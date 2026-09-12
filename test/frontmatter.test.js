import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseFrontmatter, parseList } from '../src/frontmatter.js'

test('parses a flat frontmatter block and keeps the body', () => {
  const { data, body, hasFrontmatter } = parseFrontmatter(
    ['---', 'name: 代码审查员', 'description: 专业代码审查专家', 'emoji: 👀', 'color: purple', '---', '', '# 代码审查员', '你是……'].join('\n'),
  )
  assert.equal(hasFrontmatter, true)
  assert.equal(data.name, '代码审查员')
  assert.equal(data.description, '专业代码审查专家')
  assert.equal(data.emoji, '👀')
  assert.equal(body.startsWith('\n# 代码审查员'), true)
})

test('a file without a fence is not an agent', () => {
  const { data, hasFrontmatter } = parseFrontmatter('# 第 3 阶段手册\n\n正文')
  assert.equal(hasFrontmatter, false)
  assert.deepEqual(data, {})
})

test('an unterminated fence is not an agent', () => {
  const { hasFrontmatter } = parseFrontmatter('---\nname: x\n')
  assert.equal(hasFrontmatter, false)
})

test('strips matching quotes and honors blank lines inside the block', () => {
  const { data } = parseFrontmatter(['---', 'name: "带引号的名字"', 'title: \'单引号\'', '', 'color: cyan', '---', 'body'].join('\n'))
  assert.equal(data.name, '带引号的名字')
  assert.equal(data.title, '单引号')
  assert.equal(data.color, 'cyan')
})

test('joins a wrapped continuation line instead of dropping it', () => {
  const { data } = parseFrontmatter(['---', 'name: x', 'description: 第一段', '  第二段', '---', 'body'].join('\n'))
  assert.equal(data.description, '第一段 第二段')
})

test('keeps a value that itself contains a colon', () => {
  const { data } = parseFrontmatter(['---', 'description: 用法：`请使用 x/y.md`', '---', 'b'].join('\n'))
  assert.equal(data.description, '用法：`请使用 x/y.md`')
})

test('normalizes CRLF and a BOM', () => {
  const { data, hasFrontmatter } = parseFrontmatter('\uFEFF---\r\nname: x\r\n---\r\nbody')
  assert.equal(hasFrontmatter, true)
  assert.equal(data.name, 'x')
})

test('parseList splits, trims, and drops empties', () => {
  assert.deepEqual(parseList('WebFetch, WebSearch , Read'), ['WebFetch', 'WebSearch', 'Read'])
  assert.deepEqual(parseList(''), [])
  assert.deepEqual(parseList(undefined), [])
})
