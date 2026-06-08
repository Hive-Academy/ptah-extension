import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../../../services/admin-api.service';

@Component({
  selector: 'ptah-template-create',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './template-create.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemplateCreate {
  private readonly adminApi = inject(AdminApiService);
  protected readonly router = inject(Router);

  protected readonly name = signal('');
  protected readonly subject = signal('');
  protected readonly htmlBody = signal('');
  protected readonly variablesRaw = signal('');

  protected readonly isLoading = signal(false);
  protected readonly error = signal<string | null>(null);

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
