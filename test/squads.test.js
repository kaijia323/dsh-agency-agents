/**
 * Squad tests.
 *
 * The squads are the plugin's claim about *how* experts work together, so the
 * assertions here are about the claim staying true: every member must exist in
 * the roster, the gatekeeper must exist, the playbook must resolve, and the
 * browser bundle's inline copy must equal the Host half's catalog — that last
 * one is the only guard against the two drifting, and the two files are edited
 * for different reasons (data vs. bundle size).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createNodeIO } from '../src/io.js'
import { loadRoster } from '../src/roster.js'
import { SQUADS, squadsForRole, squadRoleIds } from '../src/squads.js'
import { CLIENT_SQUADS } from '../src/client.js'
import { resolvePlaybooks } from '../src/playbook.js'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/agency-agents-zh')
const io = createNodeIO()

/** @type {Awaited<ReturnType<typeof loadRoster>>} */
let roster
async function indexed() {
  if (roster === undefined) roster = await loadRoster(io, { root: ROOT })
  return roster
}

test('every squad member and gatekeeper exists in the roster', async () => {
  const loaded = await indexed()
  const missing = []
  for (const squad of SQUADS) {
    for (const step of squad.steps) if (loaded.resolve(step.employee) === undefined) missing.push(`${squad.id} → ${step.employee}`)
    if (squad.gatekeeper !== undefined && loaded.resolve(squad.gatekeeper) === undefined) missing.push(`${squad.id} → gatekeeper ${squad.gatekeeper}`)
  }
  assert.deepEqual(missing, [], 'a squad naming a nonexistent role would send the model hunting for it')
})

test('every squad names a playbook the playbook registry can load', () => {
  for (const squad of SQUADS) {
    assert.equal(resolvePlaybooks(squad.playbook).length > 0, true, `${squad.id} → ${squad.playbook}`)
  }
})

test('no squad repeats a member, and every squad has a trigger and a scale', () => {
  for (const squad of SQUADS) {
    const ids = squad.steps.map((step) => step.employee)
    assert.equal(new Set(ids).size, ids.length, `${squad.id} repeats a member`)
    assert.equal(squad.steps.length > 0, true, `${squad.id} has no members`)
    assert.equal(typeof squad.when === 'string' && squad.when.length > 0, true, `${squad.id} has no trigger`)
    assert.equal(typeof squad.scale === 'string' && squad.scale.length > 0, true, `${squad.id} has no scale`)
    assert.equal(squad.group.length > 0, true, `${squad.id} has no display group`)
  }
})

test('squads cover the manual’s three deployment modes and both named gates', () => {
  const byId = new Map(SQUADS.map((squad) => [squad.id, squad]))
  assert.equal(byId.has('bugfix'), true, 'a Micro configuration from §15.3')
  assert.equal(byId.has('sprint-mvp'), true, 'the Sprint configuration')
  assert.equal(byId.has('phase-3-tracks'), true, 'the four parallel tracks from §6.3')
  assert.equal(byId.get('gate-discovery').gatekeeper, 'support-executive-summary-generator', 'the 0→1 gatekeeper named by §12.1')
  assert.equal(byId.get('gate-production').gatekeeper, 'testing-reality-checker', 'the single authority for production readiness')
})

test('squadsForRole answers who an expert usually works with', async () => {
  const loaded = await indexed()
  const reviewBoard = squadsForRole('engineering-code-reviewer').map((squad) => squad.id)
  assert.equal(reviewBoard.includes('code-review-board'), true)
  assert.equal(squadsForRole('marketing-content-creator').some((squad) => squad.id === 'phase-3-tracks'), true)
  assert.deepEqual(squadsForRole('academic-anthropologist'), [], 'a specialist no squad deploys')
  // The set is what the settings page uses to tag cards.
  const ids = squadRoleIds()
  assert.equal(ids.has('testing-reality-checker'), true)
  assert.equal(ids.size > 20, true, `only ${ids.size} roles are squad members`)
  void loaded
})

test('the browser bundle carries the same catalog as the host half', () => {
  // Field-by-field rather than a JSON compare, so a key reordering in one file
  // is not a failure while a changed member, role, gatekeeper, or playbook is.
  assert.equal(CLIENT_SQUADS.length, SQUADS.length, 'squad count')
  for (let i = 0; i < SQUADS.length; i += 1) {
    const host = SQUADS[i]
    const client = CLIENT_SQUADS[i]
    assert.equal(client.id, host.id)
    assert.equal(client.name, host.name)
    assert.equal(client.group, host.group)
    assert.equal(client.scale, host.scale)
    assert.equal(client.when, host.when)
    assert.equal(client.playbook, host.playbook)
    assert.equal(client.gatekeeper ?? null, host.gatekeeper ?? null, `${host.id} gatekeeper`)
    assert.equal(client.steps.length, host.steps.length, `${host.id} step count`)
    for (let j = 0; j < host.steps.length; j += 1) {
      assert.equal(client.steps[j].employee, host.steps[j].employee, `${host.id} step ${j} employee`)
      assert.equal(client.steps[j].role, host.steps[j].role, `${host.id} step ${j} role`)
      assert.equal(client.steps[j].optional === true, host.steps[j].optional === true, `${host.id} step ${j} optional`)
    }
  }
})
