/*!
 * tags.js — EXIF/PNG 标签字典、枚举释义与值格式化
 * 无依赖，可在浏览器（window.WM.tags）与 Node（require）中使用。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.WM = root.WM || {};
    root.WM.tags = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 标准标签名称
   * ------------------------------------------------------------------ */
  var IFD0 = {
    0x00fe: 'NewSubfileType',
    0x00ff: 'SubfileType',
    0x0100: 'ImageWidth',
    0x0101: 'ImageLength',
    0x0102: 'BitsPerSample',
    0x0103: 'Compression',
    0x0106: 'PhotometricInterpretation',
    0x0107: 'Thresholding',
    0x010d: 'DocumentName',
    0x010e: 'ImageDescription',
    0x010f: 'Make',
    0x0110: 'Model',
    0x0111: 'StripOffsets',
    0x0112: 'Orientation',
    0x0115: 'SamplesPerPixel',
    0x0116: 'RowsPerStrip',
    0x0117: 'StripByteCounts',
    0x0118: 'MinSampleValue',
    0x0119: 'MaxSampleValue',
    0x011a: 'XResolution',
    0x011b: 'YResolution',
    0x011c: 'PlanarConfiguration',
    0x011d: 'PageName',
    0x0122: 'GrayResponseUnit',
    0x0128: 'ResolutionUnit',
    0x0129: 'PageNumber',
    0x012d: 'TransferFunction',
    0x0131: 'Software',
    0x0132: 'DateTime',
    0x013b: 'Artist',
    0x013c: 'HostComputer',
    0x013d: 'Predictor',
    0x013e: 'WhitePoint',
    0x013f: 'PrimaryChromaticities',
    0x0140: 'ColorMap',
    0x0141: 'HalftoneHints',
    0x0142: 'TileWidth',
    0x0143: 'TileLength',
    0x0144: 'TileOffsets',
    0x0145: 'TileByteCounts',
    0x014a: 'SubIFDs',
    0x014c: 'InkSet',
    0x014d: 'InkNames',
    0x014e: 'NumberOfInks',
    0x0150: 'DotRange',
    0x0151: 'TargetPrinter',
    0x0152: 'ExtraSamples',
    0x0153: 'SampleFormat',
    0x0154: 'SMinSampleValue',
    0x0155: 'SMaxSampleValue',
    0x0156: 'TransferRange',
    0x0157: 'ClipPath',
    0x015b: 'JPEGTables',
    0x0200: 'JPEGProc',
    0x0201: 'JPEGInterchangeFormat',
    0x0202: 'JPEGInterchangeFormatLength',
    0x0203: 'JPEGRestartInterval',
    0x0205: 'JPEGLosslessPredictors',
    0x0206: 'JPEGPointTransforms',
    0x0207: 'JPEGQTables',
    0x0208: 'JPEGDCTables',
    0x0209: 'JPEGACTables',
    0x0211: 'YCbCrCoefficients',
    0x0212: 'YCbCrSubSampling',
    0x0213: 'YCbCrPositioning',
    0x0214: 'ReferenceBlackWhite',
    0x02bc: 'XMLPacket',
    0x4746: 'Rating',
    0x4749: 'RatingPercent',
    0x8298: 'Copyright',
    0x83bb: 'IPTC-NAA',
    0x8649: 'PhotoshopImageResources',
    0x8769: 'ExifIFDPointer',
    0x8773: 'ICCProfile',
    0x8825: 'GPSInfoIFDPointer',
    0x9003: 'DateTimeOriginal',
    0x9c9b: 'XPTitle',
    0x9c9c: 'XPComment',
    0x9c9d: 'XPAuthor',
    0x9c9e: 'XPKeywords',
    0x9c9f: 'XPSubject',
    0xa005: 'InteropIFDPointer',
    0xc4a5: 'PrintImageMatching',
    0xc612: 'DNGVersion',
    0xc613: 'DNGBackwardVersion',
    0xc614: 'UniqueCameraModel',
    0xc615: 'LocalizedCameraModel',
    0xc62f: 'CameraSerialNumber',
    0xc630: 'LensInfo',
    0xc65a: 'CalibrationIlluminant1',
    0xc65b: 'CalibrationIlluminant2',
    0xc68b: 'OriginalRawFileName',
    0xc6f3: 'CameraCalibrationSig',
    0xc6f4: 'ProfileCalibrationSig',
    0xc6f8: 'ProfileName',
    0xea1c: 'Padding',
    0xea1d: 'OffsetSchema'
  };

  var EXIF = {
    0x829a: 'ExposureTime',
    0x829d: 'FNumber',
    0x8822: 'ExposureProgram',
    0x8824: 'SpectralSensitivity',
    0x8827: 'ISOSpeedRatings',
    0x8828: 'OECF',
    0x8829: 'Interlace',
    0x882a: 'TimeZoneOffset',
    0x882b: 'SelfTimerMode',
    0x8830: 'SensitivityType',
    0x8831: 'StandardOutputSensitivity',
    0x8832: 'RecommendedExposureIndex',
    0x8833: 'ISOSpeed',
    0x8834: 'ISOSpeedLatitudeyyy',
    0x8835: 'ISOSpeedLatitudezzz',
    0x9000: 'ExifVersion',
    0x9003: 'DateTimeOriginal',
    0x9004: 'DateTimeDigitized',
    0x9010: 'OffsetTime',
    0x9011: 'OffsetTimeOriginal',
    0x9012: 'OffsetTimeDigitized',
    0x9101: 'ComponentsConfiguration',
    0x9102: 'CompressedBitsPerPixel',
    0x9201: 'ShutterSpeedValue',
    0x9202: 'ApertureValue',
    0x9203: 'BrightnessValue',
    0x9204: 'ExposureBiasValue',
    0x9205: 'MaxApertureValue',
    0x9206: 'SubjectDistance',
    0x9207: 'MeteringMode',
    0x9208: 'LightSource',
    0x9209: 'Flash',
    0x920a: 'FocalLength',
    0x9211: 'ImageNumber',
    0x9212: 'SecurityClassification',
    0x9213: 'ImageHistory',
    0x9214: 'SubjectArea',
    0x9215: 'ExposureIndex',
    0x927c: 'MakerNote',
    0x9286: 'UserComment',
    0x9290: 'SubSecTime',
    0x9291: 'SubSecTimeOriginal',
    0x9292: 'SubSecTimeDigitized',
    0x9400: 'Temperature',
    0x9401: 'Humidity',
    0x9402: 'Pressure',
    0x9403: 'WaterDepth',
    0x9404: 'Acceleration',
    0x9405: 'CameraElevationAngle',
    0xa000: 'FlashpixVersion',
    0xa001: 'ColorSpace',
    0xa002: 'PixelXDimension',
    0xa003: 'PixelYDimension',
    0xa004: 'RelatedSoundFile',
    0xa005: 'InteropIFDPointer',
    0xa20b: 'FlashEnergy',
    0xa20c: 'SpatialFrequencyResponse',
    0xa20e: 'FocalPlaneXResolution',
    0xa20f: 'FocalPlaneYResolution',
    0xa210: 'FocalPlaneResolutionUnit',
    0xa214: 'SubjectLocation',
    0xa215: 'ExposureIndex',
    0xa217: 'SensingMethod',
    0xa300: 'FileSource',
    0xa301: 'SceneType',
    0xa302: 'CFAPattern',
    0xa401: 'CustomRendered',
    0xa402: 'ExposureMode',
    0xa403: 'WhiteBalance',
    0xa404: 'DigitalZoomRatio',
    0xa405: 'FocalLengthIn35mmFilm',
    0xa406: 'SceneCaptureType',
    0xa407: 'GainControl',
    0xa408: 'Contrast',
    0xa409: 'Saturation',
    0xa40a: 'Sharpness',
    0xa40b: 'DeviceSettingDescription',
    0xa40c: 'SubjectDistanceRange',
    0xa420: 'ImageUniqueID',
    0xa430: 'CameraOwnerName',
    0xa431: 'BodySerialNumber',
    0xa432: 'LensSpecification',
    0xa433: 'LensMake',
    0xa434: 'LensModel',
    0xa435: 'LensSerialNumber',
    0xa460: 'CompositeImage',
    0xa461: 'SourceImageNumberOfCompositeImage',
    0xa462: 'SourceExposureTimesOfCompositeImage',
    0xa500: 'Gamma'
  };

  var GPS = {
    0x0000: 'GPSVersionID',
    0x0001: 'GPSLatitudeRef',
    0x0002: 'GPSLatitude',
    0x0003: 'GPSLongitudeRef',
    0x0004: 'GPSLongitude',
    0x0005: 'GPSAltitudeRef',
    0x0006: 'GPSAltitude',
    0x0007: 'GPSTimeStamp',
    0x0008: 'GPSSatellites',
    0x0009: 'GPSStatus',
    0x000a: 'GPSMeasureMode',
    0x000b: 'GPSDOP',
    0x000c: 'GPSSpeedRef',
    0x000d: 'GPSSpeed',
    0x000e: 'GPSTrackRef',
    0x000f: 'GPSTrack',
    0x0010: 'GPSImgDirectionRef',
    0x0011: 'GPSImgDirection',
    0x0012: 'GPSMapDatum',
    0x0013: 'GPSDestLatitudeRef',
    0x0014: 'GPSDestLatitude',
    0x0015: 'GPSDestLongitudeRef',
    0x0016: 'GPSDestLongitude',
    0x0017: 'GPSDestBearingRef',
    0x0018: 'GPSDestBearing',
    0x0019: 'GPSDestDistanceRef',
    0x001a: 'GPSDestDistance',
    0x001b: 'GPSProcessingMethod',
    0x001c: 'GPSAreaInformation',
    0x001d: 'GPSDateStamp',
    0x001e: 'GPSDifferential',
    0x001f: 'GPSHPositioningError'
  };

  var INTEROP = {
    0x0001: 'InteroperabilityIndex',
    0x0002: 'InteroperabilityVersion',
    0x1000: 'RelatedImageFileFormat',
    0x1001: 'RelatedImageWidth',
    0x1002: 'RelatedImageLength'
  };

  /* ------------------------------------------------------------------ *
   * 常用标签中文释义（悬浮提示）
   * ------------------------------------------------------------------ */
  var CN = {
    0x0100: '图像宽度', 0x0101: '图像高度', 0x0103: '压缩方式', 0x010e: '图像描述',
    0x010f: '制造商', 0x0110: '相机型号', 0x0112: '方向', 0x011a: '水平分辨率',
    0x011b: '垂直分辨率', 0x0128: '分辨率单位', 0x0131: '软件', 0x0132: '修改时间',
    0x013b: '作者', 0x8298: '版权', 0x8769: 'EXIF 子目录', 0x8825: 'GPS 子目录',
    0x829a: '曝光时间', 0x829d: '光圈', 0x8822: '曝光程序', 0x8827: 'ISO 感光度',
    0x9000: 'EXIF 版本', 0x9003: '拍摄时间', 0x9004: '数字化时间',
    0x9010: '时区偏移', 0x9011: '拍摄时区偏移', 0x9012: '数字化时区偏移',
    0x9101: '色彩分量配置', 0x9102: '压缩图像数据率', 0x9201: '快门速度',
    0x9202: '光圈值', 0x9203: '亮度值', 0x9204: '曝光补偿', 0x9205: '最大光圈',
    0x9206: '被摄体距离', 0x9207: '测光模式', 0x9208: '光源', 0x9209: '闪光灯',
    0x920a: '焦距', 0x9214: '主体区域', 0x927c: '厂商备注', 0x9286: '用户注释',
    0x9290: '亚秒时间', 0x9291: '原始亚秒时间', 0x9292: '数字化亚秒时间',
    0xa001: '色彩空间', 0xa002: '像素宽度', 0xa003: '像素高度',
    0xa217: '感光方式', 0xa300: '文件来源', 0xa301: '场景类型',
    0xa401: '自定义渲染', 0xa402: '曝光模式', 0xa403: '白平衡',
    0xa404: '数码变焦倍数', 0xa405: '35mm 等效焦距', 0xa406: '场景拍摄类型',
    0xa407: '增益控制', 0xa408: '对比度', 0xa409: '饱和度', 0xa40a: '锐度',
    0xa40b: '设备设置描述', 0xa40c: '被摄体距离范围', 0xa420: '图像唯一 ID',
    0xa430: '相机所有者', 0xa431: '机身序列号', 0xa432: '镜头规格',
    0xa433: '镜头制造商', 0xa434: '镜头型号', 0xa435: '镜头序列号',
    0x9c9b: '标题 (XP)', 0x9c9c: '备注 (XP)', 0x9c9d: '作者 (XP)',
    0x9c9e: '关键词 (XP)', 0x9c9f: '主题 (XP)',
    0x0001: '纬度参考', 0x0002: '纬度', 0x0003: '经度参考', 0x0004: '经度',
    0x0005: '海拔参考', 0x0006: '海拔', 0x0007: 'GPS 时间', 0x0009: 'GPS 状态',
    0x0011: '拍摄方向', 0x001d: 'GPS 日期', 0x001e: '差分定位',
    0xa005: 'Interop 子目录'
  };

  var TYPE_NAMES = {
    1: 'BYTE', 2: 'ASCII', 3: 'SHORT', 4: 'LONG', 5: 'RATIONAL',
    6: 'SBYTE', 7: 'UNDEFINED', 8: 'SSHORT', 9: 'SLONG', 10: 'SRATIONAL',
    11: 'FLOAT', 12: 'DOUBLE', 13: 'IFD'
  };

  var TYPE_SIZES = {
    1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4
  };

  /* ------------------------------------------------------------------ *
   * 枚举释义
   * ------------------------------------------------------------------ */
  var ENUMS = {
    Orientation: {
      1: '正常（无旋转）', 2: '水平镜像', 3: '旋转 180°', 4: '垂直镜像',
      5: '镜像并顺时针旋转 90°', 6: '顺时针旋转 90°', 7: '镜像并逆时针旋转 90°',
      8: '逆时针旋转 90°'
    },
    ResolutionUnit: { 1: '无单位', 2: '英寸 (dpi)', 3: '厘米 (dpcm)' },
    Compression: {
      1: '未压缩', 2: 'CCITT 1D', 3: 'T4/Group 3', 4: 'T6/Group 4', 5: 'LZW',
      6: 'JPEG (旧)', 7: 'JPEG', 8: 'Deflate', 9: 'JBIG B/W', 10: 'JBIG Color',
      32766: 'Next', 32767: 'Sony ARW', 32773: 'PackBits', 32809: 'ThunderScan',
      34892: '无损 JPEG', 34925: 'LZMA2', 50000: 'Zstd'
    },
    PhotometricInterpretation: {
      0: 'WhiteIsZero', 1: 'BlackIsZero', 2: 'RGB', 3: '调色板', 4: '透明遮罩',
      5: 'CMYK', 6: 'YCbCr', 8: 'CIELab', 9: 'ICCLab', 10: 'ITULab'
    },
    YCbCrPositioning: { 1: '居中', 2: '并置' },
    ExposureProgram: {
      0: '未定义', 1: '手动', 2: '程序自动', 3: '光圈优先', 4: '快门优先',
      5: '创意程序（景深优先）', 6: '动作程序（快门优先）', 7: '人像模式',
      8: '风景模式', 9: '微距模式', 10: '运动模式', 11: '夜景模式'
    },
    MeteringMode: {
      0: '未知', 1: '平均测光', 2: '中央重点平均测光', 3: '点测光',
      4: '多点测光', 5: '评价测光（矩阵）', 6: '局部测光', 255: '其他'
    },
    LightSource: {
      0: '未知', 1: '日光', 2: '荧光灯', 3: '钨丝灯（白炽灯）', 4: '闪光灯',
      9: '晴天', 10: '阴天', 11: '阴影', 12: '日光色荧光灯',
      13: 'D55', 14: 'D65', 15: 'D75', 16: 'D50', 17: '标准光 A',
      18: '标准光 B', 19: '标准光 C', 20: 'D55', 21: 'D65', 22: 'D75',
      23: 'D50', 24: 'ISO 影棚钨丝灯', 255: '其他'
    },
    ColorSpace: { 1: 'sRGB', 2: 'Adobe RGB（非标准）', 0xffff: '未校准' },
    SensingMethod: {
      1: '未定义', 2: '单芯片彩色区域传感器', 3: '双芯片彩色区域传感器',
      4: '三芯片彩色区域传感器', 5: '彩色顺序区域传感器', 7: '三线传感器',
      8: '四线传感器'
    },
    FileSource: { 1: '数字相机', 2: '扫描仪', 3: '数字后背', 0: '其他' },
    SceneType: { 0: '其他', 1: '直接拍摄' },
    CustomRendered: { 0: '正常处理', 1: '自定义处理' },
    ExposureMode: { 0: '自动曝光', 1: '手动曝光', 2: '自动包围曝光' },
    WhiteBalance: { 0: '自动', 1: '手动' },
    SceneCaptureType: { 0: '标准', 1: '风景', 2: '人像', 3: '夜景', 4: '其他' },
    GainControl: {
      0: '无增益', 1: '弱增益 (Low gain up)', 2: '强增益 (High gain up)',
      3: '弱衰减 (Low gain down)', 4: '强衰减 (High gain down)'
    },
    Contrast: { 0: '标准', 1: '柔和', 2: '强烈' },
    Saturation: { 0: '标准', 1: '低饱和', 2: '高饱和' },
    Sharpness: { 0: '标准', 1: '柔和', 2: '强烈' },
    SubjectDistanceRange: { 0: '未知', 1: '微距', 2: '近景', 3: '远景' },
    SensitivityType: {
      0: '未知', 1: '标准输出灵敏度', 2: '推荐曝光指数',
      3: 'ISO 速度', 4: '标准输出灵敏度 + 推荐曝光指数',
      5: '标准输出灵敏度 + ISO 速度', 6: '推荐曝光指数 + ISO 速度',
      7: '标准输出灵敏度 + 推荐曝光指数 + ISO 速度'
    },
    GPSAltitudeRef: { 0: '海平面以上', 1: '海平面以下' },
    GPSStatus: { A: '测量进行中', V: '测量有效' },
    GPSMeasureMode: { 2: '2 维测量', 3: '3 维测量' },
    GPSSpeedRef: { K: 'km/h', M: 'mph', N: '节' },
    GPSTrackRef: { T: '真北', M: '磁北' },
    GPSImgDirectionRef: { T: '真北', M: '磁北' },
    GPSDestBearingRef: { T: '真北', M: '磁北' },
    GPSDestDistanceRef: { K: '公里', M: '英里', N: '海里' },
    GPSDifferential: { 0: '无差分校正', 1: '有差分校正' },
    CompositeImage: {
      0: '未知', 1: '非合成图', 2: '合成图', 3: '合成图（已保存原始图）'
    },
    InteropIndex: { R98: 'R98（DCF 标准）', R03: 'R03', THM: '缩略图' },
    Flash: null
  };

  /* ------------------------------------------------------------------ *
   * 通用工具
   * ------------------------------------------------------------------ */
  function first(v) {
    return Array.isArray(v) && v.length ? v[0] : v;
  }

  function toNumber(v) {
    v = first(v);
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && typeof v.n === 'number' && v.d) return v.n / v.d;
    return NaN;
  }

  function ratValue(r) {
    if (Array.isArray(r)) r = r[0];
    if (!r || typeof r !== 'object') return NaN;
    if (!r.d) return NaN;
    return r.n / r.d;
  }

  function fmtNum(x, maxDigits) {
    if (!isFinite(x)) return '—';
    if (maxDigits == null) maxDigits = 3;
    var s = x.toFixed(maxDigits);
    s = s.replace(/\.?0+$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function hexTag(tag) {
    var s = Number(tag).toString(16).toUpperCase();
    while (s.length < 4) s = '0' + s;
    return '0x' + s;
  }

  function bytesToHex(bytes, max) {
    if (!bytes || !bytes.length) return '';
    var n = Math.min(bytes.length, max || 32);
    var out = [];
    for (var i = 0; i < n; i++) {
      var h = bytes[i].toString(16).toUpperCase();
      out.push(h.length < 2 ? '0' + h : h);
    }
    return out.join(' ') + (bytes.length > n ? ' … (' + bytes.length + ' 字节)' : '');
  }

  function decodeAsciiBytes(bytes) {
    if (!bytes || !bytes.length) return '';
    var end = bytes.length;
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) { end = i; break; }
    }
    return decodeBytes(bytes.subarray(0, end));
  }

  function decodeBytes(bytes) {
    if (!bytes || !bytes.length) return '';
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\u0000+$/, '');
    } catch (e) {
      try {
        return new TextDecoder('windows-1252').decode(bytes);
      } catch (e2) {
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return s;
      }
    }
  }

  function decodeUtf16(bytes, le) {
    if (!bytes || bytes.length < 2) return '';
    var out = '';
    for (var i = 0; i + 1 < bytes.length; i += 2) {
      var code = le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1];
      if (code === 0) break;
      out += String.fromCharCode(code);
    }
    return out;
  }

  function textOf(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.replace(/\u0000+$/, '').trim();
    if (Array.isArray(v)) return v.map(textOf).join(', ');
    return String(v);
  }

  function enumText(name, value) {
    var table = ENUMS[name];
    if (!table) return String(value);
    return table[value] != null ? table[value] : String(value);
  }

  function flashText(v) {
    var n = Number(first(v));
    if (!isFinite(n)) return '—';
    var parts = [];
    parts.push(n & 1 ? '闪光灯已触发' : '未使用闪光灯');
    var ret = (n >> 1) & 3;
    parts.push(['', '（无回传）', '（有回传）', '（回传模式）'][ret] || '');
    var mode = (n >> 3) & 3;
    parts.push(['', '强制闪光', '强制不闪光', '自动'][mode] || '');
    if (n & 0x20) parts.push('无闪光功能');
    if (n & 0x40) parts.push('防红眼');
    return parts.filter(Boolean).join('，') + '（0x' + n.toString(16).toUpperCase() + '）';
  }

  function formatDateString(s) {
    s = String(s || '').trim();
    var m = s.match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return s;
    return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
  }

  function apexShutter(v) {
    var x = toNumber(v);
    if (!isFinite(x)) return null;
    return Math.pow(2, -x);
  }

  function apexAperture(v) {
    var x = toNumber(v);
    if (!isFinite(x)) return null;
    return Math.pow(2, x / 2);
  }

  function formatSeconds(sec) {
    if (!isFinite(sec) || sec <= 0) return '—';
    if (sec >= 1) return fmtNum(sec, sec >= 10 ? 1 : 2) + ' 秒';
    var denom = Math.round(1 / sec);
    if (denom <= 0) denom = 1;
    return '1/' + denom + ' 秒';
  }

  function gpsCoordinate(entry, refEntry) {
    if (!entry || entry.value == null) return null;
    var arr = Array.isArray(entry.value) ? entry.value : [entry.value];
    var d = ratValue(arr[0]);
    var m = arr.length > 1 ? ratValue(arr[1]) : 0;
    var s = arr.length > 2 ? ratValue(arr[2]) : 0;
    if (!isFinite(d)) return null;
    if (!isFinite(m)) m = 0;
    if (!isFinite(s)) s = 0;
    var dec = d + m / 60 + s / 3600;
    var ref = refEntry ? String(first(refEntry.value)).trim().toUpperCase() : '';
    if (ref === 'S' || ref === 'W') dec = -dec;
    var text = d + '°' + m + '′' + fmtNum(s, 2) + '″' + (ref ? ' ' + ref : '');
    return { decimal: dec, text: text, ref: ref };
  }

  function makerNoteVendor(bytes) {
    if (!bytes || !bytes.length) return '';
    var head = '';
    for (var i = 0; i < Math.min(bytes.length, 24); i++) {
      head += String.fromCharCode(bytes[i] || 0);
    }
    var checks = [
      ['Nikon', 'Nikon'],
      ['OLYMPUS', 'Olympus'],
      ['FUJIFILM', 'Fujifilm'],
      ['SONY', 'Sony'],
      ['Panasonic', 'Panasonic'],
      ['Apple', 'Apple'],
      ['DJI', 'DJI'],
      ['Hasselblad', 'Hasselblad'],
      ['LEICA', 'Leica'],
      ['RICOH', 'Ricoh'],
      ['PENTAX', 'Pentax'],
      ['Samsung', 'Samsung']
    ];
    for (var c = 0; c < checks.length; c++) {
      if (head.indexOf(checks[c][0]) >= 0) return checks[c][1];
    }
    return '';
  }

  function decodeUserComment(bytes) {
    if (!bytes || !bytes.length) return '';
    var prefix = '';
    for (var i = 0; i < Math.min(8, bytes.length); i++) prefix += String.fromCharCode(bytes[i]);
    var body = bytes.subarray(8);
    if (prefix.indexOf('UNICODE') === 0) {
      var le = decodeUtf16(body, true);
      var be = decodeUtf16(body, false);
      var printable = function (s) {
        var bad = 0;
        for (var j = 0; j < s.length; j++) {
          var c = s.charCodeAt(j);
          if (c < 32 && c !== 9 && c !== 10 && c !== 13) bad++;
        }
        return s.length ? 1 - bad / s.length : 0;
      };
      return printable(le) >= printable(be) ? le.replace(/\u0000+$/, '') : be.replace(/\u0000+$/, '');
    }
    if (prefix.indexOf('ASCII') === 0) return decodeBytes(body).replace(/^\u0000+/, '');
    if (prefix.indexOf('JIS') === 0) {
      try { return new TextDecoder('shift_jis').decode(body).replace(/\u0000+$/, ''); } catch (e) { return decodeBytes(body); }
    }
    return decodeBytes(body).replace(/^\u0000+/, '');
  }

  function decodeGpsText(bytes) {
    return decodeUserComment(bytes);
  }

  function lensSpecText(value) {
    if (!value) return '';
    var arr = Array.isArray(value) ? value : [value];
    var nums = arr.map(ratValue);
    if (nums.length < 4 || !isFinite(nums[0])) return '';
    var f1 = fmtNum(nums[0], 1);
    var f2 = fmtNum(nums[1], 1);
    var a1 = fmtNum(nums[2], 1);
    var a2 = fmtNum(nums[3], 1);
    var focal = f1 === f2 ? f1 + 'mm' : f1 + '-' + f2 + 'mm';
    var ap = a1 === a2 ? 'f/' + a1 : 'f/' + a1 + '-' + a2;
    return focal + ' ' + ap;
  }

  /* ------------------------------------------------------------------ *
   * 主格式化入口
   * ------------------------------------------------------------------ */
  function formatValue(ifdName, tag, entry, ctx) {
    ctx = ctx || {};
    var entries = ctx.entries || {};
    var result = { text: '', note: '' };
    var v = entry.value;

    if (v === undefined || v === null) {
      result.text = entry.invalid ? '（无法读取，数据越界）' : '—';
      return result;
    }

    switch (tag) {
      case 0x010f: case 0x0110: case 0x0131: case 0x013b: case 0x010e:
      case 0x013c: case 0x010d: case 0xa433: case 0xa434: case 0xa430:
      case 0xa435: case 0x8298: case 0x013e: case 0x013f:
        return { text: textOf(v), note: '' };

      case 0x0112:
        return { text: enumText('Orientation', Number(first(v))) };

      case 0x0128:
        return { text: enumText('ResolutionUnit', Number(first(v))) };

      case 0x0103:
        return { text: enumText('Compression', Number(first(v))) };

      case 0x0106:
        return { text: enumText('PhotometricInterpretation', Number(first(v))) };

      case 0x0213:
        return { text: enumText('YCbCrPositioning', Number(first(v))) };

      case 0x011a: case 0x011b: case 0xa20e: case 0xa20f: {
        var n = ratValue(v);
        return { text: fmtNum(n, 3) + (ctx.dpiLabel ? ' dpi' : '') };
      }

      case 0x829a: {
        var t = ratValue(v);
        return { text: formatSeconds(t), note: isFinite(t) ? fmtNum(t, 6) + ' 秒' : '' };
      }

      case 0x829d: {
        var f = ratValue(v);
        return { text: isFinite(f) ? 'f/' + fmtNum(f, 2) : '—' };
      }

      case 0x8822:
        return { text: enumText('ExposureProgram', Number(first(v))) };

      case 0x8827: case 0x8831: case 0x8832: case 0x8833:
        return { text: textOf(v) };

      case 0x8830:
        return { text: enumText('SensitivityType', Number(first(v))) };

      case 0x9000: case 0xa000: {
        var vers = '';
        if (v && v.length) {
          for (var vi = 0; vi < v.length; vi++) vers += String.fromCharCode(v[vi]);
        }
        return { text: vers || '—' };
      }

      case 0x9003: case 0x9004: case 0x0132:
        return { text: formatDateString(textOf(v)) };

      case 0x9010: case 0x9011: case 0x9012:
        return { text: textOf(v) };

      case 0x9101: {
        var labels = { 0: '-', 1: 'Y', 2: 'Cb', 3: 'Cr', 4: 'R', 5: 'G', 6: 'B' };
        var comp = [];
        for (var ci = 0; ci < (v.length || 0); ci++) comp.push(labels[v[ci]] || String(v[ci]));
        return { text: comp.join(' ') };
      }

      case 0x9201: {
        var sec = apexShutter(v);
        return { text: sec != null ? formatSeconds(sec) : '—', note: 'APEX ' + fmtNum(toNumber(v), 3) };
      }

      case 0x9202: case 0x9205: {
        var ap = apexAperture(v);
        return { text: ap != null ? 'f/' + fmtNum(ap, 2) : '—', note: 'APEX ' + fmtNum(toNumber(v), 3) };
      }

      case 0x9203: {
        var bv = toNumber(v);
        return { text: isFinite(bv) ? fmtNum(bv, 3) + ' EV' : '—', note: 'APEX 亮度' };
      }

      case 0x9204: {
        var ev = toNumber(v);
        if (!isFinite(ev)) return { text: '—' };
        return { text: (ev > 0 ? '+' : '') + fmtNum(ev, 2) + ' EV' };
      }

      case 0x9206: {
        var dist = ratValue(v);
        return { text: isFinite(dist) ? fmtNum(dist, 2) + ' 米' : '—' };
      }

      case 0x9207:
        return { text: enumText('MeteringMode', Number(first(v))) };

      case 0x9208:
        return { text: enumText('LightSource', Number(first(v))) };

      case 0x9209:
        return { text: flashText(v) };

      case 0x920a: {
        var focal = ratValue(v);
        return { text: isFinite(focal) ? fmtNum(focal, 1) + ' mm' : '—' };
      }

      case 0x9214: case 0xa214: {
        return { text: textOf(v) };
      }

      case 0x927c: {
        var vendor = makerNoteVendor(v);
        return {
          text: '存在 · ' + v.length + ' 字节' + (vendor ? ' · ' + vendor : ''),
          note: '厂商私有数据，仅保留不解码'
        };
      }

      case 0x9286:
        if (typeof v === 'string') {
          return { text: v.replace(/\u0000+/g, ''), note: '字符串形式' };
        }
        return { text: decodeUserComment(v), note: '字符集前缀已处理' };

      case 0x9290: case 0x9291: case 0x9292:
        return { text: textOf(v) };

      case 0xa001:
        return { text: enumText('ColorSpace', Number(first(v))) };

      case 0xa002: case 0xa003: case 0x0100: case 0x0101:
        return { text: String(first(v)) + ' px' };

      case 0xa217:
        return { text: enumText('SensingMethod', Number(first(v))) };

      case 0xa300:
        return { text: enumText('FileSource', v.length ? v[0] : '') };

      case 0xa301:
        return { text: enumText('SceneType', v.length ? v[0] : '') };

      case 0xa401:
        return { text: enumText('CustomRendered', Number(first(v))) };

      case 0xa402:
        return { text: enumText('ExposureMode', Number(first(v))) };

      case 0xa403:
        return { text: enumText('WhiteBalance', Number(first(v))) };

      case 0xa404: {
        var dz = ratValue(v);
        return { text: isFinite(dz) ? fmtNum(dz, 2) + '×' : '—' };
      }

      case 0xa405: {
        var f35 = Number(first(v));
        return { text: isFinite(f35) ? f35 + ' mm' : '—', note: '35mm 等效' };
      }

      case 0xa406:
        return { text: enumText('SceneCaptureType', Number(first(v))) };

      case 0xa407:
        return { text: enumText('GainControl', Number(first(v))) };

      case 0xa408:
        return { text: enumText('Contrast', Number(first(v))) };

      case 0xa409:
        return { text: enumText('Saturation', Number(first(v))) };

      case 0xa40a:
        return { text: enumText('Sharpness', Number(first(v))) };

      case 0xa40c:
        return { text: enumText('SubjectDistanceRange', Number(first(v))) };

      case 0xa432:
        return { text: lensSpecText(v), note: '焦距与最大光圈' };

      case 0xa420: case 0xa431: case 0xa435: case 0x4746: case 0x4749:
        return { text: textOf(v) };

      case 0x9c9b: case 0x9c9c: case 0x9c9d: case 0x9c9e: case 0x9c9f:
        return { text: decodeUtf16(v, true) };

      case 0x8769: case 0x8825: case 0xa005:
        return { text: '见子目录', note: '偏移 ' + first(v) };

      case 0x0201: case 0x0202: case 0x0111: case 0x0117:
      case 0x0144: case 0x0145: case 0x014a:
        return { text: '（二进制偏移/长度）', note: textOf(v) };

      case 0x0000: {
        var gv = [];
        for (var gi = 0; gi < (v.length || 0); gi++) gv.push(v[gi]);
        return { text: gv.join('.'), note: 'GPS 版本' };
      }

      case 0x0001: case 0x0003:
      case 0x000e: case 0x0010: case 0x0017: case 0x0019:
        return { text: textOf(v) };

      case 0x0002: case 0x0004: case 0x0014: case 0x0016: {
        var coord = gpsCoordinate(entry, entries[tag === 0x0002 ? 0x0001 : tag === 0x0004 ? 0x0003 : tag === 0x0014 ? 0x0013 : 0x0015]);
        if (!coord) return { text: '—' };
        return { text: coord.text, note: '十进制 ' + coord.decimal.toFixed(6) };
      }

      case 0x0005:
        return { text: enumText('GPSAltitudeRef', v.length ? v[0] : 0) };

      case 0x0006: {
        var alt = ratValue(v);
        var altRef = entries[0x0005];
        var below = altRef && (altRef.value && altRef.value[0] === 1);
        return { text: isFinite(alt) ? fmtNum(alt, 1) + ' 米' + (below ? '（海平面以下）' : '') : '—' };
      }

      case 0x0007: {
        var arrT = Array.isArray(v) ? v : [v];
        var hh = ratValue(arrT[0]), mm = ratValue(arrT[1]), ss = ratValue(arrT[2]);
        var dateEntry = entries[0x001d];
        return {
          text: [pad2(Math.round(hh) || 0), pad2(Math.round(mm) || 0), pad2(Math.round(ss) || 0)].join(':') +
            (dateEntry ? ' ' + textOf(dateEntry.value) : ''),
          note: 'UTC'
        };
      }

      case 0x0009:
        return { text: enumText('GPSStatus', textOf(v)) };

      case 0x000a:
        return { text: enumText('GPSMeasureMode', Number(first(v))) };

      case 0x000b: {
        var dop = ratValue(v);
        return { text: isFinite(dop) ? fmtNum(dop, 2) : '—' };
      }

      case 0x000c:
        return { text: enumText('GPSSpeedRef', textOf(v)) };

      case 0x000d: case 0x000f: case 0x0011: case 0x0015:
      case 0x0018: case 0x001a: case 0x001f: {
        var q = ratValue(v);
        return { text: isFinite(q) ? fmtNum(q, 3) : '—' };
      }

      case 0x001b: case 0x001c:
        return { text: decodeGpsText(v) };

      case 0x001d:
        return { text: textOf(v) };

      case 0x001e:
        return { text: enumText('GPSDifferential', Number(first(v))) };
    }

    if (ifdName === 'interop' && tag === 0x0001) {
      var raw = textOf(v);
      return { text: ENUMS.InteropIndex[raw] || raw };
    }

    /* ---- 按类型回退 ---- */
    var type = entry.type;
    if (type === 2) return { text: textOf(v) };
    if (type === 7 || type === 1 || type === 6) {
      if (v instanceof Uint8Array) return { text: bytesToHex(v) };
      return { text: textOf(v) };
    }
    if (type === 5 || type === 10) {
      var arrR = Array.isArray(v) ? v : [v];
      if (arrR.length === 1) {
        var rv = ratValue(arrR[0]);
        return {
          text: fmtNum(rv, 4),
          note: arrR[0] && arrR[0].d ? arrR[0].n + '/' + arrR[0].d : ''
        };
      }
      return { text: arrR.map(function (r) { return fmtNum(ratValue(r), 4); }).join(', ') };
    }
    if (Array.isArray(v)) return { text: v.join(', ') };
    if (v instanceof Uint8Array) return { text: bytesToHex(v) };
    return { text: String(v) };
  }

  function tagName(ifdName, tag) {
    var table = ifdName === 'gps' ? GPS : ifdName === 'interop' ? INTEROP : ifdName === 'exif' ? EXIF : IFD0;
    return table[tag] || '';
  }

  function cnHint(tag) {
    return CN[tag] || '';
  }

  return {
    NAMES: { ifd0: IFD0, exif: EXIF, gps: GPS, interop: INTEROP },
    CN: CN,
    ENUMS: ENUMS,
    TYPE_NAMES: TYPE_NAMES,
    TYPE_SIZES: TYPE_SIZES,
    tagName: tagName,
    cnHint: cnHint,
    formatValue: formatValue,
    hexTag: hexTag,
    fmtNum: fmtNum,
    first: first,
    ratValue: ratValue,
    toNumber: toNumber,
    formatSeconds: formatSeconds,
    formatDateString: formatDateString,
    gpsCoordinate: gpsCoordinate,
    bytesToHex: bytesToHex,
    decodeAsciiBytes: decodeAsciiBytes,
    decodeBytes: decodeBytes,
    decodeUtf16: decodeUtf16,
    lensSpecText: lensSpecText,
    textOf: textOf
  };
});
