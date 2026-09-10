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
  it('offers Auto/1/2/3 and writes the selected workspace preference', () => {
    const setColumnsPreference = jest.fn();
    const store = {
      activeWorkspacePath: signal<string | null>('/ws/a'),
      columnsPreferenceFor: jest.fn(() => 'auto'),
      setColumnsPreference,
    } as unknown as CanvasStore;
    TestBed.configureTestingModule({
      imports: [CanvasLayoutControlsComponent],
      providers: [{ provide: CanvasStore, useValue: store }],
    });
    const fixture = TestBed.createComponent(CanvasLayoutControlsComponent);
    fixture.detectChanges();
    const buttons = fixture.debugElement.queryAll(By.css('button'));
    expect(buttons.map((button) => button.nativeElement.textContent.trim())).toEqual([
      'Auto',
      '1',
      '2',
      '3',
    ]);
    buttons[2].nativeElement.click();
    expect(setColumnsPreference).toHaveBeenCalledWith(2);
  });

  it('disables every preference and refuses programmatic mutation while locked', () => {
    const setColumnsPreference = jest.fn();
    const store = {
      activeWorkspacePath: signal<string | null>('/ws/a'),
      columnsPreferenceFor: jest.fn(() => 'auto'),
      setColumnsPreference,
    } as unknown as CanvasStore;
    TestBed.configureTestingModule({
      imports: [CanvasLayoutControlsComponent],
      providers: [{ provide: CanvasStore, useValue: store }],
    });
    const fixture = TestBed.createComponent(CanvasLayoutControlsComponent);
    fixture.componentRef.setInput('locked', true);
    fixture.detectChanges();

    const buttons = fixture.debugElement.queryAll(By.css('button'));
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.nativeElement.disabled)).toBe(true);
    buttons[2].triggerEventHandler('click');
    expect(setColumnsPreference).not.toHaveBeenCalled();
  });
});
