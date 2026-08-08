import { preprocessInput, medianFilter, bilateralFilter, kmeansQuantize, despeckleAndMerge, traceContoursShared, buildSVG, optimizeGeometry } from './pipeline.js';
import { initI18n, toggleLanguage, t } from './i18n.js';

const els = {
  fileInput: document.getElementById('fileInput'),
  scalePercent: document.getElementById('scalePercent'),
  scalePercentVal: document.getElementById('scalePercentVal'),
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
  downloadSizeHint: document.getElementById('downloadSizeHint'),
  status: document.getElementById('status'),
  originalCanvas: document.getElementById('originalCanvas'),
  denoisedCanvas: document.getElementById('denoisedCanvas'),
  quantizedCanvas: document.getElementById('quantizedCanvas'),
  svgContainer: document.getElementById('svgContainer'),
  langToggleBtn: document.getElementById('langToggleBtn'),
  guideBtn: document.getElementById('guideBtn'),
  guideModal: document.getElementById('guideModal'),
  closeGuideBtn: document.getElementById('closeGuideBtn'),
  dragOverlay: document.getElementById('dragOverlay'),
};

let currentImageData = null;
let currentSVGString = null;
let currentFileName = 'vectorized';

// 初始化多语言
initI18n();
els.langToggleBtn.addEventListener('click', () => {
  toggleLanguage();
  updateDownloadSizeDisplay();
});

// ---- 说明书 模态框交互逻辑 ----
if (els.guideBtn && els.guideModal) {
  els.guideBtn.addEventListener('click', () => {
    els.guideModal.classList.add('active');
  });
}

if (els.closeGuideBtn && els.guideModal) {
  els.closeGuideBtn.addEventListener('click', () => {
    els.guideModal.classList.remove('active');
  });
}

if (els.guideModal) {
  els.guideModal.addEventListener('click', (e) => {
    if (e.target === els.guideModal) {
      els.guideModal.classList.remove('active');
    }
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && els.guideModal && els.guideModal.classList.contains('active')) {
    els.guideModal.classList.remove('active');
  }
});

// ---- 矢量文件体积提示更新 ----
function updateDownloadSizeDisplay() {
  if (els.downloadSizeHint) {
    if (currentSVGString) {
      const sizeKB = (new Blob([currentSVGString]).size / 1024).toFixed(2);
      els.downloadSizeHint.textContent = t('downloadSize', { size: sizeKB });
    } else {
      els.downloadSizeHint.textContent = '';
    }
  }
}

// ---- 双向绑定滑块与数值输入框 ----
function bindRange(rangeEl, valEl) {
  const min = parseFloat(rangeEl.min);
  const max = parseFloat(rangeEl.max);

  const updateFromRange = () => {
    valEl.value = rangeEl.value;
  };

  const updateFromInput = () => {
    let val = parseFloat(valEl.value);
    if (isNaN(val)) val = parseFloat(rangeEl.value);
    if (val < min) val = min;
    if (val > max) val = max;
    rangeEl.value = val;
    valEl.value = val;
  };

  rangeEl.addEventListener('input', updateFromRange);
  valEl.addEventListener('change', updateFromInput);
  valEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      updateFromInput();
      valEl.blur();
    }
  });

  updateFromRange();
}

bindRange(els.scalePercent, els.scalePercentVal);
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

// ---- 图片处理核心加载逻辑 ----
function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
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
    currentSVGString = null;
    updateDownloadSizeDisplay();
    URL.revokeObjectURL(url);
    if (els.fileInput) els.fileInput.value = '';
  };
  img.onerror = () => {
    setStatus(t('statusError', { msg: 'Failed to load image file.' }));
    URL.revokeObjectURL(url);
    if (els.fileInput) els.fileInput.value = '';
  };
  img.src = url;
}

els.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleImageFile(file);
});

// ---- 全屏炫酷 拖拽导入 (Drag & Drop) 支持 ----
let dragCounter = 0;

window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter++;
  if (e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
    if (els.dragOverlay) els.dragOverlay.classList.add('active');
  }
});

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

window.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    if (els.dragOverlay) els.dragOverlay.classList.remove('active');
  }
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dragCounter = 0;
  if (els.dragOverlay) els.dragOverlay.classList.remove('active');
  const dt = e.dataTransfer;
  if (dt && dt.files && dt.files.length > 0) {
    handleImageFile(dt.files[0]);
  }
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
  updateDownloadSizeDisplay();
  els.svgContainer.innerHTML = '';

  const colorCount = parseInt(els.colorCount.value, 10);
  const medianRadius = parseInt(els.medianRadius.value, 10);
  const despeckleMinArea = parseInt(els.despeckleMinArea.value, 10);
  const simplifyEpsilon = parseFloat(els.simplifyEpsilon.value);

  try {
    // 阶段0：输入预处理（按百分比缩放）
    setStatus(t('statusStage0'));
    await nextFrame();
    const preprocessRes = preprocessInput(currentImageData, { scalePercent: els.scalePercent.value });
    const processedImageData = preprocessRes.img;
    await nextFrame();

    // 阶段A：降噪
    setStatus(t('statusStageA'));
    await nextFrame();
    const denoised = els.bilateralToggle.checked
      ? bilateralFilter(processedImageData, medianRadius)
      : medianFilter(processedImageData, medianRadius);
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
    let geomStats = null;
    if (els.optimizeGeometryToggle.checked) {
      setStatus(t('statusStageE'));
      await nextFrame();
      const geomRes = optimizeGeometry(regions);
      regions = geomRes.regions;
      geomStats = geomRes.stats;
    }

    setStatus(t('statusStageF'));
    await nextFrame();
    const svgRes = buildSVG(regions, palette, width, height, 0, els.seamGuardToggle.checked);
    currentSVGString = typeof svgRes === 'object' ? svgRes.svg : svgRes;
    const svgStats = typeof svgRes === 'object' ? svgRes.stats : null;
    els.svgContainer.innerHTML = currentSVGString;

    // 控制台汇总对比输出
    console.log('==== [SuzuSVG Performance & Vector Complexity Summary] ====');
    console.log(`Scale Percent: ${els.scalePercent.value}%`);
    console.log(`Processed Resolution: ${width}x${height}`);
    if (geomStats) {
      console.log(`Geometry Optimization Stats:`, geomStats);
    } else {
      console.log(`Geometry Optimization: Disabled`);
    }
    if (svgStats) {
      console.log(`SVG Output Stats: Path Count = ${svgStats.pathCount}, Total Vertices = ${svgStats.totalVertices}, Size = ${(svgStats.fileSizeChars / 1024).toFixed(2)} KB`);
    }

    const totalPaths = regions.reduce((s, r) => s + r.loops.length, 0);
    setStatus(t('statusDone', { colors: palette.length, paths: totalPaths }));
    els.downloadBtn.disabled = false;
    updateDownloadSizeDisplay();
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
