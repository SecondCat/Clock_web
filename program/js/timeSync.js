/* ==========================================================================
   timeSync.js - 网络时间自动校准（对齐 time.is 等 NTP 时钟）
   经典脚本模式：依赖 config.js（ClockConfig）、utils.js（ClockUtils，需先加载）
   解耦约定：校准成功后仅派发 window 自定义事件 'clock:time-adjusted'，
   由各显示模块（clock/analogClock）自行监听刷新，本模块不依赖任何渲染模块。
   注意：timeOffset/syncState/lastSyncAt 为模块内可变变量，外部一律通过
   nowMs() / getSyncStatus() 读取，避免命名空间快照失效。
   导出挂载到 window.ClockTime
   ========================================================================== */
'use strict';

(() => {

const { fetchWithTimeout, $ } = window.ClockUtils;
const { MAX_SYNC_JUMP } = window.ClockConfig;

/* ---------- 校准状态 ---------- */
let timeOffset = 0;        // 本地时钟与网络时间的偏移（毫秒）：Date.now() + timeOffset = 真实时间
let syncState = 'pending'; // pending | syncing | synced | error | off
let lastSyncAt = 0;        // 最近一次成功校准的时刻（本地时间）
let syncEnabled = true;    // 自动校准开关：false 时始终使用本地系统时间（timeOffset 归零）

/** 校准后的当前时间戳（毫秒）：所有时钟显示都应基于它，而非裸 Date.now() */
function nowMs() {
  return Date.now() + timeOffset;
}

/** 开关自动校准：关闭时偏移归零并通知各显示模块立即刷新；开启时立即校准一次 */
function setSyncEnabled(enabled) {
  syncEnabled = Boolean(enabled);
  if (!syncEnabled) {
    // 切回本地系统时间：偏移归零、清空校准记录，并让所有时钟显示立即刷新
    timeOffset = 0;
    lastSyncAt = 0;
    syncState = 'off';
    window.dispatchEvent(new CustomEvent('clock:time-adjusted'));
    updateSyncUI();
  } else {
    syncState = 'pending';
    updateSyncUI();
    syncTime(); // 立即从网络时间源校准
  }
}

/* ---------- 时间源列表：probe() 返回 Promise<偏移毫秒>（= 服务器时刻 - 本地请求-响应中点时刻），失败抛错 ---------- */
const TIME_SOURCES = [
  {
    name: 'Cloudflare',
    // www.cloudflare.com/cdn-cgi/trace 返回 ts=<毫秒精度秒>，Access-Control-Allow-Origin: * 支持跨域，
    // 且由全球边缘节点应答（RTT 小、稳定），是理想的主时间源
    probe: async () => {
      const t0 = Date.now();
      const res = await fetchWithTimeout('https://www.cloudflare.com/cdn-cgi/trace', {}, 6000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const t1 = Date.now();
      const m = /(?:^|\n)ts=([0-9]+(?:\.[0-9]+)?)/.exec(text);
      if (!m) throw new Error('no ts field');
      const serverMs = Math.round(parseFloat(m[1]) * 1000);
      return serverMs - (t0 + t1) / 2; // RTT 半程补偿，抵消单向网络延迟
    },
  },
  {
    name: 'WorldTimeAPI',
    // 返回 { unixtime: 秒 }；部分网络可达，作为备用源（失败自动跳过）
    probe: async () => {
      const t0 = Date.now();
      const res = await fetchWithTimeout('https://worldtimeapi.org/api/ip', {}, 6000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const t1 = Date.now();
      if (!data || typeof data.unixtime !== 'number') throw new Error('bad payload');
      return data.unixtime * 1000 - (t0 + t1) / 2;
    },
  },
];

/** 测量网络时间偏移：主源并行采样 3 次 + 备用源各 1 次，取中位数抗抖动 */
async function measureTimeOffset() {
  const results = [];
  const jobs = [];
  const primary = TIME_SOURCES[0];
  for (let i = 0; i < 3; i++) {
    jobs.push(primary.probe().then((v) => { results.push(v); }).catch(() => {}));
  }
  for (let i = 1; i < TIME_SOURCES.length; i++) {
    jobs.push(TIME_SOURCES[i].probe().then((v) => { results.push(v); }).catch(() => {}));
  }
  await Promise.all(jobs);
  if (!results.length) throw new Error('所有时间源均不可用');
  results.sort((a, b) => a - b);
  return results[Math.floor(results.length / 2)]; // 中位数
}

/** 应用新偏移（带突变保护），生效后派发事件通知各显示模块立即刷新 */
function applyTimeOffset(offset) {
  // 首次校准（timeOffset 仍为 0）直接应用；二次校准若偏移突变 > 5s 则拒绝（可能是测量异常）
  if (timeOffset !== 0 && Math.abs(offset - timeOffset) > MAX_SYNC_JUMP) {
    return false;
  }
  timeOffset = offset;
  lastSyncAt = Date.now();
  window.dispatchEvent(new CustomEvent('clock:time-adjusted'));
  return true;
}

/** 执行一次校准（发起即返回，不阻塞调用方） */
function syncTime() {
  if (!syncEnabled) {
    // 开关已关闭：保持本地系统时间模式
    syncState = 'off';
    updateSyncUI();
    return;
  }
  if (syncState === 'syncing') return; // 已有校准在进行中
  syncState = 'syncing';
  updateSyncUI();
  measureTimeOffset()
    .then((offset) => {
      if (!syncEnabled) return; // 校准期间被用户关闭 → 放弃应用结果
      syncState = 'synced';
      applyTimeOffset(offset);
    })
    .catch(() => {
      syncState = 'error';
    })
    .finally(() => updateSyncUI());
}

/** 更新同步状态 UI（仅设置面板状态行） */
function updateSyncUI() {
  const statusEl = $('#sync-status');
  const btn = $('#resync-btn');
  if (statusEl) {
    statusEl.classList.toggle('error', syncState === 'error');
    if (syncState === 'off') {
      // 用户关闭了自动校准 → 使用本地系统时间
      statusEl.textContent = '已关闭网络校准，当前使用本地系统时间。';
    } else if (syncState === 'synced') {
      const sec = timeOffset / 1000;
      statusEl.textContent =
        `✓ 已与网络时间同步（偏移 ${sec > 0 ? '+' : ''}${sec.toFixed(2)} 秒，` +
        `同步于 ${new Date(lastSyncAt).toLocaleTimeString('zh-CN', { hour12: false })}）。` +
        '若系统时间有偏差，时钟显示已自动修正。';
    } else if (syncState === 'pending' || syncState === 'syncing') {
      statusEl.textContent = '正在从网络时间源（Cloudflare 等）校准…';
    } else {
      statusEl.textContent = '✗ 校准失败，当前使用系统时间（可点击下方按钮重试）。';
    }
  }
  if (btn) btn.disabled = syncState === 'syncing' || syncState === 'off';
}

/** 供调试接口读取的校准状态快照 */
function getSyncStatus() {
  return { syncState, timeOffset, lastSyncAt };
}

/* ---------- 命名空间导出 ---------- */
window.ClockTime = { nowMs, setSyncEnabled, syncTime, getSyncStatus };

})();
