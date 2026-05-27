import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  const ORIGINAL = { ...process.env };
  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('WORK_RESUME_')) delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('WORK_RESUME_')) delete process.env[k];
    }
    Object.assign(process.env, ORIGINAL);
  });

  it('returns all defaults when no env vars set', () => {
    const cfg = loadConfig('/tmp/x');
    expect(cfg.projectRoot).toBe('/tmp/x');
    expect(cfg.storeDir).toBe('.work-resume');
    expect(cfg.autoIntervalMs).toBe(60_000);
    expect(cfg.autoRetentionHours).toBe(24);
    expect(cfg.maxRepoScanDepth).toBe(3);
    expect(cfg.langs).toEqual(['ts','tsx','js','jsx','py','go','rs','java','rb','php']);
    expect(cfg.fallback).toBe('regex');
    expect(cfg.grammarLoad).toBe('lazy');
    expect(cfg.trashRetentionDays).toBe(7);
  });

  it('respects WORK_RESUME_PROJECT_ROOT', () => {
    process.env.WORK_RESUME_PROJECT_ROOT = '/srv/repo';
    expect(loadConfig('/tmp/x').projectRoot).toBe('/srv/repo');
  });

  it('parses WORK_RESUME_LANGS as comma list with trim', () => {
    process.env.WORK_RESUME_LANGS = ' ts , py , go ';
    expect(loadConfig('/tmp/x').langs).toEqual(['ts','py','go']);
  });

  it('throws on invalid WORK_RESUME_FALLBACK', () => {
    process.env.WORK_RESUME_FALLBACK = 'bogus';
    expect(() => loadConfig('/tmp/x')).toThrow(/WORK_RESUME_FALLBACK/);
  });

  it('throws on invalid WORK_RESUME_GRAMMAR_LOAD', () => {
    process.env.WORK_RESUME_GRAMMAR_LOAD = 'maybe';
    expect(() => loadConfig('/tmp/x')).toThrow(/WORK_RESUME_GRAMMAR_LOAD/);
  });

  it('rejects numeric envs below minimum bound', () => {
    process.env.WORK_RESUME_AUTO_INTERVAL_MS = '0';
    expect(() => loadConfig('/tmp/x')).toThrow(/WORK_RESUME_AUTO_INTERVAL_MS/);
  });
});
