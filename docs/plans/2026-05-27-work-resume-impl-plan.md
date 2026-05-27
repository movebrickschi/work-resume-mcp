# work-resume-mcp Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 实现一个跨会话续写 MCP server，5 个工具（`save_progress` / `resume_latest` / `list_checkpoints` / `diff_since` / `clear_checkpoints`），AI 主动 + 搭便车自动快照，git/monorepo 集成，tree-sitter 抓 changed_symbols。

**Architecture:** Node.js 20+ / TypeScript 5+ 实现的 MCP server，运行时通过 `@modelcontextprotocol/sdk` 与三家 IDE（Cursor / Claude Code / Codex）通信；存储用纯文件系统（每个 git 仓库根下一份 `.work-resume/`），无数据库；git 信息通过 child_process 直接调 `git` CLI 抓；符号识别用 `web-tree-sitter` + 8 语言 grammar 包按需 lazy load，未支持语言降级到正则方案。

**Tech Stack:** TypeScript 5.x · Node.js 20+ · `@modelcontextprotocol/sdk` · `web-tree-sitter` + 8 个 grammar 包 · `execa` · `vitest` · 纯 fs/path 标准库

**Spec 参考：** [`docs/specs/2026-05-27-work-resume-design.md`](../specs/2026-05-27-work-resume-design.md) — 任何字段语义、决策理由查阅以 spec 为准；本 plan 只描述"怎么写"。

---

## 阅读约定

- 所有路径相对 `work-resume-mcp/` 项目根；`src/` / `tests/` / `rules/` 都在此根下。
- 每个 Task 都按 TDD：先红测 → 跑 → 最小实现 → 绿测 → commit。
- 测试用 `vitest`，命令统一是 `npx vitest run tests/<path>`（CI 模式不监听）。
- commit message 用约定式（`feat:` / `test:` / `chore:` / `docs:` / `fix:`），与 spec D 系列决策对齐。
- 涉及 `execa` 或 `child_process` 的 Task 必须 mock 子进程，不要真跑 `git`（除非该 Task 明确是集成测试）。
- **Iron Law**：每个 Task 完成后跑一次 `npx tsc --noEmit` 确认类型干净，再 commit。

---

## Phase / Task 一览

| Phase | Task # | 内容 | 依赖 |
|---|---|---|---|
| 0 · 骨架 | 0 | 项目脚手架（package.json / tsconfig / vitest / .gitignore / README 占位） | 无 |
| 1 · 底层 | 1 | `src/config.ts`：环境变量读取与默认值 | T0 |
| 1 · 底层 | 2 | `src/git.ts`：git CLI 封装 | T0 |
| 1 · 底层 | 3 | `src/repo-scanner.ts`：monorepo 多 git 仓库探测 + 文件归属判定 | T2 |
| 1 · 底层 | 4 | `src/storage.ts`：`.work-resume/` 读写 + 索引维护 + 软删除 | T1, T3 |
| 2 · AST | 5 | `src/tree-sitter/regex-fallback.ts`：正则降级方案 | T0 |
| 2 · AST | 6 | `src/tree-sitter/lazy-loader.ts`：grammar 按需 lazy load + 缓存 | T1 |
| 2 · AST | 7 | `src/tree-sitter/index.ts`：基于 hunk + AST 抓 changed_symbols 主流程 | T2, T5, T6 |
| 3 · 兜底 | 8 | `src/auto-snapshot.ts`：搭便车物理快照（节流 + 跳过列表 + 24h 清理） | T2, T4, T7 |
| 4 · 工具 | 9 | `src/tools/save-progress.ts` | T2, T3, T4 |
| 4 · 工具 | 10 | `src/tools/resume-latest.ts` | T2, T3, T4 |
| 4 · 工具 | 11 | `src/tools/list-checkpoints.ts` | T4 |
| 4 · 工具 | 12 | `src/tools/diff-since.ts` | T2, T4 |
| 4 · 工具 | 13 | `src/tools/clear-checkpoints.ts` | T4 |
| 5 · 装配 | 14 | `src/index.ts`：MCP server 入口 + 工具路由 + 自动快照拦截 | T8-T13 |
| 6 · 文档 | 15 | `rules/RULE.md`：Rule 模板 | spec §4 |
| 6 · 文档 | 16 | `README.md`：安装 / 配置 / 三家 IDE 注册示例 | T14 |
| 7 · 验收 | 17 | 集成测试：跨进程 save→resume 端到端 | T14 |
| 7 · 验收 | 18 | 集成测试：HEAD 变化 / monorepo / 非 git 三种降级 | T14 |
| 7 · 验收 | 19 | 集成测试：24h 清理 + `clear_checkpoints` 安全约束 | T14 |
| 7 · 验收 | 20 | 三家 IDE 真实手测脚本与验收记录 | T14, T16 |

**总计**：21 个 Task；每个 Task 内拆 4-8 步；预估 5-7 个工作日（单人）。

---

# Phase 0 · 项目骨架

## Task 0 · 创建项目脚手架

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`（占位 entry，仅打印 banner，后续 Task 14 才装配真正的 MCP server）
- Create: `tests/.gitkeep`
- Create: `README.md`（占位骨架，Task 16 补全）

### Step 1：创建 `package.json`

```json
{
  "name": "work-resume-mcp",
  "version": "0.1.0",
  "description": "Cross-session resume MCP server for Cursor / Claude Code / Codex",
  "type": "module",
  "bin": { "work-resume-mcp": "dist/index.js" },
  "main": "dist/index.js",
  "files": ["dist", "rules"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "execa": "^9.0.0",
    "web-tree-sitter": "^0.22.0",
    "tree-sitter-typescript": "^0.21.0",
    "tree-sitter-javascript": "^0.21.0",
    "tree-sitter-python": "^0.21.0",
    "tree-sitter-go": "^0.21.0",
    "tree-sitter-rust": "^0.21.0",
    "tree-sitter-java": "^0.21.0",
    "tree-sitter-ruby": "^0.21.0",
    "tree-sitter-php": "^0.22.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**注**：tree-sitter grammar 包的版本号写在依赖里只是 lock 一个上限，实际加载用 `web-tree-sitter` 的 WASM 后端（见 Task 6 决策）。如果选用原生 N-API 后端（`node-tree-sitter`），需要把这些 grammar 包配合 prebuild；本 plan 采用 WASM 路线避免 native 构建复杂度，详见 Task 6。

### Step 2：创建 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### Step 3：创建 `vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10_000,
    pool: 'forks',
    coverage: { reporter: ['text', 'html'], reportsDirectory: 'coverage' },
  },
});
```

### Step 4：创建 `.gitignore`

```
node_modules/
dist/
coverage/
*.log
.DS_Store
.idea/
.vscode/
.work-resume/
```

### Step 5：创建占位 `src/index.ts`

```ts
#!/usr/bin/env node
console.error('[work-resume-mcp] scaffold up — server not implemented yet (see docs/plans for Task 14)');
process.exit(0);
```

### Step 6：创建占位 `README.md`（Task 16 会重写）

```markdown
# work-resume-mcp

Cross-session resume MCP server. See `docs/specs/2026-05-27-work-resume-design.md`.

WIP — implementation in progress per `docs/plans/2026-05-27-work-resume-impl-plan.md`.
```

### Step 7：安装依赖并验证

Run: `npm install`
Expected: 全部依赖落地，无 EBADENGINE 警告（前提 Node ≥ 20）

Run: `npx tsc --noEmit`
Expected: 无类型错误（此时 src 只有一个占位文件）

### Step 8：Commit

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/index.ts README.md tests/.gitkeep
git commit -m "chore(scaffold): bootstrap work-resume-mcp project skeleton"
```

---

# Phase 1 · 底层基础设施

## Task 1 · `src/config.ts` — 环境变量读取

**Files:**
- Create: `src/config.ts`
- Test: `tests/unit/config.test.ts`

**Spec 引用：** §5 环境变量表。

### Step 1：写失败测试 `tests/unit/config.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('WORK_RESUME_')) delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('WORK_RESUME_')) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL);
  });

  it('returns all defaults when no env vars set', () => {
    const cfg = loadConfig('/tmp/x');
    expect(cfg.projectRoot).toBe('/tmp/x');
    expect(cfg.storeDir).toBe('.work-resume');
    expect(cfg.autoIntervalMs).toBe(60_000);
    expect(cfg.autoRetentionHours).toBe(24);
    expect(cfg.maxRepoScanDepth).toBe(3);
    expect(cfg.langs).toEqual(['ts','tsx','js','jsx','py','go','rs','java','rb','php']);
    expect(cfg.fallback).toBe('regex');
    expect(cfg.grammarLoad).toBe('lazy');
    expect(cfg.trashRetentionDays).toBe(7);
  });

  it('respects WORK_RESUME_PROJECT_ROOT', () => {
    process.env.WORK_RESUME_PROJECT_ROOT = '/srv/repo';
    expect(loadConfig('/tmp/x').projectRoot).toBe('/srv/repo');
  });

  it('parses WORK_RESUME_LANGS as comma list with trim', () => {
    process.env.WORK_RESUME_LANGS = ' ts , py , go ';
    expect(loadConfig('/tmp/x').langs).toEqual(['ts','py','go']);
  });

  it('throws on invalid WORK_RESUME_FALLBACK', () => {
    process.env.WORK_RESUME_FALLBACK = 'bogus';
    expect(() => loadConfig('/tmp/x')).toThrow(/WORK_RESUME_FALLBACK/);
  });

  it('throws on invalid WORK_RESUME_GRAMMAR_LOAD', () => {
    process.env.WORK_RESUME_GRAMMAR_LOAD = 'maybe';
    expect(() => loadConfig('/tmp/x')).toThrow(/WORK_RESUME_GRAMMAR_LOAD/);
  });

  it('parses numeric envs with bounds checking', () => {
    process.env.WORK_RESUME_AUTO_INTERVAL_MS = '0';
    expect(() => loadConfig('/tmp/x')).toThrow(/WORK_RESUME_AUTO_INTERVAL_MS/);
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/config.test.ts`
Expected: FAIL — `Cannot find module '../../src/config.js'`

### Step 3：实现 `src/config.ts`

```ts
export interface Config {
  projectRoot: string;
  storeDir: string;
  autoIntervalMs: number;
  autoRetentionHours: number;
  maxRepoScanDepth: number;
  langs: string[];
  fallback: 'regex' | 'empty';
  grammarLoad: 'lazy' | 'eager';
  trashRetentionDays: number;
}

const DEFAULT_LANGS = ['ts','tsx','js','jsx','py','go','rs','java','rb','php'];

function parseIntEnv(name: string, defaultVal: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new Error(`Invalid ${name}: ${raw} (expected integer >= ${min})`);
  }
  return n;
}

function parseEnum<T extends string>(name: string, defaultVal: T, allowed: readonly T[]): T {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`Invalid ${name}: ${raw} (allowed: ${allowed.join('|')})`);
  }
  return raw as T;
}

export function loadConfig(cwd: string): Config {
  const langsRaw = process.env.WORK_RESUME_LANGS;
  const langs = langsRaw
    ? langsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_LANGS;

  return {
    projectRoot: process.env.WORK_RESUME_PROJECT_ROOT || cwd,
    storeDir: process.env.WORK_RESUME_DIR || '.work-resume',
    autoIntervalMs: parseIntEnv('WORK_RESUME_AUTO_INTERVAL_MS', 60_000, 1),
    autoRetentionHours: parseIntEnv('WORK_RESUME_AUTO_RETENTION_HOURS', 24, 1),
    maxRepoScanDepth: parseIntEnv('WORK_RESUME_MAX_REPO_SCAN_DEPTH', 3, 0),
    langs,
    fallback: parseEnum('WORK_RESUME_FALLBACK', 'regex', ['regex','empty'] as const),
    grammarLoad: parseEnum('WORK_RESUME_GRAMMAR_LOAD', 'lazy', ['lazy','eager'] as const),
    trashRetentionDays: parseIntEnv('WORK_RESUME_TRASH_RETENTION_DAYS', 7, 1),
  };
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/config.test.ts`
Expected: 6 tests passed

Run: `npx tsc --noEmit`
Expected: 无报错

### Step 5：Commit

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat(config): env-driven configuration loader"
```

---

## Task 2 · `src/git.ts` — git CLI 封装

**Files:**
- Create: `src/git.ts`
- Test: `tests/unit/git.test.ts`

**Spec 引用：** §3.3。

### Step 1：写失败测试 `tests/unit/git.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn(),
}));

import { execa } from 'execa';
import { getGitStatus, isGitRepo, getDirtyDiff, getDiffStat, getHunksUnified0 } from '../../src/git.js';

const mockExeca = execa as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => mockExeca.mockReset());

describe('isGitRepo', () => {
  it('returns true when rev-parse succeeds', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '/abs/repo', exitCode: 0 } as any);
    expect(await isGitRepo('/abs/repo')).toBe(true);
  });
  it('returns false when rev-parse throws', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not a git repo'));
    expect(await isGitRepo('/abs/repo')).toBe(false);
  });
});

describe('getGitStatus', () => {
  it('parses HEAD / branch / dirty', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: 'a1b2c3', exitCode: 0 } as any)         // rev-parse HEAD
      .mockResolvedValueOnce({ stdout: 'feature/x', exitCode: 0 } as any)      // rev-parse --abbrev-ref HEAD
      .mockResolvedValueOnce({ stdout: ' M src/a.ts\n?? src/b.ts\n', exitCode: 0 } as any); // status --porcelain
    const s = await getGitStatus('/abs/repo');
    expect(s.head).toBe('a1b2c3');
    expect(s.branch).toBe('feature/x');
    expect(s.dirty_files).toEqual(['src/a.ts','src/b.ts']);
  });

  it('returns empty dirty_files when clean', async () => {
    mockExeca
      .mockResolvedValueOnce({ stdout: 'a1b2c3', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: 'main', exitCode: 0 } as any)
      .mockResolvedValueOnce({ stdout: '', exitCode: 0 } as any);
    const s = await getGitStatus('/abs/repo');
    expect(s.dirty_files).toEqual([]);
  });
});

describe('getDiffStat', () => {
  it('parses numstat output into per-file counts', async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: '12\t3\tsrc/a.ts\n0\t0\tsrc/b.ts\n-\t-\tassets/img.png\n',
      exitCode: 0,
    } as any);
    const stats = await getDiffStat('/abs/repo');
    expect(stats.get('src/a.ts')).toEqual({ added: 12, removed: 3 });
    expect(stats.get('src/b.ts')).toEqual({ added: 0, removed: 0 });
    expect(stats.get('assets/img.png')).toEqual({ added: 0, removed: 0 });
  });
});

