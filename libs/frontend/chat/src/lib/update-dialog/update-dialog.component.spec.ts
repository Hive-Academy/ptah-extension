/**
 * UpdateDialogComponent specs
 *
 * Coverage:
 *  1. Dialog not rendered when state = idle
 *  2. Dialog rendered when state = available AND isElectron = true
 *  3. Dialog NOT rendered when isElectron = false (VS Code mode)
 *  4. Download link rendered with href = platform installer URL
 *  5. Download link falls back to the release page URL when no installer asset
 *  6. Later button click → dialogService.dismiss() called
 *  7. Backdrop click → dialogService.dismiss() called
 *  8. Release notes rendered via ptah-markdown-block selector (NOT [innerHTML])
 *  9. Fallback "View release notes" link when releaseNotesMarkdown is null
 * 10. Error state renders nothing — a failed check is not user-actionable
 *
 * Stubs:
 *   - ngx-markdown (ESM-only, breaks Jest) via jest.mock
 *   - MarkdownBlockComponent overridden with a stub via TestBed.overrideComponent
 *   - VSCodeService, UpdateDialogService provided as value mocks
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';

// Stub ngx-markdown BEFORE importing the component under test.
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

import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { UpdateDialogComponent } from './update-dialog.component';
import { UpdateDialogService } from './update-dialog.service';
import { VSCodeService } from '@ptah-extension/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import type { UpdateLifecycleState } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Stub for MarkdownBlockComponent
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

function availableState(
  overrides: Partial<
    Extract<UpdateLifecycleState, { state: 'available' }>
  > = {},
): UpdateLifecycleState {
  return {
    state: 'available',
    currentVersion: '0.1.48',
    newVersion: '0.1.49',
    releaseNotesMarkdown: null,
    downloadUrl: 'https://dl.example/0.1.49.exe',
    releaseUrl:
      'https://github.com/Hive-Academy/ptah-extension/releases/tag/electron-v0.1.49',
    ...overrides,
  };
}

function setup(opts: { isElectron?: boolean; stateSig?: StateSig } = {}) {
  const { isElectron = true } = opts;
  const stateSig =
    opts.stateSig ?? signal<UpdateLifecycleState>({ state: 'idle' });

  const dialogServiceStub = {
    state: stateSig.asReadonly(),
    dismiss: jest.fn(),
    markDownloaded: jest.fn().mockResolvedValue(undefined),
  };

  const vscodeStub = {
    get isElectron() {
      return isElectron;
    },
  };

  TestBed.configureTestingModule({
    imports: [UpdateDialogComponent],
    providers: [
      { provide: UpdateDialogService, useValue: dialogServiceStub },
      { provide: VSCodeService, useValue: vscodeStub },
    ],
  });

  TestBed.overrideComponent(UpdateDialogComponent, {
    remove: { imports: [MarkdownBlockComponent] },
    add: { imports: [MarkdownBlockStubComponent] },
  });

  const fixture = TestBed.createComponent(UpdateDialogComponent);
  fixture.detectChanges();

  return { fixture, stateSig, dialogServiceStub };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('UpdateDialogComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does NOT render the dialog when state is idle', () => {
    const { fixture } = setup();
    const dialog = fixture.nativeElement.querySelector(
      '[data-testid="update-dialog"]',
    );
    expect(dialog).toBeNull();
  });

  it('renders the dialog when state is available and isElectron is true', () => {
    const { fixture } = setup({ stateSig: signal(availableState()) });
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector(
      '[data-testid="update-dialog"]',
    );
    expect(dialog).not.toBeNull();
    expect(dialog.classList).toContain('modal-open');
    expect(dialog.textContent).toContain('0.1.48');
    expect(dialog.textContent).toContain('0.1.49');
  });

  it('does NOT render the dialog when isElectron is false (VS Code mode)', () => {
    const { fixture } = setup({
      isElectron: false,
      stateSig: signal(availableState()),
    });
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector(
      '[data-testid="update-dialog"]',
    );
    expect(dialog).toBeNull();
  });

  it('renders a Download link pointing at the platform installer URL', () => {
    const { fixture } = setup({ stateSig: signal(availableState()) });
    fixture.detectChanges();

    const link = fixture.debugElement.query(
      By.css('[data-testid="update-download"]'),
    );
    expect(link).not.toBeNull();
    expect(link.nativeElement.textContent.trim()).toBe('Download');
    expect(link.nativeElement.getAttribute('href')).toBe(
      'https://dl.example/0.1.49.exe',
    );
    expect(link.nativeElement.getAttribute('target')).toBe('_blank');
    expect(link.nativeElement.getAttribute('rel')).toContain('noopener');
  });

  it('falls back to the release page URL when no installer asset matched', () => {
    const releaseUrl =
      'https://github.com/Hive-Academy/ptah-extension/releases/tag/electron-v0.1.49';
    const { fixture } = setup({
      stateSig: signal(availableState({ downloadUrl: null, releaseUrl })),
    });
    fixture.detectChanges();

    const link = fixture.debugElement.query(
      By.css('[data-testid="update-download"]'),
    );
    expect(link.nativeElement.getAttribute('href')).toBe(releaseUrl);
  });

  it('records the version when Download is clicked, without blocking navigation', () => {
    const { fixture, dialogServiceStub } = setup({
      stateSig: signal(availableState()),
    });
    fixture.detectChanges();

    const link = fixture.debugElement.query(
      By.css('[data-testid="update-download"]'),
    );
    const event = new MouseEvent('click', { cancelable: true });
    link.nativeElement.dispatchEvent(event);

    expect(dialogServiceStub.markDownloaded).toHaveBeenCalledWith('0.1.49');
    expect(event.defaultPrevented).toBe(false);
  });

  it('calls dialogService.dismiss() when Later button is clicked', () => {
    const { fixture, dialogServiceStub } = setup({
      stateSig: signal(availableState()),
    });
    fixture.detectChanges();

    const laterBtn = fixture.debugElement.query(By.css('button.btn-ghost'));
    expect(laterBtn).not.toBeNull();
    laterBtn.nativeElement.click();

    expect(dialogServiceStub.dismiss).toHaveBeenCalledTimes(1);
  });

  it('calls dialogService.dismiss() when the backdrop is clicked', () => {
    const { fixture, dialogServiceStub } = setup({
      stateSig: signal(availableState()),
    });
    fixture.detectChanges();

    const backdropBtn = fixture.debugElement.query(
      By.css('.modal-backdrop button'),
    );
    expect(backdropBtn).not.toBeNull();
    backdropBtn.nativeElement.click();

    expect(dialogServiceStub.dismiss).toHaveBeenCalledTimes(1);
  });

  it('renders release notes via ptah-markdown-block selector, not [innerHTML]', () => {
    const notes = '## What is new\n\n- Bug fixes\n- Improvements';
    const { fixture } = setup({
      stateSig: signal(availableState({ releaseNotesMarkdown: notes })),
    });
    fixture.detectChanges();

    const markdownEl = fixture.debugElement.query(
      By.css('ptah-markdown-block'),
    );
    expect(markdownEl).not.toBeNull();

    const innerHtmlElements = Array.from(
      fixture.nativeElement.querySelectorAll('*'),
    ).filter((el) => (el as Element).hasAttribute('innerHTML'));
    expect(innerHtmlElements.length).toBe(0);
  });

  it('renders a fallback "View release notes" link when releaseNotesMarkdown is null', () => {
    const { fixture } = setup({
      stateSig: signal(availableState({ releaseNotesMarkdown: null })),
    });
    fixture.detectChanges();

    const link = fixture.debugElement.query(By.css('a.link-primary'));
    expect(link).not.toBeNull();
    expect(link.nativeElement.textContent).toContain('View release notes');

    const markdownEl = fixture.debugElement.query(
      By.css('ptah-markdown-block'),
    );
    expect(markdownEl).toBeNull();
  });

  it('renders nothing in the error state — a failed check is not user-actionable', () => {
    const { fixture } = setup({
      stateSig: signal<UpdateLifecycleState>({
        state: 'error',
        message: 'request timed out after 15000ms',
      }),
    });
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector(
      '[data-testid="update-dialog"]',
    );
    expect(dialog).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('timed out');
  });
});
