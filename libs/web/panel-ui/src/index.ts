/**
 * `@ptah-web/panel-ui` — the shared operator/member panel primitives.
 *
 * ⚠️ **10 EXPORT LINES / 11 SYMBOLS. THIS COMMENT IS THE AUTHORITATIVE COUNT.**
 * TASK_2026_177 PRE-3 recorded "nine symbols / 8 export lines" and that literal
 * went stale the moment Batch 7 promoted `ThreadRow` and `TagChip` (RISK-M).
 * Later batches read THIS file, not the precondition. Update the numbers here in
 * the same edit that changes the list below, so there is exactly one place a
 * reader has to trust.
 *
 * The eleven symbols: `PanelNavItem` + `PanelNavGroup` (types), `BadgeVariant`
 * (type), `PanelLayout`, `StatTile`, `StatusBadge`, `EmptyState`,
 * `DetailDrawer`, `SelectionToolbar`, `ThreadRow`, `TagChip`.
 *
 * ⚠️ THE PROMOTION RULE (§5.3): a primitive earns a place here when a SECOND
 * panel ACTUALLY RENDERS IT — not when it looks reusable. `ThreadRow` and
 * `TagChip` qualify because `libs/web/admin/.../community/community-moderation`
 * renders both in the same batch that added them; before that consumer existed,
 * `community-activity-card.ts` deliberately kept its rows inline and said so.
 * The member-only community components (`TopicComposer`, `ReplyComposer`,
 * `ReactionBar`, `AcceptedAnswerBadge`, `UnreadPill`) stay private to
 * `libs/web/members` because nothing else renders them — the composers have no
 * admin equivalent, reactions are member-semantics-only (A-8), and unread state
 * is per-member (A-6).
 */
export * from './lib/panel-nav.types';
export * from './lib/badge-variant';
export * from './lib/panel-layout/panel-layout';
export * from './lib/stat-tile/stat-tile';
export * from './lib/status-badge/status-badge';
export * from './lib/empty-state/empty-state';
export * from './lib/detail-drawer/detail-drawer';
export * from './lib/selection-toolbar/selection-toolbar';
export * from './lib/thread-row/thread-row';
export * from './lib/tag-chip/tag-chip';
