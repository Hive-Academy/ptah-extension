/**
 * RemovalLockBadgeComponent specs (plan C8, Task 9.2).
 *
 * A compact lock button opens a `NativePopover` with the reason, the `<code>`
 * command and a copy button; no command means no copy button.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RemovalLockBadgeComponent } from './removal-lock-badge.component';

// The real popover positions itself with Floating UI, which needs layout that
// jsdom does not have. Same stand-in as the ui popover spec.
jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

const REASON =
  'sentry is declared in ~/.claude.json and owned by the Claude CLI.';
const COMMAND = 'claude mcp remove sentry';

async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  fixture.detectChanges();
}

describe('RemovalLockBadgeComponent', () => {
  let fixture: ComponentFixture<RemovalLockBadgeComponent>;
  let element: HTMLElement;

  function render(fixCommand?: string | null): void {
    fixture = TestBed.createComponent(RemovalLockBadgeComponent);
    fixture.componentRef.setInput('serverName', 'sentry');
    fixture.componentRef.setInput('reason', REASON);
    if (fixCommand !== undefined) {
      fixture.componentRef.setInput('fixCommand', fixCommand);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const lockButton = (): HTMLButtonElement =>
    element.querySelector(
      '[data-testid="removal-lock-button"]',
    ) as HTMLButtonElement;
  const details = (): HTMLElement | null =>
    element.querySelector('[data-testid="removal-lock-details"]');

  async function open(): Promise<void> {
    lockButton().click();
    await settle(fixture);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [RemovalLockBadgeComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is a compact lock button named "Removal blocked — details"', () => {
    render(COMMAND);
    const button = lockButton();
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-label')).toBe('Removal blocked — details');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.querySelector('lucide-angular')).not.toBeNull();
    expect(button.textContent?.trim()).toBe('Blocked');
  });

  it('never puts the reason in the action column while closed', () => {
    render(COMMAND);
    expect(details()).toBeNull();
    expect(element.textContent).not.toContain(REASON);
    expect(element.querySelector('p')).toBeNull();
  });

  it('opens a popover with the reason, the command in <code> and a copy button', async () => {
    render(COMMAND);
    await open();
    expect(lockButton().getAttribute('aria-expanded')).toBe('true');
    const panel = details();
    expect(panel?.getAttribute('role')).toBe('dialog');
    const headingId = panel?.getAttribute('aria-labelledby');
    expect(headingId).toBeTruthy();
    expect(element.querySelector(`#${headingId}`)?.textContent).toContain(
      'sentry',
    );
    expect(
      panel
        ?.querySelector('[data-testid="removal-lock-reason"]')
        ?.textContent?.trim(),
    ).toBe(REASON);
    const code = panel?.querySelector('code');
    expect(code?.textContent).toBe(COMMAND);
    expect(
      panel?.querySelector('[data-testid="copy-command-button"]'),
    ).not.toBeNull();
  });

  it.each([undefined, null, '', '   '])(
    'shows the reason but no command and no copy button when fixCommand is %p',
    async (fixCommand) => {
      render(fixCommand);
      await open();
      expect(details()?.textContent).toContain(REASON);
      expect(details()?.querySelector('code')).toBeNull();
      expect(
        details()?.querySelector('[data-testid="copy-command-button"]'),
      ).toBeNull();
    },
  );

  it('selects the command in the popover when the clipboard rejects', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    try {
      render(COMMAND);
      await open();
      (
        details()?.querySelector(
          '[data-testid="copy-command-button"]',
        ) as HTMLButtonElement
      ).click();
      await settle(fixture);
      const selection = document.getSelection();
      expect(selection?.getRangeAt(0).toString()).toBe(COMMAND);
    } finally {
      if (original) {
        Object.defineProperty(navigator, 'clipboard', original);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
      document.getSelection()?.removeAllRanges();
    }
  });

  it('closes on Escape', async () => {
    render(COMMAND);
    await open();
    details()?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await settle(fixture);
    expect(details()).toBeNull();
    expect(lockButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles closed on a second click', async () => {
    render(COMMAND);
    await open();
    await open();
    expect(details()).toBeNull();
  });

  it('gives each badge its own heading id', async () => {
    render(COMMAND);
    await open();
    const first = details()?.getAttribute('aria-labelledby');
    const firstFixture = fixture;
    render(COMMAND);
    await open();
    expect(details()?.getAttribute('aria-labelledby')).not.toBe(first);
    firstFixture.destroy();
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'removal-lock-badge.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
