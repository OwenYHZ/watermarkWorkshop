import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const layout = require('../js/layout.js');
const brands = require('../js/brands.js');
const state = require('../js/state.js');
const meta = require('../js/meta.js');
const render = require('../js/render.js');

const summary = {
  make: 'Canon',
  model: 'EOS R5',
  modelFull: 'Canon EOS R5',
  lens: 'RF24-70mm F2.8 L IS USM',
  focalText: '50mm',
  apertureText: 'f/2.8',
  shutterText: '1/250s',
  isoText: 'ISO 400',
  date: { y: 2024, m: 5, d: 1, h: 12, mi: 34, s: 56, offset: '+08:00' },
  coordText: '30.2701°N, 120.1252°E',
  filename: 'canon-r5.jpg',
  artist: 'Test Photographer',
  copyright: '© 2024 Test Photographer'
};

function compose(overrides) {
  const settings = state.sanitize(state.DEFAULTS);
  if (overrides && overrides.settings) Object.assign(settings, overrides.settings);
  return layout.compose({
    imageW: 4000,
    imageH: 3000,
    meta: summary,
    settings,
    brandName: 'Canon',
    logoAspect: 3,
    logoEnabled: true,
    luminance: 0.35,
    formatDateOnly: (d) => meta.formatDateStyle(d,
      settings.template === 'dv-cam' ? settings.dv.dateStyle : settings.content.dateStyle,
      { weekday: settings.content.showWeekday }),
    formatTimeOnly: (d) => meta.formatTimeStyle(d,
      settings.template === 'dv-cam' ? settings.dv.timeStyle : settings.content.timeStyle,
      { offset: settings.content.showOffset }),
    ...(overrides || {})
  });
}

test('六套模板都能生成有效布局', () => {
  const templates = ['param-panel', 'polaroid', 'bottom-bar', 'film-frame', 'dv-cam', 'tile-copyright'];
  templates.forEach((template) => {
    const settings = state.sanitize(state.DEFAULTS);
    settings.template = template;
    const scene = layout.compose({
      imageW: 4000, imageH: 3000, meta: summary, settings,
      brandName: 'Canon', logoAspect: 3, logoEnabled: true, luminance: 0.35,
      formatDateOnly: (d) => meta.formatDateStyle(d, 'iso', {}),
      formatTimeOnly: (d) => meta.formatTimeStyle(d, '24hms', {})
    });
    assert.ok(scene.output.w > 0 && scene.output.h > 0, template + ' 输出尺寸');
    assert.ok(scene.ops.length > 0, template + ' 有绘制指令');
    scene.ops.forEach((op) => {
      ['x', 'y', 'w', 'h', 'size', 'radius', 'x1', 'y1', 'x2', 'y2'].forEach((key) => {
        if (op[key] !== undefined) assert.ok(isFinite(op[key]), template + ' ' + key + ' 有限');
      });
    });
    assert.ok(scene.textColor, template + ' 文字颜色');
  });
});

test('角落徽标/参数卡：位置随锚点变化且不越界', () => {
  const settings = state.sanitize(state.DEFAULTS);
  const anchorChecks = [
    ['top-left', (s) => s.ops.find((o) => o.kind === 'rect').x < 400],
    ['bottom-right', (s) => {
      const rect = s.ops.find((o) => o.kind === 'rect');
      return rect.x + rect.w <= 4000 && rect.x > 1800;
    }]
  ];
  anchorChecks.forEach(([anchor, check]) => {
    settings.layout.anchor = anchor;
    const scene = compose({ settings });
    assert.ok(check(scene), anchor);
    scene.ops.forEach((op) => {
      if (op.kind === 'text') {
        assert.ok(op.x >= 0 && op.x <= scene.output.w, anchor + ' 文本 x 不越界');
        assert.ok(op.y >= 0 && op.y <= scene.output.h, anchor + ' 文本 y 不越界');
      }
    });
  });
});

test('关闭所有字段时不产生文字指令', () => {
  const settings = state.sanitize(state.DEFAULTS);
  Object.keys(settings.fields).forEach((key) => { settings.fields[key] = false; });
  settings.template = 'param-panel';
  const scene = compose({ settings });
  assert.equal(scene.ops.filter((op) => op.kind === 'text').length, 0);
  assert.ok(scene.ops.some((op) => op.kind === 'image' && op.role === 'logo'));
});

test('关闭 logo 时不产生 image 指令', () => {
  const scene = compose({ logoEnabled: false });
  assert.equal(scene.ops.filter((op) => op.kind === 'image').length, 0);
});

test('自动对比：亮背景用深色字，暗背景用白色字', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'param-panel';
  settings.panel.style = 'none';
  const dark = compose({ settings, luminance: 0.2 });
  const light = compose({ settings, luminance: 0.9 });
  assert.equal(dark.textColor, '#FFFFFF');
  assert.equal(light.textColor, '#15181D');
});

test('拍立得画布大于照片，且使用相纸颜色', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'polaroid';
  settings.frame.color = '#F4EFE4';
  const scene = compose({ settings });
  assert.ok(scene.output.w > 4000);
  assert.ok(scene.output.h > 3000);
  assert.equal(scene.background.color, '#F4EFE4');
  assert.ok(scene.imageRect.x > 0 && scene.imageRect.y > 0);
  assert.equal(scene.textColor, '#15181D');
});

