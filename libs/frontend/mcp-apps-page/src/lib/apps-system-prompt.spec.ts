import { APPS_SYSTEM_PROMPT } from './apps-system-prompt';

describe('APPS_SYSTEM_PROMPT', () => {
  it.each([
    'ptah_surface_update',
    'ptah_surface_get_state',
    'ptah_dashboard_propose_spec',
  ])('names the %s tool', (tool) => {
    expect(APPS_SYSTEM_PROMPT).toContain(tool);
  });

  it('tells the agent to read state instead of asking the user to paste it', () => {
    expect(APPS_SYSTEM_PROMPT).toContain('the selected row');
    expect(APPS_SYSTEM_PROMPT).toContain('the form');
    expect(APPS_SYSTEM_PROMPT).toContain('Never ask the user to paste');
  });

  it('describes forms, selection and host-formatted submits', () => {
    expect(APPS_SYSTEM_PROMPT).toContain('surface.submit');
    expect(APPS_SYSTEM_PROMPT).toContain('dashboard.select');
    expect(APPS_SYSTEM_PROMPT).toContain('formatted by the host');
  });

  it('does not carry the pushed dashboard-selection context', () => {
    expect(APPS_SYSTEM_PROMPT).not.toContain(
      'SYSTEM CONTEXT - DASHBOARD SELECTION',
    );
  });
});
