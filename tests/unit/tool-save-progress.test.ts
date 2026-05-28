import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/git.js', () => ({
  isGitRepo: vi.fn(),
  getGitStatus: vi.fn(),
  getRepoTopLevel: vi.fn(),
}));
vi.mock('../../src/repo-scanner.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/repo-scanner.js')>('../../src/repo-scanner.js');
  return {
    ...actual,
    scanRepos: vi.fn(),
    resolveRepoForFile: vi.fn(),
    clearScanCache: vi.fn(),
  };
});

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
      summary: 'wip path',
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

  it('honors explicit repo_root for cross-project work', async () => {
    (scanRepos as any).mockResolvedValue([]);
    (resolveRepoForFile as any).mockReturnValue(null);
    const out = await saveProgress(workspaceRoot, {
      summary: 'cross-project commit and push',
      next_steps: ['verify deploy'],
      files_in_focus: [path.join(frontend, 'src/router/index.ts')],
      repo_root: frontend,
    });
    expect(out.repo_root).toBe(frontend);
    expect(out.checkpoint_id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{6}$/);
  });

  it('rejects when files_in_focus escapes explicit repo_root', async () => {
    (scanRepos as any).mockResolvedValue([]);
    await expect(saveProgress(workspaceRoot, {
      summary: 'mismatched repo root',
      next_steps: ['x'],
      files_in_focus: [path.join(backend, 'a.go')],
      repo_root: frontend,
    })).rejects.toThrow(/PATH_ESCAPE/);
  });

  it('falls back to getRepoTopLevel when workspaceRoot has no repos', async () => {
    (scanRepos as any).mockResolvedValue([]);
    const out = await saveProgress(workspaceRoot, {
      summary: 'work in sibling repo via absolute path',
      next_steps: ['continue'],
      files_in_focus: [path.join(frontend, 'src/a.ts')],
    });
    expect(out.repo_root).toBe(frontend);
    expect(getRepoTopLevel).toHaveBeenCalled();
  });

  it('errors when no repos and files_in_focus are all relative paths', async () => {
    (scanRepos as any).mockResolvedValue([]);
    (getRepoTopLevel as any).mockResolvedValue(null);
    await expect(saveProgress(workspaceRoot, {
      summary: 'no way to find repo',
      next_steps: ['x'],
      files_in_focus: ['src/a.ts'],
    })).rejects.toThrow(/NOT_IN_GIT_REPO/);
  });

  it('errors when inferred repos span multiple', async () => {
    (scanRepos as any).mockResolvedValue([]);
    (getRepoTopLevel as any).mockImplementation(async (cwd: string) =>
      cwd.startsWith(frontend) ? frontend : backend);
    await expect(saveProgress(workspaceRoot, {
      summary: 'spanning two repos',
      next_steps: ['x'],
      files_in_focus: [path.join(frontend, 'a.ts'), path.join(backend, 'b.go')],
    })).rejects.toThrow(/MULTI_REPO_FILES/);
  });
});
