import { resolveExtensionToLang, getParser } from './lazy-loader.js';
import { regexExtractSymbols } from './regex-fallback.js';
import { loadConfig } from '../config.js';
import type { Hunk } from '../git.js';

const NAMED_NODES = [
  'function_declaration',
  'function_definition',
  'method_definition',
  'method_declaration',
  'class_declaration',
  'class_definition',
  'interface_declaration',
  'enum_declaration',
  'type_alias_declaration',
  'arrow_function',
];

export async function extractChangedSymbols(
  filePath: string,
  fileContent: string,
  hunks: Hunk[],
): Promise<string[]> {
  if (hunks.length === 0) return [];

  const cfg = loadConfig(process.cwd());
  const lang = resolveExtensionToLang(filePath);

  if (!lang || !cfg.langs.includes(lang)) {
    return cfg.fallback === 'regex' ? regexExtractSymbols(fileContent, hunks) : [];
  }

  const parser = await getParser(lang);
  if (!parser) {
    return cfg.fallback === 'regex' ? regexExtractSymbols(fileContent, hunks) : [];
  }

  let tree;
  try {
    tree = parser.parse(fileContent);
  } catch {
    return cfg.fallback === 'regex' ? regexExtractSymbols(fileContent, hunks) : [];
  }
  if (!tree?.rootNode) return [];

  const named = tree.rootNode.descendantsOfType(NAMED_NODES);
  const lineSet = new Set<number>();
  for (const h of hunks) {
    for (let i = 0; i < h.addedCount; i++) {
      lineSet.add(h.addedStart + i - 1);
    }
  }

  const out = new Set<string>();
  for (const node of named) {
    const startRow = node.startPosition.row;
    const endRow = node.endPosition.row;
    let touched = false;
    for (const row of lineSet) {
      if (row >= startRow && row <= endRow) { touched = true; break; }
    }
    if (!touched) continue;
    const nameNode = typeof node.childForFieldName === 'function' ? node.childForFieldName('name') : null;
    const name = nameNode?.text;
    if (name) out.add(name);
  }
  return [...out];
}
