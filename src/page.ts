/**
 * Render the tap-through HTML page.
 *
 * The page exists because the links can only be judged on a real handset: every
 * variant is a button, and a tester reports which ones opened GCash and what
 * the confirmation screen said.
 */

import type { ParsedQrph, Variant } from './types.ts';

/** One QR and its variants, as one section of the page. */
export interface PageSection {
  parsed: ParsedQrph;
  variants: Variant[];
  /** Optional callout rendered above the buttons. */
  note?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return '&quot;';
    }
  });
}

function describeInitMethod(code: string): string {
  if (code === '12') return `${code} (dynamic — expires)`;
  if (code === '11') return `${code} (static)`;
  return code || '?';
}

function renderSection(section: PageSection): string {
  const { parsed, variants, note } = section;

  const meta = [
    `₱${escapeHtml(parsed.amount || '(payer enters)')}`,
    escapeHtml(parsed.bankCode || '?'),
    `shop ${escapeHtml(parsed.shopId || '?')}`,
    `ref ${escapeHtml(parsed.referenceLabel || '-')}`,
    `init ${escapeHtml(describeInitMethod(parsed.initMethod))}`,
    parsed.crcValid
      ? '<span class="ok">CRC ok</span>'
      : '<span class="bad">CRC MISMATCH</span>',
  ].join(' &middot; ');

  const items = variants
    .map(
      (v) =>
        `<li><h2>${escapeHtml(v.label)}</h2>` +
        `<a class="btn" href="${escapeHtml(v.deeplink)}">gcash://</a>` +
        `<a class="btn alt" href="${escapeHtml(v.intent)}">intent://</a>` +
        `<details><summary>show link</summary><code>${escapeHtml(v.deeplink)}</code></details>` +
        `</li>`,
    )
    .join('');

  return (
    `<section>` +
    `<h1>${escapeHtml(parsed.merchantName || 'Unknown merchant')}</h1>` +
    `<p class="meta">${meta}</p>` +
    (note ? `<p class="note">${escapeHtml(note)}</p>` : '') +
    (parsed.crcValid
      ? ''
      : `<p class="note bad-note">CRC does not match — the payload may be truncated or ` +
        `mistyped. GCash validates server-side and will reject it.</p>`) +
    `<ul>${items}</ul>` +
    `</section>`
  );
}

/** Render one page holding every section, oldest QR first. */
export function renderPage(sections: PageSection[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GCash deeplink probe</title>
<style>
  :root{--bg:#f7f6f3;--card:#fff;--line:#e4e0d9;--ink:#1b1b1a;--dim:#6b675f;
        --accent:#0a6cff;--accent2:#18181b;--ok:#0a7d4a;--bad:#c0392b}
  @media (prefers-color-scheme:dark){
    :root{--bg:#17181a;--card:#212225;--line:#34363a;--ink:#ecebe8;--dim:#9a968e}
  }
  *{box-sizing:border-box}
  body{margin:0 auto;padding:16px;max-width:760px;background:var(--bg);color:var(--ink);
       font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
  section+section{border-top:2px solid var(--line);padding-top:22px;margin-top:30px}
  h1{font-size:19px;margin:0 0 4px;letter-spacing:-.01em}
  p.meta{margin:0;color:var(--dim);font-size:13px;word-break:break-all}
  p.note{margin:12px 0 0;background:#fff6e5;border:1px solid #f0d9a8;color:#6b4e0f;
         border-radius:8px;padding:9px 11px;font-size:13px}
  p.note.bad-note{background:#fdecea;border-color:#f2b8b1;color:#8c2019}
  @media (prefers-color-scheme:dark){
    p.note{background:#2c2415;border-color:#5a4718;color:#e6c98a}
    p.note.bad-note{background:#331c19;border-color:#6d2f27;color:#f0a79c}
  }
  ul{list-style:none;padding:0;margin:14px 0 0}
  li{background:var(--card);border:1px solid var(--line);border-radius:10px;
     padding:14px;margin-bottom:12px}
  h2{font-size:13px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.06em;
     color:var(--dim)}
  .btn{display:inline-block;padding:11px 18px;margin:0 8px 8px 0;border-radius:8px;
       background:var(--accent);color:#fff;text-decoration:none;font-weight:600;font-size:15px}
  .btn.alt{background:var(--accent2)}
  .ok{color:var(--ok);font-weight:600}
  .bad{color:var(--bad);font-weight:600}
  details{margin-top:4px}
  summary{font-size:12px;color:var(--dim);cursor:pointer}
  code{display:block;margin-top:6px;font-size:10.5px;line-height:1.4;
       word-break:break-all;color:var(--dim)}
</style>
</head>
<body>
${sections.map(renderSection).join('\n')}
</body>
</html>
`;
}
