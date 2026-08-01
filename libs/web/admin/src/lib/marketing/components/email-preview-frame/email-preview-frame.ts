import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Eye } from 'lucide-angular';
import DOMPurify from 'dompurify';
import { EmptyState } from '../../../components/empty-state/empty-state';

/**
 * EmailPreviewFrame — the ONE shared, safe email-HTML preview surface
 * (design spec §4.6). Compose Step 2/3 and the Templates gallery all reuse
 * this component so the sanitization logic lives in exactly one place.
 *
 * Defense in depth — BOTH layers, never either/or:
 *   1. `DOMPurify.sanitize` the `{{var}}`-substituted HTML before it touches the
 *      DOM (forbids script/iframe/object/embed/form tags + `on*` handlers).
 *   2. Render the cleaned markup inside a maximally-restrictive sandboxed
 *      `<iframe [attr.sandbox]="''" [srcdoc]="...">` on a white frame — never
 *      `[innerHTML]` on the host document.
 *
 * The input is admin-authored raw email HTML (a different trust boundary than
 * chat markdown), so this is a small purpose-built sanitize call, not a detour
 * through `libs/frontend/markdown`'s chokepoint.
 */
@Component({
  selector: 'ptah-marketing-email-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState],
  templateUrl: './email-preview-frame.html',
})
export class EmailPreviewFrame {
  private readonly sanitizer = inject(DomSanitizer);

  /** Email subject line — rendered as a mock `Subject:` header. */
  public readonly subject = input<string>('');

  /** Raw, admin-authored email HTML body. */
  public readonly htmlBody = input<string>('');

  /** Sample variables substituted into the preview only (never sent). */
  public readonly sampleVars = input<Record<string, string>>({
    firstName: 'Jordan',
    email: 'jordan@example.com',
    unsubscribeUrl: '#',
  });

  protected readonly EyeIcon = Eye;

  /** Subject with sample variables substituted for display. */
  protected readonly previewSubject = computed<string>(() =>
    substituteVars(this.subject(), this.sampleVars()),
  );

  /** DOMPurify-cleaned body HTML (empty string when there is nothing to show). */
  private readonly cleanBody = computed<string>(() => {
    const raw = this.htmlBody();
    if (!raw || !raw.trim()) return '';
    const substituted = substituteVars(raw, this.sampleVars());
    const clean = DOMPurify.sanitize(substituted, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'],
      // DOMPurify strips event handlers by default; listed explicitly for intent.
      FORBID_ATTR: [
        'onerror',
        'onload',
        'onclick',
        'onmouseover',
        'onfocus',
        'onblur',
        'onsubmit',
      ],
    });
    return clean.trim();
  });

  /** True once there is renderable content — otherwise the empty state shows. */
  protected readonly hasPreview = computed<boolean>(
    () => this.cleanBody().length > 0,
  );

  /**
   * SafeHtml for the iframe `srcdoc`. The body is already DOMPurify-cleaned;
   * `bypassSecurityTrustHtml` stops Angular's own sanitizer from re-stripping it
   * so the preview renders faithfully. The empty `sandbox` attribute guarantees
   * nothing executes regardless.
   */
  protected readonly srcdoc = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.cleanBody()),
  );
}

/**
 * Replace `{{ token }}` occurrences with matching `vars` values. Unknown tokens
 * are left verbatim; only known keys are substituted.
 */
function substituteVars(input: string, vars: Record<string, string>): string {
  if (!input) return '';
  return input.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : match,
  );
}
