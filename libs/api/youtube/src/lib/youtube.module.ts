import { Module } from '@nestjs/common';
import { YouTubeMetadataProvider } from './youtube-metadata.provider';

/**
 * `YoutubeModule` — provides and exports {@link YouTubeMetadataProvider}, and
 * nothing else.
 *
 * ⚠️ DELIBERATELY NOT `@Global()`. There are exactly two consumers —
 * `LearningModule` (Batch 9) and, in Phase 4, the `LiveSession` authoring path
 * in `@ptah-api/community` (plan R3.2) — and both import it explicitly. A
 * global module would make "which modules can reach YouTube" unanswerable by
 * reading imports, which is precisely the question NFR-P6 asks: no YouTube
 * request may fire on a member lesson read, and Task 9.17 asserts that
 * structurally by naming the single file permitted to import this lib.
 *
 * ⚠️ NO `ConfigModule` IMPORT HERE. `ConfigModule.forRoot({ isGlobal: true })`
 * is registered once by the application, so `ConfigService` is already
 * injectable. Re-importing it in a library module would let this lib carry its
 * own configuration posture, which is the thing NFR-S6 centralises.
 */
@Module({
  providers: [YouTubeMetadataProvider],
  exports: [YouTubeMetadataProvider],
})
export class YoutubeModule {}
