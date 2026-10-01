import type { ExecutionStatus } from '@ptah-extension/shared';
import { stripMarkdownToPlainText } from './compact-plain-text';
import { shortenRowText } from './compact-wire-text';
import {
  displayToolName,
  toolStatusBadgeClass,
} from '../../utils/tool-target.utils';
import type {
  CompactSemanticMark,
  CompactSemanticMarkKind,
  CompactSummaryStatusTone,
} from './compact-session-summary';

/**
 * Pure view-model for the compact activity feed: one row per semantic mark,
 * with its badge classes, glyphs and bounded text. No Angular here.
 */

export interface CompactFeedRow {
  readonly mark: CompactSemanticMark;
  /** Plain-text label. */
  readonly label: string;
  /**
   * Primary one-line row text: the mark detail when present, else the label.
   * For a tool row it is the call's target, never its output.
   */
  readonly text: string;
  /** Row title/tooltip: the label plus the full detail line. */
  readonly title: string;
  /**
   * Full plain-text detail for the inline expanded block; null when absent.
   * For a tool row: the error excerpt when it failed, else the full target
   * when the row had to cut it.
   */
  readonly detail: string | null;
  /** Tool-name badge for a tool row; null for every other row kind. */
  readonly tool: CompactFeedToolBadge | null;
}

export interface CompactFeedToolBadge {
  /** Raw tool name, for the tool icon. */
  readonly name: string;
  /** Name shown on the badge (Ptah MCP tools show their short name). */
  readonly displayName: string;
  /** Full badge class string, coloured by status as in the normal view. */
  readonly badgeClass: string;
}

const KIND_LABEL: Record<CompactSemanticMarkKind, string> = {
  tool: 'TOOL',
  agent: 'AGENT',
  prose: 'PROSE',
  prompt: 'ASK',
  compaction: 'COMP',
  terminal: 'TERM',
};

/**
 * Badge colour is coded by mark KIND (like the wire-console prototype), while
 * tone stays dual-coded through the glyph and the row accent.
 */
type WireBadgeTone = 'info' | 'secondary' | 'primary' | 'warning' | 'error';

const KIND_BADGE_TONE: Record<CompactSemanticMarkKind, WireBadgeTone> = {
  tool: 'info',
  agent: 'secondary',
  prose: 'primary',
  prompt: 'warning',
  compaction: 'warning',
  terminal: 'error',
};

const BADGE_CLASSES: Record<WireBadgeTone, string> = {
  info: 'border-info/30 bg-info/10 text-info',
  secondary: 'border-secondary/30 bg-secondary/10 text-secondary',
  primary: 'border-primary/30 bg-primary/10 text-primary',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  error: 'border-error/30 bg-error/10 text-error',
};

/**
 * Full class string for a wire badge. Bound through a single `[class]` so
 * the static layout classes and the kind-coded colours do not collide with
 * the no-duplicate-attributes template rule.
 */
const BADGE_BASE_CLASSES =
  'inline-flex min-w-[60px] shrink-0 items-center justify-center gap-1 rounded border px-1.5 py-px text-center text-[9px] font-bold';

/** Tool-name badge, as in the normal view's tool header. */
const TOOL_BADGE_BASE_CLASSES =
  'badge badge-xs font-mono px-1.5 max-w-[45%] shrink-0 overflow-hidden';

/**
 * A tool mark's tone read as the execution status the normal view colours.
 * `warning` and `idle` have no tool status of their own (the normal view has
 * no idle tool), so both read as `pending`, the neutral badge.
 */
const TONE_TOOL_STATUS: Record<CompactSummaryStatusTone, ExecutionStatus> = {
  live: 'streaming',
  success: 'complete',
  error: 'error',
  warning: 'pending',
  idle: 'pending',
};

/** Input bound for conversion; tool output can be very large. */
const DETAIL_SOURCE_LIMIT = 4000;
/** The detail block wraps and scrolls, so 600 plain chars is plenty. */
const DETAIL_TEXT_LIMIT = 600;
/** The row description is one visually truncated line. */
const ROW_TEXT_LIMIT = 120;

/**
 * Tone is dual-coded: every badge pairs this glyph with a colour class so
 * tone reads correctly without colour vision.
 */
const TONE_GLYPH: Record<CompactSummaryStatusTone, string> = {
  idle: '○',
  live: '▶',
  success: '✓',
  warning: '▲',
  error: '✖',
};

export function feedKindLabel(kind: CompactSemanticMarkKind): string {
  return KIND_LABEL[kind];
}

export function feedToneGlyph(tone: CompactSummaryStatusTone): string {
  return TONE_GLYPH[tone];
}

/** Kind-coded wire badge classes; an error tone overrides the kind colour. */
export function wireBadgeClass(mark: CompactSemanticMark): string {
  const tone: WireBadgeTone =
    mark.tone === 'error' ? 'error' : KIND_BADGE_TONE[mark.kind];
  return `${BADGE_BASE_CLASSES} ${BADGE_CLASSES[tone]}`;
}

/** The feed row for a mark: a tool row when it names its tool, else a mark row. */
export function feedRow(mark: CompactSemanticMark): CompactFeedRow {
  return mark.kind === 'tool' && mark.toolName
    ? toolFeedRow(mark, mark.toolName)
    : markFeedRow(mark);
}

/** A prose, agent, prompt, compaction or terminal row: label plus detail. */
function markFeedRow(mark: CompactSemanticMark): CompactFeedRow {
  const label = stripMarkdownToPlainText(mark.label);
  const detail = mark.text
    ? stripMarkdownToPlainText(mark.text.slice(0, DETAIL_SOURCE_LIMIT)).slice(
        0,
        DETAIL_TEXT_LIMIT,
      )
    : null;
  return {
    mark,
    label,
    detail: detail || null,
    text: shortenRowText(detail || label, ROW_TEXT_LIMIT),
    title: detail ? `${label} — ${detail}` : label,
    tool: null,
  };
}

/**
 * A tool row, read like the normal view's tool header. Its text is the
 * call's target from the tool input; it is never parsed as markdown (glob
 * patterns must survive intact) and never carries tool output.
 */
function toolFeedRow(
  mark: CompactSemanticMark,
  toolName: string,
): CompactFeedRow {
  const label = stripMarkdownToPlainText(mark.label);
  const target = (mark.text ?? '').slice(0, DETAIL_TEXT_LIMIT);
  const oneLine = target.replace(/\s+/g, ' ').trim();
  const text = shortenRowText(oneLine || label, ROW_TEXT_LIMIT);
  const cut = target.trim() !== oneLine || oneLine.length > ROW_TEXT_LIMIT;
  const detail =
    mark.tone === 'error' && mark.excerpt
      ? mark.excerpt.slice(0, DETAIL_TEXT_LIMIT)
      : cut
        ? target.trim()
        : null;
  return {
    mark,
    label,
    detail,
    text,
    title: oneLine ? `${label} — ${oneLine}` : label,
    tool: {
      name: toolName,
      displayName: displayToolName(toolName),
      badgeClass: `${TOOL_BADGE_BASE_CLASSES} ${toolStatusBadgeClass(
        TONE_TOOL_STATUS[mark.tone],
      )}`,
    },
  };
}
