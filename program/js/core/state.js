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
  style: 'minimal',        // minimal | analog
  hourFormat: 24,          // 24 | 12
  themeMode: 'auto',       // auto | light | dark
  colorPreset: 'default',  // 配色预设：default | ocean | sunset | forest | sakura | graphite | amethyst
  autoSync: true,          // 时间自动校准开关：true=网络时间校准，false=使用本地系统时间
  analogDigital: true,     // 模拟表盘风格下是否显示数字时间
  showSeconds: true,       // 是否显示秒数
  showAmpm: true,          // 是否显示 AM/PM（仅 12 小时制下生效）
  showDate: true,          // 是否显示日期
  showWeather: true,       // 是否显示天气
  infoFontSize: 16,        // 日期/天气字号（px，范围 10-28）
  weatherSource: 'auto',   // 天气数据源：auto | amap | ecmwf | gfs | wttr
  globalZoom: 100,         // 全局缩放百分比（50-200，步进 10；CSS zoom 实现页面级整体缩放）
  analogScale: 100,        // 表盘尺寸缩放百分比（50-200，步进 5；仅 analog 风格，乘到 vh/vw 基础比例上）
  // 每种风格的独立字体设置
  fonts: {},               // { minimal: '...', analog: '...' }
  sizes: {},               // { minimal: 92, analog: 40 }
  weights: {},             // { minimal: 200, analog: 400 }
  digitGaps: {},           // { minimal: 0, analog: 0 } 数字间距（em，负值=字符层叠；冒号间距由此联动派生）
  glow: 'on',              // 数字发光开关：'on' | 'off'（开启即冷光灯管效果）
  uiOpen: {},              // 设置面板各分组的展开状态：{ clock: true, data: false, ... }（只影响 UI）
  weather: null,           // 最近一次天气数据
  weatherTimestamp: 0,
  location: null,          // 最近一次定位
};

function loadState() {
  let dirty = false; // 本次载入是否修正过存档（含移除风格的数据清理），需要回写
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      Object.assign(state, saved);
      // 确保未知字段回退默认（2026-11-12 移除霓虹风后，旧存档的 style:"neon" 走这里）
      if (!STYLE_CONFIGS[state.style]) { state.style = 'minimal'; dirty = true; }
      if (state.hourFormat !== 12 && state.hourFormat !== 24) state.hourFormat = 24;
      if (!['auto', 'light', 'dark'].includes(state.themeMode)) state.themeMode = 'auto';
      if (!COLOR_PRESETS[state.colorPreset]) state.colorPreset = 'default';
      if (typeof state.autoSync !== 'boolean') state.autoSync = true;
      if (typeof state.analogDigital !== 'boolean') state.analogDigital = true;
      if (typeof state.showSeconds !== 'boolean') state.showSeconds = true;
      if (typeof state.showAmpm !== 'boolean') state.showAmpm = true;
      if (typeof state.showDate !== 'boolean') state.showDate = true;
      if (typeof state.showWeather !== 'boolean') state.showWeather = true;
      if (typeof state.infoFontSize !== 'number') state.infoFontSize = 16;
      state.infoFontSize = Math.min(28, Math.max(10, Math.round(state.infoFontSize)));
      if (!['auto', 'amap', 'ecmwf', 'gfs', 'cma', 'wttr'].includes(state.weatherSource)) state.weatherSource = 'auto';
      if (typeof state.globalZoom !== 'number') state.globalZoom = 100;
      state.globalZoom = Math.min(200, Math.max(50, Math.round(state.globalZoom)));
      if (typeof state.analogScale !== 'number') state.analogScale = 100;
      // 旧值 soft（原柔和档）/ strong（原强光档）统一并入 on：2026-11-12 起只保留一档
      if (state.glow === 'soft' || state.glow === 'strong') { state.glow = 'on'; dirty = true; }
      else if (state.glow !== 'on' && state.glow !== 'off') state.glow = 'on';
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
  // 轻量渲染档已移除（2026-11-12）：旧存档里的 perfMode 一并丢弃，避免留下幽灵字段
  if ('perfMode' in state) { delete state.perfMode; dirty = true; }
  // 清理已移除风格（neon）遗留的分风格设置，避免存档无限累积
  for (const map of ['fonts', 'sizes', 'weights', 'digitGaps']) {
    for (const key of Object.keys(state[map])) {
      if (!STYLE_CONFIGS[key]) { delete state[map][key]; dirty = true; }
    }
  }
  // 面板折叠状态：只接受布尔值，未知分组键丢弃（避免旧存档污染 DOM 的 data-open）
  if (state.uiOpen && typeof state.uiOpen === 'object') {
    const clean = {};
    Object.keys(state.uiOpen).forEach((k) => {
      if (typeof state.uiOpen[k] === 'boolean' && /^[a-z]{3,10}$/.test(k)) clean[k] = state.uiOpen[k];
    });
    state.uiOpen = clean;
  } else {
    state.uiOpen = {};
  }
  if (dirty) saveState();
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
      showDate: state.showDate,
      showWeather: state.showWeather,
      infoFontSize: state.infoFontSize,
      weatherSource: state.weatherSource,
      globalZoom: state.globalZoom,
      analogScale: state.analogScale,
      glow: state.glow,
      uiOpen: state.uiOpen,
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
