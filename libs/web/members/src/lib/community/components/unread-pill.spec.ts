import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { UnreadPill } from './unread-pill';

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UnreadPill],
  template: `<ptah-unread-pill [count]="count()" [noun]="noun()" />`,
})
class HostComponent {
  public readonly count = signal(0);
  public readonly noun = signal<'reply' | 'thread'>('reply');
}

function render() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return fixture;
}

describe('UnreadPill', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  it('renders NOTHING at zero', () => {
    // A "0 new" chip on every read topic trains a member to stop looking at the
    // badge, which is the one thing it exists to do.
    const fixture = render();

    expect(fixture.nativeElement.querySelector('span')).toBeNull();
    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('renders nothing for a negative count either', () => {
    // The server clamps at 0, so this is defence against a future bug rather
    // than a live case — but "-2 new" is the worst possible way to find out.
    const fixture = render();
    fixture.componentInstance.count.set(-2);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('span')).toBeNull();
  });

  it('renders "N new" above zero', () => {
    const fixture = render();
    fixture.componentInstance.count.set(4);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('4 new');
  });

  it('says which noun it counts, for a screen reader', () => {
    // `MemberTopicSummary.unreadCount` counts POSTS; `MemberCategory.unreadCount`
    // counts TOPICS. "3 new" alone is ambiguous and the two are trivially
    // confusable at a call site.
    const fixture = render();
    fixture.componentInstance.count.set(3);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('span').getAttribute('aria-label'),
    ).toBe('3 unread replies');

    fixture.componentInstance.noun.set('thread');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('span').getAttribute('aria-label'),
    ).toBe('3 unread threads');
  });

  it('singularises at one', () => {
    const fixture = render();
    fixture.componentInstance.count.set(1);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('span').getAttribute('aria-label'),
    ).toBe('1 unread reply');
  });
});
