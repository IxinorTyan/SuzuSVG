// pipeline.js — 纯JS图像转矢量核心算法，无外部依赖，浏览器/Node通用
// 输入统一格式: { data: Uint8ClampedArray(RGBA), width, height }

// ---------- 0. 输入预处理流水线 (Stage 0: Input Preprocessing Pipeline) ----------
export function preprocessInput(img, options = {}) {
  const { scalePercent = 100 } = options;
  const { width: origWidth, height: origHeight, data } = img;

  const clampedPercent = Math.max(5, Math.min(100, Number(scalePercent) || 100));
  const scale = clampedPercent / 100;

  let targetWidth = origWidth;
  let targetHeight = origHeight;

  if (scale < 1.0) {
    targetWidth = Math.max(1, Math.round(origWidth * scale));
    targetHeight = Math.max(1, Math.round(origHeight * scale));
  }

  let processedImg = img;

  if (scale < 1.0) {
    const canvas = document.createElement('canvas');
    canvas.width = origWidth;
    canvas.height = origHeight;
    const ctx = canvas.getContext('2d');
    const clamped = new Uint8ClampedArray(data);
    ctx.putImageData(new ImageData(clamped, origWidth, origHeight), 0, 0);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = targetWidth;
    outCanvas.height = targetHeight;
    const outCtx = outCanvas.getContext('2d');
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);

    const outImgData = outCtx.getImageData(0, 0, targetWidth, targetHeight);
    processedImg = {
      data: new Uint8ClampedArray(outImgData.data),
      width: targetWidth,
      height: targetHeight
    };
  }

  const preprocessStats = {
    origWidth,
    origHeight,
    targetWidth,
    targetHeight,
    scale,
    scalePercent: clampedPercent
  };

  console.log('[Stage 0 - Input Preprocessing]',
    `Scale: ${clampedPercent}%`,
    `Original: ${origWidth}x${origHeight}`,
    `Normalized: ${targetWidth}x${targetHeight}`
  );

  return { img: processedImg, stats: preprocessStats };
}

// ---------- Stage 1. 中值滤波与双边滤波降噪 ----------
export function medianFilter(img, radius) {
  if (radius <= 0) return img;
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(data.length);
  const win = (2 * radius + 1) * (2 * radius + 1);
  const rBuf = new Uint8ClampedArray(win);
  const gBuf = new Uint8ClampedArray(win);
  const bBuf = new Uint8ClampedArray(win);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          const idx = (sy * width + sx) * 4;
          rBuf[n] = data[idx];
          gBuf[n] = data[idx + 1];
          bBuf[n] = data[idx + 2];
          n++;
        }
      }
      const sub = rBuf.subarray(0, n).slice().sort();
      const sg = gBuf.subarray(0, n).slice().sort();
      const sb = bBuf.subarray(0, n).slice().sort();
      const mid = n >> 1;
      const oIdx = (y * width + x) * 4;
      out[oIdx] = sub[mid];
      out[oIdx + 1] = sg[mid];
      out[oIdx + 2] = sb[mid];
      out[oIdx + 3] = data[oIdx + 3];
    }
  }
  return { data: out, width, height };
}

export function bilateralFilter(img, radius, sigmaColor = 30, sigmaSpace = 3) {
  if (radius <= 0) return img;
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(data.length);

  const spaceWeights = new Float32Array((2 * radius + 1) * (2 * radius + 1));
  let wi = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      spaceWeights[wi++] = Math.exp(-(dx * dx + dy * dy) / (2 * sigmaSpace * sigmaSpace));
    }
  }
  const colorCoeff = -1 / (2 * sigmaColor * sigmaColor);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const cr = data[idx], cg = data[idx + 1], cb = data[idx + 2];
      let sumR = 0, sumG = 0, sumB = 0, sumW = 0;
      let wi2 = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = Math.min(height - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = Math.min(width - 1, Math.max(0, x + dx));
          const sIdx = (sy * width + sx) * 4;
          const sr = data[sIdx], sg = data[sIdx + 1], sb = data[sIdx + 2];
          const colorDist = (sr - cr) ** 2 + (sg - cg) ** 2 + (sb - cb) ** 2;
          const w = spaceWeights[wi2++] * Math.exp(colorDist * colorCoeff);
          sumR += sr * w; sumG += sg * w; sumB += sb * w; sumW += w;
        }
      }
      out[idx] = sumR / sumW;
      out[idx + 1] = sumG / sumW;
      out[idx + 2] = sumB / sumW;
      out[idx + 3] = data[idx + 3];
    }
  }
  return { data: out, width, height };
}

