/* ==========================================================================
   settings.js - 设置面板交互（开关面板、各控件的事件绑定）
   经典脚本模式：依赖 utils.js（ClockUtils）、state.js（ClockState）、theme.js（ClockTheme）、
   style.js（ClockStyle）、timeSync.js（ClockTime）、weather.js（ClockWeather）、
   fonts.js（ClockFonts，需先加载）
   导出挂载到 window.ClockSettings
   ========================================================================== */
'use strict';

(() => {

const { $ } = window.ClockUtils;
const { state, saveState } = window.ClockState;
const { applyTheme } = window.ClockTheme;
const { applyStyle, applyFontSettings, applyAnalogScale } = window.ClockStyle;
const { applyPalette } = window.ClockPalette;
const { COLOR_PRESETS } = window.ClockConfig;
const { syncTime, setSyncEnabled } = window.ClockTime;
const {
  updateWeather,
  refreshWeatherManual,
  getAmapKey,
  saveAmapKey,
} = window.ClockWeather;
const { clearFontCache } = window.ClockFonts;

/* ---------- 全局缩放 ---------- */
const ZOOM_MIN = 50, ZOOM_MAX = 200, ZOOM_STEP = 10;

/** 将 state.globalZoom（百分比）应用到 body 的 CSS zoom，实现页面级整体缩放。
    CSS zoom 会按比例缩放布局尺寸（含 fixed 定位的设置按钮/面板），
    视觉效果等效浏览器缩放；真正的浏览器缩放级别无法由网页 JS 直接控制，
    故采用 zoom 作为等效方案。
    同时写入 --zoom-factor（数字，= zoom/100）：数字时间的字号 vw/vh 约束
    除以该因子，使 zoom 放大时数字时间视觉尺寸保持 fit、秒数/AM/PM 不溢出屏幕 */
function applyZoom() {
  const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, state.globalZoom));
  state.globalZoom = z;
  document.body.style.zoom = String(z / 100);
  document.documentElement.style.setProperty('--zoom-factor', String(z / 100));
  const val = $('#zoom-value');
  if (val) val.textContent = `${z}%`;
}

/** 将所有 .setting-select 包装为自定义下拉组件：
    - trigger（复刻 select 外观 + border chevron 箭头，替代原渐变箭头修复显示不完整）
    - menu（展开列表，圆角 + 主题色，替代原生 option 列表以完整适配风格）
    保留原 select（hidden）承载 value 与 change 语义；菜单项点击写回 value 并派发
    change，复用 settings.js 原有的 change 监听。 */
function setupCustomSelects() {
  let openMenu = null; // 当前展开的菜单（互斥，同时只开一个）
  const syncFns = [];   // 每个 select 的 sync 函数，供全局 syncAll 调用

  function closeCurrent() {
    if (openMenu) {
      openMenu.menu.hidden = true;
      openMenu.trigger.classList.remove('open');
      openMenu = null;
    }
  }

  document.querySelectorAll('.setting-select').forEach((select) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    select.parentNode.insertBefore(wrapper, select);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    const label = document.createElement('span');
    label.className = 'custom-select-label';
    trigger.appendChild(label);
    wrapper.appendChild(trigger);

    const menu = document.createElement('ul');
    menu.className = 'custom-select-menu';
    menu.hidden = true;
    wrapper.appendChild(menu);

    // 原 select 移入 wrapper 并隐藏（保留 value / change 语义）
    wrapper.appendChild(select);
    select.hidden = true;

    // 同步 trigger 文本 + 重建菜单项（含选中高亮）
    function sync() {
      const selected = select.options[select.selectedIndex];
      label.textContent = selected ? selected.textContent : '';
      menu.innerHTML = '';
      Array.from(select.options).forEach((opt) => {
        const li = document.createElement('li');
        li.className = 'custom-select-option';
        li.textContent = opt.textContent;
        li.dataset.value = opt.value;
        if (opt.selected) li.classList.add('selected');
        li.addEventListener('click', (e) => {
          // 阻止 click 冒泡到包裹层 <label>：label 的默认行为会把点击转发给
          // 其内部第一个表单控件（trigger 按钮），导致 closeCurrent 后又触发
          // trigger 的 open() 重新展开菜单（字体/天气源下拉被 label 包裹，
          // 风格/配色下拉没有 —— 这正是只有前两者不能收回的根因）
          e.preventDefault();
          e.stopPropagation();
          if (select.value !== opt.value) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          sync();
          closeCurrent();
        });
        menu.appendChild(li);
      });
    }
    syncFns.push(sync);

    function open() {
      closeCurrent();
      menu.hidden = false;
      trigger.classList.add('open');
      openMenu = { menu, trigger };
    }

    trigger.addEventListener('click', () => {
      if (menu.hidden) open();
      else closeCurrent();
    });

    // 选项动态变化（如 font-family-select 被 applyFontSettings 重建）时同步菜单；
    // 编程改 select.value（如 applyStyle 设 styleSelect.value）不触发 change/属性
    // 变化，由 style.js 显式调用 window.ClockSelect.syncAll() 同步
    new MutationObserver(sync).observe(select, { childList: true, subtree: true });

    document.addEventListener('click', (e) => {
      if (!wrapper.contains(e.target) && !menu.hidden) closeCurrent();
    });

    sync();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCurrent();
  });

  // 对外暴露：所有下拉同步（编程改 value 后调用）
  window.ClockSelect = { syncAll: () => syncFns.forEach((fn) => fn()) };
}

