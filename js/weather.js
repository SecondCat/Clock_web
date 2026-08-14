/* ==========================================================================
   weather.js - 天气获取（多源顺序回退）、定位缓存、高德 API Key 管理
   经典脚本模式：依赖 utils.js（ClockUtils）、dom.js（ClockDom）、state.js（ClockState）、
   config.js（ClockConfig，需先加载）
   导出挂载到 window.ClockWeather
   ========================================================================== */
'use strict';

(() => {

const { withTimeout } = window.ClockUtils;
const { els } = window.ClockDom;
const { state } = window.ClockState;
const {
  LOCATION_KEY,
  AMAP_KEY_STORAGE,
  WEATHER_CODES,
  WWO_TO_WMO,
  WEATHER_MAX_AGE,
  GEO_OPTIONS,
} = window.ClockConfig;

/* ---------- 定位授权询问策略 ---------- */
// 自动刷新只在页面会话内「首次需要定位」时询问一次浏览器授权；
// 之后自动刷新不再触发定位（有缓存用缓存位置，无缓存回退北京天气），
// 仅用户手动点击「刷新天气」按钮时才允许再次弹出授权询问。
let geoPrompted = false;

// 无法获取定位信息时的默认天气城市：北京（天安门坐标 + 高德区级 adcode）
const BEIJING = {
  lat: 39.9042,
  lon: 116.4074,
  city: '北京',
  adcode: '110101', // 高德：东城区（区级 adcode，天气查询精度到区）
  district: '东城区',
};

/* ---------- 定位缓存（localStorage） ---------- */

function loadCachedLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const loc = JSON.parse(raw);
    if (typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return null;
    return loc;
  } catch (e) {
    return null;
  }
}

function saveCachedLocation(location) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify({
      lat: location.lat,
      lon: location.lon,
      city: location.city || null,
      adcode: location.adcode || null, // 高德区级城市编码（天气查询用，区级精度）
      district: location.district || null, // 高德区名（如"越秀区"，区级精度显示）
      cachedAt: Date.now(),
    }));
  } catch (e) { /* 忽略存储失败 */ }
}

/* ---------- 高德 API Key 存取 ---------- */

function getAmapKey() {
  try {
    return (localStorage.getItem(AMAP_KEY_STORAGE) || '').trim();
  } catch (e) {
    return '';
  }
}

function saveAmapKey(key) {
  try {
    if (key) localStorage.setItem(AMAP_KEY_STORAGE, key.trim());
    else localStorage.removeItem(AMAP_KEY_STORAGE);
  } catch (e) { /* 忽略存储失败 */ }
}

/* ---------- 状态栏 UI ---------- */

