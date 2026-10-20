import { PROVIDER_BRAND_ART } from '@ptah-extension/ui/provider-brand-art';
import { PROVIDER_BRAND_SLUGS } from '@ptah-extension/ui';
import type { CommandWorkNode } from '../model/command-center.store';

export interface SpritePalette {
  readonly lit: string;
  readonly mid: string;
  readonly dark: string;
  readonly rim: string;
}

export type CanvasFactory = () => HTMLCanvasElement;

export interface SpriteRequest {
  readonly node: CommandWorkNode;
  readonly theme: 'light' | 'dark';
  readonly paletteName: string;
  readonly palette: SpritePalette;
  readonly size: number;
  readonly dpr: number;
}

const SHIELD = 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z';

function monogram(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  return (
    words.length > 1 ? words[0][0] + words[1][0] : label.slice(0, 2)
  ).toUpperCase();
}

/** Prepared once per changed node snapshot, never assembled in the render loop. */
export class SpriteCache {
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly voiceHalos = new Map<string, HTMLCanvasElement>();
  private readonly nodeKeys = new Map<
    string,
    {
      signature: string;
      key: string;
      node: CommandWorkNode;
      palette: SpritePalette;
      size: number;
      dpr: number;
      paletteName: string;
    }
  >();
  private theme: 'light' | 'dark' | null = null;
  private readonly logo: HTMLImageElement | null;
  private logoReady = false;

  public constructor(
    private readonly createCanvas: CanvasFactory,
    logoUri?: string,
    private readonly onLogoReady?: () => void,
  ) {
    this.logo = logoUri && typeof Image !== 'undefined' ? new Image() : null;
    if (this.logo) {
      this.logo.onload = () => {
        this.logoReady = true;
        this.onLogoReady?.();
      };
      this.logo.onerror = () => {
        this.logoReady = false;
      };
      this.logo.src = logoUri ?? '';
    }
  }

  /** Release sprites for nodes that left the current scene snapshot. */
  public prune(liveNodeIds: ReadonlySet<string>): void {
    for (const id of this.nodeKeys.keys()) {
      if (!liveNodeIds.has(id)) this.nodeKeys.delete(id);
    }
    const liveKeys = new Set(
      [...this.nodeKeys.values()].map((entry) => entry.key),
    );
    for (const key of this.sprites.keys()) {
      if (!liveKeys.has(key)) {
        const canvas = this.sprites.get(key);
        if (canvas) {
          canvas.width = 0;
          canvas.height = 0;
        }
        this.sprites.delete(key);
      }
    }
  }

