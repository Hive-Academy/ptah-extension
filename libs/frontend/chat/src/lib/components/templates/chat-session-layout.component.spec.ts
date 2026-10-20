import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DisplayDockState } from '../../services/display-dock/display-dock.state';
import { ArtifactStore } from '../../services/artifact.store';
import { ClaudeRpcService } from '@ptah-extension/core';
import { ChangeSetActionsService } from '../../services/change-set/change-set-actions.service';
import { DisplaySheetComponent } from '../organisms/display-sheet/display-sheet.component';
import { DisplaySheetState } from '../organisms/display-sheet/display-sheet.state';
import { ChatSessionLayoutComponent } from './chat-session-layout.component';

@Component({
  imports: [ChatSessionLayoutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-chat-session-layout>
      <header>Session header</header>
      <div sessionTranscript data-testid="transcript">
        @for (message of messages(); track message) {
          <p>{{ message }}</p>
        }
      </div>
      <div sessionControls>Session controls</div>
      <div sessionComposer><textarea #chatInputRef></textarea></div>
    </ptah-chat-session-layout>
  `,
})
class HostComponent {
  readonly messages = signal(['first', 'second']);
  readonly chatInputRef =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('chatInputRef');
}

@Component({
  imports: [ChatSessionLayoutComponent, DisplaySheetComponent],
  providers: [
    DisplayDockState,
    DisplaySheetState,
    { provide: ChangeSetActionsService, useValue: {} },
    { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
    {
      provide: ArtifactStore,
      useValue: {
        records: signal({}),
        lastError: signal(null),
        recordById: () => null,
        forSession: () => signal([]),
        reload: jest.fn(),
      },
    },
  ],
  template: `
    <ptah-chat-session-layout>
      <div sessionTranscript class="flex-1 min-h-0">Transcript</div>
      <ptah-display-sheet sessionSheet tabId="tab-1" />
      <div sessionComposer class="flex-shrink-0"><textarea aria-label="Message"></textarea></div>
    </ptah-chat-session-layout>
  `,
})
class FullHeightHostComponent {
  readonly dock = inject(DisplayDockState);
  readonly sheet = inject(DisplaySheetState);
}

describe('ChatSessionLayoutComponent', () => {
  it('projects session regions in order and keeps their view queries and loops in the parent view', async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const layout = fixture.nativeElement.querySelector('ptah-chat-session-layout') as HTMLElement;
    expect(Array.from(layout.children, (child) => child.tagName.toLowerCase())).toEqual([
      'header', 'div', 'div', 'div',
    ]);
    expect(layout.querySelector('[data-testid="transcript"]')?.textContent).toContain('second');
    expect(fixture.componentInstance.chatInputRef().nativeElement).toBe(
      layout.querySelector('textarea'),
    );

    fixture.componentInstance.messages.set(['third']);
    fixture.detectChanges();
    expect(layout.querySelectorAll('[data-testid="transcript"] p')).toHaveLength(1);
    expect(layout.querySelector('[data-testid="transcript"] p')?.textContent).toBe('third');
  });

  it('gives the projected session a bounded flex host', async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();

    const layout = fixture.nativeElement.querySelector('ptah-chat-session-layout') as HTMLElement;
    expect(layout.classList.contains('flex')).toBe(true);
    expect(layout.classList.contains('flex-1')).toBe(true);
    expect(layout.classList.contains('flex-col')).toBe(true);
    expect(layout.classList.contains('min-h-0')).toBe(true);
    expect(layout.classList.contains('min-w-0')).toBe(true);
  });

  it('leaves every composer ancestor free of size containment for fixed menus', async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const composer = fixture.nativeElement.querySelector('textarea') as HTMLElement;
    for (let node = composer.parentElement; node !== null; node = node.parentElement) {
      const type = getComputedStyle(node).getPropertyValue('container-type').trim();
      expect(type).not.toBe('size');
      expect(type).not.toBe('inline-size');
    }
    fixture.destroy();
  });

  it('gives full mode the remaining flex height while keeping the composer after the sheet', async () => {
    await TestBed.configureTestingModule({ imports: [FullHeightHostComponent] }).compileComponents();
    const fixture = TestBed.createComponent(FullHeightHostComponent);
    fixture.componentInstance.dock.open('tab-1');
    fixture.componentInstance.sheet.setMode('tab-1', 'full');
    fixture.detectChanges();
    const layout = fixture.nativeElement.querySelector('ptah-chat-session-layout') as HTMLElement;
    const sheet = layout.querySelector('ptah-display-sheet') as HTMLElement;
    const composer = layout.querySelector('[sessionComposer]') as HTMLElement;
    expect(sheet.classList.contains('sheet-full')).toBe(true);
    expect(sheet.querySelector('[data-testid="display-sheet-region"]')?.classList.contains('full')).toBe(true);
    expect(layout.lastElementChild).toBe(composer);
    expect(composer.querySelector('textarea')).not.toBeNull();
    expect(sheet.querySelector('[data-testid="display-sheet-bar"]')).not.toBeNull();
    fixture.destroy();
  });
});
