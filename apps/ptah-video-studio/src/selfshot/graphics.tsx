/**
 * Authored graphic scenes for the self-shot compositions.
 *
 * These are pure Remotion components — no screen capture required — mounted by
 * a `graphic` beat. Two layouts:
 *   - `panel` (default) parks the scene in the left third of the frame, which
 *     is empty in the founder's framing, so his face is never covered.
 *   - `full`  takes the whole frame for section transitions.
 *
 * Both layouts are format-aware: see `GraphicScene` for how the base unit and
 * the panel band are derived from the frame's SHORT edge, so 9:16 gets a layout
 * suited to its shape instead of an unadjusted crop of the 16:9 one.
 *
 * Every scene reads a single `p` (0→1 entry progress) plus the raw frame, so
 * they stay deterministic and resume-safe. Add a scene by adding a key to
 * `GRAPHICS`; `beats.json` references it by name.
 */
import React from 'react';
import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';
import { AnimatedIcon, type IconName } from './icons';

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export type GraphicName =
  | 'building-this'
  | 'open-source'
  | 'the-name'
  | 'agent-gap'
  | 'encode-architecture'
  | 'ships-with'
  | 'install-flow'
  | 'wizard-output'
  | 'cli-both-ways'
  | 'stack-grid'
  | 'provider-switch'
  | 'harness-layers'
  | 'skills-checklist'
  | 'wizard-phases'
  | 'runtime-trio'
  | 'agent-grid'
  | 'memory-timeline'
  | 'trajectory-skill';

export interface GraphicProps {
  /** Entry progress 0→1 (spring-driven). */
  p: number;
  /** Frames since the beat started — for staggering and idle motion. */
  frame: number;
  /** Base unit in px, derived from frame height so scenes scale with format. */
  u: number;
}

/** Per-item reveal: item `i` starts `stagger` frames after the one before it. */
function reveal(frame: number, i: number, stagger = 5, ramp = 12): number {
  return interpolate(frame, [i * stagger, i * stagger + ramp], [0, 1], {
    ...CLAMP,
    easing: Easing.out(Easing.cubic),
  });
}

// ── Shared bits ───────────────────────────────────────────────────────────────

const Title: React.FC<{ text: string; u: number; p: number }> = ({ text, u, p }) => (
  <div
    style={{
      fontSize: u * 0.62,
      fontWeight: 700,
      letterSpacing: 2.4,
      textTransform: 'uppercase',
      color: THEME.amberLight,
      marginBottom: u * 0.9,
      clipPath: `inset(0 ${(1 - p) * 100}% 0 0)`,
    }}
  >
    {text}
  </div>
);

const Tile: React.FC<{
  label: string;
  sub?: string;
  u: number;
  r: number;
  icon?: IconName;
  active?: boolean;
}> = ({ label, sub, u, r, icon, active }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: u * 0.6,
      padding: `${u * 0.52}px ${u * 0.7}px`,
      borderRadius: u * 0.42,
      background: active ? 'rgba(245,181,68,0.16)' : 'rgba(255,255,255,0.075)',
      border: `1px solid ${active ? 'rgba(245,181,68,0.55)' : 'rgba(255,255,255,0.14)'}`,
      opacity: r,
      transform: `translateX(${(1 - r) * -26}px)`,
    }}
  >
    {icon ? (
      <AnimatedIcon name={icon} size={u * 0.92} color={THEME.amber} progress={r} strokeWidth={2} />
    ) : (
      <div
        style={{
          width: u * 0.34,
          height: u * 0.34,
          borderRadius: 99,
          flexShrink: 0,
          background: active ? THEME.amber : 'rgba(255,255,255,0.3)',
          boxShadow: active ? `0 0 ${u * 0.5}px ${THEME.amber}` : 'none',
        }}
      />
    )}
    <div>
      <div style={{ fontSize: u * 0.66, fontWeight: 700, color: THEME.textStrong, whiteSpace: 'nowrap' }}>
        {label}
      </div>
      {sub ? (
        <div style={{ fontSize: u * 0.44, fontWeight: 600, color: THEME.textSoft, marginTop: u * 0.1 }}>
          {sub}
        </div>
      ) : null}
    </div>
  </div>
);

