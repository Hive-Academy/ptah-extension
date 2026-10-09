/**
 * Deterministic seeded-session generator for the memory write-side suites
 * (design 3.1 / 10.1: every seeded fact is stated inside a templated session
 * that also carries bait; the long-session class plants its facts in the
 * middle windows the curator's window clamp drops).
 *
 * ## Determinism
 *
 * Byte-identical across runs by construction: a seeded PRNG (the Task 1.1
 * FNV-1a-seeded Mulberry32 of `metrics/bootstrap.ts:76-90`, kept in step by
 * hand because that module does not export it), a caller-supplied clock, no
 * `Date.now()`, no `Math.random()`, no network, no model. Two runs with the
 * same inputs produce the same `jsonl` and `transcript` byte for byte — the
 * spec pins this.
 *
 * ## Product shapes the output must satisfy
 *
 * - JSONL lines are the boot-scan reader's raw shape (`SessionHistoryMessage`,
 *   `history.types.ts:16-46`): `type`, `uuid`, `sessionId`, `timestamp`,
 *   `cwd` and `message { role, content }` with content an array of text
 *   blocks. No line is `isMeta`/`isSynthetic`, a non-user/assistant role, an
 *   empty content or a `<task-notification>` opener, so the reader's
 *   projection (`session-history-reader.service.ts:587-612`) keeps every
 *   line; every `uuid` matches the reader's `LINE_UUID_PATTERN`
 *   (`session-history-reader.service.ts:770-771`).
 * - The flattened `transcript` is what `curate({ transcript })` receives and
 *   what `SdkTranscriptReaderAdapter.read` returns
 *   (`sdk-transcript-reader.adapter.ts:37-39`): `ROLE: content` records
 *   joined on a blank line, content being the text blocks joined on `\n`
 *   (`history-event-factory.ts:514-517` for a text-only array).
 * - No emitted line starts with `[tool_result` or `[tool_use `, so
 *   `compressToolNoise` (`transcript-windows.ts:148`) rewrites nothing and
 *   the product's window plan equals this generator's arithmetic.
 * - The long-session placement is checked after generation with the product's
 *   own `clampTranscript`: a middle-planted fact statement that survives the
 *   clamp throws `MiddleFactSurvivesClampError`, and a head-planted one the
 *   clamp drops is a plain generation error.
 *
 * ## Host/spec-only
 *
 * The `clampTranscript` import loads the memory-curator barrel (tsyringe +
 * vscode-core) at runtime, so generation runs inside the bench host or a spec,
 * never in the runner parent. Pinned by `../host-only-imports.spec.ts`.
 */

import {
  clampTranscript,
  CURATOR_MAX_WINDOWS,
  CURATOR_TRANSCRIPT_MAX_CHARS,
} from '@ptah-extension/memory-curator';

import { z } from 'zod';

import { RECORD_SEPARATOR, SessionJsonlWriter } from './session-jsonl-writer';

/**
 * Characters in one curator window — the product's own clamp cap, imported
 * from the barrel (which loads under Jest with the `vscode` stub the specs
 * install, `retention-policies.spec.ts:1-8`) so the two figures can never
 * drift apart.
 */
export const CURATOR_WINDOW_CHARS = CURATOR_TRANSCRIPT_MAX_CHARS;

/** Maximum windows per curation pass — the product's own figure. */
export const CURATOR_WINDOW_LIMIT = CURATOR_MAX_WINDOWS;

/**
 * Windows of filler text a long session is built with (the design asks for
 * "more than 8, about 12"). This is the build target, not the reported plan:
 * `windowPlan.plannedWindows` is computed from the finished transcript, and
 * the fact turns ride on top of the fill without displacing filler draws.
 */
export const LONG_SESSION_WINDOWS = 13;

/** Minutes between consecutive turns. Deterministic, so timestamps are too. */
const MINUTES_PER_TURN_STANDARD = 1;
const MINUTES_PER_TURN_LONG = 2;

/** The three bait classes (design 3.1). */
export type BaitClass = 'sediment' | 'rejected-hypothesis' | 'corrected-claim';

const baitClassSchema = z.enum([
  'sediment',
  'rejected-hypothesis',
  'corrected-claim',
]);

