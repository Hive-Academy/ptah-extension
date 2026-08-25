/**
 * Accessibility gate for EditorPanelComponent's three native dialogs.
 *
 * WHY THIS FILE EXISTS
 *
 * TASK_2026_215 made `axe-core` a declared devDependency and stood up a
 * permanent gate for the hunk-revert dialog in `../diff-view/
 * diff-view-dialog.a11y.spec.ts`. It deliberately covered that one dialog.
 * TASK_2026_216 then converted three dialogs in this component to native
 * `<dialog>` opened with `showModal()` — delete-confirm, name-input, and the
 * pre-existing save-conflict — and none of the three was covered by any axe
 * scan. Two lanes each declined to close that gap because the component was
 * dirty in another lane's tree at the time. This file is that follow-up.
 *
 * It stands alone, mirroring `diff-view-dialog.a11y.spec.ts`, rather than
 * adding cases to `editor-panel.component.spec.ts`. The cost is the stub
 * harness below, duplicated from that file. The reason is concurrency: the
 * component spec is under active edit in another lane, and a shared file is a
 * collision. A shared helper module was also rejected — `tsconfig.lib.json`
 * compiles every non-spec file under `src` as production code with an empty
 * `types` array, so a jest-aware helper under `src/testing/` would either
 * break `nx typecheck editor` or drag `axe-core` into this lib's shipped
 * surface.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 *
 * jsdom has no layout, no compositing and no hit-testing, so the axe rules
 * that depend on rendering are switched off below rather than left on to
 * produce reassuring noise. What survives is the structural half of the dialog
 * contract — roles, accessible names, ARIA validity, id references, nesting —
 * which is exactly the half that regresses when someone edits the markup.
 *
 * axe has no rule for focus trapping at all. The behavioural assertions that
 * cover that live in `editor-panel.component.spec.ts` (the save-conflict focus
 * block and the TASK_2026_216 top-layer block). This file is an addition to
 * those, never a replacement.
 */

import axe from 'axe-core';
import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule } from 'lucide-angular';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VSCodeService } from '@ptah-extension/core';
import { EditorPanelComponent } from './editor-panel.component';
import { EditorService } from '../services/editor.service';
import { GitStatusService } from '../services/git-status.service';
import { VimModeService } from '../services/vim-mode.service';

beforeAll(() => {
  // jsdom implements no HTMLDialogElement methods, so `showModal()` would throw
  // the moment a dialog opens. Reflecting the `open` attribute is enough for
  // axe, which reads the DOM and not the top layer.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    } as HTMLDialogElement['showModal'];
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    } as HTMLDialogElement['close'];
  }

  // jsdom implements no hit-testing, so `document.elementFromPoint` is absent.
  // This stub is load-bearing, and getting it wrong is silent: axe calls
  // `elementFromPoint` while looking for the topmost modal, the call THROWS,
  // and every rule downstream of that lookup is reported as `incomplete` with
  // an `error-occurred` check rather than as a pass or a violation — 17 of
  // them, including `aria-dialog-name` and `button-name`. A scan in that state
  // reports ZERO violations no matter how broken the markup is. TASK_2026_215
  // measured it on the diff-view dialog: 2 rules actually running without
  // this, 16 with it.
  //
  // Returning null is the honest stand-in, not a convenience: it tells axe
  // "nothing is under that point", so it evaluates the tree without claiming
  // any element is on top. Whether these dialogs really reach the top layer is
  // precisely what jsdom cannot answer — that is proven structurally by the
  // TASK_2026_216 block in the component spec, which asserts `showModal()` is
  // what opened them, and against a live host in `apps/ptah-electron-e2e`.
  const doc = document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (!doc.elementFromPoint) doc.elementFromPoint = () => null;
  if (!doc.elementsFromPoint) doc.elementsFromPoint = () => [];
});

