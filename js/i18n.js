export const translations = {
  zh: {
    title: "SuzuSVG — 插画转SVG",
    headerTitle: "SuzuSVG",
    subtitle: "(扁平)插画→ 矢量 SVG · 纯本地处理，图片不会上传到任何服务器",
    selectImage: "选择图片 (或拖拽图片到此)",
    scalePercent: "缩放比例 (%)",
    scalePercentHint: "按百分比等比例缩放图像分辨率，降低矢量复杂度（100% 为原图）",
    colorCount: "颜色数量",
    colorCountHint: "K-means聚类的颜色种类，扁平插画建议 10~20",
    medianRadius: "降噪半径",
    medianRadiusHint: "保边降噪半径，越大越平滑（但可能磨圆细节折角）",
    bilateralToggle: "用双边滤波替代中值滤波",
    bilateralHint: "额外按颜色相近度加权，边缘附近更少被抹平，纹理复杂的图建议开启（速度会变慢）",
    despeckleMinArea: "碎片过滤阈值",
    despeckleHint: "小于此面积（像素²）的色块碎片会被合并进相邻颜色",
    simplifyEpsilon: "轮廓简化强度",
    simplifyHint: "越大路径点越少、边缘越直，适合解构主义风格",
    runBtn: "开始处理",
    runBtnHint: "提示：因为实际上是代码渲染与算法聚类，即使是同一参数，也可能需要重复运行几次（Reroll）才能出现想要的效果。",
    seamGuardToggle: "渲染接缝保护（同色描边）",
    seamGuardHint: "矢量坐标本身已无缝拼接；这个是给游戏引擎栅格化贴图时的抗锯齿接缝上双保险，勾选后重新点\"开始处理\"生效",
    optimizeGeometryToggle: "启用几何优化 (Geometry Optimization) (不一定真的会有用)",
    optimizeGeometryHint: "清理冗余顶点、共线点、退化多边形，减小文件体积（不一定真的会有用，效果取决于具体图像结构）",
    downloadBtn: "下载 SVG",
    downloadSize: "文件大小: {size} KB",
    statusInitial: "请先选择一张图片",
    stageOriginal: "原始图片",
    stageA: "阶段A · 降噪",
    stageBC: "阶段B/C · 量化+去碎片",
    stageDE: "阶段D/E · 矢量结果",
    footerNotice: "开源项目 · 基于 MIT 协议纯前端本地处理",
    dragOverlayText: "释放图片到任意位置即可导入",

    // 说明书 Modal 多语言
    guideBtn: "使用说明 / 指南",
    guideTitle: "SuzuSVG 使用说明与参数指南",
    guideScopeTitle: "核心定位与适用场景",
    guideScopeText: "SuzuSVG 专注于将<b>扁平插画、解构主义艺术、线条分明的 Logo/Icon</b> 转换为高质量矢量图。对于此类图片，转换后的 SVG 文件体积可大幅缩小且边缘极度清晰。",
    guideBadgeSuccess: "✅ 推荐：线条简单、平涂色块、解构主义、扁平插画",
    guideBadgeDanger: "❌ 不推荐：普通二次元细节画、高密渐变、带杂色网点的写实插画",
    guideCaseTitle: "真实测试案例对比",
    caseATitle: "解构主义插画 (案例 A)",
    caseADesc: "线条与色块结构清晰，无冗余细节。",
    caseAEffect: "转换效果：完美",
    caseASize: "文件大小：<b>1.1 MB ➔ 11 KB</b> (暴降 99%)",
    caseBTitle: "普通二次元插画 (案例 B)",
    caseBDesc: "包含大量发丝细节、微小阴影与网点。",
    caseBEffect: "转换效果：较差/色块碎裂",
    caseBSize: "文件大小：<b>0.5 MB ➔ 0.9 MB</b> (反增 80%)",
    guideParamTitle: "参数调优指南",
    paramScale: "<b>缩放比例 (%)：</b>在矢量化之前等比例缩小像素分辨率，能平滑微小像素噪点，极大降低矢量 Path 节点数并提升运行速度。",
    paramColor: "<b>颜色数量：</b>K-means 聚类提取的色块种类。色块越少，生成的矢量图越纯净；过高会导致碎片噪点成倍增加。",
    paramNoise: "<b>降噪半径 / 双边滤波：</b>平滑色彩噪声。勾选双边滤波可以在平滑降噪的同时，更好地保留锐利的色块边缘折角（速度较慢）。",
    paramDespeckle: "<b>碎片过滤阈值：</b>自动把小于该面积（px²）的孤立微小碎片像素归并进相邻最大的颜色，清理椒盐噪点。",
    paramSimplify: "<b>轮廓简化强度：</b>使用 RDP 算法拉直多边形边缘。数值越大节点越少、线条越直，非常适合解构主义风格。",
    paramGeom: "<b>几何优化 (Geometry Optimization)：</b>后处理清理冗余/共线顶点与退化多边形（<i>不一定真的会有用，效果取决于具体的图像几何结构</i>）。",
    paramSeam: "<b>渲染接缝保护：</b>给矢量 Path 加上同色微细描边，彻底消除游戏引擎/浏览器渲染时的发丝级抗锯齿缝隙。",
    
    // 动态状态提示
    statusLoaded: "已加载图片 {w}x{h}，点击\"开始处理\"",
    statusStage0: "阶段0: 正在进行输入预处理...",
    statusStageA: "阶段A: 正在降噪...",
    statusStageB: "阶段B: 正在量化颜色...",
    statusStageC: "阶段C: 正在清理碎片噪点...",
    statusStageD: "阶段D: 正在提取矢量轮廓...",
    statusStageE: "阶段E: 正在进行几何优化...",
    statusStageF: "阶段F: 正在生成SVG...",
    statusDone: "完成！共 {colors} 种颜色，{paths} 个矢量区域。",
    statusError: "处理出错: {msg}"
  },
  en: {
    title: "SuzuSVG — Illustration to SVG",
    headerTitle: "SuzuSVG",
    subtitle: "(Flat) Illustration → Vector SVG · 100% Local Processing, No Server Uploads",
    selectImage: "Select Image (or Drag & Drop)",
    scalePercent: "Scale Percentage (%)",
    scalePercentHint: "Proportionally scale image resolution to lower vector complexity (100% = original)",
    colorCount: "Color Count",
    colorCountHint: "K-means clustering colors, 10~20 recommended for flat illustrations",
    medianRadius: "Denoise Radius",
    medianRadiusHint: "Edge-preserving denoise radius, larger is smoother (but may round sharp corners)",
    bilateralToggle: "Use Bilateral Filter instead of Median",
    bilateralHint: "Weights by color similarity, preserves edges better. Recommended for complex textures (slower)",
    despeckleMinArea: "Despeckle Threshold",
    despeckleHint: "Fragments smaller than this area (px²) will be merged into adjacent colors",
    simplifyEpsilon: "Simplify Strength",
    simplifyHint: "Larger value means fewer points and straighter edges, suitable for deconstructivism style",
    runBtn: "Start Processing",
    runBtnHint: "Tip: Since clustering is randomized, re-running with the same parameters multiple times (Reroll) may yield different desired results.",
    seamGuardToggle: "Render Seam Guard (Same-color Stroke)",
    seamGuardHint: "Vector coordinates are already seamless; this adds a stroke to prevent anti-aliasing gaps in game engines. Re-run to apply.",
    optimizeGeometryToggle: "Enable Geometry Optimization (May not always be effective)",
    optimizeGeometryHint: "Clean redundant/collinear vertices, degenerate polygons, reduce file size (may not always be effective, depends on image)",
    downloadBtn: "Download SVG",
    downloadSize: "SVG File Size: {size} KB",
    statusInitial: "Please select an image first",
    stageOriginal: "Original Image",
    stageA: "Stage A · Denoise",
    stageBC: "Stage B/C · Quantize & Despeckle",
    stageDE: "Stage D/E · Vector Result",
    footerNotice: "Open Source Project · 100% Local Browser Processing under MIT License",
    dragOverlayText: "Drop image anywhere to import",

    // Guide Modal English
    guideBtn: "User Guide",
    guideTitle: "SuzuSVG User Guide & Parameter Reference",
    guideScopeTitle: "Core Scope & Applicable Scenarios",
    guideScopeText: "SuzuSVG focuses on converting <b>flat illustrations, deconstructivist art, and clean-line Logos/Icons</b> into high-quality vector images. For these image types, SVG file sizes drop dramatically while edges remain ultra-sharp.",
    guideBadgeSuccess: "✅ Recommended: Simple lines, flat color blocks, deconstructivism, flat illustrations",
    guideBadgeDanger: "❌ Not Recommended: Complex anime drawings, dense gradients, halftone textures",
    guideCaseTitle: "Real-World Test Case Comparison",
    caseATitle: "Deconstructivist Art (Case A)",
    caseADesc: "Clean lines and well-defined color blocks without redundant details.",
    caseAEffect: "Quality: Perfect",
    caseASize: "File Size: <b>1.1 MB ➔ 11 KB</b> (-99%)",
    caseBTitle: "Standard Anime Art (Case B)",
    caseBDesc: "Contains fine hair lines, subtle shading, and halftone noise.",
    caseBEffect: "Quality: Poor / Fragmented",
    caseBSize: "File Size: <b>0.5 MB ➔ 0.9 MB</b> (+80%)",
    guideParamTitle: "Parameter Tuning Guide",
    paramScale: "<b>Scale Percentage (%):</b> Proportionally reduces image resolution before vectorization to smooth pixel noise, dramatically decrease path vertex count, and boost speed.",
    paramColor: "<b>Color Count:</b> Number of colors clustered by K-means. Fewer colors produce a cleaner vector result; higher values increase fragmented noise.",
    paramNoise: "<b>Denoise Radius / Bilateral Filter:</b> Smooths color noise. Enabling Bilateral Filter preserves sharp corners better while denoising (slower).",
    paramDespeckle: "<b>Despeckle Threshold:</b> Automatically merges isolated speckle pixels smaller than this area (px²) into adjacent dominant colors.",
    paramSimplify: "<b>Simplify Strength:</b> Straightens polygon edges using Douglas-Peucker algorithm. Higher values yield fewer vertices and straighter lines.",
    paramGeom: "<b>Geometry Optimization:</b> Post-processing to remove redundant/collinear vertices and degenerate polygons (<i>May not always be effective, depends on image geometry</i>).",
    paramSeam: "<b>Render Seam Guard:</b> Adds a fine same-color stroke to vector paths to eliminate hairline anti-aliasing gaps during rasterization.",
    
    // Dynamic status messages
    statusLoaded: "Loaded image {w}x{h}, click \"Start Processing\"",
    statusStage0: "Stage 0: Preprocessing input...",
    statusStageA: "Stage A: Denoising...",
    statusStageB: "Stage B: Quantizing colors...",
    statusStageC: "Stage C: Cleaning speckles...",
    statusStageD: "Stage D: Extracting vector contours...",
    statusStageE: "Stage E: Optimizing geometry...",
    statusStageF: "Stage F: Generating SVG...",
    statusDone: "Done! {colors} colors, {paths} vector regions.",
    statusError: "Error: {msg}"
  }
};

