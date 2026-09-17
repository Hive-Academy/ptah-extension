import type { StateStorageArraySplitPlan } from '@ptah-extension/platform-core';
import type { z } from 'zod';

interface OutputNamespace {
  readonly planIndex: number;
  readonly value: string;
  readonly exact: boolean;
}

function outputNamespaces(
  plans: readonly StateStorageArraySplitPlan[],
): OutputNamespace[] {
  return plans.flatMap((plan, planIndex) => [
    { planIndex, value: plan.indexKey, exact: true },
    { planIndex, value: plan.detailKeyPrefix, exact: false },
    ...(plan.nestedExtractions ?? []).map((extraction) => ({
      planIndex,
      value: extraction.destinationKeyPrefix,
      exact: false,
    })),
  ]);
}

function namespacesOverlap(
  left: OutputNamespace,
  right: OutputNamespace,
): boolean {
  if (left.exact && right.exact) return left.value === right.value;
  if (left.exact) return left.value.startsWith(right.value);
  if (right.exact) return right.value.startsWith(left.value);
  return (
    left.value.startsWith(right.value) || right.value.startsWith(left.value)
  );
}

function isPathPrefix(
  prefix: readonly (string | number)[],
  path: readonly (string | number)[],
): boolean {
  return (
    prefix.length <= path.length &&
    prefix.every((segment, index) => String(segment) === String(path[index]))
  );
}

function sourceInsideNamespace(
  plans: readonly StateStorageArraySplitPlan[],
  planIndex: number,
  namespace: OutputNamespace,
): boolean {
  const { sourceKey } = plans[planIndex];
  if (namespace.exact) {
    return namespace.planIndex !== planIndex && namespace.value === sourceKey;
  }
  return sourceKey.startsWith(namespace.value);
}

export function refineSplitPlans(
  plans: StateStorageArraySplitPlan[],
  context: z.RefinementCtx<StateStorageArraySplitPlan[]>,
): void {
  const reject = (message: string): void => {
    context.addIssue({ code: 'custom', message });
  };
  const sourceKeys = new Set(plans.map((plan) => plan.sourceKey));
  if (sourceKeys.size !== plans.length) {
    reject('split plans must have distinct source keys');
  }
  if (plans.some((plan) => plan.sourceKey !== plan.indexKey)) {
    reject('a split plan must write its index to its source key');
  }
  for (const plan of plans) {
    const paths = (plan.nestedExtractions ?? []).map(
      (extraction) => extraction.sourceArrayPath,
    );
    const nests = paths.some((path, index) =>
      paths.some((other, at) => at !== index && isPathPrefix(path, other)),
    );
    if (nests) reject('nested extraction source paths must not nest');
  }
  const namespaces = outputNamespaces(plans);
  namespaces.forEach((namespace, index) => {
    if (
      namespaces
        .slice(index + 1)
        .some((other) => namespacesOverlap(namespace, other))
    ) {
      reject('split plan output namespaces must not overlap');
    }
  });
  plans.forEach((_, planIndex) => {
    if (
      namespaces.some((namespace) =>
        sourceInsideNamespace(plans, planIndex, namespace),
      )
    ) {
      reject('a split plan source key must not be another plan output');
    }
  });
}
