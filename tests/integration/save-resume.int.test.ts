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

  const { resumeLatest: freshResume } = await import('../../src/tools/resume-latest.js');
  const out = await freshResume(workspaceRoot, {});
  expect(out.semantic_checkpoint?.summary).toContain('wip on a.ts');
  expect(out.head_match).toBe(true);
  expect(out.git_status?.dirty_files).toContain('a.ts');
});
