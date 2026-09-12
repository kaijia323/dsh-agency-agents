/**
 * Expert squads: the curated teams the NEXUS manual actually deploys.
 *
 * The manual is explicit about *who* works together for a given kind of job —
 * the Micro configurations of `strategy/nexus-strategy.md` §15.3, the phase 3
 * assignment matrix, and the four parallel build tracks of §6.3. Those
 * combinations are the single most reusable thing in the corpus, so they live
 * here as data rather than only as prose the model has to rediscover.
 *
 * Two consumers read this: the model (through the `agency_team`/`agency_run`
 * flow, where a squad names a proven cast) and the 专家团 settings page, which
 * renders each squad with its members and issues.
 *
 * Every `steps[].employee` must resolve in the roster; `test/squads.test.js`
 * enforces it, because a squad that names a role the library does not have
 * would send the model hunting for a expert that does not exist.
 *
 * @module dsh-agency-agents/squads
 */

/**
 * @typedef {object} SquadStep
 * @property {string} employee - role id from the roster.
 * @property {string} role - what this member does in the squad.
 * @property {boolean} [optional] - the manual marks this member as activated on demand.
 */

/**
 * @typedef {object} Squad
 * @property {string} id
 * @property {string} name
 * @property {string} group - display grouping on the settings page.
 * @property {string} scale - Micro / Sprint / Full, matching the manual's three deployment modes.
 * @property {string} when - the trigger condition, in the manual's own terms.
 * @property {string} [gatekeeper] - the role that decides whether the work passes, when the manual names one.
 * @property {string} playbook - the playbook topic to load before running this squad.
 * @property {SquadStep[]} steps
 */

