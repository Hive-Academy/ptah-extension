import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
  computed,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  LucideAngularModule,
  FlaskConical,
  Eye,
  SendHorizontal,
} from 'lucide-angular';
import {
  AdminApiService,
  MarketingSegmentKey,
  MarketingSegmentsResponse,
  MarketingTemplate,
  SendCampaignRequest,
} from '../../services/admin-api.service';
import { AuthService } from '@ptah-web/core';
import { SegmentPicker } from '../../components/segment-picker/segment-picker';
import { TemplatePicker } from '../../components/template-picker/template-picker';
import { StatTile } from '../../components/stat-tile/stat-tile';
import { EmptyState } from '../../components/empty-state/empty-state';
import { EmailPreviewFrame } from '../components/email-preview-frame/email-preview-frame';
import { SEGMENT_LABELS, segmentLabel } from '../marketing-segment-labels';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

/**
 * Recipient count above which the send requires an extra type-to-confirm gate
 * (design spec §4.4). Small explicit-ID and single-recipient test sends never
 * hit it; a mass audience must be typed out exactly before Send unlocks.
 */
const MASS_SEND_THRESHOLD = 100;

/** Lock-out window (ms) applied after a test-send to prevent double-sends. */
const TEST_SEND_LOCKOUT_MS = 5000;