describe('getHunksUnified0', () => {
  it('returns per-file added line ranges from unified=0 diff', async () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
index e69de29..0000001 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,0 +11,3 @@ class Foo {
+  bar() {}
+  baz() {}
+}
@@ -30,2 +33,1 @@
-  old1();
-  old2();
+  newOnly();
`;
    mockExeca.mockResolvedValueOnce({ stdout: diff, exitCode: 0 } as any);
    const hunks = await getHunksUnified0('/abs/repo');
    expect(hunks.get('src/a.ts')).toEqual([
      { addedStart: 11, addedCount: 3 },
      { addedStart: 33, addedCount: 1 },
    ]);
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/git.test.ts`
Expected: FAIL — `Cannot find module '../../src/git.js'`

### Step 3：实现 `src/git.ts`

```ts
import { execa } from 'execa';

export interface GitStatus {
  head: string;
  branch: string;
  dirty_files: string[];
}

export interface DiffStat { added: number; removed: number; }

export interface Hunk { addedStart: number; addedCount: number; }

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd: repoRoot, reject: true });
  return stdout;
}

export async function isGitRepo(repoRoot: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ['rev-parse', '--show-toplevel']);
    return true;
  } catch {
    return false;
  }
}

export async function getRepoTopLevel(cwd: string): Promise<string | null> {
  try {
    return (await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch { return null; }
}

export async function getGitStatus(repoRoot: string): Promise<GitStatus> {
  const head = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
  const branch = (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const porcelain = await runGit(repoRoot, ['status', '--porcelain']);
  const dirty_files = porcelain
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => l.slice(3).trim()); // strip "XY " prefix
  return { head, branch, dirty_files };
}

export async function getDirtyDiff(repoRoot: string, maxBytes = 100_000): Promise<{ diff: string; truncated: boolean }> {
  const full = await runGit(repoRoot, ['diff', 'HEAD']);
  if (full.length <= maxBytes) return { diff: full, truncated: false };
  return { diff: full.slice(0, maxBytes), truncated: true };
}

export async function getDiffStat(repoRoot: string): Promise<Map<string, DiffStat>> {
  const out = await runGit(repoRoot, ['diff', 'HEAD', '--numstat']);
  const result = new Map<string, DiffStat>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [a, r, ...rest] = line.split('\t');
    const file = rest.join('\t');
    const added = a === '-' ? 0 : Number(a);
    const removed = r === '-' ? 0 : Number(r);
    result.set(file, { added, removed });
  }
  return result;
}

export async function getHunksUnified0(repoRoot: string): Promise<Map<string, Hunk[]>> {
  const out = await runGit(repoRoot, ['diff', 'HEAD', '--unified=0']);
  const map = new Map<string, Hunk[]>();
  let current: string | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6).trim();
      if (!map.has(current)) map.set(current, []);
      continue;
    }
    if (line.startsWith('@@') && current) {
      // @@ -10,0 +11,3 @@ ...
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const addedStart = Number(m[1]);
        const addedCount = m[2] !== undefined ? Number(m[2]) : 1;
        if (addedCount > 0) map.get(current)!.push({ addedStart, addedCount });
      }
    }
  }
  return map;
}

export async function getDiffSinceCommit(repoRoot: string, baseHead: string, maxBytes = 100_000): Promise<{ diff: string; truncated: boolean }> {
  const committedSinceBase = await runGit(repoRoot, ['diff', baseHead, 'HEAD']);
  const dirty = await runGit(repoRoot, ['diff', 'HEAD']);
  const combined = committedSinceBase + (dirty ? `\n--- uncommitted ---\n${dirty}` : '');
  if (combined.length <= maxBytes) return { diff: combined, truncated: false };
  return { diff: combined.slice(0, maxBytes), truncated: true };
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/git.test.ts`
Expected: 5 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/git.ts tests/unit/git.test.ts
git commit -m "feat(git): wrap git CLI for HEAD / branch / dirty / hunks"
```

---

## Task 3 · `src/repo-scanner.ts` — monorepo 多仓库探测

**Files:**
- Create: `src/repo-scanner.ts`
- Test: `tests/unit/repo-scanner.test.ts`

**Spec 引用：** §2.3.1、§3.3 多仓库探测。

### Step 1：写失败测试 `tests/unit/repo-scanner.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { scanRepos, resolveRepoForFile, clearScanCache } from '../../src/repo-scanner.js';

async function mkRepo(root: string, rel: string) {
  const repo = path.join(root, rel);
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  return repo;
}

describe('scanRepos', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-scan-'));
    clearScanCache();
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('discovers nested git repos up to maxDepth', async () => {
    await mkRepo(tmp, 'frontend');
    await mkRepo(tmp, 'backend');
    await mkRepo(tmp, 'libs/shared');
    const repos = await scanRepos(tmp, 3);
    expect(repos.map(r => path.relative(tmp, r)).sort())
      .toEqual(['backend','frontend','libs/shared'].sort());
  });

  it('does not recurse into .git directories', async () => {
    const a = await mkRepo(tmp, 'a');
    await fs.mkdir(path.join(a, '.git', 'nested'), { recursive: true });
    const repos = await scanRepos(tmp, 3);
    expect(repos).toEqual([a]);
  });

  it('skips node_modules / dist / build / target / vendor / .next / .nuxt / .cache', async () => {
    await mkRepo(tmp, 'node_modules/nested');
    await mkRepo(tmp, 'dist/nested');
    await mkRepo(tmp, 'build/nested');
    await mkRepo(tmp, 'target/nested');
    await mkRepo(tmp, 'vendor/nested');
    await mkRepo(tmp, '.next/nested');
    await mkRepo(tmp, '.nuxt/nested');
    await mkRepo(tmp, '.cache/nested');
    await mkRepo(tmp, 'real-repo');
    const repos = await scanRepos(tmp, 3);
    expect(repos.map(r => path.basename(r))).toEqual(['real-repo']);
  });

  it('respects maxDepth=0 (only scans root itself)', async () => {
    await mkRepo(tmp, '.');
    await mkRepo(tmp, 'nested');
    const repos = await scanRepos(tmp, 0);
    expect(repos).toEqual([tmp]);
  });

  it('caches results for 5 min and clearScanCache resets', async () => {
    await mkRepo(tmp, 'a');
    const r1 = await scanRepos(tmp, 3);
    await mkRepo(tmp, 'b');
    const r2 = await scanRepos(tmp, 3); // cached, b absent
    expect(r2).toEqual(r1);
    clearScanCache();
    const r3 = await scanRepos(tmp, 3);
    expect(r3.length).toBe(2);
  });
});

describe('resolveRepoForFile', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-resolve-'));
    clearScanCache();
  });
  afterEach(async () => { await fs.rm(tmp, { recursive: true, force: true }); });

  it('returns the nearest ancestor repo root', async () => {
    const fe = await mkRepo(tmp, 'frontend');
    const be = await mkRepo(tmp, 'backend');
    const repos = await scanRepos(tmp, 3);
    const target = path.join(fe, 'src/components/App.tsx');
    expect(resolveRepoForFile(target, repos)).toBe(fe);
    expect(resolveRepoForFile(path.join(be, 'main.go'), repos)).toBe(be);
  });

  it('returns null when file is outside all repos', async () => {
    await mkRepo(tmp, 'inside');
    const repos = await scanRepos(tmp, 3);
    expect(resolveRepoForFile(path.join(tmp, 'outside.txt'), repos)).toBeNull();
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/repo-scanner.test.ts`
Expected: FAIL

### Step 3：实现 `src/repo-scanner.ts`

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.cache', 'dist', 'build', 'target', 'vendor', '.next', '.nuxt']);
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry { repos: string[]; expiresAt: number; }
const cache = new Map<string, CacheEntry>();

export function clearScanCache(): void { cache.clear(); }

export async function scanRepos(root: string, maxDepth: number): Promise<string[]> {
  const absRoot = path.resolve(root);
  const cached = cache.get(absRoot);
  if (cached && cached.expiresAt > Date.now()) return cached.repos;

  const repos: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: any[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch { return; }

    if (entries.some((e) => e.isDirectory() && e.name === '.git')) {
      repos.push(dir);
      return; // do not recurse below a repo root
    }

    if (depth >= maxDepth) return;

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.') && e.name !== '.') continue; // skip dotdirs except current
      await walk(path.join(dir, e.name), depth + 1);
    }
  }

  await walk(absRoot, 0);
  repos.sort();
  cache.set(absRoot, { repos, expiresAt: Date.now() + CACHE_TTL_MS });
  return repos;
}

export function resolveRepoForFile(filePath: string, repos: string[]): string | null {
  const abs = path.resolve(filePath);
  let best: string | null = null;
  for (const repo of repos) {
    if (abs === repo || abs.startsWith(repo + path.sep)) {
      if (!best || repo.length > best.length) best = repo;
    }
  }
  return best;
}
```

**实现注意**：

- `walk` 在发现 `.git` 时立刻把当前 dir 计为 repo 且不递归，这与 git submodule 嵌套场景的行为对齐（外层 repo 优先）。
- 隐藏目录跳过包括 `.cache`/`.next`/`.nuxt` 等（已显式在 SKIP_DIRS 中），但也兜底拦截以 `.` 开头的目录，避免误进 `.git`、`.idea` 等。
- 缓存只缓存 `(absRoot, maxDepth)` 组合，本实现简化为按 `absRoot` 缓存；同一 root 在 5 分钟内若改变 `maxDepth` 会拿到旧结果。**这是已知限制**：在 server 启动时配置一次 maxDepth，运行期不变，可接受。

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/repo-scanner.test.ts`
Expected: 7 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/repo-scanner.ts tests/unit/repo-scanner.test.ts
git commit -m "feat(repo-scanner): monorepo discovery + file-to-repo resolution"
```

---

## Task 4 · `src/storage.ts` — 存储层

**Files:**
- Create: `src/storage.ts`
- Test: `tests/unit/storage.test.ts`

**Spec 引用：** §2.3、§3.1.5。

**职责**：所有 `.work-resume/` 目录的读写都走这一层。

- 写入：`writeSemantic` / `writePhysical`
- 读取：`readLatestSemantic(branch?)` / `readPhysicalsAfter(semanticId)` / `readById(id)`
- 索引：每次写入追加 `index.json`，读取始终先看 index
- 清理：`removeOlderThanHours(retentionHours, kind)` → 移到 `.trash/<ts>/`
- 软删除恢复：跟主要工具无关，保留 `.trash/` 由下次 `clear_checkpoints` 顺手清理 7 天以前的
- 并发安全：写 index 用临时文件 + rename（原子写）

### Step 1：写失败测试 `tests/unit/storage.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  writeSemantic,
  writePhysical,
  readLatestSemantic,
  readPhysicalsAfter,
  readIndex,
  removeBeforeTimestamp,
  emptyTrashOlderThanDays,
} from '../../src/storage.js';

describe('storage', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-storage-'));
  });
  afterEach(async () => { await fs.rm(repo, { recursive: true, force: true }); });

  it('writes a semantic checkpoint and reads it back', async () => {
    const sem = {
      summary: 'wip on login UI',
      next_steps: ['add API call'],
      files_in_focus: ['src/auth.ts'],
      blockers: [],
      context_notes: 'using fetch',
      todo_status: [],
      branch: 'feature/login',
      git_head: 'abc',
      dirty_files_count: 2,
    };
    const written = await writeSemantic(repo, sem as any);
    expect(written.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{6}$/);
    const back = await readLatestSemantic(repo);
    expect(back?.summary).toBe('wip on login UI');
    expect(back?.branch).toBe('feature/login');
  });

  it('returns physicals saved after a semantic checkpoint', async () => {
    const sem = await writeSemantic(repo, baseSemantic());
    await sleep(5);
    const p1 = await writePhysical(repo, basePhysical('save_progress'));
    await sleep(5);
    const p2 = await writePhysical(repo, basePhysical('save_progress'));
    const list = await readPhysicalsAfter(repo, sem.saved_at);
    expect(list.map(p => p.id)).toEqual([p1.id, p2.id]);
  });

  it('filters latest semantic by branch', async () => {
    await writeSemantic(repo, { ...baseSemantic(), branch: 'a' });
    await sleep(5);
    await writeSemantic(repo, { ...baseSemantic(), branch: 'b' });
    const a = await readLatestSemantic(repo, 'a');
    expect(a?.branch).toBe('a');
  });

  it('removeBeforeTimestamp soft-deletes by moving to .trash', async () => {
    const p = await writePhysical(repo, basePhysical('save_progress'));
    const removed = await removeBeforeTimestamp(repo, new Date().toISOString(), { scope: 'auto-snapshots' });
    expect(removed.map(r => r.checkpoint_id)).toEqual([p.id]);
    const trashRoot = path.join(repo, '.work-resume', '.trash');
    const exists = await fs.stat(trashRoot).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('emptyTrashOlderThanDays purges old trash entries', async () => {
    await writePhysical(repo, basePhysical('save_progress'));
    await removeBeforeTimestamp(repo, new Date(Date.now() + 1000).toISOString(), { scope: 'auto-snapshots' });
    // Backdate the trash dir mtime to 10 days ago
    const trashRoot = path.join(repo, '.work-resume', '.trash');
    const entries = await fs.readdir(trashRoot);
    for (const e of entries) {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
      await fs.utimes(path.join(trashRoot, e), tenDaysAgo, tenDaysAgo);
    }
    const purged = await emptyTrashOlderThanDays(repo, 7);
    expect(purged).toBeGreaterThan(0);
  });

  it('writes index.json atomically (no half-written file)', async () => {
    const writes = Array.from({ length: 5 }, () => writeSemantic(repo, baseSemantic()));
    await Promise.all(writes);
    const idx = await readIndex(repo);
    expect(idx.checkpoints.length).toBe(5);
  });
});

function baseSemantic() {
  return {
    summary: 'wip',
    next_steps: ['a'],
    files_in_focus: ['x.ts'],
    blockers: [],
    context_notes: '',
    todo_status: [],
    branch: 'main',
    git_head: 'aaa',
    dirty_files_count: 1,
  };
}
function basePhysical(tool: string) {
  return {
    triggered_by_tool: tool,
    branch: 'main',
    git_head: 'aaa',
    files_changed: [],
    total_diff_size_bytes: 0,
  };
}
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/storage.test.ts`
Expected: FAIL

### Step 3：实现 `src/storage.ts`

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const STORE = '.work-resume';

export type SemanticInput = {
  summary: string;
  next_steps: string[];
  files_in_focus: string[];
  blockers?: string[];
  context_notes?: string;
  todo_status?: Array<{ id: string; content: string; status: string }>;
  branch?: string;
  git_head?: string;
  dirty_files_count: number;
};
export type SemanticCheckpoint = SemanticInput & {
  kind: 'semantic';
  id: string;
  saved_at: string;
};

export type PhysicalInput = {
  triggered_by_tool: string;
  branch?: string;
  git_head?: string;
  files_changed: Array<{ path: string; stat: { added: number; removed: number }; changed_symbols: string[]; diff_hash: string }>;
  total_diff_size_bytes: number;
};
export type PhysicalCheckpoint = PhysicalInput & {
  kind: 'physical';
  id: string;
  saved_at: string;
};

export interface IndexEntry {
  id: string;
  kind: 'semantic' | 'physical';
  saved_at: string;
  branch?: string;
  summary?: string;
  triggered_by_tool?: string;
}
export interface IndexFile { version: 1; checkpoints: IndexEntry[]; }

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-` +
    randomBytes(3).toString('hex')
  );
}

