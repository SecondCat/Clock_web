/* ==========================================================================
   theme.js - 深色/浅色主题管理
   经典脚本模式：依赖 state.js（ClockState）、timeSync.js（ClockTime）、
   config.js（ClockConfig，需先加载）
   导出挂载到 window.ClockTheme
   ========================================================================== */
'use strict';

(() => {

const { state } = window.ClockState;
const { nowMs } = window.ClockTime;
const { AUTO_DARK_START, AUTO_LIGHT_START } = window.ClockConfig;

/** 按当前时刻计算并应用自动主题（6:00 – 18:00 浅色，其余深色） */
function applyAutoTheme(now = new Date(nowMs())) {
  const h = now.getHours();
  const isDark = h >= AUTO_DARK_START || h < AUTO_LIGHT_START;
  document.body.dataset.theme = isDark ? 'dark' : 'light';
}

/** 应用用户选择的主题模式，并同步设置面板按钮高亮 */
function applyTheme() {
  if (state.themeMode === 'auto') {
    applyAutoTheme();
  } else {
    document.body.dataset.theme = state.themeMode;
  }
  // 同步按钮高亮
  document.querySelectorAll('.theme-option').forEach((btn) => {
    const active = btn.dataset.mode === state.themeMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-checked', String(active));
  });
}

/* ---------- 命名空间导出 ---------- */
window.ClockTheme = { applyAutoTheme, applyTheme };

})();
