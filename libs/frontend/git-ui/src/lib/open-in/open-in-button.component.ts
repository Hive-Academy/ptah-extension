import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ChevronDown,
  Code2,
  ExternalLink,
  LucideAngularModule,
} from 'lucide-angular';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type { EditorTarget, EditorTargetId } from '@ptah-extension/shared';

export type OpenInButtonMode = 'full' | 'icon-only';

export interface OpenInRequest {
  target: EditorTargetId;
  path?: string;
  line?: number;
  root?: string;
}

const LAST_EDITOR_SETTING_KEY = 'editorLauncher.lastTarget';
const NO_EDITOR_TITLE = 'No supported editor found on this machine';

@Component({
  selector: 'ptah-open-in-button',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="join join-horizontal" data-testid="open-in-button">
      <button
        type="button"
        class="btn btn-ghost btn-xs join-item gap-1"
        data-testid="open-in-primary"
        [class.w-5]="mode() === 'icon-only'"
        [class.h-5]="mode() === 'icon-only'"
        [class.p-0]="mode() === 'icon-only'"
        [class.btn-disabled]="targets().length === 0"
        [disabled]="targets().length === 0"
        [attr.aria-disabled]="targets().length === 0"
        [attr.aria-label]="primaryAriaLabel()"
        [title]="primaryTitle()"
        (click)="onPrimaryClick()"
        (keydown.escape)="menuOpen.set(false)"
      >
        <lucide-angular
          [img]="ExternalLinkIcon"
          class="w-3 h-3"
          aria-hidden="true"
        />
        @if (mode() === 'full') {
          <span>{{ primaryLabel() }}</span>
        }
      </button>

      @if (targets().length > 1) {
        <div
          class="dropdown dropdown-end join-item"
          [class.dropdown-open]="menuOpen()"
        >
          <button
            type="button"
            class="btn btn-ghost btn-xs join-item px-1"
            data-testid="open-in-caret"
            aria-haspopup="menu"
            aria-label="More editors"
            [attr.aria-expanded]="menuOpen()"
            (click)="menuOpen.set(!menuOpen())"
            (keydown.escape)="menuOpen.set(false)"
          >
            <lucide-angular
              [img]="ChevronDownIcon"
              class="w-3 h-3"
              aria-hidden="true"
            />
          </button>
          @if (menuOpen()) {
            <ul
              class="dropdown-content menu menu-xs bg-base-200 rounded-box shadow z-20 min-w-36"
              role="menu"
            >
              @for (target of targets(); track target.id) {
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    [class.menu-active]="selectedTarget()?.id === target.id"
                    (click)="choose(target)"
                  >
                    <lucide-angular
                      [img]="CodeIcon"
                      class="w-3 h-3"
                      aria-hidden="true"
                    />
                    <span>{{ target.displayName }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      }
    </div>
  `,
})
export class OpenInButtonComponent implements OnInit {
  private readonly vscodeService = inject(VSCodeService);

  readonly targets = input.required<readonly EditorTarget[]>();
  readonly remembered = input<string | null>(null);
  readonly mode = input<OpenInButtonMode>('full');
  readonly path = input<string>();
  readonly line = input<number>();
  readonly root = input<string>();
  readonly open = output<OpenInRequest>();

  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly CodeIcon = Code2;
  protected readonly menuOpen = signal(false);
  private readonly storedTargetId = signal<string | null>(null);

  protected readonly selectedTarget = computed(() => {
    const selectedId = this.remembered() ?? this.storedTargetId();
    return this.targets().find(({ id }) => id === selectedId) ?? null;
  });

  private readonly primaryTarget = computed(() => {
    if (this.targets().length === 1) return this.targets()[0];
    return this.selectedTarget();
  });

  protected readonly primaryLabel = computed(() => {
    const target = this.primaryTarget();
    return target ? `Open in ${target.displayName}` : 'Open in…';
  });

  protected readonly primaryAriaLabel = computed(() => {
    const target = this.primaryTarget();
    return target ? `Open in ${target.displayName}` : 'Choose editor';
  });

  protected readonly primaryTitle = computed(() =>
    this.targets().length === 0 ? NO_EDITOR_TITLE : this.primaryAriaLabel(),
  );

  ngOnInit(): void {
    if (this.remembered() !== null) return;
    void this.loadRememberedTarget();
  }

  protected onPrimaryClick(): void {
    const target = this.primaryTarget();
    if (target) {
      this.choose(target);
      return;
    }
    if (this.targets().length > 1) this.menuOpen.set(true);
  }

  protected choose(target: EditorTarget): void {
    this.storedTargetId.set(target.id);
    this.menuOpen.set(false);
    void this.persistTarget(target.id);
    this.open.emit({
      target: target.id,
      ...(this.path() === undefined ? {} : { path: this.path() }),
      ...(this.line() === undefined ? {} : { line: this.line() }),
      ...(this.root() === undefined ? {} : { root: this.root() }),
    });
  }

  private async loadRememberedTarget(): Promise<void> {
    try {
      const result = await rpcCall<{ value?: unknown }>(
        this.vscodeService,
        'settings:get',
        { key: LAST_EDITOR_SETTING_KEY },
      );
      const value = result.data?.value;
      if (result.success && typeof value === 'string') {
        this.storedTargetId.set(value);
      }
    } catch {
      // The unset preference is represented by null; the control remains usable.
    }
  }

  private async persistTarget(target: EditorTargetId): Promise<void> {
    try {
      await rpcCall(this.vscodeService, 'settings:set', {
        key: LAST_EDITOR_SETTING_KEY,
        value: target,
      });
    } catch {
      // Launching is more important than remembering the optional preference.
    }
  }
}
