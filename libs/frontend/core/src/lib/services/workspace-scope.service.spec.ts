/**
 * WorkspaceScopeService — the invalidation key every workspace-scoped cache
 * reads (TASK_2026_345, judge round 1).
 *
 * Two properties carry the whole design, and both are load-bearing in opposite
 * directions:
 *   - a REAL workspace change must produce a new key, or a cache serves the
 *     previous workspace's answer forever;
 *   - a redundant switch to the workspace already active must NOT, or every
 *     cache is thrown away for nothing and the "one fetch per view" property
 *     this task exists to establish is lost.
 */

import { TestBed } from '@angular/core/testing';

import { WorkspaceScopeService } from './workspace-scope.service';

function makeService(): WorkspaceScopeService {
  TestBed.configureTestingModule({ providers: [WorkspaceScopeService] });
  return TestBed.inject(WorkspaceScopeService);
}

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('WorkspaceScopeService', () => {
  it('starts at generation 0 with no workspace', () => {
    const scope = makeService();

    expect(scope.generation()).toBe(0);
    expect(scope.activeWorkspacePath()).toBeNull();
  });

  it('bumps the generation and the key on a real switch', () => {
    const scope = makeService();
    const before = scope.scopeKey();

    scope.switchTo('D:/projects/qa3elhamor');

    expect(scope.generation()).toBe(1);
    expect(scope.activeWorkspacePath()).toBe('D:/projects/qa3elhamor');
    expect(scope.scopeKey()).not.toBe(before);
  });

  it('does NOT bump for a switch to the workspace already active', () => {
    // `TabManagerService.switchWorkspace` and `AppStateManager.switchWorkspace`
    // both early-return on this case, so it is reachable. Treating it as a
    // change would invalidate every cache for no reason.
    const scope = makeService();
    scope.switchTo('D:/projects/qa3elhamor');
    const key = scope.scopeKey();

    const generation = scope.switchTo('D:/projects/qa3elhamor');

    expect(generation).toBe(1);
    expect(scope.generation()).toBe(1);
    expect(scope.scopeKey()).toBe(key);
  });

  it('gives A a DIFFERENT key on each visit across A -> B -> A', () => {
    // The reason the key is a generation and not just the path. A request
    // issued during the first A can be resolved by the host after the switch to
    // B, so its answer describes B; a path-only key would hand that answer to a
    // caller who is back on A.
    const scope = makeService();

    scope.switchTo('/a');
    const firstA = scope.scopeKey();
    scope.switchTo('/b');
    scope.switchTo('/a');
    const secondA = scope.scopeKey();

    expect(scope.activeWorkspacePath()).toBe('/a');
    expect(secondA).not.toBe(firstA);
    expect(scope.generation()).toBe(3);
  });

  it('names the workspace in the key, so an inspected key says where it belongs', () => {
    const scope = makeService();
    scope.switchTo('D:/projects/property-hub');

    expect(scope.scopeKey()).toContain('D:/projects/property-hub');
  });

  it('treats "no workspace" as a scope of its own', () => {
    const scope = makeService();
    scope.switchTo('/a');
    const withWorkspace = scope.scopeKey();

    scope.switchTo(null);

    expect(scope.scopeKey()).not.toBe(withWorkspace);
    expect(scope.generation()).toBe(2);
  });
});
