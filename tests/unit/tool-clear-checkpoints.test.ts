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
    expect(idx.checkpoints.length).toBe(2);
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
