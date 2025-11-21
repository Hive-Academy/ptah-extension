# Component Specifications - Session Management

**Date**: 2025-01-21
**Designer**: UI/UX Designer Agent
**Project**: Ptah Extension Session Management
**Status**: Implementation-Ready Specifications

---

## Component Architecture

### Component Tree

```
ChatComponent (apps/ptah-extension-webview/src/app/features/chat/)
├── ChatHeaderComponent (MODIFIED)
│   ├── [EXISTING] Analytics Button
│   ├── [NEW] SessionDropdownComponent
│   │   ├── DropdownTrigger (button with chevron)
│   │   └── DropdownMenu (conditional @if)
│   │       ├── SessionListComponent (reusable)
│   │       │   └── SessionItemComponent (x5-10)
│   │       ├── NewSessionButton
│   │       └── SearchAllButton
│   └── [EXISTING] Provider Settings Button
│
├── [LAZY-LOADED] SessionSearchOverlayComponent
│   ├── CloseButton (top-right X)
│   ├── SearchInput (debounced)
│   ├── SessionGroupComponent (x N date groups)
│   │   ├── GroupHeader ("Today", "Yesterday", etc.)
│   │   └── SessionListComponent (reusable)
│   │       └── SessionItemComponent (virtual scroll)
│   └── EmptyState (no results / no sessions)
│
└── ChatEmptyStateComponent (MODIFIED)
    ├── [EXISTING] Welcome Section
    ├── [EXISTING] Action Cards
    ├── [REMOVED] Recent Sessions Section ❌
    └── [EXISTING] Feature Highlights
```

---

## Component 1: SessionDropdownComponent

### File Location

`libs/frontend/chat/src/lib/components/session-dropdown/session-dropdown.component.ts`

### Purpose

Provides quick access to recent sessions via header dropdown menu.

### Component Signature

```typescript
import { Component, input, output, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, ChevronDownIcon, PlusIcon, SearchIcon } from 'lucide-angular';
import { SessionSummary, SessionId } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-session-dropdown',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  template: `<!-- See Template Section -->`,
  styles: [
    `
      /* See Styles Section */
    `,
  ],
})
export class SessionDropdownComponent {
  // Icons
  readonly ChevronDownIcon = ChevronDownIcon;
  readonly PlusIcon = PlusIcon;
  readonly SearchIcon = SearchIcon;

  // Inputs
  readonly currentSessionId = input<SessionId | null>(null);
  readonly recentSessions = input<SessionSummary[]>([]);

  // Outputs
  readonly sessionSelected = output<SessionId>();
  readonly newSessionClicked = output<void>();
  readonly searchAllClicked = output<void>();

  // Internal State
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  private readonly _focusedIndex = signal(-1);
  readonly focusedIndex = this._focusedIndex.asReadonly();

  // Computed
  readonly hasRecentSessions = computed(() => this.recentSessions().length > 0);
  readonly dropdownAriaLabel = computed(() => (this.isOpen() ? 'Close recent sessions menu' : 'Open recent sessions menu'));

  // Methods
  toggleDropdown(): void {
    this._isOpen.update((open) => !open);
    if (this._isOpen()) {
      this._focusedIndex.set(-1);
    }
  }

  closeDropdown(): void {
    this._isOpen.set(false);
    this._focusedIndex.set(-1);
  }

  selectSession(sessionId: SessionId): void {
    this.sessionSelected.emit(sessionId);
    this.closeDropdown();
  }

  onNewSession(): void {
    this.newSessionClicked.emit();
    this.closeDropdown();
  }

  onSearchAll(): void {
    this.searchAllClicked.emit();
    this.closeDropdown();
  }

  // Keyboard Navigation
  onKeyDown(event: KeyboardEvent): void {
    const sessions = this.recentSessions();

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.closeDropdown();
        break;

      case 'ArrowDown':
        event.preventDefault();
        if (!this.isOpen()) {
          this.toggleDropdown();
        } else {
          this._focusedIndex.update(
            (i) => Math.min(i + 1, sessions.length + 1) // +1 for "New Session", +1 for "Search All"
          );
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        this._focusedIndex.update((i) => Math.max(i - 1, -1));
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        const focusedIdx = this._focusedIndex();
        if (focusedIdx === -1) {
          this.toggleDropdown();
        } else if (focusedIdx < sessions.length) {
          this.selectSession(sessions[focusedIdx].id);
        } else if (focusedIdx === sessions.length) {
          this.onNewSession();
        } else {
          this.onSearchAll();
        }
        break;
    }
  }

  // Click Outside Handler
  onClickOutside(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.session-dropdown')) {
      this.closeDropdown();
    }
  }

  // Utility Methods
  isActiveSession(sessionId: SessionId): boolean {
    return this.currentSessionId() === sessionId;
  }

  getRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;

    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
}
```

