/**
 * IntroCard — branded title card shown before the recording.
 *
 * Transparent base (the global <Backdrop> shows through, so the cut into the
 * body reads as a crossfade). A row of pulsing "agent" dots nods to the
 * multi-agent theme; the title springs up and an amber accent line draws in.
 */
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';

export interface IntroCardProps {
  title: string;
  subtitle?: string;
  videoHeight: number;
}

const AgentDots: React.FC<{ size: number }> = ({ size }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = [THEME.amber, THEME.indigo, '#14b8a6', THEME.amberDeep];
  return (
    <div
      style={{
        display: 'flex',
        gap: size * 0.9,
        marginBottom: size * 1.6,
        alignItems: 'flex-end',
        height: size * 3.2,
      }}
    >
      {colors.map((c, i) => {
        const phase = (frame / fps) * 2 + i * 0.6;
        const h = size * (1.1 + Math.sin(phase) * 0.9 + 0.9);
        const appear = spring({
          frame: frame - i * 4,
          fps,
          config: { damping: 14 },
        });
        return (
          <div
            key={i}
            style={{
              width: size,
              height: h,
              borderRadius: size,
              background: c,
              opacity: 0.55 * appear + 0.35,
              boxShadow: `0 0 ${size}px ${c}`,
              transform: `scaleY(${appear})`,
              transformOrigin: 'bottom',
            }}
          />
        );
      })}
    </div>
  );
};

export const IntroCard: React.FC<IntroCardProps> = ({
  title,
  subtitle,
  videoHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({
    frame: frame - 6,
    fps,
    config: { damping: 20, mass: 0.6 },
  });
  const y = interpolate(enter, [0, 1], [34, 0]);
  const titleSize = Math.round(videoHeight * 0.078);
  const subSize = Math.round(videoHeight * 0.028);
  const underline = interpolate(
    spring({ frame: frame - 14, fps, config: { damping: 22 } }),
    [0, 1],
    [0, titleSize * 6],
  );

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: THEME.textStrong,
        fontFamily: THEME.font,
      }}
    >
      <AgentDots size={Math.round(videoHeight * 0.014)} />
      <div
        style={{
          opacity: enter,
          transform: `translateY(${y}px)`,
          textAlign: 'center',
          padding: '0 8%',
        }}
      >
        <div
          style={{ fontSize: titleSize, fontWeight: 800, letterSpacing: -1.5 }}
        >
          {title}
        </div>
        <div
          style={{
            height: Math.max(3, Math.round(videoHeight * 0.005)),
            width: underline,
            maxWidth: '80%',
            margin: `${titleSize * 0.28}px auto 0`,
            borderRadius: 99,
            background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
            boxShadow: `0 0 18px ${THEME.amberDeep}`,
          }}
        />
        {subtitle ? (
          <div
            style={{
              marginTop: titleSize * 0.34,
              fontSize: subSize,
              fontWeight: 500,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: THEME.textSoft,
            }}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
};
