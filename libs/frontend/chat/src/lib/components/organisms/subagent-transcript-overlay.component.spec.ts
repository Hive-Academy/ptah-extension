/**
 * SubagentTranscriptOverlayComponent — the file-link context it publishes.
 *
 * L-7. The overlay renders subagent markdown and opts into file links, but it
 * carried no tab marker, so a relative path written by a subagent working in a
 * background workspace resolved against the ACTIVE workspace root and could
 * open a same-named file from a different repository (AC 22). The overlay does
 * know the transcript's parent session, so the owning tab is resolvable.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SubagentTranscriptViewerService } from '../../services/subagent-transcript-viewer.service';
import { SubagentTranscriptOverlayComponent } from './subagent-transcript-overlay.component';

describe('SubagentTranscriptOverlayComponent file-link context', () => {
  const sessionId = signal<string | null>(null);
  let findTabBySessionIdAcrossWorkspaces: jest.Mock;

  beforeEach(() => {
    sessionId.set(null);
    findTabBySessionIdAcrossWorkspaces = jest.fn(() => null);

    TestBed.configureTestingModule({
      imports: [SubagentTranscriptOverlayComponent],
      providers: [
        {
          provide: SubagentTranscriptViewerService,
          useValue: {
            open: signal(false),
            loading: signal(false),
            error: signal<string | null>(null),
            messages: signal([]),
            agentName: signal('Subagent'),
            sessionId,
            close: jest.fn(),
            refresh: jest.fn(),
          },
        },
        {
          provide: TabManagerService,
          useValue: { findTabBySessionIdAcrossWorkspaces },
        },
      ],
    });
  });

  function render() {
    const fixture = TestBed.createComponent(SubagentTranscriptOverlayComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('publishes the owning tab of the open transcript', () => {
    findTabBySessionIdAcrossWorkspaces.mockReturnValue({
      tab: { id: 'tab-bg' },
      workspacePath: 'D:/background-ws',
    });
    sessionId.set('session-1');

    const host = render();

    expect(findTabBySessionIdAcrossWorkspaces).toHaveBeenCalledWith(
      'session-1',
    );
    expect(host.hasAttribute('data-ptah-file-links')).toBe(true);
    expect(host.getAttribute('data-ptah-tab-id')).toBe('tab-bg');
  });

  it('publishes no tab while nothing is open', () => {
    const host = render();

    expect(findTabBySessionIdAcrossWorkspaces).not.toHaveBeenCalled();
    expect(host.hasAttribute('data-ptah-tab-id')).toBe(false);
  });

  it('publishes no tab when the session has no tab in any workspace', () => {
    sessionId.set('session-orphan');

    const host = render();

    expect(host.hasAttribute('data-ptah-tab-id')).toBe(false);
  });
});
