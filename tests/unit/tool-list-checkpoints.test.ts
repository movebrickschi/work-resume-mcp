import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('../../src/repo-scanner.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/repo-scanner.js')>('../../src/repo-scanner.js');
  return {
    ...actual,
    scanRepos: vi.fn(),
    resolveRepoForFile: vi.fn(),
    clearScanCache: vi.fn(),
  };
});

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
