import { preprocessInput, medianFilter, bilateralFilter, kmeansQuantize, despeckleAndMerge, traceContoursShared, fitCurvesToRegions, buildSVG, optimizeGeometry } from './pipeline.js';
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
  cornerHardness: document.getElementById('cornerHardness'),
  cornerHardnessVal: document.getElementById('cornerHardnessVal'),
  bezierTolerance: document.getElementById('bezierTolerance'),
  bezierToleranceVal: document.getElementById('bezierToleranceVal'),
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
  magnifierLens: document.getElementById('magnifierLens'),
  magnifierCanvas: document.getElementById('magnifierCanvas'),
};

let currentImageData = null;
let currentSVGString = null;
let currentSVGImage = null;
let currentFileName = 'vectorized';
let currentMode = 'smooth';

// 初始化多语言
initI18n();
els.langToggleBtn.addEventListener('click', () => {
  toggleLanguage();
  updateDownloadSizeDisplay();
});

// ---- 动态模式切换（Segmented Pill 按钮组事件委托） ----
const vectorModeGroup = document.getElementById('vectorModeGroup');

function updateModeUI() {
  const isSmooth = currentMode === 'smooth';
  const cornerBlock = els.cornerHardness ? els.cornerHardness.closest('.control-block') : null;
  const bezierBlock = els.bezierTolerance ? els.bezierTolerance.closest('.control-block') : null;
  if (cornerBlock) cornerBlock.style.display = isSmooth ? '' : 'none';
  if (bezierBlock) bezierBlock.style.display = isSmooth ? '' : 'none';
}

if (vectorModeGroup) {
  vectorModeGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    const mode = btn.getAttribute('data-mode');
    if (!mode) return;

    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = mode;
    updateModeUI();
  });
}
updateModeUI();

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

// ---- 矢量文件体积提示与 SVG 图像转换更新 ----
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

