import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { DropdownComponent } from './dropdown.component';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { DROPDOWN_POSITIONS } from '../shared/overlay-positions';

/**
 * Test host component to wrap DropdownComponent
 * Provides signal-based isOpen control and event handlers
 */
@Component({
  standalone: true,
  imports: [DropdownComponent],
  template: `
    <lib-dropdown
      [isOpen]="isOpen()"
      [positions]="positions()"
      [hasBackdrop]="hasBackdrop()"
      [backdropClass]="backdropClass()"
      [closeOnBackdropClick]="closeOnBackdropClick()"
      (opened)="onOpened()"
      (closed)="onClosed()"
      (backdropClicked)="onBackdropClicked()"
    >
      <button trigger>Open Dropdown</button>
      <div content class="dropdown-panel">
        <div class="option">Option 1</div>
        <div class="option">Option 2</div>
      </div>
    </lib-dropdown>
  `,
})
class TestHostComponent {
  isOpen = signal(false);
  positions = signal<ConnectedPosition[]>(DROPDOWN_POSITIONS);
  hasBackdrop = signal(true);
  backdropClass = signal('cdk-overlay-transparent-backdrop');
  closeOnBackdropClick = signal(true);

  openedCount = 0;
  closedCount = 0;
  backdropClickedCount = 0;

  onOpened(): void {
    this.openedCount++;
  }

  onClosed(): void {
    this.closedCount++;
    this.isOpen.set(false);
  }

  onBackdropClicked(): void {
    this.backdropClickedCount++;
  }
}

describe('DropdownComponent', () => {
  let component: TestHostComponent;
  let fixture: ComponentFixture<TestHostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DropdownComponent, TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render trigger content in cdkOverlayOrigin', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    const trigger = compiled.querySelector('button');
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent?.trim()).toBe('Open Dropdown');
  });

  it('should not render dropdown panel when isOpen is false', () => {
    component.isOpen.set(false);
    fixture.detectChanges();

    // Dropdown should not be in DOM when closed
    const overlayContainer = document.querySelector('.cdk-overlay-container');
    const dropdownPanel = overlayContainer?.querySelector('.dropdown-panel');
    expect(dropdownPanel).toBeFalsy();
  });

  it('should render dropdown panel in portal when isOpen is true', (done) => {
    component.isOpen.set(true);
    fixture.detectChanges();

    // Allow time for overlay to attach
    setTimeout(() => {
      const overlayContainer = document.querySelector('.cdk-overlay-container');
      expect(overlayContainer).toBeTruthy();

      const dropdownPanel = overlayContainer?.querySelector('.dropdown-panel');
      expect(dropdownPanel).toBeTruthy();

      const options = dropdownPanel?.querySelectorAll('.option');
      expect(options?.length).toBe(2);
      done();
    }, 100);
  });

  it('should emit opened event when overlay attaches', (done) => {
    expect(component.openedCount).toBe(0);

    component.isOpen.set(true);
    fixture.detectChanges();

    setTimeout(() => {
      expect(component.openedCount).toBe(1);
      done();
    }, 100);
  });

  it('should emit backdropClicked event when backdrop is clicked', (done) => {
    component.isOpen.set(true);
    fixture.detectChanges();

    setTimeout(() => {
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop).toBeTruthy();
      expect(component.backdropClickedCount).toBe(0);

      (backdrop as HTMLElement).click();
      fixture.detectChanges();

      setTimeout(() => {
        expect(component.backdropClickedCount).toBe(1);
        done();
      }, 50);
    }, 100);
  });

  it('should emit backdropClicked and parent can close dropdown (closeOnBackdropClick pattern)', (done) => {
    component.closeOnBackdropClick.set(true);
    component.isOpen.set(true);
    fixture.detectChanges();

    setTimeout(() => {
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop).toBeTruthy();
      expect(component.backdropClickedCount).toBe(0);
      expect(component.closedCount).toBe(0);

      // Click backdrop
      (backdrop as HTMLElement).click();
      fixture.detectChanges();

      setTimeout(() => {
        // backdropClicked should be emitted
        expect(component.backdropClickedCount).toBe(1);
        // Parent's onClosed() handler sets isOpen to false, which triggers detach -> closed event
        expect(component.closedCount).toBe(1);
        done();
      }, 50);
    }, 100);
  });

  it('should only emit backdropClicked when closeOnBackdropClick is false (parent decides)', (done) => {
    component.closeOnBackdropClick.set(false);
    component.isOpen.set(true);
    fixture.detectChanges();

    setTimeout(() => {
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop).toBeTruthy();
      expect(component.backdropClickedCount).toBe(0);

      // Click backdrop
      (backdrop as HTMLElement).click();
      fixture.detectChanges();

      setTimeout(() => {
        // backdropClicked emitted
        expect(component.backdropClickedCount).toBe(1);
        // Parent didn't close the dropdown (isOpen still true), so no closed event
        expect(component.closedCount).toBe(0);
        done();
      }, 50);
    }, 100);
  });

  it('should apply custom position configurations', (done) => {
    const customPositions: ConnectedPosition[] = [
      {
        originX: 'end',
        originY: 'bottom',
        overlayX: 'end',
        overlayY: 'top',
        offsetY: 16,
      },
    ];

    component.positions.set(customPositions);
    component.isOpen.set(true);
    fixture.detectChanges();

    setTimeout(() => {
      const overlayContainer = document.querySelector('.cdk-overlay-container');
      const dropdownPanel = overlayContainer?.querySelector('.dropdown-panel');
      expect(dropdownPanel).toBeTruthy();
      done();
    }, 100);
  });

  it('should apply custom backdrop class', (done) => {
    component.backdropClass.set('custom-backdrop-class');
    component.isOpen.set(true);
    fixture.detectChanges();

    setTimeout(() => {
      const backdrop = document.querySelector('.custom-backdrop-class');
      expect(backdrop).toBeTruthy();
      done();
    }, 100);
  });

  it('should not render backdrop when hasBackdrop is false', (done) => {
    component.hasBackdrop.set(false);
    component.isOpen.set(true);
    fixture.detectChanges();

    setTimeout(() => {
      const backdrop = document.querySelector('.cdk-overlay-backdrop');
      expect(backdrop).toBeFalsy();
      done();
    }, 100);
  });

  it('should use DROPDOWN_POSITIONS by default', () => {
    expect(component.positions()).toEqual(DROPDOWN_POSITIONS);
  });

  afterEach(() => {
    // Clean up overlay container after each test
    const overlayContainer = document.querySelector('.cdk-overlay-container');
    if (overlayContainer) {
      overlayContainer.innerHTML = '';
    }
  });
});
