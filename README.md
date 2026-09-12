# dsh-agency-agents

把 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 的 **277 位中文专家角色**接入 DeepSeek Harness：
主代理按需检索、以角色人设启动子代理、按 NEXUS 剧本编排多智能体协作。

- **不是 277 个插件行**。角色是数据，调度是代码：一次委托注入一份人设，父子代理身份互不污染。
- **完整角色正文不进父会话**。父代理只付出一份常驻目录（`depts` 档约 1.4 K 字符）加几次检索。
- **自带编排剧本**。仓库里的 NEXUS 运营手册（7 阶段、6 道门禁、交接模板、角色激活提示词）按需加载。

---

## 它给主代理装了什么

| 工具 | 作用 | 成本 |
|---|---|---|
| `agency_list` | 列部门 / 列某部门的角色清单 | 一次工具往返 |
| `agency_find` | 按需求描述检索最合适的专家，返回候选与命中理由 | 一次工具往返 |
| `agency_brief` | 看某位角色的职责概要（不产生子代理） | 一次工具往返 |
| `agency_run` | **以某位专家的人设启动一个子代理**执行任务 | 一份角色正文（中位 6 K 字符）+ 一次推理 |
| `agency_team` | 一次并发委托多位互不依赖的专家并汇总 | N 份角色正文 |
| `agency_playbook` | 按需加载编排剧本（阶段流程 / 门禁 / 交接模板 / 编队脚本） | 0.5–24 K 字符 |

外加一段常驻系统提示：专家目录（四档可调）+ 编排守则（何时编队、三级规模、状态外置、3 次重试与升级、自主的边界）。

### 设置里的「专家团」页

安装后，**设置 → 专家团** 会多出一页（Client half，`dsh.client` 声明的浏览器包）：

- **专家名录**：277 位专家按 20 个部门分组，带 emoji、中文名、角色 id、一句话职责；支持关键词搜索与部门筛选；点角色 id 可复制。
- **编队剧本**：NEXUS 手册里真实部署过的 14 套编队（定向任务 Micro 配置、阶段门禁守门人、阶段 3 四条并行轨道、评审加固、高频单点专家），每套给出适用场景、成员分工与守门人；点成员名直接跳到名录里查这位专家。

页面是**只读**的：没有可配置项，因此不会与"模型实际能调用什么"脱节。数据由构建时**内联进 bundle**（构建脚本读的就是 Host 索引的同一份语料），页面因此不需要任何 RPC —— 常驻客户端包用不了动态 runner 的 `host.call`，而注册 remote 服务属于 host 组合的改动，超出这个插件该动的范围。

> 注意：这一页是**安装后**才有的常驻能力。当前会话里我另外挂了一个临时动态 Package 做预览，它需要你在 Run 卡片上批准；两者互不影响，你也可以直接拒绝它、改用安装路径。

### 为什么"以角色人设启动子代理"能成立

DSH 的 `subagents` 服务在启动请求上就带 `persona` 字段。in-process provider 在子代理的创建窗口里把它注册成**子代理自己 scope 上的 `deployment:persona-prefix` 段** —— 只影响该子代理，父代理和兄弟代理都看不见。于是：

```
父代理 → agency_run(employee: "代码审查员", task: "…")
       → subagents.start("spawn", { persona: <角色正文>, prompt: <任务>, parent, signal, maxDepth, … })
       → 子代理以「代码审查员」的身份、流程与交付标准完成，父代理只收到结论
```

这也解释了两条硬约束：

- **只支持 in-process provider**（`spawn` / `fork`）。进程外 provider 声明 `NO_START_CAPABILITIES`（五项能力全 false），DSH 会在启动前直接拒绝 —— 挂载时就会 fail loud，不会静默退化成"通用子代理"。
- **必须做模板中和**。角色正文是第三方内容，9 个文件里含 `${{ secrets.GITHUB_TOKEN }}`、`{{ $labels.instance }}` 这类字面量；DSH 的人设是严格插值模板，未注册变量会让该子代理的 prompt 组装**直接抛错**。插件在注入前把 `{{` 中和为含零宽空格的 `{{`（渲染视觉一致，token 不再可识别），并在测试里对全部 277 个角色逐个校验。

