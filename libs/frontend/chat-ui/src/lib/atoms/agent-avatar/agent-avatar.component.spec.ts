import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentAvatarComponent } from './agent-avatar.component';
import type {
  AgentAvatarSize,
  AgentKind,
  AgentStatusWord,
} from './agent-avatar.types';

describe('AgentAvatarComponent', () => {
  let fixture: ComponentFixture<AgentAvatarComponent>;
  let host: HTMLElement;

  function render(inputs: {
    kind?: AgentKind;
    status?: AgentStatusWord | null;
    size?: AgentAvatarSize;
    cliId?: string | null;
    agentType?: string | null;
  }): void {
    fixture.componentRef.setInput('kind', inputs.kind ?? 'orchestrator');
    if (inputs.status !== undefined) {
      fixture.componentRef.setInput('status', inputs.status);
    }
    if (inputs.size !== undefined) {
      fixture.componentRef.setInput('size', inputs.size);
    }
    if (inputs.cliId !== undefined) {
      fixture.componentRef.setInput('cliId', inputs.cliId);
    }
    if (inputs.agentType !== undefined) {
      fixture.componentRef.setInput('agentType', inputs.agentType);
    }
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return host.querySelector(`[data-testid="${testId}"]`);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentAvatarComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentAvatarComponent);
    host = fixture.nativeElement;
  });

  afterEach(() => fixture.destroy());

  it('is hidden from assistive tech and publishes the status word', () => {
    render({ status: 'running' });

    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('data-status')).toBe('running');
    expect(query('agent-avatar-tile')).not.toBeNull();
  });

  it('draws the pulse, a solid ring and no badge while running', () => {
    render({ status: 'running' });

    const pulse = query('agent-avatar-pulse');
    expect(pulse).not.toBeNull();
    expect(pulse?.classList).toContain('agent-avatar-pulse');
    // The pulse draws in the running state ink, so it reads as the state.
    expect(pulse?.classList).toContain('text-state-run');

    expect(query('agent-avatar-badge')).toBeNull();
    expect(query('agent-avatar-halo')).toBeNull();

    // The old rotating arc is gone: the ring is one solid circle.
    const ring = query('agent-avatar-ring');
    expect(ring).not.toBeNull();
    expect(ring?.classList).toContain('text-state-run');
    const circle = ring?.querySelector('circle');
    expect(circle?.getAttribute('stroke-dasharray')).toBeNull();
  });

  it('keeps the tile identity while running', () => {
    render({ kind: 'orchestrator', status: 'running' });

    expect(query('agent-avatar-glyph')).not.toBeNull();
    expect(query('agent-avatar-monogram')).toBeNull();
  });

  it('draws a solid ring with a pulsing halo and the hand badge while waiting', () => {
    render({ status: 'waiting' });

    expect(query('agent-avatar-pulse')).toBeNull();
    expect(query('agent-avatar-halo')).not.toBeNull();
    expect(query('agent-avatar-ring')?.classList).toContain('text-state-need');
    expect(query('agent-avatar-badge')).not.toBeNull();
  });

  it('draws a solid ring and the alert badge when failed', () => {
    render({ status: 'failed' });

    expect(query('agent-avatar-pulse')).toBeNull();
    expect(query('agent-avatar-halo')).toBeNull();
    expect(query('agent-avatar-ring')?.classList).toContain('text-state-err');
    expect(query('agent-avatar-badge')).not.toBeNull();
  });

  it.each([
    ['done', true],
    ['stopped', true],
    ['queued', false],
  ] as const)('draws no ring and no pulse for %s', (status, hasBadge) => {
    render({ status });

    expect(query('agent-avatar-ring')).toBeNull();
    expect(query('agent-avatar-pulse')).toBeNull();
    expect(query('agent-avatar-halo')).toBeNull();
    expect(Boolean(query('agent-avatar-badge'))).toBe(hasBadge);
  });

  it('draws the tile only when the status is unknown', () => {
    render({ status: null });

    expect(query('agent-avatar-tile')).not.toBeNull();
    expect(query('agent-avatar-ring')).toBeNull();
    expect(query('agent-avatar-pulse')).toBeNull();
    expect(query('agent-avatar-badge')).toBeNull();
  });

  it('draws the provider mark for a known CLI lane', () => {
    render({ kind: 'cli', cliId: 'claude' });

    expect(host.querySelector('ptah-provider-mark')).not.toBeNull();
    expect(query('agent-avatar-monogram')).toBeNull();
  });

  it('draws a monogram for a CLI lane without a provider mark', () => {
    render({ kind: 'cli', cliId: 'unknown-lane' });

    expect(query('agent-avatar-monogram')).not.toBeNull();
  });

  // jest-preset-angular strips component styles, so the declared CSS is read
  // from source (jsdom does no layout either way).
  it('no longer defines any rotate animation and reuses the shared pulse', () => {
    const source = readFileSync(
      join(__dirname, 'agent-avatar.component.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/rotate\(/);
    expect(source).not.toMatch(/@keyframes\s+agent-avatar-spin/);
    expect(source).toMatch(
      /\.agent-avatar-pulse::before\s*\{[^}]*animation:\s*ptah-pulse-core\s/s,
    );
    expect(source).toMatch(
      /\.agent-avatar-pulse::after\s*\{[^}]*animation:\s*ptah-pulse-ring\s/s,
    );
  });

  it('animates only opacity and transform', () => {
    const source = readFileSync(
      join(__dirname, 'agent-avatar.component.ts'),
      'utf8',
    );

    const keyframes = [...source.matchAll(/@keyframes\b/g)];
    expect(keyframes.length).toBeGreaterThan(0);
    for (const match of keyframes) {
      const open = source.indexOf('{', match.index);
      let depth = 0;
      let body = '';
      for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) {
          body = source.slice(open + 1, i);
          break;
        }
      }
      const properties = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect(properties.length).toBeGreaterThan(0);
      expect(
        properties.every((name) => ['opacity', 'transform'].includes(name)),
      ).toBe(true);
    }
  });

  it('stops motion under reduced preference and keeps a still dot', () => {
    const source = readFileSync(
      join(__dirname, 'agent-avatar.component.ts'),
      'utf8',
    );
    const reduce =
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.exec(source);
    expect(reduce).not.toBeNull();
    const rest = source.slice((reduce?.index ?? 0) + (reduce?.[0].length ?? 0));

    expect(rest).toMatch(/\.agent-avatar-halo\s*\{[^}]*animation:\s*none/);
    expect(rest).toMatch(/\.agent-avatar-pulse::after\s*\{[^}]*display:\s*none/);
    const stillDot = /\.agent-avatar-pulse::before\s*\{[^}]*opacity:\s*0\.8/;
    expect(rest).toMatch(stillDot);
  });
});