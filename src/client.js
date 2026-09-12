/**
 * The 专家团 settings page — Client half.
 *
 * Registers one page into `settings.section`, so it appears in the settings
 * panel beside 通用设置 / 模型 / 插件 / Agent 预设. The page renders the live
 * roster grouped by department, tags squad members, and lists the curated
 * squads the NEXUS manual actually deploys.
 *
 * Two properties are deliberate:
 *
 * - **No imports.** This module is also the browser bundle, and the harness
 *   resolves a client bundle against a frozen module table (React, Cordis, and
 *   static UI libraries). Keeping it import-free means the bundle needs no
 *   bundler and no external declarations — the only runtime values it uses are
 *   the Client builtins `React`, `styles`, `host`, and `console`. The squad
 *   catalog is therefore inline; `test/squads.test.js` asserts it stays
 *   identical to `src/squads.js`, which is what the Host half ships.
 * - **Read-only.** There is no setting to change, so nothing here can drift out
 *   of sync with what the model is actually able to call.
 *
 * @module dsh-agency-agents/client
 */

/** CSS class prefix, so the page's styles cannot collide with the shell's. */
const P = 'dsa'

/**
 * The squad catalog, mirroring `src/squads.js`.
 *
 * Inline because this module is also the browser bundle and must import
 * nothing; `test/squads.test.js` asserts it stays identical to the shipped
 * catalog, so the two cannot drift silently.
 */