/** One bait of the distractor bank. */
export const distractorRecordSchema = z
  .strictObject({
    kind: z.literal('distractor'),
    id: z.string().min(1),
    baitClass: baitClassSchema,
    /** The bait as said in a session. */
    text: z.string().min(1),
    /** The in-session rebuttal: mandatory for classes b and c, never for a. */
    rebuttal: z.string().min(1).optional(),
    scenarioTags: z.array(z.string().min(1)),
  })
  .superRefine((record, ctx) => {
    if (record.baitClass === 'sediment') {
      if (record.rebuttal !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'a sediment bait is a single line and carries no rebuttal',
          path: ['rebuttal'],
        });
      }
    } else if (record.rebuttal === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${record.baitClass} bait needs the in-session rebuttal text`,
        path: ['rebuttal'],
      });
    }
    rejectCompressibleLines(record.text, record.rebuttal, ctx);
  });
export type DistractorRecord = z.infer<typeof distractorRecordSchema>;

/** Where a turn template may be used in a session. */
export const templateSlotSchema = z.enum([
  'opener',
  'fact',
  'filler-short',
  'filler-long',
  'closer',
]);
export type TemplateSlot = z.infer<typeof templateSlotSchema>;

/** One turn template of the distractor bank. */
export const turnTemplateRecordSchema = z
  .strictObject({
    kind: z.literal('turn-template'),
    id: z.string().min(1),
    slot: templateSlotSchema,
    role: z.enum(['user', 'assistant']),
    /** A fact template plants `{statement}`; every other slot must not. */
    text: z.string().min(1),
    scenarioTags: z.array(z.string().min(1)),
  })
  .superRefine((template, ctx) => {
    const plantsStatement = template.text.includes('{statement}');
    if (template.slot === 'fact' && !plantsStatement) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a fact template must contain the {statement} placeholder',
        path: ['text'],
      });
    }
    if (template.slot !== 'fact' && plantsStatement) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `a ${template.slot} template must not plant {statement}`,
        path: ['text'],
      });
    }
    rejectCompressibleLines(template.text, undefined, ctx);
  });
export type TurnTemplateRecord = z.infer<typeof turnTemplateRecordSchema>;

/** Any record of `distractors.v1.jsonl`: a bait or a turn template. */
export const distractorBankRecordSchema = z.union([
  distractorRecordSchema,
  turnTemplateRecordSchema,
]);
export type DistractorBankRecord = z.infer<typeof distractorBankRecordSchema>;

function rejectCompressibleLines(
  text: string,
  rebuttal: string | undefined,
  ctx: z.RefinementCtx,
): void {
  const lines = rebuttal === undefined ? text.split('\n') : [text, rebuttal];
  for (const line of lines) {
    if (/^\[tool_(?:result|use)/.test(line)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'bank text must not start a line with a tool label: ' +
          'compressToolNoise would rewrite it and shift the window plan',
        path: ['text'],
      });
      return;
    }
  }
}

/**
 * Parses and validates `distractors.v1.jsonl`: one record per non-empty line.
 * A malformed line throws with its 1-based line number.
 */
export function parseDistractorBank(text: string): DistractorBankRecord[] {
  const records: DistractorBankRecord[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    try {
      records.push(distractorBankRecordSchema.parse(JSON.parse(line)));
    } catch (error: unknown) {
      throw new Error(
        `distractors.v1.jsonl line ${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
  }
  return records;
}

/**
 * One statement planted into one session. Update pairs plant v1 at t1 and
 * v2 at t2 as two plantings — each planting becomes its own dated session
 * (design 3.3: "each value is planted in a separate seeded session, curated
 * in date order").
 */
export interface PlantedStatement {
  readonly factId: string;
  readonly statement: string;
  /** `YYYY-MM-DD`; the session is dated at this day. */
  readonly date: string;
}

/**
 * The injected clock: maps a planting to the session's start instant. Never
 * called with the wall clock; the default is a fixed time of day.
 */
export interface SeededSessionClock {
  sessionStartAt(planting: PlantedStatement): string;
}

/** Every seeded session starts at 10:00 UTC on its planting's date. */
export const fixedDailyClock: SeededSessionClock = {
  sessionStartAt(planting) {
    return `${planting.date}T10:00:00.000Z`;
  },
};

/** One emitted turn, with where it landed. */
export interface SeededTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** 0-based index into the session's turn list. */
  readonly turnIndex: number;
  /** 1-based window the turn was built into. */
  readonly window: number;
  readonly factIds: readonly string[];
  readonly baitIds: readonly string[];
}

