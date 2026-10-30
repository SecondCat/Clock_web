/* ==========================================================================
   config.js - 全局常量与风格配置（纯数据模块，不依赖任何其它模块）
   经典脚本模式：导出挂载到 window.ClockConfig
   ========================================================================== */
'use strict';

(() => {

/* ---------- localStorage 键名 ---------- */
const STORAGE_KEY = 'fullscreenClockPrefs_v1';
const LOCATION_KEY = 'fullscreenClockLocation_v1'; // 定位缓存（localStorage，天气优先使用）
const AMAP_KEY_STORAGE = 'fullscreenClockAmapKey_v1'; // 高德 Web 服务 API Key（仅存本机）

/* ---------- 全部可选字体（所有风格共用：合并原 minimal/neon/analog 三套列表） ---------- */
const ALL_FONTS = [
  { value: "'Inter', 'PingFang SC', sans-serif",              label: 'Inter（现代无衬线）' },
  { value: "'Montserrat', 'PingFang SC', sans-serif",         label: 'Montserrat（几何无衬线）' },
  { value: "'Poppins', 'PingFang SC', sans-serif",            label: 'Poppins（圆润无衬线）' },
  { value: "'Space Grotesk', 'PingFang SC', sans-serif",      label: 'Space Grotesk' },
  { value: "'Oswald', sans-serif",                            label: 'Oswald（压缩体）' },
  { value: "'Roboto Mono', monospace",                        label: 'Roboto Mono（等宽）' },
  { value: "'Share Tech Mono', monospace",                    label: 'Share Tech Mono（科技等宽）' },
  { value: "'Major Mono Display', monospace",                 label: 'Major Mono（点阵）' },
  { value: "'Orbitron', sans-serif",                          label: 'Orbitron（霓虹科幻）' },
  { value: "'Exo 2', sans-serif",                             label: 'Exo 2（科技感）' },
  { value: "'Chakra Petch', sans-serif",                      label: 'Chakra Petch（锐利科技）' },
  { value: "'Audiowide', sans-serif",                         label: 'Audiowide（未来感）' },
  { value: "'Michroma', sans-serif",                          label: 'Michroma（硬科幻）' },
  { value: "'Cinzel', serif",                                 label: 'Cinzel（古典衬线）' },
  { value: "'Playfair Display', serif",                       label: 'Playfair Display（优雅衬线）' },
  { value: "'Cormorant Garamond', serif",                     label: 'Cormorant（纤细衬线）' },
  { value: "'EB Garamond', serif",                            label: 'EB Garamond（古籍衬线）' },
  { value: "'Helvetica Neue', Arial, 'PingFang SC', sans-serif", label: 'Helvetica（系统）' },
  { value: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif", label: 'Segoe UI（系统）' },
  { value: "Georgia, 'Times New Roman', serif",               label: 'Georgia（系统衬线）' },
  { value: "Palatino, 'Palatino Linotype', 'Book Antiqua', serif", label: 'Palatino（系统衬线）' },
];

/* ---------- 三种风格的配置：默认字体/字号/字重、字号范围（字体列表统一用 ALL_FONTS） ---------- */
const STYLE_CONFIGS = {
  minimal: {
    label: '极简',
    defaultFont: "'Inter', 'PingFang SC', sans-serif",
    defaultSize: 92,
    defaultWeight: 200,
    minSize: 32,
    maxSize: 360,
  },
  neon: {
    label: '霓虹',
    defaultFont: "'Orbitron', sans-serif",
    defaultSize: 84,
    defaultWeight: 700,
    minSize: 32,
    maxSize: 340,
  },
  analog: {
    label: '表盘',
    defaultFont: "'Cinzel', serif",
    defaultSize: 40,
    defaultWeight: 400,
    minSize: 16,
    maxSize: 96,
  },
};

/* ---------- WMO 天气代码 → 中文描述 + 图标（Open-Meteo） ---------- */
const WEATHER_CODES = {
  0:  { icon: '☀️', text: '晴' },
  1:  { icon: '🌤️', text: '大部晴朗' },
  2:  { icon: '⛅', text: '多云' },
  3:  { icon: '☁️', text: '阴' },
  45: { icon: '🌫️', text: '雾' },
  48: { icon: '🌫️', text: '冻雾' },
  51: { icon: '🌦️', text: '小毛毛雨' },
  53: { icon: '🌦️', text: '毛毛雨' },
  55: { icon: '🌧️', text: '大毛毛雨' },
  56: { icon: '🌧️', text: '冻毛毛雨' },
  57: { icon: '🌧️', text: '强冻毛毛雨' },
  61: { icon: '🌧️', text: '小雨' },
  63: { icon: '🌧️', text: '中雨' },
  65: { icon: '🌧️', text: '大雨' },
  66: { icon: '🌧️', text: '冻雨' },
  67: { icon: '🌧️', text: '强冻雨' },
  71: { icon: '🌨️', text: '小雪' },
  73: { icon: '🌨️', text: '中雪' },
  75: { icon: '❄️', text: '大雪' },
  77: { icon: '❄️', text: '雪粒' },
  80: { icon: '🌦️', text: '小阵雨' },
  81: { icon: '🌦️', text: '中阵雨' },
  82: { icon: '⛈️', text: '强阵雨' },
  85: { icon: '🌨️', text: '小阵雪' },
  86: { icon: '❄️', text: '大阵雪' },
  91: { icon: '⛈️', text: '雷暴' },
  92: { icon: '⛈️', text: '雷暴伴小冰雹' },
  93: { icon: '⛈️', text: '雷暴伴大冰雹' },
};

/* ---------- wttr.in（备用天气源）使用的 WWO 天气代码 → WMO 代码映射，复用上方 WEATHER_CODES ---------- */
const WWO_TO_WMO = {
  113: 0, 116: 1, 119: 2, 122: 3,                    // 晴 → 大部晴朗 → 多云 → 阴
  143: 45, 248: 45, 260: 48,                         // 雾 / 雾 / 冻雾
  263: 51, 266: 53, 281: 56, 284: 57, 293: 51, 296: 53, // 毛毛雨系
  299: 63, 302: 63, 305: 65, 308: 65,                // 小雨/中雨/大雨
  311: 66, 314: 67, 317: 66,                         // 冻雨 / 强冻雨 / 雨夹雪
  179: 85, 182: 66, 185: 56,                         // 小阵雪 / 雨夹雪 / 冻毛毛雨
  227: 77, 230: 75, 350: 77, 374: 77, 377: 77,       // 吹雪 / 暴雪 / 冰粒
  323: 85, 326: 85, 329: 86, 332: 73, 335: 75, 338: 75, // 阵雪/雪
  176: 80, 353: 80, 356: 81, 359: 82,                // 阵雨系
  362: 66, 365: 66, 368: 85, 371: 86,                // 雨夹雪 / 阵雪
  200: 95, 386: 95, 389: 95, 392: 96, 395: 99,       // 雷暴系
};

/* ---------- 配色预设（元数据） ----------
   说明：这里只定义预设的展示信息（下拉列表 label）与浏览器主题色
   （meta[name="theme-color"] 跟随浅/深模式取值）。
   各组完整颜色变量定义在 styles.css 末尾的 body[data-palette="xxx"] 规则中：
     - body[data-palette="xxx"]                 → 浅色模式变量
     - body[data-palette="xxx"][data-theme="dark"] → 深色模式变量（选择器优先级更高，自动联动主题）
   default 预设不写 CSS 规则，沿用 body 默认主题变量。 */
const COLOR_PRESETS = {
  default: {
    label: '星蓝',
    themeColor: { light: '#f2f3f7', dark: '#0d0e16' },
  },
  ocean: {
    label: '海洋',
    themeColor: { light: '#eef4f6', dark: '#0a141c' },
  },
  sunset: {
    label: '落日',
    themeColor: { light: '#faf3ee', dark: '#1a0e0a' },
  },
  forest: {
    label: '森林',
    themeColor: { light: '#f0f4ee', dark: '#0c150e' },
  },
  sakura: {
    label: '樱花',
    themeColor: { light: '#faf2f6', dark: '#180e16' },
  },
  graphite: {
    label: '石墨',
    themeColor: { light: '#f5f5f5', dark: '#101010' },
  },
  amethyst: {
    label: '紫晶',
    themeColor: { light: '#f3f1fa', dark: '#100d1e' },
  },
};

/* ---------- 自动主题切换时间 ---------- */
const AUTO_DARK_START = 18; // 自动深色开始时间（18:00）
const AUTO_LIGHT_START = 6; // 自动浅色开始时间（6:00）

/* ---------- 时间自动校准常量 ---------- */
const SYNC_INTERVAL = 60 * 60 * 1000;        // 周期校准间隔：1 小时
const RESYNC_AFTER_VISIBLE = 30 * 60 * 1000; // 页面可见且距上次校准超过 30 分钟则补校准
const MAX_SYNC_JUMP = 5000;                  // 二次校准时允许的最大偏移变化（毫秒），防止测量异常导致时间跳变

/* ---------- 天气刷新常量 ---------- */
const WEATHER_REFRESH_INTERVAL = 10 * 60 * 1000; // 天气定时刷新间隔：10 分钟
const WEATHER_REFRESH_AFTER_VISIBLE = 10 * 60 * 1000; // 页面回到前台且距上次天气更新超过 10 分钟则补刷新
const WEATHER_MAX_AGE = 3 * 3600 * 1000;    // 模型当前时刻数据超过该时长视为过期（跳过该源）
const GEO_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 10000,
  maximumAge: 5 * 60 * 1000,
};

/* ---------- 命名空间导出 ---------- */
window.ClockConfig = {
  STORAGE_KEY,
  LOCATION_KEY,
  AMAP_KEY_STORAGE,
  ALL_FONTS,
  STYLE_CONFIGS,
  WEATHER_CODES,
  WWO_TO_WMO,
  COLOR_PRESETS,
  AUTO_DARK_START,
  AUTO_LIGHT_START,
  SYNC_INTERVAL,
  RESYNC_AFTER_VISIBLE,
  MAX_SYNC_JUMP,
  WEATHER_REFRESH_INTERVAL,
  WEATHER_REFRESH_AFTER_VISIBLE,
  WEATHER_MAX_AGE,
  GEO_OPTIONS,
};

})();
