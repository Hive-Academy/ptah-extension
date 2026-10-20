import type { SceneInks } from './command-scene-renderer';
import type { SceneLayout, SceneNode, SceneTether } from './scene-layout';

const TRAVEL_MS = 720;
const RING_MS = 520;
const PULSE_LIFE_MS = TRAVEL_MS + RING_MS;
const MAX_PULSES = 6;
const MAX_PENDING = 12;
const MAX_TRACKED_STATES = 512;

interface LinkPath {
  kind: 'bezier' | 'line';
  ox: number;
  oy: number;
  wx: number;
  wy: number;
  workerRadius: number;
}

interface Pulse {
  childId: string;
  born: number;
}

function linkFor(
  worker: SceneNode,
  owner: SceneNode,
  tetherByFrom: ReadonlyMap<string, SceneTether[]>,
): LinkPath | null {
  const workerTethers = tetherByFrom.get(worker.node.id);
  const tether = workerTethers?.find((item) => item.toId === owner.node.id);
  if (tether) {
    return {
      kind: 'line',
      ox: tether.toX,
      oy: tether.toY,
      wx: tether.fromX,
      wy: tether.fromY,
      workerRadius: worker.radius,
    };
  }
  if (workerTethers) return null;
  return {
    kind: 'bezier',
    ox: owner.x,
    oy: owner.y,
    wx: worker.x,
    wy: worker.y,
    workerRadius: worker.radius,
  };
}

function pointOn(path: LinkPath, t: number): { x: number; y: number } {
  if (path.kind === 'line')
    return {
      x: path.ox + (path.wx - path.ox) * t,
      y: path.oy + (path.wy - path.oy) * t,
    };
  const inverse = 1 - t;
  const midY = (path.oy + path.wy) / 2;
  return {
    x:
      inverse ** 3 * path.ox +
      3 * inverse ** 2 * t * path.ox +
      3 * inverse * t ** 2 * path.wx +
      t ** 3 * path.wx,
    y:
      inverse ** 3 * path.oy +
      3 * inverse ** 2 * t * midY +
      3 * inverse * t ** 2 * midY +
      t ** 3 * path.wy,
  };
}

export class DelegationPulseEmitter {
  private pulses: Pulse[] = [];
  private pending: string[] = [];
  private readonly lastStates = new Map<string, string>();
  private readonly links = new Map<string, LinkPath>();
  private seeded = false;
  private lastUpdate = Number.NEGATIVE_INFINITY;

  public get count(): number {
    return this.pulses.length;
  }
  public get pendingCount(): number {
    return this.pending.length;
  }

  public observe(layout: SceneLayout, silent: boolean): void {
    this.links.clear();
    const nodes = new Map(layout.nodes.map((node) => [node.node.id, node]));
    const tetherByFrom = new Map<string, SceneTether[]>();
    for (const tether of layout.tethers ?? []) {
      const fromTethers = tetherByFrom.get(tether.fromId) ?? [];
      fromTethers.push(tether);
      tetherByFrom.set(tether.fromId, fromTethers);
    }
    for (const worker of layout.nodes) {
      const owner = worker.node.parentId
        ? nodes.get(worker.node.parentId)
        : undefined;
      if (!owner) continue;
      const path = linkFor(worker, owner, tetherByFrom);
      if (path) this.links.set(worker.node.id, path);
    }
    this.pulses = this.pulses.filter((pulse) => this.links.has(pulse.childId));
    this.pending = this.pending.filter((id) => this.links.has(id));
    for (const worker of layout.nodes) {
      const id = worker.node.id;
      if (!this.links.has(id)) continue;
      const state = worker.node.state;
      const previous = this.lastStates.get(id);
      const live = state === 'starting' || state === 'running';
      const previousLive = previous === 'starting' || previous === 'running';
      if (
        this.seeded &&
        !silent &&
        live &&
        !previousLive &&
        !this.pending.includes(id)
      ) {
        this.pending.push(id);
        if (this.pending.length > MAX_PENDING) this.pending.shift();
      }
      this.lastStates.delete(id);
      this.lastStates.set(id, state);
      if (this.lastStates.size > MAX_TRACKED_STATES) {
        const oldest = this.lastStates.keys().next().value;
        if (oldest !== undefined) this.lastStates.delete(oldest);
      }
    }
    this.seeded = true;
  }

  public update(now: number): void {
    if (now < this.lastUpdate) this.pulses = [];
    this.pulses = this.pulses.filter(
      (pulse) => now - pulse.born < PULSE_LIFE_MS,
    );
    if (this.pulses.length < MAX_PULSES) {
      const next = this.pending.findIndex(
        (id) =>
          this.links.has(id) &&
          !this.pulses.some((pulse) => pulse.childId === id),
      );
      if (next >= 0) {
        const [childId] = this.pending.splice(next, 1);
        if (childId !== undefined) this.pulses.push({ childId, born: now });
      }
    }
    this.lastUpdate = now;
  }

  public draw(
    context: CanvasRenderingContext2D,
    now: number,
    inks: SceneInks,
  ): void {
    context.save();
    context.setLineDash([]);
    context.fillStyle = inks.run;
    context.strokeStyle = inks.run;
    for (const pulse of this.pulses) {
      const path = this.links.get(pulse.childId);
      if (!path) continue;
      const age = now - pulse.born;
      if (age < 0 || age >= PULSE_LIFE_MS) continue;
      if (age < TRAVEL_MS) {
        const progress = age / TRAVEL_MS;
        const t =
          progress < 0.5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2;
        const head = pointOn(path, t);
        context.globalAlpha = 0.22;
        context.beginPath();
        context.arc(head.x, head.y, 7, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha = 0.95;
        context.beginPath();
        context.arc(head.x, head.y, 2.6, 0, Math.PI * 2);
        context.fill();
        for (let k = 1; k <= 3; k++) {
          const tail = pointOn(path, Math.max(0, t - 0.04 * k));
          context.globalAlpha = [0.5, 0.3, 0.15][k - 1];
          context.beginPath();
          context.arc(tail.x, tail.y, 1.6, 0, Math.PI * 2);
          context.fill();
        }
      } else {
        const progress = (age - TRAVEL_MS) / RING_MS;
        context.globalAlpha = 0.6 * (1 - progress) ** 1.5;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(
          path.wx,
          path.wy,
          path.workerRadius + 13 + 16 * (1 - (1 - progress) ** 2),
          0,
          Math.PI * 2,
        );
        context.stroke();
      }
    }
    context.restore();
  }

  public clear(): void {
    this.pulses = [];
    this.pending = [];
    this.lastStates.clear();
    this.links.clear();
    this.seeded = false;
    this.lastUpdate = Number.NEGATIVE_INFINITY;
  }
}
