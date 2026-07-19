/**
 * ScreenDemo — the founder's SCREEN recording under the showcase virtual-camera
 * grammar, plus an optional circular camera bubble.
 *
 * The screen fills the frame via <ScreenStage> (reusing lib/shots zoom/pan/ring/
 * motion-blur — the SAME camera as ShowcaseVideo). Zoom + highlight beats were
 * lowered to `props.shots` upstream. When the manifest enables a bubble, the
 * founder's camera is composited as a corner circle over the demo. Captions,
 * overlays and the end card come from <SelfShotShell>.
 */
import React from 'react';
import { useVideoConfig } from 'remotion';
import { SelfShotShell, resolveSrc } from './Shell';
import { ScreenStage } from './ScreenStage';
import { CameraBubble } from './CameraBubble';
import type { ResolvedSelfShotProps } from './resolved';

export const ScreenDemo: React.FC<ResolvedSelfShotProps> = (props) => {
  const { height } = useVideoConfig();
  const bubbleEnabled = !!props.bubble && !!props.cameraSrc;
  return (
    <SelfShotShell props={props} videoHeight={height}>
      {props.screenSrc ? (
        <ScreenStage
          src={resolveSrc(props.screenSrc)}
          shots={props.shots}
          source={props.screenSource}
          muted={props.muteVideo}
        />
      ) : null}
      {bubbleEnabled ? (
        <CameraBubble
          src={resolveSrc(props.cameraSrc as string)}
          corner={props.bubble?.corner}
          sizePct={props.bubble?.sizePct}
          // Camera is video-only decoration here; audio comes from screen track
          // or the separate voice track — always mute the bubble to avoid echo.
          muted
        />
      ) : null}
    </SelfShotShell>
  );
};
