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
const { applyStyle, applyFontSettings, applyFontVars } = window.ClockStyle;
const { applyPalette } = window.ClockPalette;
const { COLOR_PRESETS } = window.ClockConfig;
const { syncTime, setSyncEnabled } = window.ClockTime;
const { scheduleLayoutInfoBar } = window.ClockRender;
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
  // zoom 改变主视觉的视觉坐标，需要重算信息栏贴靠位置（内部按 zoom 因子换算）
  scheduleLayoutInfoBar();
}

/** 绑定设置面板全部交互（由入口模块在 DOM 就绪后调用） */
function setupSettingsPanel() {
  const panel = $('#settings-panel');
  const overlay = $('#settings-overlay');
  const openBtn = $('#settings-btn');
  const closeBtn = $('#close-settings');

  // 焦点管理：打开时记住来源、把焦点移入面板；关闭时归还。
  // 面板是模态抽屉，Tab 不应跑到被遮罩的页面上去（无焦点约束时会出现）。
  let lastFocused = null;

  function focusables() {
    return [].filter.call(
      panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      (el) => !el.disabled && el.offsetParent !== null
    );
  }

  function openPanel() {
    lastFocused = document.activeElement;
    panel.classList.add('open');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('show'));
    // 摘要可能已过期（例如上次改完值后关闭面板），打开时统一刷新一次
    if (window.ClockPanelGroups) window.ClockPanelGroups.refresh();
    if (closeBtn.focus) closeBtn.focus({ preventScroll: true });
  }

  function closePanel() {
    panel.classList.remove('open');
    overlay.classList.remove('show');
    setTimeout(() => { overlay.hidden = true; }, 300);
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }

  openBtn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closePanel(); return; }
    if (e.key !== 'Tab' || !panel.classList.contains('open')) return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
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
      // 立即按新制式重绘：AM/PM 的显隐与文本由 tick 决定，
      // 不依赖下一次整秒调度（否则切换后最多 1 秒才生效）
      window.ClockRender.tick();
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

  // 字体选择（低频路径：完整应用变量 + 面板同步 + 槽位重测）
  $('#font-family-select').addEventListener('change', (e) => {
    // 先捕获选中值：面板同步与自定义下拉联动期间 value 可能被改写
    const fontCss = e.target.value;
    state.fonts[state.style] = fontCss;
    applyFontSettings(state.style);
    scheduleLayoutInfoBar();
    saveState();
  });

  // 字号滑杆（高频路径：只写 CSS 变量，不重建面板控件；
  // 字号影响数字宽度与主视觉高度 → 重测槽位宽度 + 重算信息栏贴靠）
  $('#font-size-slider').addEventListener('input', (e) => {
    state.sizes[state.style] = Number(e.target.value);
    applyFontVars(state.style);
    window.ClockRender.scheduleDigitMeasure();
    scheduleLayoutInfoBar();
    saveState();
  });

  // 字重滑杆（每风格独立；不同字重的数字宽度不同，需重测槽位宽度）
  $('#font-weight-slider').addEventListener('input', (e) => {
    state.weights[state.style] = Number(e.target.value);
    applyFontVars(state.style);
    window.ClockRender.scheduleDigitMeasure();
    saveState();
  });

  // 数字间距滑杆（每风格独立；负值=字符层叠，最左在上；冒号间距与秒数间距
  // 由此联动派生，不再单独调节 —— 派生公式见 style.js applyFontVars）
  $('#digit-gap-slider').addEventListener('input', (e) => {
    state.digitGaps[state.style] = Number(e.target.value);
    applyFontVars(state.style);
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
  // 清空字体缓存：破坏性操作，先展开行内确认（不弹系统对话框，避免打断沉浸式全屏）
  const clearBtn = $('#clear-font-cache-btn');
  const fontHint = $('#font-cache-hint');
  const FONT_HINT_DEFAULT = fontHint ? fontHint.textContent : '';
  let confirmBox = null;

  function closeConfirm() {
    if (!confirmBox) return;
    confirmBox.remove();
    confirmBox = null;
    clearBtn.disabled = false;
    clearBtn.textContent = '🗑 清空字体缓存';
    clearBtn.focus({ preventScroll: true });
  }

  async function runClearFontCache() {
    clearBtn.disabled = true;
    clearBtn.textContent = '⏳ 清除中…';
    const cleared = await clearFontCache();
    closeConfirm();
    if (fontHint) {
      fontHint.textContent = `✓ 已清除 ${cleared} 条字体缓存。下次切换字体时将重新从网络加载。`;
      fontHint.style.color = 'var(--accent-color)';
      setTimeout(() => {
        fontHint.textContent = FONT_HINT_DEFAULT;
        fontHint.style.color = '';
      }, 5000);
    }
  }

  clearBtn.addEventListener('click', () => {
    if (confirmBox) { closeConfirm(); return; }
    confirmBox = document.createElement('div');
    confirmBox.className = 'inline-confirm';
    confirmBox.innerHTML = '<p>清空后，未缓存的字体会在下次切换时重新联网下载。确定清空？</p>'
      + '<div class="inline-confirm-actions">'
      + '<button type="button" class="danger">确认清空</button>'
      + '<button type="button" class="cancel">取消</button>'
      + '</div>';
    clearBtn.parentNode.insertBefore(confirmBox, clearBtn.nextSibling);
    confirmBox.querySelector('.danger').addEventListener('click', runClearFontCache);
    confirmBox.querySelector('.cancel').addEventListener('click', closeConfirm);
    confirmBox.querySelector('.cancel').focus({ preventScroll: true });
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

  // 模拟表盘风格：数字时间显示开关（影响主视觉底部位置 → 重算信息栏贴靠）
  const analogDigitalToggle = $('#analog-digital-toggle');
  if (analogDigitalToggle) {
    analogDigitalToggle.checked = state.analogDigital;
    analogDigitalToggle.addEventListener('change', (e) => {
      state.analogDigital = e.target.checked;
      document.body.dataset.analogDigital = state.analogDigital ? 'on' : 'off';
      scheduleLayoutInfoBar();
      saveState();
    });
  }

  // 表盘尺寸缩放滑动条（仅 analog 风格显示）：作为缩放系数乘到 vh/vw 基础比例上
  const analogScaleSlider = $('#analog-scale-slider');
  if (analogScaleSlider) {
    analogScaleSlider.value = String(state.analogScale);
    analogScaleSlider.addEventListener('input', (e) => {
      state.analogScale = Number(e.target.value);
      if (window.ClockAnalog) window.ClockAnalog.applyScale();
      scheduleLayoutInfoBar();
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

  // 霓虹光效开关（内部状态名仍为 glow）：三层模糊副本（见 glow.js 与报告第 12 节）
  const glowToggle = $('#glow-toggle');
  if (glowToggle && window.ClockGlow) {
    glowToggle.checked = state.glow === 'on';
    glowToggle.addEventListener('change', () => {
      state.glow = glowToggle.checked ? 'on' : 'off';
      window.ClockGlow.apply(state.glow);
      saveState();
    });
  }

  // 全屏切换：交给 ClockFullscreen 统一处理（主动退出不触发「意外退出」的自动恢复）
  $('#fullscreen-btn').addEventListener('click', () => {
    if (window.ClockFullscreen) {
      window.ClockFullscreen.toggle();
    } else if (!document.fullscreenElement) {
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

  // 分组卡片：恢复折叠状态 + 绑定标题行 + 渲染摘要（必须先于下拉包装，
  // 因为折叠态的卡片里 select 的布局尺寸为 0，包装逻辑要在可见状态确定后执行）
  if (window.ClockPanelGroups) window.ClockPanelGroups.setup();

  // 自定义下拉组件（在所有 select 选项初始化完成后包装，含动态填充的 palette/font select）
  window.ClockSelectPanel.setup();

  // 滑动条交互：方向判定，避免触摸下压直接跳值
  window.ClockSlider.setup();
}

/* ---------- 命名空间导出 ---------- */
window.ClockSettings = { setupSettingsPanel, applyZoom };

})();