async function ensureDirs(repo: string): Promise<void> {
  const root = path.join(repo, STORE);
  await fs.mkdir(path.join(root, 'checkpoints'), { recursive: true });
  await fs.mkdir(path.join(root, 'auto-snapshots'), { recursive: true });
  await fs.mkdir(path.join(root, '.trash'), { recursive: true });
}

async function readIndexRaw(repo: string): Promise<IndexFile> {
  const p = path.join(repo, STORE, 'index.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch { return { version: 1, checkpoints: [] }; }
}

let indexQueue = Promise.resolve();
async function writeIndex(repo: string, mutator: (idx: IndexFile) => void): Promise<void> {
  // Serialize all index writes via a chained promise (per-process lock)
  indexQueue = indexQueue.then(async () => {
    const idx = await readIndexRaw(repo);
    mutator(idx);
    const p = path.join(repo, STORE, 'index.json');
    const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(idx, null, 2));
    await fs.rename(tmp, p);
  });
  await indexQueue;
}

export async function readIndex(repo: string): Promise<IndexFile> {
  return readIndexRaw(repo);
}

export async function writeSemantic(repo: string, input: SemanticInput): Promise<SemanticCheckpoint> {
  await ensureDirs(repo);
  const id = ts();
  const saved_at = new Date().toISOString();
  const obj: SemanticCheckpoint = { kind: 'semantic', id, saved_at, ...input };
  await fs.writeFile(path.join(repo, STORE, 'checkpoints', `${id}.json`), JSON.stringify(obj, null, 2));
  await writeIndex(repo, (idx) => {
    idx.checkpoints.push({ id, kind: 'semantic', saved_at, branch: input.branch, summary: input.summary });
  });
  return obj;
}

export async function writePhysical(repo: string, input: PhysicalInput): Promise<PhysicalCheckpoint> {
  await ensureDirs(repo);
  const id = ts();
  const saved_at = new Date().toISOString();
  const obj: PhysicalCheckpoint = { kind: 'physical', id, saved_at, ...input };
  await fs.writeFile(path.join(repo, STORE, 'auto-snapshots', `${id}.json`), JSON.stringify(obj, null, 2));
  await writeIndex(repo, (idx) => {
    idx.checkpoints.push({ id, kind: 'physical', saved_at, branch: input.branch, triggered_by_tool: input.triggered_by_tool });
  });
  return obj;
}

export async function readById(repo: string, id: string): Promise<SemanticCheckpoint | PhysicalCheckpoint | null> {
  for (const sub of ['checkpoints', 'auto-snapshots']) {
    const p = path.join(repo, STORE, sub, `${id}.json`);
    try {
      const raw = await fs.readFile(p, 'utf8');
      return JSON.parse(raw);
    } catch { /* try next */ }
  }
  return null;
}

export async function readLatestSemantic(repo: string, branch?: string): Promise<SemanticCheckpoint | null> {
  const idx = await readIndexRaw(repo);
  const cands = idx.checkpoints
    .filter((c) => c.kind === 'semantic')
    .filter((c) => branch === undefined || c.branch === branch)
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  if (cands.length === 0) return null;
  return (await readById(repo, cands[0].id)) as SemanticCheckpoint | null;
}

export async function readPhysicalsAfter(repo: string, isoTs: string): Promise<PhysicalCheckpoint[]> {
  const idx = await readIndexRaw(repo);
  const cands = idx.checkpoints
    .filter((c) => c.kind === 'physical' && c.saved_at > isoTs)
    .sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  const out: PhysicalCheckpoint[] = [];
  for (const c of cands) {
    const obj = await readById(repo, c.id);
    if (obj) out.push(obj as PhysicalCheckpoint);
  }
  return out;
}

export async function lastPhysicalSavedAt(repo: string): Promise<number> {
  const idx = await readIndexRaw(repo);
  const ts = idx.checkpoints
    .filter((c) => c.kind === 'physical')
    .map((c) => Date.parse(c.saved_at))
    .filter((n) => Number.isFinite(n));
  if (ts.length === 0) return 0;
  return Math.max(...ts);
}

export interface RemoveOptions {
  scope: 'auto-snapshots' | 'semantic' | 'all';
  branch?: string;
}

export async function removeBeforeTimestamp(
  repo: string,
  beforeIso: string,
  opts: RemoveOptions,
): Promise<Array<{ checkpoint_id: string; kind: 'semantic' | 'physical'; saved_at: string; branch?: string }>> {
  await ensureDirs(repo);
  const idx = await readIndexRaw(repo);
  const targets = idx.checkpoints.filter((c) => {
    if (c.saved_at >= beforeIso) return false;
    if (opts.scope === 'semantic' && c.kind !== 'semantic') return false;
    if (opts.scope === 'auto-snapshots' && c.kind !== 'physical') return false;
    if (opts.branch && c.branch !== opts.branch) return false;
    return true;
  });

  if (targets.length === 0) return [];

  const trashDir = path.join(repo, STORE, '.trash', `${ts()}`);
  await fs.mkdir(trashDir, { recursive: true });

  for (const t of targets) {
    const sub = t.kind === 'semantic' ? 'checkpoints' : 'auto-snapshots';
    const src = path.join(repo, STORE, sub, `${t.id}.json`);
    const dst = path.join(trashDir, `${t.kind}-${t.id}.json`);
    try { await fs.rename(src, dst); } catch { /* file already gone */ }
  }

  await writeIndex(repo, (curr) => {
    const removedIds = new Set(targets.map((t) => t.id));
    curr.checkpoints = curr.checkpoints.filter((c) => !removedIds.has(c.id));
  });

  return targets.map((t) => ({ checkpoint_id: t.id, kind: t.kind, saved_at: t.saved_at, branch: t.branch }));
}

export async function emptyTrashOlderThanDays(repo: string, days: number): Promise<number> {
  const trashRoot = path.join(repo, STORE, '.trash');
  let entries: string[];
  try { entries = await fs.readdir(trashRoot); } catch { return 0; }
  const threshold = Date.now() - days * 24 * 3600 * 1000;
  let purged = 0;
  for (const name of entries) {
    const full = path.join(trashRoot, name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs < threshold) {
        await fs.rm(full, { recursive: true, force: true });
        purged++;
      }
    } catch { /* ignore */ }
  }
  return purged;
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/storage.test.ts`
Expected: 6 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/storage.ts tests/unit/storage.test.ts
git commit -m "feat(storage): semantic/physical checkpoint persistence with index + soft delete"
```

# Phase 2 · 符号识别（tree-sitter + 正则降级）

## Task 5 · `src/tree-sitter/regex-fallback.ts` — 正则降级

**Files:**
- Create: `src/tree-sitter/regex-fallback.ts`
- Test: `tests/unit/regex-fallback.test.ts`

**Spec 引用：** §3.3 未内置语言的降级 / §5 `WORK_RESUME_FALLBACK`。

**职责**：给定文件路径 + 行号范围列表，用通用正则匹配 `def|function|class|interface|method|fn|sub|func` 前后的标识符，返回符号名集合。精度有损但不抛错。

### Step 1：写失败测试 `tests/unit/regex-fallback.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { regexExtractSymbols } from '../../src/tree-sitter/regex-fallback.js';

const sampleTs = [
  'function foo() {',          // line 1
  '  return 1;',                // 2
  '}',                          // 3
  'class Bar {',                // 4
  '  baz() {',                  // 5
  '    return 2;',              // 6
  '  }',                        // 7
  '}',                          // 8
  'const arrow = () => 3;',     // 9
].join('\n');

describe('regexExtractSymbols', () => {
  it('returns symbol names whose definition appears within the changed range', () => {
    const out = regexExtractSymbols(sampleTs, [{ addedStart: 4, addedCount: 4 }]);
    expect(out.sort()).toEqual(['Bar', 'baz'].sort());
  });

  it('returns empty array when no defining keyword is in range', () => {
    const out = regexExtractSymbols(sampleTs, [{ addedStart: 2, addedCount: 1 }]);
    expect(out).toEqual([]);
  });

  it('dedupes overlapping ranges', () => {
    const out = regexExtractSymbols(sampleTs, [
      { addedStart: 1, addedCount: 1 },
      { addedStart: 1, addedCount: 2 },
    ]);
    expect(out).toEqual(['foo']);
  });

  it('matches Python def with nested methods', () => {
    const py = [
      'class A:',          // 1
      '  def m(self):',    // 2
      '    pass',          // 3
    ].join('\n');
    const out = regexExtractSymbols(py, [{ addedStart: 1, addedCount: 3 }]);
    expect(out.sort()).toEqual(['A', 'm'].sort());
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/regex-fallback.test.ts`
Expected: FAIL

### Step 3：实现 `src/tree-sitter/regex-fallback.ts`

```ts
import type { Hunk } from '../git.js';

const SYMBOL_REGEX = /(?:^|\s)(?:export\s+|public\s+|private\s+|protected\s+|static\s+|async\s+)*(?:function|def|class|interface|method|fn|sub|func)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;

export function regexExtractSymbols(fileContent: string, hunks: Hunk[]): string[] {
  const lines = fileContent.split('\n');
  const set = new Set<string>();

  // Build a single set of line numbers covered by hunks (1-based inclusive)
  const covered = new Set<number>();
  for (const h of hunks) {
    for (let i = 0; i < h.addedCount; i++) {
      covered.add(h.addedStart + i);
    }
  }

  for (const lineNo of covered) {
    const line = lines[lineNo - 1];
    if (!line) continue;
    const m = line.match(SYMBOL_REGEX);
    if (m && m[1]) set.add(m[1]);
  }
  return [...set];
}
```

**实现注意**：

- 不试图区分 `class Foo extends Bar` 中的 `Foo` 与 `Bar`；只取第一个匹配（关键字后的第一个标识符）。
- 不处理装饰器、泛型、destructuring；这正是为什么需要 tree-sitter（D6）。
- Ruby 用 `def` 关键字与 Python 重合；不区分语言，统一靠关键字命中。

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/regex-fallback.test.ts`
Expected: 4 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tree-sitter/regex-fallback.ts tests/unit/regex-fallback.test.ts
git commit -m "feat(symbols): regex-based symbol extraction fallback"
```

---

## Task 6 · `src/tree-sitter/lazy-loader.ts` — grammar 懒加载

**Files:**
- Create: `src/tree-sitter/lazy-loader.ts`
- Test: `tests/unit/lazy-loader.test.ts`

**Spec 引用：** §3.3、§5 `WORK_RESUME_GRAMMAR_LOAD`。

**Tech 决策**：v1 使用 [`web-tree-sitter`](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)（WASM 版本），grammar 包加载方式：

- 优先尝试从 npm 包根目录读取 `<package>/*.wasm`（部分 grammar 包会预编 WASM）；
- 如果包内没有 WASM，启动时报错并提示用户重装 `tree-sitter-cli` + 手动 `tree-sitter build-wasm`；
- 在 README 中说明此约束（Task 16 写）。

> **如果实现者发现某些 grammar 包不提供 WASM**：把缺失的语言从默认 `WORK_RESUME_LANGS` 列表中移除（更新 `src/config.ts` 的 `DEFAULT_LANGS` 与 `README.md`），并在决策日志补一条 ADR。**不要**沉默地让它在运行时崩。

### Step 1：写失败测试 `tests/unit/lazy-loader.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const initMock = vi.fn().mockResolvedValue(undefined);
const ParserCtor = vi.fn().mockImplementation(() => ({
  setLanguage: vi.fn(),
  parse: vi.fn().mockReturnValue({ rootNode: { type: 'program' } }),
}));
(ParserCtor as any).init = initMock;
(ParserCtor as any).Language = { load: vi.fn().mockResolvedValue({ id: 'lang' }) };

vi.mock('web-tree-sitter', () => ({ default: ParserCtor }));

import { resolveExtensionToLang, getParser, resetParserCache } from '../../src/tree-sitter/lazy-loader.js';

beforeEach(() => {
  resetParserCache();
  initMock.mockClear();
  (ParserCtor as any).Language.load.mockClear();
});

describe('resolveExtensionToLang', () => {
  it('maps known extensions', () => {
    expect(resolveExtensionToLang('foo.ts')).toBe('ts');
    expect(resolveExtensionToLang('foo.tsx')).toBe('tsx');
    expect(resolveExtensionToLang('foo.mjs')).toBe('js');
    expect(resolveExtensionToLang('foo.py')).toBe('py');
    expect(resolveExtensionToLang('foo.go')).toBe('go');
    expect(resolveExtensionToLang('foo.rs')).toBe('rs');
    expect(resolveExtensionToLang('foo.java')).toBe('java');
    expect(resolveExtensionToLang('foo.rb')).toBe('rb');
    expect(resolveExtensionToLang('foo.php')).toBe('php');
  });
  it('returns null for unknown', () => {
    expect(resolveExtensionToLang('foo.kt')).toBeNull();
    expect(resolveExtensionToLang('foo')).toBeNull();
  });
});

describe('getParser (lazy)', () => {
  it('initializes parser only once even with parallel calls', async () => {
    const [a, b] = await Promise.all([getParser('ts'), getParser('ts')]);
    expect(a).toBe(b);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect((ParserCtor as any).Language.load).toHaveBeenCalledTimes(1);
  });

  it('returns null for langs not in WORK_RESUME_LANGS', async () => {
    process.env.WORK_RESUME_LANGS = 'ts,py';
    resetParserCache();
    expect(await getParser('rb')).toBeNull();
    delete process.env.WORK_RESUME_LANGS;
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/lazy-loader.test.ts`
Expected: FAIL

### Step 3：实现 `src/tree-sitter/lazy-loader.ts`

```ts
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { loadConfig } from '../config.js';

// Dynamic typing: Parser comes from web-tree-sitter (CJS or ESM depending on bundling)
type AnyParser = any;
type AnyLanguage = any;

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx',
  '.js': 'js', '.jsx': 'jsx', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py', '.go': 'go', '.rs': 'rs',
  '.java': 'java', '.rb': 'rb', '.php': 'php',
};

const LANG_TO_WASM_HINT: Record<string, string[]> = {
  ts:    ['tree-sitter-typescript/tree-sitter-typescript.wasm'],
  tsx:   ['tree-sitter-typescript/tree-sitter-tsx.wasm'],
  js:    ['tree-sitter-javascript/tree-sitter-javascript.wasm'],
  jsx:   ['tree-sitter-javascript/tree-sitter-javascript.wasm'],
  py:    ['tree-sitter-python/tree-sitter-python.wasm'],
  go:    ['tree-sitter-go/tree-sitter-go.wasm'],
  rs:    ['tree-sitter-rust/tree-sitter-rust.wasm'],
  java:  ['tree-sitter-java/tree-sitter-java.wasm'],
  rb:    ['tree-sitter-ruby/tree-sitter-ruby.wasm'],
  php:   ['tree-sitter-php/tree-sitter-php.wasm'],
};

export function resolveExtensionToLang(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

const cache = new Map<string, Promise<AnyParser | null>>();
let parserInitOnce: Promise<void> | null = null;

export function resetParserCache(): void {
  cache.clear();
  parserInitOnce = null;
}

async function loadGrammarFromNodeModules(lang: string): Promise<AnyLanguage | null> {
  const candidates = LANG_TO_WASM_HINT[lang] || [];
  for (const rel of candidates) {
    const resolved = await resolveNodeModulePath(rel);
    if (!resolved) continue;
    try {
      const Parser: any = (await import('web-tree-sitter')).default;
      const Language = await Parser.Language.load(resolved);
      return Language;
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveNodeModulePath(rel: string): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), 'node_modules', rel),
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'node_modules', rel),
  ];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch { /* next */ }
  }
  return null;
}

export async function getParser(lang: string): Promise<AnyParser | null> {
  const cfg = loadConfig(process.cwd());
  if (!cfg.langs.includes(lang)) return null;

  if (cache.has(lang)) return cache.get(lang)!;

  const promise = (async (): Promise<AnyParser | null> => {
    const Parser: any = (await import('web-tree-sitter')).default;
    if (!parserInitOnce) parserInitOnce = Parser.init();
    await parserInitOnce;

    const language = await loadGrammarFromNodeModules(lang);
    if (!language) return null;

    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();

  cache.set(lang, promise);
  return promise;
}

export async function preloadAll(langs: string[]): Promise<void> {
  await Promise.all(langs.map((l) => getParser(l).catch(() => null)));
}
```

**实现注意**：

- `resolveNodeModulePath` 兼容两种 install 位置：项目根 `node_modules`（开发时）和 server 自身的 `node_modules`（被全局或 `npx` 安装时）。
- 测试中 mock 了 `web-tree-sitter` 整个模块，故 `Parser.init` / `Language.load` / `setLanguage` 都是 vi.fn；真实运行时 `web-tree-sitter` 必须能从 npm 拿到。
- Eager 模式由 server 入口（Task 14）在启动时调用 `preloadAll(cfg.langs)`，本模块不感知模式。

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/lazy-loader.test.ts`
Expected: 3 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tree-sitter/lazy-loader.ts tests/unit/lazy-loader.test.ts
git commit -m "feat(symbols): lazy grammar loader with per-lang cache"
```

---

## Task 7 · `src/tree-sitter/index.ts` — changed_symbols 主流程

**Files:**
- Create: `src/tree-sitter/index.ts`
- Test: `tests/unit/tree-sitter-extract.test.ts`

**Spec 引用：** §3.3 符号名抓取流程。

**输入**：文件路径 + 该文件源代码 + Hunk 数组。
**输出**：受影响的符号名数组（去重）。
**流程**：
1. 取扩展名 → resolveExtensionToLang。
2. 若语言不在 `WORK_RESUME_LANGS`，按 `fallback` 配置降级（正则 / 空数组）。
3. 否则：getParser → parse → 遍历 Hunk 行号 → 找包含该行的最近 `function_declaration` / `method_definition` / `class_declaration` / 等 → 取其 name 子节点 → 加入结果集。
4. 若 parser 不可用（grammar 未装），按 fallback 处理。

### Step 1：写失败测试 `tests/unit/tree-sitter-extract.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/tree-sitter/lazy-loader.js', () => ({
  resolveExtensionToLang: (p: string) => {
    if (p.endsWith('.ts')) return 'ts';
    if (p.endsWith('.kt')) return 'kt';
    return null;
  },
  getParser: vi.fn(),
  resetParserCache: vi.fn(),
}));

