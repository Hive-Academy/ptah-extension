import { orbitRadii, type SceneRect } from './scene-layout';

const dots = Array.from({ length: 48 }, (_, index) => ({
  x: ((index * 73) % 97) / 97,
  y: ((index * 41) % 89) / 89,
  size: index % 5 === 0 ? 1.5 : 0.8,
}));

/** Paint the static panel field into the renderer's theme and size cache. */
export function drawSceneDecoration(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: 'light' | 'dark',
  sceneRect: SceneRect,
  orbitCount: number,
): void {
  const cx = sceneRect.x + sceneRect.width / 2;
  const cy = sceneRect.y + sceneRect.height / 2;
  const edge = context.createRadialGradient(
    cx,
    cy,
    Math.min(width, height) * 0.28,
    cx,
    cy,
    Math.hypot(width, height) * 0.58,
  );
  edge.addColorStop(0, 'transparent');
  edge.addColorStop(1, theme === 'dark' ? '#40384f' : '#b6aaa4');
  context.globalAlpha = theme === 'dark' ? 0.24 : 0.18;
  context.fillStyle = edge;
  context.fillRect(0, 0, width, height);

  context.fillStyle = theme === 'dark' ? '#9d93ae' : '#625d73';
  context.globalAlpha = 0.18;
  for (const dot of dots)
    context.fillRect(dot.x * width, dot.y * height, dot.size, dot.size);
  context.globalAlpha = 1;
  context.strokeStyle = theme === 'dark' ? '#504b68' : '#aaa1b1';
  context.globalAlpha = orbitCount === 0 ? 0.24 : 0.38;
  context.lineWidth = 1;
  const axes =
    orbitCount > 8
      ? [orbitRadii(sceneRect, true, true), orbitRadii(sceneRect, true, false)]
      : [orbitRadii(sceneRect, false, false)];
  for (const { rx, ry } of axes) {
    context.beginPath();
    context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
}

/** A soft field behind the root sprite, sized by the live voice level. */
export function drawRootGlow(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  rootRadius: number,
  level: number,
  theme: 'light' | 'dark',
  reducedMotion: boolean,
): void {
  const safeLevel = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const radius =
    rootRadius *
    1.9 *
    (reducedMotion ? 1 : 1 + safeLevel * 0.25);
  const glow = context.createRadialGradient(
    x,
    y,
    rootRadius * 0.55,
    x,
    y,
    radius,
  );
  glow.addColorStop(
    0,
    theme === 'dark' ? 'rgba(238,178,77,0.3)' : 'rgba(211,140,42,0.22)',
  );
  glow.addColorStop(1, 'rgba(238,178,77,0)');
  context.fillStyle = glow;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}
