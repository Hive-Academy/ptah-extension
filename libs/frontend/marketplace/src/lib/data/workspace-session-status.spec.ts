/**
 * workspace-session-status specs (plan Revision 3, D-4.1).
 *
 * `newestWorkspaceSessionKey` is covered as a pure table. The injected signal
 * runs against the REAL root `SessionMcpStatusRegistry` and a
 * `TabManagerService` stub whose writable `tabs` stands in for the active
 * workspace's tab set (the real service needs `MODEL_REFRESH_CONTROL`, which
 * has no default provider).
 */

import { signal, type Signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  SessionMcpStatusRegistry,
  TabManagerService,
  type SessionMcpStatus,
} from '@ptah-extension/chat-state';
import {
  injectWorkspaceSessionStatus,
  newestWorkspaceSessionKey,
} from './workspace-session-status';

/** The two `TabState` fields the collaborator reads. */
interface TabStub {
  readonly id: string;
  readonly claudeSessionId: string | null;
}

const tab = (id: string, claudeSessionId: string | null = null): TabStub => ({
  id,
  claudeSessionId,
});

describe('newestWorkspaceSessionKey', () => {
  it.each<[string, readonly string[], readonly string[], string | null]>([
    ['the newest member', ['a', 'b', 'c'], ['a', 'c'], 'c'],
    ['skips a newer non-member', ['a', 'b', 'c'], ['a', 'b'], 'b'],
    ['skips every newer non-member', ['a', 'x', 'y'], ['a'], 'a'],
    ['null when no key is a member', ['x', 'y'], ['a'], null],
    ['null for no members', ['a', 'b'], [], null],
    ['null for no recorded keys', [], ['a'], null],
  ])('returns %s', (_label, recorded, members, expected) => {
    expect(newestWorkspaceSessionKey(recorded, new Set(members))).toBe(
      expected,
    );
  });
});

describe('injectWorkspaceSessionStatus', () => {
  let tabs: WritableSignal<readonly TabStub[]>;
  let registry: SessionMcpStatusRegistry;
  let status: Signal<SessionMcpStatus | null>;

  const report = (key: string, names: readonly string[]): void => {
    registry.record(key, {
      servers: names.map((name) => ({ name, status: 'connected' as const })),
      notices: [],
    });
  };

  const namesOf = (): string[] | null =>
    status()?.servers.map((server) => server.name) ?? null;

  beforeEach(() => {
    tabs = signal<readonly TabStub[]>([]);
    TestBed.configureTestingModule({
      providers: [{ provide: TabManagerService, useValue: { tabs } }],
    });
    registry = TestBed.inject(SessionMcpStatusRegistry);
    status = TestBed.runInInjectionContext(() =>
      injectWorkspaceSessionStatus(),
    );
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // Spec 1
  it('returns the newest member session and skips a newer non-member', () => {
    tabs.set([tab('tab-1', 'session-a'), tab('tab-2', 'session-b')]);
    report('session-a', ['Gmail']);
    report('session-b', ['Canva']);
    report('other-workspace', ['Slack']);

    expect(namesOf()).toEqual(['Canva']);
    expect(status()).toBe(registry.peek('session-b'));
  });

  // Spec 2
  it('is null when no recorded key is a member', () => {
    tabs.set([tab('tab-1', 'session-a')]);
    report('other-workspace', ['Slack']);

    expect(status()).toBeNull();
  });

  // Spec 2
  it('is null for an empty tab set, even with recorded sessions', () => {
    report('session-a', ['Gmail']);

    expect(tabs()).toEqual([]);
    expect(status()).toBeNull();
  });

  // Spec 3
  it('matches a push recorded under the tabId', () => {
    tabs.set([tab('tab-1')]);
    report('tab-1', ['Gmail']);

    expect(namesOf()).toEqual(['Gmail']);
  });

  // Spec 3
  it('matches a push recorded under the SDK session id', () => {
    tabs.set([tab('tab-1', 'session-a')]);
    report('session-a', ['Gmail']);

    expect(namesOf()).toEqual(['Gmail']);
  });

  // Spec 3
  it('lets a tab with no SDK id contribute only its own id', () => {
    tabs.set([tab('tab-1'), tab('tab-2', 'session-b')]);
    report('session-b', ['Canva']);
    report('session-x', ['Slack']);

    // `session-x` is nobody's key; `null` is never a member.
    expect(namesOf()).toEqual(['Canva']);
  });

  // Spec 3 / failure table: re-keyed session, whichever write is newer wins.
  it('takes the newer of the tabId and UUID records for one tab', () => {
    tabs.set([tab('tab-1', 'session-a')]);
    report('tab-1', ['Gmail']);
    report('session-a', ['Gmail', 'Canva']);

    expect(namesOf()).toEqual(['Gmail', 'Canva']);
  });

  // Spec 4
  it("flips to another workspace's tab set with no new record", () => {
    report('session-a', ['Gmail']);
    report('session-b', ['Canva']);
    tabs.set([tab('tab-a', 'session-a')]);
    expect(namesOf()).toEqual(['Gmail']);

    tabs.set([tab('tab-b', 'session-b')]);
    expect(namesOf()).toEqual(['Canva']);

    tabs.set([tab('tab-c')]);
    expect(status()).toBeNull();
  });

  // Spec 5
  it('makes a re-recorded older member session the newest', () => {
    tabs.set([tab('tab-1', 'session-a'), tab('tab-2', 'session-b')]);
    report('session-a', ['Gmail']);
    report('session-b', ['Canva']);
    expect(namesOf()).toEqual(['Canva']);

    report('session-a', ['Gmail', 'Slack']);

    expect(namesOf()).toEqual(['Gmail', 'Slack']);
  });

  // Spec 6
  it('keeps the reference across a same-key tabs write and changes it on a new record', () => {
    tabs.set([tab('tab-1', 'session-a')]);
    report('session-a', ['Gmail']);
    const first = status();
    expect(first).toBe(registry.peek('session-a'));

    const peek = jest.spyOn(registry, 'peek');
    // A streaming flush: a new array and new tab objects, the same keys.
    tabs.set([tab('tab-1', 'session-a')]);
    expect(status()).toBe(first);
    // The member set compared equal, so nothing was re-derived at all.
    expect(peek).not.toHaveBeenCalled();

    // An unrelated record re-derives but hands back the same stored object.
    report('other-workspace', ['Slack']);
    expect(status()).toBe(first);

    report('session-a', ['Gmail']);
    const second = status();
    expect(second).not.toBe(first);
    expect(second).toBe(registry.peek('session-a'));
  });

  // Spec 7
  it('falls back to the next member when the chosen tab closes, then to null', () => {
    tabs.set([tab('tab-1', 'session-a'), tab('tab-2', 'session-b')]);
    report('session-a', ['Gmail']);
    report('session-b', ['Canva']);
    expect(namesOf()).toEqual(['Canva']);

    tabs.set([tab('tab-1', 'session-a')]);
    expect(namesOf()).toEqual(['Gmail']);

    tabs.set([]);
    expect(status()).toBeNull();
  });
});
