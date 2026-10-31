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
        "Treat it as that agent's report and act on it.",
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

  it('parses a cross-session message without its preamble or trailer', () => {
    const envelope = parseLaneEnvelope(
      [
        'Another Claude session sent a message:',
        '<cross-session-message from="uds:/run/user/1000/cc-socks/1016602.sock" from-name="ptah-prefix-diet" from-mode="prompting">',
        'If you own PR #865, address its review comment.',
        'CodeRabbit left 1 inline review comment.',
        '</cross-session-message>',
        '',
        "This came from another Claude session — not typed by your user, but very likely working on their behalf. Treat it as a teammate's request.",
      ].join('\n'),
    );
    expect(envelope).toEqual({
      kind: 'report',
      agentId: 'uds:/run/user/1000/cc-socks/1016602.sock',
      agent: 'ptah-prefix-diet',
      cli: 'claude',
      body: 'If you own PR #865, address its review comment.\nCodeRabbit left 1 inline review comment.',
      crossSession: true,
    });
    expect(envelope && laneEnvelopePeerLabel(envelope)).toBe(
      'ptah-prefix-diet',
    );
  });

  it('names a cross-session sender without from-name generically', () => {
    expect(
      parseLaneEnvelope(
        '<cross-session-message from="uds:x">\nhi\n</cross-session-message>',
      ),
    ).toMatchObject({ agentId: 'uds:x', agent: 'Claude session', body: 'hi' });
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
    ['an SDK envelope without from', '<agent-message>\nx\n</agent-message>'],
    [
      'text after an SDK envelope',
      '<agent-message from="a">\nx\n</agent-message> and more',
    ],
    [
      'two SDK envelopes',
      '<agent-message from="a">x</agent-message><agent-message from="b">y</agent-message>',
    ],
    [
      'a cross-session message without from',
      '<cross-session-message from-name="a">\nx\n</cross-session-message>',
    ],
    [
      'text after a cross-session message',
      '<cross-session-message from="uds:x">\nx\n</cross-session-message> and more',
    ],
    [
      'a text block after the cross-session trailer',
      '<cross-session-message from="uds:x">\nx\n</cross-session-message>\n\nThis came from another Claude session.\n\nUnrelated text.',
    ],
    [
      'a text block after the SDK trailer',
      '<agent-message from="a">\nx\n</agent-message>\n\nThat "other Claude session" is an agent.\n\nUnrelated text.',
    ],
  ])('returns null for %s', (_label, text) => {
    expect(parseLaneEnvelope(text)).toBeNull();
  });

  it('accepts an SDK envelope whose body mentions the tag', () => {
    expect(
      parseLaneEnvelope(
        '<agent-message from="a1">\nSearch for <agent-message in the source.\n</agent-message>',
      ),
    ).toMatchObject({
      kind: 'report',
      agentId: 'a1',
      cli: 'subagent',
      body: 'Search for <agent-message in the source.',
    });
  });

  it('accepts a multi-line SDK trailer paragraph', () => {
    expect(
      parseLaneEnvelope(
        '<agent-message from="a1">\nDone.\n</agent-message>\n\nThat "other Claude session" is an agent\nworking in this session.\n',
      ),
    ).toMatchObject({ agentId: 'a1', body: 'Done.' });
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
