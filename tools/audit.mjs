/**
 * Report what the plugin will actually contribute, before it is mounted.
 *
 * Answers the questions a deployment asks when tuning the catalog: how many
 * roles and departments, what each catalog mode costs in characters and tokens,
 * which role files need template neutralization, how large a delegated persona
 * is, and what the playbook inventory looks like.
 *
 * Usage: `node tools/audit.mjs [--json]`
 *
 * @module dsh-agency-agents/tools/audit
 */

import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createNodeIO } from '../src/io.js'
import { loadRoster } from '../src/roster.js'
import { estimateCatalog } from '../src/catalog.js'
import { PLAYBOOKS, renderPlaybook } from '../src/playbook.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = resolve(ROOT, 'data/agency-agents-zh')

/** The engine's scanner, mirrored from dsh-system-prompt's `interpolate()`. */
const GROUP_AT = /^\{\{([^{}]*)\}\}/
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/** Whether the prompt engine would refuse to render this text. */
function engineHostile(text) {
  let last = 0
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', last)) {
    const group = GROUP_AT.exec(text.slice(open))
    if (group === null) {
      if (text.indexOf('}}', open + 2) >= 0) return true
      last = open + 2
      continue
    }
    if (!VARIABLE_NAME.test(group[0].slice(2, -2))) return true
    last = open + group[0].length
  }
  return false
}

/** Median of a numeric list. */
function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

const io = createNodeIO()
const roster = await loadRoster(io, { root: CORPUS })
const bodySizes = roster.roles.map((role) => role.body.length)
const hostile = roster.roles.filter((role) => engineHostile(role.body))

const report = {
  corpus: CORPUS,
  roles: roster.size,
  departments: roster.departments.length,
  rolesPerDepartment: Object.fromEntries(roster.departments.map((department) => [department, roster.inDepartment(department).length])),
  personaBytes: {
    min: Math.min(...bodySizes),
    median: median(bodySizes),
    max: Math.max(...bodySizes),
    total: bodySizes.reduce((sum, size) => sum + size, 0),
  },
  catalog: Object.fromEntries(['off', 'depts', 'compact', 'full'].map((mode) => [mode, estimateCatalog(roster, mode)])),
  templateNeutralization: {
    rolesNeedingIt: hostile.length,
    roles: hostile.map((role) => role.id),
  },
  playbooks: [],
}

for (const entry of PLAYBOOKS) {
  const text = await renderPlaybook(io, CORPUS, entry)
  report.playbooks.push({ id: entry.id, chars: text.length, kind: entry.kind })
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} else {
  const lines = []
  lines.push(`corpus                ${report.corpus}`)
  lines.push(`roles                 ${report.roles} across ${report.departments} departments`)
  lines.push(`role body size        min ${report.personaBytes.min} / median ${report.personaBytes.median} / max ${report.personaBytes.max} chars (total ${report.personaBytes.total})`)
  lines.push('')
  lines.push('resident catalog cost')
  for (const [mode, estimate] of Object.entries(report.catalog)) {
    lines.push(`  ${mode.padEnd(8)} ${String(estimate.chars).padStart(6)} chars  ≈ ${String(estimate.approxTokens).padStart(5)} tokens`)
  }
  lines.push('')
  lines.push(`template neutralization required for ${hostile.length} role file(s):`)
  for (const role of hostile) lines.push(`  - ${role.id}`)
  lines.push('')
  lines.push('playbooks (loaded on demand)')
  for (const entry of report.playbooks) lines.push(`  ${entry.id.padEnd(18)} ${String(entry.chars).padStart(6)} chars  ${entry.kind}`)
  lines.push('')
  lines.push(`role id inventory: ${roster.roles.length} unique ids, ${new Set(roster.roles.map((r) => r.name)).size} unique display names`)
  process.stdout.write(`${lines.join('\n')}\n`)
}
