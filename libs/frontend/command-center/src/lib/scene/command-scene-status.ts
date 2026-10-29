import type { SceneNode } from './scene-layout';
import type {
  SceneRenderSnapshot,
  SceneVoiceSnapshot,
} from './command-scene-renderer';

export function drawStatus(
  context: CanvasRenderingContext2D,
  node: SceneNode,
  time: number,
  snapshot: SceneRenderSnapshot,
): void {
  if (node.kind === 'root') return;
  const state = node.node.state;
  context.strokeStyle =
    state === 'failed'
      ? snapshot.inks.err
      : state === 'awaiting input'
        ? snapshot.inks.need
        : state === 'completed'
          ? snapshot.inks.done
          : state === 'running' || state === 'starting'
            ? snapshot.inks.run
            : snapshot.inks.idle;
  context.lineWidth = 2.5;
  if (state === 'queued') context.setLineDash([3, 6]);
  context.beginPath();
  const angle =
    state === 'running' && !snapshot.reducedMotion
      ? time * RUNNING_RING_RAD_PER_MS
      : -Math.PI / 2;
  context.arc(
    node.x,
    node.y,
    node.radius + 6,
    angle,
    angle + (state === 'running' ? 2.25 : Math.PI * 2),
  );
  context.stroke();
  context.setLineDash([]);
  if (state === 'running' && node.node.startedAt !== undefined) {
    const elapsed = Math.min(
      1,
      Math.max(
        0,
        Math.max(0, performance.timeOrigin + time - node.node.startedAt) /
          300_000,
      ),
    );
    if (elapsed > 0) {
      context.strokeStyle = snapshot.inks.run;
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(
        node.x,
        node.y,
        node.radius + 10,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * elapsed,
      );
      context.stroke();
    }
  }
  if (state === 'awaiting input') {
    context.fillStyle = snapshot.inks.need;
    context.beginPath();
    context.moveTo(node.x + node.radius + 12, node.y - 5);
    context.lineTo(node.x + node.radius + 18, node.y);
    context.lineTo(node.x + node.radius + 12, node.y + 5);
    context.lineTo(node.x + node.radius + 6, node.y);
    context.fill();
  } else if (
    state === 'completed' ||
    state === 'failed' ||
    state === 'cancelled'
  ) {
    const x = node.x + node.radius + 8;
    const y = node.y;
    context.beginPath();
    if (state === 'completed') {
      context.moveTo(x - 5, y);
      context.lineTo(x - 1, y + 4);
      context.lineTo(x + 6, y - 5);
    } else if (state === 'failed') {
      context.moveTo(x - 5, y - 5);
      context.lineTo(x + 5, y + 5);
      context.moveTo(x + 5, y - 5);
      context.lineTo(x - 5, y + 5);
    } else {
      context.moveTo(x - 5, y + 5);
      context.lineTo(x + 5, y - 5);
    }
    context.stroke();
  }
}

/** Running ring: 0.15 turn per second. */
export const RUNNING_RING_RAD_PER_MS = (0.15 * Math.PI * 2) / 1000;
const BREATH_PERIOD_MS = 2400;
const BREATH_DEPTH = 0.04;
const WAITING_PERIOD_MS = 1600;
/** Up to this many running nodes breathe at full depth. */
export const BREATHING_NODE_LIMIT = 8;
/** From the limit to this count the depth ramps down to zero; above it nodes hold still. */
export const BREATHING_NODE_STILL = 16;

/** Breathing depth share for `runningCount` running nodes: 1 up to the limit, 0 at the still count. */
export function breathingDepthFactor(runningCount: number): number {
  if (runningCount <= BREATHING_NODE_LIMIT) return 1;
  if (runningCount >= BREATHING_NODE_STILL) return 0;
  return (
    (BREATHING_NODE_STILL - runningCount) /
    (BREATHING_NODE_STILL - BREATHING_NODE_LIMIT)
  );
}

/**
 * Sprite scale for a running delegate: 1.00 to 1.04 and back every 2.4s.
 * Static under reduced motion and for the root. Past eight running nodes the
 * depth shrinks with each extra node, so the stage calms instead of snapping still.
 */
export function breathScale(
  node: SceneNode,
  time: number,
  snapshot: SceneRenderSnapshot,
  runningCount: number,
): number {
  if (
    snapshot.reducedMotion ||
    node.kind === 'root' ||
    node.node.state !== 'running'
  )
    return 1;
  const depth = BREATH_DEPTH * breathingDepthFactor(runningCount);
  if (depth === 0) return 1;
  const phase = (time % BREATH_PERIOD_MS) / BREATH_PERIOD_MS;
  return 1 + (depth * (1 - Math.cos(phase * Math.PI * 2))) / 2;
}

/** Halo alpha for a node waiting on input: 0.15 to 0.35 over 1.6s, fixed 0.3 when reduced. */
export function waitingHaloAlpha(time: number, reducedMotion: boolean): number {
  if (reducedMotion) return 0.3;
  const phase = (time % WAITING_PERIOD_MS) / WAITING_PERIOD_MS;
  return 0.15 + (0.2 * (1 - Math.cos(phase * Math.PI * 2))) / 2;
}

/** Soft amber halo drawn under the sprite of a delegate that waits on input. */
export function drawWaitingHalo(
  context: CanvasRenderingContext2D,
  node: SceneNode,
  time: number,
  snapshot: SceneRenderSnapshot,
): void {
  if (node.kind === 'root' || node.node.state !== 'awaiting input') return;
  context.globalAlpha = waitingHaloAlpha(time, snapshot.reducedMotion);
  context.fillStyle = snapshot.inks.need;
  context.beginPath();
  context.arc(node.x, node.y, node.radius + 10, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
}

export function drawVoiceRing(
  context: CanvasRenderingContext2D,
  voiceSnapshot: SceneVoiceSnapshot,
  node: SceneNode,
  time: number,
  snapshot: SceneRenderSnapshot,
): void {
  const voice = voiceSnapshot.voiceState;
  context.strokeStyle =
    voice === 'error'
      ? snapshot.inks.err
      : voice === 'muted' || voice === 'stopped'
        ? snapshot.inks.idle
        : voice === 'listening'
          ? snapshot.inks.done
          : voice === 'thinking'
            ? snapshot.inks.run
            : voice === 'speaking'
              ? snapshot.inks.need
              : snapshot.inks.idle;
  context.lineWidth = 3;
  context.setLineDash(
    voice === 'muted'
      ? [6, 8]
      : voice === 'speaking' || voice === 'error'
        ? [17, 7]
        : [],
  );
  const pulse = snapshot.reducedMotion
    ? 0
    : voice === 'listening'
      ? Math.max(0, Math.min(1, voiceSnapshot.inputLevel)) * 4
      : voice === 'speaking'
        ? Math.max(0, Math.min(1, voiceSnapshot.outputLevel)) * 4
        : 0;
  const angle =
    voice === 'thinking' && !snapshot.reducedMotion
      ? time * 0.0017
      : -Math.PI / 2;
  context.beginPath();
  context.arc(
    node.x,
    node.y,
    node.radius + 16 + pulse,
    angle,
    angle + (voice === 'thinking' ? 2.25 : Math.PI * 2),
  );
  context.stroke();
  context.setLineDash([]);
}