test('胶片齿孔：135 比例、孔向、两端孔、孔间打印与画面内单行', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'film-frame';
  const horizontal = compose({ settings });
  const unit = 3000 / 24;
  assert.ok(Math.abs(horizontal.output.h - 35 * unit) <= 2, '片宽 = 画面高 × 35/24');
  assert.ok(Math.abs(horizontal.imageRect.y - 5.5 * unit) <= 1, '片边 5.5mm');
  assert.equal(horizontal.background.color, '#0B0B0B');

  const holes = horizontal.ops.filter((op) => op.kind === 'rect' && op.fill === '#FCFCFC');
  const top = holes.filter((op) => op.y < horizontal.imageRect.y);
  const bottom = holes.filter((op) => op.y > horizontal.imageRect.y + horizontal.imageRect.h);
  assert.ok(top.length >= 4 && bottom.length >= 4, '上下都有白色齿孔');
  assert.ok(top.every((op) => op.w < op.h), '横向胶卷的孔为竖向长孔');
  assert.ok(Math.abs(top[0].w - 1.98 * unit) <= 2 && Math.abs(top[0].h - 2.8 * unit) <= 2, '固定 1.98×2.8mm');
  const innerGap = horizontal.imageRect.y - (top[0].y + top[0].h);
  assert.ok(Math.abs(innerGap - 0.6 * unit) <= 2, '孔内缘距画面 0.6mm');
  const firstGap = top[0].x - horizontal.imageRect.x;
  const lastGap = horizontal.imageRect.x + horizontal.imageRect.w - (top[top.length - 1].x + top[top.length - 1].w);
  assert.ok(firstGap > 0 && firstGap < 300, '首孔靠近左端');
  assert.ok(lastGap > 0 && lastGap < 300, '末孔靠近右端');

  const texts = horizontal.ops.filter((op) => op.kind === 'text');
  const textOf = (value) => texts.find((op) => op.text === value);
  const stock = textOf('KODAK PORTRA 400');
  assert.ok(stock, 'Portra 边字存在');
  assert.equal(stock.color, '#F5A623', '边字暗金色');
  assert.ok(stock.family.indexOf('Arial') >= 0, '边字使用硬朗的胶片字体');
  assert.equal(stock.shadowBlur, 0, '原有边字无光晕');
  assert.ok(stock.y < top[0].y, '原有边字在齿孔外侧');
  assert.equal(texts.filter((op) => op.text === 'KODAK PORTRA 400').length, 1,
    '单格只出现一次胶卷名（长图才重复）');

  const topHoles = top.slice().sort((a, b) => a.x - b.x).slice(0, 9);
  const hc = (i) => topHoles[i].x + topHoles[i].w / 2;
  const topTexts = texts.filter((op) => op.y < horizontal.imageRect.y);
  const bottomTexts = texts.filter((op) => op.y > horizontal.imageRect.y + horizontal.imageRect.h);
  const topNumber = topTexts.find((op) => op.text === '12');
  assert.ok(topNumber, '上侧片号 12');
  assert.ok(Math.abs(topNumber.x - hc(0)) <= 2, '上片号在首孔正上方');
  assert.equal(topNumber.color, '#F5A623', '片号与胶卷名同色');
  const stockBox = render.textBounds(stock);
  assert.ok(Math.abs((stockBox.x0 + stockBox.x1) / 2 - (hc(2) + hc(5)) / 2) <= 24,
    '胶卷名跨第 3–6 孔居中');
  assert.ok(Math.abs(stockBox.x0 - (hc(2) - topHoles[2].w / 2)) <= 12,
    '胶卷名从第 3 孔左上开始');

  const bottomNumber = bottomTexts.find((op) => op.text === '12');
  const aNumber = bottomTexts.find((op) => op.text === '12A');
  assert.ok(bottomNumber && aNumber, '下侧片号 12 / 12A');
  assert.ok(Math.abs(bottomNumber.x - hc(0)) <= 2, '下片号在首孔正下方');
  assert.ok(Math.abs(aNumber.x - hc(4)) <= 2, 'A 片号在第 5 孔下方');
  assert.ok(aNumber.size < bottomNumber.size, 'A 片号比普通片号小');
  const arrows = horizontal.ops.filter((op) => op.kind === 'path' && op.fill === '#F5A623');
  assert.equal(arrows.length, 1, 'A 片号下方有填充箭头');
  const arrowPts = arrows[0].points;
  const arrowXs = arrowPts.map((p) => p[0]);
  const arrowYs = arrowPts.map((p) => p[1]);
  assert.ok(Math.min(...arrowYs) > bottomNumber.y, '箭头在片号下方');
  const arrowLen = Math.max(...arrowXs) - Math.min(...arrowXs);
  const stepPx0 = hc(1) - hc(0);
  assert.ok(Math.abs(arrowLen - stepPx0 * 0.77) <= stepPx0 * 0.12, '箭头总长 ≈0.77P');
  assert.ok(Math.max(...arrowXs) > hc(4), '箭头右端伸到 A 片号右侧');

  const blocks = horizontal.ops.filter((op) => op.kind === 'rect' && op.fill === '#F5A623');
  assert.equal(blocks.length, 2, '两段条码各是一条实心底块');
  const stepPx = hc(1) - hc(0);
  blocks.forEach((op) => {
    assert.ok(Math.abs(op.w - stepPx * 2.66) <= stepPx * 0.08, '条码组宽 ≈2.66P');
  });
  const outerBandPx = horizontal.output.h - (bottom[0].y + bottom[0].h);
  const expectedH = outerBandPx + top[0].h * 0.7;
  assert.ok(blocks.every((op) => Math.abs(op.h - expectedH) <= 4), '条码上半截伸入齿孔区 0.7 孔高');
  const barcode1 = blocks.find((op) => op.x < hc(4));
  const barcode2 = blocks.find((op) => op.x >= hc(4));
  assert.ok(barcode1 && barcode2, '两段条码分别位于 A 片号两侧');
  assert.ok(barcode1.x >= hc(0), '条码从首孔右侧开始');
  assert.ok(barcode1.x - bottomNumber.x >= stepPx * 0.25, '第一条条码与片号之间留出一个条宽的空隙');

  // 遮罩：0 全高、2 下半、1 上半；列间无缝
  const masks = horizontal.ops.filter((op) => op.kind === 'rect' && op.fill === '#0B0B0B' &&
    op.x >= barcode1.x - 1 && op.x + op.w <= barcode2.x + barcode2.w + 1 && op.h > 1);
  const p1 = '3232303031313031212021302030323';
  const p2 = '3232303031313031212031213030323';
  const nonThree = (t) => Array.from(t).filter((c) => c !== '3').length;
  assert.equal(masks.length, nonThree(p1) + nonThree(p2), '每个 0/1/2 列都有一个遮罩');
  const maskHeights = new Set(masks.map((op) => Math.round(op.h)));
  assert.ok(maskHeights.size >= 3, '遮罩覆盖满高/上半/下半三种列');

  const longStrip = compose({ settings, imageW: 6000, imageH: 2000 });
  const longTexts = longStrip.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(longTexts.includes('13'), '长片上的片号递增');
  assert.ok(longTexts.filter((t) => t === 'KODAK PORTRA 400').length >= 2, '长片上胶卷名重复');
  const longBars = longStrip.ops.filter((op) => op.kind === 'rect' && op.fill === '#F5A623');
  assert.ok(longBars.length > blocks.length, '长片上条码重复');

  ['P', '±0.0', '400', '250', 'F2.8'].forEach((value) => {
    const item = textOf(value);
    assert.ok(item, 'Pentax 打印 ' + value);
    assert.ok(item.shadowBlur > 0, 'Pentax 打印带光晕');
  });
  const pItem = textOf('P');
  assert.ok(Math.abs(pItem.y - top[0].y - top[0].h / 2) < 2, 'Pentax 印在孔行间隙');

  settings.film.holeColor = 'black';
  const blackHoles = compose({ settings });
  assert.ok(blackHoles.ops.some((op) => op.kind === 'rect' && op.fill === '#000000'));
  settings.film.holeColor = 'white';

  // 打印字号/透明度只影响打印内容，不影响胶片原有边字
  settings.film.textSize = 60;
  settings.film.textOpacity = 0.35;
  const bigPrint = compose({ settings });
  const bigTexts = bigPrint.ops.filter((op) => op.kind === 'text');
  const bigEdge = bigTexts.find((op) => op.text === 'KODAK PORTRA 400');
  assert.equal(bigEdge.size, stock.size, '边字字号不随打印字号变化');
  assert.equal(bigEdge.color, stock.color, '边字颜色/不透明度不随打印透明度变化');
  const bigPrintItem = bigTexts.find((op) => op.shadowBlur > 0);
  const basePrintItem = texts.find((op) => op.shadowBlur > 0);
  assert.ok(bigPrintItem.size > basePrintItem.size, '打印内容字号可调');
  settings.film.textSize = 24;
  settings.film.textOpacity = 1;

  assert.deepEqual(state.filmStockOptions('color-negative').map((x) => x.id), ['portra400']);
  assert.deepEqual(state.filmStockOptions('bw-negative').map((x) => x.id), ['hp5']);
  assert.equal(state.sanitize({ film: { type: 'bw-negative' } }).film.stockId, 'hp5');
  assert.equal(state.sanitize({ film: { type: 'bw-negative', stock: 'HP5 PLUS' } }).film.stockId, 'hp5', '旧型号迁移');

  settings.film.printStyle = 'minolta';
  const minolta = compose({ settings });
  const minoltaText = minolta.ops.filter((op) => op.kind === 'text').find((op) => op.shadowBlur > 0);
  assert.ok(minoltaText && minoltaText.rotation !== 0, 'Minolta 右侧竖排');
  assert.ok(minoltaText.text.indexOf('50mm') >= 0 && minoltaText.text.indexOf('ISO400') >= 0);

  settings.film.printStyle = 'canon-date';
  const canon = compose({ settings });
  const canonText = canon.ops.filter((op) => op.kind === 'text').find((op) => op.text.indexOf("'24") === 0);
  assert.ok(canonText && canonText.shadowBlur > 0, 'Canon 右下日期带光晕');
  assert.ok(canonText.x > canon.imageRect.x + canon.imageRect.w * 0.7, '日期在右侧');
  const canonBox = render.textBounds(canonText);
  const mm = canon.imageRect.h / 24;
  assert.ok(canon.imageRect.x + canon.imageRect.w - canonBox.x1 > mm * 2.4, 'Prima 日期往左内缩');
  assert.ok(canon.imageRect.y + canon.imageRect.h - canonBox.y1 > mm * 1.2, 'Prima 日期微微上移');

  assert.equal(settings.film.orientation, 'horizontal', '默认横向齿孔');
  assert.ok(!compose({ settings }).ops.some((op) => op.kind === 'image' && op.role === 'logo'),
    '胶片不再绘制品牌徽标');
  assert.deepEqual(state.FILM_ORIENTATIONS.map((o) => o.value), ['horizontal', 'vertical']);

  settings.film.printStyle = 'none';
  const noPrint = compose({ settings });
  assert.ok(!noPrint.ops.some((op) => op.kind === 'text' && op.shadowBlur > 0), '无打印模式无激光文字');

  settings.film.printStyle = 'pentax';
  settings.film.orientation = 'vertical';
  const vertical = compose({ settings });
  const vholes = vertical.ops.filter((op) => op.kind === 'rect' && op.fill === '#FCFCFC');
  assert.ok(vholes.some((op) => op.x < vertical.imageRect.x));
  assert.ok(vholes.some((op) => op.x > vertical.imageRect.x + vertical.imageRect.w));
  assert.ok(vholes.every((op) => op.w > op.h), '竖向胶卷的孔为横向长孔');

  settings.film.type = 'bw-negative';
  const bw = compose({ settings });
  assert.equal(bw.background.color, '#0B0B0B');
  const bwTexts = bw.ops.filter((op) => op.kind === 'text').map((op) => op.color);
  assert.ok(bwTexts.every((color) => color === '#F4F4F4'));
  const bwStock = bw.ops.find((op) => op.kind === 'text' && op.text === 'ILFORD HP5 PLUS 400');
  assert.ok(bwStock && bwStock.color === '#F4F4F4', 'HP5 使用独立白字边字');
  assert.ok(!bw.ops.some((op) => op.kind === 'rect' && op.fill === '#F4F4F4'),
    'HP5 不套用 Portra 的橙色条码');
  assert.ok(!bw.ops.some((op) => op.kind === 'line' && op.color === '#F4F4F4'),
    'HP5 没有 Portra 的箭头');

  assert.deepEqual(state.FILM_TYPES.map((t) => t.value), ['bw-negative', 'color-negative']);
  assert.equal(state.sanitize({ film: { type: 'reversal' } }).film.type, 'color-negative');
  assert.equal(state.sanitize({ film: { textMode: 'none' } }).film.printStyle, 'none');
});

