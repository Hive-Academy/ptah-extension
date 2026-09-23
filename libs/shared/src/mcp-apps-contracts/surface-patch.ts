/**
 * The deterministic state algebra the host and the renderer both run: apply
 * `SurfaceStateOp`s to a surface state and revalidate its selection. The host
 * pushes committed ops and the renderer applies them with THIS function, so the
 * two copies are equal by construction. Pure, copy-on-write, never throws.
 *
 * Budgets are not enforced here: the host re-validates the whole resulting
 * document with `validateSurfaceDocument` before it commits (Req 5.2).
 */
import { isSurfaceLayoutComponent } from './surface-bindings';
import type { SurfaceLayoutComponent } from './surface-bindings';
import { applyDataModelOps } from './surface-data-model';
import type { SurfaceDataModelOp } from './surface-data-model';
import type { DashboardComponent } from './dashboard-spec.types';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceSelection,
  SurfaceStateOp,
  SurfaceStateView,
} from './surface.types';

/** The mutable part of a state view; the revision is the store's business. */
export type SurfacePatchState = Pick<
  SurfaceStateView,
  'content' | 'selection' | 'lastSubmit'
>;
export type SurfacePatchResult =
  | { readonly ok: true; readonly next: SurfacePatchState }
  | { readonly ok: false; readonly reason: string };
export type SurfaceStructureOp = Extract<
  SurfaceStateOp,
  {
    op:
      'add-component' | 'replace-component' | 'remove-component' | 'set-title';
  }
>;

type V2Surface = Extract<
  SurfaceContent,
  { contract: 'dashboard-spec/2' }
>['surface'];
type Failure = { readonly ok: false; readonly reason: string };
type ListResult =
  { readonly ok: true; readonly list: readonly SurfaceComponent[] } | Failure;

const fail = (reason: string): Failure => ({ ok: false, reason });

/** Ops can come from untyped callers; read the discriminant defensively. */
function opName(op: unknown): string {
  return typeof op === 'object' && op !== null && 'op' in op
    ? String(op.op).slice(0, 64)
    : 'unknown';
}

function isDataOp(op: SurfaceStateOp): op is SurfaceDataModelOp {
  return op.op === 'set-data' || op.op === 'remove-data';
}

/** Structure ops, as opposed to data, selection or last-submit ops. */
export function isSurfaceStructureOp(
  op: SurfaceStateOp,
): op is SurfaceStructureOp {
  return (
    op.op === 'add-component' ||
    op.op === 'replace-component' ||
    op.op === 'remove-component' ||
    op.op === 'set-title'
  );
}

/** Index path from the roots to the component with `id`, or null. Iterative. */
function locate(
  roots: readonly SurfaceComponent[],
  id: string,
): readonly number[] | null {
  const stack: { list: readonly SurfaceComponent[]; path: number[] }[] = [
    { list: roots, path: [] },
  ];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    for (let index = 0; index < entry.list.length; index++) {
      const component = entry.list[index];
      const path = [...entry.path, index];
      if (component.id === id) return path;
      if (isSurfaceLayoutComponent(component))
        stack.push({ list: component.children, path });
    }
  }
  return null;
}

function componentAt(
  roots: readonly SurfaceComponent[],
  path: readonly number[],
): SurfaceComponent | undefined {
  let list = roots;
  let component: SurfaceComponent | undefined;
  for (const index of path) {
    component = list[index];
    if (component === undefined) return undefined;
    list = isSurfaceLayoutComponent(component) ? component.children : [];
  }
  return component;
}

function findComponent(
  roots: readonly SurfaceComponent[],
  id: string,
): SurfaceComponent | undefined {
  const path = locate(roots, id);
  return path === null ? undefined : componentAt(roots, path);
}

/**
 * Rebuild the child list reached through `parentPath` (`[]` = roots) with
 * `edit`, copying only the layouts on that path; untouched branches keep their
 * identity. Iterative: the rebuild depth is the path length.
 */
