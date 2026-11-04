import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import { OperatorSettingsSchema, RepoIdentitySchema, RepositorySettingsSchema, type OperatorSettings, type RepoIdentity, type RepositorySettings } from '@ptah-extension/review-contracts';
import { PERSISTENCE_TOKENS, SqliteConnectionService } from '@ptah-extension/persistence-sqlite';

export interface IReviewSettingsStore {
  getSettings(): Promise<OperatorSettings | null>;
  updateSettings(settings: OperatorSettings): Promise<OperatorSettings>;
  listRepositories(): Promise<RepositorySettings[]>;
  setPublicationPause(paused: boolean, repo?: RepoIdentity): Promise<void>;
  getLiveGate(): Promise<LiveGateRecord | null>;
  setLiveGate(record: LiveGateRecord | null): Promise<void>;
}

export const LiveGateRecordSchema = z.object({
  repo: RepoIdentitySchema,
  login: z.string().min(1).max(39),
  connectedAt: z.string().datetime(),
  verifiedAt: z.string().datetime(),
  attestation: z.object({ who: z.string().min(1).max(39), when: z.string().datetime(),
    permissions: z.tuple([z.literal('Pull requests: Read and write'), z.literal('Contents: Read'), z.literal('Metadata: Read')]) }).strict().nullable(),
}).strict();
export type LiveGateRecord = z.infer<typeof LiveGateRecordSchema>;

const settingsRow = z.object({ settings_json: z.string() });
const repoRow = z.object({ owner: z.string(), name: z.string(), enabled: z.number(), mode: z.string(), paused: z.number() });

@injectable()
export class ReviewSettingsStore implements IReviewSettingsStore {
  constructor(@inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION) private readonly sqlite: SqliteConnectionService) {}

  async getSettings(): Promise<OperatorSettings | null> {
    const row = this.sqlite.db.prepare('SELECT settings_json FROM review_operator_settings WHERE id = 1').get();
    if (!row) return null;
    const raw = z.record(z.string(), z.unknown()).parse(JSON.parse(settingsRow.parse(row).settings_json));
    const { liveGate: _liveGate, ...settings } = raw;
    return OperatorSettingsSchema.parse(settings);
  }

  async updateSettings(raw: OperatorSettings): Promise<OperatorSettings> {
    const settings = OperatorSettingsSchema.parse(raw);
    const now = Date.now();
    this.sqlite.db.transaction(() => {
      this.sqlite.db.prepare(`INSERT INTO review_operator_settings (id, settings_json, updated_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at`)
        .run(JSON.stringify({ ...settings, liveGate: this.readLiveGate() }), now);
      if (settings.repositories.length === 0) {
        // Preserve repository identity, history, and config_hash for re-enabling.
        this.sqlite.db.prepare('UPDATE review_repositories SET enabled = 0, paused = 1, updated_at = ?').run(now);
      }
      for (const repo of settings.repositories) {
        const id = `${repo.owner.toLowerCase()}/${repo.name.toLowerCase()}`;
        this.sqlite.db.prepare(`INSERT INTO review_repositories
          (repo_id, owner, name, enabled, mode, paused, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(repo_id) DO UPDATE SET enabled = excluded.enabled, mode = excluded.mode,
          paused = excluded.paused, updated_at = excluded.updated_at`)
          .run(id, repo.owner, repo.name, Number(repo.enabled), repo.dryRun ? 'dry_run' : 'live', Number(repo.publicationPaused), now, now);
      }
    })();
    return settings;
  }

  async listRepositories(): Promise<RepositorySettings[]> {
    return this.sqlite.db.prepare('SELECT owner, name, enabled, mode, paused FROM review_repositories ORDER BY owner, name LIMIT 2')
      .all().map((raw) => {
        const row = repoRow.parse(raw);
        return RepositorySettingsSchema.parse({ owner: row.owner, name: row.name, enabled: row.enabled === 1,
          dryRun: row.mode === 'dry_run', publicationPaused: row.paused === 1 });
      });
  }

  async setPublicationPause(paused: boolean, repo?: RepoIdentity): Promise<void> {
    z.boolean().parse(paused);
    if (repo) {
      const identity = RepoIdentitySchema.parse(repo);
      this.sqlite.db.prepare('UPDATE review_repositories SET paused = ?, updated_at = ? WHERE owner = ? AND name = ?')
        .run(Number(paused), Date.now(), identity.owner, identity.name);
    }
    const settings = await this.getSettings();
    if (settings) await this.updateSettings(repo
      ? { ...settings, repositories: settings.repositories.map((entry) =>
          entry.owner === repo.owner && entry.name === repo.name ? { ...entry, publicationPaused: paused } : entry) }
      : { ...settings, globalPublicationPaused: paused });
  }

  private readLiveGate(): LiveGateRecord | null {
    const row = this.sqlite.db.prepare('SELECT settings_json FROM review_operator_settings WHERE id = 1').get();
    if (!row) return null;
    const raw: unknown = JSON.parse(settingsRow.parse(row).settings_json);
    if (typeof raw !== 'object' || raw === null || !('liveGate' in raw)) return null;
    return LiveGateRecordSchema.nullable().parse(raw.liveGate);
  }

  async getLiveGate(): Promise<LiveGateRecord | null> { return this.readLiveGate(); }

  async setLiveGate(record: LiveGateRecord | null): Promise<void> {
    const settings = await this.getSettings();
    if (!settings) {
      if (record === null) return;
      await this.updateSettings({
        repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: false, dryRun: true, publicationPaused: false }],
        maintainerLogins: [], pollMinutes: 10, globalPublicationPaused: false, laneCapPerPr: 6,
        confidenceFloor: 0.8, maxNewInline: 10, fallbackFamilies: [],
      });
    }
    const gate = LiveGateRecordSchema.nullable().parse(record);
    this.sqlite.db.prepare('UPDATE review_operator_settings SET settings_json = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify({ ...(settings ?? await this.getSettings()), liveGate: gate }), Date.now());
  }
}