test('胶片：字号跟 24mm 画幅高走，不随照片宽度变化', () => {
  const base = state.sanitize(state.DEFAULTS);
  base.template = 'film-frame';
  base.film.printStyle = 'pentax';
  const narrow = compose({ settings: base, imageW: 1000, imageH: 800 });
  const wide = compose({ settings: base, imageW: 6000, imageH: 800 });
  const sizeOf = (scene, text) => {
    const op = scene.ops.find((item) => item.kind === 'text' && item.text === text);
    return op ? op.size : 0;
  };
  assert.ok(sizeOf(narrow, 'P') > 0);
  assert.ok(Math.abs(sizeOf(narrow, 'P') - sizeOf(wide, 'P')) < 0.01, '打印字号与照片宽度无关');

  // 横向与竖向齿孔：同一 24mm 基准，打印字号也必须一致。
  const landscape = compose({ settings: base, imageW: 1200, imageH: 800 });
  const portrait = state.sanitize({ ...base, film: { ...base.film, orientation: 'vertical' } });
  const upright = compose({ settings: portrait, imageW: 800, imageH: 1200 });
  assert.ok(Math.abs(sizeOf(landscape, 'P') - sizeOf(upright, 'P')) < 0.01, '横竖切换字号不变');
});

test('胶片：片长两端各多 0.5mm 黑边，Minolta 紧贴右缘并垂直居中', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'film-frame';
  settings.film.printStyle = 'minolta';
  const scene = compose({ settings, imageW: 1200, imageH: 800 });
  const mm = 800 / 24;
  assert.ok(Math.abs(scene.imageRect.x - 0.5 * mm) <= 0.5, '左侧多出 0.5mm');
  assert.ok(Math.abs((scene.output.w - scene.imageRect.x - scene.imageRect.w) - 0.5 * mm) <= 0.5,
    '右侧多出 0.5mm');

  const pentax = compose({ settings: Object.assign({}, settings, { film: Object.assign({}, settings.film, { printStyle: 'pentax' }) }), meta: { exposureModeText: 'M', exposureCompText: '-1.0' } });
  const pentaxTexts = pentax.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(pentaxTexts.includes('M'), 'Pentax 打印真实档位');
  assert.ok(pentaxTexts.includes('-1.0'), 'Pentax 打印真实曝光补偿');

  const minolta = scene.ops.find((op) => op.kind === 'text' && op.shadowBlur > 0);
  assert.ok(minolta, 'Minolta 参数存在');
  const box = render.textBounds(minolta);
  const rightEdge = scene.imageRect.x + scene.imageRect.w;
  assert.ok(rightEdge - box.x1 <= 0.5 * mm + 1, '参数紧贴画幅右缘，不再内缩');
  const centerY = (box.y0 + box.y1) / 2;
  assert.ok(Math.abs(centerY - (scene.imageRect.y + scene.imageRect.h / 2)) <= 2,
    '参数垂直居中而非靠上');
});

