/**
 * Plugin entry: mounting the expert library into a DSH composition.
 *
 * The row belongs on the **host plane**, not in an agent preset. A preset owns
 * what one session contributes to the registries (its tools, persona, prompt
 * sections); this plugin contributes tools and a prompt section, and consumes
 * the host's `subagents` registry. It publishes no service of its own, so it
 * needs no `isolate` realm — and a second session mounting the same preset
 * cannot collide with the first.
 *
 * Composition:
 *
 * ```yaml
 * - id: agency-agents
 *   name: '@jnmetacode/dsh-agency-agents'
 *   config:
 *     roster: { source: builtin }
 *     catalog: { mode: compact }
 *     delegation: { provider: spawn, defaultMaxDepth: 1 }
 * ```
 *
 * @module dsh-agency-agents
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { createNodeIO, createServiceIO, exists, packageRoot } from './io.js'
import { loadRoster } from './roster.js'
import { catalogSectionText, createTools } from './tools.js'
import { PLAYBOOKS } from './playbook.js'
import { estimateCatalog } from './catalog.js'
import { checkProvider } from './delegation.js'
import { registerSettingsPage } from './client.js'

/** Plugin name shown in loader diagnostics. */
export const name = 'agency-agents'

/** Tools this plugin registers; a composition resolves them through the registry. */
export const inject = ['tools', 'systemPrompt']

/** Catalog modes, cheapest first. */
const CATALOG_MODES = new Set(['off', 'depts', 'compact', 'full'])

/**
 * Resolve and validate the row's configuration.
 *
 * Defaults are the design's defaults: the compact catalog (department rosters,
 * ~15 K characters, no summaries), `spawn` as the provider, and one level of
 * delegation depth so a delegated expert cannot fan out further by itself.
 * @param {object} [raw] - the row's `config` block.
 * @returns {object} the resolved configuration.
 * @throws {Error} when a value is present but unusable.
 */
export function resolveConfig(raw = {}) {
  const root = raw.roster?.root
  const source = raw.roster?.source ?? 'builtin'
  if (source !== 'builtin' && source !== 'external') {
    throw new Error(`agency-agents: roster.source must be "builtin" or "external", got "${source}"`)
  }
  if (source === 'external' && (typeof root !== 'string' || root.length === 0)) {
    throw new Error('agency-agents: roster.source "external" requires roster.root (absolute path to an agency-agents checkout)')
  }
  const mode = raw.catalog?.mode ?? 'compact'
  if (!CATALOG_MODES.has(mode)) {
    throw new Error(`agency-agents: catalog.mode must be one of ${[...CATALOG_MODES].join(', ')}, got "${mode}"`)
  }
  const defaultMaxDepth = raw.delegation?.defaultMaxDepth ?? 1
  if (!Number.isInteger(defaultMaxDepth) || defaultMaxDepth < 0) {
    throw new Error(`agency-agents: delegation.defaultMaxDepth must be a non-negative integer, got ${String(raw.delegation?.defaultMaxDepth)}`)
  }
  const maxTeamSize = raw.delegation?.maxTeamSize ?? 6
  if (!Number.isInteger(maxTeamSize) || maxTeamSize < 1) {
    throw new Error(`agency-agents: delegation.maxTeamSize must be a positive integer, got ${String(raw.delegation?.maxTeamSize)}`)
  }
  const tools = {
    list: raw.tools?.list ?? 'agency_list',
    find: raw.tools?.find ?? 'agency_find',
    brief: raw.tools?.brief ?? 'agency_brief',
    run: raw.tools?.run ?? 'agency_run',
    team: raw.tools?.team ?? 'agency_team',
    playbook: raw.tools?.playbook ?? 'agency_playbook',
  }
  const uniqueNames = new Set(Object.values(tools))
  if (uniqueNames.size !== Object.keys(tools).length) {
    throw new Error('agency-agents: every configured tool name must be distinct')
  }
  return {
    roster: { source, root: typeof root === 'string' && root.length > 0 ? root : undefined, skipDepartments: raw.roster?.skipDepartments ?? [], nameAliases: raw.roster?.nameAliases ?? {} },
    catalog: {
      mode,
      departments: Array.isArray(raw.catalog?.departments) && raw.catalog.departments.length > 0 ? raw.catalog.departments : undefined,
      includeOrchestration: raw.catalog?.includeOrchestration ?? true,
      sectionOrder: raw.catalog?.sectionOrder ?? 2810,
    },
    delegation: {
      provider: raw.delegation?.provider ?? 'spawn',
      defaultMaxDepth,
      defaultWait: raw.delegation?.defaultWait ?? false,
      maxTeamSize,
      requirePersonaCapability: raw.delegation?.requirePersonaCapability ?? true,
    },
    playbook: { enabled: raw.playbook?.enabled ?? true, maxChars: raw.playbook?.maxChars ?? 24000 },
    tools,
    logRosterSummary: raw.logRosterSummary ?? true,
  }
}

