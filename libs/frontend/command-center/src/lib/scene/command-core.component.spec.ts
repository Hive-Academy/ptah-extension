import { TestBed } from '@angular/core/testing';
import type { CommandVoiceState, CommandWorkNode } from '../model/command-center.store';
import { CommandCoreComponent } from './command-core.component';

const root: CommandWorkNode = {
  id: 'root:one', kind: 'root', parentId: null, label: 'Ptah',
  providerId: null, state: 'running',
};

describe('CommandCoreComponent', () => {
  const create = () => {
    TestBed.configureTestingModule({ imports: [CommandCoreComponent] });
    const fixture = TestBed.createComponent(CommandCoreComponent);
    fixture.componentRef.setInput('root', root);
    fixture.detectChanges();
    return fixture;
  };

  it('renders 96 ticks with every eighth tick major and a native root trigger', () => {
    const fixture = create();
    const dial = fixture.nativeElement.querySelector('[data-core-dial]') as HTMLElement;
    const ticks = dial.querySelectorAll('.ticks line');
    expect(ticks).toHaveLength(96);
    expect(dial.querySelectorAll('.ticks line.major')).toHaveLength(12);
    expect(dial.querySelector('[data-core-root-id="root:one"]')).toBeInstanceOf(HTMLButtonElement);
    expect(dial.textContent).toContain('active delegated work');
  });

  it.each<CommandVoiceState>([
    'idle', 'listening', 'thinking', 'speaking', 'muted', 'stopped', 'error',
  ])('shows the %s voice state on the dial and caption', (state) => {
    const fixture = create();
    fixture.componentRef.setInput('voiceState', state);
    fixture.detectChanges();
    const dial = fixture.nativeElement.querySelector('[data-core-dial]') as HTMLElement;
    expect(dial.dataset['voice']).toBe(state);
    expect(dial.querySelector('.voice-caption')?.textContent).toContain(state);
    expect(dial.querySelector('.voice-ring')).not.toBeNull();
  });

  it('clamps input and output expansion and freezes scale for reduced motion or hidden document', () => {
    const fixture = create();
    fixture.componentRef.setInput('voiceState', 'listening');
    fixture.componentRef.setInput('inputLevel', 2);
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceScale()).toBe(1.025);
    fixture.componentRef.setInput('inputLevel', -2);
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceScale()).toBe(1);
    fixture.componentRef.setInput('voiceState', 'speaking');
    fixture.componentRef.setInput('outputLevel', 0.5);
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceScale()).toBe(1.0125);
    fixture.componentRef.setInput('reducedMotion', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceScale()).toBe(1);
    expect((fixture.nativeElement.querySelector('[data-core-dial]') as HTMLElement).classList).toContain('is-paused');
    fixture.componentRef.setInput('reducedMotion', false);
    fixture.componentRef.setInput('visibilityPaused', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.voiceScale()).toBe(1);
    expect((fixture.nativeElement.querySelector('[data-core-dial]') as HTMLElement).classList).toContain('is-paused');
  });

  it('emits root hover, focus, activation and Escape while keeping focus on the button', () => {
    const fixture = create();
    const hovers: (string | null)[] = [];
    const activated: string[] = [];
    const escaped: string[] = [];
    fixture.componentInstance.hoverRoot.subscribe((id) => hovers.push(id));
    fixture.componentInstance.activateRoot.subscribe((id) => activated.push(id));
    fixture.componentInstance.escapeRoot.subscribe((id) => escaped.push(id));
    const button = fixture.nativeElement.querySelector('[data-core-root-id]') as HTMLButtonElement;
    button.dispatchEvent(new Event('pointerenter'));
    button.dispatchEvent(new Event('pointerleave'));
    button.focus();
    button.click();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(hovers).toEqual(['root:one', null, 'root:one']);
    expect(activated).toEqual(['root:one']);
    expect(escaped).toEqual(['root:one']);
    expect(document.activeElement).toBe(button);
    button.blur();
    expect(hovers.at(-1)).toBeNull();
  });

  it('adds preview and pinned plate relationships only for the matching root', () => {
    const fixture = create();
    const button = fixture.nativeElement.querySelector('[data-core-root-id]') as HTMLButtonElement;
    fixture.componentRef.setInput('activeId', root.id);
    fixture.detectChanges();
    expect(button.getAttribute('aria-describedby')).toBe('command-plate');
    expect(button.hasAttribute('aria-expanded')).toBe(false);
    fixture.componentRef.setInput('pinnedId', root.id);
    fixture.detectChanges();
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows an idle zero visual without a focus stop when the root is absent', () => {
    const fixture = create();
    fixture.componentRef.setInput('root', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('0');
  });
});
