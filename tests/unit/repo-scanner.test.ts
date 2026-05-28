import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execa } from 'execa';
import { scanRepos, resolveRepoForFile, resolveTargetRepo, clearScanCache } from '../../src/repo-scanner.js';

async function mkRepo(root: string, rel: string): Promise<string> {
  const repo = path.join(root, rel);
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  return repo;
}

async function mkRealRepo(root: string, rel: string): Promise<string> {
  const repo = path.join(root, rel);
  await fs.mkdir(repo, { recursive: true });
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  return repo;
}

function norm(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('scanRepos', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-scan-'));
    clearScanCache();
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('discovers nested git repos up to maxDepth', async () => {
    await mkRepo(tmp, 'frontend');
    await mkRepo(tmp, 'backend');
    await mkRepo(tmp, path.join('libs', 'shared'));
    const repos = await scanRepos(tmp, 3);
    const rel = repos.map((r) => norm(path.relative(tmp, r))).sort();
    expect(rel).toEqual(['backend', 'frontend', 'libs/shared'].sort());
  });

  it('does not recurse into .git directories', async () => {
    const a = await mkRepo(tmp, 'a');
    await fs.mkdir(path.join(a, '.git', 'nested'), { recursive: true });
    const repos = await scanRepos(tmp, 3);
    expect(repos.map(norm)).toEqual([norm(a)]);
  });

  it('skips node_modules / dist / build / target / vendor / .next / .nuxt / .cache', async () => {
    await mkRepo(tmp, path.join('node_modules', 'nested'));
    await mkRepo(tmp, path.join('dist', 'nested'));
    await mkRepo(tmp, path.join('build', 'nested'));
    await mkRepo(tmp, path.join('target', 'nested'));
    await mkRepo(tmp, path.join('vendor', 'nested'));
    await mkRepo(tmp, path.join('.next', 'nested'));
    await mkRepo(tmp, path.join('.nuxt', 'nested'));
    await mkRepo(tmp, path.join('.cache', 'nested'));
    await mkRepo(tmp, 'real-repo');
    const repos = await scanRepos(tmp, 3);
    expect(repos.map((r) => path.basename(r))).toEqual(['real-repo']);
  });

  it('respects maxDepth=0 (only scans root itself when root is a repo)', async () => {
    await mkRepo(tmp, '.');
    await mkRepo(tmp, 'nested');
    const repos = await scanRepos(tmp, 0);
    expect(repos.map(norm)).toEqual([norm(tmp)]);
  });

  it('caches results for 5 min; clearScanCache resets', async () => {
    await mkRepo(tmp, 'a');
    const r1 = await scanRepos(tmp, 3);
    await mkRepo(tmp, 'b');
    const r2 = await scanRepos(tmp, 3);
    expect(r2).toEqual(r1);
    clearScanCache();
    const r3 = await scanRepos(tmp, 3);
    expect(r3.length).toBe(2);
  });
});

describe('resolveRepoForFile', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-resolve-'));
    clearScanCache();
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns the nearest ancestor repo root', async () => {
    const fe = await mkRepo(tmp, 'frontend');
    const be = await mkRepo(tmp, 'backend');
    const repos = await scanRepos(tmp, 3);
    const target = path.join(fe, 'src', 'components', 'App.tsx');
    expect(norm(resolveRepoForFile(target, repos) ?? '')).toBe(norm(fe));
    expect(norm(resolveRepoForFile(path.join(be, 'main.go'), repos) ?? '')).toBe(norm(be));
  });

  it('returns null when file is outside all repos', async () => {
    await mkRepo(tmp, 'inside');
    const repos = await scanRepos(tmp, 3);
    expect(resolveRepoForFile(path.join(tmp, 'outside.txt'), repos)).toBeNull();
  });
});

describe('resolveTargetRepo', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-target-'));
    clearScanCache();
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('honors explicit repoRoot and validates it is a git repo', async () => {
    const repo = await mkRealRepo(tmp, 'project-a');
    const out = await resolveTargetRepo({
      repoRoot: repo,
      workspaceRoot: '/totally/unrelated',
      maxScanDepth: 0,
    });
    expect(norm(out.repo)).toBe(norm(repo));
    expect(out.allRepos.map(norm)).toEqual([norm(repo)]);
  });

  it('throws NOT_IN_GIT_REPO when explicit repoRoot is not a git repo', async () => {
    const notRepo = path.join(tmp, 'plain-dir');
    await fs.mkdir(notRepo, { recursive: true });
    await expect(resolveTargetRepo({
      repoRoot: notRepo,
      workspaceRoot: '/whatever',
      maxScanDepth: 0,
    })).rejects.toThrow(/NOT_IN_GIT_REPO/);
  });

  it('falls back to workspace scan when no explicit repoRoot', async () => {
    const a = await mkRepo(tmp, 'a');
    const b = await mkRepo(tmp, 'b');
    const out = await resolveTargetRepo({ workspaceRoot: tmp, maxScanDepth: 3 });
    expect(out.allRepos.map(norm).sort()).toEqual([norm(a), norm(b)].sort());
    expect(out.allRepos.map(norm)).toContain(norm(out.repo));
  });

  it('throws NOT_IN_GIT_REPO with cross-project hint when workspace has nothing', async () => {
    await expect(resolveTargetRepo({ workspaceRoot: tmp, maxScanDepth: 3 }))
      .rejects.toThrow(/NOT_IN_GIT_REPO.*cross-project/);
  });
});
