import { TestBed } from '@angular/core/testing';
import { SessionRotationKeepService } from './session-rotation-keep.service';

describe('SessionRotationKeepService', () => {
  let service: SessionRotationKeepService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SessionRotationKeepService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('keeps per session and threshold', () => {
    service.keep('s1', 200_000);

    expect(service.isKept('s1', 200_000)).toBe(true);
    expect(service.isKept('s1', 400_000)).toBe(false);
    expect(service.isKept('s2', 200_000)).toBe(false);
  });

  it('forgetSession drops only that session', () => {
    service.keep('s1', 200_000);
    service.keep('s1', 400_000);
    service.keep('s2', 200_000);

    service.forgetSession('s1');

    expect(service.isKept('s1', 200_000)).toBe(false);
    expect(service.isKept('s1', 400_000)).toBe(false);
    expect(service.isKept('s2', 200_000)).toBe(true);
  });

  it('forgetSession on an unknown session keeps the same set instance', () => {
    service.keep('s1', 1);
    const before = service.kept();

    service.forgetSession('nope');

    expect(service.kept()).toBe(before);
  });
});
