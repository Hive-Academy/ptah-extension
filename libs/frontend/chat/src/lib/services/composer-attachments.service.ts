import { inject, Injectable, signal, type OnDestroy } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import { MAX_IMAGE_SIZE_BYTES, resolveImageMediaType } from '@ptah-extension/shared';
import type { SendMessageOptions } from '@ptah-extension/chat-types';
import { FilePickerService, type ChatFile } from './file-picker.service';
import type { ComposerDraftImage } from './composer-draft.store';

export type ComposerImage = ComposerDraftImage;

/** Ephemeral attachment state, provided by each owning composer. */
@Injectable()
export class ComposerAttachmentsService implements OnDestroy {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly filePicker = inject(FilePickerService);
  readonly files = signal<ChatFile[]>([]);
  readonly images = signal<ComposerImage[]>([]);
  readonly error = signal<string | null>(null);
  readonly pendingReads = signal(0);
  private errorTimeout: ReturnType<typeof setTimeout> | null = null;
  private pickingFiles = false;
  private pickingImages = false;

  ngOnDestroy(): void {
    if (this.errorTimeout) clearTimeout(this.errorTimeout);
  }

  showError(message: string): void {
    if (this.errorTimeout) clearTimeout(this.errorTimeout);
    this.error.set(message);
    this.errorTimeout = setTimeout(() => {
      this.error.set(null);
      this.errorTimeout = null;
    }, 4000);
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (!item.type.startsWith('image/')) continue;
      event.preventDefault();
      const file = item.getAsFile();
      if (file) this.readImage(file, item.type, true);
    }
  }

  onDrop(event: DragEvent): void {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    for (const file of files) {
      if (file.type.startsWith('image/')) this.readImage(file, file.type, false);
      else this.showError('Unsupported image format — use PNG, JPEG, GIF, or WebP');
    }
  }

  private readImage(file: File, declaredType: string, pasted: boolean): void {
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      this.showError('Image too large — 5MB max');
      return;
    }
    const reader = new FileReader();
    this.pendingReads.update((count) => count + 1);
    reader.onload = () => {
      try {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(',')[1] ?? '';
        if (pasted && Math.floor(base64.length * 0.75) > MAX_IMAGE_SIZE_BYTES) {
          this.showError('Image too large — 5MB max');
          return;
        }
        const mediaType = resolveImageMediaType(declaredType, base64);
        if (!mediaType) {
          this.showError('Unsupported image format — use PNG, JPEG, GIF, or WebP');
          return;
        }
        this.images.update((images) => [...images, {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          data: base64,
          mediaType,
          dataUrl,
          name: pasted ? `pasted-image.${mediaType.split('/')[1]}` : file.name,
        }]);
      } finally {
        this.pendingReads.update((count) => count - 1);
      }
    };
    reader.onerror = () => {
      console.warn('[ComposerAttachments] Failed to read image file'); // degradation-audit: reported — shown beside the composer.
      this.showError('Could not read image. Try again.');
      this.pendingReads.update((count) => count - 1);
    };
    try {
      reader.readAsDataURL(file);
    } catch (cause: unknown) {
      // degradation-audit: reported — synchronous read failures are shown beside the composer.
      console.warn('[ComposerAttachments] Failed to read image file', cause);
      this.showError('Could not read image. Try again.');
      this.pendingReads.update((count) => count - 1);
    }
  }

  async pickFiles(): Promise<void> {
    if (this.pickingFiles) return;
    this.pickingFiles = true;
    try {
      const result = await this.rpc.call('file:pick', { multiple: true });
      if (!result.success) {
        this.showError('Could not attach files. Try again.');
        return;
      }
      if (!result.data?.files?.length) return;
      for (const file of result.data.files) {
        if (this.files().some((existing) => existing.path === file.path)) continue;
        const name = file.path.replace(/\\/g, '/').split('/').pop() || file.path;
        const isText = this.filePicker.isFileSupported(file.path);
        this.files.update((files) => [...files, {
          path: file.path, name, size: file.size,
          type: isText ? 'text' : 'binary',
          isLarge: file.size > 1024 * 1024,
          tokenEstimate: isText ? Math.ceil(file.size / 4) : 0,
        }]);
      }
    } catch (cause: unknown) {
      // degradation-audit: reported — picker failures are visible beside the composer.
      console.error('[ComposerAttachments] Failed to pick files:', cause);
      this.showError('Could not attach files. Try again.');
    } finally {
      this.pickingFiles = false;
    }
  }

  async pickImages(): Promise<void> {
    if (this.pickingImages) return;
    this.pickingImages = true;
    try {
      const result = await this.rpc.call('file:pick-images', { multiple: true });
      if (!result.success) {
        this.showError('Could not attach images. Try again.');
        return;
      }
      if (!result.data?.images?.length) return;
      for (const image of result.data.images) {
        const mediaType = resolveImageMediaType(image.mediaType, image.data);
        const decodedBytes = Math.floor(image.data.length * 0.75) -
          (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
        if (!mediaType || decodedBytes > MAX_IMAGE_SIZE_BYTES) {
          this.showError('Unsupported or oversized image — use PNG, JPEG, GIF, or WebP up to 5MB');
          continue;
        }
        this.images.update((images) => [...images, {
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          data: image.data, mediaType,
          dataUrl: `data:${mediaType};base64,${image.data}`,
          name: image.name,
        }]);
      }
    } catch (cause: unknown) {
      // degradation-audit: reported — picker failures are visible beside the composer.
      console.error('[ComposerAttachments] Failed to pick images:', cause);
      this.showError('Could not attach images. Try again.');
    } finally {
      this.pickingImages = false;
    }
  }

  addFile(file: ChatFile): void {
    if (!this.files().some((existing) => existing.path === file.path))
      this.files.update((files) => [...files, file]);
  }

  remove(id: string): void {
    this.files.update((files) => files.filter((file) => file.path !== id));
    this.images.update((images) => images.filter((image) => image.id !== id));
  }

  removeSent(files: readonly ChatFile[], images: readonly ComposerImage[]): void {
    const sentFiles = new Set(files);
    const sentImages = new Set(images);
    this.files.update((current) => current.filter((file) => !sentFiles.has(file)));
    this.images.update((current) => current.filter((image) => !sentImages.has(image)));
  }

  snapshotForSend(): {
    options: Pick<SendMessageOptions, 'files' | 'images'>;
    removeSent: () => void;
  } {
    const files = this.files();
    const images = this.images();
    return {
      options: this.toSendOptions(),
      removeSent: () => this.removeSent(files, images),
    };
  }

  clear(): void {
    this.files.set([]);
    this.images.set([]);
    this.error.set(null);
    if (this.errorTimeout) clearTimeout(this.errorTimeout);
    this.errorTimeout = null;
  }

  restore(files: ChatFile[], images: ComposerImage[]): void {
    this.files.set(files);
    this.images.set(images);
  }

  toSendOptions(): Pick<SendMessageOptions, 'files' | 'images'> {
    const files = this.files().map((file) => file.path);
    const images = this.images().map(({ data, mediaType }) => ({ data, mediaType }));
    return {
      files: files.length ? files : undefined,
      images: images.length ? images : undefined,
    };
  }
}
