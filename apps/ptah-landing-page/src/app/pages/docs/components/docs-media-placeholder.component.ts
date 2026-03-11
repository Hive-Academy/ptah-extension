import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Play, Image } from 'lucide-angular';

@Component({
  selector: 'ptah-docs-media-placeholder',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      class="relative rounded-xl overflow-hidden border border-amber-500/20 bg-slate-800/40 backdrop-blur-sm group lg:min-h-[50vh]"
      [style.aspect-ratio]="aspectRatio()"
      role="img"
      [attr.aria-label]="title() + ' placeholder'"
    >
      <!-- Grid pattern background -->
      <div class="absolute inset-0 opacity-10">
        <div
          class="w-full h-full"
          style="background-image: repeating-linear-gradient(0deg, transparent, transparent 24px, rgba(212,175,55,0.15) 24px, rgba(212,175,55,0.15) 25px), repeating-linear-gradient(90deg, transparent, transparent 24px, rgba(212,175,55,0.15) 24px, rgba(212,175,55,0.15) 25px);"
        ></div>
      </div>

      <!-- Center icon and caption -->
      <div
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4"
      >
        @if (mediaType() === 'video') {
        <div
          class="w-14 h-14 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center group-hover:bg-amber-500/30 transition-colors"
        >
          <lucide-angular
            [img]="PlayIcon"
            class="w-6 h-6 text-amber-400 ml-0.5"
            aria-hidden="true"
          />
        </div>
        } @else {
        <div
          class="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center"
        >
          <lucide-angular
            [img]="ImageIcon"
            class="w-6 h-6 text-amber-400/60"
            aria-hidden="true"
          />
        </div>
        }
        <span class="text-sm text-white/40 font-medium text-center">{{
          title()
        }}</span>
      </div>
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
export class DocsMediaPlaceholderComponent {
  public readonly title = input('Media placeholder');
  public readonly aspectRatio = input('16/9');
  public readonly mediaType = input<'gif' | 'video'>('gif');

  public readonly PlayIcon = Play;
  public readonly ImageIcon = Image;
}
