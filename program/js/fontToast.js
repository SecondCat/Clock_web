/* ==========================================================================
   fontToast.js - 字体加载状态提示
   监听 fonts.js 派发的 clock:font-status 事件，驱动 #font-toast 显示/隐藏：
   - loading  → 网络加载中：显示「正在加载字体…」（CSS 圆环 spinner）
   - loaded   → 不提示加载完成；仅检测字体是否实际生效，
                若页面未自动更新则显示「手动刷新」按钮供用户操作
   - failed   → 显示「加载失败，已回退系统字体」短暂提示后隐藏
   本地缓存命中时全程静默（fonts.js 不派发 loading，loaded 亦不提示完成）。
   经典脚本模式：依赖 utils.js（ClockUtils，需先加载）
   导出挂载到 window.ClockFontToast
   ========================================================================== */
'use strict';

(() => {

const { $ } = window.ClockUtils;

let hideTimer = null;   // 自动隐藏计时器
let checkTimer = null;  // 字体生效检测计时器
let activeFamily = null; // 当前活动的字体族（防止异步检测覆盖新状态）

/** 隐藏 toast（清空全部计时器与状态） */
function hideToast() {
  clearTimeout(hideTimer);
  clearTimeout(checkTimer);
  hideTimer = null;
  checkTimer = null;
  const toast = $('#font-toast');
  if (toast && !toast.hidden) toast.hidden = true;
}

/** 各状态对应的图标（loading 留空，由 CSS data-status=loading 渲染圆环 spinner） */
const STATUS_ICONS = { loaded: '✓', failed: '⚠', loading: '' };

/**
 * 显示 toast
 * @param {string} status  'loading' | 'loaded' | 'failed'（写入 data-status 控制图标形态）
 * @param {string} text    提示文案
 * @param {object} opts    { refreshBtn: 是否显示手动刷新按钮, autoHide: 自动隐藏毫秒数(0=不隐藏) }
 */
function showToast(status, text, { refreshBtn = false, autoHide = 0 } = {}) {
  clearTimeout(hideTimer);
  clearTimeout(checkTimer);
  hideTimer = null;
  checkTimer = null;

  const toast = $('#font-toast');
  if (!toast) return;
  toast.dataset.status = status;
  $('#font-toast-icon').textContent = STATUS_ICONS[status] || '';
  $('#font-toast-text').textContent = text;
  $('#font-toast-refresh').hidden = !refreshBtn;
  toast.hidden = false;

  if (autoHide > 0) hideTimer = setTimeout(hideToast, autoHide);
}

/** 检测字体是否已被浏览器实际应用（document.fonts.check 轮询，超时判定未生效） */
async function ensureFontApplied(family, timeout = 6000) {
  if (!document.fonts || typeof document.fonts.check !== 'function') return true;
  const weight = (getComputedStyle(document.documentElement)
    .getPropertyValue('--clock-font-weight') || '400').trim();
  const probe = `${weight} 16px "${family}"`;
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (document.fonts.check(probe)) return true;
    } catch (e) { /* 个别浏览器对未加载字体抛异常，忽略继续轮询 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** 绑定字体加载状态事件（由 main.js 在 DOM 就绪后调用） */
function setupFontToast() {
  const refreshBtn = $('#font-toast-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => window.location.reload());

  window.addEventListener('clock:font-status', (e) => {
    const { status, family } = e.detail || {};
    if (!family) return;

    if (status === 'loading') {
      // 网络加载中：spinner（图标由 CSS data-status=loading 渲染圆环；
      // 本地缓存命中路径不派发 loading，见 fonts.js）
      activeFamily = family;
      showToast('loading', `正在加载字体「${family}」…`);
    } else if (status === 'loaded') {
      // 加载完成：不提示完成信息，直接收起「网络加载中」提示；
      // 随后检测字体是否实际生效，若页面未自动更新则提供手动刷新按钮
      activeFamily = family;
      hideToast();
      // 延迟检测（给浏览器留出应用新字体的时间）；若期间切换了字体则放弃
      checkTimer = setTimeout(async () => {
        if (activeFamily !== family) return;
        const applied = await ensureFontApplied(family);
        if (activeFamily !== family) return;
        if (!applied) {
          // 字体数据已就绪但页面未自动更新 → 提供手动刷新按钮（不自动隐藏）
          showToast('loaded', `字体「${family}」已加载，但页面未自动更新`, { refreshBtn: true });
        }
      }, 600);
    } else if (status === 'failed') {
      activeFamily = family;
      showToast('failed', `字体「${family}」下载失败，已回退系统字体`, { autoHide: 3000 });
    }
  });
}

/* ---------- 命名空间导出 ---------- */
window.ClockFontToast = { setupFontToast };

})();