test('胶片：竖向齿孔整幅旋转，文字不压齿孔', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'film-frame';
  settings.film.orientation = 'vertical';
  ['minolta', 'canon-date', 'pentax', 'none'].forEach((style) => {
    settings.film.printStyle = style;
    const scene = compose({ settings, imageW: 800, imageH: 1200 });
    assert.ok(scene.output.w < scene.output.h, style + '：竖向画布');
    const holes = scene.ops.filter((op) => op.kind === 'rect' &&
      (op.fill === '#FCFCFC' || op.fill === '#000000') && op.w > 2 && op.h > 2);
    assert.ok(holes.length >= 8, style + '：齿孔存在');
    scene.ops.filter((op) => op.kind === 'text').forEach((op) => {
      const box = render.textBounds(op);
      holes.forEach((hole) => {
        const hit = box.x0 < hole.x + hole.w && box.x1 > hole.x &&
          box.y0 < hole.y + hole.h && box.y1 > hole.y;
        assert.ok(!hit, style + '：文字「' + op.text + '」不应压在齿孔上');
      });
      // 胶片原有边字允许在两端被裁切（真实扫描就是这样）；
      // 只有带光晕的「打印内容」必须完整落在画布内。
      if (op.shadowBlur > 0) {
        assert.ok(box.x0 >= -1 && box.y0 >= -1 &&
          box.x1 <= scene.output.w + 1 && box.y1 <= scene.output.h + 1,
          style + '：打印文字「' + op.text + '」应在画布内');
      }
    });
  });

  settings.film.printStyle = 'canon-date';
  const canon = compose({ settings, imageW: 800, imageH: 1200 });
  const date = canon.ops.find((op) => op.kind === 'text' && op.text.indexOf("'24") === 0);
  assert.ok(date && Math.abs(Math.abs(date.rotation) - Math.PI / 2) < 0.01, '竖向时日期也跟着转');
});

