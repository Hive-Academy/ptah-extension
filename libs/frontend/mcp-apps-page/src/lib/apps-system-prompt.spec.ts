import { SURFACE_COMPONENT_KINDS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
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

  it('names the ptah-surface-authoring skill on one line', () => {
    const lines = APPS_SYSTEM_PROMPT.split('\n');
    expect(
      lines.filter((line) => line.includes('ptah-surface-authoring')),
    ).toHaveLength(1);
    expect(APPS_SYSTEM_PROMPT).toContain('ptah-surface-authoring skill');
  });

  it('lists every SURFACE_COMPONENT_KINDS member as an exact token on that line', () => {
    const marker = 'component kind: ';
    const line = APPS_SYSTEM_PROMPT.split('\n').find((l) =>
      l.includes('ptah-surface-authoring'),
    );
    expect(line).toBeDefined();
    const listed = (line ?? '')
      .slice((line ?? '').indexOf(marker) + marker.length)
      .replace(/\.$/, '');
    const tokens = listed
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    expect(tokens).toHaveLength(SURFACE_COMPONENT_KINDS.length);
    expect(new Set(tokens)).toEqual(new Set([...SURFACE_COMPONENT_KINDS]));
  });

  it('counts badges among the items the user can pick', () => {
    expect(APPS_SYSTEM_PROMPT).toContain(
      'chart points, stats, badges) must declare the dashboard.select action',
    );
  });

  it('does not carry the pushed dashboard-selection context', () => {
    expect(APPS_SYSTEM_PROMPT).not.toContain(
      'SYSTEM CONTEXT - DASHBOARD SELECTION',
    );
  });
});
