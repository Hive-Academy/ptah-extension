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
  context.lineWidth = 1;
  const axes = [
    orbitRadii(sceneRect, true, true),
    orbitRadii(sceneRect, false, false),
    orbitRadii(sceneRect, true, false),
  ];
  for (const { rx, ry } of axes) {
    context.beginPath();
    context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    context.stroke();
  }
}
