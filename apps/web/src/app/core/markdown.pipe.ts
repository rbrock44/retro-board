import { Pipe, type PipeTransform, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: true, async: false });

/** Markdown to sanitized HTML. Links open in a new tab; images, scripts and raw HTML styles are stripped. */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text ?? '') as string;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'],
    ALLOWED_ATTR: ['href', 'title', 'type', 'checked', 'disabled'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

if (typeof window !== 'undefined') {
  DOMPurify.addHook('afterSanitizeAttributes', node => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);
  transform(text: string | null | undefined): SafeHtml {
    // Already sanitized by DOMPurify with a strict allowlist; Angular's sanitizer would drop target/rel.
    return this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(text ?? ''));
  }
}
