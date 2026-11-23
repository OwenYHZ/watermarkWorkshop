/*!
 * export.js — 导出编码、EXIF/PNG 元数据回写、文件名与 ZIP 打包
 *
 *   WM.export.encodeWithMetadata({canvas, format, quality, sourceBytes, parsed, keepMetadata})
 *       -> Promise<{blob, warnings}>
 *   WM.export.targetDimensions(width, height, outputSettings)
 *   WM.export.buildFilename(pattern, tokens, ext)
 *   WM.export.zip([{name, blob}]) -> Promise<Blob>
 *   WM.export.download(blob, filename)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./meta.js'));
  } else {
    root.WM = root.WM || {};
    root.WM.export = factory(root.WM.meta);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (meta) {
  'use strict';

  var MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  var EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
  var MAX_DIMENSION = 16384;
  var MAX_AREA = 268435456; // Chrome/Skia 常用上限

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function mimeFor(format) {
    return MIME[format] || MIME.jpeg;
  }

  function extFor(format) {
    return EXT[format] || 'jpg';
  }

  function jpegSegment(marker, payload) {
    if (!payload || payload.length + 2 > 0xffff) return null;
    var out = new Uint8Array(payload.length + 4);
    out[0] = 0xff;
    out[1] = marker;
    out[2] = ((payload.length + 2) >> 8) & 0xff;
    out[3] = (payload.length + 2) & 0xff;
    out.set(payload, 4);
    return out;
  }

  function xmpApp1Segment(xml) {
    var enc = new TextEncoder();
    return jpegSegment(0xe1, meta.concatU8([
      enc.encode('http://ns.adobe.com/xap/1.0/\u0000'),
      enc.encode(xml)
    ]));
  }

  function xmpItxtChunk(xml) {
    var enc = new TextEncoder();
    var keyword = enc.encode('XML:com.adobe.xmp');
    var lang = enc.encode('zh');
    var translated = enc.encode('XMP');
    return meta.buildPngChunk('iTXt', meta.concatU8([
      keyword,
      new Uint8Array([0, 0, 0]), // 关键字结束 + 未压缩标志 + 压缩方法
      lang,
      new Uint8Array([0]),
      translated,
      new Uint8Array([0]),
      enc.encode(xml)
    ]));
  }

  function pngChunkKeyword(chunk) {
    if (!chunk || !chunk.data || !chunk.data.length) return '';
    var data = chunk.data;
    var end = 0;
    while (end < data.length && data[end] !== 0) end++;
    var s = '';
    for (var i = 0; i < end; i++) s += String.fromCharCode(data[i]);
    return s;
  }

  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mimeMatch = /data:([^;]+)/.exec(parts[0]);
    var mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    var binary = atob(parts[1]);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  function encode(canvas, opts) {
    opts = opts || {};
    var format = opts.format || 'jpeg';
    var mime = mimeFor(format);
    var quality = format === 'png' ? undefined : clamp(opts.quality == null ? 0.92 : opts.quality, 0.05, 1);
    return new Promise(function (resolve, reject) {
      try {
        if (typeof canvas.toBlob === 'function') {
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('浏览器无法编码为 ' + format.toUpperCase()));
          }, mime, quality);
        } else {
          resolve(dataUrlToBlob(canvas.toDataURL(mime, quality)));
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  async function readBytes(blob) {
    return new Uint8Array(await blob.arrayBuffer());
  }

  function keepJpegSegments(parsed) {
    var segments = [];
    var warnings = [];
    if (!parsed || !parsed.metadata) return { segments: segments, warnings: warnings };
    if (parsed.exif && parsed.exif.tiffBytes) {
      // 尺寸与方向在 encodeWithMetadata 中补丁后重建
      segments.push({ kind: 'exif', tiff: parsed.exif.tiffBytes, raw: parsed.metadata.exifApp1 });
    }
    var xmpList = parsed.metadata.xmpApp1 || [];
    if (xmpList.length) {
      segments.push({ kind: 'xmp', raw: xmpList[0] });
      if (xmpList.length > 1) warnings.push('仅保留标准 XMP 段，扩展 XMP 段未写入');
    }
    if (parsed.metadata.iptcApp13) segments.push({ kind: 'iptc', raw: parsed.metadata.iptcApp13 });
    return { segments: segments, warnings: warnings };
  }

  function buildJpegSegments(parsed, width, height) {
    var prepared = keepJpegSegments(parsed);
    var segments = [];
    var warnings = prepared.warnings.slice();
    prepared.segments.forEach(function (seg) {
      if (seg.kind === 'exif') {
        var patched = meta.patchExif(seg.tiff, { orientation: 1, width: width, height: height });
        var built = meta.buildExifApp1(patched.bytes);
        if (built) segments.push(built);
        else warnings.push('EXIF 数据超过 64KB，无法写入 JPEG');
      } else if (seg.raw) {
        segments.push(seg.raw);
      }
    });
    var hasXmp = prepared.segments.some(function (seg) { return seg.kind === 'xmp'; });
    if (!hasXmp && parsed && parsed.xmp && parsed.xmp.xml) {
      var xmpSeg = xmpApp1Segment(parsed.xmp.xml);
      if (xmpSeg) segments.push(xmpSeg);
      else warnings.push('XMP 数据超过 64KB，未写入 JPEG');
    }
    return { segments: segments, warnings: warnings };
  }

  function pngPreservedChunks(parsed, sourceBytes, width, height) {
    var warnings = [];
    var chunks = [];
    var sourceChunks = [];
    if (sourceBytes) {
      try {
        sourceChunks = meta.parsePngChunks(sourceBytes, {
          onlyTypes: ['tEXt', 'zTXt', 'iTXt', 'pHYs', 'tIME', 'eXIf']
        });
      } catch (e) {
        warnings.push('PNG 原始数据块解析失败：' + e.message);
      }
    }
    var allowed = { tEXt: 1, zTXt: 1, iTXt: 1, pHYs: 1, tIME: 1 };
    var hasExif = false;
    var hasXmpItxt = false;
    sourceChunks.forEach(function (chunk) {
      if (allowed[chunk.type]) {
        chunks.push(chunk.raw);
        if (chunk.type === 'iTXt' && /xmp/i.test(pngChunkKeyword(chunk))) hasXmpItxt = true;
      } else if (chunk.type === 'eXIf') {
        hasExif = true;
      }
    });
    if (parsed && parsed.exif && parsed.exif.tiffBytes) {
      var patched = meta.patchExif(parsed.exif.tiffBytes, { orientation: 1, width: width, height: height });
      chunks.unshift(meta.buildPngChunk('eXIf', patched.bytes));
    } else if (hasExif && parsed && parsed.metadata && parsed.metadata.pngExifChunk) {
      chunks.unshift(parsed.metadata.pngExifChunk);
    }
    if (!hasXmpItxt && parsed && parsed.xmp && parsed.xmp.xml) {
      chunks.push(xmpItxtChunk(parsed.xmp.xml));
    }
    return { chunks: chunks, warnings: warnings };
  }

  async function encodeWithMetadata(opts) {
    opts = opts || {};
    var format = opts.format || 'jpeg';
    var blob = await encode(opts.canvas, { format: format, quality: opts.quality });
    var warnings = [];
    if (!opts.keepMetadata || !opts.parsed) {
      return { blob: blob, warnings: warnings };
    }
    try {
      if (format === 'jpeg') {
        var bytes = await readBytes(blob);
        var built = buildJpegSegments(opts.parsed, opts.width, opts.height);
        warnings = warnings.concat(built.warnings);
        if (built.segments.length) {
          var injected = meta.injectJpegSegments(bytes, built.segments);
          warnings = warnings.concat(injected.warnings);
          return { blob: new Blob([injected.bytes], { type: 'image/jpeg' }), warnings: warnings };
        }
      } else if (format === 'png') {
        var pngBytes = await readBytes(blob);
        var preserved = pngPreservedChunks(opts.parsed, opts.sourceBytes || null, opts.width, opts.height);
        var rebuilt = meta.rebuildPng(pngBytes, preserved.chunks);
        warnings = warnings.concat(preserved.warnings, rebuilt.warnings);
        return { blob: new Blob([rebuilt.bytes], { type: 'image/png' }), warnings: warnings };
      } else if (format === 'webp') {
        warnings.push('WebP 导出暂不支持回写 EXIF/PNG 文本块');
      }
    } catch (e) {
      warnings.push('元数据回写失败：' + e.message);
    }
    return { blob: blob, warnings: warnings };
  }

  /* ------------------------------------------------------------------ *
   * 目标尺寸
   * ------------------------------------------------------------------ */
  function targetDimensions(width, height, output) {
    output = output || {};
    var w = Math.max(1, Math.round(width));
    var h = Math.max(1, Math.round(height));
    var mode = output.resize || 'original';
    if (mode === 'longEdge') {
      var maxEdge = Math.max(64, Number(output.longEdge) || 2560);
      var scale = Math.min(1, maxEdge / Math.max(w, h));
      if (scale < 0.999) {
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
    } else if (mode === 'percent') {
      var pct = clamp(Number(output.percent) || 100, 1, 400);
      if (pct !== 100) {
        w = Math.max(1, Math.round(w * pct / 100));
        h = Math.max(1, Math.round(h * pct / 100));
      }
    }
    var limited = false;
    var note = '';
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      var s = MAX_DIMENSION / Math.max(w, h);
      w = Math.round(w * s);
      h = Math.round(h * s);
      limited = true;
      note = '已限制到浏览器 canvas 单边上限 ' + MAX_DIMENSION + 'px';
    }
    if (w * h > MAX_AREA) {
      var s2 = Math.sqrt(MAX_AREA / (w * h));
      w = Math.round(w * s2);
      h = Math.round(h * s2);
      limited = true;
      note = '已限制到浏览器 canvas 面积上限（约 2.68 亿像素）';
    }
    return { width: Math.max(1, w), height: Math.max(1, h), limited: limited, note: note };
  }

  /* ------------------------------------------------------------------ *
   * 文件名
   * ------------------------------------------------------------------ */
  function sanitizeFilename(name) {
    var s = String(name || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^\.+/, '')
      .trim();
    if (!s) s = 'watermark';
    if (s.length > 120) s = s.slice(0, 120);
    return s;
  }

  function buildFilename(pattern, tokens, ext) {
    tokens = tokens || {};
    var s = pattern || '{name}_watermark';
    s = s.replace(/\{([a-zA-Z]+)\}/g, function (m, key) {
      if (tokens[key] != null && tokens[key] !== '') return String(tokens[key]);
      return '';
    });
    s = s.replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '');
    return sanitizeFilename(s) + '.' + (ext || 'jpg');
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ------------------------------------------------------------------ *
   * ZIP（store-only，UTF-8 文件名）
   * ------------------------------------------------------------------ */
  function dosDateTime(date) {
    var d = date || new Date();
    var year = Math.max(1980, d.getFullYear());
    var time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
    var day = (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time: time, date: day };
  }

  function writeLocalHeader(nameBytes, data, crc, dos) {
    var out = new Uint8Array(30 + nameBytes.length);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8
    dv.setUint16(8, 0, true); // store
    dv.setUint16(10, dos.time, true);
    dv.setUint16(12, dos.date, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    out.set(nameBytes, 30);
    return out;
  }

  function writeCentralHeader(nameBytes, data, crc, dos, offset) {
    var out = new Uint8Array(46 + nameBytes.length);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, dos.time, true);
    dv.setUint16(14, dos.date, true);
    dv.setUint32(16, crc, true);
    dv.setUint32(20, data.length, true);
    dv.setUint32(24, data.length, true);
    dv.setUint16(28, nameBytes.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, offset, true);
    out.set(nameBytes, 46);
    return out;
  }

  async function zip(files, onProgress) {
    var encoder = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;
    var dos = dosDateTime(new Date());
    for (var i = 0; i < files.length; i++) {
      var entry = files[i];
      var data = entry.bytes || await readBytes(entry.blob);
      var nameBytes = encoder.encode(sanitizeFilename(entry.name));
      var crc = meta.crc32(data);
      var local = writeLocalHeader(nameBytes, data, crc, dos);
      parts.push(local, data);
      central.push(writeCentralHeader(nameBytes, data, crc, dos, offset));
      offset += local.length + data.length;
      if (onProgress) onProgress(i + 1, files.length, entry.name);
      // 让出主线程，避免大文件阻塞 UI
      if (i % 3 === 2) await new Promise(function (r) { setTimeout(r, 0); });
    }
    var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var eocd = new Uint8Array(22);
    var dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(4, 0, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, files.length, true);
    dv.setUint16(10, files.length, true);
    dv.setUint32(12, centralSize, true);
    dv.setUint32(16, offset, true);
    dv.setUint16(20, 0, true);
    var all = parts.concat(central, [eocd]);
    return new Blob(all, { type: 'application/zip' });
  }

  return {
    MIME: MIME,
    EXT: EXT,
    MAX_DIMENSION: MAX_DIMENSION,
    MAX_AREA: MAX_AREA,
    encode: encode,
    encodeWithMetadata: encodeWithMetadata,
    targetDimensions: targetDimensions,
    buildFilename: buildFilename,
    sanitizeFilename: sanitizeFilename,
    download: download,
    zip: zip,
    mimeFor: mimeFor,
    extFor: extFor,
    buildJpegSegments: buildJpegSegments,
    pngPreservedChunks: pngPreservedChunks
  };
});
