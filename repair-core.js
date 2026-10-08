// Local image repair. No network calls and no inference service.
export function makePlan(mask, width, height) {
  const n = width * height, seen = new Uint8Array(n), queue = new Int32Array(n);
  let head = 0, tail = 0, count = 0;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) { seen[i] = 1; continue; }
    count++;
    const x = i % width, y = (i / width) | 0;
    if ((x > 0 && !mask[i - 1]) || (x + 1 < width && !mask[i + 1]) || (y > 0 && !mask[i - width]) || (y + 1 < height && !mask[i + width])) { seen[i] = 2; queue[tail++] = i; }
  }
  if (!count) throw new Error('请先标记需要修复的区域。');
  if (count === n) throw new Error('请保留选区周围的画面作为修复参考。');
  while (head < tail) {
    const i = queue[head++], x = i % width, y = (i / width) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]) {
      if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 2; queue[tail++] = j; }
    }
  }
  return { order: queue.slice(0, tail), mask, width, height };
}
export function smoothRepair(data, plan, iterations = 65, progress = () => {}) {
  const { order, mask, width: w, height: h } = plan;
  const known = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) known[i] = mask[i] ? 0 : 1;
  for (let k = 0; k < order.length; k++) {
    const i = order[k], x = i % w, y = (i / w) | 0, p = i * 4;
    let rr = 0, gg = 0, bb = 0, aa = 0, total = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if ((!dx && !dy) || x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h) continue;
      const q = i + dy * w + dx;
      if (!known[q]) continue;
      const weight = 1 / (dx * dx + dy * dy), s = q * 4;
      rr += data[s] * weight; gg += data[s + 1] * weight; bb += data[s + 2] * weight; aa += data[s + 3] * weight; total += weight;
    }
    if (total) { data[p] = rr / total; data[p + 1] = gg / total; data[p + 2] = bb / total; data[p + 3] = aa / total; }
    known[i] = 1;
  }
  progress(35);
  // Relax only selected pixels; all unselected pixels remain byte-for-byte unchanged.
  const floats = iterations > 8 ? Float32Array.from(data) : data;
  for (let pass = 0; pass < iterations; pass++) {
    const reverse = pass % 2;
    for (let k = 0; k < order.length; k++) {
      const i = order[reverse ? order.length - 1 - k : k], x = i % w, y = (i / w) | 0, p = i * 4;
      for (let c = 0; c < 4; c++) {
        let sum = 0, n = 0;
        if (x > 0) { sum += floats[p - 4 + c]; n++; }
        if (x + 1 < w) { sum += floats[p + 4 + c]; n++; }
        if (y > 0) { sum += floats[p - w * 4 + c]; n++; }
        if (y + 1 < h) { sum += floats[p + w * 4 + c]; n++; }
        floats[p + c] = sum / n;
      }
    }
    if (pass % 8 === 0) progress(35 + 60 * (pass + 1) / iterations);
  }
  if (floats !== data) for (const i of order) for (let c = 0; c < 4; c++) data[i * 4 + c] = floats[i * 4 + c];
  return data;
}
export function textureRepair(data, plan, progress = () => {}) {
  const { order, mask, width: w, height: h } = plan, source = data.slice(), unknown = mask.slice(), radius = 4;
  const integral = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) { sum += mask[y * w + x]; integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + sum; }
  }
  const safe = (x, y) => {
    if (x < radius || y < radius || x >= w - radius || y >= h - radius) return false;
    const a = x - radius, b = y - radius, c = x + radius + 1, d = y + radius + 1, s = w + 1;
    return integral[d * s + c] - integral[b * s + c] - integral[d * s + a] + integral[b * s + a] === 0;
  };
  let seed = 7931, done = 0;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
  // A fallback supplies border cases with no valid nearby texture patch.
  const fallback = smoothRepair(data.slice(), plan, 8);
  for (let k = 0; k < order.length; k++) {
    const i = order[k]; if (!unknown[i]) continue;
    const x = i % w, y = (i / w) | 0, samples = [];
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const j = yy * w + xx;
      if (!unknown[j]) samples.push([dx, dy, j * 4]);
    }
    let best = Infinity, bx = -1, by = -1;
    const test = (sx, sy) => {
      if (!safe(sx, sy)) return;
      let loss = 0;
      for (const [dx, dy, p] of samples) {
        const q = ((sy + dy) * w + sx + dx) * 4;
        const r = data[p] - source[q], g = data[p + 1] - source[q + 1], b = data[p + 2] - source[q + 2];
        loss += r * r + g * g + b * b;
      }
      loss = loss / Math.max(1, samples.length) + Math.hypot(sx - x, sy - y) * .02;
      if (loss < best) { best = loss; bx = sx; by = sy; }
    };
    for (let d = 6; d <= 96; d += 10) { test(x - d, y); test(x + d, y); test(x, y - d); test(x, y + d); }
    for (let t = 0; t < 150; t++) { const reach = t < 115 ? 100 : Math.max(w, h); test(Math.round(x + (random() - .5) * 2 * reach), Math.round(y + (random() - .5) * 2 * reach)); }
    if (bx < 0) { for (let c = 0; c < 4; c++) data[i * 4 + c] = fallback[i * 4 + c]; unknown[i] = 0; done++; }
    else for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
      const j = yy * w + xx; if (!unknown[j]) continue;
      const q = ((by + dy) * w + bx + dx) * 4;
      for (let c = 0; c < 4; c++) data[j * 4 + c] = source[q + c];
      unknown[j] = 0; done++;
    }
    if (k % 19 === 0) progress(5 + 90 * done / order.length);
  }
  return data;
}
