import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { PopoverComponent } from './popover.component';


/**
 * Test host component to provide required inputs and test interactions
 */
@Component({
  standalone: true,
  imports: [PopoverComponent],
  template: `
    <lib-popover
      [isOpen]="isOpen()"
      [position]="position()"
      [hasBackdrop]="hasBackdrop()"
      [backdropClass]="backdropClass()"
      (opened)="onOpened()"
      (closed)="onClosed()"
      (backdropClicked)="onBackdropClicked()"
    >
      <button trigger id="trigger-btn">Open Popover</button>
      <div content class="popover-content">
        <button id="first-btn">First Button</button>
        <button id="second-btn">Second Button</button>
      </div>
    </lib-popover>
  `,
})
class TestHostComponent {
  isOpen = signal(false);
  position = signal<'above' | 'below' | 'before' | 'after'>('below');
  hasBackdrop = signal(true);
  backdropClass = signal('cdk-overlay-transparent-backdrop');

  openedCount = 0;
  closedCount = 0;
  backdropClickedCount = 0;

  onOpened(): void {
    this.openedCount++;
  }

  onClosed(): void {
    this.closedCount++;
  }

  onBackdropClicked(): void {
    this.backdropClickedCount++;
  }
}

describe('PopoverComponent', () => {
  let hostComponent: TestHostComponent;
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PopoverComponent, TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    hostComponent = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(hostComponent).toBeTruthy();
  });

  describe('Opening and Closing', () => {
    it('should emit opened event when popover opens', async () => {
      expect(hostComponent.openedCount).toBe(0);

      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(hostComponent.openedCount).toBe(1);
    });

    it('should emit closed event when popover closes', async () => {
      // Open popover first
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(hostComponent.closedCount).toBe(0);

      // Close popover
      hostComponent.isOpen.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(hostComponent.closedCount).toBe(1);
    });

    it('should render popover content when open', async () => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const popoverContent = document.querySelector('.popover-content');
      expect(popoverContent).toBeTruthy();

      const firstBtn = document.querySelector('#first-btn');
      expect(firstBtn).toBeTruthy();
      expect(firstBtn?.textContent).toContain('First Button');
    });

    it('should not render popover content when closed', () => {
      hostComponent.isOpen.set(false);
      fixture.detectChanges();

      const popoverContent = document.querySelector('.popover-content');
      expect(popoverContent).toBeFalsy();
    });
  });

  describe('Focus Trap', () => {
    it('should render popover content with focusable elements', async () => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      // Verify focus trap container exists
      const popoverPanel = document.querySelector('.popover-panel');
      expect(popoverPanel).toBeTruthy();

      // Verify focusable buttons are rendered
      const firstBtn = document.querySelector('#first-btn') as HTMLElement;
      const secondBtn = document.querySelector('#second-btn') as HTMLElement;
      expect(firstBtn).toBeTruthy();
      expect(secondBtn).toBeTruthy();

      // Verify buttons are focusable (not disabled, no tabindex=-1)
      expect(firstBtn.getAttribute('disabled')).toBeFalsy();
      expect(secondBtn.getAttribute('disabled')).toBeFalsy();
    });

    it('should destroy focus trap when popover closes', async () => {
      // Open popover
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const popoverPanel = document.querySelector('.popover-panel');
      expect(popoverPanel).toBeTruthy();

      // Close popover
      hostComponent.isOpen.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      // Verify popover is removed from DOM
      const popoverPanelAfterClose = document.querySelector('.popover-panel');
      expect(popoverPanelAfterClose).toBeFalsy();

      // Verify closed event was emitted
      expect(hostComponent.closedCount).toBe(1);
    });
  });

  describe('Backdrop Interaction', () => {
    it('should emit backdropClicked and closed when backdrop is clicked', async () => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(hostComponent.backdropClickedCount).toBe(0);
      expect(hostComponent.closedCount).toBe(0);

      // Find and click backdrop
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop).toBeTruthy();

      (backdrop as HTMLElement).click();
      fixture.detectChanges();

      expect(hostComponent.backdropClickedCount).toBe(1);
      expect(hostComponent.closedCount).toBe(1);
    });

    it('should apply transparent backdrop class by default', async () => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(
        backdrop?.classList.contains('cdk-overlay-transparent-backdrop')
      ).toBe(true);
    });

    it('should apply dark backdrop class when specified', async () => {
      hostComponent.backdropClass.set('cdk-overlay-dark-backdrop');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop?.classList.contains('cdk-overlay-dark-backdrop')).toBe(
        true
      );
    });
  });

  describe('Escape Key Handling', () => {
    it('should emit closed event when Escape key is pressed', async () => {
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(hostComponent.closedCount).toBe(0);

      // Find popover panel and dispatch Escape key event
      const popoverPanel = document.querySelector(
        '.popover-panel'
      ) as HTMLElement;
      expect(popoverPanel).toBeTruthy();

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      popoverPanel.dispatchEvent(escapeEvent);
      fixture.detectChanges();

      expect(hostComponent.closedCount).toBe(1);
    });
  });

  describe('Position Variants', () => {
    it('should render popover in below position', async () => {
      hostComponent.position.set('below');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const popoverContent = document.querySelector('.popover-content');
      expect(popoverContent).toBeTruthy();
    });

    it('should render popover in above position', async () => {
      hostComponent.position.set('above');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const popoverContent = document.querySelector('.popover-content');
      expect(popoverContent).toBeTruthy();
    });

    it('should render popover in before position', async () => {
      hostComponent.position.set('before');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const popoverContent = document.querySelector('.popover-content');
      expect(popoverContent).toBeTruthy();
    });

    it('should render popover in after position', async () => {
      hostComponent.position.set('after');
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const popoverContent = document.querySelector('.popover-content');
      expect(popoverContent).toBeTruthy();
    });
  });

  describe('ARIA and Accessibility', () => {
    it('should render backdrop when hasBackdrop is true', async () => {
      hostComponent.hasBackdrop.set(true);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop).toBeTruthy();
    });

    it('should not render backdrop when hasBackdrop is false', async () => {
      hostComponent.hasBackdrop.set(false);
      hostComponent.isOpen.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop).toBeFalsy();
    });
  });
});