test('DV 界面：REC、电池、时间码与对焦框', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'dv-cam';
  const scene = compose({ settings });
  const texts = scene.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(texts.includes('REC'));
  assert.ok(texts.includes('00:12:34'));
  assert.ok(texts.includes('AUTO'));
  assert.ok(texts.includes('78%'));
  assert.ok(scene.ops.some((op) => op.kind === 'rect' && op.fill === '#FF3B30'));
  assert.equal(scene.ops.filter((op) => op.kind === 'path').length, 4, '取景框四角各一条折线');
  assert.ok(scene.ops.filter((op) => op.kind === 'line').length >= 6, '曝光标尺轴线与 5 个刻度');
  settings.dv.rec = false;
  settings.dv.battery = false;
  const noRec = compose({ settings });
  assert.ok(!noRec.ops.some((op) => op.fill === '#FF3B30'));
  assert.ok(!noRec.ops.some((op) => op.kind === 'text' && op.text === '78%'));
});

test('底部白边：左右槽位与分隔线', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'bottom-bar';
  const scene = compose({ settings });
  assert.ok(scene.output.h > 3000);
  assert.equal(scene.imageRect.y, 0);
  const texts = scene.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(texts.includes('EOS R5'));
  assert.ok(texts.includes('RF24-70mm F2.8 L IS USM'));
  assert.ok(texts.some((t) => /50mm/.test(t)));
  assert.ok(scene.ops.some((op) => op.kind === 'line'));
  settings.bottomBar.left1 = 'brand';
  settings.bottomBar.right2 = 'location';
  const custom = compose({ settings });
  const customTexts = custom.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(customTexts.includes('Canon'));
  assert.ok(customTexts.includes('30.2701°N, 120.1252°E'));
});

test('平铺版权：出现旋转的重复文字', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'tile-copyright';
  const scene = compose({ settings });
  const texts = scene.ops.filter((op) => op.kind === 'text');
  assert.ok(texts.length >= 5);
  assert.ok(texts.every((op) => op.rotation !== 0));
  assert.match(texts[0].text, /©|Copyright/);
});

test('参数卡包含技术标签与数值', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'param-panel';
  const scene = compose({ settings });
  const texts = scene.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  ['FOCAL', 'APERTURE', 'SHUTTER', 'ISO'].forEach((label) => assert.ok(texts.includes(label), label));
  assert.ok(texts.includes('50mm'));
  assert.ok(texts.includes('f/2.8'));
  assert.ok(texts.includes('1/250s'));
  assert.ok(texts.includes('ISO 400'));
});

test('预览与导出的相对几何一致', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'param-panel';
  const small = layout.compose({
    imageW: 800, imageH: 600, meta: summary, settings,
    brandName: 'Canon', logoAspect: 3, logoEnabled: true, luminance: 0.35
  });
  const large = layout.compose({
    imageW: 4000, imageH: 3000, meta: summary, settings,
    brandName: 'Canon', logoAspect: 3, logoEnabled: true, luminance: 0.35
  });
  const sText = small.ops.find((op) => op.kind === 'text');
  const lText = large.ops.find((op) => op.kind === 'text');
  assert.ok(Math.abs(sText.x / small.output.w - lText.x / large.output.w) < 0.01);
  assert.ok(Math.abs(sText.size / small.output.w - lText.size / large.output.w) < 0.002);
  assert.ok(Math.abs(small.output.w / small.output.h - large.output.w / large.output.h) < 0.001);
});

test('默认参数不会被运行时修改污染', () => {
  const s = state.sanitize(state.DEFAULTS);
  s.text.size = 99;
  s.film.textSize = 60;
  s.fields.model = false;
  assert.equal(state.DEFAULTS.text.size, 18);
  assert.equal(state.DEFAULTS.film.textSize, 24);
  assert.equal(state.DEFAULTS.fields.model, true);
  const again = state.sanitize({});
  assert.equal(again.text.size, 18);
  assert.equal(again.film.textSize, 24);
  assert.equal(again.fields.model, true);
});

test('模板迁移：旧模板映射到新模板', () => {
  assert.equal(state.sanitize({ template: 'corner-badge' }).template, 'param-panel');
  assert.equal(state.sanitize({ template: 'film-bar' }).template, 'param-panel');
  assert.equal(state.sanitize({ template: 'frame-line' }).template, 'dv-cam');
  assert.equal(state.sanitize({ template: 'not-a-template' }).template, 'param-panel');
  assert.equal(state.TEMPLATES.length, 6);
});

test('日期与时间可分别显示并选择格式', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'param-panel';
  settings.fields.location = false;
  settings.fields.date = false;
  settings.fields.time = true;
  settings.content.timeStyle = '24hm';
  const timeOnly = compose({ settings });
  const timeTexts = timeOnly.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(timeTexts.includes('12:34'));
  assert.ok(!timeTexts.some((t) => t.includes('2024-05-01')));

  settings.fields.date = true;
  settings.fields.time = false;
  settings.content.dateStyle = 'cn';
  const dateOnly = compose({ settings });
  const dateTexts = dateOnly.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(dateTexts.includes('2024年5月1日'));
  assert.ok(!dateTexts.some((t) => t.includes('12:34')));

  settings.fields.date = true;
  settings.fields.time = true;
  settings.content.timeStyle = '24hms';
  const both = compose({ settings });
  assert.ok(both.ops.some((op) => op.text === '2024年5月1日 12:34:56'));

  settings.template = 'bottom-bar';
  settings.bottomBar.left1 = 'date';
  settings.bottomBar.right1 = 'time';
  const bar = compose({ settings });
  const barTexts = bar.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(barTexts.includes('2024年5月1日'));
  assert.ok(barTexts.includes('12:34:56'));

  settings.template = 'dv-cam';
  settings.dv.showDate = false;
  settings.dv.showTime = true;
  const dv = compose({ settings });
  const dvTexts = dv.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(dvTexts.includes('12:34:56'));
  assert.ok(!dvTexts.some((t) => t.includes('2024-05-01')));
});

