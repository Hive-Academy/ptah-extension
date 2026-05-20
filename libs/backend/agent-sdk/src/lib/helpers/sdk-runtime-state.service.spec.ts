import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { ProviderHealth, ProviderStatus } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SdkRuntimeStateService } from './sdk-runtime-state.service';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

describe('SdkRuntimeStateService', () => {
  function make(): SdkRuntimeStateService {
    return new SdkRuntimeStateService(asLogger(createMockLogger()));
  }

  it('returns null cliJsPath before any set call', () => {
    const svc = make();
    expect(svc.getCliJsPath()).toBeNull();
  });

  it('roundtrips cliJsPath through set/get', () => {
    const svc = make();
    svc.setCliJsPath('/usr/local/bin/cli.js');
    expect(svc.getCliJsPath()).toBe('/usr/local/bin/cli.js');
  });

  it('accepts null to clear cliJsPath', () => {
    const svc = make();
    svc.setCliJsPath('/x');
    svc.setCliJsPath(null);
    expect(svc.getCliJsPath()).toBeNull();
  });

  it('returns initializing health before any set call', () => {
    const svc = make();
    expect(svc.getHealth().status).toBe('initializing');
  });

  it('roundtrips health through set/get', () => {
    const svc = make();
    const health: ProviderHealth = {
      status: 'available' as ProviderStatus,
      lastCheck: 1234,
      uptime: 5678,
    };
    svc.setHealth(health);
    expect(svc.getHealth()).toEqual(health);
  });

  it('returns a defensive copy from getHealth', () => {
    const svc = make();
    svc.setHealth({
      status: 'available' as ProviderStatus,
      lastCheck: 1,
    });
    const a = svc.getHealth();
    const b = svc.getHealth();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it('reset clears cliJsPath and returns health to initializing', () => {
    const svc = make();
    svc.setCliJsPath('/x');
    svc.setHealth({
      status: 'available' as ProviderStatus,
      lastCheck: 99,
    });
    svc.reset();
    expect(svc.getCliJsPath()).toBeNull();
    expect(svc.getHealth().status).toBe('initializing');
  });
});
