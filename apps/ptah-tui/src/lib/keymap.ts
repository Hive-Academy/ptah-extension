/**
 * The single source of truth for every key binding in the TUI.
 *
 * Before this module the bindings lived in three places that had drifted apart:
 * `AppShell`'s `useInput`, the welcome screen's "Quick Start" list, and the
 * status bar's footer hints. The footer advertised six chords, the welcome
 * screen advertised five, and neither mentioned Escape, slash commands or
 * @-mentions — the three things you actually need. Every surface now reads
 * this registry, and `findKeymapConflicts` is asserted by a spec so two
 * features can never claim the same chord.
 *
 * Ink-free on purpose so it is unit-testable.
 */

export type KeymapScope = 'global' | 'chat' | 'list';

export type KeymapGroup = 'app' | 'navigation' | 'session' | 'agent' | 'chat';

export interface KeyBinding {
  /** Stable identifier, used by tests and by the footer selector. */
  readonly id: string;
  /** Long form shown in the help overlay. */
  readonly keys: string;
  /** Compact form shown in the footer. */
  readonly hint: string;
  readonly description: string;
  /** Two-word-max label used beside the compact hint in the footer. */
  readonly footerLabel?: string;
  readonly scope: KeymapScope;
  readonly group: KeymapGroup;
  /**
   * Turn phase this binding is live in. Escape means "interrupt" mid-turn and
   * "close the topmost surface" otherwise; those are two bindings on one key
   * that can never both be live, which `when` is what lets the conflict check
   * express. Omitted means "always live".
   */
  readonly when?: 'streaming' | 'idle';
  /**
   * Lower sorts earlier when the footer picks its handful of hints. Bindings
   * without a priority never appear in the footer — they live in `?` only.
   */
  readonly footerPriority?: number;
}

export const GROUP_TITLES: Record<KeymapGroup, string> = {
  chat: 'Chat',
  navigation: 'Navigation',
  session: 'Session',
  agent: 'Agent',
  app: 'Application',
};

