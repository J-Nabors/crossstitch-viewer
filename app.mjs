import { openPdf, readPdfPattern, readThreadKey, renderPage, readImage, readColorGrid, readOxs } from './patterns.mjs';
import { demoPattern } from './demo.mjs';
import { readProgress, writeProgress, encodeProgress, decodeProgress, mergeProgress } from './progress.mjs';

const byId = id => document.getElementById(id);
const chart = byId('chart');
const viewport = byId('viewport');
const threads = byId('threads');
const context = chart.getContext('2d');
const stitchPixels = document.createElement('canvas');
const pixelContext = stitchPixels.getContext('2d');
const countFormat = new Intl.NumberFormat();
const selectionHint = 'Click stitches or threads to toggle their colors.';
const horizontalRulers = [byId('ruler-top'), byId('ruler-bottom')];
const verticalRulers = [byId('ruler-left'), byId('ruler-right')];
let pattern;
let pending;
let palette = new Map();
let completed = new Set();
const selected = new Set();
let progressRecords = new Map();
let unsavedProgress = false;
let zoom = 1;
let busy = false;
let focusFrame;
let rulerScale;

function notice(message = '', error = false) {
  const status = byId('status');
  status.textContent = message;
  status.hidden = !message;
  status.dataset.error = error;
}

function setBusy(value) {
  busy = value;
  for (const id of ['open-pattern', 'open-key', 'demo', 'source-page', 'apply-grid']) {
    byId(id).disabled = value || (id === 'open-key' && (pending || !pattern?.symbolKey));
  }
}

