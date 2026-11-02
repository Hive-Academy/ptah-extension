import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { FileTagComponent } from '../../file-suggestions/file-tag.component';
import { ComposerAttachmentsService } from '../../../services/composer-attachments.service';

@Component({
  selector: 'ptah-attachment-tray',
  standalone: true,
  imports: [LucideAngularModule, FileTagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (showError() && attachments.error()) {
      <div class="flex items-center gap-1.5 text-xs text-error px-2 pb-1.5"
           role="alert" aria-live="polite">{{ attachments.error() }}</div>
    }
    @if (showChips() && (attachments.files().length || attachments.images().length)) {
      <div class="ptah-fold-fade flex flex-wrap gap-2 px-3 pt-3">
        @for (file of attachments.files(); track file.path) {
          <ptah-file-tag [file]="file" (removeFile)="attachments.remove(file.path)" />
        }
        @for (image of attachments.images(); track image.id) {
          <div class="relative group">
            <div class="w-16 h-16 rounded-lg border border-base-300 bg-cover bg-center"
                 [style.background-image]="'url(' + image.dataUrl + ')'"
                 [attr.aria-label]="image.name" role="img"></div>
            <button class="absolute -top-1.5 -right-1.5 btn btn-circle btn-xs btn-error opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    type="button" [attr.aria-label]="'Remove ' + image.name"
                    (click)="attachments.remove(image.id)">
              <lucide-angular [img]="XIcon" class="w-3 h-3" />
            </button>
            <div class="absolute bottom-0 left-0 right-0 bg-neutral/70 rounded-b-lg px-1 py-0.5">
              <span class="text-[9px] text-neutral-content truncate block">{{ image.name }}</span>
            </div>
          </div>
        }
      </div>
    }
    @if (showPickButtons()) {
      <div class="flex flex-wrap gap-2 px-2 pt-2">
        <button type="button" class="btn btn-ghost btn-sm" aria-label="Attach files"
                (click)="attachments.pickFiles()">Attach files</button>
        <button type="button" class="btn btn-ghost btn-sm" aria-label="Attach images"
                (click)="attachments.pickImages()">Attach images</button>
      </div>
      <div class="mx-2 mt-2 rounded-lg border border-dashed border-base-300 p-2 text-xs text-base-content-muted"
           role="group" aria-label="Drop image attachments here"
           (dragover)="$event.preventDefault()"
           (drop)="attachments.onDrop($event)">
        Drop images here
      </div>
    }
  `,
})
export class AttachmentTrayComponent {
  readonly attachments = inject(ComposerAttachmentsService);
  readonly showPickButtons = input(true);
  readonly showError = input(true);
  readonly showChips = input(true);
  protected readonly XIcon = X;
}
