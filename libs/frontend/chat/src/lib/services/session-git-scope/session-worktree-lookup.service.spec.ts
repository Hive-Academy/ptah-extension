import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { SessionWorktreeLookup } from './session-worktree-lookup.service';

function row(
  id: string,
  worktreePath: string | null | undefined,
): ChatSessionSummary {
  return {
    id,
    name: id,
    messageCount: 0,
    createdAt: 0,
    lastActivityAt: 0,
    isActive: false,
    ...(worktreePath === undefined
      ? {}
      : { organization: { worktreePath } }),
  } as ChatSessionSummary;
}

describe('SessionWorktreeLookup', () => {
  const sessions = signal<ChatSessionSummary[]>([]);
  let lookup: SessionWorktreeLookup;

  beforeEach(() => {
    sessions.set([]);
    TestBed.configureTestingModule({
      providers: [{ provide: ChatStore, useValue: { sessions } }],
    });
    lookup = TestBed.inject(SessionWorktreeLookup);
  });

  afterEach(() => TestBed.resetTestingModule());

  it("reads the session row's organization worktree", () => {
    sessions.set([row('s1', '/wt/one'), row('s2', null), row('s3', undefined)]);

    expect(lookup.worktreeFor('s1')).toEqual({
      known: true,
      worktreePath: '/wt/one',
    });
    expect(lookup.worktreeFor('s2')).toEqual({ known: true, worktreePath: null });
    expect(lookup.worktreeFor('s3')).toEqual({ known: true, worktreePath: null });
  });

  it('tells a row that is not loaded (unknown) from a row without a worktree', () => {
    sessions.set([row('s2', null)]);

    expect(lookup.worktreeFor('missing')).toEqual({
      known: false,
      worktreePath: null,
    });
    expect(lookup.worktreeFor('s2').known).toBe(true);
  });

  it('treats a tab without a backend session as known, with no worktree', () => {
    expect(lookup.worktreeFor(null)).toEqual({ known: true, worktreePath: null });
  });

  it('follows the rows as they change', () => {
    expect(lookup.worktreeFor('s1').known).toBe(false);

    sessions.set([row('s1', '/wt/later')]);

    expect(lookup.worktreeFor('s1')).toEqual({
      known: true,
      worktreePath: '/wt/later',
    });
  });
});
