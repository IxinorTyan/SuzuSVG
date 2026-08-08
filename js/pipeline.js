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

// ---------- 1. 中值滤波降噪（保边，不会像高斯模糊那样磨掉锐利折角） ----------
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

// ---------- 1.5 双边滤波（保边降噪，比中值滤波更好地保留色块边缘的锐利过渡） ----------
// 中值滤波逐通道取窗口内中位数，容易在纹理复杂区域抹掉细节；
// 双边滤波额外用"颜色相近度"加权，只在颜色相近的邻居间平滑，边缘附近几乎不模糊。
export function bilateralFilter(img, radius, sigmaColor = 30, sigmaSpace = 3) {
  if (radius <= 0) return img;
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(data.length);

  // 预计算空间高斯权重
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

// ---------- 2. K-means颜色量化（无dithering） ----------
export function kmeansQuantize(img, k, opts = {}) {
  const { data, width, height } = img;
  const maxIter = opts.maxIter ?? 12;
  const sampleStep = opts.sampleStep ?? 3;
  const n = width * height;

  // 采样像素用于找聚类中心（加速）
  const samples = [];
  for (let i = 0; i < n; i += sampleStep) {
    const idx = i * 4;
    samples.push([data[idx], data[idx + 1], data[idx + 2]]);
  }

  // k-means++ 初始化
  const centers = [];
  centers.push(samples[Math.floor(Math.random() * samples.length)]);
  while (centers.length < k) {
    let distSum = 0;
    const dists = samples.map((s) => {
      let best = Infinity;
      for (const c of centers) {
        const d = (s[0]-c[0])**2 + (s[1]-c[1])**2 + (s[2]-c[2])**2;
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

  // 迭代
  for (let iter = 0; iter < maxIter; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const cc = centers[c];
        const d = (s[0]-cc[0])**2 + (s[1]-cc[1])**2 + (s[2]-cc[2])**2;
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best][0] += s[0]; sums[best][1] += s[1]; sums[best][2] += s[2]; sums[best][3]++;
    }
    for (let c = 0; c < centers.length; c++) {
      if (sums[c][3] > 0) {
        centers[c] = [sums[c][0]/sums[c][3], sums[c][1]/sums[c][3], sums[c][2]/sums[c][3]];
      }
    }
  }

  // 给每个像素分配标签（无抖动，最近邻）
  const labels = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    const r = data[idx], g = data[idx+1], b = data[idx+2];
    let best = 0, bestD = Infinity;
    for (let c = 0; c < centers.length; c++) {
      const cc = centers[c];
      const d = (r-cc[0])**2 + (g-cc[1])**2 + (b-cc[2])**2;
      if (d < bestD) { bestD = d; best = c; }
    }
    labels[i] = best;
  }

  const palette = centers.map((c) => [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])]);
  const merged = mergeCloseClusters(labels, palette);
  return { labels: merged.labels, palette: merged.palette, width, height };
}

