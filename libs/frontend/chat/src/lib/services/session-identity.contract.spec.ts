import { DEFAULT_SESSION_NAME_PATTERN } from '@ptah-extension/chat-state';
import { defaultSessionName } from '@ptah-extension/core';

describe('session identity boundary contract', () => {
  it('keeps chat-state default-name recognition aligned with frontend/core', () => {
    expect(
      DEFAULT_SESSION_NAME_PATTERN.test(defaultSessionName(new Date())),
    ).toBe(true);
  });
});
