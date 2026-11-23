import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exporter = require('../js/export.js');
const meta = require('../js/meta.js');
const exif = require('../js/exif.js');

function fixture(name) {
  return fs.readFileSync(path.join(root, 'fixtures', name));
}

function u32(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
function u16(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

test('CRC32 已知向量', () => {
  const data = new TextEncoder().encode('123456789');
  assert.equal(meta.crc32(data), 0xcbf43926);
});

test('ZIP：store 模式、UTF-8 文件名、条目数正确', async () => {
  const files = [
    { name: 'a.jpg', blob: new Blob([new Uint8Array([1, 2, 3, 4])]) },
    { name: '中文.txt', blob: new Blob([new TextEncoder().encode('hello 水印')]) }
  ];
  const zipBlob = await exporter.zip(files);
  const bytes = new Uint8Array(await zipBlob.arrayBuffer());
  assert.equal(zipBlob.type, 'application/zip');
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
  assert.equal(bytes[2], 0x03);
  assert.equal(bytes[3], 0x04);

  // 第一个本地文件头
  const nameLen = u16(bytes, 26);
  const name1 = new TextDecoder().decode(bytes.subarray(30, 30 + nameLen));
  assert.equal(name1, 'a.jpg');
  const size1 = u32(bytes, 18);
  assert.equal(size1, 4);
  const dataStart = 30 + nameLen;
  assert.deepEqual(Array.from(bytes.subarray(dataStart, dataStart + 4)), [1, 2, 3, 4]);

  // 第二个本地文件头
  const secondOffset = dataStart + size1;
  assert.equal(bytes[secondOffset], 0x50);
  const nameLen2 = u16(bytes, secondOffset + 26);
  const name2 = new TextDecoder().decode(bytes.subarray(secondOffset + 30, secondOffset + 30 + nameLen2));
  assert.equal(name2, '中文.txt');
  assert.ok(u16(bytes, secondOffset + 6) & 0x0800, 'UTF-8 标志位');

  // EOCD
  const eocd = bytes.length - 22;
  assert.equal(u32(bytes, eocd), 0x06054b50);
  assert.equal(u16(bytes, eocd + 10), 2);
});

test('文件名模板与清理', () => {
  assert.equal(
    exporter.buildFilename('{name}_{brand}_{model}', { name: 'IMG 01', brand: 'Canon', model: 'EOS R5' }, 'jpg'),
    'IMG 01_Canon_EOS R5.jpg'
  );
  assert.equal(
    exporter.buildFilename('{name}_watermark', { name: 'a/b:c*?' }, 'png'),
    'a_b_c___watermark.png'
  );
  assert.equal(exporter.buildFilename('', {}, 'jpg'), 'watermark.jpg');
  assert.match(exporter.sanitizeFilename('   ..\\evil:*?  '), /^[^\\/:*?"<>|]+$/);
});

test('尺寸计算：长边、百分比、上限', () => {
  assert.deepEqual(
    exporter.targetDimensions(6000, 4000, { resize: 'longEdge', longEdge: 2560 }),
    { width: 2560, height: 1707, limited: false, note: '' }
  );
  assert.equal(exporter.targetDimensions(1000, 800, { resize: 'percent', percent: 50 }).width, 500);
  const huge = exporter.targetDimensions(30000, 20000, { resize: 'original' });
  assert.equal(huge.limited, true);
  assert.ok(huge.width <= exporter.MAX_DIMENSION);
  assert.ok(huge.width * huge.height <= exporter.MAX_AREA);
});

test('JPEG 元数据回写管线（无 canvas 的段构造）', async () => {
  const parsed = await exif.parse(fixture('canon-r5.jpg'), { name: 'canon-r5.jpg' });
  const built = exporter.buildJpegSegments(parsed, 640, 420);
  assert.ok(built.segments.length >= 3);
  const injected = meta.injectJpegSegments(fixture('no-exif.jpg'), built.segments);
  const out = await exif.parse(injected.bytes, { name: 'out.jpg' });
  assert.equal(out.exif.ifd0.map[0x010f].value, 'Canon');
  assert.equal(out.orientation, 1);
  assert.equal(out.exif.exif.map[0xa002].value, 640);
  assert.equal(out.exif.exif.map[0xa003].value, 420);
});

test('PNG 保留块管线', async () => {
  const png = await exif.parse(fixture('nikon-z6.png'), { name: 'nikon-z6.png' });
  const preserved = exporter.pngPreservedChunks(png, fixture('nikon-z6.png'), 320, 240);
  assert.ok(preserved.chunks.length >= 6);
  const rebuilt = meta.rebuildPng(fixture('minimal.png'), preserved.chunks);
  const out = await exif.parse(rebuilt.bytes, { name: 'out.png' });
  assert.ok(out.exif);
  assert.equal(out.orientation, 1);
  assert.ok(out.png.text.length >= 4);
});

test('跨格式 XMP：PNG 源导出 JPEG，JPEG 源导出 PNG', async () => {
  const png = await exif.parse(fixture('nikon-z6.png'), { name: 'nikon-z6.png' });
  const built = exporter.buildJpegSegments(png, 320, 240);
  const injected = meta.injectJpegSegments(fixture('no-exif.jpg'), built.segments);
  const outJpeg = await exif.parse(injected.bytes, { name: 'out.jpg' });
  assert.ok(outJpeg.xmpParts.length > 0, 'PNG XMP 应写入 JPEG APP1');

  const jpeg = await exif.parse(fixture('canon-r5.jpg'), { name: 'canon-r5.jpg' });
  const preserved = exporter.pngPreservedChunks(jpeg, null, 800, 1200);
  const rebuilt = meta.rebuildPng(fixture('minimal.png'), preserved.chunks);
  const outPng = await exif.parse(rebuilt.bytes, { name: 'out.png' });
  assert.ok(outPng.exif, 'JPEG EXIF 应写入 PNG eXIf');
  assert.ok(outPng.xmpParts.length > 0, 'JPEG XMP 应写入 PNG iTXt');
});
