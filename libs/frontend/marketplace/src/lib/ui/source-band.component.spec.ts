/**
 * SourceBandComponent specs (plan C8, Task 11.1).
 *
 * The header above one discovery source: heading (the page `<h1>` by
 * default), optional eyebrow, description and meta, and two slots. The
 * storefront layout carries the hero gradient and the gold eyebrow; the
 * compact layout keeps the eyebrow muted.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import {
  SOURCE_BAND_MAX_META,
  SourceBandComponent,
  type SourceBandHeadingLevel,
  type SourceBandLayout,
} from './source-band.component';

@Component({
  standalone: true,
  imports: [SourceBandComponent],
  template: `
    <ptah-source-band
      [heading]="heading()"
      [eyebrow]="eyebrow()"
      [description]="description()"
      [meta]="meta()"
      [layout]="layout()"
      [headingLevel]="headingLevel()"
    >
      @if (withSlots()) {
        <span band-mark data-testid="projected-mark">S</span>
      }
      @if (withSlots()) {
        <button band-actions type="button" data-testid="projected-action">
          Add key
        </button>
      }
    </ptah-source-band>
  `,
})
class HostComponent {
  public readonly heading = signal('Smithery');
  public readonly eyebrow = signal<string | null>('MCP servers');
  public readonly description = signal<string | null>(
    'Hosted MCP servers, installed through Smithery.',
  );
  public readonly meta = signal<readonly string[]>([]);
  public readonly layout = signal<SourceBandLayout>('compact');
  public readonly headingLevel = signal<SourceBandHeadingLevel>(1);
  public readonly withSlots = signal(true);
}

describe('SourceBandComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let element: HTMLElement;

  const q = (testId: string): HTMLElement | null =>
    element.querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders the heading as the page h1 by default', () => {
    const heading = q('source-band-heading');
    expect(heading?.tagName).toBe('H1');
    expect(heading?.textContent?.trim()).toBe('Smithery');
    expect(element.querySelectorAll('h1')).toHaveLength(1);
  });

  it('renders an h2 when the host already owns the h1', () => {
    host.headingLevel.set(2);
    fixture.detectChanges();
    expect(q('source-band-heading')?.tagName).toBe('H2');
    expect(element.querySelector('h1')).toBeNull();
  });

  it('renders the eyebrow and description, and drops blank ones', () => {
    expect(q('source-band-eyebrow')?.textContent?.trim()).toBe('MCP servers');
    expect(q('source-band-description')?.textContent?.trim()).toBe(
      'Hosted MCP servers, installed through Smithery.',
    );

    host.eyebrow.set('   ');
    host.description.set(null);
    fixture.detectChanges();
    expect(q('source-band-eyebrow')).toBeNull();
    expect(q('source-band-description')).toBeNull();
  });

  it('joins at most three non-blank meta items with a middle dot', () => {
    host.meta.set(['12 servers', ' ', 'namespace acme', 'v2', 'dropped']);
    fixture.detectChanges();
    expect(SOURCE_BAND_MAX_META).toBe(3);
    expect(q('source-band-meta')?.textContent?.trim()).toBe(
      '12 servers · namespace acme · v2',
    );

    host.meta.set([]);
    fixture.detectChanges();
    expect(q('source-band-meta')).toBeNull();
  });

  it('keeps the gold accent for the storefront layout only', () => {
    expect(q('source-band')?.getAttribute('data-layout')).toBe('compact');
    expect(q('source-band-eyebrow')?.className).toContain(
      'text-base-content-muted',
    );
    expect(q('source-band-eyebrow')?.className).not.toContain('text-secondary');
    expect(q('source-band')?.className).not.toContain('bg-gradient-to-br');

    host.layout.set('storefront');
    fixture.detectChanges();
    const band = q('source-band');
    expect(band?.getAttribute('data-layout')).toBe('storefront');
    expect(band?.className).toContain('from-base-200');
    expect(band?.className).toContain('via-base-100');
    expect(band?.className).toContain('to-primary/10');
    expect(q('source-band-eyebrow')?.className).toContain('text-secondary');
  });

  it('projects the mark and the actions into their slots', () => {
    expect(
      q('source-band-mark')?.querySelector('[data-testid="projected-mark"]'),
    ).not.toBeNull();
    expect(
      q('source-band-actions')?.querySelector(
        '[data-testid="projected-action"]',
      ),
    ).not.toBeNull();
  });

  it('leaves both slot wrappers empty (collapsible) when nothing is projected', () => {
    host.withSlots.set(false);
    fixture.detectChanges();
    expect(q('source-band-mark')?.children).toHaveLength(0);
    expect(q('source-band-mark')?.className).toContain('empty:hidden');
    expect(q('source-band-actions')?.children).toHaveLength(0);
    expect(q('source-band-actions')?.className).toContain('empty:hidden');
  });

  it('does not use innerHTML in the component source', () => {
    const source = readFileSync(
      join(__dirname, 'source-band.component.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/innerHTML/i);
  });
});
