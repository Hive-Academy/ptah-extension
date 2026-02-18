import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Copy, Check, Terminal } from 'lucide-angular';

@Component({
  selector: 'ptah-docs-code-block',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      class="rounded-xl overflow-hidden border border-amber-500/15 bg-slate-900/80 backdrop-blur-sm"
    >
      <!-- Header bar -->
      <div
        class="flex items-center justify-between px-4 py-2 bg-slate-800/60 border-b border-amber-500/10"
      >
        <div class="flex items-center gap-2">
          <lucide-angular
            [img]="TerminalIcon"
            class="w-3.5 h-3.5 text-amber-400/60"
            aria-hidden="true"
          />
          @if (label()) {
          <span class="text-xs text-white/40 font-medium">{{ label() }}</span>
          }
        </div>
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs text-white/40 hover:text-amber-400 transition-colors px-2 py-1 rounded-md hover:bg-white/5"
          aria-label="Copy code to clipboard"
          (click)="copyToClipboard()"
        >
          @if (copied()) {
          <lucide-angular
            [img]="CheckIcon"
            class="w-3.5 h-3.5 text-green-400"
            aria-hidden="true"
          />
          <span class="text-green-400">Copied</span>
          } @else {
          <lucide-angular
            [img]="CopyIcon"
            class="w-3.5 h-3.5"
            aria-hidden="true"
          />
          <span>Copy</span>
          }
        </button>
      </div>
      <!-- Code content -->
      <pre
        class="p-4 overflow-x-auto text-sm leading-relaxed"
      ><code class="font-mono text-white/80">{{ code() }}</code></pre>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsCodeBlockComponent {
  public readonly code = input('');
  public readonly label = input('');

  public readonly copied = signal(false);

  public readonly CopyIcon = Copy;
  public readonly CheckIcon = Check;
  public readonly TerminalIcon = Terminal;

  public copyToClipboard(): void {
    navigator.clipboard.writeText(this.code()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }
}
