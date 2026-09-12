/**
 * Turning a role file into a child agent's persona.
 *
 * Two jobs live here, and the first one is the reason this module exists:
 *
 * 1. **Template neutralization.** A role body is third-party prose, and some of
 *    it contains literal `{{ … }}` — GitHub Actions expressions such as
 *    `${{ secrets.GITHUB_TOKEN }}`, Prometheus templates such as
 *    `{{ $labels.instance }}`, Jinja/Twig samples. The harness prompt engine
 *    treats `{{` as the start of a variable reference and **throws** when the
 *    group after it is malformed or names an unregistered variable, which would
 *    make every delegation to one of those roles fail at prompt assembly. The
 *    engine's scanner is `/^\{\{([^{}]*)\}\}/` followed by
 *    `/^[a-z][a-z0-9_]*$/`, so insetting a zero-width space between the braces
 *    makes the token unrecognizable while leaving the rendered text visually
 *    identical (the character occupies no width).
 * 2. **Environment adaptation.** Role bodies were written for Claude Code and
 *    other tools, so they name tools this harness does not have. A short header
 *    maps those names onto the real ones; without it a child confidently plans
 *    to call tools it does not own.
 *
 * @module dsh-agency-agents/persona
 */

/** Invisible separator used to break the prompt engine's `{{` token. */
const ZERO_WIDTH_SPACE = '\u200B'

/**
 * Neutralize `{{` so the prompt engine cannot read it as a variable reference.
 *
 * Idempotent: an already-broken token is left alone, so a persona may pass
 * through this function more than once. `}}` needs no handling — the scanner
 * only advances from a `{{` it recognizes.
 * @param {string} text - any text destined for a prompt section.
 * @returns {string} the same text with every `{{` neutralized.
 */
export function escapePromptText(text) {
  if (typeof text !== 'string' || !text.includes('{{')) return text
  return text.split('{{').join(`{${ZERO_WIDTH_SPACE}{`)
}

/**
 * Whether a text still contains a token the prompt engine would try to resolve.
 *
 * Exposed for tests and for a caller that wants to assert its own content is
 * safe before registering a section; the plugin itself relies on
 * {@link escapePromptText} being total.
 * @param {string} text - the text to inspect.
 * @returns {boolean} true when a recognizable `{{name}}` group remains.
 */
export function containsPromptVariable(text) {
  if (typeof text !== 'string') return false
  return /^\{\{([^{}]*)\}\}/.test(text.slice(text.indexOf('{{'))) && /\{\{[a-z][a-z0-9_]*\}\}/.test(text)
}

/**
 * The environment header prepended to every delegated persona.
 *
 * It is intentionally short: it must not dilute the role's own instructions,
 * and it states the two facts a delegated child cannot discover for itself —
 * which tools exist, and that it has no approval channel.
 * @param {{ cwd?: string }} [options] - optional working-directory note.
 * @returns {string} the header.
 */
export function environmentHeader(options = {}) {
  const lines = [
    '## 运行环境适配（DeepSeek Harness）',
    '',
    '你运行在 DeepSeek Harness 中。角色描述里出现的工具名请按以下映射理解，并使用本环境实际存在的工具：',
    'WebFetch→web_fetch，WebSearch→web_search，Read→read，Write→write，Edit→edit，Grep→grep，Glob→glob，Bash→bash，Task/Agent→subagent。',
    '角色描述中提到的"记忆""知识库""项目文档"由工作目录中的文件承担；请先读取相关文件再动手。',
    '你没有审批通道：不要请求人工确认，也不要执行需要授权的高风险操作；遇到这类事情就在交付物里明确报告。',
  ]
  if (typeof options.cwd === 'string' && options.cwd.length > 0) {
    lines.push(`你的工作目录与父代理相同：${options.cwd}`)
  }
  lines.push('', '---', '')
  return lines.join('\n')
}

/**
 * Compose the persona string handed to `subagents.start({ persona })`.
 * @param {object} role - the roster entry.
 * @param {{ cwd?: string, includeHeader?: boolean, extraInstructions?: string, body?: string }} [options] - composition options.
 * @returns {string} the persona text.
 */
export function buildPersona(role, options = {}) {
  const parts = []
  if (options.includeHeader !== false) parts.push(environmentHeader({ cwd: options.cwd }))
  const body = options.body ?? role.body
  parts.push(`# 你是「${role.name}」（${role.id} · ${role.department}）`, '', body.trim())
  if (typeof options.extraInstructions === 'string' && options.extraInstructions.trim().length > 0) {
    parts.push('', '## 本次委托的额外要求', '', options.extraInstructions.trim())
  }
  return escapePromptText(parts.join('\n'))
}

/**
 * Compose the task prompt for a delegated child.
 *
 * Kept separate from the persona because the two travel through different
 * channels: persona shapes identity, the prompt is the child's user message.
 * @param {object} role - the roster entry.
 * @param {string} task - the model-authored task.
 * @param {{ context?: string, acceptance?: string, deliverable?: string }} [options] - optional framing.
 * @returns {string} the prompt text.
 */
export function buildTaskPrompt(role, task, options = {}) {
  const lines = [`你是「${role.name}」。本任务由父代理委托，请以你的专业身份独立完成，不要复述角色设定。`, '', '## 任务', '', task.trim()]
  if (typeof options.context === 'string' && options.context.trim().length > 0) {
    lines.push('', '## 上下文', '', options.context.trim())
  }
  if (typeof options.acceptance === 'string' && options.acceptance.trim().length > 0) {
    lines.push('', '## 验收标准', '', options.acceptance.trim())
  }
  if (typeof options.deliverable === 'string' && options.deliverable.trim().length > 0) {
    lines.push('', '## 交付要求', '', options.deliverable.trim())
  }
  lines.push(
    '',
    '## 交付规则',
    '',
    '直接把最终交付物作为你的回复正文返回（父代理看不到你的中间步骤）。',
    '如果结论依赖证据，请给出可核对的证据（文件路径、命令输出摘要、截图说明）。',
    '如果你没能完成任务，直接说明卡在哪里，不要编造结果。',
  )
  return lines.join('\n')
}

/**
 * A role's short brief, for a cheap "who is this" lookup that costs no child
 * agent: the frontmatter summary plus the section headings of its body.
 * @param {object} role - the roster entry.
 * @param {{ maxHeadings?: number }} [options] - brief options.
 * @returns {string} the brief text.
 */
export function buildBrief(role, options = {}) {
  const max = options.maxHeadings ?? 12
  const headings = role.body
    .split('\n')
    .map((line) => /^(#{2,3})\s+(.+)$/.exec(line.trim()))
    .filter((match) => match !== null)
    .map((match) => match[2].replace(/[*`]/g, '').trim())
    .filter((heading, index, all) => all.indexOf(heading) === index)
    .slice(0, max)
  const lines = [`### ${role.name} · ${role.id}`, '', `部门：${role.department}`, `简介：${role.description || '(无)'}`]
  if (role.declaredTools.length > 0) lines.push(`角色声明使用的工具：${role.declaredTools.join(', ')}`)
  if (headings.length > 0) {
    lines.push('', '职责与流程要点：')
    for (const heading of headings) lines.push(`- ${heading}`)
  }
  const chars = role.body.length
  lines.push('', `角色正文 ${chars} 字符，委托时会作为该子代理的人设注入。`)
  return escapePromptText(lines.join('\n'))
}
