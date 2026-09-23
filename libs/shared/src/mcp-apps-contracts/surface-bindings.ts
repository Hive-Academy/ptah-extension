/**
 * Pure binding rules for v2 inputs: tree walking, shared-path compatibility
 * (Req 3.7), draft versus submit validity (Req 3.6, 10.2) and submit scope
 * (Req 10.6). No schema or platform dependency; results are unions, never throws
 * for well-typed input.
 */
import {
  SURFACE_INPUT_KINDS,
  SURFACE_LAYOUT_KINDS,
  SURFACE_LIMITS,
} from './surface-catalog';
import type { SurfaceLayoutKind } from './surface-catalog';
import {
  parseSurfacePath,
  pathsOverlap,
  readSurfacePath,
} from './surface-data-model';
import type {
  SurfaceAction,
  SurfaceComponent,
  SurfaceDataModel,
  SurfaceDataValue,
  SurfaceInput,
} from './surface.types';

export type SurfaceLayoutComponent = Extract<
  SurfaceComponent,
  { readonly kind: SurfaceLayoutKind }
>;

const LAYOUT_KINDS: ReadonlySet<string> = new Set(SURFACE_LAYOUT_KINDS);
const INPUT_KINDS: ReadonlySet<string> = new Set(SURFACE_INPUT_KINDS);

export function isSurfaceLayoutComponent(
  component: SurfaceComponent,
): component is SurfaceLayoutComponent {
  return LAYOUT_KINDS.has(component.kind);
}

export function isSurfaceInputComponent(
  component: SurfaceComponent,
): component is SurfaceInput {
  return INPUT_KINDS.has(component.kind);
}

/** Actions a component declares. Inputs carry none. */
export function surfaceActionsOf(
  component: SurfaceComponent,
): readonly SurfaceAction[] {
  return 'actions' in component && component.actions !== undefined
    ? component.actions
    : [];
}

/** Return `false` from the visitor to stop the walk early. */
export type SurfaceComponentVisitor = (
  component: SurfaceComponent,
  depth: number,
  parentId: string | null,
) => boolean | void;

/**
 * Iterative pre-order walk in document order. A root component is depth 1, as
 * in v1 (`dashboard-spec.validator.ts:134-163`). Iterative so that a typed
 * caller holding an unvalidated tree cannot overflow the stack.
 */
export function visitSurfaceComponents(
  components: readonly SurfaceComponent[],
  visit: SurfaceComponentVisitor,
): void {
  const stack: {
    component: SurfaceComponent;
    depth: number;
    parentId: string | null;
  }[] = [];
  for (let index = components.length - 1; index >= 0; index--)
    stack.push({ component: components[index], depth: 1, parentId: null });
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (visit(entry.component, entry.depth, entry.parentId) === false) return;
    if (!isSurfaceLayoutComponent(entry.component)) continue;
    const children = entry.component.children;
    for (let index = children.length - 1; index >= 0; index--)
      stack.push({
        component: children[index],
        depth: entry.depth + 1,
        parentId: entry.component.id,
      });
  }
}

/** Every input in document order. Inputs are leaves; layouts carry children. */
export function collectSurfaceInputs(
  components: readonly SurfaceComponent[],
): SurfaceInput[] {
  const inputs: SurfaceInput[] = [];
  visitSurfaceComponents(components, (component) => {
    if (isSurfaceInputComponent(component)) inputs.push(component);
  });
  return inputs;
}

export type SurfaceBindingCompatibility =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly paths: readonly string[];
    };

/** text, checkbox and option are the three value types; select and radio share one. */
function valueTypeOf(input: SurfaceInput): 'text' | 'checkbox' | 'option' {
  if (input.kind === 'select' || input.kind === 'radio-group') return 'option';
  return input.kind;
}

function optionValues(input: SurfaceInput): ReadonlySet<string> {
  return input.kind === 'select' || input.kind === 'radio-group'
    ? new Set(input.options.map((option) => option.value))
    : new Set<string>();
}

