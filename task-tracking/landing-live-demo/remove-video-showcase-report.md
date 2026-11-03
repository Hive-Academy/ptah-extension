# Remove landing video showcase

## Files deleted

- `libs/web/landing/src/lib/sections/video-showcase/video-showcase.component.ts` — removed the stale YouTube section and its `video-showcase/` folder.
- `libs/web/landing/src/lib/console/device-frame.component.ts` — removed its sole component dependency.

## Files edited

- `libs/web/landing/src/lib/landing-page.component.ts` — removed the video component import, Angular `imports` entry, and template element.
- `libs/web/landing/src/index.ts` — removed exports of the video and device frame components.
- `apps/ptah-electron-e2e/src/showcase/landing-page-tour.scene.ts` — moved the demo shot to `#live-demo` and its visible replay panel; replaced the stale section comment and camera target.
- `package.json` — removed `@angular/youtube-player`.

## Kept and why

- `git grep -n -E 'DeviceFrameComponent|device-frame.component'` found only the component itself, its landing barrel export, its import in the deleted video component, and a tooling data snapshot. No other source imports it.
- `git grep -n '@angular/youtube-player' -- ':!package-lock.json' ':!*.md'` found only the deleted component import and `package.json`. The members `./youtube-player` wrapper imports Angular core and platform browser APIs, not this package; its own usages remain.
- `git grep` for the video ID and video showcase under `apps/ptah-landing-page/public/` found nothing. The deleted component has no local asset path. The files under `public/assets/live-demo/` belong to the new hero demo and remain.
- No component-only spec or story exists under `video-showcase/`.
- Unrelated `video-showcase` skill, video studio, and `content-manifest.json` references remain untouched.
- Post-edit `git grep` across the requested non-Markdown source paths found no remaining `VideoShowcase`, `video-showcase`, `#demo"`, `id="demo"`, video ID, `DeviceFrameComponent`, `device-frame.component`, or `@angular/youtube-player` references.

## Package dependency

Changed: yes. The root dependency entry was removed. `package-lock.json` was intentionally left for coordinator update; no install was run.

## Verification

Started one foreground `npm run verify -- -p web-landing | tail -40` run with pipe failure propagation. It is still queued on the shared verify lock; final result lines are pending.

## Decisions

- The worktree and branch were supplied; no branch or worktree was created because the task forbids checkout and limits edits to the listed scope.
- The tour's external voiceover line 6 describes captured real sessions but does not name the retired YouTube video. It was kept to honor the requested file scope; the scene's stale comment and shot target were updated.
- The pre-existing edit to the deleted video component was a comment about the former `#demo` anchor; deletion is required by the objective.
- No visual review was run because this lane's verification instructions prohibit app and browser targets.