export const KEYMAP: readonly KeyBinding[] = [
  // -- chat -------------------------------------------------------------
  {
    id: 'chat.send',
    keys: 'Enter',
    hint: 'enter',
    description: 'Send the composed message',
    footerLabel: 'send',
    scope: 'chat',
    group: 'chat',
  },
  {
    id: 'chat.slash',
    keys: '/',
    hint: '/',
    description: 'Slash commands — type / in the composer',
    footerLabel: 'commands',
    scope: 'chat',
    group: 'chat',
    footerPriority: 10,
  },
  {
    id: 'chat.mention',
    keys: '@',
    hint: '@',
    description: 'Attach a file — type @ then a path fragment',
    footerLabel: 'files',
    scope: 'chat',
    group: 'chat',
    footerPriority: 20,
  },
  {
    id: 'chat.help',
    keys: '?',
    hint: '?',
    description: 'Show this help — type ? in an empty composer',
    footerLabel: 'help',
    scope: 'chat',
    group: 'chat',
    footerPriority: 30,
  },
  {
    id: 'chat.interrupt',
    keys: 'Esc',
    hint: 'esc',
    description: 'Interrupt the streaming turn',
    footerLabel: 'interrupt',
    scope: 'chat',
    group: 'chat',
    when: 'streaming',
  },

  // -- navigation -------------------------------------------------------
  {
    id: 'nav.palette',
    keys: 'Alt+K',
    hint: 'M-k',
    description: 'Open the command palette',
    footerLabel: 'palette',
    scope: 'global',
    group: 'navigation',
    footerPriority: 40,
  },
  {
    id: 'nav.cancel',
    keys: 'Esc',
    hint: 'esc',
    description: 'Close the topmost overlay, panel or view',
    footerLabel: 'back',
    scope: 'global',
    group: 'navigation',
    when: 'idle',
    footerPriority: 15,
  },
  {
    id: 'nav.move',
    keys: 'Up / Down',
    hint: 'up/dn',
    description: 'Move the selection in a list',
    footerLabel: 'move',
    scope: 'list',
    group: 'navigation',
  },
  {
    id: 'nav.choose',
    keys: 'Enter',
    hint: 'enter',
    description: 'Choose the highlighted item',
    footerLabel: 'select',
    scope: 'list',
    group: 'navigation',
  },

  // -- session ----------------------------------------------------------
  {
    id: 'session.new',
    keys: 'Alt+N',
    hint: 'M-n',
    description: 'Start a new session',
    footerLabel: 'new',
    scope: 'global',
    group: 'session',
    footerPriority: 60,
  },
  {
    id: 'session.list',
    keys: 'Alt+L',
    hint: 'M-l',
    description: 'Toggle the sessions panel',
    footerLabel: 'sessions',
    scope: 'global',
    group: 'session',
    footerPriority: 70,
  },

  // -- agent ------------------------------------------------------------
  {
    id: 'agent.monitor',
    keys: 'Alt+A',
    hint: 'M-a',
    description: 'Toggle the agent activity panel',
    footerLabel: 'agents',
    scope: 'global',
    group: 'agent',
    footerPriority: 90,
  },
  {
    id: 'agent.model',
    // Not Ctrl+M (carriage return — undeliverable, see
    // `findControlCodeAliases`) and not Ctrl+O (VDISCARD, and Gemini's
    // `app.showMoreLines`). Alt+M is the mnemonic that is actually free.
    keys: 'Alt+M',
    hint: 'M-m',
    description: 'Switch the active model',
    footerLabel: 'model',
    scope: 'global',
    group: 'agent',
  },
  {
    id: 'agent.effort',
    keys: 'Alt+E',
    hint: 'M-e',
    description: 'Cycle the reasoning effort',
    footerLabel: 'effort',
    scope: 'global',
    group: 'agent',
  },
  {
    id: 'agent.permission',
    keys: 'Shift+Tab',
    hint: 'S-tab',
    description: 'Cycle the permission level',
    footerLabel: 'perms',
    scope: 'global',
    group: 'agent',
  },

  // -- app --------------------------------------------------------------
  {
    id: 'app.settings',
    keys: 'Alt+S',
    hint: 'M-s',
    description: 'Open settings',
    footerLabel: 'settings',
    scope: 'global',
    group: 'app',
    footerPriority: 80,
  },
  {
    id: 'app.thoth',
    keys: 'Alt+T',
    hint: 'M-t',
    description: 'Open Thoth — memory, skills, schedules, gateway',
    footerLabel: 'thoth',
    scope: 'global',
    group: 'app',
  },
  {
    id: 'app.quit',
    keys: 'Ctrl+C twice',
    hint: '^C^C',
    description: 'Quit — press twice within two seconds to confirm',
    footerLabel: 'quit',
    scope: 'global',
    group: 'app',
    footerPriority: 100,
  },
] as const;

/** How long the quit confirmation stays armed after the first Ctrl+C. */
export const QUIT_CONFIRM_WINDOW_MS = 2000;

/**
 * The most hints the footer will ever render.
 *
 * Three, not four: the status line shares its row with the session label,
 * model, token count, context gauge, cost and mode, and four hints pushed the
 * combined width past 80 columns — at which point Ink truncates the *left*
 * side and you lose the session state to keep an advertisement for Ctrl+E.
 */
export const MAX_FOOTER_HINTS = 3;

function scopesOverlap(a: KeymapScope, b: KeymapScope): boolean {
  if (a === 'global' || b === 'global') return true;
  return a === b;
}

function phasesOverlap(a: KeyBinding['when'], b: KeyBinding['when']): boolean {
  if (a === undefined || b === undefined) return true;
  return a === b;
}

export interface KeymapConflict {
  readonly keys: string;
  readonly ids: readonly string[];
}

/**
 * Two bindings conflict when they claim the same chord in scopes that can be
 * live at the same moment. `global` overlaps everything; `chat` and `list` are
 * mutually exclusive because a list surface always blurs the composer.
 */
export function findKeymapConflicts(
  bindings: readonly KeyBinding[] = KEYMAP,
): KeymapConflict[] {
  const conflicts: KeymapConflict[] = [];

  for (let i = 0; i < bindings.length; i += 1) {
    for (let j = i + 1; j < bindings.length; j += 1) {
      const a = bindings[i];
      const b = bindings[j];
      if (a === undefined || b === undefined) continue;
      if (a.keys !== b.keys) continue;
      if (!scopesOverlap(a.scope, b.scope)) continue;
      if (!phasesOverlap(a.when, b.when)) continue;
      conflicts.push({ keys: a.keys, ids: [a.id, b.id] });
    }
  }

  return conflicts;
}