function sameOptionSet(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * The one compatibility rule (Req 3.7). Two inputs may bind the SAME exact
 * path only when they hold the same value type: text with text, checkbox with
 * checkbox, and select or radio-group with an identical set of option values
 * (so every write one accepts, the other accepts too, and both read one
 * canonical value). Hints may differ; each input's hints apply at submit.
 * Any ancestor/descendant overlap between two bound paths is rejected, because
 * writing the ancestor would silently replace the descendant's value.
 */
export function checkBindingCompatibility(
  inputs: readonly SurfaceInput[],
): SurfaceBindingCompatibility {
  const parsed: { input: SurfaceInput; path: string }[] = [];
  for (const input of inputs) {
    const path = parseSurfacePath(input.path);
    if (!path.ok)
      return {
        ok: false,
        reason: `Input "${input.id}": ${path.reason}`,
        paths: [input.path],
      };
    parsed.push({ input, path: path.segments.join('.') });
  }
  for (let left = 0; left < parsed.length; left++) {
    for (let right = left + 1; right < parsed.length; right++) {
      const a = parsed[left];
      const b = parsed[right];
      if (a.path === b.path) {
        const typeA = valueTypeOf(a.input);
        const typeB = valueTypeOf(b.input);
        if (typeA !== typeB)
          return {
            ok: false,
            reason: `Inputs "${a.input.id}" (${a.input.kind}) and "${b.input.id}" (${b.input.kind}) bind the same path "${a.path}" with different value types.`,
            paths: [a.path],
          };
        if (
          typeA === 'option' &&
          !sameOptionSet(optionValues(a.input), optionValues(b.input))
        )
          return {
            ok: false,
            reason: `Inputs "${a.input.id}" and "${b.input.id}" bind the same path "${a.path}" with different option values.`,
            paths: [a.path],
          };
      } else if (pathsOverlap(a.path, b.path)) {
        return {
          ok: false,
          reason: `Inputs "${a.input.id}" at "${a.path}" and "${b.input.id}" at "${b.path}" bind overlapping ancestor and descendant paths.`,
          paths: [a.path, b.path],
        };
      }
    }
  }
  return { ok: true };
}

export type SurfaceValueCheck =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Draft validity, enforced at EVERY write (Req 3.4, 3.6). `undefined` means
 * the path is absent and reads as the kind's empty value, which is always a
 * valid draft. An empty required field and text outside its length hints are
 * valid drafts; those hints are enforced by `checkSubmitValues`. A wrong type,
 * or a non-empty value outside the declared options, is rejected. Select and
 * radio-group have exactly one empty value, `null`; `''` is not an option.
 */
export function checkDraftValue(
  input: SurfaceInput,
  value: SurfaceDataValue | undefined,
): SurfaceValueCheck {
  if (value === undefined) return { ok: true };
  const where = `Input "${input.id}" at "${input.path}"`;
  switch (input.kind) {
    case 'text':
      if (typeof value !== 'string')
        return { ok: false, reason: `${where} expects a string.` };
      if (value.length > SURFACE_LIMITS.maxStringLength)
        return {
          ok: false,
          reason: `${where} exceeds maxStringLength ${SURFACE_LIMITS.maxStringLength}.`,
        };
      return { ok: true };
    case 'checkbox':
      return typeof value === 'boolean'
        ? { ok: true }
        : { ok: false, reason: `${where} expects true or false.` };
    case 'select':
    case 'radio-group':
      if (value === null) return { ok: true };
      if (typeof value !== 'string')
        return {
          ok: false,
          reason: `${where} expects one of its option values or null.`,
        };
      return input.options.some((option) => option.value === value)
        ? { ok: true }
        : {
            ok: false,
            reason: `${where} does not declare the option value "${value.slice(0, SURFACE_LIMITS.maxOptionValueLength)}".`,
          };
    default:
      return { ok: false, reason: 'Unknown input kind.' };
  }
}

export interface SurfaceSubmitValue {
  readonly componentId: string;
  readonly path: string;
  readonly value: SurfaceDataValue;
}
export interface SurfaceSubmitIssue {
  readonly componentId: string;
  readonly path: string;
  readonly message: string;
}
export type SurfaceSubmitValuesCheck =
  | { readonly ok: true; readonly values: readonly SurfaceSubmitValue[] }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly issues: readonly SurfaceSubmitIssue[];
    };