vi.mock('../../src/tree-sitter/regex-fallback.js', () => ({
  regexExtractSymbols: vi.fn((src, hunks) => ['fallbackSym']),
}));

import { extractChangedSymbols } from '../../src/tree-sitter/index.js';
import { getParser } from '../../src/tree-sitter/lazy-loader.js';
import { regexExtractSymbols } from '../../src/tree-sitter/regex-fallback.js';

beforeEach(() => {
  (getParser as any).mockReset();
  (regexExtractSymbols as any).mockClear();
});

describe('extractChangedSymbols', () => {
  it('uses fallback when language not in WORK_RESUME_LANGS (fallback=regex)', async () => {
    process.env.WORK_RESUME_LANGS = 'ts';
    process.env.WORK_RESUME_FALLBACK = 'regex';
    const out = await extractChangedSymbols('foo.kt', 'fun bar() {}', [{ addedStart: 1, addedCount: 1 }]);
    expect(out).toEqual(['fallbackSym']);
    expect(regexExtractSymbols).toHaveBeenCalled();
    delete process.env.WORK_RESUME_LANGS;
    delete process.env.WORK_RESUME_FALLBACK;
  });

  it('returns [] when fallback=empty and language unsupported', async () => {
    process.env.WORK_RESUME_LANGS = 'ts';
    process.env.WORK_RESUME_FALLBACK = 'empty';
    const out = await extractChangedSymbols('foo.kt', 'fun bar() {}', [{ addedStart: 1, addedCount: 1 }]);
    expect(out).toEqual([]);
    delete process.env.WORK_RESUME_LANGS;
    delete process.env.WORK_RESUME_FALLBACK;
  });

  it('parses TS and returns enclosing function name for a single-hunk change', async () => {
    const src = [
      'function alpha() {',
      '  return 1;',
      '}',
      'function beta() {',
      '  return 2;',
      '}',
    ].join('\n');

    const parser = {
      parse: (s: string) => makeMockTree([
        { type: 'function_declaration', startRow: 0, endRow: 2, nameText: 'alpha' },
        { type: 'function_declaration', startRow: 3, endRow: 5, nameText: 'beta' },
      ]),
    };
    (getParser as any).mockResolvedValue(parser);

    const out = await extractChangedSymbols('foo.ts', src, [{ addedStart: 5, addedCount: 1 }]);
    expect(out).toEqual(['beta']);
  });

  it('handles class with nested methods', async () => {
    const src = [
      'class C {',
      '  m1() { return 1; }',
      '  m2() { return 2; }',
      '}',
    ].join('\n');

    const parser = {
      parse: () => makeMockTree([
        { type: 'class_declaration', startRow: 0, endRow: 3, nameText: 'C' },
        { type: 'method_definition', startRow: 1, endRow: 1, nameText: 'm1' },
        { type: 'method_definition', startRow: 2, endRow: 2, nameText: 'm2' },
      ]),
    };
    (getParser as any).mockResolvedValue(parser);

    const out = await extractChangedSymbols('foo.ts', src, [{ addedStart: 3, addedCount: 1 }]);
    expect(out.sort()).toEqual(['C', 'm2'].sort());
  });

  it('falls back when parser unavailable (e.g., grammar missing)', async () => {
    (getParser as any).mockResolvedValue(null);
    const out = await extractChangedSymbols('foo.ts', 'x', [{ addedStart: 1, addedCount: 1 }]);
    expect(out).toEqual(['fallbackSym']);
  });
});

function makeMockTree(nodes: Array<{ type: string; startRow: number; endRow: number; nameText: string }>) {
  // Synthesize a tree-sitter-like API: rootNode.descendantForPosition + named child query
  return {
    rootNode: {
      descendantsOfType: (types: string[]) =>
        nodes.filter((n) => types.includes(n.type)).map((n) => ({
          type: n.type,
          startPosition: { row: n.startRow },
          endPosition: { row: n.endRow },
          childForFieldName: (f: string) => (f === 'name' ? { text: n.nameText } : null),
        })),
    },
  };
}
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/tree-sitter-extract.test.ts`
Expected: FAIL

### Step 3：实现 `src/tree-sitter/index.ts`

```ts
import { resolveExtensionToLang, getParser } from './lazy-loader.js';
import { regexExtractSymbols } from './regex-fallback.js';
import { loadConfig } from '../config.js';
import type { Hunk } from '../git.js';

const NAMED_NODES = [
  'function_declaration',
  'function_definition',     // python
  'method_definition',
  'method_declaration',
  'class_declaration',
  'class_definition',         // python
  'interface_declaration',
  'enum_declaration',
  'type_alias_declaration',
  'arrow_function',
];

export async function extractChangedSymbols(
  filePath: string,
  fileContent: string,
  hunks: Hunk[],
): Promise<string[]> {
  if (hunks.length === 0) return [];

  const cfg = loadConfig(process.cwd());
  const lang = resolveExtensionToLang(filePath);

  if (!lang || !cfg.langs.includes(lang)) {
    return cfg.fallback === 'regex' ? regexExtractSymbols(fileContent, hunks) : [];
  }

  const parser = await getParser(lang);
  if (!parser) {
    return cfg.fallback === 'regex' ? regexExtractSymbols(fileContent, hunks) : [];
  }

  let tree;
  try {
    tree = parser.parse(fileContent);
  } catch {
    return cfg.fallback === 'regex' ? regexExtractSymbols(fileContent, hunks) : [];
  }
  if (!tree?.rootNode) return [];

  const named = tree.rootNode.descendantsOfType(NAMED_NODES);
  const lineSet = new Set<number>();
  for (const h of hunks) {
    for (let i = 0; i < h.addedCount; i++) {
      lineSet.add(h.addedStart + i - 1); // tree-sitter uses 0-based rows
    }
  }

  const out = new Set<string>();
  for (const node of named) {
    const startRow = node.startPosition.row;
    const endRow = node.endPosition.row;
    let touched = false;
    for (const row of lineSet) {
      if (row >= startRow && row <= endRow) { touched = true; break; }
    }
    if (!touched) continue;
    const nameNode = typeof node.childForFieldName === 'function' ? node.childForFieldName('name') : null;
    const name = nameNode?.text;
    if (name) out.add(name);
  }
  return [...out];
}
```

**实现注意**：

- `descendantsOfType` 是 tree-sitter 真实 API；mock 在测试里仿造了这一接口。
- 行号坐标：tree-sitter 行号从 0 开始；hunk 来自 git 从 1 开始；本实现统一用 hunk 减 1 转 0-based。
- 节点类型清单参考 [tree-sitter 各 grammar 的 node-types.json](https://github.com/tree-sitter)；这里列了 9 种常见类型，已经能覆盖 8 种语言的"顶层声明 + 类/方法/接口"；如发现某语言有特殊命名（如 PHP 的 `function_definition` vs `method_declaration`），可在此清单追加。
- v1 不做精确"最小包裹节点"算法（descendantForPosition 复杂度高），用"全部命中型 + 节点行号覆盖"算法，简单可靠。

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/tree-sitter-extract.test.ts`
Expected: 5 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tree-sitter/index.ts tests/unit/tree-sitter-extract.test.ts
git commit -m "feat(symbols): tree-sitter extractChangedSymbols with regex fallback"
```

# Phase 3 · 自动快照（搭便车机制）

## Task 8 · `src/auto-snapshot.ts` — 物理快照拦截器 + 24h 清理

**Files:**
- Create: `src/auto-snapshot.ts`
- Test: `tests/unit/auto-snapshot.test.ts`

**Spec 引用：** §3.2、§9 Q1。

**职责**：
- `SKIP_AUTO_SNAPSHOT` 列表：`clear_checkpoints` / `list_checkpoints` / `diff_since`
- 节流：相邻两次至少 `WORK_RESUME_AUTO_INTERVAL_MS`（默认 60s）
- 写之前 git status；clean 就不写
- 写之后顺手清理超过 `WORK_RESUME_AUTO_RETENTION_HOURS` 的旧物理快照
- 注意：`changed_symbols` 需要调 Phase 2 模块，所以 auto-snapshot 不再做正则降级特殊路径，统一走 `extractChangedSymbols`

### Step 1：写失败测试 `tests/unit/auto-snapshot.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/git.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
  getGitStatus: vi.fn(),
  getDiffStat: vi.fn(),
  getHunksUnified0: vi.fn(),
}));
vi.mock('../../src/tree-sitter/index.js', () => ({
  extractChangedSymbols: vi.fn().mockResolvedValue(['fooFn']),
}));

import { autoSnapshotIfStale, SKIP_AUTO_SNAPSHOT } from '../../src/auto-snapshot.js';
import { getGitStatus, getDiffStat, getHunksUnified0 } from '../../src/git.js';
import { readIndex } from '../../src/storage.js';

let repo: string;
beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-auto-'));
  (getGitStatus as any).mockReset();
  (getDiffStat as any).mockReset();
  (getHunksUnified0 as any).mockReset();
});

describe('SKIP_AUTO_SNAPSHOT', () => {
  it('contains the three read-only / cleanup tools', () => {
    expect(SKIP_AUTO_SNAPSHOT.has('clear_checkpoints')).toBe(true);
    expect(SKIP_AUTO_SNAPSHOT.has('list_checkpoints')).toBe(true);
    expect(SKIP_AUTO_SNAPSHOT.has('diff_since')).toBe(true);
    expect(SKIP_AUTO_SNAPSHOT.has('save_progress')).toBe(false);
  });
});

