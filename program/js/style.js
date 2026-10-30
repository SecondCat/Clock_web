/* ==========================================================================
   style.js - 时钟风格管理（切换风格、应用字体/字号/字重到 CSS 变量）
   经典脚本模式：依赖 utils.js（ClockUtils）、state.js（ClockState）、
   config.js（ClockConfig）、clock.js（ClockRender）、fonts.js（ClockFonts，需先加载）
   导出挂载到 window.ClockStyle
   ========================================================================== */
'use strict';

(() => {

const { $ } = window.ClockUtils;
const { state, saveState } = window.ClockState;
const { ALL_FONTS, STYLE_CONFIGS } = window.ClockConfig;
const { scheduleDigitMeasure } = window.ClockRender;
const { ensureFontLoaded } = window.ClockFonts;

/** 切换时钟风格（minimal | neon | analog），并应用该风格的字体设置 */
function applyStyle(style, { persist = true } = {}) {
  state.style = style;
  document.body.dataset.style = style;

  // 数字时间显示开关的生效状态（analog 风格下可关闭数字时间）
  document.body.dataset.analogDigital = state.analogDigital ? 'on' : 'off';
  // 秒数显示开关（全局，所有风格生效）
  document.body.dataset.showSeconds = state.showSeconds ? 'on' : 'off';

  // 同步风格下拉框（与字体选择一致的交互方式）
  const styleSelect = $('#style-select');
  if (styleSelect) styleSelect.value = style;
  // 编程设 value 不触发 change，需手动同步自定义下拉的 trigger 文本与高亮
  if (window.ClockSelect) window.ClockSelect.syncAll();

  // 「模拟表盘显示数字时间」开关仅在该风格下显示
  const toggleRow = $('#analog-digital-toggle-row');
  if (toggleRow) toggleRow.hidden = style !== 'analog';

  // 「表盘尺寸」滑动条仅在该风格下显示，并应用缩放系数到 CSS 变量
  const scaleRow = $('#analog-scale-row');
  if (scaleRow) scaleRow.hidden = style !== 'analog';
  applyAnalogScale();

  // 应用该风格的字体设置
  applyFontSettings(style);

  if (persist) saveState();

  // 通知生命周期模块：表针动画按需启停（仅 analog 逐帧驱动）+ 重算信息栏贴靠位置
  window.dispatchEvent(new CustomEvent('clock:style-applied', { detail: { style } }));
}

/** 将表盘尺寸缩放系数（state.analogScale，百分比）应用到 --analog-scale（数字 0.5-2），
    并同步滑动条（供 applyStyle 初始化与滑动条事件复用） */
function applyAnalogScale() {
  const scale = state.analogScale || 100;
  document.documentElement.style.setProperty('--analog-scale', String(scale / 100));
  const slider = $('#analog-scale-slider');
  if (slider) slider.value = String(scale);
}

/** 只把字体/字号/字重/间距写入 CSS 变量（高频路径）。
    字号、字重、数字间距三个滑条的 input 事件直接走这里 —— 不触碰设置面板 DOM，
    避免每拖动一像素就重建字体下拉（21 个 option）并触发自定义下拉重建 21 个 li。
    间距派生规则集中在此：冒号间距与秒数间距均由数字间距同向联动。 */
function applyFontVars(style = state.style) {
  const font = state.fonts[style];
  const size = state.sizes[style];
  const weight = state.weights[style];
  const root = document.documentElement.style;

  root.setProperty('--clock-font', font);
  // 字号设到根上，CSS 里用 min() 与 vw/vh 组合做响应式
  root.setProperty('--clock-font-size', `${size}px`);
  // 字重同样设到根上，由 .time-display 的 var 引用
  root.setProperty('--clock-font-weight', weight);

  // 数字间距（按风格独立，em；负值=字符层叠），写入根变量供 .digit/.hours/.minutes 使用
  const gap = typeof state.digitGaps[style] === 'number' ? state.digitGaps[style] : 0;
  root.setProperty('--clock-digit-gap', `${gap}em`);

  // 冒号间距：由数字间距联动派生（方向一致）——数字拉开则冒号同步外移，
  // 数字层叠则收敛至下限。下限 0.2em 已考虑冒号自身宽度，保证冒号右缘与数字
  // 左缘始终有正间隙；上限 0.6em 防止极端值下偏离过远。
  const colonGap = Math.min(0.6, Math.max(0.2, 0.3 + gap * 0.25));
  root.setProperty('--clock-colon-gap', `${colonGap}em`);

  // 秒数+AM/PM 组合距离分钟数的间距：同样随数字间距同向联动。
  // 基础 0.055em（gap=0 时约 5px @92px 主字号），下限 0.03em 保证不与分钟重叠，
  // 上限 0.5em 防止极端 gap 下偏离过远。
  const secondsGap = Math.min(0.5, Math.max(0.03, 0.055 + gap * 0.25));
  root.setProperty('--clock-seconds-gap', `${secondsGap}em`);
}

/** 字体下拉选项：ALL_FONTS 固定不变，只在首次（或数量不匹配）时构建一次 */
function ensureFontOptions() {
  const select = $('#font-family-select');
  if (!select) return null;
  if (select.options.length === ALL_FONTS.length) return select;
  select.innerHTML = '';
  ALL_FONTS.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.value;
    opt.textContent = f.label;
    select.appendChild(opt);
  });
  return select;
}

