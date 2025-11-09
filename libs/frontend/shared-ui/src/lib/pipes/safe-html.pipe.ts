/**
 * Safe HTML Pipe
 * Sanitizes HTML content to prevent XSS attacks while allowing safe HTML rendering
 *
 * Usage:
 * <div [innerHTML]="content | safeHtml"></div>
 */

import { Pipe, PipeTransform, inject, SecurityContext } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Pipe({
  name: 'safeHtml',
  standalone: true,
})
export class SafeHtmlPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    if (!value) {
      return '';
    }

    // First sanitize to remove dangerous content using Angular's built-in sanitizer
    const sanitized = this.sanitizer.sanitize(SecurityContext.HTML, value);

    // Then bypass security trust for the sanitized content
    // This tells Angular the content is safe to render
    return this.sanitizer.bypassSecurityTrustHtml(sanitized || '');
  }
}
