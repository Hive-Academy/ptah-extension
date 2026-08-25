import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { ExternalLink, LucideAngularModule, Package } from 'lucide-angular';

import type { HubSection, MemberPack } from '@ptah-contracts/community';

import { HubSectionCard } from './hub-section-card';

/**
 * PacksCard — the member-visible pack registry on the hub (R5, R6.1).
 *
 * ⚠️ THIS REGISTRY GATES NOTHING (A-1, R5.7). Ptah never serves pack content
 * and never provisions GitHub access; only the discovery and link-delivery
 * channel moved in-product when the forum was dropped. `accessNote` is shown
 * BEFORE the member follows `repoUrl` precisely so a GitHub 404 is not the
 * first signal that they lack access (R5.5).
 *
 * `accessNote` is NOT `notes`. `notes` is the admin-internal freeform field and
 * is absent from `MemberPack` by design — field absence is the contract there,
 * and it is why `MemberPack` re-declares its fields instead of extending
 * `AdminPack`.
 */
@Component({
  selector: 'ptah-packs-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HubSectionCard, LucideAngularModule],
  template: `
    <ptah-hub-section-card
      title="Your packs"
      [status]="section().status"
      [emptyIcon]="PackageIcon"
      emptyMessage="No packs published yet."
      emptyHint="Packs are reference codebases you can clone. They are published to members in phase 5."
      unavailableMessage="The pack registry could not be loaded."
      link="/members/packs"
      linkLabel="Browse"
    >
      <ul class="flex flex-col gap-3">
        @for (pack of packs(); track pack.id) {
          <li class="rounded-lg border border-hairline bg-base-100 p-3">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-base-content">
                  {{ pack.title }}
                </p>
                <p class="mt-0.5 line-clamp-2 text-xs text-base-content-muted">
                  {{ pack.description }}
                </p>
              </div>
              <a
                [href]="pack.repoUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-ghost btn-xs shrink-0"
                [attr.aria-label]="'Open the ' + pack.title + ' repository'"
              >
                <lucide-angular
                  [img]="ExternalLinkIcon"
                  class="h-3.5 w-3.5"
                  aria-hidden="true"
                />
              </a>
            </div>

            @if (pack.tags.length > 0) {
              <div class="mt-2 flex flex-wrap gap-1">
                @for (tag of pack.tags; track tag) {
                  <span class="badge badge-ghost badge-xs font-mono">
                    {{ tag }}
                  </span>
                }
              </div>
            }

            @if (pack.accessNote; as note) {
              <p class="mt-2 text-xs text-base-content-muted">{{ note }}</p>
            }
          </li>
        }
      </ul>
    </ptah-hub-section-card>
  `,
})
export class PacksCard {
  public readonly section = input.required<HubSection<MemberPack[]>>();

  protected readonly PackageIcon = Package;
  protected readonly ExternalLinkIcon = ExternalLink;

  protected readonly packs = computed<readonly MemberPack[]>(() => {
    const section = this.section();
    return section.status === 'ok' ? section.data : [];
  });
}
