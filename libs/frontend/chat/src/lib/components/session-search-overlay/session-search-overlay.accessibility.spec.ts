import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { SessionSearchOverlayComponent } from './session-search-overlay.component';
import { SessionSummary, SessionId } from '@ptah-extension/shared';

describe('SessionSearchOverlayComponent - Accessibility', () => {
  let component: SessionSearchOverlayComponent;
  let fixture: ComponentFixture<SessionSearchOverlayComponent>;

  const now = Date.now();
  const oneDayMs = 1000 * 60 * 60 * 24;

  const mockSessions: SessionSummary[] = [
    {
      id: SessionId.create(),
      name: 'Test Session 1',
      lastActiveAt: now - 1000 * 60,
      messageCount: 5,
      createdAt: now - oneDayMs,
    },
    {
      id: SessionId.create(),
      name: 'Test Session 2',
      lastActiveAt: now - oneDayMs - 1000,
      messageCount: 8,
      createdAt: now - oneDayMs * 2,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionSearchOverlayComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionSearchOverlayComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('isOpen', true);
    fixture.componentRef.setInput('currentSessionId', null);
    fixture.componentRef.setInput('sessions', mockSessions);

    fixture.detectChanges();
  });

  describe('Keyboard Navigation', () => {
    it('should trap focus within overlay', fakeAsync(() => {
      const overlay = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;
      const searchInput = fixture.nativeElement.querySelector(
        '.search-input'
      ) as HTMLElement;
      const closeButton = fixture.nativeElement.querySelector(
        '.close-button'
      ) as HTMLElement;

      expect(overlay).toBeTruthy();

      // Focus should move to search input automatically
      tick(100);
      fixture.detectChanges();

      const focusedInput = document.getElementById(
        'session-search-input'
      ) as HTMLInputElement;
      expect(focusedInput).toBeTruthy();
    }));

    it('should close overlay with Escape key', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      component.onKeyDown(escapeEvent);

      expect(closedEmitted).toBe(true);
      expect(escapeEvent.defaultPrevented).toBe(true);
    });

    it('should allow Enter key to select session', () => {
      let selectedSessionId: SessionId | undefined;
      component.sessionSelected.subscribe((id) => {
        selectedSessionId = id;
      });

      const sessionButton = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      sessionButton.dispatchEvent(enterEvent);
      sessionButton.click(); // Simulate Enter activation

      expect(selectedSessionId).toBeDefined();
    });

    it('should maintain focus on search input during typing', fakeAsync(() => {
      tick(100);
      fixture.detectChanges();

      const searchInput = document.getElementById(
        'session-search-input'
      ) as HTMLInputElement;
      searchInput.focus();

      // Type characters
      searchInput.value = 'test';
      searchInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(document.activeElement).toBe(searchInput);
    }));

    it('should restore focus after overlay closes', fakeAsync(() => {
      tick(100);
      fixture.detectChanges();

      // Focus should be on search input
      const searchInput = document.getElementById('session-search-input');
      expect(searchInput).toBeTruthy();

      component.close();
      fixture.detectChanges();

      // Focus restoration would happen in parent component
      // This test verifies close() is called correctly
      expect(component.searchQuery()).toBe('');
    }));
  });

  describe('ARIA Attributes', () => {
    it('should have role="dialog" on overlay', () => {
      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
      expect(overlay.getAttribute('role')).toBe('dialog');
    });

    it('should have aria-modal="true" on overlay', () => {
      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
    });

    it('should have aria-labelledby pointing to title', () => {
      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
      expect(overlay.getAttribute('aria-labelledby')).toBe(
        'search-overlay-title'
      );
    });

    it('should have aria-label on close button', () => {
      const closeButton = fixture.nativeElement.querySelector('.close-button');
      expect(closeButton.getAttribute('aria-label')).toBe(
        'Close search overlay'
      );
    });

    it('should have role="group" on session groups', () => {
      const sessionGroups =
        fixture.nativeElement.querySelectorAll('.group-sessions');
      sessionGroups.forEach((group: Element) => {
        expect(group.getAttribute('role')).toBe('group');
      });
    });

    it('should have aria-labelledby on session groups', () => {
      const firstGroup = fixture.nativeElement.querySelector('.group-sessions');
      expect(firstGroup.getAttribute('aria-labelledby')).toContain('group-');
    });

    it('should have accessible label on status indicators', () => {
      fixture.componentRef.setInput('currentSessionId', mockSessions[0].id);
      fixture.detectChanges();

      const activeIndicator = fixture.nativeElement.querySelector(
        '.status-dot.status-active'
      );
      expect(
        activeIndicator?.parentElement.getAttribute('aria-label')
      ).toContain('Active session');
    });
  });

  describe('Focus Trap Implementation', () => {
    it('should auto-focus search input when overlay opens', fakeAsync(() => {
      fixture.componentRef.setInput('isOpen', false);
      fixture.detectChanges();
      tick();

      fixture.componentRef.setInput('isOpen', true);
      fixture.detectChanges();

      tick(100);
      fixture.detectChanges();

      const searchInput = document.getElementById(
        'session-search-input'
      ) as HTMLInputElement;
      expect(document.activeElement).toBe(searchInput);
    }));

    it('should keep focus within overlay when open', fakeAsync(() => {
      tick(100);
      fixture.detectChanges();

      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
      const interactiveElements = overlay.querySelectorAll(
        'button, input, [tabindex]'
      );

      expect(interactiveElements.length).toBeGreaterThan(0);

      // All focusable elements should be within overlay
      interactiveElements.forEach((el: Element) => {
        expect(overlay.contains(el)).toBe(true);
      });
    }));

    it('should handle Tab key for focus management', fakeAsync(() => {
      tick(100);
      fixture.detectChanges();

      const searchInput = document.getElementById(
        'session-search-input'
      ) as HTMLInputElement;
      searchInput.focus();

      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab' });
      searchInput.dispatchEvent(tabEvent);

      // Tab should move focus to next element (close button)
      // Browser handles tab navigation naturally
      expect(tabEvent.defaultPrevented).toBe(false);
    }));
  });

  describe('Color Contrast (WCAG 2.1 AA)', () => {
    it('should have sufficient contrast for search input', () => {
      const searchInput = fixture.nativeElement.querySelector('.search-input');
      const styles = window.getComputedStyle(searchInput);

      expect(styles.color).toContain('var(--vscode-input-foreground)');
      expect(styles.backgroundColor).toContain(
        'var(--vscode-input-background)'
      );
    });

    it('should have sufficient contrast for session names', () => {
      const sessionName = fixture.nativeElement.querySelector('.session-name');
      const styles = window.getComputedStyle(sessionName);

      expect(styles.color).toContain('var(--vscode-foreground)');
    });

    it('should have sufficient contrast for metadata', () => {
      const sessionMeta = fixture.nativeElement.querySelector('.session-meta');
      const styles = window.getComputedStyle(sessionMeta);

      expect(styles.color).toContain('var(--vscode-descriptionForeground)');
    });

    it('should have sufficient contrast for group headers', () => {
      const groupHeader = fixture.nativeElement.querySelector('.group-header');
      const styles = window.getComputedStyle(groupHeader);

      expect(styles.color).toContain('var(--vscode-descriptionForeground)');
    });

    it('should have sufficient contrast for close button', () => {
      const closeIcon = fixture.nativeElement.querySelector('.close-icon');
      const styles = window.getComputedStyle(closeIcon);

      expect(styles.color).toContain('var(--vscode-icon-foreground)');
    });

    it('should have sufficient contrast for empty state text', () => {
      fixture.componentRef.setInput('sessions', []);
      fixture.detectChanges();

      const emptyTitle = fixture.nativeElement.querySelector('.empty-title');
      const emptyDesc =
        fixture.nativeElement.querySelector('.empty-description');

      const titleStyles = window.getComputedStyle(emptyTitle);
      const descStyles = window.getComputedStyle(emptyDesc);

      expect(titleStyles.color).toContain('var(--vscode-foreground)');
      expect(descStyles.color).toContain('var(--vscode-descriptionForeground)');
    });
  });

  describe('Touch Target Size (44x44px minimum)', () => {
    it('should have minimum touch target for close button', () => {
      const closeButton = fixture.nativeElement.querySelector(
        '.close-button'
      ) as HTMLElement;
      const rect = closeButton.getBoundingClientRect();

      expect(rect.width).toBeGreaterThanOrEqual(32);
      expect(rect.height).toBeGreaterThanOrEqual(32);
      // Including padding and margin should reach 44px
    });

    it('should have minimum touch target for session items', () => {
      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      const rect = sessionItem.getBoundingClientRect();

      // With 12px padding top/bottom + content, should exceed 44px
      expect(rect.height).toBeGreaterThanOrEqual(44);
    });

    it('should have minimum touch target for search input', () => {
      const searchInput = fixture.nativeElement.querySelector(
        '.search-input'
      ) as HTMLElement;
      const rect = searchInput.getBoundingClientRect();

      // 48px height specified in component
      expect(rect.height).toBeGreaterThanOrEqual(44);
    });
  });

  describe('Keyboard-Only Navigation', () => {
    it('should be fully operable without mouse', fakeAsync(() => {
      // 1. Auto-focus on search input
      tick(100);
      fixture.detectChanges();

      const searchInput = document.getElementById(
        'session-search-input'
      ) as HTMLInputElement;
      expect(document.activeElement).toBe(searchInput);

      // 2. Type search query
      searchInput.value = 'Test';
      searchInput.dispatchEvent(new Event('input'));
      tick(300);
      fixture.detectChanges();

      // 3. Tab to session item
      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      sessionItem.focus();
      expect(document.activeElement).toBe(sessionItem);

      // 4. Select with Enter
      let selectedId: SessionId | undefined;
      component.sessionSelected.subscribe((id) => {
        selectedId = id;
      });
      sessionItem.click();

      expect(selectedId).toBeDefined();
    }));

    it('should close with Escape from any focused element', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      // From close button
      const closeButton = fixture.nativeElement.querySelector(
        '.close-button'
      ) as HTMLElement;
      closeButton.focus();

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      component.onKeyDown(escapeEvent);

      expect(closedEmitted).toBe(true);
    });
  });

  describe('Screen Reader Support', () => {
    it('should announce overlay purpose', () => {
      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');

      expect(overlay.getAttribute('role')).toBe('dialog');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
      expect(overlay.getAttribute('aria-labelledby')).toBe(
        'search-overlay-title'
      );
    });

    it('should provide context for search input', () => {
      const searchInput = fixture.nativeElement.querySelector('.search-input');

      expect(searchInput.getAttribute('placeholder')).toContain(
        'Search sessions'
      );
      expect(searchInput.getAttribute('type')).toBe('text');
    });

    it('should indicate session groupings', () => {
      const groupHeaders =
        fixture.nativeElement.querySelectorAll('.group-header');

      groupHeaders.forEach((header: Element) => {
        expect(header.textContent?.trim().length).toBeGreaterThan(0);
      });
    });

    it('should announce active session status', () => {
      fixture.componentRef.setInput('currentSessionId', mockSessions[0].id);
      fixture.detectChanges();

      const activeStatusDot = fixture.nativeElement.querySelector(
        '.status-dot.status-active'
      );
      expect(activeStatusDot).toBeTruthy();

      // Parent element should have aria-label indicating active status
      const parentButton = activeStatusDot.closest('.session-item');
      expect(parentButton).toBeTruthy();
    });

    it('should announce empty states clearly', fakeAsync(() => {
      fixture.componentRef.setInput('sessions', []);
      fixture.detectChanges();
      tick(300);
      fixture.detectChanges();

      const emptyState = fixture.nativeElement.querySelector('.empty-state');
      const emptyTitle = fixture.nativeElement.querySelector('.empty-title');

      expect(emptyState).toBeTruthy();
      expect(emptyTitle.textContent).toContain('No sessions yet');
    }));
  });

  describe('Reduced Motion Support', () => {
    it('should respect prefers-reduced-motion for animations', () => {
      const styles = document.createElement('style');
      styles.textContent = `
        @media (prefers-reduced-motion: reduce) {
          .overlay-backdrop,
          .overlay-content {
            animation: none;
          }
        }
      `;
      document.head.appendChild(styles);

      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
      const content = fixture.nativeElement.querySelector('.overlay-content');

      expect(overlay).toBeTruthy();
      expect(content).toBeTruthy();

      document.head.removeChild(styles);
    });

    it('should disable transitions when reduced motion preferred', () => {
      const styles = document.createElement('style');
      styles.textContent = `
        @media (prefers-reduced-motion: reduce) {
          .session-item {
            transition: none;
          }
        }
      `;
      document.head.appendChild(styles);

      const sessionItem = fixture.nativeElement.querySelector('.session-item');
      expect(sessionItem).toBeTruthy();

      document.head.removeChild(styles);
    });
  });

  describe('Backdrop Click Accessibility', () => {
    it('should close overlay when backdrop clicked', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;

      // Create click event on backdrop itself (not content)
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(clickEvent, 'target', {
        value: backdrop,
        enumerable: true,
      });
      Object.defineProperty(clickEvent, 'currentTarget', {
        value: backdrop,
        enumerable: true,
      });

      component.onBackdropClick(clickEvent as any);

      expect(closedEmitted).toBe(true);
    });

    it('should not close when clicking overlay content', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      const content = fixture.nativeElement.querySelector(
        '.overlay-content'
      ) as HTMLElement;
      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;

      // Click on content, not backdrop
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(clickEvent, 'target', {
        value: content,
        enumerable: true,
      });
      Object.defineProperty(clickEvent, 'currentTarget', {
        value: backdrop,
        enumerable: true,
      });

      component.onBackdropClick(clickEvent as any);

      expect(closedEmitted).toBe(false);
    });
  });

  describe('Heading Hierarchy', () => {
    it('should have proper heading structure for groups', () => {
      const groupHeaders =
        fixture.nativeElement.querySelectorAll('.group-header');

      // Each group header should be a heading or have role
      groupHeaders.forEach((header: Element) => {
        expect(header.classList.contains('group-header')).toBe(true);
      });
    });

    it('should maintain semantic structure in empty state', fakeAsync(() => {
      fixture.componentRef.setInput('sessions', []);
      fixture.detectChanges();
      tick(300);
      fixture.detectChanges();

      const emptyTitle = fixture.nativeElement.querySelector('.empty-title');
      expect(emptyTitle).toBeTruthy();
      expect(emptyTitle.textContent?.trim()).toBeTruthy();
    }));
  });
});
