import type { ActivatedRoute, RouterStateSnapshot } from '@angular/router';

export interface MotionRouteKey {
  readonly key: string;
  readonly index: number | null;
}

export type MotionRouteKeyFn = (target: RouterStateSnapshot) => MotionRouteKey | null;

/** Read the pending target, since page signals may update only at NavigationEnd. */
export function detailParamKey(listRoute: ActivatedRoute, param: string): MotionRouteKeyFn {
  return (target) => {
    let node = target.root.firstChild;
    while (node && node.routeConfig !== listRoute.routeConfig) node = node.firstChild;
    if (!node) return null;
    return { key: node.firstChild?.paramMap.get(param) ?? '', index: null };
  };
}
