import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scorecard, summarizeVerdicts } from './scorecard.types';
import {
  readScorecard,
  renderScorecardMarkdown,
  writeScorecardJson,
  writeScorecardMarkdown,
} from './scorecard-writers';

const scorecard: Scorecard = {
  schemaVersion: 1,
  run: {
    id: 'run-1',
    startedAt: '2026-10-06T10:00:00.000Z',
    host: 'cli-headless',
    os: 'win32',
    node: '24.0.0',
  },
  product: { version: '1.0.0', commit: 'abcdef' },
  corpus: {
    repo: 'ptah',
    commit: '7910f34cf',
    eligibleFiles: 2,
    tsVersion: '6.0.3',
  },
  suites: [
    {
      tool: 'ptah_code_search_symbols',
      claim: 'ptah-core-prompt.ts:47',
      questions: 2,
      tool_metrics: {
        'hit@1': 1,
        tokens_p50: 50,
        calls_per_answer: 1,
        latency_ms: { p50: 10, p95: 20 },
        error_rate: 0,
        truncation_rate: 0,
      },
      native_metrics: {
        baseline: 'rg',
        'hit@1': 0.5,
        tokens_p50: 100,
        calls_per_answer: 2,
        latency_ms: { p50: 15, p95: 30 },
        error_rate: 0,
        truncation_rate: 0,
      },
      delta: { quality: 0.5, tokens: 50, calls: 1, latency_ms_p50: 5 },
      verdict: 'pass',
      failures: [],
    },
    {
      tool: 'ptah_search_text',
      claim: 'ptah-core-prompt.ts:48',
      questions: 0,
      tool_metrics: { latency_ms: { p50: null, p95: null } },
      native_metrics: { baseline: 'rg', latency_ms: { p50: null, p95: null } },
      delta: { quality: null, tokens: null, calls: null, latency_ms_p50: null },
      verdict: 'na',
      naReason: 'No latency samples',
      failures: [],
    },
  ],
  lifecycle: [
    {
      scenario: 'edit-then-query',
      tool: 'ptah_code_search_symbols',
      pass: true,
      detail: 'updated within five seconds',
    },
  ],
  eagerSelection: {
    eager: ['ptah_code_search_symbols'],
    deferred: ['ptah_search_text'],
    rule: 'see B10',
  },
};

describe('scorecard writers', () => {
  it('writes validated JSON and the required Markdown tables', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-bench-scorecard-'));
    try {
      const jsonPath = await writeScorecardJson(scorecard, directory);
      const markdownPath = await writeScorecardMarkdown(scorecard, directory);
      expect(await readScorecard(jsonPath)).toEqual(scorecard);
      expect(await readFile(markdownPath, 'utf8')).toContain(
        '## ptah_code_search_symbols',
      );
      expect(renderScorecardMarkdown(scorecard)).toContain('## Lifecycle');
      expect(renderScorecardMarkdown(scorecard)).toContain(
        '## Eager selection',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not count na as a pass and requires its reason', () => {
    expect(summarizeVerdicts(scorecard.suites)).toEqual({
      passed: 1,
      failed: 0,
      notApplicable: 1,
    });
    const missingReason = structuredClone(scorecard);
    missingReason.suites[1] = {
      ...missingReason.suites[1],
      naReason: undefined,
    };
    expect(() => renderScorecardMarkdown(missingReason)).toThrow(
      'na suites require naReason',
    );
  });

  it('rejects an invalid JSON scorecard on read', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-bench-scorecard-'));
    const path = join(directory, 'scorecard.json');
    try {
      await writeFile(
        path,
        JSON.stringify({
          ...scorecard,
          run: { ...scorecard.run, host: 'cli' },
        }),
        'utf8',
      );
      await expect(readScorecard(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
