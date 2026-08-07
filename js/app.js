import { medianFilter, bilateralFilter, kmeansQuantize, despeckleAndMerge, traceContoursShared, buildSVG, optimizeGeometry } from './pipeline.js';
import { initI18n, toggleLanguage, t } from './i18n.js';

const els = {
  fileInput: document.getElementById('fileInput'),
  colorCount: document.getElementById('colorCount'),
  colorCountVal: document.getElementById('colorCountVal'),
  medianRadius: document.getElementById('medianRadius'),
  medianRadiusVal: document.getElementById('medianRadiusVal'),
  despeckleMinArea: document.getElementById('despeckleMinArea'),
  despeckleMinAreaVal: document.getElementById('despeckleMinAreaVal'),
  simplifyEpsilon: document.getElementById('simplifyEpsilon'),
  simplifyEpsilonVal: document.getElementById('simplifyEpsilonVal'),
  bilateralToggle: document.getElementById('bilateralToggle'),
  seamGuardToggle: document.getElementById('seamGuardToggle'),
  optimizeGeometryToggle: document.getElementById('optimizeGeometryToggle'),
  runBtn: document.getElementById('runBtn'),
  downloadBtn: document.getElementById('downloadBtn'),
  status: document.getElementById('status'),
  originalCanvas: document.getElementById('originalCanvas'),
  denoisedCanvas: document.getElementById('denoisedCanvas'),
  quantizedCanvas: document.getElementById('quantizedCanvas'),
  svgContainer: document.getElementById('svgContainer'),
  langToggleBtn: document.getElementById('langToggleBtn'),
};

// 初始化多语言
initI18n();
els.langToggleBtn.addEventListener('click', toggleLanguage);

let currentImageData = null;
let currentSVGString = null;
let currentFileName = 'vectorized';

// ---- 滑块数值同步显示 ----
function bindRange(rangeEl, labelEl) {
  const update = () => { labelEl.textContent = rangeEl.value; };
  rangeEl.addEventListener('input', update);
  update();
}
bindRange(els.colorCount, els.colorCountVal);
bindRange(els.medianRadius, els.medianRadiusVal);
bindRange(els.despeckleMinArea, els.despeckleMinAreaVal);
bindRange(els.simplifyEpsilon, els.simplifyEpsilonVal);

function setStatus(text) {
  els.status.textContent = text;
}

function drawImageDataToCanvas(imgData, canvas) {
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  const ctx = canvas.getContext('2d');
  const clamped = new Uint8ClampedArray(imgData.data);
  ctx.putImageData(new ImageData(clamped, imgData.width, imgData.height), 0, 0);
}

function labelsToImageData(labels, palette, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = palette[labels[i]];
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

els.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  currentFileName = file.name.replace(/\.[^.]+$/, '') || 'vectorized';
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, img.width, img.height);
    currentImageData = { data: new Uint8ClampedArray(imgData.data), width: img.width, height: img.height };
    drawImageDataToCanvas(currentImageData, els.originalCanvas);
    setStatus(t('statusLoaded', { w: img.width, h: img.height }));
    els.runBtn.disabled = false;
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

// 让浏览器有机会先重绘UI（显示"正在处理"），再执行下一步耗时计算
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

els.runBtn.addEventListener('click', async () => {
  if (!currentImageData) return;
  els.runBtn.disabled = true;
  els.downloadBtn.disabled = true;
  currentSVGString = null;
  els.svgContainer.innerHTML = '';

  const colorCount = parseInt(els.colorCount.value, 10);
  const medianRadius = parseInt(els.medianRadius.value, 10);
  const despeckleMinArea = parseInt(els.despeckleMinArea.value, 10);
  const simplifyEpsilon = parseFloat(els.simplifyEpsilon.value);

  try {
    // 阶段A：降噪
    setStatus(t('statusStageA'));
    await nextFrame();
    const denoised = els.bilateralToggle.checked
      ? bilateralFilter(currentImageData, medianRadius)
      : medianFilter(currentImageData, medianRadius);
    drawImageDataToCanvas(denoised, els.denoisedCanvas);
    await nextFrame();

    // 阶段B：颜色量化
    setStatus(t('statusStageB'));
    await nextFrame();
    const { labels, palette, width, height } = kmeansQuantize(denoised, colorCount);
    drawImageDataToCanvas(labelsToImageData(labels, palette, width, height), els.quantizedCanvas);
    await nextFrame();

    // 阶段C：碎片清理
    setStatus(t('statusStageC'));
    await nextFrame();
    despeckleAndMerge(labels, width, height, despeckleMinArea);
    drawImageDataToCanvas(labelsToImageData(labels, palette, width, height), els.quantizedCanvas);
    await nextFrame();

    // 阶段D：轮廓提取 + 简化
    setStatus(t('statusStageD'));
    await nextFrame();
    // 拓扑无缝版：共享边界只在路口之间被简化一次，相邻色块复用同一份坐标，
    // 无论simplifyEpsilon多大，色块之间都不会因为"各自简化各自的"而错开产生缝隙。
    let regions = traceContoursShared(labels, width, height, palette.length, simplifyEpsilon);

    // 阶段E：几何优化 (可选)
    if (els.optimizeGeometryToggle.checked) {
      setStatus(t('statusStageE'));
      await nextFrame();
      regions = optimizeGeometry(regions);
    }

    setStatus(t('statusStageF'));
    await nextFrame();
    const svg = buildSVG(regions, palette, width, height, 0, els.seamGuardToggle.checked);
    currentSVGString = svg;
    els.svgContainer.innerHTML = svg;

    const totalPaths = regions.reduce((s, r) => s + r.loops.length, 0);
    setStatus(t('statusDone', { colors: palette.length, paths: totalPaths }));
    els.downloadBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(t('statusError', { msg: err.message }));
  } finally {
    els.runBtn.disabled = false;
  }
});

els.downloadBtn.addEventListener('click', () => {
  if (!currentSVGString) return;
  const blob = new Blob([currentSVGString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentFileName}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
