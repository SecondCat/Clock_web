/* ==========================================================================
   perf.js - 渲染能力探测与降级开关
   职责：在任何绘制之前决定渲染档位，写入 <html data-perf="lite|full">。
   背景（2026-11-06）：低内存设备 + Firefox 出现黑块、残影（合成器丢 tile）。
   成因是「全屏发光大字 + 4 层最大 120px 模糊的 text-shadow + 每 500ms 强制
   重绘 + 全屏光斑动画」叠加，软件合成时栅格化压力过大。轻量档会关掉这些。
   判定：
   - Firefox：UA 或 CSS.supports('-moz-appearance')（不依赖 UA 也可识别）
   - 低内存：navigator.deviceMemory ≤ 4（Chrome/Edge）或
             hardwareConcurrency ≤ 4（Firefox 无 deviceMemory，用核心数近似）
   - 手动覆盖：URL 加 ?perf=lite 或 ?perf=full（便于在设备上直接对照验证）
   导出挂载到 window.ClockPerf
   ========================================================================== */
'use strict';

(() => {

const ua = navigator.userAgent || '';
const isFirefox = /firefox|fxios/i.test(ua) ||
  (typeof CSS !== 'undefined' && CSS.supports && CSS.supports('-moz-appearance', 'none'));
const deviceMemory = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : 0;
const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : 0;
const lowMemory = (deviceMemory > 0 && deviceMemory <= 4) || (cores > 0 && cores <= 4);

const autoMode = (isFirefox && lowMemory) ? 'lite' : 'full';
const overrideMatch = /[?&]perf=(lite|full)\b/.exec(location.search);
const urlMode = overrideMatch ? overrideMatch[1] : '';

let current = '';

/** 应用档位：优先级 用户偏好（state.perfMode）> URL 参数 > 自动判定
    @param {string} [pref] ''=跟随自动 | 'lite' | 'full'
    @returns {string} 实际生效的档位 */
function apply(pref) {
  const mode = pref === 'lite' || pref === 'full' ? pref : (urlMode || autoMode);
  current = mode;
  document.documentElement.setAttribute('data-perf', mode);
  return mode;
}

// 首屏先按 URL / 自动判定落一档，避免等到 state 载入才生效（闪烁）
apply('');

window.ClockPerf = {
  isFirefox,
  deviceMemory,
  cores,
  lowMemory,
  autoMode,
  urlMode,
  apply,
  get mode() { return current; },
};

})();