let currentLang = 'en';

export function initI18n() {
  // 1. 尝试从 localStorage 读取
  const savedLang = localStorage.getItem('suzu_vector_lang');
  if (savedLang && (savedLang === 'zh' || savedLang === 'en')) {
    currentLang = savedLang;
  } else {
    // 2. 否则根据浏览器语言自动判断
    const browserLang = navigator.language || navigator.userLanguage;
    if (browserLang.toLowerCase().includes('zh')) {
      currentLang = 'zh';
    } else {
      currentLang = 'en';
    }
  }
  applyLanguage();
}

export function toggleLanguage() {
  currentLang = currentLang === 'zh' ? 'en' : 'zh';
  localStorage.setItem('suzu_vector_lang', currentLang);
  applyLanguage();
}

export function getLang() {
  return currentLang;
}

export function t(key, params = {}) {
  let text = translations[currentLang][key] || key;
  for (const [k, v] of Object.entries(params)) {
    text = text.replace(`{${k}}`, v);
  }
  return text;
}

function applyLanguage() {
  document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('title');
  
  const elements = document.querySelectorAll('[data-i18n]');
  elements.forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (translations[currentLang][key]) {
      el.innerHTML = translations[currentLang][key];
    }
  });
  
  // 更新语言切换按钮的文本
  const langBtn = document.getElementById('langToggleBtn');
  if (langBtn) {
    langBtn.textContent = currentLang === 'zh' ? '🌐 English' : '🌐 中文';
  }
}
