import * as path from 'node:path';

export interface Config {
  projectRoot: string;
  storeDir: string;
  autoIntervalMs: number;
  autoRetentionHours: number;
  maxRepoScanDepth: number;
  langs: string[];
  fallback: 'regex' | 'empty';
  grammarLoad: 'lazy' | 'eager';
  trashRetentionDays: number;
}

const DEFAULT_LANGS = ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'rb', 'php'];

function parseIntEnv(name: string, defaultVal: number, min = 1): number {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new Error(`Invalid ${name}: ${raw} (expected integer >= ${min})`);
  }
  return n;
}

function parseEnum<T extends string>(name: string, defaultVal: T, allowed: readonly T[]): T {
  const raw = process.env[name];
  if (!raw) return defaultVal;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`Invalid ${name}: ${raw} (allowed: ${allowed.join('|')})`);
  }
  return raw as T;
}

function isMcpServerPackageDir(dir: string): boolean {
  const n = dir.replace(/\\/g, '/').toLowerCase();
  return n.includes('/work-resume-mcp') || n.endsWith('/dist');
}

/** Cursor may spawn MCP with cwd = server package dir; prefer WORKSPACE_FOLDER_PATHS then. */
export function resolveWorkspaceRoot(fallbackCwd = process.cwd()): string {
  if (process.env.WORK_RESUME_PROJECT_ROOT?.trim()) {
    return path.resolve(process.env.WORK_RESUME_PROJECT_ROOT.trim());
  }

  const fallback = path.resolve(fallbackCwd);

  const wfp = process.env.WORKSPACE_FOLDER_PATHS?.trim();
  if (wfp) {
    const parts = wfp.split(path.delimiter).flatMap((p) => p.split(',')).map((s) => s.trim()).filter(Boolean);
    const ws = parts[0] ? path.resolve(parts[0]) : null;
    if (ws && isMcpServerPackageDir(fallback)) return ws;
  }

  if (process.env.VSCODE_CWD?.trim() && isMcpServerPackageDir(fallback)) {
    return path.resolve(process.env.VSCODE_CWD.trim());
  }

  return fallback;
}

export function loadConfig(cwd: string): Config {
  const langsRaw = process.env.WORK_RESUME_LANGS;
  const langs = langsRaw
    ? langsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_LANGS;

  const projectRoot = resolveWorkspaceRoot(cwd);

  return {
    projectRoot,
    storeDir: process.env.WORK_RESUME_DIR || '.work-resume',
    autoIntervalMs: parseIntEnv('WORK_RESUME_AUTO_INTERVAL_MS', 60_000, 1),
    autoRetentionHours: parseIntEnv('WORK_RESUME_AUTO_RETENTION_HOURS', 24, 1),
    maxRepoScanDepth: parseIntEnv('WORK_RESUME_MAX_REPO_SCAN_DEPTH', 3, 0),
    langs,
    fallback: parseEnum('WORK_RESUME_FALLBACK', 'regex', ['regex', 'empty'] as const),
    grammarLoad: parseEnum('WORK_RESUME_GRAMMAR_LOAD', 'lazy', ['lazy', 'eager'] as const),
    trashRetentionDays: parseIntEnv('WORK_RESUME_TRASH_RETENTION_DAYS', 7, 1),
  };
}