test('参数卡品牌 logo 替换品牌文字，避免重复', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'param-panel';
  const withBrandModel = { ...summary, model: 'Canon EOS R5', modelFull: 'Canon EOS R5' };
  const scene = compose({ settings, meta: withBrandModel, brandName: 'Canon', logoEnabled: true });
  const texts = scene.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(!texts.includes('Canon'), '有 logo 时不再打印品牌');
  assert.ok(texts.includes('EOS R5'), '型号保留且剥离品牌前缀');
  assert.ok(scene.ops.some((op) => op.kind === 'image' && op.role === 'logo'));

  const noLogo = compose({ settings, meta: withBrandModel, brandName: 'Canon', logoEnabled: false });
  const noLogoTexts = noLogo.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(noLogoTexts.includes('Canon EOS R5'), '关闭 logo 时恢复品牌 + 型号');

  settings.logo.source = 'custom';
  const customLogo = compose({ settings, meta: withBrandModel, brandName: 'Canon', logoEnabled: true });
  const customTexts = customLogo.ops.filter((op) => op.kind === 'text').map((op) => op.text);
  assert.ok(!customTexts.includes('Canon EOS R5'));
  assert.ok(customTexts.includes('EOS R5'));
});

test('拍立得字重只改变品牌型号行，不改变相纸几何', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'polaroid';
  settings.text.weight = 300;
  const light = compose({ settings });
  settings.text.weight = 800;
  const heavy = compose({ settings });
  assert.equal(light.output.w, heavy.output.w);
  assert.equal(light.output.h, heavy.output.h);
  assert.deepEqual(light.imageRect, heavy.imageRect);

  const strip = (scene) => scene.ops.filter((op) => op.kind === 'text').map((op) => ({
    text: op.text, x: op.x, y: op.y, size: op.size, weight: op.weight
  }));
  const lightTexts = strip(light);
  const heavyTexts = strip(heavy);
  assert.equal(lightTexts.length, heavyTexts.length);
  for (let i = 0; i < lightTexts.length; i++) {
    assert.equal(lightTexts[i].x, heavyTexts[i].x);
    assert.equal(lightTexts[i].y, heavyTexts[i].y);
    assert.equal(lightTexts[i].size, heavyTexts[i].size);
    if (lightTexts[i].text === 'EOS R5') {
      assert.equal(lightTexts[i].weight, 300);
      assert.equal(heavyTexts[i].weight, 800);
    } else {
      assert.equal(lightTexts[i].weight, heavyTexts[i].weight, '非品牌型号行字重不变');
    }
  }
});

test('底部白边：徽标紧邻文字，只有有 logo 时才画短竖线', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'bottom-bar';
  settings.bottomBar.logoPosition = 'before-right';
  const scene = compose({ settings });
  const logo = scene.ops.find((op) => op.kind === 'image' && op.role === 'logo');
  const line = scene.ops.find((op) => op.kind === 'line');
  assert.ok(logo && line);
  assert.ok(line.x1 > logo.x && line.x1 < logo.x + logo.w + 40 * 2, '竖线在 logo 与右侧文字之间');
  assert.ok(Math.abs(line.x1 - scene.output.w / 2) > 1, '不再是固定中间线');
  const divH = line.y2 - line.y1;
  assert.ok(divH < 92 * 4 * 0.5, '短竖线不超过半栏高');

  settings.bottomBar.logoPosition = 'after-left';
  const leftScene = compose({ settings });
  const leftLogo = leftScene.ops.find((op) => op.kind === 'image' && op.role === 'logo');
  const leftLine = leftScene.ops.find((op) => op.kind === 'line');
  assert.ok(leftLine.x1 < leftLogo.x && leftLine.x1 > 0);

  settings.bottomBar.divider = false;
  const noLine = compose({ settings });
  assert.equal(noLine.ops.filter((op) => op.kind === 'line').length, 0);

  settings.bottomBar.divider = true;
  const noLogo = compose({ settings, logoEnabled: false });
  assert.equal(noLogo.ops.filter((op) => op.kind === 'line').length, 0);
});

test('底部白边：右侧文字真正右对齐到内边距', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'bottom-bar';
  ['before-right', 'after-left'].forEach((position) => {
    settings.bottomBar.logoPosition = position;
    const scene = compose({ settings });
    const pad = settings.bottomBar.paddingX * (scene.imageRect.w / 1000);
    const rightEdge = scene.imageRect.w - pad;
    const rightTexts = scene.ops.filter((op) => op.kind === 'text' && op.align === 'right');
    assert.ok(rightTexts.length >= 1, position + '：有右侧文字');
    rightTexts.forEach((op) => {
      const box = render.textBounds(op);
      assert.ok(Math.abs(box.x1 - rightEdge) <= 1.5,
        position + '：右侧文字右缘应贴内边距（实际 ' + Math.round(box.x1) + ' vs ' + Math.round(rightEdge) + '）');
    });
  });
});

