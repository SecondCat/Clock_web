/* ==========================================================================
   fullscreen.js - 全屏保持守卫
   职责：用户进入全屏后，若退出全屏（如浏览器/系统/切换标签页等非本页发起的
        退出），则显示横幅提示，并在 5 秒后尝试自动恢复全屏；用户点击「取消」
        或再按一次 Esc 可放弃恢复。点击本页「退出全屏」按钮则完全静默。
   兼容性说明：
   - Chrome 在全屏状态下按 Esc 退出时**不向页面派发 keydown/keyup**，也无法
     通过 API 区分「用户 Esc」与「浏览器退出」，故按「可取消的自动恢复」设计：
     横幅出现在 5 秒内，Esc / 取消 / 立即恢复三个出口都在横幅上。
   - 浏览器要求全屏调用必须有用户手势；无手势时自动恢复会被拒绝，此时横幅
     转为「点击恢复」态，并在下一次点击/按键时重试。
   依赖：无（仅使用浏览器 Fullscreen API）
   导出挂载到 window.ClockFullscreen
   ========================================================================== */
'use strict';

(() => {

const RESUME_DELAY = 5000;  // 意外退出后自动恢复的等待时间（毫秒）
const ESC_WINDOW = 1500;    // 判定「用户按 Esc 主动退出」的时间窗（毫秒）
const RETRY_SETTLE = 260;   // 请求全屏后等待状态落定的时间（毫秒）

let countdownTimer = null;  // 1 秒步进的倒计时定时器
let remain = 0;             // 剩余秒数
let wasFullscreen = false;  // 是否曾进入过全屏（用于区分「从未全屏」与「退出全屏」）
let intentional = false;    // 本次退出是否由用户主动触发
let lastEscAt = 0;          // 最近一次 Esc 按下的时间戳
let blocked = false;        // 自动恢复被浏览器拒绝（缺少用户手势）
let banner = null;          // 横幅根节点
let prefixEl = null;        // 文案前缀
let countEl = null;         // 倒计时数字
let suffixEl = null;        // 文案后缀
let nowBtn = null;          // 「立即恢复」按钮
let cancelBtn = null;       // 「取消」按钮
let gestureHandler = null;  // 阻塞态下等待下一次用户手势的监听器

/** 当前是否处于全屏（兼容各前缀实现） */
function isFullscreen() {
  return !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.msFullscreenElement ||
            document.mozFullScreenElement);
}

/** 请求全屏，统一成 Promise（旧实现没有返回值时用状态轮询兜底） */
function requestFullscreen() {
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (!fn) return Promise.reject(new Error('fullscreen unsupported'));
  try {
    const ret = fn.call(el);
    if (ret && typeof ret.then === 'function') return ret;
    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

/** 退出全屏（document 级 API） */
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
  if (!fn) return Promise.resolve();
  try {
    const ret = fn.call(document);
    return (ret && typeof ret.then === 'function') ? ret : Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}

/* ---------- 横幅 ---------- */

function buildBanner() {
  if (banner) return;

  banner = document.createElement('div');
  banner.className = 'fs-guard';
  banner.id = 'fs-guard';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.hidden = true;

  const icon = document.createElement('span');
  icon.className = 'fs-guard-icon';
  icon.textContent = '⛶';

  const text = document.createElement('span');
  text.className = 'fs-guard-text';
  prefixEl = document.createElement('span');
  prefixEl.textContent = '意外退出全屏，';
  countEl = document.createElement('b');
  countEl.className = 'fs-guard-count';
  suffixEl = document.createElement('span');
  suffixEl.textContent = ' 秒后自动恢复';
  text.appendChild(prefixEl);
  text.appendChild(countEl);
  text.appendChild(suffixEl);

  nowBtn = document.createElement('button');
  nowBtn.type = 'button';
  nowBtn.className = 'fs-guard-btn';
  nowBtn.textContent = '立即恢复';
  nowBtn.addEventListener('click', () => {
    unbindGesture();
    attemptResume();
  });

  cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'fs-guard-btn fs-guard-cancel';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', cancel);

  banner.appendChild(icon);
  banner.appendChild(text);
  banner.appendChild(nowBtn);
  banner.appendChild(cancelBtn);
  document.body.appendChild(banner);
}

/** 正常倒计时态（数字 + 自动恢复文案） */
function renderCountdown() {
  prefixEl.textContent = '已退出全屏，';
  prefixEl.hidden = false;
  suffixEl.textContent = ' 秒后自动恢复（Esc 取消）';
  suffixEl.hidden = false;
  countEl.hidden = false;
  countEl.textContent = String(remain);
  nowBtn.textContent = '立即恢复';
}

/** 浏览器拒绝自动恢复后：改为「点击恢复」态 */
function renderBlocked() {
  prefixEl.textContent = '浏览器不允许自动恢复全屏，点击「恢复全屏」继续';
  prefixEl.hidden = false;
  countEl.hidden = true;
  suffixEl.hidden = true;
  nowBtn.textContent = '恢复全屏';
}

function showBanner() {
  buildBanner();
  banner.hidden = false;
}

function hideBanner() {
  if (!banner) return;
  banner.hidden = true;
  prefixEl.textContent = '已退出全屏，';
  prefixEl.hidden = false;
  suffixEl.textContent = ' 秒后自动恢复（Esc 取消）';
  suffixEl.hidden = false;
  countEl.hidden = false;
  nowBtn.textContent = '立即恢复';
}

/* ---------- 倒计时与恢复 ---------- */

function stopTimers() {
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function clearState() {
  stopTimers();
  blocked = false;
  remain = 0;
  unbindGesture();
}

function cancel() {
  clearState();
  hideBanner();
}

function startCountdown() {
  clearState();
  remain = Math.round(RESUME_DELAY / 1000);
  showBanner();
  renderCountdown();

  countdownTimer = setInterval(() => {
    remain -= 1;
    if (remain > 0) {
      renderCountdown();
      return;
    }
    stopTimers();
    attemptResume();
  }, 1000);
}

/** 尝试恢复全屏；被浏览器拒绝（无用户手势）时转为「点击恢复」态 */
function attemptResume() {
  stopTimers();
  if (isFullscreen()) {
    clearState();
    hideBanner();
    return;
  }
  requestFullscreen().then(() => {
    setTimeout(() => {
      if (isFullscreen()) {
        clearState();
        hideBanner();
      } else {
        onBlocked();
      }
    }, RETRY_SETTLE);
  }, () => {
    onBlocked();
  });
}

function onBlocked() {
  blocked = true;
  showBanner();
  renderBlocked();
  bindGesture();
}

/** 阻塞态：等待任意一次用户手势后重试（浏览器要求全屏调用必须由手势触发） */
function bindGesture() {
  if (gestureHandler) return;
  gestureHandler = (e) => {
    // 横幅内的按钮有自己的处理逻辑，避免重复触发
    if (banner && banner.contains(e.target)) return;
    unbindGesture();
    if (blocked) attemptResume();
  };
  document.addEventListener('pointerdown', gestureHandler, true);
  document.addEventListener('keydown', gestureHandler, true);
}

function unbindGesture() {
  if (!gestureHandler) return;
  document.removeEventListener('pointerdown', gestureHandler, true);
  document.removeEventListener('keydown', gestureHandler, true);
  gestureHandler = null;
}

/* ---------- 事件 ---------- */

function onFullscreenChange() {
  const fs = isFullscreen();
  if (fs) {
    wasFullscreen = true;
    intentional = false;
    cancel();
    return;
  }
  if (!wasFullscreen) return; // 从未进入全屏（例如首次加载时的事件）不处理
  wasFullscreen = false;

  const byUser = intentional || (Date.now() - lastEscAt < ESC_WINDOW);
  intentional = false;
  if (byUser) {
    cancel();
    return;
  }
  startCountdown();
}

function onKeydown(e) {
  const isEsc = e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27;
  if (!isEsc) return;
  lastEscAt = Date.now();
  // 横幅可见时按 Esc = 明确拒绝恢复
  if (banner && !banner.hidden) cancel();
}

/* ---------- 对外接口 ---------- */

/** 进入/退出全屏（供设置面板按钮调用；主动退出不会触发自动恢复） */
function toggle() {
  if (isFullscreen()) {
    intentional = true;
    exitFullscreen().catch(() => {});
    return;
  }
  requestFullscreen().catch(() => {});
}

function setup() {
  if (setup.done) return;
  setup.done = true;
  // 若页面加载时已处于全屏（例如被浏览器以全屏方式打开），先记录初始状态，
  // 否则之后的第一次「退出全屏」不会被识别为「曾进入全屏」
  wasFullscreen = isFullscreen();
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', onKeydown, true);
  // 退出页面时释放定时器与监听，避免后台残留
  window.addEventListener('pagehide', clearState);
  // 切回前台时若倒计时已走完（后台定时器被节流），立即补一次恢复
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && banner && !banner.hidden && !blocked && remain <= 1) {
      attemptResume();
    }
  });
}

window.ClockFullscreen = {
  setup,
  toggle,
  isFullscreen,
  cancel,
  // 调试只读接口（供探针/测试观察状态，不改变行为）
  get state() {
    return {
      wasFullscreen,
      bannerVisible: !!(banner && !banner.hidden),
      blocked,
      remain,
      active: isFullscreen(),
    };
  },
};

})();
