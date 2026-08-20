/**
 * Shared metadata helper for the self-shot compositions.
 *
 * Body + optional end card, at the props' fps. Used by Root's calculateMetadata
 * for all three compositions so width/height/fps/duration flow from the resolved
 * props exactly like ShowcaseVideo's calculateMetadata. The body→end-card fade
 * (reused from @remotion/transitions in <SelfShotShell>) overlaps both
 * sequences, so the overlap is subtracted from the total once when an end card
 * is present.
 */
import { END_TRANSITION_FRAMES } from './constants';
import type { ResolvedSelfShotProps } from './resolved';

export function totalSelfShotFrames(props: ResolvedSelfShotProps): number {
  const fps = props.fps || 30;
  const bodyFrames = Math.max(1, Math.round((props.bodyMs / 1000) * fps));
  const endMs = props.endCard?.durationMs ?? 0;
  const endFrames = endMs > 0 ? Math.round((endMs / 1000) * fps) : 0;
  if (endFrames <= 0) return bodyFrames;
  const overlap = Math.min(
    END_TRANSITION_FRAMES,
    bodyFrames - 1,
    endFrames - 1,
  );
  return bodyFrames + endFrames - Math.max(0, overlap);
}
