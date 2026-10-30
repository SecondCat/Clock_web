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
let lastStackSig = '';

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
  // 仍锚定在秒数行顶上方，AM/PM 位置不变，实现秒数与 AM/PM 开关完全独立。
  // 所有 DOM 写入前先比对现值，值未变则跳过（避免无谓的样式失效与重排）
  const secondsHidden = !state.showSeconds;
  if (els.seconds.hidden !== secondsHidden) els.seconds.hidden = secondsHidden;
  if (state.showSeconds && s !== lastSecond) {
    lastSecond = s;
    renderDigits(els.seconds, pad(s));
  }

  // AM/PM：仅由 12 小时制 + 显示开关决定，不受秒数开关影响
  const ampmHidden = !(state.hourFormat === 12 && state.showAmpm);
  if (els.ampm.hidden !== ampmHidden) els.ampm.hidden = ampmHidden;
  if (state.hourFormat === 12 && els.ampm.textContent !== ampm) {
    els.ampm.textContent = ampm;
  }

  const dateStr = formatDate(now);
  if (els.dateDisplay.textContent !== dateStr) els.dateDisplay.textContent = dateStr;

  // 层叠顺序：全局从左到右 z-index 递减（最左在上、往右依次降低），
  // 负间距层叠时左侧字符始终盖住右侧字符（内部仅在位数变化时重算）
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

/** 信息条贴靠主视觉：计算主视觉（数字时间/表盘）底部位置写入 --main-bottom，
    CSS 中信息条 top = --main-bottom + --clock-gap，实现贴靠而非固定底部。
    - minimal/neon：贴数字时间底部
    - analog + 显示数字时间：贴数字时间底部
    - analog + 不显示数字时间：贴表盘底部
    由布局变化事件（风格/字号/开关/缩放/resize/字体加载）触发，不再逐帧计算 ——
    getBoundingClientRect 会强制同步布局，放在每秒轮询里代价过高。 */
let lastMainBottom = -1;

function layoutInfoBar() {
  const infoBar = els.infoBar;
  if (!infoBar) return;
  const td = els.timeDisplay;
  const ac = els.analogClock;
  // zoom 因子：getBoundingClientRect 返回视觉坐标（已含 CSS zoom 缩放），
  // 而 CSS top 是布局坐标（会被 zoom 再次缩放）→ 除以 zoom 因子回到布局坐标，
  // 保证信息栏在任意全局缩放下都精确贴靠主视觉、不溢出屏幕
  const zoom = (state.globalZoom || 100) / 100;
  let bottom = 0;
  if (state.style === 'analog') {
    if (state.analogDigital && td) {
      const r = td.getBoundingClientRect();
      if (r.height > 0) bottom = r.bottom / zoom;
    }
    if (!bottom && ac) bottom = ac.getBoundingClientRect().bottom / zoom;
  } else if (td) {
    bottom = td.getBoundingClientRect().bottom / zoom;
  }
  // 位置未变则不写 CSS 变量（避免触发样式重算）
  if (bottom > 0 && Math.abs(bottom - lastMainBottom) > 0.01) {
    lastMainBottom = bottom;
    els.root.style.setProperty('--main-bottom', `${bottom}px`);
  }
}

/** 合并同一帧内的多次布局请求，并在布局稳定后再测量（快速响应路径）。 */
let infoBarPending = false;
function scheduleLayoutInfoBar() {
  if (infoBarPending) return;
  infoBarPending = true;
  requestAnimationFrame(() => {
    setTimeout(() => {
      infoBarPending = false;
      layoutInfoBar();
    }, 0);
  });
}

/** 主视觉尺寸观察器：字号、表盘尺寸、视口、display 切换都会改变主视觉几何，
    ResizeObserver 在布局完成后触发，此时读取几何最准确。 */
let layoutObserver = null;
function setupLayoutObserver() {
  if (layoutObserver || typeof ResizeObserver === 'undefined') return;
  layoutObserver = new ResizeObserver(() => { layoutInfoBar(); });
  if (els.timeDisplay) layoutObserver.observe(els.timeDisplay);
  if (els.analogClock) layoutObserver.observe(els.analogClock);
}

/** 低频校验兜底：由 CSS 变量派生的布局（analog 下 .digital-container 的
    top: calc(...)、表盘尺寸 derive）可能比事件晚若干帧才生效，事件驱动那一次
    会读到中间态。这里以 500ms 为周期校验一次真实几何，仅在确有偏差时回写
    （layoutInfoBar 内部与 lastMainBottom 比较后才会写）。
    相比重构前每 250ms 无条件测量，调用频次由 4 次/秒降至 2 次/秒。 */
let layoutVerifyTimer = null;
function startLayoutVerify() {
  if (layoutVerifyTimer !== null) return;
  layoutVerifyTimer = setInterval(layoutInfoBar, 500);
}
function stopLayoutVerify() {
  if (layoutVerifyTimer !== null) {
    clearInterval(layoutVerifyTimer);
    layoutVerifyTimer = null;
  }
}

/** 强制刷新（重置秒缓存并立即渲染一次），供生命周期/校准联动使用 */
function forceRefresh() {
  lastSecond = -1;
  lastStackSig = '';
  lastMainBottom = -1; // 强制下次布局重新写入 --main-bottom
  tick();
  scheduleLayoutInfoBar();
}

/** 层叠顺序：按全局从左到右给每个数字槽位设置递减的 z-index。
    - 最左侧字符 z-index 最大（在上），往右依次降低，负间距叠压时左盖右；
    - 跨组（时/分/秒）同样生效 —— 前提是所有数字容器及 .seconds-wrapper
      都不得使用 transform / z-index（会创建层叠上下文，使子元素无法跨组比较）；
      本实现中各组仅用绝对定位 + margin 偏移，digit 的 z-index 直接参与
      .time-display 所在层叠上下文的排序。 */
function applyDigitStack() {
  const groups = [els.hours, els.minutes, els.seconds];
  // 位数签名：各组数字槽位数变化时才需重算 z-index（正常情况每秒最多变一次，
  // 多数分钟完全不变）——避免每秒重复写 6 次 style.zIndex
  let sig = '';
  for (const g of groups) sig += g ? g.children.length + ',' : '0,';
  if (sig === lastStackSig) return;
  lastStackSig = sig;

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

/** 实测数字槽位宽度用的 canvas 上下文（复用同一个，避免每次测量新建 canvas
    带来的额外 GPU 纹理分配与回收开销） */
let measureCtx = null;

function measureDigitWidthEm() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const ctx = measureCtx;
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
window.ClockRender = {
  tick,
  forceRefresh,
  applyDigitWidth,
  scheduleDigitMeasure,
  applyDigitStack,
  layoutInfoBar,
  scheduleLayoutInfoBar,
  setupLayoutObserver,
  startLayoutVerify,
  stopLayoutVerify,
};

})();