// ---------------------------------------------------------------------------
// Stub child components (match selectors + bound inputs/outputs)
//
// `test-setup.ts` sets errorOnUnknownElements/Properties, so every child the
// panel template binds must be present with the right input/output surface.
// ---------------------------------------------------------------------------
@Component({
  selector: 'ptah-code-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubCodeEditorComponent {
  readonly filePath = input<string | undefined>(undefined);
  readonly content = input<string>('');
  readonly isFocused = input(true);
  readonly contentIsPersisted = input<boolean | undefined>(undefined);
  readonly contentChanged = output<string>();
  readonly fileSaved = output<{ filePath: string; content: string }>();
}

@Component({
  selector: 'ptah-diff-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubDiffViewComponent {
  readonly diffTab = input<unknown>(null);
  readonly openDiffKeys = input<readonly string[]>([]);
  readonly applyHunks = input<unknown>(null);
  readonly retryRequested = output<string>();
}

@Component({
  selector: 'ptah-sidebar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubSidebarComponent {
  readonly width = input(256);
  readonly files = input<unknown[]>([]);
  readonly activeFilePath = input<string | undefined>(undefined);
  readonly changedFiles = input<unknown[]>([]);
  readonly fileSelected = output<string>();
  readonly diffRequested = output<unknown>();
  readonly searchResultSelected = output<{ filePath: string; line: number }>();
  readonly contextMenuRequested = output<unknown>();
}

@Component({
  selector: 'ptah-git-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubGitStatusBarComponent {}

@Component({
  selector: 'ptah-terminal-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubTerminalPanelComponent {}

@Component({
  selector: 'ptah-file-tree-context-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubContextMenuComponent {
  readonly x = input(0);
  readonly y = input(0);
  readonly node = input<unknown>(null);
  readonly action = output<unknown>();
  readonly closed = output<void>();
}

@Component({
  selector: 'ptah-quick-open',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubQuickOpenComponent {
  readonly fileSelected = output<{ filePath: string }>();
  readonly closed = output<void>();
}

// ---------------------------------------------------------------------------
// Service stubs
// ---------------------------------------------------------------------------
function makeEditorServiceStub() {
  const activeFilePath = signal<string | undefined>(undefined);
  const splitActive = signal(false);
  const focusedPane = signal<'left' | 'right'>('left');
  return {
    isLoading: signal(false),
    activeFilePath,
    activeFileContent: signal(''),
    hasActiveFile: computed(() => !!activeFilePath()),
    activeDiffTab: signal<unknown>(null),
    isActiveFileImage: signal(false),
    openTabs: signal<unknown[]>([]),
    splitActive,
    focusedPane,
    closeSplit: jest.fn(() => {
      splitActive.set(false);
      focusedPane.set('left');
    }),
    splitFilePath: signal<string | undefined>(undefined),
    splitFileContent: signal(''),
    terminalVisible: signal(false),
    terminalHeight: signal(200),
    setTerminalHeight: jest.fn(),
    fileTree: signal<unknown[]>([]),
    error: signal<string | null>(null),
    activeWorkspacePath: '/ws',
    switchWorkspace: jest.fn(),
    startFileTreeWatcher: jest.fn(),
    stopFileTreeWatcher: jest.fn(),
    clearError: jest.fn(),
    switchTab: jest.fn(),
    closeTab: jest.fn(),
    setFocusedPane: jest.fn(),
    saveFile: jest.fn(() => Promise.resolve()),
    markTabClean: jest.fn(),
    updateTabContent: jest.fn(),
    updateSplitContent: jest.fn(),
    hasUnabsorbedPeerEdit: jest.fn(() => false),
    // `Signal<boolean>` on EditorService, read by the "Diverged" chip
    // (TASK_2026_214). Present so the panel renders; this file asserts nothing
    // about the chip.
    splitPanesDiverged: signal(false),
    deleteItem: jest.fn(() => Promise.resolve()),
    createFile: jest.fn(() => Promise.resolve()),
    createFolder: jest.fn(() => Promise.resolve()),
    renameItem: jest.fn(() => Promise.resolve()),
    targetLine: signal<number | undefined>(undefined),
    clearTargetLine: jest.fn(),
  } as unknown as EditorService & {
    activeFilePath: ReturnType<typeof signal<string | undefined>>;
    openTabs: ReturnType<typeof signal<unknown[]>>;
    splitActive: ReturnType<typeof signal<boolean>>;
    splitFilePath: ReturnType<typeof signal<string | undefined>>;
    hasUnabsorbedPeerEdit: jest.Mock;
  };
}

function makeGitStatusStub() {
  return {
    files: signal<unknown[]>([]),
    activeWorkspacePath: signal<string | null>(null),
    switchWorkspace: jest.fn(),
    startListening: jest.fn(),
    stopListening: jest.fn(),
  } as unknown as GitStatusService;
}

function makeVimStub() {
  return {
    enabled: signal(false),
    loadPreference: jest.fn(async () => undefined),
    toggle: jest.fn(async () => undefined),
    attachToEditor: jest.fn(),
    detach: jest.fn(),
  } as unknown as VimModeService;
}

function makeVscodeStub() {
  return {
    config: signal({ workspaceRoot: '' }),
    isConnected: signal(false),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  } as unknown as VSCodeService;
}

// ---------------------------------------------------------------------------
// axe scaffolding
// ---------------------------------------------------------------------------

/**
 * Rules disabled because jsdom cannot evaluate them, NOT because the dialogs
 * fail them. Each one needs a rendered box, and jsdom has none.
 */
const RULES_JSDOM_CANNOT_EVALUATE = [
  'color-contrast',
  'target-size',
  'scrollable-region-focusable',
] as const;

/**
 * The lower bound on rules that must actually have RUN for a clean result to
 * mean anything. Without it, a mistake in the axe options — a bad selector, an
 * over-broad disable list, an element that was never in scope — produces zero
 * violations and a permanently green test that checks nothing. Deliberately
 * far below the observed count so it fails on a broken configuration rather
 * than on axe shipping a new rule.
 */
const MIN_RULES_EXERCISED = 10;

/**
 * The rules that carry these dialogs' contract on every one of the three.
 * Named rather than counted, because "15 rules ran" stays true while the ones
 * that matter quietly drop into `incomplete` — which is exactly what a missing
 * `elementFromPoint` does.
 *
 * `aria-required-children` is deliberately NOT here. It only applies to roles
 * that require owned children (list, menu, grid, tablist); a dialog requires
 * none, so axe never evaluates it anywhere in these subtrees and asserting it
 * "ran" would fail on all three for a reason that has nothing to do with the
 * markup. Measured, not assumed.
 */
const BASE_LOAD_BEARING_RULES = [
  'aria-allowed-attr',
  'aria-prohibited-attr',
  'aria-valid-attr',
  'aria-valid-attr-value',
  'button-name',
] as const;

/**
 * Rules axe applies only to an element carrying an EXPLICIT `role`.
 *
 * A bare `<dialog>` has an implicit `dialog` role, but axe's rule selectors key
 * off the attribute, not the implicit mapping: scanning `<dialog
 * aria-labelledby=...>` runs 10 rules and NONE of them is `aria-dialog-name`,
 * while the same markup with `role="dialog"` runs 15 including it. Measured
 * against axe-core 4.x in this workspace.
 *
 * Consequence: the delete-confirm and save-conflict dialogs carry
 * `role="alertdialog"` and so have their accessible name enforced by axe. The
 * name-input dialog carries no role, so it does NOT — its name is asserted by
 * hand in (a11y-N3) instead. Giving that dialog an explicit `role="dialog"`
 * would fold it into this set; see the note on (a11y-N3).
 */
const EXPLICIT_ROLE_RULES = ['aria-dialog-name', 'aria-required-attr'] as const;

type AxeCheckable = Parameters<typeof axe.run>[0];

async function scanDialog(element: HTMLElement): Promise<axe.AxeResults> {
  return axe.run(element as AxeCheckable, {
    rules: Object.fromEntries(
      RULES_JSDOM_CANNOT_EVALUATE.map((id) => [id, { enabled: false }]),
    ),
  });
}

/** Readable failure text — the rule id plus the node axe objected to. */
function describeViolations(results: axe.AxeResults): string {
  return results.violations
    .map(
      (v) =>
        v.id +
        ' (' +
        v.impact +
        '): ' +
        v.help +
        '\n  ' +
        v.nodes.map((n) => n.html).join('\n  '),
    )
    .join('\n');
}

/** Every rule axe reached a verdict on, in any of the three buckets. */
function rulesThatRan(results: axe.AxeResults): Set<string> {
  return new Set(
    [...results.passes, ...results.violations, ...results.incomplete].map(
      (r) => r.id,
    ),
  );
}

describe('EditorPanelComponent dialogs — axe (TASK_2026_215 follow-up)', () => {
  let fixture: ComponentFixture<EditorPanelComponent>;
  let editor: ReturnType<typeof makeEditorServiceStub>;
  /** Stands in for the element the dialog was raised from. */
  let raiser: HTMLButtonElement;

  const FILE_NODE = { path: '/ws/src/a.ts', name: 'a.ts', type: 'file' };

  /** Drive the real path: file-tree context menu -> menu action -> dialog. */
  function chooseMenuAction(type: string, node: unknown): void {
    const sidebar = fixture.debugElement.query(
      By.directive(StubSidebarComponent),
    );
    sidebar.componentInstance.contextMenuRequested.emit({
      event: new MouseEvent('contextmenu', {
        cancelable: true,
        clientX: 10,
        clientY: 10,
      }),
      node,
    });
    fixture.detectChanges();

    const menu = fixture.debugElement.query(
      By.directive(StubContextMenuComponent),
    );
    menu.componentInstance.action.emit({ type, node });
    fixture.detectChanges();
  }

  function panes() {
    return fixture.debugElement.queryAll(By.directive(StubCodeEditorComponent));
  }

  /** Same route as the C2 focus block: a save that collides with a peer edit. */
  async function openSaveConflict(): Promise<void> {
    editor.openTabs.set([
      {
        filePath: '/ws/a.ts',
        fileName: 'a.ts',
        content: 'peer',
        isDirty: true,
      },
    ]);
    editor.activeFilePath.set('/ws/a.ts');
    editor.splitActive.set(true);
    editor.splitFilePath.set('/ws/a.ts');
    fixture.detectChanges();
    editor.hasUnabsorbedPeerEdit.mockReturnValue(true);

    panes()[0].componentInstance.fileSaved.emit({
      filePath: '/ws/a.ts',
      content: 'mine',
    });
    await Promise.resolve();
    fixture.detectChanges();
  }

  /**
   * Guard, not decoration: every assertion here is vacuous if the dialog never
   * opened, and a silently-empty scan is the failure mode this file exists to
   * prevent.
   */
  function requireDialog(selector: string, what: string): HTMLElement {
    const dialog = fixture.nativeElement.querySelector(
      selector,
    ) as HTMLElement | null;
    if (!dialog) {
      throw new Error(
        what +
          ' did not open — the axe scan would have passed against nothing. ' +
          'Check the affordance that raises it, not axe.',
      );
    }
    return dialog;
  }

  /**
   * The save-conflict dialog carries no `data-testid` and shares
   * `role="alertdialog"` with the delete dialog, so it is selected by the
   * absence of a testid rather than by role alone.
   */
  const SAVE_CONFLICT = '[role="alertdialog"]:not([data-testid])';
  const DELETE_DIALOG = '[data-testid="delete-confirm-dialog"]';
  const NAME_DIALOG = '[data-testid="name-input-dialog"]';

  /** The half of the gate that proves a clean scan was a real scan. */
  function expectRulesActuallyRan(
    results: axe.AxeResults,
    alsoRequired: readonly string[] = [],
  ): void {
    // `passes` counts rules that RAN and found compliant nodes. A misconfigured
    // scan reports zero of everything and would otherwise look identical to a
    // perfect one.
    expect(results.passes.length).toBeGreaterThanOrEqual(MIN_RULES_EXERCISED);

    // Asserted as a set difference rather than a loop so a failure names the
    // rules that went missing instead of reporting `false`.
    const ran = rulesThatRan(results);
    const required = [...BASE_LOAD_BEARING_RULES, ...alsoRequired];
    expect(required.filter((rule) => !ran.has(rule))).toEqual([]);

    // `incomplete` means axe could not decide. Any entry is a rule silently not
    // being enforced, so it fails rather than being tolerated.
    expect(results.incomplete.map((r) => r.id)).toEqual([]);
  }

  beforeEach(() => {
    editor = makeEditorServiceStub();

    TestBed.configureTestingModule({
      imports: [EditorPanelComponent],
      providers: [
        { provide: EditorService, useValue: editor },
        { provide: GitStatusService, useValue: makeGitStatusStub() },
        { provide: VimModeService, useValue: makeVimStub() },
        { provide: VSCodeService, useValue: makeVscodeStub() },
      ],
    });

    TestBed.overrideComponent(EditorPanelComponent, {
      set: {
        imports: [
          NgClass,
          LucideAngularModule,
          StubCodeEditorComponent,
          StubDiffViewComponent,
          StubSidebarComponent,
          StubGitStatusBarComponent,
          StubTerminalPanelComponent,
          StubContextMenuComponent,
          StubQuickOpenComponent,
        ],
      },
    });

    raiser = document.createElement('button');
    raiser.textContent = 'file row';
    document.body.appendChild(raiser);
    raiser.focus();

    fixture = TestBed.createComponent(EditorPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    raiser.remove();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  // -- delete confirmation ---------------------------------------------------

  it('(a11y-D1) the open delete-confirm dialog has no axe violations', async () => {
    chooseMenuAction('delete', FILE_NODE);
    const dialog = requireDialog(DELETE_DIALOG, 'delete-confirm dialog');

    const results = await scanDialog(dialog);

    expect(describeViolations(results)).toBe('');
    expect(results.violations).toHaveLength(0);
  });

  it('(a11y-D2) the delete-confirm scan exercised its load-bearing rules', async () => {
    chooseMenuAction('delete', FILE_NODE);
    const dialog = requireDialog(DELETE_DIALOG, 'delete-confirm dialog');

    // role="alertdialog" is explicit here, so the name rules apply.
    expectRulesActuallyRan(await scanDialog(dialog), EXPLICIT_ROLE_RULES);
  });

  it('(a11y-D3) the gate FAILS when the accessible name is removed', async () => {
    chooseMenuAction('delete', FILE_NODE);
    const dialog = requireDialog(DELETE_DIALOG, 'delete-confirm dialog');

    // A negative control for the whole file. Every other test here asserts an
    // absence — no violations, no `incomplete` — and an absence is exactly what
    // a silently broken scan also produces. This one breaks the markup on
    // purpose and insists the scan notices, so a future change that neuters
    // axe (a bad option, a lost `elementFromPoint`, a scan pointed at the wrong
    // element) fails HERE rather than going quietly green everywhere.
    //
    // The mutation is applied to the rendered DOM rather than to the component
    // source so this stays a self-contained test of the gate.
    dialog.removeAttribute('aria-labelledby');

    const results = await scanDialog(dialog);

    const dialogName = results.violations.find(
      (v) => v.id === 'aria-dialog-name',
    );
    expect(dialogName).toBeDefined();
    expect(dialogName?.impact).toBe('serious');
  });

  // -- name input ------------------------------------------------------------

  it('(a11y-N1) the open name-input dialog has no axe violations', async () => {
    chooseMenuAction('rename', FILE_NODE);
    const dialog = requireDialog(NAME_DIALOG, 'name-input dialog');

    const results = await scanDialog(dialog);

    expect(describeViolations(results)).toBe('');
    expect(results.violations).toHaveLength(0);
  });

  it('(a11y-N2) the name-input scan exercised its load-bearing rules', async () => {
    chooseMenuAction('rename', FILE_NODE);
    const dialog = requireDialog(NAME_DIALOG, 'name-input dialog');

    // No EXPLICIT_ROLE_RULES: this dialog carries no `role` attribute, so axe
    // does not apply its dialog-name rules to it. See (a11y-N3).
    expectRulesActuallyRan(await scanDialog(dialog));
  });

  it('(a11y-N3) the name-input dialog resolves an accessible name, which axe does not check for it', () => {
    chooseMenuAction('rename', FILE_NODE);
    const dialog = requireDialog(NAME_DIALOG, 'name-input dialog');

    // This assertion exists because axe cannot make it. `aria-dialog-name`
    // matches on an explicit role attribute, and this dialog relies on the
    // implicit `dialog` role of the element, so the scan in (a11y-N2) says
    // nothing about whether the dialog is named. Adding `role="dialog"` to it
    // in `editor-panel.component.ts` would bring it under axe and let this
    // test be replaced by EXPLICIT_ROLE_RULES in (a11y-N2). That change is not
    // made here only because the component is owned by another lane.
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    const label = dialog.querySelector('#' + labelledBy);
    expect(label).toBeTruthy();
    expect(label?.textContent?.trim()).toBe('Rename to');
  });

  // -- save conflict ---------------------------------------------------------

  it('(a11y-S1) the open save-conflict dialog has no axe violations', async () => {
    await openSaveConflict();
    const dialog = requireDialog(SAVE_CONFLICT, 'save-conflict dialog');

    const results = await scanDialog(dialog);

    expect(describeViolations(results)).toBe('');
    expect(results.violations).toHaveLength(0);
  });

  it('(a11y-S2) the save-conflict scan exercised its load-bearing rules', async () => {
    await openSaveConflict();
    const dialog = requireDialog(SAVE_CONFLICT, 'save-conflict dialog');

    // role="alertdialog" is explicit here, so the name rules apply.
    expectRulesActuallyRan(await scanDialog(dialog), EXPLICIT_ROLE_RULES);
  });

  // -- the scan targets themselves -------------------------------------------

  it('(a11y-T1) scans the dialog itself, not an ancestor that contains it', () => {
    chooseMenuAction('delete', FILE_NODE);
    const del = requireDialog(DELETE_DIALOG, 'delete-confirm dialog');

    // If the element handed to axe were the component host, a violation
    // anywhere in the editor surface would be attributed to the dialog, and a
    // dialog regression could be masked by an unrelated fix elsewhere.
    expect(del.tagName).toBe('DIALOG');
    expect(del.getAttribute('role')).toBe('alertdialog');
  });
});
