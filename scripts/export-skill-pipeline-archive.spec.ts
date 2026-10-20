import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { exportArchive } from './export-skill-pipeline-archive';
import { verifySkillPipelineArchive } from '../libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive';

describe('OP-1 archive export', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op1-export-spec-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('copies a temp SQLite DB before archive reads and leaves the source unchanged', () => {
    const source = path.join(dir, 'source.sqlite');
    const Database = require('better-sqlite3') as new (file: string) => {
      exec(sql: string): void;
      close(): void;
    };
    const db = new Database(source);
    db.exec("CREATE TABLE skill_candidates (id TEXT); INSERT INTO skill_candidates VALUES ('one'), ('two')");
    db.close();
    const before = fs.statSync(source);
    const digest = createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const output = path.join(dir, 'archive');
    const { receipt, copyPath } = exportArchive(source, output);
    expect(fs.existsSync(copyPath)).toBe(true);
    expect(receipt.archivePath.startsWith(output)).toBe(true);
    expect(receipt.format).toBe(2);
    expect(receipt.tables).toHaveLength(9);
    expect(receipt.tables[8]?.table).toBe('scheduled_jobs');
    expect(receipt.tables.find((entry) => entry.table === 'skill_candidates')).toMatchObject({ present: true, rows: 2 });
    const entry = receipt.tables.find((item) => item.table === 'skill_candidates');
    expect(entry?.sha256).toBe(createHash('sha256').update(fs.readFileSync(path.join(receipt.archivePath, 'skill_candidates.jsonl'))).digest('hex'));
    expect(verifySkillPipelineArchive(path.join(receipt.archivePath, 'receipt.json'))).toEqual(receipt);
    expect(fs.statSync(source).mtimeMs).toBe(before.mtimeMs);
    expect(createHash('sha256').update(fs.readFileSync(source)).digest('hex')).toBe(digest);
    if (process.platform !== 'win32') {
      expect(fs.statSync(output).mode & 0o777).toBe(0o700);
      expect(fs.statSync(receipt.archivePath).mode & 0o777).toBe(0o700);
      expect(fs.statSync(copyPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.join(receipt.archivePath, 'receipt.json')).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses a database with a live WAL sidecar before making an archive', () => {
    const source = path.join(dir, 'source.sqlite');
    const Database = require('better-sqlite3') as new (file: string) => { close(): void };
    new Database(source).close();
    fs.writeFileSync(`${source}-wal`, 'pending');
    expect(() => exportArchive(source, path.join(dir, 'archive'))).toThrow('sidecar');
    expect(fs.existsSync(path.join(dir, 'archive'))).toBe(false);
  });
});
