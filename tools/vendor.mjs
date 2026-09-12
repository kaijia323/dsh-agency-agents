/**
 * Refresh the vendored corpus from an agency-agents-zh checkout.
 *
 * The published package carries a snapshot of the role library so the plugin is
 * offline-installable and reproducible. This script is how that snapshot is
 * produced: point it at a checkout, and it copies only the role-bearing
 * directories plus the upstream LICENSE, then records the provenance in
 * `data/VENDOR.md`. Assets, integrations, examples, and the upstream's own
 * gallery are deliberately excluded — they are most of the repository's weight
 * and none of the plugin's behaviour.
 *
 * Usage:
 *   node tools/vendor.mjs --from /path/to/agency-agents-zh
 *   node tools/vendor.mjs --from https://github.com/jnMetaCode/agency-agents-zh
 *
 * @module dsh-agency-agents/tools/vendor
 */

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = resolve(ROOT, 'data/agency-agents-zh')

/** Directories whose markdown is copied. Matches the roster scanner's view. */
const ROLE_DIRECTORIES = [
  'academic', 'company', 'design', 'engineering', 'finance', 'game-development', 'gis', 'hr',
  'legal', 'marketing', 'paid-media', 'product', 'project-management', 'sales', 'security',
  'spatial-computing', 'specialized', 'strategy', 'supply-chain', 'support', 'testing',
]

/** Parse `--flag value` pairs. */
function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    args[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') === false ? argv[++i] : true
  }
  return args
}

/** Whether a file is a role definition (frontmatter carries a `name`). */
async function isRole(file) {
  const text = await readFile(file, 'utf8')
  const end = text.indexOf('\n---', 3)
  if (!text.startsWith('---') || end < 0) return undefined
  const name = /^name:[ \t]*(.+)$/m.exec(text.slice(3, end))
  return name === null ? undefined : name[1].trim()
}

/** Recursively collect `*.md` paths under a directory. */
async function markdownFiles(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await markdownFiles(path)))
    else if (entry.name.endsWith('.md')) found.push(path)
  }
  return found
}

const args = parseArgs(process.argv.slice(2))
if (args.from === undefined) {
  process.stderr.write('usage: node tools/vendor.mjs --from <checkout path or git URL>\n')
  process.exit(2)
}

let source = resolve(String(args.from))
let commit = 'unknown'
if (/^https?:|^git@/.test(String(args.from))) {
  const tmp = resolve(ROOT, 'tmp/vendor-checkout')
  await rm(tmp, { recursive: true, force: true })
  process.stdout.write(`cloning ${args.from} …\n`)
  await run('git', ['clone', '--depth', '1', String(args.from), tmp], { maxBuffer: 32 * 1024 * 1024 })
  source = tmp
}
try {
  const { stdout } = await run('git', ['-C', source, 'rev-parse', 'HEAD'])
  commit = stdout.trim()
} catch {
  process.stdout.write('note: source is not a git checkout; commit unknown\n')
}
try {
  await stat(join(source, 'README.md'))
} catch {
  process.stderr.write(`error: ${source} does not look like an agency-agents-zh checkout\n`)
  process.exit(2)
}

await rm(TARGET, { recursive: true, force: true })
await mkdir(TARGET, { recursive: true })
const perDepartment = {}
let roles = 0
let files = 0
for (const department of ROLE_DIRECTORIES) {
  const from = join(source, department)
  try {
    await stat(from)
  } catch {
    continue
  }
  await cp(from, join(TARGET, department), { recursive: true, filter: (src) => !src.includes('/.git') })
  let departmentRoles = 0
  for (const file of await markdownFiles(join(TARGET, department))) {
    files += 1
    if ((await isRole(file)) !== undefined) departmentRoles += 1
  }
  if (departmentRoles > 0) perDepartment[department] = departmentRoles
  roles += departmentRoles
}

// The upstream license travels with the content; redistribution depends on it.
await cp(join(source, 'LICENSE'), join(TARGET, 'LICENSE'))

const upstreamPackage = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const stamp = new Date().toISOString().slice(0, 10)
await writeFile(
  resolve(ROOT, 'data/VENDOR.md'),
  [
    '# Vendored corpus provenance',
    '',
    'The markdown under `agency-agents-zh/` is a snapshot of the upstream community project.',
    'It is vendored rather than fetched so the plugin works offline and so a run is',
    'reproducible. `tools/vendor.mjs` is the only thing that may rewrite it.',
    '',
    '| field | value |',
    '| --- | --- |',
    `| upstream | https://github.com/jnMetaCode/agency-agents-zh |`,
    `| upstream version | ${upstreamPackage.version} |`,
    `| commit | ${commit} |`,
    `| vendored on | ${stamp} |`,
    `| roles | ${roles} |`,
    `| departments | ${Object.keys(perDepartment).length} |`,
    `| markdown files | ${files} |`,
    '| license | MIT (upstream LICENSE copied beside the content) |',
    '',
    '## Roles per department',
    '',
    '| department | roles |',
    '| --- | --- |',
    ...Object.entries(perDepartment).sort().map(([department, count]) => `| ${department} | ${count} |`),
    '',
    '## What is deliberately not vendored',
    '',
    '`assets/`, `evals/`, `examples/`, `integrations/`, and `scripts/` — the upstream',
    'repository\'s sponsor images, gallery, per-tool conversion output, and tooling. They',
    'are most of its weight and none of this plugin\'s behaviour. The `strategy/`',
    'documentation *is* vendored: it is the orchestration manual the playbooks load.',
    '',
    '## Refreshing',
    '',
    '```sh',
    'node tools/vendor.mjs --from https://github.com/jnMetaCode/agency-agents-zh',
    'npm test   # the roster assertions pin the counts recorded above',
    '```',
    '',
    'A refresh that changes the role count must update the expectations in',
    '`test/roster.test.js` and `test/persona.test.js` in the same commit.',
    '',
  ].join('\n'),
)
process.stdout.write(`vendored ${roles} roles across ${Object.keys(perDepartment).length} departments (${files} files) from ${commit}\n`)
