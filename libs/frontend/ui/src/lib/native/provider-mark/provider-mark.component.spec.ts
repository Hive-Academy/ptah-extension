import { TestBed } from '@angular/core/testing';
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
      '[data-testid="provider-mark-svg"]',
    ) as SVGSVGElement;
    expect(node).not.toBeNull();
    return node;
  }

  function firstPathD(fixture: ReturnType<typeof create>): string {
    const path = svg(fixture).querySelector('path');
    if (!path) {
      throw new Error('mark rendered no path segment');
    }
    return path.getAttribute('d') ?? '';
  }

  it('renders the tabled path mark for a known provider id', () => {
    const fixture = create('openrouter');
    const paths = svg(fixture).querySelectorAll('path');
    expect(paths.length).toBe(
      (PROVIDER_MARKS['openrouter'] as { d: readonly string[] }).d.length,
    );
    expect(paths[0].getAttribute('d')).toBe(
      PROVIDER_MARKS['openrouter'].kind === 'path'
        ? PROVIDER_MARKS['openrouter'].d[0]
        : '',
    );
  });

  it('renders the shared ollama mark for both ollama ids', () => {
    const a = firstPathD(create('ollama'));
    const b = firstPathD(create('ollama-cloud'));
    expect(a).toBe(b);
  });

  it('renders 32px box with a 24px mark and currentColor, aria-hidden', () => {
    const fixture = create('openrouter');
    const box = fixture.nativeElement.querySelector(
      '[data-testid="provider-mark-box"]',
    ) as HTMLElement;
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(box.className).toContain('h-8 w-8');
    expect(svg(fixture).getAttribute('stroke')).toBe('currentColor');
  });

  it('falls back to the requested lucide glyph for an unknown id', () => {
    const bot = firstPathD(create('some-user-provider', 'Bot'));
    const server = firstPathD(create('some-user-provider', 'Server'));
    const terminal = firstPathD(create('some-user-provider', 'Terminal'));
    expect(bot).not.toBe(server);
    expect(server).not.toBe(terminal);
  });

  it('lets a lucide record in the table win over the fallback input', () => {
    // `claude-cli` is pinned to Terminal in the table; an unknown id with
    // fallback Bot must render something else.
    const pinned = firstPathD(create('claude-cli', 'Bot'));
    const botFallback = firstPathD(create('some-user-provider', 'Bot'));
    expect(pinned).not.toBe(botFallback);
  });

  it('never binds innerHTML — the svg is built from [attr.d] paths', () => {
    // Source-level pin: keep the sanitization boundary in the template.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const source = fs.readFileSync(
      path.join(__dirname, 'provider-mark.component.ts'),
      'utf8',
    );
    expect(source).not.toContain('innerHTML');
    expect(source).toContain('[attr.d]');
  });
});
