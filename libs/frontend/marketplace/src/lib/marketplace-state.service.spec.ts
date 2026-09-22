/**
 * MarketplaceStateService specs.
 *
 * Coverage:
 *   - `select` / `selectSource` write through to the right place: the SECTION
 *     to `AppStateManager`, the chip to memory only.
 *   - Every retired provider id — and anything else unparsable — lands on
 *     `connected` rather than on a blank page (AC5).
 *   - A `section:source` deep link is adopted and the stored value normalised
 *     back to the bare section id.
 *   - The section does not survive a workspace switch, and returning to a
 *     workspace restores it (TASK_2026_228).
 *
 * `AppStateManager` is exercised for real — it has no collaborators beyond
 * `window` and `localStorage` — so these specs assert the selection actually
 * changes rather than that a setter was called. That matters here: the bug
 * being pinned is that this service is `providedIn: 'root'` and a snapshot
 * taken in a field initializer would be read exactly once for the lifetime of
 * the app, so a stubbed app-state would hide the very defect under test.
 */

import { TestBed } from '@angular/core/testing';
import { AppStateManager } from '@ptah-extension/core';
import { MarketplaceStateService } from './marketplace-state.service';

/** Every id the pre-TASK_2026_524 provider registry could have persisted. */
const RETIRED_PROVIDER_IDS = [
  'connectors',
  'plugins',
  'official-mcp',
  'skills-sh',
  'smithery',
  'oauth-mcp',
  'composio',
];

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

  describe('sections', () => {
    it('opens on Connected, which has no chips', () => {
      expect(service.activeSection()).toBe('connected');
      expect(service.activeSource()).toBeNull();
    });

    it('select persists the bare section id and opens its first chip', () => {
      service.select('apps');

      expect(service.activeSection()).toBe('apps');
      expect(service.activeSource()).toBe('connectors');
      expect(appState.marketplaceActiveProvider()).toBe('apps');
    });

    it('select can name the chip to open on', () => {
      service.select('skills', 'marketplaces');

      expect(service.activeSection()).toBe('skills');
      expect(service.activeSource()).toBe('marketplaces');
      // The chip is in-memory only; storage still holds the bare section.
      expect(appState.marketplaceActiveProvider()).toBe('skills');
    });

    it('does not carry a chip across a section change', () => {
      service.select('skills', 'community');
      service.select('apps');

      expect(service.activeSource()).toBe('connectors');
    });

    it('selectSource switches the chip without touching storage', () => {
      service.select('apps');
      service.selectSource('smithery');

      expect(service.activeSource()).toBe('smithery');
      expect(appState.marketplaceActiveProvider()).toBe('apps');
    });

    it('notifyContentChanged advances the refresh trigger', () => {
      const before = service.refreshTrigger();
      service.notifyContentChanged();

      expect(service.refreshTrigger()).toBe(before + 1);
    });
  });

  describe('retired ids (AC5)', () => {
    it.each(RETIRED_PROVIDER_IDS)('%s opens Connected', (retired) => {
      appState.setMarketplaceActiveProvider(retired);

      expect(service.activeSection()).toBe('connected');
      expect(service.activeSource()).toBeNull();
    });

    it.each(['', 'apps:', 'apps:nonsense', 'nonsense'])(
      'degrades %p without throwing',
      (raw) => {
        appState.setMarketplaceActiveProvider(raw);

        expect(() => service.activeSection()).not.toThrow();
      },
    );

    it('keeps the section when only the chip is unknown', () => {
      appState.setMarketplaceActiveProvider('apps:nonsense');

      expect(service.activeSection()).toBe('apps');
      expect(service.activeSource()).toBe('connectors');
    });
  });

  describe('deep links', () => {
    it('adopts a section:source link and normalises storage', () => {
      appState.setMarketplaceActiveProvider('apps:smithery');
      TestBed.flushEffects();

      expect(service.activeSection()).toBe('apps');
      expect(service.activeSource()).toBe('smithery');
      expect(appState.marketplaceActiveProvider()).toBe('apps');
    });

    it('adopts a link that arrives while the service is already live', () => {
      service.select('connected');
      TestBed.flushEffects();

      appState.setMarketplaceActiveProvider('skills:ptah-plugins');
      TestBed.flushEffects();

      expect(service.activeSection()).toBe('skills');
      expect(service.activeSource()).toBe('ptah-plugins');
    });

    it('leaves a bare section id alone', () => {
      appState.setMarketplaceActiveProvider('skills');
      TestBed.flushEffects();

      expect(service.activeSection()).toBe('skills');
      expect(service.activeSource()).toBe('ptah-plugins');
      expect(appState.marketplaceActiveProvider()).toBe('skills');
    });
  });

  describe('workspace partitioning (TASK_2026_228)', () => {
    it('does not carry the section onto a never-visited workspace', () => {
      appState.switchWorkspace('D:/repo/A');
      service.select('skills');
      expect(service.activeSection()).toBe('skills');

      appState.switchWorkspace('D:/repo/B');

      // Installed content is per-workspace, so B must open on Connected rather
      // than on the section A was left on.
      expect(service.activeSection()).toBe('connected');
      expect(service.activeSource()).toBeNull();
    });

    it('restores each workspace section on return (A→B→A)', () => {
      appState.switchWorkspace('D:/repo/A');
      service.select('skills');

      appState.switchWorkspace('D:/repo/B');
      service.select('apps');

      appState.switchWorkspace('D:/repo/A');
      expect(service.activeSection()).toBe('skills');

      appState.switchWorkspace('D:/repo/B');
      expect(service.activeSection()).toBe('apps');
    });

    it('tracks the active workspace even though the service is constructed once', () => {
      // The service is `providedIn: 'root'` and injected before any workspace
      // arrives. A snapshot taken at construction would be read exactly once
      // and would then never reflect a switch.
      expect(service.activeSection()).toBe('connected');

      appState.switchWorkspace('D:/repo/A');
      service.select('apps');
      // A frozen construction-time snapshot would still read 'connected' here.
      expect(service.activeSection()).toBe('apps');

      appState.switchWorkspace('D:/repo/B');
      expect(service.activeSection()).toBe('connected');
    });
  });
});
