import {
  applyEscape,
  resolveEscapeTarget,
  type ShellSurfaces,
} from './escape-target.js';

const base: ShellSurfaces = {
  view: 'chat',
  sidebarVisible: false,
  agentPanelVisible: false,
};

describe('resolveEscapeTarget', () => {
  it('does nothing on a bare chat view', () => {
    expect(resolveEscapeTarget(base)).toBe('none');
  });

  it('closes the sessions panel first', () => {
    expect(
      resolveEscapeTarget({
        view: 'settings',
        sidebarVisible: true,
        agentPanelVisible: true,
      }),
    ).toBe('sessions');
  });

  it('closes the agents panel next', () => {
    expect(
      resolveEscapeTarget({
        view: 'settings',
        sidebarVisible: false,
        agentPanelVisible: true,
      }),
    ).toBe('agents');
  });

  it('returns to chat last', () => {
    expect(resolveEscapeTarget({ ...base, view: 'thoth' })).toBe('view');
  });
});

describe('applyEscape', () => {
  it('closes exactly one surface per press', () => {
    let state: ShellSurfaces = {
      view: 'settings',
      sidebarVisible: true,
      agentPanelVisible: true,
    };

    state = applyEscape(state);
    expect(state).toEqual({
      view: 'settings',
      sidebarVisible: false,
      agentPanelVisible: true,
    });

    state = applyEscape(state);
    expect(state).toEqual({
      view: 'settings',
      sidebarVisible: false,
      agentPanelVisible: false,
    });

    state = applyEscape(state);
    expect(state).toEqual({
      view: 'chat',
      sidebarVisible: false,
      agentPanelVisible: false,
    });
  });

  it('reaches the bare chat view from any state and then stays put', () => {
    const states: ShellSurfaces[] = [];
    for (const view of ['chat', 'settings', 'thoth'] as const) {
      for (const sidebarVisible of [true, false]) {
        for (const agentPanelVisible of [true, false]) {
          states.push({ view, sidebarVisible, agentPanelVisible });
        }
      }
    }

    for (const start of states) {
      let state = start;
      // Three surfaces means at most three presses; the fourth must be a no-op.
      for (let i = 0; i < 4; i += 1) state = applyEscape(state);
      expect(state).toEqual(base);
      expect(applyEscape(state)).toBe(state);
    }
  });

  it('never changes more than one field in a single press', () => {
    const start: ShellSurfaces = {
      view: 'thoth',
      sidebarVisible: true,
      agentPanelVisible: true,
    };
    const next = applyEscape(start);
    const changed = (Object.keys(start) as (keyof ShellSurfaces)[]).filter(
      (key) => start[key] !== next[key],
    );
    expect(changed).toHaveLength(1);
  });
});
