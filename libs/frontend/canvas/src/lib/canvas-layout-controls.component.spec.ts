import {
  ChangeDetectionStrategy,
  Component,
  NgModule,
  signal,
} from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
  })
  class MarkdownStub {}
  @NgModule({ imports: [MarkdownStub], exports: [MarkdownStub] })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStub,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { CanvasLayoutControlsComponent } from './canvas-layout-controls.component';
import { CanvasStore } from './canvas.store';

describe('CanvasLayoutControlsComponent', () => {
  function setup(options?: {
    columnsPref?: string | number;
    locked?: boolean;
    tileCount?: number | null;
  }) {
    const setColumnsPreference = jest.fn();
    const columnsPreference = signal(options?.columnsPref ?? 'auto');
    const store = {
      activeWorkspacePath: signal<string | null>('/ws/a'),
      columnsPreferenceFor: jest.fn(() => columnsPreference()),
      setColumnsPreference: jest.fn((pref) => {
        columnsPreference.set(pref);
        setColumnsPreference(pref);
      }),
    } as unknown as CanvasStore;

    TestBed.configureTestingModule({
      imports: [CanvasLayoutControlsComponent],
      providers: [{ provide: CanvasStore, useValue: store }],
    });

    const fixture = TestBed.createComponent(CanvasLayoutControlsComponent);
    if (options?.locked !== undefined) {
      fixture.componentRef.setInput('locked', options.locked);
    }
    if (options?.tileCount !== undefined) {
      fixture.componentRef.setInput('tileCount', options.tileCount);
    }
    fixture.detectChanges();
    return { fixture, setColumnsPreference, store };
  }

  it('renders a floating-looking layout trigger with icon and accessible label', () => {
    const { fixture } = setup({ tileCount: 2 });
    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    expect(trigger).toBeTruthy();
    expect(trigger.nativeElement.textContent.trim()).toContain('Layout');
    expect(trigger.nativeElement.getAttribute('aria-label')).toBe(
      'Layout options',
    );
    expect(trigger.nativeElement.disabled).toBe(false);
  });

  it('expands into four attractive icon actions without numeric button labels', () => {
    const { fixture } = setup({ tileCount: 2 });
    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    trigger.nativeElement.click();
    fixture.detectChanges();

    const group = fixture.debugElement.query(By.css('[role="group"]'));
    expect(group).toBeTruthy();
    expect(group.nativeElement.getAttribute('aria-label')).toBe(
      'Maximum tiles per row',
    );

    const actionButtons = group.queryAll(By.css('button'));
    expect(actionButtons).toHaveLength(4);

    // Verify accessible labels and tooltips instead of numeric labels
    expect(actionButtons[0].nativeElement.getAttribute('aria-label')).toBe(
      '1 column',
    );
    expect(actionButtons[0].nativeElement.getAttribute('title')).toBe(
      '1 column',
    );
    expect(actionButtons[1].nativeElement.getAttribute('aria-label')).toBe(
      '2 columns',
    );
    expect(actionButtons[1].nativeElement.getAttribute('title')).toBe(
      '2 columns',
    );
    expect(actionButtons[2].nativeElement.getAttribute('aria-label')).toBe(
      '3 columns',
    );
    expect(actionButtons[2].nativeElement.getAttribute('title')).toBe(
      '3 columns',
    );
    expect(actionButtons[3].nativeElement.getAttribute('aria-label')).toBe(
      'Lock tiles',
    );

    // No numeric text content in button labels
    for (const btn of actionButtons) {
      expect(btn.nativeElement.textContent.trim()).toBe('');
      expect(btn.query(By.css('lucide-angular'))).toBeTruthy();
    }
  });

  it('writes columns preference and preserves auto default when re-selecting active preference', () => {
    const { fixture, setColumnsPreference } = setup({ tileCount: 3 });
    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    trigger.nativeElement.click();
    fixture.detectChanges();

    const actionButtons = fixture.debugElement.queryAll(
      By.css('[role="group"] button'),
    );

    // Select 2 columns
    actionButtons[1].nativeElement.click();
    fixture.detectChanges();
    expect(setColumnsPreference).toHaveBeenCalledWith(2);
    expect(actionButtons[1].nativeElement.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(actionButtons[1].nativeElement.classList).toContain('btn-active');

    // Re-select 2 columns -> toggles back to 'auto' internally (no 5th auto button required)
    actionButtons[1].nativeElement.click();
    fixture.detectChanges();
    expect(setColumnsPreference).toHaveBeenCalledWith('auto');
    expect(actionButtons[1].nativeElement.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('toggles lock state and emits lockToggled when clicking the lock action', () => {
    const { fixture } = setup({ tileCount: 2, locked: false });
    let lockToggledFired = false;
    fixture.componentInstance.lockToggled.subscribe(() => {
      lockToggledFired = true;
    });

    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    trigger.nativeElement.click();
    fixture.detectChanges();

    const lockBtn = fixture.debugElement.queryAll(
      By.css('[role="group"] button'),
    )[3];
    expect(lockBtn.nativeElement.getAttribute('aria-label')).toBe('Lock tiles');
    expect(lockBtn.nativeElement.getAttribute('aria-pressed')).toBe('false');

    lockBtn.nativeElement.click();
    expect(lockToggledFired).toBe(true);
  });

  it('disables column preferences when locked, keeping unlock action enabled', () => {
    const { fixture, setColumnsPreference } = setup({
      tileCount: 2,
      locked: true,
    });
    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    trigger.nativeElement.click();
    fixture.detectChanges();

    const actionButtons = fixture.debugElement.queryAll(
      By.css('[role="group"] button'),
    );
    expect(actionButtons).toHaveLength(4);

    // Columns 1, 2, 3 disabled
    expect(actionButtons[0].nativeElement.disabled).toBe(true);
    expect(actionButtons[1].nativeElement.disabled).toBe(true);
    expect(actionButtons[2].nativeElement.disabled).toBe(true);

    // Lock toggle button remains enabled so user can unlock
    expect(actionButtons[3].nativeElement.disabled).toBe(false);
    expect(actionButtons[3].nativeElement.getAttribute('aria-label')).toBe(
      'Unlock tiles',
    );
    expect(actionButtons[3].nativeElement.getAttribute('aria-pressed')).toBe(
      'true',
    );

    // Programmatic mutation refused
    actionButtons[1].triggerEventHandler('click');
    expect(setColumnsPreference).not.toHaveBeenCalled();
  });

  it('disables layout controls when singleton session (tileCount <= 1)', () => {
    const { fixture } = setup({ tileCount: 1 });
    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    expect(trigger.nativeElement.disabled).toBe(true);
    expect(trigger.nativeElement.getAttribute('aria-label')).toBe(
      'Layout controls not applicable for a single session',
    );
  });

  it('closes open layout controls when tile count becomes singleton', () => {
    const { fixture } = setup({ tileCount: 2 });
    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    trigger.nativeElement.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.isOpen()).toBe(true);

    fixture.componentRef.setInput('tileCount', 1);
    fixture.detectChanges();

    expect(fixture.componentInstance.isOpen()).toBe(false);
    expect(fixture.debugElement.query(By.css('[role="group"]'))).toBeNull();
  });

  it('dismisses layout controls when close() is called or Escape pressed', () => {
    const { fixture } = setup({ tileCount: 2 });
    const trigger = fixture.debugElement.query(By.css('button[trigger]'));
    trigger.nativeElement.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.isOpen()).toBe(true);
    expect(fixture.debugElement.query(By.css('[role="group"]'))).toBeTruthy();

    // Close via close method
    fixture.componentInstance.close();
    fixture.detectChanges();

    expect(fixture.componentInstance.isOpen()).toBe(false);
    expect(fixture.debugElement.query(By.css('[role="group"]'))).toBeNull();
  });
});
