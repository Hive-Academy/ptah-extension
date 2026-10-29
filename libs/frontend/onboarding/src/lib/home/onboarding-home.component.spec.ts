import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SetupStatusStore } from '@ptah-extension/chat-ui';
import { AppStateManager } from '@ptah-extension/core';
import type { SetupStatusGetResponse } from '@ptah-extension/shared';
import { OnboardingFlagService } from '../first-run/onboarding-flag.service';
import { OnboardingHomeComponent } from './onboarding-home.component';

/** The `SetupStatusStore` surface Home reads, as writable signals. */
function createStatusStore() {
  return {
    workspaceNotOpen: signal(false),
    folderError: signal<string | null>(null),
    isLoading: signal(false),
    status: signal<SetupStatusGetResponse | null>(null),
    error: signal<string | null>(null),
    scanError: signal<string | null>(null),
    scanReady: signal<boolean | null>(null),
    agentsReady: signal<boolean | null>(null),
    refresh: jest.fn().mockResolvedValue(undefined),
    retry: jest.fn().mockResolvedValue(undefined),
    openFolder: jest.fn().mockResolvedValue(undefined),
  };
}

const CONFIGURED: SetupStatusGetResponse = {
  isConfigured: true,
  agentCount: 4,
  ruleCount: 2,
  lastUpdated: null,
  hasClaudeConfig: true,
};

describe('OnboardingHomeComponent', () => {
  let store: ReturnType<typeof createStatusStore>;
  let markDismissed: jest.Mock<void, []>;
  let setCurrentView: jest.Mock<void, [string]>;
  let fixture: ComponentFixture<OnboardingHomeComponent>;

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }
  function byTestId<T extends Element = HTMLElement>(id: string): T | null {
    return el().querySelector<T>(`[data-testid="${id}"]`);
  }
  function render(): void {
    fixture = TestBed.createComponent(OnboardingHomeComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    store = createStatusStore();
    markDismissed = jest.fn<void, []>();
    setCurrentView = jest.fn<void, [string]>();
    TestBed.configureTestingModule({
      imports: [OnboardingHomeComponent],
      providers: [
        provideRouter([]),
        { provide: SetupStatusStore, useValue: store },
        { provide: OnboardingFlagService, useValue: { markDismissed } },
        { provide: AppStateManager, useValue: { setCurrentView } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders one focusable h1 and asks for fresh status on entry', () => {
    render();
    const headings = el().querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent?.trim()).toBe('Set up Ptah for your work');
    expect(headings[0].getAttribute('tabindex')).toBe('-1');
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the three paths in order, Analyze first, each named by its h2 link', () => {
    render();
    const links = [...el().querySelectorAll<HTMLAnchorElement>('h2 a')];
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      'Analyze current project',
      'New project',
      'AI team builder',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/onboarding/analyze',
      '/onboarding/new-project',
      '/onboarding/team-builder',
    ]);
    for (const link of links) {
      const description = el().querySelector(
        `#${link.getAttribute('aria-describedby')}`,
      );
      expect(description?.textContent?.trim()).toBeTruthy();
    }
  });

  it('offers the Analyze secondary links', () => {
    render();
    expect(
      byTestId<HTMLAnchorElement>('onboarding-link-agents-only')?.getAttribute('href'),
    ).toBe('/onboarding/analyze/agents?source=catalog');
    expect(
      byTestId<HTMLAnchorElement>('onboarding-link-guidance-only')?.getAttribute('href'),
    ).toBe('/onboarding/guidance');
  });

  it('marks every icon decorative', () => {
    render();
    const icons = [...el().querySelectorAll('lucide-angular')];
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('shows skeleton tiles while the first status read is pending', () => {
    store.isLoading.set(true);
    render();
    expect(el().querySelectorAll('[data-testid="onboarding-path-tile-skeleton"]')).toHaveLength(3);
    expect(el().querySelectorAll('h2 a')).toHaveLength(0);

    store.isLoading.set(false);
    store.status.set(CONFIGURED);
    fixture.detectChanges();
    expect(el().querySelectorAll('[data-testid="onboarding-path-tile-skeleton"]')).toHaveLength(0);
  });

  it('shows status chips with state text once the checks are known', () => {
    store.status.set(CONFIGURED);
    store.agentsReady.set(true);
    store.scanReady.set(false);
    render();

    const chips = [
      ...el().querySelectorAll('[data-testid="onboarding-status-chips"] li'),
    ].map((chip) => chip.textContent?.trim());
    expect(chips).toEqual(['Not analyzed yet', '4 agents set up']);
  });

  it('shows no chip for an unknown check', () => {
    render();
    expect(byTestId('onboarding-status-chips')).toBeNull();
  });

  it('replaces only the chips when the status read fails, and Retry retries', () => {
    store.error.set('Could not check agent setup. Please try again.');
    store.scanReady.set(true);
    render();

    expect(byTestId('onboarding-status-chips')).toBeNull();
    const unavailable = byTestId('onboarding-status-unavailable');
    expect(unavailable?.textContent).toContain('Status unavailable');
    expect(el().querySelectorAll('h2 a')).toHaveLength(3);

    unavailable?.querySelector('button')?.click();
    expect(store.retry).toHaveBeenCalledTimes(1);
  });

  it('disables the tiles with an inline reason when no folder is open', () => {
    store.workspaceNotOpen.set(true);
    render();

    expect(el().querySelectorAll('h2 a')).toHaveLength(0);
    expect(byTestId('onboarding-link-agents-only')).toBeNull();
    for (const id of ['analyze', 'new-project', 'team-builder']) {
      expect(byTestId(`onboarding-path-${id}`)?.getAttribute('aria-disabled')).toBe('true');
      expect(byTestId(`onboarding-path-disabled-${id}`)?.textContent?.trim()).toBe(
        'Open a folder to use this path.',
      );
    }

    byTestId<HTMLButtonElement>('onboarding-open-folder')?.click();
    expect(store.openFolder).toHaveBeenCalledTimes(1);
  });

  it('Skip for now dismisses onboarding and returns to chat', () => {
    render();
    byTestId<HTMLButtonElement>('onboarding-skip')?.click();
    expect(markDismissed).toHaveBeenCalledTimes(1);
    expect(setCurrentView).toHaveBeenCalledWith('chat');
  });

  it('tags its surfaces with approved glass roles only', () => {
    render();
    const roles = new Set(
      [...el().querySelectorAll('[data-glass-surface]')].map((node) =>
        node.getAttribute('data-glass-surface'),
      ),
    );
    expect([...roles].sort()).toEqual(['chrome', 'tile']);
  });
});
