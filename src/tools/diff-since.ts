import { readById } from '../storage.js';
import { resolveTargetRepo } from '../repo-scanner.js';
import { getDiffSinceCommit } from '../git.js';
import { loadConfig } from '../config.js';

export interface DiffSinceInput {
  checkpoint_id: string;
  repo_root?: string;
}

export interface DiffSinceOutput {
  files_changed: string[];
  diff: string;
  truncated: boolean;
}

function err(code: string, message: string): never { throw new Error(`${code}: ${message}`); }

function parseFilesFromDiff(diff: string): string[] {
  const set = new Set<string>();
  for (const line of diff.split('\n')) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) set.add(m[2]);
  }
  return [...set];
}

export async function diffSince(workspaceRoot: string, input: DiffSinceInput): Promise<DiffSinceOutput> {
  if (!input.checkpoint_id) err('VALIDATION', 'checkpoint_id is required');
  const cfg = loadConfig(workspaceRoot);
  const { allRepos } = await resolveTargetRepo({
    repoRoot: input.repo_root,
    workspaceRoot: cfg.projectRoot,
    maxScanDepth: cfg.maxRepoScanDepth,
  });

  let foundRepo: string | null = null;
  let cp: any = null;
  for (const r of allRepos) {
    cp = await readById(r, input.checkpoint_id);
    if (cp) { foundRepo = r; break; }
  }
  if (!cp || !foundRepo) err('CHECKPOINT_NOT_FOUND', input.checkpoint_id);

  const baseHead = cp.git_head;
  if (!baseHead) err('VALIDATION', `checkpoint has no git_head: ${input.checkpoint_id}`);

  const { diff, truncated } = await getDiffSinceCommit(foundRepo, baseHead);
  return { files_changed: parseFilesFromDiff(diff), diff, truncated };
}
