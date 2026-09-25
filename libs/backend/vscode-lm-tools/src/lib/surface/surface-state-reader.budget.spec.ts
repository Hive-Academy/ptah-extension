/**
 * The escaped worst case of complete agent reads (review finding 2, Batch 9;
 * implementation-plan.md "Batch 9 read-budget decision"). Every fixture is
 * admissible content (`validateSurfaceDocument`), every found read is within
 * `SURFACE_LIMITS.maxStateReadBytes`, carries no raw U+2028/U+2029 and parses
 * back to exactly what the store holds.
 *
 * Separators are built with `String.fromCharCode`, so this file contains no
 * raw separator character.
 */
import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceDataModel,
  SurfaceDataValue,
  SurfaceSelection,
  SurfaceSubmitRecord,
} from '@ptah-extension/shared';
import {
  SURFACE_LIMITS,
  describeSurfaceSelection,
  formatSurfaceSubmitMessage,
  validateSurfaceDocument,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  SurfaceStateReader,
  type SurfaceAgentReadResult,
} from './surface-state-reader';
import { SurfaceStateStore, createSurfaceRecord } from './surface-state.store';

type V2Content = Extract<SurfaceContent, { contract: 'dashboard-spec/2' }>;

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const RAW_SEPARATOR = new RegExp(`[${LS}${PS}]`);
const MAX = SURFACE_LIMITS.maxStateReadBytes;
/** The pre-decision bound, 320 KiB: reads above it prove the old limit failed. */
const OLD_BOUND = 327_680;
const NONCE = '12345678-1234-1234-1234-123456789012';

function v2(
  components: readonly SurfaceComponent[],
  dataModel: SurfaceDataModel,
): V2Content {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId: 'a',
      title: { text: 'Title' },
      components,
    },
    dataModel,
  };
}

function validation(content: V2Content) {
  return validateSurfaceDocument(
    { ...content.surface, dataModel: content.dataModel },
    jsonUtf8Bytes,
  );
}

function escapedBytes(value: unknown): number {
  return Buffer.byteLength(
    JSON.stringify(value).split(LS).join('\\u2028').split(PS).join('\\u2029'),
  );
}

/** Found, within the bound, no raw separator; returns the parsed payload. */
function expectCompleteRead(
  result: SurfaceAgentReadResult,
): Record<string, unknown> {
  expect(result.status).toBe('found');
  // Assertions measure the text instead of matching it, so a failure never
  // prints hundreds of KiB of fixture.
  expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(MAX);
  expect(RAW_SEPARATOR.test(result.text)).toBe(false);
  return JSON.parse(result.text.slice(result.text.indexOf('\n') + 1)) as Record<
    string,
    unknown
  >;
}

/**
 * 100 text inputs with 128-character ids, bound to paths of `prefixSegments`
 * 64-character segments followed by `k<i>`, and the nested model that holds
 * `value(i)` at each path.
 */
function maximalInputs(
  prefixSegments: number,
  value: (index: number) => string,
): { inputs: SurfaceComponent[]; dataModel: SurfaceDataModel } {
  const count = SURFACE_LIMITS.maxInputs;
  const prefix = Array.from({ length: prefixSegments }, (_v, index) =>
    String.fromCharCode(97 + index).repeat(64),
  );
  const inputs: SurfaceComponent[] = [];
  const fields: Record<string, SurfaceDataValue> = {};
  for (let index = 0; index < count; index++) {
    fields[`k${index}`] = value(index);
    inputs.push({
      kind: 'text',
      id: `f${index}`.padEnd(SURFACE_LIMITS.maxComponentIdLength, 'x'),
      label: 'Field',
      path: [...prefix, `k${index}`].join('.'),
      hints: { required: true, minLength: 1_000 },
    });
  }
  let dataModel: SurfaceDataModel = fields;
  for (const segment of [...prefix].reverse())
    dataModel = { [segment]: dataModel };
  return { inputs, dataModel };
}

/** Three stacks of at most 45 inputs, the first owning the submit action. */
function stacks(inputs: readonly SurfaceComponent[]): SurfaceComponent[] {
  return [
    {
      kind: 'stack',
      id: 'one',
      children: inputs.slice(0, 10),
      actions: [
        { id: 'send', action: 'surface.submit', label: { text: 'Send' } },
      ],
    },
    { kind: 'stack', id: 'two', children: inputs.slice(10, 55) },
    { kind: 'stack', id: 'three', children: inputs.slice(55) },
  ];
}

function separatorStat(index: number, titleLength: number): SurfaceComponent {
  return {
    kind: 'stat',
    id: `s${index}`,
    title: { text: LS.repeat(titleLength) },
    value: 1,
  };
}

