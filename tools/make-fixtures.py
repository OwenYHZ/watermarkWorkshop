#!/usr/bin/env python3
"""生成 EXIF 水印工具的测试样本（JPEG / PNG）。

用法（项目根目录）：
    python tools/make-fixtures.py

样本全部由本脚本合成，包含 IFD0 / Exif / GPS / IFD1 缩略图 / XMP / IPTC /
PNG eXIf、tEXt、zTXt、iTXt、pHYs 等，用于解析器与浏览器端到端测试。
"""

import io
import os
import struct
import zlib

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "fixtures")

TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8}


def pad_even(b):
    return b + (b"\x00" if len(b) % 2 else b"")


def ascii_e(tag, text, endian="<"):
    return (tag, 2, text.encode("utf-8") + b"\x00")


def undefined_e(tag, data):
    return (tag, 7, data)


def short_e(tag, values, endian="<"):
    if isinstance(values, int):
        values = [values]
    return (tag, 3, b"".join(struct.pack(endian + "H", v) for v in values))


def long_e(tag, values, endian="<"):
    if isinstance(values, int):
        values = [values]
    return (tag, 4, b"".join(struct.pack(endian + "I", v) for v in values))


def rational_e(tag, pairs, endian="<"):
    raw = b"".join(struct.pack(endian + "II", n, d) for n, d in pairs)
    return (tag, 5, raw)


def srational_e(tag, pairs, endian="<"):
    raw = b"".join(struct.pack(endian + "ii", n, d) for n, d in pairs)
    return (tag, 10, raw)


def plan_ifd(entries):
    layout = []
    datas = []
    data_size = 0
    for tag, typ, raw in entries:
        count = len(raw) // TYPE_SIZE[typ]
        if len(raw) <= 4:
            layout.append(("inline", tag, typ, count, raw))
        else:
            layout.append(("data", tag, typ, count, len(datas)))
            datas.append(raw)
            data_size += len(raw) + (len(raw) % 2)
    return layout, datas, data_size


def build_tiff(ifd0, exif_ifd, gps_ifd, interop_ifd, thumb_jpeg, endian="<"):
    ifd0 = list(ifd0)
    exif_ifd = list(exif_ifd or [])
    gps_ifd = list(gps_ifd or [])
    interop_ifd = list(interop_ifd or [])

    if interop_ifd:
        exif_ifd.append(long_e(0xA005, 0, endian))
    if gps_ifd:
        ifd0.append(long_e(0x8825, 0, endian))
    if exif_ifd:
        ifd0.append(long_e(0x8769, 0, endian))

    ifd1_entries = []
    if thumb_jpeg:
        ifd1_entries = [
            long_e(0x0201, 0, endian),
            long_e(0x0202, len(thumb_jpeg), endian),
            short_e(0x0103, 6, endian),
            rational_e(0x011A, [(72, 1)], endian),
            rational_e(0x011B, [(72, 1)], endian),
            short_e(0x0128, 2, endian),
        ]

    order = [("ifd0", ifd0), ("exif", exif_ifd), ("gps", gps_ifd), ("ifd1", ifd1_entries)]
    plans = {}
    sizes = {}
    for name, entries in order:
        layout, datas, data_size = plan_ifd(entries)
        plans[name] = (layout, datas)
        sizes[name] = (2 + 12 * len(entries) + 4, data_size)

    block_offsets = {}
    cursor = 8
    for name, _ in order:
        block_offsets[name] = cursor
        cursor += sizes[name][0]
    cursor = (cursor + 1) & ~1
    data_offsets = {}
    for name, _ in order:
        data_offsets[name] = cursor
        cursor += sizes[name][1]
    cursor = (cursor + 1) & ~1
    thumb_offset = cursor

    def get_pointer(entries, tag):
        for i, (t, typ, raw) in enumerate(entries):
            if t == tag:
                return i
        return None

    i = get_pointer(ifd0, 0x8769)
    if i is not None:
        ifd0[i] = long_e(0x8769, block_offsets["exif"], endian)
    i = get_pointer(ifd0, 0x8825)
    if i is not None:
        ifd0[i] = long_e(0x8825, block_offsets["gps"], endian)
    i = get_pointer(exif_ifd, 0xA005)
    if i is not None:
        exif_ifd[i] = long_e(0xA005, block_offsets["interop"], endian)
    i = get_pointer(ifd1_entries, 0x0201)
    if i is not None:
        ifd1_entries[i] = long_e(0x0201, thumb_offset, endian)

    # 指针替换后重新 plan，保证布局一致
    for name, entries in [("ifd0", ifd0), ("exif", exif_ifd), ("gps", gps_ifd), ("ifd1", ifd1_entries)]:
        layout, datas, _ = plan_ifd(entries)
        plans[name] = (layout, datas)

    blocks = {}
    for name, entries in [("ifd0", ifd0), ("exif", exif_ifd), ("gps", gps_ifd), ("ifd1", ifd1_entries)]:
        layout, datas = plans[name]
        next_offset = block_offsets["ifd1"] if name == "ifd0" else 0
        block = struct.pack(endian + "H", len(layout))
        data_cursor = 0
        data_area = b""
        for kind, tag, typ, count, info in layout:
            block += struct.pack(endian + "HHI", tag, typ, count)
            if kind == "inline":
                block += info + b"\x00" * (4 - len(info))
            else:
                data_offset = data_offsets[name] + data_cursor
                block += struct.pack(endian + "I", data_offset)
                raw = datas[info]
                data_area += pad_even(raw)
                data_cursor += len(raw) + (len(raw) % 2)
        block += struct.pack(endian + "I", next_offset)
        blocks[name] = block

    header = (b"II" if endian == "<" else b"MM") + struct.pack(endian + "H", 42) + struct.pack(endian + "I", 8)
    total = header + blocks["ifd0"] + blocks["exif"] + blocks["gps"] + blocks["ifd1"]
    total += b"\x00" * (data_offsets["ifd0"] - len(total))
    total += b"".join(pad_even(d) for d in plans["ifd0"][1])
    total += b"".join(pad_even(d) for d in plans["exif"][1])
    total += b"".join(pad_even(d) for d in plans["gps"][1])
    total += b"".join(pad_even(d) for d in plans["ifd1"][1])
    if thumb_jpeg:
        total += b"\x00" * (thumb_offset - len(total))
        total += thumb_jpeg
    return total