// K-means是随机初始化的，偶尔会把肉眼看起来是同一种颜色的区域（比如纯色背景）
// 分裂成两个颜色极其接近的簇。这两个簇在边界处交错分布时会产生椒盐状噪点，
// 而且每个小碎片的面积可能都刚好超过despeckle阈值，导致清理不掉。
// 这里在量化后、despeckle前，把颜色距离很近的簇直接合并，从根源上避免这种情况。
function mergeCloseClusters(labels, palette, colorDistThreshold = 18) {
  const k = palette.length;
  const parent = Array.from({ length: k }, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const [r1,g1,b1] = palette[i], [r2,g2,b2] = palette[j];
      const dist = Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
      if (dist < colorDistThreshold) union(i, j);
    }
  }

  // 给每个合并组重新分配连续标签，颜色取组内像素数加权平均
  const rootToNewLabel = new Map();
  let nextLabel = 0;
  for (let i = 0; i < k; i++) {
    const r = find(i);
    if (!rootToNewLabel.has(r)) rootToNewLabel.set(r, nextLabel++);
  }

  const pixelCountPerOld = new Array(k).fill(0);
  for (let i = 0; i < labels.length; i++) pixelCountPerOld[labels[i]]++;

  const newPaletteAccum = Array.from({ length: nextLabel }, () => [0, 0, 0, 0]);
  for (let i = 0; i < k; i++) {
    const nl = rootToNewLabel.get(find(i));
    const w = pixelCountPerOld[i];
    newPaletteAccum[nl][0] += palette[i][0] * w;
    newPaletteAccum[nl][1] += palette[i][1] * w;
    newPaletteAccum[nl][2] += palette[i][2] * w;
    newPaletteAccum[nl][3] += w;
  }
  const newPalette = newPaletteAccum.map((acc) => acc[3] > 0
    ? [Math.round(acc[0]/acc[3]), Math.round(acc[1]/acc[3]), Math.round(acc[2]/acc[3])]
    : [0, 0, 0]);

  const oldToNew = new Int32Array(k);
  for (let i = 0; i < k; i++) oldToNew[i] = rootToNewLabel.get(find(i));

  const newLabels = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) newLabels[i] = oldToNew[labels[i]];

  return { labels: newLabels, palette: newPalette };
}

// ---------- 3. 连通域碎片清理（despeckle），小碎片归并给最大的相邻颜色，不留空洞 ----------
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
        // 4邻域
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
    // 标记需要清除的小碎片像素
    let anySmall = false;
    const toClear = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (compArea[compId[i]] < minArea) { toClear[i] = 1; anySmall = true; }
    }
    if (!anySmall) break;

    // 多源BFS波前填充：只处理"待清除像素与已知像素的边界"，而不是每轮扫全图
    // 初始frontier：toClear像素中，至少有一个非toClear邻居的
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
      // 统计非toClear邻居的label众数（最多4个邻居，直接线性找众数即可）
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

      if (c0 === 0) { inQueue[p] = 0; continue; } // 暂时没有已解析的邻居，稍后再处理

      let bestLabel = l0, bestCount = c0;
      if (c1 > bestCount) { bestCount = c1; bestLabel = l1; }
      if (c2 > bestCount) { bestCount = c2; bestLabel = l2; }
      if (c3 > bestCount) { bestCount = c3; bestLabel = l3; }

      labels[p] = bestLabel;
      toClear[p] = 0;

      // 把仍待清除的邻居加入队列
      if (x > 0 && toClear[p - 1] && !inQueue[p - 1]) { queue[tail++] = p - 1; inQueue[p - 1] = 1; }
      if (x < width - 1 && toClear[p + 1] && !inQueue[p + 1]) { queue[tail++] = p + 1; inQueue[p + 1] = 1; }
      if (y > 0 && toClear[p - width] && !inQueue[p - width]) { queue[tail++] = p - width; inQueue[p - width] = 1; }
      if (y < height - 1 && toClear[p + width] && !inQueue[p + width]) { queue[tail++] = p + width; inQueue[p + width] = 1; }

      if (tail >= n) { // 队列长度保护：重置为紧凑数组（极少触发）
        const remain = queue.slice(head, tail);
        remain.forEach((v, i) => queue[i] = v);
        tail -= head; head = 0;
      }
    }
  }
  return labels;
}

// ---------- 4. 全局边界图：每条物理边只生成一次，同时记录两侧的颜色标签 ----------
// 这是解决缝隙问题的基础：不再按颜色各自收集边（导致后续各自简化各自的），
// 而是先建立一张"谁和谁在哪条边上相邻"的全局图。
function buildBoundaryGraph(labels, width, height) {
  const edges = []; // { v1, v2, sideA, sideB, used }
  const vertexAdj = new Map(); // vertexId -> [{ other, edgeIdx }]

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
      // 上边：只由当前像素生成一次（避免和上方像素重复生成同一条边）
      const up = y === 0 ? -1 : labels[(y - 1) * width + x];
      if (up !== c) addEdge(x, y, x + 1, y, up, c);
      // 左边：只由当前像素生成一次
      const left = x === 0 ? -1 : labels[y * width + x - 1];
      if (left !== c) addEdge(x, y, x, y + 1, left, c);
      // 下边/右边：只有贴着画布边界时才需要单独生成（内部的已经被邻居的"上/左"逻辑生成过了）
      if (y === height - 1) addEdge(x, y + 1, x + 1, y + 1, c, -1);
      if (x === width - 1) addEdge(x + 1, y, x + 1, y + 1, c, -1);
    }
  }

  return { edges, vertexAdj };
}

