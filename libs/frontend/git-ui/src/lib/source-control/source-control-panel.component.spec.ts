/**
 * SourceControlPanelComponent specs — D1 (TASK_2026_173).
 *
 * Both section headers used to be a single `<button>` with the stage-all /
 * unstage-all `<button>` nested INSIDE it. Nested interactive content inside a
 * `<button>` is invalid HTML — the browser flattens it — and it is why
 * `onStageAll` / `onUnstageAll` had to call `event.stopPropagation()`: without
 * that, staging everything also collapsed the section you were looking at.
 *
 * Each header is now a presentational row holding a disclosure `<button>` and
 * the bulk-action `<button>` as SIBLINGS, both handlers take no event, and the
 * disclosure state is announced via `aria-expanded` + `aria-controls` instead
 * of being carried by the chevron glyph alone.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  GIT_HOOK_TIMEOUT_MS,
  GIT_LOCKED_MESSAGE,
  gitRpcTimeoutFor,
} from '@ptah-extension/shared';
import type {
  GitFileStatus,
  GitStatusUnavailableReason,
} from '@ptah-extension/shared';
import { SourceControlPanelComponent } from './source-control-panel.component';
import { SourceControlFileComponent } from './source-control-file.component';
import { SourceControlService } from '../services/source-control.service';
import { GitStatusService } from '../services/git-status.service';

/**
 * `rpcCall` is mocked at the module boundary for the SourceControlService
 * timeout block at the end of this file (the panel suites use a service stub
 * and never reach it). Same pattern as `git-branches.service.spec.ts`.
 */
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
const { VSCodeService } = jest.requireActual('@ptah-extension/core');

/**
 * The worktree section pulls WorktreeService / EditorService / the Electron
 * layout service, none of which this suite is about — stub the selector out.
 */