### Template

```html
<div class="session-dropdown" (keydown)="onKeyDown($event)">
  <!-- Dropdown Trigger Button -->
  <button type="button" class="dropdown-trigger" (click)="toggleDropdown()" [attr.aria-expanded]="isOpen()" [attr.aria-label]="dropdownAriaLabel()" aria-haspopup="true" aria-controls="session-dropdown-menu">
    <span class="trigger-text">Recent Sessions</span>
    <lucide-angular [img]="ChevronDownIcon" class="trigger-icon" [class.rotated]="isOpen()" />
  </button>

  <!-- Dropdown Menu Overlay -->
  @if (isOpen()) {
  <div id="session-dropdown-menu" class="dropdown-menu" role="menu" aria-orientation="vertical" (click)="$event.stopPropagation()">
    <!-- Recent Sessions List -->
    @if (hasRecentSessions()) {
    <div class="menu-section">
      <div class="section-header">Recent Sessions</div>
      @for (session of recentSessions(); track session.id; let i = $index) {
      <button type="button" class="session-item" [class.active]="isActiveSession(session.id)" [class.focused]="focusedIndex() === i" (click)="selectSession(session.id)" role="menuitem" [attr.aria-label]="'Switch to session: ' + session.name">
        <!-- Status Indicator -->
        <div class="session-status">
          @if (isActiveSession(session.id)) {
          <div class="status-dot status-active" aria-label="Active session"></div>
          } @else {
          <div class="status-dot status-inactive"></div>
          }
        </div>

        <!-- Session Info -->
        <div class="session-info">
          <div class="session-name">{{ session.name }}</div>
          <div class="session-meta">
            <span class="meta-item">{{ session.messageCount }} messages</span>
            <span class="meta-separator">•</span>
            <span class="meta-item">{{ getRelativeTime(session.lastActiveAt) }}</span>
          </div>
        </div>
      </button>
      }
    </div>
    }

    <!-- New Session Button -->
    <button type="button" class="menu-action new-session" [class.focused]="focusedIndex() === recentSessions().length" (click)="onNewSession()" role="menuitem" aria-label="Create new session">
      <lucide-angular [img]="PlusIcon" class="action-icon" />
      <span class="action-text">New Session</span>
    </button>

    <!-- Search All Button -->
    <button type="button" class="menu-action search-all" [class.focused]="focusedIndex() === recentSessions().length + 1" (click)="onSearchAll()" role="menuitem" aria-label="Search all sessions">
      <lucide-angular [img]="SearchIcon" class="action-icon" />
      <span class="action-text">Search All Sessions...</span>
    </button>
  </div>
  }
</div>
```

### Styles

