/**
 * The roster index.
 *
 * One scan of the vendored corpus produces an in-memory index of every role:
 * identity, department, one-line summary, and the path the body is read from on
 * demand. Nothing here reads a role body — a body is 4–50 KB and is only ever
 * needed at the moment a role is actually delegated to, which is what keeps the
 * whole 277-role library out of the parent conversation's context.
 *
 * @module dsh-agency-agents/roster
 */

import { parseFrontmatter, parseList } from './frontmatter.js'

/** Departments in the corpus, with the display names the playbooks use. */
export const DEPARTMENT_LABELS = {
  academic: '学术',
  company: '公司经营',
  design: '设计',
  engineering: '工程',
  finance: '金融',
  'game-development': '游戏开发',
  gis: '地理信息',
  hr: '人力资源',
  legal: '法务',
  marketing: '营销',
  'paid-media': '付费媒体',
  product: '产品',
  'project-management': '项目管理',
  sales: '销售',
  security: '安全',
  'spatial-computing': '空间计算',
  specialized: '专项',
  strategy: '战略',
  'supply-chain': '供应链',
  support: '支持',
  testing: '测试',
}

/** Directory names that never hold role definitions. */
const SKIP_DIRECTORIES = new Set(['.git', '.github', 'node_modules', 'assets', 'evals', 'examples', 'integrations', 'scripts'])

/** Roles the shipped NEXUS playbooks name under a different label than the roster's `name`. */
export const DEFAULT_NAME_ALIASES = {
  高管摘要生成器: 'support-executive-summary-generator',
  'LSP/索引工程师': 'lsp-index-engineer',
  'LSP索引工程师': 'lsp-index-engineer',
}

/** Normalize a role label for comparison: case, spacing, and separators are not meaningful. */
export function normalizeLabel(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s_\-/\\（）()【】[\]·.,:：]+/g, '')
}

/**
 * Scan a corpus root and build the roster index.
 *
 * The walk is recursive with a depth cap: the corpus is mostly flat, but
 * game-development nests one level per engine, and a future upstream addition
 * should not silently vanish from the catalog. A file counts as a role exactly
 * when its frontmatter carries a `name`, which is the predicate the upstream
 * project's own count script uses — that is what excludes the NEXUS playbooks
 * and runbooks that sit beside the roles under `strategy/`.
 * @param {import('./io.js').RosterIO} io - file access.
 * @param {{ root: string, nameAliases?: Record<string, string>, skipDepartments?: string[], maxDepth?: number }} options - scan options.
 * @returns {Promise<Roster>} the index.
 */
export async function loadRoster(io, options) {
  const root = options.root
  const skip = new Set(options.skipDepartments ?? [])
  const maxDepth = options.maxDepth ?? 3
  const entries = await io.listDir(root)
  const roles = []
  const scannedDepartments = []
  for (const department of entries) {
    if (department.startsWith('.') || SKIP_DIRECTORIES.has(department) || skip.has(department)) continue
    const departmentPath = `${root}/${department}`
    let isDirectory
    try {
      isDirectory = (await io.listDir(departmentPath)).length >= 0
    } catch {
      isDirectory = false
    }
    if (!isDirectory) continue
    const before = roles.length
    await walk(io, departmentPath, department, 0, maxDepth, roles)
    if (roles.length > before) scannedDepartments.push(department)
  }
  roles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return new Roster(roles, scannedDepartments, options.nameAliases ?? {})
}

/** Depth-capped recursive walk collecting role definitions. */
async function walk(io, path, department, depth, maxDepth, roles) {
  if (depth > maxDepth) return
  let children
  try {
    children = await io.listDir(path)
  } catch {
    return
  }
  for (const child of children) {
    if (child.startsWith('.')) continue
    const childPath = `${path}/${child}`
    if (child.endsWith('.md')) {
      const role = await readRole(io, childPath, department)
      if (role !== undefined) roles.push(role)
      continue
    }
    if (SKIP_DIRECTORIES.has(child)) continue
    let nested
    try {
      nested = await io.listDir(childPath)
    } catch {
      continue
    }
    if (nested.length === 0) continue
    await walk(io, childPath, department, depth + 1, maxDepth, roles)
  }
}

/** Read one candidate file; `undefined` when it is not a role definition. */
async function readRole(io, path, department) {
  let text
  try {
    text = await io.readText(path)
  } catch {
    return undefined
  }
  const { data, body, hasFrontmatter } = parseFrontmatter(text)
  // The corpus carries non-role markdown beside the roles (NEXUS playbooks and
  // runbooks). A role is identified by a frontmatter `name`, which is exactly
  // the predicate the upstream project's own count script uses.
  if (!hasFrontmatter || typeof data.name !== 'string' || data.name.length === 0) return undefined
  const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  return {
    id: file,
    name: data.name,
    description: typeof data.description === 'string' ? data.description : '',
    department,
    path,
    emoji: typeof data.emoji === 'string' ? data.emoji : '',
    declaredTools: parseList(data.tools),
    body,
  }
}

