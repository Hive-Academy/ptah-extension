import { ChangeDetectionStrategy, Component, computed, input, type InputSignal } from '@angular/core';
import type { AvatarNode } from '../view-model/view-model.types';

/**
 * Initials disc colours come from the renderer's display tokens (D17), with
 * theme fallbacks outside a renderer root. No image, icon or URL is ever
 * rendered: the contract carries a plain name only (R4.7, trust boundary).
 */
const AVATAR_STYLES = `
  .dp-avatar {
    display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 999px;
    font-size: 12px; font-weight: 700; line-height: 1;
    background: var(--dp-avatar-tint); color: var(--dp-avatar-text);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--dp-avatar-text) 26%, transparent);
  }
  .dp-avatar--neutral { --dp-avatar-tint: var(--dp-n-tint, oklch(var(--b3))); --dp-avatar-text: var(--dp-fg, oklch(var(--bc))); }
  .dp-avatar--info { --dp-avatar-tint: var(--dp-in-tint, oklch(var(--b3))); --dp-avatar-text: var(--dp-in-text, oklch(var(--in))); }
  .dp-avatar--success { --dp-avatar-tint: var(--dp-su-tint, oklch(var(--b3))); --dp-avatar-text: var(--dp-su-text, oklch(var(--su))); }
  .dp-avatar--warning { --dp-avatar-tint: var(--dp-wa-tint, oklch(var(--b3))); --dp-avatar-text: var(--dp-wa-text, oklch(var(--wa))); }
`;

export const AVATAR_TONES = ['neutral', 'info', 'success', 'warning'] as const;
export type AvatarTone = (typeof AVATAR_TONES)[number];

/** Literal class strings, never concatenated. */
const AVATAR_TONE_CLASSES: Readonly<Record<AvatarTone, string>> = {
  neutral: 'dp-avatar dp-avatar--neutral',
  info: 'dp-avatar dp-avatar--info',
  success: 'dp-avatar dp-avatar--success',
  warning: 'dp-avatar dp-avatar--warning',
};

/**
 * Up to two initials: the first letter of the first two words ("code-explorer"
 * gives "CE"), or the first two characters of a single word ("planner" gives
 * "Pl"). Characters are code points, so a surrogate pair is never split.
 */
export function avatarInitials(name: string): string {
  const trimmed = name.trim();
  const words = trimmed.split(/[\s\-_./]+/u).filter(word => word.length > 0);
  if (words.length >= 2) return words.slice(0, 2).map(word => firstChar(word).toLocaleUpperCase()).join('');
  // A name made only of separators ("--") keeps its own characters.
  const [first = '', second = ''] = Array.from(words[0] ?? trimmed);
  return `${first.toLocaleUpperCase()}${second}`;
}

function firstChar(word: string): string {
  const [first = ''] = Array.from(word);
  return first;
}

/** Deterministic tone: FNV-1a over the name's UTF-16 code units, so a name keeps its colour across renders. */
export function avatarTone(name: string): AvatarTone {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash = Math.imul(hash ^ name.charCodeAt(index), 0x01000193) >>> 0;
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? 'neutral';
}

/**
 * `dashboard-catalog/4` avatar (R4.7-R4.8): a decorative initials disc
 * (`aria-hidden`) beside the name and optional subtitle as plain text.
 * Avatars have no selection target, so nothing here is interactive.
 */
@Component({
  selector: 'ptah-dashboard-avatar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [AVATAR_STYLES],
  template: `
    <div class="flex min-w-0 items-center gap-2 text-base-content">
      <span [class]="toneClasses()" aria-hidden="true" data-testid="avatar-initials">{{ initials() }}</span>
      <span class="flex min-w-0 flex-col">
        <span class="break-words text-sm font-semibold leading-tight" data-testid="avatar-name">{{ node().name }}</span>
        @if (node().subtitle) {
          <span class="break-words text-xs leading-tight text-base-content-muted" data-testid="avatar-subtitle">{{ node().subtitle }}</span>
        }
      </span>
    </div>
  `,
})
export class DashboardAvatarComponent {
  public readonly node: InputSignal<AvatarNode> = input.required<AvatarNode>();

  public readonly initials = computed(() => avatarInitials(this.node().name));
  public readonly toneClasses = computed(() => AVATAR_TONE_CLASSES[avatarTone(this.node().name)]);
}
