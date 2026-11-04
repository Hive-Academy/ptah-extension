import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { Lens, Severity } from '@ptah-extension/review-contracts';

/** Presentation shape supplied by a validated finding RPC in P1-16. */
export interface ReviewFindingRow {
  id: string;
  severity: Severity;
  lens: Lens;
  path: string;
  line: number | null;
  status: 'accepted' | 'suppressed';
  reason: string | null;
  confidence: number;
}
type SortField = 'severity' | 'lens' | 'location' | 'status' | 'confidence';
const severityOrder: Record<Severity, number> = { Critical: 0, Major: 1, Minor: 2, Nitpick: 3 };

@Component({
  selector: 'ptah-review-findings-table', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Findings" class="space-y-3">
      <div class="flex flex-wrap gap-2">
        <label class="sr-only" for="finding-status">Filter findings by status</label>
        <select id="finding-status" class="select select-bordered select-sm" (change)="setStatus($event)">
          <option value="all">All findings</option><option value="accepted">Accepted</option><option value="suppressed">Suppressed</option>
        </select>
        <label class="sr-only" for="finding-lens">Filter findings by lens</label>
        <select id="finding-lens" class="select select-bordered select-sm" (change)="setLens($event)">
          <option value="all">All lenses</option>@for (lens of lenses; track lens) { <option [value]="lens">{{ lens }}</option> }
        </select>
      </div>
      @if (rows().length === 0) { <p class="text-sm text-base-content-muted">Findings unavailable for this run.</p> }
      @else if (visibleRows().length === 0) { <p class="text-sm text-base-content-muted">No matching findings.</p> }
      @else { <div class="overflow-x-auto"><table class="table table-zebra table-sm">
        <caption class="sr-only">Findings for selected review run</caption>
        <thead><tr>
          <th scope="col"><button type="button" (click)="sort('severity')">Severity</button></th>
          <th scope="col"><button type="button" (click)="sort('lens')">Lens</button></th>
          <th scope="col"><button type="button" (click)="sort('location')">Location</button></th>
          <th scope="col"><button type="button" (click)="sort('status')">Status</button></th>
          <th scope="col"><button type="button" (click)="sort('confidence')">Confidence</button></th>
        </tr></thead><tbody>
          @for (finding of visibleRows(); track finding.id) { <tr>
            <td>{{ finding.severity }}</td><td>{{ finding.lens }}</td>
            <td class="font-mono text-xs">{{ finding.path }}:{{ finding.line ?? '—' }}</td>
            <td>{{ finding.status }}@if (finding.status === 'suppressed') { <span class="block text-xs text-base-content-muted">{{ finding.reason || 'Reason unavailable' }}</span> }</td>
            <td>{{ (finding.confidence * 100).toFixed(0) }}%</td>
          </tr> }
        </tbody></table></div> }
    </section>
  `,
})
export class ReviewFindingsTableComponent {
  readonly rows = input.required<readonly ReviewFindingRow[]>();
  readonly lenses: readonly Lens[] = ['correctness-lifecycle', 'contracts-callers', 'security-privacy', 'host-di-config'];
  readonly status = signal<'all' | ReviewFindingRow['status']>('all');
  readonly lens = signal<string>('all');
  readonly sortField = signal<SortField>('severity');
  readonly ascending = signal(true);
  readonly visibleRows = computed(() => this.rows()
    .filter(row => (this.status() === 'all' || row.status === this.status()) && (this.lens() === 'all' || row.lens === this.lens()))
    .slice().sort((a, b) => {
      const field = this.sortField();
      const left = field === 'severity' ? severityOrder[a.severity] : field === 'location' ? `${a.path}:${a.line ?? 0}` : a[field];
      const right = field === 'severity' ? severityOrder[b.severity] : field === 'location' ? `${b.path}:${b.line ?? 0}` : b[field];
      const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
      return (this.ascending() ? result : -result) || a.id.localeCompare(b.id);
    }));
  sort(field: SortField): void { this.ascending.set(this.sortField() === field ? !this.ascending() : true); this.sortField.set(field); }
  setStatus(event: Event): void { const target = event.target; if (target instanceof HTMLSelectElement && (target.value === 'all' || target.value === 'accepted' || target.value === 'suppressed')) this.status.set(target.value); }
  setLens(event: Event): void { const target = event.target; if (target instanceof HTMLSelectElement && (target.value === 'all' || this.lenses.some(lens => lens === target.value))) this.lens.set(target.value); }
}
