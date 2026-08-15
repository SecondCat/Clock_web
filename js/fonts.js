/* ==========================================================================
   fonts.js - 字体本地缓存与优先加载
   ==========================================================================
   策略：
   1. 应用启动 / 切换字体时，优先从 IndexedDB 读取已缓存的字体数据，
      构造 FontFace 直接注入，完全离线可用、秒开；
   2. 本地无缓存时，才请求 Google Fonts CSS2 + woff2 分片，成功后写入
      IndexedDB 持久化，供下次直接使用；
   3. 网络失败 / 字体数据损坏时静默回退（CSS font-family 栈中的
      系统字体兜底），不阻塞页面渲染；单个字体族下载整体超时 120 秒，
      超时或其它错误统一上报 failed（UI 提示「下载失败，已回退系统字体」）；
   4. 系统字体（Helvetica/Segoe UI/Georgia/Palatino 等）不经网络加载。
   经典脚本模式：依赖 utils.js（ClockUtils，需先加载）
   导出挂载到 window.ClockFonts
   ========================================================================== */
'use strict';

(() => {

const { withTimeout } = window.ClockUtils;

/* ---------- IndexedDB 封装 ---------- */

const DB_NAME = 'fullscreenClockFonts';
const DB_VERSION = 1;
const STORE = 'fontFaces';
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE); // out-of-line key（见 keyOf）
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 读取单条字体缓存记录 */
function dbGet(key) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  }));
}

/** 写入单条字体缓存记录 */
function dbPut(key, value) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** 按字体族前缀取全部缓存记录 */
function dbGetByFamily(family) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const range = IDBKeyRange.bound(`face:${family}:`, `face:${family}:\uffff`);
    const r = tx.objectStore(STORE).getAll(range);
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  }));
}

/** 统计缓存记录总数（调试用） */
async function countCachedFaces() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } catch (e) {
    return 0;
  }
}

/** 清空全部字体缓存（IndexedDB fontFaces store），返回已清除的记录数 */
async function clearFontCache() {
  try {
    const db = await openDB();
    const count = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).count();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return count;
  } catch (e) {
    console.warn('[fonts] 清空缓存失败', (e && e.message) || e);
    return 0;
  }
}

function keyOf(rec) {
  return `face:${rec.family}:${rec.style}:${rec.weight}:${rec.unicodeRange || ''}`;
}

/* ---------- 网络字体族表（Google Fonts） ---------- */

// 与 config.js ALL_FONTS 中的网络字体一一对应（系统字体不在其中）
const WEB_FONTS = [
  { family: 'Inter', weights: '100..900' },
  { family: 'Montserrat', weights: '100..900' },
  { family: 'Poppins', weights: '100..900' },
  { family: 'Space Grotesk', weights: '300..700' },
  { family: 'Oswald', weights: '200..700' },
  { family: 'Roboto Mono', weights: '100..700' },
  { family: 'Share Tech Mono', weights: '400' },
  { family: 'Major Mono Display', weights: '400' },
  { family: 'Orbitron', weights: '400..900' },
  { family: 'Exo 2', weights: '100..900' },
  { family: 'Chakra Petch', weights: '300..700' },
  { family: 'Audiowide', weights: '400' },
  { family: 'Michroma', weights: '400' },
  { family: 'Cinzel', weights: '400..900' },
  { family: 'Playfair Display', weights: '400..900' },
  { family: 'Cormorant Garamond', weights: '300..700' },
  { family: 'EB Garamond', weights: '400..800' },
];
const webFontByFamily = new Map(WEB_FONTS.map((f) => [f.family, f]));

/** 从 CSS font-family 字符串提取首个族名（'Inter', 'PingFang SC', sans-serif → Inter） */
function extractFamily(fontCssValue) {
  const m = String(fontCssValue || '').match(/^\s*['"]?([^'",]+?)['"]?\s*(?:,|$)/);
  return m ? m[1].trim() : null;
}

/** 构造 Google Fonts CSS2 地址（单个字体族，限制字重范围以减小体积） */
function familyCssUrl(family) {
  const info = webFontByFamily.get(family);
  const f = family.replace(/ /g, '+');
  return info && info.weights !== '400'
    ? `https://fonts.googleapis.com/css2?family=${f}:wght@${info.weights}&display=swap`
    : `https://fonts.googleapis.com/css2?family=${f}&display=swap`;
}

/* ---------- CSS @font-face 解析 ---------- */

