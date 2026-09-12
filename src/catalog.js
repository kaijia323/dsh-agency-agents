/**
 * Catalog rendering: how the 277-role library reaches the model's context.
 *
 * The library is far too large to keep resident (the full roster with summaries
 * is ~44 K characters). The catalog is therefore a ladder, and the plugin picks
 * the rung from configuration:
 *
 * - `off`     — nothing resident; the model must call `agency_list`.
 * - `depts`   — department names, counts, and the orchestration hint (~0.3 K).
 * - `compact` — department rosters with role ids and display names (~15 K).
 * - `full`    — the above plus a truncated summary per role (~44 K).
 *
 * Text substitution is applied to every rendered string: role labels and
 * summaries are third-party content that may contain `{{`, which the harness's
 * prompt engine would otherwise read as a variable reference.
 *
 * @module dsh-agency-agents/catalog
 */

import { DEPARTMENT_LABELS } from './roster.js'
import { escapePromptText } from './persona.js'

/** Characters of a role summary kept in `compact` and `full` modes. */
const SUMMARY_CHARS = 44

/**
 * The few-shot routing examples rendered under the gate.
 *
 * A roster of 277 names tells the model *who exists* but not *when to reach for
 * one*; these lines give it a concrete, imitable mapping from request shape to
 * role id. They are deliberately spread across departments and deliberately
 * short — a long list would compete for attention with the rosters themselves.
 * The role ids here are asserted by the catalog test, so a rename upstream
 * fails the suite instead of silently shipping a dangling example.
 */
const ROUTING_EXAMPLES = [
  '「帮我看看这段代码有没有问题 / 审查一下这个 PR」→ `engineering-code-reviewer`',
  '「这个功能该怎么做 / 帮我拆需求 / 排优先级」→ `product-manager`',
  '「这个定价合理吗 / 该怎么定价」→ `specialized-pricing-analyst`',
  '「这份合同有没有风险 / 帮我审一下条款」→ `legal-contract-reviewer`',
  '「这个接口慢 / 数据库查询要优化」→ `testing-performance-benchmarker` 或 `engineering-database-optimizer`',
  '「帮我做个安全测试 / 有没有漏洞」→ `security-penetration-tester`',
  '「这份财报 / 这个投资标的怎么看」→ `finance-financial-analyst`',
]

/**
 * Render the resident catalog section.
 * @param {import('./roster.js').Roster} roster - the index.
 * @param {{ mode?: 'off'|'depts'|'compact'|'full', departments?: string[], includeOrchestration?: boolean, toolNames?: { list: string, find: string, run: string, team: string, brief: string } }} [options] - render options.
 * @returns {string} the section text, or an empty string when nothing is resident.
 */
export function renderCatalog(roster, options = {}) {
  const mode = options.mode ?? 'compact'
  if (mode === 'off') return ''
  const scope = options.departments === undefined ? roster.departments : roster.departments.filter((d) => options.departments.includes(d))
  const names = options.toolNames ?? defaultToolNames()
  const lines = []
  lines.push('# 专家库（agency-agents-zh）')
  lines.push('')
  lines.push(
    `本环境内置 ${roster.size} 位中文专家角色，覆盖 ${roster.departments.length} 个部门。` +
      `委托一位专家 = 以他的专业人设、流程与交付标准启动一个独立子代理；他不会看到本会话的对话，因此任务描述必须自包含。`,
  )
  lines.push('')
  if (mode === 'depts') {
    lines.push('可用部门：' + scope.map((d) => `${d}(${DEPARTMENT_LABELS[d] ?? d}, ${roster.inDepartment(d).length}人)`).join(' · '))
    lines.push('')
  } else {
    for (const department of scope) {
      const roles = roster.inDepartment(department)
      if (roles.length === 0) continue
      lines.push(`## ${DEPARTMENT_LABELS[department] ?? department} · ${department} (${roles.length})`)
      for (const role of roles) {
        const summary = mode === 'full' && role.description.length > 0 ? ` — ${truncate(role.description, SUMMARY_CHARS)}` : ''
        lines.push(`- ${role.id} (${role.name})${summary}`)
      }
      lines.push('')
    }
  }
  lines.push('## 何时调用（路由门禁）')
  lines.push(
    `**接到需求先做一次判断：这属于哪个专业领域？** 只要它落在上面某个部门覆盖的专业范围内、需要专业判断或行业标准，就先路由，不要自己闷头做完：`,
    `- 拿不准该找谁 → ${names.find}（传需求描述，返回候选与理由），再用 ${names.brief} 看一眼职责。`,
    `- 已经知道角色 id 或中文名 → 直接 ${names.run}（employee 传角色 id 或中文名）。`,
    `- 只记得部门 → ${names.list}。`,
    '',
    `判断的时机是**动手之前**，不是做完之后。需要领域判断的工作自己全做完，等于放弃了这批专家的专业流程与交付标准——而委托他们不占用本会话的上下文：角色正文只在子代理里展开。`,
    '',
    '典型路由（示例，不是全集）：',
    ...ROUTING_EXAMPLES.map((line) => `- ${line}`),
    '',
    `纯实现、纯查询、纯机械改动自己做；一个任务需要**多个**专业视角、且交付物能分别验收时，再升级成编队：用 ${names.run} 逐个推进，或用 ${names.team} 让互不依赖的几位同时开工。`,
  )
  lines.push('')
  if (options.includeOrchestration !== false) lines.push(renderOrchestrationHint(names))
  return escapePromptText(lines.join('\n').trimEnd())
}