const SQUADS = [
  { id: 'bugfix', name: '缺陷修复闭环', group: '定向任务', scale: 'Micro · 3 人', when: '修一个具体缺陷，并且要能拿出可核对的证据', gatekeeper: 'testing-evidence-collector', playbook: 'micro-bugfix', steps: [{ employee: 'engineering-backend-architect', role: '定位根因并实现修复' }, { employee: 'testing-api-tester', role: '验证修复与回归路径' }, { employee: 'testing-evidence-collector', role: '出具可核对的证据（守门人）' }] },
  { id: 'research', name: '市场调研结论', group: '定向任务', scale: 'Micro · 3 人', when: '需要一份有数据支撑、能给决策者看的研究结论', gatekeeper: 'support-executive-summary-generator', playbook: 'micro-research', steps: [{ employee: 'product-trend-researcher', role: '收集市场与竞品情报' }, { employee: 'support-analytics-reporter', role: '把数据变成结论' }, { employee: 'support-executive-summary-generator', role: '压缩成决策者可读的摘要（守门人）' }] },
  { id: 'performance', name: '性能问题攻坚', group: '定向任务', scale: 'Micro · 3 人', when: '系统变慢或有明确性能指标不达标', gatekeeper: null, playbook: 'micro-perf', steps: [{ employee: 'testing-performance-benchmarker', role: '建立基线并定位瓶颈' }, { employee: 'support-infrastructure-maintainer', role: '调整运行环境与容量' }, { employee: 'engineering-devops-automator', role: '把优化固化进流水线' }] },
  { id: 'ux', name: '体验改进链路', group: '定向任务', scale: 'Micro · 4 人', when: '体验问题需要从研究一路走到落地', gatekeeper: 'testing-evidence-collector', playbook: 'micro-ux', steps: [{ employee: 'design-ux-researcher', role: '找到真实痛点' }, { employee: 'design-ux-architect', role: '把痛点转成交互结构' }, { employee: 'engineering-frontend-developer', role: '实现' }, { employee: 'testing-evidence-collector', role: '验证并留证（守门人）' }] },
  { id: 'content', name: '内容投放活动', group: '定向任务', scale: 'Micro · 3 人起', when: '一次跨平台的内容投放', gatekeeper: null, playbook: 'micro-content', steps: [{ employee: 'marketing-content-creator', role: '产出内容与编辑日历' }, { employee: 'marketing-social-media-strategist', role: '制定平台策略' }, { employee: 'marketing-x-twitter-intelligence-analyst', role: '实时互动与扩散', optional: true }] },
  { id: 'compliance', name: '合规审查', group: '定向任务', scale: 'Micro · 3 人', when: '需要合规/法务结论并向上汇报', gatekeeper: 'support-executive-summary-generator', playbook: 'micro-compliance', steps: [{ employee: 'security-compliance-auditor', role: '审查合规缺口' }, { employee: 'legal-contract-reviewer', role: '审查合同与条款风险', optional: true }, { employee: 'support-executive-summary-generator', role: '出决策摘要（守门人）' }] },
  { id: 'gate-discovery', name: '发现门禁（0 → 1）', group: '阶段门禁', scale: 'Gate', when: '判断"市场是否已验证、需求是否已确认、监管路径是否清晰"', gatekeeper: 'support-executive-summary-generator', playbook: 'gates', steps: [{ employee: 'product-trend-researcher', role: '市场与竞品情报' }, { employee: 'design-ux-researcher', role: '用户需求确认' }, { employee: 'legal-policy-writer', role: '监管路径梳理', optional: true }, { employee: 'support-executive-summary-generator', role: '给出放行结论（守门人）' }] },
  { id: 'gate-production', name: '生产门禁（4 → 5）', group: '阶段门禁', scale: 'Gate', when: '判断"是否生产就绪"——手册指定现实检验者为唯一权威', gatekeeper: 'testing-reality-checker', playbook: 'gates', steps: [{ employee: 'testing-reality-checker', role: '基于证据认证，默认 NEEDS WORK（唯一权威）' }, { employee: 'security-penetration-tester', role: '安全验证', optional: true }, { employee: 'testing-accessibility-auditor', role: '可访问性验证', optional: true }] },
  { id: 'sprint-mvp', name: 'MVP 冲刺编队', group: '阶段编队', scale: 'Sprint · 15–25 人（首批核心 10 人）', when: '从零做一个能上线的最小产品', gatekeeper: 'testing-reality-checker', playbook: 'sprint-mvp', steps: [{ employee: 'project-manager-senior', role: '规格拆成可执行任务' }, { employee: 'design-ux-architect', role: '信息架构与交互基础' }, { employee: 'design-ui-designer', role: '设计系统与界面' }, { employee: 'engineering-frontend-developer', role: '前端实现' }, { employee: 'engineering-backend-architect', role: '服务端与数据模型' }, { employee: 'engineering-devops-automator', role: 'CI/CD 与部署' }, { employee: 'testing-evidence-collector', role: '逐任务 QA' }, { employee: 'testing-reality-checker', role: '最终集成认证（守门人）' }, { employee: 'support-analytics-reporter', role: '上线后度量', optional: true }, { employee: 'finance-financial-analyst', role: '成本与定价视角', optional: true }] },
  { id: 'phase-3-tracks', name: '四条并行构建轨道（阶段 3）', group: '阶段编队', scale: 'Full · 4 轨并行', when: '阶段 3 构建期：各轨道内部无依赖，可同时开工', gatekeeper: 'agents-orchestrator', playbook: 'phase-3', steps: [{ employee: 'engineering-frontend-developer', role: '轨道 A · 核心产品：界面实现' }, { employee: 'engineering-backend-architect', role: '轨道 A · 核心产品：API 与业务逻辑' }, { employee: 'marketing-growth-hacker', role: '轨道 B · 增长营销：获客实验' }, { employee: 'marketing-content-creator', role: '轨道 B · 增长营销：上线内容' }, { employee: 'testing-evidence-collector', role: '轨道 C · 质量运营：持续 QA' }, { employee: 'testing-performance-benchmarker', role: '轨道 C · 质量运营：压力测试' }, { employee: 'design-ui-designer', role: '轨道 D · 品牌体验：组件打磨' }, { employee: 'design-brand-guardian', role: '轨道 D · 品牌体验：一致性审计' }] },
  { id: 'code-review-board', name: '代码评审会审', group: '评审与加固', scale: 'Micro · 3 人（并行）', when: '一次改动需要正确性、安全、可维护性三个视角同时给意见', gatekeeper: 'engineering-code-reviewer', playbook: 'handoff', steps: [{ employee: 'engineering-code-reviewer', role: '正确性与可维护性' }, { employee: 'security-appsec-engineer', role: '安全视角' }, { employee: 'testing-test-results-analyzer', role: '测试覆盖与质量信号' }] },
  { id: 'security-hardening', name: '安全加固', group: '评审与加固', scale: 'Micro · 4 人', when: '上线前的安全加固或一次安全事件后的补强', gatekeeper: 'testing-reality-checker', playbook: 'phase-4', steps: [{ employee: 'security-architect', role: '威胁建模与架构审查' }, { employee: 'security-penetration-tester', role: '主动验证可利用性' }, { employee: 'security-incident-responder', role: '响应与止血预案' }, { employee: 'security-compliance-auditor', role: '合规对照' }] },
  { id: 'incident', name: '线上事故响应', group: '评审与加固', scale: 'Micro · 4 人', when: '线上故障：定位、止血、复盘', gatekeeper: 'support-executive-summary-generator', playbook: 'scenario-incident', steps: [{ employee: 'security-incident-responder', role: '指挥响应与止血' }, { employee: 'support-infrastructure-maintainer', role: '恢复系统状态' }, { employee: 'engineering-sre', role: '定位根因与可靠性改进' }, { employee: 'support-executive-summary-generator', role: '对外与向上通报（守门人）' }] },
  { id: 'solo-frequent', name: '高频单点专家', group: '单点专家', scale: 'Solo', when: '任务只需要一个专业视角——直接 agency_run，不要为此组队', gatekeeper: null, playbook: 'quickstart', steps: [{ employee: 'engineering-code-reviewer', role: '代码审查' }, { employee: 'engineering-software-architect', role: '架构决策' }, { employee: 'specialized-pricing-analyst', role: '定价策略' }, { employee: 'product-manager', role: '需求澄清与排期' }, { employee: 'engineering-technical-writer', role: '文档撰写' }, { employee: 'support-analytics-reporter', role: '数据分析' }] },
]

