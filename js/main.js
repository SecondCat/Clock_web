/* ==========================================================================
   main.js - 入口与生命周期编排
   职责：初始化时序、定时器/rAF 统一管理（后台暂停省电、退出即清理）、
        页面可见性/方向/尺寸适配、调试接口。所有业务逻辑都在各业务模块中。
   经典脚本模式：作为最后一个脚本（defer）加载，依赖全部前置命名空间。
   不再使用 ES Module import/export —— 各模块通过 window.ClockXxx 命名空间互访。
   ========================================================================== */
'use strict';

(() => {

const {
  loadState, state,
} = window.ClockState;
const {
  abortPendingRequests,
} = window.ClockUtils;
const {
  tick, forceRefresh, applyDigitWidth, scheduleDigitMeasure,
} = window.ClockRender;
const {
  buildAnalogClockFace, updateAnalogClock,
} = window.ClockAnalog;
const {
  applyTheme,
} = window.ClockTheme;
const {
  applyPalette, watchThemeColor,
} = window.ClockPalette;
const {
  applyStyle,
} = window.ClockStyle;
const {
  preloadAllFonts, countCachedFaces, getFontLoadStatus, clearFontCache,
} = window.ClockFonts;
const {
  setupFontToast,
} = window.ClockFontToast;
const {
  nowMs, syncTime, setSyncEnabled, getSyncStatus,
} = window.ClockTime;
const {
  updateWeather, loadCachedLocation, getAmapKey,
} = window.ClockWeather;
const {
  setupSettingsPanel,
} = window.ClockSettings;
const {
  SYNC_INTERVAL,
  WEATHER_REFRESH_INTERVAL,
  RESYNC_AFTER_VISIBLE,
  WEATHER_REFRESH_AFTER_VISIBLE,
} = window.ClockConfig;

/* ---------- 生命周期变量（定时器/rAF 句柄） ---------- */
let tickTimer = null;
let rafId = null;
let analogActive = false;
let syncTimer = null;    // 周期校准定时器（与时钟动画同生命周期：隐藏暂停、退出清理）
let weatherTimer = null; // 天气定时刷新（同生命周期管理）
let repaintTimer = null; // 强制重绘定时器（保持渲染管线活跃，防止长时间静止导致渲染错误/显存问题）
let repaintFlag = false; // 强制重绘的交替标志（translateZ 微移 0/1px，视觉无差异）

/** 启动全部定时器与动画循环（页面可见时调用） */
function startClockAnimation() {
  if (tickTimer === null) {
    tickTimer = setInterval(tick, 250); // 250ms 粒度保证数字显示与冒号同步
  }
  if (syncTimer === null) {
    syncTimer = setInterval(syncTime, SYNC_INTERVAL); // 每小时自动重新校准
  }
  if (weatherTimer === null) {
    weatherTimer = setInterval(() => updateWeather(), WEATHER_REFRESH_INTERVAL); // 每 10 分钟刷新天气
  }
  if (repaintTimer === null) {
    repaintTimer = setInterval(forceRepaint, 500); // 每 500ms 强制重绘一次（2fps）
  }
  if (!analogActive) {
    analogActive = true;
    const loop = () => {
      if (!analogActive) return;
      updateAnalogClock(new Date(nowMs()));
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }
}

/** 强制重绘全局屏幕：切换 #clock-app 的 translateZ（0↔1px，Z 轴微移视觉无差异），
    强制浏览器合成器重新合成整个页面。长时间静止显示（minimal/neon 数字不变）时，
    浏览器可能进入异常状态或 GPU/显存累积导致渲染错误，周期性强制重绘可规避 */
function forceRepaint() {
  repaintFlag = !repaintFlag;
  const app = document.getElementById('clock-app');
  if (app) app.style.transform = repaintFlag ? 'translateZ(1px)' : 'translateZ(0px)';
}

/** 停止全部定时器与动画循环（页面隐藏/退出时调用） */
function stopClockAnimation() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (syncTimer !== null) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
  if (weatherTimer !== null) {
    clearInterval(weatherTimer);
    weatherTimer = null;
  }
  if (repaintTimer !== null) {
    clearInterval(repaintTimer);
    repaintTimer = null;
  }
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  analogActive = false;
}

/** 退出/隐藏时释放全部后台资源：停止定时器与动画、中断请求 */
function cleanupBackgroundServices() {
  stopClockAnimation();
  abortPendingRequests();
}

/** 横竖屏记录（CSS 媒体查询负责实际布局） */
function handleOrientation() {
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  document.body.dataset.orientation = isPortrait ? 'portrait' : 'landscape';
}

/* ---------- 初始化 ---------- */

function init() {
  loadState();

  // 读取缓存的定位信息：即使定位权限关闭/被拒，也能基于上次定位展示天气
  state.location = loadCachedLocation();

  // 应用主题、风格、字体
  applyTheme();
  applyPalette();
  applyStyle(state.style, { persist: false });

  // 构建模拟表盘
  buildAnalogClockFace();

  // 数字槽位宽度：先按当前字体测量；Web 字体加载完成后重测，覆盖精确宽度
  scheduleDigitMeasure();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => setTimeout(applyDigitWidth, 100));
  }
  // 字体加载完成（本地缓存注入/网络加载成功）后同样重测槽位宽度
  window.addEventListener('clock:fonts-loaded', () => {
    setTimeout(applyDigitWidth, 100);
  });

  // 打开页面后自动下载全部网络字体（每个字体族只尝试 1 次，失败不重试不中断其余）
  setTimeout(() => preloadAllFonts(), 0);

  // 立即渲染一次时钟（避免空白闪烁）
  tick();
  // 定时器与 rAF 由生命周期统一管理：页面隐藏时暂停、回到前台恢复、退出时清理
  startClockAnimation();

  // 设置面板
  setupSettingsPanel();

  // 浏览器主题色跟随浅/深模式与配色预设变化（自动主题切换亦同步）
  watchThemeColor();

  // 字体加载状态提示（toast：网络加载中 / 失败 / 手动刷新）
  setupFontToast();

  // 方向监听
  handleOrientation();
  window.addEventListener('orientationchange', () => {
    setTimeout(handleOrientation, 150);
  });
  window.addEventListener('resize', () => {
    clearTimeout(window.__resizeTimer);
    window.__resizeTimer = setTimeout(() => {
      handleOrientation();
      applyDigitWidth(); // 视口约束可能改变实际字号，重新测量槽位宽度
    }, 200);
  });

  // 页面可见性：隐藏时暂停全部动画与定时器（省电、释放 CPU），回到前台立即恢复
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopClockAnimation();
    } else {
      forceRefresh();
      startClockAnimation();
      // 回到前台且距上次校准超过 30 分钟 → 立即补一次校准
      if (getSyncStatus().lastSyncAt && Date.now() - getSyncStatus().lastSyncAt > RESYNC_AFTER_VISIBLE) syncTime();
      // 回到前台且距上次天气更新超过 10 分钟 → 立即补刷新天气
      if (state.weatherTimestamp && Date.now() - state.weatherTimestamp > WEATHER_REFRESH_AFTER_VISIBLE) {
        updateWeather();
      }
    }
  });

  // 应用退出（关闭标签页/刷新）：停止所有定时器与动画，中断未完成的网络请求，
  // 确保不在后台持续运行任何服务、不驻留任何资源
  window.addEventListener('pagehide', cleanupBackgroundServices);
  window.addEventListener('beforeunload', cleanupBackgroundServices);

  // 天气：页面加载后延迟请求（避免与初始渲染争抢）；有缓存定位时直接加载缓存位置天气
  setTimeout(() => updateWeather(), 800);

  // 时间自动校准：按开关状态启动——
  // 开启：页面加载后立即从网络时间源校准一次（自动修正系统时间偏差）；
  // 关闭：偏移归零，始终使用本地系统时间。
  setTimeout(() => setSyncEnabled(state.autoSync), 600);
}

document.addEventListener('DOMContentLoaded', init);

/* ---------- 调试接口（只读）：便于外部/测试查看校准状态与手动触发校准 ---------- */
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__clockDebug', {
    value: {
      get syncState() { return getSyncStatus().syncState; },
      get timeOffset() { return getSyncStatus().timeOffset; },
      get lastSyncAt() { return getSyncStatus().lastSyncAt; },
      get weatherTimestamp() { return state.weatherTimestamp; },
      get weatherTimerActive() { return weatherTimer !== null; },
      get amapKeyConfigured() { return getAmapKey() !== ''; },
      get autoSync() { return state.autoSync; },
      get analogDigital() { return state.analogDigital; },
      get weatherSource() { return state.weatherSource; },
      get fontCacheCount() { return countCachedFaces(); },
      get fontLoadStatus() { return getFontLoadStatus(); },
      syncTime,
      updateWeather,
      ensureFontLoaded,
      clearFontCache,
    },
    writable: false,
    configurable: false,
  });
}

})();
