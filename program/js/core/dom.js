/* ==========================================================================
   dom.js - DOM 元素引用注册表
   经典脚本模式：以 defer 加载，执行时 DOM 已解析完成，可直接查询元素。
   导出挂载到 window.ClockDom
   ========================================================================== */
'use strict';

(() => {

const els = {
  hours: document.querySelector('#hours'),
  minutes: document.querySelector('#minutes'),
  seconds: document.querySelector('#seconds'),
  colon: document.querySelector('#colon'),
  secondsWrapper: document.querySelector('#seconds-wrapper'),
  ampm: document.querySelector('#ampm'),
  dateDisplay: document.querySelector('#date-display'),
  weatherIcon: document.querySelector('#weather-icon'),
  weatherText: document.querySelector('#weather-text'),
  analogClock: document.querySelector('#analog-clock'),
  hourHand: document.querySelector('#hour-hand'),
  minuteHand: document.querySelector('#minute-hand'),
  secondHand: document.querySelector('#second-hand'),
  // 布局与测量高频访问的容器/节点：统一在此缓存，避免每帧 querySelector
  app: document.querySelector('#clock-app'),
  timeDisplay: document.querySelector('#time-display'),
  digitalContainer: document.querySelector('#digital-container'),
  analogContainer: document.querySelector('#analog-container'),
  infoBar: document.querySelector('#info-bar'),
  weatherDisplay: document.querySelector('#weather-display'),
  root: document.documentElement,
};

window.ClockDom = { els };

})();