@Component({
  selector: 'ptah-worktree-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubWorktreeSectionComponent {}

/** Every element a keyboard user or the browser treats as interactive. */
const INTERACTIVE = 'a[href], button, input, select, textarea, [tabindex]';

/** A git mutation that git itself reports as done. */
const GIT_OK = { success: true, data: { success: true } };

/**
 * The failure the commit mock returns by default: the RPC round trip worked
 * and git refused. The old `{ success: true }` mock hid exactly the bug RC1
 * fixes — a transport success read as a git success.
 */
const HOOK_FAILED = {
  success: true,
  data: {
    success: false,
    code: 'HOOK_FAILED',
    error: 'pre-commit hook exited with 1',
    hookOutput: 'lint failed\n  src/a.ts:1 no-unused-vars',
    exitCode: 1,
  },
};

function makeSourceControlStub() {
  return {
    stageFile: jest.fn(async () => GIT_OK),
    unstageFile: jest.fn(async () => GIT_OK),
    discardChanges: jest.fn(async () => GIT_OK),
    stageAll: jest.fn(async () => GIT_OK),
    unstageAll: jest.fn(async () => GIT_OK),
    commit: jest.fn(async (): Promise<unknown> => HOOK_FAILED),
  };
}

function makeGitStatusStub() {
  return { refresh: jest.fn(async () => undefined) };
}

@Component({
  standalone: true,
  imports: [SourceControlPanelComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `<ptah-source-control-panel
    [files]="files()"
    [workspaceRoot]="workspaceRoot()"
    [statusUnavailable]="statusUnavailable()"
    [staleReason]="staleReason()"
    (diffRequested)="diffRequested.push($event)"
  />`,
})
class HostComponent {
  readonly workspaceRoot = signal('/ws/a');
  readonly statusUnavailable = signal<GitStatusUnavailableReason | null>(null);
  readonly staleReason = signal<GitStatusUnavailableReason | null>(null);
  readonly files = signal<GitFileStatus[]>([
    { path: 'src/a.ts', status: 'M', staged: true } as GitFileStatus,
    { path: 'src/b.ts', status: 'A', staged: false } as GitFileStatus,
  ]);
  readonly diffRequested: unknown[] = [];
}

describe('SourceControlPanelComponent — header controls are siblings, not nested (D1)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let sourceControl: ReturnType<typeof makeSourceControlStub>;
  let gitStatus: ReturnType<typeof makeGitStatusStub>;

  function q<T extends HTMLElement>(selector: string): T {
    const el = fixture.nativeElement.querySelector(selector) as T | null;
    expect(el).toBeTruthy();
    return el as T;
  }

  const stagedToggle = () =>
    q<HTMLButtonElement>('button[aria-label="Toggle staged changes section"]');
  const unstagedToggle = () =>
    q<HTMLButtonElement>('button[aria-label="Toggle changes section"]');
  const unstageAll = () =>
    q<HTMLButtonElement>('button[aria-label="Unstage all files"]');
  const stageAll = () =>
    q<HTMLButtonElement>('button[aria-label="Stage all files"]');

  function clickReal(el: HTMLElement): void {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  }

  beforeEach(() => {
    sourceControl = makeSourceControlStub();
    gitStatus = makeGitStatusStub();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: SourceControlService, useValue: sourceControl },
        { provide: GitStatusService, useValue: gitStatus },
      ],
    });
    TestBed.overrideComponent(SourceControlPanelComponent, {
      set: {
        imports: [
          FormsModule,
          NgTemplateOutlet,
          LucideAngularModule,
          SourceControlFileComponent,
          StubWorktreeSectionComponent,
        ],
      },
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  // -- AC1 -------------------------------------------------------------------

  it('renders no interactive element inside another interactive element (AC1)', () => {
    const nested: string[] = [];
    for (const el of fixture.nativeElement.querySelectorAll(INTERACTIVE)) {
      // The walk MUST start at the parent: `closest` matches the element
      // itself, so a self-comparing variant of this check silently passes
      // even on the pre-batch-6 nested markup.
      if ((el as HTMLElement).parentElement?.closest(INTERACTIVE)) {
        nested.push((el as HTMLElement).outerHTML.slice(0, 140));
      }
    }
    expect(nested).toEqual([]);
  });

  it('keeps each bulk action a sibling of its disclosure toggle (AC1)', () => {
    expect(unstageAll().parentElement).toBe(stagedToggle().parentElement);
    expect(stageAll().parentElement).toBe(unstagedToggle().parentElement);
    expect(stagedToggle().contains(unstageAll())).toBe(false);
    expect(unstagedToggle().contains(stageAll())).toBe(false);
    // The header row itself is not a control.
    expect(stagedToggle().parentElement?.tagName).toBe('DIV');
  });

  // -- AC3/AC4: the disclosure state is announced ----------------------------

  it('announces the disclosure state and the region each toggle controls (AC3, AC4)', () => {
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');

    const stagedRegionId = stagedToggle().getAttribute('aria-controls');
    expect(stagedRegionId).toBeTruthy();
    const stagedRegion = document.getElementById(
      stagedRegionId as string,
    ) as HTMLElement | null;
    expect(stagedRegion).toBeTruthy();
    expect(stagedRegion?.getAttribute('aria-label')).toBe('Staged files');

    // Every toggle points at a DIFFERENT region.
    expect(unstagedToggle().getAttribute('aria-controls')).not.toBe(
      stagedRegionId,
    );

    clickReal(stagedToggle());
    fixture.detectChanges();

    expect(stagedToggle().getAttribute('aria-expanded')).toBe('false');
    // The other section is untouched.
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Staged files"]'),
    ).toBeNull();
  });

  it('labels every header control distinctly (AC4)', () => {
    const labels = [
      stagedToggle(),
      unstageAll(),
      unstagedToggle(),
      stageAll(),
    ].map((b) => b.getAttribute('aria-label'));

    expect(labels).toEqual([
      'Toggle staged changes section',
      'Unstage all files',
      'Toggle changes section',
      'Stage all files',
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // -- AC5: isolation without stopPropagation --------------------------------

  it('unstages everything WITHOUT collapsing the staged section (AC5)', () => {
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');

    clickReal(unstageAll());
    fixture.detectChanges();

    expect(sourceControl.unstageAll).toHaveBeenCalledTimes(1);
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('stages everything WITHOUT collapsing the changes section (AC5)', () => {
    clickReal(stageAll());
    fixture.detectChanges();

    expect(sourceControl.stageAll).toHaveBeenCalledTimes(1);
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('lets the bulk-action click keep bubbling — isolation is structural, not a stopped event (AC5)', () => {
    const reachedRoot: string[] = [];
    fixture.nativeElement.addEventListener('click', () => {
      reachedRoot.push('root');
    });

    clickReal(stageAll());
    fixture.detectChanges();

    // Nothing suppresses propagation any more; the toggle simply is not an
    // ancestor of the bulk-action button.
    expect(reachedRoot).toEqual(['root']);
    expect(sourceControl.stageAll).toHaveBeenCalledTimes(1);
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('still toggles the section when the disclosure button itself is clicked (AC5)', () => {
    clickReal(unstagedToggle());
    fixture.detectChanges();

    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('false');
    expect(sourceControl.stageAll).not.toHaveBeenCalled();
  });

  // -- AC2/AC7 ---------------------------------------------------------------

  it('gives each header control independent keyboard focus and a focus ring (AC2, AC7)', () => {
    // jsdom does not implement the UA default action that turns Enter/Space on
    // a <button> into a click, so the key press itself cannot be asserted
    // here. What is asserted is the property that buys it unconditionally:
    // four separate, natively focusable, in-tab-order <button>s.
    const controls = [
      stagedToggle(),
      unstageAll(),
      unstagedToggle(),
      stageAll(),
    ];
    for (const el of controls) {
      expect(el.tagName).toBe('BUTTON');
      expect(el.type).toBe('button');
      expect(el.getAttribute('tabindex')).toBeNull();
      el.focus();
      expect(document.activeElement).toBe(el);
      expect(el.className).toContain('focus-visible:outline-2');
    }
    expect(new Set(controls).size).toBe(4);
  });

  // -- AC6 -------------------------------------------------------------------

  it('keeps the header chrome — including the shared opacity — on the header row (AC6)', () => {
    const row = stagedToggle().parentElement as HTMLElement;
    for (const cls of [
      'flex',
      'items-center',
      'gap-1',
      'w-full',
      'px-2',
      'py-1',
      'text-[10px]',
      'font-semibold',
      'uppercase',
      'tracking-wider',
      'bg-base-200',
      'transition-opacity',
    ]) {
      expect(row.className).toContain(cls);
    }
    // opacity-70/hover:opacity-100 stays on the ROW, not on the toggle, so the
    // bulk-action button's resting opacity is exactly what it was before.
    expect(row.className).toContain('opacity-70');
    expect(row.className).toContain('hover:opacity-100');
    expect(unstageAll().className).not.toContain('opacity-70');

    // The bulk action is still pushed to the right edge and is always visible
    // (these two are NOT hover-gated, unlike the tab close and the row actions).
    expect(unstageAll().className).toContain('ml-auto');
    expect(unstageAll().className).toContain('btn-ghost');
    expect(unstageAll().className).not.toContain('opacity-0');
  });

  it('repeats `uppercase` on the toggle, which the button preflight would otherwise strip (AC6)', () => {
    // Tailwind preflight sets `text-transform: none` on <button>. Now that the
    // header text lives INSIDE a button instead of being the button, the
    // inherited `uppercase` from the row is reset and the label silently drops
    // out of caps — measured as a 108.39px -> 96.78px label in Chromium before
    // this class was added back. jsdom applies no stylesheet, so assert the
    // class rather than the computed style.
    expect(stagedToggle().className).toContain('uppercase');
    expect(unstagedToggle().className).toContain('uppercase');
  });

  // -- TASK_2026_211: empty-state list ownership ------------------------------

  /**
   * Every element child of a `role="list"` that the accessibility tree does
   * NOT resolve to a `listitem`.
   *
   * The walk descends through `role="presentation"` / `role="none"` hosts and
   * nothing else, which is exactly how an owned-element check resolves this
   * panel's markup: `<ptah-source-control-file>` carries `role="presentation"`
   * on its host precisely so the `role="listitem"` div inside it is owned by
   * the list. Anything else — notably a bare `<div>`, whose implicit role is
   * `generic` — is an unowned child and a critical `aria-required-children`
   * violation.
   */
  function unownedChildren(list: HTMLElement): HTMLElement[] {
    const offenders: HTMLElement[] = [];
    const visit = (parent: Element): void => {
      for (const child of Array.from(parent.children) as HTMLElement[]) {
        const role = child.getAttribute('role');
        if (role === 'listitem') continue;
        if (role === 'presentation' || role === 'none') {
          visit(child);
          continue;
        }
        offenders.push(child);
      }
    };
    visit(list);
    return offenders;
  }

  const lists = () =>
    Array.from(
      fixture.nativeElement.querySelectorAll('[role="list"]'),
    ) as HTMLElement[];

  it('detects an unowned child — the checker above is not vacuous (TASK_2026_211)', () => {
    // Without this, every assertion below would still pass if `unownedChildren`
    // silently returned []. Re-creates the exact defect shape: a bare <div>
    // dropped straight into the list region.
    const [staged] = lists();
    const bare = document.createElement('div');
    bare.textContent = 'No staged changes';
    staged.appendChild(bare);

    expect(unownedChildren(staged)).toEqual([bare]);

    staged.removeChild(bare);
    expect(unownedChildren(staged)).toEqual([]);
  });

  it('owns the empty-state message of BOTH sections as a listitem (TASK_2026_211)', () => {
    fixture.componentInstance.files.set([]);
    fixture.detectChanges();

    const regions = lists();
    expect(regions.length).toBe(2);

    for (const region of regions) {
      // The section is empty, so the empty-state message is the only child —
      // and it must be the list's own item, not an orphan inside it.
      expect(unownedChildren(region)).toEqual([]);
      expect(region.children.length).toBe(1);
      expect(region.children[0].getAttribute('role')).toBe('listitem');
    }

    expect(regions.map((r) => (r.textContent ?? '').trim())).toEqual([
      'No staged changes',
      'No changes',
    ]);
  });

  it('keeps both empty-state messages visually unchanged (TASK_2026_211)', () => {
    fixture.componentInstance.files.set([]);
    fixture.detectChanges();

    for (const region of lists()) {
      const message = region.children[0] as HTMLElement;
      // role= is the whole change; the presentation must not have moved.
      for (const cls of [
        'px-3',
        'py-2',
        'text-[10px]',
        'opacity-40',
        'text-center',
      ]) {
        expect(message.className).toContain(cls);
      }
    }
  });

  it('owns every child in the half-empty and populated states too (TASK_2026_211)', () => {
    // Populated on both sides (the fixture default) — the state Batch 6's own
    // axe run used, which is why it never saw the defect.
    for (const region of lists()) {
      expect(unownedChildren(region)).toEqual([]);
    }

    // One side empty, one side populated — the mixed case neither the
    // populated run nor a both-empty run would cover.
    fixture.componentInstance.files.set([
      { path: 'src/b.ts', status: 'A', staged: false } as GitFileStatus,
    ]);
    fixture.detectChanges();

    const regions = lists();
    expect(regions.length).toBe(2);
    expect(unownedChildren(regions[0])).toEqual([]);
    expect(regions[0].children[0].getAttribute('role')).toBe('listitem');
    expect((regions[0].textContent ?? '').trim()).toBe('No staged changes');
    expect(unownedChildren(regions[1])).toEqual([]);
  });

  it('renders paths as collapsible nested lists and folders never request a diff', () => {
    fixture.componentInstance.files.set([
      {
        path: '.github/workflows/ci.yml',
        status: '??',
        staged: false,
      } as GitFileStatus,
      {
        path: '.github/ISSUE_TEMPLATE/bug.md',
        status: '??',
        staged: false,
      } as GitFileStatus,
    ]);
    fixture.detectChanges();

    const github = q<HTMLButtonElement>(
      'button[aria-label="Toggle .github folder"]',
    );
    expect(github.getAttribute('aria-expanded')).toBe('false');
    expect(
      fixture.nativeElement.querySelector(
        'button[aria-label="Open diff for ci.yml"]',
      ),
    ).toBeNull();

    clickReal(github);
    fixture.detectChanges();

    expect(github.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.componentInstance.diffRequested).toEqual([]);
    const workflows = q<HTMLButtonElement>(
      'button[aria-label="Toggle workflows folder"]',
    );
    expect(workflows.getAttribute('aria-expanded')).toBe('false');
    expect(github.getAttribute('aria-controls')).toBe(
      workflows.closest('[role="list"]')?.id,
    );

    clickReal(workflows);
    fixture.detectChanges();
    clickReal(
      q<HTMLButtonElement>('button[aria-label="Open diff for ci.yml"]'),
    );

    expect(fixture.componentInstance.diffRequested).toEqual([
      { path: '.github/workflows/ci.yml', comparison: 'worktree' },
    ]);
    for (const region of lists()) {
      expect(unownedChildren(region)).toEqual([]);
    }
  });

  it('renders every changed file that shares the same folder', () => {
    fixture.componentInstance.files.set([
      { path: 'src/a.ts', status: 'M', staged: false } as GitFileStatus,
      { path: 'src/c.ts', status: 'M', staged: false } as GitFileStatus,
    ]);
    fixture.detectChanges();
    clickReal(q<HTMLButtonElement>('button[aria-label="Toggle src folder"]'));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-source-control-file'),
    ).toHaveLength(2);
  });

  it('turns a legacy directory status row into a folder control, never a file row', () => {
    fixture.componentInstance.files.set([
      {
        path: '.github',
        status: '??',
        staged: false,
        isDirectory: true,
      } as GitFileStatus,
    ]);
    fixture.detectChanges();

    clickReal(
      q<HTMLButtonElement>('button[aria-label="Toggle .github folder"]'),
    );
    fixture.detectChanges();

    expect(fixture.componentInstance.diffRequested).toEqual([]);
    expect(
      fixture.nativeElement.querySelector(
        'button[aria-label^="Open diff for"]',
      ),
    ).toBeNull();
  });

  // -- TASK_2026_437: status unavailable --------------------------------------

  it('renders the unavailable notice instead of "No changes" or any count when status could not be read', () => {
    const noticeText =
      'Git status is unavailable (the status output is too large to read).';
    fixture.componentInstance.files.set([]);
    fixture.componentInstance.statusUnavailable.set('output-too-large');
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector(
      '[data-testid="git-status-unavailable"]',
    ) as HTMLElement | null;
    expect(notice).toBeTruthy();
    expect(notice?.getAttribute('role')).toBe('status');
    expect((notice?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      noticeText,
    );

    const text = (fixture.nativeElement.textContent ?? '') as string;
    expect(text).not.toContain('No changes');
    expect(text).not.toContain('No staged changes');
    expect(text).not.toMatch(/Changes \(\d+\)/);
    expect(lists()).toHaveLength(0);

    // A later readable result restores the normal sections.
    fixture.componentInstance.statusUnavailable.set(null);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="git-status-unavailable"]',
      ),
    ).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('No changes');
  });

  it('hides each bulk action when its section is empty (AC6)', () => {
    fixture.componentInstance.files.set([
      { path: 'src/b.ts', status: 'A', staged: false } as GitFileStatus,
    ]);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        'button[aria-label="Unstage all files"]',
      ),
    ).toBeNull();
    expect(stageAll()).toBeTruthy();
    // The toggle is unaffected by the action's absence.
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  // -- TASK_2026_576 RC1: every result is awaited and surfaced ----------------

  /** Let the awaited handler finish and the template catch up. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  const textOf = (el: Element | null): string =>
    (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  const textarea = () =>
    q<HTMLTextAreaElement>('textarea[aria-label="Commit message"]');
  const commitButton = () => q<HTMLButtonElement>('button.btn-primary');
  const rowErrors = () =>
    Array.from(
      fixture.nativeElement.querySelectorAll('[data-testid="git-row-error"]'),
    ) as HTMLElement[];

  /** Top-level files, so every row renders without opening a folder. */
  function useRootFiles(): void {
    fixture.componentInstance.files.set([
      { path: 'a.ts', status: 'M', staged: true } as GitFileStatus,
      { path: 'b.ts', status: 'M', staged: false } as GitFileStatus,
    ]);
    fixture.detectChanges();
  }

  async function typeAndCommit(message: string): Promise<void> {
    const field = textarea();
    field.value = message;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickReal(commitButton());
    await settle();
  }

  it('keeps the message and shows the hook output when a hook rejects the commit', async () => {
    await typeAndCommit('feat: add thing');

    expect(sourceControl.commit).toHaveBeenCalledWith('feat: add thing');
    expect(textarea().value).toBe('feat: add thing');

    const log = q<HTMLElement>('[role="log"]');
    expect(log.tagName).toBe('PRE');
    expect(log.getAttribute('aria-label')).toBe('Commit hook output');
    // Keyboard-scrollable: focusable, height-capped, scrolls.
    expect(log.getAttribute('tabindex')).toBe('0');
    expect(log.className).toContain('max-h-48');
    expect(log.className).toContain('overflow-y-auto');
    expect(log.textContent).toBe('lint failed\n  src/a.ts:1 no-unused-vars');

    const alert = q<HTMLElement>(
      '[data-testid="git-commit-failure"] [role="alert"]',
    );
    expect(textOf(alert)).toBe(
      'Commit failed: pre-commit hook exited with 1 Your message was kept.',
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-commit-success"]'),
    ).toBeNull();
    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears the message and shows the hash and subject when the commit succeeds', async () => {
    sourceControl.commit.mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        commitHash: 'a1b2c3d',
        subject: 'feat: add thing',
      },
    });

    await typeAndCommit('feat: add thing');

    expect(textarea().value).toBe('');
    const success = q<HTMLElement>('[data-testid="git-commit-success"]');
    expect(success.getAttribute('role')).toBe('status');
    expect(textOf(success)).toBe('Committed a1b2c3d feat: add thing');
    expect(fixture.nativeElement.querySelector('[role="log"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-commit-failure"]'),
    ).toBeNull();
    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
  });

  it('reports a transport failure as a transport error, never as a commit', async () => {
    sourceControl.commit.mockResolvedValueOnce({
      success: false,
      error: 'RPC timeout: git:commit',
    });

    await typeAndCommit('feat: add thing');

    expect(textarea().value).toBe('feat: add thing');
    expect(textOf(q('[data-testid="git-commit-failure"] [role="alert"]'))).toBe(
      'Commit failed: Could not reach git: RPC timeout: git:commit Your message was kept.',
    );
    expect(fixture.nativeElement.querySelector('[role="log"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-commit-success"]'),
    ).toBeNull();
  });

  it('treats a transport success without a git result as a failure', async () => {
    sourceControl.commit.mockResolvedValueOnce({ success: true });

    await typeAndCommit('feat: add thing');

    expect(textarea().value).toBe('feat: add thing');
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-commit-success"]'),
    ).toBeNull();
    expect(
      textOf(q('[data-testid="git-commit-failure"] [role="alert"]')),
    ).toContain('Git returned no result.');
  });

  it('reports a thrown commit call as a transport error and keeps the message', async () => {
    sourceControl.commit.mockRejectedValueOnce(new Error('IPC closed'));

    await typeAndCommit('feat: add thing');

    expect(textarea().value).toBe('feat: add thing');
    expect(
      textOf(q('[data-testid="git-commit-failure"] [role="alert"]')),
    ).toContain('Could not reach git: IPC closed');
    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
  });

  it('dismisses the commit error without touching the message', async () => {
    await typeAndCommit('feat: add thing');

    clickReal(q('button[aria-label="Dismiss commit error"]'));
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="git-commit-failure"]'),
    ).toBeNull();
    expect(textarea().value).toBe('feat: add thing');
  });

  it('shows a held lock as the lock message on the row, never the raw stderr', async () => {
    useRootFiles();
    sourceControl.stageFile.mockResolvedValueOnce({
      success: true,
      data: {
        success: false,
        code: 'LOCKED',
        error: "fatal: Unable to create '/home/me/repo/.git/index.lock'",
      },
    } as never);

    clickReal(q('button[aria-label="Stage file"]'));
    await settle();

    expect(sourceControl.stageFile).toHaveBeenCalledWith('b.ts');
    const errors = rowErrors();
    expect(errors).toHaveLength(1);
    expect(textOf(errors[0])).toBe(GIT_LOCKED_MESSAGE);
    expect(textOf(errors[0])).not.toContain('/home/me');
    // The error line is owned by the "Changed files" list, next to its row.
    expect(errors[0].getAttribute('role')).toBe('listitem');
    expect(errors[0].closest('[role="list"]')?.getAttribute('aria-label')).toBe(
      'Changed files',
    );
    expect(errors[0].querySelector('[role="alert"]')).toBeTruthy();
    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears a row error on the next success of that row', async () => {
    useRootFiles();
    sourceControl.discardChanges.mockResolvedValueOnce({
      success: true,
      data: {
        success: false,
        code: 'GIT_ERROR',
        error: 'pathspec did not match',
      },
    } as never);

    clickReal(
      q('[aria-label="Changed files"] button[aria-label="Discard changes"]'),
    );
    await settle();
    expect(rowErrors().map(textOf)).toEqual(['pathspec did not match']);

    clickReal(
      q('[aria-label="Changed files"] button[aria-label="Discard changes"]'),
    );
    await settle();

    expect(rowErrors()).toHaveLength(0);
    expect(gitStatus.refresh).toHaveBeenCalledTimes(2);
  });

  it('dismisses a row error from its own button', async () => {
    useRootFiles();
    sourceControl.unstageFile.mockResolvedValueOnce({
      success: false,
      error: 'RPC timeout: git:unstage',
    } as never);

    clickReal(q('button[aria-label="Unstage file"]'));
    await settle();
    expect(rowErrors().map(textOf)).toEqual([
      'Could not reach git: RPC timeout: git:unstage',
    ]);
    expect(
      rowErrors()[0].closest('[role="list"]')?.getAttribute('aria-label'),
    ).toBe('Staged files');

    clickReal(
      q('button[aria-label="Dismiss error for a.ts in staged changes"]'),
    );
    fixture.detectChanges();

    expect(rowErrors()).toHaveLength(0);
  });

  it('shows a failed stage-all under its section header, outside the list', async () => {
    sourceControl.stageAll.mockResolvedValueOnce({
      success: true,
      data: { success: false, error: 'index is corrupt' },
    } as never);

    clickReal(stageAll());
    await settle();

    const error = q<HTMLElement>('[data-testid="git-section-error"]');
    expect(textOf(error)).toBe('index is corrupt');
    expect(error.closest('[role="list"]')).toBeNull();
    for (const region of lists()) {
      expect(unownedChildren(region)).toEqual([]);
    }

    clickReal(q('button[aria-label="Dismiss stage all error"]'));
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-section-error"]'),
    ).toBeNull();
  });

  it('refreshes the status after every mutation, success or failure', async () => {
    useRootFiles();
    sourceControl.unstageAll.mockResolvedValueOnce({
      success: false,
      error: 'RPC timeout: git:unstage',
    } as never);

    clickReal(q('button[aria-label="Stage file"]'));
    await settle();
    clickReal(q('button[aria-label="Unstage file"]'));
    await settle();
    clickReal(
      q('[aria-label="Changed files"] button[aria-label="Discard changes"]'),
    );
    await settle();
    clickReal(stageAll());
    await settle();
    clickReal(unstageAll());
    await settle();
    await typeAndCommit('feat: add thing');

    for (const call of [
      sourceControl.stageFile,
      sourceControl.unstageFile,
      sourceControl.discardChanges,
      sourceControl.stageAll,
      sourceControl.unstageAll,
      sourceControl.commit,
    ]) {
      expect(call).toHaveBeenCalledTimes(1);
    }
    expect(gitStatus.refresh).toHaveBeenCalledTimes(6);
    // Each refresh follows its mutation rather than preceding it.
    const refreshOrder = gitStatus.refresh.mock.invocationCallOrder;
    expect(refreshOrder[0]).toBeGreaterThan(
      sourceControl.stageFile.mock.invocationCallOrder[0],
    );
    expect(refreshOrder[5]).toBeGreaterThan(
      sourceControl.commit.mock.invocationCallOrder[0],
    );
  });

  it("never shows one workspace's row error against another workspace", async () => {
    useRootFiles();
    sourceControl.stageFile.mockResolvedValueOnce({
      success: true,
      data: { success: false, error: 'boom' },
    } as never);

    clickReal(q('button[aria-label="Stage file"]'));
    await settle();
    expect(rowErrors()).toHaveLength(1);

    fixture.componentInstance.workspaceRoot.set('/ws/b');
    fixture.detectChanges();
    expect(rowErrors()).toHaveLength(0);

    fixture.componentInstance.workspaceRoot.set('/ws/a');
    fixture.detectChanges();
    expect(rowErrors()).toHaveLength(1);
  });

  // -- TASK_2026_576 RC3: last known list, marked stale ------------------------

  it('keeps the last known list visible, marked stale, when a later read failed', () => {
    useRootFiles();
    fixture.componentInstance.statusUnavailable.set('timeout');
    fixture.componentInstance.staleReason.set('timeout');
    fixture.detectChanges();

    const notice = q<HTMLElement>('[data-testid="git-status-stale"]');
    expect(notice.getAttribute('role')).toBe('status');
    expect(textOf(notice)).toBe(
      'Git status is unavailable (git timed out) — showing the last known changes.',
    );
    expect(notice.className).toContain('text-base-content-muted');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="git-status-unavailable"]',
      ),
    ).toBeNull();

    const regions = lists();
    expect(regions).toHaveLength(2);
    for (const region of regions) {
      expect(region.getAttribute('data-stale')).toBe('true');
      expect(region.getAttribute('aria-describedby')).toBe(notice.id);
      expect(region.className).toContain('border-warning');
      expect(unownedChildren(region)).toEqual([]);
    }
    expect(
      fixture.nativeElement.querySelectorAll('ptah-source-control-file'),
    ).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('Changes (1)');

    // The next good read drops the marker.
    fixture.componentInstance.statusUnavailable.set(null);
    fixture.componentInstance.staleReason.set(null);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-status-stale"]'),
    ).toBeNull();
    for (const region of lists()) {
      expect(region.getAttribute('data-stale')).toBeNull();
      expect(region.getAttribute('aria-describedby')).toBeNull();
    }
  });

  it('names the lock reason in the stale notice', () => {
    fixture.componentInstance.statusUnavailable.set('locked');
    fixture.componentInstance.staleReason.set('locked');
    fixture.detectChanges();

    expect(textOf(q('[data-testid="git-status-stale"]'))).toBe(
      'Git status is unavailable (another git process is using this repository) — showing the last known changes.',
    );
  });

  // -- Batch 7 revise: in-flight guard, workspace-scoped commit ---------------

  /** A promise the test settles by hand, to hold a call in flight. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const button = (label: string) =>
    q<HTMLButtonElement>(`button[aria-label="${label}"]`);

  it('runs a row action once however often it is activated while in flight', async () => {
    useRootFiles();
    const call = deferred<unknown>();
    sourceControl.stageFile.mockReturnValueOnce(call.promise as never);

    clickReal(button('Stage file'));
    fixture.detectChanges();
    expect(button('Stage file').disabled).toBe(true);
    expect(button('Stage file').getAttribute('aria-busy')).toBe('true');
    // A second activation that reaches the handler anyway is a no-op.
    button('Stage file').disabled = false;
    clickReal(button('Stage file'));
    clickReal(button('Stage file'));
    expect(sourceControl.stageFile).toHaveBeenCalledTimes(1);
    // Other rows stay usable.
    expect(button('Unstage file').disabled).toBe(false);

    call.resolve(GIT_OK);
    await settle();

    expect(button('Stage file').disabled).toBe(false);
    expect(button('Stage file').getAttribute('aria-busy')).toBeNull();
    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
  });

  it('lets a failed in-flight row action be retried once it settles', async () => {
    useRootFiles();
    const call = deferred<unknown>();
    sourceControl.discardChanges.mockReturnValueOnce(call.promise as never);
    const discard = () =>
      q<HTMLButtonElement>(
        '[aria-label="Changed files"] button[aria-label="Discard changes"]',
      );

    clickReal(discard());
    fixture.detectChanges();
    expect(discard().disabled).toBe(true);

    call.reject(new Error('IPC closed'));
    await settle();
    expect(discard().disabled).toBe(false);
    expect(rowErrors().map(textOf)).toEqual([
      'Could not reach git: IPC closed',
    ]);

    clickReal(discard());
    await settle();
    expect(sourceControl.discardChanges).toHaveBeenCalledTimes(2);
    expect(rowErrors()).toHaveLength(0);
  });

  it('never overlaps a bulk action with another mutation of the same workspace', async () => {
    useRootFiles();
    const call = deferred<unknown>();
    sourceControl.stageAll.mockReturnValueOnce(call.promise as never);

    clickReal(stageAll());
    fixture.detectChanges();

    expect(stageAll().disabled).toBe(true);
    expect(stageAll().getAttribute('aria-busy')).toBe('true');
    expect(unstageAll().disabled).toBe(true);
    expect(button('Stage file').disabled).toBe(true);
    expect(button('Unstage file').disabled).toBe(true);

    // Activations that reach the handlers anyway do nothing.
    for (const el of [stageAll(), unstageAll(), button('Stage file')]) {
      el.disabled = false;
      clickReal(el);
    }
    expect(sourceControl.stageAll).toHaveBeenCalledTimes(1);
    expect(sourceControl.unstageAll).not.toHaveBeenCalled();
    expect(sourceControl.stageFile).not.toHaveBeenCalled();

    call.resolve(GIT_OK);
    await settle();
    expect(stageAll().disabled).toBe(false);
    expect(unstageAll().disabled).toBe(false);
    expect(button('Stage file').disabled).toBe(false);
  });

  it('holds both bulk actions while a row action is in flight', async () => {
    useRootFiles();
    const call = deferred<unknown>();
    sourceControl.unstageFile.mockReturnValueOnce(call.promise as never);

    clickReal(button('Unstage file'));
    fixture.detectChanges();
    expect(stageAll().disabled).toBe(true);
    expect(unstageAll().disabled).toBe(true);

    call.resolve(GIT_OK);
    await settle();
    expect(stageAll().disabled).toBe(false);
    expect(unstageAll().disabled).toBe(false);
  });

  it('starts one commit however often Commit is activated while it runs', async () => {
    const call = deferred<unknown>();
    sourceControl.commit.mockReturnValueOnce(call.promise);
    const field = textarea();
    field.value = 'feat: once';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    clickReal(commitButton());
    clickReal(commitButton());
    fixture.detectChanges();
    commitButton().disabled = false;
    clickReal(commitButton());

    expect(sourceControl.commit).toHaveBeenCalledTimes(1);
    call.resolve(HOOK_FAILED);
    await settle();
  });

  it('keeps the commit state and message of each workspace to itself across a switch mid-commit', async () => {
    const call = deferred<unknown>();
    sourceControl.commit.mockReturnValueOnce(call.promise);
    const host = fixture.componentInstance;

    const field = textarea();
    field.value = 'feat: from a';
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    clickReal(commitButton());
    fixture.detectChanges();
    expect(textOf(commitButton())).toBe('Committing...');

    // Switch to B while A's commit runs: B is not busy and has its own draft.
    host.workspaceRoot.set('/ws/b');
    await settle();
    expect(textOf(commitButton())).toBe('Commit (1)');
    expect(textarea().disabled).toBe(false);
    expect(textarea().value).toBe('');

    textarea().value = 'fix: from b';
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // A's commit succeeds while B is displayed: nothing of it shows on B.
    call.resolve({
      success: true,
      data: { success: true, commitHash: 'a1b2c3d', subject: 'feat: from a' },
    });
    await settle();
    expect(textarea().value).toBe('fix: from b');
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-commit-success"]'),
    ).toBeNull();

    // Back on A: its draft was cleared by its own success, which is shown.
    host.workspaceRoot.set('/ws/a');
    await settle();
    expect(textarea().value).toBe('');
    expect(textOf(commitButton())).toBe('Commit (1)');
    expect(textOf(q('[data-testid="git-commit-success"]'))).toBe(
      'Committed a1b2c3d feat: from a',
    );

    // And B's draft is still B's.
    host.workspaceRoot.set('/ws/b');
    await settle();
    expect(textarea().value).toBe('fix: from b');
  });

  it('keeps the message of a workspace whose commit failed while another was displayed', async () => {
    const call = deferred<unknown>();
    sourceControl.commit.mockReturnValueOnce(call.promise);
    const host = fixture.componentInstance;

    await typeAndCommit('feat: from a');
    // typeAndCommit settles; the commit is still pending on `call`.
    host.workspaceRoot.set('/ws/b');
    await settle();

    call.resolve(HOOK_FAILED);
    await settle();
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-commit-failure"]'),
    ).toBeNull();

    host.workspaceRoot.set('/ws/a');
    await settle();
    expect(textarea().value).toBe('feat: from a');
    expect(q('[role="log"]').textContent).toContain('lint failed');
  });

  it('gives every dismiss button a 24×24 CSS px target (WCAG 2.2 SC 2.5.8)', async () => {
    // jsdom has no layout, so the target size is pinned through the classes
    // that produce it: w-6 / h-6 / min-h-6 = 1.5rem = 24px, with p-0 and
    // btn-square so daisyUI's btn-xs padding and min-height cannot shrink or
    // stretch it. Measured in the running app by the visual review.
    useRootFiles();
    sourceControl.stageFile.mockResolvedValueOnce({
      success: true,
      data: { success: false, error: 'row failed' },
    } as never);
    sourceControl.stageAll.mockResolvedValueOnce({
      success: true,
      data: { success: false, error: 'section failed' },
    } as never);
    clickReal(button('Stage file'));
    await settle();
    clickReal(stageAll());
    await settle();
    await typeAndCommit('feat: size');

    const dismissers = () =>
      Array.from(
        fixture.nativeElement.querySelectorAll('button[aria-label^="Dismiss"]'),
      ) as HTMLButtonElement[];
    const expectTarget = (el: HTMLButtonElement) => {
      for (const cls of ['btn-square', 'p-0', 'w-6', 'h-6', 'min-h-6']) {
        expect(el.classList).toContain(cls);
      }
      expect(el.classList).not.toContain('min-h-0');
      expect(el.classList).not.toContain('h-auto');
    };

    expect(dismissers().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Dismiss commit error',
      'Dismiss stage all error',
      'Dismiss error for b.ts in changes',
    ]);
    dismissers().forEach(expectTarget);

    // The commit success line's dismiss button too.
    sourceControl.commit.mockResolvedValueOnce({
      success: true,
      data: { success: true, commitHash: 'a1b2c3d' },
    });
    await typeAndCommit('feat: size');
    expectTarget(button('Dismiss commit result'));
  });

  it('survives a rejected status refresh after a mutation', async () => {
    useRootFiles();
    gitStatus.refresh.mockRejectedValueOnce(new Error('refresh failed'));
    sourceControl.stageFile.mockResolvedValueOnce({
      success: true,
      data: { success: false, error: 'boom' },
    } as never);

    clickReal(button('Stage file'));
    await settle();

    expect(gitStatus.refresh).toHaveBeenCalledTimes(1);
    expect(rowErrors().map(textOf)).toEqual(['boom']);
    expect(button('Stage file').disabled).toBe(false);
  });
});

// -- Batch 6 carry-over (V1 regression guard) ---------------------------------

describe('SourceControlService — mutation RPC timeouts (TASK_2026_576 RC8, V1)', () => {
  const HOOK_RPC_TIMEOUT_MS = gitRpcTimeoutFor(GIT_HOOK_TIMEOUT_MS);
  let service: SourceControlService;

  beforeEach(() => {
    mockRpcCall.mockReset();
    mockRpcCall.mockResolvedValue({ success: true, data: { success: true } });
    TestBed.configureTestingModule({
      providers: [
        SourceControlService,
        { provide: VSCodeService, useValue: {} },
        {
          provide: GitStatusService,
          useValue: { activeWorkspacePath: () => '/ws/a' },
        },
      ],
    });
    service = TestBed.inject(SourceControlService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('uses the 615,000 ms hook timeout (backend hook timeout + margin)', () => {
    expect(HOOK_RPC_TIMEOUT_MS).toBe(615_000);
  });

  it.each([
    ['stageFile', () => service.stageFile('a.ts'), 'git:stage', ['a.ts']],
    ['unstageFile', () => service.unstageFile('a.ts'), 'git:unstage', ['a.ts']],
    ['stageAll', () => service.stageAll(), 'git:stage', ['.']],
    ['unstageAll', () => service.unstageAll(), 'git:unstage', ['.']],
    [
      'discardChanges',
      () => service.discardChanges('a.ts'),
      'git:discard',
      ['a.ts'],
    ],
  ] as const)(
    '%s passes the hook timeout as the fourth rpcCall argument',
    async (_name, invoke, method, paths) => {
      await invoke();

      expect(mockRpcCall).toHaveBeenCalledTimes(1);
      const [, calledMethod, params, timeout] = mockRpcCall.mock.calls[0];
      expect(calledMethod).toBe(method);
      expect(params).toEqual({ paths, workspaceRoot: '/ws/a' });
      expect(timeout).toBe(615_000);
    },
  );

  it('commit passes the hook timeout as the fourth rpcCall argument', async () => {
    await service.commit('feat: x');

    const [, method, params, timeout] = mockRpcCall.mock.calls[0];
    expect(method).toBe('git:commit');
    expect(params).toEqual({ message: 'feat: x', workspaceRoot: '/ws/a' });
    expect(timeout).toBe(615_000);
  });

  it('git:showFile keeps the default timeout (no fourth argument)', async () => {
    await service.getOriginalContent('a.ts');

    const call = mockRpcCall.mock.calls[0];
    expect(call[1]).toBe('git:showFile');
    expect(call).toHaveLength(3);
    expect(call[3]).toBeUndefined();
  });
});
