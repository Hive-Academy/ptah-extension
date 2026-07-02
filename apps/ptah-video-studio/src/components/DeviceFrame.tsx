/**
 * DeviceFrame — the recording presented as a floating "app window" plus a
 * virtual camera.
 *
 * Jobs:
 *  1. Framing fix — sizes the card to the detected CONTENT region and clips the
 *     capture's bottom padding band away.
 *  2. Production value — rounded corners, hairline border, deep soft shadow.
 *  3. MOTION — a virtual camera zooms/pans between the scene's shots (eased),
 *     turning the static screen capture into punch-ins on the active UI region.
 *     A highlight ring can outline the focused region and moves WITH the camera.
 *  4. MOTION BLUR — during fast camera moves the footage layer is blurred in
 *     proportion to camera velocity (subtle, capped), zeroing out once settled.
 *  5. SUPERSAMPLING — when capture res exceeds output res the camera may punch
 *     in past the nominal 2.4× and still resolve real pixels (dynamicMaxScale).
 *
 * Camera + ring live inside one transformed stage so they stay locked to the
 * pixels they annotate. Content point (u,v) in 0..1 maps to (u*cardW, v*cardH).
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
  dynamicMaxScale,
  focusAt,
  focusToTransform,
  type FocusRect,
  type Shot,
} from '../lib/shots';

export interface SourceInfo {
  width: number;
  height: number;
  /** Rows of real UI content from the top; the rest is padding to be clipped. */
  contentHeight: number;
}

export interface DeviceFrameProps {
  src: string;
  source: SourceInfo;
  shots?: Shot[];
  kenBurns?: boolean;
  /**
   * True when capture footage is higher-res than the output composition, so the
   * camera is allowed to push past the nominal 2.4× (see dynamicMaxScale). The
   * output composition height is `useVideoConfig().height`; capture height is
   * `source.height`.
   */
  supersample?: boolean;
}

/** Peak motion-blur radius (px) at maximum normalized camera velocity. */
const MAX_MOTION_BLUR_PX = 8;

const Ring: React.FC<{
  rect: FocusRect;
  cardW: number;
  cardH: number;
  camScale: number;
  localFrame: number;
  fps: number;
}> = ({ rect, cardW, cardH, camScale, localFrame, fps }) => {
  const appear = interpolate(localFrame, [0, fps * 0.3], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Counter-scale the border so it stays a crisp ~3px regardless of zoom.
  const border = 3 / camScale;
  const pad = 8 / camScale;
  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x * cardW - pad,
        top: rect.y * cardH - pad,
        width: rect.w * cardW + pad * 2,
        height: rect.h * cardH + pad * 2,
        border: `${border}px solid ${THEME.amber}`,
        borderRadius: 14 / camScale,
        boxShadow: `0 0 ${24 / camScale}px rgba(245,181,68,0.55)`,
        opacity: appear * 0.95,
      }}
    />
  );
};

export const DeviceFrame: React.FC<DeviceFrameProps> = ({
  src,
  source,
  shots = [],
  kenBurns = true,
  supersample = false,
}) => {
  const frame = useCurrentFrame();
  const { width: compW, height: compH, fps, durationInFrames } =
    useVideoConfig();

  const { width: sw, height: sh, contentHeight } = source;
  const contentRatio = Math.min(1, contentHeight / sh);

  const margin = compW * 0.045;
  let cardW = compW - margin * 2;
  let cardH = (cardW * (sh * contentRatio)) / sw;
  const maxCardH = compH * 0.78;
  if (cardH > maxCardH) {
    cardH = maxCardH;
    cardW = (cardH * sw) / (sh * contentRatio);
  }
  const videoDispH = (cardW * sh) / sw;

  const nowMs = (frame / fps) * 1000;
  const hasShots = shots.length > 0;

  // With supersampled footage, allow the camera to punch in past 2.4× — the
  // extra source pixels keep the close-up crisp. Otherwise stay at the default.
  const maxScale = supersample
    ? dynamicMaxScale(sh, compH)
    : undefined; /* focusToTransform default (2.4) */

  // Camera: shot-driven zoom/pan, or a gentle idle Ken Burns when no shots.
  const f = focusAt(shots, nowMs);
  const cam = focusToTransform(f, cardW, cardH, maxScale);
  const idle =
    !hasShots && kenBurns
      ? interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      : 1;
  const scale = cam.scale * idle;

  // Motion blur: proportional to camera velocity (one-frame finite diff),
  // subtle and capped, zero once the move has settled. CSS blur is
  // omnidirectional — acceptable per the roadmap; scaled by normalized speed.
  const velocity = hasShots ? cameraVelocity(shots, nowMs, 1000 / fps) : 0;
  const blurPx = velocity * MAX_MOTION_BLUR_PX;
  const footageFilter = blurPx > 0.15 ? `blur(${blurPx.toFixed(2)}px)` : 'none';

  const active = activeShot(shots, nowMs);
  const localFrame = active ? frame - (active.fromMs / 1000) * fps : 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: cardW,
          height: cardH,
          overflow: 'hidden',
          borderRadius: Math.round(compW * 0.014),
          border: '1px solid rgba(255,255,255,0.09)',
          boxShadow:
            '0 50px 130px rgba(0,0,0,0.62), 0 12px 34px rgba(0,0,0,0.55), 0 0 0 1px rgba(245,181,68,0.05)',
          background: THEME.bg,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: cardW,
            height: videoDispH,
            transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <OffthreadVideo
            src={src}
            style={{
              width: cardW,
              height: videoDispH,
              display: 'block',
              filter: footageFilter,
              // Nudge the browser to composite the blur on its own layer so the
              // filter doesn't jitter the ring/annotations sharing this stage.
              willChange: footageFilter === 'none' ? undefined : 'filter',
            }}
          />
          {active?.ring ? (
            <Ring
              rect={active.ring}
              cardW={cardW}
              cardH={cardH}
              camScale={scale}
              localFrame={localFrame}
              fps={fps}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
