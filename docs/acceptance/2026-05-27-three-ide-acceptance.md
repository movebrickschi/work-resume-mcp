# work-resume-mcp 三家 IDE 真实场景手测验收

> **目的**：v1 发布前在三家 IDE 各跑一次完整断开-续接流程，确认主流场景 S1/S2/S3 在生产环境工作。
> **前置**：`npm install -g work-resume-mcp` 完成；本 plan 的所有自动化测试已绿。

## 场景 A · 主流断开续接

在每家 IDE 中重复以下步骤：

1. [ ] 新建临时 git 仓库 `~/wr-acceptance` 并 `git init && echo "# t" > README.md && git add . && git commit -m init`
2. [ ] 在 IDE 中打开该仓库
3. [ ] 让 AI："给我生成 `src/login.ts`，实现一个 loginRequest 函数，先写空骨架"
4. [ ] 让 AI："现在帮我加 401 错误分支" — 期间让 AI 调一次 save_progress（手动让它读 Rule 后自然触发）
5. [ ] **断开**：直接关掉 IDE 窗口（不要等 AI 完成）
6. [ ] 重开 IDE，新会话第一句："接着上次"
7. [ ] 验收：
   - [ ] AI 自动调了 `resume_latest`
   - [ ] AI 复述了上次的 summary（包含 "loginRequest"）
   - [ ] AI 给出的下一步与原 next_steps 一致或可对齐
   - [ ] `head_match=true`
   - [ ] `git diff` 显示的内容跟物理快照的 files_changed 对得上

## 场景 B · HEAD 变化容错

1. [ ] 接场景 A 步骤 6 之后，**先 commit 当前 dirty 改动**
2. [ ] 重开会话，"接着上次"
3. [ ] 验收：
   - [ ] `head_match=false`
   - [ ] AI 的 `hint` 明确说 "HEAD has changed"
   - [ ] AI 主动向用户求证"我们之前在改 X，对吗？"，而不是闷头改

## 场景 C · monorepo 路由

1. [ ] 创建 `~/wr-mono` 含两个 git 子仓库 `frontend/` 和 `backend/`
2. [ ] 让 AI 同时在两边改东西
3. [ ] 让 AI 调一次 save_progress（只针对 frontend 文件）
4. [ ] 验收：
   - [ ] 快照保存到 `frontend/.work-resume/` 而非 `backend/.work-resume/`
   - [ ] `output.repo_root` 是 frontend 路径
   - [ ] 若 AI 在调用里混入 backend 文件 → 抛 `MULTI_REPO_FILES` 错误

## 场景 D · 三家 IDE 调用差异

| IDE | 注册位置 | 第一次启动成功? | resume_latest 返回完整 schema? | 工具列表 5 个? |
|---|---|---|---|---|
| Cursor | `~/.cursor/mcp.json` | [ ] | [ ] | [ ] |
| Claude Code | `claude mcp add work-resume -- npx work-resume-mcp` | [ ] | [ ] | [ ] |
| Codex CLI | `~/.codex/config.toml` | [ ] | [ ] | [ ] |

## 已知小问题登记

> 若手测发现非阻断问题，列在这里供 v1.1 修复，不阻塞发布。

| # | 问题描述 | 影响 | 解决路径 |
|---|---|---|---|
| 1 | ... | ... | ... |

## 验收结论

- [ ] 三家全过 → 可发布 v1
- [ ] 至少一家失败 → 列已知问题，看是否阻断