test('DV：OSD 固定白色、满透明度为 100%、REC 红点更大', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'dv-cam';
  settings.dv.opacity = 1;
  const scene = compose({ settings });
  assert.equal('color' in state.DEFAULTS.dv, false, '已删除 DV 颜色选项');
  assert.equal(state.DV_COLORS, undefined);
  assert.equal(state.sanitize({ dv: { color: 'amber' } }).dv.color, undefined, '旧颜色字段被丢弃');

  // 所有图元（文字/线/折线/描边）在 opacity=1 时都必须 100% 不透明。
  const alphaOf = (color) => {
    const m = String(color || '').match(/rgba\([^)]*,\s*([0-9.]+)\s*\)$/);
    return m ? Number(m[1]) : 1;
  };
  scene.ops.forEach((op) => {
    if (op.color) assert.equal(alphaOf(op.color), 1, op.kind + ' 应为 100% 不透明');
    if (op.stroke && op.stroke.color) assert.equal(alphaOf(op.stroke.color), 1, '描边应为 100% 不透明');
    if (op.fill && typeof op.fill === 'string') assert.equal(alphaOf(op.fill), 1, '填充应为 100% 不透明');
  });

  const path = scene.ops.find((op) => op.kind === 'path');
  assert.ok(path && path.points.length === 3 && path.lineJoin === 'miter', '取景框为单条折线');
  const frameWidth = settings.dv.frameWidth * (settings.dv.size ? 4000 / 1000 : 1);
  assert.ok(Math.abs(path.width - frameWidth) < 0.01, '折线宽度 = 取景框线宽');

  const rec = scene.ops.find((op) => op.kind === 'rect' && op.fill === '#FF3B30');
  const u = 4000 / 1000;
  const expected = settings.dv.size * u * 0.775;
  assert.ok(Math.abs(rec.w - expected) < 0.01, 'REC 红点直径 = 0.775 × 字号（比原来大 25%）');
});

test('DV：取景框在最外侧、上下对称，并含分辨率/曝光/中心对焦', () => {
  const settings = state.sanitize(state.DEFAULTS);
  settings.template = 'dv-cam';
  const scene = compose({ settings });
  const u = 4000 / 1000;
  const frameInset = settings.dv.frameMargin * u;
  const framePaths = scene.ops.filter((op) => op.kind === 'path');
  assert.equal(framePaths.length, 4, '取景框四角各一条折线');
  assert.ok(framePaths.every((op) => op.points.length === 3 && op.lineJoin === 'miter'),
    '转角是一条折线且 miter 连接，避免两条直线拼接的暗块');
  assert.ok(framePaths.every((op) => {
    const xs = op.points.map((p) => p[0]);
    const ys = op.points.map((p) => p[1]);
    return Math.min(...xs) <= frameInset + 1 || Math.min(...ys) <= frameInset + 1 ||
      Math.max(...xs) >= scene.output.w - frameInset - 1 || Math.max(...ys) >= scene.output.h - frameInset - 1;
  }), '取景框在最外侧');
  settings.dv.frameWidth = 12;
  const thicker = compose({ settings });
  const thickPath = thicker.ops.find((op) => op.kind === 'path');
  assert.ok(thickPath && thickPath.width > framePaths[0].width, '取景框线宽可调');
  settings.dv.frameWidth = 4;
  const rec = scene.ops.find((op) => op.kind === 'text' && op.text === 'REC');
  const date = scene.ops.find((op) => op.kind === 'text' && op.text === '2024-05-01 12:34:56');
  assert.ok(rec && date);
  const contentInset = Math.max(settings.dv.padding * u, frameInset + rec.size * 1.15 * 0.75);
  assert.ok(rec.y - rec.size / 2 >= contentInset - 1.5, 'REC 在取景框内');
  assert.ok(date.y + date.size / 2 <= 3000 - contentInset + 1.5, '日期在取景框内');
  assert.ok(Math.abs((rec.y - rec.size / 2) - (3000 - (date.y + date.size / 2))) < 2, '上下边距对称');
  assert.ok(scene.ops.some((op) => op.kind === 'text' && op.text === '4K'));
  assert.ok(scene.ops.filter((op) => op.kind === 'line').length >= 6, '曝光标尺轴线与刻度');

  settings.dv.resolution = false;
  assert.ok(!compose({ settings }).ops.some((op) => op.kind === 'text' && op.text === '4K'));

  settings.dv.centerFocus = 'none';
  const noFocus = compose({ settings });
  const focused = compose({ settings: state.sanitize({ ...state.DEFAULTS, template: 'dv-cam' }) });
  assert.ok(noFocus.ops.filter((op) => op.kind === 'rect' && !op.fill).length <
    focused.ops.filter((op) => op.kind === 'rect' && !op.fill).length);

  settings.dv.centerFocus = 'circle';
  const circle = compose({ settings });
  assert.ok(circle.ops.some((op) => op.kind === 'rect' && op.radius > 0 && !op.fill));

  settings.dv.exposure = true;
  const markerOf = (ev) => compose({ settings, meta: { exposureComp: ev } })
    .ops.find((op) => op.kind === 'rect' && op.fill && op.h < 20);
  const marker0 = markerOf(0);
  const markerPlus = markerOf(2);
  const markerMinus = markerOf(-2);
  assert.ok(marker0 && markerPlus && markerMinus, '曝光标尺标记存在');
  assert.ok(markerPlus.y < marker0.y && marker0.y < markerMinus.y, '真实曝光补偿驱动标记位置');

  // DV 必须扁平：任何图元都不带阴影
  const flat = compose({ settings });
  const shadowed = flat.ops.filter((op) => op.shadow || op.shadowBlur > 0 || op.shadowColor);
  assert.equal(shadowed.length, 0, 'DV OSD 全部无阴影');
  assert.ok(flat.ops.filter((op) => op.kind === 'path').every((op) => !op.shadow), '取景框无阴影');
});