/**
 * The orchestration policy: when to coordinate several experts, and how far the
 * agent may go on its own before a human decision is required.
 * @param {{ list: string, find: string, run: string, team: string, brief: string, playbook: string }} names - tool names.
 * @returns {string} the hint text.
 */
export function renderOrchestrationHint(names) {
  return [
    '## 编排守则',
    '',
    '- **门槛（单点专家）**：需求只要需要专业判断、行业标准或专业交付物（审查报告、合规清单、评估结论、方案设计），就委托一位对口专家，而不是自己兼着做。专家的价值在于他那套流程与交付标准，不只是多一个视角。',
    '- **门槛（多人编队）**：需要 2 个以上不同专业视角、且各交付物能独立验收时，才升级成编队。不要为小事开会——每个专家子代理都是一次完整推理。',
    '- **三级编队**：定向任务用 3–5 位（调研→分析→汇总、修复→验证→出证据）；功能/MVP 用 15–25 位；企业级全流程才动用完整流水线。',
    '- **顺序**：每阶段有守门人，未达标不得推进。用 ' +
      names.playbook +
      ' 按需加载剧本（`micro-bugfix` / `micro-research` / `micro-perf` / `micro-ux` / `sprint-mvp` / `phase-0`..`phase-6` / `nexus` / `gates` / `handoff` / `activation`），不要凭记忆编流程。',
    '- **状态外置**：编排放到 `.agency/<项目>/` 下的文件里（`PIPELINE-STATUS.md`、任务清单、每任务的实现与 QA 证据、`handoffs/`、`escalations/`）。上下文只保留指针与摘要，流程再长也不会把你压爆。',
    '- **循环与升级**：同一任务 QA 不通过最多重试 3 次，每次把 QA 报告作为反馈传回去；第 3 次仍不通过就停下来。',
    '- **自主的边界**：机械门禁（清单是否勾满、测试是否通过）自己判；判断门禁（是否生产就绪、范围或预算变更、重试 3 次后的处置）由守门人角色给出结论后提级给人，不要自行放行。',
  ].join('\n')
}

/** Default tool names, matching the plugin's defaults. */
export function defaultToolNames() {
  return { list: 'agency_list', find: 'agency_find', brief: 'agency_brief', run: 'agency_run', team: 'agency_team', playbook: 'agency_playbook' }
}

/** Truncate on a character boundary, appending an ellipsis when cut. */
function truncate(text, limit) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`
}

/**
 * Estimated size of a rendered catalog, so a deployment can see what a mode
 * costs before committing to it.
 * @param {import('./roster.js').Roster} roster - the index.
 * @param {'off'|'depts'|'compact'|'full'} mode - catalog mode.
 * @returns {{ chars: number, approxTokens: number }} the estimate.
 */
export function estimateCatalog(roster, mode) {
  const text = renderCatalog(roster, { mode })
  // CJK-heavy text runs roughly 1.5 characters per token; this is an estimate
  // for reporting only, never a budget the plugin enforces.
  return { chars: text.length, approxTokens: Math.round(text.length / 1.5) }
}
