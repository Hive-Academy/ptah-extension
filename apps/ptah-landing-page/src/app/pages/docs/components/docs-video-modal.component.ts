import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Pause, Play, X } from 'lucide-angular';
import { DocsVideoModalService } from '../services/docs-video-modal.service';

@Component({
  selector: 'ptah-docs-video-modal',
  imports: [CommonModule, LucideAngularModule],
  template: `
    @if (modal.videoSrc(); as src) {
    <div
      class="fixed inset-0 z-[9999] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center"
      (click)="modal.close()"
    >
      <!-- Video -->
      <video
        #videoEl
        autoplay
        muted
        loop
        playsinline
        class="w-[90vw] h-[80vh] object-contain rounded-lg cursor-pointer"
        (click)="togglePlay($event)"
      >
        <source [src]="src" type="video/mp4" />
      </video>

      <!-- Controls bar -->
      <div
        class="flex items-center gap-4 mt-4 px-4 py-2.5 rounded-xl bg-white/10 border border-white/15 backdrop-blur-sm"
        (click)="$event.stopPropagation()"
      >
        <!-- Play/Pause -->
        <button
          type="button"
          class="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          (click)="togglePlay($event)"
        >
          <lucide-icon [img]="isPaused() ? PlayIcon : PauseIcon" [size]="18" />
        </button>

        <!-- Speed controls -->
        <div class="flex items-center gap-1">
          @for (speed of speeds; track speed) {
          <button
            type="button"
            class="px-2 py-1 rounded-md text-xs font-mono transition-colors"
            [ngClass]="
              currentSpeed() === speed
                ? 'bg-white/20 text-white'
                : 'text-white/50 hover:text-white/80'
            "
            (click)="setSpeed(speed)"
          >
            {{ speed }}x
          </button>
          }
        </div>
      </div>

      <!-- Close button -->
      <button
        type="button"
        class="absolute top-4 right-4 p-2.5 rounded-xl bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 hover:text-white transition-colors"
        (click)="modal.close()"
      >
        <lucide-icon [img]="XIcon" [size]="20" />
      </button>

      <p
        class="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/30 text-xs"
      >
        Click video to play/pause · Press
        <kbd
          class="px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-white/50 font-mono text-[10px]"
          >Esc</kbd
        >
        to close
      </p>
    </div>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsVideoModalComponent {
  public readonly XIcon = X;
  public readonly PlayIcon = Play;
  public readonly PauseIcon = Pause;
  public readonly modal = inject(DocsVideoModalService);

  public readonly speeds = [0.25, 0.5, 0.75, 1, 1.5, 2];
  public readonly currentSpeed = signal(0.5);
  public readonly isPaused = signal(false);

  public readonly videoEl = viewChild<ElementRef<HTMLVideoElement>>('videoEl');

  public constructor() {
    // Apply speed when video element becomes available or speed changes
    effect(() => {
      const speed = this.currentSpeed();
      const ref = this.videoEl();
      if (ref) {
        ref.nativeElement.playbackRate = speed;
      }
    });
  }

  public togglePlay(event: MouseEvent): void {
    event.stopPropagation();
    const ref = this.videoEl();
    if (!ref) return;
    const video = ref.nativeElement;
    if (video.paused) {
      video.play();
      this.isPaused.set(false);
    } else {
      video.pause();
      this.isPaused.set(true);
    }
  }

  public setSpeed(speed: number): void {
    this.currentSpeed.set(speed);
  }
}
