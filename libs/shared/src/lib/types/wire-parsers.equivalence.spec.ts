/**
 * Equivalence proof: hand-written wire parsers ≡ their Zod schemas.
 *
 * TASK_2026_187 Unit 10 removed `zod` (304 kB) from the webview's initial
 * bundle by replacing six `.safeParse()` calls on the chat streaming path
 * with hand-written parsers. Those parsers guard a **trust boundary** —
 * inbound `postMessage` payloads from the extension host — so a parser that
 * is even slightly weaker than its schema silently widens that boundary.
 *
 * This suite exists so equivalence is *demonstrated, not asserted*. For each
 * schema/parser pair it enumerates a large corpus — a canonical valid
 * payload, then every field crossed with a battery of hostile values, every
 * field deleted, unknown keys added, and the whole payload replaced — and
 * asserts on every single input that:
 *
 *   1. the parser accepts exactly when the schema accepts;
 *   2. on acceptance the parsed value is strictly equal to `safeParse().data`,
 *      including keys whose value is `undefined` (hence `toStrictEqual`);
 *   3. the output key order matches Zod's;
 *   4. arrays Zod freezes via `.readonly()` come back frozen, and arrays it
 *      does not freeze come back unfrozen.
 *
 * The Zod schemas remain the source of truth. This file is the only place
 * both implementations meet; if you change one, this suite fails, which is
 * the intended and desired failure mode.
 */

import {
  AskUserQuestionRequestSchema,
  PermissionRequestSchema,
} from './permission.schemas';
import {
  parseAskUserQuestionRequest,
  parsePermissionRequest,
} from './permission.parsers';
import {
  SdkCompactionCompletePayloadSchema,
  SdkSubagentEndedPayloadSchema,
  SdkTurnEndedPayloadSchema,
  SdkTurnFailedPayloadSchema,
} from './sdk-hook.schemas';
import {
  parseSdkCompactionCompletePayload,
  parseSdkSubagentEndedPayload,
  parseSdkTurnEndedPayload,
  parseSdkTurnFailedPayload,
} from './sdk-hook.parsers';

// ---------------------------------------------------------------------------
// Corpus primitives
// ---------------------------------------------------------------------------

const UUID_V4 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const UUID_V4_UPPER = '3F2504E0-4F89-41D3-9A0C-0305E82C3301';
const UUID_V1 = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const UUID_NIL = '00000000-0000-0000-0000-000000000000';
const UUID_MAX_LOWER = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const UUID_MAX_UPPER = 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF';
const UUID_BAD_VERSION = '3f2504e0-4f89-91d3-9a0c-0305e82c3301';
const UUID_BAD_VARIANT = '3f2504e0-4f89-41d3-ca0c-0305e82c3301';

/**
 * Values thrown at every field of every payload. Deliberately includes the
 * numeric edges that separate `z.number()` from `typeof === 'number'`
 * (`NaN`, `±Infinity`) and `.int()` from `Number.isInteger` (`2 ** 53`), plus
 * the UUID variants that separate Zod's version-agnostic `.uuid()` from the
 * v4-only `UUID_REGEX`.
 */
const HOSTILE_VALUES: readonly unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  -0,
  1,
  -1,
  1.5,
  NaN,
  Infinity,
  -Infinity,
  2 ** 53,
  2 ** 53 - 1,
  Number.MAX_SAFE_INTEGER,
  '',
  ' ',
  'x',
  'manual',
  'auto',
  'completed',
  'unknown',
  'AskUserQuestion',
  UUID_V4,
  UUID_V4_UPPER,
  UUID_V1,
  UUID_NIL,
  UUID_MAX_LOWER,
  UUID_MAX_UPPER,
  UUID_BAD_VERSION,
  UUID_BAD_VARIANT,
  'not-a-uuid',
  [],
  ['a'],
  [{}],
  {},
  { a: 1 },
  { id: 'x', type: 'y', status: 'z', description: 'd' },
  new Date(0),
  () => undefined,
  // Exotic object shapes. These matter because `z.record(...)` applies a
  // strict plain-object test that `z.object(...)` does not, and a
  // structured-clone transport (Electron IPC) really can deliver a Date or a
  // Map where a plain record is expected.
  new Map(),
  new Set(),
  new WeakMap(),
  new Error('boom'),
  /regex/,
  new Uint8Array(2),
  new ArrayBuffer(2),
  Object.create(null),
  Object.create({ inherited: 1 }),
  Object.create(Object.create(null)),
  Object.create(Array.prototype),
  new (class Custom {
    public a = 1;
  })(),
  { a: 1, [Symbol.toStringTag]: 'Weird' },
  {
    a: 1,
    [Symbol.iterator]: function* (): Generator<number> {
      yield 1;
    },
  },
];