// ---------- Stage 1: K-means颜色量化（Alpha透明背景感知与碎片清理） ----------
export function kmeansQuantize(img, k, opts = {}) {
  const { data, width, height } = img;
  const maxIter = opts.maxIter ?? 12;
  const sampleStep = opts.sampleStep ?? 3;
  const n = width * height;

  // 1. 检查是否存在 Alpha 0/透明像素 (< 128)
  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) {
      hasAlpha = true;
      break;
    }
  }

  // 若有透明像素，预留 1 个专用透明 Label 0，RGB 占 k - 1 个聚类中心；否则占 k 个
  const rgbK = hasAlpha ? Math.max(1, k - 1) : k;

  // 采样不透明像素（alpha >= 128）用于找 RGB 聚类中心
  const samples = [];
  for (let i = 0; i < n; i += sampleStep) {
    const idx = i * 4;
    if (data[idx + 3] >= 128) {
      samples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  // 兜底：若全图都是透明像素
  if (samples.length === 0) {
    const labels = new Int32Array(n).fill(0);
    const palette = [[0, 0, 0, 0]];
    return { labels, palette, width, height };
  }

  // k-means++ 初始化 RGB 聚类中心
  const centers = [];
  centers.push(samples[Math.floor(Math.random() * samples.length)]);
  while (centers.length < rgbK) {
    let distSum = 0;
    const dists = samples.map((s) => {
      let best = Infinity;
      for (const c of centers) {
        const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
        if (d < best) best = d;
      }
      distSum += best;
      return best;
    });
    let r = Math.random() * distSum;
    let chosen = samples[0];
    for (let i = 0; i < samples.length; i++) {
      r -= dists[i];
      if (r <= 0) { chosen = samples[i]; break; }
    }
    centers.push(chosen.slice());
  }

  // 迭代 RGB K-means
  for (let iter = 0; iter < maxIter; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const cc = centers[c];
        const d = (s[0] - cc[0]) ** 2 + (s[1] - cc[1]) ** 2 + (s[2] - cc[2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best][0] += s[0]; sums[best][1] += s[1]; sums[best][2] += s[2]; sums[best][3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
  }

  // 分配像素标签
  const labels = new Int32Array(n);
  const palette = [];

  if (hasAlpha) {
    // Label 0: 专用透明通道 [0, 0, 0, 0]
    palette.push([0, 0, 0, 0]);
    // Centers 对应 Label 1 ~ rgbK
    for (const c of centers) {
      palette.push([Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255]);
    }

    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      if (data[idx + 3] < 128) {
        labels[i] = 0; // 透明像素分配 Label 0
      } else {
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        let best = 0, bestD = Infinity;
        for (let c = 0; c < centers.length; c++) {
          const cc = centers[c];
          const d = (r - cc[0]) ** 2 + (g - cc[1]) ** 2 + (b - cc[2]) ** 2;
          if (d < bestD) { bestD = d; best = c; }
        }
        labels[i] = best + 1; // 偏移 1
      }
    }
  } else {
    for (const c of centers) {
      palette.push([Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), 255]);
    }
    for (let i = 0; i < n; i++) {
      const idx = i * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const cc = centers[c];
        const d = (r - cc[0]) ** 2 + (g - cc[1]) ** 2 + (b - cc[2]) ** 2;
        if (d < bestD) { bestD = d; best = c; }
      }
      labels[i] = best;
    }
  }

  const merged = mergeCloseClusters(labels, palette);
  return { labels: merged.labels, palette: merged.palette, width, height };
}

function mergeCloseClusters(labels, palette, colorDistThreshold = 18) {
  const k = palette.length;
  const parent = Array.from({ length: k }, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const [r1, g1, b1, a1] = palette[i];
      const [r2, g2, b2, a2] = palette[j];
      // 不把透明色块与实色色块合并！
      if ((a1 === 0) !== (a2 === 0)) continue;
      const dist = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
      if (dist < colorDistThreshold) union(i, j);
    }
  }

  const rootToNewLabel = new Map();
  let nextLabel = 0;
  for (let i = 0; i < k; i++) {
    const r = find(i);
    if (!rootToNewLabel.has(r)) rootToNewLabel.set(r, nextLabel++);
  }

  const pixelCountPerOld = new Array(k).fill(0);
  for (let i = 0; i < labels.length; i++) pixelCountPerOld[labels[i]]++;

  const newPaletteAccum = Array.from({ length: nextLabel }, () => [0, 0, 0, 0, 0]);
  for (let i = 0; i < k; i++) {
    const nl = rootToNewLabel.get(find(i));
    const w = pixelCountPerOld[i];
    const isTrans = palette[i][3] === 0;
    newPaletteAccum[nl][0] += palette[i][0] * w;
    newPaletteAccum[nl][1] += palette[i][1] * w;
    newPaletteAccum[nl][2] += palette[i][2] * w;
    newPaletteAccum[nl][3] += isTrans ? 0 : w;
    newPaletteAccum[nl][4] += w;
  }
  const newPalette = newPaletteAccum.map((acc) => {
    if (acc[4] === 0) return [0, 0, 0, 0];
    const isTrans = acc[3] === 0;
    if (isTrans) return [0, 0, 0, 0];
    return [
      Math.round(acc[0] / acc[4]),
      Math.round(acc[1] / acc[4]),
      Math.round(acc[2] / acc[4]),
      255
    ];
  });

  const oldToNew = new Int32Array(k);
  for (let i = 0; i < k; i++) oldToNew[i] = rootToNewLabel.get(find(i));

  const newLabels = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) newLabels[i] = oldToNew[labels[i]];

  return { labels: newLabels, palette: newPalette };
}

