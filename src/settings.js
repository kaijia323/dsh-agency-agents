/**
 * The 专家团 settings page's data contract.
 *
 * Kept out of the plugin entry so it is testable without a Cordis context: the
 * payload is plain JSON assembled from already-indexed data, and the model-visible
 * shapes (`Roster` entries, `SQUADS`) never cross the wire.
 *
 * The page is deliberately read-only. It answers "现在有哪些专家、他们怎么组队"
 * — a catalog — while the running capability lives in the seven tools. There is
 * nothing to configure here, so there is nothing to persist, which is also why
 * the page cannot drift out of sync with what the model can actually call.
 *
 * @module dsh-agency-agents/settings
 */

import { DEPARTMENT_LABELS } from './roster.js'
import { SQUADS } from './squads.js'

/** Wire version of the payload; a mismatch means a stale Bundle, not a bug. */
export const SETTINGS_PAYLOAD_VERSION = 1

/**
 * Build the settings page payload.
 * @param {import('./roster.js').Roster} roster - the index.
 * @param {{ toolNames?: Record<string, string>, source?: string, catalogMode?: string }} [options] - plugin facts worth showing.
 * @returns {object} losslessly JSON-serializable payload.
 */
export function settingsPayload(roster, options = {}) {
  const squadMembers = new Set()
  for (const squad of SQUADS) for (const step of squad.steps) squadMembers.add(step.employee)
  const departments = roster.departments.map((department) => ({
    id: department,
    label: DEPARTMENT_LABELS[department] ?? department,
    count: roster.inDepartment(department).length,
  }))
  const roles = roster.roles.map((role) => ({
    id: role.id,
    name: role.name,
    department: role.department,
    // The page shows a one-line summary; the full description is longer than any
    // card can use and the payload crosses a wire.
    description: role.description.length > 120 ? `${role.description.slice(0, 119)}…` : role.description,
    emoji: role.emoji ?? '',
    bodyChars: role.body.length,
    inSquad: squadMembers.has(role.id),
  }))
  return {
    version: SETTINGS_PAYLOAD_VERSION,
    roles,
    departments,
    squads: SQUADS.map((squad) => ({
      id: squad.id,
      name: squad.name,
      group: squad.group,
      scale: squad.scale,
      when: squad.when,
      gatekeeper: squad.gatekeeper ?? null,
      playbook: squad.playbook,
      steps: squad.steps.map((step) => ({
        employee: step.employee,
        role: step.role,
        optional: step.optional === true,
      })),
    })),
    tools: options.toolNames ?? {},
    source: options.source ?? 'builtin',
    catalogMode: options.catalogMode ?? 'compact',
  }
}

/**
 * The names the page references, resolved for display so the client never needs
 * its own copy of the roster to render a squad member.
 * @param {import('./roster.js').Roster} roster - the index.
 * @returns {Record<string, { name: string, department: string, emoji: string }>} id → display facts.
 */
export function roleNames(roster) {
  const names = {}
  for (const role of roster.roles) {
    names[role.id] = { name: role.name, department: role.department, emoji: role.emoji ?? '' }
  }
  return names
}
