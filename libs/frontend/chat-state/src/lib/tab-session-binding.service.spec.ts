import { TestBed } from '@angular/core/testing';
import { ConversationId, SurfaceId, TabId } from './identity/ids';
import { TabSessionBinding } from './tab-session-binding.service';

describe('TabSessionBinding — TASK_2026_106 Phase 1', () => {
  let binding: TabSessionBinding;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    binding = TestBed.inject(TabSessionBinding);
  });

  describe('bind()', () => {
    it('records both forward and reverse edges', () => {
      const tab = TabId.create();
      const conv = ConversationId.create();
      binding.bind(tab, conv);

      expect(binding.conversationFor(tab)).toBe(conv);
      expect(binding.tabsFor(conv)).toEqual([tab]);
      expect(binding.boundTabCount()).toBe(1);
      expect(binding.boundConversationCount()).toBe(1);
    });

    it('supports multiple tabs bound to the same conversation', () => {
      const conv = ConversationId.create();
      const t1 = TabId.create();
      const t2 = TabId.create();
      binding.bind(t1, conv);
      binding.bind(t2, conv);

      const tabs = binding.tabsFor(conv);
      expect(new Set(tabs)).toEqual(new Set([t1, t2]));
      expect(binding.boundConversationCount()).toBe(1);
      expect(binding.boundTabCount()).toBe(2);
    });

    it('replaces a prior binding when a tab moves to a new conversation', () => {
      const tab = TabId.create();
      const oldConv = ConversationId.create();
      const newConv = ConversationId.create();

      binding.bind(tab, oldConv);
      binding.bind(tab, newConv);

      expect(binding.conversationFor(tab)).toBe(newConv);
      expect(binding.tabsFor(newConv)).toEqual([tab]);
      expect(binding.tabsFor(oldConv)).toEqual([]);
      expect(binding.hasBoundTabs(oldConv)).toBe(false);
      expect(binding.boundConversationCount()).toBe(1);
    });

    it('is a no-op when re-binding to the same conversation', () => {
      const tab = TabId.create();
      const conv = ConversationId.create();
      binding.bind(tab, conv);
      const beforeMap = binding.tabsFor(conv);
      binding.bind(tab, conv);
      const afterMap = binding.tabsFor(conv);
      expect(afterMap).toEqual(beforeMap);
      expect(binding.boundTabCount()).toBe(1);
    });

    it('keeps siblings when a peer is moved', () => {
      const conv = ConversationId.create();
      const otherConv = ConversationId.create();
      const t1 = TabId.create();
      const t2 = TabId.create();
      binding.bind(t1, conv);
      binding.bind(t2, conv);

      binding.bind(t2, otherConv);

      expect(binding.tabsFor(conv)).toEqual([t1]);
      expect(binding.tabsFor(otherConv)).toEqual([t2]);
    });
  });

  describe('unbind()', () => {
    it('removes both edges', () => {
      const tab = TabId.create();
      const conv = ConversationId.create();
      binding.bind(tab, conv);
      binding.unbind(tab);

      expect(binding.conversationFor(tab)).toBeNull();
      expect(binding.tabsFor(conv)).toEqual([]);
      expect(binding.boundTabCount()).toBe(0);
      expect(binding.boundConversationCount()).toBe(0);
    });

    it('leaves siblings intact when one of many is unbound', () => {
      const conv = ConversationId.create();
      const t1 = TabId.create();
      const t2 = TabId.create();
      binding.bind(t1, conv);
      binding.bind(t2, conv);
      binding.unbind(t1);

      expect(binding.tabsFor(conv)).toEqual([t2]);
      expect(binding.boundConversationCount()).toBe(1);
    });

    it('is a no-op on an unbound tab', () => {
      const tab = TabId.create();
      expect(() => binding.unbind(tab)).not.toThrow();
      expect(binding.boundTabCount()).toBe(0);
    });
  });

  describe('lookup helpers', () => {
    it('conversationFor() returns null on unbound tab', () => {
      expect(binding.conversationFor(TabId.create())).toBeNull();
    });

    it('tabsFor() returns empty array on unknown conversation', () => {
      expect(binding.tabsFor(ConversationId.create())).toEqual([]);
    });

    it('hasBoundTabs() reflects current state', () => {
      const conv = ConversationId.create();
      expect(binding.hasBoundTabs(conv)).toBe(false);
      const tab = TabId.create();
      binding.bind(tab, conv);
      expect(binding.hasBoundTabs(conv)).toBe(true);
      binding.unbind(tab);
      expect(binding.hasBoundTabs(conv)).toBe(false);
    });
  });

  describe('reverse-set isolation', () => {
    it('callers cannot mutate the reverse set through tabsFor()', () => {
      const conv = ConversationId.create();
      const tab = TabId.create();
      binding.bind(tab, conv);

      const snapshot = binding.tabsFor(conv) as TabId[];
      snapshot.push(TabId.create());

      // Internal state unaffected
      expect(binding.tabsFor(conv)).toEqual([tab]);
    });
  });

  // ------------------------------------------------------------------
  // TASK_2026_107 Phase 1 — surface bindings (parallel to tab bindings).
  // ------------------------------------------------------------------

  describe('bindSurface()', () => {
    it('records both forward and reverse edges', () => {
      const surface = SurfaceId.create();
      const conv = ConversationId.create();
      binding.bindSurface(surface, conv);

      expect(binding.conversationForSurface(surface)).toBe(conv);
      expect(binding.surfacesFor(conv)).toEqual([surface]);
      expect(binding.boundSurfaceCount()).toBe(1);
      expect(binding.boundConversationCount()).toBe(1);
    });

    it('supports multiple surfaces bound to the same conversation', () => {
      const conv = ConversationId.create();
      const s1 = SurfaceId.create();
      const s2 = SurfaceId.create();
      binding.bindSurface(s1, conv);
      binding.bindSurface(s2, conv);

      const surfaces = binding.surfacesFor(conv);
      expect(new Set(surfaces)).toEqual(new Set([s1, s2]));
      expect(binding.boundConversationCount()).toBe(1);
      expect(binding.boundSurfaceCount()).toBe(2);
    });

    it('replaces a prior binding when a surface moves to a new conversation', () => {
      const surface = SurfaceId.create();
      const oldConv = ConversationId.create();
      const newConv = ConversationId.create();

      binding.bindSurface(surface, oldConv);
      binding.bindSurface(surface, newConv);

      expect(binding.conversationForSurface(surface)).toBe(newConv);
      expect(binding.surfacesFor(newConv)).toEqual([surface]);
      expect(binding.surfacesFor(oldConv)).toEqual([]);
      expect(binding.hasBoundSurfaces(oldConv)).toBe(false);
      expect(binding.boundConversationCount()).toBe(1);
    });

    it('is a no-op when re-binding to the same conversation', () => {
      const surface = SurfaceId.create();
      const conv = ConversationId.create();
      binding.bindSurface(surface, conv);
      const before = binding.surfacesFor(conv);
      binding.bindSurface(surface, conv);
      const after = binding.surfacesFor(conv);
      expect(after).toEqual(before);
      expect(binding.boundSurfaceCount()).toBe(1);
    });

    it('keeps surface siblings when a peer is moved', () => {
      const conv = ConversationId.create();
      const otherConv = ConversationId.create();
      const s1 = SurfaceId.create();
      const s2 = SurfaceId.create();
      binding.bindSurface(s1, conv);
      binding.bindSurface(s2, conv);

      binding.bindSurface(s2, otherConv);

      expect(binding.surfacesFor(conv)).toEqual([s1]);
      expect(binding.surfacesFor(otherConv)).toEqual([s2]);
    });
  });

  describe('unbindSurface()', () => {
    it('removes both edges', () => {
      const surface = SurfaceId.create();
      const conv = ConversationId.create();
      binding.bindSurface(surface, conv);
      binding.unbindSurface(surface);

      expect(binding.conversationForSurface(surface)).toBeNull();
      expect(binding.surfacesFor(conv)).toEqual([]);
      expect(binding.boundSurfaceCount()).toBe(0);
      expect(binding.boundConversationCount()).toBe(0);
    });

    it('leaves siblings intact when one of many is unbound', () => {
      const conv = ConversationId.create();
      const s1 = SurfaceId.create();
      const s2 = SurfaceId.create();
      binding.bindSurface(s1, conv);
      binding.bindSurface(s2, conv);
      binding.unbindSurface(s1);

      expect(binding.surfacesFor(conv)).toEqual([s2]);
      expect(binding.boundConversationCount()).toBe(1);
    });

    it('is a no-op on an unbound surface', () => {
      const surface = SurfaceId.create();
      expect(() => binding.unbindSurface(surface)).not.toThrow();
      expect(binding.boundSurfaceCount()).toBe(0);
    });
  });

  describe('surface lookup helpers', () => {
    it('conversationForSurface() returns null on unbound surface', () => {
      expect(binding.conversationForSurface(SurfaceId.create())).toBeNull();
    });

    it('surfacesFor() returns empty array on unknown conversation', () => {
      expect(binding.surfacesFor(ConversationId.create())).toEqual([]);
    });

    it('hasBoundSurfaces() reflects current state', () => {
      const conv = ConversationId.create();
      expect(binding.hasBoundSurfaces(conv)).toBe(false);
      const surface = SurfaceId.create();
      binding.bindSurface(surface, conv);
      expect(binding.hasBoundSurfaces(conv)).toBe(true);
      binding.unbindSurface(surface);
      expect(binding.hasBoundSurfaces(conv)).toBe(false);
    });

    it('callers cannot mutate the reverse set through surfacesFor()', () => {
      const conv = ConversationId.create();
      const surface = SurfaceId.create();
      binding.bindSurface(surface, conv);

      const snapshot = binding.surfacesFor(conv) as SurfaceId[];
      snapshot.push(SurfaceId.create());

      expect(binding.surfacesFor(conv)).toEqual([surface]);
    });
  });

  describe('tab/surface isolation', () => {
    it('binding a surface does not add it to tabsFor()', () => {
      const conv = ConversationId.create();
      const surface = SurfaceId.create();
      binding.bindSurface(surface, conv);

      expect(binding.tabsFor(conv)).toEqual([]);
      expect(binding.hasBoundTabs(conv)).toBe(false);
    });

    it('binding a tab does not add it to surfacesFor()', () => {
      const conv = ConversationId.create();
      const tab = TabId.create();
      binding.bind(tab, conv);

      expect(binding.surfacesFor(conv)).toEqual([]);
      expect(binding.hasBoundSurfaces(conv)).toBe(false);
    });

    it('boundConversationCount counts a conversation referenced by both a tab and a surface only once', () => {
      const conv = ConversationId.create();
      binding.bind(TabId.create(), conv);
      binding.bindSurface(SurfaceId.create(), conv);

      expect(binding.boundConversationCount()).toBe(1);
    });

    it('boundConversationCount sums distinct conversations across tabs and surfaces', () => {
      const tabConv = ConversationId.create();
      const surfaceConv = ConversationId.create();
      binding.bind(TabId.create(), tabConv);
      binding.bindSurface(SurfaceId.create(), surfaceConv);

      expect(binding.boundConversationCount()).toBe(2);
    });

    it('unbinding a surface does not affect tab bindings on the same conversation', () => {
      const conv = ConversationId.create();
      const tab = TabId.create();
      const surface = SurfaceId.create();
      binding.bind(tab, conv);
      binding.bindSurface(surface, conv);

      binding.unbindSurface(surface);

      expect(binding.tabsFor(conv)).toEqual([tab]);
      expect(binding.surfacesFor(conv)).toEqual([]);
      expect(binding.boundConversationCount()).toBe(1);
    });

    it('unbinding a tab does not affect surface bindings on the same conversation', () => {
      const conv = ConversationId.create();
      const tab = TabId.create();
      const surface = SurfaceId.create();
      binding.bind(tab, conv);
      binding.bindSurface(surface, conv);

      binding.unbind(tab);

      expect(binding.tabsFor(conv)).toEqual([]);
      expect(binding.surfacesFor(conv)).toEqual([surface]);
      expect(binding.boundConversationCount()).toBe(1);
    });
  });
});
