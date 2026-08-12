import type { LucideIconData } from 'lucide-angular';

/**
 * Sidebar navigation contract shared by every authenticated panel shell
 * (`/admin`, `/members`).
 *
 * Extracted from the admin dashboard's `AdminNavItem`/`AdminNavGroup`, which
 * were identical in shape but private to that lib. The IA is task-oriented
 * ("what does this person need to do") rather than model-oriented ("what is in
 * the database"), and that framing is what makes it reusable: an operator's
 * tasks and a member's tasks differ, the chrome describing them does not.
 */
export interface PanelNavItem {
  /** Sidebar label. */
  label: string;
  /** Absolute route path. */
  route: string;
  /**
   * Tier: `true` = primary (high-frequency) — icon + medium weight, always
   * visible. `false` = secondary/utility — smaller, indented, hidden when its
   * group's disclosure is collapsed.
   */
  primary: boolean;
  /** Leading lucide icon — present on primary items only. */
  icon?: LucideIconData;
  /** Renders the muted `ro` badge. Mirrors a backend read-only capability. */
  readOnly?: boolean;
  /**
   * When true the active highlight requires an EXACT route match. Use for
   * hub-style items whose slug prefixes a sibling's route (e.g.
   * `/admin/marketing` vs `/admin/marketing/compose`) so the parent does not
   * stay lit while a child page is open.
   */
  exact?: boolean;
  /** Optional trailing count (unread replies, pending items). Hidden at 0. */
  badgeCount?: number;
}

export interface PanelNavGroup {
  /** Uppercase group header label. */
  label: string;
  /** Group icon. Retained for callers that render one; the shell does not. */
  icon?: LucideIconData;
  /** Ordered items — primary first, then secondary. */
  items: PanelNavItem[];
  /**
   * When true the group renders as a flat standalone link with no disclosure
   * toggle. Use for single-item groups (an Overview or Home link).
   */
  flat?: boolean;
}
