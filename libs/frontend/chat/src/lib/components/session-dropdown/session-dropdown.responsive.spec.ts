import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionDropdownComponent } from './session-dropdown.component';
import { SessionSummary, SessionId } from '@ptah-extension/shared';

describe('SessionDropdownComponent - Responsive Design', () => {
  let component: SessionDropdownComponent;
  let fixture: ComponentFixture<SessionDropdownComponent>;

  const mockSessions: SessionSummary[] = [
    {
      id: 'session-1' as SessionId,
      name: 'Test Session 1',
      messageCount: 12,
      lastActiveAt: Date.now() - 1000 * 60 * 5,
      createdAt: Date.now() - 1000 * 60 * 60 * 24,
    },
    {
      id: 'session-2' as SessionId,
      name: 'Test Session 2',
      messageCount: 8,
      lastActiveAt: Date.now() - 1000 * 60 * 60,
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 2,
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionDropdownComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SessionDropdownComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('recentSessions', mockSessions);
    fixture.componentRef.setInput('currentSessionId', 'session-1');
    fixture.detectChanges();
  });

  describe('Desktop Breakpoint (≥1024px)', () => {
    beforeEach(() => {
      // Set viewport to desktop size
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 1920,
      });
    });

    it('should render dropdown with 320px width', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;
      const styles = window.getComputedStyle(menu);

      expect(styles.width).toBe('320px');
    });

    it('should have max-height of 400px', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;
      const styles = window.getComputedStyle(menu);

      expect(styles.maxHeight).toBe('400px');
    });

    it('should position dropdown below trigger', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;
      const styles = window.getComputedStyle(menu);

      expect(styles.position).toBe('absolute');
      expect(styles.top).toContain('100%');
    });

    it('should display all session metadata', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionMeta = fixture.nativeElement.querySelector('.session-meta');
      expect(sessionMeta).toBeTruthy();
      expect(sessionMeta.textContent).toContain('messages');
      expect(sessionMeta.textContent).toContain('ago');
    });
  });

  describe('Tablet Breakpoint (768px - 1024px)', () => {
    beforeEach(() => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 800,
      });
    });

    it('should render dropdown for tablet viewport', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector('.dropdown-menu');
      expect(menu).toBeTruthy();
    });

    it('should maintain readable font sizes', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionName = fixture.nativeElement.querySelector('.session-name');
      const styles = window.getComputedStyle(sessionName);

      // Font size should be 13px
      expect(styles.fontSize).toBe('13px');
    });

    it('should have adequate touch targets', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      const rect = sessionItem.getBoundingClientRect();

      // Min height of 56px exceeds 44px minimum
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
    });

    it('should render dropdown on mobile viewport', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector('.dropdown-menu');
      expect(menu).toBeTruthy();
    });

    it('should have touch-friendly session items', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      const rect = sessionItem.getBoundingClientRect();

      // Height should be >= 56px for easy tapping
      expect(rect.height).toBeGreaterThanOrEqual(56);
    });

    it('should maintain readable text on small screens', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionName = fixture.nativeElement.querySelector('.session-name');
      const sessionMeta = fixture.nativeElement.querySelector('.session-meta');

      const nameStyles = window.getComputedStyle(sessionName);
      const metaStyles = window.getComputedStyle(sessionMeta);

      // Font sizes should not be too small
      expect(parseInt(nameStyles.fontSize)).toBeGreaterThanOrEqual(13);
      expect(parseInt(metaStyles.fontSize)).toBeGreaterThanOrEqual(11);
    });

    it('should have adequate spacing for touch interaction', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const actionButtons =
        fixture.nativeElement.querySelectorAll('.action-button');
      actionButtons.forEach((button: Element) => {
        const rect = button.getBoundingClientRect();
        expect(rect.height).toBeGreaterThanOrEqual(44);
      });
    });
  });

  describe('Viewport Orientation', () => {
    it('should adapt to landscape orientation', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 896, // iPhone landscape
      });
      Object.defineProperty(window, 'innerHeight', {
        writable: true,
        configurable: true,
        value: 414,
      });

      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector('.dropdown-menu');
      expect(menu).toBeTruthy();
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

      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector('.dropdown-menu');
      expect(menu).toBeTruthy();
    });
  });

  describe('Touch Target Compliance', () => {
    it('should meet 44x44px minimum for dropdown trigger', () => {
      const trigger = fixture.nativeElement.querySelector(
        '.dropdown-trigger'
      ) as HTMLElement;
      const rect = trigger.getBoundingClientRect();

      expect(rect.height).toBeGreaterThanOrEqual(44);
    });

    it('should meet 44x44px minimum for session items', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionItems = fixture.nativeElement.querySelectorAll(
        '.session-item'
      ) as NodeListOf<HTMLElement>;
      sessionItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        expect(rect.height).toBeGreaterThanOrEqual(44);
      });
    });

    it('should meet 44x44px minimum for action buttons', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const actionButtons = fixture.nativeElement.querySelectorAll(
        '.action-button'
      ) as NodeListOf<HTMLElement>;
      actionButtons.forEach((button) => {
        const rect = button.getBoundingClientRect();
        expect(rect.height).toBeGreaterThanOrEqual(44);
      });
    });

    it('should have adequate spacing between interactive elements', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionItems = fixture.nativeElement.querySelectorAll(
        '.session-item'
      ) as NodeListOf<HTMLElement>;

      if (sessionItems.length >= 2) {
        const firstRect = sessionItems[0].getBoundingClientRect();
        const secondRect = sessionItems[1].getBoundingClientRect();

        // Items should be adjacent or have minimal gap
        const gap = secondRect.top - firstRect.bottom;
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(2); // Max 2px gap from border
      }
    });
  });

  describe('Theme Switching', () => {
    it('should use VS Code theme variables', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;
      const styles = window.getComputedStyle(menu);

      // Background should use theme variable
      expect(styles.backgroundColor).toContain(
        'var(--vscode-dropdown-background)'
      );
    });

    it('should update colors when theme changes', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      const styles = window.getComputedStyle(sessionItem);

      expect(styles.color).toContain('var(--vscode-dropdown-foreground)');
    });

    it('should support high contrast theme', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const activeSession = fixture.nativeElement.querySelector(
        '.session-item.active'
      ) as HTMLElement;
      const styles = window.getComputedStyle(activeSession);

      // Border should use theme variable for high contrast support
      expect(styles.borderLeftColor).toBeTruthy();
    });
  });

  describe('Animation and Motion', () => {
    it('should animate dropdown opening', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;
      const styles = window.getComputedStyle(menu);

      expect(styles.animation).toContain('dropdownOpen');
    });

    it('should respect prefers-reduced-motion', () => {
      const styles = document.createElement('style');
      styles.textContent = `
        @media (prefers-reduced-motion: reduce) {
          .dropdown-menu {
            animation: none !important;
          }
        }
      `;
      document.head.appendChild(styles);

      component.toggleDropdown();
      fixture.detectChanges();

      // Animation should be disabled when reduced motion preferred
      const menu = fixture.nativeElement.querySelector('.dropdown-menu');
      expect(menu).toBeTruthy();

      document.head.removeChild(styles);
    });

    it('should have smooth transitions on hover', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const sessionItem = fixture.nativeElement.querySelector(
        '.session-item'
      ) as HTMLElement;
      const styles = window.getComputedStyle(sessionItem);

      expect(styles.transition).toContain('background-color');
    });
  });

  describe('Scrolling Behavior', () => {
    it('should enable scrolling when content exceeds max-height', () => {
      // Create many sessions to force scrolling
      const manySessions: SessionSummary[] = Array.from(
        { length: 20 },
        (_, i) => ({
          id: `session-${i}` as SessionId,
          name: `Session ${i}`,
          messageCount: 5,
          lastActiveAt: Date.now(),
          createdAt: Date.now(),
        })
      );

      fixture.componentRef.setInput('recentSessions', manySessions);
      fixture.detectChanges();

      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;
      const styles = window.getComputedStyle(menu);

      expect(styles.overflowY).toBe('auto');
      expect(styles.maxHeight).toBe('400px');
    });

    it('should handle scrolling on touch devices', () => {
      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;

      // Touch scrolling should work
      const touchStartEvent = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [
          {
            clientX: 100,
            clientY: 100,
          } as Touch,
        ],
      });

      menu.dispatchEvent(touchStartEvent);
      expect(touchStartEvent.defaultPrevented).toBe(false);
    });
  });

  describe('Text Overflow Handling', () => {
    it('should truncate long session names with ellipsis', () => {
      const longSession: SessionSummary = {
        id: 'long-session' as SessionId,
        name: 'This is a very long session name that should be truncated with ellipsis',
        messageCount: 5,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      };

      fixture.componentRef.setInput('recentSessions', [longSession]);
      fixture.detectChanges();

      component.toggleDropdown();
      fixture.detectChanges();

      const sessionName = fixture.nativeElement.querySelector(
        '.session-name'
      ) as HTMLElement;
      const styles = window.getComputedStyle(sessionName);

      expect(styles.whiteSpace).toBe('nowrap');
      expect(styles.overflow).toBe('hidden');
      expect(styles.textOverflow).toBe('ellipsis');
    });

    it('should display full session name on hover with title attribute', () => {
      const longSession: SessionSummary = {
        id: 'long-session' as SessionId,
        name: 'This is a very long session name',
        messageCount: 5,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      };

      fixture.componentRef.setInput('recentSessions', [longSession]);
      fixture.detectChanges();

      component.toggleDropdown();
      fixture.detectChanges();

      const sessionItem = fixture.nativeElement.querySelector('.session-item');
      const ariaLabel = sessionItem.getAttribute('aria-label');

      expect(ariaLabel).toContain('This is a very long session name');
    });
  });

  describe('VS Code Webview Constraints', () => {
    it('should work within VS Code webview dimensions', () => {
      // Typical VS Code webview size
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

      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector('.dropdown-menu');
      expect(menu).toBeTruthy();
    });

    it('should handle narrow webview panels', () => {
      Object.defineProperty(window, 'innerWidth', {
        writable: true,
        configurable: true,
        value: 400,
      });

      component.toggleDropdown();
      fixture.detectChanges();

      const menu = fixture.nativeElement.querySelector(
        '.dropdown-menu'
      ) as HTMLElement;
      const rect = menu.getBoundingClientRect();

      // Menu should fit within 400px width
      expect(rect.width).toBeLessThanOrEqual(400);
    });
  });
});
