/**
 * BackgroundAgentTrayComponent — scope handling for an unresolved session
 * (TASK_2026_295).
 *
 * The tray's filter was `if (scope && rec.parentSessionId !== scope) continue;`.
 * A tile whose session had not resolved passed `''`, which is falsy, so the
 * filter switched itself off and the tile listed EVERY session's agents.
 *
 * Wave 2 folded the second axis into `agentVisibleInSession` as well: a view
 * scoped to a session that has not resolved shows NOTHING. The tray used to be
 * the odd one out here — it showed unattributed agents in an unresolved tile
 * while `agent-monitor-panel` and `chat-view` showed none — purely because
 * `agentVisibleInSession(undefined, '')` happened to be true. No agent becomes
 * unreachable: every RESOLVED view still shows unattributed agents (see the
 * third case below), and the unscoped tray shows everything.
 */

import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  AgentMonitorStore,
  BackgroundAgentStore,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { SubagentTranscriptViewerService } from '../../services/subagent-transcript-viewer.service';
import { BackgroundAgentTrayComponent } from './background-agent-tray.component';

const TILE_SESSION = 'session-tile';
const OTHER_SESSION = 'session-other';

function record(
  parentToolUseId: string,
  parentSessionId: string | undefined,
): SubagentRecord {
  return {
    parentToolUseId,
    status: 'running',
    teammateName: parentToolUseId,
    parentSessionId,
  } as SubagentRecord;
}

describe('BackgroundAgentTrayComponent — unresolved session scope', () => {
  function createTray(sessionId: string | null, records: SubagentRecord[]) {
    TestBed.configureTestingModule({
      imports: [BackgroundAgentTrayComponent],
      providers: [
        {
          provide: AgentMonitorStore,
          useValue: {
            subagents: signal(
              new Map(records.map((r) => [r.parentToolUseId, r])),
            ),
            sendMessageToAgent: jest.fn(),
            stopAgent: jest.fn(),
            backgroundAgent: jest.fn(),
          },
        },
        {
          provide: BackgroundAgentStore,
          useValue: { agents: signal([]) },
        },
        {
          provide: TabManagerService,
          useValue: { findTabBySessionId: jest.fn(), switchTab: jest.fn() },
        },
        {
          provide: SubagentTranscriptViewerService,
          useValue: { openFor: jest.fn() },
        },
      ],
    });
    const fixture = TestBed.createComponent(BackgroundAgentTrayComponent);
    fixture.componentRef.setInput('sessionId', sessionId);
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders nothing in a tile whose session is unresolved — least of all another session`s agents', () => {
    const fixture = createTray('', [
      record('mine', undefined),
      record('theirs', OTHER_SESSION),
    ]);

    const ids = fixture.componentInstance.entries().map((e) => e.id);
    // The original defect: `theirs` leaking into an unresolved tile.
    expect(ids).not.toContain('theirs');
    // And the reconciled rule: an unresolved scope claims nothing at all.
    expect(ids).toEqual([]);
  });

  it('lists every session`s agents on the main (unscoped) tray', () => {
    const fixture = createTray(null, [
      record('mine', TILE_SESSION),
      record('theirs', OTHER_SESSION),
    ]);

    expect(
      fixture.componentInstance
        .entries()
        .map((e) => e.id)
        .sort(),
    ).toEqual(['mine', 'theirs']);
  });

  it('shows an unattributed agent inside a resolved tile', () => {
    const fixture = createTray(TILE_SESSION, [
      record('unattributed', undefined),
      record('mine', TILE_SESSION),
      record('theirs', OTHER_SESSION),
    ]);

    expect(
      fixture.componentInstance
        .entries()
        .map((e) => e.id)
        .sort(),
    ).toEqual(['mine', 'unattributed']);
  });
});
