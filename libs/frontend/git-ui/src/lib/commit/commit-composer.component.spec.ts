/**
 * CommitComposerComponent (TASK_2026_576 Batch 48, Requirement 9). Ports the
 * RC1 commit cases of `source-control-panel.component.spec.ts` (disabled
 * states, message kept on failure, cleared on success, transport failure is
 * a failure) and covers what is new: Generate message, the streamed hook log
 * routed by operationId, Cancel and the capped log.
 */

import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import axe from 'axe-core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  GitCommitResult,
  GitGenerateCommitMessageResult,
  GitLastCommitResult,
} from '@ptah-extension/shared';
import type { RpcCallResult } from '@ptah-extension/core';
import { GitBranchesService } from '../services/git-branches.service';
import { GitOperationOutputService } from '../services/git-operation-output.service';
import { GitStatusService } from '../services/git-status.service';
import { SourceControlService } from '../services/source-control.service';
import {
  COMMIT_LOG_RENDER_CAP,
  CommitComposerComponent,
} from './commit-composer.component';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const OPERATION_ID = '0b6c2f3e-1d2a-4e5f-8a9b-0c1d2e3f4a5b';

describe('CommitComposerComponent', () => {
  let fixture: ComponentFixture<CommitComposerComponent>;
  let gitStatus: {
    activeWorkspacePath: ReturnType<typeof signal<string | null>>;
    stagedCount: ReturnType<typeof signal<number>>;
    stagedFiles: ReturnType<typeof signal<{ path: string }[]>>;
    refresh: jest.Mock;
  };
  let gitBranches: {
    lastCommit: ReturnType<typeof signal<GitLastCommitResult | null>>;
    refreshForCauses: jest.Mock;
    workspaceRoot: jest.Mock;
  };
  let sourceControl: {
    commit: jest.Mock;
    cancelOperation: jest.Mock;
    generateCommitMessage: jest.Mock;
  };
  let output: GitOperationOutputService;

  beforeEach(() => {
    gitStatus = {
      activeWorkspacePath: signal<string | null>('/ws/a'),
      stagedCount: signal(2),
      stagedFiles: signal([{ path: 'src/a.ts' }, { path: 'src/b.ts' }]),
      refresh: jest.fn(async () => undefined),
    };
    const lastCommit = signal<GitLastCommitResult | null>({
      hash: 'head-before',
      shortHash: 'head-be',
      subject: 'chore: earlier',
    } as GitLastCommitResult);
    gitBranches = {
      lastCommit,
      // A good HEAD read publishes a fresh object, here for an unmoved HEAD.
      refreshForCauses: jest.fn(async () => {
        const head = lastCommit();
        if (head) lastCommit.set({ ...head });
      }),
      workspaceRoot: jest.fn(() => gitStatus.activeWorkspacePath()),
    };
    sourceControl = {
      commit: jest.fn(),
      cancelOperation: jest.fn(async () => ({
        success: true,
        data: { cancelled: true },
      })),
      generateCommitMessage: jest.fn(),
    };
    jest
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue(OPERATION_ID as ReturnType<Crypto['randomUUID']>);

    TestBed.configureTestingModule({
      imports: [CommitComposerComponent],
      providers: [
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitBranchesService, useValue: gitBranches },
        { provide: SourceControlService, useValue: sourceControl },
      ],
    });
    output = TestBed.inject(GitOperationOutputService);
    fixture = TestBed.createComponent(CommitComposerComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function el<T extends HTMLElement = HTMLElement>(testId: string): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(
      `[data-testid="${testId}"]`,
    );
  }

  function textOf(testId: string): string {
    return (el(testId)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  const textarea = () => el<HTMLTextAreaElement>('commit-message');
  const commitButton = () => el<HTMLButtonElement>('commit-submit');
  const generateButton = () => el<HTMLButtonElement>('commit-generate');

  async function type(value: string): Promise<void> {
    const field = textarea();
    if (!field) throw new Error('no textarea');
    field.value = value;
    field.dispatchEvent(new Event('input'));
    await settle();
  }

  function push(operationId: string, chunk: string, stream = 'stdout'): void {
    output.handleMessage({
      type: MESSAGE_TYPES.GIT_OPERATION_OUTPUT,
      payload: { operationId, stream, chunk },
    });
  }

  /** Start a commit whose reply is held until the test resolves it. */
  async function startCommit(
    message = 'feat: add composer',
  ): Promise<Deferred<RpcCallResult<GitCommitResult>>> {
    const reply = deferred<RpcCallResult<GitCommitResult>>();
    sourceControl.commit.mockReturnValue(reply.promise);
    await type(message);
    commitButton()?.click();
    await settle();
    return reply;
  }

  async function finish(
    reply: Deferred<RpcCallResult<GitCommitResult>>,
    result: RpcCallResult<GitCommitResult>,
  ): Promise<void> {
    reply.resolve(result);
    await settle();
  }

  // -- Disabled states (Requirement 9.6) -------------------------------------

  it('shows the staged count', () => {
    expect(textOf('commit-staged-count')).toBe('Staged: 2 files');

    gitStatus.stagedCount.set(1);
    fixture.detectChanges();
    expect(textOf('commit-staged-count')).toBe('Staged: 1 file');
  });

  it('disables Commit without a message, including a blank one', async () => {
    expect(commitButton()?.disabled).toBe(true);

    await type('   \n ');
    expect(commitButton()?.disabled).toBe(true);

    await type('fix: thing');
    expect(commitButton()?.disabled).toBe(false);
  });

  it('disables Commit and Generate with nothing staged, and says so', async () => {
    gitStatus.stagedCount.set(0);
    await type('fix: thing');

    expect(commitButton()?.disabled).toBe(true);
    expect(generateButton()?.disabled).toBe(true);
    expect(textarea()?.placeholder).toBe(
      'Nothing staged yet — stage changes in the Changes tab.',
    );
    expect(textarea()?.disabled).toBe(false);
  });

  it('a click on a disabled Commit commits nothing', async () => {
    commitButton()?.click();
    await settle();

    expect(sourceControl.commit).not.toHaveBeenCalled();
  });

  // -- Generate message (Requirement 9.2) ------------------------------------

  it('calls the provider only on a Generate click', async () => {
    await settle();
    expect(sourceControl.generateCommitMessage).not.toHaveBeenCalled();

    sourceControl.generateCommitMessage.mockResolvedValue({
      success: true,
      data: { status: 'generated', message: 'feat: generated' },
    } satisfies RpcCallResult<GitGenerateCommitMessageResult>);
    generateButton()?.click();
    await settle();

    expect(sourceControl.generateCommitMessage).toHaveBeenCalledTimes(1);
    expect(textarea()?.value).toBe('feat: generated');
    expect(textarea()?.disabled).toBe(false);
    expect(el('commit-generate-notice')).toBeNull();
    expect(sourceControl.commit).not.toHaveBeenCalled();
  });

  it('shows Generating… while the provider writes and keeps the field editable', async () => {
    const reply = deferred<RpcCallResult<GitGenerateCommitMessageResult>>();
    sourceControl.generateCommitMessage.mockReturnValue(reply.promise);

    generateButton()?.click();
    await settle();

    expect(textOf('commit-generate')).toBe('Generating…');
    expect(generateButton()?.disabled).toBe(true);
    expect(textarea()?.disabled).toBe(false);

    reply.resolve({
      success: true,
      data: { status: 'generated', message: 'feat: x' },
    });
    await settle();
    expect(textOf('commit-generate')).toBe('Generate message');
  });

  it.each([
    ['no-provider', 'No AI provider is configured.'],
    ['rate-limited', 'The AI provider is rate-limited right now.'],
    ['unreachable', 'The AI provider could not be reached.'],
    ['timeout', 'The AI provider did not answer in time.'],
  ] as const)(
    'an unavailable result (%s) says why and keeps the typed text',
    async (reason, why) => {
      await type('my own words');
      sourceControl.generateCommitMessage.mockResolvedValue({
        success: true,
        data: { status: 'unavailable', reason },
      });

      generateButton()?.click();
      await settle();

      const notice = el('commit-generate-notice');
      expect(textarea()?.value).toBe('my own words');
      expect(textarea()?.disabled).toBe(false);
      // MOD-2: the text lands in the persistent live region.
      expect(notice?.closest('[role="status"]')).toBe(
        el('commit-generate-status'),
      );
      expect(textOf('commit-generate-notice')).toBe(
        `Message generation unavailable — type your own. ${why}`,
      );
      expect(textarea()?.getAttribute('aria-describedby')).toBe(notice?.id);
    },
  );

  it('a failed or thrown generate request keeps the typed text', async () => {
    await type('draft');
    sourceControl.generateCommitMessage.mockResolvedValueOnce({
      success: false,
      error: 'IPC channel closed',
    });
    generateButton()?.click();
    await settle();
    expect(textarea()?.value).toBe('draft');
    expect(textOf('commit-generate-notice')).toContain('The request failed.');

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sourceControl.generateCommitMessage.mockRejectedValueOnce(new Error('x'));
    generateButton()?.click();
    await settle();
    expect(textarea()?.value).toBe('draft');
    expect(textOf('commit-generate-notice')).toContain(
      'Message generation unavailable',
    );
  });

  it('a generation timeout gets its own message (MIN-2)', async () => {
    sourceControl.generateCommitMessage.mockResolvedValueOnce({
      success: false,
      error: 'RPC timeout: git:generateCommitMessage',
    });
    generateButton()?.click();
    await settle();

    expect(textOf('commit-generate-notice')).toBe(
      'Message generation unavailable — type your own. The request timed out.',
    );
  });

  it('keeps both status regions in the DOM before anything is announced (MOD-2)', () => {
    for (const id of ['commit-generate-status', 'commit-status']) {
      expect(el(id)?.getAttribute('role')).toBe('status');
      expect(textOf(id)).toBe('');
    }
  });

  it('never overwrites text typed while the message was being written', async () => {
    const reply = deferred<RpcCallResult<GitGenerateCommitMessageResult>>();
    sourceControl.generateCommitMessage.mockReturnValue(reply.promise);
    generateButton()?.click();
    await settle();

    await type('typed meanwhile');
    reply.resolve({
      success: true,
      data: { status: 'generated', message: 'feat: generated' },
    });
    await settle();

    expect(textarea()?.value).toBe('typed meanwhile');
    expect(textOf('commit-generate-notice')).toContain('your text was kept');
  });

  // -- Commit with streamed hook output (Requirements 9.1, 9.3) ---------------

  it('commits the trimmed message with a fresh operationId', async () => {
    await startCommit('  feat: add composer \n');

    expect(sourceControl.commit).toHaveBeenCalledTimes(1);
    const [message, operationId] = sourceControl.commit.mock.calls[0] as [
      string,
      string,
    ];
    expect(message).toBe('feat: add composer');
    expect(operationId).toBe(OPERATION_ID);
    expect(operationId).toMatch(/^[\w.:-]{1,128}$/);
  });

  it('while running: Committing…, a locked field, Cancel and an open live log', async () => {
    await startCommit();

    const log = el('commit-hook-output');
    expect(textOf('commit-submit')).toBe('Committing…');
    expect(commitButton()?.disabled).toBe(true);
    expect(generateButton()?.disabled).toBe(true);
    expect(textarea()?.disabled).toBe(true);
    expect(el('commit-cancel')).not.toBeNull();
    expect(log?.getAttribute('role')).toBe('log');
    expect(log?.getAttribute('aria-live')).toBe('polite');
    expect(log?.getAttribute('aria-label')).toBe('Commit hook output');
    expect(log?.getAttribute('tabindex')).toBe('0');
  });

  it('appends chunks in order for its own operationId only', async () => {
    await startCommit();

    push(OPERATION_ID, 'eslint ');
    push('another-op', 'not mine\n');
    push(OPERATION_ID, 'ok\n', 'stderr');
    push(OPERATION_ID, 'commitlint…');
    fixture.detectChanges();

    expect(el('commit-hook-output')?.textContent).toBe(
      'eslint ok\ncommitlint…',
    );
  });

  it('ignores malformed output pushes', async () => {
    await startCommit();

    output.handleMessage({
      type: MESSAGE_TYPES.GIT_OPERATION_OUTPUT,
      payload: { operationId: OPERATION_ID, stream: 'stdin', chunk: 'x' },
    });
    output.handleMessage({
      type: MESSAGE_TYPES.GIT_OPERATION_OUTPUT,
      payload: { operationId: OPERATION_ID, stream: 'stdout', chunk: 4 },
    });
    output.handleMessage({ type: MESSAGE_TYPES.GIT_OPERATION_OUTPUT });
    fixture.detectChanges();

    expect(el('commit-hook-output')?.textContent).toBe('');
  });

  it('caps the rendered log and marks older output as not shown', async () => {
    await startCommit();

    const line = `${'x'.repeat(99)}\n`;
    for (let i = 0; i < 700; i++) push(OPERATION_ID, line);
    push(OPERATION_ID, 'last line');
    fixture.detectChanges();

    const text = el('commit-hook-output')?.textContent ?? '';
    expect(text.startsWith('[earlier output not shown]\n')).toBe(true);
    expect(text.endsWith('last line')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(
      COMMIT_LOG_RENDER_CAP + '[earlier output not shown]\n'.length,
    );
    // Starts on a whole line after the notice.
    expect(text.split('\n')[1]).toBe('x'.repeat(99));
  });

  it('success shows hash and subject, clears the message, hides the log and re-reads status', async () => {
    const region = el('commit-status');
    const reply = await startCommit();
    push(OPERATION_ID, 'hooks ok\n');

    await finish(reply, {
      success: true,
      data: {
        success: true,
        commitHash: 'a1b2c3d',
        subject: 'feat: add composer',
      },
    });

    // MOD-2: announced through the region that was there all along.
    expect(el('commit-status')).toBe(region);
    expect(el('commit-success')?.closest('[role="status"]')).toBe(region);
    expect(textOf('commit-success')).toBe(
      'committed a1b2c3d feat: add composer',
    );
    expect(textarea()?.value).toBe('');
    expect(textarea()?.disabled).toBe(false);
    expect(el('commit-hook-output')).toBeNull();
    expect(el('commit-cancel')).toBeNull();
    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
  });

  it('stops listening once the commit settles', async () => {
    const reply = await startCommit();
    await finish(reply, {
      success: true,
      data: { success: false, code: 'HOOK_FAILED', error: 'hook' },
    });
    push(OPERATION_ID, 'late\n');
    fixture.detectChanges();

    expect(el('commit-hook-output')).toBeNull();
  });

  // -- Failure (Requirement 9.4, RC1) ----------------------------------------

  it('a hook failure keeps the message and the streamed log open under an alert', async () => {
    const reply = await startCommit();
    push(OPERATION_ID, '✓ eslint\n✗ commitlint: subject may not be empty\n');

    await finish(reply, {
      success: true,
      data: {
        success: false,
        code: 'HOOK_FAILED',
        error: 'hook failed',
        hookOutput: '✓ eslint\n✗ commitlint: subject may not be empty\n',
      },
    });

    expect(el('commit-failure')?.getAttribute('role')).toBe('alert');
    expect(textOf('commit-failure')).toBe(
      'Commit blocked by a hook. Your message was kept.',
    );
    expect(textarea()?.value).toBe('feat: add composer');
    expect(el('commit-hook-output')?.textContent).toBe(
      '✓ eslint\n✗ commitlint: subject may not be empty\n',
    );
    expect(commitButton()?.disabled).toBe(false);
  });

  it('shows the result hook output when nothing was streamed', async () => {
    const reply = await startCommit();

    await finish(reply, {
      success: true,
      data: {
        success: false,
        code: 'HOOK_FAILED',
        hookOutput: 'pre-commit: lint failed\n',
      },
    });

    expect(el('commit-hook-output')?.textContent).toBe(
      'pre-commit: lint failed\n',
    );
  });

  it('a transport failure is a failure, never a success', async () => {
    const reply = await startCommit();

    await finish(reply, { success: false, error: 'IPC channel closed' });

    expect(textOf('commit-failure')).toBe(
      'Commit failed: Could not reach git: IPC channel closed Your message was kept.',
    );
    expect(el('commit-success')).toBeNull();
    expect(textarea()?.value).toBe('feat: add composer');
  });

  // -- A commit that outlasts the RPC timeout (MOD-1, SER-1, MOD-5, MIN-6) ----

  const TIMEOUT_REPLY = { success: false, error: 'RPC timeout: git:commit' };

  /** Make the next HEAD read answer with `hash` / `subject`. */
  function nextHead(hash: string, subject: string): void {
    gitBranches.refreshForCauses.mockImplementationOnce(async () => {
      gitBranches.lastCommit.set({
        hash,
        shortHash: hash.slice(0, 7),
        subject,
      } as GitLastCommitResult);
    });
  }

  const UNCONFIRMED_NOT_FOUND =
    'Git did not answer in time and no new commit shows yet. It may still be running: cancel it, or commit again once it has stopped. Your message was kept.';

  it('on a timeout: checks with Cancel available, then a moved HEAD with this subject reads as committed', async () => {
    const reply = await startCommit('feat: add composer\n\nbody text');
    const refreshed = deferred<undefined>();
    gitStatus.refresh.mockReturnValueOnce(refreshed.promise);
    nextHead('head-after-0000', 'feat: add composer');

    await finish(reply, TIMEOUT_REPLY);

    expect(textOf('commit-checking')).toBe(
      'Git did not answer in time — checking whether the commit was made…',
    );
    expect(el('commit-checking')?.closest('[role="status"]')).toBe(
      el('commit-status'),
    );
    expect(textOf('commit-submit')).toBe('Checking…');
    expect(el('commit-cancel')).not.toBeNull();
    expect(el('commit-failure')).toBeNull();
    expect(gitBranches.refreshForCauses).toHaveBeenCalledWith(['head']);

    refreshed.resolve(undefined);
    await settle();

    expect(textOf('commit-success')).toBe(
      'committed head-af feat: add composer',
    );
    expect(textarea()?.value).toBe('');
    expect(el('commit-cancel')).toBeNull();
    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
  });

  it('on a timeout: HEAD moved to a commit with another subject is unconfirmed, never committed (SER-1)', async () => {
    const reply = await startCommit();
    nextHead('head-other', 'chore: someone else');

    await finish(reply, TIMEOUT_REPLY);

    expect(el('commit-success')).toBeNull();
    expect(textOf('commit-failure')).toBe(
      'Git did not answer in time and the newest commit is not this one. It may still be running: cancel it, or check the history before committing again. Your message was kept.',
    );
    expect(textarea()?.value).toBe('feat: add composer');
    expect(el('commit-cancel')).not.toBeNull();
  });

  it('on a timeout: a changed staged set with HEAD unmoved is unconfirmed, never committed (SER-1)', async () => {
    const reply = await startCommit();
    gitStatus.refresh.mockImplementationOnce(async () => {
      gitStatus.stagedFiles.set([]);
    });

    await finish(reply, TIMEOUT_REPLY);

    expect(el('commit-success')).toBeNull();
    expect(textOf('commit-failure')).toBe(UNCONFIRMED_NOT_FOUND);
    expect(textarea()?.value).toBe('feat: add composer');
    expect(el('commit-cancel')).not.toBeNull();
  });

  it('on a timeout with nothing changed: says the outcome is unconfirmed, keeps Cancel by operationId, and allows a retry', async () => {
    const reply = await startCommit();
    await finish(reply, TIMEOUT_REPLY);

    expect(el('commit-failure')?.getAttribute('role')).toBe('alert');
    expect(textOf('commit-failure')).toBe(UNCONFIRMED_NOT_FOUND);
    expect(textOf('commit-failure')).not.toContain('Commit failed');
    expect(textarea()?.value).toBe('feat: add composer');
    expect(commitButton()?.disabled).toBe(false);

    el<HTMLButtonElement>('commit-cancel')?.click();
    await settle();

    expect(sourceControl.cancelOperation).toHaveBeenCalledWith(OPERATION_ID);
    expect(textOf('commit-cancelled')).toBe(
      'Commit cancelled. Your message was kept.',
    );
    expect(el('commit-cancel')).toBeNull();
  });

  it('on a timeout whose HEAD read failed: unknown, not "HEAD did not move" (MIN-6)', async () => {
    const reply = await startCommit();
    // The read fails: GitBranchesService keeps its previous value.
    gitBranches.refreshForCauses.mockImplementationOnce(async () => undefined);

    await finish(reply, TIMEOUT_REPLY);

    expect(textOf('commit-failure')).toContain(
      'the status could not be checked',
    );
    expect(el('commit-cancel')).not.toBeNull();
  });

  it('on a timeout: a HEAD read for another workspace is unknown, even with this subject (MIN-6)', async () => {
    const reply = await startCommit();
    gitBranches.workspaceRoot.mockReturnValue('/ws/other');
    nextHead('head-after', 'feat: add composer');

    await finish(reply, TIMEOUT_REPLY);

    expect(el('commit-success')).toBeNull();
    expect(textOf('commit-failure')).toContain(
      'the status could not be checked',
    );
    expect(textarea()?.value).toBe('feat: add composer');
  });

  it('Cancel during the check answered cancelled:false never reads as cancelled (MOD-5)', async () => {
    const reply = await startCommit();
    const refreshed = deferred<undefined>();
    gitStatus.refresh.mockReturnValueOnce(refreshed.promise);
    await finish(reply, TIMEOUT_REPLY);
    sourceControl.cancelOperation.mockResolvedValueOnce({
      success: true,
      data: { cancelled: false },
    });

    el<HTMLButtonElement>('commit-cancel')?.click();
    await settle();
    refreshed.resolve(undefined);
    await settle();

    expect(el('commit-cancelled')).toBeNull();
    expect(textOf('commit-status')).not.toContain('cancelled');
    expect(textOf('commit-failure')).toBe(UNCONFIRMED_NOT_FOUND);
    expect(el('commit-cancel')).not.toBeNull();
  });

  it('Cancel during the check that git accepted reads as cancelled (MOD-5)', async () => {
    const reply = await startCommit();
    const refreshed = deferred<undefined>();
    gitStatus.refresh.mockReturnValueOnce(refreshed.promise);
    await finish(reply, TIMEOUT_REPLY);

    el<HTMLButtonElement>('commit-cancel')?.click();
    await settle();
    refreshed.resolve(undefined);
    await settle();

    expect(textOf('commit-cancelled')).toBe(
      'Commit cancelled. Your message was kept.',
    );
    expect(textarea()?.value).toBe('feat: add composer');
  });

  it('cancelling an unconfirmed commit that already ended re-checks HEAD and its subject', async () => {
    const reply = await startCommit();
    await finish(reply, TIMEOUT_REPLY);
    sourceControl.cancelOperation.mockResolvedValueOnce({
      success: true,
      data: { cancelled: false },
    });
    nextHead('head-after', 'feat: add composer');

    el<HTMLButtonElement>('commit-cancel')?.click();
    await settle();

    expect(el('commit-success')).not.toBeNull();
    expect(el('commit-cancelled')).toBeNull();
    expect(textarea()?.value).toBe('');
  });

  it('cancelling an unconfirmed commit that ended without committing reports a failure', async () => {
    const reply = await startCommit();
    await finish(reply, TIMEOUT_REPLY);
    sourceControl.cancelOperation.mockResolvedValueOnce({
      success: true,
      data: { cancelled: false },
    });

    el<HTMLButtonElement>('commit-cancel')?.click();
    await settle();

    expect(textOf('commit-failure')).toBe(
      'Commit failed: git stopped without making the commit. Your message was kept.',
    );
    expect(el('commit-cancel')).toBeNull();
  });

  it('a held lock reads as the lock message', async () => {
    const reply = await startCommit();

    await finish(reply, {
      success: true,
      data: { success: false, code: 'LOCKED', error: 'index.lock exists' },
    });

    expect(textOf('commit-failure')).not.toContain('index.lock');
    expect(textOf('commit-failure')).toContain('Commit failed:');
  });

  it('a thrown commit call is reported and keeps the message', async () => {
    sourceControl.commit.mockRejectedValue(new Error('boom'));
    await type('fix: y');
    commitButton()?.click();
    await settle();

    expect(textOf('commit-failure')).toBe(
      'Commit failed: Could not reach git: boom Your message was kept.',
    );
    expect(textarea()?.value).toBe('fix: y');
  });

  // -- Cancel ----------------------------------------------------------------

  it('Cancel asks git:cancelOperation and reports a cancelled commit', async () => {
    const reply = await startCommit();
    push(OPERATION_ID, 'running hook…\n');

    el<HTMLButtonElement>('commit-cancel')?.click();
    await settle();

    expect(sourceControl.cancelOperation).toHaveBeenCalledWith(OPERATION_ID);
    expect(textOf('commit-cancel')).toBe('Cancelling…');
    expect(el<HTMLButtonElement>('commit-cancel')?.disabled).toBe(true);

    await finish(reply, {
      success: true,
      data: { success: false, code: 'CANCELLED', error: 'cancelled' },
    });

    expect(el('commit-cancelled')?.closest('[role="status"]')).toBe(
      el('commit-status'),
    );
    expect(textOf('commit-cancelled')).toBe(
      'Commit cancelled. Your message was kept.',
    );
    expect(textarea()?.value).toBe('feat: add composer');
    expect(el('commit-hook-output')?.textContent).toBe('running hook…\n');
    expect(el('commit-cancel')).toBeNull();
  });

  it('re-enables Cancel when the cancel request never reached git', async () => {
    await startCommit();
    sourceControl.cancelOperation.mockResolvedValueOnce({
      success: false,
      error: 'RPC timeout',
    });

    el<HTMLButtonElement>('commit-cancel')?.click();
    await settle();

    expect(textOf('commit-cancel')).toBe('Cancel');
    expect(el<HTMLButtonElement>('commit-cancel')?.disabled).toBe(false);
  });

  // -- Workspaces ------------------------------------------------------------

  it('keeps one draft per workspace', async () => {
    await type('draft for a');
    gitStatus.activeWorkspacePath.set('/ws/b');
    await settle();
    expect(textarea()?.value).toBe('');

    gitStatus.activeWorkspacePath.set('/ws/a');
    await settle();
    expect(textarea()?.value).toBe('draft for a');
  });

  // -- Accessibility ---------------------------------------------------------

  it('labels the message field and uses no alpha text colours', () => {
    const field = textarea();
    const label = (fixture.nativeElement as HTMLElement).querySelector(
      `label[for="${field?.id}"]`,
    );
    expect(label?.textContent?.trim()).toBe('Commit message');
    expect((fixture.nativeElement as HTMLElement).innerHTML).not.toMatch(
      /text-base-content\/\d/,
    );
  });

  it('has no axe violations while a commit runs with output', async () => {
    await startCommit();
    push(OPERATION_ID, 'eslint ok\n');
    fixture.detectChanges();

    const results = await axe.run(
      fixture.nativeElement as Parameters<typeof axe.run>[0],
      {
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
        },
      },
    );

    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.html),
      })),
    ).toEqual([]);
  });
});
