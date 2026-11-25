const pdfRoot = new URL('./vendor/pdfjs/build/', import.meta.url);
const pdfVersion = '4.10.38';
const privateSymbol = /^[\uE000-\uF8FF]$/u;

export function rgbHex(red, green, blue) {
  return '#' + [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('');
}

export async function openPdf(bytes) {
  const pdfjs = await import(new URL(`pdf.mjs?v=${pdfVersion}`, pdfRoot).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(`pdf.worker.mjs?v=${pdfVersion}`, pdfRoot).href;
  return pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true }).promise;
}

export async function renderPage(page, target = 1500) {
  const original = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: target / Math.max(original.width, original.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  await page.render({ canvasContext: context, viewport }).promise;
  return { canvas, context, viewport };
}

export function parseKey(items) {
  const rows = [];
  const sorted = items.filter(item => item.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5]);
  for (const item of sorted) {
    const row = rows.at(-1);
    if (row && Math.abs(row[0].transform[5] - item.transform[5]) <= 1.25) {
      row.push(item);
    } else {
      rows.push([item]);
    }
  }
  const key = new Map();
  for (const row of rows.values()) {
    const line = row.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(' ');
    const entry = line.match(/([\uE000-\uF8FF])\s+((?:DMC|Anchor|Madeira)\s+[A-Z0-9]+)\s+(\d+)/iu);
    if (entry) key.set(entry[1], { name: entry[2].replace(/\s+/g, ' '), count: Number(entry[3]) });
  }
  return key;
}

function chartGeometry(items) {
  const stitches = items.filter(item => privateSymbol.test(item.str?.trim()));
  if (stitches.length < 16 || items.some(item => /Thread\s*No/i.test(item.str || ''))) return null;
  const levels = [...new Set(stitches.map(item => Math.round(item.transform[5] * 100) / 100))].sort((a, b) => b - a);
  const gaps = levels.slice(1).map((level, index) => levels[index] - level).filter(gap => gap > 3);
  if (gaps.length < 3) return null;
  const pitch = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  const firstX = Math.min(...stitches.map(item => item.transform[4]));
  const firstY = levels[0];
  const lastX = Math.max(...stitches.map(item => item.transform[4]));
  const numeric = items.filter(item => /^\s*\d+(?:\s+\d+)*\s*$/.test(item.str || ''));
  const top = numeric.filter(item => item.transform[5] > firstY && item.transform[5] < firstY + pitch * 2 && item.transform[4] >= firstX - pitch / 2);
  const left = numeric.filter(item => item.transform[4] < firstX - pitch * .4 && item.transform[5] <= firstY + pitch / 2 && item.transform[5] >= levels.at(-1) - pitch);
  function offset(labels, position) {
    const candidates = labels.map(item => {
      const stitch = Number.parseInt(item.str, 10);
      return stitch % 10 === 0 ? stitch - 1 - Math.round(position(item)) : -1;
    });
    return candidates.find(value => value >= 0 && candidates.filter(candidate => candidate === value).length >= Math.min(2, candidates.length));
  }
  const col = offset(top, item => (item.transform[4] - firstX) / pitch);
  const row = offset(left, item => (firstY - item.transform[5]) / pitch);
  if (col === undefined || row === undefined || lastX - firstX < pitch * 2) return null;
  return { stitches, pitch, firstX, firstY, col, row };
}

function sampleColors(image, x, y, dx, dy, approximate = false) {
  const colors = new Map();
  const channel = approximate ? value => Math.min(255, Math.round(value / 16) * 16) : value => value;
  for (const fy of [.14, .25, .5, .75, .86]) {
    for (const fx of [.14, .25, .5, .75, .86]) {
      const px = Math.max(0, Math.min(image.width - 1, Math.floor(x + dx * fx)));
      const py = Math.max(0, Math.min(image.height - 1, Math.floor(y + dy * fy)));
      const index = (px + py * image.width) * 4;
      const color = image.data[index + 3] < 128 ? null : rgbHex(channel(image.data[index]), channel(image.data[index + 1]), channel(image.data[index + 2]));
      colors.set(color, (colors.get(color) || 0) + 1);
    }
  }
  return mostCommon(colors);
}

function mostCommon(counts) {
  let best = null;
  let count = 0;
  for (const [value, uses] of counts) {
    if (uses > count) {
      best = value;
      count = uses;
    }
  }
  return best;
}

