/**
 * Persona tests.
 *
 * The load-bearing assertion is `matchesPromptEngineViolations`: it re-implements
 * the harness prompt engine's scanner (`@deepseek-ai/dsh-system-prompt`,
 * `interpolate()`) and asserts that no role body, after escaping, would make the
 * engine throw. Role bodies are third-party prose — GitHub Actions expressions,
 * Prometheus templates, Twig samples — and an unescaped `{{ … }}` group fails
 * prompt assembly for that child, which would surface as "this particular expert
 * cannot be delegated to".
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createNodeIO } from '../src/io.js'
import { loadRoster } from '../src/roster.js'
import { buildBrief, buildPersona, buildTaskPrompt, containsPromptVariable, environmentHeader, escapePromptText } from '../src/persona.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/agency-agents-zh')
const io = createNodeIO()

/** The engine's own regexes, copied from dsh-system-prompt/lib/index.js. */
const GROUP_AT = /^\{\{([^{}]*)\}\}/
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/**
 * Report every `{{ … }}` group the prompt engine would refuse to render.
 * @param {string} text - section text.
 * @returns {string[]} violations, empty when the engine would render it.
 */
function matchesPromptEngineViolations(text) {
  const violations = []
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT.exec(text.slice(open))
    if (group === null) {
      if (text.indexOf('}}', open + 2) >= 0) violations.push(`malformed reference at ${JSON.stringify(text.slice(open, open + 16))}`)
      last = open + 2
      continue
    }
    const name = group[0].slice(2, -2)
    if (!VARIABLE_NAME.test(name)) violations.push(`malformed variable name ${JSON.stringify(name)}`)
    last = open + group[0].length
  }
  return violations
}

test('escapePromptText neutralizes the token without changing visible text', () => {
  const source = 'run: ${{ secrets.GITHUB_TOKEN }} and {{ $labels.instance }}'
  const escaped = escapePromptText(source)
  assert.equal(escaped.includes('{{'), false, 'no recognizable {{ token remains')
  assert.deepEqual(matchesPromptEngineViolations(escaped), [], 'the engine would render it')
  assert.equal(escaped.replace(/\u200B/g, ''), source, 'rendered text is identical')
})

test('escapePromptText is idempotent and leaves clean text untouched', () => {
  const clean = '普通正文，没有模板语法'
  assert.equal(escapePromptText(clean), clean)
  const once = escapePromptText('a {{ b }} c')
  assert.equal(escapePromptText(once), once)
})

test('containsPromptVariable recognizes what actually breaks assembly', () => {
  assert.equal(containsPromptVariable('找 {{name}} 的注册变量'), true)
  assert.equal(containsPromptVariable('${{ secrets.GITHUB_TOKEN }}'), false, 'not a simple group the engine accepts as a name')
  assert.equal(containsPromptVariable('没有任何模板'), false)
})

test('the raw corpus does contain files the engine would reject, which is why escaping exists', async () => {
  const roster = await loadRoster(io, { root: ROOT })
  const offenders = roster.roles.filter((role) => matchesPromptEngineViolations(role.body).length > 0)
  assert.equal(offenders.length > 0, true, 'the corpus is not template-free')
  // Recorded so a corpus refresh that removes them is noticed rather than
  // silently making this whole suite vacuous.
  assert.equal(offenders.length, 9, 'nine role files carry engine-hostile template text')
})

test('every vendored role survives escaping', async () => {
  const roster = await loadRoster(io, { root: ROOT })
  for (const role of roster.roles) {
    assert.deepEqual(matchesPromptEngineViolations(escapePromptText(role.body)), [], `role ${role.id} would fail prompt assembly`)
    assert.equal(escapePromptText(role.body).replace(/\u200B/g, ''), role.body, `role ${role.id} text changed`)
  }
})

test('buildPersona escapes the composed persona, not only the body', async () => {
  const roster = await loadRoster(io, { root: ROOT })
  const hostile = roster.roles.find((role) => matchesPromptEngineViolations(role.body).length > 0)
  assert.notEqual(hostile, undefined)
  const persona = buildPersona(hostile, { cwd: '/tmp/work', extraInstructions: '要求 {{x}} 也要安全' })
  assert.deepEqual(matchesPromptEngineViolations(persona), [])
  assert.equal(persona.includes(hostile.name), true)
  assert.equal(persona.includes('/tmp/work'), true)
})

test('the environment header states the tool mapping and the missing approval channel', () => {
  const header = environmentHeader({ cwd: '/w' })
  assert.equal(header.includes('WebFetch→web_fetch'), true)
  assert.equal(header.includes('没有审批通道'), true)
  assert.equal(header.includes('/w'), true)
})

test('buildTaskPrompt frames the task and requires a self-contained deliverable', async () => {
  const roster = await loadRoster(io, { root: ROOT })
  const role = roster.resolve('engineering-code-reviewer')
  const prompt = buildTaskPrompt(role, '审查 src/a.go', { acceptance: '列出阻塞项', deliverable: '分级清单' })
  assert.equal(prompt.includes('审查 src/a.go'), true)
  assert.equal(prompt.includes('## 验收标准'), true)
  assert.equal(prompt.includes('## 交付要求'), true)
  assert.equal(prompt.includes('看不到你的中间步骤'), true)
})

test('buildBrief stays cheap and never leaks the whole body', async () => {
  const roster = await loadRoster(io, { root: ROOT })
  const role = roster.roles.find((item) => item.body.length > 20000)
  const brief = buildBrief(role)
  assert.equal(brief.length < role.body.length / 2, true, 'a brief is much smaller than the body')
  assert.equal(brief.includes(role.name), true)
  assert.equal(brief.includes('部门：'), true)
})