interface SchemaLike<T> {
  safeParse(input: unknown): { success: boolean; data?: T };
}

/**
 * The single assertion used everywhere. Any divergence between the two
 * implementations fails here, with the offending input in the message.
 */
function assertAgree<T>(
  label: string,
  schema: SchemaLike<T>,
  parser: (input: unknown) => unknown,
  input: unknown,
  frozenArrayKeys: readonly string[] = [],
): void {
  const context = `${label} :: ${safeLabel(input)}`;
  const parsed = parser(input);

  let zodResult: { success: boolean; data?: T };
  try {
    zodResult = schema.safeParse(input);
  } catch {
    // KNOWN DIVERGENCE, parser is the stricter side.
    //
    // `z.array(...).readonly().safeParse(new Uint8Array(2))` throws a
    // TypeError out of `safeParse` instead of returning `{success:false}` —
    // Zod applies `Object.freeze` to the input before the array check
    // rejects it, and V8 refuses to freeze a non-empty array-buffer view.
    // (Empty typed arrays reject normally; only non-empty ones throw.)
    //
    // On the streaming path the call site has no try/catch, so today that
    // would propagate out of the message handler rather than dropping one
    // message. The hand-written parser has no such failure mode: it rejects.
    // We assert exactly that, so the parser can never become the weaker side.
    expect(
      `${context} parser-rejected-where-zod-threw=${parsed === null}`,
    ).toBe(`${context} parser-rejected-where-zod-threw=true`);
    return;
  }

  // 1. accept/reject must agree
  expect(`${context} accepted=${parsed !== null}`).toBe(
    `${context} accepted=${zodResult.success}`,
  );

  if (!zodResult.success) return;

  const zodData = zodResult.data as Record<string, unknown>;
  const parsedData = parsed as Record<string, unknown>;

  // 2. value must be strictly equal (undefined-valued keys included)
  expect(parsedData).toStrictEqual(zodData);

  // 3. key order must match
  expect(`${context} keys=${Object.keys(parsedData).join(',')}`).toBe(
    `${context} keys=${Object.keys(zodData).join(',')}`,
  );

  // 4. freeze semantics must match
  for (const key of frozenArrayKeys) {
    expect(`${context} ${key} frozen=${Object.isFrozen(parsedData[key])}`).toBe(
      `${context} ${key} frozen=${Object.isFrozen(zodData[key])}`,
    );
  }
}

function safeLabel(input: unknown): string {
  if (typeof input === 'function') return '<function>';
  try {
    return JSON.stringify(input) ?? String(input);
  } catch {
    return String(input);
  }
}

/**
 * Builds the full corpus for one canonical payload: the payload itself, each
 * field replaced by each hostile value, each field deleted, unknown keys
 * added, and non-object inputs.
 */
function buildCorpus(base: Record<string, unknown>): unknown[] {
  const corpus: unknown[] = [base, { ...base, unknownKey: 'ignored' }];
  corpus.push(...HOSTILE_VALUES);

  for (const key of Object.keys(base)) {
    for (const hostile of HOSTILE_VALUES) {
      corpus.push({ ...base, [key]: hostile });
    }
    const without = { ...base };
    delete without[key];
    corpus.push(without);
  }
  return corpus;
}

function runCorpus<T>(
  label: string,
  schema: SchemaLike<T>,
  parser: (input: unknown) => unknown,
  base: Record<string, unknown>,
  frozenArrayKeys: readonly string[] = [],
  extraInputs: readonly unknown[] = [],
): void {
  const corpus = [...buildCorpus(base), ...extraInputs];
  it(`${label}: agrees with its schema on ${corpus.length} inputs`, () => {
    for (const input of corpus) {
      assertAgree(label, schema, parser, input, frozenArrayKeys);
    }
  });

  it(`${label}: corpus actually exercises both outcomes`, () => {
    // Guards against a corpus that trivially passes because every input is
    // rejected (or every input accepted) by both implementations.
    const accepted = corpus.filter((i) => {
      try {
        return schema.safeParse(i).success;
      } catch {
        return false;
      }
    }).length;
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(corpus.length);
  });
}

// ---------------------------------------------------------------------------
// Canonical payloads
// ---------------------------------------------------------------------------

const BACKGROUND_TASK = {
  id: 'task-1',
  type: 'bash',
  status: 'running',
  description: 'build',
  command: 'npm run build',
};

