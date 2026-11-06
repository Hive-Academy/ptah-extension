import { isToolPermitted, toolClass } from './mcp-caller-policy';

describe('mcp caller policy', () => {
  it('classifies read tools, execute_code, browsers, and unknown names', () => {
    expect(toolClass('ptah_workspace_analyze')).toBe('read');
    expect(toolClass('ptah_task_check')).toBe('read');
    expect(toolClass('ptah_surface_get_state')).toBe('read');
    expect(toolClass('execute_code')).toBe('execute-code');
    expect(toolClass('approval_prompt')).toBe('approval');
    expect(toolClass('ptah_task_create')).toBe('task-git-mutation');
    expect(toolClass('ptah_web_search')).toBe('network');
    expect(toolClass('ptah_browser_status')).toBe('browser-control');
    expect(toolClass('ptah_browser_navigate')).toBe('browser-control');
    expect(toolClass('ptah_not_a_real_tool')).toBe('agent-control');
  });

  it('permits only the read class for read-only callers', () => {
    expect(isToolPermitted('ptah_task_get', 'read-only')).toBe(true);
    expect(isToolPermitted('execute_code', 'read-only')).toBe(false);
    expect(isToolPermitted('ptah_task_create', 'read-only')).toBe(false);
    expect(isToolPermitted('ptah_browser_status', 'read-only')).toBe(false);
    expect(isToolPermitted('ptah_not_a_real_tool', 'read-only')).toBe(false);
  });

  it('permits lane reports and read tools without privileged access', () => {
    expect(isToolPermitted('ptah_workspace_analyze', 'lane-report')).toBe(true);
    expect(isToolPermitted('ptah_agent_report', 'lane-report')).toBe(true);
    expect(isToolPermitted('ptah_agent_message_status', 'lane-report')).toBe(
      true,
    );
    for (const name of [
      'ptah_agent_spawn',
      'ptah_agent_message',
      'ptah_agent_stop',
      'ptah_task_create',
      'ptah_browser_status',
      'approval_prompt',
      'execute_code',
    ]) {
      expect(isToolPermitted(name, 'lane-report')).toBe(false);
    }
  });

  it('permits every class for a privileged caller', () => {
    expect(isToolPermitted('execute_code', 'privileged')).toBe(true);
    expect(isToolPermitted('ptah_task_create', 'privileged')).toBe(true);
    expect(isToolPermitted('ptah_not_a_real_tool', 'privileged')).toBe(true);
  });
});