async function fileId(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function currentProgress() {
  if (!unsavedProgress) {
    try { progressRecords = readProgress(localStorage); } catch { /* Keep the in-memory copy. */ }
  }
  return progressRecords;
}

function saveProgress(records) {
  progressRecords = records;
  try {
    writeProgress(localStorage, records);
    unsavedProgress = false;
  } catch {
    unsavedProgress = true;
  }
  return !unsavedProgress;
}

function loadCompletion(records) {
  completed = new Set([...(records.get(pattern.storageId) || [])].filter(id => palette.has(id)));
}

function setPattern(value) {
  const previousPdf = pending?.pdf;
  pending = null;
  if (previousPdf) void previousPdf.destroy().catch(() => {});
  pattern = value;
  palette = new Map();
  for (const id of pattern.ids) {
    if (id === null) continue;
    if (!palette.has(id)) palette.set(id, { ...pattern.colors.get(id), count: 0 });
    palette.get(id).count++;
  }
  const ordered = [...palette].sort((a, b) => (a[1].name || a[1].color).localeCompare(b[1].name || b[1].color, undefined, { numeric: true }));
  palette = new Map(ordered);
  loadCompletion(currentProgress());
  selected.clear();
  byId('setup').hidden = true;
  byId('thread-search').value = '';
  byId('thread-filter').value = 'all';
  byId('project-name').textContent = pattern.title;
  byId('project-meta').textContent = `${pattern.width} × ${pattern.height} stitches · ${palette.size} threads · ${pattern.source}`;
  byId('demo').hidden = pattern.storageId.startsWith('demo-');
  byId('chart-hint').textContent = selectionHint;
  byId('open-key').disabled = busy || !pattern.symbolKey;
  byId('open-key').title = pattern.symbolKey ? 'Read thread names from a compatible PDF key' : 'Separate keys are available for recognized symbol-based PDF charts';
  byId('coordinate').textContent = '';
  zoom = 1;
  paintStitches();
  drawChart(false);
  updatePalette();
}

function threadLabel(entry) {
  return entry.name || entry.color.toUpperCase();
}

function updatePalette(restoreFocus) {
  const filter = byId('thread-filter').value;
  const query = byId('thread-search').value.trim().toLowerCase();
  const scroll = threads.scrollTop;
  const rows = document.createDocumentFragment();
  let focusedControl;
  for (const [id, entry] of palette) {
    const checked = completed.has(id);
    if ((filter === 'done' && !checked) || (filter === 'todo' && checked)) continue;
    const name = threadLabel(entry);
    if (query && ![name, entry.color].some(text => text.toLowerCase().includes(query))) continue;
    const row = document.createElement('li');
    row.className = 'thread' + (selected.has(id) ? ' active' : '');
    row.dataset.thread = id;
    const button = document.createElement('button');
    button.className = 'thread-button';
    button.setAttribute('aria-pressed', selected.has(id));
    button.addEventListener('click', () => selectThread(id, { id, type: 'button' }));
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = entry.color;
    const details = document.createElement('span');
    const label = document.createElement('span');
    label.className = 'thread-name';
    label.textContent = name;
    const quantity = document.createElement('span');
    quantity.className = 'thread-count';
    quantity.textContent = `${countFormat.format(entry.count)} ${entry.count === 1 ? 'stitch' : 'stitches'}`;
    details.append(label, quantity);
    button.append(swatch, details);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.setAttribute('aria-label', `Mark ${name} complete`);
    checkbox.addEventListener('change', () => {
      const records = new Map(currentProgress());
      const threads = new Set(records.get(pattern.storageId));
      if (checkbox.checked) threads.add(id);
      else threads.delete(id);
      records.set(pattern.storageId, threads);
      if (!saveProgress(records)) notice('This browser could not save progress. Copy a progress code before closing the page.', true);
      loadCompletion(records);
      updatePalette({ id, type: 'checkbox' });
    });
    row.append(button, checkbox);
    rows.append(row);
    if (restoreFocus?.id === id) focusedControl = restoreFocus.type === 'button' ? button : checkbox;
  }
  if (!rows.childElementCount) {
    const empty = document.createElement('li');
    empty.className = 'empty-threads';
    empty.textContent = pending ? 'Read the stitch grid to see its colors.' : 'No threads match your search.';
    rows.append(empty);
  }
  threads.replaceChildren(rows);
  threads.scrollTop = scroll;
  if (restoreFocus) (focusedControl || byId('thread-filter')).focus({ preventScroll: true });
  byId('progress-text').textContent = `${completed.size} of ${palette.size} colors complete`;
  byId('progress').max = palette.size || 1;
  byId('progress').value = completed.size;
  byId('focus-bar').hidden = selected.size === 0;
  byId('focus-text').textContent = selected.size === 1
    ? threadLabel(palette.get(selected.values().next().value))
    : `${selected.size} colors selected`;
}

function selectThread(id, restoreFocus) {
  if (pending) return;
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  paintStitches();
  drawChart();
  updatePalette(restoreFocus);
  if (!restoreFocus && selected.has(id)) {
    const row = [...threads.children].find(element => element.dataset.thread === id);
    if (row) {
      const bounds = row.getBoundingClientRect();
      const visible = threads.getBoundingClientRect();
      if (bounds.top < visible.top) threads.scrollTop += bounds.top - visible.top;
      if (bounds.bottom > visible.bottom) threads.scrollTop += bounds.bottom - visible.bottom;
    }
  }
}

function clearSelection() {
  if (!selected.size) return;
  if (document.activeElement === byId('clear-focus')) byId('thread-search').focus();
  selected.clear();
  paintStitches();
  drawChart();
  updatePalette();
}

function paintStitches() {
  const { width, height, ids } = pattern;
  stitchPixels.width = width;
  stitchPixels.height = height;
  const pixels = pixelContext.createImageData(width, height);
  const display = new Map();
  const opacity = Number(byId('other-opacity').value) / 100;
  const saturation = Number(byId('other-saturation').value) / 100;
  const lightSelection = [...selected].some(id => [1, 3, 5].every(offset => Number.parseInt(palette.get(id).color.slice(offset, offset + 2), 16) >= 208));
  chart.style.backgroundColor = lightSelection && opacity < 1
    ? `color-mix(in srgb, #fffefa ${opacity * 100}%, #c0c9c2)`
    : '';
  for (const [id, entry] of palette) {
    const code = Number.parseInt(entry.color.slice(1), 16);
    let rgb = [code >> 16, (code >> 8) & 255, code & 255];
    const muted = selected.size && !selected.has(id);
    if (muted && saturation < 1) {
      const gray = .21 * rgb[0] + .72 * rgb[1] + .07 * rgb[2];
      rgb = rgb.map(channel => channel * saturation + gray * (1 - saturation));
    }
    display.set(id, [...rgb, muted ? Math.round(255 * opacity) : 255]);
  }
  for (let index = 0; index < ids.length; index++) {
    const rgba = display.get(ids[index]);
    if (rgba) pixels.data.set(rgba, index * 4);
  }
  pixelContext.putImageData(pixels, 0, 0);
}

function drawRulers(rulers, dimension, cellSize, side) {
  const ticks = document.createDocumentFragment();
  const step = Math.max(10, Math.ceil(38 / (10 * cellSize)) * 10);
  for (let number = 0; number <= dimension; number += step) {
    const label = document.createElement('span');
    label.textContent = number;
    label.style[side] = `${number * cellSize}px`;
    ticks.append(label);
  }
  for (const ruler of rulers) ruler.replaceChildren(ticks.cloneNode(true));
}

function syncRulers() {
  if (pending) return;
  const plot = chart.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  for (const ruler of horizontalRulers) ruler.style.transform = `translateX(${plot.left - view.left}px)`;
  for (const ruler of verticalRulers) ruler.style.transform = `translateY(${plot.top - view.top}px)`;
}

function drawGrid(columns, rows, width, height, interval, weight, opacity) {
  const majorLineFollows = interval === 1 && byId('show-grid').checked;
  context.beginPath();
  for (let col = interval; col < columns; col += interval) {
    if (majorLineFollows && col % 10 === 0) continue;
    context.moveTo(col * width / columns, 0);
    context.lineTo(col * width / columns, height);
  }
  for (let row = interval; row < rows; row += interval) {
    if (majorLineFollows && row % 10 === 0) continue;
    context.moveTo(0, row * height / rows);
    context.lineTo(width, row * height / rows);
  }
  context.strokeStyle = byId('grid-color').value;
  context.lineWidth = weight;
  context.globalAlpha = opacity;
  context.stroke();
  context.globalAlpha = 1;
}

function drawChart(keepPosition = true) {
  byId('chart-frame').toggleAttribute('data-calibrating', Boolean(pending));
  const source = pending?.source.canvas || stitchPixels;
  const oldRect = chart.getBoundingClientRect();
  const viewRect = viewport.getBoundingClientRect();
  const relativeX = oldRect.width ? (viewRect.left + viewport.clientWidth / 2 - oldRect.left) / oldRect.width : .5;
  const relativeY = oldRect.height ? (viewRect.top + viewport.clientHeight / 2 - oldRect.top) / oldRect.height : .5;
  const fit = Math.min((viewport.offsetWidth - 38) / source.width, (viewport.offsetHeight - 34) / source.height);
  const scale = Math.max(.05, fit) * zoom;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const density = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(width, height));
  const pixelWidth = Math.max(1, Math.round(width * density));
  const pixelHeight = Math.max(1, Math.round(height * density));
  if (chart.width !== pixelWidth) chart.width = pixelWidth;
  if (chart.height !== pixelHeight) chart.height = pixelHeight;
  chart.style.width = `${width}px`;
  chart.style.height = `${height}px`;
  context.setTransform(chart.width / width, 0, 0, chart.height / height, 0, 0);
  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = Boolean(pending);
  context.drawImage(source, 0, 0, width, height);
  const cellX = width / source.width;
  const cellY = height / source.height;
  if (pending) {
    drawCrop();
  } else {
    if (byId('show-minor-grid').checked) drawGrid(source.width, source.height, width, height, 1, .65, Math.min(.32, Math.min(cellX, cellY) * .045));
    if (byId('show-grid').checked) {
      drawGrid(source.width, source.height, width, height, 10, Number(byId('grid-weight').value), .72);
    }
    const scaleKey = [width, height, source.width, source.height].join('/');
    if (rulerScale !== scaleKey) {
      drawRulers(horizontalRulers, source.width, cellX, 'left');
      drawRulers(verticalRulers, source.height, cellY, 'top');
      rulerScale = scaleKey;
    }
    byId('crop-guide').hidden = true;
  }
  byId('zoom-value').textContent = Math.round(zoom * 100) + '%';
  if (keepPosition) {
    const next = chart.getBoundingClientRect();
    viewport.scrollLeft += next.left + relativeX * width - viewRect.left - viewport.clientWidth / 2;
    viewport.scrollTop += next.top + relativeY * height - viewRect.top - viewport.clientHeight / 2;
  } else {
    viewport.scrollTo(0, 0);
  }
  for (const ruler of horizontalRulers) ruler.parentElement.style.width = `${viewport.clientWidth}px`;
  for (const ruler of verticalRulers) ruler.parentElement.style.height = `${viewport.clientHeight}px`;
  syncRulers();
}

