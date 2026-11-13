/* ==========================================================================
   panel-groups.js - 设置面板分组卡片：折叠状态 + 当前值摘要
   职责：
     1. 每个 .setting-group[data-group] 是可折叠卡片：点标题行切换 data-open，
        状态写入 state.uiOpen 并持久化（下次打开面板保持）；
     2. 折叠态在标题右侧显示当前值摘要（如「极简 · 92px」「星蓝 · 深色」），
        让用户不展开也能确认配置。
   为什么单独成文件：分组元数据（标题 → 摘要规则）与「控件怎么改状态」正交，
        新增一个分组只需要加一段 HTML + 这里一条摘要规则。
   经典脚本模式：依赖 core/state.js、core/config.js
   导出：window.ClockPanelGroups = { setup, refresh }
   ========================================================================== */
'use strict';

(() => {

const { state, saveState } = window.ClockState;
const { STYLE_CONFIGS, COLOR_PRESETS, ALL_FONTS } = window.ClockConfig;

const THEME_LABEL = { auto: '自动', light: '浅色', dark: '深色' };
const WEATHER_LABEL = { auto: '自动源', amap: '高德', ecmwf: 'ECMWF', gfs: 'GFS', cma: 'CMA', wttr: 'wttr.in' };

/** 字体值的简短显示：优先取内置字体表的 label，否则取第一个字体族名 */
function fontShort(value) {
  const hit = ALL_FONTS.filter((f) => f.value === value)[0];
  // 内置字体表的 label 形如「Inter（现代无衬线）」，摘要只取族名部分
  if (hit) return String(hit.label).split(/[（(]/)[0].trim();
  const first = String(value || '').split(',')[0].replace(/['"]/g, '').trim();
  return first || '系统字体';
}

/** 各分组的摘要文案（唯一来源：新增分组时在这里补一条） */
const SUMMARY = {
  clock: () => {
    const cfg = STYLE_CONFIGS[state.style];
    return (cfg ? cfg.label : '极简') + (state.showSeconds ? ' · 有秒' : '');
  },
  font: () => `${fontShort(state.fonts[state.style])} · ${state.sizes[state.style]}px`,
  look: () => {
    const p = COLOR_PRESETS[state.colorPreset];
    const glow = state.themeMode === 'light' ? '' : (state.glow === 'on' ? ' · 光效' : '');
    return `${p ? p.label : '星蓝'} · ${THEME_LABEL[state.themeMode] || '自动'}${glow}`;
  },
  format: () => `${state.hourFormat} 小时制` + (state.showAmpm && state.hourFormat === 12 ? ' · AM/PM' : ''),
  data: () => (state.autoSync ? '自动校时' : '本地时间') + ` · ${WEATHER_LABEL[state.weatherSource] || '自动源'}`,
  display: () => `${state.globalZoom}%`,
};

const groups = [];   // [{ el, name, head, body, sum }]

/** 写入某个分组的展开状态（DOM + aria + 存档） */
function applyOpen(group, open, persist) {
  group.el.dataset.open = open ? 'true' : 'false';
  group.head.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (persist) {
    state.uiOpen[group.name] = open;
    saveState();
  }
}

/** 刷新所有分组的摘要文本（写前比较，避免无谓的样式失效） */
function refresh() {
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!g.sum) continue;
    const fn = SUMMARY[g.name];
    const text = fn ? String(fn()) : '';
    if (g.sum.textContent !== text) g.sum.textContent = text;
  }
}

/** 初始化：收集分组、恢复折叠状态、绑定标题行点击、首次渲染摘要 */
function setup() {
  const nodes = document.querySelectorAll('.setting-group[data-group]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    const head = el.querySelector('.setting-group-head');
    if (!head) continue;
    const name = el.dataset.group;
    const group = {
      el,
      name,
      head,
      body: el.querySelector('.setting-group-body'),
      sum: el.querySelector('.setting-group-sum'),
    };
    groups.push(group);

    // 存档优先，其次 HTML 里的 data-open（首次使用时的默认展开策略）
    const saved = state.uiOpen[name];
    applyOpen(group, typeof saved === 'boolean' ? saved : el.dataset.open !== 'false', false);

    head.addEventListener('click', (e) => {
      e.preventDefault();
      applyOpen(group, group.el.dataset.open === 'false', true);
    });
  }
  refresh();

  // 任何控件交互后刷新摘要：面板内控件种类多（change/input/click 各有），
  // 统一在 document 上捕获比逐个 handler 里插一行更不易漏（刷新仅改 6 个短文本）
  const scheduleRefresh = () => {
    if (scheduleRefresh.pending) return;
    scheduleRefresh.pending = true;
    // 微任务后再读 state：handler 先写状态，摘要随后取值
    Promise.resolve().then(() => {
      scheduleRefresh.pending = false;
      refresh();
    });
  };
  document.addEventListener('change', scheduleRefresh, true);
  document.addEventListener('input', scheduleRefresh, true);
  document.addEventListener('click', scheduleRefresh, true);
}

/* ---------- 命名空间导出 ---------- */
window.ClockPanelGroups = { setup, refresh };

})();
