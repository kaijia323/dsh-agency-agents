/**
 * The Cordis plugin row.
 *
 * Kept separate from `src/index.js` only so the library half (`roster`,
 * `catalog`, `persona`, `playbook`) stays importable — and testable — without
 * the harness packages present. `@deepseek-ai/dsh-tools` is a peer dependency:
 * a deployment that mounts this row has it, and a test run does not need it.
 *
 * @module dsh-agency-agents/plugin
 */

import { apply, inject, name } from './index.js'

export { apply, inject, name }
export { resolveConfig } from './index.js'
export default { name, inject, apply }
