import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type {
  ChatSessionSummary,
  SessionOrganizationSummary,
} from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';
import { SessionOrganizationCache } from '../session-organization/session-organization-cache.store';
import { SessionWorktreeLookup } from './session-worktree-lookup.service';

function row(id: string): ChatSessionSummary {
  return {
    id,
    name: id,
    messageCount: 0,
    createdAt: 0,
    lastActivityAt: 0,
    isActive: false,
  } as ChatSessionSummary;
}

function organization(worktreePath: string | null): SessionOrganizationSummary {
  return { worktreePath } as SessionOrganizationSummary;
}

describe('SessionWorktreeLookup', () => {
  const sessions = signal<ChatSessionSummary[]>([]);
  const organizations = signal<ReadonlyMap<string, SessionOrganizationSummary>>(
    new Map(),
  );
  const organizationFor = jest.fn((sessionId: string) =>
    computed(() => organizations().get(sessionId) ?? null),
  );
  let lookup: SessionWorktreeLookup;

  beforeEach(() => {
    sessions.set([]);
    organizations.set(new Map());
    organizationFor.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ChatStore, useValue: { sessions } },
        { provide: SessionOrganizationCache, useValue: { organizationFor } },
      ],
    });
    lookup = TestBed.inject(SessionWorktreeLookup);
  });

  afterEach(() => TestBed.resetTestingModule());

  it("reads the session's organization worktree from the cache", () => {
    organizations.set(
      new Map([
        ['s1', organization('/wt/one')],
        ['s2', organization(null)],
      ]),
    );

    expect(lookup.worktreeFor('s1')).toEqual({
      known: true,
      worktreePath: '/wt/one',
    });
    expect(lookup.worktreeFor('s2')).toEqual({ known: true, worktreePath: null });
    expect(organizationFor).toHaveBeenCalledWith('s1');
  });

  it('knows a session outside the loaded rows once the cache reads it', () => {
    expect(lookup.worktreeFor('paged-out')).toEqual({
      known: false,
      worktreePath: null,
    });

    organizations.set(new Map([['paged-out', organization('/wt/far')]]));

    expect(lookup.worktreeFor('paged-out')).toEqual({
      known: true,
      worktreePath: '/wt/far',
    });
  });

  it('treats a loaded row without an organization as known, with no worktree', () => {
    sessions.set([row('s3')]);

    expect(lookup.worktreeFor('s3')).toEqual({ known: true, worktreePath: null });
    expect(lookup.worktreeFor('missing').known).toBe(false);
  });

  it('treats a tab without a backend session as known, with no worktree', () => {
    expect(lookup.worktreeFor(null)).toEqual({ known: true, worktreePath: null });
    expect(organizationFor).not.toHaveBeenCalled();
  });
});