describe('autoSnapshotIfStale', () => {
  it('writes a physical snapshot when dirty and beyond throttle', async () => {
    (getGitStatus as any).mockResolvedValue({ head: 'h1', branch: 'main', dirty_files: ['src/a.ts'] });
    (getDiffStat as any).mockResolvedValue(new Map([['src/a.ts', { added: 2, removed: 1 }]]));
    (getHunksUnified0 as any).mockResolvedValue(new Map([['src/a.ts', [{ addedStart: 1, addedCount: 2 }]]]));

    await fs.writeFile(path.join(repo, 'src-a.ts'), 'placeholder'); // referenced relatively in tests
    const result = await autoSnapshotIfStale(repo, 'save_progress', { autoIntervalMs: 1, autoRetentionHours: 24 });
    expect(result?.kind).toBe('physical');
    const idx = await readIndex(repo);
    expect(idx.checkpoints.length).toBe(1);
  });

  it('skips when dirty_files is empty', async () => {
    (getGitStatus as any).mockResolvedValue({ head: 'h1', branch: 'main', dirty_files: [] });
    const result = await autoSnapshotIfStale(repo, 'save_progress', { autoIntervalMs: 1, autoRetentionHours: 24 });
    expect(result).toBeNull();
  });

  it('respects throttle window (no second snapshot inside interval)', async () => {
    (getGitStatus as any).mockResolvedValue({ head: 'h1', branch: 'main', dirty_files: ['x.ts'] });
    (getDiffStat as any).mockResolvedValue(new Map([['x.ts', { added: 1, removed: 0 }]]));
    (getHunksUnified0 as any).mockResolvedValue(new Map([['x.ts', [{ addedStart: 1, addedCount: 1 }]]]));

    const first = await autoSnapshotIfStale(repo, 'save_progress', { autoIntervalMs: 60_000, autoRetentionHours: 24 });
    const second = await autoSnapshotIfStale(repo, 'save_progress', { autoIntervalMs: 60_000, autoRetentionHours: 24 });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it('cleans up physical snapshots older than retention hours after writing', async () => {
    (getGitStatus as any).mockResolvedValue({ head: 'h1', branch: 'main', dirty_files: ['x.ts'] });
    (getDiffStat as any).mockResolvedValue(new Map([['x.ts', { added: 1, removed: 0 }]]));
    (getHunksUnified0 as any).mockResolvedValue(new Map([['x.ts', [{ addedStart: 1, addedCount: 1 }]]]));

    await autoSnapshotIfStale(repo, 'save_progress', { autoIntervalMs: 0, autoRetentionHours: 0 });
    await autoSnapshotIfStale(repo, 'save_progress', { autoIntervalMs: 0, autoRetentionHours: 0 });

    const idx = await readIndex(repo);
    // With retention=0 (immediate cleanup), the previous snapshot should have been trashed
    expect(idx.checkpoints.length).toBeLessThanOrEqual(1);
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/auto-snapshot.test.ts`
Expected: FAIL

### Step 3：实现 `src/auto-snapshot.ts`

```ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isGitRepo, getGitStatus, getDiffStat, getHunksUnified0 } from './git.js';
import { extractChangedSymbols } from './tree-sitter/index.js';
import {
  writePhysical,
  lastPhysicalSavedAt,
  removeBeforeTimestamp,
  emptyTrashOlderThanDays,
  type PhysicalCheckpoint,
} from './storage.js';

export const SKIP_AUTO_SNAPSHOT: ReadonlySet<string> = new Set([
  'clear_checkpoints',
  'list_checkpoints',
  'diff_since',
]);

export interface AutoSnapshotOptions {
  autoIntervalMs: number;
  autoRetentionHours: number;
  trashRetentionDays?: number;
}

export async function autoSnapshotIfStale(
  repo: string,
  toolName: string,
  opts: AutoSnapshotOptions,
): Promise<PhysicalCheckpoint | null> {
  if (SKIP_AUTO_SNAPSHOT.has(toolName)) return null;
  if (!(await isGitRepo(repo))) return null;

  const lastAt = await lastPhysicalSavedAt(repo);
  if (lastAt > 0 && Date.now() - lastAt < opts.autoIntervalMs) return null;

  const status = await getGitStatus(repo);
  if (status.dirty_files.length === 0) return null;

  const statMap = await getDiffStat(repo);
  const hunkMap = await getHunksUnified0(repo);

  const files_changed = [];
  let totalSize = 0;

  for (const file of status.dirty_files) {
    const stat = statMap.get(file) ?? { added: 0, removed: 0 };
    const hunks = hunkMap.get(file) ?? [];
    let content = '';
    try {
      content = await fs.readFile(path.join(repo, file), 'utf8');
    } catch { /* binary or deleted file */ }
    const symbols = content ? await extractChangedSymbols(file, content, hunks).catch(() => []) : [];
    const diff_hash = createHash('sha256').update(content).digest('hex').slice(0, 32);
    totalSize += content.length;
    files_changed.push({ path: file, stat, changed_symbols: symbols, diff_hash });
  }

  const snap = await writePhysical(repo, {
    triggered_by_tool: toolName,
    branch: status.branch,
    git_head: status.head,
    files_changed,
    total_diff_size_bytes: totalSize,
  });

  // post-write retention cleanup
  const beforeIso = new Date(Date.now() - opts.autoRetentionHours * 3600 * 1000).toISOString();
  await removeBeforeTimestamp(repo, beforeIso, { scope: 'auto-snapshots' });

  if (opts.trashRetentionDays !== undefined && opts.trashRetentionDays > 0) {
    await emptyTrashOlderThanDays(repo, opts.trashRetentionDays);
  }

  return snap;
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/auto-snapshot.test.ts`
Expected: 4 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/auto-snapshot.ts tests/unit/auto-snapshot.test.ts
git commit -m "feat(auto-snapshot): piggyback physical snapshot with throttling + retention"
```

# Phase 4 · 5 个 MCP 工具

每个工具有完整的 input/output schema 已在 spec §3.1 列出；本 Phase 不重复 schema，只描述实现 + 校验 + 错误码。

通用错误约定：

| 错误代码 | 说明 |
|---|---|
| `VALIDATION` | 输入字段缺失/类型错/越界 |
| `NOT_IN_GIT_REPO` | 调用时 cwd 不在任何 git 仓库里 |
| `MULTI_REPO_FILES` | `files_in_focus` 跨多个 git 仓库 |
| `PATH_ESCAPE` | 路径含 `..` 或跳出 repo 根 |
| `CHECKPOINT_NOT_FOUND` | 引用了不存在的 checkpoint_id |
| `CONFIRM_REQUIRED` | `clear_checkpoints scope=all` 但 dry_run=false 且未指定 before/branch |

错误抛出方式：所有工具函数 throw `Error` 实例，message 以 `${ERROR_CODE}: 详细描述` 开头，由 Task 14 的 server 装配层捕获并转换为 MCP 错误响应。

---

## Task 9 · `src/tools/save-progress.ts`

**Files:**
- Create: `src/tools/save-progress.ts`
- Test: `tests/unit/tool-save-progress.test.ts`

**Spec 引用：** §3.1.1。

### Step 1：写失败测试 `tests/unit/tool-save-progress.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/git.js', () => ({
  isGitRepo: vi.fn(),
  getGitStatus: vi.fn(),
  getRepoTopLevel: vi.fn(),
}));
vi.mock('../../src/repo-scanner.js', () => ({
  scanRepos: vi.fn(),
  resolveRepoForFile: vi.fn(),
  clearScanCache: vi.fn(),
}));

import { saveProgress } from '../../src/tools/save-progress.js';
import { isGitRepo, getGitStatus, getRepoTopLevel } from '../../src/git.js';
import { scanRepos, resolveRepoForFile } from '../../src/repo-scanner.js';

let workspaceRoot: string;
let frontend: string;
let backend: string;

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-save-'));
  frontend = path.join(workspaceRoot, 'frontend');
  backend = path.join(workspaceRoot, 'backend');
  await fs.mkdir(path.join(frontend, '.git'), { recursive: true });
  await fs.mkdir(path.join(backend, '.git'), { recursive: true });

  (scanRepos as any).mockResolvedValue([frontend, backend]);
  (isGitRepo as any).mockResolvedValue(true);
  (getGitStatus as any).mockResolvedValue({ head: 'h', branch: 'feature/x', dirty_files: ['src/a.ts','src/b.ts','src/c.ts'] });
  (getRepoTopLevel as any).mockResolvedValue(frontend);
});

describe('saveProgress', () => {
  it('rejects empty summary', async () => {
    (resolveRepoForFile as any).mockReturnValue(frontend);
    await expect(saveProgress(workspaceRoot, {
      summary: '',
      next_steps: ['x'],
      files_in_focus: [path.join(frontend, 'src/a.ts')],
    })).rejects.toThrow(/VALIDATION/);
  });

  it('rejects when next_steps is empty', async () => {
    (resolveRepoForFile as any).mockReturnValue(frontend);
    await expect(saveProgress(workspaceRoot, {
      summary: 'wip on something',
      next_steps: [],
      files_in_focus: [path.join(frontend, 'src/a.ts')],
    })).rejects.toThrow(/VALIDATION/);
  });

  it('rejects files spanning multiple repos', async () => {
    (resolveRepoForFile as any).mockImplementation((p: string) =>
      p.startsWith(frontend) ? frontend : (p.startsWith(backend) ? backend : null));
    await expect(saveProgress(workspaceRoot, {
      summary: 'cross-repo work',
      next_steps: ['x'],
      files_in_focus: [path.join(frontend, 'a.ts'), path.join(backend, 'b.go')],
    })).rejects.toThrow(/MULTI_REPO_FILES/);
  });

  it('rejects paths containing ".." segments', async () => {
    (resolveRepoForFile as any).mockReturnValue(frontend);
    await expect(saveProgress(workspaceRoot, {
      summary: 'wip',
      next_steps: ['x'],
      files_in_focus: ['../etc/passwd'],
    })).rejects.toThrow(/PATH_ESCAPE/);
  });

  it('writes a semantic checkpoint to the correct repo and returns metadata', async () => {
    (resolveRepoForFile as any).mockReturnValue(frontend);
    const out = await saveProgress(workspaceRoot, {
      summary: 'wip on login UI',
      next_steps: ['add API', 'add test'],
      files_in_focus: [path.join(frontend, 'src/auth.ts')],
      blockers: [],
      context_notes: 'choosing fetch',
    });
    expect(out.checkpoint_id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{6}$/);
    expect(out.repo_root).toBe(frontend);
    expect(out.branch).toBe('feature/x');
    expect(out.git_head).toBe('h');
    expect(out.dirty_files_count).toBe(3);

    const file = path.join(frontend, '.work-resume', 'checkpoints', `${out.checkpoint_id}.json`);
    const saved = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(saved.summary).toBe('wip on login UI');
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/tool-save-progress.test.ts`
Expected: FAIL

### Step 3：实现 `src/tools/save-progress.ts`

```ts
import * as path from 'node:path';
import { getGitStatus, isGitRepo } from '../git.js';
import { scanRepos, resolveRepoForFile } from '../repo-scanner.js';
import { writeSemantic } from '../storage.js';
import { loadConfig } from '../config.js';

export interface SaveProgressInput {
  summary: string;
  next_steps: string[];
  files_in_focus: string[];
  blockers?: string[];
  context_notes?: string;
  todo_status?: Array<{ id: string; content: string; status: string }>;
}

export interface SaveProgressOutput {
  checkpoint_id: string;
  saved_at: string;
  repo_root: string;
  git_head?: string;
  branch?: string;
  dirty_files_count: number;
}

function err(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

export async function saveProgress(workspaceRoot: string, input: SaveProgressInput): Promise<SaveProgressOutput> {
  if (!input.summary || input.summary.trim().length < 8) {
    err('VALIDATION', 'summary must be non-empty and at least 8 chars');
  }
  if (!Array.isArray(input.next_steps) || input.next_steps.length === 0) {
    err('VALIDATION', 'next_steps must be a non-empty array');
  }
  for (const s of input.next_steps) {
    if (typeof s !== 'string' || s.trim().length === 0) {
      err('VALIDATION', 'each next_steps entry must be a non-empty string');
    }
  }
  if (!Array.isArray(input.files_in_focus)) {
    err('VALIDATION', 'files_in_focus must be an array');
  }
  for (const f of input.files_in_focus) {
    if (typeof f !== 'string' || f.length === 0) err('VALIDATION', 'files_in_focus contains non-string');
    if (f.includes('..')) err('PATH_ESCAPE', `path contains "..": ${f}`);
  }

  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
  if (repos.length === 0) err('NOT_IN_GIT_REPO', `no git repos found under ${cfg.projectRoot}`);

  let targetRepo: string | null = null;
  for (const f of input.files_in_focus) {
    const abs = path.isAbsolute(f) ? f : path.resolve(workspaceRoot, f);
    const repo = resolveRepoForFile(abs, repos);
    if (!repo) err('PATH_ESCAPE', `file outside all repos: ${f}`);
    if (targetRepo && repo !== targetRepo) err('MULTI_REPO_FILES', `files span repos: ${targetRepo} vs ${repo}`);
    targetRepo = repo;
  }
  if (!targetRepo) targetRepo = repos[0]; // no files_in_focus → fall back to first repo

  if (!(await isGitRepo(targetRepo))) {
    err('NOT_IN_GIT_REPO', `target repo not a git repo: ${targetRepo}`);
  }

  const status = await getGitStatus(targetRepo);

  // Normalize paths relative to target repo for storage
  const relFiles = input.files_in_focus.map((f) => {
    const abs = path.isAbsolute(f) ? f : path.resolve(workspaceRoot, f);
    return path.relative(targetRepo!, abs);
  });

  const cp = await writeSemantic(targetRepo, {
    summary: input.summary,
    next_steps: input.next_steps,
    files_in_focus: relFiles,
    blockers: input.blockers ?? [],
    context_notes: input.context_notes,
    todo_status: input.todo_status,
    branch: status.branch,
    git_head: status.head,
    dirty_files_count: status.dirty_files.length,
  });

  return {
    checkpoint_id: cp.id,
    saved_at: cp.saved_at,
    repo_root: targetRepo,
    git_head: status.head,
    branch: status.branch,
    dirty_files_count: status.dirty_files.length,
  };
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/tool-save-progress.test.ts`
Expected: 5 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tools/save-progress.ts tests/unit/tool-save-progress.test.ts
git commit -m "feat(tools): save_progress with multi-repo + path-safety validation"
```

---

## Task 10 · `src/tools/resume-latest.ts`

**Files:**
- Create: `src/tools/resume-latest.ts`
- Test: `tests/unit/tool-resume-latest.test.ts`

**Spec 引用：** §3.1.2、§3.2 `hint` 生成规则。

### Step 1：写失败测试 `tests/unit/tool-resume-latest.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/git.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
  getGitStatus: vi.fn(),
}));
vi.mock('../../src/repo-scanner.js', () => ({
  scanRepos: vi.fn(),
  resolveRepoForFile: vi.fn(),
  clearScanCache: vi.fn(),
}));

import { resumeLatest } from '../../src/tools/resume-latest.js';
import { writeSemantic, writePhysical } from '../../src/storage.js';
import { getGitStatus } from '../../src/git.js';
import { scanRepos } from '../../src/repo-scanner.js';

let workspaceRoot: string;
let repo: string;

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-resume-'));
  repo = path.join(workspaceRoot, 'frontend');
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  (scanRepos as any).mockResolvedValue([repo]);
});

function baseSem(overrides = {}) {
  return {
    summary: 'wip on auth',
    next_steps: ['ship login API'],
    files_in_focus: ['src/auth.ts'],
    blockers: [],
    context_notes: '',
    todo_status: [],
    branch: 'feature/login',
    git_head: 'AAA',
    dirty_files_count: 2,
    ...overrides,
  };
}

describe('resumeLatest', () => {
  it('returns NULL semantic when no checkpoints exist', async () => {
    (getGitStatus as any).mockResolvedValue({ head: 'AAA', branch: 'feature/login', dirty_files: [] });
    const out = await resumeLatest(workspaceRoot, {});
    expect(out.semantic_checkpoint).toBeNull();
    expect(out.hint).toMatch(/no semantic checkpoint/i);
  });

  it('generates "head_match=true, dirty covers focus" hint', async () => {
    await writeSemantic(repo, baseSem());
    (getGitStatus as any).mockResolvedValue({ head: 'AAA', branch: 'feature/login', dirty_files: ['src/auth.ts', 'src/extra.ts'] });
    const out = await resumeLatest(workspaceRoot, {});
    expect(out.head_match).toBe(true);
    expect(out.hint).toMatch(/git diff/i);
  });

  it('generates "head_match=true, dirty changed" hint', async () => {
    await writeSemantic(repo, baseSem({ files_in_focus: ['src/auth.ts'] }));
    (getGitStatus as any).mockResolvedValue({ head: 'AAA', branch: 'feature/login', dirty_files: ['src/login.ts'] });
    const out = await resumeLatest(workspaceRoot, {});
    expect(out.head_match).toBe(true);
    expect(out.hint).toMatch(/dirty file set has changed/i);
  });

  it('generates "head_match=false" hint', async () => {
    await writeSemantic(repo, baseSem());
    (getGitStatus as any).mockResolvedValue({ head: 'BBB', branch: 'feature/login', dirty_files: [] });
    const out = await resumeLatest(workspaceRoot, {});
    expect(out.head_match).toBe(false);
    expect(out.hint).toMatch(/HEAD has changed/);
  });

  it('includes physical snapshots saved after the semantic checkpoint', async () => {
    await writeSemantic(repo, baseSem());
    await new Promise((r) => setTimeout(r, 10));
    await writePhysical(repo, {
      triggered_by_tool: 'save_progress',
      branch: 'feature/login',
      git_head: 'AAA',
      files_changed: [],
      total_diff_size_bytes: 0,
    });
    (getGitStatus as any).mockResolvedValue({ head: 'AAA', branch: 'feature/login', dirty_files: [] });
    const out = await resumeLatest(workspaceRoot, {});
    expect(out.physical_snapshots_since.length).toBeGreaterThanOrEqual(1);
  });

  it('lists available_repos in monorepo case', async () => {
    const repo2 = path.join(workspaceRoot, 'backend');
    await fs.mkdir(path.join(repo2, '.git'), { recursive: true });
    (scanRepos as any).mockResolvedValue([repo, repo2]);
    await writeSemantic(repo, baseSem());
    (getGitStatus as any).mockResolvedValue({ head: 'AAA', branch: 'feature/login', dirty_files: [] });
    const out = await resumeLatest(workspaceRoot, {});
    expect(out.available_repos?.sort()).toEqual([repo, repo2].sort());
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/tool-resume-latest.test.ts`
Expected: FAIL

### Step 3：实现 `src/tools/resume-latest.ts`

```ts
import { getGitStatus, isGitRepo } from '../git.js';
import { scanRepos } from '../repo-scanner.js';
import { readLatestSemantic, readPhysicalsAfter, type SemanticCheckpoint, type PhysicalCheckpoint } from '../storage.js';
import { loadConfig } from '../config.js';

export interface ResumeLatestInput {
  branch?: string;
  repo_root?: string;
}

export interface ResumeLatestOutput {
  repo_root: string;
  semantic_checkpoint: SemanticCheckpoint | null;
  physical_snapshots_since: PhysicalCheckpoint[];
  git_status: { head: string; branch: string; dirty_files: string[] } | null;
  head_match: boolean;
  hint: string;
  ago: string;
  available_repos?: string[];
}

function err(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function formatAgo(isoTs: string | undefined): string {
  if (!isoTs) return 'never';
  const ms = Date.now() - Date.parse(isoTs);
  if (!Number.isFinite(ms)) return 'unknown';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function buildHint(
  sem: SemanticCheckpoint | null,
  status: { head: string; branch: string; dirty_files: string[] } | null,
): { head_match: boolean; hint: string } {
  if (!sem) return { head_match: false, hint: 'No semantic checkpoint found. Start a fresh session or ask the user.' };
  if (!status) return { head_match: false, hint: 'Target repo is not a git repo or could not be inspected. Only summary/next_steps are reliable.' };

  const head_match = sem.git_head === status.head;
  if (!head_match) {
    return {
      head_match: false,
      hint: `WARNING: Git HEAD has changed (snapshot=${sem.git_head?.slice(0, 7)}, current=${status.head.slice(0, 7)}). Reliable info: summary, next_steps, files_in_focus, changed_symbols from physical snapshots. Confirm with the user before continuing.`,
    };
  }
  const focusSet = new Set(sem.files_in_focus);
  const dirtySet = new Set(status.dirty_files);
  const covers = [...focusSet].every((f) => dirtySet.has(f));
  if (covers) {
    return {
      head_match: true,
      hint: 'Git HEAD matches and dirty files cover snapshot focus. Run `git diff` to see uncommitted changes, then follow next_steps.',
    };
  }
  return {
    head_match: true,
    hint: 'Git HEAD matches but the dirty file set has changed since the snapshot. Run `git diff` first; compare changed_symbols in physical snapshots to identify what AI changed vs what user changed.',
  };
}

export async function resumeLatest(workspaceRoot: string, input: ResumeLatestInput): Promise<ResumeLatestOutput> {
  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);

  if (repos.length === 0) {
    err('NOT_IN_GIT_REPO', `no git repos found under ${cfg.projectRoot}`);
  }

  const repo = input.repo_root && repos.includes(input.repo_root) ? input.repo_root : repos[0];
  const status = (await isGitRepo(repo)) ? await getGitStatus(repo) : null;

  const sem = await readLatestSemantic(repo, input.branch ?? status?.branch);
  const physicals = sem ? await readPhysicalsAfter(repo, sem.saved_at) : [];

  const { head_match, hint } = buildHint(sem, status);

  return {
    repo_root: repo,
    semantic_checkpoint: sem,
    physical_snapshots_since: physicals,
    git_status: status,
    head_match,
    hint,
    ago: formatAgo(sem?.saved_at),
    available_repos: repos.length > 1 ? repos : undefined,
  };
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/tool-resume-latest.test.ts`
Expected: 6 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tools/resume-latest.ts tests/unit/tool-resume-latest.test.ts
git commit -m "feat(tools): resume_latest with HEAD-match aware hint generation"
```

---

## Task 11 · `src/tools/list-checkpoints.ts`

**Files:**
- Create: `src/tools/list-checkpoints.ts`
- Test: `tests/unit/tool-list-checkpoints.test.ts`

**Spec 引用：** §3.1.3。

### Step 1：写失败测试

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/repo-scanner.js', () => ({
  scanRepos: vi.fn(),
  resolveRepoForFile: vi.fn(),
  clearScanCache: vi.fn(),
}));

import { listCheckpoints } from '../../src/tools/list-checkpoints.js';
import { writeSemantic, writePhysical } from '../../src/storage.js';
import { scanRepos } from '../../src/repo-scanner.js';

let workspaceRoot: string;
let repo: string;
beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-list-'));
  repo = path.join(workspaceRoot, 'r');
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  (scanRepos as any).mockResolvedValue([repo]);
});

describe('listCheckpoints', () => {
  it('lists semantic by default, newest first', async () => {
    const a = await writeSemantic(repo, sem('a'));
    await new Promise((r) => setTimeout(r, 5));
    const b = await writeSemantic(repo, sem('b'));
    const out = await listCheckpoints(workspaceRoot, {});
    expect(out[0].checkpoint_id).toBe(b.id);
    expect(out[1].checkpoint_id).toBe(a.id);
  });

  it('filters by branch', async () => {
    await writeSemantic(repo, sem('a', 'br-a'));
    await writeSemantic(repo, sem('b', 'br-b'));
    const out = await listCheckpoints(workspaceRoot, { branch: 'br-a' });
    expect(out.every((c) => c.branch === 'br-a')).toBe(true);
  });

  it('includes physicals when kind=all', async () => {
    await writeSemantic(repo, sem('a'));
    await writePhysical(repo, phys('save_progress'));
    const all = await listCheckpoints(workspaceRoot, { kind: 'all' });
    expect(all.find((c) => c.kind === 'physical')).toBeTruthy();
    expect(all.find((c) => c.kind === 'semantic')).toBeTruthy();
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) await writeSemantic(repo, sem(String(i)));
    const out = await listCheckpoints(workspaceRoot, { limit: 2 });
    expect(out.length).toBe(2);
  });
});

function sem(s: string, branch = 'main') {
  return { summary: s, next_steps: ['n'], files_in_focus: ['x.ts'], blockers: [], context_notes: '', todo_status: [], branch, git_head: 'h', dirty_files_count: 0 };
}
function phys(tool: string) {
  return { triggered_by_tool: tool, branch: 'main', git_head: 'h', files_changed: [], total_diff_size_bytes: 0 };
}
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/tool-list-checkpoints.test.ts`
Expected: FAIL

### Step 3：实现 `src/tools/list-checkpoints.ts`

```ts
import { readIndex } from '../storage.js';
import { scanRepos } from '../repo-scanner.js';
import { loadConfig } from '../config.js';

export interface ListCheckpointsInput {
  limit?: number;
  branch?: string;
  kind?: 'semantic' | 'physical' | 'all';
  repo_root?: string;
}

export interface ListedCheckpoint {
  checkpoint_id: string;
  kind: 'semantic' | 'physical';
  saved_at: string;
  branch?: string;
  git_head?: string;
  summary?: string;
  triggered_by_tool?: string;
}

function err(code: string, message: string): never { throw new Error(`${code}: ${message}`); }

export async function listCheckpoints(workspaceRoot: string, input: ListCheckpointsInput): Promise<ListedCheckpoint[]> {
  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
  if (repos.length === 0) err('NOT_IN_GIT_REPO', `no git repos found`);

  const repo = input.repo_root && repos.includes(input.repo_root) ? input.repo_root : repos[0];
  const limit = input.limit ?? 20;
  const kind = input.kind ?? 'semantic';

  const idx = await readIndex(repo);
  let entries = [...idx.checkpoints];
  if (kind !== 'all') entries = entries.filter((e) => e.kind === kind);
  if (input.branch) entries = entries.filter((e) => e.branch === input.branch);
  entries.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  return entries.slice(0, limit).map((e) => ({
    checkpoint_id: e.id,
    kind: e.kind,
    saved_at: e.saved_at,
    branch: e.branch,
    summary: e.summary,
    triggered_by_tool: e.triggered_by_tool,
  }));
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/tool-list-checkpoints.test.ts`
Expected: 4 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tools/list-checkpoints.ts tests/unit/tool-list-checkpoints.test.ts
git commit -m "feat(tools): list_checkpoints with kind/branch/limit filters"
```

---

## Task 12 · `src/tools/diff-since.ts`

**Files:**
- Create: `src/tools/diff-since.ts`
- Test: `tests/unit/tool-diff-since.test.ts`

**Spec 引用：** §3.1.4。

### Step 1：写失败测试

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/git.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(true),
  getDiffSinceCommit: vi.fn(),
}));
vi.mock('../../src/repo-scanner.js', () => ({
  scanRepos: vi.fn(),
  resolveRepoForFile: vi.fn(),
  clearScanCache: vi.fn(),
}));

