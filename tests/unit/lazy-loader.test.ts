import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    access: vi.fn().mockResolvedValue(undefined),
  };
});

const initMock = vi.fn().mockResolvedValue(undefined);
const ParserCtor = vi.fn().mockImplementation(() => ({
  setLanguage: vi.fn(),
  parse: vi.fn().mockReturnValue({ rootNode: { type: 'program' } }),
}));
(ParserCtor as any).init = initMock;
(ParserCtor as any).Language = { load: vi.fn().mockResolvedValue({ id: 'lang' }) };

vi.mock('web-tree-sitter', () => ({ default: ParserCtor }));

import { resolveExtensionToLang, getParser, resetParserCache } from '../../src/tree-sitter/lazy-loader.js';

beforeEach(() => {
  resetParserCache();
  initMock.mockClear();
  (ParserCtor as any).Language.load.mockClear();
});

describe('resolveExtensionToLang', () => {
  it('maps known extensions', () => {
    expect(resolveExtensionToLang('foo.ts')).toBe('ts');
    expect(resolveExtensionToLang('foo.tsx')).toBe('tsx');
    expect(resolveExtensionToLang('foo.mjs')).toBe('js');
    expect(resolveExtensionToLang('foo.py')).toBe('py');
    expect(resolveExtensionToLang('foo.go')).toBe('go');
    expect(resolveExtensionToLang('foo.rs')).toBe('rs');
    expect(resolveExtensionToLang('foo.java')).toBe('java');
    expect(resolveExtensionToLang('foo.rb')).toBe('rb');
    expect(resolveExtensionToLang('foo.php')).toBe('php');
  });
  it('returns null for unknown', () => {
    expect(resolveExtensionToLang('foo.kt')).toBeNull();
    expect(resolveExtensionToLang('foo')).toBeNull();
  });
});

describe('getParser (lazy)', () => {
  it('initializes parser only once even with parallel calls', async () => {
    const [a, b] = await Promise.all([getParser('ts'), getParser('ts')]);
    expect(a).toBe(b);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect((ParserCtor as any).Language.load).toHaveBeenCalledTimes(1);
  });

  it('returns null for langs not in WORK_RESUME_LANGS', async () => {
    process.env.WORK_RESUME_LANGS = 'ts,py';
    resetParserCache();
    expect(await getParser('rb')).toBeNull();
    delete process.env.WORK_RESUME_LANGS;
  });
});