/** 同步设置面板中的字体相关控件（低频路径：初始化 / 风格切换 / 字体变更时调用） */
function syncFontPanel(style = state.style) {
  const cfg = STYLE_CONFIGS[style];
  const font = state.fonts[style];
  const size = state.sizes[style];
  const weight = state.weights[style];

  const select = ensureFontOptions();
  if (select) {
    let matched = false;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === font) { matched = true; break; }
    }
    if (matched) {
      if (select.value !== font) select.value = font;
    } else {
      // 当前保存的字体不在内置列表中（如旧版本遗留的本地字体）→ 回退默认并保存
      state.fonts[style] = cfg.defaultFont;
      saveState();
      select.value = cfg.defaultFont;
      document.documentElement.style.setProperty('--clock-font', cfg.defaultFont);
    }
  }

  const slider = $('#font-size-slider');
  if (slider) {
    if (slider.min !== String(cfg.minSize)) slider.min = cfg.minSize;
    if (slider.max !== String(cfg.maxSize)) slider.max = cfg.maxSize;
    if (slider.value !== String(size)) slider.value = size;
  }

  const weightSlider = $('#font-weight-slider');
  if (weightSlider && weightSlider.value !== String(weight)) weightSlider.value = weight;

  const gap = typeof state.digitGaps[style] === 'number' ? state.digitGaps[style] : 0;
  const gapSlider = $('#digit-gap-slider');
  if (gapSlider && gapSlider.value !== String(gap)) gapSlider.value = String(gap);

  const label = $('#current-style-label');
  if (label) label.textContent = `（${cfg.label}）`;

  // 编程设 select.value 不触发 change，需手动同步自定义下拉的 trigger 文本与高亮
  if (window.ClockSelect) window.ClockSelect.syncAll();
}

/** 完整应用某风格的字体设置（CSS 变量 + 面板控件 + 槽位重测 + 字体加载），
    供风格切换与初始化使用 */
function applyFontSettings(style = state.style) {
  applyFontVars(style);
  syncFontPanel(style);
  // 字体/字号变化后重新测量数字槽位宽度
  scheduleDigitMeasure();
  // 异步确保所选字体可用（缓存优先，未命中才网络加载；失败静默回退系统字体）
  ensureFontLoaded(state.fonts[style]);
}

/* ---------- 命名空间导出 ---------- */
window.ClockStyle = { applyStyle, applyFontSettings, applyFontVars, applyAnalogScale };

})();
