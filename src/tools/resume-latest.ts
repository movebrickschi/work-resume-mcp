import { getGitStatus, isGitRepo } from '../git.js';
import { scanRepos } from '../repo-scanner.js';
import { readLatestSemantic, readPhysicalsAfter, type SemanticCheckpoint, type PhysicalCheckpoint } from '../storage.js';
import { loadConfig } from '../config.js';

export interface ResumeLatestInput {
  branch?: string;
  repo_root?: string;
}

export interface ResumeLatestOutput {
  repo_root: string;
  semantic_checkpoint: SemanticCheckpoint | null;
  physical_snapshots_since: PhysicalCheckpoint[];
  git_status: { head: string; branch: string; dirty_files: string[] } | null;
  head_match: boolean;
  hint: string;
  ago: string;
  available_repos?: string[];
}

function err(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

function formatAgo(isoTs: string | undefined): string {
  if (!isoTs) return 'never';
  const ms = Date.now() - Date.parse(isoTs);
  if (!Number.isFinite(ms)) return 'unknown';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function buildHint(
  sem: SemanticCheckpoint | null,
  status: { head: string; branch: string; dirty_files: string[] } | null,
): { head_match: boolean; hint: string } {
  if (!sem) return { head_match: false, hint: 'No semantic checkpoint found. Start a fresh session or ask the user.' };
  if (!status) return { head_match: false, hint: 'Target repo is not a git repo or could not be inspected. Only summary/next_steps are reliable.' };

  const head_match = sem.git_head === status.head;
  if (!head_match) {
    return {
      head_match: false,
      hint: `WARNING: Git HEAD has changed (snapshot=${sem.git_head?.slice(0, 7)}, current=${status.head.slice(0, 7)}). Reliable info: summary, next_steps, files_in_focus, changed_symbols from physical snapshots. Confirm with the user before continuing.`,
    };
  }
  const focusSet = new Set(sem.files_in_focus);
  const dirtySet = new Set(status.dirty_files);
  const covers = [...focusSet].every((f) => dirtySet.has(f));
  if (covers) {
    return {
      head_match: true,
      hint: 'Git HEAD matches and dirty files cover snapshot focus. Run `git diff` to see uncommitted changes, then follow next_steps.',
    };
  }
  return {
    head_match: true,
    hint: 'Git HEAD matches but the dirty file set has changed since the snapshot. Run `git diff` first; compare changed_symbols in physical snapshots to identify what AI changed vs what user changed.',
  };
}

export async function resumeLatest(workspaceRoot: string, input: ResumeLatestInput): Promise<ResumeLatestOutput> {
  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);

  if (repos.length === 0) {
    err('NOT_IN_GIT_REPO', `no git repos found under ${cfg.projectRoot}`);
  }

  const repo = input.repo_root && repos.includes(input.repo_root) ? input.repo_root : repos[0];
  const status = (await isGitRepo(repo)) ? await getGitStatus(repo) : null;

  const sem = await readLatestSemantic(repo, input.branch ?? status?.branch);
  const physicals = sem ? await readPhysicalsAfter(repo, sem.saved_at) : [];

  const { head_match, hint } = buildHint(sem, status);

  return {
    repo_root: repo,
    semantic_checkpoint: sem,
    physical_snapshots_since: physicals,
    git_status: status,
    head_match,
    hint,
    ago: formatAgo(sem?.saved_at),
    available_repos: repos.length > 1 ? repos : undefined,
  };
}
