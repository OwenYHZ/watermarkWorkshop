import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exif = require('../js/exif.js');
const meta = require('../js/meta.js');
const tags = require('../js/tags.js');

function fixture(name) {
  return fs.readFileSync(path.join(root, 'fixtures', name));
}

test('JPEG：解析基础 EXIF、GPS、缩略图、XMP、IPTC、ICC', async () => {
  const parsed = await exif.parse(fixture('canon-r5.jpg'), { name: 'canon-r5.jpg', type: 'image/jpeg' });
  assert.equal(parsed.format, 'jpeg');
  assert.deepEqual(parsed.dimensions, { width: 1200, height: 800 });
  assert.equal(parsed.orientation, 6);
  assert.equal(parsed.exif.ifd0.map[0x010f].value, 'Canon');
  assert.equal(parsed.exif.ifd0.map[0x0110].value, 'Canon EOS R5');
  assert.equal(parsed.exif.exif.map[0x8827].value, 400);
  assert.equal(parsed.exif.exif.map[0x920a].value.n, 50);
  assert.equal(parsed.exif.exif.map[0xa434].value, 'RF24-70mm F2.8 L IS USM');
  assert.equal(parsed.exif.gps.map[0x0001].value, 'N');
  assert.ok(parsed.thumbnail && parsed.thumbnail.bytes.length > 1000);
  assert.match(parsed.xmp.xml, /xmpmeta/);
  assert.ok(parsed.iptcRaw.length > 50);
  assert.ok(parsed.iccRaw.length > 1000);
  assert.deepEqual(parsed.warnings, []);
});

test('报告：摘要与分组字段', async () => {
  const parsed = await exif.parse(fixture('canon-r5.jpg'), { name: 'canon-r5.jpg' });
  const report = meta.buildReport(parsed);
  const s = report.summary;
  assert.equal(s.make, 'Canon');
  assert.equal(s.model, 'EOS R5');
  assert.equal(s.apertureText, 'f/2.8');
  assert.equal(s.shutterText, '1/250s');
  assert.equal(s.isoText, 'ISO 400');
  assert.equal(s.focalText, '50mm');
  assert.equal(s.date.y, 2024);
  assert.equal(s.offset, '+08:00');
  assert.ok(Math.abs(s.latitude - 30.2701) < 0.0002);
  assert.ok(Math.abs(s.longitude - 120.1252) < 0.0002);
  assert.ok(Math.abs(s.altitude - 40) < 0.01);
  assert.equal(report.groups.some((g) => g.id === 'gps'), true);
  assert.equal(report.groups.some((g) => g.id === 'iptc'), true);
  assert.equal(report.groups.some((g) => g.id === 'icc'), true);
  const iptc = report.groups.find((g) => g.id === 'iptc');
  assert.ok(iptc.rows.some((r) => /外滩正午/.test(r.value)));
  const xmp = report.groups.find((g) => g.id === 'xmp');
  assert.ok(xmp && xmp.rows.some((r) => r.name === 'xmp:Rating' && r.value === '4'));
});

test('PNG：eXIf、tEXt、zTXt、iTXt、pHYs', async () => {
  const parsed = await exif.parse(fixture('nikon-z6.png'), { name: 'nikon-z6.png', type: 'image/png' });
  assert.equal(parsed.format, 'png');
  assert.deepEqual(parsed.dimensions, { width: 800, height: 600 });
  assert.equal(parsed.exif.ifd0.map[0x010f].value, 'NIKON CORPORATION');
  assert.equal(parsed.png.ihdr.bitDepth, 8);
  assert.ok(parsed.png.text.length >= 5);
  const ztxt = parsed.png.text.find((t) => t.type === 'zTXt');
  assert.match(ztxt.text, /压缩 zTXt/);
  const author = parsed.png.text.find((t) => /Author/.test(t.keyword || ''));
  assert.match(author.text, /尼康样张/);
  assert.ok(parsed.png.phys);
  const report = meta.buildReport(parsed);
  assert.equal(report.summary.model, 'Z 6_2');
});

test('损坏 EXIF：不抛异常并给出警告', async () => {
  const parsed = await exif.parse(fixture('broken-exif.jpg'), { name: 'broken-exif.jpg' });
  assert.equal(parsed.format, 'jpeg');
  assert.ok(parsed.warnings.length > 0);
});

test('无 EXIF：仍能识别尺寸', async () => {
  const parsed = await exif.parse(fixture('no-exif.jpg'), { name: 'no-exif.jpg' });
  assert.equal(parsed.format, 'jpeg');
  assert.deepEqual(parsed.dimensions, { width: 640, height: 420 });
  assert.equal(parsed.exif, null);
  const png = await exif.parse(fixture('minimal.png'), { name: 'minimal.png' });
  assert.deepEqual(png.dimensions, { width: 320, height: 240 });
});

