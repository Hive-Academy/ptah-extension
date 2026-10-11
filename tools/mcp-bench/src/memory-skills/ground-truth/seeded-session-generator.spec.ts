/**
 * Batch 4 spec: the seeded session generator, the worked-facts seed and the
 * distractor bank.
 *
 * The product round-trip (Assumption, batches.md "Plan validation") checks the
 * generator's output against the REAL curator modules — `planCuratorWindows`
 * and `clampTranscript` imported from the `@ptah-extension/memory-curator`
 * barrel (the retention-policies.spec.ts pattern: the barrel loads tsyringe,
 * so the reflect polyfill comes first, and it pulls `vscode` through
 * vscode-core, so the module is stubbed virtually for this Jest run). The
 * JSONL side is checked against the reader's documented contract
 * (`projectHistoryMessages`, `session-history-reader.service.ts:587-612`, its
 * `LINE_UUID_PATTERN` at 770-771, the adapter's flattening at
 * `sdk-transcript-reader.adapter.ts:37-39`).
 */
import 'reflect-metadata';
jest.mock('vscode', () => ({}), { virtual: true });
import {
  clampTranscript,
  CURATOR_MAX_WINDOWS,
  CURATOR_TRANSCRIPT_MAX_CHARS,
  planCuratorWindows,
} from '@ptah-extension/memory-curator';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { factSchema, type Fact } from './label-schemas';
import { readManifest, sha256File } from './fixture-manifest';
import {
  CURATOR_WINDOW_CHARS,
  CURATOR_WINDOW_LIMIT,
  LONG_SESSION_WINDOWS,
  distractorRecordSchema,
  fixedDailyClock,
  generateLongSeededSession,
  generateSeededSession,
  maxMiddlePlantings,
  MiddleFactSurvivesClampError,
  parseDistractorBank,
  turnTemplateRecordSchema,
  type DistractorBankRecord,
  type DistractorRecord,
  type PlantedStatement,
  type SeededSession,
} from './seeded-session-generator';

const FIXTURES_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  'fixtures',
  'memory-skills',
);
const SEED = 'TASK_2026_620:gt-memory@v1';
/** The reader's `LINE_UUID_PATTERN` (session-history-reader.service.ts:770-771). */
const LINE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/**
 * The product clamp's whole budget: one window's cap times the window limit
 * (`transcript-windows.ts:333` passes exactly this to `clampTranscript`).
 */
const CLAMP_BUDGET = CURATOR_TRANSCRIPT_MAX_CHARS * CURATOR_MAX_WINDOWS;

let bank: DistractorBankRecord[];
let facts: Fact[];

function parseFacts(text: string): Fact[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => factSchema.parse(JSON.parse(line)));
}

function plantingOf(fact: Fact): PlantedStatement {
  return { factId: fact.id, statement: fact.statement, date: fact.date };
}

function sessionFor(fact: Fact): SeededSession {
  return generateSeededSession({
    seed: SEED,
    planting: plantingOf(fact),
    bank,
    clock: fixedDailyClock,
  });
}

beforeAll(async () => {
  bank = parseDistractorBank(
    await readFile(join(FIXTURES_DIR, 'distractors.v1.jsonl'), 'utf8'),
  );
  facts = parseFacts(
    await readFile(join(FIXTURES_DIR, 'memory-facts.v1.jsonl'), 'utf8'),
  );
});

