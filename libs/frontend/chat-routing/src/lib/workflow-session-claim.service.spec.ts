import { TestBed } from '@angular/core/testing';
import { SurfaceId } from '@ptah-extension/chat-state';

import { WorkflowSessionClaimService } from './workflow-session-claim.service';

describe('WorkflowSessionClaimService', () => {
  let service: WorkflowSessionClaimService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WorkflowSessionClaimService);
  });

  it('starts empty', () => {
    expect(service.hasClaims()).toBe(false);
    expect(service.surfaceFor('anything')).toBeNull();
  });

  it('claim() registers a correlation → surface mapping', () => {
    const surfaceId = SurfaceId.create();
    service.claim('corr-1', surfaceId);

    expect(service.surfaceFor('corr-1')).toBe(surfaceId);
    expect(service.hasClaims()).toBe(true);
  });

  it('claim() overwrites an existing correlation', () => {
    const first = SurfaceId.create();
    const second = SurfaceId.create();
    service.claim('corr-1', first);
    service.claim('corr-1', second);

    expect(service.surfaceFor('corr-1')).toBe(second);
  });

  it('release() removes the claim', () => {
    const surfaceId = SurfaceId.create();
    service.claim('corr-1', surfaceId);
    service.release('corr-1');

    expect(service.surfaceFor('corr-1')).toBeNull();
    expect(service.hasClaims()).toBe(false);
  });

  it('release() of an unknown correlation is a no-op', () => {
    expect(() => service.release('ghost')).not.toThrow();
    expect(service.hasClaims()).toBe(false);
  });

  it('tracks multiple independent claims', () => {
    const s1 = SurfaceId.create();
    const s2 = SurfaceId.create();
    service.claim('corr-1', s1);
    service.claim('corr-2', s2);

    expect(service.surfaceFor('corr-1')).toBe(s1);
    expect(service.surfaceFor('corr-2')).toBe(s2);

    service.release('corr-1');

    expect(service.surfaceFor('corr-1')).toBeNull();
    expect(service.surfaceFor('corr-2')).toBe(s2);
    expect(service.hasClaims()).toBe(true);
  });
});
