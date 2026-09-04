---
name: "r3f-scene-patterns"
description: "React Three Fiber scene architecture and render-loop discipline for scroll-driven 3D sites. Use when building R3F components, scroll-bound camera paths, GLTF landmark loading, instanced particle systems, hover/click hit-testing in 3D, adaptive quality tiers, or when a scene drops frames. Covers the R3F-specific failure modes that ordinary React advice gets wrong."
source: harness
---

# React Three Fiber Scene Patterns

Guidance for scroll-driven, landmark-based R3F sites. The rules here exist because R3F
inverts several ordinary React instincts: the render loop runs at 60 Hz outside React, so
anything that triggers a React re-render per frame is a bug, not a style preference.

## The one rule that matters

**Never call `setState` from `useFrame`.**

`useFrame` runs every frame. A `setState` inside it re-renders the React tree 60 times a
second and will tank the frame rate on mid-range mobile. Mutate the object directly instead:

```tsx
// WRONG — re-renders the tree every frame
useFrame((_, delta) => setRotation((r) => r + delta));

// RIGHT — mutates the three.js object, React never re-renders
const ref = useRef<Mesh>(null);
useFrame((_, delta) => {
  if (ref.current) ref.current.rotation.y += delta;
});
```

The same applies to camera position, material uniforms, and instance matrices. React owns
the scene *structure*; the frame loop owns the scene *values*.

State belongs in React only when it changes at human speed — which overlay is open, which
landmark is focused, the resolved quality tier.

## Frame-loop discipline

- **Allocate nothing per frame.** `new Vector3()` inside `useFrame` allocates 60 objects a
  second and hands the GC a sawtooth. Hoist scratch objects to module scope or a ref.
- **Use `delta`, never a frame counter.** Motion tied to frame count runs at different
  speeds on 60 Hz and 120 Hz displays.
- **Prefer one `useFrame` over many.** Each subscription costs a callback per frame; a
  parent that drives its children is cheaper than ten independent subscribers.
- **Use `invalidate()` with `frameloop="demand"`** for scenes that are static between
  interactions. A landmark overlay sitting open does not need 60 FPS behind it.

## Scroll-driven camera on a spline

The camera rides a `CatmullRomCurve3`; scroll position maps to `t` along the curve.

```tsx
const curve = useMemo(() => new CatmullRomCurve3(waypoints), [waypoints]);
const scratch = useMemo(() => new Vector3(), []);

useFrame(() => {
  const t = smoothedScrollProgress.current;   // a ref, not state
  curve.getPointAt(clamp(t, 0, 1), scratch);
  camera.position.lerp(scratch, 0.1);         // damped, not snapped
  camera.lookAt(lookTarget.current);
});
```

Points to get right:

- **Damp the scroll input.** Raw `scrollY` is jittery and trackpad-dependent. Keep a ref of
  the target value and lerp the actual value toward it each frame.
- **Define waypoints as data.** A spline built from a config array is one a forker can
  reorder; one built from inline literals is not.
- **Decouple `lookAt` from position.** The camera should be able to keep facing a landmark
  while continuing to descend past it.
- **Never drive the camera from React state.** Scroll fires far faster than React can
  reconcile.

## Loading GLTF landmarks

```tsx
useGLTF.preload('/models/pineapple.glb');       // module scope, before first paint
const { scene } = useGLTF('/models/pineapple.glb');
```

- **Always `.glb`, never `.gltf` + `.bin` + loose textures.** One request beats twenty.
- **Register the Draco/KTX2 loaders once**, at the `Canvas` level, not per model.
- **Clone before reuse.** `useGLTF` caches the scene graph; placing the same model twice
  without `clone()` moves one object rather than rendering two. Use drei's `<Clone>`.
- **Suspense boundaries per landmark**, not one around the whole scene — otherwise a single
  slow asset blocks everything from appearing.

## Hit-testing landmarks

Raycasting against a detailed mesh is expensive and gives imprecise hover targets on mobile.
Attach the pointer handlers to an **invisible proxy** — a box or sphere roughly enclosing the
landmark — and mark the detailed mesh `raycast={() => null}`:

```tsx
<group>
  <Clone object={scene} raycast={() => null} />
  <mesh visible={false} onPointerOver={onHover} onClick={onOpen}>
    <boxGeometry args={hitBox} />
  </mesh>
</group>
```

Set `document.body.style.cursor` on hover; there is no CSS `:hover` inside a canvas.

## Particles and instancing

Bubbles, plankton, and debris must be **instanced**. A thousand individual meshes is a
thousand draw calls; one `InstancedMesh` is one.

- Write per-instance transforms into the instance matrix inside `useFrame`, then set
  `instanceMatrix.needsUpdate = true` once per frame — not once per instance.
- Randomise phase per instance at init and drive motion from `elapsedTime + phase`, so a
  thousand bubbles do not pulse in lockstep.
- Instance count is the first thing a quality tier should scale down.

## Disposal

R3F disposes what it created when a component unmounts, but **not** what you created
manually. Geometries, materials, and textures built in a `useMemo` need an explicit cleanup:

```tsx
useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
```

Leaked GPU resources are invisible in React DevTools and show up only as a slow climb in
memory across route changes.

## Adaptive quality

Resolve a tier once at startup from device signals, then re-check against sustained frame
rate and downgrade if the scene cannot hold its target. Gate on the tier:

| Tier | Particles | Postprocessing | Shadows | Texture resolution |
|---|---|---|---|---|
| low | few hundred | none | none | half |
| medium | ~1k | bloom only | none | full |
| high | several k | full stack | soft | full |

Downgrade readily and upgrade reluctantly — oscillating between tiers is more noticeable
than simply running at the lower one.

## Testing R3F in jsdom

jsdom has no WebGL context, so a `<Canvas>` cannot mount in a unit test. Mock it and assert
the DOM overlay; cover the scene itself with visual-regression screenshots in a real browser.

```tsx
vi.mock('@react-three/fiber', () => ({ Canvas: () => <div data-testid="canvas" /> }));
```

Do not render children from the stub — three.js primitives are not DOM elements and React
warns on every one.

## Checklist before calling a scene done

- [ ] No `setState` inside any `useFrame`
- [ ] No allocation inside any `useFrame`
- [ ] Motion is `delta`-scaled, not frame-counted
- [ ] Particles are instanced
- [ ] Manually created geometries/materials are disposed
- [ ] Hit targets are invisible proxies, not detailed meshes
- [ ] Models are `.glb` with loaders registered once
- [ ] Holds target FPS on a throttled mobile profile, not just on the dev machine