---

## 安装

插件是 host 平面的一行组合，不是预设的一部分 —— 它不发布任何服务，因此不需要 `isolate` realm，也不会在第二个会话挂载时冲突。

**直接从 GitHub 装**（`dsh plugin --profile <name> add` 的 spec 就是 pnpm 的 spec）：

```sh
# 默认分支的最新提交
dsh plugin --profile web add github:kaijia323/dsh-agency-agents

# 或钉住某个 tag / commit（生产环境推荐，升级变成显式动作）
dsh plugin --profile web add github:kaijia323/dsh-agency-agents#v0.1.4

# SSH（私有 fork、或 HTTPS 被限流的网络）
dsh plugin --profile web add git+ssh://git@github.com/kaijia323/dsh-agency-agents.git

# 本地开发：见下方「本地开发」一节（不能直接 add 仓库路径）
```

pnpm 会把 `github:` 解析成 `codeload.github.com` 上的 tarball 并**锁到具体 commit**（`pnpm-lock.yaml` 里能看到完整 sha），所以"装一次"是可复现的。仓库 tarball 包含全部源码、`cordis.patch.yml` 与 277 角色快照（约 1.5 MB 压缩后），不受 `files` 白名单影响。

装完**重启 Profile** 即生效，不需要再改任何配置：本包自带 `dsh.bundle.patch`（`cordis.patch.yml`），profile 会把它作为一层补丁自动应用，行是启用的 —— 不是注释掉的模板。你会得到：七个专家工具、常驻目录提示段、以及设置里的「专家团」页。

安装过程做过端到端验证（复刻 DSH 的 `nodeLinker: hoisted` 布局）：`add` 之后 profile 的 `package.json` 会同时得到依赖与本层登记 ——

```json
{ "dependencies": { "dsh-agency-agents": "github:kaijia323/dsh-agency-agents" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-agency-agents"] } } }
```

`@deepseek-ai/*` 这组 peer 依赖从 profile 共享的 `node_modules` 解析得到，不需要本包含任何运行时依赖。

升级与卸载：

```sh
dsh plugin --profile web update dsh-agency-agents     # 按 spec 拉最新（钉了 tag 则不动）
dsh plugin --profile web remove dsh-agency-agents     # 工具、提示段、设置页一起撤下
```

要改行为就覆盖配置（bundle 补丁的 `insert` 行还可以被 profile 自己的补丁层按 id 定向覆盖）；要临时停用就加 `disabled: true`：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml —— 可选，只写你要改的部分
- id: agency-agents
  config:
    catalog: { mode: depts }        # off | depts | compact | full
    delegation: { defaultWait: true }
# 或
- id: agency-agents
  disabled: true
