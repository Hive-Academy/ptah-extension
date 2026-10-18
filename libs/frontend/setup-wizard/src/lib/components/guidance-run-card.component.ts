import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import type {
  GuidanceRunStatus,
  GuidanceSnapshot,
} from '../services/guidance-generation.store';

@Component({
  selector: 'ptah-guidance-run-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-base-300 bg-base-200 p-4"
      aria-labelledby="guidance-run-title"
    >
      <h2 id="guidance-run-title" class="font-semibold">Project guidance</h2>
      @if (snapshot(); as accepted) {
        <p class="text-sm text-base-content-muted">
          Source: {{ accepted.sourceLabel }}
        </p>
        @if (accepted.provider && accepted.model) {
          <p class="text-sm text-base-content-muted">
            Accepted with {{ accepted.provider }} · {{ accepted.model }}
          </p>
        }
      }
      @switch (status()) {
        @case ('starting') {
          <p role="status">Starting project guidance…</p>
        }
        @case ('running') {
          <p role="status">Generating project guidance…</p>
        }
        @case ('cancelling') {
          <p role="status">Stopping generation…</p>
        }
        @case ('completed') {
          <p role="status">Project guidance saved for this workspace.</p>
        }
        @case ('cancelled') {
          <p role="status">
            Generation was cancelled. Check the saved guidance below.
          </p>
        }
        @case ('failed') {
          <p role="alert">Guidance was not saved. You can retry.</p>
        }
        @case ('timed-out') {
          <p role="alert">Guidance timed out. You can retry.</p>
        }
        @case ('stop-unknown') {
          <p role="alert">Run state could not be confirmed. Check again.</p>
        }
        @case ('unknown') {
          <p role="status">Run state could not be confirmed. Check again.</p>
        }
        @default {
          <p class="text-sm text-base-content-muted">No active guidance run.</p>
        }
      }
      @if (
        status() === 'starting' ||
        status() === 'running' ||
        status() === 'cancelling'
      ) {
        <button
          type="button"
          class="btn btn-outline btn-sm"
          [disabled]="status() === 'cancelling'"
          (click)="stopRequested.emit()"
        >
          {{ status() === 'cancelling' ? 'Stopping…' : 'Stop generation' }}
        </button>
      }
      @if (status() === 'failed' || status() === 'timed-out') {
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="retryRequested.emit()"
        >
          Retry
        </button>
      }
      @if (status() === 'unknown' || status() === 'stop-unknown') {
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="refreshRequested.emit()"
        >
          Check again
        </button>
      }
    </section>
  `,
})
export class GuidanceRunCardComponent {
  readonly snapshot = input<GuidanceSnapshot | null>(null);
  readonly status = input.required<GuidanceRunStatus>();
  readonly stopRequested = output<void>();
  readonly retryRequested = output<void>();
  readonly refreshRequested = output<void>();
}
