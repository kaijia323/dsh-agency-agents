/**
 * Client bundle tests.
 *
 * The bundle is generated, so these assertions are about the contract the shell
 * enforces, and they run the artifact rather than reading it: a classic script
 * must call `window.__ModuleLoader__.load` with a factory, and the factory must
 * return a Cordis plugin whose `apply` registers the page into
 * `settings.section`.
 *
 * This is the defect that shipped in v0.1.1: the client half was plain ESM, so
 * it evaluated fine and registered nothing. The shell reported
 * `loaded without registering "dsh-agency-agents" via __ModuleLoader__.load` and
 * every other client plugin in the same combo failed with it — the whole
 * settings panel vanished.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BUNDLE = resolve(ROOT, 'lib/client.js')

/**
 * Run the bundle as the browser would: a classic script whose only entry point
 * is the module loader it registers with.
 * @returns {{ id: string, exports: object, registered: object[], calls: string[], resolved: object, required: string[] }}
 */
async function runBundle() {
  const code = await readFile(BUNDLE, 'utf8')
  const registrations = []
  const calls = []
  let styleCount = 0

  const slots = {
    inject(key, callback) {
      calls.push(`inject:${key}`)
      return callback()
    },
    register(options, component) {
      registrations.push({ options, component })
      calls.push(`register:${options.name}:${options.id}`)
      return () => calls.push(`dispose:${options.id}`)
    },
  }
  const loaded = []
  // `useEffect` runs its effect during render here, which is enough to prove the
  // page reaches for the RPC and installs its own <style> without a DOM harness.
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: (effect) => {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanup()
    },
  }
  // The bundle declares `slots` in its inject, so Cordis guarantees the service
  // is present on the context by the time apply runs.
  const ctx = {
    slots,
    get: (name) => (name === 'slots' ? slots : undefined),
    effect: (callback) => callback(),
  }
  const resolved = { hostCall: 0, styleRemovals: 0, styleInserts: 0 }
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (descriptor) => {
          assert.equal(typeof descriptor.id, 'string')
          assert.equal(typeof descriptor.factory, 'function')
          assert.equal(descriptor.factory.length, 1, 'the factory receives require')
          loaded.push(descriptor)
        },
      },
    },
    React,
    document: {
      createElement: () => ({ textContent: '', remove: () => { resolved.styleRemovals += 1 } }),
      head: { appendChild: () => { styleCount += 1; resolved.styleInserts = (resolved.styleInserts ?? 0) + 1 } },
    },
    navigator: { clipboard: { writeText: async () => {} } },
    console: { log: () => {}, error: () => {} },
  }
  vm.createContext(sandbox)
  new vm.Script(code, { filename: BUNDLE }).runInContext(sandbox)

  assert.equal(loaded.length, 1, 'the bundle registered exactly one module')
  const descriptor = loaded[0]
  const required = []
  const exports = descriptor.factory((specifier) => {
    required.push(specifier)
    // The shell resolves bare specifiers from its frozen module table; `react` is
    // the only one this bundle may ask for.
    if (specifier === 'react') return React
    throw new Error(`the bundle required an unexpected module: ${specifier}`)
  })
  return { id: descriptor.id, exports, registered: registrations, calls, ctx, resolved, required }
}


/**
 * Render the registered component the way React would.
 *
 * The registration is a wrapper that returns `React.createElement(AgencyPage)`;
 * a stub renderer must therefore unwrap element descriptors until it reaches the
 * function component, or the page body never runs.
 * @param {Function} component - the registered component.
 * @returns {object[]} the rendered element of the page body.
 */
function renderAgencyPage(component) {
  let node = component({ close: () => {} })
  const seen = new Set()
  while (node !== null && typeof node === 'object' && typeof node.type === 'function' && !seen.has(node.type)) {
    seen.add(node.type)
    node = node.type(node.props ?? {})
  }
  return node
}

test('the bundle registers itself with the shell module loader', async () => {
  const bundle = await runBundle()
  assert.equal(bundle.id, 'dsh-agency-agents')
})

