/**
 * PtahCliStreamLoop — effectiveSessionId handling spec.
 *
 * Behavior under test (per identity-audit §3.2 / §4 fix):
 *   - `effectiveSessionId` starts as `null` rather than the empty-string
 *     sentinel `'' as SessionId`. The old sentinel masked malformed SDK
 *     `session_id` values and let them propagate.
 *   - On system-init with a valid UUID, the field becomes that SessionId
 *     and `onSessionResolved` fires.
 *   - On system-init with no `session_id`, the field stays `null` and
 *     `onSessionResolved` is NOT invoked.
 *   - On system-init with a non-UUID `session_id`, `SessionId.from()`
 *     throws — a contract violation should fail loudly, not be swallowed.
 *
 * Notes:
 *   - We probe the private `effectiveSessionId` field via a cast in tests.
 *     This is intentional: the field is the load-bearing invariant of this
 *     fix and there is no public getter.
 *   - The transformer dependency is stubbed; we never iterate a real SDK
 *     query, only the system-init branch of `run()`.
 */

import 'reflect-metadata';
import { SessionId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SdkMessageTransformer } from '../../sdk-message-transformer';
import type { SDKMessage } from '../../types/sdk-types/claude-sdk.types';
import { PtahCliStreamLoop } from './ptah-cli-stream-loop.service';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function createTransformerStub(): SdkMessageTransformer {
  const stub = {
    transform: jest.fn(() => []),
    createIsolated: jest.fn(),
  };
  stub.createIsolated.mockReturnValue(stub);
  return stub as unknown as SdkMessageTransformer;
}

function makeLoop(opts?: { onSessionResolved?: (sessionId: string) => void }): {
  loop: PtahCliStreamLoop;
  onSessionResolved: jest.Mock;
} {
  const onSessionResolved = jest.fn(opts?.onSessionResolved);
  const loop = new PtahCliStreamLoop({
    logger: createLogger(),
    messageTransformer: createTransformerStub(),
    emitOutput: jest.fn(),
    emitSegment: jest.fn(),
    emitStreamEvent: jest.fn(),
    agentName: 'test-agent',
    onSessionResolved,
  });
  return { loop, onSessionResolved };
}

function getEffectiveSessionId(loop: PtahCliStreamLoop): unknown {
  return (loop as unknown as { effectiveSessionId: unknown })
    .effectiveSessionId;
}

async function* singleMessage(msg: SDKMessage): AsyncIterable<SDKMessage> {
  yield msg;
}

// ---------------------------------------------------------------------------

describe('PtahCliStreamLoop.effectiveSessionId', () => {
  it('starts as null before any system-init message', () => {
    const { loop } = makeLoop();
    expect(getEffectiveSessionId(loop)).toBeNull();
  });

  it('receives a valid SessionId after a system-init with a UUID session_id', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      session_id: VALID_UUID,
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    await loop.run(singleMessage(initMsg));

    expect(getEffectiveSessionId(loop)).toBe(VALID_UUID);
    expect(SessionId.validate(getEffectiveSessionId(loop) as string)).toBe(
      true,
    );
    expect(onSessionResolved).toHaveBeenCalledWith(VALID_UUID);
  });

  it('stays null when system-init has no session_id', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      // session_id intentionally omitted
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    await loop.run(singleMessage(initMsg));

    expect(getEffectiveSessionId(loop)).toBeNull();
    expect(onSessionResolved).not.toHaveBeenCalled();
  });

  it('stays null when system-init session_id is explicitly undefined', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      session_id: undefined,
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    await loop.run(singleMessage(initMsg));

    expect(getEffectiveSessionId(loop)).toBeNull();
    expect(onSessionResolved).not.toHaveBeenCalled();
  });

  it('hard-fails (loop reports exit 1) when system-init session_id is a non-UUID string', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      session_id: 'tab_1778939573732_w43e75q', // the exact v0.2.32 regression class
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    // SessionId.from() throws inside the loop. The outer try-finally in run()
    // catches and returns exit code 1; that's the "fail loudly" contract —
    // the malformed id never silently becomes the empty-string sentinel.
    const exitCode = await loop.run(singleMessage(initMsg));

    expect(exitCode).toBe(1);
    expect(getEffectiveSessionId(loop)).toBeNull();
    expect(onSessionResolved).not.toHaveBeenCalled();
  });
});
