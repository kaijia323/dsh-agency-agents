/**
 * `/agency-agents` command tests.
 *
 * The command is the manual way in: the human names the expert, and the handler
 * turns that into a model instruction. Two properties matter and neither is
 * visible from reading the handler — that an unresolvable expert never reaches
 * the model as a broken instruction, and that a composition without the command
 * registry still mounts the rest of the plugin.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installHarnessStub } from './stub-harness.mjs'

installHarnessStub()

const { AGENCY_COMMAND, parseAgencyInvocation, renderDelegationInstruction } = await import('../src/command.js')
const { apply } = await import('../src/index.js')

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/agency-agents-zh')

/**
 * A `commands` registry stub that keeps the definition, plus a context whose
 * `inject` mirrors Cordis: present services activate, absent ones skip.
 */
function fakeContext({ withCommands = true } = {}) {
  const commands = []
  const services = {
    tools: { register: () => {} },
    systemPrompt: { section: () => () => {} },
    subagents: { list: () => ['spawn'], getProvider: () => ({ name: 'spawn', capabilities: { persona: true } }) },
    ...(withCommands ? { commands: { register: (definition) => { commands.push(definition); return () => {} } } } : {}),
  }
  const ctx = {
    get: (name) => services[name],
    effect: (callback) => callback(),
    inject: (names, callback) => (names.every((name) => services[name] !== undefined) ? callback(ctx) : undefined),
  }
  return { ctx, commands }
}

/** Mount the plugin against the real corpus and return its command. */
async function mount(options = {}) {
  const harness = fakeContext(options)
  await apply(harness.ctx, { roster: { source: 'external', root: ROOT }, logRosterSummary: false })
  return { ...harness, command: harness.commands.find((entry) => entry.name === AGENCY_COMMAND) }
}

/** A fake agent recording what the handler submits. */
function fakeAgent() {
  const submitted = []
  return { submitted, followup: (message) => submitted.push(message) }
}

const invoke = (agent, rawInput) => ({ agent, rawInput, attachments: [], signal: new AbortController().signal })

// ── registration ───────────────────────────────────────────────────────────

test('the command registers under the exact name /agency-agents', async () => {
  const { command } = await mount()
  assert.notEqual(command, undefined, 'the command must register')
  assert.equal(command.name, 'agency-agents')
  // The registry only accepts lowercase names; a CJK display name lives in the description.
  assert.match(command.name, /^[a-z][a-z0-9-]*$/)
  assert.equal(command.description.includes('专家'), true)
})

test('a composition without the command registry still mounts the plugin', async () => {
  const harness = fakeContext({ withCommands: false })
  await apply(harness.ctx, { roster: { source: 'external', root: ROOT }, logRosterSummary: false })
  assert.equal(harness.commands.length, 0)
})

// ── parsing ────────────────────────────────────────────────────────────────

test('parsing selects a mode by prefix, and treats free text as a search', () => {
  assert.deepEqual(parseAgencyInvocation(''), { kind: 'inventory' })
  assert.deepEqual(parseAgencyInvocation('   '), { kind: 'inventory' })
  assert.deepEqual(parseAgencyInvocation(' 找 数据库慢查询'), { kind: 'search', need: '数据库慢查询' })
  assert.deepEqual(parseAgencyInvocation(' 用 engineering-code-reviewer 审查 auth.ts'), {
    kind: 'delegate',
    employee: 'engineering-code-reviewer',
    task: '审查 auth.ts',
  })
  // Forgiving by design: a human who typed a need without the keyword wants hits.
  assert.deepEqual(parseAgencyInvocation(' 帮我审代码'), { kind: 'search', need: '帮我审代码' })
  assert.equal(parseAgencyInvocation(' 找').kind, 'usage')
  assert.equal(parseAgencyInvocation(' 用').kind, 'usage')
})

test('a multi-word task keeps its internal whitespace and newlines', () => {
  const parsed = parseAgencyInvocation(' 用 代码审查员 第一行\n第二行')
  assert.equal(parsed.kind, 'delegate')
  assert.equal(parsed.employee, '代码审查员')
  assert.equal(parsed.task, '第一行\n第二行')
})

// ── handling ───────────────────────────────────────────────────────────────

test('a bare invocation renders the inventory and never touches the model', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  const result = command.handler(invoke(agent, ''))
  assert.equal(result.kind, 'success')
  assert.equal(result.text.includes('277 位专家'), true)
  assert.equal(result.text.includes('编队剧本'), true)
  assert.equal(agent.submitted.length, 0, 'an inventory is not a delegation')
})

test('a search renders hits with role ids', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  const result = command.handler(invoke(agent, ' 找 代码审查'))
  assert.equal(result.kind, 'success')
  assert.equal(result.text.includes('engineering-code-reviewer'), true)
  assert.equal(agent.submitted.length, 0)
})

