import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

const STORE = '.work-resume';

export type SemanticInput = {
  summary: string;
  next_steps: string[];
  files_in_focus: string[];
  blockers?: string[];
  context_notes?: string;
  todo_status?: Array<{ id: string; content: string; status: string }>;
  branch?: string;
  git_head?: string;
  dirty_files_count: number;
};

export type SemanticCheckpoint = SemanticInput & {
  kind: 'semantic';
  id: string;
  saved_at: string;
};

export type PhysicalInput = {
  triggered_by_tool: string;
  branch?: string;
  git_head?: string;
  files_changed: Array<{
    path: string;
    stat: { added: number; removed: number };
    changed_symbols: string[];
    diff_hash: string;
  }>;
  total_diff_size_bytes: number;
};

export type PhysicalCheckpoint = PhysicalInput & {
  kind: 'physical';
  id: string;
  saved_at: string;
};

export interface IndexEntry {
  id: string;
  kind: 'semantic' | 'physical';
  saved_at: string;
  branch?: string;
  summary?: string;
  triggered_by_tool?: string;
}

export interface IndexFile {
  version: 1;
  checkpoints: IndexEntry[];
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-` +
    randomBytes(3).toString('hex')
  );
}

async function ensureDirs(repo: string): Promise<void> {
  const root = path.join(repo, STORE);
  await fs.mkdir(path.join(root, 'checkpoints'), { recursive: true });
  await fs.mkdir(path.join(root, 'auto-snapshots'), { recursive: true });
  await fs.mkdir(path.join(root, '.trash'), { recursive: true });
}

async function readIndexRaw(repo: string): Promise<IndexFile> {
  const p = path.join(repo, STORE, 'index.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as IndexFile;
  } catch {
    return { version: 1, checkpoints: [] };
  }
}

let indexQueue: Promise<void> = Promise.resolve();

async function writeIndex(repo: string, mutator: (idx: IndexFile) => void): Promise<void> {
  indexQueue = indexQueue.then(async () => {
    const idx = await readIndexRaw(repo);
    mutator(idx);
    const p = path.join(repo, STORE, 'index.json');
    const tmp = `${p}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(idx, null, 2));
    await fs.rename(tmp, p);
  });
  await indexQueue;
}

export async function readIndex(repo: string): Promise<IndexFile> {
  return readIndexRaw(repo);
}

export async function writeSemantic(repo: string, input: SemanticInput): Promise<SemanticCheckpoint> {
  await ensureDirs(repo);
  const id = ts();
  const saved_at = new Date().toISOString();
  const obj: SemanticCheckpoint = { kind: 'semantic', id, saved_at, ...input };
  await fs.writeFile(
    path.join(repo, STORE, 'checkpoints', `${id}.json`),
    JSON.stringify(obj, null, 2),
  );
  await writeIndex(repo, (idx) => {
    idx.checkpoints.push({
      id,
      kind: 'semantic',
      saved_at,
      branch: input.branch,
      summary: input.summary,
    });
  });
  return obj;
}

export async function writePhysical(repo: string, input: PhysicalInput): Promise<PhysicalCheckpoint> {
  await ensureDirs(repo);
  const id = ts();
  const saved_at = new Date().toISOString();
  const obj: PhysicalCheckpoint = { kind: 'physical', id, saved_at, ...input };
  await fs.writeFile(
    path.join(repo, STORE, 'auto-snapshots', `${id}.json`),
    JSON.stringify(obj, null, 2),
  );
  await writeIndex(repo, (idx) => {
    idx.checkpoints.push({
      id,
      kind: 'physical',
      saved_at,
      branch: input.branch,
      triggered_by_tool: input.triggered_by_tool,
    });
  });
  return obj;
}

export async function readById(
  repo: string,
  id: string,
): Promise<SemanticCheckpoint | PhysicalCheckpoint | null> {
  for (const sub of ['checkpoints', 'auto-snapshots']) {
    const p = path.join(repo, STORE, sub, `${id}.json`);
    try {
      const raw = await fs.readFile(p, 'utf8');
      return JSON.parse(raw);
    } catch {
      continue;
    }
  }
  return null;
}