def jpeg_segment(marker, payload):
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


def insert_jpeg_segments(jpeg, segments):
    assert jpeg[:2] == b"\xff\xd8"
    return jpeg[:2] + b"".join(segments) + jpeg[2:]


XMP = """<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:tiff="http://ns.adobe.com/tiff/1.0/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmp:Rating="4"
    xmp:CreatorTool="WatermarkStudio Test"
    photoshop:City="Shanghai"
    photoshop:Country="China"
    photoshop:Credit="Local Test"
    tiff:Make="Canon"
    tiff:Model="Canon EOS R5"
    exif:DateTimeOriginal="2024-05-01T12:34:56+08:00"
    exif:GPSLatitude="30,16.205N"
    exif:GPSLongitude="120,7.510E">
    <dc:title><rdf:Alt><rdf:li xml:lang="x-default">The Bund at noon</rdf:li></rdf:Alt></dc:title>
    <dc:creator><rdf:Seq><rdf:li>Test Photographer</rdf:li></rdf:Seq></dc:creator>
    <dc:subject><rdf:Bag><rdf:li>Shanghai</rdf:li><rdf:li>Bund</rdf:li><rdf:li>test</rdf:li></rdf:Bag></dc:subject>
    <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2024 Test Photographer</rdf:li></rdf:Alt></dc:rights>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>""".encode("utf-8")


def iim_dataset(record, dataset, value):
    if isinstance(value, str):
        value = value.encode("utf-8")
    return bytes([0x1C, record, dataset]) + struct.pack(">H", len(value)) + value


def build_iptc():
    records = [
        iim_dataset(1, 90, b"\x1b%G"),  # UTF-8
        iim_dataset(2, 0, b"\x00\x04"),
        iim_dataset(2, 5, "外滩正午"),
        iim_dataset(2, 25, "Shanghai"),
        iim_dataset(2, 25, "Bund"),
        iim_dataset(2, 25, "水印测试"),
        iim_dataset(2, 80, "Test Photographer"),
        iim_dataset(2, 90, "Shanghai"),
        iim_dataset(2, 95, "Shanghai"),
        iim_dataset(2, 101, "China"),
        iim_dataset(2, 105, "The Bund at noon"),
        iim_dataset(2, 116, "© 2024 Test Photographer"),
        iim_dataset(2, 120, "测试用 IPTC 说明文字，用于验证中文解码。"),
    ]
    data = b"".join(records)
    name = b"\x00\x00"  # 空 Pascal 名，补齐到偶数
    block = b"8BIM" + struct.pack(">H", 0x0404) + name + struct.pack(">I", len(data)) + data
    if len(data) % 2:
        block += b"\x00"
    return b"Photoshop 3.0\x00" + block


