# api-youtube

`@ptah-api/youtube` — the **one** outbound integration with the YouTube Data API
v3 (TASK_2026_177, Phase 3). It resolves a video id or URL into
`{ videoId, title, durationSeconds, thumbnailUrl }` **once, at authoring time**,
and nothing else.

## The boundary, in one paragraph

This lib owns **one outbound integration** and **no persistence**. It never sees
Prisma, never sees a `MemberContext`, never sees an HTTP request or response,
and **never throws** — every outcome, including a timeout and a malformed
upstream body, folds into a discriminated `YouTubeFetchResult`. It is consumed
by `@ptah-api/learning` (Batch 9, `lessons/lesson-video.service.ts` — and per
NFR-P6 that is the _only_ file in that lib permitted to import it) and by
`@ptah-api/community` for `LiveSession` metadata (Phase 4, plan R3.2) —
**verbatim, as this same provider, never as a second implementation**.

## Dependencies: it imports nothing from `libs/api/*`, deliberately

`type:util` under `scope:api`. The workspace boundary rule
(`eslint.config.mjs`, `{ sourceTag: 'type:util', onlyDependOnLibsWithTags:
['type:util'] }`) means a `type:util` lib may only reach other `type:util` libs.
`api-core`, `api-identity`, `api-audit` and `api-membership` are **all**
`["scope:api","type:util"]`, so this lib _would be permitted_ to depend on any of
them.

**It depends on none of them.** `ConfigService` comes from `@nestjs/config` and
`Logger` from `@nestjs/common` — both npm packages, outside the Nx tag graph
entirely. That is exactly how `GoogleAuthProvider`
(`libs/api/community/src/lib/google-sessions/google-auth.provider.ts:1-3`) is
built, and it is what keeps this lib importable from `type:util` and
`type:feature` consumers alike without a boundary argument. Both halves of that
finding are recorded here so the next reader does not re-litigate RISK-Q.

## What it does not do (RK-1, RK-6, §4.5)

No OAuth, no upload pipeline, no channel write access, no quota tracking, no
backoff scheduler, and **no metadata refresh cron** — `refresh-metadata` is a
_manual_ admin action, deliberately, because an automatic refresh job
reintroduces the quota surface the authoring-time decision removed.

No cache, no TTL, no Redis: **persistence is the cache** (§4.5). Metadata is
fetched once and written onto `Lesson`; a member page view issues zero
third-party calls (NFR-P6). There is nothing to cache because there is no
read-path call.

No `googleapis` npm package — native `fetch` plus an `AbortController` bounded
at 10,000 ms, matching `GoogleAuthProvider`'s explicit decision.

## Feature-off is a first-class outcome, not an error

`YOUTUBE_API_KEY` is read **once** in the provider constructor via
`ConfigService` (NFR-S6 — never `process.env`). When it is unset,
`isEnabled()` is `false`, `fetchVideo()` returns `{ ok: false, skipped: true }`
and logs **once**. `skipped` is a **distinct arm of the union**, not
`error: 'disabled'`: a caller pattern-matching on `error` must be structurally
unable to treat "the feature is off" as "the video is broken", because the admin
save is supposed to proceed with `videoMetadataSource: 'manual'` (R2.2.6).

**The API key never crosses to the client** (RK-6). It is in no returned object
and in no log line, and a spec asserts both.

## The barrel does not export the Zod schema, on purpose

`src/index.ts` exports `YoutubeModule`, `YouTubeMetadataProvider`,
`extractVideoId`, `parseIso8601Duration`, `VIDEO_ID_PATTERN` and the types.

It does **not** export `youtube.schemas.ts`. A consumer that can reach the
schema can parse a hand-written object into a `YouTubeVideoMetadata` that never
went through `fetchVideo` — which is the one thing this lib exists to prevent.
