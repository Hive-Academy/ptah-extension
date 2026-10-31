/**
 * Electron Welcome Component
 *
 * The no-workspace screen of the Electron desktop app (TASK_2026_721 11a,
 * design screens 01 and 01b). The medallion, `Open a workspace` and the gold
 * Open Folder button, then two columns on the glass (recent workspaces and
 * the 13-week activity grid across all workspaces) and one vitals row.
 *
 * First run (no recent workspace and no usage): the grid becomes the Day 1
 * field and the vitals row keeps only Plan, Agents and Skills. Until the
 * store knows whether this is a first run, the row's height is reserved and
 * no cell is drawn, so the row never shows a Spend cell and then drops it.
 *
 * No card or frame: the content sits on the tinted scene, with a frameless
 * local text scrim (`--glass-scrim-text`) fading out behind it so captions
 * keep 4.5:1. Every figure comes from `WelcomeVitalsStore`, provided here so
 * its reads live as long as the screen; the mapping is in
 * `welcome-vitals.view.ts`.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  ArrowRight,
  BookOpen,
  Bot,
  CircleDollarSign,
  FolderOpen,
  Gauge,
  LucideAngularModule,
  RotateCw,
  TriangleAlert,
} from 'lucide-angular';
import {
  ElectronLayoutService,
  LoggingService,
  VSCodeService,
} from '@ptah-extension/core';
import { ActivityGridComponent } from '@ptah-extension/chat-ui';
// The welcome-only molecules come from the lazy `vitals` entry point: this
// component loads inside electron-shell's `@defer`, and the main barrel is
// eager (see libs/frontend/chat-ui/src/vitals.ts).
import {
  PlanRingComponent,
  RecentWorkspaceListComponent,
  SpendBarsComponent,
  StatCellComponent,
  StatRowComponent,
  StatValueComponent,
} from '@ptah-extension/chat-ui/vitals';
import { RecentWorkspacesStore } from '../../services/vitals/recent-workspaces.store';
import { localDayKey } from '../../services/vitals/usage-vitals.model';
import { WelcomeVitalsStore } from '../../services/vitals/welcome-vitals.store';
import {
  toCountCell,
  toGridView,
  toPlanCell,
  toRecentItems,
  toSpendCell,
} from '../../services/vitals/welcome-vitals.view';

const LOG_CONTEXT = 'ElectronWelcome';

@Component({
  selector: 'ptah-electron-welcome',
  standalone: true,
  imports: [
    LucideAngularModule,
    ActivityGridComponent,
    PlanRingComponent,
    RecentWorkspaceListComponent,
    SpendBarsComponent,
    StatCellComponent,
    StatRowComponent,
    StatValueComponent,
  ],
  providers: [WelcomeVitalsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './electron-welcome.component.css',
  template: `
    <div class="ptah-welcome">
      <div class="ptah-welcome__stage">
        <div class="ptah-welcome__hero">
          <img
            [src]="ptahIconUri"
            alt="PtahCode"
            class="size-12"
            width="48"
            height="48"
          />
          <h1 class="text-[28px] leading-tight font-semibold text-base-content">
            Open a workspace
          </h1>
          <button
            type="button"
            class="btn btn-primary gap-2 rounded-full px-6"
            data-testid="welcome-open-folder"
            (click)="addFolder()"
          >
            <lucide-angular
              [img]="FolderOpenIcon"
              class="size-4"
              aria-hidden="true"
            />
            Open Folder
            <lucide-angular
              [img]="ArrowRightIcon"
              class="size-4"
              aria-hidden="true"
            />
          </button>
        </div>

        @if (openFailed()) {
          <p
            role="alert"
            class="flex items-center gap-2 text-sm text-base-content"
            data-testid="welcome-open-failed"
          >
            <lucide-angular
              [img]="AlertIcon"
              class="size-4 text-error"
              aria-hidden="true"
            />
            Folder is no longer available
          </p>
        }
        @if (recentsFailed()) {
          <div
            role="alert"
            class="flex items-center gap-2 text-sm text-base-content"
            data-testid="welcome-recents-error"
          >
            <lucide-angular
              [img]="AlertIcon"
              class="size-4 text-error"
              aria-hidden="true"
            />
            Recent folders unavailable
            <button
              type="button"
              class="btn btn-ghost btn-xs gap-1"
              (click)="reloadRecents()"
            >
              <lucide-angular
                [img]="RetryIcon"
                class="size-3.5"
                aria-hidden="true"
              />
              Retry
            </button>
          </div>
        }

        <div class="ptah-welcome__body">
          <div class="ptah-welcome__zone">
            @if (recentItems().length > 0) {
              <ptah-recent-workspace-list
                class="ptah-welcome__recents"
                [items]="recentItems()"
                (open)="openRecent($event)"
              />
            }
            @let view = grid();
            <div
              class="ptah-welcome__grid"
              [attr.aria-busy]="view.busy ? 'true' : null"
              data-testid="welcome-activity"
            >
              <ptah-activity-grid
                [days]="view.days"
                [today]="view.today"
                [mode]="view.mode"
                [caption]="view.caption"
                [ariaLabel]="view.label"
              />
            </div>
          </div>

          @if (firstRun() === null) {
            <div
              class="ptah-welcome__vitals-slot"
              aria-hidden="true"
              data-testid="welcome-vitals-pending"
            ></div>
          } @else {
            <ptah-stat-row
              class="ptah-welcome__vitals"
              density="regular"
              data-testid="welcome-vitals"
            >
              <ptah-stat-cell
                [icon]="PlanIcon"
                label="Plan"
                [state]="plan().state"
                [caption]="plan().caption"
              >
                <ptah-plan-ring [ring]="plan().ring" />
              </ptah-stat-cell>
              @if (!firstRun()) {
                <ptah-stat-cell
                  [icon]="SpendIcon"
                  label="Spend 7d"
                  [state]="spend().state"
                  caption="last 7 days"
                >
                  <ptah-stat-value [text]="spend().text">
                    <ptah-spend-bars
                      [values]="spend().bars"
                      ariaLabel="Spend per day, last 7 days"
                    />
                  </ptah-stat-value>
                </ptah-stat-cell>
              }
              <ptah-stat-cell
                [icon]="AgentsIcon"
                label="Agents"
                [state]="agents().state"
                caption="detected"
              >
                <ptah-stat-value [text]="agents().text" />
              </ptah-stat-cell>
              <ptah-stat-cell
                [icon]="SkillsIcon"
                label="Skills"
                [state]="skills().state"
                caption="enabled"
              >
                <ptah-stat-value [text]="skills().text" />
              </ptah-stat-cell>
            </ptah-stat-row>
          }
        </div>
      </div>
    </div>
  `,
})
export class ElectronWelcomeComponent {
  private readonly layout = inject(ElectronLayoutService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly logger = inject(LoggingService);
  private readonly recentWorkspaces = inject(RecentWorkspacesStore);
  private readonly vitals = inject(WelcomeVitalsStore);

  protected readonly FolderOpenIcon = FolderOpen;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly AlertIcon = TriangleAlert;
  protected readonly RetryIcon = RotateCw;
  protected readonly PlanIcon = Gauge;
  protected readonly SpendIcon = CircleDollarSign;
  protected readonly AgentsIcon = Bot;
  protected readonly SkillsIcon = BookOpen;

  protected readonly ptahIconUri = this.vscodeService.getPtahIconUri();

  /** A recent folder failed to open (moved or deleted). */
  protected readonly openFailed = signal(false);
  private opening = false;

  /** `null` until the store knows; the vitals row waits for it. */
  protected readonly firstRun = this.vitals.isFirstRun;

  protected readonly recentsFailed = computed(
    () => this.vitals.recents().status === 'error',
  );
  protected readonly recentItems = computed(() =>
    toRecentItems(this.vitals.recents(), Date.now()),
  );
  protected readonly grid = computed(() =>
    toGridView(
      this.firstRun() === true,
      this.vitals.activity90(),
      localDayKey(new Date()),
    ),
  );
  protected readonly plan = computed(() => toPlanCell(this.vitals.planRing()));
  protected readonly spend = computed(() => toSpendCell(this.vitals.spend7()));
  protected readonly agents = computed(() =>
    toCountCell(this.vitals.cliCount()),
  );
  protected readonly skills = computed(() =>
    toCountCell(this.vitals.skillCount()),
  );

  protected addFolder(): void {
    this.openFailed.set(false);
    void this.layout.addFolder();
  }

  /**
   * Opens a recent folder. The layout service reports nothing on failure.
   * This screen shows only while no folder is open, so any folder in the list
   * afterwards means the open worked; none means it failed (moved or
   * deleted): the screen says so and rereads the list, which prunes it.
   */
  protected async openRecent(path: string): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    this.openFailed.set(false);
    try {
      await this.layout.addFolderByPath(path);
    } finally {
      this.opening = false;
    }
    if (this.layout.hasWorkspaceFolders()) return;
    this.logger.warn(LOG_CONTEXT, 'Recent workspace could not be opened');
    this.openFailed.set(true);
    void this.recentWorkspaces.load();
  }

  protected reloadRecents(): void {
    void this.recentWorkspaces.load();
  }
}
