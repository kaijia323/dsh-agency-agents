/**
 * Minimal frontmatter parser for the agency-agents-zh corpus.
 *
 * The corpus uses a deliberately simple YAML subset — a leading `---` fence, a
 * flat `key: value` block, a closing `---`, then markdown. Pulling in a YAML
 * dependency for that would be more surface than the format deserves, and the
 * parser must stay tolerant: a file whose frontmatter does not match is not an
 * agent at all, and the scanner simply skips it.
 *
 * @module dsh-agency-agents/frontmatter
 */

/**
 * Parse one markdown document's leading frontmatter block.
 * @param {string} text - full file content.
 * @returns {{ data: Record<string, string>, body: string, hasFrontmatter: boolean }}
 *   parsed flat key/value pairs, the remaining body, and whether a fence was found.
 */
export function parseFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---')) {
    return { data: {}, body: normalized, hasFrontmatter: false }
  }
  const end = normalized.indexOf('\n---', 3)
  if (end < 0) return { data: {}, body: normalized, hasFrontmatter: false }
  const block = normalized.slice(3, end)
  const data = {}
  let currentKey
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line)
    if (match !== null) {
      currentKey = match[1]
      data[currentKey] = stripQuotes(match[2])
      continue
    }
    // A folded/scalar continuation line. The corpus never needs block scalars,
    // so appending keeps a stray wrapped description readable instead of lost.
    if (currentKey !== undefined && /^[ \t]+\S/.test(rawLine)) {
      data[currentKey] = `${data[currentKey]} ${line.trim()}`.trim()
    }
  }
  const bodyStart = normalized.indexOf('\n', end + 1)
  return {
    data,
    body: bodyStart < 0 ? '' : normalized.slice(bodyStart + 1),
    hasFrontmatter: true,
  }
}

/** Strip one layer of matching single or double quotes from a scalar. */
function stripQuotes(value) {
  const text = value.trim()
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1)
    }
  }
  return text
}

/**
 * Split a comma-separated frontmatter list (`tools: WebFetch, Read`).
 * @param {string | undefined} value - the raw scalar.
 * @returns {string[]} trimmed, non-empty items.
 */
export function parseList(value) {
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}
