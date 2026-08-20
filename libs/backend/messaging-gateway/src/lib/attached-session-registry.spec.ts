import 'reflect-metadata';

import type { ISessionAttachmentGuard } from '@ptah-extension/platform-core';
import { AttachedSessionRegistry } from './attached-session-registry';

describe('AttachedSessionRegistry', () => {
  let registry: AttachedSessionRegistry;

  beforeEach(() => {
    registry = new AttachedSessionRegistry();
  });

  it('records attach and reports isAttached / bindingFor', () => {
    registry.attach('uuid-1', 'binding-1');

    expect(registry.isAttached('uuid-1')).toBe(true);
    expect(registry.bindingFor('uuid-1')).toBe('binding-1');
  });

  it('reports false / null for unknown sessions', () => {
    expect(registry.isAttached('nope')).toBe(false);
    expect(registry.bindingFor('nope')).toBeNull();
  });

  it('detach removes the record', () => {
    registry.attach('uuid-1', 'binding-1');
    registry.detach('uuid-1');

    expect(registry.isAttached('uuid-1')).toBe(false);
    expect(registry.bindingFor('uuid-1')).toBeNull();
  });

  it('detach of an absent uuid is a no-op', () => {
    expect(() => registry.detach('absent')).not.toThrow();
  });

  it('ignores empty uuid / bindingId on attach', () => {
    registry.attach('', 'binding-1');
    registry.attach('uuid-2', '');

    expect(registry.isAttached('')).toBe(false);
    expect(registry.isAttached('uuid-2')).toBe(false);
  });

  it('last attach for a uuid wins', () => {
    registry.attach('uuid-1', 'binding-a');
    registry.attach('uuid-1', 'binding-b');

    expect(registry.bindingFor('uuid-1')).toBe('binding-b');
  });

  it('satisfies the ISessionAttachmentGuard port (chat:resume backstop)', () => {
    // Structural assignability: the registry is the Electron-host adapter for
    // the platform-core port the shared chat handler injects.
    const guard: ISessionAttachmentGuard = registry;
    registry.attach('uuid-9', 'binding-9');

    expect(guard.isAttached('uuid-9')).toBe(true);
    expect(guard.isAttached('uuid-absent')).toBe(false);
  });
});
