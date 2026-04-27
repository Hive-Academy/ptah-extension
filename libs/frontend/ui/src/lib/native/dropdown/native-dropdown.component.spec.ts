import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Placement } from '@floating-ui/dom';
import * as FloatingDom from '@floating-ui/dom';
import { NativeDropdownComponent } from './native-dropdown.component';

jest.mock('@floating-ui/dom', () => {
  const actual = jest.requireActual('@floating-ui/dom');
  return {
    ...actual,
    computePosition: jest.fn().mockResolvedValue({ x: 0, y: 0 }),
    autoUpdate: jest.fn().mockReturnValue(() => undefined),
  };
});

@Component({
  standalone: true,
  imports: [NativeDropdownComponent],
  template: `
    <ptah-native-dropdown
      [isOpen]="isOpen()"
      [placement]="placement()"
      [offset]="offsetValue()"
      [hasBackdrop]="hasBackdrop()"
      [backdropClass]="backdropClass()"
      [closeOnBackdropClick]="closeOnBackdropClick()"
      (opened)="onOpened()"
      (closed)="onClosed()"
      (backdropClicked)="onBackdropClicked()"
    >
      <button trigger id="trigger-btn">Toggle</button>
      <div content class="menu-panel">
        <button class="menu-item">Item 1</button>
      </div>
    </ptah-native-dropdown>
  `,
})
class HostComponent {
  isOpen = signal(false);
  placement = signal<Placement>('bottom-start');
  offsetValue = signal(8);
  hasBackdrop = signal(true);
  backdropClass = signal<'transparent' | 'dark'>('transparent');
  closeOnBackdropClick = signal(true);

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

describe('NativeDropdownComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  const mockedCompute = FloatingDom.computePosition as unknown as jest.Mock;

  beforeEach(async () => {
    mockedCompute.mockClear();
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  const flushMicrotasks = () =>
    new Promise((r) => queueMicrotask(() => r(null)));

  it('should create', () => {
    expect(host).toBeTruthy();
  });

  it('should always render the trigger content', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('#trigger-btn')).toBeTruthy();
  });

  it('should NOT render panel or backdrop when isOpen is false', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.menu-panel')).toBeFalsy();
    expect(compiled.querySelector('[role="presentation"]')).toBeFalsy();
  });

  it('should render panel and backdrop when isOpen is true', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.dropdown-panel')).toBeTruthy();
    expect(compiled.querySelector('[role="presentation"]')).toBeTruthy();
    expect(compiled.querySelector('.menu-panel')).toBeTruthy();
  });

  it('should NOT render backdrop when hasBackdrop is false', () => {
    host.hasBackdrop.set(false);
    host.isOpen.set(true);
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('[role="presentation"]')).toBeFalsy();
    expect(compiled.querySelector('.dropdown-panel')).toBeTruthy();
  });

  it('should apply dark backdrop class when backdropClass is "dark"', () => {
    host.backdropClass.set('dark');
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    );
    expect(backdrop?.classList.contains('bg-black/20')).toBe(true);
  });

  it('should emit backdropClicked AND closed when backdrop clicked with closeOnBackdropClick=true', () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    backdrop.click();

    expect(host.backdropClickedCount).toBe(1);
    expect(host.closedCount).toBe(1);
  });

  it('should emit only backdropClicked when closeOnBackdropClick=false', () => {
    host.closeOnBackdropClick.set(false);
    host.isOpen.set(true);
    fixture.detectChanges();

    const backdrop = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    backdrop.click();

    expect(host.backdropClickedCount).toBe(1);
    expect(host.closedCount).toBe(0);
  });

  it('should emit opened event after positioning completes', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    // Wait for microtask + async positioning
    await flushMicrotasks();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.openedCount).toBe(1);
  });

  it('should invoke computePosition from Floating UI when opened', async () => {
    host.isOpen.set(true);
    fixture.detectChanges();

    await flushMicrotasks();
    await Promise.resolve();

    expect(mockedCompute).toHaveBeenCalled();
  });

  describe('document click outside (no backdrop)', () => {
    beforeEach(() => {
      host.hasBackdrop.set(false);
      host.isOpen.set(true);
      fixture.detectChanges();
    });

    it('should emit closed when clicking outside trigger and panel', () => {
      const outsideEl = document.createElement('div');
      document.body.appendChild(outsideEl);

      outsideEl.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(1);
      outsideEl.remove();
    });

    it('should NOT emit closed when clicking inside panel', () => {
      const panel = (fixture.nativeElement as HTMLElement).querySelector(
        '.menu-panel',
      ) as HTMLElement;

      panel.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(0);
    });

    it('should NOT emit closed when clicking trigger', () => {
      const trigger = (fixture.nativeElement as HTMLElement).querySelector(
        '#trigger-btn',
      ) as HTMLElement;

      trigger.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );

      expect(host.closedCount).toBe(0);
    });
  });

  it('should not trigger document-click close when isOpen is false', () => {
    const outsideEl = document.createElement('div');
    document.body.appendChild(outsideEl);
    outsideEl.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(host.closedCount).toBe(0);
    outsideEl.remove();
  });
});