function setWeatherStatus(msg, isError = false) {
  const el = document.querySelector('#weather-status');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

/* ---------- 代码映射 ---------- */

// 将 wttr.in 的 WWO 代码转为 { icon, text }（未知代码回退为通用图标）
function parseWWO(code) {
  const wmo = WWO_TO_WMO[Number(code)];
  return (wmo !== undefined && WEATHER_CODES[wmo]) || { icon: '🌡️', text: '未知' };
}

// 高德汉字天气现象 → 图标（高德直接返回中文描述，无需 WMO 映射）
function amapIcon(desc) {
  if (!desc) return '🌡️';
  if (desc.includes('晴')) return '☀️';
  if (desc.includes('云')) return '⛅';
  if (desc.includes('阴')) return '☁️';
  if (desc.includes('雾')) return '🌫️';
  if (desc.includes('雷')) return '⛈️';
  if (desc.includes('雹')) return '⛈️';
  if (desc.includes('雨')) return '🌧️';
  if (desc.includes('雪')) return '🌨️';
  if (desc.includes('风')) return '💨';
  return '🌡️';
}

// 校验 Open-Meteo current.time 是否过期（无法解析视为有效，交给后续字段校验）
function isWeatherStale(isoTime) {
  const t = Date.parse(isoTime);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t > WEATHER_MAX_AGE;
}

/* --------------------------------------------------------------------------
   多源天气获取
   背景：Open-Meteo 默认 best_match 在中国区使用 CMA（中国气象局 GFS GRAPES）
   模型，而 CMA 开放数据服务近期严重超负荷，导致中国区预报不可靠。
   对策：默认按 高德 → ECMWF → GFS → wttr.in 顺序回退（"自动"模式）；
   用户也可在设置面板指定单一数据源（state.weatherSource），此时只使用该源，
   失败则直接报错，不再静默回退。
   -------------------------------------------------------------------------- */

const WEATHER_SOURCES = [
  {
    id: 'amap',
    name: '高德',
    // 高德天气（中国区实况最准）：需 Web 服务 API Key（设置面板填入，存 localStorage）。
    // city 参数用城市 adcode：优先使用调用方 hint（如北京兜底直接给定 adcode），
    // 其次复用定位缓存，最后才调用高德逆地理编码获取。
    fetch: async (lat, lon, hint) => {
      const key = getAmapKey();
      if (!key) throw new Error('未配置高德 Key');

      // 1. 获取区级 adcode 与区名（区级精度：regeo 返回区级 adcode，如 440104=越秀区）
      let adcode = (hint && hint.adcode) || null;
      let district = (hint && hint.district) || null;
      const cached = loadCachedLocation();
      if (!adcode && cached && cached.adcode) adcode = cached.adcode;
      if (!district && cached && cached.district) district = cached.district;
      if (!adcode) {
        const reRes = await fetch(
          `https://restapi.amap.com/v3/geocode/regeo?location=${lon},${lat}&key=${encodeURIComponent(key)}&extensions=base`,
          { signal: withTimeout(8000) }
        );
        if (!reRes.ok) throw new Error(`regeo HTTP ${reRes.status}`);
        const reData = await reRes.json();
        if (reData.status !== '1' || !reData.regeocode) throw new Error(`regeo ${reData.info || 'fail'}`);
        const comp = reData.regeocode.addressComponent;
        adcode = comp && comp.adcode;
        district = comp && comp.district;
        if (!adcode) throw new Error('regeo no adcode');
        // 无条件回写缓存（含区级 adcode + 区名），下次免逆地理编码请求
        saveCachedLocation({
          lat, lon,
          city: (cached && cached.city) || district || null,
          adcode,
          district: district || null,
        });
      }

      // 2. 查询实况天气
      const url = `https://restapi.amap.com/v3/weather/weatherInfo?city=${encodeURIComponent(adcode)}&extensions=base&output=JSON&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { signal: withTimeout(8000) });
      if (!res.ok) throw new Error(`weather HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== '1') throw new Error(`weather ${data.info || 'fail'}`);
      const live = data.lives && data.lives[0];
      if (!live || live.temperature === undefined || live.temperature === null) throw new Error('weather bad payload');

      return {
        source: '高德',
        temp: Math.round(Number(live.temperature)),
        icon: amapIcon(live.weather),
        desc: live.weather || '未知',
        humidity: live.humidity !== undefined && live.humidity !== null ? Number(live.humidity) : undefined,
        windText: [live.winddirection, live.windpower ? `${live.windpower}级` : ''].filter(Boolean).join(' ') || undefined,
        city: live.city || district || null, // 区级 adcode 查询返回区名（如"越秀区"），精度到区
        adcode, district, // 供定位缓存回写，维持区级精度
      };
    },
  },
  {
    id: 'ecmwf',
    name: 'ECMWF',
    fetch: (lat, lon) => {
      // ECMWF IFS 0.25° 全球模型：中国区覆盖好、精度高，与 CMA 无关
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=ecmwf_ifs025&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=auto`;
      return fetch(url, { signal: withTimeout(8000) })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          const c = data.current;
          if (!c || typeof c.temperature_2m !== 'number') throw new Error('bad payload');
          if (isWeatherStale(c.time)) throw new Error('stale data');
          const codeInfo = WEATHER_CODES[c.weather_code] || { icon: '🌡️', text: '未知' };
          return {
            source: 'ECMWF',
            temp: Math.round(c.temperature_2m),
            icon: codeInfo.icon,
            desc: codeInfo.text,
            humidity: c.relative_humidity_2m,
            wind: Math.round(c.wind_speed_10m),
          };
        });
    },
  },
  {
    id: 'gfs',
    name: 'GFS',
    fetch: (lat, lon) => {
      // NOAA GFS 全球模型：同样不依赖 CMA，作为 ECMWF 的备选
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=gfs_seamless&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=auto`;
      return fetch(url, { signal: withTimeout(8000) })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          const c = data.current;
          if (!c || typeof c.temperature_2m !== 'number') throw new Error('bad payload');
          if (isWeatherStale(c.time)) throw new Error('stale data');
          const codeInfo = WEATHER_CODES[c.weather_code] || { icon: '🌡️', text: '未知' };
          return {
            source: 'GFS',
            temp: Math.round(c.temperature_2m),
            icon: codeInfo.icon,
            desc: codeInfo.text,
            humidity: c.relative_humidity_2m,
            wind: Math.round(c.wind_speed_10m),
          };
        });
    },
  },
  {
    id: 'wttr',
    name: 'wttr.in',
    fetch: (lat, lon) => {
      // wttr.in：免费、无需 Key、CORS 开放（Access-Control-Allow-Origin: *），最后兜底
      const url = `https://wttr.in/${lat},${lon}?format=j1&lang=zh`;
      return fetch(url, { signal: withTimeout(8000) })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          const cc = data && data.current_condition && data.current_condition[0];
          if (!cc || cc.temp_C === undefined || cc.temp_C === null) throw new Error('bad payload');
          const codeInfo = parseWWO(cc.weatherCode);
          return {
            source: 'wttr.in',
            temp: Math.round(Number(cc.temp_C)),
            icon: codeInfo.icon,
            desc: codeInfo.text,
            humidity: cc.humidity !== undefined && cc.humidity !== null ? Number(cc.humidity) : undefined,
            wind: cc.windspeedKmph !== undefined && cc.windspeedKmph !== null ? Math.round(Number(cc.windspeedKmph)) : undefined,
          };
        });
    },
  },
  {
    id: 'cma',
    name: 'CMA',
    autoSkip: true, // 自动模式不参与回退链（服务不稳定），仅用户手动选择时使用
    fetch: (lat, lon) => {
      // 中国气象局 CMA GRAPES 全球模型（Open-Meteo cma_grapes_global）。
      // ⚠ 此数据源可能不稳定（CMA 开放数据服务超负荷），由用户自行决定是否选用。
      // 排在 wttr.in 之后：自动模式下不参与回退链，仅用户手动选择时使用。
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&models=cma_grapes_global&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&timezone=auto`;
      return fetch(url, { signal: withTimeout(8000) })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          const c = data.current;
          if (!c || typeof c.temperature_2m !== 'number') throw new Error('bad payload');
          if (isWeatherStale(c.time)) throw new Error('stale data');
          const codeInfo = WEATHER_CODES[c.weather_code] || { icon: '🌡️', text: '未知' };
          return {
            source: 'CMA',
            temp: Math.round(c.temperature_2m),
            icon: codeInfo.icon,
            desc: codeInfo.text,
            humidity: c.relative_humidity_2m,
            wind: Math.round(c.wind_speed_10m),
          };
        });
    },
  },
];

// 按顺序尝试各天气源，第一个成功即返回；全部失败抛最后错误。
// 用户在设置面板指定了单一数据源（state.weatherSource）时，只尝试该源，
// 失败即抛出带数据源名的可读错误（不再静默回退，尊重用户选择）。
async function fetchWeather(lat, lon, hint) {
  const chosen = state.weatherSource;
  let lastErr = null;
  for (const src of WEATHER_SOURCES) {
    // auto 模式：跳过标记了 autoSkip 的源（如 CMA，服务不稳定，仅手动选择时使用）
    if (chosen === 'auto' && src.autoSkip) continue;
    if (chosen && chosen !== 'auto' && src.id !== chosen) continue;
    try {
      return await src.fetch(lat, lon, hint);
    } catch (e) {
      lastErr = e;
      if (chosen && chosen !== 'auto') {
        throw new Error(`数据源「${src.name}」不可用：${e.message}`);
      }
    }
  }
  if (lastErr) throw new Error(`天气数据源均不可用（${lastErr.message || '网络异常'}）`);
  throw new Error('没有可用的天气数据源');
}

// 将底层错误转成用户可读文案：中断/超时等网络类错误统一提示，其余透传具体原因
function friendlyError(e) {
  const msg = e && e.message ? e.message : '';
  if (!msg || /aborted|timeout|failed to fetch|networkerror/i.test(msg)) {
    return '天气服务请求失败，请检查网络';
  }
  return msg;
}

function fetchCityName(lat, lon) {
  // BigDataCloud 免费反向地理编码（无需 Key）
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;
  return fetch(url, { signal: withTimeout(8000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (!data) return null;
      return data.city || data.locality || data.principalSubdivision || null;
    })
    .catch(() => null);
}

/* ---------- 主流程：缓存位置优先；无缓存时才请求实时定位 ---------- */

async function updateWeather({ force = false } = {}) {
  // 5 分钟内不重复请求
  if (!force && state.weather && Date.now() - state.weatherTimestamp < 5 * 60 * 1000) {
    renderWeather(state.weather, state.location);
    return;
  }

  const cached = loadCachedLocation();

  if (cached) {
    // 有缓存：先用缓存位置展示天气；实时定位仅在首次自动加载时更新一次，
    // 之后自动刷新不再触发定位 → 不再重复弹出授权询问
    await fetchWeatherWithCachedLocation(cached);
    if (!geoPrompted) {
      geoPrompted = true;
      refreshLocationSilently(cached);
    }
  } else if (!geoPrompted) {
    // 无缓存且本会话尚未询问过：请求实时定位（首次自动加载，浏览器可能弹出授权）
    geoPrompted = true;
    await fetchWeatherWithLiveLocation();
  } else {
    // 无缓存且已询问过（被拒/失败）：默认显示北京天气，不再请求定位
    await fetchWeatherBeijing();
  }
}

// 无缓存：请求实时定位获取天气，成功后写入缓存。
// 定位失败时直接回退北京天气（自动路径不再尝试 IP 定位）。
async function fetchWeatherWithLiveLocation() {
  if (!navigator.geolocation) {
    setWeatherStatus('此浏览器不支持定位功能，显示北京天气…', true);
    await fetchWeatherBeijing();
    return;
  }

  setWeatherStatus('正在获取定位…');

  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
    });

    const { latitude, longitude } = pos.coords;
    state.location = { lat: latitude, lon: longitude };

    // 并行获取天气 + 城市名（高德源自带中文城市名时优先）
    const [weather, city] = await Promise.all([
      fetchWeather(latitude, longitude),
      fetchCityName(latitude, longitude),
    ]);

    state.weather = { ...weather, city: weather.city || city };
    state.weatherTimestamp = Date.now();
    saveCachedLocation({ lat: latitude, lon: longitude, city: state.weather.city, adcode: weather.adcode, district: weather.district }); // 写入定位缓存（含高德区级 adcode/区名）

    renderWeather(state.weather, state.location);

    setWeatherStatus(
      city
        ? `✓ 已更新：${city} ${weather.temp}°C ${weather.desc}（${weather.source}）`
        : `✓ 已更新：${latitude.toFixed(2)}, ${longitude.toFixed(2)} ${weather.temp}°C ${weather.desc}（${weather.source}）`
    );
  } catch (err) {
    // 自动路径定位失败：无法获取定位信息 → 北京兜底
    handleGeoError(err);
    if (!state.weather) await fetchWeatherBeijing();
  }
}

// 手动刷新：用户点击「刷新天气」时调用。
// 为让浏览器能在按钮点击的用户手势保护期内弹出定位授权询问，
// 此函数在同步阶段立即调用 navigator.geolocation.getCurrentPosition（获得 Promise），
// 随后才 await 缓存天气与定位结果；定位失败按 IP 定位 → 北京天气 逐级兜底。
async function refreshWeatherManual() {
  // 同步阶段立即发起定位请求，确保浏览器可弹出授权询问
  const geoPromise = new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('此浏览器不支持定位功能'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
  });

  const cached = loadCachedLocation();

  try {
    // 有缓存时先快速展示，避免等待定位时界面空白
    if (cached) {
      await fetchWeatherWithCachedLocation(cached);
    }

    const pos = await geoPromise;
    const { latitude, longitude } = pos.coords;
    state.location = { lat: latitude, lon: longitude };

    // 并行获取天气 + 城市名
    const [weather, city] = await Promise.all([
      fetchWeather(latitude, longitude),
      fetchCityName(latitude, longitude),
    ]);

    state.weather = { ...weather, city: weather.city || city };
    state.weatherTimestamp = Date.now();
    saveCachedLocation({ lat: latitude, lon: longitude, city: state.weather.city, adcode: weather.adcode, district: weather.district });
    renderWeather(state.weather, state.location);
    setWeatherStatus(
      city
        ? `✓ 已更新：${city} ${weather.temp}°C ${weather.desc}（${weather.source}）`
        : `✓ 已更新：${latitude.toFixed(2)}, ${longitude.toFixed(2)} ${weather.temp}°C ${weather.desc}（${weather.source}）`
    );
  } catch (err) {
    // 定位失败：IP 定位兜底 → 仍失败则回退北京天气
    const ok = await weatherByIP();
    if (!ok) {
      if (!state.weather) await fetchWeatherBeijing();
      else handleGeoError(err);
    }
  }
}

// 有缓存：直接基于缓存位置加载天气（即使定位权限被拒/关闭也能显示）
async function fetchWeatherWithCachedLocation(cached) {
  setWeatherStatus('正在加载上次定位的天气…');

  try {
    const cityPromise = cached.city
      ? Promise.resolve(cached.city)
      : fetchCityName(cached.lat, cached.lon);
    const [weather, city] = await Promise.all([
      fetchWeather(cached.lat, cached.lon),
      cityPromise,
    ]);

    state.location = { lat: cached.lat, lon: cached.lon };
    state.weather = { ...weather, city: weather.city || city || cached.city || null };
    state.weatherTimestamp = Date.now();

    renderWeather(state.weather, state.location);

    const name = city || cached.city;
    setWeatherStatus(
      name
        ? `✓ 已加载（上次定位 ${name}）：${weather.temp}°C ${weather.desc}（${weather.source}）`
        : `✓ 已加载（上次定位）：${cached.lat.toFixed(2)}, ${cached.lon.toFixed(2)} ${weather.temp}°C ${weather.desc}（${weather.source}）`
    );
  } catch (e) {
    // 天气服务请求失败：若内存仍有上次成功数据则保留展示
    if (state.weather) {
      renderWeather(state.weather, state.location);
      setWeatherStatus(`天气刷新失败（${friendlyError(e)}），当前显示上次数据`, true);
    } else {
      setWeatherStatus(friendlyError(e), true);
      renderWeatherFallback();
    }
  }
}

// 无法获取定位信息时的默认兜底：显示北京天气。
// 不写入定位缓存（避免污染用户真实定位缓存）；北京 adcode 通过 hint 直接传给高德源。
async function fetchWeatherBeijing() {
  setWeatherStatus('无法获取定位信息，显示北京天气…');
  try {
    const [weather, city] = await Promise.all([
      fetchWeather(BEIJING.lat, BEIJING.lon, { adcode: BEIJING.adcode, district: BEIJING.district }),
      Promise.resolve(BEIJING.city),
    ]);
    state.location = { lat: BEIJING.lat, lon: BEIJING.lon };
    state.weather = { ...weather, city: weather.city || BEIJING.city };
    state.weatherTimestamp = Date.now();
    renderWeather(state.weather, state.location);
    setWeatherStatus(`定位不可用，已显示北京天气：${state.weather.temp}°C ${state.weather.desc}（${state.weather.source}）`);
    return true;
  } catch (e) {
    setWeatherStatus(`天气服务请求失败：${friendlyError(e)}`, true);
    renderWeatherFallback();
    return false;
  }
}

// 后台静默尝试实时定位：成功且位置变化明显时更新缓存与天气
function refreshLocationSilently(cached) {
  if (!navigator.geolocation) return;

  const doRefresh = () => {
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      // 与缓存位置相距 < 约 1.1km（0.01°）时不刷新，避免无谓请求
      if (Math.abs(cached.lat - latitude) < 0.01 && Math.abs(cached.lon - longitude) < 0.01) {
        return;
      }
      try {
        const [weather, city] = await Promise.all([
          fetchWeather(latitude, longitude),
          fetchCityName(latitude, longitude),
        ]);
        state.location = { lat: latitude, lon: longitude };
        state.weather = { ...weather, city: weather.city || city };
        state.weatherTimestamp = Date.now();
        saveCachedLocation({ lat: latitude, lon: longitude, city: state.weather.city, adcode: weather.adcode, district: weather.district }); // 更新缓存（含高德区级 adcode/区名）
        renderWeather(state.weather, state.location);
        setWeatherStatus(
          city
            ? `✓ 已更新：${city} ${weather.temp}°C ${weather.desc}（${weather.source}）`
            : `✓ 已更新：${latitude.toFixed(2)}, ${longitude.toFixed(2)} ${weather.temp}°C ${weather.desc}（${weather.source}）`
        );
      } catch {
        // 后台刷新失败不影响已展示的缓存天气
      }
    }, (err) => {
      // 定位失败/被拒：保持缓存位置展示，仅提示
      if (err && err.code === 1) {
        setWeatherStatus(`已使用上次定位（${cached.city || '缓存位置'}），定位权限被拒绝`, true);
      }
    }, GEO_OPTIONS);
  };

  // 权限已明确拒绝时不发起无谓的定位请求
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' })
      .then((p) => {
        if (p.state === 'denied') {
          setWeatherStatus(`已使用上次定位（${cached.city || '缓存位置'}），定位权限被拒绝`, true);
        } else {
          doRefresh();
        }
      })
      .catch(() => doRefresh());
  } else {
    doRefresh();
  }
}

function handleGeoError(err) {
  // 定位失败（无缓存可用时的降级处理）
  if (err && err.code === 1) {
    setWeatherStatus('定位权限被拒绝。您可以通过浏览器地址栏的权限图标重新授权，或点击下方按钮重试。', true);
  } else if (err && err.code === 2) {
    setWeatherStatus('无法获取定位（位置不可用），请检查系统定位设置', true);
  } else if (err && err.code === 3) {
    setWeatherStatus('定位超时，请检查网络后重试', true);
  } else if (err && err.name === 'TimeoutError') {
    setWeatherStatus('天气服务请求超时，请检查网络', true);
  } else {
    setWeatherStatus(friendlyError(err), true);
  }
  // 内存中若仍有上次成功数据则保留展示
  if (state.weather) {
    renderWeather(state.weather, state.location);
  } else {
    renderWeatherFallback();
  }
}

function renderWeather(weather, location) {
  els.weatherIcon.textContent = weather.icon;
  const cityPart = weather.city ? `${weather.city} ` : '';
  els.weatherText.textContent = `${cityPart}${weather.temp}°C ${weather.desc}`;
  const parts = [`温度 ${weather.temp}°C · ${weather.desc}`];
  if (typeof weather.humidity === 'number') parts.push(`湿度 ${weather.humidity}%`);
  if (weather.windText) parts.push(`风 ${weather.windText}`);
  else if (typeof weather.wind === 'number') parts.push(`风速 ${weather.wind} km/h`);
  if (weather.source) parts.push(`数据源 ${weather.source}`);
  els.weatherText.title = parts.join('\n');
}

// 降级：无任何可用数据时显示占位
function renderWeatherFallback() {
  els.weatherIcon.textContent = '';
  els.weatherText.textContent = '天气不可用';
  els.weatherText.title = '无法获取天气信息';
}

// IP 定位降级（手动刷新时定位被拒/失败后的兜底：无需定位权限，按 IP 估算位置）
async function weatherByIP() {
  setWeatherStatus('尝试通过 IP 定位获取天气…');
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: withTimeout(8000) });
    if (!res.ok) throw new Error('ipapi failed');
    const data = await res.json();
    if (!data.latitude || !data.longitude) throw new Error('no coords');

    state.location = { lat: data.latitude, lon: data.longitude };
    const [weather, city] = await Promise.all([
      fetchWeather(data.latitude, data.longitude),
      Promise.resolve(data.city || data.region || null),
    ]);

    state.weather = { ...weather, city: weather.city || city };
    state.weatherTimestamp = Date.now();
    saveCachedLocation({ lat: data.latitude, lon: data.longitude, city: state.weather.city || data.city || data.region || null, adcode: weather.adcode, district: weather.district }); // IP 定位结果也写入缓存（含高德区级 adcode/区名）
    renderWeather(state.weather, state.location);

    setWeatherStatus(
      city
        ? `✓ 已通过 IP 定位更新：${city} ${weather.temp}°C ${weather.desc}（${weather.source}）`
        : `✓ 已通过 IP 定位更新：${weather.temp}°C ${weather.desc}（${weather.source}）`
    );
    return true;
  } catch (e) {
    setWeatherStatus('IP 定位也失败了，请检查网络', true);
    renderWeatherFallback();
    return false;
  }
}

/* ---------- 命名空间导出 ---------- */
window.ClockWeather = {
  loadCachedLocation,
  saveCachedLocation,
  getAmapKey,
  saveAmapKey,
  updateWeather,
  refreshWeatherManual,
  weatherByIP,
};

})();
