/**
 * Playbook tests.
 *
 * The playbooks are the corpus's orchestration manual, and the two facts worth
 * guarding are that every registered topic resolves to a real, readable file and
 * that the rendered text is template-safe — the manual contains workflow samples
 * (`${{ github.sha }}`) and is fed straight into the conversation.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createNodeIO } from '../src/io.js'
import { PLAYBOOKS, playbookIndex, renderPlaybook, resolvePlaybooks } from '../src/playbook.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/agency-agents-zh')
const io = createNodeIO()

test('every registered playbook exists and renders', async () => {
  for (const entry of PLAYBOOKS) {
    const text = await renderPlaybook(io, ROOT, entry)
    assert.equal(text.length > 200, true, `${entry.id} rendered too little`)
    assert.equal(text.includes(entry.id), true, `${entry.id} header`)
    assert.equal(text.includes('{{'), false, `${entry.id} must be template-safe`)
  }
})

test('topic resolution is forgiving about separators and case', () => {
  assert.equal(resolvePlaybooks('phase-3')[0].id, 'phase-3')
  assert.equal(resolvePlaybooks('PHASE-3')[0].id, 'phase-3')
  assert.equal(resolvePlaybooks('micro-bugfix')[0].id, 'micro-bugfix')
  assert.equal(resolvePlaybooks('bugfix')[0].id, 'micro-bugfix')
  assert.equal(resolvePlaybooks('sprint')[0].id, 'sprint-mvp')
  assert.deepEqual(resolvePlaybooks('完全不存在的话题'), [])
})

test('the Chinese topic words a model is likely to use reach the manual', () => {
  // `gates` and `nexus` both point at the strategy manual; a Chinese topic word
  // must not silently return nothing.
  assert.equal(resolvePlaybooks('质量门禁').length > 0, true)
  assert.equal(resolvePlaybooks('交接').length > 0, true)
})

test('a section-scoped playbook extracts only that heading', async () => {
  const gates = PLAYBOOKS.find((entry) => entry.id === 'gates')
  const text = await renderPlaybook(io, ROOT, gates)
  assert.equal(text.includes('门禁总览'), true)
  assert.equal(text.length < 6000, true, `gate extract must stay small, got ${text.length}`)
})

test('a Micro script keeps its squad list and stays small', async () => {
  const entry = PLAYBOOKS.find((item) => item.id === 'micro-bugfix')
  const text = await renderPlaybook(io, ROOT, entry)
  assert.equal(text.includes('NEXUS-Micro'), true)
  assert.equal(text.length < 4000, true, `micro script size ${text.length}`)
})

test('the index lists every playbook id', () => {
  const index = playbookIndex()
  for (const entry of PLAYBOOKS) assert.equal(index.includes(entry.id), true)
})
