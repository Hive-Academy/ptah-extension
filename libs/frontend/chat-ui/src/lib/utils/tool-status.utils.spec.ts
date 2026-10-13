import type { ExecutionStatus } from '@ptah-extension/shared';
import {
  toolStatusPresentation,
  type ToolStatusPresentation,
} from './tool-status.utils';

const PULSE = 'bg-info animate-pulse motion-reduce:animate-none';

describe('toolStatusPresentation', () => {
  describe('every status, command vs non-command', () => {
    it.each<[ExecutionStatus, boolean, ToolStatusPresentation]>([
      [
        'complete',
        false,
        { railClass: 'bg-success', label: 'Completed', failed: false },
      ],
      [
        'complete',
        true,
        { railClass: 'bg-success', label: 'Command succeeded', failed: false },
      ],
      [
        'error',
        false,
        { railClass: 'bg-error', label: 'Failed', failed: true },
      ],
      [
        'error',
        true,
        { railClass: 'bg-error', label: 'Command failed', failed: true },
      ],
      [
        'streaming',
        false,
        { railClass: PULSE, label: 'Running', failed: false },
      ],
      [
        'streaming',
        true,
        { railClass: PULSE, label: 'Command running', failed: false },
      ],
      [
        'interrupted',
        false,
        { railClass: 'bg-warning', label: 'Interrupted', failed: false },
      ],
      [
        'interrupted',
        true,
        { railClass: 'bg-warning', label: 'Interrupted', failed: false },
      ],
      [
        'resumed',
        false,
        { railClass: 'bg-info', label: 'Resumed', failed: false },
      ],
      [
        'resumed',
        true,
        { railClass: 'bg-info', label: 'Resumed', failed: false },
      ],
      [
        'pending',
        false,
        { railClass: 'bg-base-300', label: 'Pending', failed: false },
      ],
      [
        'pending',
        true,
        { railClass: 'bg-base-300', label: 'Pending', failed: false },
      ],
    ])('%s (command=%s)', (status, command, expected) => {
      expect(
        toolStatusPresentation(status, { command, awaitingPermission: false }),
      ).toEqual(expected);
    });
  });

  describe('a pending permission outranks every status', () => {
    it.each<[ExecutionStatus, boolean]>([
      ['complete', false],
      ['error', false],
      ['error', true],
      ['streaming', true],
      ['interrupted', false],
      ['resumed', false],
      ['pending', true],
    ])('%s (command=%s)', (status, command) => {
      expect(
        toolStatusPresentation(status, {
          command,
          awaitingPermission: true,
          background: true,
        }),
      ).toEqual({
        railClass: 'bg-warning',
        label: 'Awaiting permission',
        failed: false,
      });
    });
  });

  describe('a background call', () => {
    it.each<[boolean, string]>([
      [true, 'Command started'],
      [false, 'Started'],
    ])(
      'complete (command=%s) reads "%s" on a success rail',
      (command, label) => {
        expect(
          toolStatusPresentation('complete', {
            command,
            awaitingPermission: false,
            background: true,
          }),
        ).toEqual({ railClass: 'bg-success', label, failed: false });
      },
    );

    it.each<[ExecutionStatus, string, boolean]>([
      ['streaming', 'Command running', false],
      ['error', 'Command failed', true],
      ['pending', 'Pending', false],
    ])('%s is unaffected by the flag: "%s"', (status, label, failed) => {
      const presentation = toolStatusPresentation(status, {
        command: true,
        awaitingPermission: false,
        background: true,
      });
      expect(presentation.label).toBe(label);
      expect(presentation.failed).toBe(failed);
    });

    it('defaults to foreground when the flag is omitted', () => {
      expect(
        toolStatusPresentation('complete', {
          command: true,
          awaitingPermission: false,
        }).label,
      ).toBe('Command succeeded');
    });
  });
});
