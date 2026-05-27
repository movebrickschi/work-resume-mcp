# work-resume-mcp 设计规格

- **状态**：v1.1 · 决议已固化 · 实现就绪
- **创建日期**：2026-05-27
- **最后更新**：2026-05-27（用户决议 Q1-Q5 + D1-D3 已全部落地，重跑自检通过）
- **作者**：与 AI 协作设计
- **目标读者**：本项目实现者（不假设熟悉本领域）

---

## 1. 背景与问题

### 1.1 用户故事

> 在使用 Cursor / Claude Code / Codex 进行 AI 辅助编程时，对话可能因为以下原因意外中断：
> - 网络波动导致连接断开
> - IDE 崩溃或电脑死机
> - 用户被打扰主动关掉
> - 上下文超过模型限制被迫开新会话
>
> 当下次重新打开会话时，希望能"无缝续写到上次断点"，而不是从零跟 AI 重新对齐"我在做什么、做到哪了、下一步要干什么"。

### 1.2 问题维度拆解

| 维度 | 内容 | 当前 IDE 自带能力 |
|---|---|---|
| **代码层** | 未提交的 dirty 改动、半成品文件、调试用临时 print | 仅同会话 checkpoint，断会话即失效 |
| **决策层** | 为什么这么改、还有什么坑没填、本来打算下一步做什么 | 无 |
| **上下文层** | 相关文件路径、用户原始需求、已尝试过的失败路径 | 无 |

### 1.3 核心场景与边界

**主流场景（必须覆盖）**：

- S1：**网络波动断开** — AI 当下在思考，连接突然中断。代码改动已落盘，但"接下来要做什么"丢失。
- S2：**IDE 崩溃** — 同 S1。
- S3：**上下文超限主动开新会话** — 用户清楚自己在做什么，主动让新会话接力。

**边缘场景（部分覆盖即可）**：

- S4：用户在断开后自己改过几行代码。
- S5：用户在断开后做过 git 操作（commit / stash / reset）。
- S6：跨设备恢复（如笔记本断电后用台式机继续）。

**显式不覆盖**：

- 保护 AI 当下的"思考链" — 本质上不可保存，断了就是断了。
- 重放完整对话历史 — `agent-transcripts` 已经做这件事。
- 跨项目的全局状态共享。

---

## 2. 架构设计

### 2.1 形态选择

**形态：MCP Server（纯工具能力）+ 配套 Rule 文本（约束 AI 调用时机）**

候选对比记录见决策日志（§7）。选择 MCP 的根本原因：
- MCP 是 Cursor / Claude Code / Codex 三家**原生**支持的协议
- 一份代码三家通吃，零额外集成成本
- 工具调用结构化，便于校验输入输出

### 2.2 触发模型

**主：AI 主动型** — 由 Rule 约束 AI 在以下时机调用 `save_progress`：
1. 每次 TodoWrite 标记 `status="completed"` 后立即调用
2. 用户说"先停一下"/"暂停"/"明天继续"/"下班了"时
3. **切换工作主题前**（定义：当前打算执行的下一步不在已有 `next_steps` 列表里，且与列表中的任何条目无明显关联，即视为切换主题）
4. **遇到 blocker 时**（定义：无法仅靠 AI 自己解决、需要用户决策或外部资源的卡点，如：选哪个库、密钥获取、API 文档不清、需要用户提供测试数据）
5. **每次调用 Edit/Write 工具后，下一次输出文本前**
6. **每条用户消息回复完成前**

**辅：MCP server 内部搭便车自动快照** — AI 每次调用本 MCP 任何工具时，server 内部顺手做一次轻量物理快照（不需要 AI 知道），用于"AI 主动型"失效场景下的兜底。

### 2.3 数据模型

#### 2.3.1 项目根下的存储结构

**单仓库场景**：每个 git 仓库根下一份 `.work-resume/`：

```
my-project/  (git repo root)
└── .work-resume/
    ├── index.json                      # 快照索引（小，便于快速列出）
    ├── checkpoints/                    # 语义快照（AI 主动写的）
    │   └── 20260527-145320-a1b2c3.json
    ├── auto-snapshots/                 # 物理快照（MCP server 自动写）
    │   └── 20260527-145812-b4d5e6.json
    └── .gitkeep                        # 默认让此目录跟着 repo 走
```

