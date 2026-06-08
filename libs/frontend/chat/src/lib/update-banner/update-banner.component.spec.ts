/**
 * UpdateBannerComponent specs
 *
 * Coverage:
 *  1. Banner not rendered when state = idle
 *  2. Banner rendered when state = available AND isElectron = true
 *  3. Banner NOT rendered when isElectron = false (VS Code mode)
 *  4. Download link rendered with href = platform installer URL
 *  5. Download link falls back to the release page URL when no installer asset
 *  6. Later button click → bannerService.dismiss() called
 *  7. Release notes rendered via ptah-markdown-block selector (NOT [innerHTML])
 *  8. Fallback "View release notes" link when releaseNotesMarkdown is null
 *  9. Error state renders the error message and no Download link
 *
 * Stubs:
 *   - ngx-markdown (ESM-only, breaks Jest) via jest.mock
 *   - MarkdownBlockComponent overridden with a stub via TestBed.overrideComponent
 *   - VSCodeService, UpdateBannerService provided as value mocks
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
import { UpdateBannerComponent } from './update-banner.component';
import { UpdateBannerService } from './update-banner.service';
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

  const bannerServiceStub = {
    state: stateSig.asReadonly(),
    dismiss: jest.fn(),
  };

  const vscodeStub = {
    get isElectron() {
      return isElectron;
    },
  };

  TestBed.configureTestingModule({
    imports: [UpdateBannerComponent],
    providers: [
      { provide: UpdateBannerService, useValue: bannerServiceStub },
      { provide: VSCodeService, useValue: vscodeStub },
    ],
  });

  TestBed.overrideComponent(UpdateBannerComponent, {
    remove: { imports: [MarkdownBlockComponent] },
    add: { imports: [MarkdownBlockStubComponent] },
  });

  const fixture = TestBed.createComponent(UpdateBannerComponent);
  fixture.detectChanges();

  return { fixture, stateSig, bannerServiceStub };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('UpdateBannerComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does NOT render the banner when state is idle', () => {
    const { fixture } = setup();
    const banner = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(banner).toBeNull();
  });

  it('renders the banner when state is available and isElectron is true', () => {
    const { fixture } = setup({ stateSig: signal(availableState()) });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(banner).not.toBeNull();
  });

  it('does NOT render the banner when isElectron is false (VS Code mode)', () => {
    const { fixture } = setup({
      isElectron: false,
      stateSig: signal(availableState()),
    });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(banner).toBeNull();
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

  it('calls bannerService.dismiss() when Later button is clicked', () => {
    const { fixture, bannerServiceStub } = setup({
      stateSig: signal(availableState()),
    });
    fixture.detectChanges();

    const laterBtn = fixture.debugElement.query(By.css('button.btn-ghost'));
    expect(laterBtn).not.toBeNull();
    laterBtn.nativeElement.click();

    expect(bannerServiceStub.dismiss).toHaveBeenCalledTimes(1);
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

  it('renders the error message and no Download link in the error state', () => {
    const { fixture } = setup({
      stateSig: signal<UpdateLifecycleState>({
        state: 'error',
        message: 'GitHub releases request failed: HTTP 503',
      }),
    });
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector(
      '[data-testid="update-banner"]',
    );
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('HTTP 503');

    const downloadLink = fixture.debugElement.query(
      By.css('[data-testid="update-download"]'),
    );
    expect(downloadLink).toBeNull();
  });
});
