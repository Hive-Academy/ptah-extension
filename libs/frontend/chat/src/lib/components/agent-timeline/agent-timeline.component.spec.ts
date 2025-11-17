import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentTimelineComponent } from './agent-timeline.component';
import type { AgentTreeNode } from './agent-timeline.component';
import type {
  ClaudeAgentStartEvent,
  ClaudeAgentActivityEvent,
} from '@ptah-extension/shared';

describe('AgentTimelineComponent', () => {
  let component: AgentTimelineComponent;
  let fixture: ComponentFixture<AgentTimelineComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentTimelineComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentTimelineComponent);
    component = fixture.componentInstance;
  });

  // ========================================
  // Basic Rendering Tests
  // ========================================

  it('should create component', () => {
    expect(component).toBeTruthy();
  });

  it('should render with empty agents array', () => {
    fixture.componentRef.setInput('agents', []);
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector(
      '.timeline-container'
    );
    expect(container).toBeTruthy();

    const segments =
      fixture.nativeElement.querySelectorAll('.timeline-segment');
    expect(segments.length).toBe(0);
  });

  it('should render timeline scale markers', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 45000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const markers = fixture.nativeElement.querySelectorAll('.scale-marker');
    expect(markers.length).toBeGreaterThan(0);

    // Should have markers at 0s, 10s, 20s, 30s, 40s
    const markerTexts = Array.from(markers).map((m) =>
      (m as Element).textContent?.trim()
    );
    expect(markerTexts).toContain('0s');
    expect(markerTexts).toContain('10s');
    expect(markerTexts).toContain('20s');
  });

  // ========================================
  // Timeline Scale Tests
  // ========================================

  it('should use base scale (2px/s) for duration < 300s', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 60000,
      }, // 60s
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const scale = component.timelineScale();
    expect(scale).toBe(2); // Base scale
  });

  it('should auto-scale for duration > 300s', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 400000,
      }, // 400s
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const scale = component.timelineScale();
    expect(scale).toBeLessThan(2); // Scaled down
    expect(scale).toBeGreaterThanOrEqual(0.5); // Min scale 0.5px/s
  });

  // ========================================
  // Track Assignment Tests
  // ========================================

  it('should assign sequential agents to same track', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 10000,
      },
      {
        agentId: 'agent2',
        subagentType: 'backend-developer',
        timestamp: 15000,
        duration: 10000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgents = component.timelineAgents();
    expect(timelineAgents[0].track).toBe(0);
    expect(timelineAgents[1].track).toBe(0); // Same track (no overlap)
  });

  it('should assign parallel agents to separate tracks', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 20000,
      },
      {
        agentId: 'agent2',
        subagentType: 'backend-developer',
        timestamp: 5000,
        duration: 20000,
      }, // Overlaps
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgents = component.timelineAgents();
    expect(timelineAgents[0].track).toBe(0);
    expect(timelineAgents[1].track).toBe(1); // Different track (overlap detected)
  });

  it('should handle 3+ parallel agents across multiple tracks', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 30000,
      },
      {
        agentId: 'agent2',
        subagentType: 'backend-developer',
        timestamp: 5000,
        duration: 30000,
      },
      {
        agentId: 'agent3',
        subagentType: 'frontend-developer',
        timestamp: 10000,
        duration: 30000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgents = component.timelineAgents();
    expect(timelineAgents[0].track).toBe(0);
    expect(timelineAgents[1].track).toBe(1);
    expect(timelineAgents[2].track).toBe(2); // 3 separate tracks
  });

  it('should reuse tracks when agents complete', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 10000,
      },
      {
        agentId: 'agent2',
        subagentType: 'backend-developer',
        timestamp: 5000,
        duration: 10000,
      },
      {
        agentId: 'agent3',
        subagentType: 'frontend-developer',
        timestamp: 20000,
        duration: 10000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgents = component.timelineAgents();
    expect(timelineAgents[0].track).toBe(0);
    expect(timelineAgents[1].track).toBe(1); // Overlaps agent1
    expect(timelineAgents[2].track).toBe(0); // Reuses track 0 (agent1 complete)
  });

  // ========================================
  // Segment Positioning Tests
  // ========================================

  it('should calculate correct segment position', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 10000,
        duration: 20000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgent = component.timelineAgents()[0];
    const style = component.getSegmentStyle(timelineAgent);

    // Scale = 2px/s
    // startTime = 10s → left = 20px
    // duration = 20s → width = 40px
    expect(style.left).toBe('20px');
    expect(style.width).toBe('40px');
    expect(style.top).toBe('0px'); // Track 0
  });

  it('should position segments on correct tracks', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 10000,
      },
      {
        agentId: 'agent2',
        subagentType: 'backend-developer',
        timestamp: 5000,
        duration: 10000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgents = component.timelineAgents();
    const style1 = component.getSegmentStyle(timelineAgents[0]);
    const style2 = component.getSegmentStyle(timelineAgents[1]);

    expect(style1.top).toBe('0px'); // Track 0
    expect(style2.top).toBe('48px'); // Track 1 (40px height + 8px gap)
  });

  // ========================================
  // Duration Formatting Tests
  // ========================================

  it('should format durations < 60s correctly', () => {
    expect(component.formatDuration(5000)).toBe('5s');
    expect(component.formatDuration(45000)).toBe('45s');
    expect(component.formatDuration(59000)).toBe('59s');
  });

  it('should format durations >= 60s correctly', () => {
    expect(component.formatDuration(60000)).toBe('1m 0s');
    expect(component.formatDuration(90000)).toBe('1m 30s');
    expect(component.formatDuration(150000)).toBe('2m 30s');
    expect(component.formatDuration(3600000)).toBe('60m 0s');
  });

  // ========================================
  // Popover Tests
  // ========================================

  it('should not show popover initially', () => {
    fixture.componentRef.setInput('agents', []);
    fixture.detectChanges();

    expect(component.hoveredAgent()).toBeNull();

    const popover = fixture.nativeElement.querySelector('.timeline-popover');
    expect(popover).toBeNull();
  });

  it('should show popover after hover delay', async () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 10000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgent = component.timelineAgents()[0];
    const mockEvent = new MouseEvent('mouseenter');

    // Simulate hover
    component.showPopover(timelineAgent, mockEvent);

    // Wait for 300ms delay
    await new Promise((resolve) => setTimeout(resolve, 350));

    expect(component.hoveredAgent()).toBeTruthy();
  });

  it('should hide popover on mouse leave', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 10000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgent = component.timelineAgents()[0];
    component.hoveredAgent.set(timelineAgent);

    component.hidePopover();

    expect(component.hoveredAgent()).toBeNull();
  });

  // ========================================
  // ARIA Accessibility Tests
  // ========================================

  it('should have ARIA role on container', () => {
    fixture.componentRef.setInput('agents', []);
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector(
      '.timeline-container'
    );
    expect(container.getAttribute('role')).toBe('region');
    expect(container.getAttribute('aria-label')).toBe(
      'Agent execution timeline'
    );
  });

  it('should have ARIA labels on timeline segments', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 12000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const segment = fixture.nativeElement.querySelector('.timeline-segment');
    expect(segment.getAttribute('role')).toBe('listitem');
    expect(segment.getAttribute('aria-label')).toContain('Explore agent');
    expect(segment.getAttribute('aria-label')).toContain('12s duration');
  });

  it('should have ARIA label on popover', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 10000,
      },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const timelineAgent = component.timelineAgents()[0];
    component.hoveredAgent.set(timelineAgent);
    fixture.detectChanges();

    const popover = fixture.nativeElement.querySelector('.timeline-popover');
    expect(popover.getAttribute('role')).toBe('tooltip');
    expect(popover.getAttribute('aria-label')).toContain(
      'Details for Explore agent'
    );
  });

  // ========================================
  // Agent Color Tests
  // ========================================

  it('should return correct color for known agent types', () => {
    expect(component.getAgentColor('Explore')).toBe(
      'var(--vscode-symbolIcon-classForeground)'
    );
    expect(component.getAgentColor('backend-developer')).toBe(
      'var(--vscode-symbolIcon-functionForeground)'
    );
    expect(component.getAgentColor('frontend-developer')).toBe(
      'var(--vscode-symbolIcon-interfaceForeground)'
    );
  });

  it('should return default color for unknown agent types', () => {
    const defaultColor = 'var(--vscode-symbolIcon-classForeground)';
    expect(component.getAgentColor('unknown-agent')).toBe(defaultColor);
  });

  // ========================================
  // Edge Cases
  // ========================================

  it('should handle zero-duration agents', () => {
    const agents = createMockAgents([
      { agentId: 'agent1', subagentType: 'Explore', timestamp: 0, duration: 0 },
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const style = component.getSegmentStyle(component.timelineAgents()[0]);
    expect(style.width).toBe('0px');
  });

  it('should handle very long durations', () => {
    const agents = createMockAgents([
      {
        agentId: 'agent1',
        subagentType: 'Explore',
        timestamp: 0,
        duration: 600000,
      }, // 10 minutes
    ]);
    fixture.componentRef.setInput('agents', agents);
    fixture.detectChanges();

    const scale = component.timelineScale();
    expect(scale).toBeGreaterThan(0); // Should still calculate valid scale
  });

  // ========================================
  // Helper Functions
  // ========================================

  /**
   * Create mock AgentTreeNode array for testing
   */
  function createMockAgents(
    specs: Array<{
      agentId: string;
      subagentType: string;
      timestamp: number;
      duration: number;
      status?: 'running' | 'complete' | 'error';
      errorMessage?: string;
    }>
  ): AgentTreeNode[] {
    return specs.map((spec) => ({
      agent: {
        type: 'agent_start',
        agentId: spec.agentId,
        subagentType: spec.subagentType,
        description: `${spec.subagentType} agent`,
        prompt: 'Test prompt',
        timestamp: spec.timestamp,
      } as ClaudeAgentStartEvent,
      activities: [],
      status: spec.status ?? 'complete',
      duration: spec.duration,
      errorMessage: spec.errorMessage,
    }));
  }
});
