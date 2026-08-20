import type { DependencyContainer } from 'tsyringe';

import type { Logger } from '@ptah-extension/vscode-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';

import { wireThothPushBridges } from './wire-thoth-push-bridges';
import type { CliWebviewManagerAdapter } from '../transport/cli-webview-manager-adapter.js';

type Entry = readonly [unknown, unknown];

function makeContainer(entries: Entry[]): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: (token: unknown) => {
      if (!map.has(token)) {
        throw new Error(`not registered: ${String(token)}`);
      }
      return map.get(token);
    },
  } as unknown as DependencyContainer;
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makePushAdapter() {
  return {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mirrors `thoth-runtime/.../boot-thoth-runtime.spec.ts` — the same
 * `MEMORY_EXTRACTED` broadcast is wired twice, once per host, so the absence
 * contract has to be pinned in both places or one host can drift back to `''`.
 */
describe('wireThothPushBridges — MEMORY_EXTRACTED session identity', () => {
  function wireCurator() {
    const pushAdapter = makePushAdapter();
    let onEventCb: ((ev: Record<string, unknown>) => void) | null = null;
    const memoryCurator = {
      onEvent: jest.fn((cb: (ev: Record<string, unknown>) => void) => {
        onEventCb = cb;
        return { dispose: jest.fn() };
      }),
    };
    const container = makeContainer([
      [MEMORY_TOKENS.MEMORY_CURATOR, memoryCurator],
    ]);

    wireThothPushBridges(
      container,
      pushAdapter as unknown as CliWebviewManagerAdapter,
      makeLogger(),
    );

    if (onEventCb === null) {
      throw new Error('curator onEvent was never subscribed');
    }
    return {
      pushAdapter,
      emit: onEventCb as unknown as (ev: Record<string, unknown>) => void,
    };
  }

  // TASK_2026_296 item 1 — `CuratorEvent.sessionId` is optional at the source,
  // so this bridge used to invent `''` to satisfy a required wire field. The
  // field is now optional; an absent id must stay absent.
  it('broadcasts an absent sessionId as undefined, never as an empty string', () => {
    const { pushAdapter, emit } = wireCurator();

    emit({
      kind: 'curator-run',
      stats: { created: 1, extracted: 3, merged: 0 },
      timestamp: 7,
    });

    expect(pushAdapter.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.MEMORY_EXTRACTED,
      {
        sessionId: undefined,
        workspaceRoot: null,
        extracted: 3,
        created: 1,
        merged: 0,
        timestamp: 7,
      },
    );
    const payload = pushAdapter.broadcastMessage.mock.calls[0][1] as {
      sessionId?: string;
    };
    expect(payload.sessionId).not.toBe('');
  });

  // Paired-isolation sibling: the legitimate path is unchanged.
  it('broadcasts a present sessionId unchanged', () => {
    const { pushAdapter, emit } = wireCurator();

    emit({
      kind: 'curator-run',
      sessionId: 's1',
      stats: { created: 2, extracted: 5, merged: 1 },
      timestamp: 42,
    });

    expect(pushAdapter.broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.MEMORY_EXTRACTED,
      {
        sessionId: 's1',
        workspaceRoot: null,
        extracted: 5,
        created: 2,
        merged: 1,
        timestamp: 42,
      },
    );
  });

  it('does not broadcast for a curator run that created nothing', () => {
    const { pushAdapter, emit } = wireCurator();

    emit({ kind: 'curator-run', stats: { created: 0 }, timestamp: 1 });

    expect(pushAdapter.broadcastMessage).not.toHaveBeenCalled();
  });
});