export function despeckleAndMerge(labels, width, height, minArea, maxPasses = 25) {
  const n = width * height;

  function connectedComponents() {
    const compId = new Int32Array(n).fill(-1);
    const compArea = [];
    const compLabel = [];
    let cid = 0;
    const stack = new Int32Array(n);
    for (let start = 0; start < n; start++) {
      if (compId[start] !== -1) continue;
      const lbl = labels[start];
      let sp = 0;
      stack[sp++] = start;
      compId[start] = cid;
      let area = 0;
      while (sp > 0) {
        const p = stack[--sp];
        area++;
        const px = p % width, py = (p / width) | 0;
        if (px > 0) { const q = p - 1; if (compId[q] === -1 && labels[q] === lbl) { compId[q] = cid; stack[sp++] = q; } }
        if (px < width - 1) { const q = p + 1; if (compId[q] === -1 && labels[q] === lbl) { compId[q] = cid; stack[sp++] = q; } }
        if (py > 0) { const q = p - width; if (compId[q] === -1 && labels[q] === lbl) { compId[q] = cid; stack[sp++] = q; } }
        if (py < height - 1) { const q = p + width; if (compId[q] === -1 && labels[q] === lbl) { compId[q] = cid; stack[sp++] = q; } }
      }
      compArea.push(area);
      compLabel.push(lbl);
      cid++;
    }
    return { compId, compArea, compLabel };
  }

  const queue = new Int32Array(n);

  for (let pass = 0; pass < maxPasses; pass++) {
    const { compId, compArea } = connectedComponents();
    let anySmall = false;
    const toClear = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (compArea[compId[i]] < minArea) { toClear[i] = 1; anySmall = true; }
    }
    if (!anySmall) break;

    let head = 0, tail = 0;
    const inQueue = new Uint8Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (!toClear[p]) continue;
        let hasGoodNeighbor = false;
        if (x > 0 && !toClear[p - 1]) hasGoodNeighbor = true;
        else if (x < width - 1 && !toClear[p + 1]) hasGoodNeighbor = true;
        else if (y > 0 && !toClear[p - width]) hasGoodNeighbor = true;
        else if (y < height - 1 && !toClear[p + width]) hasGoodNeighbor = true;
        if (hasGoodNeighbor && !inQueue[p]) { queue[tail++] = p; inQueue[p] = 1; }
      }
    }

    while (head < tail) {
      const p = queue[head++];
      if (!toClear[p]) continue;
      const x = p % width, y = (p / width) | 0;
      let l0=-1,c0=0,l1=-1,c1=0,l2=-1,c2=0,l3=-1,c3=0;
      const vote = (lbl) => {
        if (lbl === l0) { c0++; return; }
        if (lbl === l1) { c1++; return; }
        if (lbl === l2) { c2++; return; }
        if (lbl === l3) { c3++; return; }
        if (l0 === -1) { l0 = lbl; c0 = 1; return; }
        if (l1 === -1) { l1 = lbl; c1 = 1; return; }
        if (l2 === -1) { l2 = lbl; c2 = 1; return; }
        l3 = lbl; c3 = 1;
      };
      if (x > 0 && !toClear[p - 1]) vote(labels[p - 1]);
      if (x < width - 1 && !toClear[p + 1]) vote(labels[p + 1]);
      if (y > 0 && !toClear[p - width]) vote(labels[p - width]);
      if (y < height - 1 && !toClear[p + width]) vote(labels[p + width]);

      if (c0 === 0) { inQueue[p] = 0; continue; }

      let bestLabel = l0, bestCount = c0;
      if (c1 > bestCount) { bestCount = c1; bestLabel = l1; }
      if (c2 > bestCount) { bestCount = c2; bestLabel = l2; }
      if (c3 > bestCount) { bestCount = c3; bestLabel = l3; }

      labels[p] = bestLabel;
      toClear[p] = 0;

      if (x > 0 && toClear[p - 1] && !inQueue[p - 1]) { queue[tail++] = p - 1; inQueue[p - 1] = 1; }
      if (x < width - 1 && toClear[p + 1] && !inQueue[p + 1]) { queue[tail++] = p + 1; inQueue[p + 1] = 1; }
      if (y > 0 && toClear[p - width] && !inQueue[p - width]) { queue[tail++] = p - width; inQueue[p - width] = 1; }
      if (y < height - 1 && toClear[p + width] && !inQueue[p + width]) { queue[tail++] = p + width; inQueue[p + width] = 1; }

      if (tail >= n) {
        const remain = queue.slice(head, tail);
        remain.forEach((v, i) => queue[i] = v);
        tail -= head; head = 0;
      }
    }
  }
  return labels;
}

// ---------- Stage 2: 无缝边界提取 (Boundary Extraction) ----------
function buildBoundaryGraph(labels, width, height) {
  const edges = [];
  const vertexAdj = new Map();

  function pushAdj(v, other, edgeIdx) {
    if (!vertexAdj.has(v)) vertexAdj.set(v, []);
    vertexAdj.get(v).push({ other, edgeIdx });
  }
  function addEdge(x1, y1, x2, y2, sideA, sideB) {
    const v1 = y1 * (width + 1) + x1;
    const v2 = y2 * (width + 1) + x2;
    const idx = edges.length;
    edges.push({ v1, v2, sideA, sideB, used: false });
    pushAdj(v1, v2, idx);
    pushAdj(v2, v1, idx);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = labels[y * width + x];
      const up = y === 0 ? -1 : labels[(y - 1) * width + x];
      if (up !== c) addEdge(x, y, x + 1, y, up, c);
      const left = x === 0 ? -1 : labels[y * width + x - 1];
      if (left !== c) addEdge(x, y, x, y + 1, left, c);
      if (y === height - 1) addEdge(x, y + 1, x + 1, y + 1, c, -1);
      if (x === width - 1) addEdge(x + 1, y, x + 1, y + 1, c, -1);
    }
  }

  return { edges, vertexAdj };
}

function extractArcs(graph) {
  const { edges, vertexAdj } = graph;
  const arcs = [];

  function firstUnused(v) {
    const list = vertexAdj.get(v) || [];
    for (const e of list) if (!edges[e.edgeIdx].used) return e;
    return null;
  }

  function finalizeArc(pts, sideA, sideB) {
    const closed = pts.length > 1 && pts[0] === pts[pts.length - 1];
    if (closed) pts.pop();
    arcs.push({ pts, sideA, sideB, isolatedLoop: closed });
  }

  for (const [v, list] of vertexAdj) {
    if (list.length === 2) continue;
    let e = firstUnused(v);
    while (e) {
      const { sideA, sideB } = edges[e.edgeIdx];
      edges[e.edgeIdx].used = true;
      const pts = [v, e.other];
      let cur = e.other;
      let guard = 0;
      while ((vertexAdj.get(cur) || []).length === 2 && guard++ < edges.length + 10) {
        const nxt = firstUnused(cur);
        if (!nxt) break;
        edges[nxt.edgeIdx].used = true;
        cur = nxt.other;
        pts.push(cur);
        if (cur === v) break;
      }
      finalizeArc(pts, sideA, sideB);
      e = firstUnused(v);
    }
  }

  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    const { sideA, sideB } = edges[i];
    const startV = edges[i].v1;
    edges[i].used = true;
    const pts = [startV, edges[i].v2];
    let cur = edges[i].v2;
    let guard = 0;
    while (cur !== startV && guard++ < edges.length + 10) {
      const nxt = firstUnused(cur);
      if (!nxt) break;
      edges[nxt.edgeIdx].used = true;
      cur = nxt.other;
      pts.push(cur);
    }
    finalizeArc(pts, sideA, sideB);
  }

  return arcs;
}

