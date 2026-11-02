import { TestBed } from '@angular/core/testing';
import type { SessionAgent } from '@ptah-extension/chat';
import { AgentDockMenuComponent } from './agent-dock-menu.component';
import { agentDurationText } from './dock-overflow';

function agent(key: string, status: SessionAgent['status']): SessionAgent {
  return { key, name: key, kind: 'cli', status, cliId: null, agentType: null,
    startedAt: status === 'running' || status === 'done' ? 0 : null,
    endedAt: status === 'done' ? 5_000 : null, activity: null, openRequestIds: [] };
}

describe('AgentDockMenuComponent', () => {
  const hidden = [agent('Runner', 'running'), agent('Waiting', 'waiting'),
    agent('Failed', 'failed'), agent('Queued', 'queued'), agent('Done', 'done'),
    agent('Stopped', 'stopped')];

  beforeEach(() => TestBed.configureTestingModule({ imports: [AgentDockMenuComponent] }));

  function create() {
    const fixture = TestBed.createComponent(AgentDockMenuComponent);
    fixture.componentRef.setInput('hidden', hidden);
    fixture.componentRef.setInput('selectedKey', 'Done');
    fixture.componentRef.setInput('now', 10_000);
    fixture.detectChanges();
    return fixture;
  }

  it('shows every hidden agent once with count, status, duration, and selection', async () => {
    const fixture = create();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    try {
      const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      expect(trigger.getAttribute('aria-label')).toBe('6 more agents');
      expect(trigger.textContent).toContain('+6');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      const rows = [...root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      expect(rows).toHaveLength(hidden.length);
      expect(rows.map((row) => row.getAttribute('aria-label')?.split(',')[0])).toEqual(
        ['Runner', 'Waiting', 'Failed', 'Queued', 'Done', 'Stopped'],
      );
      for (const agent of hidden) {
        const row = rows.find((item) => item.getAttribute('aria-label')?.startsWith(agent.name + ','))!;
        expect(row.getAttribute('aria-label')).toContain(agent.status);
        expect(row.getAttribute('aria-label')).toContain(agentDurationText(agent, 10_000) ?? 'no duration');
      }
      expect(rows[4].getAttribute('aria-checked')).toBe('true');
      expect(rows[4].querySelector('.bg-secondary')).not.toBeNull();
    } finally { root.remove(); fixture.destroy(); }
  });

  it('closes on pointer selection and returns focus to the trigger after render', async () => {
    const fixture = create();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    try {
      const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      const chosen = jest.fn();
      fixture.componentInstance.agentSelect.subscribe(chosen);
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      root.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')[4].click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(chosen).toHaveBeenCalledWith('Done');
      expect(root.querySelector('[role="menu"]')).toBeNull();
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
    } finally { root.remove(); fixture.destroy(); }
  });

  it('supports arrow/Home/End, keyboard selection and Escape without reopening', async () => {
    const fixture = create();
    const root: HTMLElement = fixture.nativeElement;
    document.body.appendChild(root);
    try {
      const trigger = root.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      const chosen = jest.fn();
      fixture.componentInstance.agentSelect.subscribe(chosen);
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      let menu = root.querySelector<HTMLElement>('[role="menu"]')!;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
      expect(document.activeElement?.getAttribute('aria-label')).toContain('Stopped');
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      expect(document.activeElement?.getAttribute('aria-label')).toContain('Runner');
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(document.activeElement?.getAttribute('aria-label')).toContain('Waiting');
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(chosen).toHaveBeenCalledWith('Waiting');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(trigger);
      trigger.click();
      fixture.detectChanges();
      await fixture.whenStable();
      menu = root.querySelector<HTMLElement>('[role="menu"]')!;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      expect(chosen).toHaveBeenCalledTimes(1);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(root.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally { root.remove(); fixture.destroy(); }
  });
});
