import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { LucideAngularModule, Check, AlertCircle } from 'lucide-angular';
import { ToolIconComponent } from '../../atoms/tool-icon.component';

/**
 * CompactToolRow - Pre-derived, render-ready description of a single tool call.
 *
 * The parent CompactSessionActivityComponent derives this from either a
 * finalized ExecutionNode or a live ToolStartEvent so this component stays
 * purely presentational (no shared types, no event parsing).
 */
export interface CompactToolRow {
  /** Raw tool name (drives the icon + color via ToolIconComponent) */
  toolName: string;
  /** Human verb: Read → "Read", Write → "Wrote", Edit → "Updated", Bash → "Ran"… */
  verb: string;
  /** Execution status affordance */
  status: 'running' | 'complete' | 'error';
  /** File-name badge(s) for file-oriented tools (basenames only) */
  files: string[];
  /** Shell command (Bash) rendered in monospace */
  command?: string;
  /** Secondary detail (search pattern, query, url) rendered in monospace */
  detail?: string;
  /** Added line count (Write/Edit) — only set when honestly derivable */
  added?: number;
  /** Removed line count (Edit) — only set when honestly derivable */
  removed?: number;
}

/**
 * CompactToolRowComponent - One clean inline tool activity row.
 *
 * Renders like the reference: verb + target (file badges / mono command) +
 * optional diff stat (+733 / +1 -7) + status affordance (spinner running,
 * check complete, muted "Failed" on error). Density-first for the compact view.
 *
 * Complexity Level: 1 (presentational atom-like molecule, input-only)
 * Patterns: standalone, OnPush, composes ToolIconComponent.
 */
@Component({
  selector: 'ptah-compact-tool-row',
  standalone: true,
  imports: [LucideAngularModule, ToolIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-1.5 py-0.5 min-w-0 text-[11px]">
      <!-- Status affordance -->
      @if (row().status === 'running') {
        <span
          class="loading loading-spinner w-2.5 h-2.5 text-primary flex-shrink-0"
        ></span>
      } @else if (row().status === 'error') {
        <lucide-angular
          [img]="AlertCircleIcon"
          class="w-2.5 h-2.5 text-error/70 flex-shrink-0"
        />
      } @else {
        <lucide-angular
          [img]="CheckIcon"
          class="w-2.5 h-2.5 text-success/50 flex-shrink-0"
        />
      }

      <!-- Tool icon (shared color conventions) -->
      <ptah-tool-icon [toolName]="row().toolName" />

      <!-- Verb -->
      <span class="font-medium text-base-content/75 flex-shrink-0">{{
        row().verb
      }}</span>

      <!-- Command (Bash) in monospace -->
      @if (row().command) {
        <code
          class="font-mono text-[10px] text-base-content/60 bg-base-300/50 rounded px-1 py-px truncate min-w-0"
          [title]="row().command"
          >{{ row().command }}</code
        >
      }

      <!-- File-name badges -->
      @for (file of row().files; track file) {
        <span
          class="font-mono text-[10px] text-base-content/70 bg-base-content/5 border border-base-content/10 rounded px-1 py-px max-w-[10rem] truncate"
          [title]="file"
          >{{ file }}</span
        >
      }

      <!-- Secondary detail (pattern / query / url) -->
      @if (row().detail) {
        <code
          class="font-mono text-[10px] text-base-content/45 truncate min-w-0"
          [title]="row().detail"
          >{{ row().detail }}</code
        >
      }

      <!-- Diff stat -->
      @if (row().added || row().removed) {
        <span class="font-mono text-[10px] flex-shrink-0">
          @if (row().added) {
            <span class="text-success/70">+{{ row().added }}</span>
          }
          @if (row().removed) {
            <span class="text-error/70 ml-0.5">-{{ row().removed }}</span>
          }
        </span>
      }

      <!-- Failed label -->
      @if (row().status === 'error') {
        <span class="ml-auto text-[10px] text-error/60 flex-shrink-0"
          >Failed</span
        >
      }
    </div>
  `,
})
export class CompactToolRowComponent {
  readonly row = input.required<CompactToolRow>();

  protected readonly CheckIcon = Check;
  protected readonly AlertCircleIcon = AlertCircle;
}
