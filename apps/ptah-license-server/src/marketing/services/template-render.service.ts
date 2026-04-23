import { Injectable } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { injectCampaignFooter } from '../utils/footer-injector';

const ALLOWED_VARIABLES = ['firstName', 'email', 'unsubscribeUrl'] as const;

@Injectable()
export class TemplateRenderService {
  private readonly allowedTags = [
    'a',
    'abbr',
    'b',
    'blockquote',
    'br',
    'caption',
    'cite',
    'code',
    'col',
    'colgroup',
    'dd',
    'del',
    'details',
    'div',
    'dl',
    'dt',
    'em',
    'figcaption',
    'figure',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'ins',
    'kbd',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    'q',
    's',
    'section',
    'small',
    'span',
    'strong',
    'sub',
    'summary',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'time',
    'tr',
    'u',
    'ul',
  ];

  sanitizeForStorage(htmlBody: string): string {
    return (sanitizeHtml as any)(htmlBody, {
      allowedTags: this.allowedTags,
      allowedAttributes: {
        '*': ['style', 'class'],
        a: ['href', 'target', 'rel'],
        img: ['src', 'alt', 'width', 'height'],
      },
      disallowedTagsMode: 'discard',
    });
  }

  render(params: {
    htmlBody: string;
    subject: string;
    user: { firstName?: string | null; email: string };
    unsubscribeUrl: string;
    postalAddress: string;
  }): { html: string; subject: string } {
    const vars: Record<(typeof ALLOWED_VARIABLES)[number], string> = {
      firstName: params.user.firstName ?? params.user.email.split('@')[0],
      email: params.user.email,
      unsubscribeUrl: params.unsubscribeUrl,
    };
    let html = params.htmlBody;
    let subject = params.subject;
    for (const [key, val] of Object.entries(vars)) {
      const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      html = html.replace(re, val);
      subject = subject.replace(re, val);
    }
    html = this.sanitizeForStorage(html);
    html = injectCampaignFooter(
      html,
      params.postalAddress,
      params.unsubscribeUrl,
    );
    return { html, subject };
  }
}
