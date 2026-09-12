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
 * @returns {{ id: string, exports: object, registered: object[], calls: string[], resolved: object }}
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
  const ctx = {
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
    host: {
      call: async (method) => {
        resolved.hostCall += 1
        calls.push(`host.call:${method}`)
        return { roles: [], departments: [], squads: [], tools: {}, source: 'builtin', catalogMode: 'compact' }
      },
    },
    console: { log: () => {}, error: () => {} },
  }
  vm.createContext(sandbox)
  new vm.Script(code, { filename: BUNDLE }).runInContext(sandbox)

  assert.equal(loaded.length, 1, 'the bundle registered exactly one module')
  const descriptor = loaded[0]
  const exports = descriptor.factory(() => {
    throw new Error('the bundle must not require anything: it is served without a module table')
  })
  return { id: descriptor.id, exports, registered: registrations, styleCount, calls, ctx, resolved }
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
  assert.equal(bundle.exports.inject.length, 0, 'the page needs no other client plugin')
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

test('rendering the page fetches its payload over the package RPC and owns its styles', async () => {
  const bundle = await runBundle()
  bundle.exports.apply(bundle.ctx)
  const component = bundle.registered[0].component
  renderAgencyPage(component)
  // The fetch is a promise; give it a turn to settle before reading the log.
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(bundle.calls.includes('host.call:agency/settings'), true, `the page asks the Host half for its data (saw ${bundle.calls.join(', ')})`)
  // The stub runs each effect's cleanup immediately, so the page both installed
  // its <style> and removed it — which is the property under test: the page owns
  // the element's full lifecycle rather than leaking it.
  assert.equal(bundle.resolved.styleInserts, 1, `the page installs exactly one <style> (calls: ${bundle.calls.join(', ')})`)
  assert.equal(bundle.resolved.styleRemovals, 1, 'and releases it on unmount')
})

test('the bundle carries no ES module syntax', async () => {
  const code = await readFile(BUNDLE, 'utf8')
  assert.equal(/^export /m.test(code), false, 'a classic script cannot parse an export statement')
  assert.equal(/^import /m.test(code), false, 'a classic script cannot parse an import statement')
  assert.equal(code.includes('__ModuleLoader__.load'), true)
})
