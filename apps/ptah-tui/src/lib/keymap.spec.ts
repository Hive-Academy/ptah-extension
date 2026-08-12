import {
  KEYMAP,
  MAX_FOOTER_HINTS,
  findControlCodeAliases,
  findDuplicateIds,
  findKeymapConflicts,
  getFooterHints,
  getHelpGroups,
  measureFooterWidth,
  shouldOpenHelp,
  type KeyBinding,
} from './keymap.js';

describe('keymap registry', () => {
  it('has no two bindings claiming the same chord in overlapping scopes', () => {
    expect(findKeymapConflicts()).toEqual([]);
  });

  it('has no duplicate binding ids', () => {
    expect(findDuplicateIds()).toEqual([]);
  });

  it('claims no chord the terminal reports as a different key', () => {
    // `agent.model` was Ctrl+M for as long as it existed. Ctrl+M is carriage
    // return, so Ink delivered `{name:'return'}` and the model selector could
    // never open — pressing the advertised chord sent the message instead.
    expect(findControlCodeAliases()).toEqual([]);
  });

  it('detects an aliased chord when one is introduced', () => {
    const aliased: KeyBinding[] = [
      {
        id: 'a',
        keys: 'Ctrl+M',
        hint: '^M',
        description: 'a',
        scope: 'global',
        group: 'app',
      },
    ];
    expect(findControlCodeAliases(aliased)).toEqual([
      { keys: 'Ctrl+M', id: 'a', aliasOf: 'Enter (carriage return)' },
    ]);
    // The chord-string check cannot see it — that is why this one exists.
    expect(findKeymapConflicts(aliased)).toEqual([]);
  });

  it('detects a conflict when one is introduced', () => {
    const clashing: KeyBinding[] = [
      {
        id: 'a',
        keys: 'Ctrl+K',
        hint: '^K',
        description: 'a',
        scope: 'global',
        group: 'app',
      },
      {
        id: 'b',
        keys: 'Ctrl+K',
        hint: '^K',
        description: 'b',
        scope: 'chat',
        group: 'chat',
      },
    ];
    expect(findKeymapConflicts(clashing)).toEqual([
      { keys: 'Ctrl+K', ids: ['a', 'b'] },
    ]);
  });

  it('does not flag Escape twice: interrupt and cancel are phase-disjoint', () => {
    const escapes = KEYMAP.filter((binding) => binding.keys === 'Esc');
    expect(escapes.map((b) => b.id).sort()).toEqual([
      'chat.interrupt',
      'nav.cancel',
    ]);
    expect(escapes.map((b) => b.when).sort()).toEqual(['idle', 'streaming']);
  });

  it('flags two bindings on the same key and same phase', () => {
    const clashing: KeyBinding[] = [
      {
        id: 'a',
        keys: 'Esc',
        hint: 'esc',
        description: 'a',
        scope: 'global',
        group: 'app',
        when: 'streaming',
      },
      {
        id: 'b',
        keys: 'Esc',
        hint: 'esc',
        description: 'b',
        scope: 'chat',
        group: 'chat',
        when: 'streaming',
      },
    ];
    expect(findKeymapConflicts(clashing)).toHaveLength(1);
  });
});

describe('help overlay contents', () => {
  it('lists every registered binding exactly once', () => {
    const listed = getHelpGroups().flatMap((group) =>
      group.bindings.map((binding) => binding.id),
    );
    expect(listed.slice().sort()).toEqual(
      KEYMAP.map((binding) => binding.id).sort(),
    );
  });

  it('names every group it renders', () => {
    for (const group of getHelpGroups()) {
      expect(group.title.length).toBeGreaterThan(0);
      expect(group.bindings.length).toBeGreaterThan(0);
    }
  });

  it('keeps every help row on one line in an 80-column terminal', () => {
    // HelpOverlay row = 2 indent + padded key column + 5 separator + text,
    // inside a round border with paddingX=2 → 74 columns of interior.
    const keyColumn = Math.max(...KEYMAP.map((binding) => binding.keys.length));
    const overflowing = KEYMAP.filter(
      (binding) => 2 + keyColumn + 5 + binding.description.length > 74,
    ).map((binding) => binding.id);
    expect(overflowing).toEqual([]);
  });

  it('documents the three input-driven affordances the footer advertises', () => {
    const ids = KEYMAP.map((binding) => binding.id);
    expect(ids).toContain('chat.slash');
    expect(ids).toContain('chat.mention');
    expect(ids).toContain('chat.help');
  });
});

