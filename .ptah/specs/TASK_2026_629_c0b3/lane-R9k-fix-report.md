# Lane report R9k fix round

- `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts:4`: import `TileLayout` directly from `./canvas-layout.service`, removing the canvas project's self-import through its barrel.
- `libs/frontend/canvas/src/lib/canvas-layout.service.spec.ts:125`: renamed the test to `TileLayout keeps the shape Tribunal consumes`. Its typed fixture now reads `x`, `y`, `w`, and `h` individually, so changing a field breaks compilation instead of comparing the fixture with its own literal.
- Check: `node .ptah/tmp/check-run.mjs r9kf-layout -- npx nx test @ptah-extension/canvas --testFile=canvas-layout.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` — exit 0. `Tests:       5 passed, 5 total`.