/**
 * Chords the terminal or the line editor already owns.
 *
 * The rule, taken from Gemini CLI's binding table: **`Ctrl+<letter>` belongs to
 * readline**, and app-level features live on `Alt+<key>`, `Shift+Tab` or
 * function keys. Gemini binds `ctrl+a`/`ctrl+e` to home/end, `ctrl+k`/`ctrl+u`
 * to the kill commands and `ctrl+p`/`ctrl+n` to history — then puts approval
 * cycling on `shift+tab` and markdown toggling on `alt+m`.
 *
 * We had drifted the other way. Four bindings sat directly on line-editing
 * defaults — `Ctrl+E` on end-of-line, `Ctrl+K` on kill-to-end, `Ctrl+P` and
 * `Ctrl+N` on history — so in a composer that is a text input, the documented
 * way to move around the text you were typing did something else entirely.
 *
 * Three groups, all unavailable:
 *
 *   - **Line editing.** What a user types into the composer expecting readline.
 *   - **Terminal control.** Signals and flow control the tty eats before the
 *     process sees them. `Ctrl+S`/`Ctrl+Q` are XON/XOFF; `Ctrl+O` is VDISCARD.
 *   - **Aliases.** Handled separately by {@link findControlCodeAliases},
 *     because those are not merely taken — they are undeliverable.
 *
 * `Ctrl+C` is the deliberate exception: it is claimed here as quit, exactly as
 * Gemini claims it for `basic.quit`, and Ink is rendered with
 * `exitOnCtrlC: false` so this module owns it.
 */
export const RESERVED_CHORDS: Readonly<Record<string, string>> = {
  'Ctrl+A': 'readline: beginning-of-line',
  'Ctrl+B': 'readline: backward-char',
  'Ctrl+D': 'terminal: EOF',
  'Ctrl+E': 'readline: end-of-line',
  'Ctrl+F': 'readline: forward-char',
  'Ctrl+K': 'readline: kill-to-end',
  'Ctrl+N': 'readline: next-history',
  'Ctrl+P': 'readline: previous-history',
  'Ctrl+R': 'readline: reverse-search-history',
  'Ctrl+T': 'readline: transpose-chars',
  'Ctrl+U': 'readline: kill-to-start',
  'Ctrl+W': 'readline: kill-word-backward',
  'Ctrl+Y': 'readline: yank',
  'Ctrl+O': 'terminal: VDISCARD (flush output)',
  'Ctrl+Q': 'terminal: XON (flow control)',
  'Ctrl+S': 'terminal: XOFF (flow control)',
  'Ctrl+Z': 'terminal: SIGTSTP',
};

export interface ReservedChordConflict {
  readonly keys: string;
  readonly id: string;
  /** What already owns the chord. */
  readonly ownedBy: string;
}

/**
 * Bindings claiming a chord readline or the tty already owns.
 *
 * Distinct from both other checks: `findKeymapConflicts` only sees collisions
 * *within* this registry, and `findControlCodeAliases` only sees chords that
 * cannot be delivered. A chord can be perfectly deliverable, unique in our
 * table, and still wrong because the line editor got there first.
 */
export function findReservedChordConflicts(
  bindings: readonly KeyBinding[] = KEYMAP,
): ReservedChordConflict[] {
  const conflicts: ReservedChordConflict[] = [];
  for (const binding of bindings) {
    // Ctrl+C is ours on purpose; see the note on RESERVED_CHORDS.
    if (binding.id === 'app.quit') continue;
    const ownedBy = RESERVED_CHORDS[binding.keys];
    if (ownedBy !== undefined) {
      conflicts.push({ keys: binding.keys, id: binding.id, ownedBy });
    }
  }
  return conflicts;
}

/**
 * Control chords a terminal cannot deliver as themselves.
 *
 * A `Ctrl+<letter>` chord is just the ASCII control code for that letter, and
 * five of them are already spoken for by keys that have their own name. Ctrl+M
 * and Enter are the *same byte*, so a terminal cannot tell you which one was
 * pressed and Ink reports the named key: `{name:'return', ctrl:false}`. Any
 * handler testing `key.ctrl && input === 'm'` is therefore dead code that the
 * help overlay still advertises.
 *
 * `findKeymapConflicts` cannot see this — it compares chord strings, and
 * "Ctrl+M" and "Enter" are different strings for one byte.
 */
