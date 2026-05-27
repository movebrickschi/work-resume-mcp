import { describe, it, expect } from 'vitest';
import { regexExtractSymbols } from '../../src/tree-sitter/regex-fallback.js';

const sampleTs = [
  'function foo() {',          // line 1
  '  return 1;',                // 2
  '}',                          // 3
  'class Bar {',                // 4
  '  baz() {',                  // 5
  '    return 2;',              // 6
  '  }',                        // 7
  '}',                          // 8
  'const arrow = () => 3;',     // 9
].join('\n');

describe('regexExtractSymbols', () => {
  it('returns symbol names whose definition appears within the changed range', () => {
    const out = regexExtractSymbols(sampleTs, [{ addedStart: 4, addedCount: 4 }]);
    expect(out.sort()).toEqual(['Bar', 'baz'].sort());
  });

  it('returns empty array when no defining keyword is in range', () => {
    const out = regexExtractSymbols(sampleTs, [{ addedStart: 2, addedCount: 1 }]);
    expect(out).toEqual([]);
  });

  it('dedupes overlapping ranges', () => {
    const out = regexExtractSymbols(sampleTs, [
      { addedStart: 1, addedCount: 1 },
      { addedStart: 1, addedCount: 2 },
    ]);
    expect(out).toEqual(['foo']);
  });

  it('matches Python def with nested methods', () => {
    const py = [
      'class A:',          // 1
      '  def m(self):',    // 2
      '    pass',          // 3
    ].join('\n');
    const out = regexExtractSymbols(py, [{ addedStart: 1, addedCount: 3 }]);
    expect(out.sort()).toEqual(['A', 'm'].sort());
  });
});
