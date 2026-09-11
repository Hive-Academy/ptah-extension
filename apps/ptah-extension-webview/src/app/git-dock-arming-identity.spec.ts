/**
 * DI-identity regression guard for `GitDockComponent`'s arming (TASK_2026_385
 * Batch 3.1 fix pass, FIX 2).
 *
 * `GitDockComponent`'s constructor arms `GitStatusService.startListening()`
 * and `GitBranchesService.startListening()` via plain `inject()`. That only
 * actually arms the push gate `MessageRouterService` dispatches through if
 * `inject()` resolves to the SAME singleton `app.config.ts` registers in the
 * `MESSAGE_HANDLERS` multi-provider (`useExisting: GitStatusService` /
 * `useExisting: GitBranchesService`, `app.config.ts:190-191`). Both
 * services are `@Injectable({ providedIn: 'root' })` with no component-level
 * `providers` override on `GitDockComponent`, so this holds today by
 * construction — but only by code reading, not by a test.
 *
 * `git-dock.component.spec.ts` (in `git-ui`) proves the component CALLS the
 * right methods, using `useValue` stubs that bypass real DI resolution
 * entirely. It cannot catch a future regression — e.g. someone adding
 * `providers: [GitStatusService]` to `@Component` for an unrelated reason —
 * which would silently reintroduce the exact "push gate has no armer" bug
 * this whole batch exists to close, with every existing test (including
 * that spec) still green.
 *
 * Lives here, not in `git-ui` or `chat`, because `MESSAGE_HANDLERS` is wired
 * in `apps/ptah-extension-webview/src/app/app.config.ts` — this is the one
 * project whose jest config exercises that composition root. Follows the
 * exact pattern of the neighbouring `editor-message-routing.spec.ts`: real
 * `MessageRouterService` + real `GitStatusService`/`GitBranchesService`
 * wired through the same `MESSAGE_HANDLERS` registrations `app.config.ts`
 * uses, `rpcCall` mocked at the module boundary.
 */

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  MESSAGE_HANDLERS,
  MessageRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  GitBranchesService,
  GitDockComponent,
  GitReviewService,
  GitStatusService,
} from '@ptah-extension/git-ui';
import { MESSAGE_TYPES } from '@ptah-extension/shared';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

function makeVscodeStub() {
  const config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

/** Access to `GitDockComponent`'s private/protected DI fields for the identity assertion only. */
interface GitDockInternals {
  gitStatus: GitStatusService;
  gitBranches: GitBranchesService;
  review: GitReviewService;
}

describe('GitDockComponent resolves the same singletons MESSAGE_HANDLERS holds (FIX 2)', () => {
  beforeEach(() => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({ success: true, data: {} });

    TestBed.configureTestingModule({
      imports: [GitDockComponent],
      providers: [
        { provide: VSCodeService, useValue: makeVscodeStub() },
        MessageRouterService,
        // Mirrors app.config.ts:190-191 exactly.
        {
          provide: MESSAGE_HANDLERS,
          useExisting: GitStatusService,
          multi: true,
        },
        {
          provide: MESSAGE_HANDLERS,
          useExisting: GitBranchesService,
          multi: true,
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('injects the exact GitStatusService instance MESSAGE_HANDLERS holds', () => {
    // Constructing the router builds the handler map, which reads
    // `handledMessageTypes` off every registered handler — proves the
    // `useExisting` registration resolves without exploding (mirrors
    // `editor-message-routing.spec.ts`'s A-8 risk).
    const router = TestBed.inject(MessageRouterService);
    const handlers = TestBed.inject(MESSAGE_HANDLERS);
    const rootGitStatus = TestBed.inject(GitStatusService);
    expect(router).toBeTruthy();
    expect(handlers).toContain(rootGitStatus);

    const fixture = TestBed.createComponent(GitDockComponent);
    const injected = (fixture.componentInstance as unknown as GitDockInternals)
      .gitStatus;

    expect(injected).toBe(rootGitStatus);
    fixture.destroy();
  });

  it('injects the exact GitBranchesService instance MESSAGE_HANDLERS holds', () => {
    const router = TestBed.inject(MessageRouterService);
    const handlers = TestBed.inject(MESSAGE_HANDLERS);
    const rootGitBranches = TestBed.inject(GitBranchesService);
    expect(router).toBeTruthy();
    expect(handlers).toContain(rootGitBranches);

    const fixture = TestBed.createComponent(GitDockComponent);
    const injected = (fixture.componentInstance as unknown as GitDockInternals)
      .gitBranches;

    expect(injected).toBe(rootGitBranches);
    fixture.destroy();
  });

  it('a push routed through the real MessageRouterService reaches the instance GitDockComponent armed', () => {
    // Force the router to exist BEFORE the dock, matching real bootstrap
    // order (app.config.ts wires MESSAGE_HANDLERS before any component
    // mounts).
    TestBed.inject(MessageRouterService);

    const fixture = TestBed.createComponent(GitDockComponent);
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
          payload: {
            branch: {
              branch: 'armed-live',
              upstream: null,
              ahead: 0,
              behind: 0,
            },
            files: [],
            isGitRepo: true,
            workspaceRoot: '/ws/a',
          },
        },
      }),
    );

    expect(gitStatus.branchName()).toBe('armed-live');

    fixture.destroy();
    gitStatus.stopListening();
  });

  it('injects the root GitReviewService used by workspace coordination', () => {
    const fixture = TestBed.createComponent(GitDockComponent);
    const injected = (fixture.componentInstance as unknown as GitDockInternals)
      .review;
    expect(injected).toBe(TestBed.inject(GitReviewService));
    fixture.destroy();
  });
});
