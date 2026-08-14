/* ==========================================================================
   state.js - 全局状态管理与 localStorage 持久化
   经典脚本模式：依赖 config.js（ClockConfig，需先加载）
   导出挂载到 window.ClockState
   ========================================================================== */
'use strict';

(() => {

const { STORAGE_KEY, STYLE_CONFIGS, COLOR_PRESETS } = window.ClockConfig;

/** 全局状态（可变对象，各模块直接读写属性） */
const state = {
  style: 'minimal',        // minimal | neon | analog
  hourFormat: 24,          // 24 | 12
  themeMode: 'auto',       // auto | light | dark
  colorPreset: 'default',  // 配色预设：default | ocean | sunset | forest | sakura | graphite | amethyst
  autoSync: true,          // 时间自动校准开关：true=网络时间校准，false=使用本地系统时间
  analogDigital: true,     // 模拟表盘风格下是否显示数字时间
  showSeconds: true,       // 是否显示秒数
  showAmpm: true,          // 是否显示 AM/PM（仅 12 小时制下生效）
  weatherSource: 'auto',   // 天气数据源：auto | amap | ecmwf | gfs | wttr
  globalZoom: 100,         // 全局缩放百分比（50-200，步进 10；CSS zoom 实现页面级整体缩放）
  analogScale: 100,        // 表盘尺寸缩放百分比（50-200，步进 5；仅 analog 风格，乘到 vh/vw 基础比例上）
  // 每种风格的独立字体设置
  fonts: {},               // { minimal: '...', neon: '...', analog: '...' }
  sizes: {},               // { minimal: 92, neon: 84, analog: 40 }
  weights: {},             // { minimal: 200, neon: 700, analog: 400 }
  digitGaps: {},           // { minimal: 0, neon: 0, analog: 0 } 数字间距（em，负值=字符层叠；冒号间距由此联动派生）
  weather: null,           // 最近一次天气数据
  weatherTimestamp: 0,
  location: null,          // 最近一次定位
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(state, saved);
      // 确保未知字段回退默认
      if (!STYLE_CONFIGS[state.style]) state.style = 'minimal';
      if (state.hourFormat !== 12 && state.hourFormat !== 24) state.hourFormat = 24;
      if (!['auto', 'light', 'dark'].includes(state.themeMode)) state.themeMode = 'auto';
      if (!COLOR_PRESETS[state.colorPreset]) state.colorPreset = 'default';
      if (typeof state.autoSync !== 'boolean') state.autoSync = true;
      if (typeof state.analogDigital !== 'boolean') state.analogDigital = true;
      if (typeof state.showSeconds !== 'boolean') state.showSeconds = true;
      if (typeof state.showAmpm !== 'boolean') state.showAmpm = true;
      if (!['auto', 'amap', 'ecmwf', 'gfs', 'cma', 'wttr'].includes(state.weatherSource)) state.weatherSource = 'auto';
      if (typeof state.globalZoom !== 'number') state.globalZoom = 100;
      state.globalZoom = Math.min(200, Math.max(50, Math.round(state.globalZoom)));
      if (typeof state.analogScale !== 'number') state.analogScale = 100;
      state.analogScale = Math.min(200, Math.max(50, Math.round(state.analogScale)));
    }
  } catch (e) {
    // localStorage 不可用，静默使用默认值
  }
  // 确保每种风格都有字体/字号/字重/间距设置
  if (!state.digitGaps || typeof state.digitGaps !== 'object') state.digitGaps = {};
  for (const [key, cfg] of Object.entries(STYLE_CONFIGS)) {
    if (!state.fonts[key]) state.fonts[key] = cfg.defaultFont;
    if (typeof state.sizes[key] !== 'number') state.sizes[key] = cfg.defaultSize;
    if (typeof state.weights[key] !== 'number') state.weights[key] = cfg.defaultWeight;
    if (typeof state.digitGaps[key] !== 'number') state.digitGaps[key] = 0;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      style: state.style,
      hourFormat: state.hourFormat,
      themeMode: state.themeMode,
      colorPreset: state.colorPreset,
      autoSync: state.autoSync,
      analogDigital: state.analogDigital,
      showSeconds: state.showSeconds,
      showAmpm: state.showAmpm,
      weatherSource: state.weatherSource,
      globalZoom: state.globalZoom,
      analogScale: state.analogScale,
      fonts: state.fonts,
      sizes: state.sizes,
      weights: state.weights,
      digitGaps: state.digitGaps,
    }));
  } catch (e) { /* 忽略存储失败 */ }
}

/* ---------- 命名空间导出 ---------- */
window.ClockState = { state, loadState, saveState };

})();
