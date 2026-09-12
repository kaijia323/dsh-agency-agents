/**
 * The `/agency-agents` host command: the manual, deterministic way to use the library.
 *
 * The plugin's other surface is deliberately autonomous — the resident catalog
 * plus a routing gate let the model decide on its own when to delegate, and the
 * settings page only shows what exists. Both leave a gap the model's judgement
 * cannot close: a human who already knows which expert they want has no
 * deterministic way to say so. `/agency-agents` is that way in.
 *
 * Three modes, chosen by the first token of the invocation:
 *
 * - (none)        — an inventory: departments with counts, and the curated squads.
 * - `找 <需求>`    — roster search, the same ranking `agency_find` uses.
 * - `用 <角色> <任务>` — **hand the work to the model**, naming the expert. This is
 *                   the mode that does something: the handler submits a user
 *                   message instructing the agent to delegate to that expert,
 *                   so the turn runs with the routing decision already made.
 *
 * The command never starts a child agent itself. It composes the instruction and
 * hands it to the model through `followup`, which queues an ordinary turn and
 * wakes the driver. Delegation stays on the model's side of the line — it owns
 * the task framing, the acceptance criteria, and the wait/background choice —
 * while the *choice of who* comes from the human.
 *
 * @module dsh-agency-agents/command
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'

import { DEPARTMENT_LABELS } from './roster.js'
import { SQUADS } from './squads.js'

/**
 * The command name, without its leading slash.
 *
 * Lowercase ASCII, matching the registry's [a-z][a-z0-9-]* shape — the Chinese
 * display name stays in the description and the output instead.
 *
 * (No backticks around that pattern: a comment holding both a backtick and a
 * regex literal makes `node --check` fail with a bogus "Unexpected end of
 * input" on Node 24.21.0, even though the module loads fine.)
 */
export const AGENCY_COMMAND = 'agency-agents'

/** How many search hits one invocation renders. */
const SEARCH_LIMIT = 8

/**
 * Split an invocation into its mode and payload.
 *
 * Only the exact prefixes `找` and `用` select a mode, and they must be followed
 * by whitespace, so an expert whose name begins with either character is still
 * reachable as free text. Everything unrecognized is treated as a search need —
 * the forgiving choice, because a human who typed `/agency-agents 帮我审代码` wants hits,
 * not a usage error.
 *
 * @param {string} rawInput - text following the command name, including separator whitespace.
 * @returns {{ kind: 'inventory' } | { kind: 'search', need: string } | { kind: 'delegate', employee: string, task: string } | { kind: 'usage', text: string }} the parsed invocation.
 */
export function parseAgencyInvocation(rawInput) {
  const input = String(rawInput ?? '').trim()
  if (input.length === 0) return { kind: 'inventory' }

  const delegate = /^用\s+(\S+)\s+([\s\S]+)$/u.exec(input)
  if (delegate !== null) {
    return { kind: 'delegate', employee: delegate[1], task: delegate[2].trim() }
  }
  if (/^用(\s|$)/u.test(input)) {
    return { kind: 'usage', text: `用法：/${AGENCY_COMMAND} 用 <角色 id 或中文名> <任务>。先 /${AGENCY_COMMAND} 找 <需求> 可以查角色。` }
  }

  const search = /^找\s+([\s\S]+)$/u.exec(input)
  if (search !== null) return { kind: 'search', need: search[1].trim() }
  if (/^找(\s|$)/u.test(input)) {
    return { kind: 'usage', text: `用法：/${AGENCY_COMMAND} 找 <需求描述>，例如 /${AGENCY_COMMAND} 找 数据库慢查询。` }
  }

  return { kind: 'search', need: input }
}

/**
 * Render the inventory: departments with counts, then the curated squads.
 * @param {import('./roster.js').Roster} roster - the index.
 * @returns {string} the command output.
 */
export function renderInventory(roster) {
  const departments = roster.departments
    .map((department) => ({ department, count: roster.inDepartment(department).length }))
    .filter((entry) => entry.count > 0)
  const lines = [`# 专家团 · ${roster.size} 位专家 · ${departments.length} 个部门`, '']
  lines.push(departments.map((entry) => `${DEPARTMENT_LABELS[entry.department] ?? entry.department} ${entry.department}(${entry.count})`).join(' · '))
  lines.push('', `## 编队剧本（${SQUADS.length} 套）`, '')
  for (const squad of SQUADS) {
    lines.push(`- **${squad.name}**（${squad.scale}）— ${squad.when}`)
  }
  lines.push(
    '',
    '## 用法',
    `- \`/${AGENCY_COMMAND}\` — 这份清单`,
    `- \`/${AGENCY_COMMAND} 找 <需求>\` — 按需求检索角色，例如 \`/${AGENCY_COMMAND} 找 数据库慢查询\``,
    `- \`/${AGENCY_COMMAND} 用 <角色> <任务>\` — 指定专家并把任务交给主代理，例如 \`/${AGENCY_COMMAND} 用 engineering-code-reviewer 审查 auth.ts 的会话校验\``,
  )
  return lines.join('\n')
}