export async function readPdfPattern(pdf, onPage = () => {}) {
  const key = new Map();
  const charts = [];
  let title = '';
  let expectedSize;
  for (let index = 1; index <= pdf.numPages; index++) {
    onPage(index, pdf.numPages);
    const page = await pdf.getPage(index);
    const { items } = await page.getTextContent();
    const cover = items.map(item => item.str).join(' ');
    const chart = chartGeometry(items);
    if (chart) {
      charts.push({ page, ...chart });
    } else {
      for (const [symbol, data] of parseKey(items)) key.set(symbol, data);
      title ||= cover.match(/\bName:\s*(.+?)\s+Author:/i)?.[1] || '';
      const size = cover.match(/\bSize:\s*(\d+)\s*[×x]\s*(\d+)\s*sts/i);
      if (size) expectedSize = size.slice(1).map(Number);
      page.cleanup();
    }
  }
  if (!charts.length) return null;
  const cells = new Map();
  const samples = new Map();
  let width = 0;
  let height = 0;
  for (const [index, chart] of charts.entries()) {
    onPage(index + 1, charts.length, true);
    const { page, stitches, pitch, firstX, firstY, col, row } = chart;
    const { canvas, context, viewport } = await renderPage(page, 1150);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for (const item of stitches) {
      const symbol = item.str.trim();
      const localX = Math.round((item.transform[4] - firstX) / pitch);
      const localY = Math.round((firstY - item.transform[5]) / pitch);
      const x = col + localX;
      const y = row + localY;
      const address = `${x},${y}`;
      if (cells.has(address) && cells.get(address)[2] !== symbol) return null;
      cells.set(address, [x, y, symbol]);
      width = Math.max(width, x + 1);
      height = Math.max(height, y + 1);
      const [px, py] = viewport.convertToViewportPoint(firstX + (localX - .19) * pitch, firstY + (.72 - localY) * pitch);
      const color = sampleColors(pixels, px, py, pitch * viewport.scale, pitch * viewport.scale);
      const votes = samples.get(symbol) || new Map();
      votes.set(color, (votes.get(color) || 0) + 1);
      samples.set(symbol, votes);
    }
    page.cleanup();
  }
  if (expectedSize) {
    if (width > expectedSize[0] || height > expectedSize[1]) return null;
    [width, height] = expectedSize;
  }
  if (width * height > 2_250_000 || cells.size < 16) return null;
  const ids = new Array(width * height).fill(null);
  for (const [x, y, symbol] of cells.values()) ids[y * width + x] = symbol;
  const colors = new Map([...samples].map(([symbol, votes]) => {
    const color = mostCommon(votes);
    return [symbol, { color: color || '#ffffff', name: key.get(symbol)?.name }];
  }));
  if (key.size && colors.size === key.size && [...key.keys()].every(symbol => colors.has(symbol))) {
    const counts = new Map();
    for (const [, , symbol] of cells.values()) counts.set(symbol, (counts.get(symbol) || 0) + 1);
    if ([...key].some(([symbol, entry]) => counts.get(symbol) !== entry.count)) return null;
  }
  return { title, width, height, ids, colors, source: 'PDF chart', symbolKey: true };
}

export async function readThreadKey(pdf) {
  const key = new Map();
  for (let index = 1; index <= pdf.numPages; index++) {
    const page = await pdf.getPage(index);
    const { items } = await page.getTextContent();
    for (const [symbol, entry] of parseKey(items)) key.set(symbol, entry);
    page.cleanup();
  }
  return key;
}

