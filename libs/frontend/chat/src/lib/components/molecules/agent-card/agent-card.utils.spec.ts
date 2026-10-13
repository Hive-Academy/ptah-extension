/**
 * Incremental stdout/stderr parsing (TASK_2026_628 batch 4c).
 *
 * The per-card parsers re-parse only the tail of a growing buffer. Whatever
 * the chunking, their result must equal a full parse of the same buffer.
 */

import {
  createAgentOutputParser,
  createStderrParser,
  parseAgentOutput,
  parseStderr,
} from './agent-card.utils';

/** Deterministic PRNG (mulberry32) so a failing split is reproducible. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Split `text` into chunks that cut anywhere, including inside a line. */
function chunks(text: string, random: () => number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const size = 1 + Math.floor(random() * 23);
    out.push(text.slice(i, i + size));
    i += size;
  }
  return out;
}

const STDOUT_FIXTURE = [
  'Starting the agent',
  'plain prose line one',
  'plain prose line two',
  '',
  '● Planning the change',
  '## Heading with hashes',
  'Tool: Read src/app.ts',
  'const a = 1;',
  'const b = 2;',
  '► Tool result',
  'file contents here',
  'more contents',
  '► Tool result (error)',
  'ENOENT: missing',
  '[stderr] warming up the cache',
  '[stderr] loaded 3 files',
  '[stderr] request failed with timeout',
  'Reading package.json',
  'Searching for usages',
  'Error: something broke',
  'X build failed',
  'FAILED 2 tests',
  'Tool: Bash npm test',
  '',
  'trailing prose after the tool',
  '   indented prose',
  '# last heading',
  'final words',
].join('\n');

const STDERR_FIXTURE = [
  'Model: gpt-5',
  'loading cached config',
  'tokens: 1200 input',
  'unexpected failure in worker',
  'stack frame 1',
  '',
  'v1.2.3',
  'cost $0.02',
  'fatal: aborting',
  'done in 42ms',
].join('\n');

describe('createAgentOutputParser', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    'equals parseAgentOutput after every chunk (seed %i)',
    (seed) => {
      const parse = createAgentOutputParser();
      let buffer = '';
      for (const chunk of chunks(STDOUT_FIXTURE, rng(seed))) {
        buffer += chunk;
        expect(parse(buffer)).toEqual(parseAgentOutput(buffer));
      }
    },
  );

  it('equals parseAgentOutput when every chunk is one character', () => {
    const parse = createAgentOutputParser();
    let buffer = '';
    for (const char of STDOUT_FIXTURE) {
      buffer += char;
      expect(parse(buffer)).toEqual(parseAgentOutput(buffer));
    }
  });

  it('handles a line that only becomes a boundary once it is complete', () => {
    const parse = createAgentOutputParser();
    const steps = ['prose\nTool:', 'prose\nTool: Re', 'prose\nTool: Read x\nbody'];
    for (const step of steps) {
      expect(parse(step)).toEqual(parseAgentOutput(step));
    }
  });

  it('falls back to a full parse across a front truncation', () => {
    const parse = createAgentOutputParser();
    const random = rng(42);
    let buffer = '';
    for (const chunk of chunks(STDOUT_FIXTURE, random)) {
      buffer += chunk;
      parse(buffer);
    }
    // The store front-trims on a line boundary and writes a head notice.
    const cut = buffer.indexOf('\n', buffer.length / 2) + 1;
    let trimmed =
      `… ${cut} characters of earlier output were dropped to bound this card.\n` +
      buffer.slice(cut);
    expect(parse(trimmed)).toEqual(parseAgentOutput(trimmed));

    for (const chunk of chunks('\nTool: Grep foo\nmatch\nafter trim', random)) {
      trimmed += chunk;
      expect(parse(trimmed)).toEqual(parseAgentOutput(trimmed));
    }
  });

  it('starts over when the buffer is reset', () => {
    const parse = createAgentOutputParser();
    parse(STDOUT_FIXTURE);
    expect(parse('fresh run')).toEqual(parseAgentOutput('fresh run'));
  });

  it('returns the same array when the buffer did not change', () => {
    const parse = createAgentOutputParser();
    const first = parse(STDOUT_FIXTURE);
    expect(parse(STDOUT_FIXTURE)).toBe(first);
  });
});

describe('createStderrParser', () => {
  it.each([1, 2, 3, 4, 5, 6])(
    'equals parseStderr after every chunk (seed %i)',
    (seed) => {
      const parse = createStderrParser();
      let buffer = '';
      for (const chunk of chunks(STDERR_FIXTURE, rng(seed))) {
        buffer += chunk;
        expect(parse(buffer)).toEqual(parseStderr(buffer));
      }
    },
  );

  it('equals parseStderr when every chunk is one character', () => {
    const parse = createStderrParser();
    let buffer = '';
    for (const char of STDERR_FIXTURE) {
      buffer += char;
      expect(parse(buffer)).toEqual(parseStderr(buffer));
    }
  });
});
