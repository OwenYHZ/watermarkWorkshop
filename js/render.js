/*!
 * render.js — 把 layout 场景绘制到 canvas，并处理 EXIF 方向与亮度采样
 *
 *   WM.render.measureText(text, {size, weight, family, tracking})
 *   WM.render.draw(canvas, scene, {photo, logo})
 *   WM.render.orientPhoto(source, orientation, targetW, targetH) -> canvas
 *   WM.render.sampleLuminance(canvas) -> 0..1
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.WM = root.WM || {};
    root.WM.render = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var measureCanvas = null;
  var measureCtx = null;

  function sharedCtx() {
    if (measureCtx) return measureCtx;
    if (typeof document === 'undefined') return null;
    measureCanvas = document.createElement('canvas');
    measureCanvas.width = 8;
    measureCanvas.height = 8;
    measureCtx = measureCanvas.getContext('2d');
    return measureCtx;
  }

  function fontString(spec) {
    var weight = spec.weight || 400;
    var style = spec.italic ? 'italic ' : '';
    var family = spec.family || 'system-ui, sans-serif';
    return style + weight + ' ' + Math.max(1, spec.size || 16) + 'px ' + family;
  }

  function measureText(text, spec) {
    spec = spec || {};
    var ctx = sharedCtx();
    var chars = Array.from(String(text == null ? '' : text));
    if (!ctx) {
      var size = spec.size || 16;
      var approx = 0;
      chars.forEach(function (ch) {
        var code = ch.codePointAt(0);
        if (code > 0x2e80) approx += size;
        else if (ch === ' ') approx += size * 0.3;
        else approx += size * 0.55;
      });
      return approx + (spec.tracking || 0) * Math.max(0, chars.length - 1);
    }
    ctx.font = fontString(spec);
    var width = 0;
    chars.forEach(function (ch) { width += ctx.measureText(ch).width; });
    return (width + (spec.tracking || 0) * Math.max(0, chars.length - 1)) * (spec.scaleX || 1);
  }

  function roundedPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    if (!r) {
      ctx.rect(x, y, w, h);
      return;
    }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function fillValue(ctx, fill, x, y, w, h) {
    if (!fill) return null;
    if (typeof fill === 'string') return fill;
    if (fill.kind === 'linear') {
      var grad = fill.direction === 'horizontal'
        ? ctx.createLinearGradient(x, y, x + w, y)
        : ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, fill.from);
      grad.addColorStop(1, fill.to);
      return grad;
    }
    return fill.color || null;
  }

  function drawPhoto(ctx, photo, rect) {
    if (!photo) return;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  function drawBlur(ctx, photo, op, scene) {
    if (!photo) return;
    var r = Math.max(0, op.radius || 0);
    ctx.save();
    roundedPath(ctx, op.x, op.y, op.w, op.h, op.cornerRadius || 0);
    ctx.clip();
    ctx.filter = 'blur(' + r + 'px)';
    ctx.drawImage(photo,
      op.x - r, op.y - r, op.w + r * 2, op.h + r * 2);
    ctx.restore();
  }

  function drawRect(ctx, op) {
    if (op.fill) {
      ctx.save();
      if (op.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = Math.max(4, Math.min(op.w, op.h) * 0.08);
        ctx.shadowOffsetY = Math.max(2, Math.min(op.w, op.h) * 0.02);
      }
      roundedPath(ctx, op.x, op.y, op.w, op.h, op.radius || 0);
      var fill = fillValue(ctx, op.fill, op.x, op.y, op.w, op.h);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      ctx.restore();
    }
    if (op.stroke && op.stroke.width > 0) {
      ctx.save();
      roundedPath(ctx, op.x, op.y, op.w, op.h, op.radius || 0);
      ctx.strokeStyle = op.stroke.color;
      ctx.lineWidth = op.stroke.width;
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawLine(ctx, op) {
    ctx.save();
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width || 1;
    ctx.beginPath();
    ctx.moveTo(op.x1, op.y1);
    ctx.lineTo(op.x2, op.y2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 折线：一条路径画完多段，转角用 miter 连接。
   * 用于取景框四角，避免「两条短直线拼接」在 alpha < 1 时的重叠暗块。
   */
  function drawPath(ctx, op) {
    var points = op.points || [];
    if (points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width || 1;
    ctx.lineCap = op.lineCap || 'butt';
    ctx.lineJoin = op.lineJoin || 'miter';
    ctx.miterLimit = op.miterLimit || 10;
    if (op.shadow || op.shadowColor) {
      ctx.shadowColor = op.shadowColor || 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = op.shadowBlur != null ? op.shadowBlur : Math.max(2, (op.width || 1) * 1.2);
      ctx.shadowOffsetY = op.shadowOffsetY != null ? op.shadowOffsetY : 0;
    }
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (op.fill) {
      ctx.fillStyle = op.fill;
      ctx.fill();
    }
    if (op.color && (op.width || 0) > 0) ctx.stroke();
    ctx.restore();
  }

  function drawImageOp(ctx, op, assets) {
    var img = op.role === 'logo' ? assets.logo : op.role === 'photo' ? assets.photo : null;
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = op.opacity == null ? 1 : op.opacity;
    if (op.radius) {
      roundedPath(ctx, op.x, op.y, op.w, op.h, op.radius);
      ctx.clip();
    }
    ctx.drawImage(img, op.x, op.y, op.w, op.h);
    ctx.restore();
  }

  function drawText(ctx, op) {
    var text = op.text == null ? '' : String(op.text);
    if (!text) return;
    var size = op.size || 16;
    var spec = { size: size, weight: op.weight, family: op.family, italic: op.italic };
    var chars = Array.from(text);
    var tracking = op.tracking || 0;
    ctx.save();
    ctx.font = fontString(spec);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = op.color || '#FFFFFF';
    ctx.globalAlpha = op.opacity == null ? 1 : op.opacity;
    if (op.shadow || op.shadowColor) {
      ctx.shadowColor = op.shadowColor || 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = op.shadowBlur != null ? op.shadowBlur : Math.max(2, size * 0.35);
      ctx.shadowOffsetY = op.shadowOffsetY != null ? op.shadowOffsetY : Math.max(1, size * 0.05);
    }
    var total = 0;
    chars.forEach(function (ch) { total += ctx.measureText(ch).width; });
    total += tracking * Math.max(0, chars.length - 1);
    // 对齐位移必须在「旋转后的局部坐标系」里做：先把坐标系平移到锚点并旋转，
    // 再把 align 偏移施加在局部 x 上。否则旋转文字的锚点会被额外平移 T/2，
    // 竖排文字会整体内缩/上移（胶片右侧参数与边字错位的根因）。
    var offset = 0;
    if (op.align === 'center') offset = -total / 2;
    else if (op.align === 'right') offset = -total;
    var scaleX = op.scaleX || 1;
    ctx.translate(op.x || 0, op.y || 0);
    if (op.rotation) ctx.rotate(op.rotation);
    if (scaleX !== 1) ctx.scale(scaleX, 1);
    var cursor = offset;
    chars.forEach(function (ch) {
      ctx.fillText(ch, cursor, 0);
      cursor += ctx.measureText(ch).width + tracking;
    });
    ctx.restore();
  }

  /**
   * 计算文字 op 在输出画布上的轴对齐包围盒（与 drawText 同源）。
   * 供布局自检与测试断言「紧贴右边 / 不压齿孔」。
   */
  function textBounds(op) {
    if (!op || op.kind !== 'text') return null;
    var text = op.text == null ? '' : String(op.text);
    if (!text) return null;
    var size = op.size || 16;
    var tracking = op.tracking || 0;
    var w = measureText(text, {
      size: size, weight: op.weight, family: op.family, italic: op.italic, tracking: tracking
    }) * (op.scaleX || 1);
    var h = size;
    var offset = 0;
    if (op.align === 'center') offset = -w / 2;
    else if (op.align === 'right') offset = -w;
    var ax = op.x || 0;
    var ay = op.y || 0;
    var localLeft = offset;
    var localTop = -h / 2;
    var rot = op.rotation || 0;
    if (!rot) {
      return { x0: ax + localLeft, y0: ay + localTop, x1: ax + localLeft + w, y1: ay + localTop + h };
    }
    var cos = Math.cos(rot);
    var sin = Math.sin(rot);
    var corners = [
      [localLeft, localTop],
      [localLeft + w, localTop],
      [localLeft + w, localTop + h],
      [localLeft, localTop + h]
    ];
    var x0 = Infinity;
    var y0 = Infinity;
    var x1 = -Infinity;
    var y1 = -Infinity;
    corners.forEach(function (p) {
      var px = ax + p[0] * cos - p[1] * sin;
      var py = ay + p[0] * sin + p[1] * cos;
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
    });
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  function draw(canvas, scene, assets) {
    assets = assets || {};
    var w = scene.output.w;
    var h = scene.output.h;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (scene.background && scene.background.color) {
      ctx.fillStyle = scene.background.color;
      ctx.fillRect(0, 0, w, h);
    }
    drawPhoto(ctx, assets.photo, scene.imageRect || { x: 0, y: 0, w: w, h: h });
    (scene.ops || []).forEach(function (op) {
      switch (op.kind) {
        case 'blur': drawBlur(ctx, assets.photo, op, scene); break;
        case 'rect': drawRect(ctx, op); break;
        case 'line': drawLine(ctx, op); break;
        case 'path': drawPath(ctx, op); break;
        case 'image': drawImageOp(ctx, op, assets); break;
        case 'text': drawText(ctx, op); break;
      }
    });
    return canvas;
  }

  /* ------------------------------------------------------------------ *
   * 方向与缩放
   * ------------------------------------------------------------------ */
  function orientedSize(width, height, orientation) {
    return orientation >= 5 && orientation <= 8
      ? { width: height, height: width }
      : { width: width, height: height };
  }

  /**
   * 浏览器解码时可能已经按 EXIF 方向旋转过（createImageBitmap 默认
   * image-orientation: from-image）。用「原始像素尺寸」与「解码后尺寸」
   * 是否互换来判断，避免二次旋转。
   */
  function photoIsUpright(source, orientation, rawW, rawH) {
    if (!(orientation >= 5 && orientation <= 8)) return true;
    var sw = source.width || source.naturalWidth || 0;
    var sh = source.height || source.naturalHeight || 0;
    if (!rawW || !rawH) return true;
    if (Math.abs(sw - rawW) <= 1 && Math.abs(sh - rawH) <= 1) return false;
    return true;
  }

  function displaySize(source, orientation, rawW, rawH) {
    var sw = source.width || source.naturalWidth || 0;
    var sh = source.height || source.naturalHeight || 0;
    if (!photoIsUpright(source, orientation, rawW, rawH)) {
      return orientedSize(sw, sh, orientation);
    }
    return { width: sw, height: sh };
  }

  /**
   * 把解码后的图片统一成「已按 EXIF 方向摆正」的画布。
   * 若浏览器已摆正，直接缩放绘制；否则应用方向变换。
   */
  function normalizePhoto(source, orientation, rawW, rawH, targetW, targetH) {
    if (!photoIsUpright(source, orientation, rawW, rawH)) {
      return orientPhoto(source, orientation, targetW, targetH);
    }
    var size = displaySize(source, orientation, rawW, rawH);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(targetW || size.width));
    canvas.height = Math.max(1, Math.round(targetH || size.height));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function orientPhoto(source, orientation, targetW, targetH) {
    orientation = orientation || 1;
    var srcW = source.width || source.naturalWidth || 0;
    var srcH = source.height || source.naturalHeight || 0;
    var outSize = orientedSize(srcW, srcH, orientation);
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(targetW || outSize.width));
    canvas.height = Math.max(1, Math.round(targetH || outSize.height));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var sx = canvas.width / outSize.width;
    var sy = canvas.height / outSize.height;
    ctx.save();
    ctx.scale(sx, sy);
    ctx.translate(0, 0);
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, srcW, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, srcW, srcH); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, srcH); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, srcH, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, srcH, srcW); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, srcW); break;
      default: break;
    }
    try {
      ctx.drawImage(source, 0, 0, srcW, srcH);
    } catch (e) {
      ctx.restore();
      throw e;
    }
    ctx.restore();
    return canvas;
  }

  function resizeCanvas(source, maxDim) {
    var w = source.width;
    var h = source.height;
    var scale = Math.min(1, maxDim / Math.max(w, h));
    if (scale >= 0.999) return source;
    var canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function sampleLuminance(source) {
    if (!source) return 0.5;
    var n = 24;
    var canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, n, n);
    var data;
    try {
      data = ctx.getImageData(0, 0, n, n).data;
    } catch (e) {
      return 0.5;
    }
    var sum = 0;
    var count = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) continue;
      sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      count++;
    }
    return count ? (sum / count) / 255 : 0.5;
  }

  /**
   * 从照片中提取低饱和主题色。返回色相/饱和度（0..360 / 0..1）。
   */
  function sampleThemeColor(source) {
    var fallback = { h: 205, s: 0.22, l: 0.5 };
    if (!source || typeof document === 'undefined') return fallback;
    var n = 32;
    var canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, n, n);
    var data;
    try {
      data = ctx.getImageData(0, 0, n, n).data;
    } catch (e) {
      return fallback;
    }
    var r = 0;
    var g = 0;
    var b = 0;
    var count = 0;
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 32) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    if (!count) return fallback;
    r /= count * 255;
    g /= count * 255;
    b /= count * 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
    var h = 0;
    if (max !== min) {
      if (max === r) h = (g - b) / (max - min) + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / (max - min) + 2;
      else h = (r - g) / (max - min) + 4;
      h *= 60;
    }
    if (s < 0.08) {
      h = fallback.h;
      s = fallback.s;
    } else {
      s = Math.min(0.30, Math.max(0.14, s * 0.7));
    }
    return { h: Math.round(h), s: s, l: l };
  }

  return {
    measureText: measureText,
    draw: draw,
    textBounds: textBounds,
    orientPhoto: orientPhoto,
    orientedSize: orientedSize,
    photoIsUpright: photoIsUpright,
    displaySize: displaySize,
    normalizePhoto: normalizePhoto,
    resizeCanvas: resizeCanvas,
    sampleLuminance: sampleLuminance,
    sampleThemeColor: sampleThemeColor,
    fontString: fontString
  };
});
