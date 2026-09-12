/**
 * Plugin wiring tests.
 *
 * These run the real `apply()` against a fake Cordis context and a fake
 * `subagents` service, so what is verified is the whole path a deployment
 * exercises: config validation → roster indexing from disk → tool registration →
 * prompt section registration → roster lookup → child start request.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { installHarnessStub } from './stub-harness.mjs'

installHarnessStub()

const { apply, resolveConfig } = await import('../src/index.js')

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)), 'data/agency-agents-zh')

/** A persona-capable `subagents` stub that records every start request. */
function fakeSubagents({ providers = ['spawn'], result } = {}) {
  const starts = []
  return {
    starts,
    list: () => providers,
    getProvider: (name) => (providers.includes(name) ? { name, capabilities: { persona: true } } : undefined),
    async start(name, request) {
      starts.push({ name, request })
      return {
        id: 'child-1',
        localAgent: undefined,
        result: Promise.resolve(result ?? { stopReason: 'completed', output: [{ type: 'text', text: '专家交付物' }] }),
        async dispose() {},
      }
    },
  }
}

/** A `jobs` stub whose producer can be settled by the test. */
function fakeJobs() {
  const jobs = new Map()
  return {
    jobs,
    start(spec) {
      const id = `subagent-${jobs.size + 1}`
      jobs.set(id, spec)
      return id
    },
  }
}

/** A minimal Cordis-shaped context for one mount. */
function fakeContext({ config = {}, subagents, jobs, agents = { id: 'parent-1' }, cwd = '/workspace', noCommands = false } = {}) {
  const registered = []
  const sections = []
  const effects = []
  const commands = []
  const services = {
    tools: { register: (tool) => { registered.push(tool) } },
    systemPrompt: { section: (section) => { sections.push(section) } },
    subagents,
    jobs,
    commands: { register: (definition) => { commands.push(definition); return () => {} } },
  }
  // A minimal composition omits the command registry entirely; the plugin must
  // then keep every other surface instead of failing to mount.
  if (noCommands) delete services.commands
  const ctx = {
    registered,
    sections,
    effects,
    commands,
    config,
    get(name) {
      return services[name]
    },
    effect(callback, label) {
      effects.push(label)
      return callback()
    },
    /**
     * The real `inject` mounts a child fiber once every named service exists; a
     * composition that omits one simply never runs the callback. Mirroring that
     * is what makes the "no command registry" degradation testable.
     */
    inject(names, callback) {
      const missing = names.filter((name) => services[name] === undefined)
      if (missing.length > 0) return undefined
      return callback(ctx)
    },
  }
  return { ctx, registered, sections, commands, effects, agents, cwd }
}

/** Build the caller object a tool execution receives. */
const execFor = (agent, cwd) => ({ agent: { ...agent, session: { header: { cwd } } }, signal: new AbortController().signal })

async function mount(options = {}) {
  const subagents = options.subagents ?? fakeSubagents()
  const jobs = options.jobs
  const harness = fakeContext({ config: options.config ?? {}, subagents, jobs, agents: options.agents, cwd: options.cwd, noCommands: options.noCommands })
  await apply(harness.ctx, { roster: { source: 'external', root: ROOT }, logRosterSummary: false, ...(options.config ?? {}) })
  const tool = (name) => harness.registered.find((entry) => entry.name === name)
  return { ...harness, subagents, jobs, tool }
}

// ── config resolution ──────────────────────────────────────────────────────

test('resolveConfig applies the designed defaults', () => {
  const config = resolveConfig()
  assert.equal(config.roster.source, 'builtin')
  assert.equal(config.catalog.mode, 'compact')
  assert.equal(config.catalog.sectionOrder, 2810)
  assert.equal(config.delegation.provider, 'spawn')
  assert.equal(config.delegation.defaultMaxDepth, 1, 'a delegated expert may not fan out by itself')
  assert.equal(config.delegation.defaultWait, false, 'background by default')
  assert.equal(config.tools.run, 'agency_run')
  assert.equal(config.playbook.enabled, true)
})