function updateSVGImage() {
  if (!currentSVGString) {
    currentSVGImage = null;
    return;
  }
  const img = new Image();
  const blob = new Blob([currentSVGString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    currentSVGImage = img;
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

// ---- 双向绑定滑块与数值输入框 ----
function bindRange(rangeEl, valEl) {
  if (!rangeEl || !valEl) return;
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
bindRange(els.cornerHardness, els.cornerHardnessVal);
bindRange(els.bezierTolerance, els.bezierToleranceVal);

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
    const color = palette[labels[i]];
    if (color) {
      data[i * 4] = color[0];
      data[i * 4 + 1] = color[1];
      data[i * 4 + 2] = color[2];
      data[i * 4 + 3] = color[3] !== undefined ? color[3] : 255;
    }
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
    currentSVGImage = null;
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

// ---- 局部细节 高清大镜头 浮动放大镜 (Magnifier Lens) ----
function initMagnifier() {
  const canvasWraps = document.querySelectorAll('.canvas-wrap');
  if (!els.magnifierLens || !els.magnifierCanvas) return;
  const magnifierCtx = els.magnifierCanvas.getContext('2d');
  if (!magnifierCtx) return;

  const zoom = 4.0; // 4.0x 高清放大倍率
  const lensSize = 240; // 240px 大口径镜头

  canvasWraps.forEach((wrap) => {
    wrap.addEventListener('mouseenter', () => {
      els.magnifierLens.style.display = 'block';
    });

    wrap.addEventListener('mouseleave', () => {
      els.magnifierLens.style.display = 'none';
    });

    wrap.addEventListener('mousemove', (e) => {
      const canvasEl = wrap.querySelector('canvas');
      const isSvgWrap = wrap.classList.contains('svg-wrap');

      let sourceEl = canvasEl;
      let imgWidth = 0;
      let imgHeight = 0;

      if (isSvgWrap) {
        if (currentSVGImage && currentSVGImage.complete && currentSVGImage.width > 0) {
          sourceEl = currentSVGImage;
          imgWidth = currentSVGImage.width;
          imgHeight = currentSVGImage.height;
        } else {
          els.magnifierLens.style.display = 'none';
          return;
        }
      } else if (canvasEl && canvasEl.width > 0) {
        imgWidth = canvasEl.width;
        imgHeight = canvasEl.height;
      } else {
        els.magnifierLens.style.display = 'none';
        return;
      }

      const rect = wrap.getBoundingClientRect();
      const wrapW = rect.width;
      const wrapH = rect.height;

      if (wrapW === 0 || wrapH === 0 || imgWidth === 0 || imgHeight === 0) {
        els.magnifierLens.style.display = 'none';
        return;
      }

      // 计算 object-fit: contain 实际图像渲染区域
      const wrapAspect = wrapW / wrapH;
      const imgAspect = imgWidth / imgHeight;

      let renderW, renderH, offsetX, offsetY;
      if (imgAspect > wrapAspect) {
        renderW = wrapW;
        renderH = wrapW / imgAspect;
        offsetX = 0;
        offsetY = (wrapH - renderH) / 2;
      } else {
        renderH = wrapH;
        renderW = wrapH * imgAspect;
        offsetX = (wrapW - renderW) / 2;
        offsetY = 0;
      }

      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // 归一化坐标 rx, ry
      const rx = (mouseX - offsetX) / renderW;
      const ry = (mouseY - offsetY) / renderH;

      if (rx < 0 || rx > 1 || ry < 0 || ry > 1) {
        els.magnifierLens.style.display = 'none';
        return;
      }

      els.magnifierLens.style.display = 'block';
      els.magnifierLens.style.left = `${e.clientX - lensSize / 2}px`;
      els.magnifierLens.style.top = `${e.clientY - lensSize / 2}px`;

      // 消除宽高不一致形变的正方形 1:1 采样计算
      const scale = renderW / imgWidth;
      const cropSize = (lensSize / zoom) / scale;

      const sx = rx * imgWidth;
      const sy = ry * imgHeight;

      magnifierCtx.clearRect(0, 0, els.magnifierCanvas.width, els.magnifierCanvas.height);
      magnifierCtx.imageSmoothingEnabled = true;
      magnifierCtx.imageSmoothingQuality = 'high';

      try {
        magnifierCtx.drawImage(
          sourceEl,
          sx - cropSize / 2,
          sy - cropSize / 2,
          cropSize,
          cropSize,
          0,
          0,
          els.magnifierCanvas.width,
          els.magnifierCanvas.height
        );
      } catch (err) {
        // Safe Fallback
      }
    });
  });
}

initMagnifier();

// 让浏览器有机会先重绘UI（显示"正在处理"），再执行下一步耗时计算
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

els.runBtn.addEventListener('click', async () => {
  if (!currentImageData) return;
  els.runBtn.disabled = true;
  els.downloadBtn.disabled = true;
  currentSVGString = null;
  currentSVGImage = null;
  updateDownloadSizeDisplay();
  els.svgContainer.innerHTML = '';

  const colorCount = parseInt(els.colorCount.value, 10);
  const medianRadius = parseInt(els.medianRadius.value, 10);
  const despeckleMinArea = parseInt(els.despeckleMinArea.value, 10);
  const simplifyEpsilon = parseFloat(els.simplifyEpsilon.value);
  const cornerHardness = parseInt(els.cornerHardness ? els.cornerHardness.value : 50, 10);
  const bezierTolerance = parseFloat(els.bezierTolerance ? els.bezierTolerance.value : 0.8);
  const isSmoothMode = currentMode === 'smooth';

  try {
    // Stage 0: Input Preprocessing
    setStatus(t('statusStage0'));
    await nextFrame();
    const preprocessRes = preprocessInput(currentImageData, { scalePercent: els.scalePercent.value });
    const processedImageData = preprocessRes.img;
    await nextFrame();

    // Stage 1: Color Quantization & Despeckling
    setStatus(t('statusStage1'));
    await nextFrame();
    const denoised = els.bilateralToggle.checked
      ? bilateralFilter(processedImageData, medianRadius)
      : medianFilter(processedImageData, medianRadius);
    drawImageDataToCanvas(denoised, els.denoisedCanvas);
    await nextFrame();

    const { labels, palette, width, height } = kmeansQuantize(denoised, colorCount);
    despeckleAndMerge(labels, width, height, despeckleMinArea);
    drawImageDataToCanvas(labelsToImageData(labels, palette, width, height), els.quantizedCanvas);
    await nextFrame();

    // Stage 2 & 3: Boundary Extraction & Contour Simplification
    setStatus(t('statusStage2'));
    await nextFrame();
    const contourRes = traceContoursShared(labels, width, height, palette.length, simplifyEpsilon);
    let regions = typeof contourRes === 'object' && contourRes.regions ? contourRes.regions : contourRes;
    const contourStats = typeof contourRes === 'object' && contourRes.stats ? contourRes.stats : null;

    let curveStats = null;
    if (isSmoothMode) {
      // Stage 4 & 5: Corner Detection & Curve Fitting (Cubic Bezier Fitting)
      setStatus(t('statusStage5'));
      await nextFrame();
      const curveRes = fitCurvesToRegions(regions, { cornerHardness, bezierTolerance });
      regions = curveRes.regions;
      curveStats = curveRes.stats;
    } else {
      console.log('[Vector Mode] Deconstructive Line Mode selected. Using pure RDP polyline output for crisp/sharp art.');
    }

    // Stage 6: Geometry Optimization (Optional)
    let geomStats = null;
    if (els.optimizeGeometryToggle.checked) {
      setStatus(t('statusStage6'));
      await nextFrame();
      const geomRes = optimizeGeometry(regions);
      regions = geomRes.regions;
      geomStats = geomRes.stats;
    }

    // Stage 7: SVG Generation
    setStatus(t('statusStage7'));
    await nextFrame();
    const svgRes = buildSVG(regions, palette, width, height, 0, els.seamGuardToggle.checked);
    currentSVGString = typeof svgRes === 'object' ? svgRes.svg : svgRes;
    const svgStats = typeof svgRes === 'object' ? svgRes.stats : null;
    els.svgContainer.innerHTML = currentSVGString;
    updateSVGImage();

    // 控制台完整 0-7 阶段性能与复杂度对比输出
    console.log('==== [SuzuSVG Stage 0-7 Pipeline Summary] ====');
    console.log(`Vectorization Mode: ${currentMode}`);
    console.log(`Input Scale: ${els.scalePercent.value}% | Resolution: ${width}x${height}`);
    if (contourStats) {
      console.log(`Stage 2 & 3 Contour Simplification Stats:`);
      console.log(` - Raw Boundary Loop Vertices: ${contourStats.rawLoopVertexCount}`);
      console.log(` - RDP Simplified Vertices: ${contourStats.rdpSimplifiedVertexCount}`);
    }
    if (curveStats) {
      console.log(`Stage 4 & 5 Adaptive Curve Fitting Detailed Stats:`, curveStats);
      console.log(` - Total Loops: ${curveStats.totalLoops}`);
      console.log(` - Curve Fitting Candidates: ${curveStats.curveFittingCandidates}`);
      console.log(` - Curve Fitting Skipped: ${curveStats.curveFittingSkipped}`);
      console.log(` - Curve Fitting Attempted: ${curveStats.curveFittingAttempted}`);
      console.log(` - Input Vertices: ${curveStats.inputVertices}`);
      console.log(` - Original Segment Count: ${curveStats.originalSegmentCount}`);
      console.log(` - Output Line Segments: ${curveStats.outputLineSegments}`);
      console.log(` - Output Cubic Bezier Segments: ${curveStats.outputCubicSegments}`);
      console.log(` - Final Segment Count: ${curveStats.finalSegmentCount}`);
      console.log(` - Output Control Points: ${curveStats.outputControlPoints}`);
      console.log(` - Successful Bezier: ${curveStats.fittingSuccessCount}`);
      console.log(` - Fallback: ${curveStats.fallbackCount}`);
      console.log(` - Temporary Sampling Peak: ${curveStats.temporarySamplingPeak}`);
      console.log(` - Geometry Object Count: ${curveStats.geometryObjectCount}`);
      console.log(` - Estimated Geometry Memory: ${curveStats.estimatedGeometryMemoryKB} KB (Trend comparison only, not browser heap)`);
      console.log(` - Max Bidirectional Error: ${curveStats.maxBidirectionalError.toFixed(3)} px`);
    }
    if (geomStats) {
      console.log(`Stage 6 Geometry Optimization Stats:`, geomStats);
    }
    if (svgStats) {
      console.log(`Stage 7 SVG Stats: Path Count = ${svgStats.pathCount}, Total Control Vertices = ${svgStats.totalVertices}, Size = ${(svgStats.fileSizeChars / 1024).toFixed(2)} KB`);
    }

    const totalPaths = regions.reduce((s, r) => s + (r.pathSegments ? r.pathSegments.length : r.loops.length), 0);
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
