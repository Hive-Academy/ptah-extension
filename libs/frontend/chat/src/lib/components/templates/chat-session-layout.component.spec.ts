import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  signal,
  viewChild,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
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
});
