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
  assert.equal(text.includes('engineering-code-reviewer'), false, 'no role ids in depts mode')
  assert.equal(text.length < 2000, true, `depts mode must stay cheap, got ${text.length}`)
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
  assert.equal(text.includes('## 如何使用'), true)
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
