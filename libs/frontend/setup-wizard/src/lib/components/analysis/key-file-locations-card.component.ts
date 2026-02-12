import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { KeyFileLocations } from '@ptah-extension/shared';
import { LucideAngularModule, Folder } from 'lucide-angular';

/**
 * KeyFileLocationsCardComponent - Displays key file locations organized by type
 *
 * Purpose:
 * - Show key file locations grouped by purpose (entry points, configs, tests, etc.)
 * - Collapsible sections for each file type with null-safe array iteration
 *
 * Usage:
 * ```html
 * <ptah-key-file-locations-card [locations]="analysis.keyFileLocations" />
 * ```
 */
@Component({
  selector: 'ptah-key-file-locations-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-base-300 rounded-md bg-base-200/50 mb-4">
      <div class="p-4">
        <h3 class="text-sm font-medium uppercase tracking-wide mb-3">
          <lucide-angular [img]="FolderIcon" class="h-4 w-4" />
          Key File Locations
        </h3>
        <div class="space-y-3">
          @for (section of sections; track section.key) { @if
          (getItems(section.key).length > 0) {
          <div tabindex="0" class="collapse collapse-arrow bg-base-100">
            <div class="collapse-title font-medium">
              {{ section.label }}
              <span class="badge badge-sm badge-ghost ml-2">{{
                getItems(section.key).length
              }}</span>
            </div>
            <div class="collapse-content">
              <ul class="text-sm text-base-content/80 space-y-1">
                @for (item of getDisplayItems(section.key); track item) {
                <li class="font-mono text-xs truncate" [title]="item">
                  {{ item }}
                </li>
                } @if (getItems(section.key).length > 10) {
                <li class="text-xs text-base-content/60">
                  +{{ getItems(section.key).length - 10 }} more
                </li>
                }
              </ul>
            </div>
          </div>
          } }
        </div>
      </div>
    </div>
  `,
})
export class KeyFileLocationsCardComponent {
  // Lucide icon reference
  protected readonly FolderIcon = Folder;

  readonly locations = input.required<KeyFileLocations>();

  protected readonly sections = [
    { key: 'entryPoints' as const, label: 'Entry Points' },
    { key: 'configs' as const, label: 'Configuration Files' },
    { key: 'testDirectories' as const, label: 'Test Directories' },
    { key: 'components' as const, label: 'Components' },
    { key: 'services' as const, label: 'Services' },
    { key: 'apiRoutes' as const, label: 'API Routes' },
  ];

  protected getItems(key: keyof KeyFileLocations): string[] {
    return (this.locations()[key] as string[] | undefined) ?? [];
  }

  protected getDisplayItems(key: keyof KeyFileLocations): string[] {
    return this.getItems(key).slice(0, 10);
  }
}
