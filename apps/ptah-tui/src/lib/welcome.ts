/**
 * The first-run screen, as data.
 *
 * What was here before: a five-line `ink-big-text` FIGlet banner, a gradient,
 * an Egyptian hieroglyph outside the BMP, and a list of five Ctrl-chords —
 * three of which (^B agents, ^E sessions) open panels a first-time user has no
 * reason to want, while the two things that actually move you forward (setting
 * up a provider, typing a message) were a dim italic afterthought at the
 * bottom. The banner alone is a third of an 80x24 terminal.
 *
 * This module builds the replacement as plain data — one logo line, the
 * workspace, honest provider status, exactly three next actions — so a spec
 * can assert both the content and that it fits in 80 columns.
 *
 * Ink-free on purpose so it is unit-testable.
 */

import type { GlyphSet } from './glyphs.js';

export interface WelcomeInput {
  readonly workspacePath: string;
  readonly authReady: boolean;
  readonly authError?: string | null;
  readonly model?: string | null;
  readonly columns: number;
}

export interface WelcomeAction {
  readonly keys: string;
  readonly label: string;
}

export interface WelcomeModel {
  readonly logo: string;
  readonly tagline: string;
  readonly workspace: string;
  readonly provider: { readonly label: string; readonly ready: boolean };
  readonly actions: readonly WelcomeAction[];
}

/** Exactly this many next-actions, always. More is a menu, not a nudge. */
export const WELCOME_ACTION_COUNT = 3;

const TAGLINE = 'The Coding Orchestra';

/**
 * Keep the tail of a path, not the head — the last two segments identify the
 * project, the drive letter does not.
 */
export function truncatePath(value: string, max: number): string {
  if (max <= 1) return '';
  if (value.length <= max) return value;
  const tail = value.slice(value.length - (max - 1));
  return `…${tail}`;
}

export function buildWelcome(
  input: WelcomeInput,
  glyphs: GlyphSet,
): WelcomeModel {
  const budget = Math.max(20, input.columns - 4);

  const provider = input.authReady
    ? {
        label:
          input.model !== undefined &&
          input.model !== null &&
          input.model.length > 0
            ? `ready — ${input.model}`
            : 'ready',
        ready: true,
      }
    : {
        label:
          input.authError !== undefined &&
          input.authError !== null &&
          input.authError.length > 0
            ? `not configured — ${input.authError}`
            : 'not configured',
        ready: false,
      };

  const actions: WelcomeAction[] = input.authReady
    ? [
        { keys: '/', label: 'run a command — /help lists them all' },
        { keys: '@', label: 'attach a file by path' },
        { keys: '?', label: 'show every keyboard shortcut' },
      ]
    : [
        { keys: 'Ctrl+S', label: 'connect a provider to get started' },
        { keys: '/', label: 'run a command — /help lists them all' },
        { keys: '?', label: 'show every keyboard shortcut' },
      ];

  return {
    logo: `${glyphs.logo} Ptah`,
    tagline: TAGLINE,
    workspace: truncatePath(
      input.workspacePath,
      Math.max(20, budget - 'workspace  '.length),
    ),
    provider: {
      label: truncatePath(
        provider.label,
        Math.max(20, budget - 'provider  '.length),
      ),
      ready: provider.ready,
    },
    actions,
  };
}

/**
 * The rendered width of the widest line, so a spec can prove the screen fits an
 * 80-column terminal without rendering Ink.
 */
export function measureWelcomeWidth(model: WelcomeModel): number {
  const keyColumn = Math.max(...model.actions.map((a) => a.keys.length));
  const lines = [
    `${model.logo}  ${model.tagline}`,
    `workspace  ${model.workspace}`,
    `provider   ${model.provider.label}`,
    ...model.actions.map((a) => `${a.keys.padEnd(keyColumn)}  ${a.label}`),
  ];
  return Math.max(...lines.map((line) => line.length));
}
