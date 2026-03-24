import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  ElementRef,
  viewChild,
  inject,
} from '@angular/core';
import { LucideAngularModule, Play, Maximize } from 'lucide-angular';
import { DocsVideoModalService } from '../services/docs-video-modal.service';

@Component({
  selector: 'ptah-docs-video-player',
  imports: [LucideAngularModule],
  template: `
    <div
      class="group relative cursor-pointer rounded-xl overflow-hidden"
      (click)="togglePlay()"
    >
      <video
        #videoEl
        muted
        loop
        playsinline
        preload="metadata"
        class="w-full rounded-xl border border-white/10 shadow-2xl"
      >
        <source [src]="src()" type="video/mp4" />
      </video>

      <!-- Play overlay -->
      <div
        class="absolute inset-0 flex items-center justify-center rounded-xl bg-black/30 transition-opacity duration-300 pointer-events-none"
        [style.opacity]="isPlaying() ? '0' : '1'"
      >
        <div
          class="w-20 h-20 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-xl"
        >
          <lucide-icon
            [img]="PlayIcon"
            class="w-10 h-10 text-slate-900 ml-1"
            [size]="40"
          />
        </div>
      </div>

      <!-- Fullscreen button -->
      <button
        type="button"
        class="absolute bottom-3 right-3 p-2 rounded-lg bg-slate-900/80 border border-white/10 text-white/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-slate-900 hover:text-white z-10"
        (click)="openFullscreen($event)"
      >
        <lucide-icon [img]="MaximizeIcon" [size]="16" />
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsVideoPlayerComponent {
  public readonly src = input.required<string>();

  public readonly PlayIcon = Play;
  public readonly MaximizeIcon = Maximize;

  public readonly isPlaying = signal(false);

  public readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoEl');

  private readonly modalService = inject(DocsVideoModalService);

  public togglePlay(): void {
    const videoRef = this.videoEl();
    if (!videoRef) return;
    const video = videoRef.nativeElement;
    if (video.paused) {
      video.play();
      this.isPlaying.set(true);
    } else {
      video.pause();
      this.isPlaying.set(false);
    }
  }

  public openFullscreen(event: MouseEvent): void {
    event.stopPropagation();
    this.modalService.open(this.src());
  }
}
