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

/** 超时自动中断信号封装（统一用 AbortController，不用 AbortSignal.timeout ——
    后者 Chrome 103+ 才支持，且部分定制内核浏览器（如小米浏览器）存在实现 bug
    会立即 abort 导致 fetch 失败）。旧浏览器连 AbortController 都没有时返回
    undefined（fetch 不带 signal、无超时但可正常工作） */
function withTimeout(ms) {
  if (typeof AbortController === 'undefined') return undefined;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  trackAbort(ctrl.signal);
  return ctrl.signal;
}

/** 带超时的 fetch：优先带 signal；若因 signal/AbortController 兼容问题（定制内核
    浏览器，如小米浏览器）导致失败，自动重试一次不带 signal（无超时），
    最大程度兼容旧/定制内核浏览器 */
function fetchWithTimeout(url, options, ms) {
  const signal = withTimeout(ms);
  const doFetch = (withSig) => {
    const opts = withSig && signal
      ? Object.assign({}, options || {}, { signal })
      : (options || {});
    return fetch(url, opts);
  };
  return doFetch(true).catch((err) => {
    if (signal) return doFetch(false); // 带 signal 失败 → 重试一次不带 signal
    throw err;
  });
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
window.ClockUtils = { $, pad, withTimeout, fetchWithTimeout, abortPendingRequests, formatDate };

})();
