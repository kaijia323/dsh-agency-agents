/**
 * The orchestration playbooks.
 *
 * The corpus ships a complete multi-agent operating manual: a seven-phase
 * pipeline, a per-phase playbook, seven structured handoff templates, twelve
 * fill-in-the-blank role activation prompts, four scenario runbooks, and a
 * stage-gate table with a named gatekeeper per transition. That manual is the
 * reason autonomous orchestration is realistic here — the agent does not have
 * to invent a process, only to follow one.
 *
 * It is also ~165 K characters, so none of it is resident: this module resolves
 * a playbook by topic and reads exactly that file on demand.
 *
 * @module dsh-agency-agents/playbook
 */

import { escapePromptText } from './persona.js'

/**
 * The playbook registry. `path` is relative to the corpus root.
 * @type {ReadonlyArray<{ id: string, title: string, path: string, useWhen: string, kind: 'script'|'phase'|'scenario'|'template'|'doctrine' }>}
 */
export const PLAYBOOKS = Object.freeze([
  { id: 'nexus', title: 'NEXUS 总纲（七阶段流水线、指挥结构、激活模式、门禁总览）', path: 'strategy/nexus-strategy.md', useWhen: '需要完整流程视图、门禁表、部门依赖图或术语时', kind: 'doctrine' },
  { id: 'quickstart', title: '快速启动指南', path: 'strategy/QUICKSTART.md', useWhen: '第一次编排，想知道从哪一步开始', kind: 'doctrine' },
  { id: 'brief', title: '高管摘要（给决策者的短版）', path: 'strategy/EXECUTIVE-BRIEF.md', useWhen: '需要向人解释编排方案本身', kind: 'doctrine' },
  { id: 'phase-0', title: '第 0 阶段 — 情报与发现（守门人：高管摘要师）', path: 'strategy/playbooks/phase-0-discovery.md', useWhen: '项目起步、市场/用户/合规调研', kind: 'phase' },
  { id: 'phase-1', title: '第 1 阶段 — 策略与架构（守门人：工作室制片人 + 现实检验者）', path: 'strategy/playbooks/phase-1-strategy.md', useWhen: '定架构、品牌、预算、Sprint 计划', kind: 'phase' },
  { id: 'phase-2', title: '第 2 阶段 — 基础与脚手架（守门人：DevOps 自动化师 + 证据收集者）', path: 'strategy/playbooks/phase-2-foundation.md', useWhen: 'CI/CD、骨架应用、监控', kind: 'phase' },
  { id: 'phase-3', title: '第 3 阶段 — 构建与迭代（守门人：智能体编排者）', path: 'strategy/playbooks/phase-3-build.md', useWhen: '开发-测试循环、任务分配矩阵、并行构建轨道', kind: 'phase' },
  { id: 'phase-4', title: '第 4 阶段 — 质量与加固', path: 'strategy/playbooks/phase-4-hardening.md', useWhen: '安全、性能、可访问性加固', kind: 'phase' },
  { id: 'phase-5', title: '第 5 阶段 — 上线与增长（守门人：工作室制片人 + 数据分析师）', path: 'strategy/playbooks/phase-5-launch.md', useWhen: '部署、上线流程、增长渠道', kind: 'phase' },
  { id: 'phase-6', title: '第 6 阶段 — 运营与演进', path: 'strategy/playbooks/phase-6-operate.md', useWhen: '上线后的持续改进循环', kind: 'phase' },
  { id: 'gates', title: '质量门禁总览与失败处理', path: 'strategy/nexus-strategy.md', useWhen: '判断当前阶段能否放行', kind: 'doctrine', section: '§12' },
  { id: 'handoff', title: '交接模板（标准 / QA 通过 / QA 不通过 / 升级 / 阶段门禁 / Sprint / 事故）', path: 'strategy/coordination/handoff-templates.md', useWhen: '需要把上下文结构化交给下一位专家或升级给人', kind: 'template' },
  { id: 'activation', title: '角色激活提示词（12 份可直接填充的模板）', path: 'strategy/coordination/agent-activation-prompts.md', useWhen: '要把任务写成某位专家能直接执行的委托书', kind: 'template' },
  { id: 'micro-bugfix', title: '定向任务 — 修 Bug（后端架构师 → API 测试员 → 证据收集者）', path: 'strategy/nexus-strategy.md', useWhen: '修一个缺陷并要证据', kind: 'script', section: '§15.3' },
  { id: 'micro-research', title: '定向任务 — 市场调研（趋势研究员 → 数据分析师 → 高管摘要师）', path: 'strategy/nexus-strategy.md', useWhen: '需要一份有数据支撑的结论', kind: 'script', section: '§15.3' },
  { id: 'micro-perf', title: '定向任务 — 性能问题（性能基准师 → 基础设施运维师 → DevOps 自动化师）', path: 'strategy/nexus-strategy.md', useWhen: '系统变慢、需要基准与优化', kind: 'script', section: '§15.3' },
  { id: 'micro-ux', title: '定向任务 — UX 改进（UX 研究员 → UX 架构师 → 前端开发者 → 证据收集者）', path: 'strategy/nexus-strategy.md', useWhen: '体验问题需要研究到落地的完整链路', kind: 'script', section: '§15.3' },
  { id: 'micro-content', title: '定向任务 — 内容活动（内容创作者 → 社交媒体策略师 → 互动官）', path: 'strategy/nexus-strategy.md', useWhen: '一次跨平台内容投放', kind: 'script', section: '§15.3' },
  { id: 'micro-compliance', title: '定向任务 — 合规审计（法务合规员 → 高管摘要师）', path: 'strategy/nexus-strategy.md', useWhen: '合规/法务审查并出摘要', kind: 'script', section: '§15.3' },
  { id: 'sprint-mvp', title: '场景 — 创业 MVP 构建（NEXUS-Sprint）', path: 'strategy/runbooks/scenario-startup-mvp.md', useWhen: '从零做一个可上线的最小产品', kind: 'scenario' },
  { id: 'scenario-feature', title: '场景 — 企业级功能交付', path: 'strategy/runbooks/scenario-enterprise-feature.md', useWhen: '在大系统里交付一个功能', kind: 'scenario' },
  { id: 'scenario-incident', title: '场景 — 事故响应', path: 'strategy/runbooks/scenario-incident-response.md', useWhen: '线上故障需要定位、止血、复盘', kind: 'scenario' },
  { id: 'scenario-campaign', title: '场景 — 营销活动', path: 'strategy/runbooks/scenario-marketing-campaign.md', useWhen: '一次完整营销战役', kind: 'scenario' },
])

