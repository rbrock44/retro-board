import { renderMarkdown } from './markdown.pipe';

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    expect(renderMarkdown('**bold** and _em_')).toContain('<strong>bold</strong>');
  });

  it('strips scripts, event handlers, images and javascript links', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toMatch(/href="javascript/i);
  });

  it('opens links in a new tab safely', () => {
    const html = renderMarkdown('[docs](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