/**
 * Render search hits.
 * @param {import('./roster.js').Roster} roster - the index.
 * @param {string} need - the natural-language need.
 * @returns {string} the command output.
 */
export function renderSearch(roster, need) {
  if (need.length === 0) return `请给出需求描述，例如 \`/${AGENCY_COMMAND} 找 数据库慢查询\`。`
  const hits = roster.search(need, { limit: SEARCH_LIMIT })
  if (hits.length === 0) {
    return `没有匹配「${need}」的角色。试试更短的关键词，或用 \`/${AGENCY_COMMAND}\` 看部门清单。`
  }
  const lines = [`# 匹配「${need}」的角色（${hits.length}）`, '']
  for (const hit of hits) {
    const reason = hit.reasons.length > 0 ? ` — ${hit.reasons.join('；')}` : ''
    lines.push(`- \`${hit.role.id}\`（${hit.role.name}）${reason}`)
    if (hit.role.description.length > 0) lines.push(`  ${hit.role.description}`)
  }
  lines.push('', `确定后：\`/${AGENCY_COMMAND} 用 <角色 id> <任务>\`。`)
  return lines.join('\n')
}

/**
 * Compose the instruction the model receives for a named delegation.
 *
 * The message reads as a direct instruction rather than as a request, and it
 * names the tool to call: the point of the command is that the routing decision
 * is already made, so the model should not re-litigate it. The task text is
 * passed through verbatim — framing it is the model's job.
 *
 * @param {{ id: string, name: string }} role - the resolved expert.
 * @param {string} task - the human's task text.
 * @param {{ run: string, brief: string }} toolNames - the resolved tool names.
 * @returns {string} the user message text.
 */
export function renderDelegationInstruction(role, task, toolNames) {
  return [
    `请把下面这件事交给专家 ${role.name}（\`${role.id}\`）：用 ${toolNames.run} 以他的专业人设启动子代理完成。`,
    `角色与任务的匹配已经由用户指定，不要再改成别人；如果不确定他的职责边界，先用 ${toolNames.brief} 看一眼。`,
    '',
    '## 任务',
    task,
  ].join('\n')
}

/**
 * Register the `/agency-agents` command.
 *
 * A deployment whose composition omits the command registry keeps the rest of
 * the plugin: `ctx.inject` yields a child fiber that simply never activates, the
 * same degradation `@nanmicoder/dsh-agent-teams` documents for its own command.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {{ roster: import('./roster.js').Roster, toolNames: { run: string, brief: string } }} deps - what the handler needs.
 * @returns {void}
 */
export function registerAgencyCommand(ctx, deps) {
  ctx.inject(['commands'], (commandCtx) => {
    // Resolved through `get` rather than read as a property: the child fiber this
    // callback receives owns the injected service, but only a context that also
    // declares it may read it as `commandCtx.commands` — and this module cannot
    // declare `commands` in its own `inject` without failing every composition
    // that omits the registry.
    const commands = commandCtx.get('commands')
    commandCtx.effect(
      () =>
        commands.register({
          name: AGENCY_COMMAND,
          description: '手动调用专家库：列专家团、按需求找角色、或指定专家把任务交给主代理',
          input: { hint: '[找 <需求> | 用 <角色> <任务>]' },
          handler(invocation) {
            const parsed = parseAgencyInvocation(invocation.rawInput)
            try {
              switch (parsed.kind) {
                case 'inventory':
                  return { kind: 'success', text: renderInventory(deps.roster) }
                case 'search':
                  return { kind: 'success', text: renderSearch(deps.roster, parsed.need) }
                case 'usage':
                  return { kind: 'error', text: parsed.text }
                case 'delegate': {
                  const role = deps.roster.resolve(parsed.employee)
                  if (role === undefined) {
                    return {
                      kind: 'error',
                      text: `专家库里没有「${parsed.employee}」。先用 \`/${AGENCY_COMMAND} 找 <需求>\` 查角色 id。`,
                    }
                  }
                  if (parsed.task.length === 0) {
                    return { kind: 'error', text: `用法：/${AGENCY_COMMAND} 用 ${role.id} <任务>` }
                  }
                  invocation.agent.followup(
                    createUserMessage({
                      content: [{ type: 'text', text: renderDelegationInstruction(role, parsed.task, deps.toolNames) }],
                      source: { kind: 'user' },
                    }),
                  )
                  return {
                    kind: 'success',
                    text: `已指定 ${role.name}（\`${role.id}\`），主代理会据此委托。`,
                  }
                }
                /* v8 ignore next 2 -- the union above is closed and every member is handled */
                default:
                  return { kind: 'error', text: '无法解析这次调用。' }
              }
            } catch (error) {
              return { kind: 'error', text: `专家团命令失败：${error instanceof Error ? error.message : String(error)}` }
            }
          },
        }),
      'agency-agents:command',
    )
  })
}
