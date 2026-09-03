/**
 * `parseSdkSubagentEndedPayload` — the optional `toolCallId` field.
 *
 * The whole-corpus equivalence proof against the Zod schemas lives in
 * `wire-parsers.equivalence.spec.ts`. This file pins the ONE key on which the
 * parser deliberately goes beyond `SdkSubagentEndedPayloadSchema`: the optional
 * `toolCallId` that carries the `agentId` ↔ `toolCallId` pairing to
 * `BackgroundAgentStore`.
 *
 * Coverage:
 *   - a payload WITHOUT the field parses, and the key is absent from the result
 *   - a payload WITH a non-empty field parses and keeps it
 *   - a blank or non-string field is rejected, as `z.string().min(1)` would
 *   - a present-but-`undefined` field parses, as `.optional()` would
 *   - the required fields still reject exactly as before
 */

import { parseSdkSubagentEndedPayload } from './sdk-hook.parsers';

const BASE = {
  sessionId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  cwd: 'D:/repo',
  agentId: 'adcecb2',
  agentType: 'software-architect',
  lastAssistantMessage: null,
  backgroundTasks: [],
  timestamp: 1_700_000_000_000,
};

describe('parseSdkSubagentEndedPayload', () => {
  it('parses a payload without toolCallId and leaves the key absent', () => {
    const parsed = parseSdkSubagentEndedPayload({ ...BASE });

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
    const parsed = parseSdkSubagentEndedPayload({
      ...BASE,
      toolCallId: 'toolu_abc',
    });

    expect(parsed?.toolCallId).toBe('toolu_abc');
  });

  it('rejects an empty or non-string toolCallId', () => {
    for (const bad of ['', 0, 1, true, false, null, [], {}, ['toolu_a']]) {
      expect(
        parseSdkSubagentEndedPayload({ ...BASE, toolCallId: bad }),
      ).toBeNull();
    }
  });

  // `z.string().min(1)` counts characters, it does not trim. The parser must
  // agree, or it is stricter than the schema it mirrors.
  it('accepts a whitespace toolCallId, exactly as `.min(1)` does', () => {
    expect(
      parseSdkSubagentEndedPayload({ ...BASE, toolCallId: ' ' })?.toolCallId,
    ).toBe(' ');
  });

  it('accepts a present-but-undefined toolCallId, as `.optional()` does', () => {
    const parsed = parseSdkSubagentEndedPayload({
      ...BASE,
      toolCallId: undefined,
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.toolCallId).toBeUndefined();
  });

  it('still rejects every malformed required field', () => {
    expect(parseSdkSubagentEndedPayload({ ...BASE, sessionId: '' })).toBeNull();
    expect(parseSdkSubagentEndedPayload({ ...BASE, cwd: '' })).toBeNull();
    expect(parseSdkSubagentEndedPayload({ ...BASE, agentId: '' })).toBeNull();
    expect(parseSdkSubagentEndedPayload({ ...BASE, agentType: '' })).toBeNull();
    expect(
      parseSdkSubagentEndedPayload({ ...BASE, lastAssistantMessage: 1 }),
    ).toBeNull();
    expect(
      parseSdkSubagentEndedPayload({ ...BASE, backgroundTasks: 'nope' }),
    ).toBeNull();
    expect(parseSdkSubagentEndedPayload({ ...BASE, timestamp: -1 })).toBeNull();
    expect(parseSdkSubagentEndedPayload(undefined)).toBeNull();
  });

  it('strips unknown keys and keeps a valid toolCallId', () => {
    const parsed = parseSdkSubagentEndedPayload({
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
