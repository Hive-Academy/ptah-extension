import { Pipe, type PipeTransform } from '@angular/core';

/**
 * Hold raw input before ngx-markdown invokes marked and the configured sanitizer.
 * Activity is a presentation input supplied by the consuming webview component.
 * The pure pipe re-runs when either raw text or activity changes, so activation
 * catches up even when raw text has not changed since the last hidden update.
 * Each binding owns its last published string; this library knows no router.
 */
@Pipe({ name: 'surfaceMarkdown', standalone: true })
export class SurfaceMarkdownPipe implements PipeTransform {
  private rendered = '';

  transform(raw: string | null | undefined, active: boolean): string {
    if (active) this.rendered = raw ?? '';
    return this.rendered;
  }
}
