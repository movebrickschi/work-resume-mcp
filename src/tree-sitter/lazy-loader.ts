import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { loadConfig } from '../config.js';

type AnyParser = any;
type AnyLanguage = any;

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'ts', '.tsx': 'tsx',
  '.js': 'js', '.jsx': 'jsx', '.mjs': 'js', '.cjs': 'js',
  '.py': 'py', '.go': 'go', '.rs': 'rs',
  '.java': 'java', '.rb': 'rb', '.php': 'php',
};

const LANG_TO_WASM_HINT: Record<string, string[]> = {
  ts:    ['tree-sitter-typescript/tree-sitter-typescript.wasm'],
  tsx:   ['tree-sitter-typescript/tree-sitter-tsx.wasm'],
  js:    ['tree-sitter-javascript/tree-sitter-javascript.wasm'],
  jsx:   ['tree-sitter-javascript/tree-sitter-javascript.wasm'],
  py:    ['tree-sitter-python/tree-sitter-python.wasm'],
  go:    ['tree-sitter-go/tree-sitter-go.wasm'],
  rs:    ['tree-sitter-rust/tree-sitter-rust.wasm'],
  java:  ['tree-sitter-java/tree-sitter-java.wasm'],
  rb:    ['tree-sitter-ruby/tree-sitter-ruby.wasm'],
  php:   ['tree-sitter-php/tree-sitter-php.wasm'],
};

export function resolveExtensionToLang(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

const cache = new Map<string, Promise<AnyParser | null>>();
let parserInitOnce: Promise<void> | null = null;

export function resetParserCache(): void {
  cache.clear();
  parserInitOnce = null;
}

async function loadGrammarFromNodeModules(lang: string): Promise<AnyLanguage | null> {
  const candidates = LANG_TO_WASM_HINT[lang] || [];
  for (const rel of candidates) {
    const resolved = await resolveNodeModulePath(rel);
    if (!resolved) continue;
    try {
      const Parser: any = (await import('web-tree-sitter')).default;
      const Language = await Parser.Language.load(resolved);
      return Language;
    } catch {
      continue;
    }
  }
  return null;
}

async function resolveNodeModulePath(rel: string): Promise<string | null> {
  const candidates = [
    path.join(process.cwd(), 'node_modules', rel),
    path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'node_modules', rel),
  ];
  for (const c of candidates) {
    try { await fs.access(c); return c; } catch { /* next */ }
  }
  return null;
}

export async function getParser(lang: string): Promise<AnyParser | null> {
  const cfg = loadConfig(process.cwd());
  if (!cfg.langs.includes(lang)) return null;

  if (cache.has(lang)) return cache.get(lang)!;

  const promise = (async (): Promise<AnyParser | null> => {
    const Parser: any = (await import('web-tree-sitter')).default;
    if (!parserInitOnce) parserInitOnce = Parser.init();
    await parserInitOnce;

    const language = await loadGrammarFromNodeModules(lang);
    if (!language) return null;

    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  })();

  cache.set(lang, promise);
  return promise;
}

export async function preloadAll(langs: string[]): Promise<void> {
  await Promise.all(langs.map((l) => getParser(l).catch(() => null)));
}
