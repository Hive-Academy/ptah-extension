import { SCENE_DOTS } from './command-scene-decoration';

const TWINKLE_DOTS = SCENE_DOTS.filter((_, index) => index % 4 === 1).map(
  (dot, index) => ({
    ...dot,
    period: 3600 + ((index * 577) % 3000),
    phase: (index * 0.618) % 1,
  }),
);

export function drawBackdropTwinkle(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: 'light' | 'dark',
  time: number,
): void {
  if (!Number.isFinite(time) || width < 1 || height < 1) return;
  context.save();
  context.fillStyle = theme === 'dark' ? '#9d93ae' : '#625d73';
  const peak = theme === 'dark' ? 0.55 : 0.4;
  for (const dot of TWINKLE_DOTS) {
    const brightness =
      Math.max(0, Math.sin(2 * Math.PI * (time / dot.period + dot.phase))) ** 4;
    if (brightness < 0.02) continue;
    context.globalAlpha = brightness * peak;
    context.fillRect(
      dot.x * width - 0.4,
      dot.y * height - 0.4,
      dot.size + 0.8,
      dot.size + 0.8,
    );
  }
  context.restore();
}
