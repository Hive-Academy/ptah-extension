import 'reflect-metadata';
import {
  MIGRATIONS,
  SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import { Logger } from '@ptah-extension/vscode-core';
import {
  ReviewSettingsStore,
  type LiveGateRecord,
} from './review-settings.store';

describe('ReviewSettingsStore', () => {
  it('round trips validated operator and repository settings in migration 0065', async () => {
    const Database = require('better-sqlite3') as new (
      path: string,
    ) => SqliteDatabase;
    const db = new Database(':memory:');
    try {
      const migration = MIGRATIONS.find((entry) => entry.version === 65);
      if (!migration?.sql) throw new Error('Review migration missing');
      db.exec(migration.sql);
      const logger = Object.create(Logger.prototype) as Logger;
      const connection = new SqliteConnectionService(':memory:', logger);
      Object.defineProperty(connection, 'db', { value: db });
      const store = new ReviewSettingsStore(connection);
      const settings = {
        repositories: [
          {
            owner: 'Hive-Academy',
            name: 'PtahCode',
            enabled: true,
            dryRun: true,
            publicationPaused: false,
          },
        ],
        maintainerLogins: ['maintainer'],
        pollMinutes: 30,
        globalPublicationPaused: false,
        laneCapPerPr: 6,
        confidenceFloor: 0.8,
        maxNewInline: 10,
        fallbackFamilies: [],
      } as const;
      await store.updateSettings({
        ...settings,
        repositories: [...settings.repositories],
        maintainerLogins: [...settings.maintainerLogins],
        fallbackFamilies: [],
      });
      expect(await store.getSettings()).toEqual(settings);
      const gate: LiveGateRecord = {
        repo: { owner: 'Hive-Academy', name: 'PtahCode' },
        login: 'ptah-bot',
        connectedAt: '2026-11-04T00:00:00.000Z',
        verifiedAt: '2026-11-04T00:00:00.000Z',
        attestation: {
          who: 'maintainer',
          when: '2026-11-04T00:01:00.000Z',
          permissions: [
            'Pull requests: Read and write',
            'Contents: Read',
            'Metadata: Read',
          ],
        },
      };
      await store.setLiveGate(gate);
      expect(await store.getLiveGate()).toEqual(gate);
      await store.updateSettings({
        ...settings,
        repositories: [...settings.repositories],
        maintainerLogins: [...settings.maintainerLogins],
        fallbackFamilies: [],
      });
      expect(await store.getLiveGate()).toEqual(gate);
      await store.setLiveGate(null);
      expect(await store.getLiveGate()).toBeNull();
      expect(await store.listRepositories()).toEqual(settings.repositories);
      await store.setPublicationPause(true, {
        owner: 'Hive-Academy',
        name: 'PtahCode',
      });
      expect(
        (await store.getSettings())?.repositories[0].publicationPaused,
      ).toBe(true);
      expect(await store.listRepositories()).toMatchObject([
        { publicationPaused: true },
      ]);
      await store.updateSettings({
        ...settings,
        repositories: [
          ...settings.repositories,
          {
            owner: 'Acme',
            name: 'Widget',
            enabled: false,
            dryRun: true,
            publicationPaused: false,
          },
        ],
        maintainerLogins: [],
        fallbackFamilies: [],
      });
      expect(await store.listRepositories()).toHaveLength(2);
      await store.updateSettings({
        ...settings,
        repositories: [
          {
            owner: 'Acme',
            name: 'Widget',
            enabled: true,
            dryRun: true,
            publicationPaused: false,
          },
        ],
        maintainerLogins: [],
        fallbackFamilies: [],
      });
      expect(
        db
          .prepare('SELECT repo_id, enabled, paused FROM review_repositories ORDER BY repo_id')
          .all(),
      ).toEqual([
        { repo_id: 'acme/widget', enabled: 1, paused: 0 },
        { repo_id: 'hive-academy/ptahcode', enabled: 0, paused: 1 },
      ]);
      await store.updateSettings({
        ...settings,
        repositories: [],
        maintainerLogins: [],
        fallbackFamilies: [],
      });
      expect(await store.listRepositories()).toEqual([]);
      expect(await store.getSettings()).toMatchObject({ repositories: [] });
    } finally {
      db.close();
    }
  });
});
