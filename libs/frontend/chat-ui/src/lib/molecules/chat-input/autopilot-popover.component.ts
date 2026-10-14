import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Zap, ZapOff, ChevronDown } from 'lucide-angular';
import { AutopilotStateService } from '@ptah-extension/core';
import { type PermissionLevel, type SessionId } from '@ptah-extension/shared';
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
      <!-- Composer status-line pill (h-6). Colour lives on the icon only. -->
      <button
        trigger
        class="inline-flex items-center gap-1 h-6 px-1.5 rounded-full text-xs font-normal min-w-0 text-base-content-muted hover:text-base-content hover:bg-base-content/5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-base-content/30 disabled:opacity-50 disabled:pointer-events-none"
        [class.bg-base-300]="isOpen()"
        [class.text-base-content]="isOpen()"
        type="button"
        (click)="toggleDropdown()"
        [disabled]="autopilotState.isPending()"
        [attr.aria-expanded]="isOpen()"
        [title]="'Autopilot: ' + tabStatusText()"
      >
        @if (autopilotState.isPending()) {
          <span class="loading loading-spinner loading-xs"></span>
        } @else if (tabEnabled()) {
          <lucide-angular
            [img]="ZapIcon"
            class="w-3.5 h-3.5 flex-shrink-0 text-primary"
          />
        } @else {
          <lucide-angular
            [img]="ZapOffIcon"
            class="w-3.5 h-3.5 flex-shrink-0"
          />
        }
        <span class="ptah-composer-label truncate">{{ tabStatusText() }}</span>
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-3 h-3 flex-shrink-0 opacity-60"
        />
      </button>

      <!-- Dropdown Content -->
      <div content class="w-72 flex flex-col">
        <!-- Header -->
        <div class="px-3 py-2 border-b border-base-300 flex items-center gap-2">
          <lucide-angular
            [img]="tabEnabled() ? ZapIcon : ZapOffIcon"
            class="w-3.5 h-3.5"
            [class.text-primary]="tabEnabled()"
          />
          <span
            class="text-xs font-semibold text-base-content-muted uppercase tracking-wide"
          >
            Autopilot Mode
          </span>
          @if (tabEnabled()) {
            <span class="badge badge-primary badge-outline badge-xs ml-auto"
              >Active</span
            >
          }
        </div>

        <!-- Content -->
        <div class="p-2">
          @if (!tabEnabled()) {
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
                    <span class="text-[11px] text-base-content-muted">{{
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
              class="btn btn-primary btn-xs w-full gap-1.5"
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
              <p class="text-xs text-base-content-muted">
                Current mode:
                <span class="font-medium">{{ tabStatusText() }}</span>
              </p>
              <p class="text-[11px] text-base-content-muted mt-1">
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

  /**
   * SDK session id of the tab this composer belongs to, or null while the tab
   * has no live session. Sent with every toggle so the backend re-gates THIS
   * session; with null it saves the default and re-gates no live session.
   */
  readonly sessionId = input<SessionId | null>(null);

  /**
   * What this tab shows (TASK_2026_660): its own session's live level, or the
   * saved default while the tab has no session. A toggle in another tab
   * changes only that tab's session, so the default is not this tab's level.
   */
  private readonly tabState = computed(() =>
    this.autopilotState.stateFor(this.sessionId()),
  );
  readonly tabEnabled = computed(() => this.tabState().enabled);
  readonly tabStatusText = computed(() =>
    this.autopilotState.statusTextFor(this.tabState()),
  );

  constructor() {
    // Read the tab's live level whenever the tab gets (or switches) session.
    effect(() => {
      const sessionId = this.sessionId();
      if (sessionId) untracked(() => this.refreshTabSession(sessionId));
    });
  }

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
    const opening = !this._isOpen();
    this._isOpen.set(opening);
    // The level can change outside this popover (e.g. a CLI toggle); re-read
    // it when the user is about to act on it.
    const sessionId = this.sessionId();
    if (opening && sessionId) this.refreshTabSession(sessionId);
  }

  private refreshTabSession(sessionId: SessionId): void {
    // A failed read keeps the last known state; nothing to surface.
    this.autopilotState.refreshSession(sessionId).catch(() => undefined);
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
      const sessionId = this.sessionId();
      await this.autopilotState.setPermissionLevel(
        this.selectedLevel(),
        sessionId,
      );
      await this.autopilotState.toggleAutopilot(sessionId);
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
      await this.autopilotState.toggleAutopilot(this.sessionId());
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
