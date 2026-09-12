/**
 * Delegation: turning a resolved role into a running child agent.
 *
 * Everything in this module is plain orchestration over the `subagents`
 * service. The one detail worth stating loudly is `persona`: it is passed on
 * the start request, and the in-process backends register it as a scoped
 * `deployment:persona-prefix` section **on the child alone** — the parent's
 * identity and every sibling's identity are untouched. That is what makes a
 * 277-role library possible without 277 tool rows.
 *
 * @module dsh-agency-agents/delegation
 */

import { buildPersona, buildTaskPrompt } from './persona.js'

/** Stop reasons that count as a usable result. */
const SUCCESSFUL_STOP_REASON = 'completed'

/** Providers that cannot honor a per-child persona; the plugin refuses them up front. */
export const PERSONA_CAPABLE_PROVIDERS = Object.freeze(['spawn', 'fork'])

/**
 * Assert that a provider exists and can accept a per-child persona.
 *
 * A delegated role is *only* its persona, so a provider without that capability
 * would silently run a generic child — exactly the failure this plugin exists to
 * prevent. The check is loud and happens before any work starts.
 * @param {object} subagents - the `subagents` service.
 * @param {string} name - provider name.
 * @returns {{ ok: true, provider: object } | { ok: false, message: string }} the check result.
 */
export function checkProvider(subagents, name) {
  const provider = subagents.getProvider(name)
  if (provider === undefined) {
    return { ok: false, message: `子代理 provider "${name}" 未注册；当前已注册：${subagents.list().join(', ') || '(无)'}` }
  }
  if (provider.capabilities?.persona !== true) {
    return {
      ok: false,
      message: `子代理 provider "${name}" 不支持 persona 能力（角色人设无法注入）。请改用进程内 provider：${PERSONA_CAPABLE_PROVIDERS.join(' / ')}`,
    }
  }
  return { ok: true, provider }
}

/**
 * Start one child agent for a role.
 * @param {object} options - the delegation.
 * @param {object} options.subagents - the `subagents` service.
 * @param {string} options.provider - provider name.
 * @param {object} options.role - the roster entry.
 * @param {{ agent: object, cwd?: string }} options.caller - the calling agent and its working directory.
 * @param {string} options.task - the model-authored task.
 * @param {object} [options.framing] - optional `context` / `acceptance` / `deliverable`.
 * @param {string} [options.extraInstructions] - appended to the persona.
 * @param {AbortSignal} options.signal - caller cancellation.
 * @param {number} [options.maxDepth] - recursion cap for the child.
 * @param {object} [options.agentOptions] - provider/model overrides for the child.
 * @param {object} [options.toolFilter] - child tool restriction.
 * @param {object} [options.outputSchema] - object-rooted JSON schema for structured output.
 * @returns {Promise<object>} the `SubagentRun` handle.
 */
export async function startChild(options) {
  const persona = buildPersona(options.role, {
    cwd: options.caller.cwd,
    extraInstructions: options.extraInstructions,
  })
  const prompt = buildTaskPrompt(options.role, options.task, options.framing ?? {})
  const request = {
    label: `${options.role.name} · ${truncateLabel(options.task)}`,
    prompt: [{ type: 'text', text: prompt }],
    parent: options.caller.agent,
    signal: options.signal,
    persona,
    ...options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth },
    ...options.agentOptions === undefined ? {} : { agentOptions: options.agentOptions },
    ...options.toolFilter === undefined ? {} : { toolFilter: options.toolFilter },
    ...options.outputSchema === undefined ? {} : { outputSchema: options.outputSchema },
  }
  return options.subagents.start(options.provider, request)
}

/**
 * Run one child to settlement in the foreground.
 *
 * Result collection and disposal both run to completion: a failing child still
 * has a child agent and a session to release. When both fail, the aggregate
 * error keeps both causes instead of dropping one.
 * @param {object} run - the handle returned by {@link startChild}.
 * @returns {Promise<object>} a presentation-ready result.
 */
export async function settleChild(run) {
  const [execution] = await Promise.allSettled([run.result])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') {
    if (disposal.status === 'rejected') {
      throw new AggregateError(
        [execution.reason, disposal.reason],
        `专家子代理运行失败：${String(execution.reason)}；同时释放失败：${String(disposal.reason)}`,
      )
    }
    throw execution.reason
  }
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/**
 * Format a settled result for the model.
 * @param {object} role - the roster entry that ran.
 * @param {object} result - a `SubagentResult`.
 * @returns {string} markdown text.
 */