```css
:host {
  display: inline-block;
  position: relative;
}

/* Dropdown Trigger Button */
.dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--vscode-button-background);
  border: 1px solid var(--vscode-button-border, transparent);
  border-radius: 3px;
  color: var(--vscode-button-foreground);
  font-family: var(--vscode-font-family);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.dropdown-trigger:hover {
  background: var(--vscode-button-hoverBackground);
}

.dropdown-trigger:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

.trigger-icon {
  width: 14px;
  height: 14px;
  transition: transform 200ms ease;
}

.trigger-icon.rotated {
  transform: rotate(180deg);
}

/* Dropdown Menu Overlay */
.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 320px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  z-index: 1000;
  animation: dropdownOpen 200ms ease-out;
}

@keyframes dropdownOpen {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Menu Section */
.menu-section {
  padding: 8px 0;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.section-header {
  padding: 8px 12px 4px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Session Item */
.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-left: 3px solid transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease;
}

.session-item:hover,
.session-item.focused {
  background: var(--vscode-list-hoverBackground);
}

.session-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  border-left-color: var(--vscode-focusBorder);
}

.session-item:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

/* Status Indicator */
.session-status {
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.status-active {
  background: var(--vscode-charts-green);
  box-shadow: 0 0 4px var(--vscode-charts-green);
}

.status-dot.status-inactive {
  background: var(--vscode-charts-blue);
}

/* Session Info */
.session-info {
  flex: 1;
  min-width: 0;
}

.session-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-dropdown-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.meta-separator {
  opacity: 0.5;
}

/* Menu Actions */
.menu-action {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-top: 1px solid var(--vscode-panel-border);
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease;
}

.menu-action:hover,
.menu-action.focused {
  background: var(--vscode-list-hoverBackground);
}

.menu-action:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: -1px;
}

.action-icon {
  width: 16px;
  height: 16px;
  color: var(--vscode-icon-foreground);
}

.action-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--vscode-dropdown-foreground);
}

/* Specific Action Styles */
.new-session .action-icon {
  color: var(--vscode-charts-green);
}

.search-all .action-icon {
  color: var(--vscode-charts-blue);
}

/* Scrollbar */
.dropdown-menu::-webkit-scrollbar {
  width: 8px;
}

.dropdown-menu::-webkit-scrollbar-track {
  background: var(--vscode-scrollbar-shadow);
}

.dropdown-menu::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background);
  border-radius: 4px;
}

.dropdown-menu::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground);
}

/* Responsive: Mobile */
@media (max-width: 768px) {
  .dropdown-menu {
    width: 280px;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  .dropdown-menu {
    animation: none;
  }

  .trigger-icon {
    transition: none;
  }
}
```

### Usage Example

```typescript
// In ChatHeaderComponent
import { SessionDropdownComponent } from '../session-dropdown/session-dropdown.component';

@Component({
  selector: 'ptah-chat-header',
  imports: [SessionDropdownComponent /* other imports */],
  template: `
    <div class="header-container">
      <div class="header-actions">
        <!-- Replace "New Session" button with dropdown -->
        <ptah-session-dropdown [currentSessionId]="currentSession()?.id ?? null" [recentSessions]="chatService.recentSessions()" (sessionSelected)="onSessionSelected($event)" (newSessionClicked)="onNewSession()" (searchAllClicked)="onSearchAllClicked()" />

        <button class="header-action-btn" (click)="analytics.emit()">
          <span>Analytics</span>
        </button>
      </div>

      <div class="header-provider">
        <!-- Provider settings button -->
      </div>
    </div>
  `,
})
export class ChatHeaderComponent {
  // ... existing code

  onSessionSelected(sessionId: SessionId): void {
    void this.chatService.switchToSession(sessionId);
  }

  onNewSession(): void {
    this.newSession.emit();
  }

  onSearchAllClicked(): void {
    // Show search overlay (lazy-loaded)
    this.showSearchOverlay.set(true);
  }
}
```

---

## Component 2: SessionSearchOverlayComponent

### File Location

`libs/frontend/chat/src/lib/components/session-search-overlay/session-search-overlay.component.ts`

### Purpose

Full-screen search overlay for browsing and searching all sessions.

### Component Signature

