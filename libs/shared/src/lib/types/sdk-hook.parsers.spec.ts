/**
 * `parseSdkSubagentEndedPayload` — the optional `toolCallId` field.
 *
 * The whole-corpus equivalence proof against the Zod schemas lives in
 * `wire-parsers.equivalence.spec.ts`. This file covers the ONE field that
 * corpus does not reach, because its canonical payload does not carry the key:
 * the optional `toolCallId` that hands the `agentId` ↔ `toolCallId` pairing to
 * `BackgroundAgentStore`. Every case below asserts the parser AND
 * `SdkSubagentEndedPayloadSchema` agree, so the two definitions of the field
 * cannot drift apart (TASK_2026_376 R2, style finding 1).
 *
 * Coverage:
 *   - a payload WITHOUT the field parses, and the key is absent from the result
 *   - a payload WITH a non-empty field parses and keeps it
 *   - a blank or non-string field is DELIVERED with the field treated as absent
 *   - a present-but-`undefined` field parses, as `.optional()` would
 *   - the required fields still reject
 */

import { parseSdkSubagentEndedPayload } from './sdk-hook.parsers';
import { SdkSubagentEndedPayloadSchema } from './sdk-hook.schemas';

const BASE = {
  sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  cwd: 'D:/repo',
  agentId: 'adcecb2',
  agentType: 'software-architect',
  lastAssistantMessage: null,
  backgroundTasks: [],
  timestamp: 1_700_000_000_000,
};

/**
 * Asserts the hand-written parser and the Zod schema produce the SAME outcome
 * for one input: same accept/reject, same value, same key order.
 */
function expectSchemaAgreement(input: unknown): unknown {
  const parsed = parseSdkSubagentEndedPayload(input);
  const zod = SdkSubagentEndedPayloadSchema.safeParse(input);

  expect(`accepted=${parsed !== null}`).toBe(`accepted=${zod.success}`);
  if (!zod.success) return parsed;

  const zodData = zod.data as unknown as Record<string, unknown>;
  const parsedData = parsed as unknown as Record<string, unknown>;
  expect(parsedData).toStrictEqual(zodData);
  expect(Object.keys(parsedData).join(',')).toBe(
    Object.keys(zodData).join(','),
  );
  return parsed;
}

describe('parseSdkSubagentEndedPayload', () => {
  it('parses a payload without toolCallId and leaves the key absent', () => {
    const parsed = expectSchemaAgreement({ ...BASE });

    expect(parsed).not.toBeNull();
    expect(parsed).toStrictEqual({
      sessionId: BASE.sessionId,
      cwd: BASE.cwd,
      agentId: BASE.agentId,
      agentType: BASE.agentType,
      lastAssistantMessage: null,
      backgroundTasks: [],
      timestamp: BASE.timestamp,
    });
    expect('toolCallId' in (parsed as object)).toBe(false);
  });

  it('keeps a non-empty toolCallId', () => {
    const parsed = expectSchemaAgreement({
      ...BASE,
      toolCallId: 'toolu_abc',
    }) as { toolCallId?: string };

    expect(parsed.toolCallId).toBe('toolu_abc');
  });

  /**
   * The whole point of `.catch(undefined)`. `toolCallId` is a CORRELATION id,
   * not part of the terminal signal: rejecting the payload over it would stop
   * `handleSubagentEnded` from running at all, so no background agent of that
   * session would ever reach a terminal state — the exact defect F1 repaired.
   * A peer of a different version sending `toolCallId: ''` must not cause that.
   */
  it('delivers the payload when toolCallId is invalid, treating it as absent', () => {
    for (const bad of ['', 0, 1, true, false, null, [], {}, ['toolu_a'], NaN]) {
      const parsed = expectSchemaAgreement({ ...BASE, toolCallId: bad }) as {
        toolCallId?: string;
        agentId: string;
      } | null;

      expect(parsed).not.toBeNull();
      expect(parsed?.toolCallId).toBeUndefined();
      // The rest of the payload is intact, so the terminal signal still works.
      expect(parsed?.agentId).toBe(BASE.agentId);
    }
  });

  // `''` is never an id in this codebase: an invalid value is dropped, never
  // stored. Nothing downstream can key a store entry on a blank string.
  it('never publishes a blank toolCallId', () => {
    const parsed = parseSdkSubagentEndedPayload({ ...BASE, toolCallId: '' });

    expect(parsed?.toolCallId).not.toBe('');
    expect(parsed?.toolCallId).toBeUndefined();
  });

  // `z.string().min(1)` counts characters, it does not trim. The parser must
  // agree, or it is stricter than the schema it mirrors.
  it('accepts a whitespace toolCallId, exactly as `.min(1)` does', () => {
    const parsed = expectSchemaAgreement({ ...BASE, toolCallId: ' ' }) as {
      toolCallId?: string;
    };

    expect(parsed.toolCallId).toBe(' ');
  });

  it('accepts a present-but-undefined toolCallId, as `.optional()` does', () => {
    const parsed = expectSchemaAgreement({
      ...BASE,
      toolCallId: undefined,
    }) as { toolCallId?: string } | null;

    expect(parsed).not.toBeNull();
    expect(parsed?.toolCallId).toBeUndefined();
  });

  it('still rejects every malformed required field', () => {
    expect(expectSchemaAgreement({ ...BASE, sessionId: '' })).toBeNull();
    expect(expectSchemaAgreement({ ...BASE, cwd: '' })).toBeNull();
    expect(expectSchemaAgreement({ ...BASE, agentId: '' })).toBeNull();
    expect(expectSchemaAgreement({ ...BASE, agentType: '' })).toBeNull();
    expect(
      expectSchemaAgreement({ ...BASE, lastAssistantMessage: 1 }),
    ).toBeNull();
    expect(
      expectSchemaAgreement({ ...BASE, backgroundTasks: 'nope' }),
    ).toBeNull();
    expect(expectSchemaAgreement({ ...BASE, timestamp: -1 })).toBeNull();
    expect(expectSchemaAgreement(undefined)).toBeNull();
  });

  // A malformed REQUIRED field is still fatal even when the correlation id is
  // present and valid: `.catch(undefined)` widens exactly one key, not the
  // payload.
  it('still rejects a malformed required field alongside a valid toolCallId', () => {
    expect(
      expectSchemaAgreement({
        ...BASE,
        agentId: '',
        toolCallId: 'toolu_abc',
      }),
    ).toBeNull();
  });

  it('strips unknown keys and keeps a valid toolCallId', () => {
    const parsed = expectSchemaAgreement({
      ...BASE,
      unknownKey: 'ignored',
      toolCallId: 'toolu_abc',
    });

    expect(parsed).toStrictEqual({
      sessionId: BASE.sessionId,
      cwd: BASE.cwd,
      agentId: BASE.agentId,
      agentType: BASE.agentType,
      toolCallId: 'toolu_abc',
      lastAssistantMessage: null,
      backgroundTasks: [],
      timestamp: BASE.timestamp,
    });
  });
});
