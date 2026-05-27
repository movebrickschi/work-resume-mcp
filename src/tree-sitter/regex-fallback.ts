import type { Hunk } from '../git.js';

const SYMBOL_REGEX = /(?:^|\s)(?:export\s+|public\s+|private\s+|protected\s+|static\s+|async\s+)*(?:function|def|class|interface|method|fn|sub|func)\s+([A-Za-z_$][A-Za-z0-9_$]*)/;
const METHOD_REGEX = /^\s+(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/;

export function regexExtractSymbols(fileContent: string, hunks: Hunk[]): string[] {
  const lines = fileContent.split('\n');
  const set = new Set<string>();

  const covered = new Set<number>();
  for (const h of hunks) {
    for (let i = 0; i < h.addedCount; i++) {
      covered.add(h.addedStart + i);
    }
  }

  for (const lineNo of covered) {
    const line = lines[lineNo - 1];
    if (!line) continue;
    const m = line.match(SYMBOL_REGEX) ?? line.match(METHOD_REGEX);
    if (m && m[1]) set.add(m[1]);
  }
  return [...set];
}