const CSS = `
.${P}-page { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 24px; color: var(--dsw-alias-label-primary); }
.${P}-head { display: flex; flex-direction: column; gap: 6px; }
.${P}-title { font-size: 16px; font-weight: 600; }
.${P}-sub { font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.7; }
.${P}-search { width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 13px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.${P}-search:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.${P}-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.${P}-chip { padding: 4px 10px; font-size: 12px; border-radius: 999px; cursor: pointer; user-select: none;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
.${P}-chip:hover { border-color: var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); }
.${P}-chip[data-on="1"] { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
.${P}-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); padding-bottom: 8px; }
.${P}-tab { padding: 5px 12px; font-size: 13px; border-radius: 8px; cursor: pointer; user-select: none; color: var(--dsw-alias-label-secondary); }
.${P}-tab[data-on="1"] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-weight: 600; }
.${P}-count { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.${P}-group { display: flex; flex-direction: column; gap: 8px; }
.${P}-grouphead { display: flex; align-items: baseline; gap: 8px; font-size: 13px; font-weight: 600; margin-top: 4px; }
.${P}-grouphead span { font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-secondary); }
.${P}-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(266px, 1fr)); gap: 8px; }
.${P}-card { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.${P}-card:hover { border-color: var(--dsw-alias-border-l2); }
.${P}-row { display: flex; align-items: center; gap: 8px; }
.${P}-name { font-size: 13px; font-weight: 600; }
.${P}-emoji { font-size: 15px; line-height: 1; }
.${P}-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--dsw-alias-label-secondary);
  cursor: pointer; overflow-wrap: anywhere; }
.${P}-id:hover { color: var(--dsw-alias-brand-primary); }
.${P}-desc { font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
.${P}-tag { margin-left: auto; flex: 0 0 auto; font-size: 10px; padding: 2px 6px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.${P}-squad { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); }
.${P}-squadhead { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.${P}-squadname { font-size: 13px; font-weight: 600; }
.${P}-scale { font-size: 10px; padding: 2px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); }
.${P}-caret { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.${P}-when { font-size: 12px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
.${P}-steps { display: flex; flex-direction: column; gap: 5px; margin: 2px 0 0; padding: 0; list-style: none; }
.${P}-step { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.${P}-stepno { flex: 0 0 20px; color: var(--dsw-alias-label-secondary); }
.${P}-stepname { cursor: pointer; font-weight: 600; }
.${P}-stepname:hover { color: var(--dsw-alias-brand-primary); }
.${P}-steprole { color: var(--dsw-alias-label-secondary); }
.${P}-gate { font-size: 11px; color: var(--dsw-alias-state-warn-primary); }
.${P}-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; line-height: 1.8; }
.${P}-empty { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 16px 0; }
.${P}-err { font-size: 12px; color: var(--dsw-alias-state-error-primary); line-height: 1.7; }
`

