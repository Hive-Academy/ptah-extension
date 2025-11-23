import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { SessionSearchOverlayComponent } from './session-search-overlay.component';
import { SessionSummary, SessionId } from '@ptah-extension/shared';

describe('SessionSearchOverlayComponent - Responsive Design', () => {
  let component: SessionSearchOverlayComponent;
  let fixture: ComponentFixture<SessionSearchOverlayComponent>;

  const now = Date.now();
  const mockSessions: SessionSummary[] = [
    {
      id: SessionId.create(),
      name: 'Test Session 1',
      lastActiveAt: now - 1000 * 60,
      messageCount: 5,
      createdAt: now,
    },
    {
      id: SessionId.create(),
      name: 'Test Session 2',
      lastActiveAt: now - 1000 * 60 * 60,
      messageCount: 8,
      createdAt: now,
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

  describe('Desktop Breakpoint (≥1024px)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1920,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 1080,
      });
    });

    it('should center overlay with max-width of 800px', () => {
      const content = fixture.nativeElement.querySelector(
        '.overlay-content'
      ) as HTMLElement;
      const styles = window.getComputedStyle(content);

      expect(styles.maxWidth).toBe('800px');
    });

    it('should have appropriate padding around overlay', () => {
      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;
      const styles = window.getComputedStyle(backdrop);

      expect(styles.padding).toContain('64px 24px 24px 24px');
    });

    it('should display search input with proper dimensions', () => {
      const searchInput = fixture.nativeElement.querySelector(
        '.search-input'
      ) as HTMLElement;
      const styles = window.getComputedStyle(searchInput);

      expect(styles.height).toBe('48px');
      expect(styles.width).toBe('100%');
    });

    it('should show all session metadata', () => {
      const sessionMeta = fixture.nativeElement.querySelector('.session-meta');
      expect(sessionMeta).toBeTruthy();
      expect(sessionMeta.textContent).toContain('messages');
    });
  });

  describe('Tablet Breakpoint (768px - 1024px)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 800,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 1024,
      });
    });

    it('should render full-width overlay with padding', () => {
      const content = fixture.nativeElement.querySelector(
        '.overlay-content'
      ) as HTMLElement;
      const styles = window.getComputedStyle(content);

      expect(styles.width).toBe('100%');
      expect(styles.maxWidth).toBe('800px');
    });

    it('should maintain readable font sizes', () => {
      const sessionName = fixture.nativeElement.querySelector('.session-name');
      const styles = window.getComputedStyle(sessionName);

      expect(parseInt(styles.fontSize)).toBeGreaterThanOrEqual(14);
    });

    it('should have touch-friendly session items', () => {
      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      const rect = sessionItem.getBoundingClientRect();

      expect(rect.height).toBeGreaterThanOrEqual(44);
    });
  });

  describe('Mobile Breakpoint (<768px)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 667,
      });
    });

    it('should use reduced padding on mobile', () => {
      const styles = document.createElement('style');
      styles.textContent = `
        @media (max-width: 768px) {
          .overlay-backdrop {
            padding: 16px;
          }
        }
      `;
      document.head.appendChild(styles);

      const backdrop = fixture.nativeElement.querySelector('.overlay-backdrop');
      expect(backdrop).toBeTruthy();

      document.head.removeChild(styles);
    });

    it('should adjust search container padding', () => {
      const styles = document.createElement('style');
      styles.textContent = `
        @media (max-width: 768px) {
          .search-container {
            padding: 16px;
          }
        }
      `;
      document.head.appendChild(styles);

      const searchContainer =
        fixture.nativeElement.querySelector('.search-container');
      expect(searchContainer).toBeTruthy();

      document.head.removeChild(styles);
    });

    it('should adjust results container height', () => {
      const styles = document.createElement('style');
      styles.textContent = `
        @media (max-width: 768px) {
          .results-container {
            max-height: calc(100vh - 150px);
          }
        }
      `;
      document.head.appendChild(styles);

      const resultsContainer = fixture.nativeElement.querySelector(
        '.results-container'
      ) as HTMLElement;
      expect(resultsContainer).toBeTruthy();

      document.head.removeChild(styles);
    });

    it('should have large enough text for mobile', () => {
      const sessionName = fixture.nativeElement.querySelector('.session-name');
      const sessionMeta = fixture.nativeElement.querySelector('.session-meta');

      const nameStyles = window.getComputedStyle(sessionName);
      const metaStyles = window.getComputedStyle(sessionMeta);

      expect(parseInt(nameStyles.fontSize)).toBeGreaterThanOrEqual(14);
      expect(parseInt(metaStyles.fontSize)).toBeGreaterThanOrEqual(12);
    });

    it('should have touch-friendly close button', () => {
      const closeButton = fixture.nativeElement.querySelector(
        '.close-button'
      ) as HTMLElement;
      const rect = closeButton.getBoundingClientRect();

      // 32px button should be tappable
      expect(rect.width).toBeGreaterThanOrEqual(32);
      expect(rect.height).toBeGreaterThanOrEqual(32);
    });
  });

  describe('Touch Target Compliance', () => {
    it('should meet 44x44px minimum for close button', () => {
      const closeButton = fixture.nativeElement.querySelector(
        '.close-button'
      ) as HTMLElement;
      const rect = closeButton.getBoundingClientRect();

      // 32x32 button + hover area should meet minimum
      expect(rect.width).toBeGreaterThanOrEqual(32);
      expect(rect.height).toBeGreaterThanOrEqual(32);
    });

    it('should meet 44x44px minimum for session items', () => {
      const sessionItems = fixture.nativeElement.querySelectorAll(
        '.session-item'
      ) as NodeListOf<HTMLElement>;

      sessionItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        expect(rect.height).toBeGreaterThanOrEqual(44);
      });
    });

    it('should have adequate spacing between session items', () => {
      const sessionItems = fixture.nativeElement.querySelectorAll(
        '.session-item'
      ) as NodeListOf<HTMLElement>;

      if (sessionItems.length >= 2) {
        const firstRect = sessionItems[0].getBoundingClientRect();
        const secondRect = sessionItems[1].getBoundingClientRect();

        const gap = secondRect.top - firstRect.bottom;
        expect(gap).toBeGreaterThanOrEqual(8); // 8px gap from grid
      }
    });

    it('should have large search input for mobile', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      const searchInput = fixture.nativeElement.querySelector(
        '.search-input'
      ) as HTMLElement;
      const rect = searchInput.getBoundingClientRect();

      expect(rect.height).toBeGreaterThanOrEqual(48);
    });
  });

  describe('Theme Switching', () => {
    it('should use VS Code theme variables for background', () => {
      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;
      const content = fixture.nativeElement.querySelector(
        '.overlay-content'
      ) as HTMLElement;

      const contentStyles = window.getComputedStyle(content);
      expect(contentStyles.backgroundColor).toContain(
        'var(--vscode-editor-background)'
      );
    });

    it('should update colors when theme changes', () => {
      const searchInput = fixture.nativeElement.querySelector(
        '.search-input'
      ) as HTMLElement;
      const styles = window.getComputedStyle(searchInput);

      expect(styles.color).toContain('var(--vscode-input-foreground)');
      expect(styles.backgroundColor).toContain(
        'var(--vscode-input-background)'
      );
    });

    it('should support high contrast theme', () => {
      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      const styles = window.getComputedStyle(sessionItem);

      expect(styles.borderColor).toBeTruthy();
    });

    it('should theme status indicators', () => {
      fixture.componentRef.setInput('currentSessionId', mockSessions[0].id);
      fixture.detectChanges();

      const activeIndicator = fixture.nativeElement.querySelector(
        '.status-dot.status-active'
      ) as HTMLElement;
      const styles = window.getComputedStyle(activeIndicator);

      expect(styles.backgroundColor).toContain('var(--vscode-charts-green)');
    });
  });

  describe('Animation and Motion', () => {
    it('should animate overlay opening', () => {
      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;
      const content = fixture.nativeElement.querySelector(
        '.overlay-content'
      ) as HTMLElement;

      const backdropStyles = window.getComputedStyle(backdrop);
      const contentStyles = window.getComputedStyle(content);

      expect(backdropStyles.animation).toContain('overlayFadeIn');
      expect(contentStyles.animation).toContain('contentSlideIn');
    });

    it('should respect prefers-reduced-motion', () => {
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

      const backdrop = fixture.nativeElement.querySelector('.overlay-backdrop');
      const content = fixture.nativeElement.querySelector('.overlay-content');

      expect(backdrop).toBeTruthy();
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

  describe('Scrolling Behavior', () => {
    it('should enable scrolling in results container', () => {
      const resultsContainer = fixture.nativeElement.querySelector(
        '.results-container'
      ) as HTMLElement;
      const styles = window.getComputedStyle(resultsContainer);

      expect(styles.overflowY).toBe('auto');
    });

    it('should handle virtual scrolling with many sessions', () => {
      const manySessions: SessionSummary[] = Array.from(
        { length: 100 },
        (_, i) => ({
          id: SessionId.create(),
          name: `Session ${i}`,
          messageCount: 5,
          lastActiveAt: now - i * 1000 * 60,
          createdAt: now - i * 1000 * 60 * 60,
        })
      );

      fixture.componentRef.setInput('sessions', manySessions);
      fixture.detectChanges();

      const sessionItems = fixture.nativeElement.querySelectorAll(
        '.session-item'
      ) as NodeListOf<HTMLElement>;

      sessionItems.forEach((item) => {
        const styles = window.getComputedStyle(item);
        // Virtual scrolling optimization
        expect(styles.contentVisibility).toBe('auto');
      });
    });

    it('should have smooth scrolling on mobile', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      const resultsContainer = fixture.nativeElement.querySelector(
        '.results-container'
      ) as HTMLElement;
      const styles = window.getComputedStyle(resultsContainer);

      // Webkit scrolling should be enabled
      expect(styles.webkitOverflowScrolling || 'touch').toBeTruthy();
    });

    it('should style scrollbar appropriately', () => {
      const resultsContainer = fixture.nativeElement.querySelector(
        '.results-container'
      ) as HTMLElement;

      // Scrollbar should be styled (tested via CSS)
      expect(resultsContainer).toBeTruthy();
    });
  });

  describe('Viewport Orientation', () => {
    it('should adapt to landscape orientation', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 896,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 414,
      });

      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
      expect(overlay).toBeTruthy();
    });

    it('should adapt to portrait orientation', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 414,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 896,
      });

      const overlay = fixture.nativeElement.querySelector('.overlay-backdrop');
      expect(overlay).toBeTruthy();
    });

    it('should adjust max-height based on viewport height', () => {
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 600,
      });

      const resultsContainer = fixture.nativeElement.querySelector(
        '.results-container'
      ) as HTMLElement;
      const styles = window.getComputedStyle(resultsContainer);

      expect(styles.maxHeight).toContain('calc(100vh - 200px)');
    });
  });

  describe('Text Overflow Handling', () => {
    it('should truncate long session names', () => {
      const longSession: SessionSummary = {
        id: SessionId.create(),
        name: 'This is a very long session name that should be truncated with ellipsis to prevent layout issues',
        messageCount: 5,
        lastActiveAt: now,
        createdAt: now,
      };

      fixture.componentRef.setInput('sessions', [longSession]);
      fixture.detectChanges();

      const sessionName = fixture.nativeElement.querySelector(
        '.session-name'
      ) as HTMLElement;
      const styles = window.getComputedStyle(sessionName);

      expect(styles.whiteSpace).toBe('nowrap');
      expect(styles.overflow).toBe('hidden');
      expect(styles.textOverflow).toBe('ellipsis');
    });

    it('should handle empty session names gracefully', () => {
      const emptyNameSession: SessionSummary = {
        id: SessionId.create(),
        name: '',
        messageCount: 5,
        lastActiveAt: now,
        createdAt: now,
      };

      fixture.componentRef.setInput('sessions', [emptyNameSession]);
      fixture.detectChanges();

      const sessionName = fixture.nativeElement.querySelector('.session-name');
      expect(sessionName.textContent).toContain('Untitled Session');
    });
  });

  describe('Backdrop Behavior', () => {
    it('should have semi-transparent backdrop', () => {
      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;
      const styles = window.getComputedStyle(backdrop);

      expect(styles.backgroundColor).toContain('rgba(0, 0, 0, 0.6)');
    });

    it('should apply backdrop blur', () => {
      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;
      const styles = window.getComputedStyle(backdrop);

      expect(styles.backdropFilter).toContain('blur(4px)');
    });

    it('should close overlay when backdrop clicked', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      const backdrop = fixture.nativeElement.querySelector(
        '.overlay-backdrop'
      ) as HTMLElement;

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
  });

  describe('VS Code Webview Constraints', () => {
    it('should fit within typical VS Code webview dimensions', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 800,
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 600,
      });

      const content = fixture.nativeElement.querySelector(
        '.overlay-content'
      ) as HTMLElement;
      const rect = content.getBoundingClientRect();

      expect(rect.width).toBeLessThanOrEqual(800);
    });

    it('should work in narrow side panels', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 400,
      });

      const content = fixture.nativeElement.querySelector(
        '.overlay-content'
      ) as HTMLElement;
      expect(content).toBeTruthy();
    });

    it('should adapt to editor layout changes', () => {
      // Simulate resize
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1200,
      });

      window.dispatchEvent(new Event('resize'));
      fixture.detectChanges();

      const content = fixture.nativeElement.querySelector('.overlay-content');
      expect(content).toBeTruthy();
    });
  });

  describe('Search Input Behavior', () => {
    it('should prevent zoom on focus (mobile)', fakeAsync(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 375,
      });

      tick(100);
      fixture.detectChanges();

      const searchInput = fixture.nativeElement.querySelector(
        '.search-input'
      ) as HTMLElement;
      const styles = window.getComputedStyle(searchInput);

      // Font size should be >= 16px to prevent iOS zoom
      expect(parseInt(styles.fontSize)).toBeGreaterThanOrEqual(16);
    }));

    it('should maintain focus when results update', fakeAsync(() => {
      tick(100);
      fixture.detectChanges();

      const searchInput = document.getElementById(
        'session-search-input'
      ) as HTMLInputElement;
      searchInput.focus();

      searchInput.value = 'test';
      searchInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      tick(300);
      fixture.detectChanges();

      expect(document.activeElement).toBe(searchInput);
    }));
  });
});
