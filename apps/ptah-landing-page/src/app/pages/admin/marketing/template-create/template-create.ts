import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AlertTriangle, LucideAngularModule } from 'lucide-angular';
import {
  AdminApiService,
  MarketingTemplate,
} from '../../../../services/admin-api.service';
import { EmailPreviewFrame } from '../components/email-preview-frame/email-preview-frame';

@Component({
  selector: 'ptah-template-create',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule, EmailPreviewFrame],
  templateUrl: './template-create.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateCreate {
  private readonly adminApi = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);

  protected readonly AlertTriangleIcon = AlertTriangle;

  protected readonly name = signal('');
  protected readonly subject = signal('');
  protected readonly htmlBody = signal('');
  protected readonly variablesRaw = signal('');

  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);

  /** True when arriving via `?duplicateFrom=<id>` — swaps the page header. */
  protected readonly isDuplicate = signal(false);
  protected readonly pageTitle = computed(() =>
    this.isDuplicate() ? 'Duplicate Template' : 'New Template',
  );

  protected readonly parsedVariables = computed(() =>
    this.variablesRaw()
      .split(/[,\n\s]+/)
      .map((v) => v.trim())
      .filter((v) => v.length > 0),
  );

  protected readonly canSubmit = computed(
    () =>
      this.name().trim().length > 0 &&
      this.subject().trim().length > 0 &&
      this.htmlBody().trim().length > 0 &&
      !this.isLoading(),
  );

  public constructor() {
    // `?duplicateFrom=<id>` prefill (spec §6.3): fetch the source template and
    // seed the form with a "(Copy)" name so the admin can save it as a new,
    // uniquely-named record. Server enforces name uniqueness, so a friendly
    // TEMPLATE_NAME_TAKEN rejection already covers the un-renamed case.
    const duplicateFrom =
      this.route.snapshot.queryParamMap.get('duplicateFrom');
    if (duplicateFrom) {
      this.isDuplicate.set(true);
      this.adminApi
        .get<MarketingTemplate>('marketing-campaign-templates', duplicateFrom)
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (t) => {
            this.name.set(`${t.name} (Copy)`);
            this.subject.set(t.subject);
            this.htmlBody.set(t.htmlBody);
            this.variablesRaw.set(t.variables.join(', '));
          },
          error: (err: unknown) => {
            this.error.set(this.friendlyError(err));
          },
        });
    }
  }

  public submit(): void {
    if (!this.canSubmit()) return;

    this.isLoading.set(true);
    this.error.set(null);

    const variables = this.parsedVariables();

    this.adminApi
      .saveTemplate({
        name: this.name().trim(),
        subject: this.subject().trim(),
        htmlBody: this.htmlBody().trim(),
        variables: variables.length > 0 ? variables : undefined,
      })
      .subscribe({
        next: () => {
          this.isLoading.set(false);
          this.router.navigate(['/admin', 'marketing-campaign-templates']);
        },
        error: (err: unknown) => {
          this.isLoading.set(false);
          this.error.set(this.friendlyError(err));
        },
      });
  }

  private friendlyError(err: unknown): string {
    const body = (err as { error?: { code?: string; message?: string } })
      ?.error;
    const code = body?.code ?? body?.message;
    if (code === 'TEMPLATE_NAME_TAKEN') {
      return 'A template with this name already exists. Choose a different name.';
    }
    if (code === 'TEMPLATE_SANITISE_REJECTED') {
      return (
        body?.message ??
        'The HTML contains disallowed tags or attributes and was rejected.'
      );
    }
    return body?.message ?? 'Failed to save template.';
  }
}