const CONTROL_CODE_ALIASES: Readonly<Record<string, string>> = {
  'Ctrl+I': 'Tab',
  'Ctrl+J': 'Enter (line feed)',
  'Ctrl+M': 'Enter (carriage return)',
  'Ctrl+H': 'Backspace',
  'Ctrl+[': 'Esc',
};

export interface KeymapAlias {
  readonly keys: string;
  readonly id: string;
  /** The key the terminal actually reports instead. */
  readonly aliasOf: string;
}

/**
 * Bindings claiming a chord the terminal reports as some other key. A binding
 * here is unreachable by definition — it is advertised and cannot fire.
 */
export function findControlCodeAliases(
  bindings: readonly KeyBinding[] = KEYMAP,
): KeymapAlias[] {
  const aliases: KeymapAlias[] = [];
  for (const binding of bindings) {
    const aliasOf = CONTROL_CODE_ALIASES[binding.keys];
    if (aliasOf !== undefined) {
      aliases.push({ keys: binding.keys, id: binding.id, aliasOf });
    }
  }
  return aliases;
}

export function findDuplicateIds(
  bindings: readonly KeyBinding[] = KEYMAP,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const binding of bindings) {
    if (seen.has(binding.id)) duplicates.add(binding.id);
    seen.add(binding.id);
  }
  return [...duplicates];
}

export interface HelpGroup {
  readonly group: KeymapGroup;
  readonly title: string;
  readonly bindings: readonly KeyBinding[];
}

const GROUP_ORDER: readonly KeymapGroup[] = [
  'chat',
  'navigation',
  'session',
  'agent',
  'app',
];

export function getHelpGroups(
  bindings: readonly KeyBinding[] = KEYMAP,
): HelpGroup[] {
  return GROUP_ORDER.map((group) => ({
    group,
    title: GROUP_TITLES[group],
    bindings: bindings.filter((binding) => binding.group === group),
  })).filter((entry) => entry.bindings.length > 0);
}

export type FooterView = 'chat' | 'settings' | 'thoth';

export interface FooterContext {
  readonly view: FooterView;
  readonly isStreaming: boolean;
  readonly overlayOpen: boolean;
  readonly panelOpen: boolean;
}

/**
 * Pick the handful of hints worth showing right now.
 *
 * The old footer rendered six chords unconditionally, which is both wider than
 * an 80-column terminal can hold and wrong most of the time — it advertised
 * "^E sessions" while the sessions panel was already open, and never mentioned
 * Escape, which was the only key that could close it.
 */
export function getFooterHints(
  context: FooterContext,
  bindings: readonly KeyBinding[] = KEYMAP,
): KeyBinding[] {
  if (context.isStreaming) {
    const interrupt = bindings.find((b) => b.id === 'chat.interrupt');
    return interrupt ? [interrupt] : [];
  }

  if (context.overlayOpen || context.panelOpen) {
    const ids = ['nav.move', 'nav.choose', 'nav.cancel'];
    return ids
      .map((id) => bindings.find((b) => b.id === id))
      .filter((b): b is KeyBinding => b !== undefined);
  }

  const eligible = bindings.filter((binding) => {
    if (binding.footerPriority === undefined) return false;
    if (binding.scope === 'list') return false;
    if (binding.scope === 'chat' && context.view !== 'chat') return false;
    // Escape only earns footer space when there is something to escape from.
    if (binding.id === 'nav.cancel') return context.view !== 'chat';
    return true;
  });

  return eligible
    .slice()
    .sort((a, b) => (a.footerPriority ?? 0) - (b.footerPriority ?? 0))
    .slice(0, MAX_FOOTER_HINTS);
}

/**
 * The rendered width of a footer hint run, matching `StatusBar`'s layout:
 * `hint label` joined by a three-column separator. Lets a spec prove the
 * footer fits an 80-column terminal without rendering Ink.
 */
export function measureFooterWidth(hints: readonly KeyBinding[]): number {
  if (hints.length === 0) return 0;
  const cells = hints.map(
    (hint) => `${hint.hint} ${hint.footerLabel ?? ''}`.trimEnd().length,
  );
  const separators = (hints.length - 1) * 5;
  return cells.reduce((sum, width) => sum + width, 0) + separators;
}

/**
 * `?` opens the shortcut help, but only from an empty composer — otherwise a
 * literal question mark could never be typed into a message.
 */
export function shouldOpenHelp(nextValue: string): boolean {
  return nextValue === '?';
}
