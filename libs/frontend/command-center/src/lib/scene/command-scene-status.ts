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
      ? time * 0.0017
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
  if (node.kind === 'tribunal' && node.phases.length) {
    const done = node.phases.filter(
      (phase) => phase.state === 'completed',
    ).length;
    context.lineWidth = 3;
    context.beginPath();
    context.arc(
      node.x,
      node.y,
      node.radius + 12,
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI * 2 * done) / node.phases.length,
    );
    context.stroke();
  }
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
  if (voice === 'speaking' && !snapshot.reducedMotion) {
    const level = Math.max(0, Math.min(1, voiceSnapshot.outputLevel));
    context.strokeStyle = snapshot.inks.need;
    context.lineWidth = 1.5;
    for (let index = 0; index < 2; index++) {
      const progress = (time * 0.00045 + index * 0.5) % 1;
      context.globalAlpha = (1 - progress) * (0.08 + level * 0.18);
      context.beginPath();
      context.arc(
        node.x,
        node.y,
        node.radius + 20 + progress * 34,
        0,
        Math.PI * 2,
      );
      context.stroke();
    }
    context.globalAlpha = 1;
  }
}
