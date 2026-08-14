/* ==========================================================================
   clock.js - 数字时钟渲染（逐位 tick、数字槽位宽度测量）
   经典脚本模式：依赖 utils.js（ClockUtils）、dom.js（ClockDom）、state.js（ClockState）、
   timeSync.js（ClockTime）、theme.js（ClockTheme，需先加载）
   导出挂载到 window.ClockRender
   ========================================================================== */
'use strict';

(() => {

const { pad, $, formatDate } = window.ClockUtils;
const { els } = window.ClockDom;
const { state } = window.ClockState;
const { nowMs } = window.ClockTime;
const { applyAutoTheme } = window.ClockTheme;

/* ---------- 渲染内部状态 ---------- */
let lastSecond = -1;
let lastThemeCheckMinute = -1;

/** 将字符串逐位写入元素下的 <span class="digit">（位数不足自动补建，值不变不重写） */
function renderDigits(el, str) {
  while (el.children.length < str.length) {
    const d = document.createElement('span');
    d.className = 'digit';
    el.appendChild(d);
  }
  for (let i = 0; i < str.length; i++) {
    const d = el.children[i];
    if (d.textContent !== str[i]) d.textContent = str[i];
  }
}

/** 主渲染循环：每 250ms 调用一次（由生命周期模块的 setInterval 驱动） */
function tick() {
  const now = new Date(nowMs());
  const s = now.getSeconds();

  let hours = now.getHours();
  let ampm = '';

  if (state.hourFormat === 12) {
    ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
  }

  renderDigits(els.hours, pad(hours));
  renderDigits(els.minutes, pad(now.getMinutes()));

  // 秒数显示开关：关闭时只隐藏 .seconds（block 元素），保留 .seconds-wrapper
  // 作为 AM/PM 的定位包含块 —— wrapper 高度归零后 AM/PM 的 bottom:calc(100%+0.18em)
  // 仍锚定在秒数行顶上方，AM/PM 位置不变，实现秒数与 AM/PM 开关完全独立
  els.seconds.hidden = !state.showSeconds;
  if (state.showSeconds && s !== lastSecond) {
    lastSecond = s;
    renderDigits(els.seconds, pad(s));
  }

  // AM/PM：仅由 12 小时制 + 显示开关决定，不受秒数开关影响
  els.ampm.hidden = !(state.hourFormat === 12 && state.showAmpm);
  if (state.hourFormat === 12) {
    els.ampm.textContent = ampm;
  }

  els.dateDisplay.textContent = formatDate(now);

  // 层叠顺序：全局从左到右 z-index 递减（最左在上、往右依次降低），
  // 负间距层叠时左侧字符始终盖住右侧字符
  applyDigitStack();

  // 自动主题：每分钟检查一次即可（秒变化不影响主题）
  if (state.themeMode === 'auto') {
    const minKey = now.getHours() * 60 + now.getMinutes();
    if (minKey !== lastThemeCheckMinute) {
      lastThemeCheckMinute = minKey;
      applyAutoTheme(now);
    }
  }
}

/** 强制刷新（重置秒缓存并立即渲染一次），供生命周期/校准联动使用 */
function forceRefresh() {
  lastSecond = -1;
  tick();
}

/** 层叠顺序：按全局从左到右给每个数字槽位设置递减的 z-index。
    - 最左侧字符 z-index 最大（在上），往右依次降低，负间距叠压时左盖右；
    - 跨组（时/分/秒）同样生效 —— 前提是所有数字容器及 .seconds-wrapper
      都不得使用 transform / z-index（会创建层叠上下文，使子元素无法跨组比较）；
      本实现中各组仅用绝对定位 + margin 偏移，digit 的 z-index 直接参与
      .time-display 所在层叠上下文的排序。 */
function applyDigitStack() {
  const groups = [els.hours, els.minutes, els.seconds];
  let total = 0;
  for (const g of groups) if (g) total += g.children.length;
  let idx = 0;
  for (const g of groups) {
    if (!g) continue;
    for (let i = 0; i < g.children.length; i++) {
      g.children[i].style.zIndex = String(total - idx);
      idx++;
    }
  }
}

/* --------------------------------------------------------------------------
   数字槽位宽度
   - 每个数字是独立 <span class="digit"> + 固定宽度槽位（text-align:center），
     任意非等宽字体下数字位置恒定、互不干扰；
   - 宽度 = 当前字体实测最宽数字 + 12% 缓冲，以 em 为单位（相对自身字号），
     主显示与秒显示字重不同需分别测量，取最大值；
   - 测量时机：字体加载完成后 / 字体或字号变化 / 窗口 resize。
   -------------------------------------------------------------------------- */

function measureDigitWidthEm() {
  const ctx = document.createElement('canvas').getContext('2d');
  let maxEm = 0.62; // 兜底值（JS 未运行时 CSS var 也使用该值）
  const probe = (el) => {
    if (!el) return;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    if (!size) return;
    ctx.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    let maxPx = 0;
    for (let i = 0; i <= 9; i++) {
      maxPx = Math.max(maxPx, ctx.measureText(String(i)).width);
    }
    maxEm = Math.max(maxEm, (maxPx / size) * 1.12);
  };
  probe(document.querySelector('.time-display'));
  probe(document.querySelector('.seconds'));
  return maxEm;
}

/** 将测量结果写入 CSS 变量 --clock-digit-width */
function applyDigitWidth() {
  document.documentElement.style.setProperty('--clock-digit-width', `${measureDigitWidthEm()}em`);
}

let digitMeasureTimer = null;

/** 防抖调度：字体/字号/字重变化后延迟重测槽位宽度 */
function scheduleDigitMeasure() {
  clearTimeout(digitMeasureTimer);
  digitMeasureTimer = setTimeout(applyDigitWidth, 60);
}

// 时间校准完成后按新时间立即刷新数字显示
window.addEventListener('clock:time-adjusted', forceRefresh);

/* ---------- 命名空间导出 ---------- */
window.ClockRender = { tick, forceRefresh, applyDigitWidth, scheduleDigitMeasure, applyDigitStack };

})();