```typescript
import { Component, input, output, signal, computed, effect, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, XIcon, SearchIcon } from 'lucide-angular';
import { SessionSummary, SessionId } from '@ptah-extension/shared';
import { debounceTime } from 'rxjs/operators';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'ptah-session-search-overlay',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `<!-- See Template Section -->`,
  styles: [
    `
      /* See Styles Section */
    `,
  ],
})
export class SessionSearchOverlayComponent {
  private readonly destroyRef = inject(DestroyRef);

  // Icons
  readonly XIcon = XIcon;
  readonly SearchIcon = SearchIcon;

  // Inputs
  readonly isOpen = input<boolean>(false);
  readonly currentSessionId = input<SessionId | null>(null);
  readonly sessions = input<SessionSummary[]>([]);

  // Outputs
  readonly sessionSelected = output<SessionId>();
  readonly closed = output<void>();

  // Internal State
  private readonly _searchQuery = signal('');
  readonly searchQuery = this._searchQuery.asReadonly();

  // Debounced search query
  private readonly debouncedQuery = signal('');

  constructor() {
    // Setup debounced search
    toObservable(this._searchQuery)
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => this.debouncedQuery.set(query));

    // Focus search input when overlay opens
    effect(() => {
      if (this.isOpen()) {
        setTimeout(() => {
          const input = document.getElementById('session-search-input') as HTMLInputElement;
          input?.focus();
        }, 100);
      }
    });
  }

  // Computed: Filtered sessions
  readonly filteredSessions = computed(() => {
    const query = this.debouncedQuery().toLowerCase().trim();
    if (!query) return this.sessions();

    return this.sessions().filter((session) => session.name.toLowerCase().includes(query));
  });

  // Computed: Grouped sessions by date
  readonly groupedSessions = computed(() => {
    const sessions = this.filteredSessions();
    const now = Date.now();
    const oneDayMs = 1000 * 60 * 60 * 24;

    const groups: {
      today: SessionSummary[];
      yesterday: SessionSummary[];
      lastWeek: SessionSummary[];
      lastMonth: SessionSummary[];
      older: SessionSummary[];
    } = {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: [],
    };

    for (const session of sessions) {
      const diff = now - session.lastActiveAt;
      if (diff < oneDayMs) {
        groups.today.push(session);
      } else if (diff < oneDayMs * 2) {
        groups.yesterday.push(session);
      } else if (diff < oneDayMs * 7) {
        groups.lastWeek.push(session);
      } else if (diff < oneDayMs * 30) {
        groups.lastMonth.push(session);
      } else {
        groups.older.push(session);
      }
    }

    return groups;
  });

  // Computed: Visible group labels
  readonly visibleGroups = computed(() => {
    const groups = this.groupedSessions();
    const visible: Array<{ label: string; sessions: SessionSummary[] }> = [];

    if (groups.today.length > 0) visible.push({ label: 'Today', sessions: groups.today });
    if (groups.yesterday.length > 0) visible.push({ label: 'Yesterday', sessions: groups.yesterday });
    if (groups.lastWeek.length > 0) visible.push({ label: 'Last 7 Days', sessions: groups.lastWeek });
    if (groups.lastMonth.length > 0) visible.push({ label: 'Last 30 Days', sessions: groups.lastMonth });
    if (groups.older.length > 0) visible.push({ label: 'Older', sessions: groups.older });

    return visible;
  });

  // Computed: Empty state
  readonly hasResults = computed(() => this.filteredSessions().length > 0);
  readonly showNoResults = computed(() => this.debouncedQuery().trim().length > 0 && !this.hasResults());
  readonly showNoSessions = computed(() => this.sessions().length === 0 && this.debouncedQuery().trim().length === 0);

  // Methods
  close(): void {
    this.closed.emit();
    this._searchQuery.set('');
  }

  selectSession(sessionId: SessionId): void {
    this.sessionSelected.emit(sessionId);
    this.close();
  }

  onSearchInput(value: string): void {
    this._searchQuery.set(value);
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  isActiveSession(sessionId: SessionId): boolean {
    return this.currentSessionId() === sessionId;
  }

  getRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;

    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: timestamp < new Date().getFullYear() ? 'numeric' : undefined,
    });
  }
}
```

### Template

```html
@if (isOpen()) {
<div class="overlay-backdrop" (click)="onBackdropClick($event)" (keydown)="onKeyDown($event)" role="dialog" aria-modal="true" aria-labelledby="search-overlay-title">
  <div class="overlay-content" (click)="$event.stopPropagation()">
    <!-- Close Button -->
    <button type="button" class="close-button" (click)="close()" aria-label="Close search overlay">
      <lucide-angular [img]="XIcon" class="close-icon" />
    </button>

    <!-- Search Input -->
    <div class="search-container">
      <lucide-angular [img]="SearchIcon" class="search-icon" />
      <input id="session-search-input" type="text" class="search-input" placeholder="Search sessions by name or content..." [value]="searchQuery()" (input)="onSearchInput($any($event.target).value)" autocomplete="off" spellcheck="false" />
    </div>

    <!-- Results Container -->
    <div class="results-container">
      @if (hasResults()) {
      <!-- Grouped Sessions -->
      @for (group of visibleGroups(); track group.label) {
      <div class="session-group">
        <div class="group-header">{{ group.label }}</div>
        <div class="group-sessions">
          @for (session of group.sessions; track session.id) {
          <button type="button" class="session-item" [class.active]="isActiveSession(session.id)" (click)="selectSession(session.id)">
            <!-- Status Indicator -->
            <div class="session-status">
              @if (isActiveSession(session.id)) {
              <div class="status-dot status-active" aria-label="Active session"></div>
              } @else {
              <div class="status-dot status-inactive"></div>
              }
            </div>

            <!-- Session Info -->
            <div class="session-info">
              <div class="session-name">{{ session.name }}</div>
              <div class="session-meta">
                <span class="meta-item">{{ session.messageCount }} messages</span>
                <span class="meta-separator">•</span>
                <span class="meta-item">{{ getRelativeTime(session.lastActiveAt) }}</span>
              </div>
            </div>
          </button>
          }
        </div>
      </div>
      } } @else if (showNoResults()) {
      <!-- No Results Empty State -->
      <div class="empty-state">
        <div class="empty-icon">🤷</div>
        <div class="empty-title">No sessions found</div>
        <div class="empty-description">Try adjusting your search terms or browse all sessions below</div>
      </div>
      } @else if (showNoSessions()) {
      <!-- No Sessions Empty State -->
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-title">No sessions yet</div>
        <div class="empty-description">Click "New Session" to start chatting with Claude Code</div>
      </div>
      }
    </div>
  </div>
</div>
}
```