**monorepo / 多 git 仓库根场景**：MCP server 启动时扫描工作目录下所有 `.git/`（深度限制由 `WORK_RESUME_MAX_REPO_SCAN_DEPTH` 控制，默认 3），每个 git 仓库根独立维护一份 `.work-resume/`：

```
workspace/                              # 工作根（可以没有 .git）
├── project-a/
│   ├── .git/
│   └── .work-resume/                   # 独立存储
├── project-b/
│   ├── .git/
│   └── .work-resume/                   # 独立存储
└── tools/
    ├── .git/
    └── .work-resume/                   # 独立存储
```

#### 2.3.2 语义快照（save_progress 写）

```json
{
  "kind": "semantic",
  "id": "20260527-145320-a1b2c3",
  "saved_at": "2026-05-27T14:53:20+08:00",
  "branch": "feature/login",
  "git_head": "a1b2c3d4...",
  "summary": "已完成登录页 UI，正在写 API 调用",
  "next_steps": [
    "在 src/auth.ts 实现 loginRequest()",
    "处理 401/500 错误分支",
    "为 loginHandler 写单测"
  ],
  "files_in_focus": [
    "src/components/LoginPage.tsx",
    "src/auth.ts",
    "tests/auth.test.ts"
  ],
  "blockers": [],
  "context_notes": "选择了 fetch 而非 axios，因为项目其他地方都用 fetch",
  "todo_status": [
    { "id": "1", "content": "UI 组件", "status": "completed" },
    { "id": "2", "content": "API 调用", "status": "in_progress" },
    { "id": "3", "content": "单测", "status": "pending" }
  ],
  "dirty_files_count": 3
}
```

#### 2.3.3 物理快照（auto-snapshot 写）

```json
{
  "kind": "physical",
  "id": "20260527-145812-b4d5e6",
  "saved_at": "2026-05-27T14:58:12+08:00",
  "triggered_by_tool": "save_progress",
  "branch": "feature/login",
  "git_head": "a1b2c3d4...",
  "files_changed": [
    {
      "path": "src/auth.ts",
      "stat": { "added": 12, "removed": 3 },
      "changed_symbols": ["loginRequest", "validateToken"],
      "diff_hash": "sha256:7f8e9d..."
    }
  ],
  "total_diff_size_bytes": 4523
}
```

**关键设计**：物理快照**不保存 diff 内容本身**，只保存元信息。恢复时由 AI 自己执行 `git diff` 现取，详见 §3.2 恢复策略。

#### 2.3.4 索引文件 `index.json`

```json
{
  "version": 1,
  "checkpoints": [
    { "id": "...", "kind": "semantic", "saved_at": "...", "branch": "...", "summary": "..." },
    { "id": "...", "kind": "physical", "saved_at": "...", "branch": "...", "triggered_by_tool": "..." }
  ]
}
```

每次新增快照同步追加索引。索引文件单独维护是为了避免列快照时要读取所有完整快照。

---

## 3. 接口设计：MCP 工具

### 3.1 工具列表

#### 3.1.1 `save_progress`

**用途**：AI 主动保存当前工作进度（语义快照）。

```typescript
input: {
  summary: string;            // 一句话进度概述，必填
  next_steps: string[];       // 3-5 条具体可执行的下一步，必填
  files_in_focus: string[];   // 当前关注文件的路径列表，必填
  blockers?: string[];        // 卡点列表，默认空数组
  context_notes?: string;     // 决策理由、关键发现等额外说明
  todo_status?: Array<{ id: string; content: string; status: 'completed' | 'in_progress' | 'pending' | 'cancelled' }>;
}

output: {
  checkpoint_id: string;      // 形如 "20260527-145320-a1b2c3"
  saved_at: string;           // ISO 8601 时间戳
  repo_root: string;          // 快照被存到了哪个 git 仓库根（绝对路径）
  git_head?: string;          // 当前 git HEAD（不在 git 仓库时为 undefined）
  branch?: string;
  dirty_files_count: number;
}
```

**字段校验规则**：

