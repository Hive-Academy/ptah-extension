import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';

import { PROVIDER_BRAND_ART } from '../brand-mark/provider-brand-art.generated';
import type { MarkArtwork } from '../brand-mark/mark-artwork';
import { ProviderMarkComponent } from './provider-mark.component';
import {
  PROVIDER_MARKS,
  type ProviderMarkLucideIcon,
} from './provider-marks.data';

describe('ProviderMarkComponent', () => {
  function create(
    providerId: string,
    fallback: ProviderMarkLucideIcon = 'Bot',
  ) {
    const fixture = TestBed.createComponent(ProviderMarkComponent);
    fixture.componentRef.setInput('providerId', providerId);
    fixture.componentRef.setInput('fallback', fallback);
    fixture.detectChanges();
    return fixture;
  }

  function svg(fixture: ReturnType<typeof create>): SVGSVGElement {
    const node = fixture.nativeElement.querySelector(
      '[data-testid="provider-mark-svg"] svg',
    ) as SVGSVGElement | null;
    if (!node) {
      throw new Error('mark rendered no svg');
    }
    return node;
  }

  function pathDs(fixture: ReturnType<typeof create>): string[] {
    return Array.from(svg(fixture).querySelectorAll('path')).map(
      (path) => path.getAttribute('d') ?? '',
    );
  }

  function artDs(art: MarkArtwork | undefined): string[] {
    if (!art) {
      throw new Error('expected artwork is missing');
    }
    return art.paths.map((path) => path.d);
  }

  function tabledStroke(id: string): MarkArtwork {
    const mark = PROVIDER_MARKS[id];
    if (mark?.kind !== 'stroke') {
      throw new Error(`${id} is not a tabled stroke mark`);
    }
    return mark;
  }

  it('renders the tabled stroke mark for a known provider id', () => {
    const fixture = create('openrouter');
    expect(pathDs(fixture)).toEqual(artDs(tabledStroke('openrouter')));
    expect(svg(fixture).getAttribute('data-kind')).toBe('stroke');
    expect(svg(fixture).getAttribute('stroke')).toBe('currentColor');
  });

  it('renders the shared ollama mark for both ollama ids', () => {
    expect(pathDs(create('ollama'))).toEqual(pathDs(create('ollama-cloud')));
  });

  it('renders 32px box with a 24px mono mark, aria-hidden', () => {
    const fixture = create('openrouter');
    const box = fixture.nativeElement.querySelector(
      '[data-testid="provider-mark-box"]',
    ) as HTMLElement;
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(box.className).toContain('h-8 w-8');
    const host = fixture.nativeElement.querySelector(
      '[data-testid="provider-mark-svg"]',
    ) as HTMLElement;
    expect(host.tagName.toLowerCase()).toBe('ptah-mark-svg');
    expect(host.className).toContain('h-6 w-6');
    expect(svg(fixture).getAttribute('data-paint')).toBe('mono');
  });

  it('draws the vendored artwork for providers with a real mark (R1)', () => {
    const anthropic = create('anthropic', 'Terminal');
    expect(pathDs(anthropic)).toEqual(artDs(PROVIDER_BRAND_ART['anthropic']));
    expect(svg(anthropic).getAttribute('data-kind')).toBe('fill');
    expect(svg(anthropic).getAttribute('viewBox')).toBe(
      PROVIDER_BRAND_ART['anthropic'].viewBox,
    );

    const claudeCli = create('claude-cli', 'Bot');
    expect(pathDs(claudeCli)).toEqual(artDs(PROVIDER_BRAND_ART['claude']));
  });

  it('paints vendored artwork in currentColor so it follows the text colour', () => {
    const fixture = create('anthropic');
    const fills = Array.from(svg(fixture).querySelectorAll('path')).map(
      (path) => path.getAttribute('fill'),
    );
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.every((fill) => fill === 'currentColor')).toBe(true);
  });

  it('falls back to the requested lucide glyph for an unknown id', () => {
    const bot = pathDs(create('some-user-provider', 'Bot'));
    const server = pathDs(create('some-user-provider', 'Server'));
    const terminal = pathDs(create('some-user-provider', 'Terminal'));
    expect(bot).not.toEqual(server);
    expect(server).not.toEqual(terminal);
    expect(bot).not.toEqual(terminal);
  });

  it('lets a lucide record in the table win over the fallback input', () => {
    // `lm-studio` is pinned to Server in the table.
    const pinned = pathDs(create('lm-studio', 'Bot'));
    expect(pinned).toEqual(pathDs(create('some-user-provider', 'Server')));
    expect(pinned).not.toEqual(pathDs(create('some-user-provider', 'Bot')));
  });

  it('never resolves inherited object keys as provider ids', () => {
    expect(pathDs(create('constructor', 'Terminal'))).toEqual(
      pathDs(create('some-user-provider', 'Terminal')),
    );
  });

  it('renders through the shared renderer and reads only the provider art subset', () => {
    // Source-level pins: the sanitization boundary is `ptah-mark-svg`, and the
    // full vendored table must never be imported here (plan R7).
    const source = readFileSync(
      join(__dirname, 'provider-mark.component.ts'),
      'utf8',
    );
    expect(source).not.toContain('innerHTML');
    expect(source).toContain('<ptah-mark-svg');
    expect(source).toContain('paint="mono"');
    const imports = (source.match(/^import[\s\S]*?from '[^']+';$/gm) ?? []).join(
      '\n',
    );
    expect(imports).toContain('PROVIDER_BRAND_ART');
    expect(imports).not.toMatch(/\bBRAND_MARKS\b/);
    // Not even another export of the table's MODULE: esbuild would put the
    // whole module, `BRAND_MARKS` included, in a chunk the eager side loads.
    expect(imports).toContain(
      "from '../brand-mark/provider-brand-art.generated'",
    );
    expect(imports).not.toContain('brand-marks.generated');
  });
});
