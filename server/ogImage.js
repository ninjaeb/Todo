// Renders a lightweight social-preview card (SVG, rasterized to PNG
// elsewhere via sharp) for a note.
//
// Text is converted to vector outlines (SVG <path> data) ourselves via
// opentype.js, rather than left as <text> elements for the image renderer
// to draw with a font. Two earlier approaches both failed in production
// despite working in dev: a bare font-family name only renders if that
// font happens to be installed on the server (most minimal hosts have
// none — "tofu" boxes instead of letters), and an embedded @font-face
// data URI depends on the specific sharp/libvips build supporting
// font-loading at all, which this host's build apparently doesn't. Plain
// <path> elements have no such dependency — every SVG renderer draws
// vector shapes the same way regardless of what fonts, if any, exist on
// the system.
//
// opentype.js's own text-shaping (Font.getPath) crashes on a GSUB
// substitution type it doesn't support in Roboto's table, so glyphs are
// placed manually (per-character, using each glyph's own advance width)
// instead — no ligatures/kerning, which doesn't matter for a preview
// thumbnail.

const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');

function loadFont(filename) {
  const buffer = fs.readFileSync(path.join(__dirname, 'assets/fonts', filename));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return opentype.parse(arrayBuffer);
}

const REGULAR_FONT = loadFont('Roboto-Regular.woff');
const BOLD_FONT = loadFont('Roboto-Bold.woff');

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

// Width of a run of text at a given font size, in px — used for both
// wrapping and truncation, measured from real glyph advance widths rather
// than a guessed characters-per-line constant.
function measureWidth(font, text, fontSize) {
  const scale = fontSize / font.unitsPerEm;
  let width = 0;
  for (const char of text) {
    width += (font.charToGlyph(char).advanceWidth || 0) * scale;
  }
  return width;
}

// Builds SVG path data for a line of text, glyph by glyph (see file header
// for why not font.getPath). Returns the path "d" string and the total
// width consumed, positioned so (x, y) is the left end of the baseline.
function textToPath(font, text, x, y, fontSize) {
  const scale = fontSize / font.unitsPerEm;
  const combined = new opentype.Path();
  let curX = x;
  for (const char of text) {
    const glyph = font.charToGlyph(char);
    combined.extend(glyph.getPath(curX, y, fontSize));
    curX += (glyph.advanceWidth || 0) * scale;
  }
  return { d: combined.toPathData(2), width: curX - x };
}

function wrapByWidth(font, text, fontSize, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (measureWidth(font, next, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncateToWidth(font, text, fontSize, maxWidth) {
  if (measureWidth(font, text, fontSize) <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && measureWidth(font, `${result}…`, fontSize) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}…`;
}

function renderNoteSvg(note) {
  const W = 1200;
  const H = 630;
  const PAD = 64;
  const colors = NOTE_COLORS[note.color] || NOTE_COLORS.default;
  const contentWidth = W - PAD * 2;

  const titleFontSize = 52;
  const titleLineHeight = 62;
  const titleLines = wrapByWidth(BOLD_FONT, note.title || 'Untitled list', titleFontSize, contentWidth).slice(0, 2);

  const MAX_ITEMS = 6;
  const items = (note.items || []).slice(0, MAX_ITEMS);
  const remaining = (note.items || []).length - items.length;

  const itemFontSize = 32;
  const itemLineHeight = 48;
  const checkboxSize = 28;
  const textX = PAD + checkboxSize + 20;
  const itemTextMaxWidth = W - PAD - textX;

  let y = PAD + titleFontSize * 0.8 + (titleLines.length - 1) * titleLineHeight + 36;

  const titlePaths = titleLines
    .map((line, i) => {
      const { d } = textToPath(BOLD_FONT, line, PAD, PAD + titleFontSize * 0.8 + i * titleLineHeight, titleFontSize);
      return `<path d="${d}" fill="#202124" />`;
    })
    .join('\n');

  const itemPaths = items
    .map((item) => {
      const text = truncateToWidth(REGULAR_FONT, item.text || '(empty item)', itemFontSize, itemTextMaxWidth);
      const checked = !!item.checked;
      const boxY = y - checkboxSize + 6;
      const checkbox = checked
        ? `<rect x="${PAD}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="#1a73e8" />
           <path d="M ${PAD + 6} ${boxY + 14} L ${PAD + 12} ${boxY + 20} L ${PAD + 22} ${boxY + 8}" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
        : `<rect x="${PAD}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="none" stroke="#5f6368" stroke-width="2.5" />`;
      const { d, width } = textToPath(REGULAR_FONT, text, textX, y, itemFontSize);
      const strike = checked
        ? `<line x1="${textX}" y1="${y - itemFontSize * 0.32}" x2="${textX + width}" y2="${y - itemFontSize * 0.32}" stroke="#5f6368" stroke-width="2" />`
        : '';
      const textPath = `<path d="${d}" fill="${checked ? '#5f6368' : '#202124'}" />${strike}`;
      const row = checkbox + textPath;
      y += itemLineHeight;
      return row;
    })
    .join('\n');

  let moreSvg = '';
  if (remaining > 0) {
    const moreFontSize = itemFontSize - 6;
    const { d } = textToPath(REGULAR_FONT, `+${remaining} more`, textX, y, moreFontSize);
    moreSvg = `<path d="${d}" fill="#5f6368" />`;
  }

  const footerText = '📝 Todo Keep';
  const footerFontSize = 26;
  const footerWidth = measureWidth(REGULAR_FONT, footerText.replace('📝 ', ''), footerFontSize);
  const { d: footerPathD } = textToPath(
    REGULAR_FONT,
    footerText.replace('📝 ', ''),
    W - PAD - footerWidth,
    H - 36,
    footerFontSize
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${colors.bg}" />
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="${colors.border}" stroke-width="4" />
  ${titlePaths}
  ${itemPaths}
  ${moreSvg}
  <path d="${footerPathD}" fill="#5f6368" />
</svg>`;
}

module.exports = { renderNoteSvg };
