import type { CommandWorkNode } from '../model/command-center.store';
import type { ProjectionResult } from '../model/work-projection';

export interface SceneViewport {
  readonly width: number;
  readonly height: number;
  readonly sceneRect?: SceneRect;
}

export interface SceneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SceneNode {
  readonly node: CommandWorkNode;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly scale: number;
  readonly kind: 'root' | 'delegate' | 'tribunal' | 'satellite';
  readonly label: string;
  readonly labelRect: SceneRect | null;
  readonly phases: readonly CommandWorkNode[];
}

export interface SceneLayout {
  readonly nodes: readonly SceneNode[];
  readonly orbitCount: number;
  /** Ownership links terminate at the owning child sphere. */
  readonly tethers?: readonly SceneTether[];
  readonly overflowCompleted: number;
  readonly overflowOther: number;
  readonly overflowChip: {
    readonly text: string;
    readonly x: number;
    readonly y: number;
  } | null;
}

export interface SceneTether {
  readonly fromId: string;
  readonly toId: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
}

export type MeasureSceneLabel = (
  nodeId: string,
  text: string,
) => Pick<SceneRect, 'width' | 'height'>;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
export const SCENE_LABEL_CANDIDATE_LIMIT = 4 + 7 * 16 * 4;
export const CHILD_ORBIT_RADIUS = 70;

/** Root medallion radius: 96px across on wide stages, 80px below 600px. */
export function rootRadiusFor(width: number): number {
  return (width < 600 ? 80 : 96) / 2;
}

export function orbitRadii(
  rect: SceneRect,
  many: boolean,
  inner: boolean,
): { rx: number; ry: number } {
  return {
    rx: Math.max(
      0,
      Math.min(
        rect.width * (many ? (inner ? 0.235 : 0.425) : 0.405),
        rect.width / 2 - 44,
      ),
    ),
    ry: Math.max(
      0,
      Math.min(
        rect.height * (many ? (inner ? 0.225 : 0.385) : 0.365),
        rect.height / 2 - 44,
      ),
    ),
  };
}

