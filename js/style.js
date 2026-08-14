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
}

/** 将表盘尺寸缩放系数（state.analogScale，百分比）应用到 --analog-scale（数字 0.5-2），
    并同步滑动条与数值显示（供 applyStyle 初始化与滑动条事件复用） */
function applyAnalogScale() {
  const scale = state.analogScale || 100;
  document.documentElement.style.setProperty('--analog-scale', String(scale / 100));
  const slider = $('#analog-scale-slider');
  if (slider) slider.value = String(scale);
  const val = $('#analog-scale-value');
  if (val) val.textContent = `${scale}%`;
}

/** 将指定风格的字体/字号/字重写入 CSS 变量，并同步设置面板控件 */
function applyFontSettings(style = state.style) {
  const cfg = STYLE_CONFIGS[style];
  const font = state.fonts[style];
  const size = state.sizes[style];
  const weight = state.weights[style];

  document.documentElement.style.setProperty('--clock-font', font);
  // 字号设到根上，CSS 里用 clamp 与 var 组合做响应式
  document.documentElement.style.setProperty('--clock-font-size', `${size}px`);
  // 字重同样设到根上，由 .time-display 的 var 引用
  document.documentElement.style.setProperty('--clock-font-weight', weight);

  // 刷新设置面板中的字体选项（所有风格共用同一份全字体列表）
  const select = $('#font-family-select');
  select.innerHTML = '';
  let matched = false;
  ALL_FONTS.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.value;
    opt.textContent = f.label;
    if (f.value === font) { opt.selected = true; matched = true; }
    select.appendChild(opt);
  });
  // 当前保存的字体不在内置列表中（如旧版本遗留的本地字体）→ 回退默认并保存
  if (!matched) {
    state.fonts[style] = cfg.defaultFont;
    saveState();
    select.value = cfg.defaultFont;
    document.documentElement.style.setProperty('--clock-font', cfg.defaultFont);
  }

  const slider = $('#font-size-slider');
  slider.min = cfg.minSize;
  slider.max = cfg.maxSize;
  slider.value = size;

  const weightSlider = $('#font-weight-slider');
  weightSlider.value = weight;

  // 数字间距（按风格独立，em；负值=字符层叠），写入根变量供 .digit/.hours/.minutes 使用
  const gap = typeof state.digitGaps[style] === 'number' ? state.digitGaps[style] : 0;
  document.documentElement.style.setProperty('--clock-digit-gap', `${gap}em`);
  const gapSlider = $('#digit-gap-slider');
  if (gapSlider) gapSlider.value = String(gap);

  // 冒号间距：由数字间距联动派生（合并为单一滑块，不再单独存储），方向与数字
  // 间距一致 —— 数字拉开（gap 增大）时冒号同步外移，保持整体比例协调；
  // 数字层叠（gap 为负）时冒号收敛至下限。clamp 下限 0.2em 已考虑冒号自身
  // 宽度，保证冒号右缘与数字左缘始终有正间隙、永不被覆盖；上限 0.6em 防止
  // 极端值下冒号偏离过远。
  const colonGap = Math.min(0.6, Math.max(0.2, 0.3 + gap * 0.25));
  document.documentElement.style.setProperty('--clock-colon-gap', `${colonGap}em`);

  $('#current-style-label').textContent = `（${cfg.label}）`;

  // 字体/字号变化后重新测量数字槽位宽度
  scheduleDigitMeasure();

  // 异步确保所选字体可用（缓存优先，未命中才网络加载；失败静默回退系统字体）
  ensureFontLoaded(font);
}

/* ---------- 命名空间导出 ---------- */
window.ClockStyle = { applyStyle, applyFontSettings, applyAnalogScale };

})();
