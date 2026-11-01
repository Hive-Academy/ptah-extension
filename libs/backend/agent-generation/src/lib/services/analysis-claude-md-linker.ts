import { join } from 'path';
import { inject, injectable } from 'tsyringe';
import { FileType, PLATFORM_TOKENS, type IFileSystemProvider } from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { AGENT_GENERATION_TOKENS } from '../di/tokens';
import { PHASE_CONFIGS } from '../types/multi-phase.types';
import { AnalysisStorageService, isLegacyArchiveDirName } from './analysis-storage.service';
import { normalizeEolBytes, sha256Hex } from './analysis-fingerprint';

const BEGIN = '<!-- ptah:analysis:begin -->';
const END = '<!-- ptah:analysis:end -->';
type LinkResult = { written: boolean; error?: string };
type Candidate = { slug: string; dir: string; files: string[]; at: number; hashes: string[] };

/** Maintains only the marked import block in the workspace root CLAUDE.md. */
@injectable()
export class AnalysisClaudeMdLinker {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE)
    private readonly storage: AnalysisStorageService,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /** Serialize each workspace's read-modify-write cycle within this process. */
  link(workspaceRoot: string): Promise<LinkResult> {
    const path = join(workspaceRoot, 'CLAUDE.md');
    const previous = this.pending.get(path) ?? Promise.resolve();
    const work = previous.then(() => this.linkUnlocked(workspaceRoot, path));
    const settled = work.then(() => undefined);
    this.pending.set(path, settled);
    void settled.then(() => {
      if (this.pending.get(path) === settled) this.pending.delete(path);
    });
    return work;
  }

  private async linkUnlocked(workspaceRoot: string, path: string): Promise<LinkResult> {
    try {
      const analysisRoot = this.storage.getAnalysisDir(workspaceRoot);
      const entries = await this.fs.readDirectory(analysisRoot);
      const candidates: Candidate[] = [];
      let unsafeSlug = false;
      for (const entry of entries) {
        if (entry.type !== FileType.Directory || isLegacyArchiveDirName(entry.name)) continue;
        const dir = join(analysisRoot, entry.name);
        const manifest = await this.storage.loadManifest(dir);
        if (!manifest || manifest.version !== 4 || manifest.lifecycle !== 'completed') continue;
        if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) {
          unsafeSlug = true;
          continue;
        }
        const phases = PHASE_CONFIGS.map(({ id }) => manifest.phases[id]);
        if (phases.some((phase) =>
          phase?.status !== 'completed' ||
          phase?.verification.status !== 'verified' ||
          !phase?.verification.outputSha256 ||
          !/^[0-9]{2}-[a-z-]+\.md$/.test(phase?.file ?? ''),
        )) continue;
        const at = Date.parse(manifest.analyzedAt);
        if (Number.isFinite(at)) candidates.push({
          slug: entry.name,
          dir,
          at,
          files: phases.map((phase) => phase?.file ?? ''),
          hashes: phases.map((phase) => phase?.verification.outputSha256 ?? ''),
        });
      }
      candidates.sort((a, b) => b.at - a.at);
      let latest: Candidate | undefined;
      for (const candidate of candidates) {
        let outputsMatch = true;
        for (let index = 0; index < candidate.files.length; index++) {
          const file = join(candidate.dir, candidate.files[index]);
          if (!(await this.fs.exists(file))) { outputsMatch = false; break; }
          const bytes = await this.fs.readFileBytes(file);
          if (sha256Hex(bytes) !== candidate.hashes[index] &&
              sha256Hex(normalizeEolBytes(bytes)) !== candidate.hashes[index]) {
            outputsMatch = false;
            break;
          }
        }
        if (outputsMatch) { latest = candidate; break; }
      }
      if (!latest) return { written: false, error: unsafeSlug
        ? 'Analysis slug contains unsupported characters.'
        : 'No completed analysis with phase files was found.' };

      const current = await this.fs.exists(path) ? await this.fs.readFile(path) : '';
      const crlf = (current.match(/\r\n/g) ?? []).length;
      const lf = (current.match(/(?<!\r)\n/g) ?? []).length;
      const eol = crlf > lf ? '\r\n' : '\n';
      const imports = latest.files.map((file) => `@.ptah/analysis/${latest.slug}/${file}`).join(eol);
      const begins = current.split(BEGIN).length - 1;
      const ends = current.split(END).length - 1;
      if ((begins !== 0 || ends !== 0) &&
          (begins !== 1 || ends !== 1 || current.indexOf(BEGIN) > current.indexOf(END))) {
        return { written: false, error: 'CLAUDE.md has unpaired or out-of-order analysis markers.' };
      }
      let updated: string;
      if (begins === 1) {
        const before = current.slice(0, current.indexOf(BEGIN) + BEGIN.length);
        const after = current.slice(current.indexOf(END));
        updated = `${before}${eol}${imports}${eol}${after}`;
      } else {
        const separator = current.length === 0 || current.endsWith(`${eol}${eol}`)
          ? '' : current.endsWith(eol) ? eol : `${eol}${eol}`;
        updated = `${current}${separator}${BEGIN}${eol}${imports}${eol}${END}${eol}`;
      }
      if (updated === current) return { written: false };
      // Catch an editor save that occurred while phase files were inspected.
      const beforeWrite = await this.fs.exists(path) ? await this.fs.readFile(path) : '';
      if (beforeWrite !== current) return { written: false, error: 'CLAUDE.md changed during analysis linking.' };
      await this.fs.writeFile(path, updated);
      return { written: true };
    } catch (error) {
      // degradation-audit: reported — linking is best effort and must never
      // fail analysis completion or loading.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('Could not update CLAUDE.md analysis links', error);
      return { written: false, error: message };
    }
  }
}