function editChildren(
  roots: readonly SurfaceComponent[],
  parentPath: readonly number[],
  edit: (children: readonly SurfaceComponent[]) => ListResult,
): ListResult {
  const lists: (readonly SurfaceComponent[])[] = [roots];
  const owners: SurfaceLayoutComponent[] = [];
  let list = roots;
  for (const index of parentPath) {
    const owner = list[index];
    if (owner === undefined || !isSurfaceLayoutComponent(owner))
      return fail('Component path does not resolve to a layout.');
    owners.push(owner);
    list = owner.children;
    lists.push(list);
  }
  const edited = edit(list);
  if (!edited.ok) return edited;
  let rebuilt = edited.list;
  for (let level = parentPath.length - 1; level >= 0; level--) {
    const copy = lists[level].slice();
    copy[parentPath[level]] = { ...owners[level], children: rebuilt };
    rebuilt = copy;
  }
  return { ok: true, list: rebuilt };
}

function missing(id: string, surface: V2Surface): Failure {
  return fail(
    `Component "${id}" does not exist in surface "${surface.surfaceId}".`,
  );
}

function addComponent(
  surface: V2Surface,
  op: Extract<SurfaceStateOp, { op: 'add-component' }>,
): ListResult {
  let parentPath: readonly number[] = [];
  if (op.parentId !== null) {
    const located = locate(surface.components, op.parentId);
    if (located === null) return missing(op.parentId, surface);
    const parent = componentAt(surface.components, located);
    if (parent === undefined || !isSurfaceLayoutComponent(parent))
      return fail(
        `Component "${op.parentId}" is a ${parent?.kind ?? 'missing component'}; only section, stack, grid and card take children.`,
      );
    parentPath = located;
  }
  return editChildren(surface.components, parentPath, (children) => {
    const index = op.index ?? children.length;
    if (!Number.isInteger(index) || index < 0 || index > children.length)
      return fail(
        `Index ${index} is out of range for ${op.parentId === null ? 'the root components' : `component "${op.parentId}"`} (0..${children.length}).`,
      );
    const list = children.slice();
    list.splice(index, 0, op.component);
    return { ok: true, list };
  });
}

function replaceOrRemove(
  surface: V2Surface,
  op: Extract<SurfaceStateOp, { op: 'replace-component' | 'remove-component' }>,
): ListResult {
  const id = op.op === 'replace-component' ? op.component.id : op.componentId;
  const located = locate(surface.components, id);
  if (located === null) return missing(id, surface);
  const position = located[located.length - 1];
  return editChildren(surface.components, located.slice(0, -1), (children) => {
    const list = children.slice();
    if (op.op === 'replace-component') list[position] = op.component;
    else list.splice(position, 1);
    return { ok: true, list };
  });
}

function applyStructureOp(
  surface: V2Surface,
  op: SurfaceStructureOp,
): { readonly ok: true; readonly surface: V2Surface } | Failure {
  if (op.op === 'set-title') {
    // Sets the header wholesale: an omitted description clears it.
    return {
      ok: true,
      surface: {
        schemaVersion: surface.schemaVersion,
        catalogVersion: surface.catalogVersion,
        surfaceId: surface.surfaceId,
        title: op.title,
        ...(op.description === undefined
          ? {}
          : { description: op.description }),
        components: surface.components,
      },
    };
  }
  let edited: ListResult;
  if (op.op === 'add-component') edited = addComponent(surface, op);
  else if (op.op === 'replace-component' || op.op === 'remove-component')
    edited = replaceOrRemove(surface, op);
  else return fail('Unknown structure operation.');
  if (!edited.ok) return edited;
  return { ok: true, surface: { ...surface, components: edited.list } };
}

/**
 * The selection after one structure op, judged on the tree BEFORE the op: a
 * replace or remove of the selected component or of any of its current
 * ancestors clears it. Only a later explicit `set-selection` re-establishes one.
 */
