/**
 * Root — Remotion entry. Registers the single parametric ShowcaseVideo
 * composition. width/height/fps/durationInFrames are derived per-render from
 * the `manifest` prop via calculateMetadata, so the resolution tiers driven by
 * PTAH_SHOWCASE_RES (1080p/1440p/4k) flow through automatically (AC-5).
 */
import React from 'react';
import { Composition, registerRoot } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';
import { sceneManifestSchema } from './lib/load-manifest';
import {
  ShowcaseVideo,
  totalDurationInFrames,
  OUTPUT_FPS,
  type ShowcaseVideoProps,
} from './ShowcaseVideo';
import {
  PromoReel,
  PROMO_FPS,
  promoDims,
  promoDurationInFrames,
  type PromoReelProps,
} from './PromoReel';

// Fallback metadata used only when the composition is opened in the studio
// without props (e.g. picking it from the sidebar before render-all wires
// real props). render-all.mjs always supplies a real manifest.
const FALLBACK_MANIFEST: ShowcaseVideoProps['manifest'] = {
  scene: 'preview',
  title: 'Showcase Preview',
  recordStartMs: 0,
  durationMs: 6000,
  res: { width: 1920, height: 1080 },
  beats: [],
};

const calculateMetadata: CalculateMetadataFunction<ShowcaseVideoProps> = ({
  props,
}) => {
  const manifest = props.manifest ?? FALLBACK_MANIFEST;
  // Output size = explicit --out-res override (render-all) if present, else the
  // capture res from the manifest (native). When the capture is taller than the
  // output, the footage is supersampled — DeviceFrame scales it down and the
  // camera may punch in further (see props.supersample / dynamicMaxScale).
  const width = props.outRes?.width ?? manifest.res.width;
  const height = props.outRes?.height ?? manifest.res.height;
  return {
    width,
    height,
    fps: OUTPUT_FPS,
    durationInFrames: totalDurationInFrames(
      manifest,
      props.introMs,
      props.outroMs,
    ),
  };
};

// Studio-only fallback so PromoReel can be opened without props. Loads the REAL
// generated props (spec + actual Kokoro clip durations + narration wavs + music
// + SFX, staged into public/ by scripts/stage-preview) so the studio previews
// the full 10-scene video at true pacing WITH audio — matching the final render
// exactly. Regenerate with: node scripts/render-promo.mjs (which rebuilds the
// per-scene props at render time regardless of this fallback).
import previewProps from '../preview.props.json';

const FALLBACK_PROMO = previewProps as unknown as PromoReelProps;

// Studio-only preview entries for the new 3D concept scenes, so they can be
// opened from the sidebar with zero props editing (the dyad PromoReel preview
// above is left untouched). Each wraps PromoReel with its promo spec baked in.
import assetSheetSpec from '../promos/asset-sheet.json';
import agentShowcaseSpec from '../promos/agent-showcase-pilot.json';
import stateOfArtProofSpec from '../promos/state-of-art-proof.json';
import ptahSaasStorySpec from '../promos/ptah-saas-story.json';

// These are silent single-slide scenes, so the narration/clip-duration arrays
// PromoReel indexes per slide (clipDurationsMs[i], narrationFiles[i]) are empty
// — slide timing then falls back to each slide's holdMs.
const ASSET_SHEET_PROMO = {
  spec: assetSheetSpec,
  clipDurationsMs: [],
  narrationFiles: [],
} as unknown as PromoReelProps;
const AGENT_SHOWCASE_PROMO = {
  spec: agentShowcaseSpec,
  clipDurationsMs: [],
  narrationFiles: [],
} as unknown as PromoReelProps;
const STATE_OF_ART_PROOF_PROMO = {
  spec: stateOfArtProofSpec,
  clipDurationsMs: [],
  narrationFiles: [],
} as unknown as PromoReelProps;
const PTAH_SAAS_STORY_PROMO = {
  spec: ptahSaasStorySpec,
  clipDurationsMs: [],
  narrationFiles: [],
} as unknown as PromoReelProps;

const calculatePromoMetadata: CalculateMetadataFunction<PromoReelProps> = ({
  props,
}) => {
  const spec = props.spec ?? FALLBACK_PROMO.spec;
  const { width, height } = promoDims(spec);
  return {
    width,
    height,
    fps: PROMO_FPS,
    durationInFrames: promoDurationInFrames(spec, props.clipDurationsMs ?? []),
  };
};