def make_thumb(w=160, h=107):
    im = Image.new("RGB", (w, h), (40, 70, 110))
    d = ImageDraw.Draw(im)
    for x in range(w):
        for y in range(0, h, 8):
            d.point((x, y), fill=(200, 170, 90))
    d.text((8, 8), "THUMB", fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def make_canvas_jpeg(w, h, variant="canon"):
    im = Image.new("RGB", (w, h), (24, 32, 44))
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=(int(30 + 120 * t), int(60 + 90 * (1 - t)), int(120 + 80 * t)))
    d.ellipse((w * 0.15, h * 0.2, w * 0.45, h * 0.8), fill=(250, 200, 90))
    d.rectangle((w * 0.55, h * 0.3, w * 0.85, h * 0.7), fill=(30, 30, 30))
    d.text((20, h - 40), f"{variant.upper()} TEST IMAGE {w}x{h}", fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def canon_exif(thumb):
    ifd0 = [
        ascii_e(0x010F, "Canon"),
        ascii_e(0x0110, "Canon EOS R5"),
        short_e(0x0112, 6),
        rational_e(0x011A, [(300, 1)]),
        rational_e(0x011B, [(300, 1)]),
        short_e(0x0128, 2),
        ascii_e(0x0131, "WatermarkStudio Test 1.0"),
        ascii_e(0x0132, "2024:05:01 12:34:56"),
        ascii_e(0x013B, "Test Photographer"),
        ascii_e(0x8298, "© 2024 Test Photographer"),
        ascii_e(0x010E, "测试图像：外滩正午"),
        short_e(0x0100, 1200),
        short_e(0x0101, 800),
    ]
    exif_ifd = [
        rational_e(0x829A, [(1, 250)]),
        rational_e(0x829D, [(28, 10)]),
        short_e(0x8822, 3),
        short_e(0x8827, 400),
        undefined_e(0x9000, b"0232"),
        ascii_e(0x9003, "2024:05:01 12:34:56"),
        ascii_e(0x9004, "2024:05:01 12:34:57"),
        ascii_e(0x9010, "+08:00"),
        ascii_e(0x9011, "+08:00"),
        undefined_e(0x9101, b"\x01\x02\x03\x00"),
        srational_e(0x9201, [(7965784, 1000000)]),
        rational_e(0x9202, [(2970854, 1000000)]),
        srational_e(0x9203, [(-1234, 1000)]),
        srational_e(0x9204, [(1, 3)]),
        rational_e(0x9205, [(3, 1)]),
        rational_e(0x9206, [(425, 100)]),
        short_e(0x9207, 5),
        short_e(0x9208, 1),
        short_e(0x9209, 16),
        rational_e(0x920A, [(50, 1)]),
        short_e(0x9214, [600, 400, 200, 200]),
        ascii_e(0x9286, "ASCII\x00\x00\x00Hello 水印 world"),
        short_e(0xA001, 1),
        long_e(0xA002, 1200),
        long_e(0xA003, 800),
        short_e(0xA217, 2),
        undefined_e(0xA300, b"\x03"),
        undefined_e(0xA301, b"\x01"),
        short_e(0xA402, 1),
        short_e(0xA403, 0),
        rational_e(0xA404, [(1, 1)]),
        short_e(0xA405, 50),
        short_e(0xA406, 0),
        short_e(0xA407, 0),
        short_e(0xA408, 0),
        short_e(0xA409, 0),
        short_e(0xA40A, 0),
        ascii_e(0xA430, "Test Photographer"),
        ascii_e(0xA431, "SN-TEST-0001"),
        rational_e(0xA432, [(24, 1), (70, 1), (28, 10), (28, 10)]),
        ascii_e(0xA433, "Canon"),
        ascii_e(0xA434, "RF24-70mm F2.8 L IS USM"),
        ascii_e(0xA435, "LENS-TEST-0001"),
        ascii_e(0x9291, "123"),
        undefined_e(0x927C, b"CanonMakerNoteTest\x00\x01\x02\x03\x04"),
        undefined_e(0xA420, b"0123456789ABCDEF0123456789ABCDEF"),
        short_e(0xA460, 1),
    ]
    gps_ifd = [
        undefined_e(0x0000, b"\x02\x03\x00\x00"),
        ascii_e(0x0001, "N"),
        rational_e(0x0002, [(30, 1), (16, 1), (1234, 100)]),
        ascii_e(0x0003, "E"),
        rational_e(0x0004, [(120, 1), (7, 1), (3060, 100)]),
        undefined_e(0x0005, b"\x00"),
        rational_e(0x0006, [(40, 1)]),
        rational_e(0x0007, [(4, 1), (34, 1), (56, 1)]),
        ascii_e(0x0012, "WGS-84"),
        ascii_e(0x001D, "2024:05:01"),
        rational_e(0x0011, [(90, 1)]),
        ascii_e(0x0010, "T"),
        short_e(0x001E, 0),
        rational_e(0x001F, [(35, 10)]),
    ]
    return build_tiff(ifd0, exif_ifd, gps_ifd, None, thumb)


def png_chunk(chunk_type, data):
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)