function survivesStructureOp(
  before: SurfaceContent,
  selection: SurfaceSelection | null,
  op: SurfaceStructureOp,
): SurfaceSelection | null {
  if (selection === null) return null;
  const touched =
    op.op === 'replace-component'
      ? op.component.id
      : op.op === 'remove-component'
        ? op.componentId
        : undefined;
  if (touched === undefined) return selection;
  return ancestorChain(before, selection.componentId).includes(touched)
    ? null
    : selection;
}

/**
 * Apply ops in order, atomically: every op applies, or a reason is returned
 * and the input state is untouched (it is never mutated). A missing component
 * or parent id is an error naming the id (Req 5.3). v1 content accepts only
 * selection and last-submit ops; its structure arrives as whole snapshots. A
 * `set-selection` must resolve against the content at that point. The
 * selection is revalidated as EACH structure op applies, against the tree the
 * op saw, and again on the result (Req 5.9): it is cleared, never remapped.
 */
export function applySurfaceOps(
  state: SurfacePatchState,
  ops: readonly SurfaceStateOp[],
): SurfacePatchResult {
  try {
    let content = state.content;
    let selection = state.selection;
    let lastSubmit = state.lastSubmit;
    let index = 0;
    while (index < ops.length) {
      const op = ops[index];
      if (op.op === 'set-selection') {
        if (op.selection !== null) {
          const check = checkSurfaceSelection(content, op.selection);
          if (!check.ok) return check;
        }
        selection = op.selection;
        index++;
        continue;
      }
      if (op.op === 'set-last-submit') {
        lastSubmit = op.record;
        index++;
        continue;
      }
      if (content.contract !== 'dashboard-spec/2')
        return fail(
          `Operation "${opName(op)}" is not allowed on a dashboard-spec/1 surface; v1 surfaces are replaced whole.`,
        );
      const v2 = content;
      if (isDataOp(op)) {
        // One atomic data-model call per run of consecutive data ops.
        const run: SurfaceDataModelOp[] = [];
        while (index < ops.length) {
          const candidate = ops[index];
          if (!isDataOp(candidate)) break;
          run.push(candidate);
          index++;
        }
        const applied = applyDataModelOps(v2.dataModel, run);
        if (!applied.ok) return applied;
        content = { ...v2, dataModel: applied.next };
        continue;
      }
      index++;
      if (!isSurfaceStructureOp(op))
        return fail(`Unknown surface operation "${opName(op)}".`);
      // Invalidate against the PRE-op tree, as each structure op applies: an
      // ancestor that exists only between two ops (added, selected into, then
      // removed) must still clear the selection (Req 5.9).
      selection = survivesStructureOp(v2, selection, op);
      const applied = applyStructureOp(v2.surface, op);
      if (!applied.ok) return applied;
      content = { ...v2, surface: applied.surface };
      if (selection !== null && !checkSurfaceSelection(content, selection).ok)
        selection = null;
    }
    if (selection !== null && !checkSurfaceSelection(content, selection).ok)
      selection = null;
    return { ok: true, next: { content, selection, lastSubmit } };
  } catch {
    // Fail closed for exotic in-process objects; the input state is untouched.
    return fail('Cannot apply surface operations.');
  }
}

interface TreeNode {
  readonly id: string;
  readonly children?: readonly TreeNode[];
}

/** Ids from the root down to `id` (inclusive), or [] when absent. */
function ancestorChain(content: SurfaceContent, id: string): string[] {
  const roots: readonly TreeNode[] =
    content.contract === 'dashboard-spec/2'
      ? content.surface.components
      : content.spec.components;
  const stack = roots.map((node) => ({ node, chain: [node.id] }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (entry.node.id === id) return entry.chain;
    for (const child of entry.node.children ?? [])
      stack.push({ node: child, chain: [...entry.chain, child.id] });
  }
  return [];
}

function findSelectable(
  content: SurfaceContent,
  id: string,
): SurfaceComponent | DashboardComponent | undefined {
  if (content.contract === 'dashboard-spec/2')
    return findComponent(content.surface.components, id);
  const stack: DashboardComponent[] = [...content.spec.components];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) break;
    if (node.id === id) return node;
    if (node.children !== undefined) stack.push(...node.children);
  }
  return undefined;
}

