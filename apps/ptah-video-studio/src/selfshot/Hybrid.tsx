/**
 * Hybrid — a layout STATE MACHINE driven by the beats manifest.
 *
 * `layout-switch` beats were resolved upstream to `props.layouts` (absolute ms +
 * state). Four states: 'camera-full' | 'screen-full-with-bubble' | 'side-by-side'
 * | 'screen-only'. The camera and screen videos are BOTH mounted continuously
 * (one persistent OffthreadVideo each) and their geometry (position/size/corner-
 * radius/opacity) is eased between states over HYBRID_MORPH_FRAMES — so audio and
 * video never restart at a layout change (which a TransitionSeries swap of the
 * sources would cause). @remotion/transitions is still reused for the body→end-
 * card fade in <SelfShotShell>. Captions / overlays / end card come from the shell.
 */
import React from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';
import { SelfShotShell, resolveSrc } from './Shell';
import { HYBRID_MORPH_FRAMES } from './constants';
import type { LayoutState } from './manifest';
import type { ResolvedSelfShotProps } from './resolved';

interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  opacity: number;
}

const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpSlot = (a: Slot, b: Slot, t: number): Slot => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
  radius: lerp(a.radius, b.radius, t),
  opacity: lerp(a.opacity, b.opacity, t),
});

function slotsFor(
  layout: LayoutState,
  W: number,
  H: number,
  bubble: { corner?: 'tl' | 'tr' | 'bl' | 'br'; sizePct?: number } | undefined,
): { cam: Slot; scr: Slot } {
  const d = Math.round(H * (bubble?.sizePct ?? 0.24));
  const m = Math.round(H * 0.035);
  const corner = bubble?.corner ?? 'br';
  const bubbleSlot: Slot = {
    x: corner.endsWith('l') ? m : W - m - d,
    y: corner.startsWith('t') ? m : H - m - d,
    w: d,
    h: d,
    radius: d / 2,
    opacity: 1,
  };
  const full: Slot = { x: 0, y: 0, w: W, h: H, radius: 0, opacity: 1 };
  switch (layout) {
    case 'camera-full':
      return { cam: full, scr: { ...full, opacity: 0 } };
    case 'screen-only':
      return { cam: { ...bubbleSlot, opacity: 0 }, scr: full };
    case 'screen-full-with-bubble':
      return { cam: bubbleSlot, scr: full };
    case 'side-by-side':
      return {
        cam: { x: 0, y: 0, w: W / 2, h: H, radius: 0, opacity: 1 },
        scr: { x: W / 2, y: 0, w: W / 2, h: H, radius: 0, opacity: 1 },
      };
    default:
      return { cam: full, scr: { ...full, opacity: 0 } };
  }
}

const VideoSlot: React.FC<{ src: string; slot: Slot; muted: boolean; border?: boolean }> = ({
  src,
  slot,
  muted,
  border,
}) => {
  if (slot.opacity <= 0.001) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: slot.x,
        top: slot.y,
        width: slot.w,
        height: slot.h,
        opacity: slot.opacity,
        borderRadius: slot.radius,
        overflow: 'hidden',
        border: border && slot.radius > 4 ? `${Math.max(2, slot.w * 0.012)}px solid rgba(245,181,68,0.5)` : undefined,
        boxShadow: slot.radius > 4 ? '0 24px 60px rgba(0,0,0,0.6)' : undefined,
      }}
    >
      <OffthreadVideo src={src} muted={muted} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
};

const HybridStage: React.FC<ResolvedSelfShotProps> = (props) => {
  const frame = useCurrentFrame();
  const { width: W, height: H, fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  const layouts = props.layouts.length > 0 ? props.layouts : [{ atMs: 0, layout: 'camera-full' as LayoutState }];
  let idx = 0;
  for (let i = 0; i < layouts.length; i++) if (nowMs >= layouts[i].atMs) idx = i;

  const cur = slotsFor(layouts[idx].layout, W, H, props.bubble);
  let cam = cur.cam;
  let scr = cur.scr;
  if (idx > 0) {
    const prev = slotsFor(layouts[idx - 1].layout, W, H, props.bubble);
    const switchFrame = Math.round((layouts[idx].atMs / 1000) * fps);
    const t = Math.max(0, Math.min(1, (frame - switchFrame) / HYBRID_MORPH_FRAMES));
    const e = easeInOut(t);
    cam = lerpSlot(prev.cam, cur.cam, e);
    scr = lerpSlot(prev.scr, cur.scr, e);
  }

  return (
    <AbsoluteFill style={{ background: THEME.bg }}>
      {props.screenSrc ? <VideoSlot src={resolveSrc(props.screenSrc)} slot={scr} muted /> : null}
      {props.cameraSrc ? (
        <VideoSlot src={resolveSrc(props.cameraSrc)} slot={cam} muted={props.muteVideo ?? false} border />
      ) : null}
    </AbsoluteFill>
  );
};

export const Hybrid: React.FC<ResolvedSelfShotProps> = (props) => {
  const { height } = useVideoConfig();
  return (
    <SelfShotShell props={props} videoHeight={height}>
      <HybridStage {...props} />
    </SelfShotShell>
  );
};
