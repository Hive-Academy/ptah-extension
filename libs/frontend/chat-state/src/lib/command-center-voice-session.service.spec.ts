import { CommandCenterVoiceSessionService } from './command-center-voice-session.service';

describe('CommandCenterVoiceSessionService', () => {
  it('tracks roots independently and clears only the requested root', () => {
    const sessions = new CommandCenterVoiceSessionService();
    sessions.activate('root-a');
    sessions.activate('root-b');
    sessions.deactivate('root-a');

    expect(sessions.isActive('root-a')).toBe(false);
    expect(sessions.isActive('root-b')).toBe(true);
    expect(new CommandCenterVoiceSessionService().isActive('root-b')).toBe(
      false,
    );
  });
});
