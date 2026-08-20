/**
 * TerminalPlayer — renders a recorded TUI session as real text.
 *
 * Deliberately dumb. All terminal emulation happened once, offline, in
 * `scripts/tui-frames.mjs`; what arrives here is a plain array of per-frame
 * screen grids. That matters because Remotion renders frames out of order and
 * in parallel across browser tabs, and a live emulator is stateful — driving
 * xterm inside the composition would paint a different picture depending on
 * which tab got which frame. This component holds no state at all: frame N is a
 * pure array lookup.
 *
 * Text is rendered as text, not as pixels scaled from a screen capture, so the
 * output is crisp at any resolution and the font/palette can change without
 * re-recording.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { MONO_FAMILY } from '../concept/story-kit';

/** One styled run of characters inside a row. */
export interface TuiRun {
  /** Text. */
  t: string;
  /** Foreground CSS colour. */
  fg: string;
  /** Background CSS colour, or `transparent`. */
  bg: string;
  /** Bold flag (1/0). */
  b: number;
  /** Dim flag (1/0). */
  d: number;
}

/** A frame either carries its own grid, or points back at an identical earlier one. */
export type TuiFrame = { g: TuiRun[][] } | { r: number };

export interface TuiFramesData {
  cols: number;
  rows: number;
  fps: number;
  frameCount: number;
  durationMs: number;
  frames: TuiFrame[];
}

/** Resolve a frame through the dedupe back-reference chain. */
function gridAt(data: TuiFramesData, index: number): TuiRun[][] {
  const clamped = Math.max(0, Math.min(data.frames.length - 1, index));
  const frame = data.frames[clamped];
  if (!frame) return [];
  if ('g' in frame) return frame.g;
  const target = data.frames[frame.r];
  return target && 'g' in target ? target.g : [];
}

export const TerminalPlayer: React.FC<{
  data: TuiFramesData;
  /** Where to start inside the recording. */
  startFromMs?: number;
  /** Fraction of frame width the terminal body may occupy. */
  fill?: number;
}> = ({ data, startFromMs = 0, fill = 0.84 }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // The recording was gridded at its own fps; map composition time onto it so a
  // mismatch degrades to a resample rather than to the wrong speed.
  const tMs = (frame / fps) * 1000 + startFromMs;
  const grid = gridAt(data, Math.round((tMs / 1000) * data.fps));

  // Size from BOTH axes and take the tighter constraint, so a tall recording
  // (many rows) shrinks to fit instead of overflowing the frame.
  const LINE_HEIGHT = 1.34;
  // Monospace advance is ~0.6em for JetBrains Mono; this is what keeps columns
  // aligned without measuring text at render time.
  const ADVANCE = 0.6;
  const byWidth = (width * fill) / data.cols / ADVANCE;
  const byHeight = (height * 0.78) / data.rows / LINE_HEIGHT;
  const fontSize = Math.floor(Math.min(byWidth, byHeight));

  const bodyW = Math.ceil(data.cols * fontSize * ADVANCE);
  const bodyH = Math.ceil(data.rows * fontSize * LINE_HEIGHT);
  const pad = Math.round(fontSize * 1.1);
  const chrome = Math.round(fontSize * 1.9);

  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          width: bodyW + pad * 2,
          borderRadius: Math.round(fontSize * 0.6),
          overflow: 'hidden',
          background: '#0b0d11',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.72)',
        }}
      >
        <div
          style={{
            height: chrome,
            background: '#14171d',
            display: 'flex',
            alignItems: 'center',
            gap: chrome * 0.26,
            paddingLeft: chrome * 0.44,
            flexShrink: 0,
          }}
        >
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span
              key={c}
              style={{ width: chrome * 0.28, height: chrome * 0.28, borderRadius: '50%', background: c }}
            />
          ))}
          <span
            style={{
              marginLeft: 'auto',
              marginRight: chrome * 0.6,
              color: 'rgba(255,255,255,0.42)',
              fontFamily: MONO_FAMILY,
              fontSize: chrome * 0.32,
            }}
          >
            ptah tui
          </span>
        </div>

        <div
          style={{
            padding: pad,
            height: bodyH + pad * 2,
            fontFamily: MONO_FAMILY,
            fontSize,
            lineHeight: `${Math.round(fontSize * LINE_HEIGHT)}px`,
            // `pre` keeps the emulator's own spacing verbatim — the grid already
            // encodes every space, so any collapsing would break alignment.
            whiteSpace: 'pre',
            letterSpacing: 0,
          }}
        >
          {grid.map((runs, y) => (
            <div key={y} style={{ height: Math.round(fontSize * LINE_HEIGHT) }}>
              {runs.map((run, i) => (
                <span
                  key={i}
                  style={{
                    color: run.fg,
                    background: run.bg === 'transparent' ? undefined : run.bg,
                    fontWeight: run.b ? 700 : 400,
                    opacity: run.d ? 0.6 : 1,
                  }}
                >
                  {run.t}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
