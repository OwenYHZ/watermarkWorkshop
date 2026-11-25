/*!
 * layout.js — 水印模板布局（纯函数）
 *
 * compose({imageW, imageH, meta, settings, brandName, logoAspect, logoEnabled,
 *          measureText, luminance, remoteLocation}) -> scene
 *
 * scene = {
 *   output: {w, h},            // 最终画布尺寸（拍立得会更大）
 *   imageRect: {x, y, w, h},   // 照片绘制位置
 *   background: {color} | null,
 *   ops: [ {kind:'rect'|'text'|'line'|'image'|'blur', ...} ],
 *   template, textColor, logoVariant
 * }
 *
 * 所有尺寸基于 u = imageW / 1000，因此预览与导出按各自宽度重算时比例一致。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./brands.js'));
  else {
    root.WM = root.WM || {};
    root.WM.layout = factory(root.WM.brands);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (brands) {
  'use strict';

  var FAMILIES = (brands && brands.FAMILIES) || {
    sans: 'system-ui, sans-serif',
    serif: 'Georgia, serif',
    mono: 'Consolas, monospace'
  };

  var FILM_PALETTES = {
    'bw-negative': {
      base: '#0B0B0B', hole: '#000000', text: '#FFFFFF',
      stock: 'ILFORD HP5 PLUS 400', stockShort: 'HP5 PLUS 400'
    },
    'color-negative': {
      base: '#0B0B0B', hole: '#000000', text: '#FFB000',
      stock: 'KODAK PORTRA 400', stockShort: 'PORTRA 400'
    }
  };

  // 胶片边字字体：真实 Portra 的 0 是干净椭圆，不带点也不带斜杠。
  var EDGE_FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  var EDGE_NUM_FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  var EDGE_STOCK_FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

  // 按胶卷型号定义边字样式；不同胶卷（即使同为彩负）互不套用。
  var FILM_EDGE_STYLES = {
    portra400: {
      type: 'color-negative',
      color: '#F5A623',
      name: 'KODAK PORTRA 400',
      // 第 1 孔出片号，第 9 孔开始下一片号 → 每 8 个孔一个循环。
      cycle: 8,
      stockHoles: [2, 5],
      aHole: 4,
      arrow: true,
      numberScale: 1.04,
      aScale: 0.84,
      stockScale: 1,
      tracking: 0.12,
      barcode1: '3232303031313031212021302030323',
      barcode2: '3232303031313031212031213030323'
    },
    generic: {
      type: null,
      color: '#F4F4F4',
      name: '',
      cycle: 8,
      stockHoles: [2, 5],
      aHole: 4,
      arrow: false,
      numberScale: 1,
      aScale: 0.9,
      stockScale: 1,
      tracking: 0.12,
      barcode1: '323230303131303121202',
      barcode2: '323230303131303121203'
    },
    hp5: {
      type: 'bw-negative',
      color: '#F2F2F2',
      name: 'ILFORD HP5 PLUS',
      pixel: true,
      cycle: 8,
      stockHoles: [0, 3],
      aHole: 4,
      arrow: false,
      numberScale: 1,
      aScale: 0.9,
      stockScale: 1,
      tracking: 0.12,
      barcode1: hp5Barcode(7),
      barcode2: hp5Barcode(31),
      barcodeSpan: 2.6,
      barcodeOffset: 0.75,
      numberPixel: 0.05
    }
  };

  // Ilford HP5 的条码比 Portra 密集得多：固定长度、0..3 高度，视觉上像细密的白条。
  function hp5Barcode(seed) {
    var out = '';
    var x = seed;
    for (var i = 0; i < 53; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      out += String(x % 4);
    }
    return out;
  }

  // DV 的 OSD 固定白色（真实摄像机 OSD 只有白色），不再提供调色。
  var DV_OSD_COLOR = '#FFFFFF';

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  function pad2(n) {
    var v = Math.round(Number(n) || 0);
    return v < 10 ? '0' + v : String(v);
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return { r: 128, g: 128, b: 128 };
    var h = hex.trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return { r: 255, g: 255, b: 255 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function colorLuminance(hex) {
    var c = hexToRgb(hex);
    var rr = c.r / 255;
    var gg = c.g / 255;
    var bb = c.b / 255;
    rr = rr <= 0.03928 ? rr / 12.92 : Math.pow((rr + 0.055) / 1.055, 2.4);
    gg = gg <= 0.03928 ? gg / 12.92 : Math.pow((gg + 0.055) / 1.055, 2.4);
    bb = bb <= 0.03928 ? bb / 12.92 : Math.pow((bb + 0.055) / 1.055, 2.4);
    return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
  }

  function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + clamp(alpha, 0, 1) + ')';
  }

  function shadeColor(hex, factor) {
    var c = hexToRgb(hex);
    function part(v) { return Math.round(clamp(v * factor, 0, 255)); }
    return '#' + [part(c.r), part(c.g), part(c.b)].map(function (v) {
      var s = v.toString(16);
      return s.length < 2 ? '0' + s : s;
    }).join('').toUpperCase();
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function stripBrandPrefix(text, brandName) {
    var value = String(text || '').trim();
    var brand = String(brandName || '').trim();
    if (!value || !brand) return value;
    var first = brand.split(/\s+/)[0] || brand;
    var re = new RegExp('^\\s*' + escapeRegExp(first) + '\\s*', 'i');
    return value.replace(re, '').trim();
  }

  function blendLuminance(fgLum, fgAlpha, bgLum) {
    return fgLum * fgAlpha + bgLum * (1 - fgAlpha);
  }

  function approxMeasure(text, spec) {
    var size = spec.size || 16;
    var total = 0;
    var chars = Array.from(String(text || ''));
    chars.forEach(function (ch) {
      var code = ch.codePointAt(0);
      if (code > 0x2e80) total += size;
      else if (ch === ' ') total += size * 0.3;
      else if (/[0-9]/.test(ch)) total += size * 0.56;
      else total += size * 0.55;
    });
    var tracking = spec.tracking || 0;
    return total + tracking * Math.max(0, chars.length - 1);
  }

  function cleanupSettings(s) {
    s = s || {};
    var text = s.text || {};
    var layout = s.layout || {};
    var panel = s.panel || {};
    var logo = s.logo || {};
    var frame = s.frame || {};
    var fields = s.fields || {};
    var content = s.content || {};
    var film = s.film || {};
    var dv = s.dv || {};
    var bottomBar = s.bottomBar || {};
    var tile = s.tile || {};
    return {
      template: s.template === '' ? '' : (s.template || 'param-panel'),
      fields: fields,
      text: {
        family: text.family || 'sans',
        size: num(text.size, 18),
        weight: num(text.weight, 600),
        color: text.color || '#FFFFFF',
        opacity: num(text.opacity, 1),
        letterSpacing: num(text.letterSpacing, 0.02),
        lineHeight: num(text.lineHeight, 1.32),
        align: text.align || 'left',
        autoContrast: text.autoContrast !== false,
        shadow: text.shadow !== false
      },
      layout: {
        anchor: layout.anchor || 'bottom-right',
        margin: num(layout.margin, 34),
        maxWidth: num(layout.maxWidth, 0.72)
      },
      panel: {
        style: panel.style || 'glass',
        color: panel.color || '#000000',
        opacity: num(panel.opacity, 0.42),
        blur: num(panel.blur, 18),
        radius: num(panel.radius, 12),
        paddingX: num(panel.paddingX, 24),
        paddingY: num(panel.paddingY, 16),
        borderColor: panel.borderColor || '#FFFFFF',
        borderOpacity: num(panel.borderOpacity, 0.16),
        borderWidth: num(panel.borderWidth, 1.2),
        shadow: panel.shadow !== false
      },
      logo: {
        source: logo.source || 'brand',
        variant: logo.variant || 'auto',
        height: num(logo.height, 40),
        gap: num(logo.gap, 16),
        opacity: num(logo.opacity, 1),
        radius: num(logo.radius, 0),
        placement: logo.placement || 'left'
      },
      frame: {
        enabled: frame.enabled !== false,
        thickness: num(frame.thickness, 18),
        color: frame.color || '#FFFFFF',
        innerLine: !!frame.innerLine,
        innerLineColor: frame.innerLineColor || '#000000'
      },
      content: {
        separator: content.separator != null ? content.separator : ' · ',
        dateStyle: content.dateStyle || 'iso',
        timeStyle: content.timeStyle || '24hms',
        showWeekday: !!content.showWeekday,
        showOffset: !!content.showOffset,
        manualLocation: content.manualLocation || '',
        locationMode: content.locationMode || 'coords',
        customText: content.customText || ''
      },
      film: {
        type: film.type || 'color-negative',
        orientation: film.orientation || 'horizontal',
        holeColor: film.holeColor || 'white',
        printStyle: film.printStyle || 'pentax',
        stockId: film.stockId || (film.type === 'bw-negative' ? 'hp5' : 'portra400'),
        frameNo: film.frameNo || '12',
        textSize: num(film.textSize, 24),
        textOpacity: num(film.textOpacity, 1),
        edgeOpacity: film.edgeOpacity == null ? 1 : film.edgeOpacity
      },
      dv: {
        size: num(dv.size, 15),
        opacity: num(dv.opacity, 1),
        frame: dv.frame !== false,
        frameMargin: num(dv.frameMargin, 18),
        frameWidth: num(dv.frameWidth, 4),
        padding: num(dv.padding, 34),
        rec: dv.rec !== false,
        battery: dv.battery !== false,
        batteryLevel: num(dv.batteryLevel, 78),
        resolution: dv.resolution !== false,
        resolutionLabel: dv.resolutionLabel || '4K',
        exposure: dv.exposure !== false,
          exposurePosition: dv.exposurePosition || 'left',
        showDate: dv.showDate !== false,
        showTime: dv.showTime !== false,
        dateStyle: dv.dateStyle || 'iso',
        timeStyle: dv.timeStyle || '24hms',
        counter: dv.counter !== false,
        counterText: dv.counterText || '00:12:34',
        centerFocus: dv.centerFocus || 'square',
        centerFocusSize: num(dv.centerFocusSize, 18),
        grid: !!dv.grid,
        modeLabel: dv.modeLabel || 'AUTO',
        showBrand: dv.showBrand !== false
      },
      bottomBar: {
        height: num(bottomBar.height, 92),
        color: bottomBar.color || '#FFFFFF',
        textColor: bottomBar.textColor || '#111111',
        autoContrast: bottomBar.autoContrast !== false,
        divider: bottomBar.divider !== false,
        dividerColor: bottomBar.dividerColor || '#D8D8D8',
        paddingX: num(bottomBar.paddingX, 40),
        left1: bottomBar.left1 || 'model',
        left2: bottomBar.left2 || 'lens',
        right1: bottomBar.right1 || 'params',
        right2: bottomBar.right2 || 'datetime',
        logoPosition: bottomBar.logoPosition || 'before-right'
      },
      tile: {
        angle: num(tile.angle, -26),
        density: num(tile.density, 1),
        opacity: num(tile.opacity, 0.16),
        textSize: num(tile.textSize, 20)
      }
    };
  }

  function makeMeta(meta) {
    meta = meta || {};
    return {
      model: meta.model || '',
      lens: meta.lens || '',
      focalText: meta.focalText || '',
      apertureText: meta.apertureText || '',
      shutterText: meta.shutterText || '',
      isoText: meta.isoText || '',
      date: meta.date || null,
      coordText: meta.coordText || '',
      artist: meta.artist || '',
      copyright: meta.copyright || '',
      filename: meta.filename || '',
      exposureComp: meta.exposureComp,
      exposureCompText: meta.exposureCompText || '',
      exposureMode: meta.exposureMode || '',
      exposureModeText: meta.exposureModeText || ''
    };
  }

  function contentTokens(meta, s, opts) {
    var m = makeMeta(meta);
    var fields = s.fields || {};
    var brandName = opts.brandName || '';
    var primary = '';
    if (fields.model && m.model) primary = m.model;
    else if (fields.brand && brandName && (!opts.logoEnabled || !opts.logoIsBrand)) primary = brandName;
    if (opts.logoEnabled) {
      primary = stripBrandPrefix(primary, brandName);
    } else if (fields.brand && brandName && primary &&
      primary.toLowerCase().indexOf(brandName.toLowerCase()) < 0) {
      primary = (brandName + ' ' + primary).trim();
    }

    var params = [];
    if (fields.focal && m.focalText) params.push(m.focalText);
    if (fields.aperture && m.apertureText) params.push(m.apertureText);
    if (fields.shutter && m.shutterText) params.push(m.shutterText);
    if (fields.iso && m.isoText) params.push(m.isoText);

    var hasLegacy = typeof opts.formatDate === 'function';
    function fallbackDate(d) { return d.y + '-' + pad2(d.m) + '-' + pad2(d.d); }
    function fallbackTime(d) { return pad2(d.h) + ':' + pad2(d.mi) + ':' + pad2(d.s); }
    var dateAll = '';
    var timeAll = '';
    if (m.date) {
      if (typeof opts.formatDateOnly === 'function') dateAll = opts.formatDateOnly(m.date);
      else if (hasLegacy) dateAll = opts.formatDate(m.date);
      else dateAll = fallbackDate(m.date);
      if (typeof opts.formatTimeOnly === 'function') timeAll = opts.formatTimeOnly(m.date);
      else if (!hasLegacy) timeAll = fallbackTime(m.date);
    }
    var dateText = fields.date !== false ? dateAll : '';
    var timeText = fields.time !== false ? timeAll : '';
    var dateTime = [dateText, timeText].filter(Boolean).join(' ');
    var dateTimeAll = [dateAll, timeAll].filter(Boolean).join(' ');

    var location = '';
    if (fields.location) {
      if (s.content.locationMode === 'manual') location = s.content.manualLocation || '';
      else if (s.content.locationMode === 'remote') location = opts.remoteLocation || '';
      else if (s.content.locationMode === 'coords') location = m.coordText || '';
    }
    return {
      primary: String(primary || '').trim(),
      params: params.join(s.content.separator),
      paramsAll: [m.focalText, m.apertureText, m.shutterText, m.isoText].filter(Boolean).join(s.content.separator),
      lens: fields.lens ? cleanLens(m.lens) : '',
      lensAll: cleanLens(m.lens),
      dateText: dateText,
      timeText: timeText,
      dateTime: dateTime,
      dateAll: dateAll,
      timeAll: timeAll,
      dateTimeAll: dateTimeAll,
      time: dateTime,
      location: location,
      custom: fields.custom ? String(s.content.customText || '').trim() : '',
      filename: fields.filename ? m.filename : '',
      meta: m
    };
  }

  function cleanLens(lens) {
    if (!lens) return '';
    return String(lens).replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  function bottomSlotText(token, tokens, s, opts) {
    var m = tokens.meta || {};
    switch (token) {
      case 'none': return '';
      case 'brand': return opts.brandName || '';
      case 'model': {
        var model = m.model || '';
        if (opts.logoEnabled) model = stripBrandPrefix(model, opts.brandName || '');
        if (!opts.logoEnabled && opts.brandName && model &&
          model.toLowerCase().indexOf(opts.brandName.toLowerCase()) < 0) {
          return (opts.brandName + ' ' + model).trim();
        }
        return model || (!opts.logoEnabled ? opts.brandName : '') || '';
      }
      case 'lens': return tokens.lens || m.lens || '';
      case 'focal': return m.focalText || '';
      case 'aperture': return m.apertureText || '';
      case 'shutter': return m.shutterText || '';
      case 'iso': return m.isoText || '';
      case 'params': {
        if (tokens.params) return tokens.params;
        return [m.focalText, m.apertureText, m.shutterText, m.isoText].filter(Boolean).join(s.content.separator);
      }
      case 'date': return tokens.dateText || '';
      case 'time': return tokens.timeText || '';
      case 'datetime': return tokens.dateTime || '';
      case 'location': return tokens.location || '';
      case 'custom': return String(s.content.customText || '').trim();
      case 'filename': return m.filename || '';
      default: return '';
    }
  }

  function tokenize(text) {
    var parts = String(text).match(/[\u2e80-\u9fff]|[^\s\u2e80-\u9fff]+|\s+/g) || [];
    return parts;
  }

  function wrapText(text, maxWidth, spec, measure) {
    if (!text) return [''];
    var tokens = tokenize(text);
    var lines = [];
    var current = '';
    tokens.forEach(function (tok) {
      var candidate = current + tok;
      if (current && measure(candidate, spec) > maxWidth) {
        lines.push(current.replace(/\s+$/, ''));
        current = tok.replace(/^\s+/, '');
      } else {
        current = candidate;
      }
    });
    if (current.trim()) lines.push(current.trim());
    return lines.length ? lines : [text];
  }

  function buildTextSpecs(tokens, s, u, opts) {
    var title = num(s.text.size, 15) * u;
    var param = title * 0.8;
    var small = title * 0.66;
    var specs = [];
    var sep = s.content.separator;
    function add(text, size, weight, opacity) {
      if (!text) return;
      specs.push({ text: text, size: size, weight: weight, opacity: opacity });
    }
    if (tokens.primary) add(tokens.primary, title, 700, 1);
    if (tokens.params) add(tokens.params, param, 500, 0.92);
    if (tokens.lens) add(tokens.lens, small, 500, 0.8);
    if (tokens.time && tokens.location) add(tokens.time + sep + tokens.location, small, 500, 0.85);
    else if (tokens.time) add(tokens.time, small, 500, 0.85);
    else if (tokens.location) add(tokens.location, small, 500, 0.85);
    if (tokens.custom) add(tokens.custom, small, 500, 0.9);
    if (tokens.filename) add(tokens.filename, small * 0.92, 500, 0.7);
    return specs;
  }

  function buildBlock(specs, family, lineHeight, measure, trackingEm) {
    var lines = [];
    var width = 0;
    var height = 0;
    specs.forEach(function (sp) {
      var tracking = sp.size * num(trackingEm, 0.02);
      var measureWeight = sp.measureWeight || sp.weight;
      var w = measure(sp.text, { size: sp.size, weight: measureWeight, family: family, tracking: tracking });
      lines.push({
        text: sp.text, size: sp.size, weight: sp.weight, opacity: sp.opacity,
        tracking: tracking, w: w, h: sp.size * lineHeight
      });
      width = Math.max(width, w);
      height += sp.size * lineHeight;
    });
    return { lines: lines, width: width, height: height };
  }

  function fitBlock(specs, maxWidth, family, lineHeight, measure, trackingEm) {
    var scale = 1;
    var block = buildBlock(specs, family, lineHeight, measure, trackingEm);
    var guard = 0;
    while (block.width > maxWidth && scale > 0.55 && guard++ < 6) {
      scale = Math.max(0.55, scale * Math.max(0.8, maxWidth / block.width * 0.97));
      var scaled = specs.map(function (sp) {
        return { text: sp.text, size: sp.size * scale, weight: sp.weight, opacity: sp.opacity, measureWeight: sp.measureWeight };
      });
      block = buildBlock(scaled, family, lineHeight, measure, trackingEm);
      if (scale <= 0.55) break;
    }
    return block;
  }

  function placeBox(w, h, anchor, marginX, marginY, W, H) {
    anchor = anchor || 'bottom-right';
    var x;
    var y;
    if (anchor.indexOf('left') >= 0) x = marginX;
    else if (anchor.indexOf('right') >= 0) x = W - marginX - w;
    else x = (W - w) / 2;
    if (anchor.indexOf('top') >= 0) y = marginY;
    else if (anchor.indexOf('bottom') >= 0) y = H - marginY - h;
    else y = (H - h) / 2;
    if (w < W) x = clamp(x, 0, W - w);
    if (h < H) y = clamp(y, 0, H - h);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  function textOp(text, x, y, size, weight, family, color, opacity, extra) {
    var op = {
      kind: 'text',
      text: text,
      x: x,
      y: y,
      size: size,
      weight: weight,
      family: family,
      color: color,
      opacity: opacity == null ? 1 : opacity,
      align: 'left',
      rotation: 0
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) op[k] = extra[k];
      }
    }
    return op;
  }

  function pushPanel(scene, box, s, u, textColor) {
    var padX = s.panel.style === 'none' ? 0 : s.panel.paddingX * u;
    var padY = s.panel.style === 'none' ? 0 : s.panel.paddingY * u;
    if (s.panel.style !== 'none') {
      var radius = s.panel.radius * u;
      if (s.panel.style === 'glass') {
        scene.ops.push({
          kind: 'blur',
          x: box.x, y: box.y, w: box.w, h: box.h,
          radius: s.panel.blur * u,
          cornerRadius: radius
        });
      }
      var fill;
      if (s.panel.style === 'gradient') {
        fill = {
          kind: 'linear',
          from: rgba(s.panel.color, s.panel.opacity),
          to: rgba(s.panel.color, s.panel.opacity * 0.15),
          direction: 'vertical'
        };
      } else {
        fill = rgba(s.panel.color, s.panel.opacity);
      }
      var stroke = s.panel.borderWidth > 0
        ? { color: rgba(s.panel.borderColor, s.panel.borderOpacity), width: s.panel.borderWidth * u }
        : null;
      scene.ops.push({
        kind: 'rect',
        x: box.x, y: box.y, w: box.w, h: box.h,
        radius: radius,
        fill: fill,
        stroke: stroke,
        shadow: s.panel.shadow
      });
    }
    return { x: box.x + padX, y: box.y + padY, padX: padX, padY: padY };
  }

  function pushTextBlock(scene, block, x, y, color, s, u, alignOverride) {
    var cursor = y;
    var align = alignOverride || s.text.align || 'left';
    block.lines.forEach(function (line) {
      var drawX = x;
      if (align === 'center') drawX = x + (block.width - line.w) / 2;
      else if (align === 'right') drawX = x + block.width - line.w;
      scene.ops.push(textOp(line.text, drawX, cursor + line.h / 2, line.size, line.weight,
        s.__family, color, line.opacity, {
          align: 'left',
          shadow: s.text.shadow,
          tracking: line.tracking
        }));
      cursor += line.h;
    });
    return cursor;
  }

  function logoOp(x, y, w, h, s) {
    return {
      kind: 'image',
      role: 'logo',
      x: x, y: y, w: w, h: h,
      opacity: s.logo.opacity,
      radius: h * Math.max(0, Math.min(50, s.logo.radius || 0)) / 100
    };
  }

  function computeContrast(s, template, photoLum) {
    var bgLum = photoLum;
    if (template === 'polaroid') {
      bgLum = colorLuminance(s.frame.color || '#FFFFFF');
    } else if (template === 'bottom-bar') {
      bgLum = colorLuminance(s.bottomBar.color || '#FFFFFF');
    } else if (template === 'film-bar') {
      bgLum = blendLuminance(colorLuminance(s.panel.color || '#000000'), 0.9, photoLum);
    } else if (s.panel.style !== 'none' && (template === 'corner-badge' || template === 'param-panel')) {
      bgLum = blendLuminance(colorLuminance(s.panel.color), clamp(s.panel.opacity, 0, 1), photoLum);
    }
    if (s.text.autoContrast) {
      return bgLum > 0.58 ? '#15181D' : '#FFFFFF';
    }
    return s.text.color;
  }

  function logoVariantFor(s, textColor) {
    if (s.logo.variant === 'auto') {
      return colorLuminance(textColor) > 0.5 ? 'light' : 'dark';
    }
    return s.logo.variant;
  }

  function baseScene() {
    return {
      output: { w: 0, h: 0 },
      imageRect: null,
      background: null,
      ops: [],
      template: '',
      textColor: '#FFFFFF',
      logoVariant: 'light'
    };
  }

  function applyContainer(scene, imageW, imageH) {
    scene.output = { w: imageW, h: imageH };
    scene.imageRect = { x: 0, y: 0, w: imageW, h: imageH };
    return scene;
  }

  /* ------------------------------------------------------------------ *
   * 模板：角落徽标
   * ------------------------------------------------------------------ */
  function templateCorner(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    applyContainer(scene, imageW, imageH);
    var textColor = scene.textColor;
    var sep = s.content.separator;
    var specs = buildTextSpecs(tokens, s, u);
    var logoH = opts.logoEnabled ? s.logo.height * u : 0;
    var logoW = opts.logoEnabled ? logoH * opts.logoAspect : 0;
    var gap = opts.logoEnabled ? s.logo.gap * u : 0;
    var marginX = s.layout.margin * u;
    var marginY = s.layout.margin * u;
    var padX = s.panel.style === 'none' ? 0 : s.panel.paddingX * u;
    var padY = s.panel.style === 'none' ? 0 : s.panel.paddingY * u;
    var placement = s.logo.placement || 'left';
    var maxTextW = Math.max(80 * u, imageW * s.layout.maxWidth - logoW - gap - padX * 2);
    var block = fitBlock(specs, maxTextW, family, s.text.lineHeight, measure, s.text.letterSpacing);
    var contentW = block.width;
    var contentH = block.height;
    if (opts.logoEnabled) {
      if (placement === 'above') {
        contentW = Math.max(contentW, logoW);
        contentH += logoH + gap * 0.8;
      } else {
        contentW += logoW + gap;
        contentH = Math.max(contentH, logoH);
      }
    }
    var box = {
      w: Math.min(imageW - marginX * 2, contentW + padX * 2),
      h: contentH + padY * 2
    };
    var pos = placeBox(box.w, box.h, s.layout.anchor, marginX, marginY, imageW, imageH);
    var inner = pushPanel(scene, pos, s, u, textColor);
    var contentX = inner.x;
    var contentY = inner.y;
    var textX = contentX;
    var textY = contentY;
    if (opts.logoEnabled) {
      if (placement === 'above') {
        scene.ops.push(logoOp(contentX, contentY, logoW, logoH, s));
        textY = contentY + logoH + gap * 0.8;
      } else if (placement === 'right') {
        scene.ops.push(logoOp(contentX + block.width + gap, contentY + (contentH - logoH) / 2, logoW, logoH, s));
      } else {
        scene.ops.push(logoOp(contentX, contentY + (contentH - logoH) / 2, logoW, logoH, s));
        textX = contentX + logoW + gap;
      }
    }
    pushTextBlock(scene, block, textX, textY, textColor, s, u);
  }

  /* ------------------------------------------------------------------ *
   * 模板：参数卡
   * ------------------------------------------------------------------ */
  function templateParamPanel(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    applyContainer(scene, imageW, imageH);
    var textColor = scene.textColor;
    var title = s.text.size * u;
    var valueSize = title * 0.76;
    var labelSize = title * 0.48;
    var smallSize = title * 0.6;
    var rowGap = title * 0.52;
    var dividerGap = title * 0.55;
    var maxContentW = imageW * clamp(s.layout.maxWidth, 0.2, 0.95);
    var logoH = opts.logoEnabled ? s.logo.height * u * 0.95 : 0;
    var logoW = opts.logoEnabled ? logoH * opts.logoAspect : 0;
    var gap = opts.logoEnabled ? s.logo.gap * u : 0;

    var headerMaxW = Math.max(60 * u, maxContentW - (opts.logoEnabled ? logoW + gap : 0));
    var headerBlock = fitBlock(
      tokens.primary ? [{ text: tokens.primary, size: title, weight: s.text.weight, opacity: 1 }] : [],
      headerMaxW, family, s.text.lineHeight, measure, s.text.letterSpacing
    );
    var headerLine = headerBlock.lines[0] || null;
    var headerH = Math.max(headerLine ? headerLine.h : 0, logoH);

    var rowDefs = [];
    if (s.fields.focal && tokens.meta.focalText) rowDefs.push(['FOCAL', tokens.meta.focalText]);
    if (s.fields.aperture && tokens.meta.apertureText) rowDefs.push(['APERTURE', tokens.meta.apertureText]);
    if (s.fields.shutter && tokens.meta.shutterText) rowDefs.push(['SHUTTER', tokens.meta.shutterText]);
    if (s.fields.iso && tokens.meta.isoText) rowDefs.push(['ISO', tokens.meta.isoText]);
    if (s.fields.lens && tokens.lens) rowDefs.push(['LENS', tokens.lens]);

    var labelColW = rowDefs.reduce(function (m, pair) {
      return Math.max(m, measure(pair[0], { size: labelSize, weight: 600, family: family, tracking: labelSize * 0.08 }));
    }, 0);
    var labelGap = title * 1.1;
    var valueMaxW = Math.max(40 * u, maxContentW - labelColW - labelGap);
    var rows = rowDefs.map(function (pair) {
      var vb = fitBlock([{ text: pair[1], size: valueSize, weight: s.text.weight, opacity: 1 }],
        valueMaxW, family, 1, measure, s.text.letterSpacing);
      var line = vb.lines[0] || { text: pair[1], size: valueSize, w: 0, h: valueSize };
      return {
        label: pair[0],
        value: line.text,
        labelW: measure(pair[0], { size: labelSize, weight: 600, family: family, tracking: labelSize * 0.08 }),
        valueSize: line.size,
        valueW: line.w,
        height: Math.max(valueSize, line.size) * Math.max(1.05, s.text.lineHeight) + rowGap
      };
    });
    var valueColW = rows.reduce(function (m, r) { return Math.max(m, r.valueW); }, 0);
    var rowsW = rows.length ? labelColW + labelGap + valueColW : 0;
    var rowsH = rows.reduce(function (a, r) { return a + r.height; }, 0);

    var footParts = [];
    if (tokens.time) footParts.push(tokens.time);
    if (tokens.location) footParts.push(tokens.location);
    if (tokens.custom) footParts.push(tokens.custom);
    if (tokens.filename) footParts.push(tokens.filename);
    var footText = footParts.join(s.content.separator);
    var footBlock = footText ? fitBlock([{ text: footText, size: smallSize, weight: 500, opacity: 1 }],
      maxContentW, family, 1, measure, 0.01) : { lines: [], width: 0, height: 0 };
    var footW = footBlock.lines.length ? footBlock.lines[0].w : 0;

    var contentW = Math.max(headerBlock.width + (opts.logoEnabled ? logoW + gap : 0), rowsW, footW);
    var contentH = headerH;
    if (rows.length) contentH += dividerGap * 2 + rowsH;
    if (footText) contentH += dividerGap * 1.2 + smallSize * 1.3;

    var padX = s.panel.style === 'none' ? 0 : s.panel.paddingX * u;
    var padY = s.panel.style === 'none' ? 0 : s.panel.paddingY * u;
    var pos = placeBox(contentW + padX * 2, contentH + padY * 2, s.layout.anchor,
      s.layout.margin * u, s.layout.margin * u, imageW, imageH);
    var inner = pushPanel(scene, pos, s, u, textColor);
    var x = inner.x;
    var y = inner.y;

    if (opts.logoEnabled) {
      scene.ops.push(logoOp(x, y + (headerH - logoH) / 2, logoW, logoH, s));
    }
    var titleX = x + (opts.logoEnabled ? logoW + gap : 0);
    if (headerLine) {
      scene.ops.push(textOp(headerLine.text, titleX, y + headerH / 2, headerLine.size, s.text.weight, family, textColor, 1, {
        shadow: s.text.shadow,
        tracking: headerLine.size * s.text.letterSpacing
      }));
    }
    y += headerH;

    if (rows.length) {
      y += dividerGap;
      scene.ops.push({
        kind: 'line', x1: x, y1: y, x2: x + contentW, y2: y,
        color: rgba(textColor, 0.18), width: Math.max(1, u * 1.2)
      });
      y += dividerGap;
      rows.forEach(function (r) {
        var centerY = y + r.height / 2;
        scene.ops.push(textOp(r.label, x, centerY, labelSize, 600, family, rgba(textColor, 0.62), 1, {
          tracking: labelSize * 0.08
        }));
        scene.ops.push(textOp(r.value, x + labelColW + labelGap, centerY, r.valueSize, s.text.weight, family, textColor, 1, {
          tracking: r.valueSize * s.text.letterSpacing
        }));
        y += r.height;
      });
    }

    if (footText && footBlock.lines.length) {
      y += dividerGap * 1.2;
      scene.ops.push({
        kind: 'line', x1: x, y1: y, x2: x + contentW, y2: y,
        color: rgba(textColor, 0.12), width: Math.max(1, u)
      });
      y += dividerGap * 0.5;
      var fline = footBlock.lines[0];
      scene.ops.push(textOp(fline.text, x, y + smallSize * 0.7, fline.size, 500, family, rgba(textColor, 0.82), 1, {
        shadow: s.text.shadow,
        tracking: fline.size * s.text.letterSpacing
      }));
    }
  }

  /* ------------------------------------------------------------------ *
   * 模板：细边框 + 信息条
   * ------------------------------------------------------------------ */
  function templateFrameLine(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    applyContainer(scene, imageW, imageH);
    var textColor = scene.textColor;
    var inset = Math.max(10 * u, s.frame.thickness * u);
    var lineWidth = Math.max(1.5, u * 2.2);
    if (s.frame.enabled) {
      scene.ops.push({
        kind: 'rect',
        x: inset / 2, y: inset / 2, w: imageW - inset, h: imageH - inset,
        radius: 0,
        fill: null,
        stroke: { color: s.frame.color, width: lineWidth },
        shadow: false
      });
      if (s.frame.innerLine) {
        var inset2 = inset + 6 * u;
        scene.ops.push({
          kind: 'rect',
          x: inset2, y: inset2, w: imageW - inset2 * 2, h: imageH - inset2 * 2,
          radius: 0, fill: null,
          stroke: { color: s.frame.innerLineColor, width: Math.max(1, u * 0.6) },
          shadow: false
        });
      }
    }

    var top = s.layout.anchor.indexOf('top') >= 0;
    var margin = s.layout.margin * u + inset;
    var title = s.text.size * u;
    var param = title * 0.78;
    var small = title * 0.62;
    var logoH = opts.logoEnabled ? s.logo.height * u * 0.85 : 0;
    var logoW = opts.logoEnabled ? logoH * opts.logoAspect : 0;
    var gap = opts.logoEnabled ? s.logo.gap * u : 0;

    var leftSpecs = [];
    if (tokens.primary) leftSpecs.push({ text: tokens.primary, size: title, weight: 700, opacity: 1 });
    if (tokens.params) leftSpecs.push({ text: tokens.params, size: param, weight: 500, opacity: 0.9 });
    if (tokens.lens) leftSpecs.push({ text: tokens.lens, size: small, weight: 500, opacity: 0.75 });
    var rightSpecs = [];
    if (tokens.time) rightSpecs.push({ text: tokens.time, size: small, weight: 500, opacity: 0.9 });
    if (tokens.location) rightSpecs.push({ text: tokens.location, size: small, weight: 500, opacity: 0.8 });
    if (tokens.custom) rightSpecs.push({ text: tokens.custom, size: small, weight: 500, opacity: 0.85 });
    if (tokens.filename) rightSpecs.push({ text: tokens.filename, size: small, weight: 500, opacity: 0.7 });

    var leftMax = imageW * 0.6;
    var rightMax = imageW * 0.34;
    var left = fitBlock(leftSpecs, leftMax, family, s.text.lineHeight, measure, s.text.letterSpacing);
    var right = fitBlock(rightSpecs, rightMax, family, s.text.lineHeight, measure, s.text.letterSpacing);
    var blockH = Math.max(left.height, right.height);
    var baseY = top ? margin : imageH - margin - blockH;

    if (opts.logoEnabled) {
      var logoX = margin;
      var logoY = top ? baseY : baseY - logoH - gap * 0.6;
      if (logoY < inset) logoY = inset;
      scene.ops.push(logoOp(logoX, logoY, logoW, logoH, s));
    }
    var textY = top ? baseY : baseY;
    if (opts.logoEnabled && top) textY = baseY + logoH + gap * 0.6;
    pushTextBlock(scene, left, margin, textY, textColor, s, u, 'left');
    // 右侧右对齐
    var rightX = imageW - margin;
    var cursor = textY;
    right.lines.forEach(function (line) {
      scene.ops.push(textOp(line.text, rightX, cursor + line.h / 2, line.size, line.weight, family,
        rgba(textColor, line.opacity), 1, {
          align: 'right',
          shadow: s.text.shadow,
          tracking: line.tracking
        }));
      cursor += line.h;
    });
  }

  /* ------------------------------------------------------------------ *
   * 模板：拍立得白边
   * ------------------------------------------------------------------ */
  function templatePolaroid(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    var paper = s.frame.color || '#FFFFFF';
    var border = Math.max(18 * u, s.frame.thickness * u * 1.6);
    var textColor = scene.textColor;
    var title = s.text.size * u;
    var padTop = 30 * u;
    var padBottom = 38 * u;

    var specs = [];
    if (tokens.primary) specs.push({ text: tokens.primary, size: title, weight: s.text.weight, measureWeight: 800, opacity: 1 });
    if (tokens.params) specs.push({ text: tokens.params, size: title * 0.78, weight: 500, opacity: 0.9 });
    if (tokens.lens) specs.push({ text: tokens.lens, size: title * 0.62, weight: 500, opacity: 0.78 });
    if (tokens.time || tokens.location) {
      var line = [tokens.time, tokens.location].filter(Boolean).join(s.content.separator);
      specs.push({ text: line, size: title * 0.62, weight: 500, opacity: 0.82 });
    }
    if (tokens.custom) specs.push({ text: tokens.custom, size: title * 0.62, weight: 500, opacity: 0.85 });
    if (tokens.filename) specs.push({ text: tokens.filename, size: title * 0.58, weight: 500, opacity: 0.7 });

    var maxCaptionW = imageW - border * 2 - 40 * u;
    var block = fitBlock(specs, maxCaptionW, family, s.text.lineHeight, measure, s.text.letterSpacing);
    var logoH = opts.logoEnabled ? s.logo.height * u * 0.9 : 0;
    var logoW = opts.logoEnabled ? logoH * opts.logoAspect : 0;
    var logoGap = opts.logoEnabled ? s.logo.gap * u : 0;

    var captionH = padTop + (opts.logoEnabled ? logoH + logoGap : 0) + block.height + padBottom;
    var outW = Math.round(imageW + border * 2);
    var outH = Math.round(imageH + border + captionH);
    scene.output = { w: outW, h: outH };
    scene.imageRect = { x: border, y: border, w: imageW, h: imageH };
    scene.background = { color: paper };
    var captionTop = border + imageH;
    if (opts.logoEnabled) {
      scene.ops.push(logoOp((outW - logoW) / 2, captionTop + padTop, logoW, logoH, s));
    }
    var textTop = captionTop + padTop + (opts.logoEnabled ? logoH + logoGap : 0);
    var cursor = textTop;
    block.lines.forEach(function (line) {
      scene.ops.push(textOp(line.text, outW / 2, cursor + line.h / 2, line.size, line.weight, family,
        rgba(textColor, line.opacity), 1, {
          align: 'center',
          shadow: false,
          tracking: line.tracking
        }));
      cursor += line.h;
    });
  }

  /* ------------------------------------------------------------------ *
   * 模板：电影画幅字幕条
   * ------------------------------------------------------------------ */
  function templateFilmBar(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    applyContainer(scene, imageW, imageH);
    var barColor = s.panel.color || '#000000';
    var barOpacity = 0.9;
    var textColor = scene.textColor;
    var title = s.text.size * u;
    var hTop = Math.max(50 * u, title * 3);
    var hBottom = Math.max(62 * u, title * 3.5);

    scene.ops.push({
      kind: 'rect', x: 0, y: 0, w: imageW, h: hTop,
      radius: 0, fill: rgba(barColor, barOpacity), stroke: null, shadow: false
    });
    scene.ops.push({
      kind: 'rect', x: 0, y: imageH - hBottom, w: imageW, h: hBottom,
      radius: 0, fill: rgba(barColor, barOpacity), stroke: null, shadow: false
    });
    scene.ops.push({
      kind: 'line', x1: 0, y1: imageH - hBottom, x2: imageW, y2: imageH - hBottom,
      color: rgba(textColor, 0.22), width: Math.max(1, u * 0.8)
    });

    var tracking = 0.14;
    var titleSpecs = tokens.primary ? [{ text: tokens.primary, size: title * 0.9, weight: 600, opacity: 0.96 }] : [];
    var titleBlock = buildBlock(titleSpecs, family, 1, measure, tracking);
    var logoH = opts.logoEnabled ? Math.min(hTop * 0.52, s.logo.height * u * 0.85) : 0;
    var logoW = opts.logoEnabled ? logoH * opts.logoAspect : 0;
    var groupW = titleBlock.width + (opts.logoEnabled ? logoW + 18 * u : 0);
    var startX = (imageW - groupW) / 2;
    if (opts.logoEnabled) {
      scene.ops.push(logoOp(startX, (hTop - logoH) / 2, logoW, logoH, s));
      startX += logoW + 18 * u;
    }
    if (titleBlock.lines.length) {
      scene.ops.push(textOp(titleBlock.lines[0].text, startX, hTop / 2, titleBlock.lines[0].size,
        600, family, rgba(textColor, 0.96), 1, { tracking: titleBlock.lines[0].size * tracking, shadow: false }));
    }

    var leftSpecs = [];
    if (tokens.params) leftSpecs.push({ text: tokens.params, size: title * 0.72, weight: 500, opacity: 0.9 });
    if (tokens.lens) leftSpecs.push({ text: tokens.lens, size: title * 0.56, weight: 500, opacity: 0.7 });
    var left = fitBlock(leftSpecs, imageW * 0.56, family, 1.35, measure, tracking * 0.5);
    var rightSpecs = [];
    if (tokens.time) rightSpecs.push({ text: tokens.time, size: title * 0.64, weight: 500, opacity: 0.9 });
    if (tokens.location) rightSpecs.push({ text: tokens.location, size: title * 0.56, weight: 500, opacity: 0.75 });
    if (tokens.custom) rightSpecs.push({ text: tokens.custom, size: title * 0.56, weight: 500, opacity: 0.8 });
    var right = fitBlock(rightSpecs, imageW * 0.34, family, 1.35, measure, tracking * 0.5);

    var leftX = s.layout.margin * u;
    var rightX = imageW - s.layout.margin * u;
    var maxH = Math.max(left.height, right.height);
    var leftTop = imageH - hBottom + (hBottom - maxH) / 2;
    var rightTop = leftTop;

    var cursor = leftTop;
    left.lines.forEach(function (line) {
      scene.ops.push(textOp(line.text, leftX, cursor + line.h / 2, line.size, line.weight, family,
        rgba(textColor, line.opacity), 1, { tracking: line.tracking, shadow: false }));
      cursor += line.h;
    });
    cursor = rightTop;
    right.lines.forEach(function (line) {
      scene.ops.push(textOp(line.text, rightX, cursor + line.h / 2, line.size, line.weight, family,
        rgba(textColor, line.opacity), 1, { align: 'right', tracking: line.tracking, shadow: false }));
      cursor += line.h;
    });
  }

  /* ------------------------------------------------------------------ *
   * 模板：平铺版权
   * ------------------------------------------------------------------ */
  function templateTile(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    applyContainer(scene, imageW, imageH);
    var textColor = scene.textColor;
    var base = String(s.content.customText || '').trim() || tokens.meta.copyright || tokens.meta.artist || tokens.meta.filename || 'ALL RIGHTS RESERVED';
    if (base.indexOf('©') < 0 && base.indexOf('(c)') < 0 && base.indexOf('Copyright') < 0) base = '© ' + base;
    var size = Math.max(10 * u, s.tile.textSize * u);
    var tracking = size * 0.1;
    var density = Math.max(0.4, s.tile.density || 1);
    var textW = measure(base, { size: size, weight: 600, family: family, tracking: tracking });
    var xStep = Math.max(textW + 130 * u, imageW * 0.34) / density;
    var yStep = size * 6.4 / density;
    var angle = (s.tile.angle || -26) * Math.PI / 180;
    var opacity = Math.max(0.02, s.tile.opacity) * s.text.opacity;
    var count = 0;
    for (var y = -imageH * 0.1; y < imageH * 1.1 && count < 180; y += yStep) {
      for (var x = -imageW * 0.25; x < imageW * 1.25 && count < 180; x += xStep) {
        scene.ops.push(textOp(base, x, y, size, 600, family, rgba(textColor, opacity), 1, {
          rotation: angle,
          shadow: false,
          tracking: tracking,
          align: 'left'
        }));
        count++;
      }
    }
    if (opts.logoEnabled) {
      var logoH = s.logo.height * u * 0.8;
      var logoW = logoH * opts.logoAspect;
      scene.ops.push(logoOp(imageW - s.layout.margin * u - logoW, imageH - s.layout.margin * u - logoH, logoW, logoH, s));
    }
  }

  /* ------------------------------------------------------------------ *
   * 模板：底部白边（左右分栏）
   * ------------------------------------------------------------------ */
  function templateBottomBar(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    var bar = s.bottomBar.height * u;
    var paper = s.bottomBar.color || '#FFFFFF';
    var textColor = s.bottomBar.autoContrast
      ? (colorLuminance(paper) > 0.58 ? '#15181D' : '#FFFFFF')
      : s.bottomBar.textColor;
    scene.textColor = textColor;
    scene.logoVariant = logoVariantFor(s, textColor);
    scene.output = { w: imageW, h: Math.round(imageH + bar) };
    scene.imageRect = { x: 0, y: 0, w: imageW, h: imageH };
    scene.background = { color: paper };

    var pad = s.bottomBar.paddingX * u;
    var sepGap = Math.max(8 * u, s.logo.gap * u * 0.55);
    var dividerW = Math.max(1, u * 0.8);
    var dividerH = bar * 0.38;
    var logoH = opts.logoEnabled ? Math.min(bar * 0.62, s.logo.height * u * 0.9) : 0;
    var logoW = opts.logoEnabled ? logoH * opts.logoAspect : 0;
    var reserve = opts.logoEnabled ? logoW + sepGap * 2 + dividerW : 0;
    var available = Math.max(60 * u, imageW - pad * 2 - reserve);
    var leftMax = Math.max(60 * u, available / 2);
    var rightMax = leftMax;

    function buildSlot(token, size, maxW) {
      var text = bottomSlotText(token, tokens, s, opts);
      if (!text) return null;
      var block = fitBlock([{ text: text, size: size, weight: 500, opacity: 1 }],
        maxW, family, 1, measure, s.text.letterSpacing);
      return block.lines[0] || null;
    }

    var line1Size = s.text.size * u * 1.02;
    var line2Size = s.text.size * u * 0.72;
    var left1 = buildSlot(s.bottomBar.left1, line1Size, leftMax);
    var left2 = buildSlot(s.bottomBar.left2, line2Size, leftMax);
    var right1 = buildSlot(s.bottomBar.right1, line1Size, rightMax);
    var right2 = buildSlot(s.bottomBar.right2, line2Size, rightMax);
    var leftLines = [left1, left2].filter(Boolean);
    var rightLines = [right1, right2].filter(Boolean);

    function stackHeight(lines) {
      return lines.reduce(function (a, l) { return a + l.h * s.text.lineHeight; }, 0);
    }
    function stackWidth(lines) {
      return lines.reduce(function (a, l) { return Math.max(a, l.w); }, 0);
    }

    var barTop = imageH;
    var leftH = stackHeight(leftLines);
    var rightH = stackHeight(rightLines);
    var leftW = stackWidth(leftLines);
    var rightW = stackWidth(rightLines);
    var leftY = barTop + (bar - leftH) / 2;
    var rightY = barTop + (bar - rightH) / 2;
    var leftX = pad;
    var rightRight = imageW - pad;

    var logoX = 0;
    var separatorX = null;
    if (opts.logoEnabled && logoH > 0) {
      var logoY = barTop + (bar - logoH) / 2;
      if (s.bottomBar.logoPosition === 'after-left') {
        logoX = (leftLines.length ? leftX + leftW + sepGap * 2 : leftX);
        if (rightLines.length) {
          logoX = Math.min(logoX, rightRight - rightW - sepGap * 2 - logoW);
        }
        logoX = Math.max(logoX, leftX);
        if (leftLines.length) separatorX = logoX - sepGap;
        scene.ops.push(logoOp(logoX, logoY, logoW, logoH, s));
      } else {
        logoX = rightRight - rightW - sepGap * 2 - logoW;
        if (leftLines.length) {
          logoX = Math.max(logoX, leftX + leftW + sepGap * 2);
        }
        if (rightLines.length) separatorX = logoX + logoW + sepGap;
        scene.ops.push(logoOp(logoX, logoY, logoW, logoH, s));
      }
    }

    var cursor = leftY;
    leftLines.forEach(function (line) {
      scene.ops.push(textOp(line.text, leftX, cursor + line.h / 2, line.size, 500, family, textColor, 0.94, {
        shadow: false,
        tracking: line.tracking
      }));
      cursor += line.h * s.text.lineHeight;
    });

    // 右侧文字直接画在「右内边距」上：align:'right' 已在渲染时向左展开，
    // 不能再减去一次 textW，否则会多出一个整块宽度的空缺。
    cursor = rightY;
    rightLines.forEach(function (line) {
      scene.ops.push(textOp(line.text, rightRight, cursor + line.h / 2, line.size, 500, family, textColor, 0.94, {
        align: 'right',
        shadow: false,
        tracking: line.tracking
      }));
      cursor += line.h * s.text.lineHeight;
    });

    // 只有 logo 与相邻文字同时存在时才画细短竖线；无 logo 时不画任何分隔线。
    if (opts.logoEnabled && s.bottomBar.divider && separatorX != null) {
      scene.ops.push({
        kind: 'line',
        x1: separatorX, y1: barTop + (bar - dividerH) / 2,
        x2: separatorX, y2: barTop + (bar + dividerH) / 2,
        color: s.bottomBar.dividerColor,
        width: dividerW
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 模板：胶片齿孔
   * ------------------------------------------------------------------ */
  function templateFilm(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    var pal = FILM_PALETTES[s.film.type] || FILM_PALETTES['color-negative'];
    var vertical = s.film.orientation === 'vertical';
    var acrossDim = vertical ? imageW : imageH;
    var alongDim = vertical ? imageH : imageW;

    // 所有尺寸以「24mm 画幅（沿齿孔方向的那条边）」为基准。
    // 打印字号因此只随画幅高度变化，与照片宽度无关。
    var mm = Math.max(0.001, acrossDim / 24);
    var filmAcross = 35 * mm;
    var border = 5.5 * mm;
    var innerGap = 0.6 * mm;
    var holeAlong = 1.98 * mm;
    var holeAcross = 2.8 * mm;
    var pitch = 4.75 * mm;
    // 扫描 135 片基时左右会多扫一点点：等效 24×36 尺寸下两端各 0.5mm。
    var endPad = 0.5 * mm;
    var alongTotal = alongDim + endPad * 2;
    // 齿孔间距是物理固定的：4.75mm（38mm / 8 孔），绝不随片长缩放。
    // 孔数按固定间距铺，两端多铺一孔，超出的部分由画布自然裁切。
    var step = pitch;
    var n = Math.min(240, Math.max(2, Math.ceil(alongTotal / pitch) + 1));

    // 统一在「横向胶片」坐标系里排版：宽 = 片长，高 = 35mm。
    // 竖向齿孔时最后把整份 op 旋转 90°（等价于整幅旋转竖拍）。
    var A = alongTotal;
    var F = filmAcross;
    var imgX = endPad;
    var imgY = border;
    var imgW = alongDim;
    var imgH = acrossDim;
    var ops = [];

    var style = FILM_EDGE_STYLES[s.film.stockId];
    if (!style) style = FILM_EDGE_STYLES.generic;
    if (style.type && style.type !== s.film.type) {
      style = FILM_EDGE_STYLES[s.film.type === 'bw-negative' ? 'hp5' : 'generic'];
    }
    var edgeColor = style.color;
    var printColor = edgeColor;
    // 胶片原有边字固定字号/不透明度；打印字号与透明度只影响下面的打印内容。
    var edgeOpacity = s.film.edgeOpacity == null ? 1 : Math.max(0.05, Math.min(1, s.film.edgeOpacity));
    var printOpacity = s.film.textOpacity;
    var holeFill = s.film.holeColor === 'black' ? '#000000' : '#FCFCFC';
    var hairline = Math.max(1, mm * 0.03);
    var holeStroke = s.film.holeColor === 'black'
      ? { color: 'rgba(255,255,255,0.22)', width: hairline }
      : { color: 'rgba(0,0,0,0.16)', width: hairline };

    scene.background = { color: pal.base };

    ops.push({
      kind: 'rect', x: imgX, y: imgY, w: imgW, h: imgH, radius: 0,
      fill: null, stroke: { color: 'rgba(255,255,255,0.18)', width: Math.max(1, mm * 0.036) }, shadow: false
    });

    var holeCenterFromImage = innerGap + holeAcross / 2;
    var topHoleCenter = imgY - holeCenterFromImage;
    var bottomHoleCenter = imgY + imgH + holeCenterFromImage;
    var holeRadius = Math.min(holeAlong, holeAcross) * 0.28;

    var holeOps = [];
    for (var i = 0; i < n; i++) {
      var centerAlong = (i + 0.5) * step;
      var hx = centerAlong - holeAlong / 2;
      holeOps.push({
        kind: 'rect', x: hx, y: topHoleCenter - holeAcross / 2, w: holeAlong, h: holeAcross,
        radius: holeRadius, fill: holeFill, stroke: holeStroke, shadow: false
      });
      holeOps.push({
        kind: 'rect', x: hx, y: bottomHoleCenter - holeAcross / 2, w: holeAlong, h: holeAcross,
        radius: holeRadius, fill: holeFill, stroke: holeStroke, shadow: false
      });
    }

    // 边字尺寸按真实孔距 P 标定（真实：标题 cap≈0.26P、顶号 0.24P、底号 0.29P、A 号 0.20P）。
    var edgeSize = step * 0.36;
    var printSize = Math.max(0.15 * mm, Math.min(s.film.textSize * filmAcross / 1000, holeAcross * 0.45));
    var outerBand = Math.max(1, border - innerGap - holeAcross);
    var outerCenter = outerBand / 2;

    function holeCenter(index) {
      return (index + 0.5) * step;
    }

    function bandY(top) {
      return top ? outerCenter : F - outerCenter;
    }

    function fitEdgeLine(text, size, maxW, family) {
      if (!text) return null;
      var block = fitBlock([{ text: text, size: size, weight: 700, opacity: 1 }],
        maxW, family || EDGE_FONT, 1, measure, style.tracking);
      var line = block.lines[0];
      return line && line.size >= size * 0.42 ? line : null;
    }

    function fitFilmLine(text, size, maxW) {
      return fitEdgeLine(text, size, maxW);
    }

    function pushFilmText(text, x, y, size, color, opacity, rotation, glow, align) {
      ops.push(textOp(text, x, y, size, 600, FAMILIES.mono, color, opacity, {
        align: align || 'center',
        shadow: false,
        shadowColor: glow ? rgba(color, 0.82) : undefined,
        shadowBlur: glow ? Math.max(1, size * 0.55) : 0,
        shadowOffsetY: 0,
        tracking: size * 0.1,
        rotation: rotation || 0
      }));
    }

    var PIXEL_GLYPHS = {
      ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
      'I': ['..#..', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
      'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
      'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
      'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
      'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
      'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
      'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
      'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
      'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
      'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
      'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
      '0': ['.###.', '#..##', '#.#.#', '##..#', '#...#', '#...#', '.###.'],
      '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
      '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
      '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
      '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
      '5': ['#####', '#....', '#....', '####.', '....#', '....#', '####.'],
      '6': ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
      '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
      '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
      '9': ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
      '>': ['#....', '##...', '###..', '####.', '###..', '##...', '#....']
    };

    // 5×7 点阵字：Ilford 的字母、数字与箭头都有明显的像素台阶。
    function pixelText(text, x, y, px, color, align) {
      var chars = String(text == null ? '' : text).toUpperCase().split('');
      var adv = 6 * px;
      var total = chars.length * adv - px;
      var cursor = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
      var top = y - 3.5 * px;
      chars.forEach(function (ch) {
        var glyph = PIXEL_GLYPHS[ch] || PIXEL_GLYPHS[' '];
        for (var row = 0; row < 7; row++) {
          var line = glyph[row];
          var col = 0;
          while (col < 5) {
            if (line.charAt(col) === '#') {
              var run = 1;
              while (col + run < 5 && line.charAt(col + run) === '#') run++;
              ops.push({
                kind: 'rect', x: cursor + col * px, y: top + row * px,
                w: run * px, h: px,
                radius: 0, fill: color, stroke: null, shadow: false
              });
              col += run;
            } else col++;
          }
        }
        cursor += adv;
      });
    }

    function pixelArrow(x, y, px) {
      var rows = ['#', '##', '###', '##', '#'];
      var top = y - 2.5 * px;
      for (var r = 0; r < rows.length; r++) {
        ops.push({
          kind: 'rect', x: x, y: top + r * px, w: rows[r].length * px, h: px,
          radius: 0, fill: edgeColor, stroke: null, shadow: false
        });
      }
    }

    function edgeTextAt(text, x, y, size, maxW, align, family, weight, tracking, scaleX, opacity) {
      var font = family || EDGE_FONT;
      var w = weight || 700;
      var trk = tracking == null ? style.tracking : tracking;
      var block = fitBlock([{ text: text, size: size, weight: w, opacity: 1 }],
        maxW, font, 1, measure, trk);
      var line = block.lines[0];
      if (!line || line.size < size * 0.42) return;
      // 故意不把两端收进来：贴边处被裁掉一部分才像真实扫描。
      ops.push(textOp(line.text, x, y, line.size, w, font, edgeColor,
        opacity == null ? edgeOpacity : opacity, {
        align: align || 'center',
        shadow: false,
        shadowBlur: 0,
        tracking: line.size * trk,
        rotation: 0,
        scaleX: scaleX || 1
      }));
    }

    // 真实 Portra 条码：列与列紧贴（无缝隙），0 与 1/2/3 同宽；
    // 条码带从孔下缘一直贴到片边，满高 / 上半 / 下半三档。
    function edgeBarcode(pattern, startX) {
      if (!pattern) return;
      var unit = (step * (style.barcodeSpan || 2.66)) / pattern.length;
      var holeBottom = F - outerBand;      // 下齿孔下边沿
      var bandTop = holeBottom - unit * 0.7; // 上半截只微微侵入齿孔
      var mid = (holeBottom + F) / 2;      // 1/2 分界 = 齿孔下边沿与片边的中点
      var paint = edgeOpacity >= 0.999 ? edgeColor : rgba(edgeColor, edgeOpacity);
      // 先铺一条 3333 的实心条，再用片基色遮出 0/1/2。
      ops.push({
        kind: 'rect', x: startX, y: bandTop, w: unit * pattern.length, h: F - bandTop,
        radius: 0, fill: paint, stroke: null, shadow: false
      });
      // 把相邻且遮罩范围相同的列合并成一整块，并左右各多盖 1px，
      // 避免两个遮罩相接处出现细亮缝（0/0、2/2 之间尤其明显）。
      var runs = [];
      for (var idx = 0; idx < pattern.length; idx++) {
        var code = pattern.charAt(idx);
        if (code === '3') { runs.push(null); continue; }
        var kind = code === '0' ? 'all' : code === '2' ? 'lower' : 'upper';
        var last = runs[runs.length - 1];
        if (last && last.kind === kind && last.end === idx - 1) {
          last.end = idx;
        } else {
          runs.push({ kind: kind, start: idx, end: idx });
        }
      }
      var bleed = Math.max(2, step * 0.012);
      runs.forEach(function (run) {
        if (!run) return;
        // 遮罩色与片基相同：上下边缘多盖一截，保证不会在条码顶/底漏出黄线。
        var y = run.kind === 'lower' ? mid - 1 : bandTop - bleed;
        var h = run.kind === 'lower' ? F - mid + 1 + bleed
          : run.kind === 'all' ? F - bandTop + bleed * 2 : mid - bandTop + bleed + 1;
        var x = startX + run.start * unit;
        var w = (run.end - run.start + 1) * unit;
        ops.push({
          kind: 'rect', x: x - 1, y: y, w: w + 2, h: h,
          radius: 0, fill: pal.base, stroke: null, shadow: false
        });
      });
    }

    function edgeArrow(rightX, y) {
      // 真实：总长 ≈0.77P，杆厚 ≈0.042P，头长 ≈0.25P，头高 ≈0.086P，尖头填充。
      var total = step * 0.77;
      var lw = Math.max(1, step * 0.036);
      var head = step * 0.23;
      var half = step * 0.038;
      var left = rightX - total;
      var mid = y;
      ops.push({
        kind: 'path',
        points: [
          [left, mid - lw / 2],
          [rightX - head, mid - lw / 2],
          [rightX - head, mid - half],
          [rightX, mid],
          [rightX - head, mid + half],
          [rightX - head, mid + lw / 2],
          [left, mid + lw / 2]
        ],
        fill: edgeOpacity >= 0.999 ? edgeColor : rgba(edgeColor, edgeOpacity),
        color: null,
        width: 0,
        shadow: false
      });
    }

    function frameStartInfo(raw) {
      var text = String(raw == null ? '' : raw).trim();
      var match = text.match(/(\d+)/);
      return { start: match ? parseInt(match[1], 10) : 12 };
    }

    function numericIso() {
      return String(tokens.meta.isoText || '').replace(/^iso\s*/i, '').trim();
    }
    function numericShutter() {
      return String(tokens.meta.shutterText || '').replace(/^1\//, '').replace(/s$/i, '').trim();
    }
    function apertureText() {
      var raw = String(tokens.meta.apertureText || '').trim();
      if (!raw) return '';
      return 'F' + raw.replace(/^f\s*\/?\s*/i, '');
    }

    // 按真实 Portra 135 的 9 孔循环：
    // 上：片号在首孔上方，胶卷名跨第 3–6 孔；
    // 下：片号在首孔下方，条码1跨 1–4 孔，A 片号在第 5 孔下方（更小 + 箭头），条码2跨 5–8 孔。
    var info = frameStartInfo(s.film.frameNo);
    var lastHole = Math.max(0, n - 1);
    var cycleLen = style.cycle * step;
    var cycles = Math.max(1, Math.ceil(alongTotal / cycleLen));
    var firstCycle = alongTotal > cycleLen * 1.05 ? -1 : 0;
    for (var k = firstCycle; k < cycles; k++) {
      var base = k * cycleLen;
      var num = ((info.start - 1 + k) % 36 + 36) % 36 + 1;
      if (!style.pixel) {
        edgeTextAt(String(num), base + holeCenter(0), bandY(true), step * 0.31, step * 0.95,
          'center', EDGE_NUM_FONT, 600, 0.02, 1.45);
      }
      var stockStartHole = style.stockHoles[0];
      var stockEndHole = style.stockHoles[1];
      var stockStart = base + holeCenter(stockStartHole) - holeAlong / 2;
      var stockEnd = base + holeCenter(stockEndHole) + holeAlong / 2;
      if (stockEnd > stockStart) {
        var stockSpan = stockEnd - stockStart;
        if (style.pixel) {
          // Ilford：点阵字从第 1 孔左缘开始，允许被片边裁切。
          pixelText(style.name, stockStart, bandY(true), step * 0.037,
            edgeOpacity >= 0.999 ? edgeColor : rgba(edgeColor, edgeOpacity), 'left');
        } else {
          var stockTarget = edgeSize * style.stockScale;
          var naturalWidth = measure(style.name, {
            size: stockTarget, weight: 700, family: EDGE_STOCK_FONT, tracking: stockTarget * 0.10
          });
          if (naturalWidth > 0) stockTarget *= Math.min(1.8, (stockSpan * 0.99) / naturalWidth);
          edgeTextAt(style.name, stockStart, bandY(true) + step * 0.03, stockTarget, stockSpan,
            'left', EDGE_STOCK_FONT, 700, 0.10);
        }
      }

      var bottomY = bandY(false);
      var numPaint = edgeOpacity >= 0.999 ? edgeColor : rgba(edgeColor, edgeOpacity);
      var bcUnit = style.barcode1
        ? (step * (style.barcodeSpan || 2.66)) / style.barcode1.length : step * 0.1;
      var bandTopY = F - outerBand - bcUnit * 0.7;
      var numPx = step * (style.numberPixel || 0.037);
      var pixelY = bandTopY + 3.5 * numPx;
      if (style.pixel) {
        pixelText(String(num), base + holeCenter(0), pixelY, numPx, numPaint, 'center');
      } else {
        edgeTextAt(String(num), base + holeCenter(0), bottomY, step * 0.33, step * 0.95,
          'center', EDGE_NUM_FONT, 600, 0.02, 1.45);
      }
      if (style.barcode1) {
        edgeBarcode(style.barcode1, base + holeCenter(0) + step * (style.barcodeOffset || 0.36), false);
      }
      var aHole = style.aHole;
      if (style.pixel) {
        var aPx = step * (style.numberPixel || 0.037);
        pixelArrow(base + holeCenter(aHole) - 0.22 * step, pixelY, aPx * 0.62);
        pixelText(String(num) + 'A', base + holeCenter(aHole) + 0.06 * step, pixelY,
          aPx, numPaint, 'center');
      } else {
        edgeTextAt(String(num) + 'A', base + holeCenter(aHole), bottomY,
          step * 0.22, step * 0.95, 'center', EDGE_NUM_FONT, 600, 0.01, 1.45);
        if (style.arrow) {
          edgeArrow(base + holeCenter(aHole) + step * 0.28, F - Math.max(1, step * 0.05));
        }
      }
      if (style.barcode2) {
        edgeBarcode(style.barcode2,
          base + holeCenter(style.aHole) + step * (style.barcodeOffset || 0.40), false);
      }
    }

    ops = ops.concat(holeOps);

    if (s.film.printStyle !== 'none') {
      if (s.film.printStyle === 'pentax') {
        // Pentax MZS：上侧每个齿孔间隙一个字段，顺序固定。
        var gapWidth = Math.max(0.15 * mm, step - holeAlong);
        var pentaxFields = [
          tokens.meta.exposureModeText || 'P',
          tokens.meta.exposureCompText || '±0.0',
          numericIso(),
          numericShutter(),
          apertureText()
        ];
        pentaxFields.forEach(function (text, slot) {
          if (!text || slot >= n - 1) return;
          var line = fitFilmLine(text, printSize, gapWidth * 0.92);
          if (!line) return;
          var pos = { x: (slot + 1) * step, y: topHoleCenter, rotation: 0 };
          pushFilmText(line.text, pos.x, pos.y, line.size, printColor, printOpacity,
            pos.rotation, true, 'center');
        });
      } else if (s.film.printStyle === 'minolta') {
        // Minolta α9000：拍摄参数竖排、紧贴画幅右缘、垂直居中。
        var minoltaText = [
          tokens.meta.focalText,
          apertureText(),
          numericShutter(),
          numericIso() ? 'ISO' + numericIso() : ''
        ].filter(Boolean).join(' ');
        var minoltaLine = fitFilmLine(minoltaText, printSize, imgH * 0.9);
        if (minoltaLine) {
          var minoltaGap = 0.35 * mm;
          pushFilmText(minoltaLine.text,
            imgX + imgW - minoltaGap - minoltaLine.size / 2,
            imgY + imgH / 2,
            minoltaLine.size, printColor, printOpacity, -Math.PI / 2, true, 'center');
        }
      } else if (s.film.printStyle === 'canon-date') {
        // Canon Prima 80u：右下角 'YY MM DD。
        var d = tokens.meta.date;
        if (d) {
          var dateText = "'" + String(d.y).slice(-2) + ' ' + pad2(d.m) + ' ' + pad2(d.d);
          var dateLine = fitFilmLine(dateText, printSize * 1.05, imgW * 0.45);
          if (dateLine) {
            var dateGapX = 3.2 * mm;
            var dateGapY = 1.8 * mm;
            pushFilmText(dateLine.text,
              imgX + imgW - dateGapX,
              imgY + imgH - dateGapY,
              dateLine.size, printColor, printOpacity, 0, true, 'right');
          }
        }
      }
    }

    if (!vertical) {
      scene.output = { w: Math.round(A), h: Math.round(F) };
      scene.imageRect = { x: imgX, y: imgY, w: imgW, h: imgH };
      for (var i0 = 0; i0 < ops.length; i0++) scene.ops.push(ops[i0]);
      return;
    }

    // 竖向齿孔：整幅旋转 90°（顺时针），孔位/边字/打印一起转。
    function mapPoint(x, y) { return [F - y, x]; }
    for (var j = 0; j < ops.length; j++) {
      var op = ops[j];
      var next = {};
      for (var key in op) {
        if (Object.prototype.hasOwnProperty.call(op, key)) next[key] = op[key];
      }
      if (op.kind === 'rect' || op.kind === 'blur' || op.kind === 'image') {
        var corner = mapPoint(op.x, op.y + op.h);
        next.x = corner[0];
        next.y = corner[1];
        next.w = op.h;
        next.h = op.w;
      } else if (op.kind === 'line') {
        var p1 = mapPoint(op.x1, op.y1);
        var p2 = mapPoint(op.x2, op.y2);
        next.x1 = p1[0];
        next.y1 = p1[1];
        next.x2 = p2[0];
        next.y2 = p2[1];
      } else if (op.kind === 'path') {
        next.points = (op.points || []).map(function (pt) { return mapPoint(pt[0], pt[1]); });
      } else if (op.kind === 'text') {
        var anchor = mapPoint(op.x, op.y);
        next.x = anchor[0];
        next.y = anchor[1];
        next.rotation = (op.rotation || 0) + Math.PI / 2;
      }
      scene.ops.push(next);
    }
    var imgCorner = mapPoint(imgX, imgY + imgH);
    scene.output = { w: Math.round(F), h: Math.round(A) };
    scene.imageRect = { x: imgCorner[0], y: imgCorner[1], w: imgH, h: imgW };
  }

  /* ------------------------------------------------------------------ *
   * 模板：DV 界面
   * ------------------------------------------------------------------ */
  function templateDv(scene, imageW, imageH, s, tokens, u, family, measure, opts) {
    applyContainer(scene, imageW, imageH);
    var color = DV_OSD_COLOR;
    var size = s.dv.size * u;
    var opacity = s.dv.opacity;
    var mono = FAMILIES.mono;
    scene.textColor = color;
    scene.logoVariant = logoVariantFor(s, color);

    var frameInset = s.dv.frame ? s.dv.frameMargin * u : 0;
    var lineH = size * 1.15;
    var contentInset = s.dv.frame
      ? Math.max(s.dv.padding * u, frameInset + lineH * 0.75)
      : s.dv.padding * u;
    var topCenter = contentInset + lineH / 2;
    var bottomCenter = imageH - contentInset - lineH / 2;

    function dvText(text, x, y, sz, align, op, extra) {
      if (!text) return;
      var payload = {
        align: align || 'left',
        shadow: false,
        tracking: sz * 0.04
      };
      if (extra) {
        Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
      }
      scene.ops.push(textOp(text, x, y, sz, 600, mono, color, op == null ? opacity : op, payload));
    }

    if (s.dv.grid) {
      for (var g = 1; g <= 2; g++) {
        var gy = imageH * g / 3;
        var gx = imageW * g / 3;
        scene.ops.push({ kind: 'line', x1: 0, y1: gy, x2: imageW, y2: gy, color: rgba(color, opacity), width: Math.max(1, u * 0.8) });
        scene.ops.push({ kind: 'line', x1: gx, y1: 0, x2: gx, y2: imageH, color: rgba(color, opacity), width: Math.max(1, u * 0.8) });
      }
    }

    // 取景框线：永远在所有 OSD 元素的外侧。
    // 每个角用「一条折线」（armEnd → corner → armEnd）绘制，lineJoin=miter，
    // 避免两条短直线在 alpha<1 时重叠出暗块与拼接痕迹。
    var arm = Math.min(34 * u, Math.min(imageW, imageH) * 0.06);
    var frameWidth = Math.max(1, s.dv.frameWidth * u);
    if (s.dv.frame) {
      var corners = [
        [frameInset, frameInset, 1, 1],
        [imageW - frameInset, frameInset, -1, 1],
        [frameInset, imageH - frameInset, 1, -1],
        [imageW - frameInset, imageH - frameInset, -1, -1]
      ];
      corners.forEach(function (c) {
        scene.ops.push({
          kind: 'path',
          points: [
            [c[0] + arm * c[2], c[1]],
            [c[0], c[1]],
            [c[0], c[1] + arm * c[3]]
          ],
          color: rgba(color, opacity),
          width: frameWidth,
          lineCap: 'butt',
          lineJoin: 'miter',
          miterLimit: 10,
          shadow: false
        });
      });
    }

    // 中心对焦框
    if (s.dv.centerFocus && s.dv.centerFocus !== 'none') {
      var focusSize = Math.min(imageW, imageH) * s.dv.centerFocusSize / 100;
      var fx = (imageW - focusSize) / 2;
      var fy = (imageH - focusSize) / 2;
      var focusStroke = { color: rgba(color, opacity), width: Math.max(1.2, u * 1.3) };
      var focusStyle = s.dv.centerFocus;
      if (focusStyle === 'square' || focusStyle === 'combined') {
        scene.ops.push({ kind: 'rect', x: fx, y: fy, w: focusSize, h: focusSize, radius: 0, fill: null, stroke: focusStroke, shadow: false });
      }
      if (focusStyle === 'circle' || focusStyle === 'combined') {
        var circleSize = focusStyle === 'combined' ? focusSize * 0.62 : focusSize;
        scene.ops.push({
          kind: 'rect', x: (imageW - circleSize) / 2, y: (imageH - circleSize) / 2,
          w: circleSize, h: circleSize, radius: circleSize / 2, fill: null, stroke: focusStroke, shadow: false
        });
      }
      if (focusStyle === 'cross') {
        var crossColor = rgba(color, opacity);
        var gap = focusSize * 0.14;
        var half = focusSize / 2;
        scene.ops.push({ kind: 'line', x1: imageW / 2 - half, y1: imageH / 2, x2: imageW / 2 - gap, y2: imageH / 2, color: crossColor, width: Math.max(1.2, u * 1.3) });
        scene.ops.push({ kind: 'line', x1: imageW / 2 + gap, y1: imageH / 2, x2: imageW / 2 + half, y2: imageH / 2, color: crossColor, width: Math.max(1.2, u * 1.3) });
        scene.ops.push({ kind: 'line', x1: imageW / 2, y1: imageH / 2 - half, x2: imageW / 2, y2: imageH / 2 - gap, color: crossColor, width: Math.max(1.2, u * 1.3) });
        scene.ops.push({ kind: 'line', x1: imageW / 2, y1: imageH / 2 + gap, x2: imageW / 2, y2: imageH / 2 + half, color: crossColor, width: Math.max(1.2, u * 1.3) });
      }
      if (focusStyle === 'brackets') {
        var bracketArm = focusSize * 0.28;
        var brace = [
          [fx, fy, 1, 1], [fx + focusSize, fy, -1, 1],
          [fx, fy + focusSize, 1, -1], [fx + focusSize, fy + focusSize, -1, -1]
        ];
        brace.forEach(function (b) {
          scene.ops.push({ kind: 'line', x1: b[0], y1: b[1], x2: b[0] + bracketArm * b[2], y2: b[1], color: rgba(color, opacity), width: Math.max(1.2, u * 1.3) });
          scene.ops.push({ kind: 'line', x1: b[0], y1: b[1], x2: b[0], y2: b[1] + bracketArm * b[3], color: rgba(color, opacity), width: Math.max(1.2, u * 1.3) });
        });
      }
    }

    // 左上：REC + 分辨率
    var recGroupW = 0;
    if (s.dv.rec) {
      // 红点直径比原来大 25%（原 0.62 → 0.775），视觉上更醒目。
      var dot = size * 0.775;
      scene.ops.push({
        kind: 'rect', x: contentInset, y: topCenter - dot / 2, w: dot, h: dot,
        radius: dot / 2, fill: '#FF3B30', stroke: null, shadow: false
      });
      var recX = contentInset + dot + size * 0.4;
      dvText('REC', recX, topCenter, size, 'left', opacity);
      var recW = measure('REC', { size: size, weight: 600, family: mono, tracking: size * 0.04 });
      recGroupW = dot + size * 0.4 + recW;
      if (s.dv.resolution) {
        dvText(s.dv.resolutionLabel, recX + recW + size * 0.7, topCenter, size * 0.72, 'left', opacity);
        recGroupW += size * 0.7 + measure(s.dv.resolutionLabel, { size: size * 0.72, weight: 600, family: mono, tracking: size * 0.03 });
      }
    } else if (s.dv.resolution) {
      dvText(s.dv.resolutionLabel, contentInset, topCenter, size * 0.72, 'left', opacity);
      recGroupW = measure(s.dv.resolutionLabel, { size: size * 0.72, weight: 600, family: mono });
    }

    // 右上：电量
    if (s.dv.battery) {
      var bw = size * 2.6;
      var bh = size * 1.15;
      var bx = imageW - contentInset - bw;
      var by = topCenter - bh / 2;
      scene.ops.push({
        kind: 'rect', x: bx, y: by, w: bw, h: bh, radius: size * 0.16,
        fill: null, stroke: { color: rgba(color, opacity), width: Math.max(1, u * 1.2) }, shadow: false
      });
      scene.ops.push({
        kind: 'rect', x: bx + bw, y: by + bh * 0.28, w: size * 0.22, h: bh * 0.44,
        radius: size * 0.05, fill: rgba(color, opacity), stroke: null, shadow: false
      });
      var fillW = Math.max(0, (bw - size * 0.32) * clamp(s.dv.batteryLevel / 100, 0, 1));
      if (fillW > 0) {
        scene.ops.push({
          kind: 'rect', x: bx + size * 0.16, y: by + size * 0.16, w: fillW, h: bh - size * 0.32,
          radius: size * 0.06, fill: rgba(color, opacity), stroke: null, shadow: false
        });
      }
      dvText(Math.round(s.dv.batteryLevel) + '%', bx - size * 0.4, topCenter, size * 0.72, 'right', opacity);
    }

    // 顶部正中：品牌 + 型号
    if (s.dv.showBrand && (opts.brandName || tokens.meta.model)) {
      var brandLine = [opts.brandName, tokens.meta.model].filter(Boolean).join(' ');
      var batteryReserve = 0;
      if (s.dv.battery) {
        var levelText = Math.round(s.dv.batteryLevel) + '%';
        batteryReserve = size * 2.6 + size * 0.22 + size * 0.4 +
          measure(levelText, { size: size * 0.72, weight: 600, family: mono });
      }
      var sideReserve = Math.max(recGroupW, batteryReserve);
      var brandMax = Math.max(50 * u, imageW - 2 * (contentInset + sideReserve + size * 0.7));
      var brandBlock = fitBlock([{ text: brandLine, size: size * 0.8, weight: 600, opacity: 1 }],
        brandMax, mono, 1, measure, 0.04);
      var brandLineOp = brandBlock.lines[0];
      if (brandLineOp) {
        dvText(brandLineOp.text, imageW / 2, topCenter, brandLineOp.size, 'center', opacity);
      }
    }

    // 曝光标尺
    if (s.dv.exposure) {
      var scaleH = Math.min(imageH * 0.36, 240 * u);
      var scaleX = s.dv.exposurePosition === 'right'
        ? imageW - contentInset - size * 0.8
        : contentInset + size * 0.8;
      var scaleTop = imageH / 2 - scaleH / 2;
      var scaleColor = rgba(color, opacity);
      scene.ops.push({ kind: 'line', x1: scaleX, y1: scaleTop, x2: scaleX, y2: scaleTop + scaleH, color: scaleColor, width: Math.max(1, u * 0.9) });
      for (var ev = -2; ev <= 2; ev++) {
        var tickY = scaleTop + (2 - ev) / 4 * scaleH;
        var tickLen = ev === 0 ? size * 0.85 : size * 0.42;
        scene.ops.push({ kind: 'line', x1: scaleX - tickLen / 2, y1: tickY, x2: scaleX + tickLen / 2, y2: tickY, color: scaleColor, width: Math.max(1, u * 0.9) });
      }
      var evValue = isFinite(tokens.meta.exposureComp) ? tokens.meta.exposureComp : 0;
      var markerY = scaleTop + (3 - clamp(evValue, -3, 3)) / 6 * scaleH;
      scene.ops.push({
        kind: 'rect', x: scaleX - size * 0.34, y: markerY - size * 0.14,
        w: size * 0.68, h: size * 0.28, radius: size * 0.05,
        fill: rgba(color, opacity), stroke: null, shadow: false
      });
    }

    // 底部左：日期 / 时间
    var dateText = s.dv.showDate ? tokens.dateAll : '';
    var timeText = s.dv.showTime ? tokens.timeAll : '';
    var stamp = [dateText, timeText].filter(Boolean).join(' ');
    if (stamp) {
      var stampBlock = fitBlock([{ text: stamp, size: size, weight: 600, opacity: 1 }],
        imageW * 0.48, mono, 1, measure, 0.04);
      var stampLine = stampBlock.lines[0];
      if (stampLine) dvText(stampLine.text, contentInset, bottomCenter, stampLine.size, 'left', opacity);
    }

    // 底部右：录像计数 + SP
    if (s.dv.counter) {
      var counterBlock = fitBlock([{ text: s.dv.counterText, size: size, weight: 600, opacity: 1 }],
        imageW * 0.34, mono, 1, measure, 0.04);
      var counterLine = counterBlock.lines[0];
      if (counterLine) {
        dvText(counterLine.text, imageW - contentInset, bottomCenter, counterLine.size, 'right', opacity);
        var spSize = size * 0.72;
        var spX = imageW - contentInset - counterLine.w - size * 0.5;
        if (spX > contentInset) dvText('SP', spX, bottomCenter, spSize, 'right', opacity);
      }
    }

    // 底部正中：模式
    if (s.dv.modeLabel) {
      var modeBlock = fitBlock([{ text: s.dv.modeLabel, size: size * 0.72, weight: 600, opacity: 1 }],
        imageW * 0.28, mono, 1, measure, 0.04);
      var modeLine = modeBlock.lines[0];
      if (modeLine) dvText(modeLine.text, imageW / 2, bottomCenter, modeLine.size, 'center', opacity);
    }
  }


  /* ------------------------------------------------------------------ *
   * 主入口
   * ------------------------------------------------------------------ */
  function compose(input) {
    input = input || {};
    var s = cleanupSettings(input.settings);
    var W = Math.max(1, Math.round(num(input.imageW, 1000)));
    var H = Math.max(1, Math.round(num(input.imageH, 1000)));
    var u = W / 1000;
    var family = FAMILIES[s.text.family] || FAMILIES.sans;
    s.__family = family;
    var measure = typeof input.measureText === 'function' ? input.measureText : approxMeasure;
    var photoLum = num(input.luminance, 0.5);
    var opts = {
      logoEnabled: input.logoEnabled !== false && s.logo.source !== 'none',
      logoIsBrand: s.logo.source === 'brand',
      logoAspect: Math.max(0.2, num(input.logoAspect, 3)),
      brandName: input.brandName || '',
      remoteLocation: input.remoteLocation || '',
      formatDate: input.formatDate || null,
      formatDateOnly: input.formatDateOnly || null,
      formatTimeOnly: input.formatTimeOnly || null
    };
    var tokens = contentTokens(input.meta, s, opts);
    tokens.meta = makeMeta(input.meta);

    var scene = baseScene();
    scene.template = s.template;
    // 允许不选模板：只输出原图，不叠加任何水印。
    if (!s.template) {
      applyContainer(scene, W, H);
      scene.meta = input.meta || {};
      scene.settings = s;
      scene.tokens = tokens;
      return scene;
    }
    scene.textColor = computeContrast(s, s.template, photoLum);
    scene.logoVariant = logoVariantFor(s, scene.textColor);

    switch (s.template) {
      case 'bottom-bar':
        templateBottomBar(scene, W, H, s, tokens, u, family, measure, opts);
        break;
      case 'film-frame':
        templateFilm(scene, W, H, s, tokens, u, family, measure, opts);
        break;
      case 'dv-cam':
        templateDv(scene, W, H, s, tokens, u, family, measure, opts);
        break;
      case 'polaroid':
        templatePolaroid(scene, W, H, s, tokens, u, family, measure, opts);
        break;
      case 'tile-copyright':
        templateTile(scene, W, H, s, tokens, u, family, measure, opts);
        break;
      case 'param-panel':
      default:
        templateParamPanel(scene, W, H, s, tokens, u, family, measure, opts);
        break;
    }

    // 兜底：确保输出与照片区域有效
    if (!scene.output || !scene.output.w || !scene.output.h) applyContainer(scene, W, H);
    if (!scene.imageRect) scene.imageRect = { x: 0, y: 0, w: W, h: H };
    scene.meta = input.meta || {};
    scene.settings = s;
    scene.tokens = tokens;
    return scene;
  }

  return {
    compose: compose,
    approxMeasure: approxMeasure,
    colorLuminance: colorLuminance,
    rgba: rgba,
    placeBox: placeBox,
    contentTokens: contentTokens,
    FAMILIES: FAMILIES
  };
});
