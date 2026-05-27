#!/usr/bin/env node
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { autoSnapshotIfStale, SKIP_AUTO_SNAPSHOT } from './auto-snapshot.js';
import { saveProgress, type SaveProgressInput } from './tools/save-progress.js';
import { resumeLatest, type ResumeLatestInput } from './tools/resume-latest.js';
import { listCheckpoints, type ListCheckpointsInput } from './tools/list-checkpoints.js';
import { diffSince, type DiffSinceInput } from './tools/diff-since.js';
import { clearCheckpoints, type ClearCheckpointsInput } from './tools/clear-checkpoints.js';
import { preloadAll } from './tree-sitter/lazy-loader.js';
import { runInstallRulesCli, tryAutoInstallRules, buildServerInstructions } from './install-rules.js';

export interface DispatchError extends Error { code: string; }

export async function dispatchTool(name: string, args: any, workspaceRoot: string): Promise<unknown> {
  const cfg = loadConfig(workspaceRoot);

  if (!SKIP_AUTO_SNAPSHOT.has(name)) {
    const { scanRepos } = await import('./repo-scanner.js');
    const repos = await scanRepos(cfg.projectRoot, cfg.maxRepoScanDepth);
    for (const repo of repos) {
      try {
        await autoSnapshotIfStale(repo, name, {
          autoIntervalMs: cfg.autoIntervalMs,
          autoRetentionHours: cfg.autoRetentionHours,
          trashRetentionDays: cfg.trashRetentionDays,
        });
      } catch { /* best-effort */ }
    }
  }

  try {
    switch (name) {
      case 'save_progress':     return await saveProgress(workspaceRoot, args as SaveProgressInput);
      case 'resume_latest':     return await resumeLatest(workspaceRoot, args as ResumeLatestInput);
      case 'list_checkpoints':  return await listCheckpoints(workspaceRoot, args as ListCheckpointsInput);
      case 'diff_since':        return await diffSince(workspaceRoot, args as DiffSinceInput);
      case 'clear_checkpoints': return await clearCheckpoints(workspaceRoot, args as ClearCheckpointsInput);
      default: {
        const e = new Error(`unknown tool: ${name}`) as DispatchError;
        e.code = 'UNKNOWN_TOOL';
        throw e;
      }
    }
  } catch (err: any) {
    const wrapped = err as DispatchError;
    if (!wrapped.code) {
      const m = (err.message ?? '').match(/^([A-Z_]+):\s*(.*)$/s);
      wrapped.code = m ? m[1] : 'INTERNAL';
      if (m) wrapped.message = m[2];
    }
    throw wrapped;
  }
}

const TOOL_SCHEMAS = {
  save_progress: {
    name: 'save_progress',
    description: 'Save current work progress as a semantic checkpoint. Call when completing a TodoWrite item, before context switch, before blockers, after each Edit/Write, or before replying to the user.',
    inputSchema: {
      type: 'object',
      required: ['summary', 'next_steps', 'files_in_focus'],
      properties: {
        summary:        { type: 'string', minLength: 8 },
        next_steps:     { type: 'array', items: { type: 'string' }, minItems: 1 },
        files_in_focus: { type: 'array', items: { type: 'string' } },
        blockers:       { type: 'array', items: { type: 'string' } },
        context_notes:  { type: 'string' },
        todo_status:    { type: 'array', items: { type: 'object' } },
      },
    },
  },
  resume_latest: {
    name: 'resume_latest',
    description: 'Resume the most recent checkpoint for the current branch / repo. Call at the start of a new session unless the user said "fresh task".',
    inputSchema: {
      type: 'object',
      properties: {
        branch:    { type: 'string' },
        repo_root: { type: 'string' },
      },
    },
  },
  list_checkpoints: {
    name: 'list_checkpoints',
    description: 'Browse historical checkpoints (semantic by default).',
    inputSchema: {
      type: 'object',
      properties: {
        limit:     { type: 'integer', minimum: 1, maximum: 200 },
        branch:    { type: 'string' },
        kind:      { type: 'string', enum: ['semantic','physical','all'] },
        repo_root: { type: 'string' },
      },
    },
  },
  diff_since: {
    name: 'diff_since',
    description: 'Show git diff from a specific checkpoint to now.',
    inputSchema: {
      type: 'object',
      required: ['checkpoint_id'],
      properties: {
        checkpoint_id: { type: 'string' },
        repo_root:     { type: 'string' },
      },
    },
  },
  clear_checkpoints: {
    name: 'clear_checkpoints',
    description: 'Soft-delete checkpoints. scope=all with no filters requires dry_run=true first.',
    inputSchema: {
      type: 'object',
      required: ['scope'],
      properties: {
        scope:     { type: 'string', enum: ['auto-snapshots','semantic','all'] },
        before:    { type: 'string', format: 'date-time' },
        branch:    { type: 'string' },
        repo_root: { type: 'string' },
        dry_run:   { type: 'boolean' },
      },
    },
  },
} as const;

async function main() {
  const workspaceRoot = process.cwd();
  const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cfg = loadConfig(workspaceRoot);

  try {
    const auto = await tryAutoInstallRules(pkgRoot);
    if (auto?.written.length) {
      console.error(`[work-resume-mcp] auto-installed rules (${auto.written.length} file(s))`);
    }
  } catch (err) {
    console.error('[work-resume-mcp] auto-install rules failed (non-fatal):', err);
  }

  if (cfg.grammarLoad === 'eager') {
    await preloadAll(cfg.langs).catch(() => null);
  }

  const instructions = await buildServerInstructions(pkgRoot).catch(() => undefined);

  const server = new Server(
    { name: 'work-resume-mcp', version: '0.1.0' },
    { capabilities: { tools: {} }, instructions },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(TOOL_SCHEMAS),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params as { name: string; arguments: unknown };
    try {
      const result = await dispatchTool(name, args, workspaceRoot);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: { code: err.code ?? 'INTERNAL', message: err.message } }) }],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[work-resume-mcp] up. cwd=' + workspaceRoot);
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  const sub = process.argv[2];
  if (sub === 'install-rules') {
    runInstallRulesCli(process.argv.slice(3)).catch((err) => {
      console.error('[work-resume-mcp] install-rules failed:', err);
      process.exit(1);
    });
  } else {
    main().catch((err) => {
      console.error('[work-resume-mcp] fatal:', err);
      process.exit(1);
    });
  }
}
