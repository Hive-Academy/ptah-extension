/**
 * Specs for MemoryPromptInjector.
 *
 * Covers:
 *   - query too short → returns ''
 *   - 0 hits → returns ''
 *   - hits below MIN_SCORE filtered → returns '' when all filtered
 *   - successful hits → block starts with '## Recalled Memory Context'
 *   - chunk text > MAX_CHUNK_CHARS (400) truncated with '…'
 *   - subject present → label is '[subject]'; absent → '[memory]'
 *   - search throws → returns '' (never rethrows)
 *   - workspaceRoot forwarded to reader.search
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  IMemoryReader,
  MemoryHit,
  MemoryHitPage,
} from '@ptah-extension/memory-contracts';

import type { Logger } from '@ptah-extension/vscode-core';
import { MemoryPromptInjector } from './memory-prompt-injector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHit(overrides: Partial<MemoryHit> = {}): MemoryHit {
  return {
    memoryId: 'mem-1',
    subject: 'TypeScript',
    content: 'full content',
    chunkText: 'short chunk',
    score: 0.9,
    tier: 'core',
    ...overrides,
  };
}

function makeReader(page: MemoryHitPage): IMemoryReader {
  return { search: jest.fn().mockResolvedValue(page) };
}

function makeInjector(reader: IMemoryReader): MemoryPromptInjector {
  const logger = createMockLogger() as unknown as Logger;
  return new MemoryPromptInjector(logger, reader);
}

const LONG_QUERY = 'a long enough query string';

// ---------------------------------------------------------------------------
// Guard conditions
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — guard conditions', () => {
  it('returns empty string when query is shorter than 8 chars', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock('short');

    expect(result).toBe('');
    expect(reader.search).not.toHaveBeenCalled();
  });

  it('returns empty string when query is exactly 7 chars', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock('1234567');

    expect(result).toBe('');
  });

  it('calls reader when query is exactly 8 chars', async () => {
    const reader = makeReader({ hits: [], bm25Only: true });
    const injector = makeInjector(reader);

    await injector.buildBlock('12345678');

    expect(reader.search).toHaveBeenCalled();
  });

  it('returns empty string when there are 0 hits', async () => {
    const reader = makeReader({ hits: [], bm25Only: true });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toBe('');
  });

  it('returns empty string when all hits are below MIN_SCORE (0.05)', async () => {
    const reader = makeReader({
      hits: [makeHit({ score: 0.04 }), makeHit({ score: 0.01 })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Successful injection
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — successful injection', () => {
  it('returns block starting with ## Recalled Memory Context', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toMatch(/^## Recalled Memory Context/);
  });

  it('includes all qualifying hits as numbered lines', async () => {
    const reader = makeReader({
      hits: [
        makeHit({ score: 0.9 }),
        makeHit({ score: 0.8 }),
        makeHit({ score: 0.7 }),
      ],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('3.');
  });

  it('uses [subject] label when subject is present', async () => {
    const reader = makeReader({
      hits: [makeHit({ subject: 'TypeScript tips' })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('[TypeScript tips]');
  });

  it('uses [memory] label when subject is null', async () => {
    const reader = makeReader({
      hits: [makeHit({ subject: null })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('[memory]');
  });

  it('truncates chunk text longer than 400 chars with …', async () => {
    // Use a chunk with spaces so lastIndexOf finds a break point well below 400.
    // Each word is 5 chars + space; 80 words = 480 chars total.
    const word = 'alpha ';
    const longChunk = word.repeat(80); // 480 chars with spaces
    const reader = makeReader({
      hits: [makeHit({ chunkText: longChunk })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toContain('…');
    // Full original chunk must not appear verbatim — truncation happened.
    expect(result.includes(longChunk)).toBe(false);
  });

  it('does NOT truncate chunk text of exactly 400 chars', async () => {
    const exactChunk = 'y'.repeat(400);
    const reader = makeReader({
      hits: [makeHit({ chunkText: exactChunk })],
      bm25Only: false,
    });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).not.toContain('…');
    expect(result).toContain(exactChunk);
  });

  it('ends with a --- divider', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result.trimEnd().endsWith('---')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// workspaceRoot forwarding
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — workspaceRoot forwarding', () => {
  it('passes workspaceRoot to reader.search', async () => {
    const reader = makeReader({ hits: [makeHit()], bm25Only: false });
    const injector = makeInjector(reader);

    await injector.buildBlock(LONG_QUERY, 'D:/myproject');

    expect(reader.search).toHaveBeenCalledWith(LONG_QUERY, 5, 'D:/myproject');
  });

  it('passes undefined workspaceRoot when not provided', async () => {
    const reader = makeReader({ hits: [], bm25Only: true });
    const injector = makeInjector(reader);

    await injector.buildBlock(LONG_QUERY);

    expect(reader.search).toHaveBeenCalledWith(LONG_QUERY, 5, undefined);
  });
});

// ---------------------------------------------------------------------------
// Error resilience
// ---------------------------------------------------------------------------

describe('MemoryPromptInjector.buildBlock — error resilience', () => {
  it('returns empty string when reader.search throws', async () => {
    const reader: IMemoryReader = {
      search: jest.fn().mockRejectedValue(new Error('database is locked')),
    };
    const injector = makeInjector(reader);

    const result = await injector.buildBlock(LONG_QUERY);

    expect(result).toBe('');
  });

  it('does not rethrow when reader.search rejects', async () => {
    const reader: IMemoryReader = {
      search: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const injector = makeInjector(reader);

    await expect(injector.buildBlock(LONG_QUERY)).resolves.not.toThrow();
  });
});
