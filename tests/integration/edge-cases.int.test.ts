import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execa } from 'execa';
import { saveProgress } from '../../src/tools/save-progress.js';
import { resumeLatest } from '../../src/tools/resume-latest.js';
import { clearScanCache } from '../../src/repo-scanner.js';

async function gitRepo(parent: string, name: string): Promise<string> {
  const r = path.join(parent, name);
  await fs.mkdir(r, { recursive: true });
  await execa('git', ['init', '-b', 'main'], { cwd: r });
  await execa('git', ['config', 'user.email', 't@l'], { cwd: r });
  await execa('git', ['config', 'user.name', 't'], { cwd: r });
  await fs.writeFile(path.join(r, 'seed.txt'), 'x');
  await execa('git', ['add', '.'], { cwd: r });
  await execa('git', ['commit', '-m', 'init'], { cwd: r });
  return r;
}

let ws: string;
beforeEach(async () => {
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-edge-'));
  clearScanCache();
});

it('detects HEAD change between save and resume', async () => {
  const repo = await gitRepo(ws, 'r');
  await fs.writeFile(path.join(repo, 'a.ts'), 'function foo(){}');
  await saveProgress(ws, {
    summary: 'wip work on a.ts function foo',
    next_steps: ['add bar()'],
    files_in_focus: [path.join(repo, 'a.ts')],
  });
  await execa('git', ['add', '.'], { cwd: repo });
  await execa('git', ['commit', '-m', 'wip'], { cwd: repo });
  const out = await resumeLatest(ws, {});
  expect(out.head_match).toBe(false);
  expect(out.hint).toMatch(/HEAD has changed/);
});

it('routes save_progress to the correct repo in monorepo', async () => {
  const fe = await gitRepo(ws, 'frontend');
  const be = await gitRepo(ws, 'backend');
  await fs.writeFile(path.join(fe, 'src.ts'), 'x');
  const out = await saveProgress(ws, {
    summary: 'frontend work on src.ts',
    next_steps: ['x'],
    files_in_focus: [path.join(fe, 'src.ts')],
  });
  expect(out.repo_root).toBe(fe);
  const idxFe = JSON.parse(await fs.readFile(path.join(fe, '.work-resume/index.json'), 'utf8'));
  expect(idxFe.checkpoints.length).toBe(1);
  await expect(fs.access(path.join(be, '.work-resume/index.json'))).rejects.toThrow();
});

it('returns NOT_IN_GIT_REPO when workspace has no git', async () => {
  await expect(saveProgress(ws, {
    summary: 'wip outside any git repo',
    next_steps: ['x'],
    files_in_focus: [path.join(ws, 'a.txt')],
  })).rejects.toThrow(/NOT_IN_GIT_REPO/);
});
