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
