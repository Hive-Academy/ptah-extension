/**
 * Member sidebar navigation model (plan §5.4, R9.2, R9.3).
 *
 * Mirrors `libs/web/admin/src/lib/admin-layout/admin-nav.config.ts` exactly in
 * shape: this file supplies DATA, not structure. The grouped sidebar, the
 * primary/secondary tiering, the per-group disclosure and the active highlight
 * all live in `PanelLayout` (`@ptah-web/panel-ui`) and are shared verbatim with
 * the admin panel (R9.1).
 *
 * The IA is task-oriented — Home, Learn, Build, Live, Community, Account — which
 * is what makes the same chrome fit two different audiences: an operator's
 * tasks and a member's tasks differ, the chrome describing them does not.
 */
import {
  GraduationCap,
  Home,
  MessagesSquare,
  Package,
  Radio,
  UserCircle,
} from 'lucide-angular';

import type { PanelNavGroup } from '@ptah-web/panel-ui';

/**
 * ⚠️ THE NOTIFICATIONS ITEM'S UNREAD COUNT USES `PanelNavItem.badgeCount` AND
 * NOTHING ELSE (R9.3). `badgeCount` already exists on the shared nav contract
 * and `PanelLayout` already renders it; Batch 15 binds a real number to it via
 * a `computed()` in `MemberLayout` that rebuilds this array with that one
 * item's `badgeCount` replaced. Introducing a second badge mechanism — a
 * bespoke chip in the member template, a separate signal read inside the shell
 * — is what R9.3 forbids, because then two things claim to be "the unread
 * count" and they disagree the first time one of them is missed.
 */
export const MEMBER_NAV_GROUPS: readonly PanelNavGroup[] = [
  {
    label: 'Home',
    icon: Home,
    flat: true,
    items: [
      {
        label: 'Hub',
        route: '/members/hub',
        primary: true,
        icon: Home,
        exact: true,
      },
    ],
  },
  {
    label: 'Learn',
    icon: GraduationCap,
    items: [
      {
        label: 'Courses',
        route: '/members/courses',
        primary: true,
        icon: GraduationCap,
      },
      {
        // Artifacts are published as course resources, so they share the
        // Courses route until phase 3 gives them their own surface.
        label: 'Artifacts',
        route: '/members/courses',
        primary: false,
      },
    ],
  },
  {
    label: 'Build',
    icon: Package,
    flat: true,
    items: [
      {
        label: 'Packs',
        route: '/members/packs',
        primary: true,
        icon: Package,
      },
    ],
  },
  {
    label: 'Live',
    icon: Radio,
    items: [
      {
        label: 'Sessions',
        route: '/members/live',
        primary: true,
        icon: Radio,
        exact: true,
      },
      {
        label: 'Replays',
        route: '/members/live/replays',
        primary: false,
      },
      {
        label: 'Request a session',
        route: '/members/live/request',
        primary: false,
      },
    ],
  },
  {
    label: 'Community',
    icon: MessagesSquare,
    items: [
      {
        label: 'Feed',
        route: '/members/community',
        primary: true,
        icon: MessagesSquare,
        exact: true,
      },
      {
        label: 'My Threads',
        route: '/members/community/my-threads',
        primary: false,
      },
      {
        label: 'Notifications',
        route: '/members/notifications',
        primary: false,
      },
    ],
  },
  {
    label: 'Account',
    icon: UserCircle,
    flat: true,
    items: [
      {
        label: 'Account',
        route: '/members/account',
        primary: true,
        icon: UserCircle,
      },
    ],
  },
];
