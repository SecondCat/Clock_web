/* ==========================================================================
   palette.js - 配色预设管理（应用配色、同步浏览器主题色）
   经典脚本模式：依赖 state.js（ClockState）、config.js（ClockConfig，需先加载）
   导出挂载到 window.ClockPalette

   机制说明：
   - 各组配色的完整颜色变量定义在 styles.css 末尾的 body[data-palette] 规则中，
     浅/深模式由 CSS 选择器（[data-theme="dark"]）自动联动，无需 JS 干预。
   - 本模块只负责：把用户选择的预设写入 document.body.dataset.palette
     （触发 CSS 变量实时更新），并同步浏览器地址栏/标签页的主题色
     （meta[name="theme-color"]，跟随当前浅/深模式取值）。
   ========================================================================== */
'use strict';

(() => {

const { state } = window.ClockState;
const { COLOR_PRESETS } = window.ClockConfig;

/** 应用配色预设：设置 data-palette 属性，CSS 变量立即全界面实时更新 */
function applyPalette() {
  const presetId = COLOR_PRESETS[state.colorPreset] ? state.colorPreset : 'default';
  document.body.dataset.palette = presetId;
  updateThemeColor();
}

/** 同步浏览器主题色（meta[name="theme-color"]）与当前预设的背景色一致 */
function updateThemeColor() {
  const preset = COLOR_PRESETS[state.colorPreset] || COLOR_PRESETS.default;
  const dark = document.body.dataset.theme === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? preset.themeColor.dark : preset.themeColor.light;
}

/** 监听浅/深主题与配色变化，保持浏览器主题色同步（自动主题切换无需额外触发） */
function watchThemeColor() {
  const observer = new MutationObserver(updateThemeColor);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });
}

/* ---------- 命名空间导出 ---------- */
window.ClockPalette = { applyPalette, updateThemeColor, watchThemeColor };

})();
