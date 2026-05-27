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

    await fs.writeFile(path.join(repo, 'src-a.ts'), 'placeholder');
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
    expect(idx.checkpoints.length).toBeLessThanOrEqual(1);
  });
});