describe('committed fixtures', () => {
  it('memory-facts.v1.jsonl carries the accepted U2 facts, git-cited', () => {
    const factIds = facts.map((fact) => fact.id);
    const expectedFactIds = Array.from(
      { length: 130 },
      (_, index) => `F-${String(index + 1).padStart(3, '0')}`,
    ).filter((id) => id !== 'F-038');
    expect(new Set(factIds).size).toBe(factIds.length);
    expect(new Set(factIds)).toEqual(new Set(expectedFactIds));
    for (const fact of facts) {
      // R-M1 form: a public task source plus the git revision that pins it.
      expect(
        /^\.ptah\/specs\/[^:]+:\d+/.test(fact.source) ||
          /^[A-Z]+_\d+(?:_[\w-]+)*\/[^:]+:\d+/.test(fact.source) ||
          /^commit [0-9a-f]{7,40}/.test(fact.source),
      ).toBe(true);
      expect(fact.sourceCommit).toMatch(/^[0-9a-f]{7,40}$/);
    }
    // The accepted seed covers the whole category taxonomy (design 10.1).
    expect(new Set(facts.map((fact) => fact.category))).toEqual(
      new Set([
        'extraction',
        'multi-session',
        'update',
        'temporal',
        'contradiction',
        'abstention',
      ]),
    );
  });

  it('seed facts record the accepted U2 provenance', () => {
    for (const fact of facts) {
      expect(['r1+r2', 'adj-glm']).toContain(fact.labeller);
      expect(fact.labelledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('distractors.v1.jsonl is a usable bank with all three bait classes', () => {
    const distractors = bank.filter(
      (record): record is DistractorRecord => record.kind === 'distractor',
    );
    expect(
      distractors.filter((record) => record.baitClass === 'sediment').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      distractors.filter((record) => record.baitClass === 'rejected-hypothesis')
        .length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      distractors.filter((record) => record.baitClass === 'corrected-claim')
        .length,
    ).toBeGreaterThanOrEqual(1);
    for (const record of distractors) {
      if (record.baitClass === 'rejected-hypothesis') {
        expect(record.rebuttal).toBeDefined();
      }
    }
  });

  it('MANIFEST.json records the Batch 4 fixture hashes (verifyManifest)', async () => {
    const manifest = await readManifest(FIXTURES_DIR);
    for (const relPath of ['distractors.v1.jsonl', 'memory-facts.v1.jsonl']) {
      expect(manifest.files[relPath]).toBe(
        await sha256File(join(FIXTURES_DIR, relPath)),
      );
    }
  });
});

describe('standard seeded session', () => {
  it('is byte-identical across two runs', () => {
    const fact = facts[0] as Fact;
    const first = sessionFor(fact);
    const second = sessionFor(fact);
    expect(second).toStrictEqual(first);
    expect(second.jsonl).toBe(first.jsonl);
    expect(second.transcript).toBe(first.transcript);
  });

  it('satisfies the reader contract line by line', () => {
    for (const fact of facts) {
      const session = sessionFor(fact);
      const lines = session.jsonl
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines.length).toBe(session.turns.length);
      let previous = '';
      for (const line of lines) {
        const message = line['message'] as {
          role: string;
          content: { type: string; text: string }[];
        };
        expect(LINE_UUID_PATTERN.test(String(line['uuid']))).toBe(true);
        expect(message.role === 'user' || message.role === 'assistant').toBe(
          true,
        );
        // Not hidden by the projection (isMeta/isSynthetic absent).
        expect(line['isMeta']).toBeUndefined();
        expect(line['isSynthetic']).toBeUndefined();
        const content = message.content.map((block) => block.text).join('\n');
        expect(content.length).toBeGreaterThan(0);
        expect(content.trimStart().startsWith('<task-notification>')).toBe(
          false,
        );
        const timestamp = String(line['timestamp']);
        expect(timestamp > previous).toBe(true);
        previous = timestamp;
      }
      // The adapter's flattening (`ROLE: content` joined on a blank line)
      // must reproduce the generator's transcript exactly.
      expect(
        lines
          .map((line) => {
            const message = line['message'] as {
              role: string;
              content: { type: string; text: string }[];
            };
            return `${message.role.toUpperCase()}: ${message.content
              .map((block) => block.text)
              .join('\n')}`;
          })
          .join('\n\n'),
      ).toBe(session.transcript);
    }
  });

  it('plants the fact and carries at least one bait', () => {
    for (const fact of facts) {
      const session = sessionFor(fact);
      // The user states it and the assistant acknowledges it.
      expect(
        session.transcript.split(fact.statement).length,
      ).toBeGreaterThanOrEqual(3);
      expect(session.baits.length).toBeGreaterThanOrEqual(1);
      for (const bait of session.baits) {
        const baitTurn = session.turns[bait.turnIndex];
        expect(session.transcript).toContain(baitTurn.text);
        if (bait.baitClass !== 'sediment') {
          // Classes b and c: the rebuttal immediately follows the bait.
          expect(session.transcript).toContain(
            session.turns[bait.turnIndex + 1].text,
          );
        }
      }
      expect(session.windowPlan.plannedWindows).toBe(1);
      expect(session.windowPlan.exceedsWindowLimit).toBe(false);
    }
  });

  it('is accepted by the product window plan as one window', () => {
    const session = sessionFor(facts[0] as Fact);
    const plan = planCuratorWindows(session.transcript);
    expect(plan.windows).toHaveLength(1);
    expect(plan.windows[0].windowCount).toBe(1);
    expect(plan.clamped).toBeNull();
    // No compressible tool noise in generator output: the compression the
    // planner runs is the identity, so one window really is the whole text.
    expect(plan.compressedChars).toBe(plan.originalChars);
    // The clamp never fires on a single-window session.
    expect(clampTranscript(session.transcript).clamped).toBe(false);
  });

  it('separates sessions by planting identity (update pairs, date order)', () => {
    const accepted = facts.find((fact) => fact.id === 'F-005') as Fact;
    const priorDate = new Date(`${accepted.date}T00:00:00.000Z`);
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
    const prior = priorDate.toISOString().slice(0, 10);
    const v1 = generateSeededSession({
      seed: SEED,
      planting: {
        factId: 'F-005',
        statement: 'The prior directive named a different checkpoint.',
        date: prior,
      },
      bank,
      clock: fixedDailyClock,
    });
    const v2 = sessionFor(accepted);
    // Two separate dated sessions (design 3.3), curated in date order.
    expect(v1.sessionId).not.toBe(v2.sessionId);
    expect(v1.datedAt).toBe(`${prior}T10:00:00.000Z`);
    expect(v2.datedAt).toBe(`${accepted.date}T10:00:00.000Z`);
    expect(v1.datedAt < v2.datedAt).toBe(true);
    expect(v1.transcript).toContain(
      'The prior directive named a different checkpoint.',
    );
    expect(v1.transcript).not.toContain(accepted.statement);
    expect(v2.transcript).toContain(accepted.statement);
  });
});

describe('long seeded session', () => {
  const plantings = (): PlantedStatement[] => {
    const picked = facts.filter(
      (fact) => fact.id === 'F-001' || fact.id === 'F-008',
    );
    return picked.map((fact) => plantingOf(fact));
  };

  it('reports a window plan past the product limit, facts in 4..n-4', () => {
    const session = generateLongSeededSession({
      seed: SEED,
      plantings: plantings(),
      bank,
      clock: fixedDailyClock,
      factPlacement: 'middle',
    });
    expect(session.windowPlan.plannedWindows).toBeGreaterThanOrEqual(12);
    expect(session.windowPlan.plannedWindows).toBeGreaterThan(
      CURATOR_WINDOW_LIMIT,
    );
    // Computed from the finished transcript with the product's own figure,
    // never a hard-coded window count.
    expect(session.windowPlan.plannedWindows).toBe(
      Math.ceil(session.transcript.length / CURATOR_TRANSCRIPT_MAX_CHARS),
    );
    expect(session.windowPlan.exceedsWindowLimit).toBe(true);
    // The transcript really fills the planned windows.
    expect(session.transcript.length).toBeGreaterThanOrEqual(
      LONG_SESSION_WINDOWS * CURATOR_WINDOW_CHARS,
    );
    for (const factWindow of session.windowPlan.factWindows) {
      expect(factWindow.window).toBeGreaterThanOrEqual(4);
      expect(factWindow.window).toBeLessThanOrEqual(
        session.windowPlan.plannedWindows - 4,
      );
    }
    // A bait rides the head window even in a long session.
    expect(session.baits.length).toBeGreaterThanOrEqual(1);
  });

  it('loses its middle facts to the product clamp (middle placement)', () => {
    const session = generateLongSeededSession({
      seed: SEED,
      plantings: plantings(),
      bank,
      clock: fixedDailyClock,
      factPlacement: 'middle',
    });
    const plan = planCuratorWindows(session.transcript);
    // Beyond 8 windows the planner caps and the clamp elides the middle.
    expect(plan.windows).toHaveLength(CURATOR_MAX_WINDOWS);
    expect(plan.clamped?.clamped).toBe(true);
    expect(plan.clamped?.droppedChars).toBeGreaterThan(0);
    expect(plan.compressedChars).toBe(plan.originalChars);
    // The clamp's own kept text (head + tail of the 8-window budget) drops
    // every middle-window fact, and no capped window carries one either.
    const clamp = clampTranscript(session.transcript, CLAMP_BUDGET);
    expect(clamp.clamped).toBe(true);
    expect(clamp.text.length).toBeLessThan(session.transcript.length);
    for (const statement of plantings().map((p) => p.statement)) {
      expect(clamp.text).not.toContain(statement);
      for (const window of plan.windows) {
        expect(window.text).not.toContain(statement);
      }
    }
  });

  it('keeps head-planted facts in window 1 (the head-recall baseline)', () => {
    const session = generateLongSeededSession({
      seed: SEED,
      plantings: plantings(),
      bank,
      clock: fixedDailyClock,
      factPlacement: 'head',
    });
    const plan = planCuratorWindows(session.transcript);
    // Both statements survive in the first window the planner serves.
    expect(plan.windows[0].text).toContain(plantings()[0].statement as string);
    expect(plan.windows[0].text).toContain(plantings()[1].statement as string);
    for (const statement of plantings().map((p) => p.statement)) {
      expect(session.transcript.indexOf(statement)).toBeLessThan(
        CURATOR_WINDOW_CHARS,
      );
    }
  });

  it('drops every middle fact at the clamp-derived maximum', () => {
    const cap = maxMiddlePlantings();
    const plantings: PlantedStatement[] = facts
      .slice(0, cap)
      .map((fact) => plantingOf(fact));
    const session = generateLongSeededSession({
      seed: SEED,
      plantings,
      bank,
      clock: fixedDailyClock,
      factPlacement: 'middle',
    });
    const plan = planCuratorWindows(session.transcript);
    const clamp = clampTranscript(session.transcript, CLAMP_BUDGET);
    expect(clamp.clamped).toBe(true);
    for (const statement of plantings.map((planting) => planting.statement)) {
      // The real product clamp drops every maximally-planted middle fact.
      expect(clamp.text).not.toContain(statement);
      for (const window of plan.windows) {
        expect(window.text).not.toContain(statement);
      }
    }
  });

  it('separates the head and middle variants by id with identical filler', () => {
    const variant = (factPlacement: 'middle' | 'head') => ({
      seed: SEED,
      plantings: plantings(),
      bank,
      clock: fixedDailyClock,
      factPlacement,
    });
    const middle = generateLongSeededSession(variant('middle'));
    const head = generateLongSeededSession(variant('head'));
    // The placement rides the session id, and the per-turn uuids derive
    // from it, so the two variants never collide on the same ids.
    expect(middle.sessionId).not.toBe(head.sessionId);
    const uuidOf = (session: SeededSession): string =>
      (
        JSON.parse(session.jsonl.split('\n')[0] as string) as Record<
          string,
          unknown
        >
      )['uuid'] as string;
    expect(uuidOf(middle)).not.toBe(uuidOf(head));
    // The variants differ ONLY in fact placement: every non-fact turn —
    // opener, bait, fillers, closers — is drawn identically.
    const nonFactTexts = (session: SeededSession): string[] =>
      session.turns
        .filter(
          (turn) => turn.factIds.length === 0 && turn.baitIds.length === 0,
        )
        .map((turn) => turn.text);
    expect(nonFactTexts(middle)).toEqual(nonFactTexts(head));
    const factTexts = (session: SeededSession): string[] =>
      session.turns
        .filter((turn) => turn.factIds.length > 0)
        .map((turn) => turn.text);
    expect(factTexts(middle)).toEqual(factTexts(head));
    // ...and the fact turns sit in different places.
    expect(
      middle.turns.findIndex((turn) => turn.factIds.length > 0),
    ).toBeGreaterThan(head.turns.findIndex((turn) => turn.factIds.length > 0));
  });

  it('is byte-identical across two runs', () => {
    const input = {
      seed: SEED,
      plantings: plantings(),
      bank,
      clock: fixedDailyClock,
      factPlacement: 'middle' as const,
    };
    expect(generateLongSeededSession(input)).toStrictEqual(
      generateLongSeededSession(input),
    );
  });
});

describe('construction errors (edge cases)', () => {
  it('rejects a bank without turn templates', () => {
    expect(() =>
      generateSeededSession({
        seed: SEED,
        planting: plantingOf(facts[0] as Fact),
        bank: bank.filter((record) => record.kind === 'distractor'),
        clock: fixedDailyClock,
      }),
    ).toThrow(/missing turn templates/);
  });

  it('rejects a bank without a bait class', () => {
    expect(() =>
      generateSeededSession({
        seed: SEED,
        planting: plantingOf(facts[0] as Fact),
        bank: bank.filter(
          (record) =>
            record.kind === 'turn-template' ||
            (record.kind === 'distractor' &&
              record.baitClass !== 'corrected-claim'),
        ),
        clock: fixedDailyClock,
      }),
    ).toThrow(/missing a corrected-claim bait/);
  });

  it('rejects a long session with fewer than 2 facts', () => {
    expect(() =>
      generateLongSeededSession({
        seed: SEED,
        plantings: [plantingOf(facts[0] as Fact)],
        bank,
        clock: fixedDailyClock,
        factPlacement: 'middle',
      }),
    ).toThrow(/at least 2 seeded facts/);
  });

  it('rejects more middle plantings than the clamp-derived cap', () => {
    const many: PlantedStatement[] = facts
      .slice(0, maxMiddlePlantings() + 1)
      .map((fact) => plantingOf(fact));
    expect(() =>
      generateLongSeededSession({
        seed: SEED,
        plantings: many,
        bank,
        clock: fixedDailyClock,
        factPlacement: 'middle',
      }),
    ).toThrow(MiddleFactSurvivesClampError);
  });

  it('rejects one fact planted twice in a long session', () => {
    const one = plantingOf(facts[0] as Fact);
    expect(() =>
      generateLongSeededSession({
        seed: SEED,
        plantings: [one, one],
        bank,
        clock: fixedDailyClock,
        factPlacement: 'middle',
      }),
    ).toThrow(/separate dated sessions/);
  });

  it('rejects malformed plantings', () => {
    expect(() =>
      generateSeededSession({
        seed: SEED,
        planting: {
          factId: 'F-001',
          statement: 'durable statement',
          date: '2026-13-45',
        },
        bank,
        clock: fixedDailyClock,
      }),
    ).toThrow(/date must be a real calendar date/);
    // Day overflow: V8 parses 2026-02-31 to March 3, so only the round-trip
    // comparison (like `isCalendarDate`, label-schemas.ts:18-22) rejects it.
    expect(() =>
      generateSeededSession({
        seed: SEED,
        planting: {
          factId: 'F-001',
          statement: 'durable statement',
          date: '2026-02-31',
        },
        bank,
        clock: fixedDailyClock,
      }),
    ).toThrow(/date must be a real calendar date/);
    expect(() =>
      generateSeededSession({
        seed: SEED,
        planting: {
          factId: 'F-001',
          statement: '   ',
          date: '2026-09-04',
        },
        bank,
        clock: fixedDailyClock,
      }),
    ).toThrow(/empty statement/);
  });

  it('rejects a clock that returns an invalid instant', () => {
    expect(() =>
      generateSeededSession({
        seed: SEED,
        planting: plantingOf(facts[0] as Fact),
        bank,
        clock: { sessionStartAt: () => 'not-an-instant' },
      }),
    ).toThrow(/invalid instant/);
  });

  it('names the line when the bank JSONL is malformed', () => {
    expect(() => parseDistractorBank('{"kind":"distractor"}\n')).toThrow(
      /distractors\.v1\.jsonl line 1/,
    );
  });

  it('keeps the bank schema strict about baits and templates', () => {
    expect(() =>
      distractorRecordSchema.parse({
        kind: 'distractor',
        id: 'D-x',
        baitClass: 'sediment',
        text: 'sediment line',
        rebuttal: 'a sediment bait never carries a rebuttal',
        scenarioTags: ['test'],
      }),
    ).toThrow();
    expect(() =>
      distractorRecordSchema.parse({
        kind: 'distractor',
        id: 'D-x',
        baitClass: 'corrected-claim',
        text: 'claim',
        scenarioTags: ['test'],
      }),
    ).toThrow();
    expect(() =>
      turnTemplateRecordSchema.parse({
        kind: 'turn-template',
        id: 'T-x',
        slot: 'fact',
        role: 'user',
        text: 'no placeholder here',
        scenarioTags: ['test'],
      }),
    ).toThrow();
    expect(() =>
      turnTemplateRecordSchema.parse({
        kind: 'turn-template',
        id: 'T-x',
        slot: 'filler-short',
        role: 'user',
        text: 'filler that plants {statement}',
        scenarioTags: ['test'],
      }),
    ).toThrow();
    expect(() =>
      turnTemplateRecordSchema.parse({
        kind: 'turn-template',
        id: 'T-x',
        slot: 'filler-short',
        role: 'user',
        text: '[tool_result] fillers must not open a tool line',
        scenarioTags: ['test'],
      }),
    ).toThrow();
  });
});

describe('kept-in-step generator constants', () => {
  it('CURATOR_WINDOW_CHARS equals the product clamp cap', () => {
    expect(CURATOR_WINDOW_CHARS).toBe(CURATOR_TRANSCRIPT_MAX_CHARS);
  });

  it('CURATOR_WINDOW_LIMIT equals the product window cap', () => {
    expect(CURATOR_WINDOW_LIMIT).toBe(CURATOR_MAX_WINDOWS);
  });
});
