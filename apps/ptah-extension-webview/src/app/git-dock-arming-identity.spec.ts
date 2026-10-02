/**
 * DI-identity regression guard for the dock body's arming (TASK_2026_385
 * Batch 3.1 fix pass, FIX 2; retargeted to `ReviewShellComponent` at the
 * TASK_2026_576 cutover, Batch 58).
 *
 * `ReviewShellComponent`'s constructor arms `GitStatusService.startListening()`
 * and `GitBranchesService.startListening()` via plain `inject()`. That only
 * actually arms the push gate `MessageRouterService` dispatches through if
 * `inject()` resolves to the SAME singleton `app.config.ts` registers in the
 * `MESSAGE_HANDLERS` multi-provider (`useExisting: GitStatusService` /
 * `useExisting: GitBranchesService`). Both services are
 * `@Injectable({ providedIn: 'root' })` with no component-level `providers`
 * override on the shell, so this holds today by construction — but only by
 * code reading, not by a test.
 *
 * `review-shell.component.spec.ts` (in `git-ui`) proves the component CALLS
 * the right methods, using `useValue` stubs that bypass real DI resolution
 * entirely. It cannot catch a future regression — e.g. someone adding
 * `providers: [GitStatusService]` to `@Component` for an unrelated reason —
 * which would silently reintroduce the "push gate has no armer" bug with
 * every existing test still green.
 *
 * Lives here, not in `git-ui` or `chat`, because `MESSAGE_HANDLERS` is wired
 * in `apps/ptah-extension-webview/src/app/app.config.ts` — this is the one
 * project whose jest config exercises that composition root. Real
 * `MessageRouterService` + real `GitStatusService`/`GitBranchesService`
 * wired through the same registrations `app.config.ts` uses, `rpcCall` mocked
 * at the module boundary. Every `@defer` body stays a placeholder (manual
 * defer behaviour): the identity lives in the shell's constructor, and the
 * Pierre renderer behind the canvas is ESM-only and not needed here.
 */

import { signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import {
  MESSAGE_HANDLERS,
  MessageRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { ReviewShellComponent } from '@ptah-extension/git-ui';
import {
  FileContentChangesService,
  GitBranchesService,
  GitStatusService,
} from '@ptah-extension/git-ui/services';
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
// Pierre ships ESM only; nothing here renders a diff.
jest.mock('@pierre/diffs', () => ({}));
jest.mock('@pierre/diffs/worker', () => ({}));

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

/** Access to the shell's private/protected DI fields for the identity assertion only. */
interface ReviewShellInternals {
  gitStatus: GitStatusService;
  gitBranches: GitBranchesService;
}

describe('ReviewShellComponent resolves the same singletons MESSAGE_HANDLERS holds (FIX 2)', () => {
  beforeEach(() => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({ success: true, data: {} });

    TestBed.configureTestingModule({
      imports: [ReviewShellComponent],
      deferBlockBehavior: DeferBlockBehavior.Manual,
      providers: [
        { provide: VSCodeService, useValue: makeVscodeStub() },
        MessageRouterService,
        // Mirrors app.config.ts exactly.
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
        {
          provide: MESSAGE_HANDLERS,
          useExisting: FileContentChangesService,
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
    // `useExisting` registration resolves without exploding (A-8).
    const router = TestBed.inject(MessageRouterService);
    const handlers = TestBed.inject(MESSAGE_HANDLERS);
    const rootGitStatus = TestBed.inject(GitStatusService);
    expect(router).toBeTruthy();
    expect(handlers).toContain(rootGitStatus);

    const fixture = TestBed.createComponent(ReviewShellComponent);
    const injected = (
      fixture.componentInstance as unknown as ReviewShellInternals
    ).gitStatus;

    expect(injected).toBe(rootGitStatus);
    fixture.destroy();
  });

  it('injects the exact GitBranchesService instance MESSAGE_HANDLERS holds', () => {
    const router = TestBed.inject(MessageRouterService);
    const handlers = TestBed.inject(MESSAGE_HANDLERS);
    const rootGitBranches = TestBed.inject(GitBranchesService);
    expect(router).toBeTruthy();
    expect(handlers).toContain(rootGitBranches);

    const fixture = TestBed.createComponent(ReviewShellComponent);
    const injected = (
      fixture.componentInstance as unknown as ReviewShellInternals
    ).gitBranches;

    expect(injected).toBe(rootGitBranches);
    fixture.destroy();
  });

  it('a push routed through the real MessageRouterService reaches the instance ReviewShellComponent armed', () => {
    // Force the router to exist BEFORE the shell, matching real bootstrap
    // order (app.config.ts wires MESSAGE_HANDLERS before any component
    // mounts).
    TestBed.inject(MessageRouterService);

    const fixture = TestBed.createComponent(ReviewShellComponent);
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

  it('disarms the root GitStatusService on destroy, so the push gate closes with the dock', () => {
    TestBed.inject(MessageRouterService);
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');

    const fixture = TestBed.createComponent(ReviewShellComponent);
    fixture.destroy();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: MESSAGE_TYPES.GIT_STATUS_UPDATE,
          payload: {
            branch: {
              branch: 'after-close',
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

    expect(gitStatus.branchName()).not.toBe('after-close');
  });
});
