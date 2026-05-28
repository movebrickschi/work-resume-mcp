import { readIndex } from '../storage.js';
import { resolveTargetRepo } from '../repo-scanner.js';
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

export async function listCheckpoints(workspaceRoot: string, input: ListCheckpointsInput): Promise<ListedCheckpoint[]> {
  const cfg = loadConfig(workspaceRoot);
  const { repo } = await resolveTargetRepo({
    repoRoot: input.repo_root,
    workspaceRoot: cfg.projectRoot,
    maxScanDepth: cfg.maxRepoScanDepth,
  });
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