test('resolveConfig rejects values that would fail later', () => {
  assert.throws(() => resolveConfig({ roster: { source: 'elsewhere' } }), /roster\.source/)
  assert.throws(() => resolveConfig({ roster: { source: 'external' } }), /requires roster\.root/)
  assert.throws(() => resolveConfig({ catalog: { mode: 'huge' } }), /catalog\.mode/)
  assert.throws(() => resolveConfig({ delegation: { defaultMaxDepth: -1 } }), /defaultMaxDepth/)
  assert.throws(() => resolveConfig({ delegation: { maxTeamSize: 0 } }), /maxTeamSize/)
  assert.throws(() => resolveConfig({ tools: { run: 'same', team: 'same' } }), /distinct/)
})

test('resolveConfig carries deployment overrides through', () => {
  const config = resolveConfig({
    roster: { source: 'external', root: '/tmp/checkout', nameAliases: { 别名: 'engineering-code-reviewer' } },
    catalog: { mode: 'depts', departments: ['engineering'], includeOrchestration: false, sectionOrder: 3000 },
    delegation: { provider: 'fork', defaultMaxDepth: 0, defaultWait: true, maxTeamSize: 3 },
    playbook: { enabled: false, maxChars: 1000 },
    tools: { list: 'a', find: 'b', brief: 'c', run: 'd', team: 'e', playbook: 'f' },
  })
  assert.deepEqual(config.roster.root, '/tmp/checkout')
  assert.equal(config.catalog.mode, 'depts')
  assert.deepEqual(config.catalog.departments, ['engineering'])
  assert.equal(config.delegation.provider, 'fork')
  assert.equal(config.delegation.defaultMaxDepth, 0)
  assert.equal(config.playbook.enabled, false)
  assert.equal(config.tools.playbook, 'f')
})

// ── mounting ───────────────────────────────────────────────────────────────

test('apply indexes the corpus, registers every tool, and contributes one prompt section', async () => {
  const mounted = await mount()
  assert.deepEqual(
    mounted.registered.map((tool) => tool.name),
    ['agency_list', 'agency_find', 'agency_brief', 'agency_run', 'agency_team', 'agency_playbook'],
  )
  assert.equal(mounted.sections.length, 1)
  assert.equal(mounted.sections[0].name, 'agency-agents:catalog')
  assert.equal(mounted.sections[0].order, 2810)
  assert.equal(mounted.sections[0].text.includes('engineering-code-reviewer'), true)
  assert.equal(mounted.sections[0].text.includes('{{'), false, 'the section is template-safe')
  // Every registration belongs to the row's own fiber, so stopping the row
  // unwinds all of it. Naming them beats counting: a dropped label is the
  // failure mode that leaves a tool registered after the plugin is gone.
  assert.deepEqual(
    mounted.effects.slice().sort(),
    [
      ...['list', 'find', 'brief', 'run', 'team', 'playbook'].map((name) => `agency-agents:agency_${name}`),
      'agency-agents:catalog',
      'agency-agents:command',
    ].sort(),
  )
  assert.equal(mounted.commands.length, 1, 'the manual entry point registers with the rest')
})

test('catalog.mode off registers tools but contributes no resident text', async () => {
  const mounted = await mount({ config: { catalog: { mode: 'off' } } })
  assert.equal(mounted.sections.length, 0)
  assert.equal(mounted.registered.length, 6)
})

test('playbook.enabled false withdraws only that tool', async () => {
  const mounted = await mount({ config: { playbook: { enabled: false } } })
  assert.equal(mounted.registered.some((tool) => tool.name === 'agency_playbook'), false)
  assert.equal(mounted.registered.length, 5)
})

test('a provider that cannot carry a persona fails the mount outright', async () => {
  const subagents = { list: () => ['acp'], getProvider: () => ({ name: 'acp', capabilities: { persona: false } }) }
  await assert.rejects(
    mount({ subagents, config: { delegation: { provider: 'acp' } } }),
    /persona/,
  )
})

