import { removeBeforeTimestamp, readIndex, emptyTrashOlderThanDays } from '../storage.js';
import { scanRepos } from '../repo-scanner.js';
import { loadConfig } from '../config.js';

export interface ClearCheckpointsInput {
  scope: 'auto-snapshots' | 'semantic' | 'all';
  before?: string;
  branch?: string;
  repo_root?: string;
  dry_run?: boolean;
}

export interface ClearCheckpointsOutput {
  repo_root: string;
  removed: Array<{ checkpoint_id: string; kind: 'semantic' | 'physical'; saved_at: string; branch?: string }>;
  remaining_count: number;
  dry_run: boolean;
}

function err(code: string, message: string): never { throw new Error(`${code}: ${message}`); }

export async function clearCheckpoints(workspaceRoot: string, input: ClearCheckpointsInput): Promise<ClearCheckpointsOutput> {
  if (!['auto-snapshots','semantic','all'].includes(input.scope)) {
    err('VALIDATION', `unknown scope: ${input.scope}`);
  }
  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
  if (repos.length === 0) err('NOT_IN_GIT_REPO', `no git repos found`);

  const repo = input.repo_root && repos.includes(input.repo_root) ? input.repo_root : repos[0];

  if (input.scope === 'all' && !input.before && !input.branch && !input.dry_run) {
    err('CONFIRM_REQUIRED', `scope=all without filters requires dry_run=true on first call. Re-run with dry_run=false after reviewing the dry-run output.`);
  }

  const beforeIso = input.before ?? new Date().toISOString();

  if (input.dry_run) {
    const idx = await readIndex(repo);
    const candidates = idx.checkpoints.filter((c) => {
      if (c.saved_at >= beforeIso) return false;
      if (input.scope === 'semantic' && c.kind !== 'semantic') return false;
      if (input.scope === 'auto-snapshots' && c.kind !== 'physical') return false;
      if (input.branch && c.branch !== input.branch) return false;
      return true;
    });
    const remaining = idx.checkpoints.length - candidates.length;
    return {
      repo_root: repo,
      removed: candidates.map((c) => ({ checkpoint_id: c.id, kind: c.kind, saved_at: c.saved_at, branch: c.branch })),
      remaining_count: remaining,
      dry_run: true,
    };
  }

  const removed = await removeBeforeTimestamp(repo, beforeIso, {
    scope: input.scope,
    branch: input.branch,
  });

  await emptyTrashOlderThanDays(repo, cfg.trashRetentionDays);

  const idxAfter = await readIndex(repo);
  return {
    repo_root: repo,
    removed,
    remaining_count: idxAfter.checkpoints.length,
    dry_run: false,
  };
}
