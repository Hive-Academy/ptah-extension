import type { TabState } from '@ptah-extension/chat-types';
import { TabId } from '@ptah-extension/shared';
import { projectTabForPersist, sanitizeRestoredTab } from './tab-persistence';

const baseTab = {
  id: TabId.create(),
  claudeSessionId: null,
  name: 'New Chat',
  title: 'New Chat',
  order: 0,
  status: 'fresh',
  isDirty: false,
  lastActivityAt: 0,
  messages: [],
  streamingState: null,
} as TabState;

describe('Command Center tab marker restore', () => {
  it('persists and restores a valid marker', () => {
    const marker = { workspaceId: '/workspace', createdAt: 123, version: 1 } as const;
    const stored = projectTabForPersist({ ...baseTab, commandCenterOrigin: marker });
    expect(stored.commandCenterOrigin).toEqual(marker);
    expect(sanitizeRestoredTab(stored).commandCenterOrigin).toEqual(marker);
  });

  it.each([null, {}, { workspaceId: '', createdAt: 123, version: 1 },
    { workspaceId: '/workspace', createdAt: '123', version: 1 },
    { workspaceId: '/workspace', createdAt: 123, version: 2 },
  ])('drops malformed marker %p', (marker) => {
    const stored = { ...baseTab, commandCenterOrigin: marker } as TabState;
    expect(sanitizeRestoredTab(stored).commandCenterOrigin).toBeUndefined();
  });

  it('leaves an unmarked tab ordinary', () => {
    expect(sanitizeRestoredTab(baseTab).commandCenterOrigin).toBeUndefined();
  });
});
