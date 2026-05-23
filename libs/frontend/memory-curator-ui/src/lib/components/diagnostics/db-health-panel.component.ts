import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { MemoryDbHealthDto } from '@ptah-extension/shared';

interface HealthRow {
  readonly label: string;
  readonly primary: number;
  readonly secondary: number;
  readonly secondaryLabel: string;
  readonly mismatch: boolean;
}

@Component({
  selector: 'ptah-db-health-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-md border border-base-300 bg-base-100">
      <header
        class="border-b border-base-300 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-base-content/70"
      >
        DB Health
      </header>
      @if (health(); as h) {
        <table class="w-full text-xs">
          <tbody>
            @for (row of rows(); track row.label) {
              <tr class="border-b border-base-200 last:border-b-0">
                <td class="px-3 py-1.5 font-medium">{{ row.label }}</td>
                <td class="px-3 py-1.5 text-right tabular-nums">
                  {{ row.primary }} / {{ row.secondary }}
                  <span class="ml-1">{{ row.secondaryLabel }}</span>
                </td>
                <td class="px-3 py-1.5 text-right">
                  @if (row.mismatch) {
                    <span
                      class="font-bold text-error"
                      data-testid="health-mismatch"
                    >
                      ✗ MISMATCH
                    </span>
                  } @else {
                    <span class="text-success">✓</span>
                  }
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr class="border-t border-base-300 bg-base-200/50">
              <td class="px-3 py-1.5 text-xs font-medium" colspan="2">
                coherent
              </td>
              <td class="px-3 py-1.5 text-right">
                @if (h.coherent) {
                  <span class="badge badge-success badge-sm">true</span>
                } @else {
                  <span class="badge badge-error badge-sm">false</span>
                }
              </td>
            </tr>
          </tfoot>
        </table>
      } @else {
        <div class="px-3 py-3 text-xs text-base-content/60">
          No DB health data yet.
        </div>
      }
    </div>
  `,
})
export class DbHealthPanelComponent {
  public readonly health = input<MemoryDbHealthDto | null>(null);

  protected readonly rows = computed<readonly HealthRow[]>(() => {
    const h = this.health();
    if (!h) return [];
    return [
      {
        label: 'memory_chunks',
        primary: h.memory_chunks,
        secondary: h.memory_chunks_vec,
        secondaryLabel: 'vec',
        mismatch: h.memory_chunks !== h.memory_chunks_vec,
      },
      {
        label: 'memory_chunks',
        primary: h.memory_chunks,
        secondary: h.memory_chunks_fts,
        secondaryLabel: 'fts',
        mismatch: h.memory_chunks !== h.memory_chunks_fts,
      },
      {
        label: 'code_symbols',
        primary: h.code_symbols,
        secondary: h.code_symbols_vec,
        secondaryLabel: 'vec',
        mismatch: h.code_symbols !== h.code_symbols_vec,
      },
    ];
  });
}