@Component({
  selector: 'ptah-marketing-compose',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    SegmentPicker,
    TemplatePicker,
    StatTile,
    EmptyState,
    EmailPreviewFrame,
  ],
  templateUrl: './marketing-compose.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketingCompose {
  private readonly adminApi = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly router = inject(Router);

  // ── Icons ────────────────────────────────────────────────────────────────
  protected readonly FlaskConicalIcon = FlaskConical;
  protected readonly EyeIcon = Eye;
  protected readonly SendHorizontalIcon = SendHorizontal;

  // ── Existing field signals (unchanged) ────────────────────────────────────
  protected readonly name = signal('');
  protected readonly templateId = signal<string | null>(null);
  protected readonly subject = signal('');
  protected readonly htmlBody = signal('');
  protected readonly segment = signal<MarketingSegmentKey | null>(null);
  protected readonly useExplicitUserIds = signal(false);
  protected readonly userIdsRaw = signal('');

  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);

  // ── Step state (new) ───────────────────────────────────────────────────────
  protected readonly currentStep = signal<1 | 2 | 3>(1);

  // ── Confirmation gate (new, step 3) ────────────────────────────────────────
  protected readonly confirmed = signal(false);
  protected readonly typedCount = signal('');
  protected readonly showReviewPreview = signal(false);

  // ── Test-send (new, step 2) ────────────────────────────────────────────────
  protected readonly isTestSending = signal(false);
  protected readonly testSendMessage = signal<string | null>(null);
  protected readonly testSendError = signal<string | null>(null);

  // ── Resolved template (for the live preview when a template is picked) ─────
  private readonly resolvedTemplate = signal<MarketingTemplate | null>(null);

  protected readonly segments = toSignal<MarketingSegmentsResponse | null>(
    this.adminApi.getMarketingSegments(),
    { initialValue: null },
  );

  public constructor() {
    // Query-param prefill (design spec §4.2 / §4.3): ?segment= and ?templateId=.
    const params = this.route.snapshot.queryParamMap;
    const segParam = params.get('segment');
    if (segParam && segParam in SEGMENT_LABELS) {
      this.segment.set(segParam as MarketingSegmentKey);
    }
    const tplParam = params.get('templateId');
    if (tplParam) {
      this.templateId.set(tplParam);
    }

    // Resolve the picked template's subject/body for the live preview without a
    // second fetch per keystroke — react to templateId changes only.
    effect(() => {
      const id = this.templateId();
      const current = untracked(() => this.resolvedTemplate());
      if (!id) {
        if (current) this.resolvedTemplate.set(null);
        return;
      }
      if (current?.id === id) return;
      this.adminApi
        .get<MarketingTemplate>('marketing-campaign-templates', id)
        .subscribe({
          next: (tpl) => this.resolvedTemplate.set(tpl),
          error: () => this.resolvedTemplate.set(null),
        });
    });
  }

  // ── Existing computeds (unchanged) ─────────────────────────────────────────
  protected readonly parsedUserIds = computed(() => {
    return this.userIdsRaw()
      .split(/[,\n\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  });

  protected readonly recipientCountPreview = computed(() => {
    if (this.useExplicitUserIds()) {
      return this.parsedUserIds().length;
    }
    const seg = this.segment();
    const segs = this.segments();
    if (seg && segs) {
      return segs[seg].optedIn;
    }
    return 0;
  });

  protected readonly totalRecipientPreview = computed(() => {
    if (this.useExplicitUserIds()) {
      return this.parsedUserIds().length;
    }
    const seg = this.segment();
    const segs = this.segments();
    if (seg && segs) {
      return segs[seg].total;
    }
    return 0;
  });

  /**
   * Hard cap on the campaign-name input — 93, not 100.
   *
   * `SendCampaignDto.name` is `@Length(1, 100)` server-side, and `sendTest()`
   * below posts `` `${this.name()} (test)` `` — SEVEN characters longer than
   * what the operator typed. With a 100-char client cap an admin who used
   * 94-100 characters would get the worst possible outcome: the REAL send
   * succeeds and the TEST send 400s, i.e. the safety rehearsal is the only
   * thing that fails. 100 - ' (test)'.length = 93 keeps both paths inside the
   * server's limit.
   *
   * 🔴 The DTO is right and the caller was wrong. Do NOT raise the server's
   * `@Length(1, 100)` to make a longer name fit (TASK_2026_170 §3.16).
   *
   * Related headroom note: `bulk-email-modal.ts` builds
   * `` `Bulk Email: ${subject.substring(0, 80) || 'Untitled'}` `` = 12 + ≤80 =
   * ≤92 chars, so it clears the same 100-char cap with 8 characters to spare.
   */
  private static readonly MAX_NAME_LENGTH = 93;

  /**
   * Single write path for `name`, so the cap survives paste, autofill and any
   * programmatic set — `maxlength` on the input alone only covers typing.
   */
  protected setName(value: string): void {
    this.name.set(value.slice(0, MarketingCompose.MAX_NAME_LENGTH));
  }

  // ── Per-step completeness (reuses canSubmit's existing sub-conditions) ─────
  protected readonly hasName = computed(() => this.name().trim().length > 0);

  protected readonly hasContent = computed(
    () =>
      this.templateId() !== null ||
      (this.subject().trim().length > 0 && this.htmlBody().trim().length > 0),
  );

  protected readonly hasRecipients = computed(
    () =>
      this.segment() !== null ||
      (this.useExplicitUserIds() && this.parsedUserIds().length > 0),
  );

  /** Step 1 (Audience) is complete once a name and a recipient set are chosen. */
  protected readonly step1Complete = computed(
    () => this.hasName() && this.hasRecipients(),
  );

  /** Step 2 (Content) is complete once resolvable content exists. */
  protected readonly step2Complete = computed(() => this.hasContent());

  // ── Confirmation-gate derivations (design spec §4.4) ───────────────────────
  protected readonly needsTypeConfirm = computed(
    () => this.recipientCountPreview() > MASS_SEND_THRESHOLD,
  );

  protected readonly confirmationSatisfied = computed(() => {
    if (!this.confirmed()) return false;
    if (!this.needsTypeConfirm()) return true;
    return this.typedCount().trim() === String(this.recipientCountPreview());
  });

  protected readonly canSubmit = computed(
    () =>
      this.step1Complete() &&
      this.step2Complete() &&
      this.confirmationSatisfied() &&
      !this.isLoading(),
  );

  /** Test-send is available whenever a name + resolvable content exist. */
  protected readonly canTestSend = computed(
    () => this.hasName() && this.hasContent() && !this.isTestSending(),
  );

  // ── Preview resolution (inline signals OR the picked template) ─────────────
  protected readonly previewSubject = computed(() => {
    const tpl = this.resolvedTemplate();
    if (this.templateId() && tpl) return tpl.subject;
    return this.subject();
  });

  protected readonly previewHtml = computed(() => {
    const tpl = this.resolvedTemplate();
    if (this.templateId() && tpl) return tpl.htmlBody;
    return this.htmlBody();
  });

  // ── Step 3 summary helpers ─────────────────────────────────────────────────
  protected readonly audienceSummary = computed(() => {
    if (this.useExplicitUserIds()) {
      return `Explicit list — ${this.parsedUserIds().length} recipients`;
    }
    const seg = this.segment();
    if (!seg) return '—';
    return `${segmentLabel(seg)} · ${this.recipientCountPreview()} of ${this.totalRecipientPreview()} opted-in`;
  });

  protected readonly contentSummary = computed(() => {
    const tpl = this.resolvedTemplate();
    if (this.templateId() && tpl) return `Template: ${tpl.name}`;
    if (this.templateId()) return 'Selected template';
    return `Inline content — ${this.subject() || '(no subject)'}`;
  });

  // ── Step navigation ────────────────────────────────────────────────────────
  protected goToStep(target: number): void {
    const step = target as 1 | 2 | 3;
    const cur = this.currentStep();
    if (step === cur) return;
    // Backward navigation is always allowed (no re-validation).
    if (step < cur) {
      this.currentStep.set(step);
      return;
    }
    // Forward navigation is gated by prior-step completeness.
    if (step === 2 && this.step1Complete()) this.currentStep.set(2);
    if (step === 3 && this.step1Complete() && this.step2Complete()) {
      this.currentStep.set(3);
    }
  }

  protected next(): void {
    const cur = this.currentStep();
    if (cur === 1 && this.step1Complete()) this.currentStep.set(2);
    else if (cur === 2 && this.step2Complete()) this.currentStep.set(3);
  }

  protected back(): void {
    const cur = this.currentStep();
    if (cur > 1) this.currentStep.set((cur - 1) as 1 | 2 | 3);
  }

  /** Sync the review preview disclosure state with the native `<details>`. */
  protected onReviewToggle(event: Event): void {
    this.showReviewPreview.set((event.target as HTMLDetailsElement).open);
  }

  // ── Test-send-to-self (design spec §4.5) ───────────────────────────────────
  protected sendTest(): void {
    if (!this.canTestSend()) return;
    this.isTestSending.set(true);
    this.testSendMessage.set(null);
    this.testSendError.set(null);

    this.auth.getCurrentUser().subscribe({
      next: (user) => {
        if (!user) {
          this.testSendError.set('Could not resolve your admin account.');
          this.unlockTestSend();
          return;
        }
        const payload: SendCampaignRequest = {
          name: `${this.name()} (test)`,
          templateId: this.templateId() ?? undefined,
          subject: this.templateId() ? undefined : this.subject(),
          htmlBody: this.templateId() ? undefined : this.htmlBody(),
          userIds: [user.id],
        };
        this.adminApi.sendCampaign(payload).subscribe({
          next: () => {
            this.testSendMessage.set(`Test sent to ${user.email}`);
            this.unlockTestSend();
          },
          error: (err) => {
            this.testSendError.set(
              err?.error?.message || 'Failed to send test email',
            );
            this.unlockTestSend();
          },
        });
      },
      error: () => {
        this.testSendError.set('Could not resolve your admin account.');
        this.unlockTestSend();
      },
    });
  }

  /** Keep the button locked for the debounce window, then re-enable it. */
  private unlockTestSend(): void {
    const handle = setTimeout(
      () => this.isTestSending.set(false),
      TEST_SEND_LOCKOUT_MS,
    );
    this.destroyRef.onDestroy(() => clearTimeout(handle));
  }

  // ── Submit (unchanged send logic) ──────────────────────────────────────────
  public submit(): void {
    if (!this.canSubmit()) return;

    this.isLoading.set(true);
    this.error.set(null);

    const payload = {
      name: this.name(),
      templateId: this.templateId() ?? undefined,
      subject: this.templateId() ? undefined : this.subject(),
      htmlBody: this.templateId() ? undefined : this.htmlBody(),
      segment: this.useExplicitUserIds()
        ? undefined
        : (this.segment() ?? undefined),
      userIds: this.useExplicitUserIds() ? this.parsedUserIds() : undefined,
    };

    this.adminApi.sendCampaign(payload).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigate(['/admin/marketing-campaigns']);
      },
      error: (err) => {
        this.isLoading.set(false);
        this.error.set(err.error?.message || 'Failed to send campaign');
      },
    });
  }
}
