import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  viewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Search } from 'lucide-angular';

/**
 * Dropdown Search Component - Angular 20+ Modernized
 * - Signal-based APIs (input(), output(), viewChild())
 * - OnPush change detection
 * - Pure presentation component
 */
@Component({
  selector: 'ptah-dropdown-search',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vscode-search-container">
      <div class="vscode-search-input-wrapper">
        <lucide-angular
          [img]="Search"
          class="vscode-search-icon"
        ></lucide-angular>
        <input
          #searchInput
          type="text"
          class="vscode-search-input"
          placeholder="Search..."
          [value]="searchTerm()"
          (input)="onSearch($event)"
          (keydown)="keyDown.emit($event)"
          cdkTrapFocus
        />
      </div>
    </div>
  `,
  styles: [
    `
      .vscode-search-container {
        padding: 4px;
        border-bottom: 1px solid var(--vscode-widget-border);
      }

      .vscode-search-input-wrapper {
        position: relative;
        display: flex;
        align-items: center;
      }

      .vscode-search-icon {
        position: absolute;
        left: 6px;
        width: 14px;
        height: 14px;
        color: var(--vscode-input-placeholderForeground);
        pointer-events: none;
        z-index: 1;
      }

      .vscode-search-input {
        width: 100%;
        padding: 4px 6px 4px 24px;
        border: 1px solid var(--vscode-input-border);
        border-radius: 2px;
        background-color: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        font-family: var(--vscode-font-family);
        font-size: 13px;
        outline: none;
      }

      .vscode-search-input:focus {
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
        border-color: var(--vscode-focusBorder);
      }

      .vscode-search-input::placeholder {
        color: var(--vscode-input-placeholderForeground);
      }
    `,
  ],
})
export class DropdownSearchComponent {
  // Signal-based ViewChild (Angular 20+)
  searchInput = viewChild.required<ElementRef<HTMLInputElement>>('searchInput');

  // Signal-based inputs (Angular 20+)
  searchTerm = input<string>('');

  // Signal-based outputs (Angular 20+)
  searchChange = output<string>();
  keyDown = output<KeyboardEvent>();

  readonly Search = Search;

  onSearch(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchChange.emit(target.value);
  }

  focus(): void {
    this.searchInput().nativeElement.focus();
  }
}