/**
 * Find the playbooks matching a topic, tolerant of case and separators.
 * @param {string} topic - model-supplied topic (`phase-3`, `micro-bugfix`, `门禁`, …).
 * @param {number} [limit] - maximum number of matches.
 * @returns {Array<object>} matching entries, best first.
 */
export function resolvePlaybooks(topic, limit = 2) {
  const needle = String(topic ?? '').trim().toLowerCase()
  if (needle.length === 0) return []
  const scored = []
  for (const entry of PLAYBOOKS) {
    let score = 0
    if (entry.id === needle) score += 100
    else if (entry.id.startsWith(needle) || needle.startsWith(entry.id)) score += 60
    else if (entry.id.includes(needle)) score += 30
    if (entry.title.toLowerCase().includes(needle)) score += 20
    if (entry.useWhen.toLowerCase().includes(needle)) score += 10
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((hit) => hit.entry)
}

/**
 * Render one playbook for the model.
 *
 * Two entry points use this: `agency_playbook(topic)` reads the file, and the
 * orchestration hint points at it instead of restating the manual. A `section`
 * entry carrying a heading extracts just that heading's subtree, which is how a
 * single-topic view (`gates`, the Micro scripts) stays cheap.
 * @param {import('./io.js').RosterIO} io - file access.
 * @param {string} root - corpus root.
 * @param {object} entry - a {@link PLAYBOOKS} entry.
 * @param {{ maxChars?: number }} [options] - render options.
 * @returns {Promise<string>} the rendered playbook.
 */
export async function renderPlaybook(io, root, entry, options = {}) {
  const maxChars = options.maxChars ?? 24000
  const raw = await io.readText(`${root}/${entry.path}`)
  let text = raw
  if (typeof entry.section === 'string') {
    const extracted = extractSection(raw, entry.section)
    if (extracted !== undefined) text = extracted
  }
  const truncated = text.length > maxChars
  const body = truncated ? `${text.slice(0, maxChars)}\n\n…（本文件共 ${text.length} 字符，已截断；需要完整内容请直接读 ${entry.path}）` : text
  const header = [`# 剧本：${entry.id}`, '', `**${entry.title}**`, '', `适用：${entry.useWhen}`, `来源：data/agency-agents-zh/${entry.path}${entry.section === undefined ? '' : `（${entry.section}）`}`, '', '---', ''].join('\n')
  return escapePromptText(`${header}${body}`)
}

/**
 * Extract a heading's subtree.
 *
 * Matching is deliberately loose because the caller is a model quoting a topic,
 * not a parser: `质量门禁`, `12`, and `§12` all have to reach the same section of
 * the strategy manual. The section ends at the next heading of the same or
 * shallower level.
 */
function extractSection(text, section) {
  const key = section.replace(/^§\s*/, '').trim().toLowerCase()
  const lines = text.split('\n')
  const headings = headingLines(lines)
  let start = -1
  let best = 0
  for (const [index, title] of headings) {
    const score = headingScore(title, key)
    if (score > best) {
      best = score
      start = index
    }
  }
  if (start < 0) return undefined
  const level = /^(#{2,4})/.exec(lines[start].trim())[1].length
  let end = lines.length
  for (const [index, , depth] of headings) {
    if (index > start && depth <= level) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n').trim()
}

/**
 * The real headings of a document: level, and index.
 *
 * Fenced code blocks are skipped. The manual's own examples are shell and YAML
 * snippets whose comment lines start with `#` (`# 第一步：初始化 NEXUS 流水线`),
 * and treating those as headings truncates every section that contains an
 * example — which is most of them.
 * @param {string[]} lines - the document's lines.
 * @returns {Array<[number, string, number]>} `[index, title, level]` per heading.
 */
function headingLines(lines) {
  const headings = []
  let fenced = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^(#{2,4})\s+(.+?)\s*$/.exec(line)
    if (match !== null) headings.push([i, match[2], match[1].length])
  }
  return headings
}

/** How well one heading title answers to a normalized topic key; 0 means not at all. */
function headingScore(title, key) {
  const text = title.toLowerCase().replace(/[*`]/g, '').trim()
  const numbered = /^(\d+(?:\.\d+)*)[.、]?\s*(.*)$/.exec(text)
  if (numbered !== null) {
    const [, number, rest] = numbered
    if (number === key || `${number}.` === key) return 100
    if (rest.length > 0 && rest === key) return 90
    if (rest.length > 0 && rest.startsWith(key)) return 70
    if (number.startsWith(key)) return 40
  }
  if (text === key) return 95
  if (text.startsWith(`${key}.`) || text.startsWith(`${key} `) || text.startsWith(`${key}—`) || text.startsWith(`${key}-`)) return 60
  if (text.includes(key)) return 20
  return 0
}

/**
 * A compact index of every playbook id, for the tool description and for a
 * caller that asked for an unknown topic.
 * @returns {string} one line per playbook.
 */
export function playbookIndex() {
  return PLAYBOOKS.map((entry) => `- ${entry.id} — ${entry.title}`).join('\n')
}
