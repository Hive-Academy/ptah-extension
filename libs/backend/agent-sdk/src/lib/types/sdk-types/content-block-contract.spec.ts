/**
 * Contract coverage for the Claude transcript content blocks Ptah renders.
 *
 * Part A pins the SDK transcript shapes already observed in production. Part B
 * optionally scans the local Claude corpus to make a future SDK shape change
 * fail close to this narrow boundary rather than requiring an unsafe cast.
 *
 * The corpus scan is opt-in because a developer's transcript history can be
 * large and is not present in CI:
 *
 *   PTAH_CORPUS_SPECS=1 npx nx run-many -t test -p @ptah-extension/agent-sdk
 *
 * Run it locally after updating the SDK or changing this content-block
 * contract. It reads transcripts only; it never writes to ~/.claude/projects.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  type ContentBlock,
  isTextBlock,
  isThinkingBlock,
  isToolResultBlock,
  isToolUseBlock,
} from './claude-sdk.types';

const CORPUS_ENABLED = process.env['PTAH_CORPUS_SPECS'] === '1';

/** `describe` when explicitly enabled, `describe.skip` otherwise. */
const corpusDescribe = CORPUS_ENABLED ? describe : describe.skip;

const FIXTURES = [
  { type: 'text', text: 'Hello from a completed assistant message.' },
  {
    type: 'thinking',
    thinking: '',
    signature: 'CAISpywKpgEIERgCKkDqOGUG+Mu6Yj9HDbMTy3b7...',
  },
  {
    type: 'tool_use',
    id: 'toolu_01',
    name: 'Read',
    input: { file_path: 'README.md' },
  },
  {
    type: 'tool_result',
    tool_use_id: 'toolu_01',
    content: 'File contents.',
  },
] satisfies ContentBlock[];

const DECLARED_FIELDS: Record<ContentBlock['type'], ReadonlySet<string>> = {
  text: new Set(['type', 'text']),
  thinking: new Set(['type', 'thinking', 'signature']),
  tool_use: new Set(['type', 'id', 'name', 'input']),
  tool_result: new Set(['type', 'tool_use_id', 'content', 'is_error']),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isContentBlockType(value: string): value is ContentBlock['type'] {
  return Object.hasOwn(DECLARED_FIELDS, value);
}

function assistantContentFromLine(line: string): Record<string, unknown>[] {
  try {
    const record: unknown = JSON.parse(line);
    if (!isRecord(record) || record['type'] !== 'assistant') return [];

    const message = record['message'];
    if (!isRecord(message) || !Array.isArray(message['content'])) return [];

    return message['content'].filter(isRecord);
  } catch {
    return [];
  }
}

function collectJsonlFiles(root: string): string[] {
  const files: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

describe('ContentBlock contract fixtures', () => {
  it('accepts each observed content-block shape through its predicate', () => {
    const [text, thinking, toolUse, toolResult] = FIXTURES;

    expect(isTextBlock(text)).toBe(true);
    expect(isThinkingBlock(thinking)).toBe(true);
    expect(isToolUseBlock(toolUse)).toBe(true);
    expect(isToolResultBlock(toolResult)).toBe(true);
  });
});

corpusDescribe('ContentBlock contract corpus (PTAH_CORPUS_SPECS=1)', () => {
  it('accepts only declared fields for observed assistant content block types', () => {
    const projectsDirectory = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDirectory)) return;

    for (const file of collectJsonlFiles(projectsDirectory)) {
      let transcript: string;
      try {
        transcript = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }

      for (const line of transcript.split(/\r?\n/)) {
        for (const block of assistantContentFromLine(line)) {
          const blockType = block['type'];
          expect(typeof blockType).toBe('string');
          if (typeof blockType !== 'string') continue;

          expect(isContentBlockType(blockType)).toBe(true);
          if (!isContentBlockType(blockType)) continue;

          const declaredFields = DECLARED_FIELDS[blockType];
          expect(
            Object.keys(block).every((field) => declaredFields.has(field)),
          ).toBe(true);
        }
      }
    }
  });
});
