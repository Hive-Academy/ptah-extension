import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranscriptMotionDirective } from './transcript-motion.directive';

@Component({
  imports: [TranscriptMotionDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div data-testid="motion-root" [ptahTranscriptMotion]="messages()" [active]="active()"
      [suppressed]="suppressed()" [historyReplaying]="historyReplaying()"
      [pinnedToBottom]="pinnedToBottom()">
      @for (message of messages(); track message.id) {
        <div class="chat-msg-item" [attr.data-ptah-msg-item]="message.id"></div>
      }
    </div>
  `,
})
class MotionHostComponent {
  readonly messages = signal<readonly { readonly id: string }[]>([]);
  readonly active = signal(true);
  readonly suppressed = signal(false);
  readonly historyReplaying = signal(false);
  readonly pinnedToBottom = signal(true);
  readonly motion = viewChild.required(TranscriptMotionDirective);
}

function messages(...ids: readonly string[]): readonly { readonly id: string }[] {
  return ids.map((id) => ({ id }));
}

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0, y: top, top, bottom, left: 0, right: 100,
    width: 100, height: bottom - top, toJSON: () => ({}),
  };
}

function harness(initialIds: readonly string[] = [], active = true) {
  TestBed.configureTestingModule({ imports: [MotionHostComponent] });
  const fixture = TestBed.createComponent(MotionHostComponent);
  const host = fixture.componentInstance;
  host.messages.set(messages(...initialIds));
  host.active.set(active);
  fixture.detectChanges();
  const root = fixture.nativeElement.querySelector('[data-testid="motion-root"]') as HTMLElement;
  root.getBoundingClientRect = () => rect(0, 200);
  return { fixture, host, root, motion: host.motion() };
}

function item(root: HTMLElement, id: string): HTMLElement {
  const found = Array.from(root.querySelectorAll<HTMLElement>('[data-ptah-msg-item]'))
    .find((candidate) => candidate.dataset['ptahMsgItem'] === id);
  if (!found) throw new Error(`Missing item ${id}`);
  found.getBoundingClientRect = () => rect(20, 80);
  return found;
}

describe('TranscriptMotionDirective', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('provides enter class and indexes for a new batch', () => {
    const h = harness();
    h.host.messages.set(messages('a', 'b', 'c'));
    h.fixture.detectChanges();
    expect(h.motion.enterClass('a')).toBe('ptah-msg-enter');
    expect(h.motion.index('a')).toBe(0);
    expect(h.motion.index('b')).toBe(1);
    expect(h.motion.index('c')).toBe(2);
    expect(h.motion.index('absent')).toBeNull();
  });

  it('keeps running indexes unchanged when the same ids arrive again', () => {
    const h = harness();
    h.host.messages.set(messages('a', 'b'));
    h.fixture.detectChanges();
    h.host.messages.set(messages('a', 'b'));
    h.fixture.detectChanges();
    expect(h.motion.index('a')).toBe(0);
    expect(h.motion.index('b')).toBe(1);
    expect(h.motion.enterClass('missing')).toBe('');
  });

  it('suppresses an activation edge', () => {
    const h = harness(['old'], false);
    h.host.active.set(true);
    h.host.messages.set(messages('old', 'new'));
    h.fixture.detectChanges();
    expect(h.motion.index('new')).toBeNull();
  });

  it('staggers an open batch arriving on the activation edge', () => {
    const h = harness([], false);
    h.host.active.set(true);
    h.host.messages.set(messages('a', 'b'));
    h.fixture.detectChanges();
    expect([h.motion.index('a'), h.motion.index('b')]).toEqual([0, 1]);
  });

  it('cuts a stream-to-final tail swap without entering again', () => {
    const h = harness(['user', 'stream']);
    const removed = item(h.root, 'stream');
    h.host.messages.set(messages('user', 'final'));
    h.fixture.detectChanges();
    expect(h.motion.enterClass('final')).toBe('');
    expect(h.motion.index('final')).toBeNull();
    expect(removed.hasAttribute('data-ptah-leave-cut')).toBe(true);
    expect(removed.hasAttribute('data-ptah-leaving')).toBe(true);
  });

  it('staggers the replaying open batch but not a later replay page', () => {
    const h = harness();
    h.host.historyReplaying.set(true);
    h.host.messages.set(messages('a', 'b'));
    h.fixture.detectChanges();
    expect(h.motion.index('a')).toBe(0);
    expect(h.motion.index('b')).toBe(1);
    h.host.messages.set(messages('a', 'b', 'c'));
    h.fixture.detectChanges();
    expect(h.motion.index('c')).toBeNull();
  });

  it('suppresses a new row during the replay hold', () => {
    const h = harness();
    h.host.suppressed.set(true);
    h.host.messages.set(messages('a'));
    h.fixture.detectChanges();
    expect(h.motion.index('a')).toBeNull();
  });

  it('marks a visible removed item inert and leaves it animated', () => {
    const h = harness(['a', 'b']);
    const removed = item(h.root, 'a');
    h.host.messages.set(messages('b'));
    h.fixture.detectChanges();
    expect(removed.hasAttribute('inert')).toBe(true);
    expect(removed.getAttribute('aria-hidden')).toBe('true');
    expect(removed.hasAttribute('data-ptah-leaving')).toBe(true);
    expect(removed.hasAttribute('data-ptah-leave-cut')).toBe(false);
  });

  it('cuts a replacement leave and evicts its entrance index', () => {
    const h = harness();
    h.host.messages.set(messages('old'));
    h.fixture.detectChanges();
    const removed = item(h.root, 'old');
    h.host.messages.set(messages('new'));
    h.fixture.detectChanges();
    expect(removed.hasAttribute('data-ptah-leave-cut')).toBe(true);
    expect(h.motion.index('old')).toBeNull();
    expect(h.motion.index('new')).toBe(0);
  });

  it('cuts every leave when more than six items leave', () => {
    const h = harness(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'keep']);
    const removed = item(h.root, 'a');
    h.host.messages.set(messages('keep'));
    h.fixture.detectChanges();
    expect(removed.hasAttribute('data-ptah-leave-cut')).toBe(true);
  });

  it('cuts a removed item outside the scroller rect', () => {
    const h = harness(['a', 'b']);
    const removed = item(h.root, 'a');
    removed.getBoundingClientRect = () => rect(-100, -20);
    h.host.messages.set(messages('b'));
    h.fixture.detectChanges();
    expect(removed.hasAttribute('data-ptah-leave-cut')).toBe(true);
  });
});
