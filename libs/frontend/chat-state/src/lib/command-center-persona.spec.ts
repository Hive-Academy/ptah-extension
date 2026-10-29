import {
  COMMAND_CENTER_PERSONA,
  commandCenterPersonaFor,
} from './command-center-persona';

describe('commandCenterPersonaFor', () => {
  it('applies only to a valid marker', () => {
    expect(
      commandCenterPersonaFor({
        commandCenterOrigin: {
          workspaceId: '/ws',
          createdAt: 1,
          version: 1,
        },
      }),
    ).toBe(COMMAND_CENTER_PERSONA);
    expect(commandCenterPersonaFor({})).toBeUndefined();
    expect(
      commandCenterPersonaFor({
        commandCenterOrigin: {
          workspaceId: '',
          createdAt: 1,
          version: 1,
        },
      }),
    ).toBeUndefined();
  });

  it('keeps generic Command Center instructions', () => {
    expect(COMMAND_CENTER_PERSONA).toContain('Start each reply with 1-2 plain spoken sentences that give the answer; put details after.');
    expect(COMMAND_CENTER_PERSONA).toContain('COMMAND_CENTER_STATUS_CONTEXT');
    expect(COMMAND_CENTER_PERSONA.length).toBeLessThanOrEqual(16 * 1024);
  });
});