function chartPoint(event, width, height) {
  const rect = chart.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / rect.width * width);
  const y = Math.floor((event.clientY - rect.top) / rect.height * height);
  return { x: Math.max(0, Math.min(width - 1, x)), y: Math.max(0, Math.min(height - 1, y)) };
}

function fullBounds(source) {
  return { x: 0, y: 0, w: source.canvas.width, h: source.canvas.height };
}

function drawCrop() {
  const guide = byId('crop-guide');
  const bounds = pending.bounds;
  const { width, height } = pending.source.canvas;
  guide.hidden = false;
  guide.style.left = `${bounds.x / width * 100}%`;
  guide.style.top = `${bounds.y / height * 100}%`;
  guide.style.width = `${bounds.w / width * 100}%`;
  guide.style.height = `${bounds.h / height * 100}%`;
}

function showSetup(value) {
  if (pending?.pdf && pending.pdf !== value.pdf) void pending.pdf.destroy().catch(() => {});
  pending = { ...value, bounds: fullBounds(value.source), choosing: false, first: null };
  palette = new Map();
  completed = new Set();
  selected.clear();
  zoom = 1;
  byId('setup').hidden = false;
  chart.style.backgroundColor = '';
  byId('demo').hidden = false;
  byId('project-name').textContent = value.title;
  byId('project-meta').textContent = value.pdf ? 'PDF pattern setup' : 'Image pattern setup';
  byId('columns').value = !value.pdf && value.source.canvas.width <= 500 ? value.source.canvas.width : '';
  byId('rows').value = !value.pdf && value.source.canvas.height <= 500 ? value.source.canvas.height : '';
  byId('page-control').hidden = !value.pdf || value.pdf.numPages === 1;
  const pageSelect = byId('source-page');
  pageSelect.replaceChildren();
  for (let page = 1; page <= (value.pdf?.numPages || 0); page++) pageSelect.add(new Option(page, page));
  pageSelect.value = value.pageNumber || '1';
  byId('setup-hint').textContent = 'The full image is selected.';
  byId('chart-hint').textContent = 'Match the chart grid to build the thread palette.';
  byId('coordinate').textContent = '';
  drawChart(false);
  updatePalette();
}

