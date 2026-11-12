/* ==========================================================================
   glow.js - 数字发光层
   职责：为 .time-display 创建三层发光副本（各自高斯模糊后叠加），
        主文字保持清晰锐利；文本逐位同步，未启用时不创建任何节点。
   为什么是「复制 + blur」而不是 text-shadow（实测依据见
   devtools/report-20261106-neon-vs-minimal.md 第 11–12 节）：
   - 发光不是每帧渲染：filter 只在图层失效时栅格化一次，秒变即每秒一次；
     真正要压的是这次失效的成本（4 层 text-shadow 10.3–11.4ms → 三层 blur 0.33–0.54ms）
   - 必须是三层：原霓虹的亮度集中在 0–15px（1px 处 ΔL 43.9、3px 32.0、
     12px 4.4、20px 0.3），单层/两层拟合不出这条陡衰减，会显得像「背景光」
   - 副本必须 translateZ(0) 升为独立合成层，否则每次都整层重绘（CSS 中已声明）
   依赖：dom.js（ClockDom.els）
   导出挂载到 window.ClockGlow
   ========================================================================== */
'use strict';

(() => {

const { els } = window.ClockDom;

const LAYER_CLASSES = ['d1', 'd2', 'd3'];
/** 需要与主文本保持一致的节点（按 class 在副本内定位） */
const SYNC_KEYS = ['hours', 'minutes', 'colon', 'ampm', 'seconds'];

let dups = [];     // 三层副本元素
let pairs = [];    // [主节点, 副本节点] 配对
let mode = 'off';  // 'on' | 'off'（2026-11-12 起只保留一档，开启即原强光参数）

/** 当前是否应当存在发光层 */
function shouldGlow() {
  return mode === 'on';
}

/** 递归同步文本与 hidden：逐节点先比对再写，避免无谓的样式失效
    （与 clock.js tick 的写前比较风格一致） */
function syncDeep(src, dst) {
  if (!src || !dst) return;
  if (dst.hidden !== src.hidden) dst.hidden = src.hidden;
  if (src.children.length === 0) {
    if (dst.textContent !== src.textContent) dst.textContent = src.textContent;
    return;
  }
  const n = Math.min(src.children.length, dst.children.length);
  for (let i = 0; i < n; i++) syncDeep(src.children[i], dst.children[i]);
}

function build() {
  const td = els.timeDisplay;
  if (!td) return;
  // 只取一次快照：否则第 2 层会把第 1 层一起拷进去、第 3 层再拷前两层，
  // 三层会叠成 6 份（首版预览踩过这个坑）
  const snap = td.innerHTML.replace(/id="[^"]*"/g, '');
  dups = LAYER_CLASSES.map((cls) => {
    const d = document.createElement('div');
    d.className = 'glow-dup ' + cls;
    d.setAttribute('aria-hidden', 'true');
    d.innerHTML = snap;
    td.appendChild(d);
    return d;
  });
  pairs = [];
  for (const dup of dups) {
    for (const key of SYNC_KEYS) {
      const src = els[key];
      const dst = dup.querySelector('.' + key);
      if (src && dst) pairs.push([src, dst]);
    }
  }
}

function destroy() {
  dups.forEach((d) => d.remove());
  dups = [];
  pairs = [];
}

/** 逐位同步（由 clock.js 的 tick 每 250ms 调用，内部先判断是否需要工作） */
function sync() {
  if (!dups.length || !shouldGlow()) return;
  // 主结构与副本结构因位数变化而不一致时重建（正常不会发生：时分秒恒为 2 位）
  const srcDigits = els.hours ? els.hours.children.length + els.minutes.children.length + els.seconds.children.length : 0;
  const dstDigits = dups[0] ? dups[0].querySelectorAll('.digit').length : 0;
  if (srcDigits !== dstDigits) {
    destroy();
    build();
  }
  for (let i = 0; i < pairs.length; i++) {
    const [src, dst] = pairs[i];
    if (!dst.isConnected) continue;
    syncDeep(src, dst);
  }
}

/** 应用开关：写 body[data-glow]（CSS 依据），按需创建/销毁副本
    兼容旧值：原 soft / strong 两档都归一为 on（2026-11-12 合并为单档）
    @param {string} next 'on' | 'off'
    @returns {string} 实际生效的档位 */
function apply(next) {
  mode = next === 'on' || next === 'soft' || next === 'strong' ? 'on' : 'off';
  document.body.dataset.glow = mode;
  // 同步设置面板开关（单向 状态 → 视图）：代码里直接调 apply 时，
  // 控件显示必须跟着变，否则会出现「开关是开、实际已关」的幽灵状态
  const toggle = document.getElementById('glow-toggle');
  if (toggle) toggle.checked = mode === 'on';
  if (shouldGlow()) {
    if (!dups.length) build();
    sync();
  } else {
    destroy();
  }
  return mode;
}

/** 外部条件变化后重新评估（保留入口，供开关联动复用） */
function refresh() {
  return apply(mode);
}

function setup(initial) {
  return apply(initial || 'off');
}

/* ---------- 命名空间导出 ---------- */
window.ClockGlow = {
  setup,
  apply,
  refresh,
  sync,
  get mode() { return mode; },
  get layerCount() { return dups.length; },
};

})();
