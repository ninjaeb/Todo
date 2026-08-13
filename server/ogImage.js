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

// Loaded defensively, same reasoning as sharp in server/index.js: a missing
// or failed install of a dependency used only for this optional preview
// image shouldn't crash the whole server (as a top-level
// require('cookie-parser') once did before it was installed). If
// opentype.js isn't available, renderNoteSvg falls back to plain <text>
// elements below — worse (depends on the host having a matching font
// installed) but not fatal.
let opentype = null;
try {
  opentype = require('opentype.js');
} catch (err) {
  console.warn(`opentype.js not available (${err.message}) — og-image text will fall back to <text> elements.`);
}

function loadFont(filename) {
  const buffer = fs.readFileSync(path.join(__dirname, 'assets/fonts', filename));
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return opentype.parse(arrayBuffer);
}

const REGULAR_FONT = opentype ? loadFont('Roboto-Regular.woff') : null;
const BOLD_FONT = opentype ? loadFont('Roboto-Bold.woff') : null;

function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

const PRIORITY_COLORS = {
  high: '#e0483e',
  medium: '#f5a623',
  low: '#34a853',
};

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

// Roboto has no outline for emoji/symbol characters outside its own
// coverage (e.g. bullet emoji some users type into item text) — charToGlyph
// silently returns the .notdef glyph for those, which is a visible tofu
// box, not a blank. Skip such characters entirely (no width, no path)
// rather than drawing the box.
function hasGlyph(font, char) {
  return font.charToGlyphIndex(char) !== 0;
}

