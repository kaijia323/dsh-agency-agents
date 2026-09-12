/**
 * Delegation tests.
 *
 * No harness is needed: `subagents` and `jobs` are consumed as the small shapes
 * the plugin depends on, so the settlement rules — dispose on every path, keep
 * both causes when collection and disposal fail, never claim a failed run
 * completed — are testable directly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkProvider, contentToText, formatResult, runParallel, settleChild, startAsJob } from '../src/delegation.js'

const ROLE = { id: 'engineering-code-reviewer', name: '代码审查员', department: 'engineering' }

/** A `subagents`-shaped stub. */
function fakeSubagents(providers) {
  return {
    list: () => Object.keys(providers),
    getProvider: (name) => providers[name],
  }
}

test('a missing provider is reported with what is registered', () => {
  const check = checkProvider(fakeSubagents({}), 'spawn')
  assert.equal(check.ok, false)
  assert.equal(check.message.includes('未注册'), true)
})

test('a provider without the persona capability is refused before any work', () => {
  const check = checkProvider(fakeSubagents({ acp: { name: 'acp', capabilities: { persona: false } } }), 'acp')
  assert.equal(check.ok, false)
  assert.equal(check.message.includes('persona'), true)
  assert.equal(check.message.includes('spawn'), true, 'the message names a usable provider')
})

test('a persona-capable provider passes', () => {
  const provider = { name: 'spawn', capabilities: { persona: true } }
  const check = checkProvider(fakeSubagents({ spawn: provider }), 'spawn')
  assert.equal(check.ok, true)
  assert.equal(check.provider, provider)
})

test('contentToText keeps text blocks and drops attachment-bearing blocks', () => {
  const text = contentToText([
    { type: 'text', text: '第一段' },
    { type: 'image', attachment: { attachmentId: 'a', mediaType: 'image/png' } },
    { type: 'text', text: '第二段' },
    { type: 'tool-call', id: 'x', name: 'bash', arguments: '{}' },
  ])
  assert.equal(text, '第一段\n\n第二段')
  assert.equal(contentToText(undefined), '')
})

test('settleChild returns the result and always disposes', async () => {
  let disposed = 0
  const result = { stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }
  const settled = await settleChild({ result: Promise.resolve(result), dispose: async () => { disposed += 1 } })
  assert.equal(settled, result)
  assert.equal(disposed, 1)
})

test('settleChild surfaces a rejection and still disposes', async () => {
  let disposed = 0
  await assert.rejects(
    settleChild({ result: Promise.reject(new Error('child exploded')), dispose: async () => { disposed += 1 } }),
    /child exploded/,
  )
  assert.equal(disposed, 1, 'a failed child is released too')
})

test('settleChild keeps both causes when collection and disposal fail', async () => {
  await assert.rejects(
    settleChild({ result: Promise.reject(new Error('boom')), dispose: async () => { throw new Error('teardown') } }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.equal(error.errors.length, 2)
      assert.match(error.message, /boom/)
      assert.match(error.message, /teardown/)
      return true
    },
  )
})

test('a completed run is presented as complete', () => {
  const text = formatResult(ROLE, { stopReason: 'completed', output: [{ type: 'text', text: '🔴 一个阻塞项' }] })
  assert.equal(text.includes('已完成'), true)
  assert.equal(text.includes('🔴 一个阻塞项'), true)
  assert.equal(text.includes('不可视为完成'), false)
})

test('a failed run is never presented as complete', () => {
  const text = formatResult(ROLE, { stopReason: 'aborted', output: [{ type: 'text', text: '部分内容' }], diagnostic: 'cancelled by parent' })
  assert.equal(text.includes('未正常完成：aborted'), true)
  assert.equal(text.includes('不可视为完成'), true)
  assert.equal(text.includes('cancelled by parent'), true)
})

test('structured output is appended verbatim so a verdict can be read programmatically', () => {
  const text = formatResult(ROLE, { stopReason: 'completed', output: [], structured: { verdict: 'FAIL', issues: 2 } })
  assert.equal(text.includes('## 结构化产出'), true)
  assert.equal(text.includes('"verdict": "FAIL"'), true)
})

test('runParallel settles every assignment independently', async () => {
  const entries = await runParallel([
    async () => ({ role: { id: 'a', name: 'A' }, result: { stopReason: 'completed' } }),
    async () => { throw new Error('second failed') },
    async () => ({ role: { id: 'c', name: 'C' }, result: { stopReason: 'completed' } }),
  ])
  assert.equal(entries.length, 3)
  assert.equal(entries[0].result.stopReason, 'completed')
  assert.equal(entries[1].error.message, 'second failed')
  assert.equal(entries[1].role.id, 'assignment-2', 'a failed assignment still identifies its slot')
  assert.equal(entries[2].result.stopReason, 'completed')
})

test('a background job reports completed and carries the formatted output', async () => {
  let captured
  const jobs = { start: (spec) => { captured = spec; return 'subagent-7' } }
  const id = startAsJob({
    jobs,
    caller: { agent: { id: 'parent' } },
    role: ROLE,
    label: '代码审查员 · engineering-code-reviewer',
    run: async () => ({ stopReason: 'completed', output: [{ type: 'text', text: '结论' }] }),
  })
  assert.equal(id, 'subagent-7')
  assert.equal(captured.kind, 'subagent')
  assert.equal(captured.owner.id, 'parent')
  const hooks = captured.run()
  const outcome = await hooks.done
  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.output.includes('结论'), true)
})

test('a background job reports failed for a non-completed stop reason', async () => {
  let captured
  const jobs = { start: (spec) => { captured = spec; return 'subagent-8' } }
  startAsJob({
    jobs,
    caller: { agent: { id: 'parent' } },
    role: ROLE,
    label: 'x',
    run: async () => ({ stopReason: 'max-tokens', output: [], diagnostic: 'hit the cap' }),
  })
  const outcome = await captured.run().done
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.detail, 'hit the cap')
})

test('a background job turns a thrown error into a failed outcome instead of an unhandled rejection', async () => {
  let captured
  const jobs = { start: (spec) => { captured = spec; return 'subagent-9' } }
  startAsJob({
    jobs,
    caller: { agent: { id: 'parent' } },
    role: ROLE,
    label: 'x',
    run: async () => { throw new Error('start rejected') },
  })
  const outcome = await captured.run().done
  assert.equal(outcome.status, 'failed')
  assert.equal(outcome.detail, 'start rejected')
})

test('killing a background job aborts the signal its child was started with', async () => {
  let captured
  const jobs = { start: (spec) => { captured = spec; return 'subagent-10' } }
  let sawAbort = false
  startAsJob({
    jobs,
    caller: { agent: { id: 'parent' } },
    role: ROLE,
    label: 'x',
    run: async (signal) => {
      signal.addEventListener('abort', () => { sawAbort = true })
      return { stopReason: 'completed', output: [] }
    },
  })
  const hooks = captured.run()
  hooks.cancel('user asked')
  await hooks.done
  assert.equal(sawAbort, true)
})