test('a search with no hits explains how to recover instead of failing', async () => {
  const { command } = await mount()
  // Deliberately a CJK miss: the tokenizer splits CJK into 2-3 grams, so a
  // plausible-looking Chinese need often matches on a fragment ("需求" hits
  // several briefs). This one shares no fragment with any role.
  const result = command.handler(invoke(fakeAgent(), ' 找 紫水晶占卜术'))
  assert.equal(result.kind, 'success', 'a miss is guidance, not an error')
  assert.equal(result.text.includes('没有匹配'), true)
})

test('naming an expert submits a delegation instruction to the model', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  const result = command.handler(invoke(agent, ' 用 engineering-code-reviewer 审查 auth.ts 的会话校验'))
  assert.equal(result.kind, 'success')
  assert.equal(agent.submitted.length, 1, 'the whole point of the mode: the model receives it')

  const message = agent.submitted[0]
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'user')
  const text = message.content[0].text
  assert.equal(text.includes('代码审查员'), true, 'the resolved display name')
  assert.equal(text.includes('engineering-code-reviewer'), true)
  assert.equal(text.includes('agency_run'), true, 'it names the tool to call')
  assert.equal(text.includes('审查 auth.ts 的会话校验'), true, 'the task passes through verbatim')
})

test('a Chinese role name works as the employee, same as the tool accepts', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  const result = command.handler(invoke(agent, ' 用 代码审查员 看一下这个 PR'))
  assert.equal(result.kind, 'success')
  assert.equal(agent.submitted[0].content[0].text.includes('engineering-code-reviewer'), true)
})

// The composer REFUSES a submission carrying attachments when the definition does
// not declare them, so the handler never runs. That shipped once: a user attached
// a screenshot of a bug and got "/agency-agents 不接受附件，请先移除附件" instead of a
// delegation. Declaring support is the whole fix, so it is asserted.
test('the command declares attachment support', async () => {
  const { command } = await mount()
  assert.equal(command.input.attachments, true, 'without this the composer rejects the submission')
})

test('attachments are forwarded to the delegation instead of dropped', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  const image = { type: 'image', attachment: { id: 'att-1' } }
  const file = { type: 'file', attachment: { id: 'att-2', name: 'log.txt' } }
  const result = command.handler({
    agent,
    rawInput: ' 用 engineering-code-reviewer 看这个闪烁 bug',
    attachments: [image, file],
    signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'success')
  assert.equal(result.text.includes('2 个附件'), true, 'the confirmation says what was sent')

  const content = agent.submitted[0].content
  assert.equal(content.length, 3, 'one instruction plus two attachments')
  assert.equal(content[0].type, 'text', 'the task is read before the images')
  assert.deepEqual(content[1], image)
  assert.deepEqual(content[2], file)
})

test('a delegation without attachments submits exactly one text block', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  command.handler(invoke(agent, ' 用 engineering-code-reviewer 看一下'))
  assert.equal(agent.submitted[0].content.length, 1)
})

test('an attachment-bearing call still resolves the expert before submitting', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  const result = command.handler({
    agent,
    rawInput: ' 用 不存在的专家 看这个',
    attachments: [{ type: 'image', attachment: { id: 'att-1' } }],
    signal: new AbortController().signal,
  })
  assert.equal(result.kind, 'error')
  assert.equal(agent.submitted.length, 0, 'a bad employee name must not reach the model, attachments or not')
})

test('an unknown expert fails before reaching the model', async () => {
  const { command } = await mount()
  const agent = fakeAgent()
  const result = command.handler(invoke(agent, ' 用 不存在的专家 做点事'))
  assert.equal(result.kind, 'error')
  assert.equal(result.text.includes('没有'), true)
  assert.equal(agent.submitted.length, 0, 'a broken instruction must never be submitted')
})

test('the custom tool names flow into the submitted instruction', async () => {
  const harness = fakeContext()
  await apply(harness.ctx, {
    roster: { source: 'external', root: ROOT },
    logRosterSummary: false,
    tools: { run: 'team_run', brief: 'team_brief' },
  })
  const command = harness.commands.find((entry) => entry.name === AGENCY_COMMAND)
  const agent = fakeAgent()
  command.handler(invoke(agent, ' 用 代码审查员 x'))
  assert.equal(agent.submitted[0].content[0].text.includes('team_run'), true)
  assert.equal(agent.submitted[0].content[0].text.includes('agency_run'), false)
})

test('renderDelegationInstruction keeps the task as its own section', () => {
  const text = renderDelegationInstruction({ id: 'a-b', name: '甲' }, '做那件事', { run: 'agency_run', brief: 'agency_brief' })
  assert.equal(text.includes('## 任务\n做那件事'), true)
})