async function loadPattern(file) {
  let pdf;
  setBusy(true);
  notice('Reading pattern…');
  try {
    const data = await file.arrayBuffer();
    const storageId = await fileId(data);
    const title = file.name.replace(/\.[^.]+$/, '');
    if (/\.pdf$/i.test(file.name)) {
      pdf = await openPdf(data);
      const imported = await readPdfPattern(pdf, (page, total, rendering) => {
        notice(`${rendering ? 'Reading thread colors on chart page' : 'Checking PDF page'} ${page} of ${total}…`);
      });
      if (imported) {
        setPattern({ ...imported, title: imported.title || title, storageId });
      } else {
        const page = await pdf.getPage(1);
        const source = await renderPage(page);
        page.cleanup();
        showSetup({ pdf, source, title, storageId, pageNumber: 1 });
        notice('Choose a page with a colored chart, then match its stitch grid.');
        return;
      }
    } else if (/\.oxs$/i.test(file.name)) {
      const imported = readOxs(new TextDecoder().decode(data));
      setPattern({ ...imported, title: imported.title || title, storageId });
      if (imported.omitted) {
        notice('Imported full crosses from this OXS chart. It also contains specialty stitches, which this viewer skips.');
        return;
      }
    } else if (/\.(?:png|jpe?g|gif)$/i.test(file.name)) {
      const source = await readImage(file);
      showSetup({ source, title, storageId });
    } else {
      throw new Error('Choose a PDF, OXS, PNG, JPEG, or GIF file.');
    }
    notice();
  } catch (error) {
    console.error(error);
    notice(`Could not open this pattern. ${error.message || ''}`, true);
  } finally {
    if (pdf && pending?.pdf !== pdf) await pdf.destroy().catch(() => {});
    setBusy(false);
  }
}