test('EXIF 补丁：方向归 1、尺寸更新', async () => {
  const parsed = await exif.parse(fixture('canon-r5.jpg'), { name: 'canon-r5.jpg' });
  const patched = meta.patchExif(parsed.exif.tiffBytes, { orientation: 1, width: 900, height: 600 });
  assert.equal(patched.changed.orientation, true);
  assert.equal(patched.changed.width, true);
  assert.equal(patched.changed.height, true);
  const re = exif.parseTiff(patched.bytes);
  assert.equal(re.ifd0.map[0x0112].value, 1);
  assert.equal(re.exif.map[0xa002].value, 900);
  assert.equal(re.exif.map[0xa003].value, 600);
});

test('JPEG 元数据回写：EXIF / XMP / IPTC', async () => {
  const source = await exif.parse(fixture('canon-r5.jpg'), { name: 'canon-r5.jpg' });
  const patched = meta.patchExif(source.exif.tiffBytes, { orientation: 1, width: 640, height: 420 });
  const exifSeg = meta.buildExifApp1(patched.bytes);
  const segments = [exifSeg, source.metadata.xmpApp1[0], source.metadata.iptcApp13].filter(Boolean);
  const injected = meta.injectJpegSegments(fixture('no-exif.jpg'), segments);
  assert.equal(injected.warnings.length, 0);
  const out = await exif.parse(injected.bytes, { name: 'out.jpg' });
  assert.equal(out.orientation, 1);
  assert.equal(out.exif.ifd0.map[0x010f].value, 'Canon');
  assert.ok(out.xmpParts.length > 0);
  assert.ok(out.iptcRaw && out.iptcRaw.length > 0);
});

test('PNG 数据块重建：保留文本与 eXIf', async () => {
  const nikon = await exif.parse(fixture('nikon-z6.png'), { name: 'nikon-z6.png' });
  const sourceChunks = meta.parsePngChunks(fixture('nikon-z6.png'));
  const preserved = sourceChunks
    .filter((c) => ['eXIf', 'tEXt', 'zTXt', 'iTXt', 'pHYs', 'tIME'].includes(c.type))
    .map((c) => c.raw);
  const rebuilt = meta.rebuildPng(fixture('minimal.png'), preserved);
  assert.equal(rebuilt.warnings.length, 0);
  const out = await exif.parse(rebuilt.bytes, { name: 'rebuilt.png' });
  assert.ok(out.exif);
  assert.equal(out.exif.ifd0.map[0x010f].value, 'NIKON CORPORATION');
  assert.ok(out.png.text.length >= 5);
  assert.deepEqual(out.dimensions, { width: 320, height: 240 });
});

test('标签格式化：快门/光圈/GPS/闪光灯', () => {
  const photo = {
    tag: 0x9204,
    type: 10,
    count: 1,
    value: { n: 1, d: 3 },
    bytes: new Uint8Array(8)
  };
  assert.equal(tags.formatValue('exif', 0x9204, photo, {}).text, '+0.33 EV');
  const flash = { tag: 0x9209, type: 3, count: 1, value: 16 };
  assert.match(tags.formatValue('exif', 0x9209, flash, {}).text, /闪光灯/);
  const gps = {
    entries: {
      0x0002: { tag: 0x0002, type: 5, count: 3, value: [{ n: 30, d: 1 }, { n: 16, d: 1 }, { n: 1234, d: 100 }] },
      0x0001: { tag: 0x0001, type: 2, count: 2, value: 'N' }
    }
  };
  const row = tags.formatValue('gps', 0x0002, gps.entries[0x0002], gps);
  assert.match(row.text, /30°/);
  assert.match(row.note, /30\.270/);
});

