import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AudioLines, CircleGauge, LucideAngularModule, Moon, Settings, Sparkles, Sun } from 'lucide-angular';

@Component({
  selector: 'ptah-command-center-header',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="flex min-h-[78px] flex-wrap items-center justify-between gap-3 border-b border-base-300 bg-base-100 px-4 py-2 text-base-content lg:px-[22px]">
      <div class="flex min-w-0 items-center gap-3">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-lg border border-secondary text-secondary-focus" aria-hidden="true"><lucide-angular [img]="sparklesIcon" class="size-5" /></span>
        <div class="min-w-0">
          <p class="font-mono text-[10px] uppercase tracking-widest text-secondary-focus">Ptah / Engineering</p>
          <h1 class="whitespace-nowrap font-serif text-xl font-semibold">Command Center</h1>
        </div>
      </div>
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        @if (micError()) {
          <span role="alert" class="text-sm text-error">Microphone access blocked</span>
          <button type="button" class="btn btn-ghost min-h-11 underline" (click)="voiceSettings.emit()">Open Voice settings</button>
        }
        <button type="button" class="btn btn-ghost min-h-11 max-w-full gap-2 border border-base-300 bg-base-200 font-mono text-xs" [attr.aria-label]="voiceAriaStatus()" [title]="voiceAriaStatus()" (click)="voiceSettings.emit()">
          <lucide-angular [img]="audioIcon" class="size-4" aria-hidden="true" />
          <span class="size-2 rounded-full" [class.bg-success]="voiceReady()" [class.bg-warning]="!voiceReady()" aria-hidden="true"></span>
          <span class="truncate">{{ voiceProviderText() }}</span>
        </button>
        <span class="badge badge-outline min-h-8 font-mono text-xs">Session {{ shortSessionId() }}</span>
        <span class="badge badge-outline min-h-8 font-mono text-xs" role="status">{{ sessionStatus() }}</span>
        @if (showContext()) {
          <span class="badge badge-outline min-h-8 gap-1 font-mono text-xs" [class.text-state-need]="contextWarning()" [class.border-state-need]="contextWarning()">
            <lucide-angular [img]="gaugeIcon" class="size-3" aria-hidden="true" /> Context {{ contextLabel() }}
            @if (contextWarning()) { <span>· Warning</span> }
          </span>
        }
        <button type="button" class="btn btn-ghost min-h-11 border border-base-300" (click)="voiceSettings.emit()"><lucide-angular [img]="settingsIcon" class="mr-1 size-4" aria-hidden="true" />Voice settings</button>
        <button type="button" class="btn btn-ghost min-h-11 min-w-11 border border-base-300" [attr.aria-label]="darkMode() ? 'Switch to light theme' : 'Switch to dark theme'" (click)="themeToggle.emit()"><lucide-angular [img]="darkMode() ? sunIcon : moonIcon" class="size-4" aria-hidden="true" /></button>
      </div>
    </header>
  `,
})
export class CommandCenterHeaderComponent {
  public readonly sessionId = input<string | null>(null);
  public readonly sessionStatus = input('idle');
  public readonly voiceProviderText = input('Voice unavailable');
  public readonly voiceAriaStatus = input('Voice unavailable. Open voice settings');
  public readonly voiceReady = input(false);
  public readonly contextLabel = input('unknown');
  public readonly contextPercent = input<number | null>(null);
  public readonly showContext = input(false);
  public readonly darkMode = input(true);
  public readonly micError = input(false);
  public readonly voiceSettings = output<void>();
  public readonly themeToggle = output<void>();
  public readonly shortSessionId = computed(() => this.sessionId()?.slice(0, 8) || 'new');
  public readonly contextWarning = computed(() => {
    const percent = this.contextPercent();
    return percent !== null && percent >= 70;
  });
  protected readonly sparklesIcon = Sparkles;
  protected readonly audioIcon = AudioLines;
  protected readonly gaugeIcon = CircleGauge;
  protected readonly settingsIcon = Settings;
  protected readonly sunIcon = Sun;
  protected readonly moonIcon = Moon;
}
