import { TestBed } from '@angular/core/testing';
import type { MessageTokenUsage } from '@ptah-extension/shared';
import { TurnActivityPanelComponent } from '../components/molecules/turn/turn-activity-panel.component';
import {
  summarizeTurnMetrics,
  type TurnContext,
  type TurnMessageMetrics,
} from './turn-facts.utils';

function metric(id: string, tokens?: MessageTokenUsage): TurnMessageMetrics {
  return { id, timestamp: null, tokens, toolCount: 0, filesChanged: 0 };
}

function turn(messages: readonly TurnMessageMetrics[]): TurnContext {
  return {
    turnId: 'turn',
    startTs: null,
    assistantIds: messages.map((message) => message.id),
    index: 0,
    count: messages.length,
    isFirstAssistant: true,
    isLastAssistant: messages.length === 1,
    hasActivity: true,
    messages,
    settledEndTs: null,
  };
}

function tokenRows(root: Element): readonly { label: string; value: string }[] {
  return Array.from(root.querySelectorAll('dt'))
    .filter((label) => label.textContent?.trim().startsWith('Tokens'))
    .map((label) => ({
      label: label.textContent?.trim() ?? '',
      value: label.nextElementSibling?.textContent?.trim() ?? '',
    }));
}

describe('turn token facts', () => {
  it('sums both cache classes only for messages with complete, valid usage', () => {
    const summary = summarizeTurnMetrics(
      turn([
        metric('a', { input: 10, output: 5, cacheRead: 4, cacheCreation: 6 }),
        metric('b', { input: 2, output: 3 }),
        metric('c', { input: 99, output: -1, cacheRead: 20 }),
        metric('d'),
      ]),
    );

    expect(summary.tokens).toEqual({
      input: 12,
      output: 8,
      cacheRead: 4,
      cacheCreation: 6,
      knownCount: 2,
    });
    expect(summary.messageCount).toBe(4);
  });

  it('keeps missing or overflowing usage out of a token total', () => {
    expect(summarizeTurnMetrics(turn([metric('a')])).tokens).toBeNull();
    expect(
      summarizeTurnMetrics(
        turn([metric('a', { input: 1, output: 2, cacheCreation: NaN })]),
      ).tokens,
    ).toBeNull();
    expect(
      summarizeTurnMetrics(
        turn([
          metric('a', { input: Number.MAX_VALUE, output: 0 }),
          metric('b', { input: Number.MAX_VALUE, output: 0 }),
        ]),
      ).tokens,
    ).toBeNull();
  });
});

describe('turn activity token row', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TurnActivityPanelComponent] });
  });

  function render(messages: readonly TurnMessageMetrics[]): HTMLElement {
    const fixture = TestBed.createComponent(TurnActivityPanelComponent);
    fixture.componentRef.setInput('turn', turn(messages));
    fixture.componentRef.setInput('panelId', 'activity');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows cache usage and preserves the partial coverage label', () => {
    const element = render([
      metric('a', { input: 10, output: 5, cacheRead: 4, cacheCreation: 6 }),
      metric('b', { input: 2, output: -1 }),
      metric('c'),
    ]);

    expect(tokenRows(element)).toEqual([
      { label: 'Tokens · 1 of 3 messages', value: '10 in · 5 out · 10 cache' },
      { label: 'Tokens', value: '10 in · 5 out · 10 cache' },
    ]);
  });

  it('omits unknown token usage and zero cache usage', () => {
    expect(tokenRows(render([metric('missing')]))).toEqual([]);
    expect(
      tokenRows(render([metric('known', { input: 2, output: 3 })])),
    ).toEqual([{ label: 'Tokens', value: '2 in · 3 out' }]);
  });
});