export function formatResult(role, result) {
  const stopReason = result?.stopReason
  const text = contentToText(result?.output)
  const structured = result?.structured
  const lines = []
  if (stopReason === SUCCESSFUL_STOP_REASON) {
    lines.push(`### ${role.name}（${role.id}）已完成`, '')
  } else {
    lines.push(`### ${role.name}（${role.id}）未正常完成：${String(stopReason)}`, '')
  }
  lines.push(text.length > 0 ? text : '(该专家没有产出文本结果)')
  if (structured !== undefined) {
    lines.push('', '## 结构化产出', '', '```json', safeJson(structured), '```')
  }
  if (typeof result?.diagnostic === 'string' && result.diagnostic.length > 0) {
    lines.push('', `> 诊断信息：${result.diagnostic}`)
  }
  if (stopReason !== SUCCESSFUL_STOP_REASON) {
    lines.push('', '> 该结果不可视为完成。请决定：补足信息后重试、换一位专家，或向用户报告。')
  }
  return lines.join('\n')
}

/**
 * Start one child as a parent-owned background job.
 *
 * The job registry owns identity and settlement notices; this only supplies a
 * cancellable producer, mirroring how the product's own delegation tool exposes
 * background work. `job_output` then collects the result and `job_kill` stops it.
 * @param {object} options - the delegation plus the job registry.
 * @param {object} options.jobs - the `jobs` service.
 * @param {object} options.caller - `{ agent, cwd }`.
 * @param {object} options.role - the roster entry.
 * @param {string} options.label - short job label.
 * @param {(signal: AbortSignal) => Promise<object>} options.run - starts the child; receives the job's signal.
 * @returns {string} the job id.
 */
export function startAsJob(options) {
  return options.jobs.start({
    kind: 'subagent',
    label: options.label,
    owner: options.caller.agent,
    run: () => {
      const controller = new AbortController()
      return {
        cancel: (reason) => {
          controller.abort(reason ?? 'agency subagent job killed')
        },
        done: (async () => {
          try {
            const result = await options.run(controller.signal)
            const ok = result?.stopReason === SUCCESSFUL_STOP_REASON
            return {
              status: ok ? 'completed' : 'failed',
              output: formatResult(options.role, result),
              ...ok || typeof result?.diagnostic !== 'string' ? {} : { detail: result.diagnostic },
            }
          } catch (error) {
            return { status: 'failed', detail: String(error?.message ?? error) }
          }
        })(),
      }
    },
  })
}

/**
 * Run several delegations concurrently and collect every outcome.
 *
 * Used by `agency_team`, where "the design review failed" must not erase "the
 * security review passed". Each entry settles independently.
 * @param {Array<() => Promise<{ role: object, result?: object, error?: Error }>>} thunks - one per assignment.
 * @returns {Promise<Array<{ role: object, result?: object, error?: Error }>>} settled entries.
 */
export async function runParallel(thunks) {
  const settled = await Promise.allSettled(thunks.map((thunk) => thunk()))
  return settled.map((entry, index) =>
    entry.status === 'fulfilled'
      ? entry.value
      : { role: { id: `assignment-${index + 1}`, name: '未知角色' }, error: entry.reason instanceof Error ? entry.reason : new Error(String(entry.reason)) },
  )
}

/**
 * Flatten a child's `ContentBlock[]` output to text.
 *
 * Only text blocks cross back to the parent: image and file blocks in a child's
 * output are attachments owned by the child's session, and forwarding their refs
 * would hand the parent dangling references.
 * @param {unknown} output - the result's output blocks.
 * @returns {string} the concatenated text.
 */
export function contentToText(output) {
  if (!Array.isArray(output)) return ''
  return output
    .filter((block) => block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n\n')
    .trim()
}

/** Serialize unknown structured output without ever throwing on a cycle. */
function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/** Keep a job label short enough for the job list. */
function truncateLabel(task) {
  const flat = String(task ?? '').replace(/\s+/g, ' ').trim()
  return flat.length <= 40 ? flat : `${flat.slice(0, 39)}…`
}
