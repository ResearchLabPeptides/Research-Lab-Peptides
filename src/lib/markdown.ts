/**
 * A small Markdown renderer.
 *
 * Staff write page content and every customer reads it, which makes stored HTML
 * a stored-XSS surface. So the input is escaped first and *then* a fixed set of
 * Markdown constructs is turned into tags. Nothing an author types can become
 * markup that is not on this list, because by the time any of it runs, every
 * `<` in their text is already `&lt;`.
 *
 * Supported: headings (##, ###), bold, italic, inline code, links, bullet and
 * numbered lists, blockquotes, horizontal rules, paragraphs.
 */

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Links are the one place a value goes into an attribute, so the scheme is
 * checked. `javascript:` and `data:` are the reason this function exists.
 */
function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^mailto:/i.test(url)) return url;
  if (/^tel:/i.test(url)) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  return null;
}

/** Inline formatting, applied to already-escaped text. */
function inline(text: string): string {
  let out = text;

  // Code first: its contents should not then be read as bold or italic.
  const codeSpans: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const url = safeUrl(href);
    if (!url) return label;
    const external = /^https?:\/\//i.test(url);
    const rel = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${url}" class="text-primary underline underline-offset-2"${rel}>${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_m, i: string) => {
    const code = codeSpans[Number(i)] ?? '';
    return `<code class="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">${code}</code>`;
  });

  return out;
}

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source ?? '').split(/\r?\n/);
  const html: string[] = [];

  let listType: 'ul' | 'ol' | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  const closeParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    }
  };

  const closeQuote = () => {
    if (quote.length) {
      html.push(
        `<blockquote class="border-l-2 border-primary pl-4 italic">${inline(quote.join(' '))}</blockquote>`,
      );
      quote = [];
    }
  };

  const closeAll = () => {
    closeParagraph();
    closeList();
    closeQuote();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      closeAll();
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      closeAll();
      html.push('<hr class="border-border" />');
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeAll();
      // Page titles render separately, so authored headings start at h2.
      const level = Math.min(4, heading[1]!.length + 1);
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      closeQuote();
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(bullet[1]!)}</li>`);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      closeParagraph();
      closeQuote();
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(numbered[1]!)}</li>`);
      continue;
    }

    const quoted = /^&gt;\s?(.*)$/.exec(line);
    if (quoted) {
      closeParagraph();
      closeList();
      quote.push(quoted[1]!);
      continue;
    }

    closeList();
    closeQuote();
    paragraph.push(line.trim());
  }

  closeAll();
  return html.join('\n');
}

/** First ~160 characters of plain text, for a meta description fallback. */
export function markdownExcerpt(source: string, length = 160): string {
  const plain = (source ?? '')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return plain.length <= length ? plain : `${plain.slice(0, length - 1).trimEnd()}…`;
}
