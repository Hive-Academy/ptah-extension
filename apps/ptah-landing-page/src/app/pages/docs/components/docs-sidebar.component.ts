import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronDown, BookOpen } from 'lucide-angular';

export interface DocsSectionLink {
  id: string;
  label: string;
}

@Component({
  selector: 'ptah-docs-sidebar',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <!-- Mobile Dropdown -->
    <div class="lg:hidden mb-6">
      <button
        type="button"
        class="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-slate-800/60 border border-amber-500/20 text-white/90 font-medium text-sm"
        [attr.aria-expanded]="mobileOpen()"
        aria-controls="docs-mobile-toc"
        (click)="toggleMobile()"
      >
        <span class="flex items-center gap-2">
          <lucide-angular
            [img]="BookOpenIcon"
            class="w-4 h-4 text-amber-400"
            aria-hidden="true"
          />
          On this page
        </span>
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-4 h-4 transition-transform duration-200"
          [class.rotate-180]="mobileOpen()"
          aria-hidden="true"
        />
      </button>
      @if (mobileOpen()) {
      <nav
        id="docs-mobile-toc"
        class="mt-2 rounded-lg bg-slate-800/60 border border-amber-500/20 py-2 animate-slide-down"
        aria-label="Table of contents"
      >
        @for (section of sections(); track section.id) {
        <button
          type="button"
          class="block w-full text-left px-4 py-2 text-sm transition-colors"
          [ngClass]="
            activeSection() === section.id
              ? 'text-amber-400 font-semibold'
              : 'text-white/60 hover:text-white/90'
          "
          (click)="onSectionClick(section.id)"
        >
          {{ section.label }}
        </button>
        }
      </nav>
      }
    </div>

    <!-- Desktop Sticky Sidebar -->
    <aside
      class="hidden lg:block sticky top-24 self-start w-56 xl:w-64 shrink-0 max-h-[calc(100vh-7rem)] overflow-y-auto"
      aria-label="Table of contents"
    >
      <h4
        class="text-xs font-semibold uppercase tracking-wider text-amber-400/80 mb-4 px-3"
      >
        On this page
      </h4>
      <nav class="space-y-0.5">
        @for (section of sections(); track section.id) {
        <button
          type="button"
          class="block w-full text-left px-3 py-1.5 text-sm rounded-md transition-all duration-200 border-l-2"
          [ngClass]="
            activeSection() === section.id
              ? 'border-amber-400 text-amber-400 font-semibold bg-amber-500/5'
              : 'border-transparent text-white/50 hover:text-white/80 hover:border-white/20'
          "
          (click)="onSectionClick(section.id)"
        >
          {{ section.label }}
        </button>
        }
      </nav>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      @keyframes slide-down {
        from {
          opacity: 0;
          transform: translateY(-6px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .animate-slide-down {
        animation: slide-down 0.15s ease-out;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsSidebarComponent {
  public readonly sections = input.required<DocsSectionLink[]>();
  public readonly activeSection = input<string>('');
  public readonly sectionClick = output<string>();

  public readonly mobileOpen = signal(false);

  public readonly BookOpenIcon = BookOpen;
  public readonly ChevronDownIcon = ChevronDown;

  public toggleMobile(): void {
    this.mobileOpen.update((v) => !v);
  }

  public onSectionClick(id: string): void {
    this.mobileOpen.set(false);
    this.sectionClick.emit(id);
  }
}
