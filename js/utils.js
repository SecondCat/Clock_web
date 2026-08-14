/* ==========================================================================
   utils.js - 通用工具（DOM 查询、补零、网络请求信号管理、日期格式化）
   经典脚本模式：导出挂载到 window.ClockUtils（依赖顺序最先加载）
   ========================================================================== */
'use strict';

(() => {

/** document.querySelector 简写 */
function $(sel) {
  return document.querySelector(sel);
}

/** 两位数补零 */
function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/* ---------- 网络请求中断管理 ---------- */

// 跟踪所有进行中的请求信号，页面退出时统一中断
const pendingAborters = new Set();

function trackAbort(signal) {
  pendingAborters.add(signal);
  signal.addEventListener('abort', () => pendingAborters.delete(signal), { once: true });
}

/** AbortSignal.timeout 的兼容封装（超时自动中断，且纳入统一管理） */
function withTimeout(ms) {
  try {
    const signal = AbortSignal.timeout(ms);
    trackAbort(signal);
    return signal;
  } catch (e) {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    trackAbort(ctrl.signal);
    return ctrl.signal;
  }
}

/** 中断所有进行中的网络请求（天气/地理编码等） */
function abortPendingRequests() {
  pendingAborters.forEach((signal) => {
    try { signal.abort(); } catch (e) { /* 忽略 */ }
  });
  pendingAborters.clear();
}

/* ---------- 日期格式化 ---------- */

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function formatDate(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}

/* ---------- 命名空间导出 ---------- */
window.ClockUtils = { $, pad, withTimeout, abortPendingRequests, formatDate };

})();
