export function demoPattern() {
  const width = 80;
  const height = 60;
  const entries = [
    ['linen', '#f3e9d1', 'Linen'], ['glass', '#dfebe1', 'Glass green'],
    ['pine', '#426554', 'Pine green'], ['leaf', '#76925d', 'Fern green'],
    ['sprout', '#a7ae70', 'New leaf'], ['clay', '#bd7156', 'Terracotta'],
    ['brick', '#935744', 'Red clay'], ['sun', '#eac482', 'Golden ochre'],
    ['flower', '#dd9f8d', 'Dusty rose'], ['soil', '#6e5947', 'Walnut brown'],
    ['light', '#faf3df', 'Warm ivory']
  ];
  const colors = new Map(entries.map(([id, color, name]) => [id, { color, name }]));
  const ids = new Array(width * height).fill('linen');
  function put(x, y, id) {
    if (x >= 0 && x < width && y >= 0 && y < height) ids[y * width + x] = id;
  }
  function box(x, y, w, h, id) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) put(col, row, id);
    }
  }
  function oval(cx, cy, rx, ry, id) {
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) put(x, y, id);
      }
    }
  }
  for (let row = 8; row < 21; row++) {
    const half = Math.min(30, 3 + (row - 8) * 3);
    box(40 - half, row, half * 2, 1, 'glass');
    put(40 - half, row, 'pine');
    put(39 + half, row, 'pine');
  }
  box(10, 20, 60, 31, 'glass');
  oval(51, 23, 6, 6, 'sun');
  for (const col of [10, 29, 39, 40, 50, 69]) box(col, 20, 1, 32, 'pine');
  for (const col of [29, 39, 40, 50]) box(col, col === 29 || col === 50 ? 13 : 9, 1, col === 29 || col === 50 ? 7 : 11, 'pine');
  box(10, 20, 60, 2, 'pine');
  box(10, 34, 60, 1, 'pine');
  box(8, 51, 64, 3, 'soil');
  box(13, 49, 54, 2, 'brick');
  for (const [cx, top, flower] of [[20, 30, true], [31, 36, false], [46, 26, true], [60, 33, false]]) {
    box(cx, top, 1, 14, 'pine');
    oval(cx - 2, top + 7, 4, 2, 'leaf');
    oval(cx + 3, top + 4, 4, 2, 'sprout');
    oval(cx + 3, top + 10, 3, 2, 'leaf');
    if (flower) {
      oval(cx, top, 3, 3, 'flower');
      oval(cx, top, 1, 1, 'sun');
    } else {
      oval(cx - 1, top + 1, 2, 3, 'pine');
    }
    box(cx - 4, 42, 9, 2, 'clay');
    box(cx - 3, 44, 7, 4, 'clay');
    box(cx - 2, 48, 5, 1, 'brick');
  }
  for (const [x, y] of [[7, 12], [72, 15], [16, 9], [65, 7], [5, 46], [75, 43]]) {
    box(x - 2, y, 5, 1, 'sun');
    box(x, y - 2, 1, 5, 'sun');
    put(x, y, 'light');
  }
  for (let x = 12; x < 72; x += 4) put(x, 56, 'sprout');
  return { title: 'Greenhouse sampler', source: 'Sample pattern', width, height, ids, colors, storageId: 'demo-greenhouse-v1' };
}
