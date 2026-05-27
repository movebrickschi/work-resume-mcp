import { readIndex } from '../storage.js';
import { scanRepos } from '../repo-scanner.js';
import { loadConfig } from '../config.js';

export interface ListCheckpointsInput {
  limit?: number;
  branch?: string;
  kind?: 'semantic' | 'physical' | 'all';
  repo_root?: string;
}

export interface ListedCheckpoint {
  checkpoint_id: string;
  kind: 'semantic' | 'physical';
  saved_at: string;
  branch?: string;
  git_head?: string;
  summary?: string;
  triggered_by_tool?: string;
}

function err(code: string, message: string): never { throw new Error(`${code}: ${message}`); }

export async function listCheckpoints(workspaceRoot: string, input: ListCheckpointsInput): Promise<ListedCheckpoint[]> {
  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
  if (repos.length === 0) err('NOT_IN_GIT_REPO', `no git repos found`);

  const repo = input.repo_root && repos.includes(input.repo_root) ? input.repo_root : repos[0];
  const limit = input.limit ?? 20;
  const kind = input.kind ?? 'semantic';

  const idx = await readIndex(repo);
  let entries = [...idx.checkpoints];
  if (kind !== 'all') entries = entries.filter((e) => e.kind === kind);
  if (input.branch) entries = entries.filter((e) => e.branch === input.branch);
  entries.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  return entries.slice(0, limit).map((e) => ({
    checkpoint_id: e.id,
    kind: e.kind,
    saved_at: e.saved_at,
    branch: e.branch,
    summary: e.summary,
    triggered_by_tool: e.triggered_by_tool,
  }));
}