/** The roster index with the lookups the tools need. */
export class Roster {
  /**
   * @param {Array<object>} roles - every indexed role.
   * @param {string[]} departments - departments that contributed at least one role, in scan order.
   * @param {Record<string, string>} nameAliases - playbook label → role id.
   */
  constructor(roles, departments, nameAliases) {
    this.roles = roles
    this.departments = departments
    this.nameAliases = { ...DEFAULT_NAME_ALIASES, ...nameAliases }
    /** @type {Map<string, object>} */
    this.byId = new Map()
    /** @type {Map<string, object>} */
    this.byNormalized = new Map()
    for (const role of roles) {
      this.byId.set(role.id, role)
      for (const label of [role.id, role.name, role.id.replace(/\.md$/, '')]) {
        const key = normalizeLabel(label)
        if (!this.byNormalized.has(key)) this.byNormalized.set(key, role)
      }
    }
  }

  /** @returns {number} how many roles the index holds. */
  get size() {
    return this.roles.length
  }

  /**
   * Roles in one department, in id order.
   * @param {string} department - department directory name.
   * @returns {object[]} matching roles.
   */
  inDepartment(department) {
    return this.roles.filter((role) => role.department === department)
  }

  /**
   * Resolve one role by id, display name, alias, or a `department/file` path.
   *
   * Resolution is deliberately forgiving — a model that read a role id out of a
   * playbook may pass the path form or the Chinese display name — but it never
   * guesses: an unmatched input returns `undefined` so the caller can report the
   * closest candidates instead of silently hiring the wrong expert.
   * @param {string} reference - model-supplied identifier.
   * @returns {object | undefined} the role.
   */
  resolve(reference) {
    if (typeof reference !== 'string') return undefined
    const raw = reference.trim()
    if (raw.length === 0) return undefined
    const direct = this.byId.get(raw) ?? this.byId.get(raw.replace(/\.md$/, ''))
    if (direct !== undefined) return direct
    if (raw.includes('/')) {
      const tail = raw.slice(raw.lastIndexOf('/') + 1).replace(/\.md$/, '')
      const byPathTail = this.byId.get(`${raw.split('/').slice(-2, -1)[0]}-${tail}`) ?? this.byId.get(tail)
      if (byPathTail !== undefined) return byPathTail
    }
    const alias = this.nameAliases[raw]
    if (alias !== undefined && this.byId.has(alias)) return this.byId.get(alias)
    const normalized = this.byNormalized.get(normalizeLabel(raw))
    if (normalized !== undefined) return normalized
    return undefined
  }

  /**
   * The roles closest to an unresolved reference, for a loud, actionable error.
   * @param {string} reference - the unmatched input.
   * @param {number} [limit] - how many candidates to return.
   * @returns {object[]} best candidates, best first.
   */
  closest(reference, limit = 3) {
    return this.search(reference, { limit }).map((hit) => hit.role)
  }

  /**
   * Score every role against a free-text need.
   *
   * Scoring is intentionally explainable rather than clever: exact and prefix
   * hits on the display name dominate, then description terms, then department
   * vocabulary. A model that sees why a role matched can correct a bad pick;
   * one that sees an opaque similarity score cannot.
   * @param {string} need - the requirement, in any language.
   * @param {{ department?: string, limit?: number, exclude?: string[] }} [options] - filters.
   * @returns {Array<{ role: object, score: number, reasons: string[] }>} ranked hits.
   */
  search(need, options = {}) {
    const limit = options.limit ?? 5
    const excluded = new Set(options.exclude ?? [])
    const terms = tokenize(need)
    const needle = normalizeLabel(need)
    const scored = []
    for (const role of this.roles) {
      if (excluded.has(role.id)) continue
      if (options.department !== undefined && role.department !== options.department) continue
      const reasons = []
      let score = 0
      const name = normalizeLabel(role.name)
      const id = normalizeLabel(role.id)
      const description = normalizeLabel(role.description)
      if (needle.length > 0 && name === needle) {
        score += 100
        reasons.push('名称完全匹配')
      } else if (needle.length > 1 && name.includes(needle)) {
        score += 60
        reasons.push('名称包含需求关键词')
      }
      if (needle.length > 1 && id.includes(needle)) {
        score += 30
        reasons.push('角色 ID 包含需求关键词')
      }
      for (const term of terms) {
        if (term.length < 2) continue
        if (name.includes(term)) {
          score += 12
          reasons.push(`名称命中「${term}」`)
        }
        if (id.includes(term)) score += 6
        if (description.includes(term)) {
          score += 4
          reasons.push(`简介命中「${term}」`)
        }
      }
      if (score > 0) scored.push({ role, score, reasons: [...new Set(reasons)].slice(0, 3) })
    }
    scored.sort((a, b) => (b.score - a.score) || (a.role.id < b.role.id ? -1 : 1))
    return scored.slice(0, limit)
  }
}

/**
 * Split a need into comparable terms.
 *
 * CJK has no whitespace to split on, so a Chinese run contributes its 2- and
 * 3-character n-grams; Latin text contributes whitespace-delimited words. That
 * is enough for a 277-entry index and avoids a tokenizer dependency.
 * @param {string} need - the raw requirement text.
 * @returns {string[]} normalized terms.
 */
function tokenize(need) {
  const terms = new Set()
  for (const word of String(need ?? '').toLowerCase().split(/[^\p{L}\p{N}+#.]+/u)) {
    if (word.length >= 2) terms.add(normalizeLabel(word))
  }
  for (const run of String(need ?? '').match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let size = 2; size <= 3; size += 1) {
      for (let i = 0; i + size <= run.length; i += 1) terms.add(run.slice(i, i + size))
    }
  }
  return [...terms]
}
