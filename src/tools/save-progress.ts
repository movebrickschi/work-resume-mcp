import * as path from 'node:path';
import { getGitStatus, isGitRepo } from '../git.js';
import { scanRepos, resolveRepoForFile } from '../repo-scanner.js';
import { writeSemantic } from '../storage.js';
import { loadConfig } from '../config.js';

export interface SaveProgressInput {
  summary: string;
  next_steps: string[];
  files_in_focus: string[];
  blockers?: string[];
  context_notes?: string;
  todo_status?: Array<{ id: string; content: string; status: string }>;
}

export interface SaveProgressOutput {
  checkpoint_id: string;
  saved_at: string;
  repo_root: string;
  git_head?: string;
  branch?: string;
  dirty_files_count: number;
}

function err(code: string, message: string): never {
  throw new Error(`${code}: ${message}`);
}

export async function saveProgress(workspaceRoot: string, input: SaveProgressInput): Promise<SaveProgressOutput> {
  if (!input.summary || input.summary.trim().length < 8) {
    err('VALIDATION', 'summary must be non-empty and at least 8 chars');
  }
  if (!Array.isArray(input.next_steps) || input.next_steps.length === 0) {
    err('VALIDATION', 'next_steps must be a non-empty array');
  }
  for (const s of input.next_steps) {
    if (typeof s !== 'string' || s.trim().length === 0) {
      err('VALIDATION', 'each next_steps entry must be a non-empty string');
    }
  }
  if (!Array.isArray(input.files_in_focus)) {
    err('VALIDATION', 'files_in_focus must be an array');
  }
  for (const f of input.files_in_focus) {
    if (typeof f !== 'string' || f.length === 0) err('VALIDATION', 'files_in_focus contains non-string');
    if (f.includes('..')) err('PATH_ESCAPE', `path contains "..": ${f}`);
  }

  const cfg = loadConfig(workspaceRoot);
  const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
  if (repos.length === 0) err('NOT_IN_GIT_REPO', `no git repos found under ${cfg.projectRoot}`);

  let targetRepo: string | null = null;
  for (const f of input.files_in_focus) {
    const abs = path.isAbsolute(f) ? f : path.resolve(workspaceRoot, f);
    const repo = resolveRepoForFile(abs, repos);
    if (!repo) err('PATH_ESCAPE', `file outside all repos: ${f}`);
    if (targetRepo && repo !== targetRepo) err('MULTI_REPO_FILES', `files span repos: ${targetRepo} vs ${repo}`);
    targetRepo = repo;
  }
  if (!targetRepo) targetRepo = repos[0];

  if (!(await isGitRepo(targetRepo))) {
    err('NOT_IN_GIT_REPO', `target repo not a git repo: ${targetRepo}`);
  }

  const status = await getGitStatus(targetRepo);

  const relFiles = input.files_in_focus.map((f) => {
    const abs = path.isAbsolute(f) ? f : path.resolve(workspaceRoot, f);
    return path.relative(targetRepo!, abs);
  });

  const cp = await writeSemantic(targetRepo, {
    summary: input.summary,
    next_steps: input.next_steps,
    files_in_focus: relFiles,
    blockers: input.blockers ?? [],
    context_notes: input.context_notes,
    todo_status: input.todo_status,
    branch: status.branch,
    git_head: status.head,
    dirty_files_count: status.dirty_files.length,
  });

  return {
    checkpoint_id: cp.id,
    saved_at: cp.saved_at,
    repo_root: targetRepo,
    git_head: status.head,
    branch: status.branch,
    dirty_files_count: status.dirty_files.length,
  };
}