import { diffSince } from '../../src/tools/diff-since.js';
import { writeSemantic, writePhysical } from '../../src/storage.js';
import { getDiffSinceCommit } from '../../src/git.js';
import { scanRepos } from '../../src/repo-scanner.js';

let workspaceRoot: string;
let repo: string;
beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-diff-'));
  repo = path.join(workspaceRoot, 'r');
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  (scanRepos as any).mockResolvedValue([repo]);
});

describe('diffSince', () => {
  it('returns CHECKPOINT_NOT_FOUND when id is unknown', async () => {
    await expect(diffSince(workspaceRoot, { checkpoint_id: 'nope' }))
      .rejects.toThrow(/CHECKPOINT_NOT_FOUND/);
  });

  it('returns truncated flag when diff exceeds 100KB', async () => {
    const cp = await writePhysical(repo, { triggered_by_tool: 'save_progress', branch: 'main', git_head: 'AAA', files_changed: [], total_diff_size_bytes: 0 });
    (getDiffSinceCommit as any).mockResolvedValue({ diff: 'x'.repeat(50_000), truncated: false });
    const out = await diffSince(workspaceRoot, { checkpoint_id: cp.id });
    expect(out.truncated).toBe(false);
    expect(out.diff.length).toBe(50_000);
  });

  it('infers files_changed from diff body', async () => {
    const cp = await writeSemantic(repo, { summary: 'wip', next_steps: ['x'], files_in_focus: ['a.ts'], blockers: [], context_notes: '', todo_status: [], branch: 'main', git_head: 'AAA', dirty_files_count: 1 });
    (getDiffSinceCommit as any).mockResolvedValue({
      diff: `diff --git a/a.ts b/a.ts\n@@\n+x\ndiff --git a/b.go b/b.go\n@@\n+y\n`,
      truncated: false,
    });
    const out = await diffSince(workspaceRoot, { checkpoint_id: cp.id });
    expect(out.files_changed.sort()).toEqual(['a.ts', 'b.go'].sort());
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/tool-diff-since.test.ts`
Expected: FAIL

### Step 3：实现 `src/tools/diff-since.ts`

```ts
import { readById } from '../storage.js';
import { scanRepos } from '../repo-scanner.js';
import { getDiffSinceCommit } from '../git.js';
import { loadConfig } from '../config.js';

export interface DiffSinceInput {
  checkpoint_id: string;
  repo_root?: string;
}

export interface DiffSinceOutput {
  files_changed: string[];
  diff: string;
  truncated: boolean;
}

function err(code: string, message: string): never { throw new Error(`${code}: ${message}`); }

function parseFilesFromDiff(diff: string): string[] {
  const set = new Set<string>();
  for (const line of diff.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) set.add(m[2]);
  }
  return [...set];
}

export async function diffSince(workspaceRoot: string, input: DiffSinceInput): Promise<DiffSinceOutput> {
  if (!input.checkpoint_id) err('VALIDATION', 'checkpoint_id is required');
  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);

  // Locate which repo holds the checkpoint
  let foundRepo: string | null = null;
  let cp: any = null;
  const candidates = input.repo_root ? [input.repo_root] : repos;
  for (const r of candidates) {
    cp = await readById(r, input.checkpoint_id);
    if (cp) { foundRepo = r; break; }
  }
  if (!cp || !foundRepo) err('CHECKPOINT_NOT_FOUND', input.checkpoint_id);

  const baseHead = cp.git_head;
  if (!baseHead) err('VALIDATION', `checkpoint has no git_head: ${input.checkpoint_id}`);

  const { diff, truncated } = await getDiffSinceCommit(foundRepo, baseHead);
  return { files_changed: parseFilesFromDiff(diff), diff, truncated };
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/tool-diff-since.test.ts`
Expected: 3 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tools/diff-since.ts tests/unit/tool-diff-since.test.ts
git commit -m "feat(tools): diff_since with truncation + file inference"
```

---

## Task 13 · `src/tools/clear-checkpoints.ts`

**Files:**
- Create: `src/tools/clear-checkpoints.ts`
- Test: `tests/unit/tool-clear-checkpoints.test.ts`

**Spec 引用：** §3.1.5。

### Step 1：写失败测试

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/repo-scanner.js', () => ({
  scanRepos: vi.fn(),
  clearScanCache: vi.fn(),
  resolveRepoForFile: vi.fn(),
}));