### Styles

```css
/* Overlay Backdrop */
.overlay-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 64px 24px 24px 24px;
  overflow-y: auto;
  animation: overlayFadeIn 250ms ease-out;
}

@keyframes overlayFadeIn {
  from {
    opacity: 0;
    backdrop-filter: blur(0);
  }
  to {
    opacity: 1;
    backdrop-filter: blur(4px);
  }
}

/* Overlay Content */
.overlay-content {
  width: 100%;
  max-width: 800px;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  animation: contentSlideIn 250ms ease-out;
  position: relative;
}

@keyframes contentSlideIn {
  from {
    transform: scale(0.96) translateY(16px);
    opacity: 0;
  }
  to {
    transform: scale(1) translateY(0);
    opacity: 1;
  }
}

/* Close Button */
.close-button {
  position: absolute;
  top: 16px;
  right: 16px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 150ms ease;
  z-index: 1;
}

.close-button:hover {
  background: var(--vscode-toolbar-hoverBackground);
}

.close-button:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

.close-icon {
  width: 20px;
  height: 20px;
  color: var(--vscode-icon-foreground);
}

/* Search Container */
.search-container {
  position: relative;
  padding: 24px 24px 16px 24px;
  border-bottom: 1px solid var(--vscode-panel-border);
}

.search-icon {
  position: absolute;
  top: 34px;
  left: 36px;
  width: 20px;
  height: 20px;
  color: var(--vscode-descriptionForeground);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 48px;
  padding: 12px 16px 12px 48px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-radius: 4px;
  color: var(--vscode-input-foreground);
  font-family: var(--vscode-font-family);
  font-size: 16px;
  transition: border-color 150ms ease;
}

.search-input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
}

.search-input::placeholder {
  color: var(--vscode-input-placeholderForeground);
}

/* Results Container */
.results-container {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  padding: 16px 24px 24px 24px;
}

/* Session Group */
.session-group {
  margin-bottom: 24px;
}

.session-group:last-child {
  margin-bottom: 0;
}

.group-header {
  padding: 8px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-descriptionForeground);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.group-sessions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Session Item */
.session-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border);
  border-left: 3px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  transition: all 150ms ease;

  /* Native virtual scrolling optimization */
  content-visibility: auto;
  contain-intrinsic-size: 64px;
}

.session-item:hover {
  background: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}

.session-item.active {
  background: var(--vscode-list-activeSelectionBackground);
  border-left-color: var(--vscode-focusBorder);
}

.session-item:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}

/* Status Indicator */
.session-status {
  flex-shrink: 0;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.status-active {
  background: var(--vscode-charts-green);
  box-shadow: 0 0 4px var(--vscode-charts-green);
}

.status-dot.status-inactive {
  background: var(--vscode-charts-blue);
}

/* Session Info */
.session-info {
  flex: 1;
  min-width: 0;
}

.session-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--vscode-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.session-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.meta-separator {
  opacity: 0.5;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--vscode-foreground);
  margin-bottom: 8px;
}

.empty-description {
  font-size: 14px;
  color: var(--vscode-descriptionForeground);
  max-width: 400px;
}

/* Scrollbar */
.results-container::-webkit-scrollbar {
  width: 8px;
}

.results-container::-webkit-scrollbar-track {
  background: var(--vscode-scrollbar-shadow);
}

.results-container::-webkit-scrollbar-thumb {
  background: var(--vscode-scrollbarSlider-background);
  border-radius: 4px;
}

.results-container::-webkit-scrollbar-thumb:hover {
  background: var(--vscode-scrollbarSlider-hoverBackground);
}

/* Responsive: Mobile */
@media (max-width: 768px) {
  .overlay-backdrop {
    padding: 16px;
  }

  .overlay-content {
    border-radius: 4px;
  }

  .search-container {
    padding: 16px;
  }

  .results-container {
    max-height: calc(100vh - 150px);
    padding: 12px 16px 16px 16px;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  .overlay-backdrop,
  .overlay-content {
    animation: none;
  }

  .session-item {
    transition: none;
  }
}
```