// Width of a run of text at a given font size, in px — used for both
// wrapping and truncation, measured from real glyph advance widths rather
// than a guessed characters-per-line constant.
function measureWidth(font, text, fontSize) {
  const scale = fontSize / font.unitsPerEm;
  let width = 0;
  for (const char of text) {
    if (!hasGlyph(font, char)) continue;
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
    if (!hasGlyph(font, char)) continue;
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

function renderNoteSvgWithGlyphs(note) {
  const W = 1200;
  const PAD = 64;
  const colors = NOTE_COLORS[note.color] || NOTE_COLORS.default;
  const contentWidth = W - PAD * 2;

  const titleFontSize = 52;
  const titleLineHeight = 62;
  const titleLines = wrapByWidth(BOLD_FONT, note.title || 'Untitled list', titleFontSize, contentWidth).slice(0, 2);

  // Show the whole list rather than truncating to a fixed count — the
  // image height grows to fit, capped at MAX_ITEMS so a huge list doesn't
  // produce an unreasonably tall image. Completed items are left out
  // entirely: the preview is meant to show what's left to do, not a record
  // of what's already done.
  const MAX_ITEMS = 40;
  const openItems = (note.items || []).filter((item) => !item.checked);
  const items = openItems.slice(0, MAX_ITEMS);
  const remaining = openItems.length - items.length;

  const itemFontSize = 32;
  const itemLineHeight = 48;
  const checkboxSize = 28;
  const priorityDotSize = 16;
  const checkboxX = PAD + priorityDotSize + 12;
  const textX = checkboxX + checkboxSize + 20;
  const itemTextMaxWidth = W - PAD - textX;

  const titleBlockHeight = PAD + titleFontSize * 0.8 + (titleLines.length - 1) * titleLineHeight + 60;
  const listHeight = items.length * itemLineHeight + (remaining > 0 ? itemLineHeight : 0);
  const H = Math.max(630, Math.round(titleBlockHeight + listHeight + 90));

  let y = titleBlockHeight;

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
      const priorityColor = PRIORITY_COLORS[item.priority];
      const priorityDotY = boxY + checkboxSize / 2;
      const priorityDot = priorityColor
        ? `<circle cx="${PAD + priorityDotSize / 2}" cy="${priorityDotY}" r="${priorityDotSize / 2}" fill="${priorityColor}" />`
        : '';
      const checkbox = checked
        ? `<rect x="${checkboxX}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="#1a73e8" />
           <path d="M ${checkboxX + 6} ${boxY + 14} L ${checkboxX + 12} ${boxY + 20} L ${checkboxX + 22} ${boxY + 8}" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
        : `<rect x="${checkboxX}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="none" stroke="#5f6368" stroke-width="2.5" />`;
      const { d, width } = textToPath(REGULAR_FONT, text, textX, y, itemFontSize);
      const strike = checked
        ? `<line x1="${textX}" y1="${y - itemFontSize * 0.32}" x2="${textX + width}" y2="${y - itemFontSize * 0.32}" stroke="#5f6368" stroke-width="2" />`
        : '';
      const textPath = `<path d="${d}" fill="${checked ? '#5f6368' : '#202124'}" />${strike}`;
      const row = priorityDot + checkbox + textPath;
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

// Fallback used only if opentype.js failed to load (see the require() at
// the top of this file). Plain <text> with a bare font-family, which only
// renders correctly if the host happens to have a matching font installed
// — worse than the glyph-outline version above, but keeps the endpoint
// working instead of 500ing or crashing the server.
function renderNoteSvgFallback(note) {
  const W = 1200;
  const H = 630;
  const PAD = 64;
  const colors = NOTE_COLORS[note.color] || NOTE_COLORS.default;
  const CHARS_PER_LINE = 30;

  const wrapByChars = (text, maxChars) => {
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
  };

  const titleLines = wrapByChars(note.title || 'Untitled list', CHARS_PER_LINE).slice(0, 2);
  const MAX_ITEMS = 6;
  const openItems = (note.items || []).filter((item) => !item.checked);
  const items = openItems.slice(0, MAX_ITEMS);
  const remaining = openItems.length - items.length;
  const checkboxSize = 28;
  const priorityDotSize = 16;
  const checkboxX = PAD + priorityDotSize + 12;
  const textX = checkboxX + checkboxSize + 20;

  let y = PAD + 42 + (titleLines.length - 1) * 62 + 36;

  const titleSvg = titleLines
    .map((line, i) => `<text x="${PAD}" y="${PAD + 42 + i * 62}" font-family="Arial, sans-serif" font-weight="bold" font-size="52" fill="#202124">${escapeXml(line)}</text>`)
    .join('\n');

  const itemsSvg = items
    .map((item) => {
      const text = wrapByChars(item.text || '(empty item)', 44)[0];
      const checked = !!item.checked;
      const boxY = y - checkboxSize + 6;
      const priorityColor = PRIORITY_COLORS[item.priority];
      const priorityDot = priorityColor
        ? `<circle cx="${PAD + priorityDotSize / 2}" cy="${boxY + checkboxSize / 2}" r="${priorityDotSize / 2}" fill="${priorityColor}" />`
        : '';
      const checkbox = checked
        ? `<rect x="${checkboxX}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="#1a73e8" />
           <path d="M ${checkboxX + 6} ${boxY + 14} L ${checkboxX + 12} ${boxY + 20} L ${checkboxX + 22} ${boxY + 8}" stroke="white" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />`
        : `<rect x="${checkboxX}" y="${boxY}" width="${checkboxSize}" height="${checkboxSize}" rx="6" fill="none" stroke="#5f6368" stroke-width="2.5" />`;
      const decoration = checked ? 'line-through' : 'none';
      const textSvg = `<text x="${textX}" y="${y}" font-family="Arial, sans-serif" font-size="32" fill="${checked ? '#5f6368' : '#202124'}" text-decoration="${decoration}">${escapeXml(text)}</text>`;
      const row = priorityDot + checkbox + textSvg;
      y += 48;
      return row;
    })
    .join('\n');

  const moreSvg = remaining > 0
    ? `<text x="${textX}" y="${y}" font-family="Arial, sans-serif" font-size="26" fill="#5f6368">+${remaining} more</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${colors.bg}" />
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" fill="none" stroke="${colors.border}" stroke-width="4" />
  ${titleSvg}
  ${itemsSvg}
  ${moreSvg}
  <text x="${W - PAD}" y="${H - 36}" text-anchor="end" font-family="Arial, sans-serif" font-size="26" fill="#5f6368">Todo Keep</text>
</svg>`;
}

function renderNoteSvg(note) {
  return opentype ? renderNoteSvgWithGlyphs(note) : renderNoteSvgFallback(note);
}

module.exports = { renderNoteSvg };