const RemotionRoot: React.FC = () => {
  return (
    <>
    {/* PromoReel registered first so the studio opens it by default — the
        capture-based ShowcaseVideo below needs a real recording and throws a
        MediaPlaybackError when opened with empty fallback props. */}
    <Composition
      id="PromoReel"
      component={PromoReel}
      width={promoDims(FALLBACK_PROMO.spec).width}
      height={promoDims(FALLBACK_PROMO.spec).height}
      fps={PROMO_FPS}
      durationInFrames={promoDurationInFrames(FALLBACK_PROMO.spec)}
      schema={undefined}
      calculateMetadata={calculatePromoMetadata}
      defaultProps={FALLBACK_PROMO}
    />
    {/* New 3D concept scenes — click these in the sidebar to preview the GLB
        harness / brandified asset sheet interactively before a full render. */}
    <Composition
      id="AssetSheet"
      component={PromoReel}
      width={promoDims(ASSET_SHEET_PROMO.spec).width}
      height={promoDims(ASSET_SHEET_PROMO.spec).height}
      fps={PROMO_FPS}
      durationInFrames={promoDurationInFrames(ASSET_SHEET_PROMO.spec)}
      schema={undefined}
      calculateMetadata={calculatePromoMetadata}
      defaultProps={ASSET_SHEET_PROMO}
    />
    <Composition
      id="AgentShowcase"
      component={PromoReel}
      width={promoDims(AGENT_SHOWCASE_PROMO.spec).width}
      height={promoDims(AGENT_SHOWCASE_PROMO.spec).height}
      fps={PROMO_FPS}
      durationInFrames={promoDurationInFrames(AGENT_SHOWCASE_PROMO.spec)}
      schema={undefined}
      calculateMetadata={calculatePromoMetadata}
      defaultProps={AGENT_SHOWCASE_PROMO}
    />
    {/* State-of-the-art proof — remocn motion-design + high-fidelity abstract
        3D glass hero. Open from the sidebar to preview the new aesthetic. */}
    <Composition
      id="StateOfArtProof"
      component={PromoReel}
      width={promoDims(STATE_OF_ART_PROOF_PROMO.spec).width}
      height={promoDims(STATE_OF_ART_PROOF_PROMO.spec).height}
      fps={PROMO_FPS}
      durationInFrames={promoDurationInFrames(STATE_OF_ART_PROOF_PROMO.spec)}
      schema={undefined}
      calculateMetadata={calculatePromoMetadata}
      defaultProps={STATE_OF_ART_PROOF_PROMO}
    />
    {/* "From Cold Clone to Scalable SaaS" — the full 8-beat master reel. */}
    <Composition
      id="PtahSaasStory"
      component={PromoReel}
      width={promoDims(PTAH_SAAS_STORY_PROMO.spec).width}
      height={promoDims(PTAH_SAAS_STORY_PROMO.spec).height}
      fps={PROMO_FPS}
      durationInFrames={promoDurationInFrames(PTAH_SAAS_STORY_PROMO.spec)}
      schema={undefined}
      calculateMetadata={calculatePromoMetadata}
      defaultProps={PTAH_SAAS_STORY_PROMO}
    />
    <Composition
      id="ShowcaseVideo"
      component={ShowcaseVideo}
      // Default metadata; overridden by calculateMetadata once props arrive.
      width={FALLBACK_MANIFEST.res.width}
      height={FALLBACK_MANIFEST.res.height}
      fps={OUTPUT_FPS}
      durationInFrames={totalDurationInFrames(FALLBACK_MANIFEST)}
      schema={undefined}
      calculateMetadata={calculateMetadata}
      defaultProps={{
        rawVideo: '',
        manifest: FALLBACK_MANIFEST,
        narrationFiles: {},
        durations: null,
        captions: [],
        source: {
          width: FALLBACK_MANIFEST.res.width,
          height: FALLBACK_MANIFEST.res.height,
          contentHeight: FALLBACK_MANIFEST.res.height,
        },
        shots: [],
        kenBurns: true,
        supersample: false,
      }}
    />
    </>
  );
};

// Keep the schema import referenced (manifest validation lives in the scripts;
// re-exported here so the studio bundle keeps the boundary module live).
void sceneManifestSchema;

registerRoot(RemotionRoot);