### Usage Example

```typescript
// In ChatComponent or ChatHeaderComponent
import { SessionSearchOverlayComponent } from '../session-search-overlay/session-search-overlay.component';

@Component({
  selector: 'ptah-chat',
  imports: [SessionSearchOverlayComponent /* other imports */],
  template: `
    <!-- Chat UI -->

    <!-- Lazy-loaded search overlay -->
    @if (showSearchOverlay()) {
    <ptah-session-search-overlay [isOpen]="showSearchOverlay()" [currentSessionId]="chatService.currentSession()?.id ?? null" [sessions]="chatService.sessions()" (sessionSelected)="onSessionSelected($event)" (closed)="showSearchOverlay.set(false)" />
    }
  `,
})
export class ChatComponent {
  readonly showSearchOverlay = signal(false);

  // ... other code

  onSearchAllClicked(): void {
    this.showSearchOverlay.set(true);
  }

  onSessionSelected(sessionId: SessionId): void {
    void this.chatService.switchToSession(sessionId);
    this.showSearchOverlay.set(false);
  }
}
```

---

## Component 3: ChatEmptyStateComponent (MODIFIED)

### Modifications Required

**File**: `libs/frontend/chat/src/lib/components/chat-empty-state/chat-empty-state.component.ts`

**Changes**:

1. **Remove sessions input** (line 491):

```typescript
// BEFORE
readonly sessions = input<SessionSummary[]>([]);

// AFTER
// (Remove this line entirely)
```

2. **Remove hasSessions computed** (line 496):

```typescript
// BEFORE
readonly hasSessions = computed(() => this.sessions().length > 0);

// AFTER
// (Remove this line entirely)
```

3. **Remove sessionSelected output** (line 511):

```typescript
// BEFORE
readonly sessionSelected = output<string>();

// AFTER
// (Remove this line entirely)
```

4. **Remove sessions section from template** (lines 113-146):

```html
<!-- BEFORE -->
@if (hasSessions()) {
<div class="sessions-section">
  <h4 class="sessions-title">Recent Sessions</h4>
  <div class="sessions-list">
    @for (session of sessions(); track session.id) {
    <button class="session-item" (click)="sessionSelected.emit(session.id)" type="button" [attr.aria-label]="'Open session ' + session.name">
      <!-- Session content -->
    </button>
    }
  </div>
</div>
}

<!-- AFTER -->
<!-- (Remove entire section) -->
```

5. **Remove sessions styles** (lines 301-408):

```css
/* BEFORE */
.sessions-section {
  /* ... */
}
.sessions-title {
  /* ... */
}
.sessions-list {
  /* ... */
}
.session-item {
  /* ... */
}
/* ... more session styles */

/* AFTER */
/* (Remove all session-related styles) */
```

**Result**: Clean empty state with only welcome message, action cards, and feature highlights.

---

## Component 4: ChatService (EXTENDED)

### File Location

`libs/frontend/core/src/lib/services/chat.service.ts`

### New Computed Signals

**Add after line 214** (after `readonly messageCount`):

```typescript
/**
 * Recent sessions (top 10 by lastActiveAt)
 * Filters out empty sessions (0 messages)
 */
readonly recentSessions = computed(() =>
  this.sessions()
    .slice()
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .slice(0, 10)
    .filter(s => s.messageCount > 0)
);
```

**No other changes needed** - existing methods cover all session operations:

- `switchToSession(sessionId)` - Switch to session
- `createNewSession(name?)` - Create new session
- `refreshSessions()` - Refresh from backend

---

## Integration Checklist

### Phase 1: Component Creation

- [ ] Create `SessionDropdownComponent`
  - [ ] Component file structure
  - [ ] Template implementation
  - [ ] Styles implementation
  - [ ] Keyboard navigation
  - [ ] Click outside handler
