/*!
 * brands.js — 内置品牌「字样徽标」与相机品牌识别
 *
 * 说明：这里绘制的是按品牌字体风格、字重、字距与配色排版的文字徽标，
 * 不是官方图形商标；如需官方 logo，请在水印面板导入自己的图片。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.WM = root.WM || {};
    root.WM.brands = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FAMILIES = {
    sans: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, "Microsoft YaHei", sans-serif',
    serif: 'Georgia, "Times New Roman", "Noto Serif", "Songti SC", SimSun, serif',
    mono: '"Cascadia Mono", Consolas, "Courier New", monospace'
  };

  var BRANDS = [
    { id: 'canon', name: 'Canon', group: '相机', aliases: ['canon', 'eos'], color: '#C8102E', mark: { text: 'Canon', family: 'serif', weight: 700, italic: true, tracking: 0.005 } },
    { id: 'nikon', name: 'Nikon', group: '相机', aliases: ['nikon', 'nikon corporation'], color: '#F5C400', mark: { text: 'Nikon', family: 'sans', weight: 700, tracking: 0.02 } },
    { id: 'sony', name: 'Sony', group: '相机', aliases: ['sony', 'ilce', 'alpha', 'xperia'], color: '#111111', mark: { text: 'SONY', family: 'sans', weight: 700, tracking: 0.16 } },
    { id: 'fujifilm', name: 'FUJIFILM', group: '相机', aliases: ['fujifilm', 'fuji', 'x-t', 'x100', 'gfx'], color: '#E60012', mark: { text: 'FUJIFILM', family: 'sans', weight: 700, tracking: 0.04 } },
    { id: 'leica', name: 'Leica', group: '相机', aliases: ['leica'], color: '#E2001A', mark: { text: 'LEICA', family: 'serif', weight: 700, tracking: 0.18 }, emblem: { shape: 'dot', color: '#E2001A' } },
    { id: 'panasonic', name: 'LUMIX', group: '相机', aliases: ['panasonic', 'lumix'], color: '#003087', mark: { text: 'LUMIX', family: 'sans', weight: 700, tracking: 0.14 } },
    { id: 'olympus', name: 'OLYMPUS', group: '相机', aliases: ['olympus', 'om digital', 'om system'], color: '#1B3C6E', mark: { text: 'OLYMPUS', family: 'serif', weight: 700, tracking: 0.08 } },
    { id: 'om-system', name: 'OM SYSTEM', group: '相机', aliases: ['om-1', 'om-5', 'om system'], color: '#1B3C6E', mark: { text: 'OM SYSTEM', family: 'sans', weight: 700, tracking: 0.1 } },
    { id: 'pentax', name: 'PENTAX', group: '相机', aliases: ['pentax', 'ricoh imaging'], color: '#111111', mark: { text: 'PENTAX', family: 'sans', weight: 700, tracking: 0.1 } },
    { id: 'ricoh', name: 'RICOH', group: '相机', aliases: ['ricoh', 'gr iii', 'gr iiix'], color: '#CC0000', mark: { text: 'RICOH', family: 'sans', weight: 700, tracking: 0.16 } },
    { id: 'hasselblad', name: 'Hasselblad', group: '相机', aliases: ['hasselblad'], color: '#111111', mark: { text: 'HASSELBLAD', family: 'serif', weight: 600, tracking: 0.12 } },
    { id: 'phase-one', name: 'PHASE ONE', group: '相机', aliases: ['phase one', 'phaseone'], color: '#111111', mark: { text: 'PHASE ONE', family: 'sans', weight: 700, tracking: 0.08 } },
    { id: 'sigma', name: 'SIGMA', group: '镜头', aliases: ['sigma'], color: '#111111', mark: { text: 'SIGMA', family: 'sans', weight: 700, tracking: 0.18 } },
    { id: 'zeiss', name: 'ZEISS', group: '镜头', aliases: ['zeiss', 'carl zeiss'], color: '#0033A0', mark: { text: 'ZEISS', family: 'sans', weight: 700, tracking: 0.12 }, emblem: { shape: 'ring', color: '#0033A0' } },
    { id: 'tamron', name: 'TAMRON', group: '镜头', aliases: ['tamron'], color: '#D71920', mark: { text: 'TAMRON', family: 'sans', weight: 700, tracking: 0.08 } },
    { id: 'dji', name: 'DJI', group: '无人机', aliases: ['dji', 'mavic', 'mini 3', 'air 3'], color: '#111111', mark: { text: 'DJI', family: 'sans', weight: 700, tracking: 0.06 } },
    { id: 'gopro', name: 'GoPro', group: '运动相机', aliases: ['gopro', 'hero'], color: '#00A9E0', mark: { text: 'GoPro', family: 'sans', weight: 700, tracking: 0.01, italic: true } },
    { id: 'insta360', name: 'Insta360', group: '运动相机', aliases: ['insta360', 'one x', 'one r'], color: '#111111', mark: { text: 'Insta360', family: 'sans', weight: 700, tracking: 0.02 } },
    { id: 'apple', name: 'Apple', group: '手机', aliases: ['apple', 'iphone', 'ipad'], color: '#111111', mark: { text: 'Apple', family: 'sans', weight: 600, tracking: 0.04 } },
    { id: 'samsung', name: 'SAMSUNG', group: '手机', aliases: ['samsung', 'galaxy', 'sm-'], color: '#1428A0', mark: { text: 'SAMSUNG', family: 'sans', weight: 700, tracking: 0.14 } },
    { id: 'xiaomi', name: 'Xiaomi', group: '手机', aliases: ['xiaomi', 'redmi', 'poco'], color: '#FF6900', mark: { text: 'Xiaomi', family: 'sans', weight: 700, tracking: 0.02 }, emblem: { shape: 'square', color: '#FF6900', innerText: 'mi' } },
    { id: 'huawei', name: 'HUAWEI', group: '手机', aliases: ['huawei', 'honor'], color: '#CE0E2D', mark: { text: 'HUAWEI', family: 'sans', weight: 700, tracking: 0.12 } },
    { id: 'vivo', name: 'vivo', group: '手机', aliases: ['vivo'], color: '#415FFF', mark: { text: 'vivo', family: 'sans', weight: 700, tracking: 0.01 } },
    { id: 'oppo', name: 'OPPO', group: '手机', aliases: ['oppo', 'find x', 'reno'], color: '#007B4B', mark: { text: 'OPPO', family: 'sans', weight: 700, tracking: 0.16 } },
    { id: 'oneplus', name: 'OnePlus', group: '手机', aliases: ['oneplus', 'one plus'], color: '#F5010C', mark: { text: 'OnePlus', family: 'sans', weight: 700, tracking: 0.02 } },
    { id: 'google', name: 'Google', group: '手机', aliases: ['google', 'pixel'], color: '#4285F4', mark: { text: 'Google', family: 'sans', weight: 600, tracking: 0.02 } },
    { id: 'realme', name: 'realme', group: '手机', aliases: ['realme'], color: '#FFC915', mark: { text: 'realme', family: 'sans', weight: 700, tracking: 0.02 } },
    { id: 'nothing', name: 'NOTHING', group: '手机', aliases: ['nothing phone', 'nothing'], color: '#111111', mark: { text: 'NOTHING', family: 'mono', weight: 700, tracking: 0.06 } },
    { id: 'kodak', name: 'Kodak', group: '其他', aliases: ['kodak'], color: '#FFB700', mark: { text: 'Kodak', family: 'serif', weight: 700, tracking: 0.02 } },
    { id: 'polaroid', name: 'Polaroid', group: '其他', aliases: ['polaroid'], color: '#111111', mark: { text: 'Polaroid', family: 'sans', weight: 700, tracking: 0.01 } },
    { id: 'red', name: 'RED', group: '其他', aliases: ['red digital', 'red komodo'], color: '#E31E24', mark: { text: 'RED', family: 'sans', weight: 700, tracking: 0.22 } },
    { id: 'arri', name: 'ARRI', group: '其他', aliases: ['arri'], color: '#111111', mark: { text: 'ARRI', family: 'sans', weight: 700, tracking: 0.3 } },
    { id: 'blackmagic', name: 'Blackmagic', group: '其他', aliases: ['blackmagic', 'bmpcc'], color: '#111111', mark: { text: 'Blackmagic', family: 'sans', weight: 600, tracking: 0.02 } }
  ];

  var BY_ID = {};
  BRANDS.forEach(function (b) { BY_ID[b.id] = b; });

  var VARIANT_COLORS = {
    light: '#FFFFFF',
    dark: '#15181D'
  };

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim();
  }

  function genericFrom(make) {
    var text = (make || 'CAMERA').trim();
    return {
      id: 'generic',
      name: text || 'CAMERA',
      group: '其他',
      aliases: [],
      color: '#8A8F98',
      mark: { text: text || 'CAMERA', family: 'sans', weight: 600, tracking: 0.06 }
    };
  }

  function detect(make, model) {
    var hay = normalize((make || '') + ' ' + (model || ''));
    if (!hay) return null;
    var best = null;
    var bestScore = 0;
    BRANDS.forEach(function (brand) {
      var score = 0;
      brand.aliases.forEach(function (alias) {
        var a = normalize(alias);
        if (!a) return;
        var idx = hay.indexOf(a);
        if (idx < 0) return;
        var scoreHere = a.length;
        if (idx === 0 || hay[idx - 1] === ' ') scoreHere += 2;
        if (scoreHere > score) score = scoreHere;
      });
      if (score > bestScore) {
        bestScore = score;
        best = brand;
      }
    });
    return best;
  }

  function resolve(id, summary) {
    summary = summary || {};
    if (id && id !== 'auto' && BY_ID[id]) return BY_ID[id];
    if (id === 'generic') return genericFrom(summary.make);
    var found = detect(summary.make, summary.modelFull || summary.model);
    if (found) return found;
    return genericFrom(summary.make);
  }

  function list() {
    return BRANDS.slice();
  }

  function resolveColor(brand, variant) {
    if (variant === 'light') return VARIANT_COLORS.light;
    if (variant === 'dark') return VARIANT_COLORS.dark;
    return brand.color || '#FFFFFF';
  }

  var canvasCache = {};

  function buildCanvas(brand, height, variant) {
    var h = Math.max(8, Math.round(height));
    var key = brand.id + '|' + (brand.mark.text || '') + '|' + variant + '|' + h;
    if (canvasCache[key]) return canvasCache[key];
    if (typeof document === 'undefined') return null;
    var color = resolveColor(brand, variant);
    var family = FAMILIES[brand.mark.family] || brand.mark.family || FAMILIES.sans;
    var fontPx = h * 0.78;
    var tracking = (brand.mark.tracking || 0) * fontPx;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    var font = (brand.mark.italic ? 'italic ' : '') + (brand.mark.weight || 600) + ' ' + fontPx + 'px ' + family;
    ctx.font = font;
    var text = brand.mark.text || brand.name || 'CAMERA';
    var chars = Array.from(text);
    var textWidth = 0;
    chars.forEach(function (ch) { textWidth += ctx.measureText(ch).width; });
    if (chars.length > 1) textWidth += tracking * (chars.length - 1);
    var emblem = brand.emblem;
    var emblemSize = emblem ? h * 0.82 : 0;
    var gap = emblem ? h * 0.22 : 0;
    var padX = h * 0.04;
    var width = Math.ceil(padX * 2 + emblemSize + gap + textWidth + 2);
    canvas.width = width;
    canvas.height = h;
    ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, h);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    var x = padX;
    if (emblem) {
      var eColor = (variant === 'light' || variant === 'dark') ? color : (emblem.color || brand.color || color);
      var cx = x + emblemSize / 2;
      var cy = h / 2;
      ctx.save();
      if (emblem.shape === 'ring') {
        ctx.strokeStyle = eColor;
        ctx.lineWidth = Math.max(1, h * 0.09);
        ctx.beginPath();
        ctx.arc(cx, cy, emblemSize / 2 - ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (emblem.shape === 'square') {
        ctx.fillStyle = eColor;
        var radius = emblemSize * 0.22;
        roundedRect(ctx, x, cy - emblemSize / 2, emblemSize, emblemSize, radius);
        ctx.fill();
        if (emblem.innerText) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '700 ' + (emblemSize * 0.55) + 'px ' + FAMILIES.sans;
          ctx.textAlign = 'center';
          ctx.fillText(emblem.innerText, cx, cy + 1);
          ctx.textAlign = 'left';
          ctx.font = font;
        }
      } else {
        ctx.fillStyle = eColor;
        ctx.beginPath();
        ctx.arc(cx, cy, emblemSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      x += emblemSize + gap;
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    var drawX = x;
    chars.forEach(function (ch) {
      ctx.fillText(ch, drawX, h * 0.52);
      drawX += ctx.measureText(ch).width + tracking;
    });
    var result = { canvas: canvas, width: width, height: h, aspect: width / h };
    canvasCache[key] = result;
    return result;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function toCanvas(id, opts) {
    opts = opts || {};
    var brand = typeof id === 'object' ? id : resolve(id, opts.summary);
    return buildCanvas(brand, opts.height || 80, opts.variant || 'brand');
  }

  function getAspect(id, opts) {
    opts = opts || {};
    if (opts.aspect) return opts.aspect;
    var built = toCanvas(id, opts.height ? opts : { height: 100, variant: opts.variant || 'brand', summary: opts.summary });
    return built ? built.aspect : 3;
  }

  return {
    FAMILIES: FAMILIES,
    BRANDS: BRANDS,
    detect: detect,
    resolve: resolve,
    get: function (id) { return BY_ID[id] || null; },
    list: list,
    toCanvas: toCanvas,
    getAspect: getAspect,
    resolveColor: resolveColor,
    normalize: normalize,
    note: '内置品牌为按字体风格排版的字样徽标（非官方图形商标），可在水印面板导入自己的 logo 图片。'
  };
});