async function loadKey(file) {
  if (busy || !pattern?.symbolKey) return;
  let pdf;
  setBusy(true);
  notice('Reading thread key…');
  try {
    pdf = await openPdf(await file.arrayBuffer());
    const key = await readThreadKey(pdf);
    const matches = [...key].filter(([symbol, entry]) => palette.get(symbol)?.count === entry.count);
    if (!matches.length) throw new Error('No matching thread symbols and stitch counts were found.');
    for (const [symbol, entry] of matches) palette.get(symbol).name = entry.name;
    updatePalette();
    notice(`Loaded ${matches.length} matching thread names.`);
  } catch (error) {
    console.error(error);
    notice(`Could not apply this key. ${error.message || ''}`, true);
  } finally {
    if (pdf) await pdf.destroy().catch(() => {});
    setBusy(false);
  }
}

byId('open-pattern').addEventListener('click', () => byId('pattern-file').click());
byId('open-key').addEventListener('click', () => byId('key-file').click());
for (const [id, load] of [['pattern-file', loadPattern], ['key-file', loadKey]]) {
  byId(id).addEventListener('change', event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (file && !busy) void load(file);
  });
}
byId('demo').addEventListener('click', () => {
  setPattern(demoPattern());
  notice();
});
byId('source-page').addEventListener('change', async event => {
  if (busy || !pending?.pdf) return;
  setBusy(true);
  const value = pending;
  const pageNumber = Number(event.target.value);
  try {
    const page = await value.pdf.getPage(pageNumber);
    const source = await renderPage(page);
    page.cleanup();
    showSetup({ ...value, source, pageNumber });
    notice();
  } catch (error) {
    event.target.value = value.pageNumber;
    notice(`Could not open this page. ${error.message || ''}`, true);
  } finally {
    setBusy(false);
  }
});
byId('full-image').addEventListener('click', () => {
  pending.bounds = fullBounds(pending.source);
  pending.choosing = false;
  pending.first = null;
  byId('setup-hint').textContent = 'The full image is selected.';
  drawCrop();
});
byId('pick-bounds').addEventListener('click', () => {
  pending.choosing = true;
  pending.first = null;
  byId('setup-hint').textContent = 'Click one corner of the chart.';
  byId('chart-hint').textContent = 'Click one corner of the chart.';
});
byId('apply-grid').addEventListener('click', () => {
  if (busy || !pending) return;
  if (pending.choosing) {
    notice('Pick both corners or choose Use full image first.', true);
    return;
  }
  try {
    const { title, source, bounds, storageId, pageNumber } = pending;
    const parsed = readColorGrid(source, bounds, Number(byId('columns').value), Number(byId('rows').value));
    const config = [pageNumber || 0, bounds.x, bounds.y, bounds.w, bounds.h, parsed.width, parsed.height];
    setPattern({ ...parsed, title, storageId: storageId + '.' + config.join('.') });
    notice();
  } catch (error) {
    notice(error.message, true);
  }
});

