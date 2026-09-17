import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ChevronDown, ExternalLink, LucideAngularModule } from 'lucide-angular';
import { rpcCall, VSCodeService } from '@ptah-extension/core';
import type { EditorTarget, EditorTargetId } from '@ptah-extension/shared';
import { EditorBrandIconComponent } from './editor-brand-icon.component';

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
  imports: [LucideAngularModule, EditorBrandIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)' },
  template: `
    <div class="join join-horizontal" data-testid="open-in-button">
      <button
        type="button"
        class="btn btn-ghost btn-xs join-item gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        data-testid="open-in-primary"
        [class.w-5]="mode() === 'icon-only'"
        [class.h-5]="mode() === 'icon-only'"
        [class.p-0]="mode() === 'icon-only'"
        [class.btn-disabled]="available().length === 0"
        [disabled]="available().length === 0"
        [attr.aria-disabled]="available().length === 0"
        [attr.aria-label]="primaryAriaLabel()"
        [title]="primaryTitle()"
        (click)="onPrimaryClick()"
        (keydown.escape)="menuOpen.set(false)"
      >
        @if (primaryTarget(); as target) {
          <ptah-editor-brand-icon [target]="target.id" />
        } @else {
          <lucide-angular
            [img]="ExternalLinkIcon"
            class="w-3 h-3"
            aria-hidden="true"
          />
        }
        @if (mode() === 'full') {
          <span>{{ primaryLabel() }}</span>
        }
      </button>

      @if (available().length > 0) {
        <div
          class="dropdown dropdown-end join-item"
          [class.dropdown-open]="menuOpen()"
        >
          <button
            #caret
            type="button"
            class="btn btn-ghost btn-xs join-item px-1"
            data-testid="open-in-caret"
            aria-haspopup="menu"
            aria-label="Choose where to open"
            [attr.aria-expanded]="menuOpen()"
            (click)="menuOpen.set(!menuOpen())"
            (keydown.escape)="closeMenu()"
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
              data-testid="open-in-menu"
            >
              @for (target of available(); track target.id) {
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    [attr.data-target-id]="target.id"
                    [class.menu-active]="selectedTarget()?.id === target.id"
                    (click)="choose(target, $event)"
                    (keydown.escape)="closeMenu()"
                  >
                    <ptah-editor-brand-icon [target]="target.id" />
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
  private readonly vscodeService = inject(VSCodeService, { optional: true });
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly caret = viewChild<ElementRef<HTMLButtonElement>>('caret');

  readonly targets = input.required<readonly EditorTarget[]>();
  readonly remembered = input<string | null>(null);
  readonly mode = input<OpenInButtonMode>('full');
  readonly path = input<string>();
  readonly line = input<number>();
  readonly root = input<string>();
  readonly open = output<OpenInRequest>();

  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly menuOpen = signal(false);
  private readonly storedTargetId = signal<string | null>(null);
  private choiceGeneration = 0;

  /**
   * Targets this control offers. A terminal opens a folder, not a file
   * (`editor:openFile` refuses it), so it is dropped whenever a file path is
   * bound.
   */
  protected readonly available = computed(() =>
    this.path() === undefined
      ? this.targets()
      : this.targets().filter(({ id }) => id !== 'terminal'),
  );

  protected readonly selectedTarget = computed(() => {
    const selectedId = this.remembered() ?? this.storedTargetId();
    return this.available().find(({ id }) => id === selectedId) ?? null;
  });

  protected readonly primaryTarget = computed(() => {
    if (this.available().length === 1) return this.available()[0];
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
    this.available().length === 0 ? NO_EDITOR_TITLE : this.primaryAriaLabel(),
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
    if (this.available().length > 1) this.menuOpen.set(true);
  }

  protected closeMenu(): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    this.caret()?.nativeElement.focus();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (
      this.menuOpen() &&
      event.target instanceof Node &&
      !this.element.nativeElement.contains(event.target)
    )
      this.menuOpen.set(false);
  }

  protected choose(target: EditorTarget, event?: UIEvent): void {
    this.choiceGeneration += 1;
    this.storedTargetId.set(target.id);
    const wasMenuOpen = this.menuOpen();
    this.menuOpen.set(false);
    void this.persistTarget(target.id);
    this.open.emit({
      target: target.id,
      ...(this.path() === undefined ? {} : { path: this.path() }),
      ...(this.line() === undefined ? {} : { line: this.line() }),
      ...(this.root() === undefined ? {} : { root: this.root() }),
    });

    const isMouseClick = Boolean(
      event &&
      (event.detail > 0 ||
        ('pointerType' in event &&
          (event as PointerEvent).pointerType === 'mouse')),
    );
    const isFocusInMenu = this.isFocusInMenu();
    const isKeyboardActivation =
      wasMenuOpen && !isMouseClick && (event?.detail === 0 || isFocusInMenu);

    if (wasMenuOpen && !isMouseClick && isKeyboardActivation) {
      this.caret()?.nativeElement.focus();
    }
  }

  private isFocusInMenu(): boolean {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active) return false;
    const menu = this.element.nativeElement.querySelector(
      '[data-testid="open-in-menu"]',
    );
    return Boolean(menu?.contains(active));
  }

  private async loadRememberedTarget(): Promise<void> {
    if (!this.vscodeService) return;
    const generation = this.choiceGeneration;
    try {
      const result = await rpcCall<{ value?: unknown }>(
        this.vscodeService,
        'settings:get',
        { key: LAST_EDITOR_SETTING_KEY },
      );
      const value = result.data?.value;
      if (
        generation === this.choiceGeneration &&
        result.success &&
        typeof value === 'string'
      ) {
        this.storedTargetId.set(value);
      }
    } catch {
      // The unset preference is represented by null; the control remains usable.
    }
  }

  private async persistTarget(target: EditorTargetId): Promise<void> {
    if (!this.vscodeService) return;
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
