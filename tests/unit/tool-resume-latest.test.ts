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