const Stack: React.FC<{ gap: number; children: React.ReactNode }> = ({ gap, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap }}>{children}</div>
);

// ── Scenes ────────────────────────────────────────────────────────────────────

const StackGrid: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const items: Array<[string, string, IconName]> = [
    ['Nx', 'monorepo', 'code'],
    ['Angular', 'front end', 'layers'],
    ['NestJS', 'back end', 'runtimes'],
    ['Prisma', 'ORM', 'memory'],
    ['Domain-driven', 'design', 'branch'],
  ];
  return (
    <>
      <Title text="The stack" u={u} p={p} />
      <Stack gap={u * 0.42}>
        {items.map(([label, sub, icon], i) => (
          <Tile key={label} label={label} sub={sub} icon={icon} u={u} r={reveal(frame, i)} />
        ))}
      </Stack>
    </>
  );
};

const ProviderSwitch: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const items = ['Claude Code', 'Codex', 'Llama', 'Any open model'];
  // The active row walks down the list, one every 20 frames.
  const active = Math.floor(Math.max(0, frame - 24) / 20) % items.length;
  return (
    <>
      <Title text="Provider agnostic" u={u} p={p} />
      <Stack gap={u * 0.42}>
        {items.map((label, i) => (
          <Tile key={label} label={label} u={u} r={reveal(frame, i)} active={i === active} />
        ))}
      </Stack>
    </>
  );
};

const HarnessLayers: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const layers: Array<[string, string]> = [
    ['Agent harness', 'skills · subagents'],
    ['Context harness', 'your architecture'],
    ['Application layer', 'where it all lives'],
  ];
  return (
    <>
      <Title text="One harness" u={u} p={p} />
      <Stack gap={u * 0.34}>
        {layers.map(([label, sub], i) => {
          const r = reveal(frame, i, 7);
          return (
            <div
              key={label}
              style={{
                padding: `${u * 0.6}px ${u * 0.75}px`,
                borderRadius: u * 0.4,
                background: `rgba(245,181,68,${0.05 + i * 0.045})`,
                border: '1px solid rgba(245,181,68,0.26)',
                opacity: r,
                transform: `translateY(${(1 - r) * 22}px)`,
              }}
            >
              <div style={{ fontSize: u * 0.66, fontWeight: 700, color: THEME.textStrong }}>{label}</div>
              <div style={{ fontSize: u * 0.44, fontWeight: 600, color: THEME.textSoft, marginTop: u * 0.12 }}>
                {sub}
              </div>
            </div>
          );
        })}
      </Stack>
    </>
  );
};

const SkillsChecklist: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const items = [
    'Lay out an Nx library',
    'Structure a NestJS backend',
    'Model a domain properly',
    'Multi-tenancy + auth',
  ];
  return (
    <>
      <Title text="What the skills know" u={u} p={p} />
      <Stack gap={u * 0.46}>
        {items.map((label, i) => {
          const r = reveal(frame, i, 9, 14);
          return (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: u * 0.55, opacity: r }}>
              <div
                style={{
                  width: u * 0.95,
                  height: u * 0.95,
                  borderRadius: u * 0.28,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(245,181,68,0.15)',
                  border: '1px solid rgba(245,181,68,0.42)',
                }}
              >
                <svg width={u * 0.55} height={u * 0.55} viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 12l5 5L20 6"
                    pathLength={1}
                    stroke={THEME.amber}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray={1}
                    strokeDashoffset={1 - r}
                  />
                </svg>
              </div>
              <div style={{ fontSize: u * 0.62, fontWeight: 700, color: THEME.textStrong }}>{label}</div>
            </div>
          );
        })}
      </Stack>
    </>
  );
};

