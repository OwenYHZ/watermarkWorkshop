/*!
 * meta.js — 元数据报告、XMP/IPTC/ICC 解析、EXIF 回写与 PNG 重建
 *
 *   WM.meta.buildReport(parseResult) -> {groups, summary, warnings, xmp, iptc, icc}
 *   WM.meta.formatDate(summary.date, mode, {weekday, offset})
 *   WM.meta.patchExif(tiffBytes, {orientation, width, height}) -> {bytes, changed}
 *   WM.meta.buildExifApp1(tiffBytes) -> Uint8Array | null
 *   WM.meta.injectJpegSegments(jpegBytes, segments) -> {bytes, warnings}
 *   WM.meta.rebuildPng(pngBytes, preservedChunks) -> {bytes, warnings}
 *   WM.meta.parsePngChunks(bytes)
 *   WM.meta.crc32(bytes)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./tags.js'), require('./exif.js'));
  } else {
    root.WM = root.WM || {};
    root.WM.meta = factory(root.WM.tags, root.WM.exif);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (tags, exifLib) {
  'use strict';

  var TEXT_DECODER_CACHE = {};

  function decoder(label) {
    if (!TEXT_DECODER_CACHE[label]) {
      try { TEXT_DECODER_CACHE[label] = new TextDecoder(label); } catch (e) { TEXT_DECODER_CACHE[label] = null; }
    }
    return TEXT_DECODER_CACHE[label];
  }

  function decodeSmart(bytes) {
    if (!bytes || !bytes.length) return '';
    var utf8 = decoder('utf-8');
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\u0000+$/, '');
    } catch (e) {
      var latin = decoder('windows-1252');
      if (latin) return latin.decode(bytes).replace(/\u0000+$/, '');
      if (utf8) return utf8.decode(bytes).replace(/\u0000+$/, '');
      var s = '';
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
  }

  function decodeUtf16(data, little) {
    var out = '';
    for (var i = 0; i + 1 < data.length; i += 2) {
      var code = little ? data[i] | (data[i + 1] << 8) : (data[i] << 8) | data[i + 1];
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out;
  }

  function u32be(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  function ascii(bytes, start, end) {
    var s = '';
    for (var i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function first(v) {
    return Array.isArray(v) && v.length ? v[0] : v;
  }

  function val(ifd, tag) {
    var e = ifd && ifd.map ? ifd.map[tag] : null;
    return e ? e.value : undefined;
  }

  function textVal(ifd, tag) {
    var v = val(ifd, tag);
    if (v == null) return '';
    return tags.textOf(v).trim();
  }

  function ratVal(ifd, tag) {
    var v = val(ifd, tag);
    if (v == null) return NaN;
    return tags.ratValue(v);
  }

  function numVal(ifd, tag) {
    var v = first(val(ifd, tag));
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && v.n != null) return tags.ratValue(v);
    var n = Number(v);
    return isFinite(n) ? n : NaN;
  }

  function formatBytes(n) {
    if (n == null || !isFinite(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 2 : 1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  /* ------------------------------------------------------------------ *
   * 日期
   * ------------------------------------------------------------------ */
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function parseDateParts(raw) {
    if (!raw) return null;
    var text = String(raw).trim();
    var m = text.match(/(\d{4})[:\-年](\d{1,2})[:\-月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?/);
    if (!m) return null;
    var parts = {
      y: Number(m[1]), m: Number(m[2]), d: Number(m[3]),
      h: m[4] != null ? Number(m[4]) : 0,
      mi: m[5] != null ? Number(m[5]) : 0,
      s: m[6] != null ? Number(m[6]) : 0,
      raw: String(raw)
    };
    var om = text.match(/(Z|[+-]\d{2}:?\d{2})\s*$/);
    if (om) {
      parts.offset = om[1] === 'Z' ? '+00:00' : om[1].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
    }
    if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31) return null;
    return parts;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function formatDate(parts, mode, opts) {
    if (!parts) return '';
    opts = opts || {};
    var date = new Date(parts.y, parts.m - 1, parts.d, parts.h || 0, parts.mi || 0, parts.s || 0);
    var y = parts.y;
    var yy = String(y).slice(-2);
    var out = '';
    switch (mode) {
      case 'date':
        out = y + '-' + pad2(parts.m) + '-' + pad2(parts.d);
        break;
      case 'compact':
        out = yy + '.' + pad2(parts.m) + '.' + pad2(parts.d) + ' ' + pad2(parts.h) + ':' + pad2(parts.mi);
        break;
      case 'cn':
        out = y + '年' + parts.m + '月' + parts.d + '日 ' + pad2(parts.h) + ':' + pad2(parts.mi);
        break;
      case 'minute':
        out = y + '-' + pad2(parts.m) + '-' + pad2(parts.d) + ' ' + pad2(parts.h) + ':' + pad2(parts.mi);
        break;
      case 'iso':
        out = y + '-' + pad2(parts.m) + '-' + pad2(parts.d) + 'T' + pad2(parts.h) + ':' + pad2(parts.mi) + ':' + pad2(parts.s);
        break;
      case 'datetime':
      default:
        out = y + '-' + pad2(parts.m) + '-' + pad2(parts.d) + ' ' + pad2(parts.h) + ':' + pad2(parts.mi) + ':' + pad2(parts.s);
    }
    if (opts.weekday) {
      out += ' ' + WEEKDAYS[date.getDay()];
    }
    if (opts.offset && parts.offset) {
      out += ' ' + parts.offset;
    }
    return out;
  }

  /**
   * 只格式化日期。style 来自 state.DATE_STYLES。
   */
  function formatDateStyle(parts, style, opts) {
    if (!parts) return '';
    opts = opts || {};
    var y = parts.y;
    var m = pad2(parts.m);
    var d = pad2(parts.d);
    var out;
    switch (style) {
      case 'slash': out = y + '/' + m + '/' + d; break;
      case 'dot': out = y + '.' + m + '.' + d; break;
      case 'cn': out = y + '年' + parts.m + '月' + parts.d + '日'; break;
      case 'mdy': out = m + '/' + d + '/' + y; break;
      case 'dmy': out = d + '/' + m + '/' + y; break;
      case 'iso':
      default:
        out = y + '-' + m + '-' + d;
        break;
    }
    if (opts.weekday) {
      var date = new Date(parts.y, parts.m - 1, parts.d);
      out += ' ' + WEEKDAYS[date.getDay()];
    }
    return out;
  }

  /**
   * 只格式化时间。style 来自 state.TIME_STYLES。
   */
  function formatTimeStyle(parts, style, opts) {
    if (!parts) return '';
    opts = opts || {};
    var h = parts.h || 0;
    var mi = pad2(parts.mi || 0);
    var s = pad2(parts.s || 0);
    var twelve = style === '12hms' || style === '12hm';
    var hh;
    if (twelve) {
      var suffix = h >= 12 ? 'PM' : 'AM';
      hh = pad2(h % 12 || 12);
      var withSeconds = style === '12hms';
      var result = hh + ':' + mi + (withSeconds ? ':' + s : '') + ' ' + suffix;
      if (opts.offset && parts.offset) result += ' ' + parts.offset;
      return result;
    }
    hh = pad2(h);
    var out = hh + ':' + mi + (style === '24hm' ? '' : ':' + s);
    if (opts.offset && parts.offset) out += ' ' + parts.offset;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * XMP
   * ------------------------------------------------------------------ */
  var RDF_CONTAINERS = { Alt: 1, Seq: 1, Bag: 1 };

  function localName(name) {
    var i = name.indexOf(':');
    return i >= 0 ? name.slice(i + 1) : name;
  }

  function elementChildren(el) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 1) out.push(el.childNodes[i]);
    }
    return out;
  }

  function textContent(el) {
    var s = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) s += n.nodeValue;
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function flattenXmpElement(el, prefix, out, depth) {
    if (!el || depth > 16 || out.length > 800) return;
    var name = el.nodeName || '';
    var key = prefix ? prefix + ' / ' + name : name;
    if (name === 'rdf:Description') {
      for (var a = 0; a < el.attributes.length; a++) {
        var attr = el.attributes[a];
        if (/^xmlns/i.test(attr.name) || attr.name === 'rdf:about' || attr.name === 'xml:lang') continue;
        out.push({ key: attr.name, value: attr.value });
      }
      var descKids = elementChildren(el);
      for (var d = 0; d < descKids.length; d++) flattenXmpElement(descKids[d], '', out, depth + 1);
      return;
    }
    var kids = elementChildren(el);
    if (!kids.length) {
      var text = textContent(el);
      if (text) out.push({ key: key, value: text });
      return;
    }
    if (RDF_CONTAINERS[localName(name)]) {
      var vals = [];
      for (var k = 0; k < kids.length; k++) {
        var v = textContent(kids[k]);
        if (!v) {
          var nested = elementChildren(kids[k]);
          for (var n = 0; n < nested.length; n++) {
            var nv = textContent(nested[n]);
            if (nv) v = nv;
          }
        }
        if (v) vals.push(v);
      }
      if (vals.length) {
        var parentKey = key.replace(/\s*\/\s*rdf:(Alt|Seq|Bag)$/i, '');
        out.push({ key: parentKey, value: vals.join(' | ') });
      }
      return;
    }
    for (var c = 0; c < kids.length; c++) flattenXmpElement(kids[c], key, out, depth + 1);
  }

  function decodeXmlEntities(s) {
    return String(s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); })
      .replace(/&#x([0-9a-f]+);/gi, function (m, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&amp;/g, '&');
  }

  function parseXmpFallback(xml) {
    var out = [];
    var attrRe = /([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;
    var m;
    while ((m = attrRe.exec(xml))) {
      if (/^xmlns/i.test(m[1]) || m[1] === 'rdf:about' || m[1] === 'xml:lang') continue;
      out.push({ key: m[1], value: decodeXmlEntities(m[2]) });
    }
    // RDF 容器：<exif:ISOSpeedRatings><rdf:Seq><rdf:li>800</rdf:li>...</rdf:Seq></exif:ISOSpeedRatings>
    var containerRe = /<([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)(?:\s[^>]*)?>\s*<rdf:(Alt|Seq|Bag)>([\s\S]*?)<\/rdf:\2>\s*<\/\1>/g;
    while ((m = containerRe.exec(xml))) {
      var inner = m[3];
      var vals = [];
      var liRe = /<rdf:li(?:\s[^>]*)?>([\s\S]*?)<\/rdf:li>/g;
      var lm;
      while ((lm = liRe.exec(inner))) {
        var v = decodeXmlEntities(lm[1]).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        if (v) vals.push(v);
      }
      if (vals.length) out.push({ key: m[1], value: vals.join(' | ') });
    }
    var leafRe = /<([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)(?:\s[^>]*)?>([^<]+)<\/\1>/g;
    while ((m = leafRe.exec(xml))) {
      if (m[1] === 'rdf:li') continue;
      var text = decodeXmlEntities(m[2]).replace(/\s+/g, ' ').trim();
      if (text) out.push({ key: m[1], value: text });
    }
    return out;
  }

  function parseXmp(xml) {
    if (!xml) return { props: [], error: '' };
    if (typeof DOMParser !== 'undefined') {
      try {
        var doc = new DOMParser().parseFromString(xml, 'application/xml');
        var errs = doc.getElementsByTagName('parsererror');
        if (!errs || !errs.length) {
          var props = [];
          var rootEl = doc.documentElement;
          if (rootEl) flattenXmpElement(rootEl, '', props, 0);
          var seen = {};
          props = props.filter(function (p) {
            var id = p.key + '\u0000' + p.value;
            if (seen[id]) return false;
            seen[id] = 1;
            return true;
          });
          return { props: props, error: '' };
        }
      } catch (e) { /* fall through */ }
    }
    var fallback = parseXmpFallback(xml);
    var seen2 = {};
    fallback = fallback.filter(function (p) {
      var id = p.key + '\u0000' + p.value;
      if (seen2[id]) return false;
      seen2[id] = 1;
      return true;
    });
    return { props: fallback, error: 'XML 解析器不可用或不支持该 XMP 结构，已使用文本回退解析' };
  }

  /* ------------------------------------------------------------------ *
   * XMP → 相机摘要
   * ------------------------------------------------------------------ */
  function xmpToMap(props) {
    var map = {};
    (props || []).forEach(function (p) {
      var key = String(p.key || '').trim();
      if (!key) return;
      if (map[key] == null || map[key] === '') map[key] = p.value;
      var normalized = key.replace(/\s*\/\s*rdf:(Alt|Seq|Bag)$/i, '').trim();
      if (normalized !== key && (map[normalized] == null || map[normalized] === '')) {
        map[normalized] = p.value;
      }
    });
    return map;
  }

  function xmpGet(map, keys) {
    if (!map) return '';
    for (var i = 0; i < keys.length; i++) {
      var v = map[keys[i]];
      if (v != null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function xmpNumber(value) {
    if (value == null) return NaN;
    var first = String(value).split('|')[0].trim();
    var m = first.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (m) {
      var den = Number(m[2]);
      return den ? Number(m[1]) / den : NaN;
    }
    var n = Number(first.replace(/[^\d.+\-eE]/g, ''));
    return isFinite(n) ? n : NaN;
  }

  function xmpIso(map) {
    var keys = [
      'exif:ISOSpeedRatings',
      'exif:PhotographicSensitivity',
      'exif:ISOSpeed',
      'exif:RecommendedExposureIndex',
      'exif:StandardOutputSensitivity'
    ];
    for (var i = 0; i < keys.length; i++) {
      var n = xmpNumber(map[keys[i]]);
      if (isFinite(n) && n > 0) return n;
    }
    return NaN;
  }

  function xmpGps(value, refHint) {
    var s = String(value == null ? '' : value).trim();
    if (!s) return { decimal: NaN, ref: '' };
    var ref = refHint || '';
    var rm = s.match(/([NSEW])\s*$/i);
    if (rm) {
      ref = rm[1].toUpperCase();
      s = s.slice(0, rm.index);
    }
    var parts = s.replace(/[°º'′"″]/g, ' ').replace(/,/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length || parts.length > 4) return { decimal: NaN, ref: ref };
    var d = Number(parts[0]);
    var m = parts.length > 1 ? Number(parts[1]) : 0;
    var sec = parts.length > 2 ? Number(parts[2]) : 0;
    if (!isFinite(d)) return { decimal: NaN, ref: ref };
    if (!isFinite(m)) m = 0;
    if (!isFinite(sec)) sec = 0;
    var dec = d + m / 60 + sec / 3600;
    if (ref === 'S' || ref === 'W') dec = -dec;
    return { decimal: dec, ref: ref };
  }

  function formatDms(lat, lon) {
    function one(v, pos, neg) {
      var abs = Math.abs(v);
      var d = Math.floor(abs);
      var mFull = (abs - d) * 60;
      var m = Math.floor(mFull);
      var s = (mFull - m) * 60;
      return d + '°' + m + '′' + (Math.round(s * 100) / 100) + '″ ' + (v >= 0 ? pos : neg);
    }
    if (!isFinite(lat) || !isFinite(lon)) return '';
    return one(lat, 'N', 'S') + ' ' + one(lon, 'E', 'W');
  }

  function applyXmpSummary(summary, map, parsed) {
    if (!summary || !map) return false;
    var used = false;
    var hasExif = !!(parsed && parsed.exif);

    var make = summary.make || xmpGet(map, ['tiff:Make', 'stCamera:Make']);
    if (!summary.make && make) {
      summary.make = make;
      used = true;
    }
    var modelFull = summary.modelFull || xmpGet(map, ['tiff:Model', 'stCamera:Model']);
    if (!summary.modelFull && modelFull) {
      summary.modelFull = modelFull;
      summary.model = stripMake(summary.make, modelFull);
      used = true;
    }

    var lens = summary.lens || xmpGet(map, ['exifEX:LensModel', 'aux:Lens', 'stCamera:Lens', 'exif:LensModel']);
    if (!summary.lens && lens) {
      summary.lens = lens;
      used = true;
    }
    var lensMake = summary.lensMake || xmpGet(map, ['aux:LensMake']);
    if (!summary.lensMake && lensMake) {
      summary.lensMake = lensMake;
      used = true;
    }

    var focal = summary.focal;
    if (!isFinite(focal)) {
      focal = xmpNumber(xmpGet(map, ['exif:FocalLength', 'stCamera:FocalLength']));
      if (isFinite(focal) && focal > 0) {
        summary.focal = focal;
        summary.focalText = Math.round(focal) + 'mm';
        used = true;
      }
    }
    var focal35 = summary.focal35;
    if (!isFinite(focal35)) {
      focal35 = xmpNumber(xmpGet(map, ['exif:FocalLengthIn35mmFilm']));
      if (isFinite(focal35) && focal35 > 0) {
        summary.focal35 = focal35;
        used = true;
      }
    }
    var aperture = summary.aperture;
    if (!isFinite(aperture) || aperture <= 0) {
      aperture = xmpNumber(xmpGet(map, ['exif:FNumber']));
      if (isFinite(aperture) && aperture > 0) {
        summary.aperture = aperture;
        summary.apertureText = 'f/' + (Math.round(aperture * 10) / 10).toString();
        used = true;
      }
    }
    var shutter = summary.shutter;
    if (!isFinite(shutter) || shutter <= 0) {
      shutter = xmpNumber(xmpGet(map, ['exif:ExposureTime']));
      if (isFinite(shutter) && shutter > 0) {
        summary.shutter = shutter;
        summary.shutterText = formatShutterCompact(shutter);
        used = true;
      }
    }
    var iso = summary.iso;
    if (!isFinite(iso) || iso <= 0) {
      iso = xmpIso(map);
      if (isFinite(iso) && iso > 0) {
        summary.iso = iso;
        summary.isoText = 'ISO ' + Math.round(iso);
        used = true;
      }
    }

    if (!summary.datetimeRaw) {
      var dateRaw = xmpGet(map, ['exif:DateTimeOriginal', 'photoshop:DateCreated', 'xmp:CreateDate']);
      if (dateRaw) {
        summary.datetimeRaw = dateRaw;
        summary.date = parseDateParts(dateRaw);
        used = true;
      }
    }
    if (!summary.offset) {
      var offset = xmpGet(map, ['exif:OffsetTimeOriginal', 'exif:OffsetTime', 'exif:OffsetTimeDigitized']);
      if (!offset && summary.date && summary.date.offset) offset = summary.date.offset;
      if (offset) {
        summary.offset = offset;
        used = true;
      }
    }

    if (!isFinite(summary.latitude) || !isFinite(summary.longitude)) {
      var latVal = xmpGet(map, ['exif:GPSLatitude']);
      var lonVal = xmpGet(map, ['exif:GPSLongitude']);
      var latRef = xmpGet(map, ['exif:GPSLatitudeRef']);
      var lonRef = xmpGet(map, ['exif:GPSLongitudeRef']);
      if (latVal && lonVal) {
        var lat = xmpGps(latVal, latRef).decimal;
        var lon = xmpGps(lonVal, lonRef).decimal;
        if (isFinite(lat) && isFinite(lon)) {
          summary.latitude = lat;
          summary.longitude = lon;
          summary.coordText = formatCoord(lat, lon);
          summary.dmsText = formatDms(lat, lon);
          used = true;
        }
      }
    }
    if (!isFinite(summary.altitude)) {
      var alt = xmpNumber(xmpGet(map, ['exif:GPSAltitude']));
      if (isFinite(alt)) {
        var altRef = xmpGet(map, ['exif:GPSAltitudeRef']);
        summary.altitude = (altRef === '1' || /below/i.test(altRef)) ? -alt : alt;
        used = true;
      }
    }

    var serial = summary.bodySerial || xmpGet(map, ['aux:SerialNumber']);
    if (!summary.bodySerial && serial) {
      summary.bodySerial = serial;
      used = true;
    }
    if (!summary.artist) {
      var creator = xmpGet(map, ['dc:creator']);
      if (creator) { summary.artist = creator; used = true; }
    }
    if (!summary.copyright) {
      var rights = xmpGet(map, ['dc:rights']);
      if (rights) { summary.copyright = rights; used = true; }
    }
    if (!summary.software) {
      var tool = xmpGet(map, ['xmp:CreatorTool']);
      if (tool) { summary.software = tool; used = true; }
    }

    summary.exifAvailable = hasExif;
    summary.metaSource = hasExif ? (used ? '混合' : 'EXIF') : (used ? 'XMP' : '');
    summary.xmp = map;
    return used;
  }

  /* ------------------------------------------------------------------ *
   * 手动编辑 EXIF 摘要字段（只影响界面与水印，不改导出元数据）
   * ------------------------------------------------------------------ */
  var EDIT_STRING_FIELDS = {
    make: 1, model: 1, lens: 1, lensMake: 1, lensSerial: 1,
    artist: 1, copyright: 1, software: 1, serial: 1, description: 1
  };

  function parseEditedNumber(text) {
    var raw = String(text == null ? '' : text).trim();
    if (!raw) return NaN;
    var fraction = raw.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
    if (fraction) {
      var den = Number(fraction[2]);
      return den ? Number(fraction[1]) / den : NaN;
    }
    var n = Number(raw);
    return isFinite(n) ? n : NaN;
  }

  function parseEditText(field, text) {
    var raw = String(text == null ? '' : text).trim();
    var empty = raw === '';
    if (EDIT_STRING_FIELDS[field]) {
      return { ok: true, value: raw, display: raw };
    }
    switch (field) {
      case 'aperture': {
        if (empty) return { ok: true, value: NaN, display: '' };
        var m = raw.match(/^(?:f\s*\/\s*)?(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?$/i);
        if (!m) return { ok: false, error: '光圈格式应为 f/2.8、2.8 或 28/10' };
        var ap = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
        if (!isFinite(ap) || ap <= 0) return { ok: false, error: '光圈必须大于 0' };
        return { ok: true, value: ap, display: 'f/' + (Math.round(ap * 10) / 10) };
      }
      case 'shutter': {
        if (empty) return { ok: true, value: NaN, display: '' };
        var s = raw.replace(/秒|s$/i, '').trim();
        var sm = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
        var sec;
        if (sm) sec = Number(sm[1]) / Number(sm[2]);
        else sec = Number(s);
        if (!isFinite(sec) || sec <= 0) return { ok: false, error: '快门格式应为 1/250s、1/250 或 0.004' };
        return { ok: true, value: sec, display: formatShutterCompact(sec) };
      }
      case 'iso': {
        if (empty) return { ok: true, value: NaN, display: '' };
        var iso = parseEditedNumber(raw.replace(/^ISO\s*/i, ''));
        if (!isFinite(iso) || iso <= 0) return { ok: false, error: 'ISO 格式应为 ISO 800 或 800' };
        return { ok: true, value: iso, display: 'ISO ' + Math.round(iso) };
      }
      case 'focal': {
        if (empty) return { ok: true, value: NaN, display: '' };
        var focal = parseEditedNumber(raw.replace(/mm$/i, '').trim());
        if (!isFinite(focal) || focal <= 0) return { ok: false, error: '焦距格式应为 55mm 或 55' };
        return { ok: true, value: focal, display: Math.round(focal) + 'mm' };
      }
      case 'focal35': {
        if (empty) return { ok: true, value: NaN, display: '' };
        var f35 = parseEditedNumber(raw.replace(/mm$/i, '').trim());
        if (!isFinite(f35) || f35 <= 0) return { ok: false, error: '等效焦距格式应为 85mm 或 85' };
        return { ok: true, value: f35, display: Math.round(f35) + ' mm' };
      }
      case 'datetime': {
        if (empty) return { ok: true, value: null, display: '' };
        var parts = parseDateParts(raw);
        if (!parts) return { ok: false, error: '时间格式应为 2024-05-01 12:34:56' };
        return { ok: true, value: { raw: raw, parts: parts }, display: formatDate(parts, 'datetime', {}) };
      }
      case 'offset': {
        if (empty) return { ok: true, value: '', display: '' };
        var om = raw.match(/^(Z|[+-]\d{2}:?\d{2})$/i);
        if (!om) return { ok: false, error: '时区格式应为 +08:00 或 Z' };
        var off = om[1].toUpperCase() === 'Z' ? '+00:00' : om[1].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
        return { ok: true, value: off, display: off };
      }
      case 'lat': case 'lon': {
        if (empty) return { ok: true, value: NaN, display: '' };
        var coord = xmpGps(raw);
        if (!isFinite(coord.decimal)) return { ok: false, error: '坐标格式应为 30.2701 或 30°16′12″N' };
        if (field === 'lat' && (coord.decimal < -90 || coord.decimal > 90)) {
          return { ok: false, error: '纬度必须在 -90 到 90 之间' };
        }
        if (field === 'lon' && (coord.decimal < -180 || coord.decimal > 180)) {
          return { ok: false, error: '经度必须在 -180 到 180 之间' };
        }
        return { ok: true, value: coord.decimal, display: coord.decimal.toFixed(6) };
      }
      case 'alt': {
        if (empty) return { ok: true, value: NaN, display: '' };
        var alt = parseEditedNumber(raw.replace(/米|m$/i, '').trim());
        if (!isFinite(alt)) return { ok: false, error: '海拔格式应为 40 或 -12.5' };
        return { ok: true, value: alt, display: (Math.round(alt * 10) / 10) + ' 米' };
      }
      default:
        return { ok: false, error: '该字段不支持修改' };
    }
  }

  function formatFieldDisplay(field, summary) {
    if (!summary) return '';
    switch (field) {
      case 'make': return summary.make || '';
      case 'model': return summary.model || '';
      case 'lens': return summary.lens || '';
      case 'lensMake': return summary.lensMake || '';
      case 'lensSerial': return summary.lensSerial || '';
      case 'serial': return summary.bodySerial || '';
      case 'artist': return summary.artist || '';
      case 'copyright': return summary.copyright || '';
      case 'software': return summary.software || '';
      case 'description': return summary.description || '';
      case 'aperture': return summary.apertureText || '';
      case 'shutter': return summary.shutterText || '';
      case 'iso': return summary.isoText || '';
      case 'focal': return summary.focalText || '';
      case 'focal35': return isFinite(summary.focal35) ? Math.round(summary.focal35) + ' mm' : '';
      case 'datetime': return summary.date ? formatDate(summary.date, 'datetime', {}) : (summary.datetimeRaw || '');
      case 'offset': return summary.offset || '';
      case 'lat': return isFinite(summary.latitude) ? summary.latitude.toFixed(6) : '';
      case 'lon': return isFinite(summary.longitude) ? summary.longitude.toFixed(6) : '';
      case 'alt': return isFinite(summary.altitude) ? (Math.round(summary.altitude * 10) / 10) + ' 米' : '';
      default: return '';
    }
  }

  function recomputeSummaryCoords(summary) {
    if (isFinite(summary.latitude) && isFinite(summary.longitude)) {
      summary.coordText = formatCoord(summary.latitude, summary.longitude);
      summary.dmsText = formatDms(summary.latitude, summary.longitude);
    } else {
      summary.coordText = '';
      summary.dmsText = '';
    }
  }

  function applyFieldEdit(summary, field, text) {
    if (!summary) return { ok: false, error: '没有可编辑的摘要' };
    var parsed = parseEditText(field, text);
    if (!parsed.ok) return parsed;
    var value = parsed.value;
    switch (field) {
      case 'make': {
        var oldMake = summary.make || '';
        summary.make = value;
        if (summary.modelFull) {
          var fullModel = String(summary.modelFull);
          if (oldMake && fullModel.toLowerCase().indexOf(oldMake.toLowerCase()) === 0) {
            fullModel = fullModel.slice(oldMake.length).trim();
          }
          summary.modelFull = fullModel;
          summary.model = stripMake(value, fullModel);
        }
        break;
      }
      case 'model':
        summary.modelFull = value;
        summary.model = stripMake(summary.make, value);
        break;
      case 'lens': summary.lens = value; break;
      case 'lensMake': summary.lensMake = value; break;
      case 'lensSerial': summary.lensSerial = value; break;
      case 'serial': summary.bodySerial = value; break;
      case 'artist': summary.artist = value; break;
      case 'copyright': summary.copyright = value; break;
      case 'software': summary.software = value; break;
      case 'description': summary.description = value; break;
      case 'aperture': summary.aperture = value; summary.apertureText = parsed.display; break;
      case 'shutter': summary.shutter = value; summary.shutterText = parsed.display; break;
      case 'iso': summary.iso = value; summary.isoText = parsed.display; break;
      case 'focal': summary.focal = value; summary.focalText = parsed.display; break;
      case 'focal35': summary.focal35 = value; break;
      case 'datetime':
        if (value) {
          summary.datetimeRaw = value.raw;
          summary.date = value.parts;
          if (summary.date && !summary.date.offset && summary.offset) summary.date.offset = summary.offset;
        } else {
          summary.datetimeRaw = '';
          summary.date = null;
        }
        break;
      case 'offset':
        summary.offset = value;
        if (summary.date) summary.date.offset = value || '';
        break;
      case 'lat': summary.latitude = value; recomputeSummaryCoords(summary); break;
      case 'lon': summary.longitude = value; recomputeSummaryCoords(summary); break;
      case 'alt': summary.altitude = value; break;
      default:
        return { ok: false, error: '该字段不支持修改' };
    }
    summary.edited = true;
    return { ok: true, value: value, display: parsed.display, field: field };
  }

  /* ------------------------------------------------------------------ *
   * IPTC（Photoshop 8BIM 0x0404）
   * ------------------------------------------------------------------ */
  var IPTC_NAMES = {
    '1.90': 'CodedCharacterSet',
    '2.0': 'RecordVersion',
    '2.5': 'ObjectName',
    '2.10': 'Urgency',
    '2.15': 'Category',
    '2.20': 'SupplementalCategories',
    '2.25': 'Keywords',
    '2.40': 'SpecialInstructions',
    '2.55': 'DateCreated',
    '2.60': 'TimeCreated',
    '2.62': 'DigitalCreationDate',
    '2.63': 'DigitalCreationTime',
    '2.65': 'OriginatingProgram',
    '2.70': 'ProgramVersion',
    '2.80': 'By-line',
    '2.85': 'By-lineTitle',
    '2.90': 'City',
    '2.92': 'Sub-location',
    '2.95': 'Province-State',
    '2.100': 'Country-PrimaryLocationCode',
    '2.101': 'Country-PrimaryLocationName',
    '2.103': 'OriginalTransmissionReference',
    '2.105': 'Headline',
    '2.110': 'Credit',
    '2.115': 'Source',
    '2.116': 'CopyrightNotice',
    '2.118': 'Contact',
    '2.120': 'Caption-Abstract',
    '2.122': 'Writer-Editor'
  };

  function parseIptc(input) {
    var bytes = exifLib.toUint8(input);
    var result = { charset: 'unknown', records: [], fields: {}, error: '' };
    var iim = bytes;
    var resource = null;
    try { resource = exifLib.findResourceData(bytes, 0x0404); } catch (e) { resource = null; }
    if (resource && resource.length) iim = resource;
    var pos = 0;
    var guard = 0;
    while (pos + 5 <= iim.length && guard++ < 5000) {
      if (iim[pos] !== 0x1c) { pos++; continue; }
      var record = iim[pos + 1];
      var dataset = iim[pos + 2];
      var len = (iim[pos + 3] << 8) | iim[pos + 4];
      var valueStart = pos + 5;
      if (len & 0x8000) {
        var nbytes = len & 0x7fff;
        if (valueStart + nbytes > iim.length) break;
        len = 0;
        for (var b = 0; b < nbytes; b++) len = len * 256 + iim[valueStart + b];
        valueStart += nbytes;
      }
      if (valueStart + len > iim.length) {
        result.error = 'IPTC 数据越界，可能在 ' + (pos) + ' 字节处被截断';
        break;
      }
      var raw = iim.subarray(valueStart, valueStart + len);
      var text = decodeIptcText(raw, result.charset);
      var key = record + '.' + dataset;
      if (record === 1 && dataset === 90) {
        if (raw.length >= 3) {
          var esc = String.fromCharCode(raw[raw.length - 1]);
          if (esc === 'G') result.charset = 'utf-8';
          else if (esc === 'A') result.charset = 'latin1';
          else result.charset = 'unknown';
        }
        pos = valueStart + len;
        continue;
      }
      result.records.push({
        record: record,
        dataset: dataset,
        name: IPTC_NAMES[key] || ('IIM ' + key),
        text: text,
        rawHex: raw.length <= 64 ? tags.bytesToHex(raw, 64) : raw.length + ' 字节'
      });
      pos = valueStart + len;
    }

    var fields = result.fields;
    fields.keywords = [];
    result.records.forEach(function (r) {
      var t = r.text;
      switch (r.record + '.' + r.dataset) {
        case '2.5': fields.objectName = t; break;
        case '2.25': fields.keywords.push(t); break;
        case '2.40': fields.specialInstructions = t; break;
        case '2.55': fields.dateCreated = t; break;
        case '2.60': fields.timeCreated = t; break;
        case '2.65': fields.originatingProgram = t; break;
        case '2.80': fields.byline = t; break;
        case '2.85': fields.bylineTitle = t; break;
        case '2.90': fields.city = t; break;
        case '2.92': fields.sublocation = t; break;
        case '2.95': fields.province = t; break;
        case '2.100': fields.countryCode = t; break;
        case '2.101': fields.country = t; break;
        case '2.105': fields.headline = t; break;
        case '2.110': fields.credit = t; break;
        case '2.115': fields.source = t; break;
        case '2.116': fields.copyright = t; break;
        case '2.118': fields.contact = t; break;
        case '2.120': fields.caption = t; break;
        case '2.122': fields.writer = t; break;
      }
    });
    return result;
  }

  function decodeIptcText(raw, charset) {
    if (!raw || !raw.length) return '';
    if (charset === 'utf-8') return decodeSmart(raw);
    if (charset === 'latin1') {
      var lat = decoder('windows-1252');
      return lat ? lat.decode(raw) : decodeSmart(raw);
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch (e) {
      var fallback = decoder('windows-1252');
      return fallback ? fallback.decode(raw) : decodeSmart(raw);
    }
  }

  /* ------------------------------------------------------------------ *
   * ICC
   * ------------------------------------------------------------------ */
  var ICC_DEVICE_CLASS = {
    scnr: '输入设备 (Scanner)', mntr: '显示设备 (Monitor)', prtr: '输出设备 (Printer)',
    link: '设备链接 (DeviceLink)', abst: '抽象配置 (Abstract)', nmcl: '命名色彩空间 (Named)',
    spac: '色彩空间 (ColorSpace)', 'abst': '抽象配置'
  };

  function iccText(bytes, dataView, offset, size) {
    try {
      var type = ascii(bytes, offset, offset + 4);
      if (type === 'desc') {
        var count = dataView.getUint32(offset + 8, false);
        return decodeSmart(bytes.subarray(offset + 12, offset + 12 + Math.max(0, Math.min(count, size) - 1)));
      }
      if (type === 'mluc') {
        var recCount = dataView.getUint32(offset + 8, false);
        var recSize = dataView.getUint32(offset + 12, false);
        var best = '';
        for (var i = 0; i < Math.min(recCount, 20); i++) {
          var base = offset + 16 + i * recSize;
          if (base + 12 > bytes.length) break;
          var lang = ascii(bytes, base, base + 2);
          var ctry = ascii(bytes, base + 2, base + 4);
          var len = dataView.getUint32(base + 4, false);
          var off = dataView.getUint32(base + 8, false);
          var s = decodeUtf16(bytes.subarray(offset + off, offset + off + len), false);
          if (!best || (lang === 'en' && ctry === 'US')) best = s;
        }
        return best;
      }
      if (type === 'text') {
        return decodeSmart(bytes.subarray(offset + 8, offset + size));
      }
      if (type === 'XYZ ') {
        var vals = [];
        for (var v = 0; v < 3; v++) {
          vals.push(dataView.getInt32(offset + 8 + v * 4, false) / 65536);
        }
        return vals.map(function (x) { return x.toFixed(4); }).join(', ');
      }
    } catch (e) { /* 忽略 */ }
    return '';
  }

  function parseIcc(input) {
    if (!input) return null;
    var bytes = exifLib.toUint8(input);
    if (bytes.length < 132) return { error: 'ICC 数据过短（' + bytes.length + ' 字节）' };
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var info = {
      size: dv.getUint32(0, false),
      cmm: ascii(bytes, 4, 8),
      version: bytes[8] + '.' + (bytes[9] >> 4) + '.' + (bytes[9] & 0x0f),
      deviceClass: ascii(bytes, 12, 16),
      colorSpace: ascii(bytes, 16, 20),
      pcs: ascii(bytes, 20, 24),
      signature: ascii(bytes, 36, 40),
      platform: ascii(bytes, 40, 44),
      renderingIntent: dv.getUint32(64, false),
      creator: ascii(bytes, 80, 84),
      tagCount: dv.getUint32(128, false),
      description: '',
      copyright: '',
      whitePoint: '',
      error: ''
    };
    info.deviceClassLabel = ICC_DEVICE_CLASS[info.deviceClass] || info.deviceClass;
    var offsets = {};
    for (var i = 0; i < Math.min(info.tagCount, 256); i++) {
      var base = 132 + i * 12;
      if (base + 12 > bytes.length) break;
      var sig = ascii(bytes, base, base + 4);
      var offset = dv.getUint32(base + 4, false);
      var size = dv.getUint32(base + 8, false);
      if (offset + size > bytes.length) continue;
      offsets[sig] = { offset: offset, size: size };
    }
    if (offsets.desc) info.description = iccText(bytes, dv, offsets.desc.offset, offsets.desc.size);
    if (offsets.cprt) info.copyright = iccText(bytes, dv, offsets.cprt.offset, offsets.cprt.size);
    if (offsets.wtpt) info.whitePoint = iccText(bytes, dv, offsets.wtpt.offset, offsets.wtpt.size);
    if (!info.description && offsets.desc) info.description = '（无描述）';
    return info;
  }

  /* ------------------------------------------------------------------ *
   * 摘要（供水印使用）
   * ------------------------------------------------------------------ */
  function stripMake(make, model) {
    if (!model) return '';
    if (!make) return model;
    var firstWord = make.trim().split(/\s+/)[0];
    if (!firstWord) return model;
    var cleanFirst = firstWord.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    var cleanModel = model.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (cleanFirst && cleanModel.indexOf(cleanFirst) === 0) {
      var idx = model.replace(/[^A-Za-z0-9]/g, '').length ? model.search(new RegExp(firstWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) : -1;
      if (idx >= 0) {
        var cut = idx + firstWord.length;
        return model.slice(cut).replace(/^[\s\-_]+/, '').trim() || model;
      }
    }
    return model;
  }

  function formatShutterCompact(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '';
    if (seconds >= 10) return Math.round(seconds) + 's';
    if (seconds >= 1) return (Math.round(seconds * 10) / 10) + 's';
    var denom = Math.round(1 / seconds);
    return '1/' + denom + 's';
  }

  function formatCoord(lat, lon) {
    if (!isFinite(lat) || !isFinite(lon)) return '';
    var latStr = Math.abs(lat).toFixed(4) + '°' + (lat >= 0 ? 'N' : 'S');
    var lonStr = Math.abs(lon).toFixed(4) + '°' + (lon >= 0 ? 'E' : 'W');
    return latStr + ', ' + lonStr;
  }

  function buildSummary(parsed) {
    var exif = parsed.exif;
    var ifd0 = exif ? exif.ifd0 : null;
    var sub = exif ? exif.exif : null;
    var gps = exif ? exif.gps : null;

    var make = textVal(ifd0, 0x010f) || textVal(sub, 0xa433) || '';
    var modelFull = textVal(ifd0, 0x0110) || '';
    var model = stripMake(make, modelFull);
    var lens = textVal(sub, 0xa434) || textVal(sub, 0xa433) || '';
    var focal = ratVal(sub, 0x920a);
    var focal35 = numVal(sub, 0xa405);
    var aperture = ratVal(sub, 0x829d);
    var shutter = ratVal(sub, 0x829a);
    if (!isFinite(shutter) || shutter <= 0) {
      var apex = ratVal(sub, 0x9201);
      if (isFinite(apex)) shutter = Math.pow(2, -apex);
    }
    var iso = numVal(sub, 0x8827) || numVal(sub, 0x8833) || numVal(sub, 0x8832);

    var dateRaw = textVal(sub, 0x9003) || textVal(sub, 0x9004) || textVal(ifd0, 0x0132);
    var date = parseDateParts(dateRaw);
    var offset = textVal(sub, 0x9011) || textVal(sub, 0x9010) || textVal(sub, 0x9012);
    if (date) date.offset = offset;

    var lat = NaN;
    var lon = NaN;
    var altitude = NaN;
    var dmsText = '';
    if (gps) {
      var latCoord = tags.gpsCoordinate(gps.map[0x0002], gps.map[0x0001]);
      var lonCoord = tags.gpsCoordinate(gps.map[0x0004], gps.map[0x0003]);
      if (latCoord) { lat = latCoord.decimal; }
      if (lonCoord) { lon = lonCoord.decimal; }
      var alt = ratVal(gps, 0x0006);
      if (isFinite(alt)) {
        altitude = alt * ((gps.map[0x0005] && first(gps.map[0x0005].value) === 1) ? -1 : 1);
      }
      dmsText = [latCoord ? latCoord.text : '', lonCoord ? lonCoord.text : ''].filter(Boolean).join(' ');
    }

    return {
      make: make,
      model: model,
      modelFull: modelFull,
      lens: lens,
      lensMake: textVal(sub, 0xa433),
      focal: isFinite(focal) && focal > 0 ? focal : NaN,
      focalText: isFinite(focal) && focal > 0 ? Math.round(focal) + 'mm' : '',
      focal35: isFinite(focal35) && focal35 > 0 ? focal35 : NaN,
      aperture: isFinite(aperture) && aperture > 0 ? aperture : NaN,
      apertureText: isFinite(aperture) && aperture > 0 ? 'f/' + (Math.round(aperture * 10) / 10).toString() : '',
      shutter: isFinite(shutter) && shutter > 0 ? shutter : NaN,
      shutterText: formatShutterCompact(shutter),
      iso: isFinite(iso) ? iso : NaN,
      isoText: isFinite(iso) ? 'ISO ' + Math.round(iso) : '',
      datetimeRaw: dateRaw,
      date: date,
      offset: offset,
      latitude: lat,
      longitude: lon,
      altitude: altitude,
      coordText: formatCoord(lat, lon),
      dmsText: dmsText,
      software: textVal(ifd0, 0x0131) || textVal(sub, 0x0131),
      artist: textVal(ifd0, 0x013b) || textVal(sub, 0xa430),
      copyright: textVal(ifd0, 0x8298),
      bodySerial: textVal(sub, 0xa431),
      lensSerial: textVal(sub, 0xa435),
      owner: textVal(sub, 0xa430),
      width: parsed.dimensions ? parsed.dimensions.width : 0,
      height: parsed.dimensions ? parsed.dimensions.height : 0,
      orientation: parsed.orientation || 1,
      filename: parsed.file ? parsed.file.name : '',
      format: parsed.format,
      makeRaw: make,
      exifAvailable: !!exif,
      metaSource: exif ? 'EXIF' : ''
    };
  }

  /* ------------------------------------------------------------------ *
   * 报告
   * ------------------------------------------------------------------ */
  var CAMERA_TAGS = {
    0x010f: 1, 0x0110: 1, 0x013b: 1, 0x8298: 1, 0xa430: 1, 0xa431: 1,
    0x9c9d: 1, 0x9c9b: 1, 0x9c9c: 1, 0x9c9e: 1, 0x9c9f: 1
  };
  var LENS_TAGS = {
    0xa432: 1, 0xa434: 1, 0xa433: 1, 0xa435: 1,
    0xa20e: 1, 0xa20f: 1, 0xa210: 1
  };
  var TIME_TAGS = {
    0x9003: 1, 0x9004: 1, 0x9010: 1, 0x9011: 1, 0x9012: 1,
    0x9290: 1, 0x9291: 1, 0x9292: 1
  };
  var IMAGE_TAGS = {
    0x0100: 1, 0x0101: 1, 0x0102: 1, 0x0103: 1, 0x0106: 1, 0x010e: 1,
    0x0112: 1, 0x011a: 1, 0x011b: 1, 0x011c: 1, 0x0128: 1,
    0x012d: 1, 0x0211: 1, 0x0212: 1, 0x0213: 1, 0x0214: 1
  };
  var SKIP_TAGS = {
    0x0111: 1, 0x0117: 1, 0x0201: 1, 0x0202: 1, 0x0144: 1, 0x0145: 1,
    0x014a: 1, 0x8769: 1, 0x8825: 1, 0xa005: 1, 0xea1c: 1, 0xea1d: 1
  };
  var EXPOSURE_TAGS = {
    0x829a: 1, 0x829d: 1, 0x8822: 1, 0x8824: 1, 0x8827: 1, 0x8828: 1,
    0x8830: 1, 0x8831: 1, 0x8832: 1, 0x8833: 1, 0x8834: 1, 0x8835: 1,
    0x9000: 1, 0x9101: 1, 0x9102: 1, 0x9201: 1, 0x9202: 1, 0x9203: 1,
    0x9204: 1, 0x9205: 1, 0x9206: 1, 0x9207: 1, 0x9208: 1, 0x9209: 1,
    0x920a: 1, 0x9214: 1, 0x9215: 1, 0x927c: 1, 0x9286: 1,
    0xa000: 1, 0xa001: 1, 0xa002: 1, 0xa003: 1, 0xa004: 1,
    0xa20b: 1, 0xa20c: 1, 0xa214: 1, 0xa215: 1, 0xa217: 1,
    0xa300: 1, 0xa301: 1, 0xa302: 1, 0xa401: 1, 0xa402: 1, 0xa403: 1,
    0xa404: 1, 0xa405: 1, 0xa406: 1, 0xa407: 1, 0xa408: 1, 0xa409: 1,
    0xa40a: 1, 0xa40b: 1, 0xa40c: 1, 0xa420: 1,
    0xa460: 1, 0xa461: 1, 0xa462: 1, 0xa500: 1
  };

  function classifyTag(ifdName, tag, groupIds) {
    if (ifdName === 'gps') return 'gps';
    if (ifdName === 'interop') return 'other';
    if (CAMERA_TAGS[tag]) return 'camera';
    if (LENS_TAGS[tag]) return 'lens';
    if (TIME_TAGS[tag]) return 'time';
    if (EXPOSURE_TAGS[tag]) return 'exposure';
    if (IMAGE_TAGS[tag]) return 'image';
    if (tag === 0x0131) return 'post';
    if (groupIds === 'ifd1') return 'image';
    return 'other';
  }

  var GROUP_TITLES = {
    image: '图像',
    camera: '相机与器材',
    exposure: '曝光参数',
    lens: '镜头',
    time: '时间',
    gps: 'GPS 定位',
    post: '软件与后期',
    other: '其他标签'
  };

  function parsePngChunks(input, options) {
    var bytes = exifLib.toUint8(input);
    var opts = options || {};
    var only = opts.onlyTypes || null;
    var onlyMap = null;
    if (only) {
      onlyMap = {};
      (Array.isArray(only) ? only : [only]).forEach(function (t) { onlyMap[t] = 1; });
    }
    var chunks = [];
    var pos = 8;
    var guard = 0;
    while (pos + 12 <= bytes.length && guard++ < 100000) {
      var length = u32be(bytes, pos);
      if (length > bytes.length - pos - 12) break;
      var type = ascii(bytes, pos + 4, pos + 8);
      var dataStart = pos + 8;
      var dataEnd = dataStart + length;
      var chunk = { type: type, length: length, offset: pos };
      if (!onlyMap || onlyMap[type]) {
        chunk.data = bytes.slice(dataStart, dataEnd);
        chunk.raw = bytes.slice(pos, dataEnd + 4);
      }
      chunks.push(chunk);
      pos = dataEnd + 4;
      if (type === 'IEND') break;
    }
    return chunks;
  }

  function jpegThumbDimensions(bytes) {
    if (!bytes) return null;
    for (var i = 0; i + 9 < bytes.length; i++) {
      if (bytes[i] === 0xff && (bytes[i + 1] === 0xc0 || bytes[i + 1] === 0xc1 || bytes[i + 1] === 0xc2)) {
        return {
          height: (bytes[i + 5] << 8) | bytes[i + 6],
          width: (bytes[i + 7] << 8) | bytes[i + 8]
        };
      }
    }
    return null;
  }

  function pngDimensions(bytes) {
    if (!bytes || bytes.length < 24) return null;
    if (!(bytes[0] === 0x89 && bytes[1] === 0x50)) return null;
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }

  function buildReport(parsed) {
    var groups = [];
    var groupIndex = {};
    function group(id, title) {
      if (!groupIndex[id]) {
        groupIndex[id] = { id: id, title: title, rows: [] };
        groups.push(groupIndex[id]);
      }
      return groupIndex[id];
    }
    function row(name, value, opts) {
      var r = { name: name, value: value == null ? '' : String(value) };
      if (opts) {
        if (opts.note) r.note = opts.note;
        if (opts.tag) r.tag = opts.tag;
        if (opts.cn) r.cn = opts.cn;
        if (opts.type) r.type = opts.type;
        if (opts.raw) r.raw = opts.raw;
        if (opts.source) r.source = opts.source;
        if (opts.url) r.url = opts.url;
      }
      return r;
    }

    var xmp = null;
    var xmpMapData = null;
    if (parsed.xmp && parsed.xmp.xml) {
      xmp = parseXmp(parsed.xmp.xml);
      xmpMapData = xmpToMap(xmp.props);
    }
    var summary = buildSummary(parsed);
    if (xmpMapData) applyXmpSummary(summary, xmpMapData, parsed);

    var fileGroup = group('file', '文件');
    fileGroup.rows.push(row('文件名', parsed.file.name));
    fileGroup.rows.push(row('文件类型', parsed.format === 'jpeg' ? 'JPEG' : parsed.format === 'png' ? 'PNG' : '未知'));
    fileGroup.rows.push(row('文件大小', formatBytes(parsed.file.size), { raw: parsed.file.size + ' bytes' }));
    if (parsed.dimensions && parsed.dimensions.width) {
      var w = parsed.dimensions.width;
      var h = parsed.dimensions.height;
      fileGroup.rows.push(row('图像尺寸', w + ' × ' + h + ' px'));
      fileGroup.rows.push(row('宽高比', (w / h).toFixed(4) + ' : 1'));
      fileGroup.rows.push(row('像素总量', (w * h / 1000000).toFixed(2) + ' MP'));
    }
    fileGroup.rows.push(row('方向', tags.ENUMS.Orientation[parsed.orientation] || String(parsed.orientation)));

    if (parsed.format === 'jpeg' && parsed.jpeg) {
      var jpeg = parsed.jpeg;
      if (jpeg.sof) {
        fileGroup.rows.push(row('JPEG 编码', jpeg.sof.kind));
        fileGroup.rows.push(row('采样精度', jpeg.sof.precision + ' bit'));
        fileGroup.rows.push(row('渐进式', jpeg.sof.progressive ? '是' : '否'));
        var comps = (jpeg.sof.components || []).map(function (c) {
          return '#' + c.id + ' ' + c.h + 'x' + c.v;
        }).join('，');
        fileGroup.rows.push(row('色彩组件', (jpeg.sof.components || []).length + ' 个（' + comps + '）'));
      }
      if (jpeg.jfif) {
        var unit = jpeg.jfif.units;
        var dpi = unit === 1 ? Math.round(jpeg.jfif.xDensity) + ' × ' + Math.round(jpeg.jfif.yDensity) + ' dpi'
          : unit === 2 ? Math.round(jpeg.jfif.xDensity) + ' × ' + Math.round(jpeg.jfif.yDensity) + ' dpcm'
          : '无单位（' + jpeg.jfif.xDensity + ' × ' + jpeg.jfif.yDensity + '）';
        fileGroup.rows.push(row('JFIF', '版本 ' + jpeg.jfif.version + '，密度 ' + dpi));
      }
      fileGroup.rows.push(row('量化表', jpeg.dqtTables + ' 组' + (jpeg.qualityEstimate ? '，估计质量 ≈ ' + jpeg.qualityEstimate : '')));
      fileGroup.rows.push(row('霍夫曼表', jpeg.dhtTables + ' 组'));
      if (jpeg.restartInterval) fileGroup.rows.push(row('重启间隔', jpeg.restartInterval + ' MCU'));
      if (jpeg.adobe) fileGroup.rows.push(row('Adobe APP14', '转换 ' + jpeg.adobe.transform + '，版本 ' + jpeg.adobe.version));
      if (jpeg.comment) fileGroup.rows.push(row('注释 (COM)', jpeg.comment));
      fileGroup.rows.push(row('标记段数量', jpeg.segmentCount));
    }

    if (parsed.format === 'png' && parsed.png) {
      var png = parsed.png;
      var ihdr = png.ihdr;
      if (ihdr) {
        fileGroup.rows.push(row('PNG 位深', ihdr.bitDepth + ' bit'));
        fileGroup.rows.push(row('颜色类型', ihdr.colorTypeLabel));
        fileGroup.rows.push(row('隔行扫描', ihdr.interlace ? 'Adam7 隔行' : '否（渐进式加载）'));
      }
      if (png.phys && png.phys.unit === 1) {
        fileGroup.rows.push(row('PNG 分辨率', Math.round(png.phys.x * 0.0254) + ' × ' + Math.round(png.phys.y * 0.0254) + ' dpi'));
      }
      if (png.gamma != null) fileGroup.rows.push(row('Gamma', png.gamma));
      if (png.renderingIntent != null) fileGroup.rows.push(row('sRGB 渲染意图', ['感知', '相对比色', '饱和度', '绝对比色'][png.renderingIntent] || png.renderingIntent));
      if (png.paletteEntries) fileGroup.rows.push(row('调色板', png.paletteEntries + ' 色'));
      if (png.transparency) fileGroup.rows.push(row('透明通道', '存在 tRNS'));
      if (png.actl) fileGroup.rows.push(row('APNG 动画', png.actl.frames + ' 帧'));
      if (png.time) {
        fileGroup.rows.push(row('PNG 修改时间', png.time.year + '-' + pad2(png.time.month) + '-' + pad2(png.time.day) +
          ' ' + pad2(png.time.hour) + ':' + pad2(png.time.minute) + ':' + pad2(png.time.second)));
      }
      var counts = {};
      (png.chunks || []).forEach(function (c) { counts[c.type] = (counts[c.type] || 0) + 1; });
      fileGroup.rows.push(row('数据块', Object.keys(counts).map(function (k) {
        return k + (counts[k] > 1 ? '×' + counts[k] : '');
      }).join('，')));
    }

    /* 图像属性：IFD0 中未分类到相机/时间的标签 */
    function addIfdRows(ifdName, ifd) {
      if (!ifd || !ifd.entries) return;
      ifd.entries.forEach(function (entry) {
        if (SKIP_TAGS[entry.tag]) return;
        var tag = entry.tag;
        var gid = classifyTag(ifdName, tag, ifd.name);
        var fmt = tags.formatValue(ifdName, tag, entry, { entries: ifd.map });
        var name = tags.tagName(ifdName, tag);
        if (!name) { name = '未知标签 ' + tags.hexTag(tag); gid = 'other'; }
        var source = ifdName === 'ifd0' ? 'IFD0' : ifdName === 'exif' ? 'Exif' : ifdName === 'gps' ? 'GPS' : ifdName === 'interop' ? 'Interop' : 'IFD1';
        var g = group(gid, GROUP_TITLES[gid] || '其他标签');
        g.rows.push(row(name, fmt.text, {
          note: [fmt.note, tags.cnHint(tag)].filter(Boolean).join(' · '),
          tag: tags.hexTag(tag),
          cn: tags.cnHint(tag),
          type: entry.typeName + ' × ' + entry.count,
          raw: entry.bytes && entry.bytes.length <= 48 ? tags.bytesToHex(entry.bytes, 48) : (entry.invalid ? '数据越界' : ''),
          source: source
        }));
      });
    }

    addIfdRows('ifd0', parsed.exif ? parsed.exif.ifd0 : null);
    addIfdRows('exif', parsed.exif ? parsed.exif.exif : null);
    addIfdRows('interop', parsed.exif ? parsed.exif.interop : null);
    addIfdRows('gps', parsed.exif ? parsed.exif.gps : null);

    /* XMP 兜底：EXIF 缺失或 PNG 只有 XMP 时，把关键相机/曝光信息补进常规分组 */
    if (xmpMapData) {
      var ifd0Map = parsed.exif ? parsed.exif.ifd0.map : {};
      var exifMap = parsed.exif ? parsed.exif.exif.map : {};
      function xmpRow(gid, title, name, value) {
        if (value == null || value === '') return;
        group(gid, title).rows.push(row(name, value, { source: 'XMP', note: '来自 XMP' }));
      }
      if (!ifd0Map[0x010f] && summary.make) xmpRow('camera', '相机与器材', 'Make', summary.make);
      if (!ifd0Map[0x0110] && summary.modelFull) xmpRow('camera', '相机与器材', 'Model', summary.modelFull);
      if (!ifd0Map[0x013b] && summary.artist) xmpRow('camera', '相机与器材', 'Artist', summary.artist);
      if (!ifd0Map[0x8298] && summary.copyright) xmpRow('camera', '相机与器材', 'Copyright', summary.copyright);
      if (!exifMap[0xa431] && summary.bodySerial) xmpRow('camera', '相机与器材', 'BodySerialNumber', summary.bodySerial);
      if (summary.metaSource === 'XMP' || summary.metaSource === '混合') {
        xmpRow('camera', '相机与器材', '元数据来源', summary.metaSource === 'XMP' ? 'XMP（无 EXIF）' : 'EXIF + XMP');
      }

      if (!exifMap[0x829a] && summary.shutterText) xmpRow('exposure', '曝光参数', 'ExposureTime', summary.shutterText);
      if (!exifMap[0x829d] && summary.apertureText) xmpRow('exposure', '曝光参数', 'FNumber', summary.apertureText);
      if (!exifMap[0x8827] && !exifMap[0x8833] && summary.isoText) xmpRow('exposure', '曝光参数', 'ISOSpeedRatings', summary.isoText);
      if (!exifMap[0x920a] && summary.focalText) xmpRow('exposure', '曝光参数', 'FocalLength', summary.focalText);
      if (!exifMap[0xa405] && isFinite(summary.focal35)) xmpRow('exposure', '曝光参数', 'FocalLengthIn35mmFilm', summary.focal35 + ' mm');

      if (!exifMap[0xa434] && !exifMap[0xa433] && summary.lens) xmpRow('lens', '镜头', 'LensModel', summary.lens);
      if (!exifMap[0xa433] && summary.lensMake) xmpRow('lens', '镜头', 'LensMake', summary.lensMake);

      var hasDate = exifMap[0x9003] || exifMap[0x9004] || ifd0Map[0x0132];
      if (!hasDate && summary.datetimeRaw) {
        xmpRow('time', '时间', 'DateTimeOriginal', summary.date ? formatDate(summary.date, 'datetime', {}) : summary.datetimeRaw);
      }
      if (!parsed.exif && summary.software) xmpRow('post', '软件与后期', 'Software', summary.software);
    }

    /* 缩略图 */
    var thumbRowGroup = group('image', '图像');
    if (parsed.thumbnail && parsed.thumbnail.bytes) {
      var thumbDims = parsed.thumbnail.mime === 'image/png' ? pngDimensions(parsed.thumbnail.bytes) : jpegThumbDimensions(parsed.thumbnail.bytes);
      thumbRowGroup.rows.push(row('内嵌缩略图',
        (thumbDims ? thumbDims.width + ' × ' + thumbDims.height + '，' : '') + parsed.thumbnail.mime + '，' + formatBytes(parsed.thumbnail.bytes.length),
        { note: '位于 IFD1' }));
    } else if (parsed.exif && parsed.exif.ifd1 && parsed.exif.ifd1.entries.length) {
      thumbRowGroup.rows.push(row('内嵌缩略图', '无有效缩略图数据', { note: 'IFD1 存在但未找到 JPEG 数据' }));
    }

    /* GPS 计算值（EXIF 或 XMP 均可） */
    if (isFinite(summary.latitude) && isFinite(summary.longitude)) {
      var gpsGroup = group('gps', 'GPS 定位');
      gpsGroup.rows.unshift(row('十进制坐标', summary.coordText));
      gpsGroup.rows.splice(1, 0, row('度分秒', summary.dmsText));
      gpsGroup.rows.splice(2, 0, row('OpenStreetMap', '在浏览器中查看位置', {
        url: 'https://www.openstreetmap.org/?mlat=' + summary.latitude.toFixed(6) + '&mlon=' + summary.longitude.toFixed(6) + '#map=15/' + summary.latitude.toFixed(6) + '/' + summary.longitude.toFixed(6)
      }));
      if (isFinite(summary.altitude)) {
        gpsGroup.rows.splice(3, 0, row('海拔', summary.altitude.toFixed(1) + ' 米'));
      }
    }

    /* XMP 完整属性 */
    if (xmp && xmp.props.length) {
      var xg = group('xmp', 'XMP 扩展信息');
      xmp.props.slice(0, 500).forEach(function (p) {
        xg.rows.push(row(p.key, p.value, { source: 'XMP' }));
      });
    }

    /* IPTC */
    var iptc = null;
    if (parsed.iptcRaw && parsed.iptcRaw.length) {
      iptc = parseIptc(parsed.iptcRaw);
      if (iptc.records.length) {
        var ig = group('iptc', 'IPTC 元数据');
        ig.rows.push(row('字符集', iptc.charset === 'utf-8' ? 'UTF-8' : iptc.charset === 'latin1' ? 'Latin-1' : '未声明（按 UTF-8 猜测）'));
        var iptcFields = [
          ['标题 (ObjectName)', iptc.fields.objectName],
          ['标题 (Headline)', iptc.fields.headline],
          ['说明 (Caption)', iptc.fields.caption],
          ['关键词', (iptc.fields.keywords || []).join(' / ')],
          ['作者 (By-line)', iptc.fields.byline],
          ['作者头衔', iptc.fields.bylineTitle],
          ['版权', iptc.fields.copyright],
          ['城市', iptc.fields.city],
          ['地区', iptc.fields.province],
          ['国家', iptc.fields.country],
          ['国家代码', iptc.fields.countryCode],
          ['拍摄日期', iptc.fields.dateCreated],
          ['拍摄时间', iptc.fields.timeCreated],
          ['来源', iptc.fields.source],
          ['署名', iptc.fields.credit],
          ['特别说明', iptc.fields.specialInstructions],
          ['编辑', iptc.fields.writer]
        ];
        iptcFields.forEach(function (pair) {
          if (pair[1]) ig.rows.push(row(pair[0], pair[1]));
        });
        ig.rows.push(row('IPTC 记录数', iptc.records.length, { raw: iptc.error || '' }));
      } else if (iptc.error) {
        group('warn', '解析警告').rows.push(row('IPTC', iptc.error));
      }
    }

    /* ICC */
    var icc = null;
    if (parsed.iccRaw && parsed.iccRaw.length) {
      icc = parseIcc(parsed.iccRaw);
      if (icc) {
        var cg = group('icc', 'ICC 色彩配置');
        if (icc.error) {
          cg.rows.push(row('状态', icc.error));
        } else {
          cg.rows.push(row('配置描述', icc.description || '（无）'));
          cg.rows.push(row('设备类别', icc.deviceClassLabel || '—'));
          cg.rows.push(row('色彩空间', icc.colorSpace));
          cg.rows.push(row('PCS', icc.pcs));
          cg.rows.push(row('版本', icc.version));
          cg.rows.push(row('创建者', icc.creator));
          cg.rows.push(row('渲染意图', ['感知', '相对比色', '饱和度', '绝对比色'][icc.renderingIntent] || String(icc.renderingIntent)));
          if (icc.whitePoint && icc.whitePoint !== '0.0000, 0.0000, 0.0000') cg.rows.push(row('白点 XYZ', icc.whitePoint));
          if (icc.copyright) cg.rows.push(row('版权', icc.copyright));
          cg.rows.push(row('标签数量', icc.tagCount));
          cg.rows.push(row('配置文件大小', formatBytes(icc.size)));
        }
      }
    }

    /* PNG 文本块 */
    if (parsed.png) {
      var pg = group('png', 'PNG 数据块');
      if (parsed.png.ihdr) {
        pg.rows.push(row('IHDR 位深', parsed.png.ihdr.bitDepth + ' bit'));
        pg.rows.push(row('IHDR 颜色类型', parsed.png.ihdr.colorTypeLabel));
      }
      if (parsed.png.iccProfileName) pg.rows.push(row('iCCP 配置名称', parsed.png.iccProfileName));
      (parsed.png.text || []).forEach(function (t) {
        var label = t.keyword || '(未命名)';
        var meta = [];
        if (t.type === 'iTXt') {
          if (t.language) meta.push('语言 ' + t.language);
          if (t.translatedKeyword) meta.push('译名 ' + t.translatedKeyword);
          if (t.compressed) meta.push('zlib 压缩');
        } else if (t.type === 'zTXt') {
          meta.push('zlib 压缩');
        }
        pg.rows.push(row(label, t.text, { source: t.type, note: meta.join(' · ') }));
      });
    }

    /* 警告 */
    if (parsed.warnings && parsed.warnings.length) {
      var wg = group('warn', '解析警告');
      parsed.warnings.forEach(function (w) {
        wg.rows.push(row('警告', w));
      });
    }

    if (iptc) {
      summary.iptcByline = iptc.fields.byline || '';
      summary.iptcCopyright = iptc.fields.copyright || '';
      if (!summary.artist) summary.artist = iptc.fields.byline || '';
      if (!summary.copyright) summary.copyright = iptc.fields.copyright || '';
      if (!summary.software) summary.software = iptc.fields.originatingProgram || '';
    }

    groups = groups.filter(function (g) { return g.rows && g.rows.length; });

    return {
      groups: groups,
      summary: summary,
      warnings: parsed.warnings || [],
      xmp: xmp,
      iptc: iptc,
      icc: icc
    };
  }

  /* ------------------------------------------------------------------ *
   * EXIF 可见性：默认只显示「常用 / 可能出现在水印上」的字段，
   * 其余（被摄体距离、传感器方法、缩略图、ICC 白点…）归入「全部」。
   * buildReport 的数据不裁剪，只做标记，保证 JSON 导出与既有测试不变。
   * ------------------------------------------------------------------ */
  var EXIF_CORE = {
    camera: '*',
    lens: '*',
    warn: '*',
    file: [
      '文件名', '文件类型', '文件大小', '图像尺寸', '宽高比', '像素总量',
      '方向', 'JPEG 编码', '采样精度', '渐进式', '量化表',
      'PNG 位深', '颜色类型'
    ],
    time: [
      'DateTimeOriginal', 'DateTimeDigitized', 'OffsetTimeOriginal'
    ],
    // 只留「会出现在水印上 / 摄影人真会看」的曝光项；
    // ExposureProgram / MeteringMode / LightSource / Flash 等归入「显示全部」。
    exposure: [
      'ExposureTime', 'FNumber', 'ISOSpeedRatings', 'ExposureBiasValue',
      'FocalLength', 'FocalLengthIn35mmFilm', 'ExposureMode', 'WhiteBalance'
    ],
    post: ['Software'],
    other: ['DateTime'],
    image: ['Orientation', 'ImageDescription'],
    gps: ['十进制坐标', '度分秒', 'OpenStreetMap', '海拔'],
    xmp: [
      'xmp:Rating', 'photoshop:City', 'photoshop:Country', 'photoshop:Credit',
      'dc:title', 'dc:creator', 'dc:subject', 'dc:rights', 'dc:description'
    ],
    iptc: [
      '字符集', '标题 (ObjectName)', '标题 (Headline)', '说明 (Caption)', '关键词',
      '作者 (By-line)', '版权', '城市', '地区', '国家', '拍摄日期', '来源', '署名'
    ],
    icc: ['配置描述', '设备类别', '色彩空间', '渲染意图'],
    png: ['Software', 'Author', 'Description']
  };

  /**
   * 判断一行在「只看常用」模式下是否显示。
   * 未列出的分组与未列出的行默认隐藏（extra），可用「显示全部」找回。
   */
  function rowVisibility(groupId, row) {
    var allow = EXIF_CORE[groupId];
    if (allow === '*') return 'core';
    if (!allow) return 'extra';
    var name = String(row && row.name || '').trim();
    if (!name) return 'extra';
    if (allow.indexOf(name) >= 0) return 'core';
    // dc:* 一类的通配支持
    for (var i = 0; i < allow.length; i++) {
      if (allow[i].indexOf('*') >= 0) {
        var prefix = allow[i].replace(/\*+$/, '');
        if (name.indexOf(prefix) === 0) return 'core';
      }
    }
    return 'extra';
  }

  /**
   * 分组在「只看常用」模式下的显示决策（纯函数，便于单测）：
   *   - 核心字段为 0 的非警告组 → 整组不显示
   *   - 有核心字段（或警告组）→ 默认展开，不需要用户再点一次
   */
  function groupVisibility(groupId, rows) {
    var coreCount = 0;
    var extraCount = 0;
    (rows || []).forEach(function (row) {
      if (rowVisibility(groupId, row) === 'core') coreCount += 1;
      else extraCount += 1;
    });
    var isWarn = groupId === 'warn';
    return {
      coreCount: coreCount,
      extraCount: extraCount,
      hiddenWhenScoped: !isWarn && coreCount === 0,
      openWhenScoped: isWarn || coreCount > 0
    };
  }

  function reportToJson(parsed, report) {
    return {
      generatedBy: 'Exif Watermark Studio',
      generatedAt: new Date().toISOString(),
      file: parsed.file,
      format: parsed.format,
      dimensions: parsed.dimensions,
      orientation: parsed.orientation,
      summary: report.summary,
      groups: report.groups.map(function (g) {
        return {
          id: g.id,
          title: g.title,
          rows: g.rows.map(function (r) {
            var o = { name: r.name, value: r.value };
            if (r.tag) o.tag = r.tag;
            if (r.note) o.note = r.note;
            if (r.source) o.source = r.source;
            if (r.raw) o.raw = r.raw;
            return o;
          })
        };
      }),
      warnings: report.warnings
    };
  }

  /* ------------------------------------------------------------------ *
   * EXIF 补丁与回写
   * ------------------------------------------------------------------ */
  function patchExif(input, opts) {
    opts = opts || {};
    var bytes = exifLib.toUint8(input).slice();
    var changed = { orientation: false, width: false, height: false };
    if (bytes.length < 8) return { bytes: bytes, changed: changed };
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var le;
    if (bytes[0] === 0x49 && bytes[1] === 0x49) le = true;
    else if (bytes[0] === 0x4d && bytes[1] === 0x4d) le = false;
    else return { bytes: bytes, changed: changed };

    function get16(o) { return le ? dv.getUint16(o, true) : dv.getUint16(o, false); }
    function get32(o) { return le ? dv.getUint32(o, true) : dv.getUint32(o, false); }
    function set16(o, v) { if (le) dv.setUint16(o, v, true); else dv.setUint16(o, v, false); }
    function set32(o, v) { if (le) dv.setUint32(o, v, true); else dv.setUint32(o, v, false); }

    function walk(offset, cb) {
      if (offset < 8 || offset + 2 > bytes.length) return;
      var count = get16(offset);
      if (count > 4096) return;
      for (var i = 0; i < count; i++) {
        var eo = offset + 2 + i * 12;
        if (eo + 12 > bytes.length) return;
        var tag = get16(eo);
        var type = get16(eo + 2);
        var cnt = get32(eo + 4);
        var vo = get32(eo + 8);
        var unit = tags.TYPE_SIZES[type] || 1;
        var size = unit * cnt;
        cb({ tag: tag, type: type, count: cnt, entryOffset: eo, valueOffset: vo, size: size });
      }
    }

    function writeNumber(entry, value, width) {
      var target = entry.size <= 4 ? entry.entryOffset + 8 : entry.valueOffset;
      if (width === 2) {
        if (target + 2 > bytes.length) return false;
        set16(target, value);
      } else {
        if (target + 4 > bytes.length) return false;
        set32(target, value);
      }
      return true;
    }

    var ifd0Offset = get32(4);
    var exifOffset = 0;
    walk(ifd0Offset, function (e) {
      if (e.tag === 0x8769 && e.type === 4) exifOffset = get32(e.size <= 4 ? e.entryOffset + 8 : e.valueOffset);
      if (e.tag === 0x0112 && opts.orientation != null && e.count === 1 && (e.type === 3)) {
        if (writeNumber(e, opts.orientation, 2)) changed.orientation = true;
      }
    });
    if (exifOffset) {
      walk(exifOffset, function (e) {
        if ((e.tag === 0xa002 || e.tag === 0xa003) && e.count === 1) {
          var target = e.tag === 0xa002 ? opts.width : opts.height;
          if (target == null) return;
          if (e.type === 3) {
            if (writeNumber(e, target, 2)) {
              if (e.tag === 0xa002) changed.width = true; else changed.height = true;
            }
          } else if (e.type === 4) {
            if (writeNumber(e, target, 4)) {
              if (e.tag === 0xa002) changed.width = true; else changed.height = true;
            }
          }
        }
      });
    }
    return { bytes: bytes, changed: changed };
  }

  function buildExifApp1(tiff) {
    var bytes = exifLib.toUint8(tiff);
    var payloadLength = bytes.length + 6;
    if (payloadLength + 2 > 0xffff) return null;
    var out = new Uint8Array(payloadLength + 4);
    out[0] = 0xff;
    out[1] = 0xe1;
    out[2] = ((payloadLength + 2) >> 8) & 0xff;
    out[3] = (payloadLength + 2) & 0xff;
    out.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
    out.set(bytes, 10);
    return out;
  }

  function concatChunks(parts) {
    var length = 0;
    for (var i = 0; i < parts.length; i++) length += parts[i].length;
    var out = new Uint8Array(length);
    var offset = 0;
    for (var j = 0; j < parts.length; j++) {
      out.set(parts[j], offset);
      offset += parts[j].length;
    }
    return out;
  }

  function scanJpegSegmentKinds(bytes) {
    var kinds = {};
    var i = 2;
    while (i + 4 <= bytes.length) {
      if (bytes[i] !== 0xff) break;
      var marker = bytes[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; }
      var len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (len < 2) break;
      var ds = i + 4;
      var head = ascii(bytes, ds, Math.min(bytes.length, ds + 29));
      if (marker === 0xe1) {
        if (head.indexOf('Exif') === 0) kinds.exif = 1;
        else if (head.indexOf('http://ns.adobe.com/xap/1.0/') === 0) kinds.xmp = 1;
      } else if (marker === 0xe2 && head.indexOf('ICC_PROFILE') === 0) {
        kinds.icc = 1;
      } else if (marker === 0xed && head.indexOf('Photoshop 3.0') === 0) {
        kinds.iptc = 1;
      }
      i += 2 + len;
    }
    return kinds;
  }

  function segmentKind(seg) {
    var marker = seg[1];
    var ds = 4;
    var head = ascii(seg, ds, Math.min(seg.length, ds + 29));
    if (marker === 0xe1) {
      if (head.indexOf('Exif') === 0) return 'exif';
      if (head.indexOf('http://ns.adobe.com/xap/1.0/') === 0) return 'xmp';
    }
    if (marker === 0xe2 && head.indexOf('ICC_PROFILE') === 0) return 'icc';
    if (marker === 0xed && head.indexOf('Photoshop 3.0') === 0) return 'iptc';
    return 'other';
  }

  function injectJpegSegments(input, segments) {
    var bytes = exifLib.toUint8(input);
    var warnings = [];
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return { bytes: bytes, warnings: ['目标不是 JPEG 数据，跳过元数据注入'] };
    }
    var existing = scanJpegSegmentKinds(bytes);
    var parts = [bytes.subarray(0, 2)];
    var injected = 0;
    segments.forEach(function (seg) {
      if (!seg || seg.length < 4) return;
      if (seg[0] !== 0xff) return;
      var marker = seg[1];
      if (marker < 0xe1 || marker > 0xef) return;
      var declared = (seg[2] << 8) | seg[3];
      if (declared + 2 !== seg.length) {
        warnings.push('元数据段长度不一致，已跳过（标记 0x' + marker.toString(16) + '）');
        return;
      }
      var kind = segmentKind(seg);
      if (kind !== 'other' && existing[kind]) {
        warnings.push('目标 JPEG 已存在同类元数据（' + kind + '），跳过注入');
        return;
      }
      if (kind !== 'other') existing[kind] = 1;
      parts.push(seg);
      injected++;
    });
    if (!injected) return { bytes: bytes, warnings: warnings };
    parts.push(bytes.subarray(2));
    return { bytes: concatChunks(parts), warnings: warnings };
  }

  function crc32(input) {
    var bytes = exifLib.toUint8(input);
    var table = crc32.table;
    if (!table) {
      table = crc32.table = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function buildPngChunk(type, data) {
    var typeBytes = new Uint8Array(4);
    for (var i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);
    var out = new Uint8Array(12 + data.length);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, data.length, false);
    out.set(typeBytes, 4);
    out.set(data, 8);
    var crc = crc32(concatU8([typeBytes, data]));
    dv.setUint32(8 + data.length, crc, false);
    return out;
  }

  function concatU8(parts) {
    return concatChunks(parts);
  }

  function rebuildPng(input, preserved) {
    var bytes = exifLib.toUint8(input);
    var warnings = [];
    if (!(bytes[0] === 0x89 && bytes[1] === 0x50)) {
      return { bytes: bytes, warnings: ['目标不是 PNG 数据，跳过元数据重建'] };
    }
    var existing = parsePngChunks(bytes);
    if (!existing.length) return { bytes: bytes, warnings: ['无法解析目标 PNG 数据块'] };
    var targetTypes = {};
    existing.forEach(function (c) { targetTypes[c.type] = 1; });
    var keep = [];
    (preserved || []).forEach(function (chunk) {
      if (!chunk || chunk.length < 12) return;
      var type = ascii(chunk, 4, 8);
      if (['IHDR', 'IDAT', 'IEND', 'PLTE', 'tRNS'].indexOf(type) >= 0) return;
      if (targetTypes[type]) {
        warnings.push('目标 PNG 已存在 ' + type + ' 块，跳过');
        return;
      }
      keep.push(chunk);
    });
    if (!keep.length) return { bytes: bytes, warnings: warnings };
    var parts = [bytes.subarray(0, 8)];
    var inserted = false;
    existing.forEach(function (c) {
      parts.push(c.raw);
      if (c.type === 'IHDR' && !inserted) {
        keep.forEach(function (k) { parts.push(k); });
        inserted = true;
      }
    });
    return { bytes: concatChunks(parts), warnings: warnings };
  }

  function makeExifChunk(tiff) {
    return buildPngChunk('eXIf', exifLib.toUint8(tiff));
  }

  return {
    buildReport: buildReport,
    reportToJson: reportToJson,
    rowVisibility: rowVisibility,
    groupVisibility: groupVisibility,
    parseXmp: parseXmp,
    parseIptc: parseIptc,
    parseIcc: parseIcc,
    parsePngChunks: parsePngChunks,
    buildSummary: buildSummary,
    xmpToMap: xmpToMap,
    applyXmpSummary: applyXmpSummary,
    parseEditText: parseEditText,
    applyFieldEdit: applyFieldEdit,
    formatFieldDisplay: formatFieldDisplay,
    xmpGps: xmpGps,
    xmpNumber: xmpNumber,
    formatDms: formatDms,
    formatBytes: formatBytes,
    parseDateParts: parseDateParts,
    formatDate: formatDate,
    formatDateStyle: formatDateStyle,
    formatTimeStyle: formatTimeStyle,
    formatCoord: formatCoord,
    formatShutterCompact: formatShutterCompact,
    patchExif: patchExif,
    buildExifApp1: buildExifApp1,
    injectJpegSegments: injectJpegSegments,
    rebuildPng: rebuildPng,
    buildPngChunk: buildPngChunk,
    makeExifChunk: makeExifChunk,
    crc32: crc32,
    concatU8: concatU8
  };
});