// ---------- 5. 弧提取：把"路口"(度数≠2，即3种及以上颜色交汇)之间连续的边收缩成一条弧 ----------
// 每条弧从头到尾只被两种固定颜色共享，且只会被生成、简化一次。
function extractArcs(graph) {
  const { edges, vertexAdj } = graph;
  const arcs = [];

  function firstUnused(v) {
    const list = vertexAdj.get(v) || [];
    for (const e of list) if (!edges[e.edgeIdx].used) return e;
    return null;
  }

  function finalizeArc(pts, sideA, sideB) {
    // 若弧本身首尾重合（闭合的自环，比如被完全包裹的孤立小色块），
    // 记作独立闭环，去掉尾部重复点，后面直接整环使用、不再和别的弧拼接。
    const closed = pts.length > 1 &&
      pts[0] === pts[pts.length - 1];
    if (closed) pts.pop();
    arcs.push({ pts, sideA, sideB, isolatedLoop: closed });
  }

  // 5a: 从每个路口出发，沿度数为2的链条走到下一个路口
  for (const [v, list] of vertexAdj) {
    if (list.length === 2) continue; // 不是路口，跳过（会在下面被别的路口的弧覆盖到）
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

  // 5b: 剩余的、完全不经过任何路口的独立闭环
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

// ---------- 6. 每条弧只简化一次，两侧颜色共用同一份简化结果 ----------
function simplifyArcsSet(arcs, width, epsilon) {
  return arcs.map((arc) => {
    const coords = arc.pts.map((vid) => vidToXY(vid, width));
    let pts;
    const touchesOutside = arc.sideA === -1 || arc.sideB === -1;
    if (touchesOutside) {
      // 贴着画布边缘的边界不参与简化，避免简化力度大时矢量图边缘向内收缩、露出画布底色
      pts = coords;
    } else if (arc.isolatedLoop) {
      pts = epsilon > 0 ? simplifyLoop(coords, epsilon) : coords;
    } else {
      pts = epsilon > 0 && coords.length > 2 ? rdp(coords, epsilon) : coords;
    }
    return { pts, sideA: arc.sideA, sideB: arc.sideB, isolatedLoop: arc.isolatedLoop };
  });
}

// ---------- 7. 用共享弧拼装每个颜色的闭合环 ----------
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
    // 同一条弧的几何点，sideB方向直接用，sideA方向反着用——
    // 这样两侧各自拼装时，用的是完全相同的坐标数组，只是遍历方向相反。
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
          if (!next) break; // 兜底：正常拓扑不会走到这里
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

// ---------- 拓扑无缝版轮廓提取：替代 traceContours + 逐色块simplifyLoop ----------
// 共享边界只简化一次，两侧颜色复用同一份坐标，物理上不可能产生缝隙。
export function traceContoursShared(labels, width, height, numColors, epsilon = 1.2) {
  const graph = buildBoundaryGraph(labels, width, height);
  const rawArcs = extractArcs(graph);
  const simplifiedArcs = simplifyArcsSet(rawArcs, width, epsilon);
  const regions = assembleRegionLoops(simplifiedArcs, numColors);
  return regions.map((r) => ({ ...r, area: polygonSetArea(r.loops) }));
}

// ---------- Douglas-Peucker多边形简化（闭合环，独立小色块用） ----------
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
  // 闭合环：用离首点最远的点切成两段分别RDP，再拼回来
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

// ---------- 6. 输出SVG ----------
// renderSeamGuard: 给每个色块加一道和填充色相同的细描边。
// 矢量坐标本身已无缝共享，这个选项是给"下游栅格化"上保险——
// Unity/Godot把SVG转成贴图时是逐个path分别抗锯齿的，哪怕坐标完全重合，
// 边缘半透明像素叠加处仍可能露出发丝级缝隙，同色描边能盖住这种渲染级接缝。
export function buildSVG(regions, palette, width, height, simplifyEpsilon = 1.2, renderSeamGuard = false) {
  const sorted = regions.slice().sort((a, b) => b.area - a.area);
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  for (const region of sorted) {
    const [r, g, b] = palette[region.colorIndex];
    const fill = `rgb(${r},${g},${b})`;
    let d = '';
    for (const loop of region.loops) {
      const simplified = simplifyLoop(loop, simplifyEpsilon);
      if (simplified.length < 3) continue;
      d += `M ${simplified[0][0]},${simplified[0][1]} `;
      for (let i = 1; i < simplified.length; i++) {
        d += `L ${simplified[i][0]},${simplified[i][1]} `;
      }
      d += 'Z ';
    }
    if (d) {
      const strokeAttr = renderSeamGuard
        ? ` stroke="${fill}" stroke-width="0.75" stroke-linejoin="round"`
        : '';
      parts.push(`<path d="${d.trim()}" fill="${fill}" fill-rule="evenodd"${strokeAttr} />`);
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

// ---------- 8. Geometry Optimization (第五模块) ----------

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

function pointInPolygon(pt, polygon) {
  let isInside = false;
  const [x, y] = pt;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
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

function normalizeOrientationAndHoles(loops) {
  const nesting = new Array(loops.length).fill(0);
  for (let i = 0; i < loops.length; i++) {
    if (loops[i].length < 3) continue;
    for (let j = 0; j < loops.length; j++) {
      if (i === j) continue;
      if (loops[j].length < 3) continue;
      if (pointInPolygon(loops[i][0], loops[j])) {
        nesting[i]++;
      }
    }
  }
  
  const normalized = [];
  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i].slice();
    if (loop.length < 3) {
      normalized.push(loop);
      continue;
    }
    const area = signedArea(loop);
    const isOuter = nesting[i] % 2 === 0;
    
    if (isOuter && area < 0) {
      loop.reverse();
    } else if (!isOuter && area > 0) {
      loop.reverse();
    }
    normalized.push(loop);
  }
  return normalized;
}

function removeDegeneratePolygons(loops, minArea = 1e-4) {
  return loops.filter(loop => loop.length >= 3 && Math.abs(signedArea(loop)) >= minArea);
}

function mergeSameColorRegions(regions) {
  // 预留接口，当前直接返回原数据
  // 未来可接入 Clipper2、Martinez 等布尔运算库
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
      
      // 1. Remove Duplicate Vertices
      const lenBeforeDup = l.length;
      l = removeDuplicateVertices(l, dupEpsilon);
      removedDuplicates += (lenBeforeDup - l.length);
      
      // 2. Remove Collinear Vertices
      const lenBeforeCol = l.length;
      l = removeCollinearVertices(l, collinearEpsilon);
      removedCollinears += (lenBeforeCol - l.length);
      
      optLoops.push(l);
    }
    
    // 3. Remove Degenerate Polygon
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

  console.log('[Stage E - Geometry Optimization Stats]', stats);

  return { regions: optimizedRegions, stats };
}

// ---------- 汇总：完整流水线 ----------
export function runPipeline(img, params) {
  const {
    colorCount = 16,
    medianRadius = 1,
    despeckleMinArea = 40,
    simplifyEpsilon = 1.2,
  } = params;

  const denoised = medianFilter(img, medianRadius);
  const { labels, palette, width, height } = kmeansQuantize(denoised, colorCount);
  despeckleAndMerge(labels, width, height, despeckleMinArea);
  const regions = traceContoursShared(labels, width, height, palette.length, simplifyEpsilon);
  const svg = buildSVG(regions, palette, width, height, 0); // 已经简化过，这里不再二次简化

  return { svg, labels, palette, width, height, regions };
}