// ── roster tools ───────────────────────────────────────────────────────────

test('agency_list lists departments, then one department', async () => {
  const { tool } = await mount()
  const list = tool('agency_list')
  const departments = await list.execute({})
  assert.equal(departments.includes('engineering'), true)
  assert.equal(departments.includes('277'), true)
  const engineering = await list.execute({ department: 'engineering' })
  assert.equal(engineering.includes('engineering-code-reviewer'), true)
  const unknown = await list.execute({ department: 'nope' })
  assert.equal(unknown.includes('没有部门'), true)
})

test('agency_find explains its picks and says what to do next', async () => {
  const { tool } = await mount()
  const found = await tool('agency_find').execute({ need: '评审 Go 代码的正确性与安全问题' })
  assert.equal(found.includes('engineering-code-reviewer'), true)
  assert.equal(found.includes('命中理由'), true)
  assert.equal(found.includes('agency_run'), true)
})

test('agency_find admits when it has nothing', async () => {
  const { tool } = await mount()
  const found = await tool('agency_find').execute({ need: 'zzz-nonexistent-zzz' })
  assert.equal(found.includes('没有匹配'), true)
})

test('agency_brief describes a role without starting anything', async () => {
  const { tool, subagents } = await mount()
  const brief = await tool('agency_brief').execute({ employee: '代码审查员' })
  assert.equal(brief.includes('engineering-code-reviewer'), true)
  assert.equal(subagents.starts.length, 0, 'a brief never delegates')
})

test('an unknown employee is refused with the closest candidates', async () => {
  const { tool } = await mount()
  await assert.rejects(tool('agency_brief').execute({ employee: '架构师x' }), /找不到角色/)
})

test('an aliased playbook label resolves to the real role', async () => {
  const { tool } = await mount()
  const brief = await tool('agency_brief').execute({ employee: '高管摘要生成器' })
  assert.equal(brief.includes('support-executive-summary-generator'), true)
})

// ── delegation tools ───────────────────────────────────────────────────────

test('agency_run foreground starts a child whose persona is the role, and whose prompt is the task', async () => {
  const { tool, subagents } = await mount()
  const text = await tool('agency_run').execute(
    { employee: '代码审查员', task: '审查 src/a.go 的并发安全', wait: true, acceptance: '列出阻塞项' },
    execFor({ id: 'parent-1' }, '/workspace'),
  )
  assert.equal(text.includes('专家交付物'), true)
  assert.equal(subagents.starts.length, 1)
  const { name, request } = subagents.starts[0]
  assert.equal(name, 'spawn')
  assert.equal(request.parent.id, 'parent-1')
  assert.equal(request.maxDepth, 1, 'the configured depth cap reaches the start request')
  assert.equal(request.persona.includes('你是「代码审查员」'), true)
  assert.equal(request.persona.includes('代码审查员'), true)
  assert.equal(request.persona.includes('WebFetch→web_fetch'), true, 'persona carries the environment header')
  assert.equal(request.persona.includes('/workspace'), true, 'persona carries the working directory')
  assert.equal(request.prompt[0].type, 'text')
  assert.equal(request.prompt[0].text.includes('审查 src/a.go 的并发安全'), true)
  assert.equal(request.prompt[0].text.includes('列出阻塞项'), true)
  assert.equal(typeof request.signal?.aborted, 'boolean', 'caller cancellation is forwarded')
})

test('agency_run escapes a template-hostile role so assembly cannot fail', async () => {
  const { tool, subagents } = await mount()
  await tool('agency_run').execute({ employee: 'engineering-security-engineer', task: '审计', wait: true }, execFor({ id: 'p' }, '/w'))
  const persona = subagents.starts[0].request.persona
  assert.equal(persona.includes('{{'), false, 'no recognizable template token survives')
  assert.equal(persona.replace(/\u200B/g, '').includes('secrets.GITHUB_TOKEN'), true, 'the source text is still visible')
})

