# work-resume-mcp

> 跨会话续写 MCP server — 让 Cursor / Claude Code / Codex 在网络断开 / IDE 崩溃 / 新会话开始时无缝接续工作进度。

完整设计：[`docs/specs/2026-05-27-work-resume-design.md`](docs/specs/2026-05-27-work-resume-design.md)
实现计划：[`docs/plans/2026-05-27-work-resume-impl-plan.md`](docs/plans/2026-05-27-work-resume-impl-plan.md)

## 安装

```bash
# 全局安装（推荐）
npm install -g work-resume-mcp

# 或临时跑
npx work-resume-mcp
```

## 注册到 IDE

### Cursor (`~/.cursor/mcp.json`)

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

**手动**：把 [`rules/RULE.md`](rules/RULE.md) 复制到 IDE 规则位置（见该文件末尾表格）。

## 5 个工具

| 工具 | 用途 |
|---|---|
| `save_progress` | 保存当前进度（语义快照） |
| `resume_latest` | 新会话获取最近进度 |
| `list_checkpoints` | 浏览历史快照 |
| `diff_since` | 看从某快照到现在改了什么 |
| `clear_checkpoints` | 清理旧快照（带 dry_run + 软删除） |

## 环境变量

完整列表见 [spec §5](docs/specs/2026-05-27-work-resume-design.md#5-实现技术栈)。常用：

- `WORK_RESUME_PROJECT_ROOT` — 强制项目根
- `WORK_RESUME_AUTO_RETENTION_HOURS` — 物理快照保留时长（默认 24）
- `WORK_RESUME_LANGS` — tree-sitter 启用的语言列表
- `WORK_RESUME_GRAMMAR_LOAD` — `lazy` (默认) / `eager`

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
