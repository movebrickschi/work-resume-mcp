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

function baseSemantic(branch = 'main') {
  return {
    summary: 'wip',
    next_steps: ['a'],
    files_in_focus: ['x.ts'],
    blockers: [],
    context_notes: '',
    todo_status: [],
    branch,
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
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('storage', () => {
  let repo: string;
  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-storage-'));
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

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
    const written = await writeSemantic(repo, sem);
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
    expect(list.map((p) => p.id)).toEqual([p1.id, p2.id]);
  });

  it('filters latest semantic by branch', async () => {
    await writeSemantic(repo, baseSemantic('a'));
    await sleep(5);
    await writeSemantic(repo, baseSemantic('b'));
    const a = await readLatestSemantic(repo, 'a');
    expect(a?.branch).toBe('a');
  });

  it('removeBeforeTimestamp soft-deletes by moving to .trash', async () => {
    const p = await writePhysical(repo, basePhysical('save_progress'));
    const removed = await removeBeforeTimestamp(repo, new Date(Date.now() + 1000).toISOString(), { scope: 'auto-snapshots' });
    expect(removed.map((r) => r.checkpoint_id)).toEqual([p.id]);
    const trashRoot = path.join(repo, '.work-resume', '.trash');
    const exists = await fs.stat(trashRoot).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('emptyTrashOlderThanDays purges old trash entries', async () => {
    await writePhysical(repo, basePhysical('save_progress'));
    await removeBeforeTimestamp(repo, new Date(Date.now() + 1000).toISOString(), { scope: 'auto-snapshots' });
    const trashRoot = path.join(repo, '.work-resume', '.trash');
    const entries = await fs.readdir(trashRoot);
    for (const e of entries) {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
      await fs.utimes(path.join(trashRoot, e), tenDaysAgo, tenDaysAgo);
    }
    const purged = await emptyTrashOlderThanDays(repo, 7);
    expect(purged).toBeGreaterThan(0);
  });

  it('writes index.json atomically across parallel writes (no half-written file)', async () => {
    const writes = Array.from({ length: 5 }, () => writeSemantic(repo, baseSemantic()));
    await Promise.all(writes);
    const idx = await readIndex(repo);
    expect(idx.checkpoints.length).toBe(5);
  });
});