test('agency_run selected a role by id, by name, and by playbook alias', async () => {
  const { tool, subagents } = await mount()
  const exec = execFor({ id: 'p' }, '/w')
  await tool('agency_run').execute({ employee: 'engineering-code-reviewer', task: 'a', wait: true }, exec)
  await tool('agency_run').execute({ employee: '代码审查员', task: 'b', wait: true }, exec)
  await tool('agency_run').execute({ employee: '高管摘要生成器', task: 'c', wait: true }, exec)
  assert.equal(subagents.starts.length, 3)
  assert.match(subagents.starts[0].request.persona, /代码审查员/)
  assert.match(subagents.starts[1].request.persona, /代码审查员/)
  assert.match(subagents.starts[2].request.persona, /高管摘要师/)
})

test('agency_run forwards a model override, a depth override, and a structured-output schema', async () => {
  const { tool, subagents } = await mount()
  await tool('agency_run').execute(
    {
      employee: '代码审查员',
      task: 'x',
      wait: true,
      model: 'deepseek-chat',
      // ≥ 1: the cap describes the child's absolute depth, so 0 is refused.
      max_depth: 2,
      output_schema: { type: 'object', properties: { verdict: { type: 'string' } }, required: ['verdict'] },
    },
    execFor({ id: 'p' }, '/w'),
  )
  const request = subagents.starts[0].request
  assert.deepEqual(request.agentOptions, { model: 'deepseek-chat' })
  assert.equal(request.maxDepth, 2)
  assert.equal(request.outputSchema.type, 'object')
})

test('agency_run refuses max_depth 0 before composing any child', async () => {
  const { tool, subagents } = await mount()
  await assert.rejects(
    tool('agency_run').execute({ employee: '代码审查员', task: 'x', wait: true, max_depth: 0 }, execFor({ id: 'p' }, '/w')),
    /max_depth 0 cannot be honoured/,
  )
  assert.equal(subagents.starts.length, 0, 'no child is started for a call that cannot succeed')
})

test('agency_run defaults to the background and reports a collectable job id', async () => {
  const jobs = fakeJobs()
  const { tool, subagents } = await mount({ jobs })
  const text = await tool('agency_run').execute({ employee: '代码审查员', task: 'x' }, execFor({ id: 'p' }, '/w'))
  assert.equal(text.includes('后台执行'), true)
  assert.equal(text.includes('subagent-1'), true)
  assert.equal(jobs.jobs.size, 1)
  assert.equal(subagents.starts.length, 0, 'nothing starts until the job producer runs')
  const spec = jobs.jobs.get('subagent-1')
  assert.equal(spec.kind, 'subagent')
  assert.equal(spec.owner.id, 'p')
  const outcome = await spec.run().done
  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.output.includes('专家交付物'), true)
  assert.equal(subagents.starts.length, 1)
})

test('agency_run degrades to foreground and says so when no job registry is mounted', async () => {
  const { tool, subagents } = await mount()
  const text = await tool('agency_run').execute({ employee: '代码审查员', task: 'x' }, execFor({ id: 'p' }, '/w'))
  assert.equal(text.includes('后台任务能力不可用'), true)
  assert.equal(subagents.starts.length, 1)
})

test('agency_run refuses a direct (agentless) call instead of guessing a parent', async () => {
  const { tool } = await mount()
  await assert.rejects(tool('agency_run').execute({ employee: '代码审查员', task: 'x', wait: true }, {}), /需要一个调用方 Agent/)
})

test('agency_run reports an unresolvable employee with candidates', async () => {
  const { tool } = await mount()
  await assert.rejects(
    tool('agency_run').execute({ employee: '不存在的角色', task: 'x', wait: true }, execFor({ id: 'p' }, '/w')),
    /找不到角色/,
  )
})

