/* ==========================================================================
   select.js - 自定义下拉组件（替代原生 select 外观，完整适配主题）
   职责：把 .setting-select 包装成 trigger + menu；保留原 select 承载 value/change 语义。
        菜单溢出量 ≤24px 时不建立内部滚动（触摸滑动直接交给面板原生滚动）。
   经典脚本模式：依赖 core/utils.js（ClockUtils）
   导出：window.ClockSelectPanel.setup()；运行期仍暴露 window.ClockSelect.syncAll()
        （风格/字体模块编程改 select.value 后需要同步 trigger 文本与高亮）
   ========================================================================== */
'use strict';

(() => {

const { $ } = window.ClockUtils;

/* 菜单溢出不超过该值时不启用内部滚动（px）——不为十几像素建立独立滚动容器 */
const MENU_FIT_SLACK = 24;

/** 将所有 .setting-select 包装为自定义下拉组件：
    - trigger（复刻 select 外观 + border chevron 箭头，替代原渐变箭头修复显示不完整）
    - menu（展开列表，圆角 + 主题色，替代原生 option 列表以完整适配风格）
    保留原 select（hidden）承载 value 与 change 语义；菜单项点击写回 value 并派发
    change，复用 settings.js 原有的 change 监听。 */
function setupCustomSelects() {
  let openMenu = null; // 当前展开的菜单（互斥，同时只开一个）
  const syncFns = [];   // 每个 select 的 sync 函数，供全局 syncAll 调用

  /** 菜单高度自适应：溢出量很小（如配色预设 7 项只多出十几像素）时不启用内部
      滚动，改为完整展开——避免为了十几像素建立独立的滚动容器，抢走触摸手势，
      让「继续滑动带动面板」这件事完全由浏览器原生滚动链处理（更顺滑）。 */
  function fitMenuHeight(menu) {
    menu.classList.remove('menu-fits');
    const overflow = menu.scrollHeight - menu.clientHeight;
    if (overflow > 0 && overflow <= MENU_FIT_SLACK) menu.classList.add('menu-fits');
  }

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
      fitMenuHeight(menu); // 必须在可见后测量
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


/* ---------- 命名空间导出 ---------- */
window.ClockSelectPanel = { setup: setupCustomSelects };

})();
