import { signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { VSCodeService } from '@ptah-extension/core';
import {
  OnboardingFlagService,
  type OnboardingFlag,
} from '../first-run/onboarding-flag.service';
import { OnboardingAnnouncerService } from '../shell/onboarding-announcer.service';
import {
  ClaudeReadinessStore,
  type ClaudeReadinessErrorCause,
  type ClaudeReadinessState,
  type ClaudeReadinessView,
} from './claude-readiness.store';
import { ReadyClaudeStepPage } from './ready-claude-step.page';

const PATH = '/home/me/.local/bin/claude';
const VERSION = '2.1.211';

function viewOf(
  state: ClaudeReadinessState,
  errorCause: ClaudeReadinessErrorCause | null = null,
): ClaudeReadinessView {
  const installed = state === 'ready' || state === 'signed-out';
  return {
    state,
    errorCause,
    path: installed ? PATH : null,
    version: installed ? VERSION : null,
  };
}

describe('ReadyClaudeStepPage', () => {
  let fixture: ComponentFixture<ReadyClaudeStepPage>;
  let view: WritableSignal<ClaudeReadinessView>;
  let rechecking: WritableSignal<boolean>;
  let refresh: jest.Mock<Promise<ClaudeReadinessState>, [boolean]>;
  let markReady: jest.Mock;
  let announce: jest.Mock<void, [string]>;
  let navigate: jest.SpyInstance;

  function render(
    state: ClaudeReadinessState,
    cause: ClaudeReadinessErrorCause | null = null,
    platform?: string,
  ): HTMLElement {
    view = signal(viewOf(state, cause));
    rechecking = signal(false);
    refresh = jest.fn().mockResolvedValue(state);
    markReady = jest.fn();
    announce = jest.fn();
    TestBed.configureTestingModule({
      imports: [ReadyClaudeStepPage],
      providers: [
        provideRouter([]),
        {
          provide: ClaudeReadinessStore,
          useValue: { view, rechecking, refresh, available: true },
        },
        {
          provide: OnboardingFlagService,
          useValue: { flag: signal<OnboardingFlag>({}), markReady },
        },
        { provide: OnboardingAnnouncerService, useValue: { announce } },
        {
          provide: VSCodeService,
          useValue: { config: signal({ platform }) },
        },
      ],
    });
    navigate = jest
      .spyOn(TestBed.inject(Router), 'navigate')
      .mockResolvedValue(true);
    fixture = TestBed.createComponent(ReadyClaudeStepPage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const q = <T extends HTMLElement = HTMLElement>(
    el: HTMLElement,
    id: string,
  ): T | null => el.querySelector<T>(`[data-testid="${id}"]`);

  afterEach(() => TestBed.resetTestingModule());

  it('reads the state once on mount (host cache)', () => {
    render('checking');
    expect(refresh).toHaveBeenCalledWith(false);
  });

  it('has one h1 "Check Claude Code" focusable for route-entry focus', () => {
    const el = render('ready');
    const h1s = el.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent?.trim()).toBe('Check Claude Code');
    expect(h1s[0].getAttribute('tabindex')).toBe('-1');
  });

  it('checking: chip, skeleton with sr text, left text, only Continue anyway, aria-busy', () => {
    const el = render('checking');
    expect(q(el, 'ready-claude-chip')?.textContent).toContain('Checking');
    expect(
      q(el, 'ready-claude-facts')?.querySelector('.sr-only')?.textContent,
    ).toBe('Checking');
    expect(el.textContent).toContain('Checking your computer...');
    expect(q(el, 'ready-claude-panel')?.getAttribute('aria-busy')).toBe('true');
    expect(q(el, 'ready-continue-anyway')).not.toBeNull();
    expect(q(el, 'ready-recheck')).toBeNull();
    expect(q(el, 'ready-continue')).toBeNull();
    expect(q(el, 'ready-continue-note')).toBeNull();
  });

  it('ready: chip, path and version in mono, the connected line, Continue only', () => {
    const el = render('ready');
    const facts = q(el, 'ready-claude-facts');
    expect(q(el, 'ready-claude-chip')?.textContent).toContain('Ready');
    const mono = Array.from(facts?.querySelectorAll('.font-mono') ?? []).map(
      (node) => node.textContent,
    );
    expect(mono).toEqual([PATH, VERSION]);
    expect(facts?.textContent).toContain(
      'Yes. Your Claude account is connected.',
    );
    expect(q(el, 'ready-continue')).not.toBeNull();
    expect(q(el, 'ready-continue-anyway')).toBeNull();
    expect(q(el, 'ready-claude-panel')?.getAttribute('aria-busy')).toBe(
      'false',
    );
  });

  it('missing: chip, three lines, install block, Re-check and Continue anyway, the D11 line', () => {
    const el = render('missing');
    const facts = q(el, 'ready-claude-facts')?.textContent ?? '';
    expect(q(el, 'ready-claude-chip')?.textContent).toContain('Not installed');
    expect(facts).toContain('command was found.');
    expect(facts).toContain('Not available');
    expect(facts).toContain('Install Claude Code first.');
    const block = q(el, 'ready-install-block');
    expect(block?.textContent).toContain('Install Claude Code');
    expect(block?.textContent).toContain(
      'restart Ptah so it picks up the updated PATH.',
    );
    expect(block?.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(block?.querySelectorAll('ptah-command-copy-row')).toHaveLength(4);
    expect(q(el, 'ready-recheck')?.textContent).toContain('Re-check');
    expect(q(el, 'ready-continue-anyway')).not.toBeNull();
    expect(q(el, 'ready-continue-note')?.textContent).toContain(
      'You can continue without it. A warning stays on the next screens until Claude Code is ready.',
    );
  });

  it('missing: the docs link opens safely over https', () => {
    const link = q<HTMLAnchorElement>(render('missing'), 'ready-docs-link');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(new URL(link?.href ?? '').protocol).toBe('https:');
  });

  it.each([
    ['win32', 'windows'],
    ['darwin', 'unix'],
    ['linux', 'unix'],
    [undefined, 'unix'],
  ])('preselects the OS tab for platform %s', (platform, tab) => {
    const el = render('missing', null, platform);
    const selected = el.querySelector('[role="tab"][aria-selected="true"]');
    expect(selected?.id).toBe(`ready-os-tab-${tab}`);
    expect(selected?.getAttribute('tabindex')).toBe('0');
    expect(q(el, `ready-os-panel-${tab}`)?.hidden).toBe(false);
  });

  it('wraps the OS tablist with the arrow keys and moves focus', () => {
    const el = render('missing', null, 'linux');
    const tabs = () =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    tabs()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    fixture.detectChanges();
    expect(tabs()[2].getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabs()[2]);

    tabs()[2].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    fixture.detectChanges();
    expect(tabs()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('signed-out: chip, path, version, sign-in block with the claude command', () => {
    const el = render('signed-out');
    expect(q(el, 'ready-claude-chip')?.textContent).toContain('Not signed in');
    const facts = q(el, 'ready-claude-facts')?.textContent ?? '';
    expect(facts).toContain(PATH);
    expect(facts).toContain(VERSION);
    expect(facts).toContain('No. Sign in to use Claude Code.');
    const block = q(el, 'ready-sign-in-block');
    expect(block?.querySelector('code')?.textContent).toBe('claude');
    expect(q(el, 'ready-recheck')).not.toBeNull();
    expect(q(el, 'ready-continue-anyway')).not.toBeNull();
  });

  it('signed-out: the named-account link targets stage 2 Providers with the Accounts drawer', () => {
    const link = q<HTMLAnchorElement>(
      render('signed-out'),
      'ready-named-account-link',
    );
    const url = new URL(link?.getAttribute('href') ?? '', 'http://x');
    expect(url.pathname).toBe('/onboarding/ready/settings');
    expect(url.searchParams.get('area')).toBe('providers');
    expect(url.searchParams.get('open')).toBe('claude-accounts');
  });

  it.each<[ClaudeReadinessErrorCause, string, boolean]>([
    [
      'timeout',
      'Claude Code did not answer in time (30 s). Your sign-in could not be read.',
      true,
    ],
    ['unreadable', 'Ptah could not read the Claude Code sign-in.', false],
    ['local', 'Ptah could not ask this computer about Claude Code.', false],
  ])(
    'error (%s): chip, cause line, block with details and docs link',
    (cause, line, timedOut) => {
      const el = render('error', cause);
      expect(q(el, 'ready-claude-chip')?.textContent).toContain(
        'Could not check',
      );
      const facts = q(el, 'ready-claude-facts')?.textContent ?? '';
      expect(facts).toContain('Unknown');
      expect(facts).toContain(line);
      const block = q(el, 'ready-error-block');
      expect(block?.textContent).toContain('Ptah could not read Claude Code');
      expect(block?.textContent?.includes('The check timed out.')).toBe(
        timedOut,
      );
      expect(block?.querySelector('summary')?.textContent).toContain(
        'Install or sign in by hand',
      );
      expect(
        block?.querySelector('[data-testid="ready-docs-link"]'),
      ).not.toBeNull();
      expect(q(el, 'ready-recheck')).not.toBeNull();
      expect(q(el, 'ready-continue-anyway')).not.toBeNull();
    },
  );

  it('Continue writes claudeAt and goes to stage 2', () => {
    const el = render('ready');
    q(el, 'ready-continue')?.click();
    expect(markReady).toHaveBeenCalledWith('claudeAt');
    expect(navigate).toHaveBeenCalledWith(['/onboarding', 'ready', 'settings']);
  });

  it.each<ClaudeReadinessState>(['checking', 'missing', 'signed-out', 'error'])(
    'Continue anyway in %s writes skippedAt and goes to stage 2',
    (state) => {
      const el = render(state, state === 'error' ? 'local' : null);
      q(el, 'ready-continue-anyway')?.click();
      expect(markReady).toHaveBeenCalledWith('skippedAt');
      expect(navigate).toHaveBeenCalledWith([
        '/onboarding',
        'ready',
        'settings',
      ]);
    },
  );

  it('Re-check refreshes fresh, reads "Checking..." while it runs, keeps focus and announces', async () => {
    const el = render('missing');
    let finish!: (state: ClaudeReadinessState) => void;
    refresh.mockImplementation(() => {
      rechecking.set(true);
      view.set(viewOf('checking'));
      return new Promise((resolve) => (finish = resolve));
    });
    const button = q<HTMLButtonElement>(el, 'ready-recheck');
    button?.focus();

    button?.click();
    fixture.detectChanges();

    expect(refresh).toHaveBeenLastCalledWith(true);
    const running = q<HTMLButtonElement>(el, 'ready-recheck');
    expect(running).toBe(button);
    expect(running?.textContent).toContain('Checking...');
    expect(running?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(button);
    expect(q(el, 'ready-claude-panel')?.getAttribute('aria-busy')).toBe('true');

    running?.click();
    expect(refresh).toHaveBeenCalledTimes(2); // mount + one Re-check

    rechecking.set(false);
    view.set(viewOf('missing'));
    finish('missing');
    await fixture.whenStable();
    expect(announce).toHaveBeenCalledWith('Claude Code is still not installed');
  });

  it('moves focus to Continue when Re-check resolves ready', async () => {
    const el = render('missing');
    refresh.mockImplementation(async () => {
      view.set(viewOf('ready'));
      return 'ready';
    });
    const button = q<HTMLButtonElement>(el, 'ready-recheck');
    button?.focus();

    button?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(q(el, 'ready-continue'));
  });

  it.each<[ClaudeReadinessState, string]>([
    ['ready', 'Claude Code is ready'],
    ['signed-out', 'Claude Code is still not signed in'],
    ['error', 'Ptah still could not check Claude Code'],
  ])('announces the Re-check result %s', async (result, message) => {
    const el = render('missing');
    refresh.mockResolvedValue(result);
    q(el, 'ready-recheck')?.click();
    await fixture.whenStable();
    expect(announce).toHaveBeenCalledWith(message);
  });
});
