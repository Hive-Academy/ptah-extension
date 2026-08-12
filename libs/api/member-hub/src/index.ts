/**
 * `@ptah-api/member-hub` — `GET /v1/members/hub` and `GET /v1/members/entitlement`.
 *
 * The wire types are NOT re-exported here. They live in
 * `@ptah-contracts/community` and both sides — this server and the member panel
 * — import them from there. Re-exporting them would give the frontend a second,
 * server-flavoured import path for the same declaration, which is the drift the
 * contracts lib exists to prevent.
 */
export * from './lib/cohort-badges.service';
export * from './lib/member-entitlement.controller';
export * from './lib/member-hub.controller';
export * from './lib/member-hub.module';
export * from './lib/member-hub.service';
export * from './lib/sections/community.section';
export * from './lib/sections/hub-section';
export * from './lib/sections/learning.section';
export * from './lib/sections/notifications.section';
export * from './lib/sections/packs.section';
export * from './lib/sections/sessions.section';
