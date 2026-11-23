/*!
 * exif.js — JPEG / PNG 元数据解析器（无依赖）
 *
 * 入口：
 *   WM.exif.parse(arrayBuffer|Uint8Array, {name,type,lastModified}) -> Promise<ParseResult>
 *   WM.exif.parseTiff(bytes) -> ExifInfo        （eXIf / TIFF 容器复用）
 *   WM.exif.sniffFormat(bytes) -> 'jpeg' | 'png' | 'unknown'
 *
 * 设计原则：任何损坏、越界、未知字段都不得抛出异常；解析失败记录在 warnings 中。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./tags.js'));
  else {
    root.WM = root.WM || {};
    root.WM.exif = factory(root.WM.tags);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (tags) {
  'use strict';

  var TYPE_SIZES = (tags && tags.TYPE_SIZES) || {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4
  };

  var SOF_NAMES = {
    0xc0: 'Baseline DCT（基线）',
    0xc1: 'Extended sequential DCT（扩展顺序）',
    0xc2: 'Progressive DCT（渐进式）',
    0xc3: 'Lossless（无损）',
    0xc5: 'Differential sequential DCT',
    0xc6: 'Differential progressive DCT',
    0xc7: 'Differential lossless',
    0xc9: 'Extended sequential DCT（算术编码）',
    0xca: 'Progressive DCT（算术编码）',
    0xcb: 'Lossless（算术编码）',
    0xcd: 'Differential sequential DCT（算术编码）',
    0xce: 'Differential progressive DCT（算术编码）',
    0xcf: 'Differential lossless（算术编码）'
  };

  var PNG_COLOR_TYPES = {
    0: '灰度 (Grayscale)',
    2: '真彩 RGB',
    3: '索引色 (Palette)',
    4: '灰度 + Alpha',
    6: '真彩 RGB + Alpha'
  };

  var JPEG_INTERCHANGE_STANDARD = [
    16, 11, 10, 16, 24, 40, 51, 61,
    12, 12, 14, 19, 26, 58, 60, 55,
    14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62,
    18, 22, 37, 56, 68, 109, 103, 77,
    24, 35, 55, 64, 81, 104, 113, 92,
    49, 64, 78, 87, 103, 121, 120, 101,
    72, 92, 95, 98, 112, 100, 103, 99
  ];

  /* zigzag 序号 -> 自然序号（libjpeg 的 jpeg_natural_order 前 64 项） */
  var NATURAL_ORDER = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
  ];

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */
  function toUint8(input) {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (input && input.buffer instanceof ArrayBuffer) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    throw new Error('无法识别的二进制数据');
  }

  function isPng(bytes) {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
      bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a;
  }

  function sniffFormat(input) {
    var bytes;
    try { bytes = toUint8(input); } catch (e) { return 'unknown'; }
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';
    if (isPng(bytes)) return 'png';
    return 'unknown';
  }

  function u16(dv, offset, le) {
    return le ? dv.getUint16(offset, true) : dv.getUint16(offset, false);
  }
  function u32(dv, offset, le) {
    return le ? dv.getUint32(offset, true) : dv.getUint32(offset, false);
  }
  function i16(dv, offset, le) {
    return le ? dv.getInt16(offset, true) : dv.getInt16(offset, false);
  }
  function i32(dv, offset, le) {
    return le ? dv.getInt32(offset, true) : dv.getInt32(offset, false);
  }

  function asciiRange(bytes, start, end) {
    var s = '';
    for (var i = start; i < end && i < bytes.length; i++) {
      s += String.fromCharCode(bytes[i]);
    }
    return s;
  }

  function readCString(bytes, start, maxLen) {
    var end = start;
    var limit = Math.min(bytes.length, start + (maxLen || 256));
    while (end < limit && bytes[end] !== 0) end++;
    return asciiRange(bytes, start, end);
  }

  function startsWithAscii(bytes, start, prefix) {
    if (start + prefix.length > bytes.length) return false;
    for (var i = 0; i < prefix.length; i++) {
      if (bytes[start + i] !== prefix.charCodeAt(i)) return false;
    }
    return true;
  }

  function decodeXmlBytes(bytes) {
    if (!bytes || !bytes.length) return '';
    var slice = bytes;
    while (slice.length && slice[slice.length - 1] === 0) slice = slice.subarray(0, slice.length - 1);
    var start = 0;
    while (start < slice.length && slice[start] === 0) start++;
    if (start > 0) slice = slice.subarray(start);
    try {
      if (slice.length >= 2 && slice[0] === 0xff && slice[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(slice.subarray(2));
      }
      if (slice.length >= 2 && slice[0] === 0xfe && slice[1] === 0xff) {
        return new TextDecoder('utf-16be').decode(slice.subarray(2));
      }
      return new TextDecoder('utf-8').decode(slice);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(slice);
    }
  }

  function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') {
      return Promise.reject(new Error('当前浏览器不支持 DecompressionStream，无法解压该字段'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function first(v) {
    return Array.isArray(v) && v.length ? v[0] : v;
  }

  /* ------------------------------------------------------------------ *
   * TIFF / EXIF
   * ------------------------------------------------------------------ */
  function parseTiff(input) {
    var tiff = toUint8(input);
    var exif = {
      byteOrder: 'little',
      ifd0: emptyIfd('ifd0'),
      exif: emptyIfd('exif'),
      gps: emptyIfd('gps'),
      interop: emptyIfd('interop'),
      ifd1: emptyIfd('ifd1'),
      thumbnailBytes: null,
      thumbnailMime: '',
      warnings: [],
      tiffSize: tiff.length
    };
    if (tiff.length < 8) {
      exif.warnings.push('TIFF 数据长度不足 8 字节');
      return exif;
    }
    var dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    var le;
    if (tiff[0] === 0x49 && tiff[1] === 0x49) le = true;
    else if (tiff[0] === 0x4d && tiff[1] === 0x4d) le = false;
    else {
      exif.warnings.push('未知的 TIFF 字节序标记');
      return exif;
    }
    exif.byteOrder = le ? 'little' : 'big';
    var magic = u16(dv, 2, le);
    if (magic !== 42) {
      exif.warnings.push('TIFF 魔数异常（' + magic + '），可能是压缩或损坏的 EXIF');
      return exif;
    }
    var ifd0Offset = u32(dv, 4, le);
    var ifd0 = readIfd(tiff, dv, le, ifd0Offset, 'ifd0', exif);
    exif.ifd0 = ifd0;

    var exifPointer = ifd0.map[0x8769];
    if (exifPointer && isFinite(Number(first(exifPointer.value)))) {
      exif.exif = readIfd(tiff, dv, le, Number(first(exifPointer.value)), 'exif', exif);
    }
    var gpsPointer = ifd0.map[0x8825];
    if (gpsPointer && isFinite(Number(first(gpsPointer.value)))) {
      exif.gps = readIfd(tiff, dv, le, Number(first(gpsPointer.value)), 'gps', exif);
    }
    var interopPointer = exif.exif.map[0xa005];
    if (interopPointer && isFinite(Number(first(interopPointer.value)))) {
      exif.interop = readIfd(tiff, dv, le, Number(first(interopPointer.value)), 'interop', exif);
    }
    if (ifd0.nextOffset > 0) {
      exif.ifd1 = readIfd(tiff, dv, le, ifd0.nextOffset, 'ifd1', exif);
      var thumbOffsetEntry = exif.ifd1.map[0x0201];
      var thumbLengthEntry = exif.ifd1.map[0x0202];
      if (thumbOffsetEntry && thumbLengthEntry) {
        var thumbOffset = Number(first(thumbOffsetEntry.value));
        var thumbLength = Number(first(thumbLengthEntry.value));
        if (isFinite(thumbOffset) && isFinite(thumbLength) && thumbLength > 0 &&
          thumbOffset + thumbLength <= tiff.length) {
          exif.thumbnailBytes = new Uint8Array(tiff.subarray(thumbOffset, thumbOffset + thumbLength));
          if (exif.thumbnailBytes[0] === 0xff && exif.thumbnailBytes[1] === 0xd8) exif.thumbnailMime = 'image/jpeg';
          else if (isPng(exif.thumbnailBytes)) exif.thumbnailMime = 'image/png';
        }
      }
    }
    return exif;
  }

  function emptyIfd(name) {
    return { name: name, offset: 0, entries: [], map: {}, nextOffset: 0 };
  }

  function readIfd(tiff, dv, le, offset, name, root) {
    var ifd = emptyIfd(name);
    ifd.offset = offset;
    if (!isFinite(offset) || offset < 8 || offset + 2 > tiff.length) {
      root.warnings.push(name + ' IFD 偏移越界（' + offset + '）');
      return ifd;
    }
    if (offset % 2 === 1) {
      // 允许但记录，部分写入器未对齐
      root.warnings.push(name + ' IFD 偏移未按偶数对齐');
    }
    var count = u16(dv, offset, le);
    if (count > 4096) {
      root.warnings.push(name + ' IFD 条目数量异常（' + count + '），已停止读取');
      return ifd;
    }
    var pos = offset + 2;
    for (var i = 0; i < count; i++) {
      var entryOffset = pos + i * 12;
      if (entryOffset + 12 > tiff.length) {
        root.warnings.push(name + ' IFD 在读取第 ' + (i + 1) + ' 条时越界');
        break;
      }
      var tag = u16(dv, entryOffset, le);
      var type = u16(dv, entryOffset + 2, le);
      var cnt = u32(dv, entryOffset + 4, le);
      var valueOffset = u32(dv, entryOffset + 8, le);
      var unit = TYPE_SIZES[type];
      if (!unit) {
        ifd.entries.push({
          tag: tag, type: type, typeName: 'UNKNOWN(' + type + ')', count: cnt,
          entryOffset: entryOffset, valueOffset: valueOffset, bytes: null,
          value: null, invalid: true, size: 0
        });
        continue;
      }
      var size = unit * cnt;
      var entry = {
        tag: tag,
        type: type,
        typeName: (tags && tags.TYPE_NAMES && tags.TYPE_NAMES[type]) || ('TYPE' + type),
        count: cnt,
        entryOffset: entryOffset,
        valueOffset: valueOffset,
        size: size,
        inline: size <= 4,
        bytes: null,
        value: null,
        invalid: false
      };
      if (cnt === 0) {
        entry.value = type === 2 ? '' : null;
        ifd.entries.push(entry);
        ifd.map[tag] = entry;
        continue;
      }
      if (size > 0 && size < 200000000) {
        var dataOffset = size <= 4 ? entryOffset + 8 : valueOffset;
        if (dataOffset < 0 || dataOffset + size > tiff.length) {
          entry.invalid = true;
          root.warnings.push(name + ' 标签 ' + (tags ? tags.hexTag(tag) : tag) + ' 数据越界');
        } else {
          entry.bytes = new Uint8Array(tiff.subarray(dataOffset, dataOffset + size));
          try {
            entry.value = decodeValue(dv, le, type, cnt, dataOffset);
          } catch (e) {
            entry.invalid = true;
            root.warnings.push(name + ' 标签 ' + (tags ? tags.hexTag(tag) : tag) + ' 解码失败：' + e.message);
          }
        }
      } else {
        entry.invalid = true;
        root.warnings.push(name + ' 标签 ' + (tags ? tags.hexTag(tag) : tag) + ' 长度异常（' + size + ' 字节）');
      }
      ifd.entries.push(entry);
      if (ifd.map[tag] == null) ifd.map[tag] = entry;
    }
    var nextPos = offset + 2 + count * 12;
    if (nextPos + 4 <= tiff.length) {
      ifd.nextOffset = u32(dv, nextPos, le);
    } else {
      root.warnings.push(name + ' IFD 结尾越界，无法读取下一 IFD');
    }
    return ifd;
  }

  function decodeValue(dv, le, type, count, offset) {
    var i, out;
    switch (type) {
      case 2: {
        var bytes = new Uint8Array(dv.buffer, dv.byteOffset + offset, count);
        return tags.decodeAsciiBytes(bytes);
      }
      case 3:
        if (count === 1) return u16(dv, offset, le);
        out = [];
        for (i = 0; i < count; i++) out.push(u16(dv, offset + i * 2, le));
        return out;
      case 4:
        if (count === 1) return u32(dv, offset, le);
        out = [];
        for (i = 0; i < count; i++) out.push(u32(dv, offset + i * 4, le));
        return out;
      case 5:
      case 10: {
        var mk = function (p) {
          return {
            n: type === 5 ? u32(dv, p, le) : i32(dv, p, le),
            d: type === 5 ? u32(dv, p + 4, le) : i32(dv, p + 4, le)
          };
        };
        if (count === 1) return mk(offset);
        out = [];
        for (i = 0; i < count; i++) out.push(mk(offset + i * 8));
        return out;
      }
      case 6: case 1: case 7:
        return new Uint8Array(dv.buffer, dv.byteOffset + offset, count).slice();
      case 8:
        if (count === 1) return i16(dv, offset, le);
        out = [];
        for (i = 0; i < count; i++) out.push(i16(dv, offset + i * 2, le));
        return out;
      case 9:
        if (count === 1) return i32(dv, offset, le);
        out = [];
        for (i = 0; i < count; i++) out.push(i32(dv, offset + i * 4, le));
        return out;
      case 11:
        if (count === 1) return dv.getFloat32(offset, le);
        out = [];
        for (i = 0; i < count; i++) out.push(dv.getFloat32(offset + i * 4, le));
        return out;
      case 12:
        if (count === 1) return dv.getFloat64(offset, le);
        out = [];
        for (i = 0; i < count; i++) out.push(dv.getFloat64(offset + i * 8, le));
        return out;
      case 13:
        if (count === 1) return u32(dv, offset, le);
        out = [];
        for (i = 0; i < count; i++) out.push(u32(dv, offset + i * 4, le));
        return out;
      default:
        return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * JPEG
   * ------------------------------------------------------------------ */
  function parseJpeg(bytes, out) {
    var jpeg = {
      jfif: null,
      sof: null,
      adobe: null,
      comment: null,
      dqtTables: 0,
      dhtTables: 0,
      restartInterval: 0,
      quantSample: null,
      segmentCount: 0
    };
    var meta = out.metadata;
    var iccParts = [];
    var extXmp = { parts: {}, total: 0, guid: '' };
    var i = 2;
    var guard = 0;
    var sosSeen = false;

    while (i + 1 < bytes.length && guard++ < 200000) {
      if (bytes[i] !== 0xff) {
        if (!sosSeen) out.warnings.push('JPEG 结构异常：在偏移 ' + i + ' 处出现非标记字节');
        break;
      }
      var marker = bytes[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0x00) { i += 2; continue; }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        if (marker === 0xd9) break;
        continue;
      }
      if (i + 4 > bytes.length) { out.warnings.push('JPEG 在读取标记长度时被截断'); break; }
      var segLen = (bytes[i + 2] << 8) | bytes[i + 3];
      if (segLen < 2) { out.warnings.push('JPEG 标记长度非法（' + segLen + '）'); break; }
      var dataStart = i + 4;
      var dataEnd = i + 2 + segLen;
      if (dataEnd > bytes.length) {
        out.warnings.push('JPEG 文件被截断，元数据可能不完整');
        break;
      }
      var segBytes = bytes.slice(i, dataEnd);
      jpeg.segmentCount++;

      if (marker === 0xe0) parseJfif(bytes, dataStart, dataEnd, jpeg);
      else if (marker === 0xe1) {
        if (startsWithAscii(bytes, dataStart, 'Exif')) {
          var tiffStart = dataStart + 6;
          if (tiffStart <= dataEnd) {
            try {
              out.exif = parseTiff(bytes.subarray(tiffStart, dataEnd));
              out.exif.tiffBytes = new Uint8Array(bytes.subarray(tiffStart, dataEnd));
              meta.exifApp1 = segBytes;
            } catch (e) {
              out.warnings.push('EXIF 段解析失败：' + e.message);
            }
          }
        } else if (startsWithAscii(bytes, dataStart, 'http://ns.adobe.com/xap/1.0/')) {
          var xmlStart = dataStart + 29;
          if (xmlStart < dataEnd) {
            out.xmpParts.push({ kind: 'standard', xml: decodeXmlBytes(bytes.subarray(xmlStart, dataEnd)) });
            meta.xmpApp1.push(segBytes);
          }
        } else if (startsWithAscii(bytes, dataStart, 'http://ns.adobe.com/xmp/extension/')) {
          var extStart = dataStart + 35;
          if (extStart + 40 <= dataEnd) {
            var guid = asciiRange(bytes, extStart, extStart + 32);
            var dvExt = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            var total = dvExt.getUint32(extStart + 32, false);
            var offExt = dvExt.getUint32(extStart + 36, false);
            extXmp.guid = guid;
            extXmp.total = total;
            extXmp.parts[offExt] = bytes.slice(extStart + 40, dataEnd);
          }
        }
      } else if (marker === 0xe2) {
        if (startsWithAscii(bytes, dataStart, 'ICC_PROFILE')) {
          if (dataStart + 14 <= dataEnd) {
            iccParts.push({
              seq: bytes[dataStart + 12],
              count: bytes[dataStart + 13],
              bytes: bytes.slice(dataStart + 14, dataEnd),
              segment: segBytes
            });
            meta.iccApp2.push(segBytes);
          }
        }
      } else if (marker === 0xed) {
        if (startsWithAscii(bytes, dataStart, 'Photoshop 3.0')) {
          var iptcStart = dataStart + 14;
          if (iptcStart <= dataEnd) {
            meta.iptcApp13 = segBytes;
            out.iptcRaw = new Uint8Array(bytes.subarray(iptcStart, dataEnd));
            var embedded = findResourceData(out.iptcRaw, 0x0424);
            if (embedded && !out.xmpParts.length) {
              out.xmpParts.push({ kind: 'photoshop', xml: decodeXmlBytes(embedded) });
            }
          }
        }
      } else if (marker === 0xfe) {
        jpeg.comment = tags.decodeBytes(bytes.subarray(dataStart, dataEnd)).trim();
      } else if (SOF_NAMES[marker]) {
        if (dataStart + 6 <= dataEnd) {
          var compCount = bytes[dataStart + 5];
          var comps = [];
          for (var ci = 0; ci < compCount; ci++) {
            var cpos = dataStart + 6 + ci * 3;
            if (cpos + 3 > dataEnd) break;
            comps.push({
              id: bytes[cpos],
              h: bytes[cpos + 1] >> 4,
              v: bytes[cpos + 1] & 0x0f,
              tq: bytes[cpos + 2]
            });
          }
          jpeg.sof = {
            marker: marker,
            kind: SOF_NAMES[marker],
            progressive: marker === 0xc2 || marker === 0xca,
            precision: bytes[dataStart],
            height: (bytes[dataStart + 1] << 8) | bytes[dataStart + 2],
            width: (bytes[dataStart + 3] << 8) | bytes[dataStart + 4],
            components: comps
          };
        }
      } else if (marker === 0xdb) {
        jpeg.dqtTables++;
        if (!jpeg.quantSample) {
          try {
            jpeg.quantSample = readQuantTable(bytes, dataStart, dataEnd);
          } catch (e) { /* 忽略 */ }
        }
      } else if (marker === 0xc4) {
        jpeg.dhtTables++;
      } else if (marker === 0xdd) {
        if (dataStart + 2 <= dataEnd) jpeg.restartInterval = (bytes[dataStart] << 8) | bytes[dataStart + 1];
      } else if (marker === 0xee) {
        if (startsWithAscii(bytes, dataStart, 'Adobe')) {
          jpeg.adobe = {
            version: (bytes[dataStart + 5] << 8) | bytes[dataStart + 6],
            flags0: (bytes[dataStart + 7] << 8) | bytes[dataStart + 8],
            flags1: (bytes[dataStart + 9] << 8) | bytes[dataStart + 10],
            transform: bytes[dataStart + 11]
          };
        }
      } else if (marker === 0xda) {
        sosSeen = true;
        break;
      }
      i = dataEnd;
    }

    if (iccParts.length) {
      iccParts.sort(function (a, b) { return a.seq - b.seq; });
      var totalLen = 0;
      for (var p = 0; p < iccParts.length; p++) totalLen += iccParts[p].bytes.length;
      var merged = new Uint8Array(totalLen);
      var cursor = 0;
      for (var q = 0; q < iccParts.length; q++) {
        merged.set(iccParts[q].bytes, cursor);
        cursor += iccParts[q].bytes.length;
      }
      out.iccRaw = merged;
      if (iccParts.length !== iccParts[0].count) {
        out.warnings.push('ICC 配置文件分片不完整（' + iccParts.length + '/' + iccParts[0].count + '）');
      }
    }

    if (Object.keys(extXmp.parts).length) {
      try {
        var keys = Object.keys(extXmp.parts).map(Number).sort(function (a, b) { return a - b; });
        var xml = '';
        for (var k = 0; k < keys.length; k++) xml += decodeXmlBytes(extXmp.parts[keys[k]]);
        if (xml) out.xmpParts.push({ kind: 'extended', xml: xml });
      } catch (e) {
        out.warnings.push('Extended XMP 合并失败：' + e.message);
      }
    }

    if (jpeg.quantSample) {
      jpeg.qualityEstimate = estimateQuality(jpeg.quantSample);
    }
    out.jpeg = jpeg;
  }

  function parseJfif(bytes, start, end, jpeg) {
    if (start + 14 > end) return;
    if (!startsWithAscii(bytes, start, 'JFIF')) return;
    jpeg.jfif = {
      version: bytes[start + 5] + '.' + (bytes[start + 6] < 10 ? '0' + bytes[start + 6] : bytes[start + 6]),
      units: bytes[start + 7],
      xDensity: (bytes[start + 8] << 8) | bytes[start + 9],
      yDensity: (bytes[start + 10] << 8) | bytes[start + 11],
      thumbWidth: bytes[start + 12],
      thumbHeight: bytes[start + 13]
    };
  }

  function readQuantTable(bytes, start, end) {
    var pos = start;
    if (pos + 65 > end) return null;
    var pq = bytes[pos] >> 4;
    var tq = bytes[pos] & 0x0f;
    pos++;
    var table = [];
    if (pq === 0) {
      for (var i = 0; i < 64; i++) table.push(bytes[pos + i]);
    } else {
      for (var j = 0; j < 64; j++) table.push((bytes[pos + j * 2] << 8) | bytes[pos + j * 2 + 1]);
    }
    return { precision: pq ? 16 : 8, id: tq, values: table };
  }

  function estimateQuality(sample) {
    if (!sample || sample.values.length < 64) return null;
    var ratios = [];
    for (var i = 0; i < 64; i++) {
      var base = JPEG_INTERCHANGE_STANDARD[NATURAL_ORDER[i]];
      if (base > 0) ratios.push(sample.values[i] / base);
    }
    ratios.sort(function (a, b) { return a - b; });
    var scale = ratios[Math.floor(ratios.length / 2)] * 100;
    if (!isFinite(scale) || scale <= 0) return null;
    var quality = scale > 100 ? 5000 / scale : (200 - scale) / 2;
    return Math.max(1, Math.min(100, Math.round(quality)));
  }

  function findResourceData(bytes, resourceId) {
    var pos = 0;
    while (pos + 12 <= bytes.length) {
      if (!(bytes[pos] === 0x38 && bytes[pos + 1] === 0x42 && bytes[pos + 2] === 0x49 && bytes[pos + 3] === 0x4d)) {
        pos++;
        continue;
      }
      var id = (bytes[pos + 4] << 8) | bytes[pos + 5];
      var nameLen = bytes[pos + 6];
      var nameTotal = 1 + nameLen;
      if (nameTotal % 2) nameTotal++;
      var sizePos = pos + 6 + nameTotal;
      if (sizePos + 4 > bytes.length) break;
      var size = (bytes[sizePos] << 24) | (bytes[sizePos + 1] << 16) | (bytes[sizePos + 2] << 8) | bytes[sizePos + 3];
      var dataPos = sizePos + 4;
      if (size < 0 || dataPos + size > bytes.length) break;
      if (id === resourceId) return bytes.slice(dataPos, dataPos + size);
      pos = dataPos + size + (size % 2);
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * PNG
   * ------------------------------------------------------------------ */
  async function parsePng(bytes, out) {
    var png = {
      ihdr: null,
      chunks: [],
      text: [],
      phys: null,
      time: null,
      gamma: null,
      chromaticity: null,
      renderingIntent: null,
      transparency: false,
      paletteEntries: 0,
      actl: null
    };
    var pos = 8;
    var guard = 0;
    while (pos + 12 <= bytes.length && guard++ < 100000) {
      var len = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
      if (len > bytes.length - pos - 12) {
        out.warnings.push('PNG 数据块长度越界（' + len + '），文件可能被截断');
        break;
      }
      var type = asciiRange(bytes, pos + 4, pos + 8);
      var dataStart = pos + 8;
      var dataEnd = dataStart + len;
      var keepContent = type !== 'IDAT' && type !== 'fdAT';
      var chunk = { type: type, length: len, offset: pos };
      if (keepContent) {
        chunk.bytes = bytes.slice(pos, dataEnd + 4);
        chunk.raw = chunk.bytes;
        chunk.data = bytes.slice(dataStart, dataEnd);
      }
      png.chunks.push(chunk);

      if (type === 'IHDR') {
        png.ihdr = {
          width: readU32BE(bytes, dataStart),
          height: readU32BE(bytes, dataStart + 4),
          bitDepth: bytes[dataStart + 8],
          colorType: bytes[dataStart + 9],
          compression: bytes[dataStart + 10],
          filter: bytes[dataStart + 11],
          interlace: bytes[dataStart + 12],
          colorTypeLabel: PNG_COLOR_TYPES[bytes[dataStart + 9]] || ('未知 (' + bytes[dataStart + 9] + ')')
        };
      } else if (type === 'PLTE') {
        png.paletteEntries = len / 3;
      } else if (type === 'tRNS') {
        png.transparency = true;
      } else if (type === 'pHYs') {
        png.phys = {
          x: readU32BE(bytes, dataStart),
          y: readU32BE(bytes, dataStart + 4),
          unit: bytes[dataStart + 8]
        };
      } else if (type === 'gAMA') {
        png.gamma = readU32BE(bytes, dataStart) / 100000;
      } else if (type === 'cHRM') {
        png.chromaticity = {
          wx: readU32BE(bytes, dataStart) / 100000,
          wy: readU32BE(bytes, dataStart + 4) / 100000,
          rx: readU32BE(bytes, dataStart + 8) / 100000,
          ry: readU32BE(bytes, dataStart + 12) / 100000,
          gx: readU32BE(bytes, dataStart + 16) / 100000,
          gy: readU32BE(bytes, dataStart + 20) / 100000,
          bx: readU32BE(bytes, dataStart + 24) / 100000,
          by: readU32BE(bytes, dataStart + 28) / 100000
        };
      } else if (type === 'sRGB') {
        png.renderingIntent = bytes[dataStart];
      } else if (type === 'tIME') {
        png.time = {
          year: (bytes[dataStart] << 8) | bytes[dataStart + 1],
          month: bytes[dataStart + 2],
          day: bytes[dataStart + 3],
          hour: bytes[dataStart + 4],
          minute: bytes[dataStart + 5],
          second: bytes[dataStart + 6]
        };
      } else if (type === 'acTL') {
        png.actl = { frames: readU32BE(bytes, dataStart), plays: readU32BE(bytes, dataStart + 4) };
      } else if (type === 'eXIf') {
        var tiffBytes = chunk.data;
        if (tiffBytes.length > 6 && tiffBytes[0] === 0x45 && tiffBytes[1] === 0x78 && tiffBytes[2] === 0x69 && tiffBytes[3] === 0x66) {
          tiffBytes = tiffBytes.subarray(6);
        }
        try {
          out.exif = parseTiff(tiffBytes);
          out.exif.tiffBytes = new Uint8Array(tiffBytes);
          out.metadata.pngExifChunk = chunk.bytes;
        } catch (e) {
          out.warnings.push('PNG eXIf 段解析失败：' + e.message);
        }
      } else if (type === 'iCCP') {
        var profileName = readCString(bytes, dataStart, 80);
        var compOffset = dataStart + profileName.length + 1;
        if (compOffset + 1 <= dataEnd) {
          var method = bytes[compOffset];
          if (method === 0) {
            try {
              out.iccRaw = await inflate(bytes.subarray(compOffset + 1, dataEnd));
            } catch (e) {
              out.warnings.push('PNG iCCP 解压失败：' + e.message);
            }
          }
          png.iccProfileName = profileName;
        }
      } else if (type === 'tEXt') {
        var keyEnd = dataStart;
        while (keyEnd < dataEnd && bytes[keyEnd] !== 0) keyEnd++;
        png.text.push({
          type: type,
          keyword: asciiRange(bytes, dataStart, keyEnd),
          text: tags.decodeBytes(bytes.subarray(keyEnd + 1, dataEnd)),
          compressed: false
        });
      } else if (type === 'zTXt') {
        var zKeyEnd = dataStart;
        while (zKeyEnd < dataEnd && bytes[zKeyEnd] !== 0) zKeyEnd++;
        var keyword = asciiRange(bytes, dataStart, zKeyEnd);
        var zMethod = bytes[zKeyEnd + 1];
        var entry = { type: type, keyword: keyword, text: '', compressed: true, method: zMethod };
        if (zMethod === 0) {
          try {
            entry.text = tags.decodeBytes(await inflate(bytes.subarray(zKeyEnd + 2, dataEnd)));
          } catch (e) {
            out.warnings.push('PNG zTXt（' + keyword + '）解压失败：' + e.message);
            entry.text = '（压缩文本无法解压）';
          }
        } else {
          entry.text = '（未知压缩方法 ' + zMethod + '）';
        }
        png.text.push(entry);
      } else if (type === 'iTXt') {
        var p = dataStart;
        var iKeyEnd = p;
        while (iKeyEnd < dataEnd && bytes[iKeyEnd] !== 0) iKeyEnd++;
        var iKeyword = asciiRange(bytes, p, iKeyEnd);
        p = iKeyEnd + 1;
        if (p + 2 <= dataEnd) {
          var compFlag = bytes[p];
          var compMethod = bytes[p + 1];
          p += 2;
          var langEnd = p;
          while (langEnd < dataEnd && bytes[langEnd] !== 0) langEnd++;
          var lang = asciiRange(bytes, p, langEnd);
          p = langEnd + 1;
          var transEnd = p;
          while (transEnd < dataEnd && bytes[transEnd] !== 0) transEnd++;
          var translated = tags.decodeBytes(bytes.subarray(p, transEnd));
          p = transEnd + 1;
          var iEntry = {
            type: type,
            keyword: iKeyword,
            language: lang,
            translatedKeyword: translated,
            text: '',
            compressed: compFlag === 1,
            method: compMethod
          };
          if (compFlag === 1 && compMethod === 0) {
            try {
              iEntry.text = tags.decodeBytes(await inflate(bytes.subarray(p, dataEnd)));
            } catch (e) {
              out.warnings.push('PNG iTXt（' + iKeyword + '）解压失败：' + e.message);
              iEntry.text = '（压缩文本无法解压）';
            }
          } else {
            iEntry.text = tags.decodeBytes(bytes.subarray(p, dataEnd));
          }
          png.text.push(iEntry);
          if (/xmp/i.test(iKeyword)) {
            out.xmpParts.push({ kind: 'png', xml: iEntry.text });
          }
        }
      } else if (type === 'IEND') {
        break;
      }
      pos = dataEnd + 4;
    }
    if (!png.ihdr) throw new Error('PNG 缺少 IHDR，文件可能不是有效的 PNG');
    out.png = png;
    out.dimensions = { width: png.ihdr.width, height: png.ihdr.height };

    if (png.text) {
      for (var t = 0; t < png.text.length; t++) {
        var txt = png.text[t];
        if (!out.xmpParts.length && /xml:com\.adobe\.xmp/i.test(txt.keyword || '')) {
          out.xmpParts.push({ kind: 'png', xml: txt.text });
        }
      }
    }
  }

  function readU32BE(bytes, offset) {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  }

  /* ------------------------------------------------------------------ *
   * 主入口
   * ------------------------------------------------------------------ */
  function normalizeFile(fileInfo, byteLength) {
    fileInfo = fileInfo || {};
    return {
      name: fileInfo.name || '未命名',
      type: fileInfo.type || '',
      size: fileInfo.size != null ? fileInfo.size : byteLength,
      lastModified: fileInfo.lastModified || 0
    };
  }

  async function parse(input, fileInfo) {
    var bytes;
    var result = {
      format: 'unknown',
      file: normalizeFile(fileInfo, 0),
      dimensions: { width: 0, height: 0 },
      orientation: 1,
      exif: null,
      jpeg: null,
      png: null,
      xmpParts: [],
      xmp: null,
      iptcRaw: null,
      iccRaw: null,
      metadata: {
        exifApp1: null,
        xmpApp1: [],
        iptcApp13: null,
        iccApp2: [],
        pngExifChunk: null
      },
      warnings: []
    };
    try {
      bytes = toUint8(input);
      result.file.size = bytes.byteLength;
      var format = sniffFormat(bytes);
      result.format = format;
      if (format === 'jpeg') {
        parseJpeg(bytes, result);
      } else if (format === 'png') {
        await parsePng(bytes, result);
      } else {
        throw new Error('不支持的图片格式：仅支持 JPG / PNG');
      }
    } catch (e) {
      result.warnings.push(e && e.message ? e.message : String(e));
    }

    if (result.exif) {
      var orientEntry = result.exif.ifd0.map[0x0112];
      var orient = orientEntry ? Number(first(orientEntry.value)) : 1;
      result.orientation = orient >= 1 && orient <= 8 ? orient : 1;
      if (!result.dimensions.width || !result.dimensions.height) {
        var wEntry = result.exif.exif.map[0xa002] || result.exif.ifd0.map[0x0100];
        var hEntry = result.exif.exif.map[0xa003] || result.exif.ifd0.map[0x0101];
        if (wEntry && hEntry) {
          var w = Number(first(wEntry.value));
          var h = Number(first(hEntry.value));
          if (w > 0 && h > 0) result.dimensions = { width: w, height: h };
        }
      }
    }
    if (result.format === 'jpeg' && result.jpeg && result.jpeg.sof) {
      result.dimensions = { width: result.jpeg.sof.width, height: result.jpeg.sof.height };
    }

    if (result.xmpParts.length) {
      var xmlParts = result.xmpParts.filter(function (p) { return p.xml && p.xml.trim(); });
      if (xmlParts.length) {
        result.xmp = {
          xml: xmlParts.map(function (p) { return p.xml; }).join('\n'),
          kinds: xmlParts.map(function (p) { return p.kind; })
        };
      }
    }

    if (result.exif && result.exif.thumbnailBytes) {
      result.thumbnail = {
        bytes: result.exif.thumbnailBytes,
        mime: result.exif.thumbnailMime || 'image/jpeg'
      };
    }

    if (result.exif && result.exif.warnings && result.exif.warnings.length) {
      for (var wi = 0; wi < result.exif.warnings.length; wi++) {
        result.warnings.push('EXIF: ' + result.exif.warnings[wi]);
      }
    }

    return result;
  }

  return {
    parse: parse,
    parseTiff: parseTiff,
    sniffFormat: sniffFormat,
    readU32BE: readU32BE,
    findResourceData: findResourceData,
    PNG_COLOR_TYPES: PNG_COLOR_TYPES,
    SOF_NAMES: SOF_NAMES,
    toUint8: toUint8
  };
});
