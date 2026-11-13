/* ==========================================================================
   slider.js - 设置面板滑动条的触摸/鼠标交互
   职责：①接管 .settings-body 内 range 的指针事件，用「方向判定」解决滑条与面板滚动共存：
        按下不改值 → 位移超 slop 判方向（横向接管、纵向放手）→ 抬起保留/轻点定位；
        ②拖动/聚焦时在滑块上方显示数值气泡（单位取 input 的 data-unit），
        松手 1.2 秒后淡出 —— 字号/字重这类滑条光看滑块位置无法判断当前值。
   为什么不用「先跳后回」或「必须在条内释放」：真机上别扭（2026-11-12 已试错并否决）。
   经典脚本模式：无外部依赖（只操作 DOM）
   导出：window.ClockSlider.setup()
   ========================================================================== */
'use strict';

(() => {

const SLIDER_THUMB_RADIUS = 10;  // 与 CSS 中 thumb 直径 20px 对应
const SLIDER_DRAG_SLOP = 6;      // 方向判定的最小位移（px，约 8dp 的 TouchSlop）
const SLIDER_DIRECT_RATIO = 1.2; // 横向位移需超过纵向的 1.2 倍才判定为拖动

/** 滑动条交互（按移动端平台通行做法设计）：
    - 按下时不改值，先记住「按下点对应的值」，避免触摸下压就跳（那会先跳后回）
    - 位移超过 slop 才判定方向：横向为主 → 接管手势，先把滑块跳到按下点，再实时跟随；
      纵向为主 → 放弃，值不动，手势交还面板原生滚动（CSS touch-action: pan-y）
    - 抬起：拖动过 → 保留当前值（不限制释放位置）；没拖动过（轻点）→ 定位到按下点
    参考：iOS UISlider + UIScrollView 的手势抢占、Android SeekBar 的 TouchSlop、
    Flutter Slider 的水平/垂直手势竞技场，做法一致：放开用户动作，用方向判定解冲突。 */
function setupSliderDragControl() {
  const inputs = document.querySelectorAll('.settings-body input[type="range"]');

  inputs.forEach((input) => {
    // 包一层定位容器：接管指针事件，同时给滑块留出足够的触摸高度
    const wrap = document.createElement('span');
    wrap.className = 'slider-drag-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    // 数值气泡：位置按「thumb 中心」计算（thumb 半径内缩，与原生绘制一致）
    const bubble = document.createElement('span');
    bubble.className = 'slider-bubble';
    bubble.setAttribute('aria-hidden', 'true');
    wrap.appendChild(bubble);
    let bubbleTimer = null;
    const unit = input.dataset.unit || '';

    function formatValue(v) {
      return unit === 'em' ? String(Math.round(v * 100) / 100) : String(Math.round(v));
    }

    function syncBubble() {
      const rect = wrap.getBoundingClientRect();
      const min = parseFloat(input.min) || 0;
      const max = parseFloat(input.max) || 100;
      const v = parseFloat(input.value) || 0;
      const ratio = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0;
      const usable = Math.max(1, rect.width - SLIDER_THUMB_RADIUS * 2);
      bubble.style.left = (SLIDER_THUMB_RADIUS + ratio * usable) + 'px';
      bubble.textContent = formatValue(v) + unit;
    }

    function showBubble() {
      syncBubble();
      bubble.classList.add('show');
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = null;
    }

    function hideBubbleSoon() {
      if (bubbleTimer) clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => {
        bubble.classList.remove('show');
        bubbleTimer = null;
      }, 1200);
    }

    let activeId = null;
    let mode = '';        // ''（未判定）| 'drag'（横向拖动）| 'scroll'（纵向滚动）
    let startX = 0;
    let startY = 0;
    let pressValue = '';  // 按下点对应的值（暂存，未判定前不写入）

    const trackRect = () => wrap.getBoundingClientRect();

    /** 触点横坐标 → 数值（含 thumb 半径与步长对齐） */
    function valueAt(clientX) {
      const rect = trackRect();
      const min = parseFloat(input.min) || 0;
      const max = parseFloat(input.max);
      const step = parseFloat(input.step) || 1;
      const usable = Math.max(1, rect.width - SLIDER_THUMB_RADIUS * 2);
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left - SLIDER_THUMB_RADIUS) / usable));
      const raw = min + ratio * (max - min);
      const snapped = min + Math.round((raw - min) / step) * step;
      const clamped = Math.min(max, Math.max(min, snapped));
      return String(Math.round(clamped * 1000) / 1000);
    }

    function applyValue(value) {
      if (input.value === value) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      activeId = e.pointerId;
      mode = '';
      startX = e.clientX;
      startY = e.clientY;
      pressValue = valueAt(e.clientX);
      if (input.focus) input.focus({ preventScroll: true }); // 保留键盘可调
      showBubble();
      if (wrap.setPointerCapture) {
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 旧浏览器忽略 */ }
      }
    });

    wrap.addEventListener('pointermove', (e) => {
      if (activeId !== e.pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!mode) {
        const absX = Math.abs(dx);
        const absY = Math.abs(dy);
        if (absX < SLIDER_DRAG_SLOP && absY < SLIDER_DRAG_SLOP) return; // slop 内不判定
        mode = absX > absY * SLIDER_DIRECT_RATIO ? 'drag' : 'scroll';
        if (mode === 'drag') applyValue(pressValue); // 判定为拖动后才跳到按下点
      }
      if (mode === 'drag') {
        applyValue(valueAt(e.clientX));
        showBubble();
      }
    });

    function finish(e, cancelled) {
      if (activeId !== e.pointerId) return;
      activeId = null;
      const wasDrag = mode === 'drag';
      const wasPending = mode === '';
      mode = '';
      if (wasDrag) { hideBubbleSoon(); return; }   // 拖动过：保留最后数值，不限制释放位置
      if (cancelled) { hideBubbleSoon(); return; } // 手势被系统接管（如原生滚动）：数值保持不动
      if (wasPending) applyValue(pressValue);      // 轻点：定位到按下点
      hideBubbleSoon();
    }

    // 键盘聚焦（Tab 到达）时也显示当前值；失焦后延时隐藏
    input.addEventListener('focus', showBubble);
    input.addEventListener('blur', hideBubbleSoon);
    // 键盘方向键改值时同步气泡
    input.addEventListener('input', () => {
      if (document.activeElement === input) showBubble();
    });

    wrap.addEventListener('pointerup', (e) => finish(e, false));
    wrap.addEventListener('pointercancel', (e) => finish(e, true));
  });
}


/* ---------- 命名空间导出 ---------- */
window.ClockSlider = { setup: setupSliderDragControl };

})();
