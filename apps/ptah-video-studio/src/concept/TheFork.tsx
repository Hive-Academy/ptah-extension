/**
 * TheFork — the founder's choice, and how contextless choices compound.
 *
 * Four phases hung off usePhases(durationFrames, 4), one per caption:
 *  p0  a single "repo" node FORKS into two diverging branches.
 *  p1  the fast branch — "Ship by Friday" (amber, arrow) — is emphasised; below,
 *      a clean repo node starts sprouting the first tangled red edges.
 *  p2  the alternative — "Build to last" (indigo, foundation) — is emphasised,
 *      while the fast path keeps accreting knots session after session.
 *  p3  the graph is a dense red tangle: "impossible to manage".
 *
 * Stable-container model: the fork header, the two branch cards and the lower
 * graph panel are VISUALLY STABLE frames — they settle in over the first ~10
 * frames then hold rock-steady. All life is per-element inside them: labels
 * shimmer in, branch cards spring up, and the tangle graph populates node by
 * node with edges that grow denser (compounding debt) as the session count
 * climbs. No whole-card drift/scale.
 *
 * The tangle is a deterministic seeded graph (~24 nodes on a jittered grid,
 * ~55 tangling edges) that FILLS the panel — no scattered-dots dead space.
 *
 * Fully frame-driven (useCurrentFrame + interpolate/spring/useBreath): no
 * Math.random, no timers, no CSS animation. Sized off S = min(width,height) and
 * stacks cleanly in portrait so the two-branch fork stays legible at 1080x1920.
 */
import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { THEME } from '../theme';
import type { ConceptSceneProps } from '../PromoReel';
import { CaptionRail, usePhases, useBreath } from './scene-kit';
import { BorderBeam, ShimmerSweep, Meteors } from '../components/effects';

const RED = '#ef4444';

// Tangle graph laid out in a fixed 100x52 viewBox — DETERMINISTIC, no random.
// A seeded hash (pure function of the index) jitters an even grid so the panel
// fills as a proper composed graph instead of a few scattered dots.
const seeded = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s); // 0..1, deterministic
};

type GNode = { x: number; y: number; phase: number };

/** ~24 nodes on a jittered 6x4 grid spanning the viewBox — dense enough to fill. */
function buildNodes(): GNode[] {
  const cols = 6;
  const rows = 4;
  const marginX = 8;
  const marginY = 7;
  const spanX = 100 - marginX * 2;
  const spanY = 52 - marginY * 2;
  const stepX = spanX / (cols - 1);
  const stepY = spanY / (rows - 1);
  const nodes: GNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const jx = (seeded(i * 2 + 1) - 0.5) * stepX * 0.62;
      const jy = (seeded(i * 2 + 2) - 0.5) * stepY * 0.62;
      nodes.push({
        x: marginX + c * stepX + jx,
        y: marginY + r * stepY + jy,
        phase: Math.round(seeded(i * 3 + 5) * 90),
      });
    }
  }
  // Node 0 is the clean-repo origin — pin it to the left-middle for its label.
  nodes[0] = { x: 7, y: 26, phase: 0 };
  return nodes;
}
const NODES: GNode[] = buildNodes();

/**
 * Tangling edges built deterministically: every node chains to the previous one,
 * knots back to a seeded earlier node, and every other node throws a long cross
 * edge — so the graph grows DENSER (compounding debt) as later nodes appear.
 */
function buildEdges(n: number): [number, number][] {
  const edges: [number, number][] = [];
  for (let i = 1; i < n; i++) {
    edges.push([i - 1, i]);
    const j = Math.floor(seeded(i * 3.7) * i);
    if (j !== i) edges.push([j, i]);
    if (i % 2 === 0) {
      const k = Math.floor(seeded(i * 5.13 + 2) * i);
      if (k !== i && k !== j) edges.push([k, i]);
    }
  }
  return edges;
}
const EDGES: [number, number][] = buildEdges(NODES.length);

const ArrowIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="19" y2="12" />
    <polyline points="13 6 19 12 13 18" />
    <line x1="2" y1="8" x2="6" y2="8" opacity={0.55} />
    <line x1="2" y1="16" x2="6" y2="16" opacity={0.55} />
  </svg>
);

const FoundationIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="15" width="18" height="5" rx="1" />
    <rect x="5" y="9" width="6" height="5" rx="1" />
    <rect x="13" y="9" width="6" height="5" rx="1" />
    <rect x="8" y="3" width="8" height="5" rx="1" />
  </svg>
);

export const TheFork: React.FC<ConceptSceneProps> = ({ slide, durationFrames, locale }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const S = Math.min(width, height);
  const portrait = height > width;
  const contentW = Math.min(width * 0.9, S * 1.15);

  const { phaseFrames: p } = usePhases(durationFrames, 4);

  // Container settle — the fork header, branch cards and tangle panel are STABLE
  // frames: the shell fades and nudges up over the first ~10 frames, then holds
  // rock-steady. No drift, no whole-card spring. Content populates INSIDE it.
  const shellFade = interpolate(frame, [0, 10], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const shellRise = interpolate(frame, [0, 10], [10, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  // Diverging connectors draw in during p0.
  const forkDraw = interpolate(frame, [p * 0.15, p * 0.85], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const leftEnter = spring({ frame: frame - p * 0.35, fps, config: { damping: 20, mass: 0.7 } });
  const rightEnter = spring({ frame: frame - p * 0.5, fps, config: { damping: 20, mass: 0.7 } });

  // Branch emphasis: fast path in p1, "build to last" in p2. Fast stays lit
  // afterward because the rest of the scene follows it.
  const shipBreath = useBreath(46, 0);
  const lastBreath = useBreath(46, 23);
  const shipEmph = interpolate(frame, [p * 1, p * 1 + p * 0.15, p * 2, durationFrames], [0.35, 1, 0.75, 0.75], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const lastEmph = interpolate(frame, [p * 2, p * 2 + p * 0.15, p * 3 - p * 0.1, p * 3], [0.3, 1, 1, 0.3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Tangle growth window — spans p1..p3 and keeps inching into the hold.
  const tStart = p * 1.0;
  const tEnd = p * 3 + p * 0.7;
  const tSpan = tEnd - tStart;
  const sessions = Math.round(
    interpolate(frame, [tStart, tEnd], [1, 284], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  );
  // Overall density 0..1 → drives knot rings + red saturation.
  const density = interpolate(frame, [tStart, tEnd], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // Per-node reveal: nodes populate the panel as the sessions climb.
  const nodeAppear = (i: number): number => tStart + (i / NODES.length) * tSpan * 0.8;
  const statusSwap = interpolate(frame, [3 * p, 3 * p + p * 0.25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const tanglePulse = useBreath(70);

  // Live node positions (gentle deterministic bob keeps the graph alive).
  const livePos = NODES.map((n) => ({
    x: n.x + Math.sin((frame + n.phase) / 42) * 0.5,
    y: n.y + Math.cos((frame + n.phase) / 52) * 0.5,
  }));

  const branchRow = (
    <div style={{ display: 'flex', gap: S * 0.025, width: '100%' }}>
      {/* Fast branch — amber (the hero: the rest of the scene follows it) */}
      <BranchCard
        S={S}
        enter={leftEnter}
        emph={shipEmph}
        breath={shipBreath}
        accent={THEME.amber}
        tag="Ship by Friday"
        sub="fast · unverified"
        labelDelay={p * 0.35}
        hero
        icon={<ArrowIcon size={S * 0.03} color={THEME.amber} />}
      />
      {/* Foundation branch — indigo */}
      <BranchCard
        S={S}
        enter={rightEnter}
        emph={lastEmph}
        breath={lastBreath}
        accent={THEME.indigo}
        tag="Build to last"
        sub="context · durable"
        labelDelay={p * 0.5}
        icon={<FoundationIcon size={S * 0.03} color={THEME.indigo} />}
      />
    </div>
  );

  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: THEME.font,
        flexDirection: 'column',
        gap: S * 0.045,
      }}
    >
      {/* subtle amber meteors behind the fast/ship path — speed cue, kept minimal */}
      <Meteors count={3} color={THEME.amber} />

      <div
        style={{
          width: contentW,
          display: 'flex',
          flexDirection: 'column',
          gap: S * 0.02,
          transform: `translateY(${shellRise}px)`,
          opacity: shellFade,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* ---------------- Fork header ---------------- */}
        <div style={{ position: 'relative', height: S * 0.11 }}>
          <svg width="100%" height="100%" viewBox="0 0 100 40" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
            {/* origin node */}
            <circle cx={50} cy={5} r={2.4} fill={THEME.textStrong} />
            {/* diverging branches */}
            <path
              d="M50 6 C 40 16, 26 20, 22 38"
              fill="none"
              stroke={THEME.amber}
              strokeWidth={1.4}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - forkDraw}
              opacity={0.55 + shipEmph * 0.45}
            />
            <path
              d="M50 6 C 60 16, 74 20, 78 38"
              fill="none"
              stroke={THEME.indigo}
              strokeWidth={1.4}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - forkDraw}
              opacity={0.55 + lastEmph * 0.45}
            />
          </svg>
          <div
            style={{
              position: 'absolute',
              top: -S * 0.014,
              insetInlineStart: 0,
              width: '100%',
              textAlign: 'center',
              fontSize: S * 0.016,
              fontWeight: 700,
              color: THEME.textFaint,
              letterSpacing: 0.6,
            }}
          >
            YOUR REPO
          </div>
        </div>

        {branchRow}

        {/* ---------------- Consequence: the tangle ---------------- */}
        <div
          style={{
            marginTop: S * 0.01,
            borderRadius: S * 0.03,
            background: 'rgba(255,255,255,0.045)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
            padding: S * 0.03,
            display: 'flex',
            flexDirection: 'column',
            gap: S * 0.016,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: S * 0.02 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: S * 0.01 }}>
              <ArrowIcon size={S * 0.02} color={THEME.amber} />
              <span style={{ fontSize: S * 0.02, fontWeight: 800, color: THEME.textSoft }}>Following the fast path</span>
            </div>
            <span
              style={{
                fontSize: S * 0.016,
                fontWeight: 800,
                color: THEME.amber,
                background: 'rgba(245,181,68,0.12)',
                border: '1px solid rgba(245,181,68,0.4)',
                borderRadius: 999,
                padding: `${S * 0.005}px ${S * 0.012}px`,
                whiteSpace: 'nowrap',
              }}
            >
              {sessions} session{sessions === 1 ? '' : 's'}
            </span>
          </div>

          {/* growing messy graph */}
          <div style={{ position: 'relative', width: '100%', height: portrait ? S * 0.4 : S * 0.32 }}>
            <svg width="100%" height="100%" viewBox="0 0 100 52" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
              {EDGES.map(([a, b], i) => {
                const frac = i / EDGES.length;
                // An edge draws just after its later endpoint node has landed, so
                // the tangle grows WITH the nodes rather than ahead of them.
                const appear = nodeAppear(Math.max(a, b)) + p * 0.05;
                const draw = interpolate(frame, [appear, appear + p * 0.16], [0, 1], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                  easing: Easing.out(Easing.cubic),
                });
                if (draw <= 0) return null;
                const pa = livePos[a];
                const pb = livePos[b];
                const mx = (pa.x + pb.x) / 2;
                const my = (pa.y + pb.y) / 2;
                const dx = pb.x - pa.x;
                const dy = pb.y - pa.y;
                const len = Math.max(1, Math.hypot(dx, dy));
                // Perpendicular bow, alternating + growing for a knotted look.
                const bow = (i % 2 === 0 ? 1 : -1) * (3 + (i % 4) * 2.5);
                const cx = mx + (-dy / len) * bow;
                const cy = my + (dx / len) * bow;
                const strong = 0.4 + frac * 0.45; // later edges read hotter
                return (
                  <path
                    key={i}
                    d={`M ${pa.x} ${pa.y} Q ${cx} ${cy} ${pb.x} ${pb.y}`}
                    fill="none"
                    stroke={RED}
                    strokeWidth={0.45 + frac * 0.7}
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - draw}
                    opacity={draw * strong}
                  />
                );
              })}

              {livePos.map((pos, i) => {
                const isRepo = i === 0;
                // Each node springs in on its own beat, then holds.
                const nEnter = interpolate(
                  frame,
                  [nodeAppear(i), nodeAppear(i) + p * 0.12],
                  [0, 1],
                  { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
                );
                if (nEnter <= 0) return null;
                const r = (isRepo ? 2.2 : 1.35) * interpolate(nEnter, [0, 1], [0.3, 1]);
                const ringOpacity = isRepo ? 0 : nEnter * density * (0.3 + tanglePulse * 0.35);
                return (
                  <g key={i} opacity={nEnter}>
                    {ringOpacity > 0 ? (
                      <circle cx={pos.x} cy={pos.y} r={r + 1.1 + tanglePulse * 0.7} fill="none" stroke={RED} strokeWidth={0.5} opacity={ringOpacity} />
                    ) : null}
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={r}
                      fill={isRepo ? THEME.amber : THEME.textStrong}
                      opacity={isRepo ? 1 : 0.85}
                    />
                  </g>
                );
              })}
            </svg>

            {/* clean-repo label pinned to the origin node (left) */}
            <span
              style={{
                position: 'absolute',
                insetInlineStart: '2%',
                top: '38%',
                fontSize: S * 0.014,
                fontWeight: 800,
                color: THEME.amber,
              }}
            >
              clean repo
            </span>
          </div>

          {/* status label crossfades to the endgame */}
          <div style={{ position: 'relative', height: S * 0.03 }}>
            <span
              style={{
                position: 'absolute',
                insetInlineStart: 0,
                fontSize: S * 0.02,
                fontWeight: 800,
                color: THEME.textFaint,
                opacity: 1 - statusSwap,
              }}
            >
              unverified logic, compounding
            </span>
            <span
              style={{
                position: 'absolute',
                insetInlineStart: 0,
                fontSize: S * 0.022,
                fontWeight: 800,
                color: RED,
                opacity: statusSwap,
              }}
            >
              impossible to manage
            </span>
          </div>
        </div>
      </div>

      <CaptionRail slide={slide} durationFrames={durationFrames} width={width} />
    </AbsoluteFill>
  );
};

const BranchCard: React.FC<{
  S: number;
  enter: number;
  emph: number;
  breath: number;
  accent: string;
  tag: string;
  sub: string;
  labelDelay: number;
  hero?: boolean;
  icon: React.ReactNode;
}> = ({ S, enter, emph, breath, accent, tag, sub, labelDelay, hero = false, icon }) => (
  <div
    style={{
      position: 'relative',
      overflow: hero ? 'hidden' : undefined,
      flex: '1 1 0',
      minWidth: 0,
      borderRadius: S * 0.024,
      background: 'rgba(255,255,255,0.045)',
      border: `1px solid ${accent}`,
      boxShadow: `0 40px 120px rgba(0,0,0,0.55), 0 0 ${S * 0.04 * emph * (0.5 + breath * 0.5)}px ${accent}`,
      padding: S * 0.022,
      display: 'flex',
      alignItems: 'center',
      gap: S * 0.014,
      opacity: enter * (0.6 + emph * 0.4),
      transform: `translateY(${interpolate(enter, [0, 1], [18, 0])}px)`,
    }}
  >
    <span
      style={{
        flex: '0 0 auto',
        width: S * 0.05,
        height: S * 0.05,
        borderRadius: S * 0.014,
        background: `${accent}22`,
        border: `1px solid ${accent}66`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon}
    </span>
    <div style={{ minWidth: 0 }}>
      <ShimmerSweep delayFrames={labelDelay}>
        <div style={{ fontSize: S * 0.026, fontWeight: 800, color: THEME.textStrong, whiteSpace: 'nowrap' }}>{tag}</div>
      </ShimmerSweep>
      <div style={{ fontSize: S * 0.016, fontWeight: 700, color: accent, whiteSpace: 'nowrap' }}>{sub}</div>
    </div>
    {hero ? <BorderBeam thickness={1} colorFrom={accent} colorTo={accent} /> : null}
  </div>
);
