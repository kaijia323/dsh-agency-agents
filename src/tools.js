/**
 * The model-facing tools.
 *
 * Six tools, in two families. The *roster* family (`agency_list`,
 * `agency_find`, `agency_brief`) answers "who is available and who should do
 * this" and never starts a child agent — they are cheap, and a model can afford
 * to use them before every delegation. The *execution* family (`agency_run`,
 * `agency_team`) starts children with a role's persona; `agency_playbook` loads
 * the orchestration manual that tells the model when to reach for them.
 *
 * Every tool returns markdown text. That is a deliberate choice over structured
 * objects: the consumer is a model reading prose, and a stable, readable
 * transcript is worth more than a schema the model must decode.
 *
 * @module dsh-agency-agents/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { DEPARTMENT_LABELS } from './roster.js'
import { renderCatalog } from './catalog.js'
import { buildBrief } from './persona.js'
import { PLAYBOOKS, playbookIndex, renderPlaybook, resolvePlaybooks } from './playbook.js'
import { checkProvider, formatResult, resolveMaxDepth, runParallel, settleChild, startAsJob, startChild } from './delegation.js'

/**
 * Build every tool definition this plugin registers.
 * @param {object} deps - resolved dependencies.
 * @param {import('@deepseek-ai/dsh-tools').defineTool} deps.defineTool - the tool-definition helper.
 * @param {object} deps.ctx - the plugin context.
 * @param {object} deps.config - the resolved plugin configuration.
 * @param {import('./roster.js').Roster} deps.roster - the index.
 * @param {import('./io.js').RosterIO} deps.io - file access.
 * @returns {object[]} tool definitions, in registration order.
 */
