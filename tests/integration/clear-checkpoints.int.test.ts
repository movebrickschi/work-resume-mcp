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

  const oldP = await writePhysical(repo, {
    triggered_by_tool: 'save_progress',
    branch: 'main',
    git_head: 'oldhead',
    files_changed: [],
    total_diff_size_bytes: 0,
  });
  const f = path.join(repo, '.work-resume/auto-snapshots', `${oldP.id}.json`);
  const obj = JSON.parse(await fs.readFile(f, 'utf8'));
  obj.saved_at = new Date(Date.now() - 48 * 3600_000).toISOString();
  await fs.writeFile(f, JSON.stringify(obj, null, 2));

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
  const preview = await clearCheckpoints(ws, { scope: 'all', dry_run: true });
  expect(preview.removed.length).toBe(1);
  const real = await clearCheckpoints(ws, { scope: 'all', before: new Date().toISOString() });
  expect(real.removed.length).toBe(1);
});

it('clear_checkpoints soft-deletes to .trash', async () => {
  await writePhysical(repo, { triggered_by_tool: 'save_progress', branch: 'main', git_head: 'h', files_changed: [], total_diff_size_bytes: 0 });
  await clearCheckpoints(ws, { scope: 'auto-snapshots' });
  const trash = await fs.readdir(path.join(repo, '.work-resume/.trash'));
  expect(trash.length).toBeGreaterThan(0);
});