const providerName = (id: string | null): string => {
  if (!id) return 'Session';
  return id
    .split(/[-_ ]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

/** Stable geometry and measured labels. Call only when projection or viewport changes. */
export function layoutScene(
  projection: ProjectionResult,
  viewport: SceneViewport,
  measure: MeasureSceneLabel,
  selectedId: string | null = null,
): SceneLayout {
  const root = projection.nodes.find((node) => node.parentId === null);
  if (!root)
    return {
      nodes: [],
      orbitCount: 0,
      overflowCompleted: 0,
      overflowOther: 0,
      overflowChip: null,
    };
  const byId = new Map(projection.nodes.map((node) => [node.id, node]));
  const rest = projection.nodes.filter(
    (node) => node.id !== root.id && node.kind !== 'phase',
  );
  const priority = (node: CommandWorkNode): number =>
    node.id === selectedId
      ? 0
      : node.state === 'failed' || node.state === 'awaiting input'
        ? 1
        : node.state === 'completed'
          ? 3
          : 2;
  const visibleIds = new Set<string>();
  for (const { node } of rest
    .map((node, index) => ({ node, index }))
    .sort((a, b) => priority(a.node) - priority(b.node) || a.index - b.index)) {
    const ancestors: string[] = [];
    let parentId = node.parentId;
    let valid = true;
    const visited = new Set([node.id]);
    while (parentId !== root.id) {
      if (!parentId || visited.has(parentId)) {
        valid = false;
        break;
      }
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.kind === 'phase') {
        valid = false;
        break;
      }
      ancestors.push(parent.id);
      parentId = parent.parentId;
    }
    if (!valid) continue;
    const needed = [node.id, ...ancestors].filter((id) => !visibleIds.has(id));
    if (visibleIds.size + needed.length > 23) continue;
    for (const id of needed) visibleIds.add(id);
  }
  const visible = rest.filter((node) => visibleIds.has(node.id));
  const excluded = rest.filter((node) => !visibleIds.has(node.id));
  const overflowCompleted = excluded.filter(
    (node) => node.state === 'completed',
  ).length;
  const overflowOther = excluded.length - overflowCompleted;
  const rect = viewport.sceneRect;
  const cx = rect ? rect.x + rect.width / 2 : viewport.width * 0.5;
  const cy = rect ? rect.y + rect.height / 2 : viewport.height * 0.485;
  const left = rect ? rect.x + 8 : 14;
  const right = rect ? rect.x + rect.width - 8 : viewport.width - 14;
  const top = rect ? rect.y + 6 : 66;
  const bottom = rect ? rect.y + rect.height - 6 : viewport.height - 42;
  const rootRadius = rootRadiusFor(viewport.width);
  const placed: {
    node: CommandWorkNode;
    x: number;
    y: number;
    radius: number;
    scale: number;
    kind: SceneNode['kind'];
  }[] = [
    { node: root, x: cx, y: cy, radius: rootRadius, scale: 1, kind: 'root' },
  ];
  const owningChild = (node: CommandWorkNode): string | null => {
    let parentId = node.parentId;
    while (parentId && parentId !== root.id) {
      const parent = byId.get(parentId);
      if (!parent) return null;
      if (parent.kind === 'child') return parent.id;
      parentId = parent.parentId;
    }
    return null;
  };
  const orbitNodes = visible.filter(
    (node) => node.kind !== 'lane' && (!rect || !owningChild(node)),
  );
  const many = orbitNodes.length > 8;
  for (let i = 0; i < orbitNodes.length; i++) {
    const node = orbitNodes[i];
    const kind: SceneNode['kind'] =
      node.kind === 'tribunal' ? 'tribunal' : 'delegate';
    const inner = many && i < 8;
    const ringIndex = inner ? i : many ? i - 8 : i;
    const ringCount = inner
      ? Math.min(8, orbitNodes.length)
      : many
        ? orbitNodes.length - 8
        : orbitNodes.length;
    const angle =
      -Math.PI / 2 + (ringIndex * Math.PI * 2) / Math.max(1, ringCount);
    const { rx, ry } = rect
      ? orbitRadii(rect, many, inner)
      : {
          rx: viewport.width * (many ? (inner ? 0.235 : 0.425) : 0.405),
          ry: viewport.height * (many ? (inner ? 0.225 : 0.385) : 0.365),
        };
    const scale = many ? (inner ? 0.72 : 0.78) : 1;
    const radius = ((kind === 'tribunal' ? 70 : 58) * scale) / 2;
    placed.push({
      node,
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      radius,
      scale,
      kind,
    });
  }
  // Keep the root voice ring clear and separate pairs with five deterministic passes.
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 1; i < placed.length; i++) {
      const point = placed[i];
      for (let j = 0; j < i; j++) {
        const other = placed[j];
        const dx = point.x - other.x;
        const dy = point.y - other.y;
        const distance = Math.hypot(dx, dy);
        const minimum =
          j === 0
            ? point.radius + rootRadius + 44
            : point.radius + other.radius + 12;
        if (distance >= minimum) continue;
        const direction =
          distance > 0
            ? [dx / distance, dy / distance]
            : [Math.cos(i), Math.sin(i)];
        point.x += direction[0] * (minimum - distance);
        point.y += direction[1] * (minimum - distance);
      }
      const envelope =
        point.kind === 'tribunal' &&
        visible.some(
          (node) => node.parentId === point.node.id && node.kind === 'lane',
        )
          ? point.radius + 44
          : point.radius;
      point.x = clamp(point.x, left + envelope, right - envelope);
      point.y = clamp(point.y, top + envelope, bottom - envelope);
    }
  }
  const tribunalWithLanes = new Set(
    visible.filter((node) => node.kind === 'lane').map((node) => node.parentId),
  );
  const envelopeFor = (point: (typeof placed)[number]): number =>
    point.radius +
    (point.kind === 'tribunal' && tribunalWithLanes.has(point.node.id)
      ? 44
      : 0);
  const clear = placed.slice(1).every((point, index) => {
    if (
      Math.hypot(point.x - cx, point.y - cy) <
      rootRadius + 32 + envelopeFor(point)
    )
      return false;
    return placed
      .slice(index + 2)
      .every(
        (other) =>
          Math.hypot(point.x - other.x, point.y - other.y) >=
          envelopeFor(point) + envelopeFor(other),
      );
  });
  if (!clear) {
    const targets = placed.slice(1).map((point) => ({
      x: point.x,
      y: point.y,
      radius: point.radius,
    }));
    // Compact stages keep a 12px delegate radius floor and clear the pulsing voice ring.
    for (const factor of [1, 0.9, 0.8, 0.7, 0.6]) {
      const packed = [placed[0]];
      let fits = true;
      for (let index = 1; index < placed.length; index++) {
        const point = placed[index];
        const target = targets[index - 1];
        const radius = Math.max(12, target.radius * factor);
        const envelope =
          radius +
          (point.kind === 'tribunal' && tribunalWithLanes.has(point.node.id)
            ? 44
            : 0);
        let bestX = 0;
        let bestY = 0;
        let bestDistance = Infinity;
        for (let y = top + envelope; y <= bottom - envelope; y += 10) {
          for (let x = left + envelope; x <= right - envelope; x += 10) {
            if (Math.hypot(x - cx, y - cy) < rootRadius + 32 + envelope)
              continue;
            if (
              packed
                .slice(1)
                .some(
                  (other) =>
                    Math.hypot(x - other.x, y - other.y) <
                    envelope + envelopeFor(other) + 4,
                )
            )
              continue;
            const distance = (x - target.x) ** 2 + (y - target.y) ** 2;
            if (distance < bestDistance) {
              bestDistance = distance;
              bestX = x;
              bestY = y;
            }
          }
        }
        if (bestDistance === Infinity) {
          fits = false;
          break;
        }
        packed.push({
          ...point,
          x: bestX,
          y: bestY,
          radius,
          scale: (point.scale * radius) / target.radius,
        });
      }
      if (fits) {
        placed.splice(1, placed.length - 1, ...packed.slice(1));
        break;
      }
    }
  }
  // Pack child-owned cores only after their owner has its final position.
  if (rect) {
    const pending = placed.filter((point) => point.node.kind === 'child');
    for (let childIndex = 0; childIndex < pending.length; childIndex++) {
      const owner = pending[childIndex];
      const owned = visible.filter((node) => {
        if (owningChild(node) !== owner.node.id) return false;
        return (
          node.kind !== 'lane' ||
          byId.get(node.parentId ?? '')?.kind !== 'tribunal'
        );
      });
      owned.forEach((node, index) => {
        const kind: SceneNode['kind'] =
          node.kind === 'tribunal'
            ? 'tribunal'
            : node.kind === 'lane'
              ? 'satellite'
              : 'delegate';
        const radius =
          node.kind === 'tribunal' ? 35 : node.kind === 'lane' ? 16 : 29;
        const angle = -Math.PI / 2 + (index * Math.PI * 2) / owned.length;
        let best: { x: number; y: number; score: number } | null = null;
        for (let step = 0; step < 32; step++) {
          const candidateAngle = angle + (step * Math.PI * 2) / 32;
          const x = owner.x + CHILD_ORBIT_RADIUS * Math.cos(candidateAngle);
          const y = owner.y + CHILD_ORBIT_RADIUS * Math.sin(candidateAngle);
          const outside =
            Math.max(0, left + radius - x, x + radius - right) +
            Math.max(0, top + radius - y, y + radius - bottom);
          const overlap = placed.reduce((total, other) => {
            if (other === owner) return total;
            return (
              total +
              Math.max(
                0,
                radius +
                  other.radius +
                  8 -
                  Math.hypot(x - other.x, y - other.y),
              )
            );
          }, 0);
          const score = outside * 100 + overlap * 10 + step;
          if (!best || score < best.score) best = { x, y, score };
          if (outside === 0 && overlap === 0) break;
        }
        if (!best) return;
        const point = {
          node,
          x: clamp(best.x, left + radius, right - radius),
          y: clamp(best.y, top + radius, bottom - radius),
          radius,
          scale: 1,
          kind,
        };
        placed.push(point);
        if (node.kind === 'child') pending.push(point);
      });
    }
  }
  // Satellites inherit the final core position, so pair separation cannot detach them.
  for (const core of placed.filter((point) => point.kind === 'tribunal')) {
    const lanes = visible.filter(
      (node) => node.kind === 'lane' && node.parentId === core.node.id,
    );
    const orbitRadius = core.radius + 16 + 12;
    lanes.forEach((node, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / lanes.length;
      placed.push({
        node,
        x: core.x + orbitRadius * Math.cos(angle),
        y: core.y + orbitRadius * Math.sin(angle),
        radius: 16,
        scale: 1,
        kind: 'satellite',
      });
    });
  }
  const dense = placed.length > 12;
  let ordinaryLabels = 0;
  const used: SceneRect[] = [];
  const labeled = placed.map((point) => {
    const parent = point.node.parentId
      ? byId.get(point.node.parentId)
      : undefined;
    const label =
      !rect && point.node.kind === 'child'
        ? `${providerName(parent?.providerId ?? null)} · ${point.node.label}`
        : point.node.label;
    const phases =
      point.kind === 'tribunal'
        ? projection.nodes.filter(
            (node) => node.kind === 'phase' && node.parentId === point.node.id,
          )
        : [];
    return { ...point, label, phases };
  });
  const labelRects: (SceneRect | null)[] = placed.map(() => null);
  const labelPriority = (point: (typeof placed)[number]): number =>
    point.kind === 'root'
      ? 0
      : point.node.id === selectedId
        ? 1
        : point.node.state === 'awaiting input'
          ? 2
          : point.node.state === 'failed'
            ? 3
            : 4;
  const placementOrder = placed
    .map((point, index) => ({ point, index }))
    .sort(
      (a, b) =>
        labelPriority(a.point) - labelPriority(b.point) || a.index - b.index,
    );
  for (const { point, index } of placementOrder) {
    const label = labeled[index].label;
    const must =
      point.kind === 'root' ||
      point.node.id === selectedId ||
      point.node.state === 'failed' ||
      point.node.state === 'awaiting input';
    const allowed = !dense || must || ordinaryLabels++ < 5;
    const size = measure(point.node.id, label);
    if (allowed) {
      const gap = point.kind === 'root' ? 36 : 24;
      const ownGap = rect ? (point.kind === 'root' ? 32 : 8) : gap;
      const below = [point.x - size.width / 2, point.y + point.radius + ownGap];
      const above = [
        point.x - size.width / 2,
        point.y - point.radius - size.height - gap,
      ];
      const rightSide = [
        point.x + point.radius + gap,
        point.y - size.height / 2,
      ];
      const leftSide = [
        point.x - point.radius - size.width - gap,
        point.y - size.height / 2,
      ];
      const candidates = rect
        ? [below, rightSide, leftSide, above]
        : [below, above, rightSide, leftSide];
      // Search near the sphere in fixed rings. The old viewport grid could
      // attach the root plate to an unrelated, distant corner.
      for (const radius of [18, 36, 54, 72, 96, 120, 144]) {
        if (candidates.length >= SCENE_LABEL_CANDIDATE_LIMIT) break;
        for (let step = 0; step < 16; step++) {
          const angle = (step * Math.PI * 2) / 16;
          const dx = Math.cos(angle) * radius;
          const dy = Math.sin(angle) * radius;
          for (const [baseX, baseY] of candidates.slice(0, 4)) {
            candidates.push([baseX + dx, baseY + dy]);
          }
        }
      }
      if (!rect)
        candidates.sort((a, b) => {
          const da =
            (a[0] + size.width / 2 - point.x) ** 2 +
            (a[1] + size.height / 2 - point.y) ** 2;
          const db =
            (b[0] + size.width / 2 - point.x) ** 2 +
            (b[1] + size.height / 2 - point.y) ** 2;
          return da - db || a[0] - b[0] || a[1] - b[1];
        });
      for (const [x0, y0] of candidates) {
        const x = clamp(x0, left, Math.max(left, right - size.width));
        const y = clamp(y0, top, Math.max(top, bottom - size.height));
        if (rect && (Math.abs(x - x0) > 1 || Math.abs(y - y0) > 1)) continue;
        const candidateRect = { x, y, width: size.width, height: size.height };
        const overlapsLabel = used.some(
          (other) =>
            x < other.x + other.width + (rect ? 12 : 6) &&
            x + size.width + (rect ? 12 : 6) > other.x &&
            y < other.y + other.height + (rect ? 12 : 6) &&
            y + size.height + (rect ? 12 : 6) > other.y,
        );
        const overlapsOwnSphere =
          y < point.y + point.radius + ownGap &&
          y + size.height > point.y - point.radius - ownGap &&
          x < point.x + point.radius + ownGap &&
          x + size.width > point.x - point.radius - ownGap;
        const overlapsSphere = placed.some((other) => {
          if (rect && other === point) return false;
          const exclusion = other.radius + (other.kind === 'root' ? 32 : 12);
          const dx = Math.max(x - other.x, 0, other.x - x - size.width);
          const dy = Math.max(y - other.y, 0, other.y - y - size.height);
          return dx * dx + dy * dy < exclusion * exclusion;
        });
        if (
          !overlapsLabel &&
          !overlapsSphere &&
          (!rect || !overlapsOwnSphere)
        ) {
          labelRects[index] = candidateRect;
          used.push(candidateRect);
          break;
        }
      }
      if (point.kind === 'root' && !labelRects[index]) {
        const x = clamp(
          point.x - size.width / 2,
          left,
          Math.max(left, right - size.width),
        );
        const y = clamp(
          point.y + point.radius + ownGap,
          top,
          Math.max(top, bottom - size.height),
        );
        const rect = { x, y, width: size.width, height: size.height };
        labelRects[index] = rect;
        used.push(rect);
      }
    }
  }
  const nodes: SceneNode[] = labeled.map((point, index) => ({
    ...point,
    labelRect: labelRects[index],
  }));
  const placedById = new Map(nodes.map((point) => [point.node.id, point]));
  const tethers: SceneTether[] = rect
    ? nodes.flatMap((point) => {
        const ownerId = owningChild(point.node);
        const owner = ownerId ? placedById.get(ownerId) : undefined;
        return owner && point.node.parentId === owner.node.id
          ? [
              {
                fromId: point.node.id,
                toId: owner.node.id,
                fromX: point.x,
                fromY: point.y,
                toX: owner.x,
                toY: owner.y,
              },
            ]
          : [];
      })
    : [];
  return {
    nodes,
    orbitCount: orbitNodes.length,
    ...(rect ? { tethers } : {}),
    overflowCompleted,
    overflowOther,
    overflowChip:
      overflowCompleted || overflowOther
        ? {
            text: [
              overflowCompleted ? `+${overflowCompleted} completed` : '',
              overflowOther ? `+${overflowOther} more` : '',
            ]
              .filter(Boolean)
              .join(' · '),
            x: viewport.width - 100,
            y: viewport.height - 50,
          }
        : null,
  };
}
