import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RoutingMapNodeComponent, type RoutingNodeState, type RoutingNodeTone } from './routing-map-node.component';

@Component({
  standalone: true,
  imports: [RoutingMapNodeComponent],
  template: `
    <ptah-routing-map-node nodeId="main-agent" title="Main agent" [tone]="tone()" statusText="Active" [state]="state()"
      footer="Effort: medium · Next request target" actionLabel="Reassign" actionAriaLabel="Reassign the main agent"
      (activated)="activated = activated + 1" (retryRequested)="retried = retried + 1">
      <button node-badges type="button" data-testid="badge">Effort · Workspace</button>
      <p data-testid="preview">Provider: Claude</p>
    </ptah-routing-map-node>
  `,
})
class HostComponent {
  readonly tone = signal<RoutingNodeTone>('success');
  readonly state = signal<RoutingNodeState>('ready');
  activated = 0;
  retried = 0;
}

describe('RoutingMapNodeComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let element: HTMLElement;
  const query = (id: string) => element.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });
  afterEach(() => TestBed.resetTestingModule());

  it('renders the title, a dot always paired with visible status text, the preview and the footer', () => {
    const node = query('routing-node-main-agent');
    expect(node?.querySelector('h3')?.textContent?.trim()).toBe('Main agent');
    expect(node?.querySelector('.bg-success')?.getAttribute('aria-hidden')).toBe('true');
    expect(query('routing-node-status')?.textContent?.trim()).toBe('Active');
    expect(query('preview')?.textContent).toContain('Provider: Claude');
    expect(query('routing-node-footer')?.textContent?.trim()).toBe('Effort: medium · Next request target');
  });

  it.each([['info', 'bg-info'], ['warning', 'bg-warning'], ['neutral', 'bg-base-content-muted']] as const)(
    'tone %s colours the dot only', (tone, dotClass) => {
      fixture.componentInstance.tone.set(tone);
      fixture.detectChanges();
      expect(query('routing-node-main-agent')?.querySelector(`.${dotClass}`)).not.toBeNull();
      expect(query('routing-node-status')?.className).not.toMatch(/text-(success|info|warning|error)\b/);
    });

  it('the footer action is the node\'s one trigger, stretched over the node; it emits activated', () => {
    const action = query('routing-node-action') as HTMLButtonElement;
    expect(action.tagName).toBe('BUTTON');
    expect(action.getAttribute('aria-label')).toBe('Reassign the main agent');
    expect(action.className).toContain('after:absolute');
    expect(action.className).toContain('after:inset-0');
    expect(action.className).toContain('focus-visible:outline-2');
    action.click();
    expect(fixture.componentInstance.activated).toBe(1);
  });

  it('header badges are projected above the stretched action and keep their own clicks', () => {
    const badge = query('badge');
    expect(badge?.parentElement?.className).toContain('relative z-10');
    expect(badge?.closest('button[data-testid="routing-node-action"]')).toBeNull();
  });

  it('shows a busy skeleton instead of the preview while loading', () => {
    fixture.componentInstance.state.set('loading');
    fixture.detectChanges();
    expect(query('routing-node-main-agent')?.getAttribute('aria-busy')).toBe('true');
    expect(query('routing-node-skeleton')).not.toBeNull();
    expect(query('preview')).toBeNull();
  });

  it('a failed read shows fixed copy and Retry, and the node action stays available', () => {
    fixture.componentInstance.state.set('error');
    fixture.detectChanges();
    expect(query('routing-node-error')?.textContent).toContain('Could not load this section.');
    query('routing-node-retry')?.click();
    expect(fixture.componentInstance.retried).toBe(1);
    expect((query('routing-node-action') as HTMLButtonElement).disabled).toBe(false);
  });
});
