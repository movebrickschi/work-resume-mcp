# work-resume 进度续写规则

> 把本文件复制到对应 IDE 的 Rule / AGENTS.md 位置；三家共用一份内容。

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

## 跨项目工作（Cursor 工作区本身不是 git 仓库）

> ⚠️ **跨项目调用是最容易出错的地方。漏 `repo_root` 或路径分隔符不一致都会让整次工具调用失败。**

当用户的 Cursor 工作区是空目录或非 git 目录、AI 实际修改的是兄弟项目时，调用 save_progress / resume_latest / list_checkpoints / diff_since / clear_checkpoints 必须：
- **优先**：显式传 `repo_root`，绝对路径，例如 `"repo_root": "C:\\lcc\\workspace\\huizhi-playlet-app"`
- **或**：files_in_focus 全部使用绝对路径（save_progress 会自动从绝对路径回溯找 `.git`）
- 不要把 files_in_focus 写成相对路径而又不传 repo_root —— 会报 NOT_IN_GIT_REPO
- 多个文件来自不同仓库 → 拆成多次 save_progress，每次只覆盖一个 repo_root
- **Windows 路径分隔符**：`repo_root` 与 `files_in_focus` 必须用同一种斜杠（推荐统一用反斜杠 `\\`）；混用 `/` 与 `\\` 在 Windows 上可能触发 PATH_ESCAPE

### 正确调用模板（直接抄）

```json
{
  "summary": "已完成 X / 正在做 Y",
  "next_steps": ["改 src/foo.ts 的 bar() 实现"],
  "files_in_focus": ["C:\\lcc\\workspace\\<项目名>\\src\\foo.ts"],
  "blockers": [],
  "repo_root": "C:\\lcc\\workspace\\<项目名>"
}
```

### 错误示范（必报错）

```json
{
  "summary": "...",
  "files_in_focus": ["src/foo.ts"]
}
```
缺 `repo_root` + 用相对路径 → `NOT_IN_GIT_REPO`。

## 严禁
- 跳过 save_progress 直接回复"OK 完成了"
- 在 summary 里写"做了一些工作"这类模糊描述
- 跨项目工作时省略 repo_root 又写相对路径，导致工具失败后放弃保存
- 工具报 `NOT_IN_GIT_REPO` / `PATH_ESCAPE` 后**用同样参数重试** —— 必先补 `repo_root` 或统一斜杠再重试

## 各家 IDE 安装位置

推荐用 `npx work-resume-mcp install-rules --target all`（或在 mcp.json 里设 `WORK_RESUME_AUTO_INSTALL_RULES=1`）自动生成；下表是手动放置位置。

| IDE | 位置 | 手动复制源 |
|---|---|---|
| Cursor | `.cursor/rules/work-resume.mdc` | [`examples/cursor-rule.mdc`](../examples/cursor-rule.mdc)（带 frontmatter） |
| Claude Code | `.claude/rules/work-resume.md` 或项目根 `AGENTS.md` 末尾追加 | 本文件正文（`## 必须触发` 到 `## 严禁` 之间） |
| Codex CLI | `~/.codex/AGENTS.md` 或项目 `AGENTS.md` | 同上 |
