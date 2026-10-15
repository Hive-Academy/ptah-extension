import { TestBed } from '@angular/core/testing';
import type { CommandWorkNode } from '../model/command-center.store';
import { CommandWorkListComponent } from './command-work-list.component';

const nodes: CommandWorkNode[] = Array.from({ length: 30 }, (_, index) => ({
  id: `node:${index}`,
  kind: index ? 'child' : 'root',
  parentId: index ? 'node:0' : null,
  label: `Work ${index}`,
  providerId: index === 29 ? 'unlisted-provider' : 'codex',
  state: index === 29 ? 'unknown' : 'queued',
}));

describe('CommandWorkListComponent', () => {
  function setup() {
    TestBed.configureTestingModule({ imports: [CommandWorkListComponent] });
    const fixture = TestBed.createComponent(CommandWorkListComponent);
    fixture.componentRef.setInput('projection', { nodes, edges: [] });
    fixture.detectChanges();
    return fixture;
  }

  it('lists all 30 owned nodes with provider, parent and state text', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelectorAll('li').length).toBe(30);
    expect(fixture.nativeElement.textContent).toContain('Work 29');
    expect(fixture.nativeElement.textContent).toContain(
      'Provider: unlisted-provider',
    );
    expect(fixture.nativeElement.textContent).toContain('Parent: Work 0');
    expect(fixture.nativeElement.textContent).toContain('State: unknown');
  });

  it('selects using arrow keys and Enter', () => {
    const fixture = setup();
    const selection = jest.fn();
    fixture.componentInstance.selection.subscribe(selection);
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[0].focus();
    buttons[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement).toBe(buttons[1]);
    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(selection).toHaveBeenCalledWith('node:1');
  });

  it('announces a changed state through the one polite live region', () => {
    const fixture = setup();
    fixture.componentRef.setInput('projection', {
      nodes: nodes.map((node) =>
        node.id === 'node:1' ? { ...node, state: 'running' as const } : node,
      ),
      edges: [],
    });
    fixture.detectChanges();
    const live = fixture.nativeElement.querySelectorAll(
      '[aria-live="polite"]',
    ) as NodeListOf<HTMLElement>;
    expect(live.length).toBe(1);
    expect(live[0].textContent).toContain('Work 1: running');
  });

  it('renders an unknown provider with a monogram tile', () => {
    const fixture = setup();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-monogram-tile').length,
    ).toBe(1);
  });

  it('keeps a row keyboard reachable after the projection shrinks', () => {
    const fixture = setup();
    fixture.componentInstance.activeIndex.set(29);
    fixture.componentRef.setInput('projection', {
      nodes: nodes.slice(0, 2),
      edges: [],
    });
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(2);
    expect(buttons[1].getAttribute('tabindex')).toBe('0');
    buttons[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    );
    fixture.detectChanges();
    expect(buttons[0].getAttribute('tabindex')).toBe('0');
  });
});
