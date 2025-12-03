/**
 * AutopilotPopoverComponent - Elegant Autopilot Toggle with Confirmation
 * TASK_2025_035: Model selector and autopilot integration
 *
 * A sleek popover component for toggling autopilot mode with a confirmation step.
 * Explains what autopilot does before enabling and shows current permission level.
 *
 * Pattern: Signal-based state from AutopilotStateService
 * UI: DaisyUI dropdown with confirmation content
 */

import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  Zap,
  ZapOff,
  ChevronDown,
  AlertTriangle,
} from 'lucide-angular';
import { AutopilotStateService } from '@ptah-extension/core';
import { type PermissionLevel } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-autopilot-popover',
  imports: [LucideAngularModule],
  template: `
    <div class="dropdown dropdown-top dropdown-end">
      <button
        tabindex="0"
        class="btn btn-ghost btn-sm gap-1.5 font-normal"
        type="button"
        [class.btn-disabled]="autopilotState.isPending()"
        [class.text-warning]="autopilotState.enabled()"
      >
        @if (autopilotState.isPending()) {
        <span class="loading loading-spinner loading-xs"></span>
        } @else if (autopilotState.enabled()) {
        <lucide-angular [img]="ZapIcon" class="w-4 h-4" />
        } @else {
        <lucide-angular [img]="ZapOffIcon" class="w-4 h-4 opacity-60" />
        }
        <span class="text-xs">{{ autopilotState.statusText() }}</span>
        <lucide-angular [img]="ChevronDownIcon" class="w-3 h-3" />
      </button>

      <div
        tabindex="0"
        class="dropdown-content z-50 mb-2 p-0 shadow-lg bg-base-200 rounded-lg w-80 border border-base-300"
      >
        <!-- Header -->
        <div class="px-4 py-3 border-b border-base-300 flex items-center gap-2">
          <lucide-angular
            [img]="autopilotState.enabled() ? ZapIcon : ZapOffIcon"
            class="w-5 h-5"
            [class.text-warning]="autopilotState.enabled()"
          />
          <span class="font-semibold">Autopilot Mode</span>
          @if (autopilotState.enabled()) {
          <span class="badge badge-warning badge-sm ml-auto">Active</span>
          }
        </div>

        <!-- Content -->
        <div class="p-4">
          @if (!autopilotState.enabled()) {
          <!-- Enable Autopilot View -->
          <p class="text-sm text-base-content/80 mb-4">
            Autopilot allows Claude to automatically approve certain actions
            without asking for confirmation each time.
          </p>

          <!-- Permission Level Selector -->
          <div class="mb-4">
            <label
              class="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2 block"
            >
              Permission Level
            </label>
            <div class="flex flex-col gap-1">
              @for (level of permissionLevels; track level.id) {
              <button
                type="button"
                class="btn btn-sm justify-start gap-2"
                [class.btn-primary]="selectedLevel() === level.id"
                [class.btn-ghost]="selectedLevel() !== level.id"
                (click)="selectLevel(level.id)"
              >
                <span class="font-medium">{{ level.name }}</span>
                <span class="text-xs opacity-70">{{ level.description }}</span>
              </button>
              }
            </div>
          </div>

          <!-- Warning for YOLO mode -->
          @if (selectedLevel() === 'yolo') {
          <div class="alert alert-warning mb-4 py-2">
            <lucide-angular [img]="AlertTriangleIcon" class="w-4 h-4" />
            <span class="text-xs"
              >Full Auto skips ALL permission prompts. Use with caution!</span
            >
          </div>
          }

          <!-- Enable Button -->
          <button
            class="btn btn-warning btn-sm w-full gap-2"
            [disabled]="autopilotState.isPending()"
            (click)="enableAutopilot()"
          >
            @if (autopilotState.isPending()) {
            <span class="loading loading-spinner loading-xs"></span>
            } @else {
            <lucide-angular [img]="ZapIcon" class="w-4 h-4" />
            } Enable Autopilot
          </button>
          } @else {
          <!-- Disable Autopilot View -->
          <div class="text-center">
            <div class="flex items-center justify-center gap-2 mb-3">
              <lucide-angular [img]="ZapIcon" class="w-6 h-6 text-warning" />
              <span class="font-medium">Autopilot is Active</span>
            </div>
            <p class="text-sm text-base-content/70 mb-2">
              Current mode:
              <span class="font-medium">{{ autopilotState.statusText() }}</span>
            </p>
            <p class="text-xs text-base-content/50 mb-4">
              Claude is automatically approving actions based on your permission
              level.
            </p>

            <!-- Disable Button -->
            <button
              class="btn btn-ghost btn-sm w-full gap-2"
              [disabled]="autopilotState.isPending()"
              (click)="disableAutopilot()"
            >
              @if (autopilotState.isPending()) {
              <span class="loading loading-spinner loading-xs"></span>
              } @else {
              <lucide-angular [img]="ZapOffIcon" class="w-4 h-4" />
              } Disable Autopilot
            </button>
          </div>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutopilotPopoverComponent {
  readonly autopilotState = inject(AutopilotStateService);

  // Lucide icons
  readonly ZapIcon = Zap;
  readonly ZapOffIcon = ZapOff;
  readonly ChevronDownIcon = ChevronDown;
  readonly AlertTriangleIcon = AlertTriangle;

  // Permission levels for selector
  readonly permissionLevels: {
    id: PermissionLevel;
    name: string;
    description: string;
  }[] = [
    { id: 'auto-edit', name: 'Auto-edit', description: 'File edits only' },
    { id: 'yolo', name: 'Full Auto', description: 'All actions' },
  ];

  // Local state for level selection before enabling
  readonly selectedLevel = signal<PermissionLevel>('auto-edit');

  /**
   * Select permission level before enabling autopilot
   */
  selectLevel(level: PermissionLevel): void {
    this.selectedLevel.set(level);
  }

  /**
   * Enable autopilot with selected permission level
   */
  async enableAutopilot(): Promise<void> {
    try {
      // First set the permission level
      await this.autopilotState.setPermissionLevel(this.selectedLevel());
      // Then toggle on
      await this.autopilotState.toggleAutopilot();
      // Close dropdown
      this.closeDropdown();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to enable autopilot:',
        error
      );
    }
  }

  /**
   * Disable autopilot
   */
  async disableAutopilot(): Promise<void> {
    try {
      await this.autopilotState.toggleAutopilot();
      this.closeDropdown();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to disable autopilot:',
        error
      );
    }
  }

  /**
   * Close dropdown by removing focus
   */
  private closeDropdown(): void {
    const activeElement = document.activeElement as HTMLElement;
    activeElement?.blur();
  }
}
