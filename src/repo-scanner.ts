import * as fs from 'node:fs/promises';
import * as path from 'node:path';

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
