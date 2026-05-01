import 'reflect-metadata';
import { container } from 'tsyringe';
import {
  createTestContainer,
  resetTestContainer,
} from './tsyringe-test-container';

describe('tsyringe-test-container', () => {
  const TOKEN = 'test:greeting';

  afterEach(() => {
    // Defensive: ensure the root container does not leak test registrations.
    if (container.isRegistered(TOKEN)) {
      container.reset();
    }
  });

  it('child registrations do not mutate the global container', () => {
    const child = createTestContainer();
    child.register<string>(TOKEN, { useValue: 'hello' });

    expect(child.resolve<string>(TOKEN)).toBe('hello');
    expect(container.isRegistered(TOKEN)).toBe(false);
  });

  it('resetTestContainer clears registrations', () => {
    const child = createTestContainer();
    child.register<string>(TOKEN, { useValue: 'hello' });
    expect(child.isRegistered(TOKEN)).toBe(true);

    resetTestContainer(child);
    expect(child.isRegistered(TOKEN)).toBe(false);
  });
});
