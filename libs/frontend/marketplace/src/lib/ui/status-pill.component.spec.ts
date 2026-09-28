/**
 * StatusPillComponent specs (plan C8, Task 9.1).
 *
 * Every status shows an icon and a word, never colour alone; `unknown` shows
 * the source's raw text in the neutral tone.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import type { ProviderStatus } from '../data/provider-row';
import {
  StatusPillComponent,
  statusPresentation,
} from './status-pill.component';

const KNOWN_STATUSES: readonly Exclude<ProviderStatus, 'unknown'>[] = [
  'connected',
  'failed',
  'needs-auth',
  'needs-input',
  'pending',
  'disabled',
  'expired',
  'disconnected',
  'configured',
];

describe('StatusPillComponent', () => {
  let fixture: ComponentFixture<StatusPillComponent>;
  let element: HTMLElement;

  function render(status: ProviderStatus, statusText?: string): void {
    fixture = TestBed.createComponent(StatusPillComponent);
    fixture.componentRef.setInput('status', status);
    if (statusText !== undefined) {
      fixture.componentRef.setInput('statusText', statusText);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const pill = (): HTMLElement =>
    element.querySelector('[data-testid="status-pill"]') as HTMLElement;
  const label = (): string =>
    element
      .querySelector('[data-testid="status-pill-label"]')
      ?.textContent?.trim() ?? '';

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StatusPillComponent] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it.each(KNOWN_STATUSES)(
    'renders an icon and a word for %s, never colour alone',
    (status) => {
      render(status);
      const icon = pill().querySelector('lucide-angular');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(label()).toBe(statusPresentation(status).label);
      expect(label().length).toBeGreaterThan(0);
      expect(pill().getAttribute('data-status')).toBe(status);
    },
  );

  it.each<[ProviderStatus, string, string]>([
    ['connected', 'Connected', 'success'],
    ['failed', 'Failed', 'error'],
    ['needs-auth', 'Needs sign-in', 'warning'],
    ['needs-input', 'Needs input', 'warning'],
    ['expired', 'Expired', 'warning'],
    ['pending', 'Pending', 'info'],
    ['configured', 'Configured', 'neutral'],
  ])('maps %s to "%s" in the %s tone', (status, word, tone) => {
    render(status);
    expect(label()).toBe(word);
    expect(pill().getAttribute('data-tone')).toBe(tone);
    expect(pill().className).toContain(
      `text-${tone === 'neutral' ? 'base-content-muted' : tone}`,
    );
  });

  it('renders an unknown status neutral with the raw text', () => {
    render('unknown', 'rate-limited');
    expect(label()).toBe('rate-limited');
    expect(pill().getAttribute('data-tone')).toBe('neutral');
    expect(pill().className).toContain('text-base-content-muted');
    expect(pill().querySelector('lucide-angular')).not.toBeNull();
  });

  it('keeps a long raw text whole in the title', () => {
    const raw = 'upstream said something very long about its own state';
    render('unknown', raw);
    expect(pill().getAttribute('title')).toBe(raw);
  });

  it('falls back to "Unknown" when the raw text is blank or absent', () => {
    render('unknown', '   ');
    expect(label()).toBe('Unknown');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [StatusPillComponent] });
    render('unknown');
    expect(label()).toBe('Unknown');
  });

  it('ignores statusText for a known status', () => {
    render('connected', 'something else');
    expect(label()).toBe('Connected');
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'status-pill.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