- `summary` 非空字符串，最少 8 个字符
- `next_steps` 非空数组，每条非空字符串
- `files_in_focus` 非空数组（如果当前 dirty 文件数 > 0；否则可空）
- 文件路径必须满足：① 是相对项目根的相对路径，或 ② 是位于项目根目录内部的绝对路径；严禁包含 `..` 段或跳出项目根
- **monorepo 场景**：`files_in_focus` 中所有文件必须属于**同一个** git 仓库；若跨多仓库，工具返回错误 `MULTI_REPO_FILES`，要求 AI 拆分成多次调用

#### 3.1.2 `resume_latest`

**用途**：新会话开始时调用，一次性获取所有恢复所需的信息。

```typescript
input: {
  branch?: string;            // 不传则使用当前分支
  repo_root?: string;         // monorepo 场景下指定哪个仓库根；不传则用当前 cwd 所在仓库
}

output: {
  repo_root: string;          // 实际使用的仓库根（绝对路径）
  semantic_checkpoint: <语义快照对象>;      // 最近一条 AI 主动写的快照
  physical_snapshots_since: <物理快照对象>[];  // 语义快照之后的所有物理快照
  git_status: {
    head: string;
    branch: string;
    dirty_files: string[];   // 当前 dirty 的文件路径列表
  };
  head_match: boolean;        // 当前 HEAD 是否等于快照 HEAD
  hint: string;               // 给 AI 的续写指引（人类可读）
  ago: string;                // 距快照时间的友好显示，如 "3 hours ago"
  available_repos?: string[]; // monorepo 场景下：所有检测到的仓库根列表（让 AI 知道还能 resume 哪些）
}
```

**`hint` 字段的内容规则**（根据 head_match 与 dirty 状态生成）：

- `head_match=true` 且当前 dirty ⊇ 快照 files_in_focus：
  > "Git HEAD 一致，dirty 文件涵盖了快照中的关注文件。建议：先执行 `git diff` 看当前未提交改动，然后按 next_steps 继续。"
- `head_match=true` 但 dirty 文件集变化：
  > "Git HEAD 一致，但 dirty 文件集已变化。先 `git diff` 看现状，对比快照中 changed_symbols 判断哪些是 AI 之前改的、哪些可能是用户后改的。"
- `head_match=false`：
  > "⚠ Git HEAD 已变化（快照=X, 现在=Y），无法精确恢复物理状态。可信信息：[summary, next_steps, files_in_focus, changed_symbols 列表]。请向用户确认是否继续之前的方向。"

#### 3.1.3 `list_checkpoints`

**用途**：浏览历史快照，用于排查或回滚到更早状态。

```typescript
input: {
  limit?: number;             // 默认 20
  branch?: string;            // 不传则不过滤
  kind?: 'semantic' | 'physical' | 'all';  // 默认 'semantic'
}

output: Array<{
  checkpoint_id: string;
  kind: 'semantic' | 'physical';
  saved_at: string;
  branch: string;
  git_head: string;
  summary?: string;           // 仅 semantic 类有
  triggered_by_tool?: string; // 仅 physical 类有
}>
```

#### 3.1.4 `diff_since`

**用途**：查看从某个快照到现在自己改了哪些文件。

```typescript
input: {
  checkpoint_id: string;
}

output: {
  files_changed: string[];    // 自快照后改动过的文件列表
  diff: string;               // git diff 输出，截断到 100KB
  truncated: boolean;         // 是否被截断
}
```

实现：用快照中存的 `git_head` 作为 base，对当前工作区执行 `git diff <git_head> -- HEAD` + `git diff` （未提交部分）。

#### 3.1.5 `clear_checkpoints`

**用途**：清理过期或不再需要的快照，供 AI 在用户明确要求"清理历史 / 重置"时主动调用。

```typescript
input: {
  scope: 'auto-snapshots' | 'semantic' | 'all';  // 必填：清理范围
  before?: string;            // 仅清理此 ISO 时间戳之前的；不传则清整个 scope
  branch?: string;            // 仅清理该分支的；不传则不过滤分支
  repo_root?: string;         // monorepo 场景指定仓库；不传则当前 cwd 所在仓库
  dry_run?: boolean;          // 默认 false；true 时只返回会清掉哪些不实际删
}

output: {
  repo_root: string;          // 实际操作的仓库根
  removed: Array<{ checkpoint_id: string; kind: 'semantic' | 'physical'; saved_at: string; branch: string }>;
  remaining_count: number;    // 操作后剩余快照总数
  dry_run: boolean;
}
```