```

宿主组合里已有的 `subagent` / `subagent-spawn-in-process` / `tool-jobs` 行保持不变即可。

`dsh.client` 声明了浏览器包，所以「专家团」页随同一行一起上架。

客户端入口是**生成物** `lib/client.js`（由 `src/client.js` + `tools/build-client.mjs` 生成，`npm run build:client`）。这不是打包偏好，而是硬契约：宿主把每个客户端插件当 **classic script** 加载，脚本必须自注册 ——

```js
window.__ModuleLoader__.load({ id: "…", factory: (require) => { … return module.exports } })
```

且返回的 exports 要带 Cordis 插件形状（`apply`、`inject`）。裸 ESM 能正常求值却**什么都不注册**，宿主会报 `loaded without registering "…" via __ModuleLoader__.load`，并连带把同一条 combo 里所有内建 UI 插件一起弄挂 —— 整个设置面板消失。我们**正好踩过这个坑**（v0.1.1），所以 `test/client-bundle.test.js` 会在沙箱里真实执行生成物，断言它完成注册、`apply` 把页面挂进 `settings.section`。

另外三条同样是实测踩出来的契约，测试逐个断言：

- **React 走模块表**：工厂里 `require("react")`。runner 只把 `React` 注入**动态**半区，常驻 bundle 里当全局读会抛 `React is not defined`。
- **`inject` 必须声明 `slots`**：否则 `apply` 可能在 slot 系统挂载前就跑，静默什么都不注册。
- **没有 `host.call`**：那是动态 runner 的私有 RPC，常驻客户端包够不着 —— 所以数据构建时内联。

样式由页面自己用 `document` 注入并随卸载移除（bundle 里也没有 `styles` builtin）。

### 本地开发

**不要**用 `dsh plugin --profile web add /path/to/repo` 或软链接来跑本仓库，它一定起不来：

```
Cannot find package '@deepseek-ai/dsh-tools' imported from /path/to/repo/src/index.js
```

原因是 Node 会对软链接做 realpath：解析基准变成仓库真实路径，而 `@deepseek-ai/*` 这组 peer 只存在于 profile 共享的 `node_modules`，
从仓库路径向上找不到。pnpm 的 `github:` / tarball 安装之所以正常，是因为它把包**拷贝**进 profile 的 `node_modules`（不软链），解析基准就落在 profile 里。

所以本地改完要试跑，用拷贝：

```sh
P=~/.dsh/profiles/web/node_modules/dsh-agency-agents
rm -rf "$P" && mkdir -p "$P"
cp -r src data cordis.patch.yml package.json "$P/"
dsh web --port 0 --no-open     # 只启动、不占 3080，验证装配
```

`npm test` 不需要部署：测试通过 loader hook 把 `@deepseek-ai/dsh-tools` 换成内存桩（见 `test/stub-harness.mjs`）。

### 配置项

| 键 | 默认 | 说明 |
|---|---|---|
| `roster.source` | `builtin` | `builtin` 用随包快照；`external` 读 `roster.root` 指向的上游检出路 |
| `roster.root` | — | `external` 时必填 |
| `roster.nameAliases` | 内置 2 条 | 剧本用的角色名 → 角色 id |
| `roster.skipDepartments` | `[]` | 不暴露的部门 |
| `catalog.mode` | `compact` | `off` / `depts`(≈2.1 K) / `compact`(≈13.5 K) / `full`(≈26.4 K) 字符 |
| `catalog.departments` | 全部 | 只常驻这些部门的清单 |
| `catalog.includeOrchestration` | `true` | 是否常驻编排守则 |
| `catalog.sectionOrder` | `2810` | 提示段序号（紧接 `TOOL_SUBAGENT: 2800`） |
| `delegation.provider` | `spawn` | 必须是声明了 `persona` 能力的 provider |
| `delegation.defaultMaxDepth` | `1` | 子代理递归深度上限 |
| `delegation.defaultWait` | `false` | `agency_run` 默认后台还是前台 |
| `delegation.maxTeamSize` | `6` | `agency_team` 一次最多并发几位 |
| `delegation.requirePersonaCapability` | `true` | provider 不支持 persona 时让挂载失败 |
| `playbook.enabled` / `maxChars` | `true` / `24000` | 是否提供剧本工具、单次返回上限 |
| `tools.*` | `agency_*` | 六个工具名，可整体改名 |

---

## 编排：主代理如何自主判断

### 触发：插件不劫持路由，主代理按门禁自己判断

这是装完之后最容易困惑的一点，值得先说清楚：**插件不会在"普通聊天"里自动弹出专家**。它只做两件事 ——

1. 往系统提示里挂一段常驻目录（277 个角色名 + 编排守则）；
2. 注册 6 个工具。

至于"这一轮到底该不该叫专家"，完全是主代理读了提示词之后的判断。所以**提示词怎么写，决定了它会不会被用**，而不是装没装。

v0.1.3 及更早的写法是这样的：

> 门槛：只有当 2 个以上不同专业视角、且各交付物能独立验收时**才**编排。单一实现或单一查询类任务**直接自己做**……不要为小事开会。

两个条件同时满足才动手，于是"默认自己做完"成了主代理的行为基线 —— 装了但看不见，属于设计缺陷，不是安装问题。v0.1.4 起改成**门禁**式写法：

| 位置 | 内容 |
|---|---|
| 路由门禁 | 「接到需求先做一次判断：这属于哪个专业领域？」→ 拿不准先 `agency_find`，已知角色直接 `agency_run`。并明确「判断的时机是**动手之前**，不是做完之后」 |
| 门槛（单点专家） | 需要专业判断 / 行业标准 / 专业交付物（审查报告、合规清单、评估结论、方案设计）→ 委托一位对口专家 |
| 门槛（多人编队） | 2 个以上专业视角、交付物能分别验收 → 才升级成编队 |
| 典型路由 | 7 条"请求形状 → 角色 id"示例，给模型最省力的模仿路径 |

尺度由你调：想要更克制，把 `catalog.mode` 降到 `depts`（约 2.1 K，只留部门名和守则）；完全不想常驻，设 `off`，主代理就必须先调 `agency_list` 才知道有哪些专家。代价是触发率随之下降 —— 常驻目录本身就是触发的一部分。

### `/agency-agents`：手动、确定性的入口

自动触发取决于模型的判断，而判断会有波动。**你已经知道要谁的时候，不该再赌它认不认。** 命令就是这条确定的路 —— 在输入框敲 `/` 会出现在斜杠菜单里：

| 输入 | 行为 |
|---|---|
| `/agency-agents` | 列出 20 个部门与人数、14 套编队剧本、用法。纯 UI 输出，**不调用模型** |
| `/agency-agents 找 数据库慢查询` | 走 `agency_find` 同一套排序，返回候选角色 id + 命中理由。纯 UI 输出 |
| `/agency-agents 用 engineering-code-reviewer 审查 auth.ts 的会话校验` | **把任务交给主代理**：提交一条指明该专家与 `agency_run` 的用户消息，本轮直接按"人已经选定专家"执行 |

第三条是关键：命令本身**不启动子代理**，它只把"用谁"这个决定固定下来，然后把任务交给主代理 —— 任务框定、验收标准、前台还是后台仍由主代理负责。分工是：**人选专家，主代理干活。**

委托指令是**约束式**的（"必须调用 `agency_run`…不要自己动手"），不是请求式的。这不是语气问题：最初的措辞是"请把这件事交给专家…"，实测中模型把它当建议，转头自己去读文件写报告了 —— 用户反馈的"命令没起子代理"就是这个原因。

### 折叠行：命令结果只有第一行一定会被看到

聊天壳把命令结果渲染成一个**可折叠的单行行**：只有第一行默认可见，其余要展开（点那一行）才显示。这直接决定了结果怎么排版 ——

> 首行不能是标题，必须是结论。

所以三种输出都以"完整可用的一句话"开头：

```
277 位专家 · 20 个部门 · 14 套编队。检索：`/agency-agents 找 <需求>`；委托：`/agency-agents 用 <角色> <任务>`。
最匹配「数据库慢查询」的是 `engineering-database-optimizer`（数据库优化师），共 8 个候选：
```

列表和详情跟在后面供展开。另外：**`/agency-agents` 与 `找` 不触发模型回合**（零成本、即时），`用` 才触发 —— 这也是为什么前两者的可见性完全依赖首行，而后者还会跟着一整轮对话输出。

细节：

- 角色名支持 id 和中文名（`/agency-agents 用 代码审查员 …`），和 `agency_run` 的 `employee` 规则一致；查不到时直接报错，**不会把坏指令发给模型**。
- **可以带附件**（截图、日志文件），附件原样转交给主代理。文件块由请求装配投影成"文件名 + 字节数 + 只读路径"的句柄文本；图片块在模型不支持读图时自动换成稳定的占位文本 —— 这个能力判断属于 harness 的请求装配，插件不去猜模型能不能读图。所以「一张截图 + 一句话」就能派专家，而这恰好是最自然的 bug 描述方式。
- 只认 `找` / `用` 两个前缀且必须跟空格，其余输入一律当检索词 —— 敲 `/agency-agents 帮我审代码` 会给你候选，而不是甩一条用法错误。
- 命令名必须是小写 ASCII（注册表的命名规则），所以是 `/agency-agents` 而不是 `/专家团`。
- 没有 `commands` 注册表的极简 composition 不会因此挂掉：命令那一路用 `ctx.inject` 挂载，注册表缺席时该子 fiber 永不激活，其余功能照常。

**命令不是自动触发的替代品**：门禁让主代理在该用的时候自己想到专家库，命令让你在不想等它判断时直接点将。两条路并存。

**已知的框架行为**：命令结果写入会话后，客户端不会主动重绘 —— `CommandRuntime.appendLifecycle` 的注释写明 *no flush is forced*。也就是说结果卡片可能要等到下一次交互（发下一条消息）才被刷新出来。`用` 模式不受影响，因为它必然唤醒一个模型回合；`/agency-agents` 与 `找` 是静默的，所以**首行必须自洽**这条设计约束不能违反。

### 剧本：编排最难自创的部分已经写好了

仓库里的 `strategy/` 是一套完整的运营手册（约 165 K 字符），它把编排最难自创的部分都写死了：

- **七阶段流水线 + 6 道门禁**：每道门禁有守门人角色与通过标准（发现门禁→高管摘要师，生产门禁→现实检验者"唯一权威"……）。主代理只需"跑守门人 → 读结论 → 达标才推进"。
- **开发-测试循环已是伪代码**：`PASS → 下一任务`；`FAIL 且重试 < 3 → 带反馈回到开发者`；`重试 ≥ 3 → 升级`。角色文件 `specialized/agents-orchestrator.md` 把它写成了状态机。
- **三级编队**：定向任务 3–5 位、功能/MVP 15–25 位、企业级全流程。Micro 的常见组合也已给出（`修 Bug：后端架构师 → API 测试员 → 证据收集者`）。
- **交接与升级模板**：7 套结构化交接文档，含"QA 不通过反馈"与"升级报告（重试 3/3 用尽）"。
- **任务类型 → 角色分配矩阵**（14 行）：`agency_find` 的首选推荐源。

落地方式（`agency_playbook` 按需加载，不常驻）：

| 执行体 | 用在哪 |
|---|---|
| 主代理逐轮（`todo_write` + 多次 `agency_run`） | 默认。跨阶段、要过门禁、要与人确认 |
| `agency_team` | 同一阶段内的并行轨道（多视角并行、四条构建轨道） |
| `workflow`（DSH 原生） | 阶段内**同质**大批量；注意它**不支持 persona**，不要用它做需要专家身份的编排 |

**状态外置**是长流程的关键：编排产物写到 `.agency/<项目>/`（`PIPELINE-STATUS.md`、任务清单、每任务的实现与 QA 证据、`handoffs/`、`escalations/`），主代理每轮只读状态摘要，上下文不随流程长度增长。

**自主的边界**：机械门禁（清单勾满、测试通过）自己判；判断门禁（是否生产就绪、范围变更、3 次重试后的处置）由守门人角色给结论后提级给人。

---

## 客户端页面为什么需要一个"生成步骤"

如果你要改「专家团」页，先读这段，它省下的是我踩过的三类坑。常驻客户端包有三条硬契约，全部由 `tools/build-client.mjs` 生成的包裹层满足，`test/client-bundle.test.js` 会在沙箱里**执行生成物**逐条断言：

| 契约 | 违反后的现象 |
|---|---|
| 必须是 **classic script 并自注册**（`window.__ModuleLoader__.load({ id, factory })`），导出带 `apply`/`inject` 的插件形状 | 脚本能求值但什么都不注册；宿主报 `loaded without registering`，**同一条 combo 里所有客户端插件一起挂**，整个设置面板消失 |
| **React 走工厂的 `require`** | runner 只把 `React` 注入**动态**半区；常驻 bundle 里当全局读 → 插槽内抛 `React is not defined` |
| **`inject` 必须含 `slots`** | shell 在插件加载时立刻调用 `apply`，可能早于 slot 系统 → 静默什么都不注册（连报错都没有） |

还有一条不是契约但是事实：**没有 `host.call`**。那是动态 runner 的私有 RPC，常驻客户端包够不着；要用 RPC 就得在 host 组合里注册一个 remote 服务 —— 为一个只读目录页不值得，所以花名册在构建时内联进 bundle（约 69 KB JSON）。

## 已知限制

1. **只支持 in-process provider**（`spawn` / `fork`）。进程外 provider 无法兑现 persona。
2. **角色正文的工具名是外部工具的**（WebFetch / Read / Write…）。插件在每个子代理人设前注入一段"运行环境适配"，做名称映射；角色正文本身不改写。
3. **`agency_team` 不做依赖排序**。互有依赖的任务请用多次 `agency_run` 按顺序推进 —— 一次调用只表达"这些可以同时开工"。
4. **目录是静态的**。`catalog.mode: full` 会把 26 K 字符常驻上下文；换角色库需要重新挂载。
5. **不提供 continuable 子代理**（可追问、可打断）。`agency_run` 是 one-shot 或后台任务；DSH 原生的 `subagent` 工具仍可用于需要续聊的场景。
6. **「专家团」页只读**。想看/选专家可以，但仍然没有"在这里点一下就让主代理去用"的入口 —— 委托仍由主代理自主决定，这符合本插件的定位。
7. **编队是推荐而非约束**。`SQUADS` 只告诉模型"手册里这套组合是验证过的"，它仍可自由点名任何一位专家；`agency_team` 也不做依赖排序。
8. **必须用拷贝式安装**（`github:` / tarball / 真 npm 包）。软链或仓库路径直接 `add` 会因为 peer 解析不到而启动失败，原因见「本地开发」。
9. **PTC 模式下 `max_depth` 容易踩坑**。PTC 的 `run_code` 本身就是一层委派，所以里层的 `agency_run` 拿到的深度上限必须是 ≥ 1。`max_depth` 校验的是**子代理的绝对深度**（`父深度 + 1`），不是子代理自身的递归预算 —— 传 `0` 永远不可能成立，实测报错是 `subagent depth 1 exceeds maxDepth 0`，读起来像在怪父代理的深度，模型曾据此误判成"0 表示专家不许再派子代理"。v0.1.5 起在组装子代理**之前**就拒掉 `0`，并说明这个参数真正控制什么；不填 `max_depth` 才是常规路径。想让专家还能再往下派人，把 `delegation.defaultMaxDepth` 调大即可。

---

## 开发

```sh
npm test               # 97 项断言：解析 / 索引 / 目录 / 转义 / 剧本 / 编队 / 委派 / 插件装配 / 设置页数据
node tools/audit.mjs   # 语料与成本的实测报告（角色数、目录开销、需转义的文件、剧本清单）
node tools/vendor.mjs --from <checkout|git URL>   # 刷新随包快照并更新 data/VENDOR.md
npm run emit-eval      # 重新生成 tmp/agency-core.mjs（会话内验证用，不随包发布）
npm run build:client   # 由 src/client.js + 语料生成 lib/client.js（改完客户端页面必须跑）
```

目录结构：

```
src/frontmatter.js   语料 frontmatter 的最小解析器
src/io.js            文件访问抽象：Node fs 与 harness fs 服务两种后端
src/roster.js        角色索引：扫描、解析、按 id/中文名/别名解析、检索打分
src/catalog.js       目录渲染（四档）+ 编排守则
src/persona.js       人设合成：模板中和、环境适配头、任务提示词、简报
src/playbook.js      剧本注册表与按需加载（含按标题抽取小节）
src/delegation.js    子代理启动、结算、后台任务、并行
src/tools.js         六个模型可见工具
src/index.js         配置解析与 apply（组合装配）
```

### 两个必须保留的设计决定

- `src/persona.js` 的模板中和是**承重**的，不是防御性代码：去掉它，9 个角色会在 prompt 组装时抛错。`test/persona.test.js` 内联了 harness 插值器的扫描逻辑，对全部 277 个角色逐个断言。
- `src/playbook.js` 抽小节时必须**跳过围栏代码块**：手册自己的示例是 shell/YAML 片段，其注释行以 `#` 开头，当成标题会把每个含示例的小节截断。

## 许可

本插件代码 MIT（见根目录 `LICENSE`）。

`data/agency-agents-zh/` 是上游 [agency-agents-zh](https://github.com/jnMetaCode/agency-agents-zh) 的 MIT 内容快照：
上游 `LICENSE` 随内容保留在 `data/agency-agents-zh/LICENSE`，来源与 commit 记录在 `data/VENDOR.md`，
第三方内容的归属与再分发说明见 [`NOTICE`](NOTICE)。
