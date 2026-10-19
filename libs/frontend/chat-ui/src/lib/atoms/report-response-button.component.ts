import {
  Component,
  computed,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, Flag } from 'lucide-angular';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { extractMessageText } from './message-text';

/** Recipient of AI-content reports (Microsoft Store policy 11.16). */
export const REPORT_RESPONSE_EMAIL = 'help@ptah.live';
/** Characters of the response quoted in the report, before encoding. */
export const REPORT_EXCERPT_LIMIT = 1000;

const REPORT_SUBJECT = 'Report AI response';

/**
 * ReportResponseButtonComponent - lets the user report an AI response.
 *
 * Complexity Level: 1 (Simple atom)
 *
 * A plain `mailto:` anchor with `target="_blank"`. In Electron the window-open
 * handler hands it to `openExternalSafely`, whose scheme allowlist includes
 * `mailto:`, so the user's mail client opens a draft they review before
 * anything is sent. Nothing leaves the app without that step.
 */
@Component({
  selector: 'ptah-report-response-button',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <a
      [class]="turnActionSize()
        ? 'inline-grid h-7 w-7 place-items-center rounded-md text-base-content-muted hover:bg-base-content/[.08] hover:text-base-content'
        : 'btn btn-xs btn-ghost btn-square'"
      [href]="href()"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Report this response"
      title="Report response"
      data-testid="report-response-button"
    >
      <lucide-angular [img]="FlagIcon" class="w-3.5 h-3.5" aria-hidden="true" />
    </a>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportResponseButtonComponent {
  /** The response being reported */
  readonly message = input.required<ExecutionChatMessage>();
  /** Match the 28 px turn actions; other placements use the small ghost button. */
  readonly turnActionSize = input<boolean>(false);

  readonly FlagIcon = Flag;

  protected readonly href = computed(() => {
    const message = this.message();
    const excerpt = extractMessageText(message).slice(0, REPORT_EXCERPT_LIMIT);
    const lines = [
      'Please describe what is wrong with this response:',
      '',
      '',
      '---',
      `Message ID: ${message.id}`,
      // The message's own time keeps the render pure; the mail client dates the report.
      `Response time: ${new Date(message.timestamp).toISOString()}`,
    ];
    if (excerpt) {
      lines.push('', 'Response excerpt:', excerpt);
    }
    return (
      `mailto:${REPORT_RESPONSE_EMAIL}` +
      `?subject=${encodeURIComponent(REPORT_SUBJECT)}` +
      `&body=${encodeURIComponent(lines.join('\n'))}`
    );
  });
}
