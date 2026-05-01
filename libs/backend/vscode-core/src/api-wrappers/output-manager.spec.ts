/**
 * OutputManager unit tests.
 *
 * Exercises the real OutputManager surface: channel creation, write
 * formatting, metric tracking, lifecycle management (show/hide/clear),
 * and disposal.
 *
 * TASK_2025_291 Wave B: replaces a ghost spec that mocked a nonexistent
 * EventBus dependency.
 */

import 'reflect-metadata';
import type * as vscode from 'vscode';

import {
  OutputManager,
  type OutputChannelConfig,
  type WriteOptions,
} from './output-manager';

// -------------------------------------------------------------------------
// Module-level vscode mock
// -------------------------------------------------------------------------
jest.mock('vscode', () => ({
  window: {
    createOutputChannel: jest.fn(),
  },
  Uri: {
    file: jest.fn(),
    parse: jest.fn(),
    joinPath: jest.fn(),
  },
}));

const vscodeModule = jest.requireMock<{
  window: { createOutputChannel: jest.Mock };
}>('vscode');

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
type MockChannel = {
  name: string;
  appendLine: jest.Mock<void, [string]>;
  append: jest.Mock<void, [string]>;
  replace: jest.Mock<void, [string]>;
  clear: jest.Mock<void, []>;
  show: jest.Mock<void, [boolean?]>;
  hide: jest.Mock<void, []>;
  dispose: jest.Mock<void, []>;
};

function createMockChannel(name: string): MockChannel {
  return {
    name,
    appendLine: jest.fn(),
    append: jest.fn(),
    replace: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  };
}

function createMockContext(): Pick<vscode.ExtensionContext, 'subscriptions'> {
  return { subscriptions: [] } as Pick<
    vscode.ExtensionContext,
    'subscriptions'
  >;
}

/**
 * Shape of the per-channel metrics entry returned by OutputManager.
 * Kept in sync with OutputManager.channelMetrics.
 */
interface ChannelMetrics {
  messageCount: number;
  lastWrite: number;
  createdAt: number;
  totalWrites: number;
  errorCount: number;
  levelCounts: {
    debug: number;
    info: number;
    warn: number;
    error: number;
  };
}

function getSingleMetrics(
  manager: OutputManager,
  channelName: string,
): ChannelMetrics {
  const raw = manager.getChannelMetrics(channelName);
  if (raw === null) {
    throw new Error(`expected metrics for channel ${channelName}`);
  }
  return raw as ChannelMetrics;
}