function submitIssue(
  input: SurfaceInput,
  value: SurfaceDataValue,
): string | undefined {
  const draft = checkDraftValue(input, value);
  if (!draft.ok) return draft.reason;
  const required = input.hints?.required === true;
  switch (input.kind) {
    case 'text': {
      const text = typeof value === 'string' ? value : '';
      if (required && text.trim().length === 0) return 'is required.';
      const hints = input.hints;
      // An optional field left empty is not held to its minimum length.
      if (
        hints?.minLength !== undefined &&
        text.length > 0 &&
        text.length < hints.minLength
      )
        return `must be at least ${hints.minLength} characters.`;
      if (hints?.maxLength !== undefined && text.length > hints.maxLength)
        return `must be at most ${hints.maxLength} characters.`;
      return undefined;
    }
    case 'checkbox':
      // Documented choice: `required` on a checkbox means checked (true).
      return required && value !== true ? 'must be checked.' : undefined;
    case 'select':
    case 'radio-group':
      return required && value === null ? 'is required.' : undefined;
    default:
      return 'has an unknown input kind.';
  }
}

/**
 * Submit validity for the inputs in one submit scope (Req 10.2). Missing
 * paths read as the kind's empty value (Req 4.4). The rejection names every
 * failing path, not only the first, so the UI can mark all of them at once.
 */
export function checkSubmitValues(
  inputs: readonly SurfaceInput[],
  model: SurfaceDataModel,
): SurfaceSubmitValuesCheck {
  const values: SurfaceSubmitValue[] = [];
  const issues: SurfaceSubmitIssue[] = [];
  for (const input of inputs) {
    const read = readSurfacePath(model, input.path, input.kind);
    if (!read.ok || read.value === undefined) {
      issues.push({
        componentId: input.id,
        path: input.path,
        message: read.ok ? 'cannot be read.' : read.reason,
      });
      continue;
    }
    const message = submitIssue(input, read.value);
    if (message !== undefined)
      issues.push({ componentId: input.id, path: input.path, message });
    else
      values.push({
        componentId: input.id,
        path: input.path,
        value: read.value,
      });
  }
  if (issues.length === 0) return { ok: true, values };
  return {
    ok: false,
    issues,
    reason: issues
      .map((issue) => `${issue.path} (${issue.componentId}): ${issue.message}`)
      .join('; '),
  };
}

/** The first component declaring `actionId`, with that action. */
export function findSurfaceAction(
  components: readonly SurfaceComponent[],
  actionId: string,
):
  | { readonly owner: SurfaceComponent; readonly action: SurfaceAction }
  | undefined {
  const found: { owner?: SurfaceComponent; action?: SurfaceAction } = {};
  visitSurfaceComponents(components, (component) => {
    const action = surfaceActionsOf(component).find(
      (entry) => entry.id === actionId,
    );
    if (action === undefined) return true;
    found.owner = component;
    found.action = action;
    return false;
  });
  return found.owner !== undefined && found.action !== undefined
    ? { owner: found.owner, action: found.action }
    : undefined;
}

export type SurfaceSubmitScope =
  | {
      readonly ok: true;
      readonly scopeComponentId: string;
      readonly inputs: readonly SurfaceInput[];
    }
  | {
      readonly ok: false;
      /** `undeclared`: no action has this id. The other two are contract errors. */
      readonly code: 'undeclared' | 'not-submit' | 'invalid-scope';
      readonly reason: string;
    };

/**
 * The submit scope rule (Req 10.6): a `surface.submit` action may be declared
 * only on a layout component, and it submits exactly the bound inputs in that
 * component's subtree. The scope must hold at least one input. Action ids are
 * unique across a validated surface, so the first match is the only match.
 */
export function collectSubmitScope(
  components: readonly SurfaceComponent[],
  actionId: string,
): SurfaceSubmitScope {
  const found = findSurfaceAction(components, actionId);
  if (found === undefined)
    return {
      ok: false,
      code: 'undeclared',
      reason: `Action "${actionId}" is not declared on this surface.`,
    };
  const { owner, action } = found;
  if (action.action !== 'surface.submit')
    return {
      ok: false,
      code: 'not-submit',
      reason: `Action "${actionId}" is ${action.action}, not surface.submit.`,
    };
  if (!isSurfaceLayoutComponent(owner))
    return {
      ok: false,
      code: 'invalid-scope',
      reason: `Submit action "${actionId}" is declared on ${owner.kind} "${owner.id}"; surface.submit is allowed only on section, stack, grid or card.`,
    };
  const inputs = collectSurfaceInputs(owner.children);
  if (inputs.length === 0)
    return {
      ok: false,
      code: 'invalid-scope',
      reason: `Submit action "${actionId}" on ${owner.kind} "${owner.id}" has no bound inputs in its scope.`,
    };
  return { ok: true, scopeComponentId: owner.id, inputs };
}
