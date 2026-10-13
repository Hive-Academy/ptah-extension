import {
  exceedsWrappedRows,
  outputShowsError,
  toolOutputPlainText,
  toolRetentionMessage,
} from './tool-text.utils';

describe('tool-text.utils', () => {
  describe('toolOutputPlainText', () => {
    it('extracts MCP text blocks and strips reminders, ANSI and line numbers', () => {
      const raw = JSON.stringify([
        {
          type: 'text',
          text: '     1→\x1b[32mok\x1b[0m<system-reminder>x</system-reminder>',
        },
      ]);
      expect(toolOutputPlainText(raw)).toBe('ok');
    });

    it('serialises non-string output and returns empty for none', () => {
      expect(toolOutputPlainText({ a: 1 })).toBe('{\n  "a": 1\n}');
      expect(toolOutputPlainText(undefined)).toBe('');
    });
  });

  describe('exceedsWrappedRows', () => {
    it('counts wrapped rows, not lines, and ignores a trailing terminator', () => {
      expect(exceedsWrappedRows('a\nb\nc\n', 3)).toBe(false);
      expect(exceedsWrappedRows('a\nb\nc\nd', 3)).toBe(true);
      expect(exceedsWrappedRows('x'.repeat(301), 3)).toBe(true);
      expect(exceedsWrappedRows('x'.repeat(300), 3)).toBe(false);
    });
  });

  describe('outputShowsError', () => {
    it('matches an equal or whole trailing message after normalisation', () => {
      expect(outputShowsError('boom', ' boom\n')).toBe(true);
      expect(outputShowsError('step 1\r\nboom', 'boom')).toBe(true);
      expect(outputShowsError('step\n\x1b[31mboom\x1b[0m', 'boom')).toBe(true);
    });

    it('rejects incidental mentions and empty errors', () => {
      expect(outputShowsError('boom happened, then ok', 'boom')).toBe(false);
      expect(outputShowsError('no boom', 'boom')).toBe(false);
      expect(outputShowsError('anything', '   ')).toBe(false);
    });
  });

  describe('toolRetentionMessage', () => {
    const retention = {
      droppedChars: 1200,
      capped: ['toolOutput'] as const,
      foldFailed: false,
    };

    it('names the capped field and the shared recovery sentence', () => {
      const message = toolRetentionMessage(retention, 'toolOutput');
      expect(message).toMatch(/^Output truncated — 1,200 characters/);
      expect(message).toContain('reopen the session to reload it');
      expect(toolRetentionMessage(retention, 'toolInput')).toBeNull();
    });

    it('reports a failed fold with its reason', () => {
      expect(
        toolRetentionMessage(
          {
            ...retention,
            capped: ['toolInput'],
            foldFailed: true,
            reason: 'binary',
          },
          'toolInput',
        ),
      ).toMatch(/^Input could not be preserved \(binary\)\./);
    });
  });
});