const WizardPhases: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const phases = ['Project profile', 'Architecture', 'Quality audit', 'Elevation plan'];
  const done = interpolate(frame, [10, 90], [0, phases.length], CLAMP);
  return (
    <>
      <Title text="It reads your codebase" u={u} p={p} />
      <Stack gap={u * 0.38}>
        {phases.map((label, i) => {
          const r = reveal(frame, i, 6);
          const complete = done > i + 1;
          const running = done > i && !complete;
          return (
            <div key={label} style={{ opacity: r }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: u * 0.5, marginBottom: u * 0.2 }}>
                <div
                  style={{
                    width: u * 0.3,
                    height: u * 0.3,
                    borderRadius: 99,
                    background: complete || running ? THEME.amber : 'rgba(255,255,255,0.22)',
                    boxShadow: running ? `0 0 ${u * 0.6}px ${THEME.amber}` : 'none',
                  }}
                />
                <div
                  style={{
                    fontSize: u * 0.58,
                    fontWeight: 700,
                    color: complete || running ? THEME.textStrong : THEME.textSoft,
                  }}
                >
                  {label}
                </div>
              </div>
              <div
                style={{
                  height: u * 0.16,
                  borderRadius: 99,
                  background: 'rgba(255,255,255,0.08)',
                  overflow: 'hidden',
                  marginLeft: u * 0.8,
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${Math.max(0, Math.min(1, done - i)) * 100}%`,
                    background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </Stack>
    </>
  );
};

const RuntimeTrio: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const surfaces: Array<[string, IconName]> = [
    ['VS Code', 'code'],
    ['Desktop', 'runtimes'],
    ['CLI + TUI', 'terminal'],
  ];
  return (
    <>
      <Title text="One core, three surfaces" u={u} p={p} />
      <div
        style={{
          padding: `${u * 0.55}px ${u * 0.8}px`,
          borderRadius: u * 0.42,
          background: `linear-gradient(120deg, ${THEME.amber}, ${THEME.amberDeep})`,
          color: '#1a1200',
          fontWeight: 800,
          fontSize: u * 0.68,
          textAlign: 'center',
          opacity: reveal(frame, 0),
          boxShadow: `0 0 ${u * 1.6}px ${THEME.amberDeep}55`,
        }}
      >
        platform-core
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: u * 0.3, margin: `${u * 0.35}px 0` }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: u * 0.1,
              height: u * 0.72,
              borderRadius: 99,
              background: 'rgba(245,181,68,0.45)',
              opacity: reveal(frame, i + 1, 4),
            }}
          />
        ))}
      </div>
      <Stack gap={u * 0.34}>
        {surfaces.map(([label, icon], i) => (
          <Tile key={label} label={label} icon={icon} u={u} r={reveal(frame, i + 2, 6)} active />
        ))}
      </Stack>
    </>
  );
};

const AgentGrid: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const cell = u * 2.7;
  return (
    <>
      <Title text="Nine at once" u={u} p={p} />
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(3, ${cell}px)`, gap: u * 0.34 }}>
        {Array.from({ length: 9 }, (_, i) => {
          const r = reveal(frame, i, 4, 10);
          // Each tile pulses on its own phase so the grid looks alive.
          const pulse = 0.72 + 0.28 * Math.sin(frame / 9 + i);
          return (
            <div
              key={i}
              style={{
                width: cell,
                height: cell * 0.74,
                borderRadius: u * 0.28,
                background: `rgba(245,181,68,${0.1 + 0.14 * pulse})`,
                border: '1px solid rgba(245,181,68,0.4)',
                opacity: r,
                transform: `scale(${0.7 + 0.3 * r})`,
                display: 'flex',
                alignItems: 'flex-end',
                padding: u * 0.22,
              }}
            >
              <div
                style={{
                  height: u * 0.12,
                  width: `${30 + ((i * 27) % 60)}%`,
                  borderRadius: 99,
                  background: THEME.amber,
                  opacity: pulse,
                }}
              />
            </div>
          );
        })}
      </div>
    </>
  );
};

const MemoryTimeline: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const grow = interpolate(frame, [12, 70], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  return (
    <>
      <Title text="Memory that persists" u={u} p={p} />
      <div style={{ display: 'flex', gap: u * 0.34, alignItems: 'flex-end', marginBottom: u * 0.5 }}>
        {days.map((d, i) => {
          const r = reveal(frame, i, 5);
          return (
            <div key={d} style={{ textAlign: 'center', opacity: r }}>
              <div
                style={{
                  width: u * 1.15,
                  height: u * 1.5,
                  borderRadius: u * 0.24,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              />
              <div style={{ fontSize: u * 0.42, fontWeight: 700, color: THEME.textSoft, marginTop: u * 0.22 }}>
                {d}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          height: u * 0.34,
          borderRadius: 99,
          width: `${grow * 100}%`,
          background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
          boxShadow: `0 0 ${u * 0.9}px ${THEME.amberDeep}77`,
        }}
      />
      <div style={{ fontSize: u * 0.46, fontWeight: 700, color: THEME.amberLight, marginTop: u * 0.34 }}>
        one memory, every session
      </div>
    </>
  );
};

const TrajectorySkill: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const steps: Array<[string, IconName]> = [
    ['Finished task', 'trending'],
    ['Trajectory extracted', 'branch'],
    ['Reusable skill', 'sparkles'],
  ];
  return (
    <>
      <Title text="It learns from you" u={u} p={p} />
      <Stack gap={u * 0.3}>
        {steps.map(([label, icon], i) => {
          const r = reveal(frame, i, 12, 14);
          return (
            <React.Fragment key={label}>
              <Tile label={label} icon={icon} u={u} r={r} active={i === 2} />
              {i < steps.length - 1 ? (
                <div
                  style={{
                    width: u * 0.1,
                    height: u * 0.5,
                    marginLeft: u * 1.05,
                    borderRadius: 99,
                    background: 'rgba(245,181,68,0.45)',
                    opacity: reveal(frame, i, 12, 14),
                  }}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </Stack>
    </>
  );
};

const BuildingThis: React.FC<GraphicProps> = ({ p, frame, u }) => (
  <>
    <Title text="What I've been building" u={u} p={p} />
    <Stack gap={u * 0.34}>
      <Tile label="Ptah" sub="a coding agent" icon="sparkles" u={u} r={reveal(frame, 0, 8)} active />
      <div
        style={{
          marginLeft: u * 1.05,
          width: u * 0.1,
          height: u * 0.6,
          borderRadius: 99,
          background: 'rgba(245,181,68,0.45)',
          opacity: reveal(frame, 1, 8),
        }}
      />
      <Tile label="A real SaaS" sub="built with it, every day" icon="runtimes" u={u} r={reveal(frame, 2, 8)} />
    </Stack>
  </>
);

const OpenSource: React.FC<GraphicProps> = ({ p, frame, u }) => (
  <>
    <Title text="Open source" u={u} p={p} />
    <Stack gap={u * 0.42}>
      <Tile label="All of it" sub="nothing held back" icon="branch" u={u} r={reveal(frame, 0)} active />
      <Tile label="On GitHub" sub="clone it today" icon="code" u={u} r={reveal(frame, 1)} />
      <Tile label="Contributors welcome" sub="issues + PRs open" icon="trending" u={u} r={reveal(frame, 2)} />
    </Stack>
  </>
);

const TheName: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const r = reveal(frame, 0, 0, 20);
  return (
    <>
      <Title text="The name" u={u} p={p} />
      <div
        style={{
          fontSize: u * 2.6,
          fontWeight: 800,
          letterSpacing: u * 0.18,
          lineHeight: 1,
          background: `linear-gradient(100deg, ${THEME.amberLight}, ${THEME.amber})`,
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          clipPath: `inset(0 ${(1 - r) * 100}% 0 0)`,
        }}
      >
        PTAH
      </div>
      <div
        style={{
          marginTop: u * 0.5,
          fontSize: u * 0.56,
          fontWeight: 600,
          lineHeight: 1.45,
          color: THEME.textSoft,
          opacity: reveal(frame, 2, 8),
        }}
      >
        Egyptian god of craftsmen,
        <br />
        builders and architects
      </div>
    </>
  );
};

const AgentGap: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const rows: Array<[string, boolean]> = [
    ['Writing the code', true],
    ['Knowing your architecture', false],
  ];
  return (
    <>
      <Title text="Every agent I tried" u={u} p={p} />
      <Stack gap={u * 0.46}>
        {rows.map(([label, good], i) => {
          const r = reveal(frame, i, 12, 16);
          return (
            <div
              key={label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: u * 0.6,
                padding: `${u * 0.55}px ${u * 0.7}px`,
                borderRadius: u * 0.42,
                background: good ? 'rgba(245,181,68,0.14)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${good ? 'rgba(245,181,68,0.5)' : 'rgba(255,255,255,0.13)'}`,
                opacity: r,
                transform: `translateX(${(1 - r) * -26}px)`,
              }}
            >
              <svg width={u * 0.95} height={u * 0.95} viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <path
                  d={good ? 'M4 12l5 5L20 6' : 'M6 6l12 12M18 6L6 18'}
                  pathLength={1}
                  stroke={good ? THEME.amber : 'rgba(255,255,255,0.42)'}
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeDasharray={1}
                  strokeDashoffset={1 - r}
                />
              </svg>
              <div
                style={{
                  fontSize: u * 0.64,
                  fontWeight: 700,
                  color: good ? THEME.textStrong : THEME.textSoft,
                }}
              >
                {label}
              </div>
            </div>
          );
        })}
      </Stack>
    </>
  );
};

const EncodeArchitecture: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const swap = interpolate(frame, [40, 62], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  return (
    <>
      <Title text="So I stopped explaining" u={u} p={p} />
      <div style={{ opacity: 1 - swap, transform: `translateY(${swap * -18}px)` }}>
        <div style={{ fontSize: u * 0.5, fontWeight: 700, color: THEME.textSoft, marginBottom: u * 0.34 }}>
          EVERY SINGLE SESSION
        </div>
        <Stack gap={u * 0.22}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: u * 0.62,
                borderRadius: u * 0.2,
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.13)',
                opacity: reveal(frame, i, 6),
                display: 'flex',
                alignItems: 'center',
                paddingLeft: u * 0.5,
                fontSize: u * 0.46,
                fontWeight: 600,
                color: THEME.textSoft,
              }}
            >
              explain the architecture…
            </div>
          ))}
        </Stack>
      </div>
      <div
        style={{
          marginTop: u * 0.5,
          opacity: swap,
          transform: `translateY(${(1 - swap) * 20}px)`,
          padding: `${u * 0.7}px ${u * 0.8}px`,
          borderRadius: u * 0.42,
          background: `linear-gradient(120deg, ${THEME.amber}, ${THEME.amberDeep})`,
          color: '#1a1200',
          fontWeight: 800,
          fontSize: u * 0.72,
        }}
      >
        Encoded once, in the harness
      </div>
    </>
  );
};

const ShipsWith: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const c = interpolate(frame, [4, 30], [0, 1], { ...CLAMP, easing: Easing.out(Easing.cubic) });
  const pairs: Array<[number, string]> = [
    [24, 'skills'],
    [15, 'agent templates'],
  ];
  return (
    <>
      <Title text="Ptah ships with" u={u} p={p} />
      <Stack gap={u * 0.6}>
        {pairs.map(([n, label], i) => (
          <div key={label} style={{ opacity: reveal(frame, i, 8) }}>
            <div
              style={{
                fontSize: u * 1.9,
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: -2,
                fontVariantNumeric: 'tabular-nums',
                background: `linear-gradient(90deg, ${THEME.amberLight}, ${THEME.amber})`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {Math.round(n * c)}
            </div>
            <div
              style={{
                fontSize: u * 0.52,
                fontWeight: 600,
                letterSpacing: 1.6,
                textTransform: 'uppercase',
                color: THEME.textSoft,
                marginTop: u * 0.16,
              }}
            >
              {label}
            </div>
          </div>
        ))}
      </Stack>
    </>
  );
};

const InstallFlow: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const steps: Array<[string, IconName]> = [
    ['Pick what you want', 'layers'],
    ['Install', 'sparkles'],
    ['Wired into your workspace', 'plug'],
    ['Into the agent you use', 'terminal'],
  ];
  const at = interpolate(frame, [10, 100], [0, steps.length], CLAMP);
  return (
    <>
      <Title text="One click" u={u} p={p} />
      <Stack gap={u * 0.26}>
        {steps.map(([label, icon], i) => {
          const r = reveal(frame, i, 7);
          return (
            <React.Fragment key={label}>
              <Tile label={label} icon={icon} u={u} r={r} active={at > i} />
              {i < steps.length - 1 ? (
                <div
                  style={{
                    marginLeft: u * 1.05,
                    width: u * 0.1,
                    height: u * 0.36,
                    borderRadius: 99,
                    background: at > i + 0.5 ? THEME.amber : 'rgba(245,181,68,0.32)',
                    opacity: r,
                  }}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </Stack>
    </>
  );
};

const WizardOutput: React.FC<GraphicProps> = ({ p, frame, u }) => {
  const inputs = ['Your weaknesses', 'Your strengths'];
  const merged = reveal(frame, 3, 12, 18);
  return (
    <>
      <Title text="And then it writes" u={u} p={p} />
      <Stack gap={u * 0.3}>
        {inputs.map((label, i) => (
          <Tile key={label} label={label} u={u} r={reveal(frame, i, 9)} />
        ))}
      </Stack>
      <div
        style={{
          marginLeft: u * 1.05,
          marginTop: u * 0.3,
          width: u * 0.1,
          height: u * 0.55,
          borderRadius: 99,
          background: 'rgba(245,181,68,0.45)',
          opacity: merged,
        }}
      />
      <div
        style={{
          marginTop: u * 0.3,
          padding: `${u * 0.6}px ${u * 0.75}px`,
          borderRadius: u * 0.42,
          background: `linear-gradient(120deg, ${THEME.amber}, ${THEME.amberDeep})`,
          color: '#1a1200',
          fontWeight: 800,
          fontSize: u * 0.66,
          opacity: merged,
          transform: `translateY(${(1 - merged) * 18}px)`,
        }}
      >
        Agents + skills, tailored to you
      </div>
    </>
  );
};

const CliBothWays: React.FC<GraphicProps> = ({ p, frame, u }) => (
  <>
    <Title text="The CLI goes both ways" u={u} p={p} />
    <Stack gap={u * 0.42}>
      <Tile
        label="Headless"
        sub="an agent drives it over JSON-RPC"
        icon="code"
        u={u}
        r={reveal(frame, 0, 12)}
        active
      />
      <Tile
        label="Terminal UI"
        sub="you drive it yourself"
        icon="terminal"
        u={u}
        r={reveal(frame, 1, 12)}
        active
      />
    </Stack>
  </>
);

const GRAPHICS: Record<GraphicName, React.FC<GraphicProps>> = {
  'building-this': BuildingThis,
  'open-source': OpenSource,
  'the-name': TheName,
  'agent-gap': AgentGap,
  'encode-architecture': EncodeArchitecture,
  'ships-with': ShipsWith,
  'install-flow': InstallFlow,
  'wizard-output': WizardOutput,
  'cli-both-ways': CliBothWays,
  'stack-grid': StackGrid,
  'provider-switch': ProviderSwitch,
  'harness-layers': HarnessLayers,
  'skills-checklist': SkillsChecklist,
  'wizard-phases': WizardPhases,
  'runtime-trio': RuntimeTrio,
  'agent-grid': AgentGrid,
  'memory-timeline': MemoryTimeline,
  'trajectory-skill': TrajectorySkill,
};

export function isGraphicName(v: unknown): v is GraphicName {
  return typeof v === 'string' && v in GRAPHICS;
}

/**
 * Mounts a named scene. `panel` sits in the empty left third of the founder's
 * framing; `full` covers the frame for a section break.
 *
 * ── Why the geometry is format-aware ────────────────────────────────────────
 * One manifest renders both 1920x1080 and 1080x1920. The 16:9 treatment — a
 * `height * 0.042` unit in a `width * 0.33` column — only works because in
 * landscape the founder sits right-of-centre and the left third is empty wall.
 *
 * Ported verbatim to 9:16 it fails twice over: the column is only 356px, which
 * wraps "Structure a NestJS backend" onto three lines (and floats the checkmark
 * against a triple-height label), while the unit BALLOONS to 81px because it is
 * keyed off a 1920px height — so the scenes get bigger and the space to put them
 * gets smaller at the same time. `stack-grid` then runs off the bottom, under
 * the caption bar.
 *
 * The fix is to key the base unit to the frame's SHORT edge and size the band as
 * a multiple of that unit. Both formats then give a scene the same room measured
 * in `u`, which is the only thing wrapping actually cares about. In 16:9 the
 * short edge IS the height and `14.1u ≈ width * 0.33`, so every landscape number
 * below evaluates to exactly what it did before — this is a generalisation of
 * the approved layout, not a change to it.
 *
 * Portrait additionally centres the band between the watermark and the caption
 * bar instead of on the frame, so tall scenes cannot collide with either.
 */
export const GraphicScene: React.FC<{
  name: GraphicName;
  layout: 'panel' | 'full';
  durationFrames: number;
}> = ({ name, layout, durationFrames }) => {
  const frame = useCurrentFrame();
  const { fps, height, width } = useVideoConfig();
  const Scene = GRAPHICS[name];
  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.6, stiffness: 120 } });
  const exit = interpolate(frame, [durationFrames - 12, durationFrames], [0, 1], CLAMP);
  const opacity = enter * (1 - exit);

  const portrait = width < height;
  // Short edge: `height` in landscape (so the 0.042 / 0.055 coefficients keep
  // their approved values), `width` in portrait (where height is the long edge
  // and scaling by it is what inflates the unit).
  const shortEdge = portrait ? width : height;
  const u = Math.round(shortEdge * (layout === 'full' ? 0.055 : 0.042));

  if (layout === 'full') {
    return (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(5,6,12,0.94)',
          opacity,
          fontFamily: THEME.font,
          // Short-edge padding: identical to `height * 0.1` in landscape, but in
          // portrait it stops a 192px inset from eating a fifth of the width.
          padding: shortEdge * 0.1,
        }}
      >
        <Scene p={enter} frame={frame} u={u} />
      </div>
    );
  }

  // Band width in units of `u`. 14.1u is what `width * 0.33` already resolves to
  // at 1920x1080 — the widest authored scene (`wizard-output`'s pill) measures
  // ~13.1u, so this is the column the scenes were composed against. Portrait
  // reuses the same figure, which lands at ~0.59 of a 1080px width.
  const panelMaxWidth = u * 14.1;
  // The scrim only has to reach past the band; in portrait a wider band needs a
  // wider scrim, but it stays short of the founder's face at frame centre.
  const scrimWidth = portrait ? width * 0.62 : width * 0.46;
  // Portrait centres on 42% — the midpoint of the safe band between the
  // watermark (clears ~7%) and the caption pill (tops out ~78%) — so the tallest
  // scene, `stack-grid` at ~15.8u, has ~33% of height to spare either side.
  const panelTop = portrait ? '42%' : '50%';

  return (
    <>
      {/* Soft scrim: the founder's wall is bright, so panels need a surface to
          sit on. Fades out well before his face so it reads as light, not a box. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: scrimWidth,
          opacity: opacity * 0.98,
          background:
            'linear-gradient(90deg, rgba(5,6,12,0.86) 0%, rgba(5,6,12,0.74) 48%, rgba(5,6,12,0.34) 78%, rgba(5,6,12,0) 100%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '4.5%',
          top: panelTop,
          // Landscape keeps the fixed column it was composed in. Portrait uses
          // `fit-content` capped at the same 14.1u: the band collapses to the
          // scene's longest single line, so tile chrome stops overhanging into
          // the founder's face, while every child still stretches to that one
          // shared width — `runtime-trio`'s pill, its connectors and its tiles
          // stay flush with each other the way they do in 16:9.
          ...(portrait
            ? { width: 'fit-content', maxWidth: panelMaxWidth }
            : { width: width * 0.33 }),
          opacity,
          transform: `translateY(-50%) translateX(${(1 - enter) * -50 - exit * 40}px)`,
          fontFamily: THEME.font,
        }}
      >
        <Scene p={enter} frame={frame} u={u} />
      </div>
    </>
  );
};