const SESSION_CRON = {
  id: 'cron-1',
  schedule: '0 * * * *',
  recurring: true,
  prompt: 'check',
};

const COMPACTION_COMPLETE = {
  sessionId: UUID_V4,
  cwd: 'D:/repo',
  trigger: 'manual',
  compactSummary: '',
  timestamp: 0,
};

const TURN_ENDED = {
  sessionId: UUID_V4,
  cwd: 'D:/repo',
  lastAssistantMessage: null,
  backgroundTasks: [BACKGROUND_TASK],
  sessionCrons: [SESSION_CRON],
  terminalReason: 'completed',
  timestamp: 1,
};

const TURN_FAILED = {
  sessionId: UUID_V4,
  cwd: 'D:/repo',
  lastAssistantMessage: 'partial',
  error: 'rate_limit',
  errorDetails: null,
  terminalReason: null,
  timestamp: 2,
};

const SUBAGENT_ENDED = {
  sessionId: UUID_V4,
  cwd: 'D:/repo',
  agentId: 'agent-1',
  agentType: 'Explore',
  lastAssistantMessage: null,
  backgroundTasks: [],
  timestamp: 3,
};

const PERMISSION_REQUEST = {
  id: UUID_V4,
  toolName: 'Bash',
  toolInput: { command: 'ls' },
  toolUseId: 'tu-1',
  agentToolCallId: 'ac-1',
  timestamp: 1000,
  description: 'run ls',
  timeoutAt: 2000,
  sessionId: UUID_V4,
  tabId: UUID_V4,
  surfaceMode: false,
};

