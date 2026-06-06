# work-resume-mcp

> 跨会话续写 MCP server — 让 Cursor / Claude Code / Codex 在网络断开 / IDE 崩溃 / 新会话开始时无缝接续工作进度。

完整设计：[`docs/specs/2026-05-27-work-resume-design.md`](docs/specs/2026-05-27-work-resume-design.md)
实现计划：[`docs/plans/2026-05-27-work-resume-impl-plan.md`](docs/plans/2026-05-27-work-resume-impl-plan.md)

## 安装

> 需要 Node.js ≥ 20。

```bash
# 全局安装（推荐）
npm install -g work-resume-mcp

# 或临时跑
npx work-resume-mcp
```

## 注册到 IDE

> 建议先 `npm install -g work-resume-mcp` 全局安装；否则 `npx` 在首次启动时需联网下载，可能超过 IDE 的 MCP 启动超时而报错。

### Cursor · 标准接入（已发布的 npm 包）

`~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "work-resume": {
      "command": "npx",
      "args": ["work-resume-mcp"]
    }
  }
}
```

> 想让规则自动写入工作区？给该条目加 `env`，见下方「配置 Rule · 自动绑定 MCP」。

### Claude Code

```bash
claude mcp add work-resume -- npx work-resume-mcp
```

### Codex CLI

`~/.codex/config.toml` 添加：

```toml
[mcp_servers.work-resume]
command = "npx"
args = ["work-resume-mcp"]
```

## 配置 Rule

### 自动绑定 MCP（推荐，零手动）

在 `mcp.json` 的 `work-resume` 条目加 `env`，**每次 MCP 启动**自动写入当前工作区的 Rule 文件，并注入 MCP `instructions`：

```json
"work-resume": {
  "command": "npx",
  "args": ["work-resume-mcp"],
  "env": {
    "WORK_RESUME_AUTO_INSTALL_RULES": "1",
    "WORK_RESUME_AUTO_INSTALL_TARGETS": "cursor,claude,agents",
    "WORK_RESUME_AUTO_INSTALL_GLOBAL_CODEX": "0"
  }
}
```

| 环境变量 | 含义 |
|---|---|
| `WORK_RESUME_AUTO_INSTALL_RULES` | `1` = 启动时自动 `install-rules` |
| `WORK_RESUME_AUTO_INSTALL_TARGETS` | 逗号分隔：`cursor,claude,agents,codex` |
| `WORK_RESUME_AUTO_INSTALL_GLOBAL_CODEX` | `1` = 同时写 `~/.codex/AGENTS.md` |

### 手动 / CLI

**一次性命令** — 在项目根执行：

```bash
# Cursor + Claude + 项目 AGENTS.md
npx work-resume-mcp install-rules --target all

# 含 Codex 全局 ~/.codex/AGENTS.md
npx work-resume-mcp install-rules --target all --global-codex

# 仅 Cursor
npx work-resume-mcp install-rules --target cursor --cwd /path/to/project
```

**手动**：

- Cursor：复制 [`examples/cursor-rule.mdc`](examples/cursor-rule.mdc) 到 `<项目根>/.cursor/rules/work-resume.mdc`
- Claude Code / Codex / AGENTS.md：复制 [`rules/RULE.md`](rules/RULE.md) 到对应位置（见该文件末尾表格）

> **注意**：本仓库的 `.cursor/rules/work-resume.mdc` / `.claude/rules/work-resume.md` / `AGENTS.md` 已加入 `.gitignore`，由 MCP 启动时 `install-rules` 自动生成；示例模板请用 `examples/cursor-rule.mdc`。

## 5 个工具

| 工具 | 用途 |
|---|---|
| `save_progress` | 保存当前进度（语义快照） |
| `resume_latest` | 新会话获取最近进度 |
| `list_checkpoints` | 浏览历史快照 |
| `diff_since` | 看从某快照到现在改了什么 |
| `clear_checkpoints` | 清理旧快照（带 dry_run + 软删除） |

## 环境变量

全部为**可选**，均有默认值；整数项有最小值校验、枚举项有合法值校验，**填非法值会导致启动报错**。完整设计见 [spec §5](docs/specs/2026-05-27-work-resume-design.md#5-实现技术栈)。

| 变量 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `WORK_RESUME_PROJECT_ROOT` | 否¹ | 自动探测 | 强制项目根（绝对路径） |
| `WORK_RESUME_DIR` | 否 | `.work-resume` | 快照存储目录名 |
| `WORK_RESUME_AUTO_INTERVAL_MS` | 否 | `60000` | 自动快照最小间隔（毫秒，min 1） |
| `WORK_RESUME_AUTO_RETENTION_HOURS` | 否 | `24` | 物理（自动）快照保留小时数（min 1） |
| `WORK_RESUME_TRASH_RETENTION_DAYS` | 否 | `7` | 软删除回收站保留天数（min 1） |
| `WORK_RESUME_MAX_REPO_SCAN_DEPTH` | 否 | `3` | 向下扫描兄弟 git 仓库的最大深度（min 0） |
| `WORK_RESUME_LANGS` | 否 | `ts,tsx,js,jsx,py,go,rs,java,rb,php` | tree-sitter 启用语言（逗号分隔） |
| `WORK_RESUME_GRAMMAR_LOAD` | 否 | `lazy` | `lazy` / `eager`（eager=启动即加载全部语法） |
| `WORK_RESUME_FALLBACK` | 否 | `regex` | 解析失败回退：`regex` / `empty` |
| `WORK_RESUME_AUTO_INSTALL_RULES` | 否 | 关 | `1` = 启动时自动写规则文件 |
| `WORK_RESUME_AUTO_INSTALL_TARGETS` | 否 | `cursor,claude,agents` | 自动装规则的目标（可加 `codex`），仅在上一项 = `1` 时生效 |
| `WORK_RESUME_AUTO_INSTALL_GLOBAL_CODEX` | 否 | 关 | `1` = 同时写 `~/.codex/AGENTS.md` |

> ¹ 不设时按 `cwd` / `WORKSPACE_FOLDER_PATHS` / `VSCODE_CWD` 自动探测；若工作区目录名本身含 `work-resume-mcp`，或探测落到编辑器安装目录，建议显式设置。
>
> `WORKSPACE_FOLDER_PATHS`、`VSCODE_CWD`、`USERPROFILE`/`HOME` 由编辑器/系统注入，无需手动设置。

## v1 已知限制

- tree-sitter grammar 必须随包提供 WASM 文件；若上游 npm 包没预编 WASM，需要本地 `tree-sitter build-wasm` 一次（见 spec §3.3）。
- 跨设备同步未实现（v2）；语义快照随 git commit `.work-resume/` 可半同步。
- 极端"AI 完全没机会调任何工具就断了"场景的物理快照可能为空（v2 daemon 解决）。

## 开发

```bash
npm install
npm test              # vitest 全套单测
npm run typecheck     # tsc --noEmit
npm run build         # 生成 dist/
npm run dev           # tsx 直跑（本地调试）
```

## License

MIT
