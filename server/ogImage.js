// Renders a lightweight social-preview card (SVG, rasterized to PNG
// elsewhere via sharp) for a note.
//
// Text is drawn with an embedded font (base64 data URI, bundled in
// server/assets/fonts/) rather than a named system font like "Roboto" or
// "Segoe UI" — a bare font-family reference only renders if that font
// happens to be installed on the server, and most minimal Linux hosts have
// none, which is exactly what produced blank "tofu" boxes instead of text
// in early testing. Embedding removes that dependency entirely.

const fs = require('fs');
const path = require('path');

const FONT_REGULAR_BASE64 = fs.readFileSync(path.join(__dirname, 'assets/fonts/Roboto-Regular.woff')).toString('base64');
const FONT_BOLD_BASE64 = fs.readFileSync(path.join(__dirname, 'assets/fonts/Roboto-Bold.woff')).toString('base64');

const FONT_FACES = `
  @font-face {
    font-family: 'OgImageFont';
    font-weight: 400;
    src: url(data:font/woff;base64,${FONT_REGULAR_BASE64}) format('woff');
  }
  @font-face {
    font-family: 'OgImageFont';
    font-weight: 700;
    src: url(data:font/woff;base64,${FONT_BOLD_BASE64}) format('woff');
  }
`;

const NOTE_COLORS = {
  default: { bg: '#ffffff', border: '#e0e0e0' },
  red: { bg: '#fbe1df', border: '#f2b8b5' },
  orange: { bg: '#fef0dc', border: '#f7d29c' },
  yellow: { bg: '#fef8d9', border: '#f5e27a' },
  green: { bg: '#e6f4ea', border: '#b6e2c4' },
  teal: { bg: '#e0f7f5', border: '#a8ded4' },
  blue: { bg: '#e3f1fb', border: '#aecdf2' },
  purple: { bg: '#f1e6fb', border: '#d9bdf0' },
  pink: { bg: '#fce8f0', border: '#f3c2dc' },
};

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[c]));
}

function wrapText(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncateToLine(text, maxChars) {
  const lines = wrapText(text, maxChars);
  if (lines.length <= 1) return lines[0] || '';
  return `${lines[0]}…`;
}

const FONT = "'OgImageFont', sans-serif";

function renderNoteSvg(note) {
  const W = 1200;
  const H = 630;
  const PAD = 64;
  const colors = NOTE_COLORS[note.color] || NOTE_COLORS.default;

  const titleLines = wrapText(note.title || 'Untitled list', 34).slice(0, 2);
  const titleFontSize = 52;
  const titleLineHeight = 62;

  const MAX_ITEMS = 6;
  const items = (note.items || []).slice(0, MAX_ITEMS);
  const remaining = (note.items || []).length - items.length;

  const itemFontSize = 32;
  const itemLineHeight = 48;
  const checkboxSize = 28;

  let y = PAD + titleLines.length * titleLineHeight + 36;

  const itemsSvg = items
    .map((item) => {
      const text = truncateToLine(item.text || '(empty item)', 56);
      const checked = !!item.checked;
      const boxY = y - checkboxSize + 6;
      const checkbox = checked
        ? `<rect x="${PAD}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="#1a73e8" />
           <path d="M ${PAD + 6} ${boxY + 14} L ${PAD + 12} ${boxY + 20} L ${PAD + 22} ${boxY + 8}" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
        : `<rect x="${PAD}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="none" stroke="#5f6368" stroke-width="2.5" />`;
      const textEl = `<text x="${PAD + checkboxSize + 20}" y="${y}" font-size="${itemFontSize}" font-family="${FONT}" fill="${
        checked ? '#5f6368' : '#202124'
      }"${checked ? ' text-decoration="line-through"' : ''}>${escapeXml(text)}</text>`;
      const row = checkbox + textEl;
      y += itemLineHeight;
      return row;
    })
    .join('\n');

  const moreText =
    remaining > 0
      ? `<text x="${PAD + checkboxSize + 20}" y="${y}" font-size="${itemFontSize - 6}" font-family="${FONT}" fill="#5f6368">+${remaining} more</text>`
      : '';

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="${PAD}" y="${PAD + titleFontSize + i * titleLineHeight}" font-size="${titleFontSize}" font-weight="700" font-family="${FONT}" fill="#202124">${escapeXml(
          line
        )}</text>`
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>${FONT_FACES}</style>
  <rect width="${W}" height="${H}" fill="${colors.bg}" />
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="${colors.border}" stroke-width="4" />
  ${titleSvg}
  ${itemsSvg}
  ${moreText}
  <text x="${W - PAD}" y="${H - 36}" font-size="26" font-family="${FONT}" fill="#5f6368" text-anchor="end">📝 Todo Keep</text>
</svg>`;
}

module.exports = { renderNoteSvg };
