import {
  authModalityBadge,
  authModalityLabel,
  connectionAvatarTone,
  connectionCardSpine,
  connectionCardTone,
  connectionInitials,
  connectionStateCopy,
  connectionStateDot,
  connectionStateLabel,
  primaryConnectionAction,
  resolveConnectionState,
  type ResolvedConnectionState,
} from './provider-connection-card.state';

describe('resolveConnectionState: a status that is not a confirmed success is never Connected', () => {
  it.each([
    ['unknown', null, 'not-checked'],
    ['skipped', null, 'check-unavailable'],
    ['missing', null, 'not-configured'],
    ['reachable', null, 'not-checked'],
    ['reachable', true, 'connected'],
    ['connected', false, 'not-checked'],
    ['connected', null, 'connected'],
    ['active', false, 'not-checked'],
    ['active', null, 'active'],
    ['needs-key', null, 'needs-key'],
    ['unreachable', null, 'unreachable'],
  ] as const)('%s with evidence %s → %s', (status, evidence, expected) => {
    expect(resolveConnectionState(status, evidence, false, false)).toBe(expected);
  });

  it('a connected, selected and unblocked route is active; a blocked one stays connected', () => {
    expect(resolveConnectionState('connected', null, true, false)).toBe('active');
    expect(resolveConnectionState('connected', null, true, true)).toBe('connected');
  });
});

describe('state table: label, copy, tone, spine, dot (design-spec)', () => {
  const rows: readonly [ResolvedConnectionState, string, string, string, boolean, string][] = [
    ['active', 'Active for main agent', 'Used for new main-agent requests.', 'secondary', true, 'bg-success'],
    ['connected', 'Connected','Connected and available to use.', 'neutral', false, 'bg-success'],
    ['needs-key', 'Needs API key', 'Add an API key to connect Moonshot.', 'warning', true, 'bg-warning'],
    ['unauthenticated', 'Sign-in required', 'Your credential is missing or expired; authenticate again.', 'error', false, 'bg-error'],
    ['unreachable', 'Unreachable', 'Could not reach Moonshot; check the connection and retry.', 'warning', true, 'bg-warning'],
    ['not-installed', 'Not installed', 'Install Claude CLI to use this connection.', 'neutral', false, 'bg-base-content-muted'],
    ['not-configured', 'Not configured', 'Set up Moonshot when you are ready.', 'neutral', false, 'bg-base-content-muted'],
    ['checking', 'Checking…', 'Checking Moonshot…', 'neutral', false, 'bg-info animate-pulse'],
    ['not-checked', 'Not checked', 'Connection has not been verified.', 'neutral', false, 'bg-base-content-muted'],
    ['check-unavailable', 'Check unavailable', 'Could not check this connection. Retry.', 'neutral', false, 'bg-base-content-muted'],
  ];
  it.each(rows)('%s', (state, label, copy, tone, spine, dot) => {
    expect(connectionStateLabel(state, false)).toBe(label);
    expect(connectionStateCopy(state, 'Moonshot', 'Claude CLI')).toBe(copy);
    expect(connectionCardTone(state, false)).toBe(tone);
    expect(connectionCardSpine(state, false)).toBe(spine);
    expect(connectionStateDot(state)).toBe(dot);
  });

  it('a rejected credential reads "Credential rejected"', () => {
    expect(connectionStateLabel('unauthenticated', true)).toBe('Credential rejected');
  });

  it('a blocked main route always warns, with a spine', () => {
    expect(connectionCardTone('connected', true)).toBe('warning');
    expect(connectionCardSpine('not-checked', true)).toBe(true);
  });
});

describe('primaryConnectionAction: at most one inline action per state (plan :631)', () => {
  const base = { canActivateMain: true, uncheckable: false, credentialRejected: false };
  it.each([
    ['active', base, null],
    ['checking', base, null],
    ['connected', base, 'activate-main'],
    ['connected', { ...base, canActivateMain: false }, null],
    ['needs-key', base, 'add-key'],
    ['unauthenticated', base, 'sign-in'],
    ['unauthenticated', { ...base, credentialRejected: true }, 'replace-key'],
    ['unreachable', base, 'retry'],
    ['not-installed', base, 'check-again'],
    ['not-configured', base, 'set-up'],
    // RUX-7, unchanged by design: a checkable Not checked connection is checked first.
    ['not-checked', base, 'check-connection'],
    ['not-checked', { ...base, uncheckable: true }, 'activate-main'],
    ['not-checked', { ...base, uncheckable: true, canActivateMain: false }, 'check-connection'],
    ['check-unavailable', base, 'retry'],
    ['check-unavailable', { ...base, uncheckable: true }, 'activate-main'],
  ] as const)('%s %j → %s', (state, options, expected) => {
    expect(primaryConnectionAction(state, options)).toBe(expected);
  });
});

describe('auth modality: short badge and full provenance label', () => {
  it.each([
    ['apiKey', 'API key', 'API key'], ['api-key', 'API key', 'API key'], ['cli', 'CLI', 'CLI subscription'],
    ['oauth', 'OAuth', 'OAuth'], ['local-native', 'Local', 'Local endpoint'], ['local-proxy', 'Local', 'Local endpoint'],
    ['custom', 'custom', 'custom'], [null, null, null],
  ] as const)('%s → badge %s, label %s', (modality, badge, label) => {
    expect(authModalityBadge(modality)).toBe(badge);
    expect(authModalityLabel(modality)).toBe(label);
  });
});

describe('avatar', () => {
  it.each([
    ['Moonshot (Kimi)', 'MK'],
    ['sovereigneg', 'SO'],
    ['Claude (Subscription)', 'CS'],
    ['OpenAI Codex', 'OC'],
    ['', '?'],
  ])('initials of "%s" are %s', (name, initials) => {
    expect(connectionInitials(name)).toBe(initials);
  });

  it('keeps one tone per connection id, from the three avatar surfaces', () => {
    expect(connectionAvatarTone('moonshot')).toBe(connectionAvatarTone('moonshot'));
    const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'moonshot', 'sovereigneg'].map(connectionAvatarTone));
    for (const tone of tones) expect(tone).toMatch(/^border-(primary|secondary|info)\/\d+ bg-(primary|secondary|info)\/10$/);
  });
});
