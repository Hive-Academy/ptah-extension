import {
  assertElectronStateWorkerPayloadWithinBudget,
  assertJsonCompatibleValue,
  assertMonotonicWorkerOperationId,
  canSendDirectUpdate,
  ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES,
  ElectronStateWorkerProtocolError,
  electronStateWorkerPayloadFits,
  estimateElectronStateJsonBytes,
  generateSnapshotOperations,
  generateUtf8StringSlices,
  parseElectronStateWorkerRequest,
  parseElectronStateWorkerResponse,
  stateStorageArraySplitPlanSchema,
} from './electron-state-storage-worker-protocol';

const SEQUENCE_ID = '018f55cb-3f18-7d5e-a1a4-000000000001';

describe('Electron state worker protocol', () => {
  it('accepts a generic array-split plan without domain fields', () => {
    const plan = stateStorageArraySplitPlanSchema.parse({
      kind: 'split-array-value',
      planVersion: 1,
      sourceKey: 'records',
      itemIdPath: ['id'],
      detailKeyPrefix: 'record:',
      indexKey: 'record-index',
      indexSchemaVersion: 2,
      summaryFields: [{ sourcePath: ['id'] }],
      nestedExtractions: [
        {
          sourceArrayPath: ['children'],
          itemIdPath: ['childId'],
          destinationKeyPrefix: 'child:',
          fields: [{ sourcePath: ['payload'] }],
          onMissingId: 'drop-bulk',
          dropFields: [['raw']],
          conflictPolicy: {
            kind: 'prefer-longer-arrays',
            fields: ['payload'],
          },
        },
      ],
    });

    expect(plan.sourceKey).toBe('records');
    expect(JSON.stringify(plan)).not.toMatch(/session|agent|output/i);
  });

  it('rejects malformed requests with a safe protocol error', () => {
    expect(() =>
      parseElectronStateWorkerRequest({
        type: 'get',
        operationId: 1,
        key: '',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'INVALID_MESSAGE',
      }),
    );
  });

  it('rejects oversized input before JSON.stringify can run', () => {
    const stringify = jest.spyOn(JSON, 'stringify');
    const request = {
      type: 'update',
      operationId: 1,
      key: 'large',
      value: 'x'.repeat(ELECTRON_STATE_WORKER_MESSAGE_MAX_BYTES),
    };

    expect(() => parseElectronStateWorkerRequest(request)).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'PAYLOAD_TOO_LARGE',
      }),
    );
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it('stops traversing an oversized array instead of scanning its tail', () => {
    let tailRead = false;
    const values = Array.from({ length: 70_000 }, () => 1);
    Object.defineProperty(values, 69_999, {
      configurable: true,
      enumerable: true,
      get: () => {
        tailRead = true;
        return 1;
      },
    });

    expect(() => assertElectronStateWorkerPayloadWithinBudget(values)).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'PAYLOAD_TOO_LARGE',
      }),
    );
    expect(tailRead).toBe(false);
  });

  it('rejects cycles before recursive Zod validation', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;

    expect(() => parseElectronStateWorkerRequest(cyclic)).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'UNSUPPORTED_VALUE',
      }),
    );
  });

  it('accepts a shared DAG direct update while still rejecting cycles', () => {
    const shared = { enabled: true };
    const value = { left: shared, right: shared };

    expect(canSendDirectUpdate('preferences', value)).toBe(true);
    expect(() =>
      assertElectronStateWorkerPayloadWithinBudget({
        type: 'update',
        operationId: 1,
        key: 'preferences',
        value,
      }),
    ).not.toThrow();
  });

  it('slices large UTF-8 strings without a whole-string Buffer conversion', () => {
    const value = 'a😀界'.repeat(40_000);
    const from = jest.spyOn(Buffer, 'from');
    const slices = [...generateUtf8StringSlices(value)];

    expect(from).not.toHaveBeenCalled();
    expect(slices.every((slice) => slice.bytes.byteLength <= 32 * 1024)).toBe(
      true,
    );
    expect(
      Buffer.concat(slices.map((slice) => Buffer.from(slice.bytes))).toString(
        'utf8',
      ),
    ).toBe(value);
    from.mockRestore();
  });

  it('accepts sequence item operations and rejects an empty operation page', () => {
    const request = {
      type: 'append-json-sequence-item-ops' as const,
      operationId: 3,
      sequenceId: SEQUENCE_ID,
      itemIndex: 0,
      operations: [{ kind: 'object' as const, path: ['item'] }],
    };

    expect(parseElectronStateWorkerRequest(request)).toMatchObject(request);
    expect(() =>
      parseElectronStateWorkerRequest({ ...request, operations: [] }),
    ).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'INVALID_MESSAGE',
      }),
    );
  });

  it('carries a projection on get and on every scalar continuation', () => {
    const projection = { omit: [['children', '*', 'raw']] };

    expect(
      parseElectronStateWorkerRequest({
        type: 'get',
        operationId: 5,
        key: 'record',
        projection,
      }),
    ).toMatchObject({ projection });
    expect(
      parseElectronStateWorkerRequest({
        type: 'read-scalar-page',
        operationId: 6,
        key: 'record',
        cursor: 'g1.pnone.10',
        maxBytes: 1024,
        projection,
      }),
    ).toMatchObject({ projection, cursor: 'g1.pnone.10' });
  });

  it('accepts dual budgets on sequence reads and truncated items on pages', () => {
    expect(
      parseElectronStateWorkerRequest({
        type: 'read-json-sequence',
        operationId: 7,
        key: 'list',
        maxBytes: 1024,
        maxJsonBytes: 2048,
        jsonEnvelopeBytes: 64,
        maxItemBytes: 512,
      }),
    ).toMatchObject({ maxJsonBytes: 2048, jsonEnvelopeBytes: 64 });
    expect(
      parseElectronStateWorkerResponse({
        type: 'json-sequence-page',
        operationId: 7,
        items: ['x'],
        nextCursor: null,
        done: true,
        approximateBytes: 1024,
        truncatedItems: [{ index: 0, originalJsonBytes: 5000 }],
      }),
    ).toMatchObject({
      truncatedItems: [{ index: 0, originalJsonBytes: 5000 }],
    });
  });

  it('pins the typed failure detail fields to their codes', () => {
    expect(
      parseElectronStateWorkerResponse({
        type: 'failure',
        operationId: 8,
        code: 'commit-failed',
        landed: true,
      }),
    ).toMatchObject({ landed: true });
    expect(
      parseElectronStateWorkerResponse({
        type: 'failure',
        operationId: 8,
        code: 'value-too-large',
        valueBytes: 2_000_000,
      }),
    ).toMatchObject({ valueBytes: 2_000_000 });
    for (const invalid of [
      { code: 'commit-failed' },
      { code: 'io-failed', landed: false },
      { code: 'value-too-large' },
      { code: 'cursor-stale', valueBytes: 1 },
    ]) {
      expect(() =>
        parseElectronStateWorkerResponse({
          type: 'failure',
          operationId: 8,
          ...invalid,
        }),
      ).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'INVALID_MESSAGE',
        }),
      );
    }
  });

  it('requires migration receipts on ready and cursor agreement on operation pages', () => {
    expect(() =>
      parseElectronStateWorkerResponse({
        type: 'ready',
        operationId: 9,
        generation: 1,
        mutationEpoch: 0,
      }),
    ).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'INVALID_MESSAGE',
      }),
    );
    for (const type of ['value-paged', 'scalar-page', 'snapshot-page']) {
      expect(() =>
        parseElectronStateWorkerResponse({
          type,
          operationId: 10,
          operations: [],
          nextCursor: null,
          done: false,
          approximateBytes: 0,
        }),
      ).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'INVALID_MESSAGE',
        }),
      );
    }
  });

  it('estimates JSON values with the same formula as the budget walk', () => {
    const value = { text: 'abc', list: [1, true, null], nested: { k: 'v' } };

    expect(estimateElectronStateJsonBytes(value)).toBe(
      assertElectronStateWorkerPayloadWithinBudget(value),
    );
    expect(electronStateWorkerPayloadFits('x'.repeat(10), 16)).toBe(false);
    expect(electronStateWorkerPayloadFits('x', 16)).toBe(true);
  });

  it('validates response cursor invariants and safe failures', () => {
    expect(
      parseElectronStateWorkerResponse({
        type: 'failure',
        operationId: 4,
        code: 'recovery-required',
        recoveryReason: 'blob-hash-mismatch',
      }),
    ).toEqual({
      type: 'failure',
      operationId: 4,
      code: 'recovery-required',
      recoveryReason: 'blob-hash-mismatch',
    });
    expect(() =>
      parseElectronStateWorkerResponse({
        type: 'failure',
        operationId: 4,
        code: 'recovery-required',
      }),
    ).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'INVALID_MESSAGE',
      }),
    );
    expect(() =>
      parseElectronStateWorkerResponse({
        type: 'json-sequence-page',
        operationId: 5,
        items: [],
        nextCursor: 'next',
        done: true,
        approximateBytes: 0,
      }),
    ).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'INVALID_MESSAGE',
      }),
    );
  });

  it('requires operation ids to increase', () => {
    expect(() => assertMonotonicWorkerOperationId(4, 5)).not.toThrow();
    expect(() => assertMonotonicWorkerOperationId(5, 5)).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'NON_MONOTONIC_OPERATION',
      }),
    );
    expect(() => assertMonotonicWorkerOperationId(5, 4)).toThrow(
      expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
        code: 'NON_MONOTONIC_OPERATION',
      }),
    );
  });

  it('validates scalar write request messages and enforces bounds', () => {
    const begin = parseElectronStateWorkerRequest({
      type: 'begin-scalar-write',
      operationId: 10,
      writeId: SEQUENCE_ID,
      key: 'large-scalar',
    });
    expect(begin).toEqual({
      type: 'begin-scalar-write',
      operationId: 10,
      writeId: SEQUENCE_ID,
      key: 'large-scalar',
    });

    const page = parseElectronStateWorkerRequest({
      type: 'append-scalar-write-page',
      operationId: 11,
      writeId: SEQUENCE_ID,
      operations: [
        { kind: 'object', path: ['large-scalar'] },
        { kind: 'value', path: ['large-scalar', 'prop'], value: 'hello' },
        {
          kind: 'string-start',
          path: ['large-scalar', 'long'],
          totalBytes: 50_000,
        },
        {
          kind: 'string-slice',
          path: ['large-scalar', 'long'],
          byteOffset: 0,
          totalBytes: 50_000,
          bytes: new Uint8Array(100),
        },
      ],
    });
    expect(page.type).toBe('append-scalar-write-page');

    const commit = parseElectronStateWorkerRequest({
      type: 'commit-scalar-write',
      operationId: 12,
      writeId: SEQUENCE_ID,
    });
    expect(commit.type).toBe('commit-scalar-write');

    const abort = parseElectronStateWorkerRequest({
      type: 'abort-scalar-write',
      operationId: 13,
      writeId: SEQUENCE_ID,
    });
    expect(abort.type).toBe('abort-scalar-write');

    expect(() =>
      parseElectronStateWorkerRequest({
        type: 'append-scalar-write-page',
        operationId: 14,
        writeId: 'not-a-uuid',
        operations: [{ kind: 'object', path: ['key'] }],
      }),
    ).toThrow();
  });

  describe('assertJsonCompatibleValue and bounded traversal', () => {
    it('accepts primitives, arrays, plain objects, and null-prototype objects', () => {
      expect(() => assertJsonCompatibleValue('hello')).not.toThrow();
      expect(() => assertJsonCompatibleValue(42)).not.toThrow();
      expect(() => assertJsonCompatibleValue(true)).not.toThrow();
      expect(() => assertJsonCompatibleValue(null)).not.toThrow();
      expect(() =>
        assertJsonCompatibleValue([1, 'two', null, false]),
      ).not.toThrow();
      expect(() =>
        assertJsonCompatibleValue({ a: 1, b: [2, 3] }),
      ).not.toThrow();

      const nullProto = Object.create(null);
      nullProto.x = 'valid';
      nullProto.nested = { ok: true };
      expect(() => assertJsonCompatibleValue(nullProto)).not.toThrow();
      expect(() => assertJsonCompatibleValue([nullProto])).not.toThrow();
    });

    it('rejects Date instances deterministically with UNSUPPORTED_VALUE', () => {
      expect(() => assertJsonCompatibleValue(new Date())).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue({ at: new Date() })).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue([new Date()])).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('rejects non-plain objects, class instances, RegExp, Map, and Set', () => {
      class CustomItem {
        value = 123;
      }
      expect(() => assertJsonCompatibleValue(new CustomItem())).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue(new RegExp('test'))).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue(new Map())).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue(new Set())).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('rejects cyclic references without call stack overflow', () => {
      const cyclicObj: Record<string, unknown> = {};
      cyclicObj['self'] = cyclicObj;
      expect(() => assertJsonCompatibleValue(cyclicObj)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );

      const cyclicArr: unknown[] = [];
      cyclicArr.push(cyclicArr);
      expect(() => assertJsonCompatibleValue(cyclicArr)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );

      const nestedCycle: Record<string, unknown> = { a: { b: {} } };
      (nestedCycle['a'] as Record<string, unknown>)['b'] = nestedCycle;
      expect(() => assertJsonCompatibleValue(nestedCycle)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('rejects non-finite numbers and undefined/functions/symbols', () => {
      expect(() => assertJsonCompatibleValue(NaN)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue(Infinity)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue(-Infinity)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue(undefined)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue({ fn: () => 1 })).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
      expect(() => assertJsonCompatibleValue(Symbol('test'))).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('rejects nesting depths exceeding MAX_PROTOCOL_DEPTH', () => {
      let deep: Record<string, unknown> = { leaf: true };
      for (let i = 0; i < 70; i++) {
        deep = { child: deep };
      }
      expect(() => assertJsonCompatibleValue(deep)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'MAX_DEPTH_EXCEEDED',
        }),
      );
    });
  });

  describe('generateSnapshotOperations validation', () => {
    it('rejects Date and does not treat it as empty object', () => {
      const generator = generateSnapshotOperations({
        dateKey: new Date() as unknown as string,
      });
      expect(() => generator.next()).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('rejects cyclic structures in snapshot operations without overflow', () => {
      const cycle: Record<string, unknown> = {};
      cycle['self'] = cycle;
      const generator = generateSnapshotOperations({
        cycleKey: cycle as unknown as string,
      });
      expect(() => Array.from(generator)).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('supports null-prototype objects in snapshot operations', () => {
      const nullProto = Object.create(null);
      nullProto.k = 'v';
      const ops = Array.from(
        generateSnapshotOperations({
          objKey: nullProto as unknown as Record<string, string>,
        }),
      );
      expect(
        ops.some((op) => op.kind === 'object' && op.path[0] === 'objKey'),
      ).toBe(true);
    });
  });

  describe('canSendDirectUpdate error propagation', () => {
    it('throws UNSUPPORTED_VALUE on Date instead of returning false', () => {
      expect(() =>
        canSendDirectUpdate('d', new Date() as unknown as string),
      ).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('throws UNSUPPORTED_VALUE on cycle instead of returning false', () => {
      const cycle: Record<string, unknown> = {};
      cycle['self'] = cycle;
      expect(() =>
        canSendDirectUpdate('c', cycle as unknown as string),
      ).toThrow(
        expect.objectContaining<Partial<ElectronStateWorkerProtocolError>>({
          code: 'UNSUPPORTED_VALUE',
        }),
      );
    });

    it('returns true for small valid payloads and false for large valid payloads', () => {
      expect(canSendDirectUpdate('small', { hello: 'world' })).toBe(true);
      expect(canSendDirectUpdate('large', 'x'.repeat(20_000))).toBe(false);
    });
  });
});
