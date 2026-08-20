/**
 * MarketplaceStateService specs.
 *
 * Coverage:
 *   - `select` / `clearSelection` write through to `AppStateManager`, which is
 *     the single source of truth for the selection.
 *   - Unknown provider ids degrade to the overview rather than a blank surface.
 *   - The selection does not survive a workspace switch, and returning to a
 *     workspace restores it (TASK_2026_228).
 *
 * `AppStateManager` is exercised for real — it has no collaborators beyond
 * `window` and `localStorage` — so these specs assert the selection actually
 * changes rather than that a setter was called. That matters here: the bug
 * being pinned is that this service is `providedIn: 'root'` and used to
 * snapshot the app-state value once in a field initializer, so a stubbed
 * app-state would hide the very defect under test.
 */

import { TestBed } from '@angular/core/testing';
import { AppStateManager } from '@ptah-extension/core';
import { MarketplaceStateService } from './marketplace-state.service';

describe('MarketplaceStateService', () => {
  let service: MarketplaceStateService;
  let appState: AppStateManager;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AppStateManager, MarketplaceStateService],
    });
    appState = TestBed.inject(AppStateManager);
    service = TestBed.inject(MarketplaceStateService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  describe('selection', () => {
    it('starts with no selection', () => {
      expect(service.selectedProviderId()).toBeNull();
      expect(service.selectedProvider()).toBeNull();
    });

    it('select resolves the provider descriptor and persists to app state', () => {
      service.select('skills-sh');

      expect(service.selectedProviderId()).toBe('skills-sh');
      expect(service.selectedProvider()?.id).toBe('skills-sh');
      expect(appState.marketplaceActiveProvider()).toBe('skills-sh');
    });

    it('clearSelection returns to the overview', () => {
      service.select('official-mcp');
      service.clearSelection();

      expect(service.selectedProviderId()).toBeNull();
      expect(appState.marketplaceActiveProvider()).toBeNull();
    });

    it('ignores an id that is not in the registry', () => {
      service.select('official-mcp');
      service.select('not-a-real-provider');

      expect(service.selectedProviderId()).toBeNull();
    });

    it('degrades an unknown persisted id to the overview on read', () => {
      // A provider removed from the registry between sessions, or a value
      // written by an older build.
      appState.setMarketplaceActiveProvider('retired-provider');

      expect(service.selectedProviderId()).toBeNull();
      expect(service.selectedProvider()).toBeNull();
    });

    it('notifyContentChanged advances the refresh trigger', () => {
      const before = service.refreshTrigger();
      service.notifyContentChanged();

      expect(service.refreshTrigger()).toBe(before + 1);
    });
  });

  describe('workspace partitioning (TASK_2026_228)', () => {
    it('does not carry the selection onto a never-visited workspace', () => {
      appState.switchWorkspace('D:/repo/A');
      service.select('skills-sh');
      expect(service.selectedProviderId()).toBe('skills-sh');

      appState.switchWorkspace('D:/repo/B');

      // Installed content is per-workspace, so B must open on the overview
      // rather than on the provider A was left on.
      expect(service.selectedProviderId()).toBeNull();
      expect(service.selectedProvider()).toBeNull();
    });

    it('restores each workspace selection on return (A→B→A)', () => {
      appState.switchWorkspace('D:/repo/A');
      service.select('skills-sh');

      appState.switchWorkspace('D:/repo/B');
      service.select('official-mcp');

      appState.switchWorkspace('D:/repo/A');
      expect(service.selectedProviderId()).toBe('skills-sh');

      appState.switchWorkspace('D:/repo/B');
      expect(service.selectedProviderId()).toBe('official-mcp');
    });

    it('tracks the active workspace even though the service is constructed once', () => {
      // The service is `providedIn: 'root'` and injected before any workspace
      // arrives. A snapshot taken at construction would be read exactly once
      // and would then never reflect a switch.
      expect(service.selectedProviderId()).toBeNull();

      appState.switchWorkspace('D:/repo/A');
      service.select('official-mcp');
      // A frozen construction-time snapshot would still read null here.
      expect(service.selectedProviderId()).toBe('official-mcp');

      appState.switchWorkspace('D:/repo/B');
      expect(service.selectedProviderId()).toBeNull();
    });
  });
});