function vidToXY(vid, width) {
  return [vid % (width + 1), Math.floor(vid / (width + 1))];
}

// ---------- Stage 3: 轮廓点简化 (Contour Simplification / RDP) ----------
function simplifyArcsSet(arcs, width, epsilon) {
  return arcs.map((arc) => {
    const coords = arc.pts.map((vid) => vidToXY(vid, width));
    let pts;
    const touchesOutside = arc.sideA === -1 || arc.sideB === -1;
    if (touchesOutside) {
      pts = coords;
    } else if (arc.isolatedLoop) {
      pts = epsilon > 0 ? simplifyLoop(coords, epsilon) : coords;
    } else {
      pts = epsilon > 0 && coords.length > 2 ? rdp(coords, epsilon) : coords;
    }
    return { pts, sideA: arc.sideA, sideB: arc.sideB, isolatedLoop: arc.isolatedLoop };
  });
}

function assembleRegionLoops(simplifiedArcs, numColors) {
  const regionLoops = Array.from({ length: numColors }, () => []);
  const linked = [];

  for (const arc of simplifiedArcs) {
    if (arc.isolatedLoop) {
      if (arc.pts.length >= 3) {
        if (arc.sideA >= 0 && arc.sideA < numColors) regionLoops[arc.sideA].push(arc.pts.slice().reverse());
        if (arc.sideB >= 0 && arc.sideB < numColors) regionLoops[arc.sideB].push(arc.pts.slice());
      }
    } else if (arc.pts.length >= 2) {
      linked.push(arc);
    }
  }

  const key = (pt) => pt[0] + '_' + pt[1];
  const perRegionAdj = Array.from({ length: numColors }, () => new Map());

  function register(regionIdx, variant) {
    if (regionIdx < 0 || regionIdx >= numColors) return;
    const map = perRegionAdj[regionIdx];
    const startKey = key(variant.points[0]);
    const endKey = key(variant.points[variant.points.length - 1]);
    if (!map.has(startKey)) map.set(startKey, []);
    map.get(startKey).push(variant);
    if (endKey !== startKey) {
      if (!map.has(endKey)) map.set(endKey, []);
      map.get(endKey).push(variant);
    }
  }

  for (const arc of linked) {
    register(arc.sideB, { points: arc.pts, used: false });
    register(arc.sideA, { points: arc.pts.slice().reverse(), used: false });
  }

  for (let c = 0; c < numColors; c++) {
    const adj = perRegionAdj[c];
    for (const [, list] of adj) {
      for (const variant of list) {
        if (variant.used) continue;
        variant.used = true;
        const loopPts = variant.points.slice();
        const loopStart = loopPts[0];
        let currentEnd = loopPts[loopPts.length - 1];
        let guard = 0;
        while ((currentEnd[0] !== loopStart[0] || currentEnd[1] !== loopStart[1]) && guard++ < 200000) {
          const candList = adj.get(key(currentEnd)) || [];
          const next = candList.find((v) => !v.used);
          if (!next) break;
          next.used = true;
          const pts = next.points;
          if (pts[0][0] === currentEnd[0] && pts[0][1] === currentEnd[1]) {
            loopPts.push(...pts.slice(1));
          } else {
            loopPts.push(...pts.slice(0, -1).reverse());
          }
          currentEnd = loopPts[loopPts.length - 1];
        }
        if (loopPts.length > 1 &&
            loopPts[loopPts.length - 1][0] === loopPts[0][0] &&
            loopPts[loopPts.length - 1][1] === loopPts[0][1]) {
          loopPts.pop();
        }
        if (loopPts.length >= 3) regionLoops[c].push(loopPts);
      }
    }
  }

  return regionLoops.map((loops, colorIndex) => ({ colorIndex, loops }));
}

function polygonSetArea(loops) {
  let total = 0;
  for (const loop of loops) {
    let a = 0;
    for (let i = 0; i < loop.length; i++) {
      const [x1, y1] = loop[i];
      const [x2, y2] = loop[(i + 1) % loop.length];
      a += x1 * y2 - x2 * y1;
    }
    total += Math.abs(a) / 2;
  }
  return total;
}

export function traceContoursShared(labels, width, height, numColors, epsilon = 1.2) {
  const graph = buildBoundaryGraph(labels, width, height);
  const rawArcs = extractArcs(graph);
  let rawLoopVertexCount = 0;
  for (const arc of rawArcs) {
    rawLoopVertexCount += arc.pts.length;
  }

  const simplifiedArcs = simplifyArcsSet(rawArcs, width, epsilon);
  const regions = assembleRegionLoops(simplifiedArcs, numColors);

  let rdpSimplifiedVertexCount = 0;
  for (const r of regions) {
    for (const l of r.loops) {
      rdpSimplifiedVertexCount += l.length;
    }
  }

  const regionObjects = regions.map((r) => ({ ...r, area: polygonSetArea(r.loops) }));

  return {
    regions: regionObjects,
    stats: {
      rawLoopVertexCount,
      rdpSimplifiedVertexCount
    }
  };
}

