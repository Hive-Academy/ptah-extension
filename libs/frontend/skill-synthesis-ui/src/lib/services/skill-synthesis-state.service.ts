import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { SkillSynthesisSpecSummary } from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

/** Tooltip and hint on a manual run that the Skills switch blocks. */
export const SKILLS_PAUSED_REASON = 'Paused — resume Skills to run';
/** Shown when the host refused a run because Skills was paused elsewhere. */
export const SKILLS_PAUSED_NOTICE =
  'Skills is paused, so this did not run. Turn Skills on at the top of this tab to run it.';
const SKILLS_SWITCH_WRITE_ERROR =
  'Could not change the Skills switch. It shows the saved setting.';
const SKILLS_SWITCH_READ_ERROR = 'Could not read whether Skills is paused.';
const TELEMETRY_SWITCH_WRITE_ERROR =
  'Could not change the telemetry switch. It shows the saved setting.';
const TELEMETRY_SWITCH_READ_ERROR = 'Could not read the telemetry setting.';

const SKILLS_ENABLED_KEY = 'skillSynthesis.enabled';
const SKILLS_TELEMETRY_KEY = 'skills.telemetry.enabled';
/** Mirrors the backend default in spec-harvester.service.ts. */
const STALE_SPEC_RETENTION_DAYS = 7;

/** State for the Library's switches and orchestration spec controls. */
@Injectable({ providedIn: 'root' })
export class SkillSynthesisStateService {
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly settingsRpc = inject(ClaudeRpcService);

