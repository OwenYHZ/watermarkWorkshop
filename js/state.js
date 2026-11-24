/*!
 * state.js — 默认参数、持久化、预设与自定义 logo 存储
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.WM = root.WM || {};
    root.WM.state = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'wm.settings.v1';
  var PRESET_KEY = 'wm.presets.v1';
  var THEME_KEY = 'wm.theme.v1';
  var EXIF_VIEW_KEY = 'wm.exif.v1';
  var EXPORT_DEFAULTS_KEY = 'wm.export.defaults.v1';
  var THEME_MODES = ['dark', 'light', 'system'];

  var DEFAULTS = {
    template: 'param-panel',
    fields: {
      brand: true,
      model: true,
      lens: true,
      focal: true,
      aperture: true,
      shutter: true,
      iso: true,
      date: true,
      time: true,
      location: true,
      custom: false,
      filename: false
    },
    content: {
      customText: '',
      separator: ' · ',
      dateStyle: 'iso',
      timeStyle: '24hms',
      showWeekday: false,
      showOffset: false,
      locationMode: 'coords',
      manualLocation: ''
    },
    text: {
      family: 'sans',
      size: 18,
      weight: 600,
      color: '#FFFFFF',
      opacity: 1,
      letterSpacing: 0.02,
      lineHeight: 1.32,
      align: 'left',
      autoContrast: true,
      shadow: true
    },
    layout: {
      anchor: 'bottom-right',
      margin: 34,
      maxWidth: 0.72
    },
    panel: {
      style: 'glass',
      color: '#000000',
      opacity: 0.42,
      blur: 18,
      radius: 12,
      paddingX: 24,
      paddingY: 16,
      borderColor: '#FFFFFF',
      borderOpacity: 0.16,
      borderWidth: 1.2,
      shadow: true
    },
    logo: {
      source: 'brand',
      brandId: 'auto',
      customLogoId: null,
      variant: 'auto',
      height: 40,
      gap: 16,
      opacity: 1,
      radius: 0,
      placement: 'left'
    },
    frame: {
      enabled: true,
      thickness: 18,
      color: '#FFFFFF',
      innerLine: false,
      innerLineColor: '#000000'
    },
    film: {
      type: 'color-negative',
      orientation: 'horizontal',
      holeColor: 'white',
      printStyle: 'pentax',
      stockId: 'portra400',
      frameNo: '12',
      textSize: 24,
      textOpacity: 1,
      edgeOpacity: 1
    },
    dv: {
      size: 15,
      opacity: 1,
      frame: true,
      frameMargin: 18,
      frameWidth: 4,
      padding: 34,
      rec: true,
      battery: true,
      batteryLevel: 78,
      resolution: true,
      resolutionLabel: '4K',
      exposure: true,
      exposurePosition: 'left',
      showDate: true,
      showTime: true,
      dateStyle: 'iso',
      timeStyle: '24hms',
      counter: true,
      counterText: '00:12:34',
      centerFocus: 'square',
      centerFocusSize: 18,
      grid: false,
      modeLabel: 'AUTO',
      showBrand: true
    },
    bottomBar: {
      height: 92,
      color: '#FFFFFF',
      textColor: '#111111',
      autoContrast: true,
      divider: true,
      dividerColor: '#D8D8D8',
      paddingX: 40,
      left1: 'model',
      left2: 'lens',
      right1: 'params',
      right2: 'datetime',
      logoPosition: 'before-right'
    },
    tile: {
      angle: -26,
      density: 1,
      opacity: 0.16,
      textSize: 20
    },
    output: {
      format: 'original',
      quality: 1,
      resize: 'original',
      longEdge: 2560,
      percent: 100,
      keepMetadata: true,
      flattenColor: '#FFFFFF',
      filenamePattern: '{name}_watermark',
      zipBatch: true,
      includeJson: false
    }
  };

  var TEMPLATES = [
    { id: 'param-panel', name: '参数卡', desc: '品牌型号 + 双栏参数表，玻璃底衬' },
    { id: 'polaroid', name: '拍立得', desc: '白边相纸，说明文字居中堆叠' },
    { id: 'bottom-bar', name: '底部白边', desc: '照片下方白色底栏，左下右下分组' },
    { id: 'film-frame', name: '胶片齿孔', desc: '扫描胶片边框，齿孔与边缘打印' },
    { id: 'dv-cam', name: 'DV 界面', desc: '摄像机 OSD：REC、电池、时间码' },
    { id: 'tile-copyright', name: '平铺版权', desc: '半透明斜排版权文字，防盗用' }
  ];

  var FILM_TYPES = [
    { value: 'bw-negative', label: '黑白底片' },
    { value: 'color-negative', label: '彩负底片' }
  ];

  var FILM_HOLE_COLORS = [
    { value: 'white', label: '白色' },
    { value: 'black', label: '黑色' }
  ];

  // 胶卷型号：按底片类型分组，方便以后继续加型号。
  var FILM_STOCKS = [
    { id: 'portra400', type: 'color-negative', label: 'KODAK PORTRA 400' },
    { id: 'hp5', type: 'bw-negative', label: 'ILFORD HP5 PLUS 400' }
  ];

  function filmStockOptions(type) {
    return FILM_STOCKS.filter(function (x) { return x.type === type; });
  }

  function defaultFilmStockId(type) {
    var list = filmStockOptions(type);
    return list.length ? list[0].id : '';
  }

  function filmStockById(id) {
    for (var i = 0; i < FILM_STOCKS.length; i++) {
      if (FILM_STOCKS[i].id === id) return FILM_STOCKS[i];
    }
    return null;
  }

  var FILM_PRINT_STYLES = [
    { value: 'none', label: '无打印' },
    { value: 'minolta', label: 'Minolta α9000 · 右侧参数' },
    { value: 'pentax', label: 'Pentax MZS · 上侧孔间' },
    { value: 'canon-date', label: 'Canon Prima 80u · 右下日期' }
  ];

  var FILM_ORIENTATIONS = [
    { value: 'horizontal', label: '横向齿孔（上下）' },
    { value: 'vertical', label: '竖向齿孔（左右）' }
  ];

  var DV_RESOLUTIONS = [
    { value: '8K', label: '8K' },
    { value: '4K', label: '4K' },
    { value: '2.7K', label: '2.7K' },
    { value: '1080P', label: '1080P' },
    { value: '720P', label: '720P' },
    { value: '480P', label: '480P' }
  ];

  var DV_FOCUS_STYLES = [
    { value: 'none', label: '无' },
    { value: 'square', label: '方形' },
    { value: 'circle', label: '圆形' },
    { value: 'combined', label: '方形 + 圆形' },
    { value: 'cross', label: '十字' },
    { value: 'brackets', label: '四角框' }
  ];

  var DV_EXPOSURE_POSITIONS = [
    { value: 'left', label: '左侧' },
    { value: 'right', label: '右侧' }
  ];

  var BOTTOM_SLOTS = [
    { value: 'none', label: '无' },
    { value: 'brand', label: '品牌' },
    { value: 'model', label: '型号' },
    { value: 'lens', label: '镜头' },
    { value: 'focal', label: '焦距' },
    { value: 'aperture', label: '光圈' },
    { value: 'shutter', label: '快门' },
    { value: 'iso', label: 'ISO' },
    { value: 'params', label: '参数组合' },
    { value: 'date', label: '日期' },
    { value: 'time', label: '时间' },
    { value: 'datetime', label: '日期时间' },
    { value: 'location', label: '地点' },
    { value: 'custom', label: '自定义文字' },
    { value: 'filename', label: '文件名' }
  ];

  var ANCHORS = [
    { value: 'top-left', label: '左上' }, { value: 'top-center', label: '上中' }, { value: 'top-right', label: '右上' },
    { value: 'middle-left', label: '左中' }, { value: 'middle-center', label: '居中' }, { value: 'middle-right', label: '右中' },
    { value: 'bottom-left', label: '左下' }, { value: 'bottom-center', label: '下中' }, { value: 'bottom-right', label: '右下' }
  ];

  var FONT_OPTIONS = [
    { value: 'sans', label: '无衬线（系统）' },
    { value: 'serif', label: '衬线 / 宋体' },
    { value: 'mono', label: '等宽 / 代码' }
  ];

  var DATE_STYLES = [
    { value: 'iso', label: '2024-05-01' },
    { value: 'slash', label: '2024/05/01' },
    { value: 'dot', label: '2024.05.01' },
    { value: 'cn', label: '2024年5月1日' },
    { value: 'mdy', label: '05/01/2024' },
    { value: 'dmy', label: '01/05/2024' }
  ];

  var TIME_STYLES = [
    { value: '24hms', label: '12:34:56（24 小时）' },
    { value: '24hm', label: '12:34（24 小时）' },
    { value: '12hms', label: '12:34:56 PM（12 小时）' },
    { value: '12hm', label: '12:34 PM（12 小时）' }
  ];

  var LOCATION_MODES = [
    { value: 'coords', label: '显示 GPS 坐标' },
    { value: 'manual', label: '使用手动地点' },
    { value: 'remote', label: '使用联网查询地点' },
    { value: 'none', label: '不显示地点' }
  ];

  function isPlainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function cloneDeep(value) {
    if (Array.isArray(value)) return value.map(cloneDeep);
    if (isPlainObject(value)) {
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = cloneDeep(value[key]); });
      return out;
    }
    return value;
  }

  function deepMerge(base, override) {
    var out = cloneDeep(base);
    if (!isPlainObject(out) || !isPlainObject(override)) {
      return override === undefined ? out : cloneDeep(override);
    }
    Object.keys(override).forEach(function (key) {
      var value = override[key];
      if (isPlainObject(out[key]) && isPlainObject(value)) out[key] = deepMerge(out[key], value);
      else if (value !== undefined) out[key] = cloneDeep(value);
    });
    return out;
  }

  function clampNum(v, min, max, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  var LEGACY_DATE_FORMATS = {
    datetime: { dateStyle: 'iso', timeStyle: '24hms' },
    minute: { dateStyle: 'iso', timeStyle: '24hm' },
    date: { dateStyle: 'iso', timeStyle: '24hms', timeOff: true },
    compact: { dateStyle: 'dot', timeStyle: '24hm' },
    cn: { dateStyle: 'cn', timeStyle: '24hm' }
  };

  function inOptions(options, value) {
    return options.some(function (o) { return o.value === value; });
  }

  function isHexColor(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
  }

  /**
   * 把旧版设置迁移到新结构，再与 DEFAULTS 合并。
   * 旧键：fields.datetime、content.dateFormat、dv.timestamp/dateFormat/focus、
   * film.border/holeScale/holeRatio、film.type=reversal、film.textMode=corner。
   */
  function migrateLegacy(raw) {
    var next = cloneDeep(raw || {});
    if (next.fields && typeof next.fields === 'object') {
      if (next.fields.date === undefined && next.fields.time === undefined && next.fields.datetime !== undefined) {
        next.fields.date = !!next.fields.datetime;
        next.fields.time = !!next.fields.datetime;
      }
      delete next.fields.datetime;
    }
    if (next.content && typeof next.content === 'object') {
      var legacy = next.content.dateFormat;
      var map = LEGACY_DATE_FORMATS[legacy];
      var contentLegacyOnly = next.content.dateStyle === undefined && next.content.timeStyle === undefined;
      if (map) {
        if (next.content.dateStyle === undefined) next.content.dateStyle = map.dateStyle;
        if (next.content.timeStyle === undefined) next.content.timeStyle = map.timeStyle;
        if (map.timeOff && contentLegacyOnly) {
          next.fields = next.fields || {};
          next.fields.time = false;
        }
      }
      delete next.content.dateFormat;
    }
    if (next.dv && typeof next.dv === 'object') {
      var dvLegacyOnly = next.dv.dateStyle === undefined && next.dv.timeStyle === undefined;
      if (next.dv.showDate === undefined && next.dv.showTime === undefined && next.dv.timestamp !== undefined) {
        next.dv.showDate = !!next.dv.timestamp;
        next.dv.showTime = !!next.dv.timestamp;
      }
      if (next.dv.frame === undefined && next.dv.focus !== undefined) {
        next.dv.frame = !!next.dv.focus;
      }
      var dvLegacy = next.dv.dateFormat;
      var dvMap = LEGACY_DATE_FORMATS[dvLegacy];
      if (dvMap) {
        if (next.dv.dateStyle === undefined) next.dv.dateStyle = dvMap.dateStyle;
        if (next.dv.timeStyle === undefined) next.dv.timeStyle = dvMap.timeStyle;
        if (dvMap.timeOff && dvLegacyOnly) next.dv.showTime = false;
      }
      delete next.dv.timestamp;
      delete next.dv.dateFormat;
      delete next.dv.focus;
      delete next.dv.exposureValue;
      // DV 的 OSD 固定为白色，旧的调色字段直接丢弃。
      delete next.dv.color;
    }
    if (next.film && typeof next.film === 'object') {
      if (next.film.type === 'reversal') next.film.type = 'color-negative';
      if (next.film.orientation === 'auto') next.film.orientation = 'horizontal';
      if (next.film.stock !== undefined) {
        var legacyStock = String(next.film.stock || '').toUpperCase();
        if (legacyStock.indexOf('HP5') >= 0) next.film.stockId = 'hp5';
        else if (legacyStock.indexOf('PORTRA') >= 0) next.film.stockId = 'portra400';
        delete next.film.stock;
      }
      if (next.film.printStyle === undefined && next.film.textMode !== undefined) {
        if (next.film.textMode === 'none') next.film.printStyle = 'none';
        else if (next.film.textMode === 'edge') next.film.printStyle = 'pentax';
        else next.film.printStyle = 'canon-date';
      }
      delete next.film.border;
      delete next.film.holeScale;
      delete next.film.holeRatio;
      delete next.film.textMode;
      delete next.film.imageAnchor;
      delete next.film.edgeFields;
      delete next.film.labelEvery;
      delete next.film.textColorMode;
      delete next.film.textColor;
    }
    return next;
  }

  function sanitize(input) {
    var s = deepMerge(DEFAULTS, migrateLegacy(input));
    var templateIds = TEMPLATES.map(function (t) { return t.id; });
    var migrated = { 'corner-badge': 'param-panel', 'film-bar': 'param-panel', 'frame-line': 'dv-cam' };
    if (migrated[s.template]) s.template = migrated[s.template];
    if (s.template !== '' && templateIds.indexOf(s.template) < 0) s.template = DEFAULTS.template;
    if (['original', 'jpeg', 'png', 'webp'].indexOf(s.output.format) < 0) s.output.format = 'original';
    if (['original', 'longEdge', 'percent'].indexOf(s.output.resize) < 0) s.output.resize = 'original';
    if (['none', 'solid', 'glass', 'gradient'].indexOf(s.panel.style) < 0) s.panel.style = 'glass';
    if (['brand', 'custom', 'none'].indexOf(s.logo.source) < 0) s.logo.source = 'brand';
    if (['auto', 'light', 'dark', 'brand'].indexOf(s.logo.variant) < 0) s.logo.variant = 'auto';
    if (['left', 'above', 'right'].indexOf(s.logo.placement) < 0) s.logo.placement = 'left';
    if (['sans', 'serif', 'mono'].indexOf(s.text.family) < 0) s.text.family = 'sans';
    if (['left', 'center', 'right'].indexOf(s.text.align) < 0) s.text.align = 'left';
    var anchorValues = ANCHORS.map(function (a) { return a.value; });
    if (anchorValues.indexOf(s.layout.anchor) < 0) s.layout.anchor = 'bottom-right';
    if (['coords', 'manual', 'remote', 'none'].indexOf(s.content.locationMode) < 0) s.content.locationMode = 'coords';
    if (!inOptions(DATE_STYLES, s.content.dateStyle)) s.content.dateStyle = 'iso';
    if (!inOptions(TIME_STYLES, s.content.timeStyle)) s.content.timeStyle = '24hms';
    if (!inOptions(FILM_TYPES, s.film.type)) s.film.type = 'color-negative';
    if (['horizontal', 'vertical'].indexOf(s.film.orientation) < 0) s.film.orientation = 'horizontal';
    if (!inOptions(FILM_HOLE_COLORS, s.film.holeColor)) s.film.holeColor = 'white';
    if (!inOptions(FILM_PRINT_STYLES, s.film.printStyle)) s.film.printStyle = 'pentax';
    var stockIds = filmStockOptions(s.film.type).map(function (x) { return x.id; });
    if (stockIds.indexOf(s.film.stockId) < 0) s.film.stockId = stockIds[0] || '';
    if (!inOptions(DV_RESOLUTIONS, s.dv.resolutionLabel)) s.dv.resolutionLabel = '4K';
    if (!inOptions(DV_FOCUS_STYLES, s.dv.centerFocus)) s.dv.centerFocus = 'square';
    if (!inOptions(DV_EXPOSURE_POSITIONS, s.dv.exposurePosition)) s.dv.exposurePosition = 'left';
    if (!inOptions(DATE_STYLES, s.dv.dateStyle)) s.dv.dateStyle = 'iso';
    if (!inOptions(TIME_STYLES, s.dv.timeStyle)) s.dv.timeStyle = '24hms';
    var slotValues = BOTTOM_SLOTS.map(function (o) { return o.value; });
    ['left1', 'left2', 'right1', 'right2'].forEach(function (key) {
      if (slotValues.indexOf(s.bottomBar[key]) < 0) s.bottomBar[key] = DEFAULTS.bottomBar[key];
    });
    if (['before-right', 'after-left'].indexOf(s.bottomBar.logoPosition) < 0) s.bottomBar.logoPosition = 'before-right';

    s.fields.date = s.fields.date !== false;
    s.fields.time = s.fields.time !== false;
    delete s.fields.datetime;
    s.text.size = clampNum(s.text.size, 4, 90, 18);
    s.text.weight = clampNum(s.text.weight, 100, 900, 600);
    s.text.opacity = clampNum(s.text.opacity, 0.05, 1, 1);
    s.text.letterSpacing = clampNum(s.text.letterSpacing, -0.1, 0.6, 0.02);
    s.text.lineHeight = clampNum(s.text.lineHeight, 0.9, 2.4, 1.32);
    s.layout.margin = clampNum(s.layout.margin, 0, 200, 34);
    s.layout.maxWidth = clampNum(s.layout.maxWidth, 0.2, 0.98, 0.72);
    s.panel.opacity = clampNum(s.panel.opacity, 0, 1, 0.42);
    s.panel.blur = clampNum(s.panel.blur, 0, 80, 18);
    s.panel.radius = clampNum(s.panel.radius, 0, 200, 12);
    s.panel.paddingX = clampNum(s.panel.paddingX, 0, 160, 24);
    s.panel.paddingY = clampNum(s.panel.paddingY, 0, 160, 16);
    s.panel.borderOpacity = clampNum(s.panel.borderOpacity, 0, 1, 0.16);
    s.panel.borderWidth = clampNum(s.panel.borderWidth, 0, 12, 1.2);
    s.logo.height = clampNum(s.logo.height, 4, 220, 40);
    s.logo.gap = clampNum(s.logo.gap, 0, 200, 16);
    s.logo.opacity = clampNum(s.logo.opacity, 0.05, 1, 1);
    s.logo.radius = clampNum(s.logo.radius, 0, 50, 0);
    s.frame.thickness = clampNum(s.frame.thickness, 0, 160, 18);
    s.film.textSize = clampNum(s.film.textSize, 8, 60, 24);
    s.film.textOpacity = clampNum(s.film.textOpacity, 0.35, 1, 1);
    s.film.edgeOpacity = clampNum(s.film.edgeOpacity, 0.05, 1, 1);
    s.film.stock = String(s.film.stock || '').slice(0, 60);
    s.film.frameNo = String(s.film.frameNo || '12').slice(0, 8);
    s.dv.frameWidth = clampNum(s.dv.frameWidth, 1, 12, 4);
    s.dv.size = clampNum(s.dv.size, 5, 40, 15);
    s.dv.opacity = clampNum(s.dv.opacity, 0.2, 1, 1);
    s.dv.frameMargin = clampNum(s.dv.frameMargin, 4, 80, 18);
    s.dv.padding = clampNum(s.dv.padding, 4, 150, 34);
    s.dv.batteryLevel = clampNum(s.dv.batteryLevel, 0, 100, 78);
    s.dv.centerFocusSize = clampNum(s.dv.centerFocusSize, 6, 45, 18);
    s.dv.counterText = String(s.dv.counterText || '00:12:34').slice(0, 20);
    s.dv.modeLabel = String(s.dv.modeLabel || 'AUTO').slice(0, 12);
    s.dv.resolutionLabel = String(s.dv.resolutionLabel || '4K').slice(0, 8);
    ['frame', 'rec', 'battery', 'resolution', 'exposure', 'showDate', 'showTime',
      'counter', 'grid', 'showBrand'].forEach(function (key) {
      s.dv[key] = !!s.dv[key];
    });
    s.bottomBar.height = clampNum(s.bottomBar.height, 36, 220, 92);
    s.bottomBar.paddingX = clampNum(s.bottomBar.paddingX, 0, 200, 40);
    s.bottomBar.divider = s.bottomBar.divider !== false;
    s.tile.angle = clampNum(s.tile.angle, -80, 80, -26);
    s.tile.density = clampNum(s.tile.density, 0.4, 3, 1);
    s.tile.opacity = clampNum(s.tile.opacity, 0.02, 0.8, 0.16);
    s.tile.textSize = clampNum(s.tile.textSize, 6, 60, 20);
    s.output.quality = clampNum(s.output.quality, 0.05, 1, 0.92);
    s.output.longEdge = clampNum(s.output.longEdge, 64, 20000, 2560);
    s.output.percent = clampNum(s.output.percent, 1, 400, 100);
    s.content.separator = String(s.content.separator == null ? ' · ' : s.content.separator).slice(0, 12);
    s.content.customText = String(s.content.customText || '').slice(0, 500);
    s.content.manualLocation = String(s.content.manualLocation || '').slice(0, 160);
    s.output.filenamePattern = String(s.output.filenamePattern || '{name}_watermark').slice(0, 160);
    return s;
  }

  function storageGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadSettings() {
    var raw = storageGet(STORAGE_KEY, null);
    var settings = sanitize(raw || {});
    // 一次性迁移：默认改为「原格式 + 100% 尺寸 + 100% 质量」。
    // 只做一次，之后用户自己改的设置不会被覆盖。
    if (storageGet(EXPORT_DEFAULTS_KEY, false) !== true) {
      settings.output.format = 'original';
      settings.output.quality = 1;
      settings.output.resize = 'original';
      storageSet(EXPORT_DEFAULTS_KEY, true);
      storageSet(STORAGE_KEY, settings);
    }
    return settings;
  }

  var saveTimer = null;
  function saveSettingsDebounced(settings, onError) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      if (!storageSet(STORAGE_KEY, settings) && onError) onError();
    }, 350);
  }

  function saveSettingsNow(settings) {
    return storageSet(STORAGE_KEY, settings);
  }

  function loadThemeMode() {
    var value = storageGet(THEME_KEY, 'light');
    return THEME_MODES.indexOf(value) >= 0 ? value : 'light';
  }

  function saveThemeMode(mode) {
    var clean = THEME_MODES.indexOf(mode) >= 0 ? mode : 'light';
    return storageSet(THEME_KEY, clean);
  }

  /* EXIF 显示范围开关：单独存储，不进入 settings / 预设结构 */
  function loadExifShowAll() {
    return storageGet(EXIF_VIEW_KEY, false) === true;
  }

  function saveExifShowAll(flag) {
    return storageSet(EXIF_VIEW_KEY, !!flag);
  }

  function listPresets() {
    var list = storageGet(PRESET_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function savePreset(name, settings) {
    var list = listPresets();
    var cleanName = String(name || '').trim().slice(0, 40) || '未命名预设';
    var existing = list.findIndex(function (p) { return p.name === cleanName; });
    var preset = { id: 'p_' + Date.now().toString(36), name: cleanName, settings: JSON.parse(JSON.stringify(settings)), createdAt: Date.now() };
    if (existing >= 0) {
      preset.id = list[existing].id;
      list[existing] = preset;
    } else {
      list.push(preset);
    }
    storageSet(PRESET_KEY, list);
    return preset;
  }

  function deletePreset(id) {
    var list = listPresets().filter(function (p) { return p.id !== id; });
    storageSet(PRESET_KEY, list);
    return list;
  }

  function resetSettings() {
    var s = sanitize({});
    storageSet(STORAGE_KEY, s);
    return s;
  }

  /* ------------------------------------------------------------------ *
   * 自定义 logo（IndexedDB，失败时退回内存）
   * ------------------------------------------------------------------ */
  var memoryLogos = [];
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }
      var req;
      try {
        req = indexedDB.open('wm-logos', 1);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('logos')) {
          db.createObjectStore('logos', { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
      req.onblocked = function () { reject(new Error('IndexedDB 被其他窗口占用')); };
    });
    return dbPromise;
  }

  function dbRequest(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('logos', mode);
        var store = tx.objectStore('logos');
        var req = fn(store);
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB 操作失败')); };
        if (req) req.onerror = function () { reject(req.error); };
      });
    });
  }

  async function listLogos() {
    try {
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 1500); });
      var list = await Promise.race([
        dbRequest('readonly', function (store) { return store.getAll(); }).catch(function () { return null; }),
        timeout
      ]);
      if (!Array.isArray(list)) return memoryLogos.slice();
      return list.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    } catch (e) {
      return memoryLogos.slice();
    }
  }

  async function saveLogo(input) {
    var logo = {
      id: 'logo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      name: String(input.name || '自定义 Logo').slice(0, 60),
      dataUrl: input.dataUrl,
      width: input.width || 0,
      height: input.height || 0,
      createdAt: Date.now()
    };
    if (!logo.dataUrl) throw new Error('logo 数据为空');
    try {
      await dbRequest('readwrite', function (store) { return store.put(logo); });
    } catch (e) {
      memoryLogos.push(logo);
      if (memoryLogos.length > 20) memoryLogos.shift();
      logo._memoryOnly = true;
    }
    return logo;
  }

  async function deleteLogo(id) {
    memoryLogos = memoryLogos.filter(function (l) { return l.id !== id; });
    try {
      await dbRequest('readwrite', function (store) { return store.delete(id); });
    } catch (e) { /* 内存模式下已删除 */ }
  }

  return {
    DEFAULTS: DEFAULTS,
    TEMPLATES: TEMPLATES,
    ANCHORS: ANCHORS,
    FONT_OPTIONS: FONT_OPTIONS,
    DATE_STYLES: DATE_STYLES,
    TIME_STYLES: TIME_STYLES,
    LOCATION_MODES: LOCATION_MODES,
    FILM_TYPES: FILM_TYPES,
    FILM_HOLE_COLORS: FILM_HOLE_COLORS,
    FILM_PRINT_STYLES: FILM_PRINT_STYLES,
    FILM_STOCKS: FILM_STOCKS,
    filmStockOptions: filmStockOptions,
    defaultFilmStockId: defaultFilmStockId,
    filmStockById: filmStockById,
    FILM_ORIENTATIONS: FILM_ORIENTATIONS,
    DV_RESOLUTIONS: DV_RESOLUTIONS,
    DV_FOCUS_STYLES: DV_FOCUS_STYLES,
    DV_EXPOSURE_POSITIONS: DV_EXPOSURE_POSITIONS,
    BOTTOM_SLOTS: BOTTOM_SLOTS,
    deepMerge: deepMerge,
    sanitize: sanitize,
    loadSettings: loadSettings,
    saveSettingsDebounced: saveSettingsDebounced,
    saveSettingsNow: saveSettingsNow,
    loadThemeMode: loadThemeMode,
    saveThemeMode: saveThemeMode,
    loadExifShowAll: loadExifShowAll,
    saveExifShowAll: saveExifShowAll,
    listPresets: listPresets,
    savePreset: savePreset,
    deletePreset: deletePreset,
    resetSettings: resetSettings,
    listLogos: listLogos,
    saveLogo: saveLogo,
    deleteLogo: deleteLogo
  };
});
