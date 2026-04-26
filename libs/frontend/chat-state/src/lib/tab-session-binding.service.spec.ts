import { TestBed } from '@angular/core/testing';
import { ConversationId, TabId } from './identity/ids';
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
});