export async function readLatestSemantic(
  repo: string,
  branch?: string,
): Promise<SemanticCheckpoint | null> {
  const idx = await readIndexRaw(repo);
  const cands = idx.checkpoints
    .filter((c) => c.kind === 'semantic')
    .filter((c) => branch === undefined || c.branch === branch)
    .sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  if (cands.length === 0) return null;
  return (await readById(repo, cands[0].id)) as SemanticCheckpoint | null;
}

export async function readPhysicalsAfter(
  repo: string,
  isoTs: string,
): Promise<PhysicalCheckpoint[]> {
  const idx = await readIndexRaw(repo);
  const cands = idx.checkpoints
    .filter((c) => c.kind === 'physical' && c.saved_at > isoTs)
    .sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  const out: PhysicalCheckpoint[] = [];
  for (const c of cands) {
    const obj = await readById(repo, c.id);
    if (obj) out.push(obj as PhysicalCheckpoint);
  }
  return out;
}

export async function lastPhysicalSavedAt(repo: string): Promise<number> {
  const idx = await readIndexRaw(repo);
  const tsList = idx.checkpoints
    .filter((c) => c.kind === 'physical')
    .map((c) => Date.parse(c.saved_at))
    .filter((n) => Number.isFinite(n));
  if (tsList.length === 0) return 0;
  return Math.max(...tsList);
}

export interface RemoveOptions {
  scope: 'auto-snapshots' | 'semantic' | 'all';
  branch?: string;
}

export async function removeBeforeTimestamp(
  repo: string,
  beforeIso: string,
  opts: RemoveOptions,
): Promise<Array<{ checkpoint_id: string; kind: 'semantic' | 'physical'; saved_at: string; branch?: string }>> {
  await ensureDirs(repo);
  const idx = await readIndexRaw(repo);
  const targets = idx.checkpoints.filter((c) => {
    if (c.saved_at >= beforeIso) return false;
    if (opts.scope === 'semantic' && c.kind !== 'semantic') return false;
    if (opts.scope === 'auto-snapshots' && c.kind !== 'physical') return false;
    if (opts.branch && c.branch !== opts.branch) return false;
    return true;
  });

  if (targets.length === 0) return [];

  const trashDir = path.join(repo, STORE, '.trash', `${ts()}`);
  await fs.mkdir(trashDir, { recursive: true });

  for (const t of targets) {
    const sub = t.kind === 'semantic' ? 'checkpoints' : 'auto-snapshots';
    const src = path.join(repo, STORE, sub, `${t.id}.json`);
    const dst = path.join(trashDir, `${t.kind}-${t.id}.json`);
    try {
      await fs.rename(src, dst);
    } catch {
      // file already gone
    }
  }

  await writeIndex(repo, (curr) => {
    const removedIds = new Set(targets.map((t) => t.id));
    curr.checkpoints = curr.checkpoints.filter((c) => !removedIds.has(c.id));
  });

  return targets.map((t) => ({
    checkpoint_id: t.id,
    kind: t.kind,
    saved_at: t.saved_at,
    branch: t.branch,
  }));
}

export async function emptyTrashOlderThanDays(repo: string, days: number): Promise<number> {
  const trashRoot = path.join(repo, STORE, '.trash');
  let entries: string[];
  try {
    entries = await fs.readdir(trashRoot);
  } catch {
    return 0;
  }
  const threshold = Date.now() - days * 24 * 3600 * 1000;
  let purged = 0;
  for (const name of entries) {
    const full = path.join(trashRoot, name);
    try {
      const st = await fs.stat(full);
      if (st.mtimeMs < threshold) {
        await fs.rm(full, { recursive: true, force: true });
        purged++;
      }
    } catch {
      // ignore
    }
  }
  return purged;
}