export function readOxs(text) {
  if (/<!DOCTYPE/i.test(text)) throw new Error('Choose an OXS chart without a document type declaration.');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  const chart = document.documentElement;
  if (chart.localName !== 'chart' || chart.querySelector('parsererror')) throw new Error('This file is not a valid Open Cross Stitch chart.');
  const properties = chart.querySelector(':scope > properties');
  const palette = chart.querySelector(':scope > palette');
  const stitches = chart.querySelector(':scope > fullstitches');
  function integer(element, attribute) {
    const value = element?.getAttribute(attribute);
    return /^\d+$/.test(value ?? '') ? Number(value) : NaN;
  }
  const width = integer(properties, 'chartwidth');
  const height = integer(properties, 'chartheight');
  if (!(width >= 1 && width <= 1500 && height >= 1 && height <= 1500 && palette && stitches)) {
    throw new Error('The OXS chart needs a palette, a full-stitch section, and dimensions between 1 and 1,500 stitches.');
  }
  const colors = new Map();
  for (const entry of palette.children) {
    if (entry.localName !== 'palette_item') continue;
    const index = integer(entry, 'index');
    if (!(index > 0 && Number.isSafeInteger(index))) continue;
    const color = (entry.getAttribute('color') || entry.getAttribute('printcolor') || '').replace(/^#/, '').toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(color)) continue;
    const name = [entry.getAttribute('number'), entry.getAttribute('name')]
      .filter(Boolean).map(value => value.trim().replace(/\s+/g, ' ')).filter(Boolean).join(' · ');
    colors.set(String(index), { color: '#' + color, name: name || undefined });
  }
  const ids = new Array(width * height).fill(null);
  let count = 0;
  for (const stitch of stitches.children) {
    if (stitch.localName !== 'stitch') continue;
    const index = integer(stitch, 'palindex');
    if (index === 0) continue;
    const id = String(index);
    const x = integer(stitch, 'x');
    const y = integer(stitch, 'y');
    if (!(x >= 0 && x < width && y >= 0 && y < height && colors.has(id))) {
      throw new Error('An OXS full stitch is outside the grid or refers to a missing thread color.');
    }
    const position = y * width + x;
    if (ids[position] !== null && ids[position] !== id) {
      throw new Error('This OXS chart places different full crosses in the same square.');
    }
    ids[position] = id;
    count++;
  }
  if (!count) throw new Error('This OXS chart contains no full crosses.');
  const omitted = Boolean(chart.querySelector('partstitches > *, backstitches > *, ornaments_inc_knots_and_beads > *'));
  return { title: properties.getAttribute('charttitle')?.trim(), width, height, ids, colors, source: 'OXS chart', omitted };
}

export async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { canvas, context, approximate: /\.jpe?g$/i.test(file.name) };
}

function groupJpegColors(counts) {
  const groups = new Map();
  const palette = [];
  for (const [hex] of [...counts].sort((a, b) => b[1] - a[1])) {
    const rgb = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
    let nearest;
    let closest = 28 ** 2;
    for (const choice of palette) {
      const distance = (rgb[0] - choice.rgb[0]) ** 2 + (rgb[1] - choice.rgb[1]) ** 2 + (rgb[2] - choice.rgb[2]) ** 2;
      if (distance < closest) {
        closest = distance;
        nearest = choice;
      }
    }
    if (!nearest) {
      nearest = { hex, rgb };
      palette.push(nearest);
    }
    groups.set(hex, nearest.hex);
  }
  return groups;
}

export function readColorGrid(source, bounds, width, height) {
  if (!Number.isInteger(width) || width < 1 || width > 1500 || !Number.isInteger(height) || height < 1 || height > 1500) {
    throw new Error('Enter a whole number from 1 to 1,500 for both columns and rows.');
  }
  const { x, y, w, h } = bounds;
  if (w < width || h < height) throw new Error('The selected area needs at least one image pixel per stitch. Check the corners and dimensions.');
  const pixels = source.context.getImageData(x, y, w, h);
  const ids = new Array(width * height);
  const counts = new Map();
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const color = sampleColors(pixels, col * w / width, row * h / height, w / width, h / height, source.approximate);
      ids[row * width + col] = color;
      if (color) counts.set(color, (counts.get(color) || 0) + 1);
      if (!source.approximate && counts.size > 512) throw new Error('More than 512 colors were found. Check the grid and use a flat-color chart or an original pixel pattern.');
    }
  }
  if (!counts.size) throw new Error('No colored stitches were found in the selected area.');
  const grouped = source.approximate ? groupJpegColors(counts) : null;
  const palette = grouped ? new Set(grouped.values()) : counts.keys();
  if (grouped && palette.size > 512) throw new Error('More than 512 colors were found. Use a flat-color PNG or an original pixel pattern.');
  const colors = new Map([...palette].map(color => [color, { color, name: color.toUpperCase() }]));
  return { width, height, ids: grouped ? ids.map(id => id === null ? null : grouped.get(id)) : ids, colors, source: 'Color grid' };
}
