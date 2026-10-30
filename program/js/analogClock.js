/* ==========================================================================
   analogClock.js - 模拟表盘（SVG 表盘构建与表针驱动）
   经典脚本模式：依赖 dom.js（ClockDom）、timeSync.js（ClockTime，需先加载）
   导出挂载到 window.ClockAnalog
   ========================================================================== */
'use strict';

(() => {

const { els } = window.ClockDom;
const { nowMs } = window.ClockTime;

const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

/** 一次性构建表盘刻度与罗马数字 */
function buildAnalogClockFace() {
  const ticks = document.querySelector('#minute-ticks');
  const markers = document.querySelector('#hour-markers');
  const numbers = document.querySelector('#hour-numbers');
  const NS = 'http://www.w3.org/2000/svg';

  // 60 个分钟刻度 + 12 个小时标记
  for (let i = 0; i < 60; i++) {
    const angle = (i * 6 - 90) * Math.PI / 180;
    const isHour = i % 5 === 0;
    const outer = 182;
    const inner = isHour ? 158 : 170;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', 200 + inner * Math.cos(angle));
    line.setAttribute('y1', 200 + inner * Math.sin(angle));
    line.setAttribute('x2', 200 + outer * Math.cos(angle));
    line.setAttribute('y2', 200 + outer * Math.sin(angle));
    line.setAttribute('class', isHour ? 'hour-marker' : 'minute-tick');
    (isHour ? markers : ticks).appendChild(line);
  }

  // 罗马数字 1-12（12 在顶部）
  for (let i = 1; i <= 12; i++) {
    // i=1 对应 1 点钟位置（30°），12 点钟在顶部
    const hourIndex = (i === 12) ? 0 : i; // 12 → 顶部(索引0)
    const angle = ((hourIndex === 0 ? 12 : hourIndex) * 30 - 90) * Math.PI / 180;
    const r = 130;
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', 200 + r * Math.cos(angle));
    text.setAttribute('y', 200 + r * Math.sin(angle));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('class', 'hour-number');
    text.textContent = ROMAN[hourIndex];
    numbers.appendChild(text);
  }
}

/** 按给定时间驱动三根表针旋转 */
function updateAnalogClock(now) {
  const ms = now.getMilliseconds();
  const s = now.getSeconds() + ms / 1000;
  const m = now.getMinutes() + s / 60;
  const h = (now.getHours() % 12) + m / 60;

  const secDeg = s * 6;
  const minDeg = m * 6;
  const hourDeg = h * 30;

  els.hourHand.setAttribute('transform', `rotate(${hourDeg} 200 200)`);
  els.minuteHand.setAttribute('transform', `rotate(${minDeg} 200 200)`);
  els.secondHand.setAttribute('transform', `rotate(${secDeg} 200 200)`);
}

// 时间校准完成后按新时间立即刷新表针
window.addEventListener('clock:time-adjusted', () => {
  updateAnalogClock(new Date(nowMs()));
});

/* ---------- 命名空间导出 ---------- */
window.ClockAnalog = { buildAnalogClockFace, updateAnalogClock };

})();