const isIndex = (value: number, length: number): boolean =>
  Number.isInteger(value) && value >= 0 && value < length;

/**
 * Whether `selection` points at real data in `content`: the component exists,
 * its kind matches the target, and every index is in range of the INLINE data.
 * A table, list or chart backed by a `data` reference holds no rows the host
 * can check, so it cannot be selected by index (Req 7.5, 494 D4).
 */
export function checkSurfaceSelection(
  content: SurfaceContent,
  selection: SurfaceSelection,
): { readonly ok: true } | Failure {
  const component = findSelectable(content, selection.componentId);
  if (component === undefined)
    return fail(
      `Selected component "${selection.componentId}" does not exist.`,
    );
  const target = selection.target;
  const where = `Selection on "${selection.componentId}" (${component.kind})`;
  switch (target.kind) {
    case 'stat':
      return component.kind === 'stat'
        ? { ok: true }
        : fail(`${where} does not match target kind stat.`);
    case 'table-row':
      return component.kind === 'table' &&
        component.rows !== undefined &&
        isIndex(target.rowIndex, component.rows.length)
        ? { ok: true }
        : fail(`${where} has no row ${target.rowIndex}.`);
    case 'list-item':
      return component.kind === 'list' &&
        component.items !== undefined &&
        isIndex(target.itemIndex, component.items.length)
        ? { ok: true }
        : fail(`${where} has no item ${target.itemIndex}.`);
    case 'chart-point': {
      if (
        (component.kind !== 'line-chart' && component.kind !== 'bar-chart') ||
        component.series === undefined ||
        !isIndex(target.seriesIndex, component.series.length)
      )
        return fail(`${where} has no series ${target.seriesIndex}.`);
      const points = component.series[target.seriesIndex].points;
      return isIndex(target.pointIndex, points.length)
        ? { ok: true }
        : fail(`${where} has no point ${target.pointIndex}.`);
    }
    default:
      return fail(`${where} has an unknown target kind.`);
  }
}

/** Field-by-field, per target kind: independent of property order. */
function sameSelection(a: SurfaceSelection, b: SurfaceSelection): boolean {
  if (a.componentId !== b.componentId) return false;
  const left = a.target;
  const right = b.target;
  switch (left.kind) {
    case 'stat':
      return right.kind === 'stat';
    case 'table-row':
      return right.kind === 'table-row' && left.rowIndex === right.rowIndex;
    case 'list-item':
      return right.kind === 'list-item' && left.itemIndex === right.itemIndex;
    case 'chart-point':
      return (
        right.kind === 'chart-point' &&
        left.seriesIndex === right.seriesIndex &&
        left.pointIndex === right.pointIndex
      );
    default:
      return false;
  }
}

/**
 * Revalidate `next.selection` for a caller that committed `ops` on `prev`
 * (Req 5.9). A whole replacement (`'replace'`) always clears it. Otherwise the
 * ops are replayed from `prev` with the same per-op rule `applySurfaceOps`
 * uses, so an intermediate ancestor that no endpoint contains is still seen.
 * The selection is kept only if the replay keeps the same selection and it
 * resolves against `next.content`; anything else fails closed to null.
 */
export function revalidateSelection(
  prev: SurfacePatchState,
  next: SurfacePatchState,
  ops: readonly SurfaceStateOp[] | 'replace',
): SurfaceSelection | null {
  const selection = next.selection;
  if (selection === null || ops === 'replace') return null;
  const replay = applySurfaceOps(prev, ops);
  if (
    !replay.ok ||
    replay.next.selection === null ||
    !sameSelection(replay.next.selection, selection)
  )
    return null;
  return checkSurfaceSelection(next.content, selection).ok ? selection : null;
}
