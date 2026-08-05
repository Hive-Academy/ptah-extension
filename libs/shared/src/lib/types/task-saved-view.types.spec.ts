/**
 * `SavedTaskView` — the shape, and the module graph that carries it.
 *
 * The first describe below is the one that is easy to delete by accident. This
 * module lives beside `task-view.types.ts` rather than inside it precisely
 * because `task-filter.ts` already imports from that file; folding the two
 * together reintroduces a cycle whose symptom is an UNDEFINED schema at import
 * time, not a typecheck error. These tests fail loudly if that ever happens.
 */
import {
  DEFAULT_TASK_SORT,
  EMPTY_TASK_FILTER,
  MAX_SAVED_TASK_VIEWS,
  MAX_SAVED_VIEW_ID_LENGTH,
  MAX_SAVED_VIEW_NAME_LENGTH,
  SavedTaskViewSchema,
} from '../../index';
import type { SavedTaskView } from '../../index';

function makeView(overrides: Partial<SavedTaskView> = {}): SavedTaskView {
  return {
    id: 'view-1',
    name: 'In progress',
    filter: EMPTY_TASK_FILTER,
    sort: DEFAULT_TASK_SORT,
    order: 0,
    ...overrides,
  };
}

describe('module graph', () => {
  it('resolves SavedTaskViewSchema through the public barrel', () => {
    // A cycle between this module and `task-filter` leaves one of the two
    // reading an uninitialized binding, so the export lands as `undefined`
    // rather than as a schema. Asserting the barrel, not the direct import,
    // because the barrel is the order real consumers load these in.
    expect(SavedTaskViewSchema).toBeDefined();
    expect(typeof SavedTaskViewSchema.safeParse).toBe('function');
  });

  it('carries a filter schema that actually validates', () => {
    // The failure mode this guards is subtler than an undefined export: a
    // half-initialized `TaskFilterSpecSchema` would parse anything at all.
    const bad = SavedTaskViewSchema.safeParse(
      makeView({
        filter: { ...EMPTY_TASK_FILTER, statuses: ['nonsense'] },
      } as unknown as Partial<SavedTaskView>),
    );
    expect(bad.success).toBe(false);
  });
});

describe('SavedTaskViewSchema', () => {
  it('accepts a well-formed view', () => {
    expect(SavedTaskViewSchema.safeParse(makeView()).success).toBe(true);
  });

  it.each([
    ['a non-object', 42],
    ['an empty object', {}],
    ['a missing id', { ...makeView(), id: undefined }],
    ['a blank name', makeView({ name: '' })],
    ['a negative order', makeView({ order: -1 })],
    ['a fractional order', makeView({ order: 1.5 })],
    [
      'an over-long id',
      makeView({ id: 'x'.repeat(MAX_SAVED_VIEW_ID_LENGTH + 1) }),
    ],
    [
      'an over-long name',
      makeView({ name: 'x'.repeat(MAX_SAVED_VIEW_NAME_LENGTH + 1) }),
    ],
  ])('rejects %s', (_label, value) => {
    expect(SavedTaskViewSchema.safeParse(value).success).toBe(false);
  });

  it('completes a partial filter with the neutral defaults', () => {
    // What lets a view stored before a facet existed keep parsing after the
    // facet is added, instead of being counted as malformed and dropped.
    const parsed = SavedTaskViewSchema.safeParse({
      ...makeView(),
      filter: { statuses: ['in_progress'] },
      sort: {},
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.filter).toEqual({
      ...EMPTY_TASK_FILTER,
      statuses: ['in_progress'],
    });
    expect(parsed.data.sort).toEqual(DEFAULT_TASK_SORT);
  });

  it('stores no task data — only the five lens fields (FR-C2.1)', () => {
    // A view is a lens, not a cache. `tasks`, `taskIds` or `results` appearing
    // here would make a saved view a second, staler index of the board.
    const parsed = SavedTaskViewSchema.parse({
      ...makeView(),
      taskIds: ['TASK_2026_181'],
      results: [{ id: 'TASK_2026_181' }],
    });

    expect(Object.keys(parsed).sort()).toEqual([
      'filter',
      'id',
      'name',
      'order',
      'sort',
    ]);
  });
});

describe('MAX_SAVED_TASK_VIEWS', () => {
  it('is the single cap the RPC boundary reports against', () => {
    expect(MAX_SAVED_TASK_VIEWS).toBe(50);
  });
});
