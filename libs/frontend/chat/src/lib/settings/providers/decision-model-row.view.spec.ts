import {
  DECISION_MODEL_INVALID_BASE_URL,
  DECISION_MODEL_INVALID_MODEL,
  DECISION_MODEL_KEY_NEEDS_HTTPS,
  type DecisionModelStatusDto,
} from '@ptah-extension/shared';
import {
  DECISION_KIND_OPTIONS,
  buildDecisionRow,
  decisionDraftForKind,
  decisionDraftFrom,
  decisionModelInput,
  endpointFieldError,
  parseDecisionModelStatus,
  sameDecisionSelection,
  type DecisionModelDraft,
} from './decision-model-row.view';

const status = (
  overrides: Partial<DecisionModelStatusDto>,
): DecisionModelStatusDto => ({
  selection: { kind: 'unset' },
  locality: null,
  reportsConfidence: false,
  state: 'unset',
  detail: null,
  ...overrides,
});

describe('decision-model-row.view: the Decision model row (TASK_2026_646 Req 1)', () => {
  it('offers exactly the four kinds, Unset first (Req 1.2)', () => {
    expect(DECISION_KIND_OPTIONS).toEqual([
      { value: 'unset', label: 'Unset' },
      { value: 'ollama', label: 'Ollama decision model' },
      { value: 'jev', label: 'TypeSafe Jev' },
      { value: 'structured', label: 'Structured-output model' },
    ]);
  });

  it.each([
    [
      status({}),
      'unset',
      'Unset · code ranking',
      /no decision request is sent/,
      null,
    ],
    [
      status({
        selection: { kind: 'ollama', model: 'tev1' },
        locality: 'local',
        state: 'ready',
      }),
      'ready',
      'Ollama · tev1',
      /Ollama is ready/,
      null,
    ],
    [
      status({
        selection: { kind: 'jev', model: 'jev-1.13.0' },
        locality: 'remote',
        state: 'no-credential',
      }),
      'no credential',
      'TypeSafe Jev · jev-1.13.0',
      /No TypeSafe Jev API key is stored/,
      null,
    ],
    [
      status({
        selection: {
          kind: 'structured',
          providerId: 'moonshot',
          model: 'kimi',
        },
        locality: 'remote',
        state: 'unreachable',
      }),
      'not reachable',
      'Moonshot (Kimi) · kimi',
      /Could not reach Moonshot \(Kimi\)/,
      'moonshot',
    ],
    [
      status({
        selection: { kind: 'ollama', model: 'laya' },
        locality: 'remote',
        state: 'unsupported-endpoint',
      }),
      'not supported',
      'Ollama · laya',
      /needs Ollama 0\.35 or later/,
      'ollama',
    ],
  ] as const)(
    'shows state %#: badge "%s"',
    (input, badge, cell, message, setup) => {
      const row = buildDecisionRow(input);
      expect(row).toEqual(
        expect.objectContaining({
          id: 'decision',
          name: 'Decision model',
          stateLabel: badge,
          cellLabel: cell,
        }),
      );
      expect(row.stateMessage).toMatch(message);
      expect(row.setupProviderId).toBe(setup);
    },
  );

  it('Jev without a key has no provider set-up link: its key is entered in the row (Req 1.5)', () => {
    const row = buildDecisionRow(
      status({
        selection: { kind: 'jev', model: 'jev-1.13.0' },
        state: 'no-credential',
      }),
    );
    expect(row.setupProviderId).toBeNull();
    expect(row.attention).toBe(true);
  });

  it('states where the data goes (Req 1.4), and nothing for Unset', () => {
    expect(
      buildDecisionRow(
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          locality: 'local',
          state: 'ready',
        }),
      ).localityMessage,
    ).toBe(
      'Runs on this machine: the request text and lane data stay on this machine.',
    );
    expect(
      buildDecisionRow(
        status({
          selection: { kind: 'jev', model: 'jev-1.13.0' },
          locality: 'remote',
          state: 'ready',
        }),
      ).localityMessage,
    ).toBe('The request text and lane data are sent to TypeSafe Jev.');
    expect(buildDecisionRow(status({})).localityMessage).toBeNull();
  });

  it('says a structured-output model reports no confidence (Req 1.8), and only for that kind', () => {
    const structured = status({
      selection: { kind: 'structured', providerId: 'anthropic', model: 'm' },
      locality: 'remote',
      state: 'ready',
    });
    expect(buildDecisionRow(structured).confidenceMessage).toBe(
      'This model reports no confidence, so its answers carry no confidence score.',
    );
    expect(
      buildDecisionRow({ ...structured, reportsConfidence: true })
        .confidenceMessage,
    ).toBeNull();
    expect(
      buildDecisionRow(
        status({
          selection: { kind: 'ollama', model: 'tev1' },
          reportsConfidence: false,
          state: 'ready',
        }),
      ).confidenceMessage,
    ).toBeNull();
  });

  it('passes the host detail through as text, also on ready', () => {
    const row = buildDecisionRow(
      status({
        selection: { kind: 'ollama', model: 'tev1' },
        state: 'ready',
        detail: 'last call failed: <b>x</b>',
      }),
    );
    expect(row.detail).toBe('last call failed: <b>x</b>');
  });

  it('a status that could not be read is "not reachable" (plan part A §11)', () => {
    expect(buildDecisionRow(null)).toEqual(
      expect.objectContaining({
        stateLabel: 'not reachable',
        cellLabel: 'Status not reachable',
        attention: true,
      }),
    );
  });

  it("builds the setConfig selection per kind; required fields block it, Jev's model is optional", () => {
    expect(
      decisionModelInput({
        kind: 'unset',
        model: 'x',
        providerId: 'y',
        baseUrl: '',
      }),
    ).toEqual({ kind: 'unset' });
    expect(
      decisionModelInput({
        kind: 'ollama',
        model: ' tev1 ',
        providerId: '',
        baseUrl: '',
      }),
    ).toEqual({ kind: 'ollama', model: 'tev1' });
    expect(
      decisionModelInput({
        kind: 'ollama',
        model: '  ',
        providerId: '',
        baseUrl: '',
      }),
    ).toBeNull();
    expect(
      decisionModelInput({
        kind: 'jev',
        model: '',
        providerId: '',
        baseUrl: '',
      }),
    ).toEqual({ kind: 'jev' });
    expect(
      decisionModelInput({
        kind: 'structured',
        model: 'm',
        providerId: '',
        baseUrl: '',
      }),
    ).toBeNull();
    expect(
      decisionModelInput({
        kind: 'structured',
        model: 'm',
        providerId: 'anthropic',
        baseUrl: '',
      }),
    ).toEqual({ kind: 'structured', providerId: 'anthropic', model: 'm' });
  });

  it('compares a write with the saved selection (Jev without a model is the host default)', () => {
    expect(
      sameDecisionSelection(
        { kind: 'jev' },
        { kind: 'jev', model: 'jev-1.13.0' },
      ),
    ).toBe(true);
    expect(
      sameDecisionSelection(
        { kind: 'ollama', model: 'tev1' },
        { kind: 'ollama', model: 'nimble' },
      ),
    ).toBe(false);
    expect(sameDecisionSelection({ kind: 'unset' }, null)).toBe(false);
    expect(
      decisionDraftForKind('ollama', { kind: 'ollama', model: 'tev1' }),
    ).toEqual({ kind: 'ollama', model: 'tev1', providerId: '', baseUrl: '' });
    expect(
      decisionDraftForKind('structured', { kind: 'ollama', model: 'tev1' }),
    ).toEqual({ kind: 'structured', model: '', providerId: '', baseUrl: '' });
  });

  it('validates the host status before it reaches the view', () => {
    const valid = status({
      selection: { kind: 'structured', providerId: 'p', model: 'm' },
      locality: 'remote',
      state: 'ready',
      detail: 'd',
    });
    expect(parseDecisionModelStatus(valid)).toEqual(valid);
    expect(parseDecisionModelStatus(undefined)).toBeNull();
    expect(
      parseDecisionModelStatus({ ...valid, state: 'model-unavailable' }),
    ).toBeNull();
    expect(
      parseDecisionModelStatus({ ...valid, selection: { kind: 'ollama' } }),
    ).toBeNull();
    expect(
      parseDecisionModelStatus({ ...valid, locality: 'cloud' }),
    ).toBeNull();
    expect(parseDecisionModelStatus({ ...valid, detail: 3 })).toBeNull();
  });
});