test('XMP：容器元素（ISO）与相机摘要映射', () => {
  const xml = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about=""
        xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
        xmlns:exif="http://ns.adobe.com/exif/1.0/"
        xmlns:exifEX="http://cipa.jp/exif/1.0/"
        xmlns:aux="http://ns.adobe.com/exif/1.0/aux/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        tiff:Make="Canon" tiff:Model="Canon EOS 200D II"
        exifEX:LensModel="EF-S18-55mm f/4-5.6 IS STM"
        aux:Lens="EF-S18-55mm f/4-5.6 IS STM"
        exif:FNumber="71/10" exif:ExposureTime="1/200"
        exif:FocalLength="55/1" exif:FocalLengthIn35mmFilm="88"
        exif:DateTimeOriginal="2020-01-01T08:05:11.33Z">
        <exif:ISOSpeedRatings><rdf:Seq><rdf:li>800</rdf:li></rdf:Seq></exif:ISOSpeedRatings>
        <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Test title</rdf:li></rdf:Alt></dc:title>
      </rdf:Description>
    </rdf:RDF>
  </x:xmpmeta>`;
  const parsedXmp = meta.parseXmp(xml);
  const map = meta.xmpToMap(parsedXmp.props);
  assert.equal(map['exif:ISOSpeedRatings'], '800');
  assert.equal(map['dc:title'], 'Test title');
  const parsed = {
    format: 'png',
    dimensions: { width: 6000, height: 4000 },
    orientation: 1,
    file: { name: 'xmp-only.png', size: 1 },
    exif: null,
    warnings: []
  };
  const summary = meta.buildSummary(parsed);
  meta.applyXmpSummary(summary, map, parsed);
  assert.equal(summary.metaSource, 'XMP');
  assert.equal(summary.make, 'Canon');
  assert.equal(summary.model, 'EOS 200D II');
  assert.equal(summary.lens, 'EF-S18-55mm f/4-5.6 IS STM');
  assert.equal(summary.apertureText, 'f/7.1');
  assert.equal(summary.shutterText, '1/200s');
  assert.equal(summary.focalText, '55mm');
  assert.equal(summary.isoText, 'ISO 800');
  assert.equal(summary.date.y, 2020);
  assert.equal(summary.date.offset, '+00:00');
});

test('EXIF 编辑：光圈/快门/ISO/焦距/时间/坐标解析与复位', () => {
  const summary = {
    make: 'Canon', model: 'EOS R5', modelFull: 'Canon EOS R5', lens: 'RF24-70mm',
    aperture: 2.8, apertureText: 'f/2.8', shutter: 1 / 250, shutterText: '1/250s',
    iso: 400, isoText: 'ISO 400', focal: 50, focalText: '50mm', focal35: 50,
    date: null, datetimeRaw: '', offset: '', latitude: NaN, longitude: NaN, altitude: NaN,
    coordText: '', dmsText: '', artist: '', copyright: '', software: '', bodySerial: '',
    lensMake: '', lensSerial: '', description: ''
  };
  assert.equal(meta.applyFieldEdit(summary, 'aperture', 'f/4').display, 'f/4');
  assert.equal(summary.aperture, 4);
  assert.equal(meta.applyFieldEdit(summary, 'shutter', '1/125s').display, '1/125s');
  assert.equal(meta.applyFieldEdit(summary, 'iso', 'ISO 1600').display, 'ISO 1600');
  assert.equal(summary.iso, 1600);
  assert.equal(meta.applyFieldEdit(summary, 'focal', '85mm').display, '85mm');
  assert.equal(summary.focal, 85);
  assert.equal(meta.applyFieldEdit(summary, 'datetime', '2024-05-01 12:34:56').ok, true);
  assert.equal(summary.date.y, 2024);
  assert.equal(summary.date.m, 5);
  assert.equal(meta.applyFieldEdit(summary, 'lat', '30.2701').ok, true);
  assert.equal(meta.applyFieldEdit(summary, 'lon', '120.1551').ok, true);
  assert.match(summary.coordText, /30\.2701°N/);
  assert.equal(meta.applyFieldEdit(summary, 'model', 'EOS R6').ok, true);
  assert.equal(summary.model, 'EOS R6');
  assert.equal(meta.applyFieldEdit(summary, 'iso', '').display, '');
  assert.ok(Number.isNaN(summary.iso));
  assert.equal(summary.edited, true);

  const bad = meta.applyFieldEdit(summary, 'aperture', 'abc');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /光圈/);
  assert.equal(summary.aperture, 4);
  assert.equal(meta.applyFieldEdit(summary, 'lat', '120').ok, false);
  assert.equal(meta.parseEditText('shutter', '1/250').value, 1 / 250);
  summary.make = 'Canon';
  summary.modelFull = 'Canon EOS R5';
  summary.model = 'EOS R5';
  meta.applyFieldEdit(summary, 'make', 'Nikon');
  assert.equal(summary.make, 'Nikon');
  assert.equal(summary.model, 'EOS R5');
});

const realDir = path.join(root, 'testTruePhoto');
const realNames = ['IMG_6507.PNG', 'P1040654.PNG', 'P1324378.PNG', 'P2033320.PNG', 'TCC_2511.PNG', 'PB150266.JPG', 'TCC_2629.JPG', '_DSC6812.JPG'];
const haveReal = realNames.every((name) => fs.existsSync(path.join(realDir, name)));

test('真实样张：PNG 仅含 XMP 也能读出品牌/镜头/曝光/ISO', { skip: haveReal ? false : 'testTruePhoto 样张不存在' }, async () => {
  const expected = {
    'IMG_6507.PNG': { make: 'Canon', model: 'EOS 200D II', lens: /EF-S18-55mm/, focal: '55mm', aperture: 'f/7.1', shutter: '1/200s', iso: 'ISO 800' },
    'P1040654.PNG': { make: 'OLYMPUS CORPORATION', model: 'E-P7', lens: /LUMIX G VARIO 12-32/, focal: '12mm', aperture: 'f/6.3', shutter: '1/500s', iso: 'ISO 200' },
    'P1324378.PNG': { make: 'Panasonic', model: 'DC-GX9', lens: /Sigma 150-500/, focal: '150mm', aperture: 'f/6.3', shutter: '1.3s', iso: 'ISO 800' },
    'P2033320.PNG': { make: 'OLYMPUS CORPORATION', model: 'E-P7', lens: /OLYMPUS M\.12-200/, focal: '12mm', aperture: 'f/7.1', shutter: '1/200s', iso: 'ISO 200' },
    'TCC_2511.PNG': { make: 'NIKON CORPORATION', model: 'D800E', lens: /70\.0-200\.0/, focal: '170mm', aperture: 'f/6.3', shutter: '1/1250s', iso: 'ISO 200' }
  };
  for (const [name, exp] of Object.entries(expected)) {
    const parsed = await exif.parse(fs.readFileSync(path.join(realDir, name)), { name });
    const report = meta.buildReport(parsed);
    const s = report.summary;
    assert.equal(parsed.exif, null, name + ' 应无 eXIf');
    assert.equal(s.metaSource, 'XMP', name + ' 来源应为 XMP');
    assert.equal(s.make, exp.make, name + ' Make');
    assert.equal(s.model, exp.model, name + ' Model');
    assert.match(s.lens, exp.lens, name + ' Lens');
    assert.equal(s.focalText, exp.focal, name + ' 焦距');
    assert.equal(s.apertureText, exp.aperture, name + ' 光圈');
    assert.equal(s.shutterText, exp.shutter, name + ' 快门');
    assert.equal(s.isoText, exp.iso, name + ' ISO');
    assert.ok(report.groups.some((g) => g.id === 'camera' && g.rows.some((r) => r.source === 'XMP')));
  }
});

test('真实样张：JPEG 品牌/型号/曝光/ISO', { skip: haveReal ? false : 'testTruePhoto 样张不存在' }, async () => {
  const cases = [
    ['PB150266.JPG', 'OLYMPUS CORPORATION', 'E-P7', 'ISO 4000'],
    ['TCC_2629.JPG', 'NIKON CORPORATION', 'D800E', 'ISO 160'],
    ['_DSC6812.JPG', 'NIKON CORPORATION', '1 J5', 'ISO 200']
  ];
  for (const [name, make, model, iso] of cases) {
    const parsed = await exif.parse(fs.readFileSync(path.join(realDir, name)), { name });
    const report = meta.buildReport(parsed);
    assert.equal(report.summary.make, make, name + ' Make');
    assert.equal(report.summary.model, model, name + ' Model');
    assert.equal(report.summary.isoText, iso, name + ' ISO');
  }
});


test('日期/时间独立格式化：样式、12 小时制、星期与时区', () => {
  const p = { y: 2024, m: 5, d: 1, h: 0, mi: 5, s: 9, offset: '+08:00' };
  assert.equal(meta.formatDateStyle(p, 'iso'), '2024-05-01');
  assert.equal(meta.formatDateStyle(p, 'slash'), '2024/05/01');
  assert.equal(meta.formatDateStyle(p, 'dot'), '2024.05.01');
  assert.equal(meta.formatDateStyle(p, 'cn'), '2024年5月1日');
  assert.equal(meta.formatDateStyle(p, 'mdy'), '05/01/2024');
  assert.equal(meta.formatDateStyle(p, 'dmy'), '01/05/2024');
  assert.equal(meta.formatDateStyle(p, 'iso', { weekday: true }), '2024-05-01 周三');
  assert.equal(meta.formatTimeStyle(p, '24hms'), '00:05:09');
  assert.equal(meta.formatTimeStyle(p, '24hm'), '00:05');
  assert.equal(meta.formatTimeStyle(p, '12hms', { offset: true }), '12:05:09 AM +08:00');
  assert.equal(meta.formatTimeStyle(p, '12hm'), '12:05 AM');
  assert.equal(meta.formatTimeStyle({ ...p, h: 12 }, '12hm'), '12:05 PM');
  assert.equal(meta.formatTimeStyle({ ...p, h: 23 }, '12hms'), '11:05:09 PM');
});