function perpendicularDist(pt, a, b) {
  const [x, y] = pt, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / len2;
  const px = x1 + t * dx, py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

function rdp(points, epsilon) {
  if (points.length < 3) return points;
  let maxDist = 0, idx = 0;
  const a = points[0], b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], a, b);
    if (d > maxDist) { maxDist = d; idx = i; }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, idx + 1), epsilon);
    const right = rdp(points.slice(idx), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

export function simplifyLoop(loop, epsilon) {
  if (epsilon <= 0 || loop.length <= 4) return loop;
  let farIdx = 1, farDist = -1;
  const first = loop[0];
  for (let i = 1; i < loop.length; i++) {
    const d = Math.hypot(loop[i][0]-first[0], loop[i][1]-first[1]);
    if (d > farDist) { farDist = d; farIdx = i; }
  }
  const chainA = loop.slice(0, farIdx + 1);
  const chainB = loop.slice(farIdx).concat([loop[0]]);
  const simpA = rdp(chainA, epsilon);
  const simpB = rdp(chainB, epsilon);
  const result = simpA.slice(0, -1).concat(simpB);
  return result.length >= 3 ? result : loop;
}

// ---------- Adaptive Curve Fitting Eligibility Heuristic Check ----------
function checkCurveEligibility(loop) {
  const n = loop.length;
  if (n < 3) return false;

  if (n < 8) {
    let maxAngle = 0;
    let smoothAngleCount = 0;

    for (let i = 0; i < n; i++) {
      const prev = loop[(i - 1 + n) % n];
      const curr = loop[i];
      const next = loop[(i + 1) % n];

      const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
      const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
      const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);

      if (len1 > 1e-5 && len2 > 1e-5) {
        const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
        const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
        if (angle > maxAngle) maxAngle = angle;
        if (angle >= 15 && angle <= 60) {
          smoothAngleCount++;
        }
      }
    }

    if (maxAngle < 12 || smoothAngleCount < 2) {
      return false;
    }
    return true;
  }

  let nonStraightCount = 0;
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];

    const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
    const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);

    if (len1 > 1e-5 && len2 > 1e-5) {
      const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
      const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);
      if (angle >= 10 && angle <= 80) {
        nonStraightCount++;
      }
    }
  }

  return (nonStraightCount / n) >= 0.15;
}

// ---------- Stage 4: 角点检测 (Corner Detection) ----------
export function detectCorners(loop, hardness = 50) {
  const n = loop.length;
  const corners = new Set();
  if (n < 3) return corners;

  const baseAngleThreshold = 18 + (100 - Math.min(100, Math.max(0, Number(hardness) || 50))) * 0.67;

  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];

    const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0], v2y = next[1] - curr[1];

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);

    if (len1 < 1e-5 || len2 < 1e-5) {
      corners.add(i);
      continue;
    }

    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * (180 / Math.PI);

    const prev2 = loop[(i - 2 + n) % n];
    const next2 = loop[(i + 2) % n];
    const vw1x = curr[0] - prev2[0], vw1y = curr[1] - prev2[1];
    const vw2x = next2[0] - curr[0], vw2y = next2[1] - curr[1];
    const lenw1 = Math.hypot(vw1x, vw1y), lenw2 = Math.hypot(vw2x, vw2y);
    let wideAngle = angle;
    if (lenw1 > 1e-5 && lenw2 > 1e-5) {
      const wdot = (vw1x * vw2x + vw1y * vw2y) / (lenw1 * lenw2);
      wideAngle = Math.acos(Math.max(-1, Math.min(1, wdot))) * (180 / Math.PI);
    }

    const lengthWeight = Math.min(1.5, Math.max(0.7, (len1 + len2) / 10));
    const effectiveAngle = Math.max(angle, wideAngle * 0.8) * lengthWeight;

    if (angle >= baseAngleThreshold || effectiveAngle >= baseAngleThreshold) {
      corners.add(i);
    }
  }

  if (corners.size === 0) {
    let maxAngle = -1, maxIdx = 0;
    for (let i = 0; i < n; i++) {
      const prev = loop[(i - 1 + n) % n];
      const curr = loop[i];
      const next = loop[(i + 1) % n];
      const v1x = curr[0] - prev[0], v1y = curr[1] - prev[1];
      const v2x = next[0] - curr[0], v2y = next[1] - curr[1];
      const len1 = Math.hypot(v1x, v1y), len2 = Math.hypot(v2x, v2y);
      if (len1 > 1e-5 && len2 > 1e-5) {
        const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
        const a = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (a > maxAngle) { maxAngle = a; maxIdx = i; }
      }
    }
    corners.add(maxIdx);
  }

  return corners;
}

function splitLoopByCorners(loop, corners) {
  const n = loop.length;
  const sortedCorners = Array.from(corners).sort((a, b) => a - b);
  const subChains = [];

  if (sortedCorners.length === 0) {
    const chain = loop.slice();
    chain.push(loop[0]);
    return [chain];
  }

  for (let k = 0; k < sortedCorners.length; k++) {
    const startIdx = sortedCorners[k];
    const endIdx = sortedCorners[(k + 1) % sortedCorners.length];

    const chain = [];
    let idx = startIdx;
    while (true) {
      chain.push(loop[idx]);
      if (idx === endIdx) break;
      idx = (idx + 1) % n;
    }
    if (chain.length >= 2) {
      subChains.push(chain);
    }
  }

  return subChains;
}

function pointToSegmentDistanceScalar(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx, py_proj = y1 + t * dy;
  return Math.hypot(px - projX, py - py_proj);
}