  public get(request: SpriteRequest): HTMLCanvasElement {
    if (this.theme !== request.theme) {
      for (const canvas of this.sprites.values()) {
        canvas.width = 0;
        canvas.height = 0;
      }
      for (const canvas of this.voiceHalos.values()) {
        canvas.width = 0;
        canvas.height = 0;
      }
      this.sprites.clear();
      this.voiceHalos.clear();
      this.nodeKeys.clear();
      this.theme = request.theme;
    }
    const { node, palette, paletteName, theme } = request;
    const previous = this.nodeKeys.get(node.id);
    if (
      previous?.node === node &&
      previous.palette === palette &&
      previous.size === request.size &&
      previous.dpr === request.dpr &&
      previous.paletteName === paletteName &&
      previous.signature.includes(
        `logo:${node.parentId === null && this.logoReady}`,
      )
    ) {
      const sprite = this.sprites.get(previous.key);
      if (sprite) return sprite;
    }
    const root = node.parentId === null;
    const tribunal = node.kind === 'tribunal';
    const satellite = node.kind === 'lane' || node.kind === 'phase';
    const size = Math.max(satellite ? 32 : 12, request.size);
    const dpr = Math.max(1, Math.min(2, request.dpr));
    const slug =
      !root && node.providerId
        ? (PROVIDER_BRAND_SLUGS[node.providerId] ?? '')
        : '';
    const fallback = tribunal
      ? ''
      : root
        ? 'P'
        : slug
          ? ''
          : monogram(node.label);
    const signature = [
      theme,
      paletteName,
      size,
      dpr,
      slug,
      fallback,
      tribunal,
      `logo:${root && this.logoReady}`,
      palette.lit,
      palette.mid,
      palette.dark,
      palette.rim,
    ].join('|');
    const key = previous?.signature === signature ? previous.key : signature;
    this.nodeKeys.set(node.id, {
      signature,
      key,
      node,
      palette,
      size: request.size,
      dpr: request.dpr,
      paletteName,
    });
    const cached = this.sprites.get(key);
    if (cached) return cached;

    const canvas = this.createCanvas();
    const pixels = Math.ceil(size * 2.2 * dpr);
    canvas.width = pixels;
    canvas.height = pixels;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    context.scale(dpr, dpr);
    const center = pixels / (2 * dpr);
    const radius = size / 2;
    const glow = context.createRadialGradient(
      center,
      center,
      radius * 0.45,
      center,
      center,
      radius * 1.1,
    );
    glow.addColorStop(0, palette.rim);
    glow.addColorStop(1, 'transparent');
    context.globalAlpha = 0.2;
    context.fillStyle = glow;
    context.beginPath();
    context.arc(center, center, radius * 1.1, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    const face = context.createRadialGradient(
      center - radius * 0.34,
      center - radius * 0.4,
      radius * 0.03,
      center + radius * 0.16,
      center + radius * 0.12,
      radius * 1.18,
    );
    face.addColorStop(0, palette.lit);
    face.addColorStop(0.42, palette.mid);
    face.addColorStop(1, palette.dark);
    context.fillStyle = face;
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.rim;
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = 'rgba(255,255,255,0.24)';
    context.beginPath();
    context.ellipse(
      center - radius * 0.31,
      center - radius * 0.48,
      radius * 0.33,
      radius * 0.14,
      -0.5,
      0,
      Math.PI * 2,
    );
    context.fill();
    if (!root) {
      context.beginPath();
      context.arc(center, center, radius * 0.59, 0, Math.PI * 2);
      context.fillStyle =
        theme === 'dark' ? 'rgba(10,15,23,0.69)' : 'rgba(255,252,245,0.8)';
      context.fill();
      context.strokeStyle = palette.rim;
      context.lineWidth = 1;
      context.stroke();
    }

    const artwork = slug ? PROVIDER_BRAND_ART[slug] : undefined;
    if (root) {
      if (this.logoReady && this.logo) {
        context.save();
        context.beginPath();
        context.arc(center, center, radius * 0.91, 0, Math.PI * 2);
        context.clip();
        const extent = radius * 1.82;
        context.drawImage(
          this.logo,
          center - extent / 2,
          center - extent / 2,
          extent,
          extent,
        );
        context.restore();
      } else {
        context.fillStyle = theme === 'dark' ? '#fff3ce' : '#2f241b';
        context.font = `600 ${Math.round(radius * 0.93)}px Georgia`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('P', center, center + 2);
      }
    } else if (artwork || tribunal) {
      const box = (artwork?.viewBox ?? '0 0 24 24').split(' ').map(Number);
      const extent = Math.max(tribunal ? 12 : 12, radius * 0.86);
      context.save();
      context.translate(center - extent / 2, center - extent / 2);
      context.scale(extent / box[2], extent / box[3]);
      context.translate(-box[0], -box[1]);
      context.fillStyle = theme === 'dark' ? palette.lit : '#2f241b';
      context.strokeStyle = palette.rim;
      if (tribunal) {
        context.lineWidth = 2;
        context.lineJoin = 'round';
        context.stroke(new Path2D(SHIELD));
      } else if (artwork) {
        for (const part of artwork.paths) {
          context.globalAlpha = part.opacity ?? 1;
          context.fillStyle =
            theme === 'dark' ? (part.fill ?? palette.lit) : '#2f241b';
          context.fill(new Path2D(part.d), part.fillRule ?? 'nonzero');
        }
      }
      context.restore();
    } else {
      context.fillStyle = theme === 'dark' ? palette.lit : '#2f241b';
      context.font = `700 ${Math.max(12, Math.round(radius * 0.47))}px ui-monospace`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(fallback, center, center + 1);
    }
    this.sprites.set(key, canvas);
    return canvas;
  }

  /** Static soft halo; live microphone and speaker levels affect only the blit. */
  public getVoiceHalo(
    request: Pick<SpriteRequest, 'theme' | 'paletteName' | 'palette' | 'dpr'>,
  ): HTMLCanvasElement {
    const dpr = Math.max(1, Math.min(2, request.dpr));
    const key = [
      request.theme,
      request.paletteName,
      request.palette.rim,
      dpr,
    ].join('|');
    const cached = this.voiceHalos.get(key);
    if (cached) return cached;
    for (const canvas of this.voiceHalos.values()) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.voiceHalos.clear();
    const canvas = this.createCanvas();
    canvas.width = Math.ceil(192 * dpr);
    canvas.height = Math.ceil(192 * dpr);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context unavailable');
    context.scale(dpr, dpr);
    const glow = context.createRadialGradient(96, 96, 37, 96, 96, 96);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(0.49, request.palette.rim);
    glow.addColorStop(1, 'transparent');
    context.globalAlpha = 0.28;
    context.fillStyle = glow;
    context.fillRect(0, 0, 192, 192);
    this.voiceHalos.set(key, canvas);
    return canvas;
  }
}
