import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sanitizeHtml = require('sanitize-html');
import { injectCampaignFooter } from '../utils/footer-injector';

@Injectable()
export class TemplateRenderService {
  private readonly postalAddress: string;

  // Implementation plan Â§8.3 whitelist
  public static readonly SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: [
      'h1',
      'h2',
      'h3',
      'h4',
      'p',
      'a',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'br',
      'hr',
      'div',
      'span',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'td',
      'th',
      'blockquote',
      'code',
      'pre',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height', 'style'],
      '*': ['style', 'class', 'id'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    disallowedTagsMode: 'discard',
    allowVulnerableTags: false,
    allowedStyles: {
      '*': {
        color: [/.*/],
        'background-color': [/.*/],
        'font-size': [/.*/],
        'text-align': [/.*/],
        padding: [/.*/],
        margin: [/.*/],
        width: [/.*/],
        height: [/.*/],
        display: [/.*/],
        'font-family': [/.*/],
        'line-height': [/.*/],
        border: [/.*/],
        'text-decoration': [/.*/],
        'max-width': [/.*/],
      },
    },
  };

  constructor(private readonly configService: ConfigService) {
    this.postalAddress =
      this.configService.get<string>('MARKETING_POSTAL_ADDRESS') || '';
  }

  /**
   * Render template with variables and sanitize
   */
  render(params: {
    htmlBody: string;
    subject: string;
    user: { firstName?: string | null; email: string };
    unsubscribeUrl: string;
  }): { html: string; subject: string } {
    const { htmlBody, subject, user, unsubscribeUrl } = params;

    // 1. Substitution (variable allowlist)
    const firstName = user.firstName || user.email.split('@')[0];

    const renderedHtml = htmlBody
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{email}}/g, user.email)
      .replace(/{{unsubscribeUrl}}/g, unsubscribeUrl);

    const renderedSubject = subject
      .replace(/{{firstName}}/g, firstName)
      .replace(/{{email}}/g, user.email);

    // 2. Sanitize
    const sanitizedHtml = sanitizeHtml(
      renderedHtml,
      TemplateRenderService.SANITIZE_OPTIONS,
    );

    // 3. Append Footer
    const finalHtml = injectCampaignFooter(
      sanitizedHtml,
      this.postalAddress,
      unsubscribeUrl,
    );

    return {
      html: finalHtml,
      subject: renderedSubject,
    };
  }

  /**
   * Sanitize for storage (called on save)
   * Throws if sanitised output differs from input (R5)
   */
  sanitizeForStorage(htmlBody: string): string {
    const sanitized = sanitizeHtml(
      htmlBody,
      TemplateRenderService.SANITIZE_OPTIONS,
    );

    if (sanitized.trim() !== htmlBody.trim()) {
      throw new BadRequestException({
        code: 'TEMPLATE_SANITISE_REJECTED',
        message:
          'The template contains disallowed HTML tags or attributes and has been rejected.',
      });
    }

    return sanitized;
  }
}
