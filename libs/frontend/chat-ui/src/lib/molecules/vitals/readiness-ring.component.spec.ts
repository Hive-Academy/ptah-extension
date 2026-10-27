import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  ReadinessRingComponent,
  type ReadinessAction,
  type ReadinessCheck,
} from './readiness-ring.component';

const CHECKS: readonly ReadinessCheck[] = [
  { id: 'skills', label: 'Skills', ready: true },
  { id: 'scan', label: 'Project scan', ready: true },
  { id: 'agents', label: 'Agents', ready: false },
];

describe('ReadinessRingComponent', () => {
  let fixture: ComponentFixture<ReadinessRingComponent>;
  let host: HTMLElement;

  function render(
    checks: readonly ReadinessCheck[],
    action: ReadinessAction | null = null,
  ): void {
    fixture.componentRef.setInput('checks', checks);
    fixture.componentRef.setInput('action', action);
    fixture.detectChanges();
  }

  function ring(): HTMLElement {
    return host.querySelector('ptah-progress-ring') as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReadinessRingComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ReadinessRingComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('reads "2/3 ready" on a large gold ring', () => {
    render(CHECKS);

    expect(ring().getAttribute('data-size')).toBe('lg');
    expect(ring().getAttribute('data-tone')).toBe('gold');
    expect(host.querySelector('.ptah-ring__value')?.textContent?.trim()).toBe(
      '2/3',
    );
    expect(host.querySelector('.ptah-ring__sub')?.textContent?.trim()).toBe(
      'ready',
    );
    expect(ring().classList).not.toContain('ptah-ring--indeterminate');
  });

  it('names every check in the ring accessible name', () => {
    render(CHECKS);

    expect(ring().getAttribute('aria-label')).toBe(
      'Workspace readiness: 2 of 3 ready. Skills ready, Project scan ready, Agents not ready',
    );
  });

  it('is indeterminate and reads "checking" while a check is unknown', () => {
    render([CHECKS[0], { id: 'scan', label: 'Project scan', ready: null }]);

    expect(ring().classList).toContain('ptah-ring--indeterminate');
    expect(host.querySelector('.ptah-ring__value')).toBeNull();
    expect(host.querySelector('.ptah-ring__sub')?.textContent?.trim()).toBe(
      'checking',
    );
    expect(ring().getAttribute('aria-label')).toBe(
      'Checking workspace readiness. Skills ready, Project scan checking',
    );
  });

  it('treats an empty check list as checking, never "0/0 ready"', () => {
    render([]);

    expect(ring().classList).toContain('ptah-ring--indeterminate');
    expect(host.querySelector('.ptah-ring__value')).toBeNull();
    expect(host.querySelector('.ptah-ring__sub')?.textContent?.trim()).toBe(
      'checking',
    );
    expect(ring().getAttribute('aria-label')).toBe(
      'Checking workspace readiness',
    );
  });

  it('renders no link without an action', () => {
    render(CHECKS);

    expect(host.querySelector('button')).toBeNull();
  });

  it('emits the action id from a keyboard-reachable link button', () => {
    const emitted: string[] = [];
    fixture.componentInstance.actionRequested.subscribe((id) =>
      emitted.push(id),
    );
    render(CHECKS, { id: 'agents', label: 'Generate agents' });

    const link = host.querySelector('button') as HTMLButtonElement;
    expect(link.type).toBe('button');
    expect(link.textContent?.trim()).toBe('Generate agents');
    link.click();
    expect(emitted).toEqual(['agents']);
  });

  it('declares a visible focus ring and binds no raw HTML', () => {
    const source = readFileSync(
      join(__dirname, 'readiness-ring.component.ts'),
      'utf8',
    );
    const flat = source.replace(/\s+/g, ' ');

    expect(flat).toMatch(
      /\.ptah-readiness__link:focus-visible \{[^}]*outline: 2px solid oklch\(var\(--p\)\);/,
    );
    expect(source).not.toMatch(/innerHTML/);
  });

  it('colours the link text with the measured link token, not the raw primary', () => {
    const flat = readFileSync(
      join(__dirname, 'readiness-ring.component.ts'),
      'utf8',
    ).replace(/\s+/g, ' ');
    const link = /\.ptah-readiness__link \{([^}]*)\}/.exec(flat)?.[1] ?? '';

    expect(link).toMatch(/color: var\(--ptah-link, oklch\(var\(--p\)\)\);/);
    expect(link).not.toMatch(/(^|[;\s])color: oklch\(var\(--p\)\);/);
  });
});
