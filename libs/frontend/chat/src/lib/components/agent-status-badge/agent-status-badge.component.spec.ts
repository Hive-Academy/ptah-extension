import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DebugElement } from '@angular/core';
import { By } from '@angular/platform-browser';
import { AgentStatusBadgeComponent } from './agent-status-badge.component';
import type { AgentTreeNode } from '@ptah-extension/core';
import type { ClaudeAgentStartEvent } from '@ptah-extension/shared';

describe('AgentStatusBadgeComponent', () => {
  let component: AgentStatusBadgeComponent;
  let fixture: ComponentFixture<AgentStatusBadgeComponent>;
  let compiled: DebugElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentStatusBadgeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentStatusBadgeComponent);
    component = fixture.componentInstance;
    compiled = fixture.debugElement;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Badge States', () => {
    it('should show "No agents" when activeAgents is empty', () => {
      fixture.componentRef.setInput('activeAgents', []);
      fixture.detectChanges();

      const badgeText = compiled.query(By.css('.badge-text')).nativeElement;
      expect(badgeText.textContent.trim()).toBe('No agents');
      expect(component.badgeState()).toBe('no-agents');
    });

    it('should show "1 agent" when activeAgents has one agent', () => {
      const agent = createMockAgentNode('agent-1', 'Explore');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badgeText = compiled.query(By.css('.badge-text')).nativeElement;
      expect(badgeText.textContent.trim()).toBe('1 agent');
      expect(component.badgeState()).toBe('active');
    });

    it('should show "N agents" when activeAgents has multiple agents', () => {
      const agents = [
        createMockAgentNode('agent-1', 'Explore'),
        createMockAgentNode('agent-2', 'backend-developer'),
        createMockAgentNode('agent-3', 'frontend-developer'),
      ];
      fixture.componentRef.setInput('activeAgents', agents);
      fixture.detectChanges();

      const badgeText = compiled.query(By.css('.badge-text')).nativeElement;
      expect(badgeText.textContent.trim()).toBe('3 agents');
      expect(component.badgeState()).toBe('active');
    });

    it('should show error state when agents have errors', () => {
      const agent = createMockAgentNode('agent-1', 'Explore', 'error');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      expect(component.badgeState()).toBe('error');
      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.classList.contains('error')).toBe(true);
    });
  });

  describe('Pulsing Animation', () => {
    it('should apply pulsing animation when state is active', () => {
      const agent = createMockAgentNode('agent-1', 'Explore');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.classList.contains('active')).toBe(true);
    });

    it('should NOT apply pulsing animation when state is no-agents', () => {
      fixture.componentRef.setInput('activeAgents', []);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.classList.contains('active')).toBe(false);
    });

    it('should NOT apply pulsing animation when state is error', () => {
      const agent = createMockAgentNode('agent-1', 'Explore', 'error');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.classList.contains('active')).toBe(false);
      expect(badge.classList.contains('error')).toBe(true);
    });
  });

  describe('Error Indicator', () => {
    it('should show error indicator when agents have errors', () => {
      const agent = createMockAgentNode('agent-1', 'Explore', 'error');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const errorIndicator = compiled.query(By.css('.error-indicator'));
      expect(errorIndicator).toBeTruthy();
      expect(errorIndicator.nativeElement.textContent.trim()).toBe('!');
    });

    it('should NOT show error indicator when no errors', () => {
      const agent = createMockAgentNode('agent-1', 'Explore');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const errorIndicator = compiled.query(By.css('.error-indicator'));
      expect(errorIndicator).toBeFalsy();
    });
  });

  describe('Click Handler', () => {
    it('should emit togglePanel when clicked', () => {
      const togglePanelSpy = jest.fn();
      fixture.componentRef.instance.togglePanel.subscribe(togglePanelSpy);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      badge.click();

      expect(togglePanelSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Tooltip', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should show tooltip after 300ms hover', () => {
      const agent = createMockAgentNode('agent-1', 'Explore');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;

      // Initially no tooltip
      expect(component.showTooltip()).toBe(false);

      // Trigger mouseenter
      badge.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();

      // Still no tooltip (before 300ms)
      expect(component.showTooltip()).toBe(false);

      // Advance timers by 300ms
      jest.advanceTimersByTime(300);
      fixture.detectChanges();

      // Tooltip should now be visible
      expect(component.showTooltip()).toBe(true);
    });

    it('should hide tooltip on mouseleave', () => {
      const agent = createMockAgentNode('agent-1', 'Explore');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;

      // Trigger mouseenter
      badge.dispatchEvent(new MouseEvent('mouseenter'));
      jest.advanceTimersByTime(300);
      fixture.detectChanges();
      expect(component.showTooltip()).toBe(true);

      // Trigger mouseleave
      badge.dispatchEvent(new MouseEvent('mouseleave'));
      fixture.detectChanges();

      expect(component.showTooltip()).toBe(false);
    });

    it('should cancel tooltip if mouseleave before 300ms', () => {
      const agent = createMockAgentNode('agent-1', 'Explore');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;

      // Trigger mouseenter
      badge.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();

      // Leave before 300ms
      jest.advanceTimersByTime(100);
      badge.dispatchEvent(new MouseEvent('mouseleave'));
      fixture.detectChanges();

      // Advance past 300ms
      jest.advanceTimersByTime(250);
      fixture.detectChanges();

      // Tooltip should NOT appear
      expect(component.showTooltip()).toBe(false);
    });

    it('should display agent list in tooltip', () => {
      const agents = [
        createMockAgentNode('agent-1', 'Explore', 'running', 12000),
        createMockAgentNode('agent-2', 'backend-developer', 'running', 45000),
      ];
      fixture.componentRef.setInput('activeAgents', agents);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      badge.dispatchEvent(new MouseEvent('mouseenter'));
      jest.advanceTimersByTime(300);
      fixture.detectChanges();

      const tooltipItems = compiled.queryAll(By.css('.tooltip-item'));
      expect(tooltipItems.length).toBe(2);
      expect(tooltipItems[0].nativeElement.textContent).toContain('Explore');
      expect(tooltipItems[0].nativeElement.textContent).toContain('12s');
      expect(tooltipItems[1].nativeElement.textContent).toContain(
        'backend-developer'
      );
      expect(tooltipItems[1].nativeElement.textContent).toContain('45s');
    });
  });

  describe('ARIA Labels', () => {
    it('should have correct aria-label for no agents', () => {
      fixture.componentRef.setInput('activeAgents', []);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.getAttribute('aria-label')).toBe(
        'No active agents. Click to toggle agent panel.'
      );
    });

    it('should have correct aria-label for 1 agent', () => {
      const agent = createMockAgentNode('agent-1', 'Explore');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.getAttribute('aria-label')).toBe(
        '1 active agent. Click to toggle agent panel.'
      );
    });

    it('should have correct aria-label for multiple agents', () => {
      const agents = [
        createMockAgentNode('agent-1', 'Explore'),
        createMockAgentNode('agent-2', 'backend-developer'),
      ];
      fixture.componentRef.setInput('activeAgents', agents);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.getAttribute('aria-label')).toBe(
        '2 active agents. Click to toggle agent panel.'
      );
    });

    it('should include error in aria-label when agents have errors', () => {
      const agent = createMockAgentNode('agent-1', 'Explore', 'error');
      fixture.componentRef.setInput('activeAgents', [agent]);
      fixture.detectChanges();

      const badge = compiled.query(By.css('.agent-status-badge')).nativeElement;
      expect(badge.getAttribute('aria-label')).toContain('with errors');
    });
  });

  describe('Duration Formatting', () => {
    it('should format duration under 60s correctly', () => {
      const result = component.formatDuration(12000); // 12 seconds
      expect(result).toBe('12s');
    });

    it('should format duration over 60s correctly', () => {
      const result = component.formatDuration(125000); // 2 minutes 5 seconds
      expect(result).toBe('2m 5s');
    });

    it('should format duration exactly 60s correctly', () => {
      const result = component.formatDuration(60000); // 1 minute
      expect(result).toBe('1m 0s');
    });
  });
});

// Helper function to create mock AgentTreeNode
function createMockAgentNode(
  agentId: string,
  subagentType: string,
  status: 'running' | 'complete' | 'error' = 'running',
  duration?: number
): AgentTreeNode {
  const startEvent: ClaudeAgentStartEvent = {
    type: 'agent_start',
    agentId,
    subagentType,
    description: `Test ${subagentType}`,
    prompt: 'Test prompt',
    timestamp: Date.now() - (duration || 0),
  };

  return {
    agent: startEvent,
    activities: [],
    status,
    duration,
    errorMessage: status === 'error' ? 'Test error' : undefined,
  };
}
