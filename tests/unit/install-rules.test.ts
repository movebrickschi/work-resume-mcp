import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  installRules,
  loadRuleBody,
  shouldAutoInstallRules,
  parseAutoInstallTargets,
  buildServerInstructions,
  tryAutoInstallRules,
} from '../../src/install-rules.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wr-rules-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('loadRuleBody', () => {
  it('extracts core rule without install-location table', async () => {
    const body = await loadRuleBody(PKG_ROOT);
    expect(body).toContain('save_progress');
    expect(body).toContain('resume_latest');
    expect(body).not.toContain('各家 IDE 安装位置');
  });
});

describe('installRules', () => {
  it('writes cursor and claude rule files', async () => {
    const r = await installRules(PKG_ROOT, { cwd: tmp, targets: ['cursor', 'claude'] });
    expect(r.written.length).toBeGreaterThanOrEqual(2);
    const mdc = await fs.readFile(path.join(tmp, '.cursor/rules/work-resume.mdc'), 'utf8');
    expect(mdc).toContain('alwaysApply: true');
    expect(mdc).toContain('save_progress');
    const claude = await fs.readFile(path.join(tmp, '.claude/rules/work-resume.md'), 'utf8');
    expect(claude).toContain('resume_latest');
  });

  it('upserts AGENTS.md section idempotently', async () => {
    await installRules(PKG_ROOT, { cwd: tmp, targets: ['agents'] });
    await installRules(PKG_ROOT, { cwd: tmp, targets: ['agents'] });
    const agents = await fs.readFile(path.join(tmp, 'AGENTS.md'), 'utf8');
    expect(agents.match(/<!-- work-resume-rules:start -->/g)?.length).toBe(1);
  });
});

describe('auto-install env', () => {
  const prevRules = process.env.WORK_RESUME_AUTO_INSTALL_RULES;
  const prevTargets = process.env.WORK_RESUME_AUTO_INSTALL_TARGETS;

  afterEach(() => {
    if (prevRules === undefined) delete process.env.WORK_RESUME_AUTO_INSTALL_RULES;
    else process.env.WORK_RESUME_AUTO_INSTALL_RULES = prevRules;
    if (prevTargets === undefined) delete process.env.WORK_RESUME_AUTO_INSTALL_TARGETS;
    else process.env.WORK_RESUME_AUTO_INSTALL_TARGETS = prevTargets;
  });

  it('shouldAutoInstallRules respects env', () => {
    delete process.env.WORK_RESUME_AUTO_INSTALL_RULES;
    expect(shouldAutoInstallRules()).toBe(false);
    process.env.WORK_RESUME_AUTO_INSTALL_RULES = '1';
    expect(shouldAutoInstallRules()).toBe(true);
  });

  it('parseAutoInstallTargets defaults', () => {
    delete process.env.WORK_RESUME_AUTO_INSTALL_TARGETS;
    expect(parseAutoInstallTargets()).toEqual(['cursor', 'claude', 'agents']);
  });

  it('tryAutoInstallRules writes when env enabled', async () => {
    process.env.WORK_RESUME_AUTO_INSTALL_RULES = '1';
    process.env.WORK_RESUME_AUTO_INSTALL_TARGETS = 'cursor';
    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      const r = await tryAutoInstallRules(PKG_ROOT);
      expect(r?.written.length).toBeGreaterThanOrEqual(1);
    } finally {
      process.chdir(origCwd);
    }
  });

  it('tryAutoInstallRules skips when workspaceRoot equals packageRoot (self-install guard)', async () => {
    process.env.WORK_RESUME_AUTO_INSTALL_RULES = '1';
    process.env.WORK_RESUME_AUTO_INSTALL_TARGETS = 'cursor';
    const prevProjectRoot = process.env.WORK_RESUME_PROJECT_ROOT;
    process.env.WORK_RESUME_PROJECT_ROOT = PKG_ROOT;
    try {
      const r = await tryAutoInstallRules(PKG_ROOT);
      expect(r).toBeNull();
    } finally {
      if (prevProjectRoot === undefined) delete process.env.WORK_RESUME_PROJECT_ROOT;
      else process.env.WORK_RESUME_PROJECT_ROOT = prevProjectRoot;
    }
  });

  it('buildServerInstructions includes core triggers', async () => {
    const text = await buildServerInstructions(PKG_ROOT);
    expect(text).toContain('save_progress');
    expect(text).toContain('resume_latest');
  });
});
