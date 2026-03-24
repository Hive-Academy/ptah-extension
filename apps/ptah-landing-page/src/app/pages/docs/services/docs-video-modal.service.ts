import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DocsVideoModalService {
  public readonly videoSrc = signal<string | null>(null);

  private readonly boundEscapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  public open(src: string): void {
    this.videoSrc.set(src);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', this.boundEscapeHandler);
  }

  public close(): void {
    this.videoSrc.set(null);
    document.body.style.overflow = '';
    document.removeEventListener('keydown', this.boundEscapeHandler);
  }
}
