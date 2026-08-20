/**
 * persistCliSessionReference — the parentless drop (TASK_2026_295).
 *
 * A CLI agent whose `parentSessionId` is falsy has nowhere to be persisted:
 * `addCliSession` is keyed by the parent session. That was a bare `return`, so
 * the agent simply never appeared under any session and nothing said why — and
 * the retry pass in `sdk-callbacks.ts` cannot recover it either, because it
 * filters on `parentSessionId === realSessionId`, which a blank id never
 * matches. The drop is now named out loud, at both call sites.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts
 */

import 'reflect-metadata';

import { EventEmitter } from 'eventemitter3';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { AgentProcessInfo } from '@ptah-extension/shared';
import type { DependencyContainer } from 'tsyringe';
import {
  persistCliSessionReference,
  wireAgentEventListeners,
} from './agent-events';

const PARENT_SESSION = '11111111-2222-4333-8444-555555555555';

function buildInfo(overrides: Partial<AgentProcessInfo>): AgentProcessInfo {
  return {
    agentId: 'agent-42',
    cli: 'ptah-cli',
    task: 'do work',
    workingDirectory: '/repo',
    status: 'exited',
    startedAt: new Date(0).toISOString(),
    ...overrides,
  } as AgentProcessInfo;
}

function buildContainer(
  entries: Array<[symbol, unknown]>,
): DependencyContainer {
  const registry = new Map<symbol, unknown>(entries);
  return {
    isRegistered: (token: symbol) => registry.has(token),
    resolve: (token: symbol) => registry.get(token),
  } as unknown as DependencyContainer;
}

describe('persistCliSessionReference — missing parent session', () => {
  it('warns and names the agent instead of dropping it silently', () => {
    const logger = createMockLogger();
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        { addCliSession, markChildSession: jest.fn() },
      ],
    ]);

    persistCliSessionReference(
      container,
      logger as unknown as Logger,
      '[test]',
      buildInfo({ parentSessionId: undefined }),
      undefined,
    );

    expect(addCliSession).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('agent-42'),
      expect.anything(),
    );
  });

  it('treats an empty-string parent the same as an absent one', () => {
    const logger = createMockLogger();
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        { addCliSession, markChildSession: jest.fn() },
      ],
    ]);

    persistCliSessionReference(
      container,
      logger as unknown as Logger,
      '[test]',
      buildInfo({ parentSessionId: '' }),
      undefined,
    );

    expect(addCliSession).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no parent session id'),
      expect.anything(),
    );
  });

  it('still persists normally when a parent session is present', () => {
    const logger = createMockLogger();
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    persistCliSessionReference(
      container,
      logger as unknown as Logger,
      '[test]',
      buildInfo({
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
      }),
      undefined,
    );

    expect(addCliSession).toHaveBeenCalledWith(
      PARENT_SESSION,
      expect.objectContaining({ cliSessionId: 'cli-sess-1' }),
    );
  });
});

describe('wireAgentEventListeners — the drop reaches the log', () => {
  it('warns when an exited agent has no parent session', () => {
    const logger = createMockLogger();
    const events = new EventEmitter();
    const agentProcessManager = {
      events,
      readOutputForPersistence: jest.fn().mockReturnValue(undefined),
    };
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, agentProcessManager],
      [
        TOKENS.WEBVIEW_MANAGER,
        { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      ],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        { addCliSession: jest.fn(), markChildSession: jest.fn() },
      ],
    ]);

    wireAgentEventListeners(container, {
      logger: logger as unknown as Logger,
      platform: 'electron',
      options: { persistCliSession: true },
    });

    events.emit('agent:exited', buildInfo({ parentSessionId: undefined }));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no parent session id'),
      expect.anything(),
    );
  });
});
