import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import {
  Copy,
  Eye,
  FileText,
  LucideAngularModule,
  Plus,
  SendHorizontal,
} from 'lucide-angular';
import { catchError, combineLatest, of, switchMap } from 'rxjs';

import {
  AdminApiService,
  AdminListQuery,
  AdminListResponse,
  MarketingTemplate,
} from '../../services/admin-api.service';
import { DetailDrawer } from '@ptah-web/panel-ui';
import { EmptyState } from '@ptah-web/panel-ui';
import { EmailPreviewFrame } from '../components/email-preview-frame/email-preview-frame';

/** Max variable chips rendered before collapsing the remainder into "+N more". */
const VISIBLE_VARIABLE_CHIPS = 4;

/**
 * TemplatesGallery — bespoke card grid for `/admin/marketing-campaign-templates`
 * (design spec §6.1), replacing the generic `AdminList` table.
 *
 * Templates are visual artifacts (subject + rendered HTML), so a preview-first
 * card layout serves them better than a data-table row. Each card carries the
 * name/subject/variable chips + a four-action row: Preview (opens the shared,
 * sandboxed `EmailPreviewFrame` in a `DetailDrawer` shell — never `[innerHTML]`),
 * Duplicate / Use-in-campaign (client-side query-param handoffs), and Edit
 * (lands on the UNCHANGED generic `AdminDetail` edit form).
 *
 * No delete action — `AdminApiService` exposes no generic delete today, so
 * template deletion is intentionally out of scope (spec §6.1).
 */
@Component({
  selector: 'ptah-marketing-templates-gallery',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LucideAngularModule,
    EmptyState,
    DetailDrawer,
    EmailPreviewFrame,
  ],
  templateUrl: './templates-gallery.html',
})
export class TemplatesGallery {
  private readonly api = inject(AdminApiService);

  protected readonly EyeIcon = Eye;
  protected readonly CopyIcon = Copy;
  protected readonly SendHorizontalIcon = SendHorizontal;
  protected readonly FileTextIcon = FileText;
  protected readonly PlusIcon = Plus;

  protected readonly page = signal<number>(1);
  protected readonly pageSize = 12;
  private readonly refreshTick = signal<number>(0);
  protected readonly loadError = signal<string | null>(null);

  /** Template currently shown in the preview drawer (null = closed). */
  protected readonly preview = signal<MarketingTemplate | null>(null);
  protected readonly previewOpen = computed<boolean>(
    () => this.preview() !== null,
  );

  private readonly response$ = combineLatest([
    toObservable(this.page),
    toObservable(this.refreshTick),
  ]).pipe(
    switchMap(([page]) => {
      const q: AdminListQuery = {
        page,
        pageSize: this.pageSize,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      };
      this.loadError.set(null);
      return this.api
        .list<MarketingTemplate>('marketing-campaign-templates', q)
        .pipe(
          catchError((err: unknown) => {
            this.loadError.set(extractError(err));
            return of<AdminListResponse<MarketingTemplate> | null>(null);
          }),
        );
    }),
  );

  protected readonly response =
    toSignal<AdminListResponse<MarketingTemplate> | null>(this.response$, {
      initialValue: null,
    });

  protected readonly loading = computed<boolean>(
    () => this.response() === null && this.loadError() === null,
  );
  protected readonly templates = computed<readonly MarketingTemplate[]>(
    () => this.response()?.data ?? [],
  );
  protected readonly total = computed<number>(
    () => this.response()?.total ?? 0,
  );
  protected readonly totalPages = computed<number>(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize)),
  );
  protected readonly isEmpty = computed<boolean>(
    () =>
      !this.loading() &&
      this.loadError() === null &&
      this.templates().length === 0,
  );

  protected readonly skeletonCards = Array.from({ length: 6 });

  protected readonly previewSubject = computed<string>(
    () => this.preview()?.subject ?? '',
  );
  protected readonly previewBody = computed<string>(
    () => this.preview()?.htmlBody ?? '',
  );
  protected readonly previewTitle = computed<string>(
    () => this.preview()?.name ?? 'Template preview',
  );

  protected visibleChips(t: MarketingTemplate): readonly string[] {
    return t.variables.slice(0, VISIBLE_VARIABLE_CHIPS);
  }

  protected extraChipCount(t: MarketingTemplate): number {
    return Math.max(0, t.variables.length - VISIBLE_VARIABLE_CHIPS);
  }

  protected relativeUpdated(t: MarketingTemplate): string {
    return relativeTime(t.updatedAt);
  }

  protected openPreview(t: MarketingTemplate): void {
    this.preview.set(t);
  }

  protected closePreview(): void {
    this.preview.set(null);
  }

  protected onPrev(): void {
    const next = Math.max(1, this.page() - 1);
    if (next !== this.page()) this.page.set(next);
  }

  protected onNext(): void {
    const next = Math.min(this.totalPages(), this.page() + 1);
    if (next !== this.page()) this.page.set(next);
  }

  protected retry(): void {
    this.refreshTick.update((v) => v + 1);
  }
}

/** Compact "3d ago" style relative time; dependency-free, safe on bad input. */
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

/** Best-effort HTTP error → message extraction. */
function extractError(err: unknown): string {
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
  return 'Failed to load templates.';
}
