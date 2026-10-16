import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commandCenterPersonaFor } from '@ptah-extension/chat-state';

describe('Chat view rewind persona', () => {
  const source = readFileSync(
    join(__dirname, 'chat-view.component.ts'),
    'utf8',
  );

  it('derives a persona only for a marked originating tab', () => {
    expect(commandCenterPersonaFor({})).toBeUndefined();
    expect(source).toMatch(
      /const rewindTab = this\._tabManager\.findTabBySessionId\(sessionId\);\s*const systemPrompt = rewindTab\s*\? commandCenterPersonaFor\(rewindTab\)\s*: undefined;/,
    );
  });

  it('passes the same persona to dry run and commit', () => {
    const body = source.slice(source.indexOf('private async attemptRewindV2('));
    expect(body.match(/anchorHint,\s*systemPrompt,/g)).toHaveLength(2);
  });
});
