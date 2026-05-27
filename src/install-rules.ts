import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type RuleTarget = 'cursor' | 'claude' | 'codex' | 'agents' | 'all';

export interface InstallRulesOptions {
  cwd: string;
  targets?: RuleTarget[];
  globalCodex?: boolean;
}

export interface InstallRulesResult {
  written: string[];
  skipped: string[];
}

const MARKER_START = '<!-- work-resume-rules:start -->';
const MARKER_END = '<!-- work-resume-rules:end -->';

export async function loadRuleBody(packageRoot: string): Promise<string> {
  const raw = await fs.readFile(path.join(packageRoot, 'rules', 'RULE.md'), 'utf8');
  const lines = raw.split('\n');
  const body: string[] = [];
  let inBody = false;
  for (const line of lines) {
    if (line.startsWith('## 必须触发 save_progress')) inBody = true;
    if (line.startsWith('## 各家 IDE 安装位置')) break;
    if (inBody) body.push(line);
  }
  return body.join('\n').trim();
}

function cursorMdc(body: string): string {
  return `---
description: work-resume 进度续写 — save_progress / resume_latest 触发规则
globs: *
alwaysApply: true
---

${body}
`;
}

function plainMarkdown(body: string): string {
  return `${body}\n`;
}

function agentsSection(body: string): string {
  return `${MARKER_START}\n\n${body}\n\n${MARKER_END}\n`;
}

async function upsertAgentsSection(filePath: string, section: string): Promise<'written' | 'skipped'> {
  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch {
    existing = '';
  }
  if (existing.includes(MARKER_START) && existing.includes(MARKER_END)) {
    const before = existing.slice(0, existing.indexOf(MARKER_START));
    const after = existing.slice(existing.indexOf(MARKER_END) + MARKER_END.length);
    await fs.writeFile(filePath, `${before}${section}${after}`, 'utf8');
    return 'written';
  }
  const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n\n' : existing.length > 0 ? '\n\n' : '';
  await fs.writeFile(filePath, `${existing}${sep}${section}`, 'utf8');
  return 'written';
}

async function writeIfChanged(filePath: string, content: string): Promise<'written' | 'skipped'> {
  try {
    const prev = await fs.readFile(filePath, 'utf8');
    if (prev === content) return 'skipped';
  } catch { /* new file */ }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return 'written';
}

export async function installRules(
  packageRoot: string,
  opts: InstallRulesOptions,
): Promise<InstallRulesResult> {
  const targets = opts.targets?.length ? opts.targets : (['all'] as RuleTarget[]);
  const expanded = new Set<RuleTarget>();
  for (const t of targets) {
    if (t === 'all') {
      expanded.add('cursor');
      expanded.add('claude');
      expanded.add('agents');
      if (opts.globalCodex) expanded.add('codex');
    } else {
      expanded.add(t);
    }
  }

  const body = await loadRuleBody(packageRoot);
  const written: string[] = [];
  const skipped: string[] = [];

  if (expanded.has('cursor')) {
    const fp = path.join(opts.cwd, '.cursor', 'rules', 'work-resume.mdc');
    const r = await writeIfChanged(fp, cursorMdc(body));
    (r === 'written' ? written : skipped).push(fp);
  }

  if (expanded.has('claude')) {
    const fp = path.join(opts.cwd, '.claude', 'rules', 'work-resume.md');
    const r = await writeIfChanged(fp, plainMarkdown(body));
    (r === 'written' ? written : skipped).push(fp);
  }

  if (expanded.has('agents')) {
    const fp = path.join(opts.cwd, 'AGENTS.md');
    const r = await upsertAgentsSection(fp, agentsSection(body));
    (r === 'written' ? written : skipped).push(fp);
  }

  if (expanded.has('codex')) {
    const home = process.env.USERPROFILE || process.env.HOME || opts.cwd;
    const fp = path.join(home, '.codex', 'AGENTS.md');
    const r = await upsertAgentsSection(fp, agentsSection(body));
    (r === 'written' ? written : skipped).push(fp);
  }

  return { written, skipped };
}

export function resolvePackageRoot(fromDir: string): string {
  return fromDir;
}

export function shouldAutoInstallRules(): boolean {
  return process.env.WORK_RESUME_AUTO_INSTALL_RULES === '1';
}

export function parseAutoInstallTargets(): RuleTarget[] {
  const raw = process.env.WORK_RESUME_AUTO_INSTALL_TARGETS;
  if (!raw?.trim()) return ['cursor', 'claude', 'agents'];
  return raw.split(',').map((s) => s.trim()).filter(Boolean) as RuleTarget[];
}

export async function tryAutoInstallRules(packageRoot: string): Promise<InstallRulesResult | null> {
  if (!shouldAutoInstallRules()) return null;
  return installRules(packageRoot, {
    cwd: process.cwd(),
    targets: parseAutoInstallTargets(),
    globalCodex: process.env.WORK_RESUME_AUTO_INSTALL_GLOBAL_CODEX === '1',
  });
}

export async function buildServerInstructions(packageRoot: string): Promise<string> {
  const body = await loadRuleBody(packageRoot);
  return [
    'work-resume-mcp is active. Follow these rules in addition to any project Rule files:',
    '',
    body,
  ].join('\n');
}

export async function runInstallRulesCli(argv: string[]): Promise<void> {
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let cwd = process.cwd();
  const targets: RuleTarget[] = [];
  let globalCodex = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cwd' && argv[i + 1]) { cwd = path.resolve(argv[++i]); continue; }
    if (a === '--global-codex') { globalCodex = true; continue; }
    if (a === '--target' && argv[i + 1]) {
      const t = argv[++i] as RuleTarget;
      targets.push(t);
      continue;
    }
    if (a === '--help' || a === '-h') {
      console.log(`Usage: work-resume-mcp install-rules [options]

Options:
  --cwd <path>       Project root (default: process.cwd())
  --target <name>    cursor | claude | codex | agents | all (repeatable)
  --global-codex     Also write ~/.codex/AGENTS.md (with --target all)
  --help             Show this help

Examples:
  npx work-resume-mcp install-rules --target all
  npx work-resume-mcp install-rules --cwd ./my-app --target cursor --target claude
  npx work-resume-mcp install-rules --target all --global-codex
`);
      return;
    }
  }

  const result = await installRules(pkgRoot, {
    cwd,
    targets: targets.length ? targets : ['all'],
    globalCodex,
  });

  if (result.written.length) {
    console.log('Written:');
    for (const f of result.written) console.log('  ' + f);
  }
  if (result.skipped.length) {
    console.log('Unchanged (already up to date):');
    for (const f of result.skipped) console.log('  ' + f);
  }
}
