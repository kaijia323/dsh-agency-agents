/**
 * File access for the roster loader.
 *
 * The loader must run in two very different worlds: a published package reading
 * the vendored corpus through Node's `fs`, and inside the harness where file
 * access belongs to the `fs` service (a sandboxed or remote backend may be the
 * real owner). Both are expressed as the same two-method interface so every
 * other module in this package stays free of environment branches.
 *
 * @module dsh-agency-agents/io
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** @typedef {{ listDir(path: string): Promise<string[]>, readText(path: string): Promise<string> }} RosterIO */

/** Sort directory entries the same way in every backend, so the catalog is stable. */
function sortNames(names) {
  return [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * Node-backed file access, for tests, tooling, and a direct host mount.
 * @param {{ root?: string }} [options] - optional base directory for relative paths.
 * @returns {RosterIO} the reader.
 */
export function createNodeIO(options = {}) {
  const base = options.root === undefined ? process.cwd() : resolve(options.root)
  const at = (path) => (path.startsWith('/') ? path : join(base, path))
  return {
    async listDir(path) {
      const entries = await readdir(at(path), { withFileTypes: true })
      return sortNames(
        entries.filter((entry) => entry.isDirectory() || entry.isFile()).map((entry) => entry.name),
      )
    },
    async readText(path) {
      return readFile(at(path), 'utf8')
    },
  }
}

/**
 * Harness `fs`-service-backed file access.
 *
 * Every call resolves a fresh target: the service owns path identity, and
 * caching targets across a plugin's lifetime would outlive a backend swap.
 * @param {{ resolve(path: string, opts?: { cwd?: string }): Promise<unknown>, readText(target: unknown): Promise<string>, listDir(target: unknown): Promise<Array<{ name: string, type: string }>> }} fs - the `fs` service.
 * @param {string} [cwd] - base directory for relative paths.
 * @returns {RosterIO} the reader.
 */
export function createServiceIO(fs, cwd) {
  return {
    async listDir(path) {
      const target = await fs.resolve(path, cwd === undefined ? undefined : { cwd })
      const entries = await fs.listDir(target)
      return sortNames(entries.map((entry) => entry.name))
    },
    async readText(path) {
      const target = await fs.resolve(path, cwd === undefined ? undefined : { cwd })
      return fs.readText(target)
    },
  }
}

/**
 * Absolute path of this package's own directory.
 *
 * Used only to default the vendored corpus location; an explicit `rosterRoot`
 * always wins. Returns `undefined` rather than throwing when the module has no
 * file URL (a bundled or dynamically evaluated host).
 * @returns {string | undefined} the package root, or undefined.
 */
export function packageRoot() {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..')
  } catch {
    return undefined
  }
}

/**
 * Whether a path exists, without leaking a backend-specific error type.
 * @param {RosterIO} io - the reader.
 * @param {string} path - candidate path.
 * @returns {Promise<boolean>} true when it is readable as a directory or file.
 */
export async function exists(io, path) {
  try {
    await io.listDir(path)
    return true
  } catch {
    try {
      await io.readText(path)
      return true
    } catch {
      return false
    }
  }
}

/**
 * Node-only existence probe for the CLI tooling (kept separate from the
 * backend-neutral helper above, which must not import `node:fs` semantics).
 * @param {string} path - candidate path.
 * @returns {Promise<boolean>} true when the path exists.
 */
export async function nodeExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