  public readonly specs = signal<SkillSynthesisSpecSummary[]>([]);
  public readonly specsLoading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);
  public readonly staleSpecCount = computed(
    () => this.specs().filter(
      (spec) => spec.status === 'harvested'
        && spec.ageDays !== null
        && spec.ageDays >= STALE_SPEC_RETENTION_DAYS,
    ).length,
  );

  // --- Skills master switch (`skillSynthesis.enabled`, plan 3.7) -----------
  //
  // The switch owns `enabled`; the Settings form does not carry it, so a Save
  // can never write a stale value back. The committed value is read here and
  // nowhere else, guarded by `switchSeq` against out-of-order answers.

  private readonly _skillsEnabled = signal<boolean | null>(null);
  private readonly _skillsEnabledPending = signal<boolean | null>(null);
  private readonly _skillsSwitchSaving = signal<boolean>(false);
  private readonly _skillsSwitchError = signal<string | null>(null);
  private switchSeq = 0;

  /** The host's committed value; `null` until first read. Drives `pausedChange`. */
  public readonly skillsEnabledCommitted = this._skillsEnabled.asReadonly();
  /** What the switch shows: the pending write, else the committed value. */
  public readonly skillsEnabled = computed<boolean | null>(
    () => this._skillsEnabledPending() ?? this._skillsEnabled(),
  );
  /** Run curator, Analyze now and Enhance are greyed out while this is true. */
  public readonly skillsPaused = computed<boolean>(
    () => this.skillsEnabled() === false,
  );
  public readonly skillsSwitchSaving = this._skillsSwitchSaving.asReadonly();
  public readonly skillsSwitchError = this._skillsSwitchError.asReadonly();

  /**
   * Read one file-based setting through `settings:get`. Throws when the RPC or
   * the host read failed, so the caller keeps its last committed value.
   */
  private async readSettingValue(key: string): Promise<unknown> {
    const result = await this.settingsRpc.call('settings:get', { key });
    const payload = result.data;
    if (!result.isSuccess() || !payload?.success) {
      throw new Error(
        result.error || payload?.error || `settings:get failed for ${key}`,
      );
    }
    return payload.value;
  }

  /**
   * Write one file-based setting through `settings:set`. Throws when the RPC
   * or the host write failed, so the caller can roll back.
   */
  private async writeSettingValue(key: string, value: unknown): Promise<void> {
    const result = await this.settingsRpc.call('settings:set', { key, value });
    const payload = result.data;
    if (!result.isSuccess() || !payload?.success) {
      throw new Error(
        result.error || payload?.error || `settings:set failed for ${key}`,
      );
    }
  }

  /**
   * Re-read `skillSynthesis.enabled` through `settings:get` (tab shown,
   * window focus, page visible). Skipped while a write is in flight; a read
   * that a newer read or write overtook is dropped. Never touches the
   * Settings form, so a focus re-read cannot discard unsaved form edits.
   */
  public async refreshSkillsEnabled(): Promise<void> {
    if (this._skillsSwitchSaving()) return;
    const seq = ++this.switchSeq;
    try {
      const value = await this.readSettingValue(SKILLS_ENABLED_KEY);
      if (seq === this.switchSeq) {
        this._skillsEnabled.set(typeof value === 'boolean' ? value : null);
        if (this._skillsSwitchError() === SKILLS_SWITCH_READ_ERROR) {
          this._skillsSwitchError.set(null);
        }
      }
    } catch {
      // Shown under the switch, which stays disabled until a read succeeds.
      if (seq === this.switchSeq) {
        this._skillsSwitchError.set(SKILLS_SWITCH_READ_ERROR);
      }
    }
  }

  /**
   * Turn Skills on or off by writing only the `skillSynthesis.enabled` key
   * (no other key, so the curator is not restarted). Optimistic: the switch
   * moves at once, the committed value becomes what the host read back
   * (`settings:get` after the write), and a failure rolls back to the
   * committed value, which is then re-read from the host.
   */
  public async setSkillsEnabled(enabled: boolean): Promise<void> {
    if (this._skillsSwitchSaving()) return;
    ++this.switchSeq;
    this._skillsSwitchSaving.set(true);
    this._skillsEnabledPending.set(enabled);
    this._skillsSwitchError.set(null);
    let failed = false;
    try {
      await this.writeSettingValue(SKILLS_ENABLED_KEY, enabled);
      const stored = await this.readSettingValue(SKILLS_ENABLED_KEY);
      ++this.switchSeq;
      this._skillsEnabled.set(typeof stored === 'boolean' ? stored : null);
    } catch {
      // Shown under the switch; the committed value is re-read below.
      failed = true;
      this._skillsSwitchError.set(SKILLS_SWITCH_WRITE_ERROR);
    } finally {
      this._skillsEnabledPending.set(null);
      this._skillsSwitchSaving.set(false);
    }
    if (failed) await this.refreshSkillsEnabled();
  }

  /**
   * The host refused a manual run with `PAUSED`: Skills was paused elsewhere
   * (tray, settings file) after this tab last read the switch.
   */
  public markSkillsPaused(): void {
    ++this.switchSeq;
    this._skillsEnabled.set(false);
  }

  // --- Skill telemetry switch (`skills.telemetry.enabled`, plan 3.7) --------
  //
  // Independent of the Skills master switch above: the two settings keys are
  // separate (file-settings-keys.ts), so pausing Skills never turns telemetry
  // off and turning telemetry off never pauses Skills. The dashboard Skills
  // tile reads the same key for its On/Off value.

  private readonly _telemetryEnabled = signal<boolean | null>(null);
  private readonly _telemetryPending = signal<boolean | null>(null);
  private readonly _telemetrySaving = signal<boolean>(false);
  private readonly _telemetryError = signal<string | null>(null);
  private telemetrySeq = 0;

  /** The host's committed value; `null` until first read. */
  public readonly telemetryEnabledCommitted =
    this._telemetryEnabled.asReadonly();
  /** What the toggle shows: the pending write, else the committed value. */
  public readonly telemetryEnabled = computed<boolean | null>(
    () => this._telemetryPending() ?? this._telemetryEnabled(),
  );
  public readonly telemetrySaving = this._telemetrySaving.asReadonly();
  public readonly telemetryError = this._telemetryError.asReadonly();

  /**
   * Re-read `skills.telemetry.enabled` through `settings:get`. Skipped while
   * a write is in flight; a read that a newer read or write overtook is
   * dropped.
   */
  public async refreshTelemetryEnabled(): Promise<void> {
    if (this._telemetrySaving()) return;
    const seq = ++this.telemetrySeq;
    try {
      const value = await this.readSettingValue(SKILLS_TELEMETRY_KEY);
      if (seq === this.telemetrySeq) {
        this._telemetryEnabled.set(typeof value === 'boolean' ? value : null);
        if (this._telemetryError() === TELEMETRY_SWITCH_READ_ERROR) {
          this._telemetryError.set(null);
        }
      }
    } catch {
      if (seq === this.telemetrySeq) {
        this._telemetryError.set(TELEMETRY_SWITCH_READ_ERROR);
      }
    }
  }

  /**
   * Turn telemetry on or off by writing only the `skills.telemetry.enabled`
   * key. Optimistic like the Skills switch: the toggle moves at once, the
   * committed value becomes what the host read back, and a failure rolls back
   * to the committed value, which is then re-read from the host.
   */
  public async setTelemetryEnabled(enabled: boolean): Promise<void> {
    if (this._telemetrySaving()) return;
    ++this.telemetrySeq;
    this._telemetrySaving.set(true);
    this._telemetryPending.set(enabled);
    this._telemetryError.set(null);
    let failed = false;
    try {
      await this.writeSettingValue(SKILLS_TELEMETRY_KEY, enabled);
      const stored = await this.readSettingValue(SKILLS_TELEMETRY_KEY);
      ++this.telemetrySeq;
      this._telemetryEnabled.set(typeof stored === 'boolean' ? stored : null);
    } catch {
      failed = true;
      this._telemetryError.set(TELEMETRY_SWITCH_WRITE_ERROR);
    } finally {
      this._telemetryPending.set(null);
      this._telemetrySaving.set(false);
    }
    if (failed) await this.refreshTelemetryEnabled();
  }

  /** Refresh the orchestration-specs list under `.ptah/specs`. */
  public async refreshSpecs(): Promise<void> {
    this.specsLoading.set(true);
    this.error.set(null);
    try {
      const list = await this.rpc.listSpecs();
      this.specs.set(list);
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.specsLoading.set(false);
    }
  }

  /** Reconcile completed specs into telemetry now, then refresh the list. */
  public async harvestSpecs(): Promise<void> {
    this.specsLoading.set(true);
    this.error.set(null);
    try {
      await this.rpc.harvestSpecs();
      await this.refreshSpecs();
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.specsLoading.set(false);
    }
  }

  /**
   * Archive (or delete) completed + harvested specs older than the retention
   * window, then refresh the list. Returns the number cleared (0 on error).
   */
  public async clearStaleSpecs(
    options: {
      retentionDays?: number;
      mode?: 'archive' | 'delete';
    } = {},
  ): Promise<number> {
    this.specsLoading.set(true);
    this.error.set(null);
    try {
      const result = await this.rpc.clearStaleSpecs(options);
      await this.refreshSpecs();
      return result.cleared;
    } catch (err) {
      this.error.set(this.toMessage(err));
      return 0;
    } finally {
      this.specsLoading.set(false);
    }
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