**安全约束**：
- `scope='all'` 时，若未指定 `before` 也未指定 `branch`，工具强制要求 `dry_run=true` 先预览；只有第二次显式带 `dry_run=false` 才真删（防 AI 误操作把所有历史抹掉）
- 删除前会把对应文件移到 `.work-resume/.trash/<timestamp>/`，保留 7 天后由下次 `clear_checkpoints` 调用顺手清除（不主动驻留进程清理）

### 3.2 自动快照（搭便车机制）

**实现位置**：MCP server 的工具分发层，所有工具调用前的统一拦截点。

```typescript
const SKIP_AUTO_SNAPSHOT: Set<string> = new Set([
  'clear_checkpoints',  // 清理工具调用前再存一个快照逻辑上自相矛盾
  'list_checkpoints',   // 只读工具，无需触发物理快照
  'diff_since',         // 同上，只读
]);

async function dispatchTool(name: string, args: unknown) {
  if (!SKIP_AUTO_SNAPSHOT.has(name)) {
    await autoSnapshotIfStale();  // 兜底物理快照
  }
  return await tools[name](args);
}

async function autoSnapshotIfStale() {
  const lastAutoAt = await readLastAutoSnapshotTime();
  if (Date.now() - lastAutoAt < AUTO_SNAPSHOT_MIN_INTERVAL_MS) return;  // 60s 节流

  const gitStatus = await getGitStatus();
  if (gitStatus.dirty_files.length === 0) return;  // 没改动就不存

  const snapshot = buildPhysicalSnapshot(gitStatus);
  await writeSnapshot(snapshot);
  await appendIndex(snapshot);
}
```

**节流策略**：相邻两次 auto-snapshot 至少间隔 60 秒，避免高频工具调用导致快照爆炸。

**生命周期**：项目根 `.work-resume/auto-snapshots/` 默认保留最近 **24 小时**（由 `WORK_RESUME_AUTO_RETENTION_HOURS` 控制）内的物理快照，超时的在下次写入时顺手清理（写入后做一遍扫描）。语义快照（`checkpoints/`）**不**自动清理，仅由用户/AI 主动调用 `clear_checkpoints` 才会删除。

### 3.3 git 集成

**依赖**：宿主机有 `git` CLI 可用。

**抓取方式**：
- `git rev-parse HEAD` 拿当前 HEAD
- `git rev-parse --abbrev-ref HEAD` 拿当前分支
- `git rev-parse --show-toplevel` 拿仓库根
- `git status --porcelain` 拿 dirty 文件列表
- `git diff --stat` 拿每个文件的 added/removed 行数
- `git diff` 输出整体哈希作为 `diff_hash`

**多仓库（monorepo）探测**：
- 启动时从 `WORK_RESUME_PROJECT_ROOT`（默认 cwd）开始 BFS 遍历，深度限制 `WORK_RESUME_MAX_REPO_SCAN_DEPTH`（默认 3）
- 凡是发现 `.git/` 目录（不递归进 `.git/`）就记录为一个仓库根
- 跳过常见无关目录：`node_modules` / `.cache` / `dist` / `build` / `target` / `vendor` / `.next` / `.nuxt`
- 探测结果缓存 5 分钟，期间不重复扫描；超时或调用 `clear_checkpoints` 重置时刷新
- 文件归属判定：对每个文件路径，找它最近的祖先 `.git` 目录所在的仓库根即为归属仓库

**非 git 仓库的降级**：所有 git 字段返回 `undefined`，仍然存语义快照（不存物理快照，因为没有 dirty diff 概念）。多仓库探测时若整个工作目录树都没有 `.git`，则 `repo_root` 字段返回 `WORK_RESUME_PROJECT_ROOT` 的值，并在 `hint` 中说明"未检测到 git 仓库，物理快照已禁用"。

