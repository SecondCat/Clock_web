/* ==========================================================================
   glow.js - 数字发光层
   职责：为主数字（时/分/冒号）与次要单元（秒数 + AM/PM）分别创建三层发光副本
        （各自高斯模糊后叠加），主文字保持清晰锐利；文本逐位同步，
        未启用时不创建任何节点。
   为什么是「复制 + blur」而不是 text-shadow（实测依据见
   devtools/report-20261106-neon-vs-minimal.md 第 11–12 节）：
   - 发光不是每帧渲染：filter 只在图层失效时栅格化一次，秒变即每秒一次；
     真正要压的是这次失效的成本（4 层 text-shadow 10.3–11.4ms → 三层 blur 0.33–0.54ms）
   - 必须是三层：原霓虹的亮度集中在 0–15px（1px 处 ΔL 43.9、3px 32.0、
     12px 4.4、20px 0.3），单层/两层拟合不出这条陡衰减，会显得像「背景光」
   为什么分两组（2026-11-12 用户反馈「秒数光晕与分数光晕之间撕裂」）：
   - 模糊半径用 em 表达，em 取的是 .time-display 的主字号；秒数只有
     --seconds-scale（默认 0.28）倍主字号，若沿用同一绝对半径，其光晕相对
     自身字号被放大 3.6 倍 —— 表现为一团糊光，与主数字锐利的管状光晕质感不同，
     两段光晕在交界处因此出现可见断层。次要单元单独成组后，半径按
     同一比例缩小，整屏光晕质感一致（CSS 见 styles.css §9.2）。
   只在深色模式生效（2026-11-13）：浅色底上光晕发灰发脏，用户要求浅色不发光。
   本模块不判断主题——始终按开关建/销副本，显示与否由 CSS
   （body[data-glow="on"][data-theme="dark"] .glow-dup）决定，
   这样切主题不需要重建节点、切回深色即刻恢复。
   依赖：dom.js（ClockDom.els）
   导出挂载到 window.ClockGlow
   ========================================================================== */
'use strict';

(() => {

const { els } = window.ClockDom;

const LAYER_CLASSES = ['d1', 'd2', 'd3'];

/** 发光分组：main = 主字号数字；sub = 秒数 + AM/PM（按 --seconds-scale 缩放半径） */
const SETS = [
  { name: 'main', keys: ['hours', 'minutes', 'colon'] },
  { name: 'sub', keys: ['ampm', 'seconds'] },
];

let dups = [];     // 两组 × 三层副本
let pairs = [];    // [主节点, 副本节点] 配对
let mode = 'off';  // 'on' | 'off'（2026-11-12 起只保留一档，开启即原强光参数）

/** 当前是否应当存在发光层 */
function shouldGlow() {
  return mode === 'on';
}

/** 去掉 id：副本若带 id，主文档会出现重复 id（首版踩过，querySelector 会命中副本） */
function stripIds(node) {
  if (node.id) node.removeAttribute('id');
  node.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
  return node;
}

/** 去掉副本里的内联 z-index（来自 applyDigitStack 的快照）。
    副本整体只有一种颜色、且被同一层模糊，数字之间不存在层叠需求；
    带 z-index 的定位子元素会在模糊层内部形成独立层叠上下文，
    合成器可能把它们拆成多个绘制块分别栅格化，块与块之间就会出现接缝
    （2026-11-12「数字之间光晕撕裂」的结构成因之一）。 */
function stripInlineStacking(node) {
  node.querySelectorAll('[style]').forEach((n) => {
    n.style.removeProperty('z-index');
    if (!n.getAttribute('style')) n.removeAttribute('style');
  });
}

/** 生成某一组的副本 HTML
    - main：整条时间串去掉秒数单元（秒数由 sub 组负责，避免被主半径二次模糊）
    - sub ：只复制 .seconds-wrapper（含 AM/PM），其绝对定位相对副本容器求值，
            与主文档中的位置一致 */
function templateFor(name) {
  if (name === 'sub') {
    const wrapper = els.secondsWrapper;
    if (!wrapper) return '';
    const node = stripIds(wrapper.cloneNode(true));
    stripInlineStacking(node);
    return node.outerHTML;
  }
  const td = els.timeDisplay;
  if (!td) return '';
  const box = stripIds(td.cloneNode(true));
  const sec = box.querySelector('.seconds-wrapper');
  if (sec) sec.remove();
  stripInlineStacking(box);
  return box.innerHTML;
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
  destroy();
  const td = els.timeDisplay;
  if (!td) return;
  for (const set of SETS) {
    // 每组只生成一次快照，供该组三层共用（避免第 2 层把第 1 层一起拷进去）
    const html = templateFor(set.name);
    if (!html) continue;
    for (const cls of LAYER_CLASSES) {
      const d = document.createElement('div');
      d.className = `glow-dup ${set.name} ${cls}`;
      d.setAttribute('aria-hidden', 'true');
      d.innerHTML = html;
      td.appendChild(d);
      dups.push(d);
      for (const key of set.keys) {
        const src = els[key];
        const dst = d.querySelector('.' + key);
        if (src && dst) pairs.push([src, dst]);
      }
    }
  }
}

function destroy() {
  dups.forEach((d) => d.remove());
  dups = [];
  pairs = [];
}

/** 主结构与副本结构因位数变化而不一致时需要重建
    （正常不会发生：时分秒恒为 2 位；小时 24 小时制首位可能为 0 位，由 CSS 控制） */
function needsRebuild() {
  const main = dups.find((d) => d.classList.contains('main'));
  const sub = dups.find((d) => d.classList.contains('sub'));
  if (!main || !sub) return true;
  const wantMain = (els.hours ? els.hours.children.length : 0)
    + (els.minutes ? els.minutes.children.length : 0);
  const wantSub = els.seconds ? els.seconds.children.length : 0;
  return main.querySelectorAll('.digit').length !== wantMain
    || sub.querySelectorAll('.digit').length !== wantSub;
}

/** 逐位同步（由 clock.js 的 tick 每 250ms 调用，内部先判断是否需要工作） */
function sync() {
  if (!dups.length || !shouldGlow()) return;
  if (needsRebuild()) build();
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