const ASK_USER_QUESTION = {
  id: UUID_V4,
  toolName: 'AskUserQuestion',
  questions: [{ id: 'q1' }],
  toolUseId: 'tu-2',
  timestamp: 1000,
  timeoutAt: 2000,
  sessionId: UUID_V4,
  tabId: UUID_V4,
  surfaceMode: true,
};

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('wire parser ≡ Zod schema equivalence', () => {
  describe('SdkCompactionCompletePayload', () => {
    runCorpus(
      'SdkCompactionCompletePayload',
      SdkCompactionCompletePayloadSchema,
      parseSdkCompactionCompletePayload,
      COMPACTION_COMPLETE,
      [],
      [
        { ...COMPACTION_COMPLETE, trigger: 'auto' },
        { ...COMPACTION_COMPLETE, sessionId: 'not-a-uuid-but-non-empty' },
        { ...COMPACTION_COMPLETE, timestamp: Number.MAX_SAFE_INTEGER },
      ],
    );
  });

  describe('SdkTurnEndedPayload', () => {
    runCorpus(
      'SdkTurnEndedPayload',
      SdkTurnEndedPayloadSchema,
      parseSdkTurnEndedPayload,
      TURN_ENDED,
      ['backgroundTasks', 'sessionCrons'],
      [
        // nested element mutations — the array parser must reject the whole
        // payload exactly when the schema does
        ...HOSTILE_VALUES.map((h) => ({
          ...TURN_ENDED,
          backgroundTasks: [{ ...BACKGROUND_TASK, id: h }],
        })),
        ...HOSTILE_VALUES.map((h) => ({
          ...TURN_ENDED,
          backgroundTasks: [{ ...BACKGROUND_TASK, command: h }],
        })),
        ...HOSTILE_VALUES.map((h) => ({
          ...TURN_ENDED,
          sessionCrons: [{ ...SESSION_CRON, recurring: h }],
        })),
        // unknown keys inside array elements must be stripped identically
        {
          ...TURN_ENDED,
          backgroundTasks: [{ ...BACKGROUND_TASK, sneaky: 'drop me' }],
        },
        // optional `command` absent vs explicitly undefined
        {
          ...TURN_ENDED,
          backgroundTasks: [
            {
              id: 'a',
              type: 'b',
              status: 'c',
              description: 'd',
            },
          ],
        },
        {
          ...TURN_ENDED,
          backgroundTasks: [{ ...BACKGROUND_TASK, command: undefined }],
        },
        { ...TURN_ENDED, backgroundTasks: [], sessionCrons: [] },
        { ...TURN_ENDED, terminalReason: null },
      ],
    );
  });

  describe('SdkTurnFailedPayload', () => {
    runCorpus(
      'SdkTurnFailedPayload',
      SdkTurnFailedPayloadSchema,
      parseSdkTurnFailedPayload,
      TURN_FAILED,
      [],
      [
        { ...TURN_FAILED, error: 'authentication_failed' },
        { ...TURN_FAILED, error: 'max_output_tokens' },
        { ...TURN_FAILED, terminalReason: 'hook_stopped' },
        { ...TURN_FAILED, errorDetails: 'boom' },
      ],
    );
  });

  describe('SdkSubagentEndedPayload', () => {
    runCorpus(
      'SdkSubagentEndedPayload',
      SdkSubagentEndedPayloadSchema,
      parseSdkSubagentEndedPayload,
      SUBAGENT_ENDED,
      ['backgroundTasks'],
      [
        { ...SUBAGENT_ENDED, backgroundTasks: [BACKGROUND_TASK] },
        { ...SUBAGENT_ENDED, lastAssistantMessage: 'done' },
      ],
    );
  });

  describe('PermissionRequest', () => {
    runCorpus(
      'PermissionRequest',
      PermissionRequestSchema,
      parsePermissionRequest,
      PERMISSION_REQUEST,
      [],
      [
        // `id` takes any UUID version; `sessionId`/`tabId` take v4 only.
        // These four inputs are the ones that catch a parser that uses the
        // same check for both.
        { ...PERMISSION_REQUEST, id: UUID_V1 },
        { ...PERMISSION_REQUEST, id: UUID_NIL },
        { ...PERMISSION_REQUEST, sessionId: UUID_V1 },
        { ...PERMISSION_REQUEST, tabId: UUID_NIL },
        { ...PERMISSION_REQUEST, id: UUID_MAX_LOWER },
        { ...PERMISSION_REQUEST, id: UUID_MAX_UPPER },
        { ...PERMISSION_REQUEST, sessionId: UUID_V4_UPPER },
        // optional keys: absent vs present-with-undefined
        { ...PERMISSION_REQUEST, toolUseId: undefined },
        { ...PERMISSION_REQUEST, agentToolCallId: undefined },
        { ...PERMISSION_REQUEST, surfaceMode: undefined },
        // toolInput is a record: any value type, arrays rejected
        { ...PERMISSION_REQUEST, toolInput: {} },
        { ...PERMISSION_REQUEST, toolInput: { a: undefined } },
        { ...PERMISSION_REQUEST, toolInput: { nested: { deep: [1, 2] } } },
        // plain z.number() — non-integers are fine here, unlike timestamps
        { ...PERMISSION_REQUEST, timestamp: 1.5, timeoutAt: -1 },
        { ...PERMISSION_REQUEST, timestamp: 2 ** 53 },
      ],
    );
  });

  describe('AskUserQuestionRequest', () => {
    runCorpus(
      'AskUserQuestionRequest',
      AskUserQuestionRequestSchema,
      parseAskUserQuestionRequest,
      ASK_USER_QUESTION,
      [],
      [
        { ...ASK_USER_QUESTION, questions: [] },
        { ...ASK_USER_QUESTION, questions: [1, 'two', null, undefined, {}] },
        { ...ASK_USER_QUESTION, toolName: 'SomethingElse' },
        { ...ASK_USER_QUESTION, toolUseId: undefined },
        { ...ASK_USER_QUESTION, id: UUID_V1 },
        { ...ASK_USER_QUESTION, sessionId: UUID_V1 },
      ],
    );
  });

  it('questions array is copied, not aliased, and is not frozen', () => {
    const input = { ...ASK_USER_QUESTION, questions: [{ id: 'q1' }] };
    const zodData = AskUserQuestionRequestSchema.safeParse(input);
    const parsed = parseAskUserQuestionRequest(input);
    expect(zodData.success).toBe(true);
    expect(parsed).not.toBeNull();
    const parsedQuestions = (parsed as { questions: unknown[] }).questions;
    expect(parsedQuestions).not.toBe(input.questions);
    expect(Object.isFrozen(parsedQuestions)).toBe(false);
    expect(
      Object.isFrozen(
        (zodData.data as unknown as { questions: unknown[] }).questions,
      ),
    ).toBe(false);
  });

  it('rejects a payload whose prototype carries the required fields', () => {
    // Own-property semantics: inherited fields must not satisfy the schema.
    const proto = { sessionId: UUID_V4, cwd: 'D:/repo' };
    const input = Object.create(proto) as Record<string, unknown>;
    input['trigger'] = 'manual';
    input['compactSummary'] = '';
    input['timestamp'] = 0;
    assertAgree(
      'prototype-carried fields',
      SdkCompactionCompletePayloadSchema,
      parseSdkCompactionCompletePayload,
      input,
    );
  });
});
