/**
 * UpdateBannerComponent specs — TASK_2026_117
 *
 * Coverage (10 scenarios):
 *  1.  Banner not rendered when state = idle
 *  2.  Banner rendered when state = available AND isElectron = true
 *  3.  Banner NOT rendered when isElectron = false (VS Code mode)
 *  4.  Restart Now button disabled when state = available
 *  5.  Restart Now button enabled when state = downloaded
 *  6.  Later button click → bannerService.dismiss() called
 *  7.  Restart Now click without active agent → ClaudeRpcService.call('update:install-now', {}) called
 *  8.  Restart Now click with active agent (streamingTabIds.size=1) →
 *        ConfirmationDialogService.confirm() shown; on cancel → RPC NOT called
 *  9.  Release notes rendered via ptah-markdown-block selector (NOT [innerHTML])
 *  10. Fallback link rendered when releaseNotesMarkdown is null
 *
 * Stubs:
 *   - ngx-markdown (ESM-only, breaks Jest) via jest.mock
 *   - MarkdownBlockComponent overridden with a stub via TestBed.overrideComponent
 *   - VSCodeService, TabManagerService, ConfirmationDialogService,
 *     ClaudeRpcService, UpdateBannerService all provided as value mocks
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';

// Stub ngx-markdown BEFORE importing the component under test. The component
// imports MarkdownBlockComponent which transitively pulls ngx-markdown
// (an ESM-only bundle that Jest cannot parse out of the box).
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }

  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}

  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UpdateBannerComponent } from './update-banner.component';
import { UpdateBannerService } from './update-banner.service';
import { VSCodeService, ClaudeRpcService } from '@ptah-extension/core';
import {
  TabManagerService,
  ConfirmationDialogService,
} from '@ptah-extension/chat-state';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Stub for MarkdownBlockComponent — no real rendering needed in unit tests
// ---------------------------------------------------------------------------
@Component({
  selector: 'ptah-markdown-block',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-test="markdown-block-stub" [attr.data-content]="content">
    {{ content }}
  </div>`,
})
class MarkdownBlockStubComponent {
  @Input() content!: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StateSig = ReturnType<typeof signal<UpdateLifecycleState>>;

/**
 * Build all required stubs and create a TestBed + fixture.
 *
 * @param overrides - partial override options:
 *   - isElectron: controls VSCodeService.isElectron (default: true)
 *   - stateSig: writable signal to push state changes to the banner service
 *   - streamingTabIds: Set returned by TabManagerService.streamingTabIds()
 *   - confirmResult: what ConfirmationDialogService.confirm() resolves to
 */
