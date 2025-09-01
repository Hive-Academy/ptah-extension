import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Search } from 'lucide-angular';

/**
 * VS Code Dropdown Search Input - Pure Component
 * - Search input with icon
 * - Emits search term changes
 * - No business logic
 */
@Component({
  selector: 'vscode-dropdown-search',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],

  template: `
    <div class="vscode-search-container">
      <div class="vscode-search-input-wrapper">
        <lucide-angular [img]="Search" class="vscode-search-icon"></lucide-angular>
        <input
          #searchInput
          type="text"
          class="vscode-search-input"
          placeholder="Search..."
          [(ngModel)]="searchTerm"
          (input)="onSearch()"
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
export class VSCodeDropdownSearchComponent {
  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  @Input() searchTerm: string = '';

  @Output() searchChange = new EventEmitter<string>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();

  readonly Search = Search;

  onSearch(): void {
    this.searchChange.emit(this.searchTerm);
  }

  focus(): void {
    this.searchInput.nativeElement.focus();
  }
}