/**
 * Register the 专家团 page and return its disposer.
 *
 * Deliberately a plain function rather than something that reaches for harness
 * client services: the published bundle is generated from this module by
 * `tools/build-client.mjs`, and inside that bundle the factory receives no
 * `ctx`-bound helpers beyond the page's own globals. `slots.inject` waits for the
 * shell to declare `settings.section`, so the page never depends on mount order,
 * and the returned disposer removes it with the plugin.
 * @param {object} ctx - the Client context.
 * @returns {(() => void) | undefined} the slot disposer, or undefined when no slots service is mounted.
 */
export function registerSettingsPage(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) {
    console.error('agency-agents: slots service unavailable; the 专家团 page was not registered')
    return undefined
  }
  return slots.inject('settings.section', () =>
    slots.register({ name: 'settings.section', id: 'agency-agents', order: 30, label: '专家团' }, () =>
      React.createElement(AgencyPage, null),
    ),
  )
}

/** The page: one RPC fetch, then two tabs over the same payload. */
function AgencyPage() {
  const [state, setState] = React.useState({ phase: 'loading', data: null, error: '' })
  const [tab, setTab] = React.useState('experts')
  const [need, setNeed] = React.useState('')
  const [department, setDepartment] = React.useState('')
  const [openSquad, setOpenSquad] = React.useState('')

  React.useEffect(() => {
    // The bundle has no `styles` builtin, so the page owns its own <style>.
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    return () => {
      style.remove()
    }
  }, [])

  React.useEffect(() => {
    let live = true
    host.call('agency/settings', null).then(
      (data) => {
        if (live) setState({ phase: 'ready', data: data, error: '' })
      },
      (error) => {
        if (live) setState({ phase: 'failed', data: null, error: String((error && error.message) || error) })
      },
    )
    return () => {
      live = false
    }
  }, [])

  if (state.phase === 'loading') {
    return React.createElement('div', { className: `${P}-page` }, React.createElement('div', { className: `${P}-empty` }, '正在读取专家库…'))
  }
  if (state.phase === 'failed') {
    return React.createElement(
      'div',
      { className: `${P}-page` },
      React.createElement('div', { className: `${P}-err` }, `读取专家库失败：${state.error}`),
      React.createElement('div', { className: `${P}-sub` }, '请确认 dsh-agency-agents 的 Host 行已加载（设置 → 插件）。'),
    )
  }

  const data = state.data
  const roles = data.roles || []
  const squads = data.squads || []
  const departments = data.departments || []
  const names = {}
  for (const role of roles) names[role.id] = role

  const needle = need.trim().toLowerCase()
  const visible = roles.filter((role) => {
    if (department !== '' && role.department !== department) return false
    if (needle === '') return true
    return (
      role.name.toLowerCase().indexOf(needle) >= 0 ||
      role.id.toLowerCase().indexOf(needle) >= 0 ||
      (role.description || '').toLowerCase().indexOf(needle) >= 0
    )
  })
  const byDepartment = new Map()
  for (const role of visible) {
    if (!byDepartment.has(role.department)) byDepartment.set(role.department, [])
    byDepartment.get(role.department).push(role)
  }
  const order = departments.map((entry) => entry.id)
  const ordered = [...byDepartment.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const label = (id) => ((departments.find((entry) => entry.id === id) || {}).label || id)

  const tabs = React.createElement(
    'div',
    { className: `${P}-tabs` },
    React.createElement('div', { className: `${P}-tab`, 'data-on': tab === 'experts' ? '1' : '0', onClick: () => setTab('experts') }, `专家名录 · ${roles.length}`),
    React.createElement('div', { className: `${P}-tab`, 'data-on': tab === 'squads' ? '1' : '0', onClick: () => setTab('squads') }, `编队剧本 · ${squads.length}`),
  )

  return React.createElement(
    'div',
    { className: `${P}-page` },
    React.createElement(
      'div',
      { className: `${P}-head` },
      React.createElement('div', { className: `${P}-title` }, `专家团 · ${roles.length} 位专家`),
      React.createElement(
        'div',
        { className: `${P}-sub` },
        `来自 agency-agents-zh 的中文专家角色库，覆盖 ${departments.length} 个部门。主代理按需检索、以角色人设启动子代理；这里是当前可用的全部专家与常用编队。`,
      ),
    ),
    tabs,
    tab === 'experts'
      ? React.createElement(
          'div',
          { className: `${P}-group` },
          React.createElement('input', {
            className: `${P}-search`,
            placeholder: '搜索名称、角色 id 或职责关键词（例如：代码审查 / 定价 / security）',
            value: need,
            onChange: (event) => setNeed(event.target.value),
          }),
          React.createElement(
            'div',
            { className: `${P}-chips` },
            chip('全部 ' + roles.length, department === '', () => setDepartment('')),
            ...departments.map((entry) => chip(`${entry.label} ${entry.count}`, department === entry.id, () => setDepartment(department === entry.id ? '' : entry.id), entry.id)),
          ),
          React.createElement('div', { className: `${P}-count` }, `匹配 ${visible.length} 位`),
          visible.length === 0 ? React.createElement('div', { className: `${P}-empty` }, '没有匹配的专家：换个关键词，或点「全部」。') : null,
          ...ordered.map((departmentId) =>
            React.createElement(
              'div',
              { key: departmentId, className: `${P}-group` },
              React.createElement('div', { className: `${P}-grouphead` }, label(departmentId), React.createElement('span', null, `${departmentId} · ${byDepartment.get(departmentId).length} 人`)),
              React.createElement(
                'div',
                { className: `${P}-grid` },
                ...byDepartment.get(departmentId).map((role) =>
                  React.createElement(
                    'div',
                    { key: role.id, className: `${P}-card` },
                    React.createElement(
                      'div',
                      { className: `${P}-row` },
                      role.emoji ? React.createElement('span', { className: `${P}-emoji` }, role.emoji) : null,
                      React.createElement('span', { className: `${P}-name` }, role.name),
                      role.inSquad ? React.createElement('span', { className: `${P}-tag` }, '编队成员') : null,
                    ),
                    React.createElement('div', { className: `${P}-id`, title: '点击复制角色 id', onClick: () => copy(role.id) }, role.id),
                    React.createElement('div', { className: `${P}-desc` }, role.description || '（无简介）'),
                  ),
                ),
              ),
            ),
          ),
        )
      : React.createElement(
          'div',
          { className: `${P}-group` },
          React.createElement(
            'div',
            { className: `${P}-sub` },
            '编队来自专家库自带的 NEXUS 运营手册（定向任务的 Micro 配置、阶段门禁守门人、阶段 3 四条并行轨道）。点成员名可跳到名录查看该专家；主代理执行前会用 agency_playbook 加载对应剧本。',
          ),
          ...[...groupBy(squads)].map(([group, list]) =>
            React.createElement(
              'div',
              { key: group, className: `${P}-group` },
              React.createElement('div', { className: `${P}-grouphead` }, group, React.createElement('span', null, `${list.length} 套`)),
              ...list.map((squad) => squadCard(squad, names, openSquad, setOpenSquad, setTab, setDepartment, setNeed)),
            ),
          ),
        ),
    React.createElement(
      'div',
      { className: `${P}-meta` },
      `角色库来源：${data.source === 'builtin' ? '随包快照' : data.source} · 常驻目录档位：${data.catalogMode}`,
      React.createElement('br', null),
      `模型可见能力：${(data.tools && data.tools.run) || 'agency_run'}（点名委托）· ${(data.tools && data.tools.team) || 'agency_team'}（并发组队）· ${(data.tools && data.tools.playbook) || 'agency_playbook'}（加载剧本）`,
    ),
  )

  function chip(text, on, onClick, key) {
    return React.createElement('div', { key: key || text, className: `${P}-chip`, 'data-on': on ? '1' : '0', onClick: onClick }, text)
  }
}

/** Group squads by their `group` field, preserving the catalog's order. */
function groupBy(squads) {
  const groups = new Map()
  for (const squad of squads) {
    if (!groups.has(squad.group)) groups.set(squad.group, [])
    groups.get(squad.group).push(squad)
  }
  return groups
}

/** One squad card; `steps` arrive as `[employeeId, role]` pairs from the wire. */
function squadCard(squad, names, openSquad, setOpenSquad, setTab, setDepartment, setNeed) {
  const open = openSquad === squad.id
  const steps = squad.steps || []
  const children = [
    React.createElement(
      'div',
      { key: 'head', className: `${P}-squadhead`, onClick: () => setOpenSquad(open ? '' : squad.id) },
      React.createElement('span', { className: `${P}-squadname` }, squad.name),
      React.createElement('span', { className: `${P}-scale` }, squad.scale),
      React.createElement('span', { className: `${P}-caret` }, open ? '收起 ▴' : '展开 ▾'),
    ),
    React.createElement('div', { key: 'when', className: `${P}-when` }, `适用：${squad.when}`),
  ]
  if (open) {
    children.push(
      React.createElement(
        'ol',
        { key: 'steps', className: `${P}-steps` },
        ...steps.map((step, index) => {
          const role = names[step.employee]
          return React.createElement(
            'li',
            { key: `${squad.id}-${step.employee}`, className: `${P}-step` },
            React.createElement('span', { className: `${P}-stepno` }, `${index + 1}.`),
            React.createElement(
              'span',
              {
                className: `${P}-stepname`,
                onClick: () => {
                  setTab('experts')
                  setDepartment('')
                  setNeed(role ? role.name : step.employee)
                },
              },
              role ? `${role.emoji ? `${role.emoji} ` : ''}${role.name}` : step.employee,
            ),
            React.createElement('span', { className: `${P}-steprole` }, ` — ${step.role}${step.optional ? '（按需）' : ''}`),
          )
        }),
        squad.gatekeeper
          ? React.createElement(
              'li',
              { key: 'gate', className: `${P}-step` },
              React.createElement('span', { className: `${P}-stepno` }, '⚑'),
              React.createElement('span', { className: `${P}-gate` }, `守门人：${(names[squad.gatekeeper] && names[squad.gatekeeper].name) || squad.gatekeeper}`),
            )
          : null,
      ),
    )
    children.push(React.createElement('div', { key: 'pb', className: `${P}-when` }, `执行前加载剧本：agency_playbook("${squad.playbook}")`))
  }
  return React.createElement('div', { key: squad.id, className: `${P}-squad` }, ...children)
}

/** Report a role id; a click on the id copies it where the browser allows. */
function copy(text) {
  try {
    const clipboard = navigator.clipboard
    if (clipboard && typeof clipboard.writeText === 'function') {
      clipboard.writeText(text).then(
        () => console.log(`agency-agents: copied ${text}`),
        () => console.log(`agency-agents: role id ${text}`),
      )
      return
    }
  } catch (error) {
    console.log(`agency-agents: role id ${text}`)
    return
  }
  console.log(`agency-agents: role id ${text}`)
}

/** The inline catalog, exported so a test can assert it matches `src/squads.js`. */
export const CLIENT_SQUADS = SQUADS
