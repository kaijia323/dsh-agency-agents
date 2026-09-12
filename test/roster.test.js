/**
 * Roster tests against the vendored corpus.
 *
 * The corpus is vendored, so these assertions are exact rather than approximate:
 * a change in the counts means the snapshot was refreshed and the expectations
 * in `data/VENDOR.md` must move with it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createNodeIO } from '../src/io.js'
import { loadRoster, normalizeLabel } from '../src/roster.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/agency-agents-zh')
const io = createNodeIO()

/** @type {Awaited<ReturnType<typeof loadRoster>>} */
let roster

test('loads the vendored corpus', async () => {
  roster = await loadRoster(io, { root: ROOT })
  assert.equal(roster.size, 277, '277 role definitions')
  assert.equal(roster.departments.length, 20, '20 departments contributed roles')
})

test('excludes the NEXUS playbooks and runbooks that sit beside the roles', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  // `strategy/` holds 16 orchestration documents and no role definitions, so it
  // must not appear as a department at all.
  assert.equal(loaded.departments.includes('strategy'), false)
  assert.equal(loaded.inDepartment('strategy').length, 0)
  // The end-to-end evidence that the non-role markdown is skipped: 293 files on
  // disk, 277 roles indexed, and none of the 16 documentation files indexed.
  assert.equal(loaded.roles.some((role) => role.id === 'phase-3-build'), false)
  assert.equal(loaded.roles.some((role) => role.id === 'nexus-strategy'), false)
  assert.equal(loaded.roles.some((role) => role.id === 'handoff-templates'), false)
  assert.equal(loaded.roles.some((role) => role.id === 'scenario-startup-mvp'), false)
})

test('indexes nested departments, not just the top level', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  const game = loaded.inDepartment('game-development')
  assert.equal(game.length, 20)
  const unity = game.filter((role) => role.path.includes('/unity/'))
  assert.equal(unity.length, 4)
  assert.equal(unity.every((role) => role.department === 'game-development'), true)
})

test('every role carries the fields the tools depend on', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  for (const role of loaded.roles) {
    assert.equal(typeof role.id, 'string', 'id')
    assert.equal(role.id.length > 0, true, `id for ${role.path}`)
    assert.equal(typeof role.name, 'string', `name for ${role.id}`)
    assert.equal(role.name.length > 0, true, `name for ${role.id}`)
    assert.equal(typeof role.body, 'string', `body for ${role.id}`)
    assert.equal(role.body.length > 0, true, `body for ${role.id}`)
    assert.equal(typeof role.description, 'string', `description for ${role.id}`)
    assert.equal(loaded.departments.includes(role.department), true, `department for ${role.id}`)
  }
})

test('role ids are unique', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  assert.equal(new Set(loaded.roles.map((role) => role.id)).size, loaded.roles.length)
})

test('display names are unique, so a name reference is never ambiguous', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  assert.equal(new Set(loaded.roles.map((role) => role.name)).size, loaded.roles.length)
})

test('resolves by id, by display name, by path form, and by playbook alias', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  assert.equal(loaded.resolve('engineering-code-reviewer').name, '代码审查员')
  assert.equal(loaded.resolve('代码审查员').id, 'engineering-code-reviewer')
  assert.equal(loaded.resolve('engineering/engineering-code-reviewer').id, 'engineering-code-reviewer')
  assert.equal(loaded.resolve('engineering-code-reviewer.md').id, 'engineering-code-reviewer')
  // The two labels the shipped playbooks use that differ from the roster names.
  assert.equal(loaded.resolve('高管摘要生成器').id, 'support-executive-summary-generator')
  assert.equal(loaded.resolve('LSP/索引工程师').id, 'lsp-index-engineer')
})

test('an unresolvable reference returns undefined and offers neighbours', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  assert.equal(loaded.resolve('完全不存在的角色名'), undefined)
  const closest = loaded.closest('架构师', 3)
  assert.equal(closest.length > 0, true)
  assert.equal(closest.every((role) => role.name.includes('架构') || role.description.includes('架构') || role.id.includes('architect')), true)
})

test('search ranks a name hit above a description hit', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  const hits = loaded.search('代码审查', { limit: 5 })
  assert.equal(hits.length > 0, true)
  assert.equal(hits[0].role.id, 'engineering-code-reviewer')
  assert.equal(hits[0].reasons.length > 0, true, 'a hit explains itself')
})

test('search honors the department filter', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  const hits = loaded.search('安全', { department: 'security', limit: 10 })
  assert.equal(hits.length > 0, true)
  assert.equal(hits.every((hit) => hit.role.department === 'security'), true)
})

test('search returns nothing rather than noise for an unrelated need', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  assert.deepEqual(loaded.search('zzzz-qqqq-xxxx', { limit: 3 }), [])
})

test('every department the playbooks gate on resolves to a real role', async () => {
  const loaded = roster ?? (await loadRoster(io, { root: ROOT }))
  // §12.1 names six stage gatekeepers; a missing one breaks a phase transition.
  const gatekeepers = [
    '高管摘要生成器',
    '工作室制片人',
    '现实检验者',
    'DevOps 自动化师',
    '证据收集者',
    '智能体编排者',
    '数据分析师',
  ]
  for (const label of gatekeepers) {
    assert.notEqual(loaded.resolve(label), undefined, `gatekeeper "${label}" must resolve`)
  }
})

test('normalizeLabel is separator- and case-insensitive', () => {
  assert.equal(normalizeLabel('LSP/索引工程师'), normalizeLabel('lsp索引工程师'))
  assert.equal(normalizeLabel('UI Designer'), normalizeLabel('ui-designer'))
})
