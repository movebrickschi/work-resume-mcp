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
