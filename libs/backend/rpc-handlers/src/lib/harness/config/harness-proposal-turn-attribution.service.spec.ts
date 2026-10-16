import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  SdkAdapterEvents,
  UserPromptSubmitCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { HarnessProposalStore } from './harness-proposal-store.service';
import { HarnessProposalTurnAttributionService } from './harness-proposal-turn-attribution.service';

describe('HarnessProposalTurnAttributionService', () => {
  let root: string;
  let registry: UserPromptSubmitCallbackRegistry;
  let events: SdkAdapterEvents;
  let attribution: HarnessProposalTurnAttributionService;
  let store: HarnessProposalStore;

  const T1 = Date.parse('2026-10-15T10:00:00.000Z');
  const T3 = Date.parse('2026-10-15T10:03:00.000Z');

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-turn-'));
    const logger = createMockLogger() as unknown as Logger;
    registry = new UserPromptSubmitCallbackRegistry(logger);
    events = new SdkAdapterEvents(logger);
    attribution = new HarnessProposalTurnAttributionService(registry, events);
    store = new HarnessProposalStore(
      logger,
      { getWorkspaceRoot: () => root } as IWorkspaceProvider,
      attribution,
    );
  });

  afterEach(async () => {
    attribution.dispose();
    await fs.rm(root, { recursive: true, force: true });
  });

  function submit(timestamp: number, workspaceRoot = root): void {
    registry.notifyAll({
      prompt: 'configure',
      sessionId: 'session',
      workspaceRoot,
      timestamp,
    });
  }

  function endTurn(): void {
    events.emitTurnEnded({
      sessionId: 'session',
      cwd: root,
      lastAssistantMessage: null,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: null,
      timestamp: T3 + 1,
    });
  }

  it('T1 start, T2 user choice, T3 callback before save reads, T4 write keeps T1', async () => {
    submit(T1);
    const capture = store.captureProposingTurnStartedAt('session');
    // The UI records a T2 user choice while this proposing call awaits I/O.
    submit(T3);
    endTurn();
    const saved = await store.save(
      'session',
      { name: 'T1 proposal' },
      false,
      capture.turnStartedAt,
    );
    capture.release();
    expect(saved.revisions).toHaveLength(1);
    expect(saved.revisions?.[0].turnStartedAt).toBe(new Date(T1).toISOString());
    expect((await store.get('session'))?.revisions).toEqual(saved.revisions);
  });

  it('leaves overlapping or workspace-mismatched callbacks unattributed', () => {
    expect(attribution.capture('session', root).turnStartedAt).toBeUndefined();
    submit(T1, path.join(root, 'other'));
    expect(attribution.capture('session', root).turnStartedAt).toBeUndefined();
    submit(T3);
    expect(attribution.capture('session', root).turnStartedAt).toBeUndefined();
    endTurn();
    submit(T3);
    const capture = attribution.capture('session', root);
    expect(capture.turnStartedAt).toBe(new Date(T3).toISOString());
    capture.release();
  });

  it('attributes a prompt with a trailing separator in its workspace root', () => {
    submit(T1, `${root}${path.sep}`);
    const capture = attribution.capture('session', root);
    expect(capture.turnStartedAt).toBe(new Date(T1).toISOString());
    capture.release();
  });

  it('attributes a prompt with different Windows root casing', () => {
    const platform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });
    try {
      submit(T1, root.toUpperCase());
      const capture = attribution.capture('session', root);
      expect(capture.turnStartedAt).toBe(new Date(T1).toISOString());
      capture.release();
    } finally {
      Object.defineProperty(process, 'platform', {
        value: platform,
        configurable: true,
      });
    }
  });

  it('attributes the next prompt after abort while a live mid-turn prompt stays ambiguous', () => {
    submit(T1);
    submit(T3);
    expect(attribution.capture('session', root).turnStartedAt).toBeUndefined();
    attribution.onTurnAborted('session');
    submit(T3 + 1);
    expect(attribution.capture('session', root).turnStartedAt).toBe(
      new Date(T3 + 1).toISOString(),
    );
  });

  it('retains a frozen value through a failed turn and releases subscriptions', () => {
    submit(T1);
    const capture = attribution.capture('session', root);
    events.emitTurnFailed({
      sessionId: 'session',
      cwd: root,
      lastAssistantMessage: null,
      error: 'rate_limit',
      errorDetails: null,
      terminalReason: null,
      timestamp: T1 + 1,
    });
    expect(capture.turnStartedAt).toBe(new Date(T1).toISOString());
    expect(attribution.capture('session', root).turnStartedAt).toBeUndefined();
    capture.release();
    attribution.dispose();
    expect(registry.size).toBe(0);
  });
});
