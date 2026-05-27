import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { isGitRepo, getGitStatus, getDiffStat, getHunksUnified0 } from './git.js';
import { extractChangedSymbols } from './tree-sitter/index.js';
import {
  writePhysical,
  lastPhysicalSavedAt,
  removeBeforeTimestamp,
  emptyTrashOlderThanDays,
  type PhysicalCheckpoint,
} from './storage.js';

export const SKIP_AUTO_SNAPSHOT: ReadonlySet<string> = new Set([
  'clear_checkpoints',
  'list_checkpoints',
  'diff_since',
]);

export interface AutoSnapshotOptions {
  autoIntervalMs: number;
  autoRetentionHours: number;
  trashRetentionDays?: number;
}

export async function autoSnapshotIfStale(
  repo: string,
  toolName: string,
  opts: AutoSnapshotOptions,
): Promise<PhysicalCheckpoint | null> {
  if (SKIP_AUTO_SNAPSHOT.has(toolName)) return null;
  if (!(await isGitRepo(repo))) return null;

  const lastAt = await lastPhysicalSavedAt(repo);
  if (lastAt > 0 && Date.now() - lastAt < opts.autoIntervalMs) return null;

  const status = await getGitStatus(repo);
  if (status.dirty_files.length === 0) return null;

  const statMap = await getDiffStat(repo);
  const hunkMap = await getHunksUnified0(repo);

  const files_changed = [];
  let totalSize = 0;

  for (const file of status.dirty_files) {
    const stat = statMap.get(file) ?? { added: 0, removed: 0 };
    const hunks = hunkMap.get(file) ?? [];
    let content = '';
    try {
      content = await fs.readFile(path.join(repo, file), 'utf8');
    } catch { /* binary or deleted file */ }
    const symbols = content ? await extractChangedSymbols(file, content, hunks).catch(() => []) : [];
    const diff_hash = createHash('sha256').update(content).digest('hex').slice(0, 32);
    totalSize += content.length;
    files_changed.push({ path: file, stat, changed_symbols: symbols, diff_hash });
  }

  const snap = await writePhysical(repo, {
    triggered_by_tool: toolName,
    branch: status.branch,
    git_head: status.head,
    files_changed,
    total_diff_size_bytes: totalSize,
  });

  const beforeIso = new Date(Date.now() - opts.autoRetentionHours * 3600 * 1000).toISOString();
  await removeBeforeTimestamp(repo, beforeIso, { scope: 'auto-snapshots' });

  if (opts.trashRetentionDays !== undefined && opts.trashRetentionDays > 0) {
    await emptyTrashOlderThanDays(repo, opts.trashRetentionDays);
  }

  return snap;
}