export function createTools(deps) {
  const { defineTool, ctx, config, roster, io } = deps
  const names = config.tools

  /** Read the calling agent and its working directory from one execution. */
  const callerOf = (exec) => {
    const agent = exec?.agent
    if (agent === undefined) {
      throw new Error(`${names.run} 需要一个调用方 Agent：本工具必须由代理调用，而不是由宿主直接调用。`)
    }
    const cwd = typeof agent.session?.header?.cwd === 'string' ? agent.session.header.cwd : undefined
    return { agent, cwd }
  }

  /** Resolve a model-supplied employee reference or explain the closest matches. */
  const resolveRole = (reference) => {
    const role = roster.resolve(reference)
    if (role !== undefined) return role
    const closest = roster.closest(reference, 3)
    const hint = closest.length === 0
      ? `用 ${names.find} 按需求检索，或用 ${names.list} 查看部门。`
      : `最接近的候选：${closest.map((item) => `${item.id}（${item.name}）`).join('、')}。`
    throw new Error(`找不到角色 "${reference}"。${hint}`)
  }

  /** Read a role body on demand and cache it for this plugin's lifetime. */
  const bodyCache = new Map()
  const roleWithBody = async (role) => {
    const cached = bodyCache.get(role.id)
    if (cached !== undefined) return { ...role, body: cached }
    const text = await io.readText(role.path)
    bodyCache.set(role.id, text)
    return { ...role, body: text }
  }

  /** The subagents service, or a loud explanation. */
  const subagentsOrThrow = () => {
    const subagents = ctx.get('subagents')
    if (subagents === undefined) throw new Error(`${names.run} 需要 subagents 服务：请确认 host 组合里已加载 @deepseek-ai/dsh-subagent 与一个进程内 provider。`)
    const check = checkProvider(subagents, config.delegation.provider)
    if (!check.ok) throw new Error(check.message)
    return subagents
  }

  const tools = []

  // ── roster family ────────────────────────────────────────────────────────

  tools.push(defineHarnessTool({
    name: names.list,
    description:
      '列出 agency-agents 专家库的部门与角色。不带参数返回部门清单（每个部门人数与职责）；传 department 返回该部门的完整角色清单（id + 中文名 + 一句话简介）。只查询、不产生子代理。不确定该找谁时先用 agency_find。',
    parameters: {
      department: { type: 'string', description: `部门目录名，例如 engineering / marketing / specialized。可选值：${roster.departments.join(', ')}` },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      if (typeof args.department === 'string' && args.department.length > 0) {
        const department = roster.departments.includes(args.department)
          ? args.department
          : roster.departments.find((item) => item.startsWith(args.department.toLowerCase()))
        if (department === undefined) {
          return `没有部门 "${args.department}"。可选部门：${roster.departments.map((d) => `${d}(${DEPARTMENT_LABELS[d] ?? d})`).join('、')}`
        }
        const roles = roster.inDepartment(department)
        const lines = [`## ${DEPARTMENT_LABELS[department] ?? department} · ${department}（${roles.length} 人）`, '']
        for (const role of roles) lines.push(`- **${role.id}**（${role.name}）— ${role.description || '(无简介)'}`)
        lines.push('', `选中后直接调用 ${names.run}（employee 传角色 id）。`)
        return lines.join('\n')
      }
      const lines = [`# 专家库部门清单（共 ${roster.size} 位角色）`, '']
      for (const department of roster.departments) {
        const roles = roster.inDepartment(department)
        lines.push(`- **${department}**（${DEPARTMENT_LABELS[department] ?? department}，${roles.length} 人）`)
      }
      lines.push('', `用 ${names.list}(department) 展开某个部门；或用 ${names.find}(need) 直接按需求找人。`)
      return lines.join('\n')
    },
  }))

  tools.push(defineHarnessTool({
    name: names.find,
    description:
      '按需求描述检索最合适的专家角色，返回候选（id + 中文名 + 简介 + 命中理由）。当你不确定该派谁、或需求跨专业时用它挑人；确认后调用 agency_run。只查询、不产生子代理。',
    parameters: {
      need: { type: 'string', required: true, description: '需求描述，用自然语言写清楚要做什么、要什么产出。例如"评审这段 Go 代码的正确性与安全问题"或"给新功能做定价策略"。' },
      department: { type: 'string', description: '可选：只在该部门内检索。' },
      limit: { type: 'number', description: '返回候选数量，默认 5，最大 10。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const limit = Number.isFinite(args.limit) ? Math.min(Math.max(Math.trunc(args.limit), 1), 10) : 5
      const hits = roster.search(args.need, { limit, department: args.department })
      if (hits.length === 0) {
        return `没有匹配「${args.need}」的角色。用 ${names.list} 看部门清单，或换一种说法描述需求（说明产出物类型通常比说明技术栈更有效）。`
      }
      const lines = [`## 针对「${args.need}」的候选专家`, '']
      hits.forEach((hit, index) => {
        lines.push(`${index + 1}. **${hit.role.id}**（${hit.role.name}·${DEPARTMENT_LABELS[hit.role.department] ?? hit.role.department}）`)
        lines.push(`   ${hit.role.description || '(无简介)'}`)
        if (hit.reasons.length > 0) lines.push(`   命中理由：${hit.reasons.join('；')}`)
      })
      lines.push('', `下一步：用 ${names.brief}(employee) 快速确认职责，或直接用 ${names.run}(employee, task) 委托。多视角任务请分别委托给多位专家。`)
      return lines.join('\n')
    },
  }))

  tools.push(defineHarnessTool({
    name: names.brief,
    description:
      '查看某位专家角色的职责概要（简介 + 职责/流程要点），用于委托前确认人选是否对口。不产生子代理、不消耗子代理上下文，成本极低。',
    parameters: {
      employee: { type: 'string', required: true, description: '角色 id（如 engineering-code-reviewer）或中文名（如 代码审查员）。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const role = resolveRole(args.employee)
      const withBody = await roleWithBody(role)
      return buildBrief(withBody)
    },
  }))

  // ── execution family ─────────────────────────────────────────────────────

  tools.push(defineHarnessTool({
    name: names.run,
    description:
      '把一件完整的工作交给专家库中的某位专家，以他的专业人设、流程与交付标准在一个独立子代理中完成。当需求需要专业判断、行业标准或专业交付物（审查报告、合规清单、评估结论、方案设计）时优先用它——专家的价值在于他那套流程与交付标准，自己兼着做等于放弃了它；委托不占用本会话上下文，角色正文只在子代理里展开。子代理看不到本会话的对话，task 必须自包含（背景、输入、产出要求、验收标准写清楚）。默认后台运行并返回子代理/任务 id，结束时你会收到通知；把 wait 设为 true 则等结果。需要多个专业视角时，分别对多位专家调用本工具，或改用 agency_team。纯实现、纯查询、纯机械改动自己做，不要为小事开会。',
    parameters: {
      employee: { type: 'string', required: true, description: '角色 id 或中文名。不确定时先用 agency_find。' },
      task: { type: 'string', required: true, description: '交给该专家的完整任务说明。必须自包含：他看不到本会话。' },
      context: { type: 'string', description: '可选：相关背景、已有结论、文件路径等。' },
      acceptance: { type: 'string', description: '可选：验收标准，越具体越好。' },
      deliverable: { type: 'string', description: '可选：交付物形态要求（例如"分级问题清单"、"含命令输出的验证报告"）。' },
      wait: { type: 'boolean', description: '默认 false（后台）。设为 true 则阻塞等待结果，仅当下一步依赖该结果时使用。' },
      extra_instructions: { type: 'string', description: '可选：追加到该专家人设后的额外要求（例如"用中文回答"、"不要改代码，只出方案"）。' },
      max_depth: { type: 'number', description: `可选：本次委派的深度上限（校验子代理的绝对深度，不是子代理自身的递归预算），默认 ${config.delegation.defaultMaxDepth}。传 0 无效——被委派的专家至少是深度 1；不填即用默认值。` },
      model: { type: 'string', description: '可选：为本次委托指定模型 id；不填则继承当前模型。' },
      // `additionalProperties: true` is required, not cosmetic: the tool-parameter
      // compiler rejects any `type: 'object'` node that does not state openness
      // explicitly, and this node is deliberately an arbitrary JSON Schema whose
      // key set the caller owns.
      output_schema: { type: 'object', additionalProperties: true, description: '可选：要求子代理返回结构化 JSON（object 根 JSON Schema），结果会附在交付物里，便于程序化判断 PASS/FAIL。' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const caller = callerOf(exec)
      const role = await roleWithBody(resolveRole(args.employee))
      const subagents = subagentsOrThrow()
      const framing = { context: args.context, acceptance: args.acceptance, deliverable: args.deliverable }
      const shared = {
        subagents,
        provider: config.delegation.provider,
        role,
        caller,
        task: args.task,
        framing,
        extraInstructions: args.extra_instructions,
        maxDepth: resolveMaxDepth(args.max_depth, config.delegation.defaultMaxDepth),
        agentOptions: typeof args.model === 'string' && args.model.length > 0 ? { model: args.model } : undefined,
        outputSchema: args.output_schema,
      }
      const wait = args.wait === true || (args.wait === undefined && config.delegation.defaultWait)
      if (wait) {
        const run = await startChild({ ...shared, signal: exec.signal })
        const result = await settleChild(run)
        return formatResult(role, result)
      }
      const jobs = ctx.get('jobs')
      if (jobs === undefined) {
        // No job registry: foreground is the only honest option, and saying so
        // beats returning an id nothing can ever collect.
        const run = await startChild({ ...shared, signal: exec.signal })
        const result = await settleChild(run)
        return `${formatResult(role, result)}\n\n> 后台任务能力不可用（未加载 jobs 注册表），本次已前台执行。`
      }
      const jobId = startAsJob({
        jobs,
        caller,
        role,
        label: `${role.name} · ${role.id}`,
        run: async (signal) => settleChild(await startChild({ ...shared, signal })),
      })
      return [
        `已委托 **${role.name}**（${role.id}）后台执行。`,
        '',
        `任务 id：\`${jobId}\`（用 job_output 读取结果，job_kill 可终止）`,
        '结束时你会收到完成通知。期间可以继续做别的事，或再委托其他专家。',
      ].join('\n')
    },
  }))

  tools.push(defineHarnessTool({
    name: names.team,
    description:
      '一次把多个互不依赖的任务并发交给多位专家，并汇总结果。适合"同一阶段多视角并行"（如同时做安全审计、性能评估、可访问性检查）或四条并行轨道同时开工；需要 3–5 位专家从不同角度审同一件事时用它，比逐个 agency_run 更快。互有依赖的任务不要放进同一次调用——那应该用多次 agency_run 按顺序推进。',
    parameters: {
      assignments: {
        type: 'array',
        required: true,
        description: '任务数组，每项形如 {"employee": "角色id", "task": "自包含任务说明", "context": "可选", "acceptance": "可选", "deliverable": "可选"}。',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            employee: { type: 'string', required: true, description: '角色 id 或中文名。' },
            task: { type: 'string', required: true, description: '交给该专家的完整任务说明。' },
            context: { type: 'string', description: '可选：相关背景。' },
            acceptance: { type: 'string', description: '可选：验收标准。' },
            deliverable: { type: 'string', description: '可选：交付物形态要求。' },
          },
        },
      },
      wait: { type: 'boolean', description: '默认 true（并发执行并等全部结束，返回汇总）。设为 false 则立刻返回各任务 id 转入后台。' },
      max_depth: { type: 'number', description: `可选：本次编队的深度上限（校验每位子代理的绝对深度），默认 ${config.delegation.defaultMaxDepth}。传 0 无效。` },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      const caller = callerOf(exec)
      const list = Array.isArray(args.assignments) ? args.assignments : []
      if (list.length === 0) return 'assignments 为空：请给出至少一项 {employee, task}。'
      if (list.length > config.delegation.maxTeamSize) {
        return `一次最多并发 ${config.delegation.maxTeamSize} 位专家（收到 ${list.length} 位）。请拆成多次调用——这也更容易定位失败原因。`
      }
      const subagents = subagentsOrThrow()
      // Validated once for the whole team, before any child is composed, so a
      // bad cap fails the call instead of N identical failures.
      const maxDepth = resolveMaxDepth(args.max_depth, config.delegation.defaultMaxDepth)
      const prepared = []
      for (const item of list) {
        const role = await roleWithBody(resolveRole(item?.employee))
        prepared.push({ role, assignment: item })
      }
      const wait = args.wait !== false
      if (wait) {
        const entries = await runParallel(prepared.map(({ role, assignment }) => async () => {
          try {
            const run = await startChild({
              subagents,
              provider: config.delegation.provider,
              role,
              caller,
              task: String(assignment.task ?? ''),
              framing: { context: assignment.context, acceptance: assignment.acceptance, deliverable: assignment.deliverable },
              signal: exec.signal,
              maxDepth,
            })
            return { role, result: await settleChild(run) }
          } catch (error) {
            return { role, error: error instanceof Error ? error : new Error(String(error)) }
          }
        }))
        const ok = entries.filter((entry) => entry.error === undefined && entry.result?.stopReason === 'completed').length
        const lines = [`# 团队汇总（${prepared.length} 位专家，成功 ${ok}，未完成 ${prepared.length - ok}）`, '']
        lines.push('| 专家 | 角色 | 状态 |', '| --- | --- | --- |')
        for (const entry of entries) {
          const status = entry.error !== undefined ? `失败：${entry.error.message}` : String(entry.result?.stopReason ?? 'unknown')
          lines.push(`| ${entry.role.name} | ${entry.role.id} | ${status} |`)
        }
        lines.push('')
        for (const entry of entries) {
          lines.push('---', '')
          if (entry.error !== undefined) {
            lines.push(`### ${entry.role.name}（${entry.role.id}）委托失败`, '', String(entry.error.message))
            continue
          }
          lines.push(formatResult(entry.role, entry.result))
        }
        lines.push('', '> 汇总完毕。请自行判断各结论是否冲突、是否需要追加专家或把结论交给下一位（例如由证据收集者做验证）。')
        return lines.join('\n')
      }
      const jobs = ctx.get('jobs')
      if (jobs === undefined) return '后台任务能力不可用（未加载 jobs 注册表）：请把 wait 设为 true。'
      const ids = prepared.map(({ role, assignment }) =>
        startAsJob({
          jobs,
          caller,
          role,
          label: `${role.name} · ${role.id}`,
          run: async (signal) => settleChild(await startChild({
            subagents,
            provider: config.delegation.provider,
            role,
            caller,
            task: String(assignment.task ?? ''),
            framing: { context: assignment.context, acceptance: assignment.acceptance, deliverable: assignment.deliverable },
            signal,
            maxDepth,
          })),
        }),
      )
      return [`已并发委托 ${ids.length} 位专家：`, '', ...prepared.map(({ role }, index) => `- ${role.name}（${role.id}）→ \`${ids[index]}\``), '', '用 job_output 逐个收集结果；结束时你会收到通知。'].join('\n')
    },
  }))

  // ── orchestration ────────────────────────────────────────────────────────

  if (config.playbook.enabled) {
    tools.push(defineHarnessTool({
      name: names.playbook,
      description:
        '按需加载编排剧本（来自专家库自带的 NEXUS 运营手册）：阶段流程、质量门禁与守门人、交接模板、角色激活提示词、定向任务的编队脚本。要编排多个专家时先读剧本再动手，不要凭记忆编流程。',
      parameters: {
        topic: { type: 'string', required: true, description: `剧本 id。可用：\n${playbookIndex()}` },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args) {
        const matches = resolvePlaybooks(args.topic, 2)
        if (matches.length === 0) {
          return [`没有剧本 "${args.topic}"。可用剧本：`, '', playbookIndex()].join('\n')
        }
        const chunks = []
        for (const entry of matches) {
          chunks.push(await renderPlaybook(io, config.roster.root, entry, { maxChars: config.playbook.maxChars }))
        }
        if (matches.length === 1 && PLAYBOOKS.length > 1) {
          chunks.push(`\n> 相关剧本可继续用 ${names.playbook} 加载：${PLAYBOOKS.filter((entry) => entry.id !== matches[0].id).slice(0, 6).map((entry) => entry.id).join('、')} …`)
        }
        return chunks.join('\n\n---\n\n')
      },
    }))
  }

  return tools
}

/**
 * Define one model-facing tool, with the tool's name on any definition error.
 *
 * The harness's `defineTool` compiles the parameter map and throws for a
 * declaration outside its schema subset; on its own that surfaces as an
 * anonymous loader failure that takes the whole profile's boot down. Naming the
 * row makes the defect one line to fix. Note the compile happens **inside**
 * `defineTool` — the returned definition carries the compiled JSON Schema in
 * `parameters`, so re-compiling that result is not a valid check.
 */
function defineHarnessTool(options) {
  try {
    return defineTool(options)
  } catch (error) {
    throw new Error(`agency-agents: tool "${options.name}" is malformed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The prompt section text: the resident catalog plus the orchestration policy.
 * @param {import('./roster.js').Roster} roster - the index.
 * @param {object} config - resolved configuration.
 * @returns {string} the section text (possibly empty).
 */
export function catalogSectionText(roster, config) {
  if (config.catalog.mode === 'off') return ''
  return renderCatalog(roster, {
    mode: config.catalog.mode,
    departments: config.catalog.departments,
    includeOrchestration: config.catalog.includeOrchestration,
    toolNames: config.tools,
  })
}
