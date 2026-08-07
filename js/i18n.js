export const translations = {
  zh: {
    title: "SuzuSVG — 插画转SVG",
    headerTitle: "SuzuSVG",
    subtitle: "(扁平)插画→ 矢量 SVG · 纯本地处理，图片不会上传到任何服务器",
    selectImage: "选择图片",
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
    seamGuardToggle: "渲染接缝保护（同色描边）",
    seamGuardHint: "矢量坐标本身已无缝拼接；这个是给游戏引擎栅格化贴图时的抗锯齿接缝上双保险，勾选后重新点\"开始处理\"生效",
    optimizeGeometryToggle: "启用几何优化 (Geometry Optimization)",
    optimizeGeometryHint: "清理冗余顶点、共线点、退化多边形，规范化方向，减小文件体积（不改变视觉效果）",
    downloadBtn: "下载 SVG",
    statusInitial: "请先选择一张图片",
    stageOriginal: "原始图片",
    stageA: "阶段A · 降噪",
    stageBC: "阶段B/C · 量化+去碎片",
    stageDE: "阶段D/E · 矢量结果",
    
    // 动态状态提示
    statusLoaded: "已加载图片 {w}x{h}，点击\"开始处理\"",
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
    selectImage: "Select Image",
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
    seamGuardToggle: "Render Seam Guard (Same-color Stroke)",
    seamGuardHint: "Vector coordinates are already seamless; this adds a stroke to prevent anti-aliasing gaps in game engines. Re-run to apply.",
    optimizeGeometryToggle: "Enable Geometry Optimization",
    optimizeGeometryHint: "Clean redundant/collinear vertices, degenerate polygons, normalize orientation, reduce file size (no visual change)",
    downloadBtn: "Download SVG",
    statusInitial: "Please select an image first",
    stageOriginal: "Original Image",
    stageA: "Stage A · Denoise",
    stageBC: "Stage B/C · Quantize & Despeckle",
    stageDE: "Stage D/E · Vector Result",
    
    // Dynamic status messages
    statusLoaded: "Loaded image {w}x{h}, click \"Start Processing\"",
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
      // 如果是 input type="button" 或类似，可能需要改 value，这里统一改 textContent
      // 对于包含子元素的标签（如 label 里面有 span 和 input），需要小心处理。
      // 我们在 HTML 中会把 data-i18n 放在最底层的文本节点容器上（如 span, p, h1, h2, button）
      el.textContent = translations[currentLang][key];
    }
  });
  
  // 更新语言切换按钮的文本
  const langBtn = document.getElementById('langToggleBtn');
  if (langBtn) {
    langBtn.textContent = currentLang === 'zh' ? '🌐 English' : '🌐 中文';
  }
}
