/**
 * AutopilotPopoverComponent - Elegant Autopilot Toggle with Confirmation
 * TASK_2025_048: Migrate to CDK Overlay with dark backdrop and keyboard navigation
 * TASK_2025_092: Migrate to Native components (Floating UI)
 *
 * A sleek popover component for toggling autopilot mode with a confirmation step.
 * Features dark backdrop (modal-like UX) and keyboard navigation for permission levels.
 *
 * Pattern: Signal-based state from AutopilotStateService
 * UI: NativePopoverComponent from @ptah-extension/ui with Floating UI positioning
 * Keyboard Navigation: Parent manages activeIndex signal for NativeOptionComponent
 * New Features: Dark backdrop, keyboard navigation for permission level selection
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
import {
  NativePopoverComponent,
  NativeOptionComponent,
  KeyboardNavigationService,
} from '@ptah-extension/ui';

@Component({
  selector: 'ptah-autopilot-popover',
  imports: [LucideAngularModule, NativePopoverComponent, NativeOptionComponent],
  providers: [KeyboardNavigationService],
  template: `
    <ptah-native-popover
      [isOpen]="isOpen()"
      [placement]="'top-end'"
      [hasBackdrop]="true"
      [backdropClass]="'dark'"
      (closed)="closePopover()"
      (backdropClicked)="closePopover()"
    >
      <button
        trigger
        class="btn btn-ghost btn-sm gap-1.5 font-normal"
        [class.ring-2]="isOpen()"
        [class.ring-warning]="isOpen()"
        type="button"
        (click)="togglePopover()"
        [disabled]="autopilotState.isPending()"
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

      <div content class="w-80">
        <!-- Header -->
        <div class="px-3 py-2 border-b border-base-300 flex items-center gap-2">
          <lucide-angular
            [img]="autopilotState.enabled() ? ZapIcon : ZapOffIcon"
            class="w-4 h-4"
            [class.text-warning]="autopilotState.enabled()"
          />
          <span class="font-semibold text-sm">Autopilot Mode</span>
          @if (autopilotState.enabled()) {
          <span class="badge badge-warning badge-xs ml-auto">Active</span>
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

          <!-- Permission Level Selector with Keyboard Navigation -->
          <div class="mb-4">
            <span
              class="text-xs font-medium text-base-content/60 uppercase tracking-wide mb-2 block"
            >
              Permission Level
            </span>
            <div class="flex flex-col gap-1">
              @for (level of permissionLevels; track level.id; let i = $index) {
              <ptah-native-option
                [optionId]="'level-' + i"
                [value]="level"
                [isActive]="i === activeIndex()"
                (selected)="selectLevel($event.id)"
                (hovered)="onHover(i)"
              >
                <div class="flex items-start gap-2 py-0.5">
                  <div class="flex flex-col items-start flex-1 min-w-0">
                    <span class="font-medium text-xs">{{ level.name }}</span>
                    <span class="text-[11px] text-base-content/60">{{
                      level.description
                    }}</span>
                  </div>
                  @if (selectedLevel() === level.id) {
                  <span class="badge badge-xs badge-primary mt-0.5"
                    >Selected</span
                  >
                  }
                </div>
              </ptah-native-option>
              }
            </div>
          </div>

          <!-- Warning for YOLO mode -->
          @if (selectedLevel() === 'yolo') {
          <div class="alert alert-warning mb-4 py-2">
            <lucide-angular [img]="AlertTriangleIcon" class="w-3 h-3" />
            <span class="text-[11px]"
              >Full Auto skips ALL permission prompts. Use with caution!</span
            >
          </div>
          }

          <!-- Error Display -->
          @if (errorMessage()) {
          <div class="alert alert-error mb-4 py-2">
            <lucide-angular [img]="AlertTriangleIcon" class="w-3 h-3" />
            <span class="text-[11px]">{{ errorMessage() }}</span>
          </div>
          }

          <!-- Enable Button -->
          <button
            class="btn btn-warning btn-sm w-full gap-1.5"
            [disabled]="autopilotState.isPending()"
            (click)="enableAutopilot()"
          >
            @if (autopilotState.isPending()) {
            <span class="loading loading-spinner loading-xs"></span>
            } @else {
            <lucide-angular [img]="ZapIcon" class="w-3 h-3" />
            } Enable Autopilot
          </button>
          } @else {
          <!-- Disable Autopilot View -->
          <div class="text-center">
            <div class="flex items-center justify-center gap-2 mb-3">
              <lucide-angular [img]="ZapIcon" class="w-5 h-5 text-warning" />
              <span class="font-medium text-sm">Autopilot is Active</span>
            </div>
            <p class="text-xs text-base-content/70 mb-2">
              Current mode:
              <span class="font-medium">{{ autopilotState.statusText() }}</span>
            </p>
            <p class="text-[11px] text-base-content/50 mb-4">
              Claude is automatically approving actions based on your permission
              level.
            </p>

            <!-- Disable Button -->
            <button
              class="btn btn-ghost btn-sm w-full gap-1.5"
              [disabled]="autopilotState.isPending()"
              (click)="disableAutopilot()"
            >
              @if (autopilotState.isPending()) {
              <span class="loading loading-spinner loading-xs"></span>
              } @else {
              <lucide-angular [img]="ZapOffIcon" class="w-3 h-3" />
              } Disable Autopilot
            </button>
          </div>
          }
        </div>
      </div>
    </ptah-native-popover>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutopilotPopoverComponent {
  readonly autopilotState = inject(AutopilotStateService);
  private readonly keyboardNav = inject(KeyboardNavigationService);

  // Lucide icons
  readonly ZapIcon = Zap;
  readonly ZapOffIcon = ZapOff;
  readonly ChevronDownIcon = ChevronDown;
  readonly AlertTriangleIcon = AlertTriangle;

  // Local state for popover visibility
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  // Keyboard navigation - expose activeIndex for template
  readonly activeIndex = this.keyboardNav.activeIndex;

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

  // Error state for RPC failures
  private readonly _errorMessage = signal<string | null>(null);
  readonly errorMessage = this._errorMessage.asReadonly();

  /**
   * Toggle popover visibility
   */
  togglePopover(): void {
    this._isOpen.set(!this._isOpen());
  }

  /**
   * Close popover (called by PopoverComponent on backdrop click)
   */
  closePopover(): void {
    this._isOpen.set(false);
    // Clear error message when closing
    this._errorMessage.set(null);
  }

  /**
   * Select permission level before enabling autopilot
   * Called by NativeOptionComponent (selected) output with keyboard navigation support
   */
  selectLevel(level: PermissionLevel): void {
    this.selectedLevel.set(level);
  }

  /**
   * Handle hover on option - update active index
   */
  onHover(index: number): void {
    this.keyboardNav.setActiveIndex(index);
  }

  /**
   * Enable autopilot with selected permission level
   */
  async enableAutopilot(): Promise<void> {
    try {
      // Clear any previous errors
      this._errorMessage.set(null);

      // First set the permission level
      await this.autopilotState.setPermissionLevel(this.selectedLevel());
      // Then toggle on
      await this.autopilotState.toggleAutopilot();
      // Only close popover on SUCCESS
      this.closePopover();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to enable autopilot:',
        error
      );
      // Show error to user, keep popover open for retry
      this._errorMessage.set(
        `Failed to enable autopilot: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  /**
   * Disable autopilot
   */
  async disableAutopilot(): Promise<void> {
    try {
      // Clear any previous errors
      this._errorMessage.set(null);

      await this.autopilotState.toggleAutopilot();
      // Only close popover on SUCCESS
      this.closePopover();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to disable autopilot:',
        error
      );
      // Show error to user, keep popover open for retry
      this._errorMessage.set(
        `Failed to disable autopilot: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
}
