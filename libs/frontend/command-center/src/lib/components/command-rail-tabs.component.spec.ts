import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  CommandRailTabsComponent,
  type CommandRailTab,
} from './command-rail-tabs.component';

describe('CommandRailTabsComponent', () => {
  let fixture: ComponentFixture<CommandRailTabsComponent>;
  let emitted: CommandRailTab[];

  const tabs = (): HTMLButtonElement[] => [
    ...fixture.nativeElement.querySelectorAll('[role="tab"]'),
  ];
  const key = (target: HTMLElement, name: string): void => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true }),
    );
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [CommandRailTabsComponent] });
    fixture = TestBed.createComponent(CommandRailTabsComponent);
    emitted = [];
    fixture.componentInstance.activeChange.subscribe((tab) => {
      emitted.push(tab);
      fixture.componentRef.setInput('active', tab);
      fixture.detectChanges();
    });
    fixture.detectChanges();
  });

  it('renders a named tablist with Live selected and a roving tabindex', () => {
    const list = fixture.nativeElement.querySelector('[role="tablist"]');
    expect(list.getAttribute('aria-label')).toBeTruthy();
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'Live',
      'Work',
      'Stats',
      'Display',
    ]);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    // Only panels in the DOM are referenced: Live stays mounted, the rest render while active.
    expect(tabs().map((tab) => tab.getAttribute('aria-controls'))).toEqual([
      'command-rail-panel-live',
      null,
      null,
      null,
    ]);
    fixture.componentRef.setInput('active', 'work');
    fixture.detectChanges();
    expect(tabs().map((tab) => tab.getAttribute('aria-controls'))).toEqual([
      'command-rail-panel-live',
      'command-rail-panel-work',
      null,
      null,
    ]);
  });

  it('moves and activates with the arrow keys, Home and End', () => {
    key(tabs()[0], 'ArrowRight');
    expect(emitted).toEqual(['work']);
    expect(document.activeElement).toBe(tabs()[1]);
    key(tabs()[1], 'End');
    key(tabs()[3], 'ArrowRight');
    key(tabs()[0], 'ArrowLeft');
    key(tabs()[3], 'Home');
    expect(emitted).toEqual(['work', 'display', 'live', 'display', 'live']);
  });

  it('activates on click and ignores other keys', () => {
    tabs()[2].click();
    key(tabs()[2], 'a');
    expect(emitted).toEqual(['stats']);
  });

  it('badges the Display tab only when it has items', () => {
    expect(fixture.nativeElement.querySelector('.tab-badge')).toBeNull();
    fixture.componentRef.setInput('displayCount', 3);
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.tab-badge');
    expect(badge.textContent.trim()).toBe('3');
    expect(badge.getAttribute('aria-label')).toBe('3 items');
  });
});
