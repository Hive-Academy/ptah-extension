import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import type { PeerSessionRow } from '@ptah-extension/shared';

import {
  PeerSessionPickerComponent,
} from './peer-session-picker.component';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

describe('PeerSessionPickerComponent', () => {
  const row = (over: Partial<PeerSessionRow> = {}): PeerSessionRow => ({
    sessionId: 'session-a',
    name: 'Session A',
    nameSource: 'user',
    workspace: '/workspace/alpha',
    workspaceLabel: 'alpha',
    inCurrentWorkspace: true,
    reachability: 'reachable',
    pid: 1234,
    ...over,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PeerSessionPickerComponent],
    }).compileComponents();
  });

  async function create(inputs: Partial<Record<string, unknown>> = {}) {
    const fixture = TestBed.createComponent(PeerSessionPickerComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function openDropdown(
    fixture: { nativeElement: unknown; detectChanges: () => void; whenStable: () => Promise<unknown> },
  ) {
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      '[trigger]',
    ) as HTMLButtonElement;
    trigger.click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function el(fixture: { nativeElement: unknown }, testId: string) {
    return (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${testId}"]`,
    );
  }

  function all(
    fixture: { nativeElement: unknown },
    testId: string,
  ): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        `[data-testid="${testId}"]`,
      ),
    );
  }

  function options(fixture: { nativeElement: unknown }): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        'ptah-native-option',
      ),
    );
  }

  function triggerButton(fixture: { nativeElement: unknown }): HTMLButtonElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      '[trigger]',
    ) as HTMLButtonElement;
  }

  // ---------------------------------------------------------------------------
  // Injector surface: the picker must be host-agnostic.
  // ---------------------------------------------------------------------------
  describe('injector surface', () => {
    it('mounts with no injected host services', async () => {
      const fixture = await create({ sessions: [row()] });
      expect(triggerButton(fixture)).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'ptah-native-dropdown',
        ),
      ).not.toBeNull();
    });

    it('declares no inject() calls', () => {
      const source = readFileSync(
        join(__dirname, 'peer-session-picker.component.ts'),
        'utf8',
      );
      const injected = Array.from(
        source.matchAll(/\binject\(\s*([A-Za-z0-9_$.]+)/g),
        (m) => m[1],
      );
      expect(injected).toEqual([]);
    });

    it('names no host-detection concept anywhere in its source', () => {
      const source = readFileSync(
        join(__dirname, 'peer-session-picker.component.ts'),
        'utf8',
      );
      for (const banned of [
        'isElectron',
        'VSCodeService',
        'acquireVsCodeApi',
      ]) {
        expect(source).not.toContain(banned);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Empty state.
  // ---------------------------------------------------------------------------
  describe('empty state', () => {
    it('renders the empty message when no sessions are supplied', async () => {
      const fixture = await create({ sessions: [] });
      await openDropdown(fixture);
      expect(el(fixture, 'peer-session-picker-empty')?.textContent).toContain(
        'No peer sessions available.',
      );
      expect(options(fixture).length).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Row rendering: every row is visible, reachable or not.
  // ---------------------------------------------------------------------------
  describe('row rendering', () => {
    it('renders one option per session', async () => {
      const fixture = await create({
        sessions: [row({ sessionId: 'a' }), row({ sessionId: 'b' })],
      });
      await openDropdown(fixture);
      expect(options(fixture).length).toBe(2);
    });

    it('renders the session name and workspace label', async () => {
      const fixture = await create({
        sessions: [
          row({
            sessionId: 'a',
            name: 'Alpha Chat',
            workspaceLabel: 'alpha',
          }),
        ],
      });
      await openDropdown(fixture);
      expect(el(fixture, 'peer-session-picker-name')?.textContent).toContain(
        'Alpha Chat',
      );
      expect(
        el(fixture, 'peer-session-picker-workspace')?.textContent,
      ).toContain('alpha');
    });

    it('marks cross-workspace rows with a badge', async () => {
      const fixture = await create({
        sessions: [
          row({ sessionId: 'local', inCurrentWorkspace: true }),
          row({ sessionId: 'remote', inCurrentWorkspace: false }),
        ],
      });
      await openDropdown(fixture);
      const badges = all(fixture, 'peer-session-picker-cross-workspace');
      expect(badges.length).toBe(1);
      expect(badges[0].textContent).toContain('other workspace');
    });

    it('does not hide unreachable rows', async () => {
      const fixture = await create({
        sessions: [
          row({ sessionId: 'ok', reachability: 'reachable' }),
          row({
            sessionId: 'bad',
            reachability: 'unreachable',
            unreachableReason: 'process-not-running',
          }),
        ],
      });
      await openDropdown(fixture);
      expect(options(fixture).length).toBe(2);
    });

    it('disables unreachable rows and shows the reason', async () => {
      const fixture = await create({
        sessions: [
          row({
            sessionId: 'bad',
            reachability: 'unreachable',
            unreachableReason: 'process-identity-mismatch',
          }),
        ],
      });
      await openDropdown(fixture);
      const option = options(fixture)[0];
      expect(option.getAttribute('aria-disabled')).toBe('true');
      expect(option.getAttribute('role')).toBe('option');
      expect(
        el(fixture, 'peer-session-picker-reason')?.textContent,
      ).toContain('process identity mismatch');
    });

    it('falls back to a generic reason when the backend supplies none', async () => {
      const fixture = await create({
        sessions: [
          row({
            sessionId: 'bad',
            reachability: 'unreachable',
          }),
        ],
      });
      await openDropdown(fixture);
      expect(
        el(fixture, 'peer-session-picker-reason')?.textContent,
      ).toContain('unreachable');
    });
  });

  // ---------------------------------------------------------------------------
  // Selection and the trigger label.
  // ---------------------------------------------------------------------------
  describe('selection', () => {
    it('reflects the selected session id in the trigger', async () => {
      const fixture = await create({
        sessions: [
          row({ sessionId: 'a', name: 'Alpha' }),
          row({ sessionId: 'b', name: 'Beta' }),
        ],
        selectedSessionId: 'b',
      });
      expect(triggerButton(fixture).textContent).toContain('Beta');
    });

    it('shows the placeholder when no session is selected', async () => {
      const fixture = await create({
        sessions: [row({ sessionId: 'a', name: 'Alpha' })],
      });
      expect(triggerButton(fixture).textContent).toContain(
        'Select a peer session',
      );
    });

    it('emits the chosen reachable row and closes the picker', async () => {
      const fixture = await create({
        sessions: [row({ sessionId: 'a', name: 'Alpha' })],
      });
      const emitted: PeerSessionRow[] = [];
      fixture.componentInstance.selectionChange.subscribe((s) =>
        emitted.push(s),
      );

      await openDropdown(fixture);
      options(fixture)[0].click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].sessionId).toBe('a');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.dropdown-panel'),
      ).toBeNull();
    });

    it('does not emit or close when an unreachable row is clicked', async () => {
      const fixture = await create({
        sessions: [
          row({
            sessionId: 'bad',
            reachability: 'unreachable',
            unreachableReason: 'process-not-running',
          }),
        ],
      });
      const emitted: PeerSessionRow[] = [];
      fixture.componentInstance.selectionChange.subscribe((s) =>
        emitted.push(s),
      );

      await openDropdown(fixture);
      options(fixture)[0].click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(emitted.length).toBe(0);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('.dropdown-panel'),
      ).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Refresh on open.
  // ---------------------------------------------------------------------------
  describe('refresh on open', () => {
    it('emits opened each time the picker is opened', async () => {
      const fixture = await create({ sessions: [row()] });
      const opened: void[] = [];
      fixture.componentInstance.opened.subscribe(() => opened.push(undefined));

      triggerButton(fixture).click();
      await fixture.whenStable();
      expect(opened.length).toBe(1);

      // Close by clicking the trigger again.
      triggerButton(fixture).click();
      await fixture.whenStable();
      fixture.detectChanges();

      triggerButton(fixture).click();
      await fixture.whenStable();
      expect(opened.length).toBe(2);
    });

    it('does not emit opened while the picker stays open', async () => {
      const fixture = await create({ sessions: [row()] });
      const opened: void[] = [];
      fixture.componentInstance.opened.subscribe(() => opened.push(undefined));

      await openDropdown(fixture);

      // Clicking the row keeps the panel open and must not re-emit opened.
      options(fixture)[0].click();
      await fixture.whenStable();
      expect(opened.length).toBe(1);
    });
  });
});