/**
 * The Cordis plugin.
 * @param {object} ctx - the plugin context.
 * @param {object} rawConfig - the row's configuration.
 * @returns {Promise<void>} resolves once the roster is indexed and rows are registered.
 */
export async function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const logger = ctx.get('logger')

  // File access: prefer the harness `fs` service so a sandboxed or remote
  // backend stays the owner of path identity; fall back to Node when this
  // package is mounted outside a deployment that provides one (tests, tooling).
  const root = await resolveRoot(ctx, config)
  const fs = ctx.get('fs')
  const io = fs === undefined ? createNodeIO() : createServiceIO(fs)

  const roster = await loadRoster(io, {
    root,
    nameAliases: config.roster.nameAliases,
    skipDepartments: config.roster.skipDepartments,
  })
  if (roster.size === 0) {
    throw new Error(`agency-agents: no roles found under "${root}" — check roster.root, or run \`node tools/vendor.mjs\` to refresh the vendored corpus`)
  }
  for (const department of config.roster.skipDepartments) {
    if (roster.departments.includes(department)) throw new Error(`agency-agents: skipDepartments did not remove "${department}"`)
  }

  const tools = ctx.get('tools')
  if (tools === undefined) throw new Error('agency-agents: the tools registry is not mounted; this row belongs in a composition that loads it')

  const definitions = createTools({ defineTool, ctx, config, roster, io })
  for (const definition of definitions) ctx.effect(() => tools.register(definition), `agency-agents:${definition.name}`)

  // The resident catalog and the orchestration policy. Registered through this
  // row's own scope, so it contributes to every agent the composition covers and
  // unwinds with the row.
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    const text = catalogSectionText(roster, config)
    if (text.length > 0) {
      ctx.effect(
        () => systemPrompt.section({ name: 'agency-agents:catalog', order: config.catalog.sectionOrder, text }),
        'agency-agents:catalog',
      )
    }
  }

  assertProvider(ctx, config, logger)

  // The 专家团 settings page reads this one Package-private method. Registering
  // the payload server-side keeps the browser free of a second copy of the role
  // library: the host already indexed it, and the client gets exactly the fields
  // the page renders.
  if (config.logRosterSummary) {
    const estimate = estimateCatalog(roster, config.catalog.mode)
    logger?.info?.(
      `agency-agents: ${roster.size} roles across ${roster.departments.length} departments from ${root}; ` +
        `catalog=${config.catalog.mode} (${estimate.chars} chars ≈ ${estimate.approxTokens} tokens); ` +
        `${definitions.length} tools; ${PLAYBOOKS.length} playbooks; provider=${config.delegation.provider}`,
    )
  }
}

/**
 * Client half.
 *
 * The browser bundle is `src/client.js`, declared as the package's `./client`
 * export; it registers the 专家团 page into `settings.section` and reads its
 * payload through the Package-private `agency/settings` call the Host half
 * registers above. Splitting the halves this way keeps the bundle import-free
 * (the harness resolves it against a frozen module table) while the page still
 * renders data only the Host can produce.
 *
 * @param {object} ctx - the Client context, present only where a browser runs.
 */
export function applyClient(ctx) {
  registerSettingsPage(ctx)
}

export { registerSettingsPage }

/**
 * Resolve the corpus root.
 *
 * `builtin` means the snapshot vendored beside this package, refreshed from
 * upstream by `tools/vendor.mjs`. `external` means a checkout the deployment
 * names, and it is checked before anything is indexed so a typo fails at mount
 * rather than at the first delegation.
 */
async function resolveRoot(ctx, config) {
  if (config.roster.source === 'external') {
    const fs = ctx.get('fs')
    const io = fs === undefined ? createNodeIO() : createServiceIO(fs)
    if (!(await exists(io, config.roster.root))) {
      throw new Error(`agency-agents: roster.root "${config.roster.root}" is not readable`)
    }
    return config.roster.root
  }
  const base = packageRoot()
  if (base === undefined) {
    throw new Error('agency-agents: cannot locate the vendored corpus beside this package; set roster.root explicitly')
  }
  return `${base}/data/agency-agents-zh`
}

/** Report the provider situation once, without preventing the mount. */
function assertProvider(ctx, config, logger) {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) {
    logger?.warn?.('agency-agents: the subagents service is not mounted yet; delegation tools will fail until it is')
    return
  }
  const check = checkProvider(subagents, config.delegation.provider)
  if (check.ok) return
  const message = `agency-agents: ${check.message}`
  // A provider the deployment chose but that cannot carry a persona is a
  // configuration error, not a transient one; failing the mount is the only
  // outcome that cannot be mistaken for working delegation.
  if (config.delegation.requirePersonaCapability && subagents.list().length > 0) throw new Error(message)
  logger?.warn?.(message)
}

export { resolvePlaybooks, PLAYBOOKS } from './playbook.js'