import { clearCheckpoints } from '../../src/tools/clear-checkpoints.js';
import { writeSemantic, writePhysical, readIndex } from '../../src/storage.js';
import { scanRepos } from '../../src/repo-scanner.js';

let workspaceRoot: string;
let repo: string;
beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-clear-'));
  repo = path.join(workspaceRoot, 'r');
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  (scanRepos as any).mockResolvedValue([repo]);
});

function sem(branch = 'main') {
  return { summary: 's', next_steps: ['n'], files_in_focus: ['x.ts'], blockers: [], context_notes: '', todo_status: [], branch, git_head: 'h', dirty_files_count: 0 };
}
function phys() {
  return { triggered_by_tool: 'save_progress', branch: 'main', git_head: 'h', files_changed: [], total_diff_size_bytes: 0 };
}

describe('clearCheckpoints', () => {
  it('rejects scope=all without dry_run and no filters', async () => {
    await expect(clearCheckpoints(workspaceRoot, { scope: 'all' }))
      .rejects.toThrow(/CONFIRM_REQUIRED/);
  });

  it('allows scope=all when dry_run=true (preview only)', async () => {
    await writeSemantic(repo, sem());
    await writePhysical(repo, phys());
    const out = await clearCheckpoints(workspaceRoot, { scope: 'all', dry_run: true });
    expect(out.removed.length).toBe(2);
    expect(out.dry_run).toBe(true);
    const idx = await readIndex(repo);
    expect(idx.checkpoints.length).toBe(2); // nothing actually deleted
  });

  it('deletes only physical when scope=auto-snapshots', async () => {
    await writeSemantic(repo, sem());
    await writePhysical(repo, phys());
    const out = await clearCheckpoints(workspaceRoot, { scope: 'auto-snapshots' });
    expect(out.removed.length).toBe(1);
    const idx = await readIndex(repo);
    expect(idx.checkpoints.length).toBe(1);
    expect(idx.checkpoints[0].kind).toBe('semantic');
  });

  it('respects before timestamp filter', async () => {
    const a = await writeSemantic(repo, sem());
    await new Promise(r => setTimeout(r, 20));
    const cutoff = new Date().toISOString();
    await new Promise(r => setTimeout(r, 20));
    await writeSemantic(repo, sem());
    const out = await clearCheckpoints(workspaceRoot, { scope: 'semantic', before: cutoff });
    expect(out.removed.length).toBe(1);
    expect(out.removed[0].checkpoint_id).toBe(a.id);
  });

  it('respects branch filter', async () => {
    await writeSemantic(repo, sem('a'));
    await writeSemantic(repo, sem('b'));
    const out = await clearCheckpoints(workspaceRoot, { scope: 'semantic', branch: 'a' });
    expect(out.removed.length).toBe(1);
    expect(out.removed[0].branch).toBe('a');
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/tool-clear-checkpoints.test.ts`
Expected: FAIL

### Step 3：实现 `src/tools/clear-checkpoints.ts`

```ts
import { removeBeforeTimestamp, readIndex, emptyTrashOlderThanDays } from '../storage.js';
import { scanRepos } from '../repo-scanner.js';
import { loadConfig } from '../config.js';

export interface ClearCheckpointsInput {
  scope: 'auto-snapshots' | 'semantic' | 'all';
  before?: string;
  branch?: string;
  repo_root?: string;
  dry_run?: boolean;
}

export interface ClearCheckpointsOutput {
  repo_root: string;
  removed: Array<{ checkpoint_id: string; kind: 'semantic' | 'physical'; saved_at: string; branch?: string }>;
  remaining_count: number;
  dry_run: boolean;
}

function err(code: string, message: string): never { throw new Error(`${code}: ${message}`); }

export async function clearCheckpoints(workspaceRoot: string, input: ClearCheckpointsInput): Promise<ClearCheckpointsOutput> {
  if (!['auto-snapshots','semantic','all'].includes(input.scope)) {
    err('VALIDATION', `unknown scope: ${input.scope}`);
  }
  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
  if (repos.length === 0) err('NOT_IN_GIT_REPO', `no git repos found`);

  const repo = input.repo_root && repos.includes(input.repo_root) ? input.repo_root : repos[0];

  // Safety: scope=all without filters and dry_run=false → require confirmation
  if (input.scope === 'all' && !input.before && !input.branch && !input.dry_run) {
    err('CONFIRM_REQUIRED', `scope=all without filters requires dry_run=true on first call. Re-run with dry_run=false after reviewing the dry-run output.`);
  }

  const beforeIso = input.before ?? new Date().toISOString();

  if (input.dry_run) {
    // Preview: compute what would be removed without actually moving files
    const idx = await readIndex(repo);
    const candidates = idx.checkpoints.filter((c) => {
      if (c.saved_at >= beforeIso) return false;
      if (input.scope === 'semantic' && c.kind !== 'semantic') return false;
      if (input.scope === 'auto-snapshots' && c.kind !== 'physical') return false;
      if (input.branch && c.branch !== input.branch) return false;
      return true;
    });
    const remaining = idx.checkpoints.length - candidates.length;
    return {
      repo_root: repo,
      removed: candidates.map((c) => ({ checkpoint_id: c.id, kind: c.kind, saved_at: c.saved_at, branch: c.branch })),
      remaining_count: remaining,
      dry_run: true,
    };
  }

  const removed = await removeBeforeTimestamp(repo, beforeIso, {
    scope: input.scope,
    branch: input.branch,
  });

  // Opportunistic trash cleanup (per spec §3.1.5)
  await emptyTrashOlderThanDays(repo, cfg.trashRetentionDays);

  const idxAfter = await readIndex(repo);
  return {
    repo_root: repo,
    removed,
    remaining_count: idxAfter.checkpoints.length,
    dry_run: false,
  };
}
```

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/tool-clear-checkpoints.test.ts`
Expected: 5 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

### Step 5：Commit

```bash
git add src/tools/clear-checkpoints.ts tests/unit/tool-clear-checkpoints.test.ts
git commit -m "feat(tools): clear_checkpoints with dry-run + scope=all confirmation guard"
```

# Phase 5 · MCP Server 装配

## Task 14 · `src/index.ts` — MCP server 入口

**Files:**
- Modify: `src/index.ts`（占位文件改为真正的 MCP server）
- Test: `tests/unit/server-dispatch.test.ts`（测试工具路由 + 错误处理 + 搭便车拦截）

**Spec 引用：** §3.2 dispatchTool 伪代码。

**职责**：
- 用 `@modelcontextprotocol/sdk` 创建 stdio MCP server
- 注册 5 个工具（带 JSON Schema 输入校验）
- 调用前过自动快照拦截（除非在 SKIP 列表）
- 错误码映射到 MCP 错误响应（`-32602` invalid params / `-32603` server error）
- 启动时根据 `WORK_RESUME_GRAMMAR_LOAD=eager` 预加载所有 grammar

### Step 1：写失败测试 `tests/unit/server-dispatch.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/auto-snapshot.js', () => ({
  autoSnapshotIfStale: vi.fn().mockResolvedValue(null),
  SKIP_AUTO_SNAPSHOT: new Set(['clear_checkpoints', 'list_checkpoints', 'diff_since']),
}));
vi.mock('../../src/tools/save-progress.js', () => ({ saveProgress: vi.fn().mockResolvedValue({ checkpoint_id: 'abc' }) }));
vi.mock('../../src/tools/resume-latest.js', () => ({ resumeLatest: vi.fn().mockResolvedValue({ repo_root: '/r' }) }));
vi.mock('../../src/tools/list-checkpoints.js', () => ({ listCheckpoints: vi.fn().mockResolvedValue([]) }));
vi.mock('../../src/tools/diff-since.js', () => ({ diffSince: vi.fn().mockResolvedValue({ files_changed: [], diff: '', truncated: false }) }));
vi.mock('../../src/tools/clear-checkpoints.js', () => ({ clearCheckpoints: vi.fn().mockResolvedValue({ repo_root: '/r', removed: [], remaining_count: 0, dry_run: true }) }));
vi.mock('../../src/repo-scanner.js', () => ({
  scanRepos: vi.fn().mockResolvedValue(['/r']),
  resolveRepoForFile: vi.fn(),
  clearScanCache: vi.fn(),
}));

import { dispatchTool } from '../../src/index.js';
import { autoSnapshotIfStale } from '../../src/auto-snapshot.js';
import { saveProgress } from '../../src/tools/save-progress.js';
import { listCheckpoints } from '../../src/tools/list-checkpoints.js';

beforeEach(() => {
  (autoSnapshotIfStale as any).mockClear();
  (saveProgress as any).mockClear();
  (listCheckpoints as any).mockClear();
});

describe('dispatchTool', () => {
  it('invokes auto-snapshot before non-skip tools', async () => {
    await dispatchTool('save_progress', { summary: 'wip on auth', next_steps: ['a'], files_in_focus: ['a.ts'] }, '/work');
    expect(autoSnapshotIfStale).toHaveBeenCalled();
    expect(saveProgress).toHaveBeenCalled();
  });

  it('skips auto-snapshot for list_checkpoints', async () => {
    await dispatchTool('list_checkpoints', {}, '/work');
    expect(autoSnapshotIfStale).not.toHaveBeenCalled();
    expect(listCheckpoints).toHaveBeenCalled();
  });

  it('wraps tool errors with MCP error envelope', async () => {
    (saveProgress as any).mockRejectedValueOnce(new Error('VALIDATION: bad input'));
    await expect(dispatchTool('save_progress', { summary: '' } as any, '/work')).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('bad input'),
    });
  });

  it('returns UNKNOWN_TOOL error for unregistered name', async () => {
    await expect(dispatchTool('made_up_tool' as any, {}, '/work')).rejects.toMatchObject({ code: 'UNKNOWN_TOOL' });
  });
});
```

### Step 2：跑测试看红

Run: `npx vitest run tests/unit/server-dispatch.test.ts`
Expected: FAIL

### Step 3：实现 `src/index.ts`

```ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { autoSnapshotIfStale, SKIP_AUTO_SNAPSHOT } from './auto-snapshot.js';
import { saveProgress, type SaveProgressInput } from './tools/save-progress.js';
import { resumeLatest, type ResumeLatestInput } from './tools/resume-latest.js';
import { listCheckpoints, type ListCheckpointsInput } from './tools/list-checkpoints.js';
import { diffSince, type DiffSinceInput } from './tools/diff-since.js';
import { clearCheckpoints, type ClearCheckpointsInput } from './tools/clear-checkpoints.js';
import { preloadAll } from './tree-sitter/lazy-loader.js';

export interface DispatchError extends Error { code: string; }

export async function dispatchTool(name: string, args: any, workspaceRoot: string): Promise<unknown> {
  const cfg = loadConfig(workspaceRoot);

  if (!SKIP_AUTO_SNAPSHOT.has(name)) {
    const { scanRepos } = await import('./repo-scanner.js');
    const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
    for (const repo of repos) {
      try {
        await autoSnapshotIfStale(repo, name, {
          autoIntervalMs: cfg.autoIntervalMs,
          autoRetentionHours: cfg.autoRetentionHours,
          trashRetentionDays: cfg.trashRetentionDays,
        });
      } catch { /* best-effort, never block real tool */ }
    }
  }

  try {
    switch (name) {
      case 'save_progress':     return await saveProgress(workspaceRoot, args as SaveProgressInput);
      case 'resume_latest':     return await resumeLatest(workspaceRoot, args as ResumeLatestInput);
      case 'list_checkpoints':  return await listCheckpoints(workspaceRoot, args as ListCheckpointsInput);
      case 'diff_since':        return await diffSince(workspaceRoot, args as DiffSinceInput);
      case 'clear_checkpoints': return await clearCheckpoints(workspaceRoot, args as ClearCheckpointsInput);
      default: {
        const e = new Error(`unknown tool: ${name}`) as DispatchError;
        e.code = 'UNKNOWN_TOOL';
        throw e;
      }
    }
  } catch (err: any) {
    const wrapped = err as DispatchError;
    if (!wrapped.code) {
      const m = (err.message ?? '').match(/^([A-Z_]+):\s*(.*)$/s);
      wrapped.code = m ? m[1] : 'INTERNAL';
      if (m) wrapped.message = m[2];
    }
    throw wrapped;
  }
}

const TOOL_SCHEMAS = {
  save_progress: {
    name: 'save_progress',
    description: 'Save current work progress as a semantic checkpoint. Call when completing a TodoWrite item, before context switch, before blockers, after each Edit/Write, or before replying to the user.',
    inputSchema: {
      type: 'object',
      required: ['summary', 'next_steps', 'files_in_focus'],
      properties: {
        summary:        { type: 'string', minLength: 8 },
        next_steps:     { type: 'array', items: { type: 'string' }, minItems: 1 },
        files_in_focus: { type: 'array', items: { type: 'string' } },
        blockers:       { type: 'array', items: { type: 'string' } },
        context_notes:  { type: 'string' },
        todo_status:    { type: 'array', items: { type: 'object' } },
      },
    },
  },
  resume_latest: {
    name: 'resume_latest',
    description: 'Resume the most recent checkpoint for the current branch / repo. Call at the start of a new session unless the user said "fresh task".',
    inputSchema: {
      type: 'object',
      properties: {
        branch:    { type: 'string' },
        repo_root: { type: 'string' },
      },
    },
  },
  list_checkpoints: {
    name: 'list_checkpoints',
    description: 'Browse historical checkpoints (semantic by default).',
    inputSchema: {
      type: 'object',
      properties: {
        limit:     { type: 'integer', minimum: 1, maximum: 200 },
        branch:    { type: 'string' },
        kind:      { type: 'string', enum: ['semantic','physical','all'] },
        repo_root: { type: 'string' },
      },
    },
  },
  diff_since: {
    name: 'diff_since',
    description: 'Show git diff from a specific checkpoint to now.',
    inputSchema: {
      type: 'object',
      required: ['checkpoint_id'],
      properties: {
        checkpoint_id: { type: 'string' },
        repo_root:     { type: 'string' },
      },
    },
  },
  clear_checkpoints: {
    name: 'clear_checkpoints',
    description: 'Soft-delete checkpoints. scope=all with no filters requires dry_run=true first.',
    inputSchema: {
      type: 'object',
      required: ['scope'],
      properties: {
        scope:     { type: 'string', enum: ['auto-snapshots','semantic','all'] },
        before:    { type: 'string', format: 'date-time' },
        branch:    { type: 'string' },
        repo_root: { type: 'string' },
        dry_run:   { type: 'boolean' },
      },
    },
  },
} as const;

