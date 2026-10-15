import { TestBed } from '@angular/core/testing';
import { SessionId } from '@ptah-extension/shared';
import { WorkflowSessionIndexService } from './workflow-session-index.service';

const STORAGE_KEY = 'ptah.workflow-sessions.v1';

describe('WorkflowSessionIndexService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  function create(): WorkflowSessionIndexService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [WorkflowSessionIndexService],
    });
    return TestBed.inject(WorkflowSessionIndexService);
  }

  it('stores only workspace, session and kind and partitions duplicate session IDs', () => {
    const index = create();
    const sessionId = SessionId.create();
    const tab = {
      claudeSessionId: sessionId,
      workflow: 'harness-configure' as const,
      title: 'secret prompt',
    };
    index.rememberTab(tab, '/one');
    expect(index.get(sessionId, '/one')).toBe('harness-configure');
    expect(index.get(sessionId, '/two')).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain('secret prompt');

    index.rememberTab({ ...tab, workflow: 'harness-new-project' }, '/two');
    expect(index.get(sessionId, '/two')).toBe('harness-new-project');
    index.forget(sessionId, '/one');
    expect(index.get(sessionId, '/one')).toBeNull();
    expect(index.get(sessionId, '/two')).toBe('harness-new-project');
  });

  it('ignores invalid stored entries and caps restored records', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          { workspacePath: '/ws', sessionId: 'bad', kind: '<script>' },
          {
            workspacePath: '/ws',
            sessionId: 'good',
            kind: 'setup-wizard-phase',
          },
          ...Array.from({ length: 510 }, (_, i) => ({
            workspacePath: '/ws',
            sessionId: `session-${i}`,
            kind: 'setup-agent-generation',
          })),
        ],
      }),
    );
    const index = create();
    expect(index.get('bad', '/ws')).toBeNull();
    expect(index.get('good', '/ws')).toBeNull();
    expect(index.get('session-509', '/ws')).toBe('setup-agent-generation');
    expect(index.get('session-0', '/ws')).toBeNull();
  });

  it('keeps the in-memory kind and exposes a safe warning when storage fails', () => {
    const index = create();
    const write = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('secret backend detail');
      });
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    const sessionId = SessionId.create();
    index.rememberTab(
      { claudeSessionId: sessionId, workflow: 'setup-project-prompt' },
      '/ws',
    );
    expect(index.get(sessionId, '/ws')).toBe('setup-project-prompt');
    expect(index.warning()).toContain('could not be saved');
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'secret backend detail',
    );
    write.mockRestore();
    warning.mockRestore();
  });
});
