import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/tree-sitter/lazy-loader.js', () => ({
  resolveExtensionToLang: (p: string) => {
    if (p.endsWith('.ts')) return 'ts';
    if (p.endsWith('.kt')) return 'kt';
    return null;
  },
  getParser: vi.fn(),
  resetParserCache: vi.fn(),
}));

vi.mock('../../src/tree-sitter/regex-fallback.js', () => ({
  regexExtractSymbols: vi.fn((src, hunks) => ['fallbackSym']),
}));

import { extractChangedSymbols } from '../../src/tree-sitter/index.js';
import { getParser } from '../../src/tree-sitter/lazy-loader.js';
import { regexExtractSymbols } from '../../src/tree-sitter/regex-fallback.js';

beforeEach(() => {
  (getParser as any).mockReset();
  (regexExtractSymbols as any).mockClear();
});

describe('extractChangedSymbols', () => {
  it('uses fallback when language not in WORK_RESUME_LANGS (fallback=regex)', async () => {
    process.env.WORK_RESUME_LANGS = 'ts';
    process.env.WORK_RESUME_FALLBACK = 'regex';
    const out = await extractChangedSymbols('foo.kt', 'fun bar() {}', [{ addedStart: 1, addedCount: 1 }]);
    expect(out).toEqual(['fallbackSym']);
    expect(regexExtractSymbols).toHaveBeenCalled();
    delete process.env.WORK_RESUME_LANGS;
    delete process.env.WORK_RESUME_FALLBACK;
  });

  it('returns [] when fallback=empty and language unsupported', async () => {
    process.env.WORK_RESUME_LANGS = 'ts';
    process.env.WORK_RESUME_FALLBACK = 'empty';
    const out = await extractChangedSymbols('foo.kt', 'fun bar() {}', [{ addedStart: 1, addedCount: 1 }]);
    expect(out).toEqual([]);
    delete process.env.WORK_RESUME_LANGS;
    delete process.env.WORK_RESUME_FALLBACK;
  });

  it('parses TS and returns enclosing function name for a single-hunk change', async () => {
    const src = [
      'function alpha() {',
      '  return 1;',
      '}',
      'function beta() {',
      '  return 2;',
      '}',
    ].join('\n');

    const parser = {
      parse: (s: string) => makeMockTree([
        { type: 'function_declaration', startRow: 0, endRow: 2, nameText: 'alpha' },
        { type: 'function_declaration', startRow: 3, endRow: 5, nameText: 'beta' },
      ]),
    };
    (getParser as any).mockResolvedValue(parser);

    const out = await extractChangedSymbols('foo.ts', src, [{ addedStart: 5, addedCount: 1 }]);
    expect(out).toEqual(['beta']);
  });

  it('handles class with nested methods', async () => {
    const src = [
      'class C {',
      '  m1() { return 1; }',
      '  m2() { return 2; }',
      '}',
    ].join('\n');

    const parser = {
      parse: () => makeMockTree([
        { type: 'class_declaration', startRow: 0, endRow: 3, nameText: 'C' },
        { type: 'method_definition', startRow: 1, endRow: 1, nameText: 'm1' },
        { type: 'method_definition', startRow: 2, endRow: 2, nameText: 'm2' },
      ]),
    };
    (getParser as any).mockResolvedValue(parser);

    const out = await extractChangedSymbols('foo.ts', src, [{ addedStart: 3, addedCount: 1 }]);
    expect(out.sort()).toEqual(['C', 'm2'].sort());
  });

  it('falls back when parser unavailable (e.g., grammar missing)', async () => {
    (getParser as any).mockResolvedValue(null);
    const out = await extractChangedSymbols('foo.ts', 'x', [{ addedStart: 1, addedCount: 1 }]);
    expect(out).toEqual(['fallbackSym']);
  });
});

function makeMockTree(nodes: Array<{ type: string; startRow: number; endRow: number; nameText: string }>) {
  return {
    rootNode: {
      descendantsOfType: (types: string[]) =>
        nodes.filter((n) => types.includes(n.type)).map((n) => ({
          type: n.type,
          startPosition: { row: n.startRow },
          endPosition: { row: n.endRow },
          childForFieldName: (f: string) => (f === 'name' ? { text: n.nameText } : null),
        })),
    },
  };
}