// ---------- Stage 5: Curve Fitting (Schneider三次贝塞尔曲线拟合 + 双向误差验证) ----------
function fitCubicBezierToChain(points, tolerance, depth, chainStats) {
  const m = points.length - 1;
  if (m <= 1) {
    chainStats.lineSegs++;
    return [{ type: 'line', p0: points[0], p1: points[m] }];
  }

  const p0 = points[0];
  const pm = points[m];

  let t1 = [points[1][0] - p0[0], points[1][1] - p0[1]];
  let t2 = [points[m - 1][0] - pm[0], points[m - 1][1] - pm[1]];
  const lenT1 = Math.hypot(t1[0], t1[1]);
  const lenT2 = Math.hypot(t2[0], t2[1]);
  t1 = lenT1 > 1e-6 ? [t1[0] / lenT1, t1[1] / lenT1] : [1, 0];
  t2 = lenT2 > 1e-6 ? [t2[0] / lenT2, t2[1] / lenT2] : [-1, 0];

  const u = new Float64Array(m + 1);
  u[0] = 0;
  for (let i = 1; i <= m; i++) {
    u[i] = u[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  const totalLen = u[m];
  if (totalLen > 1e-6) {
    for (let i = 1; i <= m; i++) u[i] /= totalLen;
  }

  let c1, c2;
  let alpha1 = 0, alpha2 = 0;
  let c11 = 0, c12 = 0, c21 = 0, c22 = 0, x1 = 0, x2 = 0;

  for (let i = 0; i <= m; i++) {
    const t = u[i];
    const b0 = (1 - t) ** 3;
    const b1 = 3 * t * (1 - t) ** 2;
    const b2 = 3 * (t ** 2) * (1 - t);
    const b3 = t ** 3;

    const a1x = t1[0] * b1, a1y = t1[1] * b1;
    const a2x = t2[0] * b2, a2y = t2[1] * b2;

    c11 += a1x * a1x + a1y * a1y;
    c12 += a1x * a2x + a1y * a2y;
    c21 = c12;
    c22 += a2x * a2x + a2y * a2y;

    const rx = points[i][0] - (p0[0] * b0 + p0[0] * b1 + pm[0] * b2 + pm[0] * b3);
    const ry = points[i][1] - (p0[1] * b0 + p0[1] * b1 + pm[1] * b2 + pm[1] * b3);

    x1 += a1x * rx + a1y * ry;
    x2 += a2x * rx + a2y * ry;
  }

  const detC1C2 = c11 * c22 - c12 * c21;
  if (Math.abs(detC1C2) > 1e-8) {
    alpha1 = (x1 * c22 - x2 * c12) / detC1C2;
    alpha2 = (c11 * x2 - c21 * x1) / detC1C2;
  }

  const chordDist = Math.hypot(pm[0] - p0[0], pm[1] - p0[1]);
  if (alpha1 < 1e-6 || alpha2 < 1e-6 || alpha1 > chordDist * 2 || alpha2 > chordDist * 2) {
    alpha1 = chordDist / 3;
    alpha2 = chordDist / 3;
  }

  c1 = [p0[0] + alpha1 * t1[0], p0[1] + alpha1 * t1[1]];
  c2 = [pm[0] + alpha2 * t2[0], pm[0] + alpha2 * t2[1]];

  let maxForwardErr = 0;
  let splitIdx = Math.floor(m / 2);

  for (let i = 1; i < m; i++) {
    const t = u[i];
    const b0 = (1 - t) ** 3, b1 = 3 * t * (1 - t) ** 2, b2 = 3 * (t ** 2) * (1 - t), b3 = t ** 3;
    const qx = b0 * p0[0] + b1 * c1[0] + b2 * c2[0] + b3 * pm[0];
    const qy = b0 * p0[1] + b1 * c1[1] + b2 * c2[1] + b3 * pm[1];
    const err = Math.hypot(points[i][0] - qx, points[i][1] - qy);
    if (err > maxForwardErr) {
      maxForwardErr = err;
      splitIdx = i;
    }
  }

  let maxReverseErr = 0;
  const numSamples = 16;
  chainStats.temporarySamplingPeak += numSamples;

  for (let j = 1; j < numSamples; j++) {
    const t = j / numSamples;
    const b0 = (1 - t) ** 3, b1 = 3 * t * (1 - t) ** 2, b2 = 3 * (t ** 2) * (1 - t), b3 = t ** 3;
    const qx = b0 * p0[0] + b1 * c1[0] + b2 * c2[0] + b3 * pm[0];
    const qy = b0 * p0[1] + b1 * c1[1] + b2 * c2[1] + b3 * pm[1];

    let minDist = Infinity;
    for (let k = 0; k < m; k++) {
      const pA = points[k], pB = points[k + 1];
      const d = pointToSegmentDistanceScalar(qx, qy, pA[0], pA[1], pB[0], pB[1]);
      if (d < minDist) minDist = d;
    }
    if (minDist > maxReverseErr) maxReverseErr = minDist;
  }

  const bidiError = Math.max(maxForwardErr, maxReverseErr);
  if (bidiError > chainStats.maxError) chainStats.maxError = bidiError;

  if (bidiError <= tolerance) {
    chainStats.success++;
    chainStats.cubicSegs++;
    return [{ type: 'cubic', p0: p0, c1: c1, c2: c2, p1: pm }];
  }

  if (depth > 0 && points.length > 3 && splitIdx > 0 && splitIdx < m) {
    const leftChain = points.slice(0, splitIdx + 1);
    const rightChain = points.slice(splitIdx);
    const leftRes = fitCubicBezierToChain(leftChain, tolerance, depth - 1, chainStats);
    const rightRes = fitCubicBezierToChain(rightChain, tolerance, depth - 1, chainStats);
    return leftRes.concat(rightRes);
  }

  chainStats.fallback++;
  const fallbackSegs = [];
  for (let i = 0; i < m; i++) {
    fallbackSegs.push({ type: 'line', p0: points[i], p1: points[i + 1] });
    chainStats.lineSegs++;
  }
  return fallbackSegs;
}

export function fitCurvesToRegions(regions, options = {}) {
  const {
    cornerHardness = 50,
    bezierTolerance = 0.8
  } = options;

  let totalLoops = 0;
  let curveFittingCandidates = 0;
  let curveFittingSkipped = 0;
  let curveFittingAttempted = 0;

  let inputVertices = 0;
  let originalSegmentCount = 0;
  let outputLineSegments = 0;
  let outputCubicSegments = 0;
  let fittingSuccessCount = 0;
  let fallbackCount = 0;
  let maxBidirectionalError = 0;
  let temporarySamplingPeak = 0;

  const fittedRegions = regions.map((region) => {
    const fittedPathSegments = region.loops.map((loop) => {
      totalLoops++;
      const numPts = loop.length;
      inputVertices += numPts;
      originalSegmentCount += numPts;

      if (numPts < 3) {
        curveFittingSkipped++;
        outputLineSegments += numPts;
        return loop; // 直接返回 Stage 3 RDP 简化环坐标数组
      }

      // Adaptive Eligibility Check based on Stage 3 Simplified Loop
      const isCandidate = checkCurveEligibility(loop);

      if (!isCandidate) {
        curveFittingSkipped++;
        outputLineSegments += numPts;
        // 直接保留 Stage 3 RDP 简化环，不进行任何 Segment 对象包装或热循环开销
        return loop;
      }

      curveFittingCandidates++;
      curveFittingAttempted++;

      const corners = detectCorners(loop, cornerHardness);
      const subChains = splitLoopByCorners(loop, corners);

      const loopSegments = [];
      for (const chain of subChains) {
        const chainStats = {
          success: 0,
          fallback: 0,
          lineSegs: 0,
          cubicSegs: 0,
          maxError: 0,
          temporarySamplingPeak: 0
        };
        const segs = fitCubicBezierToChain(chain, bezierTolerance, 4, chainStats);
        loopSegments.push(...segs);

        fittingSuccessCount += chainStats.success;
        fallbackCount += chainStats.fallback;
        outputLineSegments += chainStats.lineSegs;
        outputCubicSegments += chainStats.cubicSegs;
        temporarySamplingPeak += chainStats.temporarySamplingPeak;
        if (chainStats.maxError > maxBidirectionalError) {
          maxBidirectionalError = chainStats.maxError;
        }
      }

      // 若拟合出来的所有子链全都是直线段，直接保留 Stage 3 RDP 简化环，不生成 Segment 对象
      if (loopSegments.length > 0 && loopSegments.every(s => s.type === 'line')) {
        return loop;
      }

      return loopSegments;
    });

    return {
      ...region,
      pathSegments: fittedPathSegments
    };
  });

  const finalSegmentCount = outputLineSegments + outputCubicSegments;
  const outputControlPoints = (outputLineSegments * 2) + (outputCubicSegments * 4);
  const geometryObjectCount = outputLineSegments + outputCubicSegments;
  const estimatedGeometryMemoryKB = Number(((inputVertices * 16 + geometryObjectCount * 96) / 1024).toFixed(2));

  const stats = {
    totalLoops,
    curveFittingCandidates,
    curveFittingSkipped,
    curveFittingAttempted,
    inputVertices,
    originalSegmentCount,
    outputLineSegments,
    outputCubicSegments,
    finalSegmentCount,
    outputControlPoints,
    fittingSuccessCount,
    fallbackCount,
    maxBidirectionalError,
    temporarySamplingPeak,
    geometryObjectCount,
    estimatedGeometryMemoryKB,
    cornerHardness,
    bezierTolerance
  };

  console.log('[Stage 4 & 5 - Adaptive Curve Fitting Stats]', stats);

  return { regions: fittedRegions, stats };
}

// ---------- Stage 6: 几何优化 (Geometry Optimization) ----------
function pointDistance(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

function pointToSegmentDistance(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return pointDistance(p, a);
  let t = ((x - x1) * dx + (y - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx, py = y1 + t * dy;
  return pointDistance(p, [px, py]);
}

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function removeDuplicateVertices(loop, epsilon = 1e-6) {
  if (loop.length === 0) return loop;
  const res = [loop[0]];
  for (let i = 1; i < loop.length; i++) {
    if (pointDistance(res[res.length - 1], loop[i]) > epsilon) {
      res.push(loop[i]);
    }
  }
  if (res.length > 1 && pointDistance(res[res.length - 1], res[0]) <= epsilon) {
    res.pop();
  }
  return res;
}

function removeCollinearVertices(loop, epsilon = 1e-4) {
  if (loop.length < 3) return loop;
  let changed = true;
  let current = loop.slice();
  while (changed && current.length >= 3) {
    changed = false;
    const nextLoop = [];
    for (let i = 0; i < current.length; i++) {
      const prev = current[(i - 1 + current.length) % current.length];
      const curr = current[i];
      const next = current[(i + 1) % current.length];
      
      const dx1 = curr[0] - prev[0], dy1 = curr[1] - prev[1];
      const dx2 = next[0] - curr[0], dy2 = next[1] - curr[1];
      
      const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
      const dot = dx1 * dx2 + dy1 * dy2;
      const dist = pointToSegmentDistance(curr, prev, next);
      
      if (cross < epsilon && dot > 0 && dist < epsilon) {
        changed = true;
      } else {
        nextLoop.push(curr);
      }
    }
    current = nextLoop;
  }
  return current;
}

function removeDegeneratePolygons(loops, minArea = 1e-4) {
  return loops.filter(loop => loop.length >= 3 && Math.abs(signedArea(loop)) >= minArea);
}

function mergeSameColorRegions(regions) {
  return regions;
}

export function optimizeGeometry(regions, options = {}) {
  const {
    dupEpsilon = 1e-6,
    collinearEpsilon = 1e-4,
    minArea = 1e-4
  } = options;

  let inputPolygons = 0;
  let inputVertices = 0;
  let removedDuplicates = 0;
  let removedCollinears = 0;
  let removedDegenerates = 0;
  let outputPolygons = 0;
  let outputVertices = 0;

  let optimizedRegions = [];

  for (const region of regions) {
    let optLoops = [];
    
    for (const loop of region.loops) {
      inputPolygons++;
      inputVertices += loop.length;

      let l = loop.slice();
      
      l = removeDuplicateVertices(l, dupEpsilon);
      removedDuplicates += (loop.length - l.length);
      
      const lenBeforeCol = l.length;
      l = removeCollinearVertices(l, collinearEpsilon);
      removedCollinears += (lenBeforeCol - l.length);
      
      optLoops.push(l);
    }
    
    const lenBeforeDeg = optLoops.length;
    optLoops = removeDegeneratePolygons(optLoops, minArea);
    removedDegenerates += (lenBeforeDeg - optLoops.length);

    for (const loop of optLoops) {
      outputPolygons++;
      outputVertices += loop.length;
    }
    
    if (optLoops.length > 0) {
      optimizedRegions.push({
        ...region,
        loops: optLoops,
        area: polygonSetArea(optLoops)
      });
    }
  }

  optimizedRegions = mergeSameColorRegions(optimizedRegions);

  const stats = {
    inputPolygons,
    inputVertices,
    removedDuplicates,
    removedCollinears,
    removedDegenerates,
    outputPolygons,
    outputVertices
  };

  console.log('[Stage 6 - Geometry Optimization Stats]', stats);

  return { regions: optimizedRegions, stats };
}

// ---------- Stage 7: 输出矢量 SVG (SVG Generation) ----------
function round2(v) {
  return Math.round(v * 100) / 100;
}

export function buildSVG(regions, palette, width, height, simplifyEpsilon = 1.2, renderSeamGuard = false) {
  const sorted = regions.slice().sort((a, b) => b.area - a.area);
  const parts = [];
  let pathCount = 0;
  let totalVertices = 0;

  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  for (const region of sorted) {
    const color = palette[region.colorIndex];
    if (!color) continue;
    const [r, g, b, a] = color;
    // 如果是透明色块（a === 0），跳过生成 path，完美保留透明底！
    if (a !== undefined && a === 0) {
      continue;
    }

    const fill = `rgb(${r},${g},${b})`;
    let d = '';

    const loopList = region.pathSegments || region.loops;

    for (const loop of loopList) {
      if (!loop || loop.length === 0) continue;

      if (typeof loop[0] === 'object' && loop[0].type) {
        // Structured Segments (Line & Cubic Bezier)
        d += `M ${round2(loop[0].p0[0])},${round2(loop[0].p0[1])} `;
        for (const seg of loop) {
          if (seg.type === 'cubic') {
            d += `C ${round2(seg.c1[0])},${round2(seg.c1[1])} ${round2(seg.c2[0])},${round2(seg.c2[1])} ${round2(seg.p1[0])},${round2(seg.p1[1])} `;
            totalVertices += 3;
          } else {
            d += `L ${round2(seg.p1[0])},${round2(seg.p1[1])} `;
            totalVertices += 1;
          }
        }
        d += 'Z ';
      } else {
        // Plain coordinate array [[x,y], ...]
        const simplified = simplifyLoop(loop, simplifyEpsilon);
        if (simplified.length < 3) continue;
        d += `M ${round2(simplified[0][0])},${round2(simplified[0][1])} `;
        for (let i = 1; i < simplified.length; i++) {
          d += `L ${round2(simplified[i][0])},${round2(simplified[i][1])} `;
        }
        d += 'Z ';
        totalVertices += simplified.length;
      }
    }

    if (d) {
      pathCount++;
      const strokeAttr = renderSeamGuard
        ? ` stroke="${fill}" stroke-width="0.75" stroke-linejoin="round"`
        : '';
      parts.push(`<path d="${d.trim()}" fill="${fill}" fill-rule="evenodd"${strokeAttr} />`);
    }
  }
  parts.push('</svg>');
  const svgString = parts.join('\n');

  const stats = {
    pathCount,
    totalVertices,
    fileSizeChars: svgString.length
  };

  return { svg: svgString, stats };
}

// ---------- 完整流水线 ----------
export function runPipeline(img, params) {
  const {
    colorCount = 16,
    medianRadius = 1,
    despeckleMinArea = 40,
    simplifyEpsilon = 1.2,
    cornerHardness = 50,
    bezierTolerance = 0.8
  } = params;

  const denoised = medianFilter(img, medianRadius);
  const { labels, palette, width, height } = kmeansQuantize(denoised, colorCount);
  despeckleAndMerge(labels, width, height, despeckleMinArea);
  const contourRes = traceContoursShared(labels, width, height, palette.length, simplifyEpsilon);
  let regions = typeof contourRes === 'object' && contourRes.regions ? contourRes.regions : contourRes;
  const contourStats = typeof contourRes === 'object' && contourRes.stats ? contourRes.stats : null;

  const curveRes = fitCurvesToRegions(regions, { cornerHardness, bezierTolerance });
  regions = curveRes.regions;
  const svgRes = buildSVG(regions, palette, width, height, 0);

  return {
    svg: svgRes.svg,
    labels,
    palette,
    width,
    height,
    regions,
    stats: {
      contourStats,
      curveStats: curveRes.stats,
      svgStats: svgRes.stats
    }
  };
}
