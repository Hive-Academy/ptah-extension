/**
 * TalkingHead — the founder's camera footage, full-frame, amplified.
 *
 * The camera video fills the frame (OffthreadVideo); word-timed captions, beat
 * overlays (lower-third intro card, keyword chips, stat cards, b-roll cutaways)
 * and the branded end card are layered by <SelfShotShell>. No virtual camera —
 * the footage IS the shot; the value-add is captions + overlays + brand chrome.
 */
import React from 'react';
import { AbsoluteFill, OffthreadVideo, useVideoConfig } from 'remotion';
import { THEME } from '../theme';
import { SelfShotShell, resolveSrc } from './Shell';
import { totalSelfShotFrames } from './metadata';
import type { ResolvedSelfShotProps } from './resolved';

export const TalkingHead: React.FC<ResolvedSelfShotProps> = (props) => {
  const { height } = useVideoConfig();
  return (
    <SelfShotShell props={props} videoHeight={height}>
      <AbsoluteFill style={{ background: THEME.bg }}>
        {props.cameraSrc ? (
          <OffthreadVideo
            src={resolveSrc(props.cameraSrc)}
            muted={props.muteVideo}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : null}
      </AbsoluteFill>
    </SelfShotShell>
  );
};

export { totalSelfShotFrames };
