import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';

import { renderPtahUiBlock } from './ptah-ui-pipeline';
import { PTAH_UI_CORPUS } from './ptah-ui.corpus';
import type { SurfaceContent } from './surface.types';

const countBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

const populatedChangeSet = {
  sessionId: 'session',
  workspaceRoot: 'workspace',
  turnStartedAt: 0,
  turnEndedAt: 1,
  files: [
    { path: 'file.ts', status: 'M' as const, additions: 2, deletions: 1 },
  ],
  truncatedCount: 0,
  totals: { files: 1, additions: 2, deletions: 1 },
  countsUnavailable: false,
};

const populated: TurnSourceSnapshot = {
  state: 'terminal',
  incomplete: false,
  diff: {
    kind: 'available',
    changeSet: populatedChangeSet,
  },
  tests: {
    kind: 'available',
    runs: [{ command: 'npm test', outcome: 'passed' }],
    summary: { total: 1, passed: 1, failed: 0, unknown: 0 },
  },
  usage: {
    kind: 'available',
    input: 10,
    output: 5,
    cost: 0.25,
    durationMs: 500,
  },
};

const empty: TurnSourceSnapshot = {
  ...populated,
  diff: {
    kind: 'available',
    changeSet: {
      ...populatedChangeSet,
      files: [],
      totals: { files: 0, additions: 0, deletions: 0 },
    },
  },
  tests: {
    kind: 'available',
    runs: [],
    summary: { total: 0, passed: 0, failed: 0, unknown: 0 },
  },
};

const pending: TurnSourceSnapshot = {
  ...populated,
  state: 'pending',
  diff: { kind: 'pending' },
  tests: { kind: 'pending' },
  usage: { kind: 'pending' },
};
const unavailable: TurnSourceSnapshot = {
  ...populated,
  diff: { kind: 'unavailable' },
  tests: { kind: 'unavailable' },
  usage: { kind: 'unavailable' },
};

type StateCase = readonly [string, TurnSourceSnapshot | null, string | null];
const states: readonly StateCase[] = [
  ['null', null, 'unavailable'],
  ['pending', pending, 'pending'],
  ['unavailable', unavailable, 'unavailable'],
  ['available but empty', empty, null],
  ['available with data', populated, null],
];

const boundElements: readonly [string, string, string][] = [
  [
    'stats',
    'stats\n  Files | $diff.files\n  Tests | $tests.total\n  Cost | $usage.cost\n',
    '',
  ],
  ['diff table', 'table $diff\n', 'No files changed this turn'],
  ['tests table', 'table $tests\n', 'No tests ran this turn'],
  ['diff list', 'list $diff\n', 'No files changed this turn'],
  ['tests list', 'list $tests\n', 'No tests ran this turn'],
  [
    'selected diff columns',
    'table $diff\n  cols path | additions\n',
    'No files changed this turn',
  ],
];

describe('renderPtahUiBlock', () => {
  it.each(
    boundElements.flatMap(([element, body, emptyText]) =>
      states.map(
        ([state, snapshot, status]) =>
          [element, body, emptyText, state, snapshot, status] as const,
      ),
    ),
  )(
    'accepts %s with a %s snapshot',
    (_element, body, emptyText, _state, snapshot, status) => {
      const result = renderPtahUiBlock(body, {
        surfaceId: 'surface',
        snapshot,
        countBytes,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const text = surfaceText(result.content);
      if (status !== null) expect(text).toContain(status);
      else if (emptyText !== '' && snapshot === empty)
        expect(text).toContain(emptyText);
    },
  );

  it('returns the parser reason unchanged', () => {
    expect(
      renderPtahUiBlock('gauge Nope\n', {
        surfaceId: 'surface',
        snapshot: null,
        countBytes,
      }),
    ).toMatchObject({ ok: false, reason: 'unknown element `gauge` (line 1)' });
  });

  it('maps validator failures to a short user-facing reason', () => {
    const body = `title ${'x'.repeat(2001)}\nstats\n  Literal | value\n`;
    expect(
      renderPtahUiBlock(body, {
        surfaceId: 'surface',
        snapshot: null,
        countBytes,
      }),
    ).toEqual({ ok: false, reason: 'invalid display content' });
  });

  it('maps a byte-counter exception to internal error', () => {
    expect(
      renderPtahUiBlock('stats\n  Literal | value\n', {
        surfaceId: 'surface',
        snapshot: null,
        countBytes: () => {
          throw new Error('boom');
        },
      }),
    ).toEqual({ ok: false, reason: 'internal error' });
  });

  it.each([
    '**markdown**',
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    'https://example.test/release',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  ])('keeps untrusted text literal in every display position: %s', (text) => {
    const body = `title ${text}\nstats\n  ${text} | ${text}\ntable\n  ${text} | Column\n  ${text} | ${text}\nlist\n  - ${text}\nchart line ${text}\n  ${text} | 1\n`;
    const result = renderPtahUiBlock(body, {
      surfaceId: 'surface',
      snapshot: null,
      countBytes,
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(surfaceText(result.content)).toContain(text);
  });

  it('emits display-only components without URLs, actions, inputs, or data references', () => {
    const result = renderPtahUiBlock(PTAH_UI_CORPUS[5].body, {
      surfaceId: 'surface',
      snapshot: null,
      countBytes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.content.contract !== 'dashboard-spec/2') return;
    expect(JSON.stringify(result.content.surface)).not.toMatch(
      /"(?:url|actions|data)"\s*:/,
    );
    expect(JSON.stringify(result.content.surface)).not.toMatch(
      /"kind"\s*:\s*"[^"\n]*input/i,
    );
  });

  it('returns the validator budget reason when a block exceeds it', () => {
    const result = renderPtahUiBlock('stats\n  Literal | value\n', {
      surfaceId: 'surface',
      snapshot: null,
      countBytes: (value) =>
        typeof value === 'object' && value !== null && 'components' in value
          ? Number.MAX_SAFE_INTEGER
          : 0,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'block exceeds a display limit',
    });
  });

  it.each(PTAH_UI_CORPUS)('renders corpus case $name', ({ body }) => {
    expect(
      renderPtahUiBlock(body, {
        surfaceId: 'surface',
        snapshot: populated,
        countBytes,
      }),
    ).toMatchObject({ ok: true });
  });

  it('renders an over-limit host test command through the full pipeline', () => {
    const command = 'c'.repeat(2_001);
    const result = renderPtahUiBlock('table $tests\n', {
      surfaceId: 'surface',
      snapshot: {
        ...populated,
        tests: {
          kind: 'available',
          runs: [{ command, outcome: 'passed' }],
          summary: { total: 1, passed: 1, failed: 0, unknown: 0 },
        },
      },
      countBytes,
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).toContain(`${'c'.repeat(1_999)}…`);
  });
});

function surfaceText(content: SurfaceContent): string {
  if (content.contract !== 'dashboard-spec/2') return '';
  return JSON.stringify(content.surface);
}
