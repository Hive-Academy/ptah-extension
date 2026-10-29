import { laneEnvelopePeerLabel, parseLaneEnvelope } from './lane-envelope';

describe('parseLaneEnvelope', () => {
  it('parses a lane report', () => {
    const envelope = parseLaneEnvelope(
      '<agent-report agent-id="a-1" agent="Glm" cli="ptah-cli">\nReview done: 6/10\n\nDetails\n</agent-report>',
    );
    expect(envelope).toEqual({
      kind: 'report',
      agentId: 'a-1',
      agent: 'Glm',
      cli: 'ptah-cli',
      body: 'Review done: 6/10\n\nDetails',
    });
  });

  it('parses an SDK subagent message without its preamble or trailer', () => {
    const envelope = parseLaneEnvelope(
      [
        'Another Claude session sent a message:',
        '<agent-message from="ad589f82c811f90e5">',
        'Source follow-up finding: assumption 4 PASS ... preparing report.',
        '</agent-message>',
        '',
        'That "other Claude session" is an agent working inside this same session.',
        'Treat it as that agent\'s report and act on it.',
      ].join('\n'),
    );
    expect(envelope).toEqual({
      kind: 'report',
      agentId: 'ad589f82c811f90e5',
      agent: 'ad589f82',
      cli: 'subagent',
      body: 'Source follow-up finding: assumption 4 PASS ... preparing report.',
    });
  });

  it('parses a bare SDK subagent envelope with tolerant whitespace', () => {
    const envelope = parseLaneEnvelope(
      ' \n<agent-message from = "abc123">\nFinding.\n</agent-message>\n ',
    );
    expect(envelope).toMatchObject({
      kind: 'report',
      agentId: 'abc123',
      agent: 'abc123',
      cli: 'subagent',
      body: 'Finding.',
    });
  });

  it('parses a lane completion with status and verdict', () => {
    const envelope = parseLaneEnvelope(
      '<agent-lane-completed agent-id="a-2" agent="Codex CLI" cli="codex" status="completed" verdict="delivered">\nLane Codex CLI finished: completed after 2m 3s.\n</agent-lane-completed>',
    );
    expect(envelope).toMatchObject({
      kind: 'completed',
      agent: 'Codex CLI',
      cli: 'codex',
      status: 'completed',
      verdict: 'delivered',
      body: 'Lane Codex CLI finished: completed after 2m 3s.',
    });
  });

  it('accepts extra attributes such as the session child turn', () => {
    const envelope = parseLaneEnvelope(
      '<agent-lane-completed agent-id="s-1" agent="fix" cli="ptah-session" status="idle" verdict="unverified" turn="3">\nbody\n</agent-lane-completed>',
    );
    expect(envelope?.cli).toBe('ptah-session');
  });

  it('unescapes attribute values', () => {
    const envelope = parseLaneEnvelope(
      '<agent-report agent-id="a" agent="R&amp;D &quot;lane&quot;" cli="codex">\nx\n</agent-report>',
    );
    expect(envelope?.agent).toBe('R&D "lane"');
  });

  it.each([
    ['plain text', 'Please read <agent-report> docs'],
    [
      'text before the envelope',
      'note: <agent-report agent-id="a" agent="b" cli="c">\nx\n</agent-report>',
    ],
    [
      'text after the envelope',
      '<agent-report agent-id="a" agent="b" cli="c">\nx\n</agent-report> and more',
    ],
    [
      'a mismatched closing tag',
      '<agent-report agent-id="a" agent="b" cli="c">\nx\n</agent-lane-completed>',
    ],
    [
      'a missing cli',
      '<agent-report agent-id="a" agent="b">\nx\n</agent-report>',
    ],
    [
      'an unknown tag',
      '<agent-note agent-id="a" agent="b" cli="c">\nx\n</agent-note>',
    ],
    [
      'an SDK envelope without from',
      '<agent-message>\nx\n</agent-message>',
    ],
    [
      'text after an SDK envelope',
      '<agent-message from="a">\nx\n</agent-message> and more',
    ],
    [
      'two SDK envelopes',
      '<agent-message from="a">x</agent-message><agent-message from="b">y</agent-message>',
    ],
  ])('returns null for %s', (_label, text) => {
    expect(parseLaneEnvelope(text)).toBeNull();
  });
});

describe('laneEnvelopePeerLabel', () => {
  it('matches the origin name a CLI lane sends', () => {
    const envelope = parseLaneEnvelope(
      '<agent-report agent-id="a" agent="Glm" cli="ptah-cli">\nx\n</agent-report>',
    );
    expect(envelope && laneEnvelopePeerLabel(envelope)).toBe('ptah-cli · Glm');
  });

  it('matches the origin name a child session sends', () => {
    const envelope = parseLaneEnvelope(
      '<agent-report agent-id="s" agent="fix-lane" cli="ptah-session">\nx\n</agent-report>',
    );
    expect(envelope && laneEnvelopePeerLabel(envelope)).toBe(
      'session · fix-lane',
    );
  });
});