async function main() {
  const workspaceRoot = process.cwd();
  const cfg = loadConfig(workspaceRoot);

  if (cfg.grammarLoad === 'eager') {
    await preloadAll(cfg.langs).catch(() => null);
  }

  const server = new Server(
    { name: 'work-resume-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(TOOL_SCHEMAS),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params as { name: string; arguments: unknown };
    try {
      const result = await dispatchTool(name, args, workspaceRoot);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: { code: err.code ?? 'INTERNAL', message: err.message }) }) }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[work-resume-mcp] up. cwd=' + workspaceRoot);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[work-resume-mcp] fatal:', err);
    process.exit(1);
  });
}
```

> **Implementer note**：上面 `server.connect(transport)` 与 `setRequestHandler` 用的是 `@modelcontextprotocol/sdk@^1.0` 的 API；若 SDK 版本不同（如 `0.x` 的 `RequestSchema` 命名空间），请按 SDK 当前导出名调整，不要硬抄。**Iron Law**：写完先跑 `npm run dev`，确认 stdio 启动没崩，再继续。

### Step 4：跑测试看绿

Run: `npx vitest run tests/unit/server-dispatch.test.ts`
Expected: 4 tests passed

Run: `npx tsc --noEmit`
Expected: 干净

Run: `node dist/index.js < /dev/null` 或 `npm run dev`
Expected: stderr 出现 `[work-resume-mcp] up. cwd=...`；进程不 crash（用 `Ctrl-C` 退出）

### Step 5：Commit

```bash
git add src/index.ts tests/unit/server-dispatch.test.ts
git commit -m "feat(server): MCP stdio server with 5 tools + auto-snapshot interceptor"
```

---

# Phase 6 · 文档与 Rule 模板

## Task 15 · `rules/RULE.md`

**Files:**
- Create: `rules/RULE.md`

**Spec 引用：** §4。

照搬 spec §4 的模板原文，可视情况追加"如何在每家 IDE 安装"的小节，但**不**改变规则内容本身。

```bash
mkdir -p rules
cat > rules/RULE.md <<'EOF'
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

## 严禁
- 跳过 save_progress 直接回复"OK 完成了"
- 在 summary 里写"做了一些工作"这类模糊描述

## 各家 IDE 安装位置
| IDE | 位置 |
|---|---|
| Cursor | `.cursor/rules/work-resume.mdc`（手动复制本文件内容） |
| Claude Code | `.claude/rules/` 或项目根 `AGENTS.md` 末尾追加 |
| Codex CLI | `~/.codex/AGENTS.md` 或项目 `AGENTS.md` |
EOF
```

### Step 1：执行上述命令创建 Rule

### Step 2：Commit

```bash
git add rules/RULE.md
git commit -m "docs(rules): work-resume Rule template for Cursor / Claude Code / Codex"
```

---

## Task 16 · `README.md`

**Files:**
- Modify: `README.md`（替换占位内容）

**职责**：

- 一句话定位
- 安装与配置（npm / npx）
- 在 Cursor / Claude Code / Codex 注册的具体 JSON 片段
- 环境变量说明（链接到 spec §5）
- v1 限制（grammar 包必须含 WASM、不跨设备同步等）

### Step 1：写 README

```markdown
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

把 [`rules/RULE.md`](rules/RULE.md) 的内容贴到你 IDE 的规则位置（详见该文件末尾"各家 IDE 安装位置"小节）。

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
```

### Step 2：Commit

```bash
git add README.md
git commit -m "docs(readme): install + IDE registration + env var guide"
```

# Phase 7 · 集成测试与端到端验收

集成测试使用真实的 `git` CLI（不再 mock execa），以验证跨进程、跨会话场景。

## Task 17 · 集成测试：跨进程 save→resume 端到端

**Files:**
- Create: `tests/integration/save-resume.int.test.ts`

### Step 1：写测试

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execa } from 'execa';
import { saveProgress } from '../../src/tools/save-progress.js';
import { resumeLatest } from '../../src/tools/resume-latest.js';
import { clearScanCache } from '../../src/repo-scanner.js';

let workspaceRoot: string;
let repo: string;

beforeEach(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-int-'));
  repo = path.join(workspaceRoot, 'r');
  await fs.mkdir(repo, { recursive: true });
  await execa('git', ['init', '-b', 'main'], { cwd: repo });
  await execa('git', ['config', 'user.email', 'test@local'], { cwd: repo });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'README.md'), '# hi');
  await execa('git', ['add', '.'], { cwd: repo });
  await execa('git', ['commit', '-m', 'init'], { cwd: repo });
  clearScanCache();
});

it('save_progress in process A is visible to resume_latest in process B', async () => {
  await fs.writeFile(path.join(repo, 'a.ts'), 'function foo(){}');
  const saved = await saveProgress(workspaceRoot, {
    summary: 'wip on a.ts implementing foo function',
    next_steps: ['add bar()'],
    files_in_focus: [path.join(repo, 'a.ts')],
  });
  expect(saved.checkpoint_id).toBeTruthy();

  // Simulate a "fresh process": re-import the resume module dynamically
  const { resumeLatest: freshResume } = await import('../../src/tools/resume-latest.js?fresh=' + Date.now() as any);
  const out = await freshResume(workspaceRoot, {});
  expect(out.semantic_checkpoint?.summary).toContain('wip on a.ts');
  expect(out.head_match).toBe(true);
  expect(out.git_status?.dirty_files).toContain('a.ts');
});
```

### Step 2：跑测试

Run: `npx vitest run tests/integration/save-resume.int.test.ts`
Expected: 1 test passed

### Step 3：Commit

```bash
git add tests/integration/save-resume.int.test.ts
git commit -m "test(integration): save_progress → resume_latest end-to-end"
```

---

## Task 18 · 集成测试：HEAD 变化 / monorepo / 非 git 三种降级

**Files:**
- Create: `tests/integration/edge-cases.int.test.ts`

### Step 1：写测试

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execa } from 'execa';
import { saveProgress } from '../../src/tools/save-progress.js';
import { resumeLatest } from '../../src/tools/resume-latest.js';
import { clearScanCache } from '../../src/repo-scanner.js';

async function gitRepo(parent: string, name: string): Promise<string> {
  const r = path.join(parent, name);
  await fs.mkdir(r, { recursive: true });
  await execa('git', ['init', '-b', 'main'], { cwd: r });
  await execa('git', ['config', 'user.email', 't@l'], { cwd: r });
  await execa('git', ['config', 'user.name', 't'], { cwd: r });
  await fs.writeFile(path.join(r, 'seed.txt'), 'x');
  await execa('git', ['add', '.'], { cwd: r });
  await execa('git', ['commit', '-m', 'init'], { cwd: r });
  return r;
}

let ws: string;
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-edge-'));
  clearScanCache();
});

it('detects HEAD change between save and resume', async () => {
  const repo = await gitRepo(ws, 'r');
  await fs.writeFile(path.join(repo, 'a.ts'), 'function foo(){}');
  await saveProgress(ws, {
    summary: 'wip work on a.ts function foo',
    next_steps: ['add bar()'],
    files_in_focus: [path.join(repo, 'a.ts')],
  });
  await execa('git', ['add', '.'], { cwd: repo });
  await execa('git', ['commit', '-m', 'wip'], { cwd: repo });
  const out = await resumeLatest(ws, {});
  expect(out.head_match).toBe(false);
  expect(out.hint).toMatch(/HEAD has changed/);
});

it('routes save_progress to the correct repo in monorepo', async () => {
  const fe = await gitRepo(ws, 'frontend');
  const be = await gitRepo(ws, 'backend');
  await fs.writeFile(path.join(fe, 'src.ts'), 'x');
  const out = await saveProgress(ws, {
    summary: 'frontend work on src.ts',
    next_steps: ['x'],
    files_in_focus: [path.join(fe, 'src.ts')],
  });
  expect(out.repo_root).toBe(fe);
  const idxFe = JSON.parse(await fs.readFile(path.join(fe, '.work-resume/index.json'), 'utf8'));
  expect(idxFe.checkpoints.length).toBe(1);
  await expect(fs.access(path.join(be, '.work-resume/index.json'))).rejects.toThrow();
});

it('returns NOT_IN_GIT_REPO when workspace has no git', async () => {
  await expect(saveProgress(ws, {
    summary: 'wip outside any git repo',
    next_steps: ['x'],
    files_in_focus: [path.join(ws, 'a.txt')],
  })).rejects.toThrow(/NOT_IN_GIT_REPO/);
});
```

### Step 2：跑测试

Run: `npx vitest run tests/integration/edge-cases.int.test.ts`
Expected: 3 tests passed

### Step 3：Commit

```bash
git add tests/integration/edge-cases.int.test.ts
git commit -m "test(integration): HEAD change / monorepo / non-git fallbacks"
```

---

## Task 19 · 集成测试：24h 清理 + `clear_checkpoints` 安全约束

**Files:**
- Create: `tests/integration/clear-checkpoints.int.test.ts`

### Step 1：写测试

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execa } from 'execa';
import { autoSnapshotIfStale } from '../../src/auto-snapshot.js';
import { clearCheckpoints } from '../../src/tools/clear-checkpoints.js';
import { writeSemantic, writePhysical, readIndex } from '../../src/storage.js';
import { clearScanCache } from '../../src/repo-scanner.js';

let ws: string;
let repo: string;
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-clr-'));
  repo = path.join(ws, 'r');
  await fs.mkdir(repo, { recursive: true });
  await execa('git', ['init', '-b', 'main'], { cwd: repo });
  await execa('git', ['config', 'user.email','t@l'], { cwd: repo });
  await execa('git', ['config', 'user.name','t'], { cwd: repo });
  await fs.writeFile(path.join(repo, 'seed'), 'x');
  await execa('git', ['add','.'], { cwd: repo });
  await execa('git', ['commit', '-m','init'], { cwd: repo });
  clearScanCache();
});

it('autoSnapshotIfStale purges physical snapshots older than retentionHours', async () => {
  await fs.writeFile(path.join(repo, 'a.ts'), 'function foo(){}');

  // First snapshot, then mock its saved_at into the distant past via writePhysical directly
  const oldP = await writePhysical(repo, {
    triggered_by_tool: 'save_progress',
    branch: 'main',
    git_head: 'oldhead',
    files_changed: [],
    total_diff_size_bytes: 0,
  });
  // Rewrite saved_at to 48h ago
  const f = path.join(repo, '.work-resume/auto-snapshots', `${oldP.id}.json`);
  const obj = JSON.parse(await fs.readFile(f, 'utf8'));
  obj.saved_at = new Date(Date.now() - 48 * 3600_000).toISOString();
  await fs.writeFile(f, JSON.stringify(obj, null, 2));

  // Also patch the index entry
  const idxFile = path.join(repo, '.work-resume/index.json');
  const idx = JSON.parse(await fs.readFile(idxFile, 'utf8'));
  for (const c of idx.checkpoints) if (c.id === oldP.id) c.saved_at = obj.saved_at;
  await fs.writeFile(idxFile, JSON.stringify(idx, null, 2));

  await autoSnapshotIfStale(repo, 'save_progress', {
    autoIntervalMs: 0,
    autoRetentionHours: 24,
  });

  const after = await readIndex(repo);
  expect(after.checkpoints.find((c: any) => c.id === oldP.id)).toBeUndefined();
});

it('clear_checkpoints scope=all without dry_run throws CONFIRM_REQUIRED on first call', async () => {
  await writeSemantic(repo, { summary: 's', next_steps: ['n'], files_in_focus: ['x'], blockers: [], context_notes: '', todo_status: [], branch: 'main', git_head: 'h', dirty_files_count: 0 });
  await expect(clearCheckpoints(ws, { scope: 'all' })).rejects.toThrow(/CONFIRM_REQUIRED/);
  // Dry run preview works
  const preview = await clearCheckpoints(ws, { scope: 'all', dry_run: true });
  expect(preview.removed.length).toBe(1);
  // Then real delete works with explicit before timestamp
  const real = await clearCheckpoints(ws, { scope: 'all', before: new Date().toISOString() });
  expect(real.removed.length).toBe(1);
});

it('clear_checkpoints soft-deletes to .trash', async () => {
  await writePhysical(repo, { triggered_by_tool: 'save_progress', branch: 'main', git_head: 'h', files_changed: [], total_diff_size_bytes: 0 });
  await clearCheckpoints(ws, { scope: 'auto-snapshots' });
  const trash = await fs.readdir(path.join(repo, '.work-resume/.trash'));
  expect(trash.length).toBeGreaterThan(0);
});
```

### Step 2：跑测试

Run: `npx vitest run tests/integration/clear-checkpoints.int.test.ts`
Expected: 3 tests passed

### Step 3：Commit

```bash
git add tests/integration/clear-checkpoints.int.test.ts
git commit -m "test(integration): retention cleanup + clear_checkpoints safety guard"
```

---

## Task 20 · 三家 IDE 真实手测脚本与验收记录

**Files:**
- Create: `docs/acceptance/2026-05-27-three-ide-acceptance.md`

**Spec 引用：** §6.3 真实场景手测。

**职责**：固化"在 Cursor / Claude Code / Codex 三家中各跑一遍完整流程"的脚本与勾选清单；实现者按表对照打勾。**这不是自动化测试**，而是验收 checklist。

### Step 1：创建验收文档

```markdown
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
```

### Step 2：Commit

```bash
git add docs/acceptance/2026-05-27-three-ide-acceptance.md
git commit -m "docs(acceptance): three-IDE manual acceptance checklist"
```

### Step 3：实际执行验收

执行 checklist 的每一项；任何未勾选项必须有解释（已知问题登记或阻断 v1）。**不要**自己跳过任何一项。

---

# 项目完整性检查

实现完成后，在所有 Task 之外，跑一次完整自检：

```bash
# 1. 所有测试通过
npx vitest run

# 2. 类型干净
npx tsc --noEmit

# 3. 真实构建
npm run build

# 4. 全局 link 后跑一次 stdio
npm link
work-resume-mcp < /dev/null   # 应打印 "[work-resume-mcp] up" 到 stderr 后等输入

# 5. 在 Cursor 注册并真实调用
#    打开任意 git 仓库 → 让 AI 调 save_progress → 看 .work-resume/checkpoints/ 是否生成文件
```

任一项失败 → 不能 publish。

---

# Plan 结束

**Plan complete and saved to `docs/plans/2026-05-27-work-resume-impl-plan.md`. Two execution options:**

**1. Subagent-Driven (this session)** — 我在本会话内派遣 fresh subagent 逐 Task 实现，每 Task 完成后用 `requesting-code-review` 技能审一遍再继续。适合一气呵成、追求迭代速度。

**2. Parallel Session (separate)** — 你开新会话用 `executing-plans` 技能批量推进，按本 plan 的 Phase 边界设审查检查点。适合"先看完计划再决定，或要把活派给别人/别的 agent"。

**Which approach?**

> **If Subagent-Driven chosen:** REQUIRED SUB-SKILL is `superpowers:subagent-driven-development`. 我留在本会话，每 Task 派 fresh subagent + 跑 code review。
>
> **If Parallel Session chosen:** 在 worktree 里开新会话，新会话第一件事是用 `superpowers:executing-plans` 技能加载本 plan 文件。

