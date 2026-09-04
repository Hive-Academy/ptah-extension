---
name: "webgl-asset-pipeline"
description: "glTF/GLB compression and budget enforcement for web 3D. Use when inspecting or auditing 3D models, extracting sub-meshes from a large scene, compressing geometry with Meshopt or Draco, transcoding textures to KTX2/Basis, baking lighting to reduce material cost, or enforcing asset size budgets in CI. Covers gltf-transform workflows and the loader wiring each compression choice requires."
source: harness
---

# WebGL Asset Pipeline

Turning artist-authored or marketplace glTF models into assets a site can actually ship.

The governing fact: **a raw Sketchfab-grade model is one to two orders of magnitude too
large for a first load.** Compression is a prerequisite for building the scene, not a
polish pass afterwards. Build the pipeline before you build the environment, or you will
tune a scene against numbers that change underneath you.

## Tooling

`@gltf-transform/cli` is the workhorse. It is scriptable, deterministic, and reports before
and after sizes — which is what makes budgets enforceable.

```bash
npm i -D @gltf-transform/cli
```

Keep the pipeline as a **committed script**, never as remembered commands. A forker must be
able to reproduce every shipped asset from the sources in the repository.

## Step 1 — Inspect before you touch anything

```bash
gltf-transform inspect assets/model/scene.gltf
```

Read off: mesh count, triangle count, texture count and resolution, material count, and
whether the file uses PBR maps it does not need. Record this. It tells you which of the
steps below will actually pay, and it is the only way to know whether a large scene
contains the sub-object you were hoping to extract.

Large "map" or "town" models frequently contain named nodes for individual buildings. That
makes extraction viable and is usually cheaper than sourcing a separate model.

## Step 2 — Prune and dedupe

The cheapest wins, before any lossy step:

```bash
gltf-transform prune  in.glb out.glb     # drop unused nodes, materials, textures
gltf-transform dedup  in.glb out.glb     # merge identical accessors/textures
gltf-transform resize in.glb out.glb --width 1024 --height 1024
```

Texture resolution is almost always the single largest line item. A 4K texture on an object
that occupies 200 px of screen is pure waste — resize before reaching for fancier tools.

## Step 3 — Geometry compression

**Prefer Meshopt over Draco.** Draco compresses slightly smaller but decodes noticeably
slower, and decode time lands on the main thread during the exact moment the user is waiting.

```bash
gltf-transform meshopt in.glb out.glb --level medium
```

Use Draco only when the payload must be as small as physically possible and decode cost is
acceptable. `--level high` on Meshopt quantises aggressively and can visibly warp
low-poly geometry — check the silhouette after, especially on stylised models where the
whole read is the silhouette.

## Step 4 — Texture transcoding

KTX2/Basis textures stay compressed **in GPU memory**, not just on the wire. This matters
more than the download saving: PNG and JPEG decompress to raw RGBA on the GPU, so a scene
that downloads acceptably can still exhaust VRAM on a mid-range phone.

```bash
gltf-transform uastc in.glb out.glb --level 4 --rdo 4    # normal/detail maps
gltf-transform etc1s in.glb out.glb --quality 200        # colour maps
```

ETC1S is far smaller and right for base colour. UASTC preserves detail and is right for
normal maps, where ETC1S artefacts are obvious.

## Step 5 — Bake lighting where the art allows

For a stylised scene, baking ambient occlusion and lighting into the base colour texture
lets you drop from `MeshStandardMaterial` to `MeshBasicMaterial`. That removes per-pixel
lighting work entirely and is often the single largest frame-rate win available — at the
cost of static lighting, which for a fixed camera path is usually no cost at all.

## Loader wiring

Every compression choice requires a matching decoder, registered **once**:

```ts
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
loader.setKTX2Loader(ktx2);
loader.setMeshoptDecoder(MeshoptDecoder);
```

Two failure modes to recognise:

- **KTX2 without `detectSupport(renderer)`** throws at load time on some devices.
- **Meshopt without the decoder registered** fails with an opaque parse error that reads
  like a corrupt file.

## Budgets

Give every asset a byte budget in a manifest and fail the build when output exceeds it.
Budgets that live only in a document are budgets that get exceeded silently, one landmark
at a time, across sessions.

Reasonable starting points for a landmark-based site:

| Asset class | Compressed budget |
|---|---|
| Hero landmark (close inspection) | 1.5–2 MB |
| Secondary landmark | 0.5–1 MB |
| Background/environment | 1–1.5 MB |
| Character prop | 0.5–1 MB |
| **Total initial load** | **under 5 MB** |

Anything only reachable after a deliberate interaction should be lazily loaded and excluded
from the initial budget.

## Verify after compressing

Compression is lossy and glTF tooling can produce files that load but render wrong. After
every pipeline change:

1. `gltf-transform validate` on the output.
2. Load it in the actual scene — not a viewer — and compare silhouette and colour.
3. Check the texture memory figure in `renderer.info`, not just the file size.
4. Confirm it loads on a real mobile device, where the KTX2 transcoder path differs.

## Licensing

If sources are CC-BY or similar, compression does not discharge the attribution
obligation — the output is a derivative work and carries the same terms. Keep attribution
data alongside the manifest so an asset cannot be added without its credit, and assert the
pairing in a test.

