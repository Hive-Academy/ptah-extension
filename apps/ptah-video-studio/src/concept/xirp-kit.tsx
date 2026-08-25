/**
 * xirp-kit — flat 2D primitives for the "answer" reel (promos/ptah-xirp-answer.json).
 *
 * Deliberately NO 3D. The reference this reel answers (Spotify's Xirp promo)
 * runs its whole 64s on six devices and nothing else:
 *
 *   1. character / word reveal      -> TypeOn, WordFill
 *   2. staggered multiply           -> AppWindow stacked by the scene
 *   3. shape-by-shape logo build    -> PtahMark (stroke-drawn, our ankh analogue)
 *   4. full-bleed colour flash cut  -> scenes set their own background, cuts are hard
 *   5. object-as-transition         -> MarkWipe
 *   6. brand-shape confetti         -> ShapeBurst
 *
 * Everything here is a pure function of the frame, so renders stay deterministic.
 * Sizes are authored against a 1920x1080 stage and scaled by the caller via `s`.
 */
import React from 'react';
import { Img, interpolate, staticFile } from 'remotion';
import { AMBER, INK, INTER_FAMILY, MONO_FAMILY } from './story-kit';

/**
 * Brand ramp for the flash frames, taken verbatim from the real mark
 * (apps/ptah-extension-vscode/.../ptah-icon-toolbar.svg). The logo is a GOLD
 * medallion on a LAPIS field — putting it on amber would leave gold-on-amber
 * with almost no contrast, so the flash frames use its own lapis instead. Amber
 * stays the accent hue for type, as everywhere else in the studio.
 */
export const LAPIS = '#141E42';
export const LAPIS_MID = '#2A3F7A';
export const GOLD = '#D4AF37';
export const GOLD_LIGHT = '#F2D06B';

/** Ease-out cubic — the default for anything that lands. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
/** Ease-in-out cubic — for camera-ish moves that start and stop. */
export const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Clamped 0..1 progress across [from, to] frames. */
export function progress(frame: number, from: number, to: number): number {
  if (to <= from) return frame >= to ? 1 : 0;
  return Math.max(0, Math.min(1, (frame - from) / (to - from)));
}

/**
 * Stagger helper — per-item progress for `count` items revealing over
 * [from, to], each taking `hold` frames. Item i starts at an even slice.
 */
export function stagger(
  frame: number,
  index: number,
  count: number,
  from: number,
  to: number,
  hold = 10,
): number {
  const span = Math.max(1, (to - from - hold) / Math.max(1, count - 1));
  const start = from + index * span;
  return progress(frame, start, start + hold);
}

// ── 3. The logo reveal ───────────────────────────────────────────────────────

/**
 * The REAL Ptah logo — the gold-and-lapis medallion shipped as the app icon
 * and used on the marketing site nav (`assets/icons/ptah-icon.png`, staged into
 * the promo public dir as `brand/ptah-icon.png` by render-promo.mjs).
 *
 * It is a detailed raster, so it cannot stroke itself on the way a flat vector
 * mark could. `reveal` 0..1 instead scales it up from slightly small with a
 * short counter-rotation and a gold bloom behind it — a medallion being struck
 * rather than a line being drawn.
 */
export const PtahLogo: React.FC<{
  size: number;
  /** 0..1 reveal progress. 1 = fully landed. */
  reveal?: number;
  /** Gold halo behind the medallion. Off for small inline uses. */
  glow?: boolean;
}> = ({ size, reveal = 1, glow = true }) => {
  const e = easeOut(Math.max(0, Math.min(1, reveal)));
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        opacity: Math.min(1, e * 1.5),
        transform: `scale(${0.82 + e * 0.18}) rotate(${(1 - e) * -9}deg)`,
      }}
    >
      {glow ? (
        <div
          style={{
            position: 'absolute',
            inset: `-${size * 0.22}px`,
            borderRadius: '50%',
            background: `radial-gradient(circle, rgba(212,175,55,${0.32 * e}) 0%, rgba(212,175,55,0) 68%)`,
          }}
        />
      ) : null}
      <Img
        src={staticFile('brand/ptah-icon.png')}
        style={{ width: '100%', height: '100%', display: 'block', position: 'relative' }}
      />
    </div>
  );
};