chart.addEventListener('click', event => {
  if (pending) {
    if (!pending.choosing) return;
    const point = chartPoint(event, pending.source.canvas.width, pending.source.canvas.height);
    if (pending.first) {
      const x = Math.min(point.x, pending.first.x);
      const y = Math.min(point.y, pending.first.y);
      pending.bounds = { x, y, w: Math.abs(point.x - pending.first.x) + 1, h: Math.abs(point.y - pending.first.y) + 1 };
      pending.first = null;
      pending.choosing = false;
      byId('setup-hint').textContent = 'The chart area is selected.';
      byId('chart-hint').textContent = 'Choose Read stitches to build the thread palette.';
      drawCrop();
    } else {
      pending.first = point;
      byId('setup-hint').textContent = 'Click the opposite corner.';
      byId('chart-hint').textContent = 'Click the opposite corner.';
    }
    return;
  }
  const { x, y } = chartPoint(event, pattern.width, pattern.height);
  const id = pattern.ids[y * pattern.width + x];
  if (id !== null) selectThread(id);
});
chart.addEventListener('pointermove', event => {
  if (pending) return;
  const { x, y } = chartPoint(event, pattern.width, pattern.height);
  byId('coordinate').textContent = `Column ${x + 1} · Row ${y + 1}`;
});
chart.addEventListener('pointerleave', () => { byId('coordinate').textContent = ''; });
byId('zoom-in').addEventListener('click', () => { zoom = Math.min(16, zoom * 1.4); drawChart(); });
byId('zoom-out').addEventListener('click', () => { zoom = Math.max(.4, zoom / 1.4); drawChart(); });
byId('fit').addEventListener('click', () => { zoom = 1; drawChart(false); });
byId('clear-focus').addEventListener('click', clearSelection);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !byId('backup-dialog').open && event.target.type !== 'search') clearSelection();
});
for (const id of ['thread-search', 'thread-filter']) byId(id).addEventListener('input', () => updatePalette());
for (const id of ['show-grid', 'show-minor-grid', 'grid-color', 'grid-weight']) byId(id).addEventListener('input', () => drawChart());
for (const [control, output] of [['other-opacity', 'opacity-value'], ['other-saturation', 'saturation-value']]) {
  byId(control).addEventListener('input', event => {
    byId(output).textContent = `${event.target.value}%`;
    if (focusFrame || pending || !selected.size) return;
    focusFrame = requestAnimationFrame(() => {
      focusFrame = null;
      if (pending) return;
      paintStitches();
      drawChart();
    });
  });
}
viewport.addEventListener('scroll', syncRulers, { passive: true });

function backupStatus(message = '', error = false) {
  byId('backup-status').textContent = message;
  byId('backup-status').dataset.error = error;
}

byId('open-backup').addEventListener('click', () => {
  byId('backup-code').value = encodeProgress(currentProgress());
  byId('backup-replace').checked = false;
  backupStatus();
  byId('backup-dialog').showModal();
});
byId('copy-backup').addEventListener('click', async () => {
  const field = byId('backup-code');
  try {
    await navigator.clipboard.writeText(field.value);
    backupStatus('Progress code copied.');
  } catch {
    field.focus();
    field.select();
    backupStatus('Progress code selected. Use your device’s copy command.');
  }
});
byId('import-backup').addEventListener('click', () => {
  try {
    const imported = decodeProgress(byId('backup-code').value);
    const records = mergeProgress(currentProgress(), imported, byId('backup-replace').checked);
    const saved = saveProgress(records);
    if (!pending) {
      loadCompletion(records);
      updatePalette();
    }
    byId('backup-code').value = encodeProgress(records);
    backupStatus(saved ? `Imported progress for ${imported.size} ${imported.size === 1 ? 'pattern' : 'patterns'}.`
      : 'Progress is available in this session. Copy the code again to keep a backup because this browser could not save it.', !saved);
  } catch (error) {
    backupStatus(error.message, true);
  }
});

setPattern(demoPattern());
new ResizeObserver(() => drawChart()).observe(viewport);