function setup(
  opts: {
    isElectron?: boolean;
    stateSig?: StateSig;
    streamingTabIds?: Set<string>;
    confirmResult?: boolean;
  } = {},
) {
  const {
    isElectron = true,
    streamingTabIds = new Set<string>(),
    confirmResult = false,
  } = opts;

  // Write-able signal so tests can push state transitions.
  const stateSig =
    opts.stateSig ?? signal<UpdateLifecycleState>({ state: 'idle' });

  const bannerServiceStub = {
    state: stateSig.asReadonly(),
    dismiss: jest.fn(),
  };

  const vscodeStub = {
    get isElectron() {
      return isElectron;
    },
  };

  const tabManagerStub = {
    streamingTabIds: signal<Set<string>>(streamingTabIds).asReadonly(),
  };

  const confirmStub = {
    confirm: jest.fn().mockResolvedValue(confirmResult),
  };

  const rpcCall = jest.fn().mockResolvedValue(undefined);
  const rpcStub = { call: rpcCall };

  TestBed.configureTestingModule({
    imports: [UpdateBannerComponent],
    providers: [
      { provide: UpdateBannerService, useValue: bannerServiceStub },
      { provide: VSCodeService, useValue: vscodeStub },
      { provide: TabManagerService, useValue: tabManagerStub },
      { provide: ConfirmationDialogService, useValue: confirmStub },
      { provide: ClaudeRpcService, useValue: rpcStub },
    ],
  });

  // Override MarkdownBlockComponent with our stub so ngx-markdown is never
  // instantiated in the test environment.
  TestBed.overrideComponent(UpdateBannerComponent, {
    remove: { imports: [MarkdownBlockComponent] },
    add: { imports: [MarkdownBlockStubComponent] },
  });

  const fixture = TestBed.createComponent(UpdateBannerComponent);
  fixture.detectChanges();

  return {
    fixture,
    stateSig,
    bannerServiceStub,
    confirmStub,
    rpcCall,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('UpdateBannerComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  // ---- Scenario 1: not rendered when idle -----------------------------------

  it('does NOT render the banner when state is idle', () => {
    const { fixture } = setup();
    // idle state — bannerVisible() is false
    const banner = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(banner).toBeNull();
  });

  // ---- Scenario 2: rendered when available + isElectron = true -------------

  it('renders the banner when state is available and isElectron is true', () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'available',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture } = setup({ stateSig });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(banner).not.toBeNull();
  });

  // ---- Scenario 3: NOT rendered when isElectron = false --------------------

  it('does NOT render the banner when isElectron is false (VS Code mode)', () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'available',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture } = setup({ isElectron: false, stateSig });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(banner).toBeNull();
  });

  // ---- Scenario 4: Restart Now disabled when state = available -------------

  it('disables Restart Now button when state is available (not yet downloaded)', () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'available',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture } = setup({ stateSig });
    fixture.detectChanges();

    const button = fixture.debugElement.query(
      By.css('button[type="button"]:not(.btn-ghost)'),
    );
    expect(button).not.toBeNull();
    // The button should have the disabled attribute.
    expect(button.nativeElement.disabled).toBe(true);
  });

  // ---- Scenario 5: Restart Now enabled when state = downloaded -------------

  it('enables Restart Now button when state is downloaded', () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'downloaded',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture } = setup({ stateSig });
    fixture.detectChanges();

    const button = fixture.debugElement.query(By.css('button.btn-primary'));
    expect(button).not.toBeNull();
    expect(button.nativeElement.disabled).toBe(false);
  });

  // ---- Scenario 6: Later click → dismiss() called --------------------------

  it('calls bannerService.dismiss() when Later button is clicked', () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'available',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture, bannerServiceStub } = setup({ stateSig });
    fixture.detectChanges();

    const laterBtn = fixture.debugElement.query(By.css('button.btn-ghost'));
    expect(laterBtn).not.toBeNull();
    laterBtn.nativeElement.click();

    expect(bannerServiceStub.dismiss).toHaveBeenCalledTimes(1);
  });

  // ---- Scenario 7: Restart Now without active agent → RPC called -----------

  it('calls update:install-now RPC when Restart Now clicked with no active agent', async () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'downloaded',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture, rpcCall } = setup({
      stateSig,
      streamingTabIds: new Set(), // no active agents
    });
    fixture.detectChanges();

    const restartBtn = fixture.debugElement.query(By.css('button.btn-primary'));
    expect(restartBtn).not.toBeNull();
    restartBtn.nativeElement.click();

    // Flush async handleRestartNow()
    await fixture.whenStable();

    expect(rpcCall).toHaveBeenCalledWith('update:install-now', {});
  });

  // ---- Scenario 8: Restart Now with active agent → confirm shown; cancel → no RPC

  it('shows ConfirmationDialogService.confirm when Restart Now clicked with active agent, and does NOT call RPC on cancel', async () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'downloaded',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture, confirmStub, rpcCall } = setup({
      stateSig,
      streamingTabIds: new Set(['tab-1']), // one active agent
      confirmResult: false, // user clicks Cancel
    });
    fixture.detectChanges();

    const restartBtn = fixture.debugElement.query(By.css('button.btn-primary'));
    restartBtn.nativeElement.click();

    await fixture.whenStable();

    // Confirm dialog must have been shown.
    expect(confirmStub.confirm).toHaveBeenCalledTimes(1);
    // RPC must NOT have been called because user cancelled.
    expect(rpcCall).not.toHaveBeenCalled();
  });

  it('calls RPC when active agent confirms restart', async () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'downloaded',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture, confirmStub, rpcCall } = setup({
      stateSig,
      streamingTabIds: new Set(['tab-1']),
      confirmResult: true, // user clicks Restart
    });
    fixture.detectChanges();

    const restartBtn = fixture.debugElement.query(By.css('button.btn-primary'));
    restartBtn.nativeElement.click();

    await fixture.whenStable();

    expect(confirmStub.confirm).toHaveBeenCalledTimes(1);
    expect(rpcCall).toHaveBeenCalledWith('update:install-now', {});
  });

  // ---- Scenario 9: Release notes via ptah-markdown-block (not innerHTML) ---

  it('renders release notes via ptah-markdown-block selector, not [innerHTML]', () => {
    const notes = '## What is new\n\n- Bug fixes\n- Improvements';
    const stateSig = signal<UpdateLifecycleState>({
      state: 'available',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: notes,
    });
    const { fixture } = setup({ stateSig });
    fixture.detectChanges();

    // ptah-markdown-block must be present (rendered via stub).
    const markdownEl = fixture.debugElement.query(
      By.css('ptah-markdown-block'),
    );
    expect(markdownEl).not.toBeNull();

    // There must be NO element with a raw [innerHTML] binding carrying
    // AI-generated content — verify the banner root has no innerHTML attr.
    const bannerRoot = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(bannerRoot).not.toBeNull();
    // The inner HTML of the banner should NOT contain a direct innerHTML= attribute.
    // We assert by confirming there is no element with [innerHTML] binding for notes.
    // Since we control the stub, the content is delivered via the stub component.
    const stubEl = fixture.nativeElement.querySelector(
      '[data-test="markdown-block-stub"]',
    );
    expect(stubEl).not.toBeNull();
    // The content should NOT be injected via .innerHTML directly on any wrapper.
    const innerHtmlElements = Array.from(
      fixture.nativeElement.querySelectorAll('*'),
    ).filter((el) => (el as Element).hasAttribute('innerHTML'));
    expect(innerHtmlElements.length).toBe(0);
  });

  // ---- Scenario 10: Fallback link when releaseNotesMarkdown is null --------

  it('renders a fallback "View release notes" link when releaseNotesMarkdown is null', () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'available',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture } = setup({ stateSig });
    fixture.detectChanges();

    const link = fixture.debugElement.query(By.css('a[target="_blank"]'));
    expect(link).not.toBeNull();
    expect(link.nativeElement.textContent).toContain('View release notes');
    expect(link.nativeElement.getAttribute('rel')).toContain('noopener');

    // ptah-markdown-block must NOT be present when notes are null.
    const markdownEl = fixture.debugElement.query(
      By.css('ptah-markdown-block'),
    );
    expect(markdownEl).toBeNull();
  });

  // ---- Additional: fallback link in downloaded state too -------------------

  it('renders fallback link in downloaded state when releaseNotesMarkdown is null', () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'downloaded',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture } = setup({ stateSig });
    fixture.detectChanges();

    const link = fixture.debugElement.query(By.css('a[target="_blank"]'));
    expect(link).not.toBeNull();
    expect(link.nativeElement.textContent).toContain('View release notes');
  });

  // ---- Scenario 11: Double-click protection — RPC called once -------------
  //
  // Guards against code-logic-review.md Failure Mode 4 / Serious Issue #3:
  // the `_installInFlight` signal must flip true between the first and second
  // synchronous click so the second click finds the button disabled.

  it('does NOT issue a second install-now RPC when Restart Now is double-clicked', async () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'downloaded',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });

    // Override the rpc mock with a *delayed* promise so the in-flight signal
    // stays true between the two synchronous clicks.
    const { fixture, rpcCall } = setup({
      stateSig,
      streamingTabIds: new Set(),
    });

    let releaseRpc: () => void = () => undefined;
    rpcCall.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseRpc = () => resolve();
        }),
    );

    fixture.detectChanges();

    const restartBtn = fixture.debugElement.query(By.css('button.btn-primary'));
    expect(restartBtn).not.toBeNull();

    // First click — synchronously kicks off handleRestartNow(). No active
    // agent, so the confirmation dialog is skipped and the RPC fires
    // immediately, flipping _installInFlight true.
    restartBtn.nativeElement.click();
    fixture.detectChanges();

    // Second click — should be dropped because the button is now disabled
    // via [disabled]="!restartEnabled()".
    restartBtn.nativeElement.click();
    fixture.detectChanges();

    // The button should now be disabled because the RPC is in flight.
    expect(restartBtn.nativeElement.disabled).toBe(true);

    // Settle pending microtasks so handleRestartNow() advances past the
    // confirmation-skip branch and into the try block — RPC has already
    // been invoked at this point but is still pending.
    await Promise.resolve();
    await Promise.resolve();

    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall).toHaveBeenCalledWith('update:install-now', {});

    // Let the RPC promise settle so the finally block runs and the test
    // doesn't leave a dangling pending promise.
    releaseRpc();
    await fixture.whenStable();
  });

  // ---- Scenario 12: Re-enable after settle --------------------------------
  //
  // In the happy path the app is quitting and this UI is about to disappear;
  // this case guards the *failure* path where `quitAndInstall()` rejects on
  // the main side and the app stays alive. The button must be re-enabled so
  // the user can retry.

  it('re-enables the Restart Now button after the install-now RPC settles', async () => {
    const stateSig = signal<UpdateLifecycleState>({
      state: 'downloaded',
      currentVersion: '1.0.0',
      newVersion: '1.1.0',
      releaseNotesMarkdown: null,
    });
    const { fixture, rpcCall } = setup({
      stateSig,
      streamingTabIds: new Set(),
    });

    let releaseRpc: () => void = () => undefined;
    rpcCall.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseRpc = () => resolve();
        }),
    );

    fixture.detectChanges();

    const restartBtn = fixture.debugElement.query(By.css('button.btn-primary'));
    restartBtn.nativeElement.click();
    fixture.detectChanges();

    // While in flight: disabled.
    expect(restartBtn.nativeElement.disabled).toBe(true);

    // Settle the RPC and let the finally block clear the in-flight flag.
    releaseRpc();
    await fixture.whenStable();
    fixture.detectChanges();

    // Same button reference still in the DOM (state hasn't changed), now
    // re-enabled.
    expect(restartBtn.nativeElement.disabled).toBe(false);
  });
});