// ── 1. Character / word reveal ───────────────────────────────────────────────

/**
 * Character-by-character reveal with a block caret, the way a terminal or a
 * wordmark types on. `p` 0..1 across the whole string.
 */
export const TypeOn: React.FC<{
  text: string;
  p: number;
  color?: string;
  /** Show the block caret while typing (and blink it once done). */
  caret?: boolean;
  style?: React.CSSProperties;
}> = ({ text, p, color, caret = true, style }) => {
  const shown = text.slice(0, Math.round(text.length * Math.max(0, Math.min(1, p))));
  return (
    <span style={{ color, whiteSpace: 'pre', ...style }}>
      {shown}
      {caret && p > 0 ? (
        <span
          style={{
            display: 'inline-block',
            width: '0.55em',
            height: '1em',
            marginLeft: '0.06em',
            background: color ?? 'currentColor',
            verticalAlign: '-0.14em',
            opacity: p >= 1 ? 0.35 : 1,
          }}
        />
      ) : null}
    </span>
  );
};

/**
 * Word-by-word colour fill — the end-card headline device. Words start at
 * `dim` and settle to `strong` one at a time across [0,1].
 */
export const WordFill: React.FC<{
  text: string;
  p: number;
  strong: string;
  dim: string;
  style?: React.CSSProperties;
}> = ({ text, p, strong, dim, style }) => {
  const words = text.split(' ');
  return (
    <span style={style}>
      {words.map((word, i) => {
        const start = i / words.length;
        const filled = progress(p, start, start + 1 / words.length);
        return (
          <span key={i} style={{ color: filled > 0.5 ? strong : dim, transition: 'none' }}>
            {word}
            {i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </span>
  );
};

// ── 2. Staggered multiply ────────────────────────────────────────────────────

/** Vendor skins for the stacked session windows. */
export const VENDORS = {
  claude: { label: 'claude', accent: '#d97757', title: '~/ptah — claude' },
  codex: { label: 'codex', accent: '#9ca3af', title: '~/ptah — codex' },
  gemini: { label: 'gemini', accent: '#6b8afd', title: '~/ptah — gemini' },
  copilot: { label: 'copilot', accent: '#8b949e', title: '~/ptah — copilot' },
} as const;

export type VendorKey = keyof typeof VENDORS;

/**
 * Official vendor marks (path data from simple-icons, CC0) in each vendor's own
 * brand colour. Nominative use — the reel states which agent CLIs Ptah drives,
 * which is exactly what these marks are for.
 *
 * These live in .tsx, so they compile into the studio bundle and never reach a
 * VSIX. Do NOT copy them into the extension as standalone .svg assets: the
 * marketplace scanner rejects trademarked AI product names in non-JS files
 * (see the root CLAUDE.md marketplace rules).
 */
const VENDOR_PATHS: Record<VendorKey, string> = {
  claude:
    'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
  gemini:
    'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81',
  codex:
    'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  copilot:
    'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z',
};

/** Each vendor's own brand colour, as used on their marks. */
const VENDOR_INK: Record<VendorKey, string> = {
  claude: '#D97757',
  gemini: 'url(#gemini-grad)',
  codex: '#FFFFFF',
  copilot: '#FFFFFF',
};

/** The real vendor mark on a neutral tile, sized to the caller's grid. */
export const VendorIcon: React.FC<{ vendor: VendorKey; size: number }> = ({ vendor, size }) => (
  <span
    style={{
      width: size,
      height: size,
      flexShrink: 0,
      borderRadius: size * 0.26,
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24">
      {vendor === 'gemini' ? (
        <defs>
          {/* Gemini's mark is a gradient, not a flat fill. */}
          <linearGradient id="gemini-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4285F4" />
            <stop offset="52%" stopColor="#9B72CB" />
            <stop offset="100%" stopColor="#D96570" />
          </linearGradient>
        </defs>
      ) : null}
      <path d={VENDOR_PATHS[vendor]} fill={VENDOR_INK[vendor]} />
    </svg>
  </span>
);

/**
 * A believable terminal window — mac chrome, title bar, pre-rendered body
 * lines. Static by design: the sprawl scene stacks a dozen of these, so the
 * body must not animate per-window or the frame cost explodes.
 */
export const AppWindow: React.FC<{
  width: number;
  height: number;
  vendor: VendorKey;
  lines?: { text: string; dim?: boolean; accent?: boolean }[];
  /**
   * Depth dim for windows buried in a stack, 0..1 (1 = frontmost).
   * Applied as an ink SCRIM over an opaque window, never as opacity on the
   * window itself — a translucent window lets the text of everything behind it
   * bleed through and the stack turns into unreadable soup.
   */
  fade?: number;
}> = ({ width, height, vendor, lines = [], fade = 1 }) => {
  const v = VENDORS[vendor];
  const chrome = Math.max(18, Math.round(height * 0.075));
  const pad = Math.round(width * 0.035);
  const font = Math.max(7, Math.round(height * 0.038));

  return (
    <div
      style={{
        width,
        height,
        borderRadius: Math.round(width * 0.012),
        overflow: 'hidden',
        background: '#0b0d11',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.72)',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: chrome,
          background: '#14171d',
          display: 'flex',
          alignItems: 'center',
          gap: chrome * 0.28,
          paddingLeft: chrome * 0.45,
          flexShrink: 0,
        }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <span
            key={c}
            style={{
              width: chrome * 0.3,
              height: chrome * 0.3,
              borderRadius: '50%',
              background: c,
              opacity: 0.9,
            }}
          />
        ))}
        <span
          style={{
            marginLeft: 'auto',
            marginRight: chrome * 0.6,
            color: 'rgba(255,255,255,0.42)',
            fontFamily: MONO_FAMILY,
            fontSize: chrome * 0.34,
            letterSpacing: '0.01em',
          }}
        >
          {v.title}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          padding: pad,
          fontFamily: MONO_FAMILY,
          fontSize: font,
          lineHeight: 1.65,
          color: 'rgba(255,255,255,0.62)',
          overflow: 'hidden',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.accent ? v.accent : line.dim ? 'rgba(255,255,255,0.3)' : undefined,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
      {/* Depth scrim — opaque ink over an opaque window (see `fade`). */}
      {fade < 1 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: INK,
            opacity: 1 - fade,
            pointerEvents: 'none',
          }}
        />
      ) : null}
    </div>
  );
};

/** Generic filler body so stacked windows read as real sessions, not lorem. */
export function sessionLines(vendor: VendorKey, seed: number) {
  const bodies: Record<VendorKey, string[]> = {
    claude: ['> refactor the billing module', 'reading 14 files...', 'editing webhook-handler.ts'],
    codex: ['$ codex exec "add retries"', 'planning...', 'patch applied to 3 files'],
    gemini: ['> gemini -p "explain this"', 'scanning repo...', 'summarising 2,104 symbols'],
    copilot: ['$ copilot suggest', 'thinking...', 'proposed 2 changes'],
  };
  const body = bodies[vendor];
  return [
    { text: body[0], accent: true },
    { text: body[1], dim: true },
    { text: body[2 % body.length] },
    { text: `session ${String(seed).padStart(2, '0')} · no shared context`, dim: true },
  ];
}

// ── The siloed-context doc icon ──────────────────────────────────────────────

/** A markdown file card — the "your prompts and configs are invisible" beat. */
export const DocIcon: React.FC<{ name: string; size: number; p: number }> = ({
  name,
  size,
  p,
}) => {
  const e = easeOut(p);
  return (
    <div
      style={{
        opacity: e,
        transform: `translateY(${(1 - e) * size * 0.22}px) scale(${0.9 + e * 0.1})`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: size * 0.16,
      }}
    >
      <svg width={size} height={size * 1.24} viewBox="0 0 40 50" fill="none">
        <path
          d="M4 3h22l10 10v34H4z"
          fill="#12151b"
          stroke="rgba(255,255,255,0.24)"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <path d="M26 3v10h10" stroke="rgba(255,255,255,0.24)" strokeWidth={1.6} strokeLinejoin="round" />
        <text
          x="20" y="34"
          textAnchor="middle"
          fill={AMBER}
          fontFamily={MONO_FAMILY}
          fontSize="11"
          fontWeight="700"
        >
          MD
        </text>
      </svg>
      <span
        style={{
          fontFamily: MONO_FAMILY,
          fontSize: size * 0.22,
          color: 'rgba(255,255,255,0.5)',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
    </div>
  );
};

// ── 6. Brand-shape confetti ──────────────────────────────────────────────────

/** One confetti glyph. Shapes echo the mark: loop, bracket, bar, node. */
const SHAPES = ['loop', 'bracket', 'bar', 'node', 'chevron'] as const;

const Shape: React.FC<{ kind: (typeof SHAPES)[number]; size: number; color: string }> = ({
  kind,
  size,
  color,
}) => {
  switch (kind) {
    case 'loop':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <ellipse cx="12" cy="12" rx="8" ry="9.5" stroke={color} strokeWidth="3.4" />
        </svg>
      );
    case 'bracket':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M15 4L7 12l8 8" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'bar':
      return (
        <div style={{ width: size, height: size * 0.3, borderRadius: size * 0.15, background: color }} />
      );
    case 'node':
      return <div style={{ width: size * 0.62, height: size * 0.62, borderRadius: '50%', background: color }} />;
    case 'chevron':
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <path d="M6 5l9 7-9 7" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
};

/**
 * Rising brand-shape confetti. Deterministic: every particle's position is a
 * pure function of its index (no Math.random, which would break Remotion's
 * frame-independent rendering across the render farm).
 */
export const ShapeBurst: React.FC<{
  frame: number;
  width: number;
  height: number;
  count?: number;
  /** 0..1 overall intensity — scenes ramp this so the burst builds. */
  p?: number;
}> = ({ frame, width, height, count = 34, p = 1 }) => {
  const items = [];
  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random from the index alone.
    const r1 = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const r2 = ((Math.sin(i * 78.233) * 12345.6789) % 1 + 1) % 1;
    const r3 = ((Math.sin(i * 45.164) * 91234.5678) % 1 + 1) % 1;

    const delay = r1 * 34;
    const local = Math.max(0, frame - delay);
    const rise = easeOut(Math.min(1, local / 46));
    const size = width * (0.018 + r2 * 0.028);
    const x = r1 * width;
    // Rises from below the frame to a resting band across the lower third.
    const restY = height * (0.66 + r3 * 0.3);
    const y = interpolate(rise, [0, 1], [height * 1.12, restY]);
    const spin = (r2 - 0.5) * 90 * rise;
    const color = r3 > 0.72 ? '#2b2d33' : AMBER;

    items.push(
      <div
        key={i}
        style={{
          position: 'absolute',
          left: x,
          top: y,
          transform: `translate(-50%,-50%) rotate(${spin}deg)`,
          opacity: Math.min(1, rise * 1.6) * p,
        }}
      >
        <Shape kind={SHAPES[i % SHAPES.length]} size={size} color={color} />
      </div>,
    );
  }
  return <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>{items}</div>;
};

// ── Shared type styles ───────────────────────────────────────────────────────

export const displayStyle = (s: number, weight = 700): React.CSSProperties => ({
  fontFamily: INTER_FAMILY,
  fontSize: Math.round(64 * s),
  fontWeight: weight,
  letterSpacing: '-0.028em',
  lineHeight: 1.16,
  textAlign: 'center',
});

export const monoStyle = (s: number): React.CSSProperties => ({
  fontFamily: MONO_FAMILY,
  fontSize: Math.round(30 * s),
  letterSpacing: '-0.01em',
});

/** Full-frame flat fill — the hard-cut flash frames (amber or ink). */
export const Flat: React.FC<{ color?: string; children?: React.ReactNode }> = ({
  color = INK,
  children,
}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: color,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    {children}
  </div>
);
