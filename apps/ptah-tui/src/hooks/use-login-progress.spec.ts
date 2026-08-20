import { EventEmitter } from 'node:events';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  AuthDeviceCodePayload,
  AuthLoginOutputPayload,
} from '@ptah-extension/shared';

import {
  MAX_LOGIN_OUTPUT_LINES,
  appendLoginOutput,
  mergeDeviceCode,
} from './use-login-progress.js';

/**
 * `useLoginProgress` is a thin `useState`/`useEffect` wrapper over two pure
 * folds; there is no React renderer in this workspace, so we exercise the
 * folds directly plus the subscribe → fold → unsubscribe contract against a
 * bare EventEmitter — exactly how the hook drives the push adapter. Same
 * posture as `use-push-events.spec.ts`.
 */

const COPILOT = 'github-copilot';
const CODEX = 'openai-codex';

describe('mergeDeviceCode', () => {
  it('captures a full device-code event', () => {
    const next = mergeDeviceCode(
      null,
      {
        provider: COPILOT,
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresInSeconds: 900,
      },
      COPILOT,
    );

    expect(next).toEqual({
      provider: COPILOT,
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresInSeconds: 900,
    });
  });

  it('merges a URL-only event with a previously captured code (CLIs print them on separate lines)', () => {
    const first = mergeDeviceCode(
      null,
      { provider: CODEX, userCode: 'WXYZ-9876' },
      CODEX,
    );
    const second = mergeDeviceCode(
      first,
      { provider: CODEX, verificationUri: 'https://auth.openai.com/device' },
      CODEX,
    );

    expect(second?.userCode).toBe('WXYZ-9876');
    expect(second?.verificationUri).toBe('https://auth.openai.com/device');
  });

  it('ignores events for a different provider', () => {
    const prev: AuthDeviceCodePayload = {
      provider: COPILOT,
      userCode: 'ABCD-1234',
    };
    const next = mergeDeviceCode(
      prev,
      { provider: CODEX, userCode: 'NOPE-0000' },
      COPILOT,
    );

    expect(next).toBe(prev);
  });

  it('ignores a malformed payload without throwing', () => {
    expect(mergeDeviceCode(null, undefined, COPILOT)).toBeNull();
  });
});

describe('appendLoginOutput', () => {
  it('appends matching lines in arrival order', () => {
    let lines: readonly string[] = [];
    lines = appendLoginOutput(
      lines,
      { provider: CODEX, stream: 'stdout', line: 'first' },
      CODEX,
    );
    lines = appendLoginOutput(
      lines,
      { provider: CODEX, stream: 'stderr', line: 'second' },
      CODEX,
    );

    expect(lines).toEqual(['first', 'second']);
  });

  it('caps the retained tail so a chatty command cannot flood the frame', () => {
    let lines: readonly string[] = [];
    for (let i = 0; i < MAX_LOGIN_OUTPUT_LINES + 5; i += 1) {
      lines = appendLoginOutput(
        lines,
        { provider: CODEX, stream: 'stdout', line: `line-${i}` },
        CODEX,
      );
    }

    expect(lines).toHaveLength(MAX_LOGIN_OUTPUT_LINES);
    expect(lines[lines.length - 1]).toBe(`line-${MAX_LOGIN_OUTPUT_LINES + 4}`);
    expect(lines[0]).toBe('line-5');
  });

  it('ignores lines for a different provider', () => {
    const prev: readonly string[] = ['keep'];
    const next = appendLoginOutput(
      prev,
      { provider: COPILOT, stream: 'stdout', line: 'drop' },
      CODEX,
    );

    expect(next).toBe(prev);
  });
});

describe('push-adapter subscription contract', () => {
  it('folds both event types off one adapter and unsubscribes cleanly', () => {
    const adapter = new EventEmitter();
    const state = {
      deviceCode: null as AuthDeviceCodePayload | null,
      output: [] as readonly string[],
    };

    const onDeviceCode = (payload: unknown): void => {
      state.deviceCode = mergeDeviceCode(
        state.deviceCode,
        payload as AuthDeviceCodePayload,
        COPILOT,
      );
    };
    const onOutput = (payload: unknown): void => {
      state.output = appendLoginOutput(
        state.output,
        payload as AuthLoginOutputPayload,
        COPILOT,
      );
    };

    adapter.on(MESSAGE_TYPES.AUTH_DEVICE_CODE, onDeviceCode);
    adapter.on(MESSAGE_TYPES.AUTH_LOGIN_OUTPUT, onOutput);

    adapter.emit(MESSAGE_TYPES.AUTH_DEVICE_CODE, {
      provider: COPILOT,
      userCode: 'ABCD-1234',
    });
    adapter.emit(MESSAGE_TYPES.AUTH_LOGIN_OUTPUT, {
      provider: COPILOT,
      stream: 'stdout',
      line: 'Open the URL to continue',
    });

    expect(state.deviceCode?.userCode).toBe('ABCD-1234');
    expect(state.output).toEqual(['Open the URL to continue']);

    adapter.off(MESSAGE_TYPES.AUTH_DEVICE_CODE, onDeviceCode);
    adapter.off(MESSAGE_TYPES.AUTH_LOGIN_OUTPUT, onOutput);

    expect(adapter.listenerCount(MESSAGE_TYPES.AUTH_DEVICE_CODE)).toBe(0);
    expect(adapter.listenerCount(MESSAGE_TYPES.AUTH_LOGIN_OUTPUT)).toBe(0);
  });
});