function submitRecord(
  inputs: readonly SurfaceComponent[],
  value: string,
): SurfaceSubmitRecord {
  return {
    operationId: 'op-1700000000000-oldold01',
    actionId: 'send',
    scopeComponentId: 'one',
    baseRevision: 1,
    status: 'applied',
    submittedAt: 1_700_000_000_000,
    values: inputs.slice(0, 10).map((input) => ({
      componentId: input.id,
      path: 'path' in input ? input.path : '',
      value,
    })),
  };
}

function submitMessage(
  inputs: readonly SurfaceComponent[],
  lastSubmit: SurfaceSubmitRecord,
) {
  return formatSurfaceSubmitMessage(
    { ...lastSubmit, surfaceId: 'a' },
    {
      actionLabel: 'Send',
      inputLabels: Object.fromEntries(
        inputs.map((input) => [input.id, 'Field']),
      ),
    },
    NONCE,
  );
}

function readerWith(
  record: ReturnType<typeof createSurfaceRecord>,
): SurfaceStateReader {
  const store = new SurfaceStateStore();
  store.commit('tab-1', record);
  return new SurfaceStateReader(store);
}

describe('SurfaceStateReader escaped worst case (maxStateReadBytes)', () => {
  // Reviewer reproduction A (code-logic-review-batch-9.md, finding 2).
  it('returns the complete state of a separator-heavy form with a prior submit', () => {
    // Verbatim: five prefix segments plus `k<i>`, 210 separators per value.
    const { inputs, dataModel } = maximalInputs(5, () => LS.repeat(210));
    const content = v2(stacks(inputs), dataModel);
    expect(validation(content).ok).toBe(true);
    const lastSubmit = submitRecord(inputs, 'x'.repeat(1_000));
    expect(submitMessage(inputs, lastSubmit).ok).toBe(true);
    const reader = readerWith({
      ...createSurfaceRecord('a', content, 2),
      lastSubmit,
    });

    const result = reader.describeForAgent('tab-1', { surfaceId: 'a' });
    const payload = expectCompleteRead(result);
    expect(Buffer.byteLength(result.text)).toBeGreaterThan(OLD_BOUND);
    expect(payload['dataModel']).toEqual(dataModel);
    expect(payload['lastSubmit']).toEqual(lastSubmit);
    expect(Object.keys(payload['formValues'] as object)).toHaveLength(100);
  });

  // Reviewer reproduction B: 40 stats titled with 2,000 separators each.
  it('returns the complete structure of 40 separator-titled stats', () => {
    const content = v2(
      Array.from({ length: 40 }, (_v, index) => separatorStat(index, 2_000)),
      {},
    );
    expect(validation(content).ok).toBe(true);
    const reader = readerWith(createSurfaceRecord('a', content, 1));

    const result = reader.describeForAgent('tab-1', {
      surfaceId: 'a',
      view: 'structure',
    });
    const payload = expectCompleteRead(result);
    expect(Buffer.byteLength(result.text)).toBeGreaterThan(OLD_BOUND);
    expect(payload['structure']).toEqual(content.surface);
  });

  it('returns the complete structure of a document at maxSurfaceBytes', () => {
    // Whole separator-titled stats until the next one breaches maxSurfaceBytes.
    const components: SurfaceComponent[] = [separatorStat(0, 2_000)];
    let breach = validation(v2(components, {}));
    while (breach.ok) {
      components.push(separatorStat(components.length, 2_000));
      breach = validation(v2(components, {}));
    }
    expect(breach.ok).toBe(false);
    if (!breach.ok) expect(breach.reason).toContain('maxSurfaceBytes');
    // Fill the remaining room with one shorter stat.
    const index = components.length - 1;
    let titleLength = 2_000;
    let content = v2(components, {});
    while (titleLength > 0) {
      components[index] = separatorStat(index, titleLength);
      content = v2(components, {});
      if (validation(content).ok) break;
      titleLength -= 10;
    }
    const accepted = validation(content);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.bytes).toBeGreaterThan(SURFACE_LIMITS.maxSurfaceBytes - 64);
    const reader = readerWith(createSurfaceRecord('a', content, 1));

    const result = reader.describeForAgent('tab-1', {
      surfaceId: 'a',
      view: 'structure',
    });
    const payload = expectCompleteRead(result);
    expect(Buffer.byteLength(result.text)).toBeGreaterThan(
      2 * SURFACE_LIMITS.maxSurfaceBytes - 64 * 1024,
    );
    expect(payload['structure']).toEqual(content.surface);
  });

  it('returns the complete maximal state: separator model, 100 inputs, table selection and a 32 KiB submit', () => {
    // The longest separator value per input that keeps the model admissible.
    // Five-segment paths: four prefix segments plus `k<i>`.
    let valueLength = 230;
    let built = maximalInputs(4, () => LS.repeat(valueLength));
    const columns = Array.from({ length: 50 }, (_v, index) => ({
      key: `c${index}`,
      label: { text: LS.repeat(200) },
    }));
    const table: SurfaceComponent = {
      kind: 'table',
      id: 'tbl',
      columns,
      rows: [columns.map(() => LS.repeat(200))],
    };
    const compose = (): V2Content =>
      v2([...stacks(built.inputs), table], built.dataModel);
    let content = compose();
    while (!validation(content).ok && valueLength > 0) {
      valueLength -= 1;
      built = maximalInputs(4, () => LS.repeat(valueLength));
      content = compose();
    }
    expect(validation(content).ok).toBe(true);
    expect(jsonUtf8Bytes(content.dataModel)).toBeGreaterThan(
      SURFACE_LIMITS.maxDataModelBytes - 1_024,
    );

    // The largest separator submit whose message the formatter accepts.
    let submitLength = 600;
    let lastSubmit = submitRecord(built.inputs, LS.repeat(submitLength));
    let message = submitMessage(built.inputs, lastSubmit);
    while (!message.ok && submitLength > 0) {
      submitLength -= 1;
      lastSubmit = submitRecord(built.inputs, LS.repeat(submitLength));
      message = submitMessage(built.inputs, lastSubmit);
    }
    expect(message.ok).toBe(true);
    if (!message.ok) return;
    expect(Buffer.byteLength(message.message)).toBeGreaterThan(
      SURFACE_LIMITS.maxSubmitMessageBytes - 1_024,
    );

    const selection: SurfaceSelection = {
      componentId: 'tbl',
      target: { kind: 'table-row', rowIndex: 0 },
    };
    const reader = readerWith({
      ...createSurfaceRecord('a', content, 2),
      selection,
      lastSubmit,
    });

    const result = reader.describeForAgent('tab-1', { surfaceId: 'a' });
    const payload = expectCompleteRead(result);
    expect(Buffer.byteLength(result.text)).toBeGreaterThan(OLD_BOUND);
    expect(payload['dataModel']).toEqual(content.dataModel);
    expect(payload['lastSubmit']).toEqual(lastSubmit);
    const description = describeSurfaceSelection(content, selection);
    expect(description).not.toBeNull();
    expect(payload['selection']).toEqual({ ...selection, description });

    // T3a: form-value values are disjoint model substrings.
    const formValues = payload['formValues'] as Record<
      string,
      { value: SurfaceDataValue }
    >;
    const valueBytes = Object.values(formValues).reduce(
      (total, entry) => total + escapedBytes(entry.value),
      0,
    );
    expect(Object.keys(formValues)).toHaveLength(100);
    expect(valueBytes).toBeLessThanOrEqual(escapedBytes(content.dataModel));
    // T4: the JSON-embedded selection description.
    expect(escapedBytes(description)).toBeLessThanOrEqual(140 * 1024);
  });

  // Re-review qualification of T3a: an ABSENT binding is not a model
  // substring; it reads as the kind's empty value (`false` for a checkbox,
  // at most 5 bytes). Those bytes are charged to T3b's 1,024-byte per-input
  // allowance (about 875 used), not to T3a, so the 548 KiB total holds.
  it('charges absent bindings at most 5 bytes each (T3b allowance, not T3a)', () => {
    const boxes: SurfaceComponent[] = Array.from(
      { length: SURFACE_LIMITS.maxInputs },
      (_v, index) => ({
        kind: 'checkbox',
        id: `b${index}`,
        label: 'Box',
        path: `form.b${index}`,
      }),
    );
    const content = v2(
      [
        { kind: 'stack', id: 'one', children: boxes.slice(0, 50) },
        { kind: 'stack', id: 'two', children: boxes.slice(50) },
      ],
      {},
    );
    expect(validation(content).ok).toBe(true);
    const reader = readerWith(createSurfaceRecord('a', content, 1));

    const payload = expectCompleteRead(
      reader.describeForAgent('tab-1', { surfaceId: 'a' }),
    );
    const formValues = payload['formValues'] as Record<
      string,
      { value: SurfaceDataValue }
    >;
    const values = Object.values(formValues);
    expect(values).toHaveLength(SURFACE_LIMITS.maxInputs);
    for (const entry of values) expect(entry.value).toBe(false);
    const valueBytes = values.reduce(
      (total, entry) => total + escapedBytes(entry.value),
      0,
    );
    // The literal "values <= model bytes" does not hold here ({} is 2 bytes)...
    expect(valueBytes).toBeGreaterThan(escapedBytes(content.dataModel));
    // ...but the per-input charge stays within 5 bytes.
    expect(valueBytes).toBeLessThanOrEqual(5 * SURFACE_LIMITS.maxInputs);
  });
});
