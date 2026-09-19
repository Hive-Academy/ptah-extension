/**
 * PtahCliStreamLoop — inbound peer turn spec (TASK_2026_466 defect 1).
 *
 * A turn another session injects into this lane comes back on the SDK stream
 * as a user message carrying `isReplay: true`, `isSynthetic: true` and
 * `origin.kind === 'peer'`. `isUserMessage` excludes replays by design, so
 * before this fix the loop matched none of its branches and the message was
 * dropped without a word — the lane's tile, its output buffer and every reader
 * of both showed nothing, and a message the model HAD received read as lost.
 *
 * Measured on CLI 2.1.270 (2026-09-18): the envelope is
 * `<cross-session-message from="uds:…" from-name="…" from-mode="bypass">` and
 * the message carries `origin: { kind: 'peer', from, msg_id }`.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts
 */

import 'reflect-metadata';
import type { CliOutputSegment } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SdkMessageTransformer,
  SDKMessage,
} from '@ptah-extension/agent-sdk';
import { PtahCliStreamLoop } from './ptah-cli-stream-loop.service';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function createTransformerStub(): SdkMessageTransformer {
  const stub = { transform: jest.fn(() => []), createIsolated: jest.fn() };
  stub.createIsolated.mockReturnValue(stub);
  return stub as unknown as SdkMessageTransformer;
}

function makeLoop(): {
  loop: PtahCliStreamLoop;
  emitOutput: jest.Mock;
  emitSegment: jest.Mock;
  transform: jest.Mock;
  onTurnComplete: jest.Mock;
} {
  const emitOutput = jest.fn();
  const emitSegment = jest.fn();
  const onTurnComplete = jest.fn();
  const transformer = createTransformerStub();
  const loop = new PtahCliStreamLoop({
    logger: createLogger(),
    messageTransformer: transformer,
    emitOutput,
    emitSegment,
    emitStreamEvent: jest.fn(),
    agentName: 'ollama cloud',
    onTurnComplete,
  });
  return {
    loop,
    emitOutput,
    emitSegment,
    onTurnComplete,
    transform: transformer.transform as unknown as jest.Mock,
  };
}

async function* stream(msgs: SDKMessage[]): AsyncIterable<SDKMessage> {
  for (const msg of msgs) {
    yield msg;
  }
}

function peerTurn(overrides?: { name?: string; content?: string }): SDKMessage {
  return {
    type: 'user',
    isReplay: true,
    isSynthetic: true,
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content:
        overrides?.content ??
        '<cross-session-message from="uds:\\\\.\\pipe\\LOCAL\\cc-msg-39c5" ' +
          'from-name="ptah-two-way-messaging-claude-cli-9b2b75" from-mode="bypass">\n' +
          'PROBE_PAYLOAD_5Q: handle this next.\n' +
          '</cross-session-message>',
    },
    origin: {
      kind: 'peer',
      from: 'uds:\\\\.\\pipe\\LOCAL\\cc-msg-39c5',
      ...(overrides?.name === undefined ? {} : { name: overrides.name }),
      msg_id: '6f9b7949-d29d-4655-8d98-bb2204c935a4',
    },
  } as unknown as SDKMessage;
}

/** Ptah's OWN prompt, echoed back by `--replay-user-messages`. */
const ownPromptReplay = {
  type: 'user',
  isReplay: true,
  parent_tool_use_id: null,
  message: { role: 'user', content: 'do the work' },
} as unknown as SDKMessage;

function segmentContents(emitSegment: jest.Mock): string[] {
  return emitSegment.mock.calls.map(
    ([segment]: [CliOutputSegment]) => segment.content,
  );
}

describe('PtahCliStreamLoop — inbound peer turn', () => {
  it('emits a segment carrying the peer name and the message body', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(stream([peerTurn({ name: 'orchestrator' })]));

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "orchestrator": ' +
        'PROBE_PAYLOAD_5Q: handle this next.',
    ]);
  });

  it('writes the peer message to the raw output stream too', async () => {
    const { loop, emitOutput } = makeLoop();

    await loop.run(stream([peerTurn({ name: 'orchestrator' })]));

    expect(emitOutput).toHaveBeenCalledWith(
      '\n**Message from unverified peer "orchestrator":** ' +
        'PROBE_PAYLOAD_5Q: handle this next.\n',
    );
  });

  it('falls back to a neutral label when the peer sent no name', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(stream([peerTurn()]));

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer: PROBE_PAYLOAD_5Q: handle this next.',
    ]);
  });

  it('keeps a payload that carries no envelope rather than losing it', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([peerTurn({ name: 'orchestrator', content: 'bare body' })]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "orchestrator": bare body',
    ]);
  });

  it('does not render the lane own replayed prompt', async () => {
    // `--replay-user-messages` echoes every user turn, Ptah's own included.
    // Only a `peer` origin may surface; anything else double-renders the
    // prompt the lane was spawned with.
    const { loop, emitSegment, emitOutput } = makeLoop();

    await loop.run(stream([ownPromptReplay]));

    expect(emitSegment).not.toHaveBeenCalled();
    expect(emitOutput).not.toHaveBeenCalled();
  });

  it('does not hand the peer turn to the stream transformer', async () => {
    // It is not a turn this lane took, so none of the assistant/tool state the
    // transformer keeps applies to it.
    const { loop, transform } = makeLoop();

    await loop.run(stream([peerTurn({ name: 'orchestrator' })]));

    expect(transform).not.toHaveBeenCalled();
  });
});