/** 解析 Google Fonts CSS 文本，提取每个 @font-face 的族名/字重/风格/unicode-range/woff2 地址 */
function parseFontFaceCss(cssText) {
  const faces = [];
  const faceRe = /@font-face\s*\{([^}]*)\}/g;
  let m;
  while ((m = faceRe.exec(cssText))) {
    const props = {};
    const propRe = /([a-zA-Z-]+)\s*:\s*([^;]*);/g;
    let p;
    while ((p = propRe.exec(m[1]))) props[p[1].trim()] = p[2].trim();
    const family = (props['font-family'] || '').replace(/^['"]|['"]$/g, '').trim();
    if (!family || !props.src) continue;
    const srcMatch = props.src.match(/url\(\s*(['"]?)(.*?)\1\s*\)\s*format\(\s*['"]?woff2/i);
    if (!srcMatch) continue;
    faces.push({
      family,
      style: props['font-style'] || 'normal',
      weight: props['font-weight'] || '400',
      unicodeRange: props['unicode-range'] || '',
      url: srcMatch[2],
    });
  }
  return faces;
}

/* ---------- 网络请求 ---------- */

// 整个字体族下载（CSS + 全部 woff2 分片）的总超时：120 秒，超时按下载失败处理
const FONT_DOWNLOAD_TIMEOUT = 120000;

async function fetchText(url, signal) {
  const res = await fetch(url, { signal: signal || withTimeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function fetchArrayBuffer(url, signal) {
  const res = await fetch(url, { signal: signal || withTimeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

/* ---------- FontFace 注入 ---------- */

/** 将缓存记录注入 document.fonts（单条损坏不影响其余） */
async function injectFaces(records) {
  for (const rec of records) {
    if (!rec || !(rec.buffer instanceof ArrayBuffer) || rec.buffer.byteLength === 0) continue;
    try {
      const face = new FontFace(rec.family, rec.buffer, {
        style: rec.style,
        weight: rec.weight,
        unicodeRange: rec.unicodeRange || undefined,
      });
      await face.load();
      document.fonts.add(face);
    } catch (e) {
      console.warn(`[fonts] 缓存字体注入失败：${rec.family} ${rec.weight}`, (e && e.message) || e);
    }
  }
}

/** 通知页面字体已加载完成（供槽位宽度重测等联动） */
function notifyFontsLoaded() {
  window.dispatchEvent(new CustomEvent('clock:fonts-loaded'));
}

/* ---------- 加载状态（供 UI 提示：加载中 / 完成 / 失败） ---------- */

const FONT_STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  LOADED: 'loaded',
  FAILED: 'failed',
};

let fontStatus = FONT_STATUS.IDLE;
let currentFamily = null;
let lastFromCache = false;

// 已成功加载过的字体族（避免每次调整字号/字重都重复注入 FontFace 导致卡顿）
const loadedFamilies = new Set();

/** 查询当前字体加载状态（调试/外部轮询用） */
function getFontLoadStatus() {
  return { status: fontStatus, family: currentFamily, fromCache: lastFromCache };
}

/** 更新加载状态并派发 clock:font-status 事件（fontToast.js 监听驱动提示 UI） */
function setFontStatus(status, family, fromCache = false) {
  fontStatus = status;
  currentFamily = family || null;
  lastFromCache = !!fromCache;
  window.dispatchEvent(new CustomEvent('clock:font-status', {
    detail: { status: fontStatus, family: currentFamily, fromCache: lastFromCache },
  }));
}

/* ---------- 核心：缓存优先加载 ---------- */

/**
 * 确保指定字体可用（不阻塞调用方，内部异步完成）：
 * 1. 系统字体 → 直接返回（无需加载）；
 * 2. IndexedDB 已有该族缓存 → 直接注入；
 * 3. 无缓存 → 网络加载并持久化到 IndexedDB。
 * 任何失败均静默回退，不抛异常。
 * 状态上报策略：本地缓存命中 → 全程静默（不派发 loading/loaded 完成提示）；
 * 网络加载 → 派发 loading（「网络加载中」提示）→ loaded（完成提示由 UI 层忽略）；
 * 失败 → failed（「加载失败」提示）。
 */
async function ensureFontLoaded(fontCssValue) {
  const family = extractFamily(fontCssValue);
  if (!family || !webFontByFamily.has(family)) return; // 系统字体/未知族名
  if (loadedFamilies.has(family)) return; // 已加载过，跳过（避免重复注入导致卡顿）
  try {
    const cached = await dbGetByFamily(family);
    if (cached.length > 0) {
      // 本地缓存命中：静默注入，不派发 loading（避免「本地加载中」提示）
      await injectFaces(cached);
      setFontStatus(FONT_STATUS.LOADED, family, true); // 来自本地缓存
    } else {
      // 无缓存 → 网络加载（此刻才派发 loading，供 UI 显示「网络加载中」）
      setFontStatus(FONT_STATUS.LOADING, family);
      await loadAndCacheFamily(family);
      setFontStatus(FONT_STATUS.LOADED, family, false); // 来自网络
    }
    loadedFamilies.add(family);
    notifyFontsLoaded();
  } catch (e) {
    setFontStatus(FONT_STATUS.FAILED, family);
    console.warn(`[fonts] 字体「${family}」加载失败，已回退系统字体`, (e && e.message) || e);
  }
}

/** 网络加载一个字体族的所有分片并写入缓存（整体 120 秒超时；单个分片失败跳过，不中断整族） */
async function loadAndCacheFamily(family) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FONT_DOWNLOAD_TIMEOUT);
  try {
    const cssUrl = familyCssUrl(family);
    const cssText = await fetchText(cssUrl, controller.signal);
    const faces = parseFontFaceCss(cssText);
    if (faces.length === 0) throw new Error('CSS 中无有效 @font-face');
    let okCount = 0;
    for (const face of faces) {
      try {
        const buffer = await fetchArrayBuffer(face.url, controller.signal);
        const rec = {
          family: face.family,
          style: face.style,
          weight: face.weight,
          unicodeRange: face.unicodeRange,
          buffer,
          storedAt: Date.now(),
        };
        await dbPut(keyOf(rec), rec);
        await injectFaces([rec]);
        okCount++;
      } catch (e) {
        console.warn(`[fonts] 分片加载失败：${family} ${face.weight} ${(face.unicodeRange || '').slice(0, 24)}`, (e && e.message) || e);
      }
    }
    if (okCount === 0) throw new Error('全部字重分片加载失败');
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 命名空间导出 ---------- */
window.ClockFonts = {
  FONT_STATUS,
  extractFamily,
  countCachedFaces,
  clearFontCache,
  getFontLoadStatus,
  ensureFontLoaded,
};

})();