test('the factory returns a Cordis plugin the shell can apply', async () => {
  const bundle = await runBundle()
  assert.equal(typeof bundle.exports.apply, 'function', 'a bundle without apply loads and does nothing')
  // Cross-realm: an array built inside the vm context is not deep-equal to one
  // built here, so compare its contents rather than its identity.
  assert.equal(Array.isArray(bundle.exports.inject), true)
  assert.equal(bundle.exports.inject.length, 1)
  assert.equal(bundle.exports.inject[0], 'slots', 'the slot system must be present before apply runs')
})

test('applying the plugin registers the 专家团 page into settings.section', async () => {
  const bundle = await runBundle()
  const disposer = bundle.exports.apply(bundle.ctx)
  assert.equal(typeof disposer, 'function', 'apply returns a disposer')
  assert.equal(bundle.registered.length, 1)
  const { options, component } = bundle.registered[0]
  assert.equal(options.name, 'settings.section')
  assert.equal(options.id, 'agency-agents')
  assert.equal(options.order, 30)
  assert.equal(options.label, '专家团')
  assert.equal(typeof component, 'function', 'the registration renders a component')
  assert.deepEqual(bundle.calls.filter((call) => call.startsWith('inject:')), ['inject:settings.section'])
})

test('rendering the page uses the inlined roster and owns its styles', async () => {
  const bundle = await runBundle()
  bundle.exports.apply(bundle.ctx)
  const rendered = renderAgencyPage(bundle.registered[0].component)
  // The page has no RPC to call: a packaged client half carries its own data, and
  // the rendered tree must reflect the inlined roster rather than an empty shell.
  const text = JSON.stringify(rendered)
  assert.equal(text.includes('位专家'), true, 'the header reports the roster size')
  assert.equal(text.includes('专家名录'), true, 'the experts tab is the default view')
  // The stub runs each effect's cleanup immediately, so the page installed its
  // <style> and removed it — the page owns the element's lifecycle.
  assert.equal(bundle.resolved.styleInserts, 1, `the page installs exactly one <style> (calls: ${bundle.calls.join(', ')})`)
  assert.equal(bundle.resolved.styleRemovals, 1, 'and releases it on unmount')
})

test('the bundle inlines the roster rather than asking the Host for it', async () => {
  const code = await readFile(BUNDLE, 'utf8')
  // Slice rather than regex: the inlined JSON is large and may contain braces.
  const OPEN = 'const __AGENCY_ROSTER__ = '
  const from = code.indexOf(OPEN)
  assert.notEqual(from, -1, 'the roster constant is emitted')
  // One line of JSON follows the marker; parse exactly that line so nothing else
  // in the envelope (comments included) can be mistaken for data.
  const line = code.slice(from + OPEN.length).split('\n')[0]
  const roster = JSON.parse(line)
  assert.equal(roster.roles.length, 277, 'every role is inlined')
  assert.equal(roster.departments.length, 20)
  assert.equal(roster.squads.length, 14)
  assert.equal(roster.tools.run, 'agency_run', 'the page shows the real tool names')
  // No RPC surface may survive: a packaged client half cannot reach one. Prose
  // in the generated header mentions the name, so check executable code only.
  const codeLines = code.split('\n').filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
  assert.equal(codeLines.some((line) => line.includes('host.call')), false, 'the page must not depend on the dynamic runner RPC')
})

test('the bundle resolves React through the module table, not as a global', async () => {
  const bundle = await runBundle()
  bundle.exports.apply(bundle.ctx)
  renderAgencyPage(bundle.registered[0].component)
  // The factory resolves React itself; a bundle that instead reads a global
  // React renders "React is not defined" inside the slot.
  assert.equal(bundle.required.includes('react'), true, `expected require("react"), saw [${bundle.required.join(', ')}]`)
  assert.deepEqual(
    [...new Set(bundle.required)],
    ['react'],
    'the page must ask for nothing else from the module table',
  )
})

test('the bundle carries no ES module syntax', async () => {
  const code = await readFile(BUNDLE, 'utf8')
  assert.equal(/^export /m.test(code), false, 'a classic script cannot parse an export statement')
  assert.equal(/^import /m.test(code), false, 'a classic script cannot parse an import statement')
  assert.equal(code.includes('__ModuleLoader__.load'), true)
})