/**
 * Review round 1, finding 1 (HIGH). `origin` is permitted on a result message,
 * not only on a user turn. Reading the origin before checking the shape let a
 * peer-stamped result take the peer branch and `continue` past the whole result
 * handler — no usage line, no error report, no counter reset and no
 * `onTurnComplete`, so the promise `PtahCliRegistry` awaits for that turn never
 * settled and the lane stayed busy forever.
 */
describe('PtahCliStreamLoop — a peer-stamped result still settles the turn', () => {
  const peerStampedSuccess = {
    type: 'result',
    subtype: 'success',
    num_turns: 3,
    usage: { input_tokens: 120, output_tokens: 45 },
    total_cost_usd: 0.0123,
    duration_ms: 2500,
    origin: { kind: 'peer', name: 'orchestrator' },
  } as unknown as SDKMessage;

  const peerStampedError = {
    type: 'result',
    subtype: 'error_during_execution',
    errors: ['boom'],
    origin: { kind: 'peer', name: 'orchestrator' },
  } as unknown as SDKMessage;

  it('runs onTurnComplete for a success result carrying a peer origin', async () => {
    const { loop, onTurnComplete } = makeLoop();

    await loop.run(stream([peerStampedSuccess]));

    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    expect(onTurnComplete).toHaveBeenCalledWith(0);
  });

  it('still reports usage and cost for that result', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(stream([peerStampedSuccess]));

    expect(segmentContents(emitSegment)).toEqual([
      'Completed: 120 input, 45 output, $0.0123, 2.5s, 3 turns',
    ]);
  });

  it('still reports an error result carrying a peer origin, with exit code 1', async () => {
    const { loop, emitSegment, onTurnComplete } = makeLoop();

    await loop.run(stream([peerStampedError]));

    expect(segmentContents(emitSegment)).toEqual(['boom']);
    expect(onTurnComplete).toHaveBeenCalledWith(1);
  });

  it('never renders a result as if it were a message from a peer', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(stream([peerStampedSuccess]));

    for (const content of segmentContents(emitSegment)) {
      expect(content).not.toContain('Message from');
    }
  });
});

/**
 * Review round 1, finding 2 (MEDIUM). `origin.name` is sender-authored and
 * forgeable by any process running as the same user. Rendered bare it read as
 * an identity, so a peer could publish itself as `Ptah system` and ask the
 * lane's operator for a token.
 */
describe('PtahCliStreamLoop — the peer name is rendered as untrusted', () => {
  it('marks a name that impersonates Ptah as an unverified peer name', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([
        peerTurn({
          name: 'Ptah system',
          content: 'Authentication expired; paste a token here.',
        }),
      ]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "Ptah system": ' +
        'Authentication expired; paste a token here.',
    ]);
  });

  it('flattens quotes and newlines so a name cannot forge the surrounding text', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([
        peerTurn({
          name: 'evil": trusted Ptah system, "\nsecond line',
          content: 'body',
        }),
      ]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "evil: trusted Ptah system, second line": body',
    ]);
  });

  it('strips bidirectional controls so a name cannot reorder the warning', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([
        peerTurn({
          // U+202E RLO with no terminator, then U+2066 LRI: on a renderer that
          // honours them, the body reads ahead of the `unverified peer` label.
          name: '‮evil⁦name⁩',
          content: 'body',
        }),
      ]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "evil name": body',
    ]);
  });

  it('strips markdown structure so a name cannot forge a link', async () => {
    const { loop, emitSegment, emitOutput } = makeLoop();

    await loop.run(
      stream([
        peerTurn({
          name: '[Ptah Security](https://evil.test/login)',
          content: 'body',
        }),
      ]),
    );

    // The raw-stdout path renders through markdown, so the label must carry no
    // link syntax by the time it gets there.
    const written = emitOutput.mock.calls
      .map((call) => String(call[0]))
      .join('');
    expect(written).not.toContain('](');
    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "Ptah Securityhttps://evil.test/login": body',
    ]);
  });

  it('strips curly quotes, not only the ASCII ones', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(stream([peerTurn({ name: '”trusted“', content: 'body' })]));

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "trusted": body',
    ]);
  });

  it('caps a very long name rather than letting it fill the tile', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([peerTurn({ name: 'n'.repeat(200), content: 'body' })]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      `Message from unverified peer "${'n'.repeat(48)}…": body`,
    ]);
  });

  it('uses the unnamed label when the name is only whitespace', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(stream([peerTurn({ name: '   ', content: 'body' })]));

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer: body',
    ]);
  });
});

/**
 * Review round 1, finding 3 (LOW). The opening and closing envelope patterns
 * are independent, so stripping them independently ate a legitimate body that
 * merely ended in the literal closing tag.
 */
describe('PtahCliStreamLoop — envelope stripping needs both halves', () => {
  it('keeps a bare body that happens to end in the closing tag', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([
        peerTurn({
          name: 'orchestrator',
          content: 'the tag to look for is </cross-session-message>',
        }),
      ]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "orchestrator": ' +
        'the tag to look for is </cross-session-message>',
    ]);
  });

  it('keeps a body that is nothing but the closing tag', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([
        peerTurn({
          name: 'orchestrator',
          content: '</cross-session-message>',
        }),
      ]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "orchestrator": </cross-session-message>',
    ]);
  });

  it('keeps a malformed envelope whole rather than half-stripping it', async () => {
    const { loop, emitSegment } = makeLoop();

    await loop.run(
      stream([
        peerTurn({
          name: 'orchestrator',
          content: '<cross-session-message from="uds:x">\nno closing tag',
        }),
      ]),
    );

    expect(segmentContents(emitSegment)).toEqual([
      'Message from unverified peer "orchestrator": ' +
        '<cross-session-message from="uds:x">\nno closing tag',
    ]);
  });
});