describe('OutputManager', () => {
  let context: Pick<vscode.ExtensionContext, 'subscriptions'>;
  let createOutputChannelMock: jest.Mock;
  let createdChannels: MockChannel[];
  let manager: OutputManager;

  beforeEach(() => {
    jest.clearAllMocks();
    createdChannels = [];
    createOutputChannelMock = vscodeModule.window.createOutputChannel;
    createOutputChannelMock.mockImplementation((name: string) => {
      const channel = createMockChannel(name);
      createdChannels.push(channel);
      return channel;
    });
    context = createMockContext();
    manager = new OutputManager(context as vscode.ExtensionContext);
  });

  afterEach(() => {
    manager.dispose();
  });

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------
  describe('construction', () => {
    it('starts with no channels', () => {
      expect(manager.getChannelNames()).toEqual([]);
      expect(manager.getChannelMetrics()).toEqual({});
    });
  });

  // ---------------------------------------------------------------------
  // createOutputChannel
  // ---------------------------------------------------------------------
  describe('createOutputChannel', () => {
    it('creates a new output channel and registers it for disposal', () => {
      const config: OutputChannelConfig = { name: 'ptah.test' };

      const channel = manager.createOutputChannel(config);

      expect(createOutputChannelMock).toHaveBeenCalledWith('ptah.test');
      expect(channel).toBe(createdChannels[0]);
      expect(context.subscriptions).toContain(createdChannels[0]);
      expect(manager.hasChannel('ptah.test')).toBe(true);
      expect(manager.getChannelNames()).toEqual(['ptah.test']);
    });

    it('forwards languageId when provided', () => {
      manager.createOutputChannel({ name: 'ptah.lang', languageId: 'json' });

      expect(createOutputChannelMock).toHaveBeenCalledWith('ptah.lang', 'json');
    });

    it('returns the existing channel when creating with a duplicate name', () => {
      const first = manager.createOutputChannel({ name: 'ptah.dup' });
      const second = manager.createOutputChannel({ name: 'ptah.dup' });

      expect(second).toBe(first);
      expect(createOutputChannelMock).toHaveBeenCalledTimes(1);
    });

    it('initialises zeroed metrics for the new channel', () => {
      manager.createOutputChannel({ name: 'ptah.metrics' });

      const metrics = getSingleMetrics(manager, 'ptah.metrics');
      expect(metrics.messageCount).toBe(0);
      expect(metrics.totalWrites).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.levelCounts).toEqual({
        debug: 0,
        info: 0,
        warn: 0,
        error: 0,
      });
      expect(metrics.createdAt).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------
  // write
  // ---------------------------------------------------------------------
  describe('write', () => {
    const channelName = 'ptah.write';

    beforeEach(() => {
      manager.createOutputChannel({ name: channelName });
    });

    it('calls appendLine on the channel with the plain message by default', () => {
      manager.write(channelName, 'hello world');

      const channel = createdChannels[0];
      expect(channel.appendLine).toHaveBeenCalledWith('hello world');
    });

    it('applies a prefix and ISO timestamp when requested', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-04-23T12:34:56.000Z'));

      try {
        const options: WriteOptions = {
          prefix: 'AGENT',
          timestamp: true,
          level: 'info',
        };
        manager.write(channelName, 'msg', options);

        const channel = createdChannels[0];
        expect(channel.appendLine).toHaveBeenCalledWith(
          '[2025-04-23T12:34:56.000Z] [AGENT] msg',
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('increments per-level metrics on successful writes', () => {
      manager.write(channelName, 'a', { level: 'warn' });
      manager.write(channelName, 'b', { level: 'warn' });
      manager.write(channelName, 'c', { level: 'error' });

      const metrics = getSingleMetrics(manager, channelName);
      expect(metrics.totalWrites).toBe(3);
      expect(metrics.messageCount).toBe(3);
      expect(metrics.levelCounts.warn).toBe(2);
      expect(metrics.levelCounts.error).toBe(1);
      expect(metrics.levelCounts.info).toBe(0);
    });

    it('silently no-ops when writing to an unknown channel', () => {
      expect(() => manager.write('ptah.unknown', 'x')).not.toThrow();
    });

    it('increments errorCount and re-throws when appendLine throws', () => {
      const channel = createdChannels[0];
      channel.appendLine.mockImplementationOnce(() => {
        throw new Error('channel write failed');
      });

      expect(() =>
        manager.write(channelName, 'boom', { level: 'error' }),
      ).toThrow('channel write failed');

      const metrics = getSingleMetrics(manager, channelName);
      expect(metrics.errorCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // writeLines
  // ---------------------------------------------------------------------
  describe('writeLines', () => {
    it('writes each message with the shared options', () => {
      const channelName = 'ptah.lines';
      manager.createOutputChannel({ name: channelName });

      manager.writeLines(channelName, ['one', 'two', 'three'], {
        level: 'debug',
      });

      const channel = createdChannels[0];
      expect(channel.appendLine).toHaveBeenNthCalledWith(1, 'one');
      expect(channel.appendLine).toHaveBeenNthCalledWith(2, 'two');
      expect(channel.appendLine).toHaveBeenNthCalledWith(3, 'three');

      const metrics = getSingleMetrics(manager, channelName);
      expect(metrics.levelCounts.debug).toBe(3);
    });
  });

  // ---------------------------------------------------------------------
  // clear / show / hide
  // ---------------------------------------------------------------------
  describe('lifecycle helpers', () => {
    const channelName = 'ptah.lifecycle';

    beforeEach(() => {
      manager.createOutputChannel({ name: channelName });
    });

    it('clear() delegates to channel.clear() and returns true', () => {
      expect(manager.clear(channelName)).toBe(true);
      expect(createdChannels[0].clear).toHaveBeenCalledTimes(1);
    });

    it('clear() returns false for an unknown channel', () => {
      expect(manager.clear('ptah.unknown')).toBe(false);
    });

    it('show() delegates to channel.show() with the preserveFocus flag', () => {
      expect(manager.show(channelName, true)).toBe(true);
      expect(createdChannels[0].show).toHaveBeenCalledWith(true);
    });

    it('show() defaults preserveFocus to false', () => {
      manager.show(channelName);
      expect(createdChannels[0].show).toHaveBeenCalledWith(false);
    });

    it('hide() delegates to channel.hide() and returns true', () => {
      expect(manager.hide(channelName)).toBe(true);
      expect(createdChannels[0].hide).toHaveBeenCalledTimes(1);
    });

    it('hide() returns false for an unknown channel', () => {
      expect(manager.hide('ptah.unknown')).toBe(false);
    });

    it('show() returns false if channel.show() throws', () => {
      createdChannels[0].show.mockImplementation(() => {
        throw new Error('show failed');
      });
      expect(manager.show(channelName)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------
  describe('accessors', () => {
    it('getChannel() returns the channel for a known name', () => {
      manager.createOutputChannel({ name: 'ptah.acc' });
      expect(manager.getChannel('ptah.acc')).toBe(createdChannels[0]);
    });

    it('getChannel() returns undefined for an unknown name', () => {
      expect(manager.getChannel('ptah.unknown')).toBeUndefined();
    });

    it('getChannelMetrics() returns null for an unknown channel', () => {
      expect(manager.getChannelMetrics('ptah.unknown')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // disposeChannel
  // ---------------------------------------------------------------------
  describe('disposeChannel', () => {
    it('disposes the channel, removes tracking, and clears metrics', () => {
      manager.createOutputChannel({ name: 'ptah.disp' });
      const channel = createdChannels[0];

      expect(manager.disposeChannel('ptah.disp')).toBe(true);
      expect(channel.dispose).toHaveBeenCalledTimes(1);
      expect(manager.hasChannel('ptah.disp')).toBe(false);
      expect(manager.getChannelMetrics('ptah.disp')).toBeNull();
    });

    it('returns false for an unknown channel', () => {
      expect(manager.disposeChannel('ptah.unknown')).toBe(false);
    });

    it('returns false if channel.dispose() throws', () => {
      manager.createOutputChannel({ name: 'ptah.disp.err' });
      createdChannels[0].dispose.mockImplementation(() => {
        throw new Error('dispose failed');
      });

      expect(manager.disposeChannel('ptah.disp.err')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // dispose (all channels)
  // ---------------------------------------------------------------------
  describe('dispose', () => {
    it('disposes every channel and clears tracking state', () => {
      manager.createOutputChannel({ name: 'ptah.all.1' });
      manager.createOutputChannel({ name: 'ptah.all.2' });
      const [a, b] = createdChannels;

      manager.dispose();

      expect(a.dispose).toHaveBeenCalledTimes(1);
      expect(b.dispose).toHaveBeenCalledTimes(1);
      expect(manager.getChannelNames()).toEqual([]);
      expect(manager.getChannelMetrics()).toEqual({});
    });
  });
});
