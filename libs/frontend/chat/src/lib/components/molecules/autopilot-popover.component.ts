/**
 * AutopilotPopoverComponent - Autopilot Toggle as Bottom Sheet Modal
 *
 * Shows permission level selection in a full-width bottom sheet modal
 * instead of a floating popover, to avoid breaking the narrow sidebar layout.
 *
 * Pattern: Signal-based state from AutopilotStateService
 * UI: Custom bottom sheet with backdrop overlay
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
  X,
} from 'lucide-angular';
import { AutopilotStateService } from '@ptah-extension/core';
import { type PermissionLevel } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-autopilot-popover',
  imports: [LucideAngularModule],
  template: `
    <!-- Trigger Button -->
    <button
      class="btn btn-ghost btn-sm gap-1.5 font-normal"
      type="button"
      (click)="toggleModal()"
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

    <!-- Bottom Sheet Modal -->
    @if (isOpen()) {
    <div class="fixed inset-0 z-50 flex flex-col justify-end">
      <!-- Backdrop -->
      <div class="absolute inset-0 bg-black/60" (click)="closeModal()"></div>

      <!-- Sheet Content -->
      <div class="relative bg-base-200 rounded-t-2xl animate-slide-up">
        <!-- Drag Handle -->
        <div class="flex justify-center pt-2 pb-1">
          <div class="w-10 h-1 rounded-full bg-base-content/20"></div>
        </div>

        <!-- Header -->
        <div class="px-4 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <lucide-angular
              [img]="autopilotState.enabled() ? ZapIcon : ZapOffIcon"
              class="w-4 h-4"
              [class.text-warning]="autopilotState.enabled()"
            />
            <span class="font-semibold text-sm">Autopilot Mode</span>
            @if (autopilotState.enabled()) {
            <span class="badge badge-warning badge-xs">Active</span>
            }
          </div>
          <button
            class="btn btn-ghost btn-xs btn-circle"
            (click)="closeModal()"
            type="button"
          >
            <lucide-angular [img]="XIcon" class="w-3.5 h-3.5" />
          </button>
        </div>

        <!-- Content -->
        <div class="px-4 pb-4">
          @if (!autopilotState.enabled()) {
          <!-- Enable Autopilot View -->
          <p class="text-xs text-base-content/70 mb-3">
            Let Claude auto-approve actions without confirmation.
          </p>

          <!-- Permission Levels -->
          <div class="flex flex-col gap-1.5 mb-3">
            @for (level of permissionLevels; track level.id) {
            <button
              [class]="
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all ' +
                (selectedLevel() === level.id
                  ? level.id === 'yolo'
                    ? 'bg-warning/10 border border-warning/40'
                    : 'bg-primary/10 border border-primary/40'
                  : 'bg-base-300/50 border border-transparent hover:bg-base-300')
              "
              (click)="selectLevel(level.id)"
              type="button"
            >
              <div class="flex flex-col flex-1 min-w-0">
                <span class="font-medium text-xs">{{ level.name }}</span>
                <span class="text-[11px] text-base-content/50">{{
                  level.description
                }}</span>
              </div>
              @if (selectedLevel() === level.id) {
              <div
                class="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
              >
                <div class="w-1.5 h-1.5 rounded-full bg-primary-content"></div>
              </div>
              } @else {
              <div
                class="w-4 h-4 rounded-full border-2 border-base-content/20 flex-shrink-0"
              ></div>
              }
            </button>
            }
          </div>

          <!-- Hint for Full Auto -->
          @if (selectedLevel() === 'yolo') {
          <p class="text-[11px] text-warning/80 mb-3 px-1">
            Skips all permission prompts — best for trusted tasks.
          </p>
          }

          <!-- Info for Plan mode -->
          @if (selectedLevel() === 'plan') {
          <p class="text-[11px] text-info/80 mb-3 px-1">
            Read-only analysis — blocks file modifications and code execution.
          </p>
          }

          <!-- Error Display -->
          @if (errorMessage()) {
          <div class="alert alert-error mb-3 py-2">
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
    </div>
    }
  `,
  styles: `
    @keyframes slide-up {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }
    .animate-slide-up {
      animation: slide-up 0.2s ease-out;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutopilotPopoverComponent {
  readonly autopilotState = inject(AutopilotStateService);

  // Lucide icons
  readonly ZapIcon = Zap;
  readonly ZapOffIcon = ZapOff;
  readonly ChevronDownIcon = ChevronDown;
  readonly XIcon = X;

  // Local state for modal visibility
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  // Permission levels for selector (ordered: Full Auto first as default)
  readonly permissionLevels: {
    id: PermissionLevel;
    name: string;
    description: string;
  }[] = [
    { id: 'yolo', name: 'Full Auto', description: 'All actions auto-approved' },
    { id: 'auto-edit', name: 'Auto-edit', description: 'File edits only' },
    { id: 'plan', name: 'Plan Mode', description: 'Read-only analysis' },
  ];

  // Local state for level selection before enabling (default: Full Auto)
  readonly selectedLevel = signal<PermissionLevel>('yolo');

  // Error state for RPC failures
  private readonly _errorMessage = signal<string | null>(null);
  readonly errorMessage = this._errorMessage.asReadonly();

  toggleModal(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeModal(): void {
    this._isOpen.set(false);
    this._errorMessage.set(null);
  }

  selectLevel(level: PermissionLevel): void {
    this.selectedLevel.set(level);
  }

  async enableAutopilot(): Promise<void> {
    try {
      this._errorMessage.set(null);
      await this.autopilotState.setPermissionLevel(this.selectedLevel());
      await this.autopilotState.toggleAutopilot();
      this.closeModal();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to enable autopilot:',
        error
      );
      this._errorMessage.set(
        `Failed to enable autopilot: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async disableAutopilot(): Promise<void> {
    try {
      this._errorMessage.set(null);
      await this.autopilotState.toggleAutopilot();
      this.closeModal();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to disable autopilot:',
        error
      );
      this._errorMessage.set(
        `Failed to disable autopilot: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }
}
