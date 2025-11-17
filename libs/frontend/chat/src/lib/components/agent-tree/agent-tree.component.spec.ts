import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentTreeComponent } from './agent-tree.component';
import type { AgentTreeNode } from '@ptah-extension/core';
import type {
  ClaudeAgentStartEvent,
  ClaudeAgentActivityEvent,
} from '@ptah-extension/shared';

describe('AgentTreeComponent', () => {
  let component: AgentTreeComponent;
  let fixture: ComponentFixture<AgentTreeComponent>;

  // Test data factories
  const createAgentStartEvent = (
    agentId: string,
    subagentType: string,
    description: string
  ): ClaudeAgentStartEvent => ({
    type: 'agent_start',
    agentId,
    subagentType,
    description,
    prompt: `Test prompt for ${subagentType}`,
    model: 'claude-sonnet-4',
    timestamp: Date.now(),
  });

  const createAgentActivity = (
    agentId: string,
    toolName: string,
    toolInput: Record<string, unknown>
  ): ClaudeAgentActivityEvent => ({
    type: 'agent_activity',
    agentId,
    toolName,
    toolInput,
    timestamp: Date.now(),
  });

  const createAgentTreeNode = (
    agentId: string,
    subagentType: string,
    status: 'running' | 'complete' | 'error',
    activities: readonly ClaudeAgentActivityEvent[] = []
  ): AgentTreeNode => ({
    agent: createAgentStartEvent(agentId, subagentType, `${subagentType} agent`),
    activities,
    status,
    duration: status === 'complete' ? 12000 : undefined,
    errorMessage: status === 'error' ? 'Test error message' : undefined,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentTreeComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentTreeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Rendering', () => {
    it('should render empty state when no agents', () => {
      fixture.componentRef.setInput('agents', []);
      fixture.detectChanges();

      const treeElement = fixture.nativeElement.querySelector('.agent-tree');
      expect(treeElement).toBeTruthy();
      expect(treeElement.children.length).toBe(0);
    });

    it('should render agent nodes', () => {
      const agents = [
        createAgentTreeNode('agent-1', 'Explore', 'running'),
        createAgentTreeNode('agent-2', 'backend-developer', 'complete'),
      ];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNodes = fixture.nativeElement.querySelectorAll('.agent-node');
      expect(agentNodes.length).toBe(2);
    });

    it('should render agent type labels', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentType = fixture.nativeElement.querySelector('.agent-type');
      expect(agentType.textContent.trim()).toBe('Explore');
    });

    it('should render status badges correctly', () => {
      const runningAgent = createAgentTreeNode('agent-1', 'Explore', 'running');
      const completeAgent = createAgentTreeNode('agent-2', 'backend-developer', 'complete');
      const errorAgent = createAgentTreeNode('agent-3', 'ui-ux-designer', 'error');

      fixture.componentRef.setInput('agents', [runningAgent, completeAgent, errorAgent]);
      fixture.detectChanges();

      const statusBadges = fixture.nativeElement.querySelectorAll('.status-badge');
      expect(statusBadges[0].classList.contains('running')).toBe(true);
      expect(statusBadges[1].classList.contains('complete')).toBe(true);
      expect(statusBadges[2].classList.contains('error')).toBe(true);
    });

    it('should render duration when available', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'complete')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const duration = fixture.nativeElement.querySelector('.agent-duration');
      expect(duration.textContent.trim()).toBe('12s');
    });

    it('should apply error class to error nodes', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'error')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      expect(agentNode.classList.contains('error')).toBe(true);
    });
  });

  describe('Expand/Collapse Functionality', () => {
    it('should start with all nodes collapsed', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      expect(component.isExpanded('agent-1')).toBe(false);
    });

    it('should toggle expansion on click', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      expect(component.isExpanded('agent-1')).toBe(true);

      agentNode.click();
      fixture.detectChanges();

      expect(component.isExpanded('agent-1')).toBe(false);
    });

    it('should apply expanded class when node is expanded', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      expect(agentNode.classList.contains('expanded')).toBe(true);
    });

    it('should show expanded content when node is expanded', () => {
      const activities = [createAgentActivity('agent-1', 'Bash', { command: 'npm run build' })];
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running', activities)];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      let expandedContent = fixture.nativeElement.querySelector('.agent-node-content');
      expect(expandedContent).toBeFalsy();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      expandedContent = fixture.nativeElement.querySelector('.agent-node-content');
      expect(expandedContent).toBeTruthy();
    });

    it('should render tool activities when expanded', () => {
      const activities = [
        createAgentActivity('agent-1', 'Bash', { command: 'npm run build' }),
        createAgentActivity('agent-1', 'Read', { file: 'package.json' }),
      ];
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running', activities)];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      const activityLines = fixture.nativeElement.querySelectorAll('.tool-activity-line');
      expect(activityLines.length).toBe(2);
    });

    it('should render error message when present', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'error')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      const errorMessage = fixture.nativeElement.querySelector('.error-message');
      expect(errorMessage).toBeTruthy();
      expect(errorMessage.textContent).toContain('Test error message');
    });
  });

  describe('Keyboard Navigation', () => {
    it('should toggle expansion on Enter key', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      agentNode.dispatchEvent(event);
      fixture.detectChanges();

      expect(component.isExpanded('agent-1')).toBe(true);
    });

    it('should toggle expansion on Space key', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      const event = new KeyboardEvent('keydown', { key: ' ' });
      agentNode.dispatchEvent(event);
      fixture.detectChanges();

      expect(component.isExpanded('agent-1')).toBe(true);
    });

    it('should expand on ArrowRight when collapsed', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      component.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }), 'agent-1');
      fixture.detectChanges();

      expect(component.isExpanded('agent-1')).toBe(true);
    });

    it('should collapse on ArrowLeft when expanded', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      component.toggleExpanded('agent-1');
      fixture.detectChanges();

      component.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowLeft' }), 'agent-1');
      fixture.detectChanges();

      expect(component.isExpanded('agent-1')).toBe(false);
    });
  });

  describe('ARIA Attributes', () => {
    it('should have role="tree" on container', () => {
      const treeElement = fixture.nativeElement.querySelector('.agent-tree');
      expect(treeElement.getAttribute('role')).toBe('tree');
    });

    it('should have aria-label on tree container', () => {
      const treeElement = fixture.nativeElement.querySelector('.agent-tree');
      expect(treeElement.getAttribute('aria-label')).toBe('Agent execution tree');
    });

    it('should have role="treeitem" on agent nodes', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      expect(agentNode.getAttribute('role')).toBe('treeitem');
    });

    it('should have aria-expanded attribute on agent nodes', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      expect(agentNode.getAttribute('aria-expanded')).toBe('false');

      agentNode.click();
      fixture.detectChanges();

      expect(agentNode.getAttribute('aria-expanded')).toBe('true');
    });

    it('should have aria-level attribute on nodes', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      expect(agentNode.getAttribute('aria-level')).toBe('1');
    });

    it('should have tabindex on agent nodes', () => {
      const agents = [createAgentTreeNode('agent-1', 'Explore', 'running')];

      fixture.componentRef.setInput('agents', agents);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      expect(agentNode.getAttribute('tabindex')).toBe('0');
    });
  });

  describe('Helper Methods', () => {
    it('should format duration < 60 seconds correctly', () => {
      expect(component.formatDuration(12000)).toBe('12s');
      expect(component.formatDuration(45000)).toBe('45s');
    });

    it('should format duration >= 60 seconds correctly', () => {
      expect(component.formatDuration(90000)).toBe('1m 30s');
      expect(component.formatDuration(150000)).toBe('2m 30s');
    });

    it('should format activity with short input', () => {
      const activity = { toolName: 'Bash', toolInput: 'ls -la' };
      expect(component.formatActivity(activity)).toBe('Bash: "ls -la"');
    });

    it('should truncate long activity input', () => {
      const longInput = 'a'.repeat(100);
      const activity = { toolName: 'Read', toolInput: longInput };
      const formatted = component.formatActivity(activity);

      expect(formatted.length).toBeLessThan(100);
      expect(formatted).toContain('...');
    });

    it('should stringify JSON for tooltips', () => {
      const input = { command: 'npm run build', cwd: '/project' };
      expect(component.stringify(input)).toBe(JSON.stringify(input));
    });
  });

  describe('Future Fields Rendering', () => {
    it('should render cost when present', () => {
      const agentWithCost: AgentTreeNode = {
        ...createAgentTreeNode('agent-1', 'Explore', 'complete'),
        cost: 0.0042,
      };

      fixture.componentRef.setInput('agents', [agentWithCost]);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      const costElement = fixture.nativeElement.querySelector('.agent-cost');
      expect(costElement).toBeTruthy();
      expect(costElement.textContent).toContain('$0.0042');
    });

    it('should render tokens when present', () => {
      const agentWithTokens: AgentTreeNode = {
        ...createAgentTreeNode('agent-1', 'Explore', 'complete'),
        tokens: { input: 1000, output: 500 },
      };

      fixture.componentRef.setInput('agents', [agentWithTokens]);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      const tokensElement = fixture.nativeElement.querySelector('.agent-tokens');
      expect(tokensElement).toBeTruthy();
      expect(tokensElement.textContent).toContain('1000 in');
      expect(tokensElement.textContent).toContain('500 out');
    });

    it('should render MCP tools when present', () => {
      const agentWithMcpTools: AgentTreeNode = {
        ...createAgentTreeNode('agent-1', 'Explore', 'complete'),
        mcpTools: ['filesystem', 'database', 'browser'],
      };

      fixture.componentRef.setInput('agents', [agentWithMcpTools]);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      const mcpToolsElement = fixture.nativeElement.querySelector('.agent-mcp-tools');
      expect(mcpToolsElement).toBeTruthy();
      expect(mcpToolsElement.textContent).toContain('filesystem, database, browser');
    });

    it('should render custom agent badge when isCustomAgent is true', () => {
      const customAgent: AgentTreeNode = {
        ...createAgentTreeNode('agent-1', 'Explore', 'complete'),
        isCustomAgent: true,
      };

      fixture.componentRef.setInput('agents', [customAgent]);
      fixture.detectChanges();

      const agentNode = fixture.nativeElement.querySelector('.agent-node');
      agentNode.click();
      fixture.detectChanges();

      const customBadge = fixture.nativeElement.querySelector('.agent-custom-badge');
      expect(customBadge).toBeTruthy();
      expect(customBadge.textContent).toContain('Custom Agent');
    });
  });
});
