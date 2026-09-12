/**
 * Catalog tests.
 *
 * Two properties matter and are asserted directly: the resident catalog has no
 * `{{` token left in it (it is third-party role text, and the prompt engine
 * would refuse to render it), and each mode's size stays in the band the design
 * chose — the compact mode is the reason 277 roles can be resident at all.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createNodeIO } from '../src/io.js'
import { loadRoster } from '../src/roster.js'
import { estimateCatalog, renderCatalog } from '../src/catalog.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/agency-agents-zh')
const io = createNodeIO()

/** @type {Awaited<ReturnType<typeof loadRoster>>} */
let roster
async function indexed() {
  if (roster === undefined) roster = await loadRoster(io, { root: ROOT })
  return roster
}

test('mode off contributes nothing', async () => {
  assert.equal(renderCatalog(await indexed(), { mode: 'off' }), '')
})

test('mode depts stays a department index', async () => {
  const text = renderCatalog(await indexed(), { mode: 'depts' })
  assert.equal(text.includes('可用部门'), true)
  assert.equal(text.includes('engineering(工程, 42人)'), true)
  // The property is that no roster is enumerated — not that no role id can
  // appear anywhere: the routing examples legitimately name a handful of roles
  // to make the mapping concrete. Department headers are what enumeration adds.
  assert.equal(/^## .+ · .+ \(\d+\)$/m.test(text), false, 'no per-department rosters in depts mode')
  assert.equal(text.length < 2600, true, `depts mode must stay cheap, got ${text.length}`)
})

test('mode compact lists every role id and name, with no summaries', async () => {
  const loaded = await indexed()
  const text = renderCatalog(loaded, { mode: 'compact' })
  for (const role of loaded.roles) {
    assert.equal(text.includes(role.id), true, `missing role id ${role.id}`)
    assert.equal(text.includes(`(${role.name})`), true, `missing role name ${role.name}`)
  }
  const estimate = estimateCatalog(loaded, 'compact')
  assert.equal(estimate.chars > 8000 && estimate.chars < 30000, true, `compact catalog size ${estimate.chars}`)
})

test('mode full adds summaries and costs more than compact', async () => {
  const loaded = await indexed()
  const compact = estimateCatalog(loaded, 'compact')
  const full = estimateCatalog(loaded, 'full')
  assert.equal(full.chars > compact.chars, true)
  assert.equal(renderCatalog(loaded, { mode: 'full' }).includes('—'), true)
})

test('no rendered mode leaves a prompt variable token behind', async () => {
  const loaded = await indexed()
  for (const mode of ['depts', 'compact', 'full']) {
    const text = renderCatalog(loaded, { mode })
    assert.equal(text.includes('{{'), false, `${mode} mode must be template-safe`)
  }
})

test('the orchestration policy ships with the catalog and names the real tools', async () => {
  const text = renderCatalog(await indexed(), { mode: 'depts' })
  assert.equal(text.includes('## 编排守则'), true)
  assert.equal(text.includes('agency_playbook'), true)
  assert.equal(text.includes('最多重试 3 次'), true)
  assert.equal(text.includes('.agency/'), true, 'state is externalized to files')
  assert.equal(text.includes('提级给人'), true, 'judgment gates escalate')
})

test('the orchestration policy can be omitted for a deployment that wants only a roster', async () => {
  const text = renderCatalog(await indexed(), { mode: 'depts', includeOrchestration: false })
  assert.equal(text.includes('## 编排守则'), false)
  assert.equal(text.includes('## 何时调用（路由门禁）'), true)
})

test('a department scope narrows the catalog to the named departments', async () => {
  const loaded = await indexed()
  const text = renderCatalog(loaded, { mode: 'compact', departments: ['engineering', 'testing'] })
  assert.equal(text.includes('engineering-code-reviewer'), true)
  assert.equal(text.includes('marketing-content-creator'), false)
})

test('custom tool names flow into the rendered instructions', async () => {
  const text = renderCatalog(await indexed(), {
    mode: 'depts',
    toolNames: { list: 'team_list', find: 'team_find', brief: 'team_brief', run: 'team_run', team: 'team_team', playbook: 'team_playbook' },
  })
  assert.equal(text.includes('team_run'), true)
  assert.equal(text.includes('agency_run'), false)
})

// The gate exists because a roster alone was not enough: the model knew who was
// available but never reached for one during ordinary requests, and the old
// policy's single "2+ perspectives, otherwise do it yourself" threshold read as
// an instruction to work alone. These assertions pin the two properties that fix
// that — an explicit routing step *before* starting work, and a single-expert
// tier that fires without requiring a team.
test('the catalog routes before work starts instead of only describing the roster', async () => {
  const text = renderCatalog(await indexed(), { mode: 'compact' })
  assert.equal(text.includes('## 何时调用（路由门禁）'), true)
  assert.equal(text.includes('接到需求先做一次判断'), true)
  assert.equal(text.includes('动手之前'), true, 'the gate must fire before the work, not after')
  assert.equal(text.includes('典型路由'), true)
})

test('the policy separates the single-expert tier from the team tier', async () => {
  const text = renderCatalog(await indexed(), { mode: 'depts' })
  assert.equal(text.includes('门槛（单点专家）'), true)
  assert.equal(text.includes('门槛（多人编队）'), true)
  // The retired wording is what suppressed delegation on ordinary requests.
  assert.equal(text.includes('才编排'), false, 'the old single high threshold must be gone')
})

test('every role id named in a routing example really exists in the roster', async () => {
  const loaded = await indexed()
  const text = renderCatalog(loaded, { mode: 'compact' })
  // Scope to the examples themselves: the orchestration hint that follows names
  // playbook ids (`micro-bugfix`), which are not roles.
  const start = text.indexOf('典型路由')
  const end = text.indexOf('## 编排守则')
  const examples = text.slice(start, end === -1 ? undefined : end)
  const named = [...new Set([...examples.matchAll(/`([a-z][a-z0-9-]*[a-z0-9])`/g)].map((m) => m[1]))]
  assert.ok(named.length >= 6, `expected the examples to name roles, found ${named.length}`)
  for (const id of named) {
    assert.notEqual(loaded.resolve(id), undefined, `routing example names unknown role "${id}"`)
  }
})