/** 绑定设置面板全部交互（由入口模块在 DOM 就绪后调用） */
function setupSettingsPanel() {
  const panel = $('#settings-panel');
  const overlay = $('#settings-overlay');
  const openBtn = $('#settings-btn');
  const closeBtn = $('#close-settings');

  function openPanel() {
    panel.classList.add('open');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  function closePanel() {
    panel.classList.remove('open');
    overlay.classList.remove('show');
    setTimeout(() => { overlay.hidden = true; }, 300);
  }

  openBtn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePanel();
  });

  // 风格切换（下拉列表，与字体选择的交互方式一致）
  $('#style-select').addEventListener('change', (e) => {
    applyStyle(e.target.value);
  });

  // 配色预设：动态填充下拉选项（数据来自 config.js 的 COLOR_PRESETS），
  // 按当前状态初始化选中项；切换后立即应用并保存（无需刷新页面）
  const paletteSelect = $('#palette-select');
  if (paletteSelect) {
    paletteSelect.innerHTML = '';
    Object.entries(COLOR_PRESETS).forEach(([id, p]) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.label;
      paletteSelect.appendChild(opt);
    });
    paletteSelect.value = state.colorPreset;
    paletteSelect.addEventListener('change', (e) => {
      state.colorPreset = e.target.value;
      applyPalette();
      saveState();
    });
  }

  // 时间格式切换（12/24 小时制）
  const formatBtns = document.querySelectorAll('.format-option');
  // 按当前状态同步按钮高亮与 aria-checked（页面加载即高亮，不依赖点击）
  const syncFormatButtons = () => {
    formatBtns.forEach((b) => {
      const active = Number(b.dataset.format) === state.hourFormat;
      b.classList.toggle('active', active);
      b.setAttribute('aria-checked', String(active));
    });
  };
  syncFormatButtons();
  formatBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.hourFormat = Number(btn.dataset.format);
      saveState();
      syncFormatButtons();
    });
  });

  // 主题模式切换
  document.querySelectorAll('.theme-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.themeMode = btn.dataset.mode;
      applyTheme();
      saveState();
    });
  });

  // 字体选择
  $('#font-family-select').addEventListener('change', (e) => {
    // 先捕获选中值：applyFontSettings 会重建 select 选项，避免之后读取到被改写的 value
    const fontCss = e.target.value;
    state.fonts[state.style] = fontCss;
    applyFontSettings(state.style);
    saveState();
  });

  // 字号滑杆
  $('#font-size-slider').addEventListener('input', (e) => {
    state.sizes[state.style] = Number(e.target.value);
    applyFontSettings(state.style);
    saveState();
  });

  // 字重滑杆（每风格独立）
  $('#font-weight-slider').addEventListener('input', (e) => {
    state.weights[state.style] = Number(e.target.value);
    applyFontSettings(state.style);
    saveState();
  });

  // 数字间距滑杆（每风格独立；负值=字符层叠，最左在上；冒号间距由此联动派生，
  // 不再单独调节 —— 派生公式见 style.js applyFontSettings）
  $('#digit-gap-slider').addEventListener('input', (e) => {
    state.digitGaps[state.style] = Number(e.target.value);
    applyFontSettings(state.style);
    saveState();
  });

  // 秒数显示开关
  const showSecondsToggle = $('#show-seconds-toggle');
  if (showSecondsToggle) {
    showSecondsToggle.checked = state.showSeconds;
    showSecondsToggle.addEventListener('change', (e) => {
      state.showSeconds = e.target.checked;
      document.body.dataset.showSeconds = state.showSeconds ? 'on' : 'off';
      saveState();
      // 重置秒缓存并立即重绘（重新开启时秒数即时刷新，不留旧值）
      window.ClockRender.forceRefresh();
    });
  }

  // AM/PM 显示开关（仅 12 小时制下生效；切换后由 tick 立即刷新 hidden 状态）
  const showAmpmToggle = $('#show-ampm-toggle');
  if (showAmpmToggle) {
    showAmpmToggle.checked = state.showAmpm;
    showAmpmToggle.addEventListener('change', (e) => {
      state.showAmpm = e.target.checked;
      saveState();
      window.ClockRender.tick();
    });
  }

  // 日期显示开关（隐藏日期时 info-bar 的分隔符随之隐藏，剩余元素仍居中）
  const showDateToggle = $('#show-date-toggle');
  if (showDateToggle) {
    showDateToggle.checked = state.showDate;
    document.body.dataset.showDate = state.showDate ? 'on' : 'off';
    showDateToggle.addEventListener('change', (e) => {
      state.showDate = e.target.checked;
      document.body.dataset.showDate = state.showDate ? 'on' : 'off';
      saveState();
    });
  }

  // 天气显示开关（隐藏天气时 info-bar 的分隔符随之隐藏，剩余元素仍居中）
  const showWeatherToggle = $('#show-weather-toggle');
  if (showWeatherToggle) {
    showWeatherToggle.checked = state.showWeather;
    document.body.dataset.showWeather = state.showWeather ? 'on' : 'off';
    showWeatherToggle.addEventListener('change', (e) => {
      state.showWeather = e.target.checked;
      document.body.dataset.showWeather = state.showWeather ? 'on' : 'off';
      saveState();
    });
  }

  // 日期/天气字号滑动条：写入 --info-font-size 供 .info-bar 使用
  const infoFontSlider = $('#info-font-slider');
  if (infoFontSlider) {
    infoFontSlider.value = String(state.infoFontSize);
    document.documentElement.style.setProperty('--info-font-size', `${state.infoFontSize}px`);
    infoFontSlider.addEventListener('input', (e) => {
      state.infoFontSize = Number(e.target.value);
      document.documentElement.style.setProperty('--info-font-size', `${state.infoFontSize}px`);
      saveState();
    });
  }

  // 清空字体缓存：清除 IndexedDB 中缓存的字体文件，反馈清除结果
  $('#clear-font-cache-btn').addEventListener('click', async () => {
    const btn = $('#clear-font-cache-btn');
    const hint = $('#font-cache-hint');
    btn.disabled = true;
    btn.textContent = '⏳ 清除中…';
    const cleared = await clearFontCache();
    btn.disabled = false;
    btn.textContent = '🗑 清空字体缓存';
    hint.textContent = `✓ 已清除 ${cleared} 条字体缓存。下次切换字体时将重新从网络加载。`;
    hint.style.color = 'var(--accent-color)';
    setTimeout(() => {
      hint.textContent = '缓存可加速字体加载，无需联网即可使用。如遇字体显示异常可清空后重新加载。';
      hint.style.color = '';
    }, 5000);
  });

  // 时间自动校准开关：开启=网络校准，关闭=使用本地系统时间（偏移归零）
  const autoSyncToggle = $('#auto-sync-toggle');
  if (autoSyncToggle) {
    autoSyncToggle.checked = state.autoSync;
    autoSyncToggle.addEventListener('change', (e) => {
      state.autoSync = e.target.checked;
      setSyncEnabled(state.autoSync);
      saveState();
    });
  }

  // 模拟表盘风格：数字时间显示开关
  const analogDigitalToggle = $('#analog-digital-toggle');
  if (analogDigitalToggle) {
    analogDigitalToggle.checked = state.analogDigital;
    analogDigitalToggle.addEventListener('change', (e) => {
      state.analogDigital = e.target.checked;
      document.body.dataset.analogDigital = state.analogDigital ? 'on' : 'off';
      saveState();
    });
  }

  // 表盘尺寸缩放滑动条（仅 analog 风格显示）：作为缩放系数乘到 vh/vw 基础比例上
  const analogScaleSlider = $('#analog-scale-slider');
  if (analogScaleSlider) {
    analogScaleSlider.value = String(state.analogScale);
    analogScaleSlider.addEventListener('input', (e) => {
      state.analogScale = Number(e.target.value);
      applyAnalogScale();
      saveState();
    });
  }

  // 天气数据源选择：切换后立即用新数据源刷新天气；CMA 源显示不稳定提示
  const weatherSourceSelect = $('#weather-source-select');
  const cmaWarning = $('#cma-warning');
  if (weatherSourceSelect) {
    weatherSourceSelect.value = state.weatherSource;
    cmaWarning.hidden = state.weatherSource !== 'cma';
    weatherSourceSelect.addEventListener('change', async (e) => {
      state.weatherSource = e.target.value;
      cmaWarning.hidden = state.weatherSource !== 'cma';
      saveState();
      await updateWeather({ force: true });
    });
  }

  // 高德 API Key 输入框：回显已保存值，修改后立即保存
  const amapKeyInput = $('#amap-key');
  if (amapKeyInput) {
    amapKeyInput.value = getAmapKey();
    amapKeyInput.addEventListener('change', () => {
      saveAmapKey(amapKeyInput.value.trim());
    });
  }

  // 刷新天气（手动刷新：立即同步发起定位请求，确保浏览器在按钮点击的
  // 用户手势保护期内弹出定位授权询问；定位失败按 IP → 北京 逐级兜底）
  $('#refresh-weather').addEventListener('click', () => {
    const btn = $('#refresh-weather');
    btn.disabled = true;
    btn.textContent = '⏳ 获取中…';
    refreshWeatherManual()
      .catch((err) => {
        // 兜底：防止未捕获异常导致按钮永久禁用
        console.error('手动刷新天气失败', err);
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = '↻ 刷新天气';
      });
  });

  // 全局缩放 + / - 按钮：调整 CSS zoom，整体放大/缩小整个界面（含设置面板）
  applyZoom();
  $('#zoom-in-btn').addEventListener('click', () => {
    state.globalZoom = Math.min(ZOOM_MAX, state.globalZoom + ZOOM_STEP);
    applyZoom();
    saveState();
  });
  $('#zoom-out-btn').addEventListener('click', () => {
    state.globalZoom = Math.max(ZOOM_MIN, state.globalZoom - ZOOM_STEP);
    applyZoom();
    saveState();
  });

  // 全屏切换
  $('#fullscreen-btn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
  });

  // 立即重新校准时间
  const resyncBtn = $('#resync-btn');
  if (resyncBtn) resyncBtn.addEventListener('click', syncTime);

  // 全屏状态变化时更新按钮文字
  document.addEventListener('fullscreenchange', () => {
    $('#fullscreen-btn').textContent = document.fullscreenElement ? '⤓ 退出全屏' : '⛶ 切换全屏';
  });

  // 自定义下拉组件（在所有 select 选项初始化完成后包装，含动态填充的 palette/font select）
  setupCustomSelects();
}

/* ---------- 命名空间导出 ---------- */
window.ClockSettings = { setupSettingsPanel, applyZoom };

})();
