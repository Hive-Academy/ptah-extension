import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Zap, ZapOff, ChevronDown } from 'lucide-angular';
import { AutopilotStateService } from '@ptah-extension/core';
import { type PermissionLevel } from '@ptah-extension/shared';
import { NativeDropdownComponent } from '@ptah-extension/ui';

@Component({
  selector: 'ptah-autopilot-popover',
  imports: [LucideAngularModule, NativeDropdownComponent],
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      [closeOnBackdropClick]="true"
      (closed)="closeDropdown()"
      (backdropClicked)="closeDropdown()"
    >
      <!-- Trigger Button -->
      <button
        trigger
        class="btn btn-ghost btn-xs gap-1 font-normal h-6 min-h-0 px-1.5"
        type="button"
        (click)="toggleDropdown()"
        [disabled]="autopilotState.isPending()"
        [class.text-warning]="autopilotState.enabled()"
      >
        @if (autopilotState.isPending()) {
          <span class="loading loading-spinner loading-xs"></span>
        } @else if (autopilotState.enabled()) {
          <lucide-angular [img]="ZapIcon" class="w-3 h-3" />
        } @else {
          <lucide-angular [img]="ZapOffIcon" class="w-3 h-3 opacity-60" />
        }
        <span class="text-[10px]">{{ autopilotState.statusText() }}</span>
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-2.5 h-2.5 opacity-60"
        />
      </button>

      <!-- Dropdown Content -->
      <div content class="w-72 flex flex-col">
        <!-- Header -->
        <div class="px-3 py-2 border-b border-base-300 flex items-center gap-2">
          <lucide-angular
            [img]="autopilotState.enabled() ? ZapIcon : ZapOffIcon"
            class="w-3.5 h-3.5"
            [class.text-warning]="autopilotState.enabled()"
          />
          <span
            class="text-xs font-semibold text-base-content/70 uppercase tracking-wide"
          >
            Autopilot Mode
          </span>
          @if (autopilotState.enabled()) {
            <span class="badge badge-warning badge-xs ml-auto">Active</span>
          }
        </div>

        <!-- Content -->
        <div class="p-2">
          @if (!autopilotState.enabled()) {
            <!-- Permission Levels -->
            <div class="flex flex-col gap-1 mb-2">
              @for (level of permissionLevels; track level.id) {
                <button
                  [class]="
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all ' +
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
                      class="w-3.5 h-3.5 rounded-full bg-primary flex items-center justify-center flex-shrink-0"
                    >
                      <div
                        class="w-1.5 h-1.5 rounded-full bg-primary-content"
                      ></div>
                    </div>
                  } @else {
                    <div
                      class="w-3.5 h-3.5 rounded-full border-2 border-base-content/20 flex-shrink-0"
                    ></div>
                  }
                </button>
              }
            </div>

            @if (selectedLevel() === 'yolo') {
              <p class="text-[11px] text-warning/80 mb-2 px-1">
                Skips all permission prompts — best for trusted tasks.
              </p>
            }
            @if (selectedLevel() === 'plan') {
              <p class="text-[11px] text-info/80 mb-2 px-1">
                Read-only analysis — blocks file modifications and code
                execution.
              </p>
            }

            @if (errorMessage()) {
              <div class="alert alert-error mb-2 py-1.5 px-3">
                <span class="text-[11px]">{{ errorMessage() }}</span>
              </div>
            }

            <button
              class="btn btn-warning btn-xs w-full gap-1.5"
              [disabled]="autopilotState.isPending()"
              (click)="enableAutopilot()"
            >
              @if (autopilotState.isPending()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                <lucide-angular [img]="ZapIcon" class="w-3 h-3" />
              }
              Enable Autopilot
            </button>
          } @else {
            <!-- Active State -->
            <div class="px-2 py-1 mb-2">
              <p class="text-xs text-base-content/70">
                Current mode:
                <span class="font-medium">{{
                  autopilotState.statusText()
                }}</span>
              </p>
              <p class="text-[11px] text-base-content/50 mt-1">
                Claude is automatically approving actions based on your
                permission level.
              </p>
            </div>

            @if (errorMessage()) {
              <div class="alert alert-error mb-2 py-1.5 px-3">
                <span class="text-[11px]">{{ errorMessage() }}</span>
              </div>
            }

            <button
              class="btn btn-ghost btn-xs w-full gap-1.5"
              [disabled]="autopilotState.isPending()"
              (click)="disableAutopilot()"
            >
              @if (autopilotState.isPending()) {
                <span class="loading loading-spinner loading-xs"></span>
              } @else {
                <lucide-angular [img]="ZapOffIcon" class="w-3 h-3" />
              }
              Disable Autopilot
            </button>
          }
        </div>
      </div>
    </ptah-native-dropdown>
  `,
  styles: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AutopilotPopoverComponent {
  readonly autopilotState = inject(AutopilotStateService);

  readonly ZapIcon = Zap;
  readonly ZapOffIcon = ZapOff;
  readonly ChevronDownIcon = ChevronDown;

  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  readonly permissionLevels: {
    id: PermissionLevel;
    name: string;
    description: string;
  }[] = [
    { id: 'yolo', name: 'Full Auto', description: 'All actions auto-approved' },
    { id: 'auto-edit', name: 'Auto-edit', description: 'File edits only' },
    { id: 'plan', name: 'Plan Mode', description: 'Read-only analysis' },
  ];

  readonly selectedLevel = signal<PermissionLevel>('yolo');

  private readonly _errorMessage = signal<string | null>(null);
  readonly errorMessage = this._errorMessage.asReadonly();

  toggleDropdown(): void {
    this._isOpen.set(!this._isOpen());
  }

  closeDropdown(): void {
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
      this.closeDropdown();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to enable autopilot:',
        error,
      );
      this._errorMessage.set(
        `Failed to enable autopilot: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  async disableAutopilot(): Promise<void> {
    try {
      this._errorMessage.set(null);
      await this.autopilotState.toggleAutopilot();
      this.closeDropdown();
    } catch (error) {
      console.error(
        '[AutopilotPopoverComponent] Failed to disable autopilot:',
        error,
      );
      this._errorMessage.set(
        `Failed to disable autopilot: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }
}
