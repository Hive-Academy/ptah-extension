/**
 * Admin sidebar navigation model (visual-design-specification §2).
 *
 * Drives the grouped/collapsible sidebar in `admin-layout.html`, replacing the
 * old flat `ADMIN_MODEL_SPECS` iteration. The IA is task-oriented ("what an
 * operator needs to do") rather than model-oriented ("what the DB contains").
 *
 * Route slugs intentionally reuse the EXISTING `AdminModelKey` slugs
 * (`/admin/waitlist`, `/admin/users`, `/admin/licenses`, …). Today every
 * non-bespoke slug still resolves through the generic `:model` route in
 * `admin.routes.ts`; the bespoke components + explicit routes land in a later
 * batch. Editing routes is out of scope for this config — it only describes
 * grouping, tiering, icons, and active-state targets.
 */
import {
  AlertTriangle,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  type LucideIconData,
  ScrollText,
  Send,
  TrendingUp,
  UserCircle,
  UserPlus,
  Users2,
  Wrench,
} from 'lucide-angular';

export interface AdminNavItem {
  /** Sidebar label. */
  label: string;
  /** Absolute route path (matches an existing `admin.routes.ts` target). */
  route: string;
  /**
   * Tier: `true` = primary (bespoke, high-frequency) — icon + medium weight,
   * always visible. `false` = secondary/utility — smaller, indented, hidden
   * when its group's disclosure is collapsed (design spec §2.2, §2.3).
   */
  primary: boolean;
  /** Leading lucide icon — present on primary items only (§7.6). */
  icon?: LucideIconData;
  /** Mirrors backend `readOnly` — renders the muted `ro` badge (§2.3). */
  readOnly?: boolean;
}

export interface AdminNavGroup {
  /** Uppercase group header label. */
  label: string;
  /** 20px group icon (§7.6). */
  icon: LucideIconData;
  /** Ordered items — primary first, then secondary. */
  items: AdminNavItem[];
  /**
   * When true the group renders as a flat single link with no disclosure
   * toggle (used for groups with a single, always-visible item — Command
   * Center's Overview and Records & Compliance's Audit Log, per §2.3).
   */
  flat?: boolean;
}

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    label: 'Command Center',
    icon: LayoutDashboard,
    flat: true,
    items: [
      {
        label: 'Overview',
        route: '/admin/overview',
        primary: true,
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: 'Growth',
    icon: TrendingUp,
    items: [
      {
        label: 'Waitlist Pipeline',
        route: '/admin/waitlist',
        primary: true,
        icon: UserPlus,
      },
      {
        label: 'Compose Campaign',
        route: '/admin/marketing/compose',
        primary: true,
        icon: Send,
      },
      {
        label: 'Campaign History',
        route: '/admin/marketing-campaigns',
        primary: false,
        readOnly: true,
      },
      {
        label: 'Email Templates',
        route: '/admin/marketing-campaign-templates',
        primary: false,
      },
    ],
  },
  {
    label: 'Revenue & Licensing',
    icon: CreditCard,
    items: [
      {
        label: 'Licenses',
        route: '/admin/licenses',
        primary: true,
        icon: KeyRound,
      },
      {
        label: 'Subscriptions (Paddle)',
        route: '/admin/subscriptions',
        primary: false,
        readOnly: true,
      },
    ],
  },
  {
    label: 'Operations',
    icon: Wrench,
    items: [
      {
        label: 'Failed Webhooks',
        route: '/admin/failed-webhooks',
        primary: true,
        icon: AlertTriangle,
      },
      {
        label: 'Session Requests',
        route: '/admin/session-requests',
        primary: false,
      },
    ],
  },
  {
    label: 'People & Community',
    icon: Users2,
    items: [
      {
        label: 'Users',
        route: '/admin/users',
        primary: true,
        icon: UserCircle,
      },
      {
        label: 'Member Groups',
        route: '/admin/groups',
        primary: false,
      },
    ],
  },
  {
    label: 'Records & Compliance',
    icon: ScrollText,
    flat: true,
    items: [
      {
        label: 'Audit Log',
        route: '/admin/admin-audit-log',
        primary: false,
        readOnly: true,
      },
    ],
  },
];
