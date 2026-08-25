/**
 * ScreenStage — the founder's SCREEN recording, full-bleed, under the EXISTING
 * virtual-camera grammar (zoom/pan/amber ring/motion blur).
 *
 * This is the self-shot analogue of <DeviceFrame>, but the screen recording is
 * already full-frame footage (no floating "app window" card): the camera stage
 * fills the whole composition. It reuses the SAME camera math as the showcase
 * pipeline — `focusAt` / `focusToTransform` / `cameraVelocity` from lib/shots —
 * so a self-shot zoom looks identical to a showcase punch-in. Shots are resolved
 * upstream (selfshot-render.mjs) from `zoom`/`highlight` beats.
 */
import React from 'react';
import {
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { THEME } from '../theme';
import {
  activeShot,
  cameraVelocity,
  focusAt,
  focusToTransform,
  type FocusRect,
  type Shot,
} from '../lib/shots';

/** Peak motion-blur radius (px) at maximum normalized camera velocity. */
const MAX_MOTION_BLUR_PX = 8;

const Ring: React.FC<{
  rect: FocusRect;
  stageW: number;
  stageH: number;
  camScale: number;
  localFrame: number;
  fps: number;
}> = ({ rect, stageW, stageH, camScale, localFrame, fps }) => {
  const appear = interpolate(localFrame, [0, fps * 0.3], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const border = 3 / camScale;
  const pad = 8 / camScale;
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x * stageW - pad,
        top: rect.y * stageH - pad,
        width: rect.w * stageW + pad * 2,
        height: rect.h * stageH + pad * 2,
        border: `${border}px solid ${THEME.amber}`,
        borderRadius: 14 / camScale,
        boxShadow: `0 0 ${24 / camScale}px rgba(245,181,68,0.55)`,
        opacity: appear * 0.95,
      }}
    />
  );
};

export interface ScreenStageProps {
  src: string;
  shots?: Shot[];
  /** Detected/declared source geometry; contentHeight clips any padding band. */
  source?: { width: number; height: number; contentHeight: number };
  muted?: boolean;
  kenBurns?: boolean;
}

export const ScreenStage: React.FC<ScreenStageProps> = ({
  src,
  shots = [],
  source,
  muted = false,
  kenBurns = true,
}) => {
  const frame = useCurrentFrame();
  const { width: stageW, height: stageH, fps, durationInFrames } = useVideoConfig();

  const sw = source?.width ?? stageW;
  const sh = source?.height ?? stageH;
  const contentHeight = source?.contentHeight ?? sh;
  const contentRatio = Math.min(1, contentHeight / sh);

  // Cover the full stage; videoDispH is the video's displayed height at stage
  // width, used both to letterbox-cover and to clamp the camera translate.
  const videoDispH = (stageW * sh) / sw;
  const coverH = stageH / contentRatio;

  const nowMs = (frame / fps) * 1000;
  const hasShots = shots.some((s) => s.focus || s.ring);

  const f = focusAt(shots, nowMs);
  const cam = focusToTransform(f, stageW, stageH, undefined, Math.max(videoDispH, coverH));
  const idle =
    !hasShots && kenBurns
      ? interpolate(frame, [0, durationInFrames], [1.0, 1.05], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const scale = cam.scale * idle;

  const velocity = hasShots ? cameraVelocity(shots, nowMs, 1000 / fps) : 0;
  const blurPx = velocity * MAX_MOTION_BLUR_PX;
  const footageFilter = blurPx > 0.15 ? `blur(${blurPx.toFixed(2)}px)` : 'none';

  const active = activeShot(shots, nowMs);
  const localFrame = active ? frame - (active.fromMs / 1000) * fps : 0;

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: THEME.bg }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: stageW,
          height: stageH,
          transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <OffthreadVideo
          src={src}
          muted={muted}
          style={{
            width: stageW,
            height: coverH,
            objectFit: 'cover',
            display: 'block',
            filter: footageFilter,
            willChange: footageFilter === 'none' ? undefined : 'filter',
          }}
        />
        {active?.ring ? (
          <Ring
            rect={active.ring}
            stageW={stageW}
            stageH={stageH}
            camScale={scale}
            localFrame={localFrame}
            fps={fps}
          />
        ) : null}
      </div>
    </div>
  );
};