- [ ] Create `SessionSearchOverlayComponent`
  - [ ] Component file structure
  - [ ] Template implementation
  - [ ] Styles implementation
  - [ ] Search debouncing
  - [ ] Virtual scrolling (content-visibility)
  - [ ] Date grouping logic
  - [ ] Keyboard shortcuts
  - [ ] Focus trap
- [ ] Export components from `libs/frontend/chat/src/index.ts`

### Phase 2: Integration

- [ ] Modify `ChatHeaderComponent`
  - [ ] Import `SessionDropdownComponent`
  - [ ] Replace "New Session" button
  - [ ] Wire up event handlers
  - [ ] Add search overlay state signal
- [ ] Modify `ChatEmptyStateComponent`
  - [ ] Remove sessions input
  - [ ] Remove hasSessions computed
  - [ ] Remove sessionSelected output
  - [ ] Remove sessions template section
  - [ ] Remove sessions styles
- [ ] Extend `ChatService`
  - [ ] Add `recentSessions` computed signal
- [ ] Update `ChatComponent`
  - [ ] Import `SessionSearchOverlayComponent`
  - [ ] Add `showSearchOverlay` signal
  - [ ] Wire up search overlay handlers

### Phase 3: Testing

- [ ] Unit tests for `SessionDropdownComponent`
- [ ] Unit tests for `SessionSearchOverlayComponent`
- [ ] Integration tests for session switching
- [ ] Keyboard navigation tests
- [ ] Accessibility tests (ARIA, screen reader)
- [ ] Performance tests (363 sessions)
- [ ] Responsive design tests (mobile, tablet, desktop)

### Phase 4: Documentation

- [ ] Update `libs/frontend/chat/CLAUDE.md`
- [ ] Update component usage examples
- [ ] Add screenshot/GIF of new UI
- [ ] Update developer handoff document

---

## Accessibility Checklist

### WCAG 2.1 AA Compliance

- [ ] **Keyboard Navigation**
  - [ ] Tab: Move focus between interactive elements
  - [ ] Arrow keys: Navigate within dropdown/overlay
  - [ ] Enter/Space: Activate buttons
  - [ ] Escape: Close dropdown/overlay
- [ ] **ARIA Attributes**
  - [ ] `role="menu"` on dropdown
  - [ ] `role="dialog"` on overlay
  - [ ] `aria-expanded` on dropdown trigger
  - [ ] `aria-modal="true"` on overlay
  - [ ] `aria-labelledby` on overlay title
  - [ ] `aria-label` on all buttons
- [ ] **Focus Management**
  - [ ] Focus trap in overlay
  - [ ] Focus restoration after overlay close
  - [ ] Visible focus indicators (outline)
- [ ] **Screen Reader Support**
  - [ ] Status announcements (session switched)
  - [ ] Descriptive labels for all interactive elements
  - [ ] Proper heading hierarchy
- [ ] **Color Contrast**
  - [ ] Text: 4.5:1 minimum
  - [ ] Interactive elements: 3:1 minimum
  - [ ] Test with high contrast themes
- [ ] **Motion**
  - [ ] Respect `prefers-reduced-motion`
  - [ ] Disable animations for reduced motion

---

## Performance Checklist

### Initial Load

- [ ] Empty state renders in < 50ms
- [ ] No sessions loaded on empty state
- [ ] Dropdown renders in < 50ms (5-10 sessions)
- [ ] Search overlay lazy-loads (code splitting)

### Search Overlay

- [ ] Search input debounced (300ms)
- [ ] Virtual scrolling with `content-visibility: auto`
- [ ] Smooth 60fps scrolling with 363 sessions
- [ ] Memory usage < 10MB with all sessions loaded

### Interaction

- [ ] Dropdown open: < 100ms
- [ ] Session switch: < 500ms
- [ ] Search filter: < 50ms (debounced)
- [ ] Overlay close: < 200ms

---

## Next Steps

1. **Review & Approval**: Get approval from team for UX strategy
2. **Implementation**: Follow Phase 1-4 integration checklist
3. **Testing**: Run full test suite (unit, integration, accessibility)
4. **Documentation**: Update CLAUDE.md and user documentation
5. **Deployment**: Merge to main branch and publish extension update

**Estimated Total Time**: 12 hours (4h + 4h + 4h for creation, integration, testing/polish)
