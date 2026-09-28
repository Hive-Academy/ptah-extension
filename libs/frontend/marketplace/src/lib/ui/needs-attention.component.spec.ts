/**
 * NeedsAttentionComponent specs (plan C8 `NeedsAttention`, Task 10.3).
 *
 * Icon + hidden severity word, title, detail and a "Review" routerLink per
 * item; the link for each `NeedsAttentionTarget`; an empty state; loading
 * and error with Retry.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import type { NeedsAttentionItem } from '../data/attention';
import {
  NeedsAttentionComponent,
  needsAttentionLink,
} from './needs-attention.component';

const SESSION_FAILED: NeedsAttentionItem = {
  id: 'session:github',
  source: 'session',
  severity: 'error',
  title: 'github failed to start',
  detail: 'Reported by the most recent session.',
  target: { kind: 'server', ref: 'harness-config:github' },
};
const HARNESS: NeedsAttentionItem = {
  id: 'harness:cursor',
  source: 'harness',
  severity: 'warning',
  title: 'Cursor is out of sync',
  detail: '2 missing',
  target: { kind: 'harness' },
};
const SMITHERY: NeedsAttentionItem = {
  id: 'smithery:c1',
  source: 'connection',
  severity: 'warning',
  title: 'exa',
  detail: 'Smithery needs you to authorize this connection.',
  target: { kind: 'smithery' },
};
const AMBIGUOUS: NeedsAttentionItem = {
  id: 'session:shared',
  source: 'session',
  severity: 'warning',
  title: 'shared needs sign-in',
  detail: 'Reported by the most recent session.',
  target: { kind: 'servers' },
};

describe('needsAttentionLink', () => {
  it.each([
    [
      SESSION_FAILED.target,
      ['/', 'marketplace', 'servers', 'harness-config:github'],
    ],
    [AMBIGUOUS.target, ['/', 'marketplace', 'servers']],
    [SMITHERY.target, ['/', 'marketplace', 'servers', 'smithery']],
    [HARNESS.target, ['/', 'marketplace', 'skills']],
  ])('links %p to %p', (target, commands) => {
    expect(needsAttentionLink(target)).toEqual(commands);
  });
});

describe('NeedsAttentionComponent', () => {
  let fixture: ComponentFixture<NeedsAttentionComponent>;
  let component: NeedsAttentionComponent;
  let element: HTMLElement;
  let router: Router;

  function render(inputs: Record<string, unknown> = {}): void {
    fixture = TestBed.createComponent(NeedsAttentionComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('items', [
      SESSION_FAILED,
      HARNESS,
      SMITHERY,
      AMBIGUOUS,
    ]);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  }

  const items = (): HTMLElement[] =>
    Array.from(
      element.querySelectorAll<HTMLElement>(
        '[data-testid="needs-attention-item"]',
      ),
    );

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NeedsAttentionComponent],
      providers: [provideRouter([])],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('is a section named by its heading, with a count', () => {
    render();
    const section = element.querySelector('section');
    const heading = element.querySelector(
      `#${section?.getAttribute('aria-labelledby')}`,
    );
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent).toContain('Needs attention');
    expect(
      element
        .querySelector('[data-testid="needs-attention-count"]')
        ?.textContent?.trim(),
    ).toBe('4');
  });

  it('renders every item in order with icon, hidden severity, title and detail', () => {
    render();
    const list = items();
    expect(list.map((li) => li.getAttribute('data-severity'))).toEqual([
      'error',
      'warning',
      'warning',
      'warning',
    ]);
    const first = list[0];
    expect(
      first.querySelector('[data-testid="needs-attention-icon"]')?.classList,
    ).toContain('text-error');
    expect(first.querySelector('.sr-only')?.textContent?.trim()).toBe('Error:');
    expect(first.textContent).toContain('github failed to start');
    expect(first.textContent).toContain('Reported by the most recent session.');
    expect(list[1].querySelector('.sr-only')?.textContent?.trim()).toBe(
      'Warning:',
    );
  });

  it('gives each item a "Review" routerLink to its route', () => {
    render();
    const links = items().map(
      (li) =>
        li.querySelector(
          '[data-testid="needs-attention-review"]',
        ) as HTMLAnchorElement,
    );
    expect(
      links.every(
        (a) => a.tagName === 'A' && a.textContent?.trim() === 'Review',
      ),
    ).toBe(true);
    expect(links[0].getAttribute('aria-label')).toBe(
      'Review github failed to start',
    );
    const expected = [SESSION_FAILED, HARNESS, SMITHERY, AMBIGUOUS].map(
      (item) =>
        router.serializeUrl(
          router.createUrlTree(needsAttentionLink(item.target)),
        ),
    );
    expect(links.map((a) => a.getAttribute('href'))).toEqual(expected);
    expect(expected[0]).toBe('/marketplace/servers/harness-config:github');
  });

  it('shows the empty state when nothing needs attention', () => {
    render({ items: [] });
    expect(
      element.querySelector('[data-testid="needs-attention-empty"]')
        ?.textContent,
    ).toContain('Nothing needs attention.');
    expect(
      element.querySelector('[data-testid="needs-attention-list"]'),
    ).toBeNull();
    expect(
      element.querySelector('[data-testid="needs-attention-count"]'),
    ).toBeNull();
  });

  it('shows a skeleton while loading', () => {
    render({ state: 'loading' });
    expect(element.querySelector('section')?.getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(
      element.querySelector('[data-testid="needs-attention-loading"]'),
    ).not.toBeNull();
    expect(items()).toHaveLength(0);
  });

  it('shows the error with a Retry output', () => {
    render({ state: 'error', errorMessage: 'Harness health did not answer.' });
    const retries: void[] = [];
    component.retryRequested.subscribe(() => retries.push(undefined));
    const error = element.querySelector(
      '[data-testid="needs-attention-error"]',
    );
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toContain('Harness health did not answer.');
    (
      element.querySelector(
        '[data-testid="needs-attention-retry"]',
      ) as HTMLButtonElement
    ).click();
    expect(retries).toHaveLength(1);
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'needs-attention.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