test('旧设置迁移：日期时间字段、DV 键、胶片边框与反转片', () => {
  const migrated = state.sanitize({
    fields: { datetime: false },
    content: { dateFormat: 'date' },
    dv: { timestamp: true, dateFormat: 'date', focus: false, exposureValue: 2 },
    film: { type: 'reversal', border: 100, orientation: 'auto' }
  });
  assert.equal(migrated.fields.date, false);
  assert.equal(migrated.fields.time, false);
  assert.equal(migrated.content.dateStyle, 'iso');
  assert.equal(migrated.content.timeStyle, '24hms');
  assert.equal(migrated.dv.showDate, true);
  assert.equal(migrated.dv.showTime, false);
  assert.equal(migrated.dv.frame, false);
  assert.equal(migrated.dv.dateStyle, 'iso');
  assert.equal(migrated.film.type, 'color-negative');
  assert.equal(migrated.film.orientation, 'horizontal', '旧的自动齿孔方向迁移为横向');
  assert.equal('exposureValue' in migrated.dv, false, '旧的 DV 手填曝光值被丢弃');
  assert.equal('border' in migrated.film, false);
  assert.equal('datetime' in migrated.fields, false);
});

test('水印字段清单：固定 17 项，分 4 组，与渲染对应且均可编辑', async () => {
  const fields = meta.WATERMARK_FIELDS;
  assert.ok(Array.isArray(fields), 'WATERMARK_FIELDS 已导出');
  assert.equal(fields.length, 17, '正好 17 项');
  assert.deepEqual(meta.WATERMARK_GROUPS.map((g) => g.title),
    ['相机与器材', '曝光参数', '文件信息', '地理位置'], '四个分组');
  assert.ok(fields.every((f) => meta.WATERMARK_GROUPS.some((g) => g.id === f.group)), '每项都有合法分组');

  // 字段名不重复
  const names = fields.map((f) => f.field);
  assert.equal(new Set(names).size, names.length, '字段名不重复');

  // 每项都有中文标签与原始 tag 名
  fields.forEach((f) => {
    assert.ok(f.label && f.label.length, f.field + ' 有中文标签');
    assert.ok(f.cn && f.cn.length, f.field + ' 有原始 tag 名');
  });

  // 均能读取显示值
  const summary = meta.buildSummary({ format: 'jpeg', dimensions: { width: 100, height: 80 }, file: { name: 'x.jpg', size: 1 }, exif: null, warnings: [] });
  fields.forEach((f) => {
    const display = meta.formatFieldDisplay(f.field, summary);
    assert.equal(typeof display, 'string', f.field + ' 可读取显示值');
  });

  // 均能写入（包括无 EXIF 的图片）
  const samples = {
    make: 'Leica', model: 'M11', lens: 'Summicron 35', focal: '35mm',
    aperture: 'f/2', shutter: '1/250s', iso: 'ISO 400',
    datetime: '2024-05-01 12:34:56', offset: '+08:00',
    lat: '30.2701', lon: '120.1551', alt: '40 米',
    artist: '作者', copyright: '© 2024', filename: 'renamed.jpg',
    exposureComp: '+0.7', exposureMode: 'av'
  };
  let changed = 0;
  fields.forEach((f) => {
    const res = meta.applyFieldEdit(summary, f.field, samples[f.field]);
    assert.equal(res.ok, true, f.field + ' 可写入：' + (res.error || ''));
    changed += 1;
  });
  assert.equal(changed, 17, '全部字段可写');

  // 曝光补偿与档位：真实值可写、可按品牌显示
  assert.equal(summary.exposureComp, 0.7);
  assert.equal(summary.exposureCompText, '+0.7');
  assert.equal(meta.formatFieldDisplay('exposureComp', summary), '+0.7 EV');
  assert.equal(summary.exposureMode, 'A');
  assert.equal(summary.make, 'Leica');
  assert.equal(meta.formatFieldDisplay('exposureMode', summary), 'A', '非佳能显示 A');
  const canonSummary = meta.buildSummary({ format: 'jpeg', dimensions: { width: 10, height: 10 }, file: { name: 'c.jpg', size: 1 }, exif: null, warnings: [] });
  canonSummary.make = 'Canon';
  meta.applyFieldEdit(canonSummary, 'exposureMode', 'tv');
  assert.equal(meta.formatFieldDisplay('exposureMode', canonSummary), 'Tv', '佳能显示 Tv');
  assert.equal(meta.applyFieldEdit(canonSummary, 'exposureComp', '±0.0').display, '±0.0 EV');

  // filename 真的写进了 summary（不动真实文件名）
  assert.equal(summary.filename, 'renamed.jpg');
  assert.equal(meta.formatFieldDisplay('filename', summary), 'renamed.jpg');
  // 写入后能读回来（光圈/快门/ISO 带格式化）
  assert.equal(meta.formatFieldDisplay('make', summary), 'Leica');
  assert.equal(meta.formatFieldDisplay('aperture', summary), 'f/2');
  assert.equal(meta.formatFieldDisplay('iso', summary), 'ISO 400');
});

test('品牌自动识别', () => {
  const cases = [
    ['Canon', 'Canon EOS R5', 'canon'],
    ['NIKON CORPORATION', 'NIKON Z 6_2', 'nikon'],
    ['SONY', 'ILCE-7M4', 'sony'],
    ['Apple', 'iPhone 15 Pro', 'apple'],
    ['samsung', 'SM-S9180', 'samsung'],
    ['Xiaomi', 'Redmi Note 12', 'xiaomi'],
    ['Google', 'Pixel 8 Pro', 'google'],
    ['DJI', 'Mavic 3', 'dji'],
    ['FUJIFILM', 'X-T5', 'fujifilm'],
    ['Panasonic', 'DC-S5M2', 'panasonic'],
    ['OLYMPUS IMAGING CORP.', 'E-M1 Mark III', 'olympus'],
    ['Hasselblad', 'X2D 100C', 'hasselblad']
  ];
  cases.forEach(([make, model, id]) => {
    const brand = brands.detect(make, model);
    assert.equal(brand && brand.id, id, make + ' ' + model);
  });
  assert.ok(brands.list().length >= 20);
  assert.equal(brands.resolve('auto', { make: 'SomeMake', modelFull: 'SomeMake X1' }).mark.text.length > 0, true);
});
