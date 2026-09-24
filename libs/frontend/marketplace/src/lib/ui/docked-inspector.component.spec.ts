/**
 * DockedInspectorComponent specs (plan C8, Task 9.3).
 *
 * An `<aside aria-labelledby>` with a close button and a scrolling body of one
 * projected slot. Unlike the modal drawer it never moves focus, including
 * when the heading or the projected content changes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DockedInspectorComponent } from './docked-inspector.component';

@Component({
  standalone: true,
  imports: [DockedInspectorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" data-testid="row">Row</button>
    @if (open()) {
      <ptah-docked-inspector
        [heading]="heading()"
        (closed)="closedCount.update((n) => n + 1)"
      >
        <p data-testid="projected">{{ body() }}</p>
        <button type="button" data-testid="inner-action">Act</button>
      </ptah-docked-inspector>
    }
  `,
})
class HostComponent {
  public readonly open = signal(true);
  public readonly heading = signal('sentry');
  public readonly body = signal('Details for sentry');
  public readonly closedCount = signal(0);
}

describe('DockedInspectorComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => element.querySelector<T>(`[data-testid="${id}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    document.body.appendChild(element);
    fixture.detectChanges();
  });

  afterEach(() => {
    element.remove();
    TestBed.resetTestingModule();
  });

  it('is an aside named by its heading', () => {
    const aside = byTestId('docked-inspector');
    expect(aside?.tagName).toBe('ASIDE');
    const headingId = aside?.getAttribute('aria-labelledby');
    expect(headingId).toBeTruthy();
    const heading = element.querySelector(`#${headingId}`);
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe('sentry');
  });

  it('projects its content into the scrolling body', () => {
    const body = byTestId('docked-inspector-body');
    expect(body?.className).toContain('overflow-y-auto');
    expect(body?.querySelector('[data-testid="projected"]')?.textContent).toBe(
      'Details for sentry',
    );
  });

  it('has a named close button that emits closed', () => {
    const close = byTestId<HTMLButtonElement>('docked-inspector-close');
    expect(close?.getAttribute('aria-label')).toBe('Close details');
    expect(close?.getAttribute('type')).toBe('button');
    close?.click();
    expect(host.closedCount()).toBe(1);
  });

  it('does not take focus when it appears', async () => {
    host.open.set(false);
    await settle();
    const row = byTestId<HTMLButtonElement>('row');
    row?.focus();
    host.open.set(true);
    await settle();
    expect(document.activeElement).toBe(row);
  });

  it('does not steal focus when the heading or content changes', async () => {
    const row = byTestId<HTMLButtonElement>('row');
    row?.focus();
    host.heading.set('linear');
    host.body.set('Details for linear');
    await settle();
    expect(document.activeElement).toBe(row);
    expect(byTestId('docked-inspector-heading')?.textContent?.trim()).toBe(
      'linear',
    );
  });

  it('leaves focus inside the pane where the user put it', async () => {
    const inner = byTestId<HTMLButtonElement>('inner-action');
    inner?.focus();
    host.body.set('Updated');
    await settle();
    expect(document.activeElement).toBe(inner);
  });

  it('gives each pane its own heading id', () => {
    const first = byTestId('docked-inspector')?.getAttribute('aria-labelledby');
    const second = TestBed.createComponent(DockedInspectorComponent);
    second.componentRef.setInput('heading', 'other');
    second.detectChanges();
    const secondId = (second.nativeElement as HTMLElement)
      .querySelector('aside')
      ?.getAttribute('aria-labelledby');
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe(first);
  });

  describe('component source', () => {
    const source = readFileSync(
      join(__dirname, 'docked-inspector.component.ts'),
      'utf8',
    );

    it('has exactly one projection slot', () => {
      expect(source.match(/<ng-content\b/g)).toHaveLength(1);
    });

    it('never calls focus()', () => {
      expect(source).not.toMatch(/\.focus\(/);
    });

    it('does not use innerHTML', () => {
      expect(source).not.toMatch(/innerHTML/i);
    });
  });
});
