import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import {
  AdminApiService,
  AdminModelKey,
} from '../../../services/admin-api.service';
import {
  ADMIN_MODEL_SPECS,
  AdminModelSpec,
  FieldSpec,
} from '../admin-models.config';
import { DeleteUserModalComponent } from '../components/delete-user-modal/delete-user-modal';

/**
 * AdminDetail — generic show/edit page for a single admin record.
 *
 * Route: `/admin/:model/:id`. Fetches the record via
 * `AdminApiService.get(model, id)`, renders ALL fields from the spec in a
 * two-column read view, and — when `spec.readOnly === false` — renders an
 * edit form containing ONLY the fields marked `editable: true`.
 *
 * Edit field widgets are driven by `FieldType`:
 *   - string  → text input
 *   - number  → number input
 *   - boolean → checkbox
 *   - datetime → datetime-local input (ISO ↔ local conversion)
 *   - uuid / json → treated as string (uuid/json are never editable anyway)
 *
 * Submit collects a patch of changed keys and PATCHes them to the backend.
 * Success shows an inline toast and navigates back to the list; failure
 * shows an inline alert and keeps the form open.
 *
 * Angular 21: standalone, OnPush, signals, inject(), no FormsModule.
 */
@Component({
  selector: 'ptah-admin-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DeleteUserModalComponent],
  templateUrl: './admin-detail.html',
  styleUrls: ['./admin-detail.css'],
})
export class AdminDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);

  protected readonly deleteUserModal = viewChild(DeleteUserModalComponent);

  // --- Route params --------------------------------------------------------

  private readonly paramMap = toSignal(this.route.paramMap, {
    initialValue: null,
  });

  protected readonly model = computed<string | null>(
    () => this.paramMap()?.get('model') ?? null,
  );

  protected readonly id = computed<string | null>(
    () => this.paramMap()?.get('id') ?? null,
  );

  protected readonly spec = computed<AdminModelSpec | undefined>(() => {
    const key = this.model();
    if (!key) return undefined;
    return ADMIN_MODEL_SPECS.find((s) => s.key === key);
  });

  private readonly modelKey = computed<AdminModelKey | undefined>(() => {
    const s = this.spec();
    return s ? (s.key as AdminModelKey) : undefined;
  });

  // --- Record state --------------------------------------------------------

  protected readonly record = signal<Record<string, unknown> | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadError = signal<string | null>(null);

  /** Working copy for edits — keyed by field `key`. */
  protected readonly formValues = signal<Record<string, unknown>>({});

  protected readonly saving = signal<boolean>(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly savedAt = signal<number | null>(null);

  /** Fields rendered in the edit form (only `editable: true`). */
  protected readonly editableFields = computed<FieldSpec[]>(() => {
    const s = this.spec();
    if (!s || s.readOnly) return [];
    return s.fields.filter((f) => f.editable === true);
  });

  public constructor() {
    // Fetch when (model, id) changes.
    effect(() => {
      const key = this.modelKey();
      const id = this.id();
      if (!key || !id) {
        this.record.set(null);
        return;
      }
      this.loadRecord(key, id);
    });
  }

  // --- Data loading --------------------------------------------------------

  private loadRecord(model: AdminModelKey, id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.record.set(null);
    this.formValues.set({});
    this.saveError.set(null);
    this.savedAt.set(null);

    this.api.get(model, id).subscribe({
      next: (rec) => {
        this.loading.set(false);
        this.record.set(rec);
        this.seedFormValues(rec);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.loadError.set(
          this.extractErrorMessage(err, 'Failed to load record.'),
        );
      },
    });
  }

  /** Populate form values from the server record, converting datetime to local. */
  private seedFormValues(rec: Record<string, unknown>): void {
    const fields = this.editableFields();
    const seed: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = rec[f.key];
      seed[f.key] = this.toFormValue(f, raw);
    }
    this.formValues.set(seed);
  }

  /** Convert server value → form input value (ISO → local datetime, etc). */
  private toFormValue(field: FieldSpec, raw: unknown): unknown {
    if (raw == null) return field.type === 'boolean' ? false : '';
    if (field.type === 'datetime') {
      if (typeof raw !== 'string' && !(raw instanceof Date)) return '';
      const d = raw instanceof Date ? raw : new Date(raw);
      if (isNaN(d.getTime())) return '';
      // yyyy-MM-ddTHH:mm in LOCAL time — what datetime-local expects.
      const pad = (n: number) => String(n).padStart(2, '0');
      return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`
      );
    }
    if (field.type === 'boolean') return Boolean(raw);
    if (field.type === 'number')
      return typeof raw === 'number' ? raw : Number(raw);
    return String(raw);
  }

  // --- Form input handlers -------------------------------------------------

  protected onFieldInput(field: FieldSpec, event: Event): void {
    const target = event.target as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    if (!target) return;

    let value: unknown;
    if (field.type === 'boolean') {
      value = (target as HTMLInputElement).checked;
    } else if (field.type === 'number') {
      const v = (target as HTMLInputElement).value;
      value = v === '' ? null : Number(v);
    } else {
      value = target.value;
    }

    this.formValues.update((prev) => ({ ...prev, [field.key]: value }));
  }

  /** True for the given field when the form value differs from the record. */
  protected isDirty(field: FieldSpec): boolean {
    const rec = this.record();
    if (!rec) return false;
    const current = this.formValues()[field.key];
    const original = this.toFormValue(field, rec[field.key]);
    return !Object.is(current, original);
  }

  protected onSave(event: Event): void {
    event.preventDefault();
    const key = this.modelKey();
    const id = this.id();
    const rec = this.record();
    if (!key || !id || !rec) return;

    const dirty = this.buildDirtyPatch();
    if (Object.keys(dirty).length === 0) {
      this.saveError.set('No changes to save.');
      return;
    }

    this.saving.set(true);
    this.saveError.set(null);

    this.api.update(key, id, dirty).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.record.set(updated);
        this.seedFormValues(updated);
        this.savedAt.set(Date.now());
        // Navigate back to the list after a short delay so the user sees
        // the success toast.
        setTimeout(() => {
          if (this.savedAt() !== null) this.navigateBack();
        }, 700);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(
          this.extractErrorMessage(err, 'Failed to save changes.'),
        );
      },
    });
  }

  protected onCancel(): void {
    this.navigateBack();
  }

  protected onUserDeleted(): void {
    this.navigateBack();
  }

  protected navigateBack(): void {
    const key = this.modelKey();
    if (!key) return;
    this.router.navigate(['/admin', key]);
  }

  // --- Render helpers (exposed to template) --------------------------------

  /** String rendering for read-only cells. */
  protected renderRead(field: FieldSpec, value: unknown): string {
    if (value == null || value === '') return '—';
    if (field.type === 'boolean') return value ? 'Yes' : 'No';
    if (field.type === 'json') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    if (field.type === 'datetime') {
      // DatePipe is used directly in the template for datetime — this
      // fallback covers programmatic calls.
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }
    return String(value);
  }

  /** For template: coerce formValues()[key] to string for input bindings. */
  protected stringValue(field: FieldSpec): string {
    const v = this.formValues()[field.key];
    if (v == null) return '';
    return String(v);
  }

  /** For template: coerce formValues()[key] to boolean for checkbox bindings. */
  protected boolValue(field: FieldSpec): boolean {
    return Boolean(this.formValues()[field.key]);
  }

  // --- Private helpers -----------------------------------------------------

  private buildDirtyPatch(): Record<string, unknown> {
    const fields = this.editableFields();
    const patch: Record<string, unknown> = {};
    for (const f of fields) {
      if (!this.isDirty(f)) continue;
      const v = this.formValues()[f.key];
      patch[f.key] = this.toApiValue(f, v);
    }
    return patch;
  }

  /** Form value → API payload (local datetime → ISO string, etc). */
  private toApiValue(field: FieldSpec, value: unknown): unknown {
    if (field.type === 'datetime') {
      if (typeof value !== 'string' || value.trim() === '') return null;
      const d = new Date(value);
      return isNaN(d.getTime()) ? value : d.toISOString();
    }
    if (field.type === 'boolean') return Boolean(value);
    if (field.type === 'number') {
      if (value === '' || value == null) return null;
      return typeof value === 'number' ? value : Number(value);
    }
    return value;
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as {
        error?: { message?: string | string[] };
        message?: string;
      };
      const inner = anyErr.error?.message;
      if (Array.isArray(inner)) return inner.join(', ');
      if (typeof inner === 'string') return inner;
      if (anyErr.message) return anyErr.message;
    }
    return fallback;
  }
}