/** @type {ReadonlyArray<Squad>} */
export const SQUADS = Object.freeze([
  // ── 定向任务（NEXUS-Micro，来自 §15.3） ──────────────────────────────────
  {
    id: 'bugfix',
    name: '缺陷修复闭环',
    group: '定向任务',
    scale: 'Micro · 3 人',
    when: '修一个具体缺陷，并且要能拿出可核对的证据',
    gatekeeper: 'testing-evidence-collector',
    playbook: 'micro-bugfix',
    steps: [
      { employee: 'engineering-backend-architect', role: '定位根因并实现修复' },
      { employee: 'testing-api-tester', role: '验证修复与回归路径' },
      { employee: 'testing-evidence-collector', role: '出具可核对的证据（守门人）' },
    ],
  },
  {
    id: 'research',
    name: '市场调研结论',
    group: '定向任务',
    scale: 'Micro · 3 人',
    when: '需要一份有数据支撑、能给决策者看的研究结论',
    gatekeeper: 'support-executive-summary-generator',
    playbook: 'micro-research',
    steps: [
      { employee: 'product-trend-researcher', role: '收集市场与竞品情报' },
      { employee: 'support-analytics-reporter', role: '把数据变成结论' },
      { employee: 'support-executive-summary-generator', role: '压缩成决策者可读的摘要（守门人）' },
    ],
  },
  {
    id: 'performance',
    name: '性能问题攻坚',
    group: '定向任务',
    scale: 'Micro · 3 人',
    when: '系统变慢或有明确性能指标不达标',
    playbook: 'micro-perf',
    steps: [
      { employee: 'testing-performance-benchmarker', role: '建立基线并定位瓶颈' },
      { employee: 'support-infrastructure-maintainer', role: '调整运行环境与容量' },
      { employee: 'engineering-devops-automator', role: '把优化固化进流水线' },
    ],
  },
  {
    id: 'ux',
    name: '体验改进链路',
    group: '定向任务',
    scale: 'Micro · 4 人',
    when: '体验问题需要从研究一路走到落地',
    gatekeeper: 'testing-evidence-collector',
    playbook: 'micro-ux',
    steps: [
      { employee: 'design-ux-researcher', role: '找到真实痛点' },
      { employee: 'design-ux-architect', role: '把痛点转成交互结构' },
      { employee: 'engineering-frontend-developer', role: '实现' },
      { employee: 'testing-evidence-collector', role: '验证并留证（守门人）' },
    ],
  },
  {
    id: 'content',
    name: '内容投放活动',
    group: '定向任务',
    scale: 'Micro · 3 人起',
    when: '一次跨平台的内容投放',
    playbook: 'micro-content',
    steps: [
      { employee: 'marketing-content-creator', role: '产出内容与编辑日历' },
      { employee: 'marketing-social-media-strategist', role: '制定平台策略' },
      { employee: 'marketing-x-twitter-intelligence-analyst', role: '实时互动与扩散', optional: true },
    ],
  },
  {
    id: 'compliance',
    name: '合规审查',
    group: '定向任务',
    scale: 'Micro · 3 人',
    when: '需要合规/法务结论并向上汇报',
    gatekeeper: 'support-executive-summary-generator',
    playbook: 'micro-compliance',
    steps: [
      { employee: 'security-compliance-auditor', role: '审查合规缺口' },
      { employee: 'legal-contract-reviewer', role: '审查合同与条款风险', optional: true },
      { employee: 'support-executive-summary-generator', role: '出决策摘要（守门人）' },
    ],
  },

  // ── 阶段门禁（来自 §12.1 的门禁总览） ────────────────────────────────────
  {
    id: 'gate-discovery',
    name: '发现门禁（0 → 1）',
    group: '阶段门禁',
    scale: 'Gate',
    when: '判断"市场是否已验证、需求是否已确认、监管路径是否清晰"',
    gatekeeper: 'support-executive-summary-generator',
    playbook: 'gates',
    steps: [
      { employee: 'product-trend-researcher', role: '市场与竞品情报' },
      { employee: 'design-ux-researcher', role: '用户需求确认' },
      { employee: 'legal-policy-writer', role: '监管路径梳理', optional: true },
      { employee: 'support-executive-summary-generator', role: '给出放行结论（守门人）' },
    ],
  },
  {
    id: 'gate-production',
    name: '生产门禁（4 → 5）',
    group: '阶段门禁',
    scale: 'Gate',
    when: '判断"是否生产就绪"——手册指定现实检验者为唯一权威',
    gatekeeper: 'testing-reality-checker',
    playbook: 'gates',
    steps: [
      { employee: 'testing-reality-checker', role: '基于证据认证，默认 NEEDS WORK（唯一权威）' },
      { employee: 'security-penetration-tester', role: '安全验证', optional: true },
      { employee: 'testing-accessibility-auditor', role: '可访问性验证', optional: true },
    ],
  },

  // ── 阶段编队 ────────────────────────────────────────────────────────────
  {
    id: 'sprint-mvp',
    name: 'MVP 冲刺编队',
    group: '阶段编队',
    scale: 'Sprint · 15–25 人（首批核心 10 人）',
    when: '从零做一个能上线的最小产品',
    gatekeeper: 'testing-reality-checker',
    playbook: 'sprint-mvp',
    steps: [
      { employee: 'project-manager-senior', role: '规格拆成可执行任务' },
      { employee: 'design-ux-architect', role: '信息架构与交互基础' },
      { employee: 'design-ui-designer', role: '设计系统与界面' },
      { employee: 'engineering-frontend-developer', role: '前端实现' },
      { employee: 'engineering-backend-architect', role: '服务端与数据模型' },
      { employee: 'engineering-devops-automator', role: 'CI/CD 与部署' },
      { employee: 'testing-evidence-collector', role: '逐任务 QA' },
      { employee: 'testing-reality-checker', role: '最终集成认证（守门人）' },
      { employee: 'support-analytics-reporter', role: '上线后度量', optional: true },
      { employee: 'finance-financial-analyst', role: '成本与定价视角', optional: true },
    ],
  },
  {
    id: 'phase-3-tracks',
    name: '四条并行构建轨道（阶段 3）',
    group: '阶段编队',
    scale: 'Full · 4 轨并行',
    when: '阶段 3 构建期：各轨道内部无依赖，可同时开工',
    gatekeeper: 'agents-orchestrator',
    playbook: 'phase-3',
    steps: [
      { employee: 'engineering-frontend-developer', role: '轨道 A · 核心产品：界面实现' },
      { employee: 'engineering-backend-architect', role: '轨道 A · 核心产品：API 与业务逻辑' },
      { employee: 'marketing-growth-hacker', role: '轨道 B · 增长营销：获客实验' },
      { employee: 'marketing-content-creator', role: '轨道 B · 增长营销：上线内容' },
      { employee: 'testing-evidence-collector', role: '轨道 C · 质量运营：持续 QA' },
      { employee: 'testing-performance-benchmarker', role: '轨道 C · 质量运营：压力测试' },
      { employee: 'design-ui-designer', role: '轨道 D · 品牌体验：组件打磨' },
      { employee: 'design-brand-guardian', role: '轨道 D · 品牌体验：一致性审计' },
    ],
  },

  // ── 评审与加固 ──────────────────────────────────────────────────────────
  {
    id: 'code-review-board',
    name: '代码评审会审',
    group: '评审与加固',
    scale: 'Micro · 3 人（并行）',
    when: '一次改动需要正确性、安全、可维护性三个视角同时给意见',
    gatekeeper: 'engineering-code-reviewer',
    playbook: 'handoff',
    steps: [
      { employee: 'engineering-code-reviewer', role: '正确性与可维护性' },
      { employee: 'security-appsec-engineer', role: '安全视角' },
      { employee: 'testing-test-results-analyzer', role: '测试覆盖与质量信号' },
    ],
  },
  {
    id: 'security-hardening',
    name: '安全加固',
    group: '评审与加固',
    scale: 'Micro · 4 人',
    when: '上线前的安全加固或一次安全事件后的补强',
    gatekeeper: 'testing-reality-checker',
    playbook: 'phase-4',
    steps: [
      { employee: 'security-architect', role: '威胁建模与架构审查' },
      { employee: 'security-penetration-tester', role: '主动验证可利用性' },
      { employee: 'security-incident-responder', role: '响应与止血预案' },
      { employee: 'security-compliance-auditor', role: '合规对照' },
    ],
  },
  {
    id: 'incident',
    name: '线上事故响应',
    group: '评审与加固',
    scale: 'Micro · 4 人',
    when: '线上故障：定位、止血、复盘',
    gatekeeper: 'support-executive-summary-generator',
    playbook: 'scenario-incident',
    steps: [
      { employee: 'security-incident-responder', role: '指挥响应与止血' },
      { employee: 'support-infrastructure-maintainer', role: '恢复系统状态' },
      { employee: 'engineering-sre', role: '定位根因与可靠性改进' },
      { employee: 'support-executive-summary-generator', role: '对外与向上通报（守门人）' },
    ],
  },

  // ── 单点专家（不成队，但最常被点名） ────────────────────────────────────
  {
    id: 'solo-frequent',
    name: '高频单点专家',
    group: '单点专家',
    scale: 'Solo',
    when: '任务只需要一个专业视角——直接 agency_run，不要为此组队',
    playbook: 'quickstart',
    steps: [
      { employee: 'engineering-code-reviewer', role: '代码审查' },
      { employee: 'engineering-software-architect', role: '架构决策' },
      { employee: 'specialized-pricing-analyst', role: '定价策略' },
      { employee: 'product-manager', role: '需求澄清与排期' },
      { employee: 'engineering-technical-writer', role: '文档撰写' },
      { employee: 'support-analytics-reporter', role: '数据分析' },
    ],
  },
])

/**
 * Resolve the squads that name a given role, so the expert page can answer
 * "who does this expert usually work with".
 * @param {string} roleId - roster role id.
 * @returns {Squad[]} squads containing that role.
 */
export function squadsForRole(roleId) {
  return SQUADS.filter((squad) => squad.steps.some((step) => step.employee === roleId))
}

/**
 * Every role id any squad names, deduplicated. Used to mark squad members in
 * the expert list.
 * @returns {Set<string>} the ids.
 */
export function squadRoleIds() {
  const ids = new Set()
  for (const squad of SQUADS) for (const step of squad.steps) ids.add(step.employee)
  return ids
}
