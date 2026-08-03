/**
 * Admin sidebar navigation model (visual-design-specification §2).
 *
 * Drives the grouped/collapsible sidebar in `admin-layout.html`, replacing the
 * old flat `ADMIN_MODEL_SPECS` iteration. The IA is task-oriented ("what an
 * operator needs to do") rather than model-oriented ("what the DB contains").
 *
 * Route slugs intentionally reuse the EXISTING `AdminModelKey` slugs
 * (`/admin/waitlist`, `/admin/users`, …). Non-bespoke slugs still resolve
 * through the generic `:model` route in `admin.routes.ts`. Editing routes is
 * out of scope for this config — it only describes grouping, tiering, icons,
 * and active-state targets.
 *
 * ⚠️ THERE IS DELIBERATELY NO "Revenue & Licensing" GROUP. Licenses and Paddle
 * subscriptions were merged into the user surface: `/admin/users` carries the
 * entitlement columns + `?filter=entitlement:*` lenses, and `/admin/users/:id`
 * owns the full license ↔ subscription reconciliation. Re-adding standalone
 * `/admin/licenses` or `/admin/subscriptions` nav items would resurrect the
 * split view this merge removed (both slugs now redirect to `/admin/users`).
 */
import {
  AlertTriangle,
  CalendarDays,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Package,
  ScrollText,
  TrendingUp,
  UserCircle,
  UserPlus,
  Users2,
  Wrench,
} from 'lucide-angular';

import type { PanelNavGroup } from '@ptah-web/panel-ui';

/**
 * The item/group shapes moved to `@ptah-web/panel-ui` when the drawer shell
 * was generalised for the member panel — they were never admin-specific, only
 * admin-private. This file now supplies data, not structure.
 */
export const ADMIN_NAV_GROUPS: readonly PanelNavGroup[] = [
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
        exact: true,
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
        label: 'Marketing',
        route: '/admin/marketing',
        primary: true,
        icon: Megaphone,
        exact: true,
      },
      {
        label: 'Compose Campaign',
        route: '/admin/marketing/compose',
        primary: false,
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
    // TASK_2026_169 — the admin's window onto Builders member content, reached
    // through `AdminGuard` rather than a Builders membership. Sits between
    // Operations and People & Community: operational in nature, but the content
    // it manages is member-facing.
    //
    // Member Groups deliberately stays under People & Community — cohorts are
    // people-shaped, and the members drill-down enhances `/admin/groups` in place.
    label: 'Builders Content',
    icon: Package,
    items: [
      {
        label: 'Packs',
        route: '/admin/builders/packs',
        primary: true,
        icon: Package,
      },
      {
        label: 'Sessions',
        route: '/admin/builders/sessions',
        primary: true,
        icon: CalendarDays,
      },
      {
        label: 'Community',
        route: '/admin/builders/community',
        primary: true,
        icon: MessagesSquare,
        readOnly: true,
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
