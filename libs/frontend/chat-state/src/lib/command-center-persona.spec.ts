import { COMMAND_CENTER_PERSONA, commandCenterPersonaFor } from './command-center-persona';

describe('commandCenterPersonaFor', () => {
  it('applies only to a valid marker', () => {
    expect(commandCenterPersonaFor({ commandCenterOrigin: {
      workspaceId: '/ws', createdAt: 1, version: 1,
    } })).toBe(COMMAND_CENTER_PERSONA);
    expect(commandCenterPersonaFor({})).toBeUndefined();
    expect(commandCenterPersonaFor({ commandCenterOrigin: {
      workspaceId: '', createdAt: 1, version: 1,
    } })).toBeUndefined();
  });

  it('keeps discovery non-launching and Decline first', () => {
    expect(COMMAND_CENTER_PERSONA).toMatch(/Decline first and Confirm second/);
    expect(COMMAND_CENTER_PERSONA).toMatch(/Never spawn or launch Tribunal lanes during discovery/);
    expect(COMMAND_CENTER_PERSONA).toContain('COMMAND_CENTER_STATUS_CONTEXT');
    expect(COMMAND_CENTER_PERSONA.length).toBeLessThanOrEqual(16 * 1024);
  });
});
