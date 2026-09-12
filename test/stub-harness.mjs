/**
 * Loader hook used only by the test suite.
 *
 * `src/tools.js` and `src/index.js` import `@deepseek-ai/dsh-tools`, which a
 * checkout of this repository does not have installed (it is a peer dependency
 * of the mounted deployment). The hook resolves that specifier — and the other
 * harness specifiers a host would provide — to an in-memory stub so the plugin's
 * own wiring can be exercised here: config validation, roster indexing, tool
 * registration, and the full delegation path against a fake `subagents` service.
 *
 * The stub is deliberately minimal and mirrors only the shapes this package
 * consumes; it is not a harness emulator.
 *
 * @module dsh-agency-agents/test/stub-harness
 */

import { register } from 'node:module'

/** Identities the harness owns; a stub instance is returned per specifier. */
const STUBBED = new Set([
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-subagent',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/cordis',
])

const SOURCE = `
/**
 * Echo the tool definition. The real helper only compiles the parameter spec and
 * wraps \`execute\` with argument validation; both are the harness's concern, so
 * the plugin's own behavior is observable on the object it hands over.
 */
export function defineTool(options) {
  return options
}
`

/** Register the hook once per process. */
export function installHarnessStub() {
  register(
    `data:text/javascript,${encodeURIComponent(`
      const STUBBED = ${JSON.stringify([...STUBBED])}
      const SOURCE = ${JSON.stringify(SOURCE)}
      export async function resolve(specifier, context, nextResolve) {
        if (STUBBED.includes(specifier)) {
          return { url: 'stub:' + specifier, shortCircuit: true, format: 'module' }
        }
        return nextResolve(specifier, context)
      }
      export async function load(url, context, nextLoad) {
        if (url.startsWith('stub:')) {
          return { format: 'module', source: SOURCE, shortCircuit: true }
        }
        return nextLoad(url, context)
      }
    `)}`,
    import.meta.url,
  )
}
