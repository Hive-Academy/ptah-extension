# 3D model assets — provenance & license

All models below are **CC0 1.0 Universal (public domain dedication)** — zero
attribution required, commercial-safe. Provenance is tracked here purely for
auditability; CC0 imposes no obligation.

All props are re-skinned at render time by `brandify()` (see `three-assets.tsx`)
to one amber/emerald PBR material language, so mixed-fidelity sources read as a
cohesive set. The "theme" column maps each prop to a Ptah knowledge-base pillar
(`docs/feature-knowledge-base.md`).

| File                  | Theme / pillar                                   | Source URL                                                                                                | License                                               |
| --------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `RobotExpressive.glb` | Hero "agent" (orchestration)                     | https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/RobotExpressive/RobotExpressive.glb      | CC0 1.0 — © Tomás Laulhé, modifications © Don McCurdy |
| `drone.glb`           | Agent squad unit (orchestration)                 | https://poly.pizza/m/lF3jeRJwiH (GLB: https://static.poly.pizza/abb31ff6-3e2d-43a6-bf13-dba39b0c596d.glb) | CC0 1.0 — Poly Pizza (Public Domain)                  |
| `rocket.glb`          | SaaS launch                                      | https://poly.pizza/m/9awwTQWYux (GLB: https://static.poly.pizza/244c027c-40f0-45ca-a707-0f8e855c9831.glb) | CC0 1.0 — Poly Pizza (Public Domain)                  |
| `computer.glb`        | Setup wizard console / terminal                  | https://poly.pizza/m/7KNoiQlSxi (GLB: https://static.poly.pizza/ec47fb93-0286-4dc1-b434-9292c6a7eb77.glb) | CC0 1.0 — Poly Pizza (Public Domain)                  |
| `BoomBox.glb`         | Nx / data-center unit (stand-in)                 | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BoomBox                               | CC0 1.0 — glTF-Sample-Assets                          |
| `Lantern.glb`         | Emissive beacon prop                             | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Lantern                               | CC0 1.0 — © Microsoft, Frank Galligan                 |
| `ToyCar.glb`          | Glossy PBR reference (library; not on the sheet) | https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/ToyCar                                | CC0 1.0 — glTF-Sample-Assets                          |

**Substitution note:** no genuinely-CC0 _server rack / data-center_ model was
found on Poly Pizza (the CC0 hits were shelves/crates; real racks there are
CC-BY, rejected). `BoomBox` is used, brandified, as the data-unit stand-in, and
a hexagonal prism is built from primitives in the scene for the Nx pillar.

## Notes for the next person

- These were chosen for **verified CC0 status + reliable direct GLB URLs** so
  the render pipeline never depends on a flaky CDN. `DamagedHelmet` and
  `SciFiHelmet` from the same Khronos repo were deliberately **rejected** —
  they are CC-BY / CC-BY-NC, not CC0.
- `RobotExpressive` is the thematic "agent" hero and is tiny (~464 KB). The
  Khronos props are heavier (5–11 MB) because they ship high-res PBR textures;
  keep an eye on total `public/models/` size if you add more.
- To add a model: drop a CC0 `.glb` here, record it in this table, then
  reference it from a scene via `<GltfModel src="models/<file>.glb" … />`.
  `scripts/render-promo.mjs` stages `public/models/` into each render's public
  dir automatically (see `stageModels`), so `staticFile()` resolves it in both
  Remotion Studio and headless renders.