describe('footer hints', () => {
  const idle = {
    view: 'chat' as const,
    isStreaming: false,
    overlayOpen: false,
    panelOpen: false,
  };

  it('never exceeds the cap', () => {
    for (const view of ['chat', 'settings', 'thoth'] as const) {
      const hints = getFooterHints({ ...idle, view });
      expect(hints.length).toBeLessThanOrEqual(MAX_FOOTER_HINTS);
    }
  });

  it('shows only the interrupt while a turn is streaming', () => {
    const hints = getFooterHints({ ...idle, isStreaming: true });
    expect(hints.map((h) => h.id)).toEqual(['chat.interrupt']);
  });

  it('shows list navigation while a panel or overlay owns the keyboard', () => {
    expect(
      getFooterHints({ ...idle, panelOpen: true }).map((h) => h.id),
    ).toEqual(['nav.move', 'nav.choose', 'nav.cancel']);
    expect(
      getFooterHints({ ...idle, overlayOpen: true }).map((h) => h.id),
    ).toEqual(['nav.move', 'nav.choose', 'nav.cancel']);
  });

  it('leads with the composer affordances on the chat view', () => {
    const hints = getFooterHints(idle).map((h) => h.id);
    expect(hints[0]).toBe('chat.slash');
    expect(hints).toContain('chat.mention');
    expect(hints).toContain('chat.help');
  });

  it('drops composer-only hints and offers Escape off the chat view', () => {
    const hints = getFooterHints({ ...idle, view: 'settings' }).map(
      (h) => h.id,
    );
    expect(hints).not.toContain('chat.slash');
    expect(hints).not.toContain('chat.mention');
    expect(hints).toContain('nav.cancel');
  });

  it('gives every footer-eligible binding a short label', () => {
    for (const binding of KEYMAP) {
      if (binding.footerPriority === undefined) continue;
      expect(binding.footerLabel).toBeDefined();
      expect((binding.footerLabel ?? '').length).toBeGreaterThan(0);
      expect((binding.footerLabel ?? '').length).toBeLessThanOrEqual(9);
    }
  });

  it('fits the footer inside half of an 80-column terminal in every state', () => {
    const states = [
      idle,
      { ...idle, isStreaming: true },
      { ...idle, panelOpen: true },
      { ...idle, overlayOpen: true },
      { ...idle, view: 'settings' as const },
      { ...idle, view: 'thoth' as const },
    ];
    for (const state of states) {
      expect(measureFooterWidth(getFooterHints(state))).toBeLessThanOrEqual(40);
    }
  });

  it('never advertises a hint whose binding it cannot name', () => {
    const known = new Set(KEYMAP.map((binding) => binding.id));
    for (const view of ['chat', 'settings', 'thoth'] as const) {
      for (const hint of getFooterHints({ ...idle, view })) {
        expect(known.has(hint.id)).toBe(true);
        expect(hint.hint.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('shouldOpenHelp', () => {
  it('opens on a bare question mark', () => {
    expect(shouldOpenHelp('?')).toBe(true);
  });

  it('leaves a question mark inside a real message alone', () => {
    expect(shouldOpenHelp('what is this?')).toBe(false);
    expect(shouldOpenHelp('?? ')).toBe(false);
    expect(shouldOpenHelp('')).toBe(false);
  });
});
