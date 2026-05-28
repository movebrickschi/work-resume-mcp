import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { isGitRepo } from './git.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.cache',
  'dist',
  'build',
  'target',
  'vendor',
  '.next',
  '.nuxt',
]);

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  repos: string[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearScanCache(): void {
  cache.clear();
}

export async function scanRepos(root: string, maxDepth: number): Promise<string[]> {
  const absRoot = path.resolve(root);
  const cached = cache.get(absRoot);
  if (cached && cached.expiresAt > Date.now()) return cached.repos;

  const repos: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((e) => e.isDirectory() && e.name === '.git')) {
      repos.push(dir);
      return;
    }

    if (depth >= maxDepth) return;

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.')) continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  }

  await walk(absRoot, 0);
  repos.sort();
  cache.set(absRoot, { repos, expiresAt: Date.now() + CACHE_TTL_MS });
  return repos;
}

export function resolveRepoForFile(filePath: string, repos: string[]): string | null {
  const abs = path.resolve(filePath);
  let best: string | null = null;
  for (const repo of repos) {
    if (abs === repo || abs.startsWith(repo + path.sep)) {
      if (!best || repo.length > best.length) best = repo;
    }
  }
  return best;
}

export interface ResolveTargetRepoOptions {
  /** Explicit absolute git repo path; bypasses workspace scan when provided. */
  repoRoot?: string;
  /** Where to scan if `repoRoot` is not given (typically cfg.projectRoot). */
  workspaceRoot: string;
  /** Scan depth (typically cfg.maxRepoScanDepth). */
  maxScanDepth: number;
}

export interface ResolveTargetRepoResult {
  /** Chosen target repo (already validated as a git repo). */
  repo: string;
  /** All scanned repos under workspaceRoot. Empty when an explicit repoRoot was used. */
  allRepos: string[];
}

/**
 * Common repo resolution for read-side tools (resume_latest / list / diff / clear).
 * Honors explicit repo_root first so cross-project work (Cursor workspace = empty dir)
 * never silently falls back to workspace scan.
 *
 * Throws (with code-prefixed Error message):
 *   NOT_IN_GIT_REPO when repoRoot is set but not actually a git repo,
 *   NOT_IN_GIT_REPO when no repoRoot and workspace scan yields nothing.
 */
export async function resolveTargetRepo(opts: ResolveTargetRepoOptions): Promise<ResolveTargetRepoResult> {
  if (opts.repoRoot && opts.repoRoot.trim()) {
    const explicit = path.resolve(opts.repoRoot.trim());
    if (!(await isGitRepo(explicit))) {
      throw new Error(`NOT_IN_GIT_REPO: repo_root is not a git repo: ${explicit}`);
    }
    return { repo: explicit, allRepos: [explicit] };
  }

  const repos = await scanRepos(opts.workspaceRoot, opts.maxScanDepth);
  if (repos.length === 0) {
    throw new Error(
      `NOT_IN_GIT_REPO: no git repos found under ${opts.workspaceRoot}; ` +
      `pass repo_root explicitly for cross-project work`,
    );
  }
  return { repo: repos[0], allRepos: repos };
}
