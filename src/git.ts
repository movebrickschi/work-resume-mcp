import { execa } from 'execa';

export interface GitStatus {
  head: string;
  branch: string;
  dirty_files: string[];
}

export interface DiffStat {
  added: number;
  removed: number;
}

export interface Hunk {
  addedStart: number;
  addedCount: number;
}

async function runGit(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execa('git', args, { cwd: repoRoot, reject: true });
  return stdout;
}

export async function isGitRepo(repoRoot: string): Promise<boolean> {
  try {
    await runGit(repoRoot, ['rev-parse', '--show-toplevel']);
    return true;
  } catch {
    return false;
  }
}

export async function getRepoTopLevel(cwd: string): Promise<string | null> {
  try {
    return (await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return null;
  }
}

export async function getGitStatus(repoRoot: string): Promise<GitStatus> {
  const head = (await runGit(repoRoot, ['rev-parse', 'HEAD'])).trim();
  const branch = (await runGit(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const porcelain = await runGit(repoRoot, ['status', '--porcelain']);
  const dirty_files = porcelain
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => l.slice(3).trim());
  return { head, branch, dirty_files };
}

export async function getDirtyDiff(
  repoRoot: string,
  maxBytes = 100_000,
): Promise<{ diff: string; truncated: boolean }> {
  const full = await runGit(repoRoot, ['diff', 'HEAD']);
  if (full.length <= maxBytes) return { diff: full, truncated: false };
  return { diff: full.slice(0, maxBytes), truncated: true };
}

export async function getDiffStat(repoRoot: string): Promise<Map<string, DiffStat>> {
  const out = await runGit(repoRoot, ['diff', 'HEAD', '--numstat']);
  const result = new Map<string, DiffStat>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [a, r, ...rest] = line.split('\t');
    const file = rest.join('\t');
    const added = a === '-' ? 0 : Number(a);
    const removed = r === '-' ? 0 : Number(r);
    result.set(file, { added, removed });
  }
  return result;
}

export async function getHunksUnified0(repoRoot: string): Promise<Map<string, Hunk[]>> {
  const out = await runGit(repoRoot, ['diff', 'HEAD', '--unified=0']);
  const map = new Map<string, Hunk[]>();
  let current: string | null = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice(6).trim();
      if (!map.has(current)) map.set(current, []);
      continue;
    }
    if (line.startsWith('@@') && current) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (m) {
        const addedStart = Number(m[1]);
        const addedCount = m[2] !== undefined ? Number(m[2]) : 1;
        if (addedCount > 0) map.get(current)!.push({ addedStart, addedCount });
      }
    }
  }
  return map;
}

export async function getDiffSinceCommit(
  repoRoot: string,
  baseHead: string,
  maxBytes = 100_000,
): Promise<{ diff: string; truncated: boolean }> {
  const committedSinceBase = await runGit(repoRoot, ['diff', baseHead, 'HEAD']);
  const dirty = await runGit(repoRoot, ['diff', 'HEAD']);
  const combined = committedSinceBase + (dirty ? `\n--- uncommitted ---\n${dirty}` : '');
  if (combined.length <= maxBytes) return { diff: combined, truncated: false };
  return { diff: combined.slice(0, maxBytes), truncated: true };
}
