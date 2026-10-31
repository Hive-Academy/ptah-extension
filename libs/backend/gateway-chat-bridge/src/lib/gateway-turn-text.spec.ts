import { GatewayTurnText } from './gateway-turn-text';

describe('GatewayTurnText', () => {
  it('appends stream deltas, hook deltas, and deltas with no source', () => {
    const text = new GatewayTurnText();
    text.accept({
      messageId: 'm',
      blockIndex: 0,
      delta: 'hel',
      source: 'stream',
    });
    text.accept({ messageId: 'm', delta: 'lo' });
    text.accept({ messageId: 'm', blockIndex: 0, delta: '!', source: 'hook' });
    expect(text.join()).toBe('hello!');
  });

  it('replaces a block for complete and history instead of appending', () => {
    const text = new GatewayTurnText();
    text.accept({ messageId: 'm', delta: 'draft', source: 'stream' });
    text.accept({ messageId: 'm', delta: 'final', source: 'history' });
    expect(text.join()).toBe('final');
    text.accept({ messageId: 'm', delta: 'complete', source: 'complete' });
    expect(text.join()).toBe('complete');
  });

  it('treats an empty complete replacement as the block body', () => {
    const text = new GatewayTurnText();
    text.accept({ messageId: 'm', delta: 'draft', source: 'stream' });
    text.accept({ messageId: 'm', delta: '', source: 'complete' });
    expect(text.join()).toBe('');
  });

  it('joins to empty when nothing was accepted', () => {
    expect(new GatewayTurnText().join()).toBe('');
  });

  it('orders messages by the first noteMessage and blocks by blockIndex', () => {
    const text = new GatewayTurnText();
    text.noteMessage('second');
    text.noteMessage('first');
    text.noteMessage('second');
    text.accept({
      messageId: 'first',
      blockIndex: 2,
      delta: 'a2',
      source: 'stream',
    });
    text.accept({
      messageId: 'first',
      blockIndex: 0,
      delta: 'a0',
      source: 'stream',
    });
    text.accept({ messageId: 'second', delta: 'b0', source: 'stream' });
    expect(text.join()).toBe('b0a0a2');
  });
});