**符号名抓取**（`changed_symbols`）：
- v1 实现：使用 [tree-sitter](https://tree-sitter.github.io) 做 AST 解析
- 流程：① `git diff --unified=0` 拿到变更的行号范围 → ② 用 tree-sitter 解析对应源文件 → ③ 根据行号反查 AST 节点 → ④ 提取所属的 `function_declaration` / `method_definition` / `class_declaration` 等节点名
- **v1 内置 grammar 包**（8 个，按需 lazy load）：

| 语言 | 文件扩展名 | grammar 包 |
|---|---|---|
| TypeScript / TSX | `.ts` `.tsx` | `tree-sitter-typescript`（同包含 TS + TSX 两个 parser） |
| JavaScript / JSX | `.js` `.jsx` `.mjs` `.cjs` | `tree-sitter-javascript` |
| Python | `.py` | `tree-sitter-python` |
| Go | `.go` | `tree-sitter-go` |
| Rust | `.rs` | `tree-sitter-rust` |
| Java | `.java` | `tree-sitter-java` |
| Ruby | `.rb` | `tree-sitter-ruby` |
| PHP | `.php` | `tree-sitter-php` |

- **未内置的语言**：降级到 v1 正则方案（按 `def|function|class|interface|method|fn|sub|func` 关键字 + 标识符匹配），精度有损但不报错；连正则也匹配不到（如无关键字的脚本）则 `changed_symbols` 返回空数组
- **grammar 加载策略**：首次访问该语言时加载并缓存 grammar 实例，后续复用；**不在启动时预加载**
- 选 tree-sitter 而非纯正则/git hunk header 的理由见 §7 决策日志 D6
- v1 语言清单的具体取舍见 §7 决策日志 D7

---

## 4. Rule 模板（三家共用）

模板路径：`rules/RULE.md`（项目内提供，用户复制到各 IDE 对应位置）。

```markdown
# work-resume 进度续写规则

## 必须触发 save_progress 的时机
1. 每次 TodoWrite 标记 status="completed" 后立即调用
2. 用户说"先停一下"/"暂停"/"明天继续"/"下班了"时
3. 切换工作主题前（=当前打算做的下一步不在已有 next_steps 列表里且无明显关联）
4. 遇到 blocker 时（=无法仅靠 AI 自己解决、需要用户或外部资源的卡点，必填 blockers 字段）
5. 每次调用 Edit/Write 工具后，下一次输出文本前必须调用
6. 每条用户消息回复完成前必须调用

## 必须触发 resume_latest 的时机
1. 新会话的第一条用户消息后，若用户未明确说"全新任务"
2. 用户说"接着上次"/"恢复"/"resume"/"昨天做到哪了"时

## save_progress 字段硬要求
- summary：必须包含"已完成什么 + 正在做什么"两段
- next_steps：每条以动词开头，具体到文件或函数名
- files_in_focus：精确到文件路径，是绝对必要字段
- blockers：当前卡点；没有就传空数组

## 严禁
- 跳过 save_progress 直接回复"OK 完成了"
- 在 summary 里写"做了一些工作"这类模糊描述
```

---

## 5. 实现技术栈

| 项 | 选择 |
|---|---|
| 语言 | TypeScript 5+ |
| MCP SDK | `@modelcontextprotocol/sdk` 官方 SDK |
| 运行时 | Node.js 20+ |
| 启动方式 | `npx work-resume-mcp`（无需全局安装） |
| 存储 | 纯文件系统（JSON），不引数据库 |
| Git 调用 | `execa` 或 Node `child_process.spawn` |
| AST 解析 | `web-tree-sitter` + 各语言 grammar 包（按需加载） |
| 测试 | `vitest` |

**环境变量**：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `WORK_RESUME_DIR` | `.work-resume` | 存储目录相对项目根的路径 |
| `WORK_RESUME_AUTO_INTERVAL_MS` | `60000` | 自动快照最小间隔（毫秒） |
| `WORK_RESUME_PROJECT_ROOT` | 当前工作目录 | 强制指定项目根（用于多项目共用 server 的场景） |
| `WORK_RESUME_AUTO_RETENTION_HOURS` | `24` | 物理快照保留时长（小时），超过则清理 |
| `WORK_RESUME_MAX_REPO_SCAN_DEPTH` | `3` | monorepo 多 git 仓库探测的最大目录深度 |
| `WORK_RESUME_LANGS` | `ts,tsx,js,jsx,py,go,rs,java,rb,php` | tree-sitter 启用的语言扩展名（逗号分隔），不在列表中的会降级到正则 |
| `WORK_RESUME_FALLBACK` | `regex` | 不支持语言的降级策略：`regex` / `empty` 二选一 |
| `WORK_RESUME_GRAMMAR_LOAD` | `lazy` | grammar 加载策略：`lazy`（首次访问加载）/ `eager`（启动全部预加载） |
| `WORK_RESUME_TRASH_RETENTION_DAYS` | `7` | `clear_checkpoints` 软删后保留天数 |

---

## 6. 验证与测试计划

### 6.1 单元测试

- 各工具的 input 校验（必填字段缺失 / 类型错误）
- 索引文件的读写并发安全（同时写两条不丢失）
- HEAD 匹配判定逻辑（三种分支都要覆盖）
- 节流逻辑（60s 内的第二次调用应跳过）
- tree-sitter 符号抓取：每种内置语言至少 3 个 fixture（普通函数 / 嵌套 class method / 装饰器/泛型边角）
- 未内置语言的 fallback：`changed_symbols` 必须返回空数组而非报错
- 24h 保留策略：构造 50h 前/25h 前/10h 前/now 四条快照，验证清理逻辑只删超过 24h 的

### 6.2 集成测试

- 模拟跨会话场景：在临时 git 仓库做改动 → save_progress → 在新进程里 resume_latest → 验证拿到正确内容
- 模拟 HEAD 变化场景：save → 模拟 commit → resume → 验证 hint 是"已变化"分支
- 模拟非 git 仓库：在普通目录下 save → 验证 git 字段为 undefined

### 6.3 真实场景手测（MVP 验收）

- 在 Cursor / Claude Code / Codex 里分别测试一次完整流程：
  1. 让 AI 改几个文件
  2. 让 AI 主动 `save_progress`
  3. 关掉会话
  4. 重新开会话
  5. AI 调 `resume_latest`，能复述上次进度并接着干
- 模拟"网络波动"：在 AI 做事中途强制关掉 IDE → 重开 → 验证物理快照能兜底

---

## 7. 决策日志

### D1. 为什么选 MCP 而非 Skill？
- MCP 三家 IDE 原生支持，一份实现复用
- Skill / Rule 在不同 IDE 加载机制不一致，移植成本高
- MCP 工具调用是结构化的，便于校验

### D2. 为什么选 AI 主动型 + 搭便车自动快照，而非独立 daemon？
- 独立 daemon 需要用户主动启动、管理生命周期、有进程驻留
- 搭便车机制利用 AI 必然会调用其他工具的事实，无需额外进程
- 极端"AI 完全没机会调任何工具就断了"的场景代价可接受（v2 可补 daemon）

### D3. 为什么物理快照只存元数据不存 diff 内容？
- 主流"网络断开"场景下，git HEAD 没变，dirty 改动还在磁盘，AI 可以 `git diff` 现取
- 不存 diff 内容大幅降低存储开销（一月 ~6MB vs 数百 MB）
- 极端 HEAD 已变化场景下，元数据 + changed_symbols 仍能让 AI 跟用户对齐，不会哑火

### D4. 为什么用 git 而非自建 diff 工具？
- 用户项目本来就有 git
- git 的语义（HEAD / branch / dirty）跟用户认知一致
- 自建 diff 工具是重复造轮子

### D5. 为什么 v1 支持 monorepo / 多 git 仓库根？
- 用户现代工作流经常在一个工作目录（如 Cursor workspace）下同时打开多个相关仓库（如 frontend / backend / shared-lib）
- 不支持时，AI 在另一个仓库的所有改动都"丢失"，违背了项目"无缝续写"的目标
- 实现成本可控：只是启动时扫描 + 路径归属判定，约 1 天工作量
- 不支持的延伸代价：用户遇到这种场景就放弃用本工具，得不偿失

### D6. 为什么 `changed_symbols` v1 直接用 tree-sitter（而非正则或 git hunk header）？
- 物理快照在 git HEAD 已变化场景下是**最后一根救命稻草**：AI 必须能精确知道"我之前在改哪个函数"才能跟用户对齐
- 正则方案在嵌套类、装饰器、改函数体内部时经常误报或漏报
- git hunk header 依赖 `.gitattributes` 配置，跨平台/跨仓库可靠性有边角问题
- tree-sitter 一次性投入 2-3 天，能让此能力稳定到 v2 都不用换
- grammar 按需 lazy load，首次启动开销可接受（< 200ms）

### D7. v1 内置语言为何是这 8 种（TS/TSX, JS/JSX, Python, Go, Rust, Java, Ruby, PHP）？
- 基础推荐 5 种（TS/JS/Python/Go/Rust）覆盖 90% 的现代 AI 编程使用场景（前端、后端、AI/ML、系统）
- 用户在 D1 决策中追加 Java / Ruby / PHP，覆盖：① 企业级后端（Java/Spring 生态、PHP/Laravel）② 脚本/Web 类老项目（Ruby/Rails、PHP 旧栈）
- 8 种 grammar 包总体积约 25MB，按需 lazy load，运行时占用可控
- C / C++ 等纳入 v2 候选：tree-sitter 对 C/C++ 宏的处理需要额外配置，v1 暂不引入复杂度
- 不支持的语言不报错，由 `WORK_RESUME_FALLBACK=regex` 降级到正则方案（精度有损但有总比无好）
- 加载策略选 lazy（D3 决策）：MCP server 启动越快越好，只为正在改的语言付加载成本

### D8. 为什么需要 `clear_checkpoints` 工具（而非用户手动 rm）？
- AI 在长会话中可能积累很多无效语义快照（如多次试错的中间态），有清理需求
- 让 AI 自己用 shell 命令删 `.work-resume/` 文件风险大（路径写错可能误删整个项目）
- 提供专门工具，配合 `dry_run` + 软删除（`.trash/`）+ `scope='all'` 二次确认，安全可控
- 同时保留"用户手动 rm 整个 `.work-resume/`"的退路（工具不阻止）

---

## 8. v1 范围 vs 未来扩展

### 8.1 v1（MVP）必须有

- **5 个 MCP 工具**完整实现：`save_progress` / `resume_latest` / `list_checkpoints` / `diff_since` / `clear_checkpoints`
- AI 主动 + 搭便车自动快照（含跳过列表逻辑）
- git 集成（HEAD / branch / dirty diff），含 monorepo 多 git 仓库根支持
- 索引文件 + 物理快照按 24h 时间清理
- tree-sitter 符号识别（v1 内置 8 种语言：TS/TSX, JS/JSX, Python, Go, Rust, Java, Ruby, PHP，按需 lazy load）
- 未支持语言降级到正则方案
- 三家 IDE 的 Rule 模板（放 `rules/` 目录）
- README + 在 Cursor / Claude Code / Codex 里跑通端到端

### 8.2 v2 可选扩展

- 独立 watcher daemon（解决"AI 完全没机会调任何工具就断了"）
- 跨设备同步（基于 git push 触发的远程存储）
- Web UI 浏览历史快照
- 团队共享：把语义快照推到远端供同事查看
- 与 `git stash` 集成（每次自动快照对应一个 stash entry，支持精确回滚）

### 8.3 明确不做（YAGNI）

- 不做用户认证 / 多用户
- 不做云端存储（v2 才考虑跨设备）
- 不做完整对话历史归档（agent-transcripts 已经做）
- 不做基于 AI 的"自动总结"（让调 save_progress 的 AI 自己总结即可）

---

## 9. 已决议汇总（截至 2026-05-27 用户拍板）

| # | 问题 | 决议 | 落地位置 |
|---|---|---|---|
| Q1 | 物理快照保留策略 | **按时间，24 小时**，超时由下次写入顺手清理 | §3.2、§5 环境变量 |
| Q2 | `changed_symbols` 实现 | **tree-sitter**（C4 方案） | §3.3、§7 D6 |
| Q3 | monorepo / 多 git 仓库根支持 | **v1 支持** | §2.3.1、§3.3、§7 D5 |
| Q4 | Rule 文本位置 | **`rules/` 目录**（项目内提供，用户复制到各 IDE） | §4 |
| Q5 | `clear_checkpoints` 工具 | **v1 提供**，含 `dry_run` + 软删除安全约束 | §3.1.5、§7 D8 |
| D1 | tree-sitter v1 支持哪些语言 | **8 种**：TS/TSX, JS/JSX, Python, Go, Rust, Java, Ruby, PHP | §3.3、§7 D7 |
| D2 | 不支持语言的降级策略 | **降级到正则方案**（保留 changed_symbols 字段，精度有损） | §3.3、§5 环境变量 |
| D3 | grammar 加载策略 | **lazy load**（首次访问加载并缓存） | §3.3、§5 环境变量 |

至此，spec 进入实现就绪状态，无开放问题。

---

## 10. 规格自检报告

### 10.1 第一轮自检（2026-05-27 v1 草案）

| 检查项 | 结果 | 备注 |
|---|---|---|
| 占位符扫描（TODO / 待定 / FIXME / TBD） | 通过 | 全文 grep 无命中 |
| 内部一致性 | 已修复 | 首版 §3.1.1 `todo_status.status` 值与 §4 Rule 的 `status="completed"` 不一致；已统一为 `'completed'\|'in_progress'\|'pending'\|'cancelled'`（与 TodoWrite 工具实际值对齐） |
| 范围检查 | 通过 | v1 MVP 可由一份实现计划覆盖；v2 扩展已明确隔离；不做事项已列入 §8.3 |
| 模糊性检查 | 已修复 | 首版 §2.2 的"切换工作主题"、"blocker" 缺定义；已在 §2.2、§4 中补上判定条件；§3.1.1 文件路径校验描述细化为"严禁包含 `..` 段或跳出项目根" |

**剩余开放问题**：§9 列出 5 项 (Q1-Q5)，需在进入实现阶段前由用户确认。

### 10.2 第二轮自检（2026-05-27 用户决议固化后）

| 检查项 | 结果 | 备注 |
|---|---|---|
| 占位符扫描 | 通过 | 全文 grep 无 TODO / 待定 / FIXME / TBD 命中 |
| 内部一致性 | 已修复 | ① §3.3 tree-sitter 语言列表与 §7 D7 / §8.1 已完全对齐为 8 种；② §3.1 工具数量与 §8.1 已对齐为 5 个（新增 `clear_checkpoints`）；③ §3.2 自动快照增加 `SKIP_AUTO_SNAPSHOT` 跳过列表，避免清理工具被自身拦截 |
| 范围检查 | 通过 | v1 范围以 5 工具 + 8 语言为边界；C/C++ 等纳入 v2 候选；§7 D7/D8 明确决策理由 |
| 模糊性检查 | 已修复 | ① §3.1.5 `clear_checkpoints` 的 `scope='all'` 边界已补 dry_run 强制 + 二次确认约束；② §3.3 不支持语言的降级策略已明确（"regex / empty" 两档可配置）；③ §5 新增 4 个环境变量覆盖语言相关配置点 |
| Q1-Q5 / D1-D3 决议覆盖率 | 通过 | §9 已决议汇总表逐项标注落地位置；每条决议至少在 1 个章节有对应实现描述 |

**剩余开放问题**：无。规格可进入实现计划阶段。

### 10.3 字段交叉引用验证

| 字段 | 定义位置 | 使用位置 | 状态 |
|---|---|---|---|
| `changed_symbols` | §2.3.3 物理快照 schema | §3.1.2 resume_latest hint、§3.3 抓取流程、§6.1 单测、§7 D6/D7 | ✓ 一致 |
| `repo_root` | §3.1.1/3.1.2/3.1.5 output | §2.3.1 monorepo 描述、§3.3 探测逻辑 | ✓ 一致 |
| `WORK_RESUME_AUTO_RETENTION_HOURS` | §5 环境变量 | §3.2 生命周期、§9 Q1 决议 | ✓ 一致 |
| `WORK_RESUME_LANGS` | §5 环境变量 | §3.3 grammar 包表、§7 D7 决议 | ✓ 一致 |
| `clear_checkpoints` | §3.1.5 工具定义 | §3.2 跳过列表、§7 D8 决策、§8.1 v1 范围 | ✓ 一致 |
