import 'reflect-metadata';
import { attachCliHostAttention } from './container';
import { container as rootContainer } from 'tsyringe';
import { registerPlatformCliServices } from '@ptah-extension/platform-cli';
import { PLATFORM_TOKENS, type IFileSystemProvider } from '@ptah-extension/platform-core';

it('resolves the CLI filesystem port with bounded no-follow operations', () => {
  const container = rootContainer.createChildContainer();
  registerPlatformCliServices(container, { appPath: process.cwd() });
  const provider = container.resolve<IFileSystemProvider>(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER);
  expect(typeof provider.lstat).toBe('function');
  expect(typeof provider.realpath).toBe('function');
  expect(typeof provider.readFileBoundedNoFollow).toBe('function');
  container.clearInstances();
});

describe('CLI container attention attach', () => {
  it.each(['resolve', 'attach'] as const)('logs %s failure by name and continues', (stage) => {
    const warn = jest.fn();
    const attach = jest.fn(() => ({ dispose: jest.fn() }));
    const resolve = () => {
      if (stage === 'resolve') throw new TypeError('secret');
      return { observe: jest.fn() };
    };
    if (stage === 'attach') attach.mockImplementation(() => { throw new TypeError('secret'); });
    expect(attachCliHostAttention(resolve, attach, warn)).toBeUndefined();
    const nextBootStep = jest.fn();
    nextBootStep();
    expect(nextBootStep).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Host attention attach failed: TypeError');
    expect(warn.mock.calls.join(' ')).not.toContain('secret');
  });
});