/**
 * The reported window plan. `plannedWindows` is the number of
 * {@link CURATOR_WINDOW_CHARS} windows the transcript fills;
 * `exceedsWindowLimit` says the product's window planner will cap at
 * {@link CURATOR_WINDOW_LIMIT} windows and elide the middle.
 */
export interface SessionWindowPlan {
  readonly plannedWindows: number;
  readonly exceedsWindowLimit: boolean;
  readonly factWindows: readonly { factId: string; window: number }[];
}

/** A generated seeded session. */
export interface SeededSession {
  readonly sessionId: string;
  readonly kind: 'standard' | 'long';
  /** ISO datetime of the first turn. */
  readonly datedAt: string;
  /** Raw session JSONL: one SDK-shaped line per turn, LF-terminated. */
  readonly jsonl: string;
  /** The flattened transcript `curate({ transcript })` accepts. */
  readonly transcript: string;
  readonly turns: readonly SeededTurn[];
  readonly baits: readonly {
    id: string;
    baitClass: BaitClass;
    turnIndex: number;
  }[];
  readonly windowPlan: SessionWindowPlan;
}

export interface GenerateSessionInput {
  readonly seed: string;
  readonly planting: PlantedStatement;
  readonly bank: readonly DistractorBankRecord[];
  readonly clock: SeededSessionClock;
}

export interface GenerateLongSessionInput {
  readonly seed: string;
  /**
   * At least 2 plantings with distinct fact ids. Middle placements are capped
   * by `maxMiddlePlantings()` so every fact window sits inside the clamp's
   * elided middle; head placements have no cap (all facts share window 1).
   */
  readonly plantings: readonly PlantedStatement[];
  readonly bank: readonly DistractorBankRecord[];
  readonly clock: SeededSessionClock;
  /**
   * `'middle'` plants the facts in windows 4..n−4 (the clamp-dropped middle
   * the metric measures); `'head'` plants the same facts in window 1 (the
   * head-recall baseline).
   */
  readonly factPlacement: 'middle' | 'head';
}

/** The first window of the design's middle range, 1-based. */
const MIDDLE_FIRST_WINDOW = 4;

/**
 * The clamp's head share (`clamp-transcript.ts:54`), kept in step by hand
 * because the product does not export it. It only sizes the fail-fast
 * {@link maxMiddlePlantings} message; the authoritative middle-placement
 * check is the real `clampTranscript` call in `generateLongSeededSession`,
 * which throws if this figure ever drifts.
 */
const CLAMP_HEAD_SHARE = 0.25;

/**
 * A middle-planted fact statement survived the product's transcript clamp.
 * A surviving fact would silently score as recalled middle-window recall, so
 * this is a generation error, never a warning.
 */
export class MiddleFactSurvivesClampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MiddleFactSurvivesClampError';
  }
}

/**
 * How many facts a long session can plant in the middle so every fact window
 * sits strictly inside the span the product's clamp elides. Derived from the
 * clamp, not hard-coded: the clamp budget is {@link CURATOR_WINDOW_LIMIT}
 * windows, it keeps `ceil(head share × budget)` windows of head and the rest
 * of the budget as tail, facts may only occupy the windows between those two
 * kept spans, and the build always fills at least
 * {@link LONG_SESSION_WINDOWS} windows of filler, so the last
 * guaranteed-dropped window is `LONG_SESSION_WINDOWS − tail windows`.
 */
export function maxMiddlePlantings(): number {
  const headWindows = Math.ceil(CURATOR_WINDOW_LIMIT * CLAMP_HEAD_SHARE);
  const tailWindows = CURATOR_WINDOW_LIMIT - headWindows;
  return LONG_SESSION_WINDOWS - tailWindows - MIDDLE_FIRST_WINDOW + 1;
}

/**
 * Generates one standard session per planting: an opener, filler turns, the
 * planted fact (user statement + assistant acknowledgement), one bait of a
 * PRNG-chosen class and a closing pair. Short enough to plan exactly one
 * curator window.
 */
