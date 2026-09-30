import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
} from '@angular/core';
import {
  I18nService,
  LANG_DIRECTION,
  LANG_NATIVE_NAME,
  SUPPORTED_LANGS,
  TranslocoPipe,
  type SupportedLang,
} from '@ptah-extension/i18n';
import { Check, LucideAngularModule } from 'lucide-angular';

/**
 * LanguageSwitch — the panel skin of the language switcher (design-spec §2.4,
 * §2.5, §2.6): a two-option segmented `radiogroup` in the shared panel header.
 *
 * ⚠️ NOT EXPORTED FROM THE BARREL. `PanelLayout` is its only renderer, so both
 * shells get the same control from the one header they share, and neither can
 * place a second copy in its own `[panelTopBar]` projection.
 *
 * It owns no state: the active language, its direction and the persisted
 * choice all belong to {@link I18nService}, the same way `MemberThemeToggle`
 * defers to `MemberThemeService`.
 *
 * Accessibility:
 * - A real APG radio group. Roving `tabIndex` (0 on the checked radio, -1 on
 *   the other) makes the group one tab stop that lands on the selection.
 * - Left/Right follow the active direction: in RTL, ArrowRight moves toward
 *   reading-start. Up/Down are direction-independent (Down = next). Moving
 *   selects, as the pattern requires; Space/Enter on a focused radio applies it
 *   too, through the native button click.
 * - The visible caption is the compact code (`EN`/`AR`); the `aria-label`
 *   starts with that exact code (WCAG 2.5.3, Label in Name) and ends with the
 *   language's own name. Each option carries its own `lang`/`dir`.
 * - The check icon on the selected option carries the state beside the fill,
 *   because `primary` on the light theme's white header is only 2.04:1 as a
 *   shape boundary (design-spec §2.5a). The focus ring uses `base-content`
 *   (>= 13:1 on every panel theme), never amber (1.68:1 on the light theme).
 */
@Component({
  selector: 'ptah-language-switch',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, LucideAngularModule, TranslocoPipe],
  template: `
    <div
      role="radiogroup"
      [attr.aria-label]="'ui.common.language' | transloco"
      class="inline-flex rounded-lg border border-hairline bg-base-200 p-0.5"
      (keydown)="onGroupKeydown($event)"
    >
      @for (lang of languages; track lang) {
        <button
          type="button"
          role="radio"
          [attr.data-lang]="lang"
          [attr.lang]="lang"
          [attr.dir]="LANG_DIRECTION[lang]"
          [attr.aria-checked]="i18n.lang() === lang"
          [attr.aria-label]="
            code(lang) +
            ' — ' +
            ('ui.common.language' | transloco) +
            ': ' +
            LANG_NATIVE_NAME[lang]
          "
          [tabIndex]="i18n.lang() === lang ? 0 : -1"
          class="btn btn-sm gap-1 rounded-md border-0 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          [ngClass]="
            i18n.lang() === lang
              ? 'btn-primary'
              : 'btn-ghost text-base-content-muted hover:bg-surface-high hover:text-base-content'
          "
          (click)="apply(lang)"
        >
          {{ code(lang) }}
          @if (i18n.lang() === lang) {
            <lucide-angular
              [img]="CheckIcon"
              class="h-3 w-3"
              aria-hidden="true"
            />
          }
        </button>
      }
    </div>
  `,
})
export class LanguageSwitch {
  protected readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly languages = SUPPORTED_LANGS;
  protected readonly LANG_DIRECTION = LANG_DIRECTION;
  protected readonly LANG_NATIVE_NAME = LANG_NATIVE_NAME;
  protected readonly CheckIcon = Check;

  /** The visible caption: the language code, never translated. */
  protected code(lang: SupportedLang): string {
    return lang.toUpperCase();
  }

  /**
   * Switch to `lang`. A failed switch leaves the active language, and so
   * `aria-checked` and the roving `tabIndex`, where they were. Focus that an
   * arrow key (or a click) moved onto the option that did not apply is
   * returned to the still-checked radio, so the group's one tab stop and the
   * focused element agree again. `I18nService.setLanguage` resolves `false`
   * on a load failure; a rejection is caught here as well, so it can never
   * surface as an unhandled rejection from a click or key handler.
   */
  protected async apply(lang: SupportedLang): Promise<void> {
    let applied = false;
    try {
      applied = await this.i18n.setLanguage(lang);
    } catch (error) {
      // degradation-audit: reported - logged here; the switch keeps showing
      // the language that is actually active and focus returns to it.
      console.error(`[panel-ui] Could not switch to "${lang}".`, error);
    }
    if (!applied) this.restoreFocus();
  }

  /** APG radio-group arrows; Left/Right swap meaning under `rtl`. */
  protected onGroupKeydown(event: KeyboardEvent): void {
    const delta = this.arrowDelta(event.key);
    if (delta === 0) return;
    event.preventDefault();

    const current = this.languages.indexOf(this.i18n.lang());
    const count = this.languages.length;
    const next = this.languages[(current + delta + count) % count];
    this.focusRadio(next);
    void this.apply(next);
  }

  private arrowDelta(key: string): number {
    const isRtl = this.i18n.direction() === 'rtl';
    switch (key) {
      case 'ArrowRight':
        return isRtl ? -1 : 1;
      case 'ArrowLeft':
        return isRtl ? 1 : -1;
      case 'ArrowDown':
        return 1;
      case 'ArrowUp':
        return -1;
      default:
        return 0;
    }
  }

  private focusRadio(lang: SupportedLang): void {
    this.host.nativeElement
      .querySelector<HTMLElement>(`[role="radio"][data-lang="${lang}"]`)
      ?.focus();
  }

  /** Only when focus is still inside the group: never steal it from elsewhere. */
  private restoreFocus(): void {
    const host = this.host.nativeElement;
    if (host.contains(host.ownerDocument.activeElement)) {
      this.focusRadio(this.i18n.lang());
    }
  }
}
