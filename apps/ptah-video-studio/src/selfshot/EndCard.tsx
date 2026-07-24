/**
 * EndCard — shared branded call-to-action closing card for ALL self-shot modes.
 *
 * Ptah-since-open-source messaging:
 *   - wordmark + "Free & open source"
 *   - Builders waitlist line with the founding discount (35% monthly / 50% yearly)
 *   - clean display URL (ptah.live/#waitlist — NO query params)
 *   - QR pointing at the attributed target (…?utm_source=youtube#waitlist),
 *     generated at build time by scripts/gen-qr.mjs into waitlist-qr.ts (no
 *     runtime QR dependency).
 *
 * Transparent base so the composition's <Backdrop> shows through and the cut
 * from the body reads as a settle, not a hard slate.
 */
import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { THEME } from '../theme';
import { BRAND } from '../brand.config';
import { WAITLIST_DISPLAY_URL, WAITLIST_QR_SVG } from './waitlist-qr';

export interface EndCardProps {
  /** Optional headline override; defaults to the product name. */
  headline?: string;
}

const QrImage: React.FC<{ size: number }> = ({ size }) => {
  const dataUri = `data:image/svg+xml;base64,${btoa(WAITLIST_QR_SVG)}`;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.08),
        overflow: 'hidden',
        background: '#ffffff',
        padding: Math.round(size * 0.04),
        boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(245,181,68,0.25)',
      }}
    >
      <img src={dataUri} alt="Join the Ptah Builders waitlist" style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
};

export const EndCard: React.FC<EndCardProps> = ({ headline }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 20, mass: 0.6 } });
  const enter2 = spring({ frame: frame - 8, fps, config: { damping: 18, mass: 0.55 } });
  const qrPop = spring({ frame: frame - 14, fps, config: { damping: 16, mass: 0.6 } });
  const pulse = 1 + Math.sin((frame / fps) * 3.0) * 0.015;

  const wordSize = Math.round(height * 0.09);
  const freeSize = Math.round(height * 0.03);
  const ctaSize = Math.round(height * 0.03);
  const discountSize = Math.round(height * 0.024);
  const urlSize = Math.round(height * 0.026);
  const qrSize = Math.round(height * 0.26);
  const isVertical = height > width;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isVertical ? height * 0.05 : width * 0.06,
        padding: '0 8%',
        fontFamily: THEME.font,
        color: THEME.textStrong,
      }}
    >
      {/* Left / top: brand + copy */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isVertical ? 'center' : 'flex-start',
          textAlign: isVertical ? 'center' : 'left',
          maxWidth: isVertical ? '100%' : '58%',
        }}
      >
        <div
          style={{
            opacity: enter,
            transform: `translateY(${interpolate(enter, [0, 1], [26, 0])}px)`,
            fontSize: wordSize,
            fontWeight: 800,
            letterSpacing: -2,
            lineHeight: 1,
          }}
        >
          {headline ?? BRAND.productName}
        </div>

        <div
          style={{
            marginTop: wordSize * 0.28,
            opacity: enter,
            fontSize: freeSize,
            fontWeight: 700,
            letterSpacing: 1,
            color: THEME.emeraldLight,
          }}
        >
          Free &amp; open source
        </div>

        <div
          style={{
            marginTop: freeSize * 1.1,
            opacity: enter2,
            transform: `scale(${interpolate(enter2, [0, 1], [0.9, 1]) * pulse})`,
            transformOrigin: isVertical ? 'center' : 'left center',
            padding: `${ctaSize * 0.55}px ${ctaSize * 1.3}px`,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${THEME.amber}, ${THEME.amberDeep})`,
            color: '#1a1200',
            fontWeight: 800,
            fontSize: ctaSize,
            letterSpacing: 0.3,
            boxShadow: '0 14px 40px rgba(245,158,11,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset',
          }}
        >
          Join the Builders waitlist
        </div>

        <div
          style={{
            marginTop: ctaSize * 0.7,
            opacity: enter2 * 0.95,
            fontSize: discountSize,
            fontWeight: 600,
            color: THEME.textSoft,
            lineHeight: 1.4,
          }}
        >
          Founding members: <span style={{ color: THEME.amberLight, fontWeight: 800 }}>35% off monthly</span>
          {' · '}
          <span style={{ color: THEME.amberLight, fontWeight: 800 }}>50% off yearly</span>
        </div>

        <div
          style={{
            marginTop: discountSize * 1.1,
            opacity: enter2 * 0.9,
            fontSize: urlSize,
            fontWeight: 700,
            letterSpacing: 2,
            color: THEME.textStrong,
          }}
        >
          {WAITLIST_DISPLAY_URL}
        </div>
      </div>

      {/* Right / bottom: QR */}
      <div style={{ opacity: qrPop, transform: `scale(${interpolate(qrPop, [0, 1], [0.8, 1])})` }}>
        <QrImage size={qrSize} />
        <div
          style={{
            marginTop: qrSize * 0.06,
            textAlign: 'center',
            fontSize: Math.round(height * 0.018),
            fontWeight: 600,
            letterSpacing: 2,
            textTransform: 'uppercase',
            color: THEME.textFaint,
          }}
        >
          Scan to join
        </div>
      </div>
    </div>
  );
};