test('agency_team runs the assignments concurrently and aggregates every outcome', async () => {
  const { tool, subagents } = await mount()
  const text = await tool('agency_team').execute(
    {
      assignments: [
        { employee: '代码审查员', task: '审查实现' },
        { employee: 'engineering-security-engineer', task: '审计安全' },
      ],
    },
    execFor({ id: 'p' }, '/w'),
  )
  assert.equal(text.includes('团队汇总（2 位专家，成功 2，未完成 0）'), true)
  assert.equal(text.includes('| 代码审查员 | engineering-code-reviewer | completed |'), true)
  assert.equal(subagents.starts.length, 2)
  assert.equal(subagents.starts.every((entry) => entry.request.persona.includes('## 运行环境适配')), true)
})

test('agency_team keeps a failed member visible without discarding the rest', async () => {
  let call = 0
  const subagents = {
    list: () => ['spawn'],
    getProvider: () => ({ name: 'spawn', capabilities: { persona: true } }),
    async start() {
      call += 1
      if (call === 1) throw new Error('该专家启动失败')
      return { id: 'child-ok', result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '另一位专家的结论' }] }), async dispose() {} }
    },
  }
  const { tool } = await mount({ subagents })
  const text = await tool('agency_team').execute(
    { assignments: [{ employee: '代码审查员', task: 'a' }, { employee: '定价分析师', task: 'b' }] },
    execFor({ id: 'p' }, '/w'),
  )
  assert.equal(text.includes('成功 1，未完成 1'), true)
  assert.equal(text.includes('该专家启动失败'), true)
  assert.equal(text.includes('另一位专家的结论'), true)
})

test('agency_team caps the fan-out and refuses an empty list', async () => {
  const { tool } = await mount({ config: { delegation: { maxTeamSize: 2 } } })
  const tooMany = await tool('agency_team').execute(
    { assignments: [{ employee: '代码审查员', task: 'a' }, { employee: '定价分析师', task: 'b' }, { employee: '数据科学家', task: 'c' }] },
    execFor({ id: 'p' }, '/w'),
  )
  assert.equal(tooMany.includes('一次最多并发 2 位专家'), true)
  assert.equal((await tool('agency_team').execute({ assignments: [] }, execFor({ id: 'p' }, '/w'))).includes('assignments 为空'), true)
})

test('agency_team can hand the whole squad to the job registry', async () => {
  const jobs = fakeJobs()
  const { tool } = await mount({ jobs })
  const text = await tool('agency_team').execute(
    { assignments: [{ employee: '代码审查员', task: 'a' }, { employee: '定价分析师', task: 'b' }], wait: false },
    execFor({ id: 'p' }, '/w'),
  )
  assert.equal(jobs.jobs.size, 2)
  assert.equal(text.includes('subagent-1'), true)
  assert.equal(text.includes('subagent-2'), true)
})

// ── playbook tool ──────────────────────────────────────────────────────────

test('agency_playbook loads a phase, a gate extract, and a squad script', async () => {
  const { tool } = await mount()
  const playbook = tool('agency_playbook')
  const phase = await playbook.execute({ topic: 'phase-3' })
  assert.equal(phase.includes('开发-测试循环'), true)
  assert.equal(phase.includes('{{'), false)
  const gates = await playbook.execute({ topic: 'gates' })
  assert.equal(gates.includes('门禁总览'), true)
  const micro = await playbook.execute({ topic: 'micro-bugfix' })
  assert.equal(micro.includes('NEXUS-Micro'), true)
})

test('agency_playbook lists the options for an unknown topic', async () => {
  const { tool } = await mount()
  const text = await tool('agency_playbook').execute({ topic: '完全不存在' })
  assert.equal(text.includes('没有剧本'), true)
  assert.equal(text.includes('phase-3'), true)
})

// ── tool naming ────────────────────────────────────────────────────────────

test('renamed tools rename themselves in the registered rows and the catalog', async () => {
  const mounted = await mount({
    config: { tools: { list: 'team_list', find: 'team_find', brief: 'team_brief', run: 'team_run', team: 'team_team', playbook: 'team_playbook' } },
  })
  assert.deepEqual(
    mounted.registered.map((tool) => tool.name),
    ['team_list', 'team_find', 'team_brief', 'team_run', 'team_team', 'team_playbook'],
  )
  assert.equal(mounted.sections[0].text.includes('team_run'), true)
})
