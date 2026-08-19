/**
 * The scoping rule itself (TASK_2026_295).
 *
 * `session-scope.ts` is the single definition three sibling views share
 * (`background-agent-tray`, `agent-monitor-panel`, `chat-view`). They disagreed
 * once — an agent with an unattributed owner was visible in the tray of an
 * unresolved tile, invisible in that same tile's monitor panel, and invisible in
 * its resume banner — because each had hand-rolled its own pre-check around a
 * helper that modelled only ONE of the two axes.
 *
 * Both axes are pinned here so a future divergence fails at the definition
 * rather than in whichever surface someone happens to open.
 */

import { agentVisibleInSession, knownSessionId } from './session-scope';

const VIEWER = 'session-viewer';
const OTHER = 'session-other';

describe('agentVisibleInSession — the agent-owner axis', () => {
  it('shows an agent whose owner is this session', () => {
    expect(agentVisibleInSession(VIEWER, VIEWER)).toBe(true);
  });

  it('hides an agent owned by a different session', () => {
    expect(agentVisibleInSession(OTHER, VIEWER)).toBe(false);
  });

  it('shows an agent with NO known owner in a resolved view', () => {
    // The load-bearing case: an unattributed agent that renders nowhere is an
    // agent the user can neither steer nor stop. It belongs to no session in
    // particular, so it is reachable from every resolved one.
    expect(agentVisibleInSession(undefined, VIEWER)).toBe(true);
  });
});

describe('agentVisibleInSession — the viewer axis', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
  ])('a view scoped to an unresolved session (%s) shows nothing', (_l, sid) => {
    // It cannot claim a specific session's agents, and it does not need to
    // catch the unattributed ones — every resolved view already shows those, so
    // nothing becomes unreachable by hiding them here.
    expect(agentVisibleInSession(VIEWER, sid)).toBe(false);
    expect(agentVisibleInSession(OTHER, sid)).toBe(false);
    expect(agentVisibleInSession(undefined, sid)).toBe(false);
  });
});

describe('knownSessionId', () => {
  it('keeps a real id', () => {
    expect(knownSessionId(VIEWER)).toBe(VIEWER);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
  ])(
    'collapses %s to undefined so `??` gives the intended fallback',
    (_l, v) => {
      expect(knownSessionId(v)).toBeUndefined();
    },
  );
});
