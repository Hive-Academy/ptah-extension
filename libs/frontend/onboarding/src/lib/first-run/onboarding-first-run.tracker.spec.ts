import { TestBed } from '@angular/core/testing';
import {
  DefaultUrlSerializer,
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationSkippedCode,
  NavigationStart,
  Router,
  type Event as RouterEvent,
} from '@angular/router';
import { Subject } from 'rxjs';
import { OnboardingFlagService } from './onboarding-flag.service';
import { OnboardingFirstRunTracker } from './onboarding-first-run.tracker';

/**
 * The tracker's state machine, one case per row of its table, driven through
 * a fake `Router.events`. The real Router sequence is pinned end to end in
 * `onboarding-first-run.guard.spec.ts`.
 */
describe('OnboardingFirstRunTracker', () => {
  let events: Subject<RouterEvent>;
  let markShown: jest.Mock<void, []>;
  let tracker: OnboardingFirstRunTracker;

  const ORIGIN = 1;
  const REPLACEMENT = 2;

  const cancel = (id: number, code: NavigationCancellationCode): void =>
    events.next(new NavigationCancel(id, '/chat', 'cancelled', code));
  const start = (id: number, url: string): void =>
    events.next(new NavigationStart(id, url));
  const end = (id: number, url: string, after = url): void =>
    events.next(new NavigationEnd(id, url, after));

  /** The happy path up to (not including) the replacement's end. */
  function redirectStarted(): void {
    tracker.recordRedirect(ORIGIN);
    cancel(ORIGIN, NavigationCancellationCode.Redirect);
    start(REPLACEMENT, '/onboarding');
  }

  beforeEach(() => {
    events = new Subject<RouterEvent>();
    markShown = jest.fn<void, []>();
    const serializer = new DefaultUrlSerializer();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            events,
            parseUrl: (url: string) => serializer.parse(url),
          },
        },
        { provide: OnboardingFlagService, useValue: { markShown } },
      ],
    });
    tracker = TestBed.inject(OnboardingFirstRunTracker);
    tracker.start();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('commits shownAt when the replacement lands on onboarding', () => {
    redirectStarted();
    end(REPLACEMENT, '/onboarding');
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('commits when the redirect lands on the Get ready stage /onboarding/ready', () => {
    tracker.recordRedirect(ORIGIN);
    cancel(ORIGIN, NavigationCancellationCode.Redirect);
    start(REPLACEMENT, '/onboarding/ready');
    end(REPLACEMENT, '/onboarding/ready');
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('commits when the onboarding URL carries a child path and query', () => {
    tracker.recordRedirect(ORIGIN);
    cancel(ORIGIN, NavigationCancellationCode.Redirect);
    start(REPLACEMENT, '/onboarding/x?tab=1');
    end(REPLACEMENT, '/onboarding/x?tab=1', '/onboarding');
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('commits exactly once', () => {
    redirectStarted();
    end(REPLACEMENT, '/onboarding');
    end(REPLACEMENT, '/onboarding');
    start(3, '/onboarding');
    end(3, '/onboarding');
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('never commits a manual visit (NavigationEnd of an untracked id)', () => {
    start(7, '/onboarding');
    end(7, '/onboarding');
    tracker.recordRedirect(ORIGIN);
    end(8, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it.each([
    ['superseded', NavigationCancellationCode.SupersededByNewNavigation],
    ['guard rejected', NavigationCancellationCode.GuardRejected],
    ['no data from resolver', NavigationCancellationCode.NoDataFromResolver],
  ])('clears when the origin is cancelled as %s', (_label, code) => {
    tracker.recordRedirect(ORIGIN);
    cancel(ORIGIN, code);
    start(REPLACEMENT, '/onboarding');
    end(REPLACEMENT, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it('clears when the origin errors', () => {
    tracker.recordRedirect(ORIGIN);
    events.next(new NavigationError(ORIGIN, '/chat', new Error('x')));
    start(REPLACEMENT, '/onboarding');
    end(REPLACEMENT, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it('clears when the origin is skipped', () => {
    tracker.recordRedirect(ORIGIN);
    events.next(
      new NavigationSkipped(
        ORIGIN,
        '/chat',
        'same url',
        NavigationSkippedCode.IgnoredSameUrlNavigation,
      ),
    );
    start(REPLACEMENT, '/onboarding');
    end(REPLACEMENT, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it.each([
    [
      'cancelled',
      () =>
        cancel(
          REPLACEMENT,
          NavigationCancellationCode.SupersededByNewNavigation,
        ),
    ],
    [
      'errored',
      () =>
        events.next(
          new NavigationError(REPLACEMENT, '/onboarding', new Error('chunk')),
        ),
    ],
  ])('clears when the replacement is %s', (_label, fail) => {
    redirectStarted();
    fail();
    end(REPLACEMENT, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it('clears when a non-onboarding navigation starts first (superseded boot)', () => {
    // A host SWITCH_VIEW lands between the guard's cancel and its redirect.
    tracker.recordRedirect(ORIGIN);
    cancel(ORIGIN, NavigationCancellationCode.Redirect);
    start(REPLACEMENT, '/settings');
    end(REPLACEMENT, '/settings');
    start(3, '/onboarding');
    end(3, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it('clears without committing when the replacement settles elsewhere', () => {
    redirectStarted();
    end(REPLACEMENT, '/onboarding', '/chat');
    start(3, '/onboarding');
    end(3, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it('ignores events while nothing is pending', () => {
    cancel(ORIGIN, NavigationCancellationCode.Redirect);
    start(REPLACEMENT, '/onboarding');
    end(REPLACEMENT, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();
  });

  it('subscribes once however often start() is called', () => {
    tracker.start();
    tracker.start();
    redirectStarted();
    end(REPLACEMENT, '/onboarding');
    expect(markShown).toHaveBeenCalledTimes(1);
  });

  it('a newer recordRedirect replaces the pending one', () => {
    tracker.recordRedirect(ORIGIN);
    tracker.recordRedirect(5);
    cancel(ORIGIN, NavigationCancellationCode.Redirect);
    start(REPLACEMENT, '/onboarding');
    end(REPLACEMENT, '/onboarding');
    expect(markShown).not.toHaveBeenCalled();

    cancel(5, NavigationCancellationCode.Redirect);
    start(6, '/onboarding');
    end(6, '/onboarding');
    expect(markShown).toHaveBeenCalledTimes(1);
  });
});