def insert_png_chunks(png, chunks_before_idat):
    sig = png[:8]
    pos = 8
    insert_at = None
    while pos + 12 <= len(png):
        length = struct.unpack(">I", png[pos : pos + 4])[0]
        ctype = png[pos + 4 : pos + 8]
        if ctype in (b"IHDR", b"PLTE", b"IDAT"):
            if ctype == b"IDAT":
                insert_at = pos
                break
            pos += 12 + length
        else:
            pos += 12 + length
    if insert_at is None:
        return png
    return png[:insert_at] + b"".join(chunks_before_idat) + png[insert_at:]


def make_png_sample():
    im = Image.new("RGB", (800, 600), (20, 40, 30))
    d = ImageDraw.Draw(im)
    for x in range(0, 800, 40):
        d.rectangle((x, 0, x + 18, 600), fill=(40 + x % 120, 90, 60))
    d.text((30, 30), "NIKON PNG TEST", fill=(255, 255, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    png = buf.getvalue()

    tiff = build_tiff(
        [
            ascii_e(0x010F, "NIKON CORPORATION"),
            ascii_e(0x0110, "NIKON Z 6_2"),
            short_e(0x0112, 1),
            ascii_e(0x0131, "WatermarkStudio PNG Test"),
            ascii_e(0x0132, "2023:11:20 08:15:02"),
            ascii_e(0x013B, "PNG Photographer"),
        ],
        [
            rational_e(0x829A, [(1, 125)]),
            rational_e(0x829D, [(4, 1)]),
            short_e(0x8827, 2000),
            ascii_e(0x9003, "2023:11:20 08:15:02"),
            ascii_e(0x9011, "+08:00"),
            rational_e(0x920A, [(85, 1)]),
            short_e(0xA405, 85),
            ascii_e(0xA434, "NIKKOR Z 85mm f/1.8 S"),
            ascii_e(0xA433, "Nikon"),
        ],
        None,
        None,
        None,
    )

    xmp_png = """<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="5"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">PNG XMP 标题</rdf:li></rdf:Alt></dc:title><dc:subject><rdf:Bag><rdf:li>png</rdf:li><rdf:li>测试</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>""".encode("utf-8")

    chunks = [
        png_chunk(b"eXIf", tiff),
        png_chunk(b"pHYs", struct.pack(">IIB", 11811, 11811, 1)),
        png_chunk(b"tIME", struct.pack(">HBBBBB", 2023, 11, 20, 8, 15, 2)),
        png_chunk(b"tEXt", b"Software\x00WatermarkStudio PNG Writer"),
        png_chunk(b"tEXt", b"Comment\x00" + "普通 tEXt 注释（UTF-8 测试）".encode("utf-8")),
        png_chunk(b"zTXt", b"Description\x00\x00" + zlib.compress("压缩 zTXt 文本，包含中文与 EXIF 测试。".encode("utf-8"))),
        png_chunk(
            b"iTXt",
            b"XML:com.adobe.xmp\x00\x01\x00" + b"zh\x00" + "XMP 包".encode("utf-8") + b"\x00" + zlib.compress(xmp_png),
        ),
        png_chunk(b"iTXt", b"Author\x00\x00\x00" + b"en\x00" + b"PNG Photographer\x00" + "尼康样张".encode("utf-8")),
    ]
    return insert_png_chunks(png, chunks)


def make_plain_jpeg(w=640, h=420):
    im = Image.new("RGB", (w, h), (90, 80, 70))
    d = ImageDraw.Draw(im)
    for y in range(0, h, 20):
        d.line([(0, y), (w, y - 40)], fill=(130, 110, 90), width=3)
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def make_sony_orientation8():
    thumb = make_thumb(160, 107)
    ifd0 = [
        ascii_e(0x010F, "SONY"),
        ascii_e(0x0110, "ILCE-7M4"),
        short_e(0x0112, 8),
        ascii_e(0x0131, "WatermarkStudio Orientation Test"),
        ascii_e(0x0132, "2024:02:29 23:59:58"),
        short_e(0x0100, 1200),
        short_e(0x0101, 800),
    ]
    exif_ifd = [
        rational_e(0x829A, [(1, 60)]),
        rational_e(0x829D, [(18, 10)]),
        short_e(0x8827, 100),
        ascii_e(0x9003, "2024:02:29 23:59:58"),
        rational_e(0x920A, [(35, 1)]),
        ascii_e(0xA434, "FE 35mm F1.4 GM"),
        short_e(0xA405, 35),
    ]
    tiff = build_tiff(ifd0, exif_ifd, None, None, thumb)
    jpeg = make_canvas_jpeg(1200, 800, "sony")
    return insert_jpeg_segments(jpeg, [jpeg_segment(0xE1, b"Exif\x00\x00" + tiff)])


def make_broken_exif():
    jpeg = make_plain_jpeg()
    # 声明一个正常的 TIFF 头，但 IFD 偏移指向文件外
    bad_tiff = b"II*\x00" + struct.pack("<I", 0xFFFF0) + b"\x00" * 8
    return insert_jpeg_segments(jpeg, [jpeg_segment(0xE1, b"Exif\x00\x00" + bad_tiff)])


def main():
    os.makedirs(OUT, exist_ok=True)
    thumb = make_thumb()

    canon = make_canvas_jpeg(1200, 800, "canon")
    tiff = canon_exif(thumb)
    segments = [jpeg_segment(0xE1, b"Exif\x00\x00" + tiff)]
    segments.append(jpeg_segment(0xE1, b"http://ns.adobe.com/xap/1.0/\x00" + XMP))
    segments.append(jpeg_segment(0xED, build_iptc()))
    icc_path = os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "spool", "drivers", "color", "sRGB Color Space Profile.icm")
    icc_info = "absent"
    if os.path.exists(icc_path):
        with open(icc_path, "rb") as f:
            icc = f.read()
        chunk_size = 65519
        parts = [icc[i : i + chunk_size] for i in range(0, len(icc), chunk_size)]
        for idx, part in enumerate(parts):
            payload = b"ICC_PROFILE\x00" + bytes([idx + 1, len(parts)]) + part
            segments.append(jpeg_segment(0xE2, payload))
        icc_info = f"{len(icc)} bytes / {len(parts)} chunk(s)"
    with open(os.path.join(OUT, "canon-r5.jpg"), "wb") as f:
        f.write(insert_jpeg_segments(canon, segments))

    with open(os.path.join(OUT, "nikon-z6.png"), "wb") as f:
        f.write(make_png_sample())

    with open(os.path.join(OUT, "sony-orientation8.jpg"), "wb") as f:
        f.write(make_sony_orientation8())

    with open(os.path.join(OUT, "no-exif.jpg"), "wb") as f:
        f.write(make_plain_jpeg())

    im = Image.new("RGB", (320, 240), (200, 60, 60))
    d = ImageDraw.Draw(im)
    d.text((10, 10), "MINIMAL PNG", fill=(255, 255, 255))
    im.save(os.path.join(OUT, "minimal.png"))

    with open(os.path.join(OUT, "broken-exif.jpg"), "wb") as f:
        f.write(make_broken_exif())

    # 大图（性能与 canvas 上限测试），仅生成一次
    big_path = os.path.join(OUT, "huge.jpg")
    if not os.path.exists(big_path):
        big = Image.new("RGB", (4000, 3000), (20, 30, 50))
        d = ImageDraw.Draw(big)
        for y in range(0, 3000, 120):
            d.line([(0, y), (4000, y)], fill=(60, 90, 140), width=4)
        big.save(big_path, format="JPEG", quality=85)

    print("fixtures written to", OUT)
    print("  canon-r5.jpg           EXIF+GPS+XMP+IPTC+thumbnail, ICC:", icc_info)
    print("  nikon-z6.png           eXIf+tEXt+zTXt+iTXt+pHYs+tIME")
    print("  sony-orientation8.jpg  orientation=8")
    print("  no-exif.jpg            plain JPEG")
    print("  minimal.png            plain PNG")
    print("  broken-exif.jpg        invalid IFD offset")
    print("  huge.jpg               4000x3000")


if __name__ == "__main__":
    main()