export function generateSeededSession(
  input: GenerateSessionInput,
): SeededSession {
  validatePlanting(input.planting);
  const templates = assertUsableBank(input.bank, 'standard');
  const random = seededRandom(
    `${input.seed}:${input.planting.factId}:${input.planting.date}`,
  );
  const builder = new SessionJsonlWriter<BaitClass>(
    sessionIdOf(input.seed, `${input.planting.factId}:${input.planting.date}`),
    input.clock.sessionStartAt(input.planting),
    MINUTES_PER_TURN_STANDARD,
    CURATOR_WINDOW_CHARS,
    CURATOR_WINDOW_LIMIT,
  );

  builder.turn('user', pick(templates.openers, random).text);
  const fillerPairs = 1 + Math.floor(random() * 2);
  for (let pair = 0; pair < fillerPairs; pair += 1) {
    builder.turn('user', pick(templates.fillersShort, random).text);
    builder.turn('assistant', pick(templates.assistantsShort, random).text);
  }

  const factWindow = builder.currentWindow;
  builder.turn(
    'user',
    render(pick(templates.factUser, random), input.planting.statement),
    [input.planting.factId],
  );
  builder.turn(
    'assistant',
    render(pick(templates.factAssistant, random), input.planting.statement),
    [input.planting.factId],
  );

  emitBait(builder, input.bank, random);

  if (random() < 0.5) {
    builder.turn('user', pick(templates.fillersShort, random).text);
    builder.turn('assistant', pick(templates.assistantsShort, random).text);
  }
  builder.turn('user', pick(templates.closers, random).text);
  builder.turn('assistant', pick(templates.assistantClosers, random).text);

  return builder.build('standard', [
    { factId: input.planting.factId, window: factWindow },
  ]);
}

/**
 * Generates one long session: built from {@link LONG_SESSION_WINDOWS} windows
 * of filler text, so the product's planner caps at
 * {@link CURATOR_WINDOW_LIMIT} windows and the clamp elides the middle.
 * Facts are planted at the head of their target windows, a sediment bait
 * rides window 1 and every window is filled with long filler pairs. The
 * finished session is checked against the REAL product clamp: a
 * middle-planted fact that survives it throws
 * {@link MiddleFactSurvivesClampError}.
 */
export function generateLongSeededSession(
  input: GenerateLongSessionInput,
): SeededSession {
  if (input.plantings.length < 2) {
    throw new Error(
      'a long session carries at least 2 seeded facts (design 3.1)',
    );
  }
  const seen = new Set<string>();
  for (const planting of input.plantings) {
    validatePlanting(planting);
    if (seen.has(planting.factId)) {
      throw new Error(
        `fact ${planting.factId} is planted twice in one long session; ` +
          'update values belong in separate dated sessions',
      );
    }
    seen.add(planting.factId);
  }
  const templates = assertUsableBank(input.bank, 'long');
  const earliest = [...input.plantings].sort((left, right) =>
    left.date < right.date ? -1 : left.date > right.date ? 1 : 0,
  )[0];
  // Placement-independent streams (finding 11): the opener, bait, fillers
  // and closers come from `contentRandom`, the fact templates from
  // `factRandom`, and neither seed carries the placement, so the head and
  // middle variants of the same plantings draw the same non-fact turns and
  // differ only in where the fact turns sit.
  const contentRandom = seededRandom(
    `${input.seed}:long:${earliest.factId}:${earliest.date}`,
  );
  const factRandom = seededRandom(
    `${input.seed}:long:${earliest.factId}:${earliest.date}:fact`,
  );

  const factWindows = new Map<string, number>();
  if (input.factPlacement === 'middle') {
    input.plantings.forEach((planting, index) => {
      factWindows.set(planting.factId, MIDDLE_FIRST_WINDOW + index);
    });
  } else {
    for (const planting of input.plantings) factWindows.set(planting.factId, 1);
  }

  const builder = new SessionJsonlWriter<BaitClass>(
    sessionIdOf(
      input.seed,
      `long:${earliest.factId}:${earliest.date}:${input.factPlacement}`,
    ),
    input.clock.sessionStartAt(earliest),
    MINUTES_PER_TURN_LONG,
    CURATOR_WINDOW_CHARS,
    CURATOR_WINDOW_LIMIT,
  );

  for (let window = 1; window <= LONG_SESSION_WINDOWS; window += 1) {
    if (window === 1) {
      builder.turn('user', pick(templates.openers, contentRandom).text);
      const bait = pick(baitsOf(input.bank, 'sediment'), contentRandom);
      builder.turn(
        'user',
        bait.text,
        [],
        [{ id: bait.id, baitClass: 'sediment' }],
      );
    }
    for (const planting of input.plantings) {
      if (factWindows.get(planting.factId) !== window) continue;
      builder.turn(
        'user',
        render(pick(templates.factUser, factRandom), planting.statement),
        [planting.factId],
      );
      builder.turn(
        'assistant',
        render(pick(templates.factAssistant, factRandom), planting.statement),
        [planting.factId],
      );
    }
    if (window === LONG_SESSION_WINDOWS) {
      builder.turn('user', pick(templates.closers, contentRandom).text);
      builder.turn(
        'assistant',
        pick(templates.assistantClosers, contentRandom).text,
      );
    }
    fillLongWindow(builder, templates, contentRandom);
  }

  const session = builder.build(
    'long',
    input.plantings.map((planting) => ({
      factId: planting.factId,
      window: factWindows.get(planting.factId) as number,
    })),
  );
  assertClampPlacement(session, input.plantings, input.factPlacement);
  return session;
}