describe('decision-model-row.view: Ollama Cloud and custom endpoint kinds (TASK_2026_684 C12)', () => {
  const CLOUD = { kind: 'ollama-cloud', model: 'clef:27b-cloud' } as const;
  const CUSTOM = {
    kind: 'custom',
    baseUrl: 'https://decide.example.com/gw',
    model: 'm1',
  } as const;
  const draft = (
    overrides: Partial<DecisionModelDraft>,
  ): DecisionModelDraft => ({
    kind: 'custom',
    model: 'm1',
    providerId: '',
    baseUrl: 'https://decide.example.com/gw',
    ...overrides,
  });

  it('labels the cell with the server: Ollama Cloud, or the custom endpoint host', () => {
    expect(
      buildDecisionRow(status({ selection: CLOUD, state: 'ready' })).cellLabel,
    ).toBe('Ollama Cloud · clef:27b-cloud');
    expect(
      buildDecisionRow(status({ selection: CUSTOM, state: 'ready' })).cellLabel,
    ).toBe('decide.example.com · m1');
    expect(
      buildDecisionRow(
        status({
          selection: { ...CUSTOM, baseUrl: 'http://127.0.0.1:8080' },
          state: 'ready',
        }),
      ).cellLabel,
    ).toBe('127.0.0.1:8080 · m1');
  });

  it('states where the data goes for each new kind (2.6)', () => {
    expect(
      buildDecisionRow(
        status({ selection: CLOUD, locality: 'remote', state: 'ready' }),
      ).localityMessage,
    ).toBe('The request text and lane data are sent to Ollama Cloud.');
    expect(
      buildDecisionRow(
        status({ selection: CUSTOM, locality: 'remote', state: 'ready' }),
      ).localityMessage,
    ).toBe('The request text and lane data are sent to decide.example.com.');
    expect(
      buildDecisionRow(
        status({
          selection: { ...CUSTOM, baseUrl: 'http://localhost:11434' },
          locality: 'local',
          state: 'ready',
        }),
      ).localityMessage,
    ).toBe(
      'Runs on this machine: the request text and lane data stay on this machine.',
    );
  });

  it('Ollama Cloud without a credential points to its provider set-up (1.1, 3.2)', () => {
    const row = buildDecisionRow(
      status({ selection: CLOUD, state: 'no-credential' }),
    );
    expect(row.stateMessage).toBe(
      'Ollama Cloud has no working credential. Set up Ollama Cloud to use it.',
    );
    expect(row.setupProviderId).toBe('ollama-cloud');
    expect(row.setupProviderName).toBe('Ollama Cloud');
    expect(row.attention).toBe(true);
  });

  it('a custom endpoint without a credential points to the key field in the row, with no set-up link (3.2)', () => {
    const row = buildDecisionRow(
      status({ selection: CUSTOM, state: 'no-credential' }),
    );
    expect(row.stateMessage).toBe(
      'decide.example.com needs a valid API key. Add one in this row to use this endpoint.',
    );
    expect(row.setupProviderId).toBeNull();
    expect(row.attention).toBe(true);
  });

  it('round-trips a saved selection through the draft into the setConfig input (2.1)', () => {
    expect(decisionDraftFrom(CUSTOM)).toEqual({
      kind: 'custom',
      model: 'm1',
      providerId: '',
      baseUrl: 'https://decide.example.com/gw',
    });
    expect(decisionModelInput(decisionDraftFrom(CUSTOM))).toEqual(CUSTOM);
    expect(decisionModelInput(decisionDraftFrom(CLOUD))).toEqual(CLOUD);
    expect(decisionDraftForKind('custom', CLOUD)).toEqual({
      kind: 'custom',
      model: '',
      providerId: '',
      baseUrl: '',
    });
  });

  it('builds the new inputs only when their required fields are filled; free-text models pass (4.4)', () => {
    expect(
      decisionModelInput(draft({ kind: 'ollama-cloud', model: ' anything ' })),
    ).toEqual({ kind: 'ollama-cloud', model: 'anything' });
    expect(
      decisionModelInput(draft({ kind: 'ollama-cloud', model: ' ' })),
    ).toBeNull();
    expect(
      decisionModelInput(draft({ baseUrl: ' https://h.example ' })),
    ).toEqual({ kind: 'custom', baseUrl: 'https://h.example', model: 'm1' });
    expect(decisionModelInput(draft({ baseUrl: '  ' }))).toBeNull();
    expect(decisionModelInput(draft({ model: '' }))).toBeNull();
  });

  it('compares the new kinds with the saved selection, a custom base URL in normalised form', () => {
    expect(sameDecisionSelection(CLOUD, CLOUD)).toBe(true);
    expect(sameDecisionSelection({ ...CLOUD, model: 'other' }, CLOUD)).toBe(
      false,
    );
    expect(
      sameDecisionSelection(CLOUD, { kind: 'ollama', model: CLOUD.model }),
    ).toBe(false);
    expect(sameDecisionSelection(CUSTOM, CUSTOM)).toBe(true);
    expect(
      sameDecisionSelection(
        { ...CUSTOM, baseUrl: 'HTTPS://Decide.Example.com/gw/' },
        CUSTOM,
      ),
    ).toBe(true);
    expect(
      sameDecisionSelection(
        { ...CUSTOM, baseUrl: 'https://decide.example.com/other' },
        CUSTOM,
      ),
    ).toBe(false);
    expect(sameDecisionSelection({ ...CUSTOM, model: 'm2' }, CUSTOM)).toBe(
      false,
    );
  });

  it('parses the new kinds and the optional stored-key indicator from the host', () => {
    const custom = status({
      selection: CUSTOM,
      locality: 'remote',
      state: 'ready',
      apiKeyStored: true,
    });
    expect(parseDecisionModelStatus(custom)).toEqual(custom);
    const cloud = status({
      selection: CLOUD,
      locality: 'remote',
      state: 'ready',
    });
    const parsedCloud = parseDecisionModelStatus(cloud);
    expect(parsedCloud).toEqual(cloud);
    expect(parsedCloud).not.toHaveProperty('apiKeyStored');
    expect(
      parseDecisionModelStatus({ ...custom, apiKeyStored: 'yes' }),
    ).toBeNull();
    expect(
      parseDecisionModelStatus({
        ...custom,
        selection: { kind: 'custom', model: 'm1' },
      }),
    ).toBeNull();
    expect(
      parseDecisionModelStatus({
        ...custom,
        selection: { kind: 'ollama-cloud', model: '' },
      }),
    ).toBeNull();
  });

  describe('endpointFieldError (mirrors the host URL policy and D4)', () => {
    it('is silent for every other kind', () => {
      for (const kind of [
        'unset',
        'ollama',
        'ollama-cloud',
        'jev',
        'structured',
      ] as const) {
        expect(
          endpointFieldError(draft({ kind, baseUrl: '' }), true),
        ).toBeNull();
      }
    });

    it.each([
      'https://decide.example.com/gw',
      'https://decide.example.com/gw/',
      'http://192.168.1.20:11434',
      'http://localhost:11434',
    ])('accepts %s without a key', (baseUrl) => {
      expect(endpointFieldError(draft({ baseUrl }), false)).toBeNull();
    });

    it.each([
      '',
      '   ',
      'decide.example.com',
      'ftp://decide.example.com',
      'https://user:pass@decide.example.com',
      'https://@decide.example.com',
      'https://decide.example.com/?a=1',
      'https://decide.example.com/#frag',
      'https://',
      `https://decide.example.com/${'a'.repeat(2048)}`,
    ])('names the base URL field for %j', (baseUrl) => {
      expect(endpointFieldError(draft({ baseUrl }), false)).toEqual({
        field: 'baseUrl',
        message: DECISION_MODEL_INVALID_BASE_URL,
      });
    });

    it('refuses a key over plain http to a host that is not this machine (D4)', () => {
      expect(
        endpointFieldError(
          draft({ baseUrl: 'http://192.168.1.20:11434' }),
          true,
        ),
      ).toEqual({ field: 'baseUrl', message: DECISION_MODEL_KEY_NEEDS_HTTPS });
    });

    it.each([
      'https://decide.example.com',
      'http://localhost:8080',
      'http://127.0.0.1:8080',
      'http://[::1]:8080',
    ])('lets a key travel to %s', (baseUrl) => {
      expect(endpointFieldError(draft({ baseUrl }), true)).toBeNull();
    });

    it('names the model field when the model is empty', () => {
      expect(endpointFieldError(draft({ model: '  ' }), false)).toEqual({
        field: 'model',
        message: DECISION_MODEL_INVALID_MODEL,
      });
    });
  });
});