/**
 * Fills one window with long filler pairs until the window's own filler text
 * reaches a full window budget. The target counts only filler characters —
 * the opener, bait and fact turns ride on top of the fill — so the head and
 * middle variants draw the same filler pairs for every window.
 */
function fillLongWindow(
  builder: SessionJsonlWriter<BaitClass>,
  templates: UsableTemplates,
  random: () => number,
): void {
  let fillerChars = 0;
  while (fillerChars < CURATOR_WINDOW_CHARS) {
    const user = pick(templates.fillersLong, random).text;
    const assistant = pick(templates.assistantsLong, random).text;
    builder.turn('user', user);
    builder.turn('assistant', assistant);
    fillerChars +=
      `USER: ${user}`.length +
      RECORD_SEPARATOR.length +
      `ASSISTANT: ${assistant}`.length;
  }
}

/**
 * The authoritative placement check, run on the finished session with the
 * product's own clamp: every middle-planted statement must fall inside the
 * span the clamp elides, and every head-planted statement must survive it
 * (a dropped head fact would silently break the head-recall baseline).
 */
function assertClampPlacement(
  session: SeededSession,
  plantings: readonly PlantedStatement[],
  factPlacement: 'middle' | 'head',
): void {
  const clamped = clampTranscript(
    session.transcript,
    CURATOR_WINDOW_CHARS * CURATOR_WINDOW_LIMIT,
  );
  if (factPlacement === 'head') {
    for (const planting of plantings) {
      if (!clamped.text.includes(planting.statement)) {
        throw new Error(
          `fact ${planting.factId} is planted in window 1 but the curator ` +
            'clamp dropped it; the head-recall baseline requires it kept',
        );
      }
    }
    return;
  }
  const cap = maxMiddlePlantings();
  if (plantings.length > cap) {
    throw new MiddleFactSurvivesClampError(
      `a long session plants at most ${cap} middle facts (only windows ` +
        `${MIDDLE_FIRST_WINDOW}..${MIDDLE_FIRST_WINDOW + cap - 1} sit inside ` +
        `the clamp's elided middle); got ${plantings.length}`,
    );
  }
  for (const planting of plantings) {
    if (clamped.text.includes(planting.statement)) {
      throw new MiddleFactSurvivesClampError(
        `fact ${planting.factId} in window ` +
          `${windowOfFact(session, planting.factId)} survives the curator ` +
          'clamp; middle-window recall would silently count it as recalled',
      );
    }
  }
}

function windowOfFact(session: SeededSession, factId: string): number {
  const entry = session.windowPlan.factWindows.find(
    (factWindow) => factWindow.factId === factId,
  );
  return entry === undefined ? 0 : entry.window;
}

/** Throws unless the planting is well-formed. */
function validatePlanting(planting: PlantedStatement): void {
  if (planting.factId.length === 0) {
    throw new Error('a planting needs a non-empty factId');
  }
  if (planting.statement.trim().length === 0) {
    throw new Error(`fact ${planting.factId} has an empty statement`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(planting.date)) {
    throw new Error(
      `fact ${planting.factId} date must be YYYY-MM-DD, got ${planting.date}`,
    );
  }
  // A real calendar date, round-trip compared like the fact schema's own
  // `isCalendarDate` (`label-schemas.ts:18-22`): V8 accepts 2026-02-31 and
  // silently rolls it to March 3, so parseability alone proves nothing.
  const iso = `${planting.date}T00:00:00.000Z`;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== iso) {
    throw new Error(
      `fact ${planting.factId} date must be a real calendar date, got ` +
        `${planting.date}`,
    );
  }
}

interface UsableTemplates {
  readonly openers: readonly TurnTemplateRecord[];
  readonly factUser: readonly TurnTemplateRecord[];
  readonly factAssistant: readonly TurnTemplateRecord[];
  readonly fillersShort: readonly TurnTemplateRecord[];
  readonly assistantsShort: readonly TurnTemplateRecord[];
  readonly fillersLong: readonly TurnTemplateRecord[];
  readonly assistantsLong: readonly TurnTemplateRecord[];
  readonly closers: readonly TurnTemplateRecord[];
  readonly assistantClosers: readonly TurnTemplateRecord[];
}

/**
 * Throws naming every missing piece, so a bad bank is a construction error
 * rather than a silently degraded session. A long session needs the long
 * filler slots; a standard session does not.
 */
function assertUsableBank(
  bank: readonly DistractorBankRecord[],
  kind: 'standard' | 'long',
): UsableTemplates {
  const templates = bank.filter(
    (record): record is TurnTemplateRecord => record.kind === 'turn-template',
  );
  const of = (slot: TemplateSlot, role: 'user' | 'assistant') =>
    templates.filter(
      (template) => template.slot === slot && template.role === role,
    );
  const required: [TemplateSlot, 'user' | 'assistant'][] = [
    ['opener', 'user'],
    ['fact', 'user'],
    ['fact', 'assistant'],
    ['filler-short', 'user'],
    ['filler-short', 'assistant'],
    ...(kind === 'long'
      ? ([
          ['filler-long', 'user'],
          ['filler-long', 'assistant'],
        ] as [TemplateSlot, 'user' | 'assistant'][])
      : []),
    ['closer', 'user'],
    ['closer', 'assistant'],
  ];
  const missing = required
    .filter(([slot, role]) => of(slot, role).length === 0)
    .map(([slot, role]) => `${slot}/${role}`);
  if (missing.length > 0) {
    throw new Error(
      `the distractor bank is missing turn templates: ${missing.join(', ')}`,
    );
  }
  for (const baitClass of [
    'sediment',
    'rejected-hypothesis',
    'corrected-claim',
  ] as const) {
    if (baitsOf(bank, baitClass).length === 0) {
      throw new Error(
        `the distractor bank is missing a ${baitClass} bait (>= 1 bait ` +
          'per session rotates through all three classes)',
      );
    }
  }
  return {
    openers: of('opener', 'user'),
    factUser: of('fact', 'user'),
    factAssistant: of('fact', 'assistant'),
    fillersShort: of('filler-short', 'user'),
    assistantsShort: of('filler-short', 'assistant'),
    fillersLong: of('filler-long', 'user'),
    assistantsLong: of('filler-long', 'assistant'),
    closers: of('closer', 'user'),
    assistantClosers: of('closer', 'assistant'),
  };
}

function baitsOf(
  bank: readonly DistractorBankRecord[],
  baitClass: BaitClass,
): readonly DistractorRecord[] {
  return bank.filter(
    (record): record is DistractorRecord =>
      record.kind === 'distractor' && record.baitClass === baitClass,
  );
}

/**
 * Emits one bait. Class a is a single user line; classes b and c state the
 * text on an assistant turn and rebut it on the immediately following user
 * turn — "stated and then rejected in-session" / "a claim the user corrects".
 */
function emitBait(
  builder: SessionJsonlWriter<BaitClass>,
  bank: readonly DistractorBankRecord[],
  random: () => number,
): void {
  const classes: BaitClass[] = [
    'sediment',
    'rejected-hypothesis',
    'corrected-claim',
  ];
  const baitClass = classes[Math.floor(random() * classes.length)];
  const bait = pick(baitsOf(bank, baitClass), random);
  if (baitClass === 'sediment') {
    builder.turn('user', bait.text, [], [{ id: bait.id, baitClass }]);
    return;
  }
  builder.turn('assistant', bait.text, [], [{ id: bait.id, baitClass }]);
  builder.turn(
    'user',
    bait.rebuttal as string,
    [],
    [{ id: bait.id, baitClass }],
  );
}

function render(template: TurnTemplateRecord, statement: string): string {
  return template.text.replaceAll('{statement}', statement);
}

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)];
}

/** `gen-` + 8 hex of the identity string: stable, seed-derived session id. */
function sessionIdOf(seed: string, identity: string): string {
  let state = 2166136261;
  for (const char of `${seed}:${identity}`) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return `gen-${(state >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * FNV-1a-seeded Mulberry32 — the Task 1.1 PRNG (`metrics/bootstrap.ts:76-90`),
 * kept in step by hand because that module keeps it private.
 */
function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
