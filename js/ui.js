/*!
 * ui.js — 界面装配、拖拽、EXIF 面板、实时预览、参数控件与导出
 */
(function () {
  'use strict';

  var WM = window.WM;
  var state = WM.state;
  var tags = WM.tags;
  var meta = WM.meta;
  var brands = WM.brands;
  var layout = WM.layout;
  var render = WM.render;
  var exporter = WM.export;

  var PREVIEW_MAX = 1700;
  var settings = state.loadSettings();
  var themeMode = 'system';
  var themeMedia = null;

  var app = {
    files: [],
    activeId: null,
    logos: [],
    presets: [],
    logoImageCache: {},
    exporting: false,
    cancelExport: false,
    compareOriginal: false,
    previewToken: 0,
    raf: 0,
    lastScene: null,
    ctrlRefs: [],
    sectionRefs: {},
    exifView: null,
    exifShowAll: false,
    previewZoom: 1,
    previewFit: { w: 0, h: 0 },
    mockAspect: 1.5,
    zoomRaf: 0,
    panelWidths: { left: 336, right: 378 },
    panelApplied: { left: 336, right: 378 },
    modalOnClose: null
  };

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */
  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $id(id) {
    return document.getElementById(id);
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function baseName(name) {
    return String(name || '').replace(/\.[^.]+$/, '');
  }

  function humanSize(n) {
    return meta.formatBytes(n);
  }

  function updateThemeSwitch() {
    var buttons = document.querySelectorAll('#theme-switch button');
    Array.prototype.forEach.call(buttons, function (btn) {
      var active = btn.dataset.themeMode === themeMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function resolveTheme(mode) {
    if (mode === 'system') {
      return themeMedia && themeMedia.matches ? 'dark' : 'light';
    }
    return mode === 'dark' ? 'dark' : 'light';
  }

  function applyThemeMode(mode, persist) {
    themeMode = ['dark', 'light', 'system'].indexOf(mode) >= 0 ? mode : 'system';
    var resolved = resolveTheme(themeMode);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    updateThemeSwitch();
    if (persist !== false) state.saveThemeMode(themeMode);
  }

  function initTheme() {
    themeMode = state.loadThemeMode();
    if (window.matchMedia) {
      themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
      if (themeMedia.addEventListener) {
        themeMedia.addEventListener('change', function () {
          if (themeMode === 'system') applyThemeMode('system', false);
        });
      } else if (themeMedia.addListener) {
        themeMedia.addListener(function () {
          if (themeMode === 'system') applyThemeMode('system', false);
        });
      }
    }
    var buttons = document.querySelectorAll('#theme-switch button');
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener('click', function () {
        applyThemeMode(btn.dataset.themeMode, true);
      });
    });
    applyThemeMode(themeMode, false);
  }

  function applyPhotoTheme(photo) {
    var theme = render.sampleThemeColor(photo);
    document.documentElement.style.setProperty('--photo-h', String(theme.h));
    document.documentElement.style.setProperty('--photo-s', Math.round(theme.s * 100) + '%');
  }

  function getPath(obj, path) {
    return path.split('.').reduce(function (o, key) { return o == null ? undefined : o[key]; }, obj);
  }

  function setPath(obj, path, value) {
    var keys = path.split('.');
    var cur = obj;
    for (var i = 0; i < keys.length - 1; i++) {
      if (!cur[keys[i]] || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;
  }

  function activeFile() {
    return app.files.find(function (f) { return f.id === app.activeId; }) || null;
  }

  function templateName(id) {
    if (!id) return '无模板';
    var t = state.TEMPLATES.find(function (x) { return x.id === id; });
    return t ? t.name : id;
  }

  var toastTimer = null;
  function showToast(message, type) {
    var node = $id('toast');
    node.textContent = message;
    node.className = 'toast show' + (type ? ' ' + type : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      node.className = 'toast' + (type ? ' ' + type : '');
    }, 3200);
  }

  /* ------------------------------------------------------------------ *
   * 模态框与进度
   * ------------------------------------------------------------------ */
  function closeModal() {
    $id('modal').hidden = true;
    if (app.modalOnClose) {
      var fn = app.modalOnClose;
      app.modalOnClose = null;
      fn();
    }
  }

  function openModal(opts) {
    opts = opts || {};
    $id('modal-title').textContent = opts.title || '';
    var body = $id('modal-body');
    body.textContent = '';
    if (typeof opts.body === 'string') {
      body.appendChild(el('p', null, opts.body));
    } else if (opts.body) {
      body.appendChild(opts.body);
    }
    var actions = $id('modal-actions');
    actions.textContent = '';
    (opts.actions || []).forEach(function (action) {
      var btn = el('button', 'btn' + (action.primary ? ' btn-primary' : ''), action.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        var close = true;
        if (action.onClick) close = action.onClick() !== false;
        if (close) closeModal();
      });
      actions.appendChild(btn);
    });
    app.modalOnClose = opts.onClose || null;
    $id('modal').hidden = false;
    window.setTimeout(function () {
      var focusable = $id('modal-body').querySelector('input, textarea, button');
      if (focusable) focusable.focus();
    }, 30);
  }

  function promptDialog(title, message, defaultValue) {
    return new Promise(function (resolve) {
      var wrap = el('div');
      wrap.appendChild(el('p', null, message));
      var input = el('input', 'input');
      input.type = 'text';
      input.value = defaultValue || '';
      wrap.appendChild(input);
      openModal({
        title: title,
        body: wrap,
        onClose: function () { resolve(null); },
        actions: [
          { label: '取消', onClick: function () { resolve(null); } },
          { label: '确定', primary: true, onClick: function () { resolve(input.value); } }
        ]
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          resolve(input.value);
          closeModal();
        }
      });
    });
  }

  function showProgress(title, total) {
    $id('progress-title').textContent = title || '处理中…';
    $id('progress-percent').textContent = '0%';
    $id('progress-fill').style.width = '0%';
    $id('progress-text').textContent = total ? '0 / ' + total : '';
    $id('btn-cancel').hidden = false;
    $id('progress').hidden = false;
  }

  function updateProgress(done, total, text) {
    var pct = total ? Math.round(done / total * 100) : 0;
    $id('progress-percent').textContent = pct + '%';
    $id('progress-fill').style.width = pct + '%';
    $id('progress-text').textContent = text || (done + ' / ' + total);
  }

  function hideProgress() {
    $id('progress').hidden = true;
    $id('progress-fill').style.width = '0%';
  }

  function decodeBitmap(blob) {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob, { imageOrientation: 'none' }).catch(function () {
        return createImageBitmap(blob);
      });
    }
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(blob);
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('图片解码失败'));
      };
      img.src = url;
    });
  }

  function rawPixelSize(parsed) {
    if (!parsed) return { width: 0, height: 0 };
    if (parsed.format === 'jpeg' && parsed.jpeg && parsed.jpeg.sof) {
      return { width: parsed.jpeg.sof.width, height: parsed.jpeg.sof.height };
    }
    if (parsed.format === 'png' && parsed.png && parsed.png.ihdr) {
      return { width: parsed.png.ihdr.width, height: parsed.png.ihdr.height };
    }
    if (parsed.dimensions && parsed.dimensions.width) {
      return { width: parsed.dimensions.width, height: parsed.dimensions.height };
    }
    return { width: 0, height: 0 };
  }

  async function loadFile(file) {
    var bytes = new Uint8Array(await file.arrayBuffer());
    var parsed = await WM.exif.parse(bytes, {
      name: file.name,
      type: file.type,
      lastModified: file.lastModified
    });
    if (parsed.format === 'unknown') throw new Error('不是有效的 JPG / PNG 文件');
    var report = meta.buildReport(parsed);
    var blob = file.slice ? file.slice(0, file.size, file.type || 'image/jpeg') : new Blob([bytes], { type: 'image/jpeg' });
    var bitmap = await decodeBitmap(blob);
    var rawSize = rawPixelSize(parsed);
    var evaluated = render.displaySize(bitmap, parsed.orientation, rawSize.width, rawSize.height);
    var scale = Math.min(1, PREVIEW_MAX / Math.max(evaluated.width, evaluated.height));
    var previewW = Math.max(1, Math.round(evaluated.width * scale));
    var previewH = Math.max(1, Math.round(evaluated.height * scale));
    var previewPhoto = render.normalizePhoto(bitmap, parsed.orientation, rawSize.width, rawSize.height, previewW, previewH);
    var luminance = render.sampleLuminance(previewPhoto);
    if (bitmap.close) bitmap.close();
    var rec = {
      id: 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      name: file.name,
      size: file.size,
      type: file.type || parsed.file.type,
      blob: blob,
      bytes: null,
      parsed: parsed,
      report: report,
      previewPhoto: previewPhoto,
      luminance: luminance,
      fullW: evaluated.width,
      fullH: evaluated.height,
      thumbUrl: URL.createObjectURL(blob),
      remoteLocation: '',
      edits: { fields: {}, rows: {} },
      addedAt: Date.now()
    };
    return rec;
  }

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return /^image\/(jpeg|png)$/i.test(f.type || '') || /\.(jpe?g|png)$/i.test(f.name || '');
    });
    if (!files.length) {
      showToast('只支持 JPG / PNG 图片', 'warn');
      return;
    }
    if (files.length > 20) {
      showToast('一次最多载入 20 张图片', 'warn');
      files = files.slice(0, 20);
    }
    if (app.files.length + files.length > 8) {
      showToast('同时载入较多图片会占用内存，建议导出后移除', 'warn');
    }
    var added = 0;
    var lastAddedId = null;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.size > 150 * 1024 * 1024) {
        showToast(file.name + '：超过 150MB，已跳过', 'warn');
        continue;
      }
      if (file.size > 60 * 1024 * 1024) {
        showToast(file.name + '：文件较大，解析与导出可能需要更久', 'warn');
      }
      try {
        setStatus('读取 ' + file.name + '…');
        var rec = await loadFile(file);
        app.files.push(rec);
        added++;
        lastAddedId = rec.id;
      } catch (e) {
        if (window.console) console.error('[WM] load', file.name, e);
        showToast(file.name + '：' + e.message, 'error');
      }
    }
    if (added) {
      app.activeId = lastAddedId;
      renderFileList();
      selectFile(app.activeId);
      renderFileList();
      showToast('已载入 ' + added + ' 张图片');
    } else {
      setStatus('');
    }
  }

  function removeFile(id) {
    var idx = app.files.findIndex(function (f) { return f.id === id; });
    if (idx < 0) return;
    var rec = app.files[idx];
    try { URL.revokeObjectURL(rec.thumbUrl); } catch (e) { /* ignore */ }
    app.files.splice(idx, 1);
    if (app.activeId === id) {
      app.activeId = app.files.length ? app.files[Math.max(0, idx - 1)].id : null;
    }
    renderFileList();
    if (app.activeId) {
      selectFile(app.activeId);
    } else {
      renderActivePhoto();
      $id('preview').hidden = true;
      $id('empty-state').hidden = false;
      renderExif();
      updateExifActions();
      updateExportButtons();
      setStatus('');
    }
  }

  function selectFile(id) {
    app.activeId = id;
    app.previewZoom = 1;
    app.previewFit = { w: 0, h: 0 };
    renderActivePhoto();
    renderFileList();
    renderExif({ resetView: true });
    updateExifActions();
    updateExportButtons();
    schedulePreview();
  }

  function renderActivePhoto() {
    var file = activeFile();
    var backdrop = $id('photo-backdrop');
    if (!file) {
      if (backdrop) backdrop.style.backgroundImage = '';
      document.body.classList.remove('has-photo');
      return;
    }
    if (backdrop) backdrop.style.backgroundImage = 'url("' + file.thumbUrl + '")';
    document.body.classList.add('has-photo');
  }


  function updateFileCount() {
    var node = $id('file-count');
    if (node) node.textContent = String(app.files.length);
    var dockGallery = document.querySelector('.dock-gallery');
    if (dockGallery) dockGallery.dataset.count = String(app.files.length);
  }

  function renderFileList() {
    var host = $id('bottom-gallery');
    if (!host) return;
    host.textContent = '';
    updateFileCount();
    host.classList.toggle('is-empty', !app.files.length);
    if (!app.files.length) {
      var emptyBtn = el('button', 'gallery-empty', '还没有图片 · 拖入 / 点击选择 / Ctrl+V');
      emptyBtn.type = 'button';
      emptyBtn.addEventListener('click', openFilePicker);
      host.appendChild(emptyBtn);
    } else {
      app.files.forEach(function (f) {
        var card = el('div', 'file-card' + (f.id === app.activeId ? ' active' : ''));
        card.dataset.name = f.name;
        card.title = f.name;
        card.tabIndex = 0;
        var img = document.createElement('img');
        img.src = f.thumbUrl;
        img.alt = f.name;
        img.draggable = false;
        card.draggable = false;
        card.appendChild(img);
        if (f.edits && (Object.keys(f.edits.fields).length || Object.keys(f.edits.rows).length)) {
          var badge = el('span', 'fc-badge', '已修改');
          badge.title = '已修改';
          card.appendChild(badge);
        }
        var remove = el('button', 'fc-x', '×');
        remove.type = 'button';
        remove.title = '移除';
        remove.addEventListener('click', function (e) {
          e.stopPropagation();
          removeFile(f.id);
        });
        card.appendChild(remove);
        card.addEventListener('click', function () { selectFile(f.id); });
        card.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectFile(f.id);
          }
        });
        host.appendChild(card);
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * EXIF 面板
   * ------------------------------------------------------------------ */
  function fieldForRow(row) {
    var name = String(row && row.name || '');
    var bare = name.replace(/^[A-Za-z][\w.-]*:/, '');
    var map = {
      Make: 'make', Model: 'model', LensModel: 'lens', Lens: 'lens',
      LensMake: 'lensMake', LensSerialNumber: 'lensSerial',
      BodySerialNumber: 'serial', ImageDescription: 'description',
      FNumber: 'aperture', ExposureTime: 'shutter',
      ISOSpeedRatings: 'iso', PhotographicSensitivity: 'iso', ISOSpeed: 'iso',
      RecommendedExposureIndex: 'iso', StandardOutputSensitivity: 'iso',
      FocalLength: 'focal', FocalLengthIn35mmFilm: 'focal35',
      DateTimeOriginal: 'datetime', DateTimeDigitized: 'datetime', DateTime: 'datetime',
      DateCreated: 'datetime', OffsetTimeOriginal: 'offset', OffsetTime: 'offset',
      GPSLatitude: 'lat', GPSLongitude: 'lon', GPSAltitude: 'alt',
      Artist: 'artist', Copyright: 'copyright', Software: 'software'
    };
    return map[bare] || '';
  }

  function isRowEditable(row) {
    if (!row || row.url) return false;
    if (fieldForRow(row)) return true;
    var text = String(row.value || '');
    if (text.length > 260 || /^\d+\s*(字节|bytes?)/i.test(text)) return false;
    if (row.tag) return true;
    if (row.name && row.name.indexOf(':') >= 0) return true;
    return false;
  }

  function rowIdentity(group, row, index) {
    return [group.id, row.source || '', row.tag || '', row.name || '', index].join('|');
  }

  function hasEdits(file) {
    return !!(file && file.edits && (Object.keys(file.edits.fields).length || Object.keys(file.edits.rows).length));
  }

  function updateExifActions() {
    var file = activeFile();
    var btn = $id('btn-reset-exif');
    if (btn) btn.disabled = !file || !hasEdits(file);
  }

  function captureExifView() {
    var body = $id('exif-body');
    if (!body) return;
    var open = {};
    var groups = body.querySelectorAll('.exif-group');
    Array.prototype.forEach.call(groups, function (g) {
      open[g.dataset.group || ''] = g.open;
    });
    app.exifView = { open: open, scrollTop: body.scrollTop };
  }

  function beginExifEdit(row, field, rowKey, valueEl) {
    var file = activeFile();
    if (!file || valueEl.querySelector('.exif-edit-input')) return;
    var previous = row.value || '';
    var input = document.createElement('input');
    input.className = 'exif-edit-input';
    input.type = 'text';
    input.value = previous;
    input.maxLength = 500;
    valueEl.textContent = '';
    valueEl.appendChild(input);
    input.focus();
    input.select();
    var done = false;

    function finish(commit, keepOnError) {
      if (done) return;
      var text = input.value;
      if (commit) {
        if (field) {
          var edit = meta.applyFieldEdit(file.report.summary, field, text);
          if (!edit.ok) {
            showToast(edit.error, 'warn');
            if (keepOnError) { input.focus(); return; }
            renderExif();
            return;
          }
          file.edits.fields[field] = { text: text, display: edit.display };
          file.report.groups.forEach(function (g) {
            g.rows.forEach(function (r) {
              if (fieldForRow(r) === field) {
                r.value = edit.display || '';
                r.edited = true;
              } else if (field === 'make' && fieldForRow(r) === 'model') {
                r.value = file.report.summary.model || '';
                r.edited = true;
              }
            });
          });
        } else {
          row.value = text;
          row.edited = true;
          file.edits.rows[rowKey] = { text: text };
        }
        done = true;
        updateExifActions();
        renderExif();
        renderActivePhoto();
        renderFileList();
        schedulePreview();
        if (field) showToast('已更新：' + (row.name || field));
      } else {
        done = true;
        renderExif();
      }
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true, true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false, false);
      }
    });
    input.addEventListener('blur', function () {
      if (!done) finish(true, false);
    });
  }

  /* 常用模式：按分组固定列出全部可上水印字段，全部可编辑（与有无 EXIF 无关）。 */
  function renderWatermarkFields(file) {
    var body = $id('exif-body');
    var summary = file.report.summary || {};
    var fields = meta.WATERMARK_FIELDS || [];
    var groups = meta.WATERMARK_GROUPS || [];

    groups.forEach(function (group) {
      var defs = fields.filter(function (def) { return def.group === group.id; });
      if (!defs.length) return;
      var details = document.createElement('details');
      details.className = 'exif-group watermark-fields';
      details.dataset.group = 'wm-' + group.id;
      details.open = app.exifView && app.exifView.open['wm-' + group.id] != null
        ? app.exifView.open['wm-' + group.id]
        : true;
      var groupSummary = document.createElement('summary');
      groupSummary.appendChild(el('span', null, group.title));
      groupSummary.appendChild(el('span', 'badge', String(defs.length)));
      details.appendChild(groupSummary);

      defs.forEach(function (def) {
        var field = def.field;
        var display = meta.formatFieldDisplay(field, summary);
        var edited = !!(file.edits && file.edits.fields && file.edits.fields[field]);
        var row = { name: def.label, value: display, source: 'EXIF' };
        var rowEl = el('div', 'exif-row');
        rowEl.dataset.field = field;
        rowEl.dataset.search = [def.label, def.cn, field, display].join(' ').toLowerCase();
        if (edited) rowEl.classList.add('edited');
        var nameEl = el('div', 'exif-name');
        nameEl.appendChild(document.createTextNode(def.label));
        nameEl.appendChild(el('small', null, def.cn));
        var valueEl = el('div', 'exif-value');
        if (display) {
          valueEl.appendChild(document.createTextNode(display));
        } else {
          valueEl.classList.add('is-empty');
          valueEl.appendChild(el('span', 'exif-empty', '未填'));
        }
        if (edited && display) valueEl.appendChild(el('span', 'exif-edited-dot'));
        valueEl.classList.add('editable');
        valueEl.title = '双击修改或填入（仅影响水印与界面）';
        valueEl.addEventListener('dblclick', function (e) {
          e.preventDefault();
          e.stopPropagation();
          beginExifEdit(row, field, 'watermark|' + field, valueEl);
        });
        rowEl.appendChild(nameEl);
        rowEl.appendChild(valueEl);
        details.appendChild(rowEl);
      });
      body.appendChild(details);
    });
  }

  /* 全部模式：原分组全量列出，只读。 */
  function renderRawGroups(file) {
    var body = $id('exif-body');
    file.report.groups.forEach(function (group) {
      var details = document.createElement('details');
      details.className = 'exif-group' + (group.id === 'warn' ? ' warn' : '');
      details.dataset.group = group.id;
      details.open = app.exifView && app.exifView.open[group.id] != null
        ? app.exifView.open[group.id]
        : true;
      var groupSummary = document.createElement('summary');
      groupSummary.appendChild(el('span', null, group.title));
      groupSummary.appendChild(el('span', 'badge', String(group.rows.length)));
      details.appendChild(groupSummary);

      group.rows.forEach(function (row, rowIndex) {
        var rowEl = el('div', 'exif-row');
        var field = fieldForRow(row);
        rowEl.dataset.search = [row.name, row.value, row.note, row.tag, row.source]
          .filter(Boolean).join(' ').toLowerCase();
        rowEl.dataset.vis = 'all';
        if (row.edited) rowEl.classList.add('edited');
        if (field) rowEl.dataset.field = field;
        var nameEl = el('div', 'exif-name');
        nameEl.appendChild(document.createTextNode(row.name));
        if (row.cn && row.cn !== row.name) nameEl.appendChild(el('small', null, row.cn));
        if (row.source) nameEl.appendChild(el('small', null, row.source + (row.tag ? ' · ' + row.tag : '')));
        var valueEl = el('div', 'exif-value');
        if (row.url) {
          var a = document.createElement('a');
          a.href = row.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = row.value;
          valueEl.appendChild(a);
        } else {
          valueEl.appendChild(document.createTextNode(row.value || '—'));
        }
        if (row.note) valueEl.appendChild(el('span', 'exif-note', row.note));
        rowEl.appendChild(nameEl);
        rowEl.appendChild(valueEl);
        details.appendChild(rowEl);
      });
      body.appendChild(details);
    });
  }

  function renderExif(options) {
    var body = $id('exif-body');
    var file = activeFile();
    if (!file) {
      body.textContent = '';
      body.appendChild(el('div', 'placeholder', '载入图片后可在这里填写水印字段'));
      updateExifActions();
      return;
    }
    if (options && options.resetView) app.exifView = null;
    else captureExifView();
    body.textContent = '';
    if (app.exifShowAll) renderRawGroups(file);
    else renderWatermarkFields(file);
    if (app.exifView) body.scrollTop = app.exifView.scrollTop || 0;
    else body.scrollTop = 0;
    if ($id('exif-search').value.trim()) filterExif();
    updateExifActions();
  }

  function resetExifEdits() {
    var file = activeFile();
    if (!file || !hasEdits(file)) return;
    file.edits = { fields: {}, rows: {} };
    file.report = meta.buildReport(file.parsed);
    renderExif();
    renderActivePhoto();
    renderFileList();
    updateExifActions();
    schedulePreview();
    showToast('已恢复当前图片的原始元数据');
  }

  function filterExif() {
    var q = $id('exif-search').value.trim().toLowerCase();
    var groups = document.querySelectorAll('#exif-body .exif-group');
    Array.prototype.forEach.call(groups, function (group) {
      var any = false;
      var rows = group.querySelectorAll('.exif-row');
      Array.prototype.forEach.call(rows, function (row) {
        var show = !q || (row.dataset.search || '').indexOf(q) >= 0;
        row.hidden = !show;
        if (show) any = true;
      });
      // 常用模式下固定只有一张卡，空查询时始终显示
      group.hidden = q ? !any : false;
      if (q && any) group.open = true;
    });
  }

  function updateExifScopeButton() {
    var btn = $id('btn-exif-all');
    if (!btn) return;
    btn.textContent = app.exifShowAll ? '只看常用' : '显示全部';
    btn.setAttribute('aria-pressed', app.exifShowAll ? 'true' : 'false');
    btn.title = app.exifShowAll ? '切换为只显示常用字段' : '显示全部 EXIF / XMP / IPTC / ICC 字段';
  }

  function toggleExifScope() {
    app.exifShowAll = !app.exifShowAll;
    state.saveExifShowAll(app.exifShowAll);
    updateExifScopeButton();
    renderExif();
  }

  /* ------------------------------------------------------------------ *
   * 品牌与 logo
   * ------------------------------------------------------------------ */
  function currentBrand(summary) {
    if (settings.logo.brandId && settings.logo.brandId !== 'auto') {
      var picked = brands.get(settings.logo.brandId);
      if (picked) return picked;
    }
    return brands.resolve('auto', summary || {});
  }

  function customLogo() {
    if (!settings.logo.customLogoId) return app.logos[0] || null;
    return app.logos.find(function (l) { return l.id === settings.logo.customLogoId; }) || app.logos[0] || null;
  }

  function getLogoImage(logo) {
    if (!logo) return Promise.resolve(null);
    if (app.logoImageCache[logo.id]) return app.logoImageCache[logo.id];
    var promise = new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('logo 图片解码失败')); };
      img.src = logo.dataUrl;
    });
    app.logoImageCache[logo.id] = promise;
    return promise;
  }

  function logoAspectFor(summary) {
    if (settings.logo.source === 'brand') {
      return brands.getAspect(currentBrand(summary), { variant: 'light' });
    }
    if (settings.logo.source === 'custom') {
      var logo = customLogo();
      if (logo && logo.width && logo.height) return logo.width / logo.height;
    }
    return 3;
  }

  function logoEnabled(summary) {
    if (settings.logo.source === 'none') return false;
    if (settings.logo.source === 'brand') return true;
    return !!customLogo();
  }

  function sceneNeededLogoHeight(scene) {
    var h = 0;
    (scene.ops || []).forEach(function (op) {
      if (op.kind === 'image' && op.role === 'logo') h = Math.max(h, op.h);
    });
    return h;
  }

  async function buildLogoAsset(scene, summary, scale) {
    if (!logoEnabled(summary)) return null;
    var needed = sceneNeededLogoHeight(scene);
    if (needed <= 0) return null;
    var target = Math.max(24, Math.round(needed * (scale || 2)));
    if (settings.logo.source === 'brand') {
      var built = brands.toCanvas(currentBrand(summary), { height: target, variant: scene.logoVariant });
      return built ? built.canvas : null;
    }
    var logo = customLogo();
    if (!logo) return null;
    try {
      var img = await getLogoImage(logo);
      var w = Math.max(1, Math.round(target * (logo.width && logo.height ? logo.width / logo.height : img.width / img.height)));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = target;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, target);
      return canvas;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------ *
   * 预览
   * ------------------------------------------------------------------ */
  function schedulePreview() {
    if (app.raf) cancelAnimationFrame(app.raf);
    app.raf = requestAnimationFrame(function () {
      app.raf = 0;
      renderPreviewSafely();
    });
  }

  async function renderPreviewSafely() {
    try {
      await renderPreview();
    } catch (e) {
      setStatus('渲染失败：' + e.message);
    }
  }

  function previewDateFormatter() {
    return {
      date: function (dateParts) {
        var style = settings.template === 'dv-cam' ? settings.dv.dateStyle : settings.content.dateStyle;
        return meta.formatDateStyle(dateParts, style, { weekday: settings.content.showWeekday });
      },
      time: function (dateParts) {
        var style = settings.template === 'dv-cam' ? settings.dv.timeStyle : settings.content.timeStyle;
        return meta.formatTimeStyle(dateParts, style, { offset: settings.content.showOffset });
      }
    };
  }

  async function renderPreview() {
    var file = activeFile();
    var canvas = $id('preview');
    var empty = $id('empty-state');
    if (!file) {
      canvas.hidden = true;
      empty.hidden = false;
      applyPhotoTheme(null);
      renderMockPreview();
      applyEmptyFit();
      $id('preview-dims').textContent = '—';
      $id('preview-brand').textContent = '';
      $id('preview-template').textContent = templateName(settings.template);
      updateExportButtons();
      return;
    }
    empty.hidden = true;
    canvas.hidden = false;
    applyPhotoTheme(file.previewPhoto);
    var token = ++app.previewToken;
    var summary = file.report.summary;
    var brand = currentBrand(summary);
    var enabled = logoEnabled(summary);
    var aspect = logoAspectFor(summary);
    var fmt = previewDateFormatter();
    var scene = layout.compose({
      imageW: file.previewPhoto.width,
      imageH: file.previewPhoto.height,
      meta: summary,
      settings: settings,
      brandName: brand.name,
      logoAspect: aspect,
      logoEnabled: enabled,
      luminance: file.luminance,
      remoteLocation: file.remoteLocation,
      formatDateOnly: fmt.date,
      formatTimeOnly: fmt.time
    });
    if (token !== app.previewToken) return;
    var logoAsset = null;
    if (enabled) {
      logoAsset = await buildLogoAsset(scene, summary, 2);
      if (token !== app.previewToken) return;
    }
    var started = performance.now();
    if (app.compareOriginal) {
      canvas.width = scene.output.w;
      canvas.height = scene.output.h;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = settings.output.flattenColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(file.previewPhoto, scene.imageRect.x, scene.imageRect.y, scene.imageRect.w, scene.imageRect.h);
    } else {
      render.draw(canvas, scene, { photo: file.previewPhoto, logo: logoAsset });
    }
    app.lastScene = scene;
    var ms = Math.round(performance.now() - started);
    $id('preview-template').textContent = templateName(settings.template);
    $id('preview-brand').textContent = brand.name + (settings.logo.brandId === 'auto' && settings.logo.source === 'brand' ? ' · 自动识别' : '');
    $id('preview-dims').textContent = file.fullW + ' × ' + file.fullH + ' px · ' + humanSize(file.size) +
      (summary.metaSource ? ' · ' + summary.metaSource : '');
    setStatus('已渲染 ' + ms + ' ms' + (file.parsed.warnings.length ? ' · ' + file.parsed.warnings.length + ' 条警告' : ''));
    updateBrandPreview(brand, aspect);
    updateExportSummary();
    app.previewFit = { w: 0, h: 0 };
    measurePreviewFit();
    applyPreviewZoom();
  }

  async function updateBrandPreview(brand, aspect) {
    var host = $id('brand-preview');
    if (!host) return;
    host.textContent = '';
    if (settings.logo.source === 'none') {
      host.appendChild(el('span', 'muted small', '不显示徽标'));
      return;
    }
    var canvas = document.createElement('canvas');
    if (settings.logo.source === 'brand') {
      var built = brands.toCanvas(brand, { height: 92, variant: 'brand' });
      if (!built) return;
      canvas.width = built.canvas.width;
      canvas.height = built.canvas.height;
      canvas.getContext('2d').drawImage(built.canvas, 0, 0);
    } else {
      var logo = customLogo();
      if (!logo) {
        host.appendChild(el('span', 'muted small', '尚未导入自定义 logo'));
        return;
      }
      try {
        var img = await getLogoImage(logo);
        var h = 80;
        var w = Math.max(1, Math.round(h * (logo.width && logo.height ? logo.width / logo.height : img.width / img.height)));
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        host.dataset.logoId = logo.id;
      } catch (e) {
        host.appendChild(el('span', 'muted small', 'logo 显示失败'));
        return;
      }
    }
    canvas.style.height = '36px';
    canvas.style.width = 'auto';
    canvas.style.maxWidth = '96%';
    host.appendChild(canvas);
  }

  function setStatus(text) {
    $id('preview-status').textContent = text || '';
  }

  /* ------------------------------------------------------------------ *
   * 预览缩放：− / ◯(自适应) / +，最大值即自适应
   * ------------------------------------------------------------------ */
  var ZOOM_MIN = 0.25;
  var ZOOM_STEP = 0.1;

  function measurePreviewFit() {
    var canvas = $id('preview');
    if (!canvas || canvas.hidden) return;
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = '100%';
    var rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      app.previewFit = { w: rect.width, h: rect.height };
    }
  }

  function applyPreviewZoom() {
    var canvas = $id('preview');
    if (!canvas || !activeFile()) return;
    if (!app.previewFit.w || !app.previewFit.h) measurePreviewFit();
    var w = Math.max(1, Math.round(app.previewFit.w * app.previewZoom));
    var h = Math.max(1, Math.round(app.previewFit.h * app.previewZoom));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.maxWidth = 'none';
    canvas.style.maxHeight = 'none';
  }

  function setPreviewZoom(value) {
    var next = Math.min(1, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
    app.previewZoom = next;
    applyPreviewZoom();
  }

  /* 无图状态：3:2 磨砂方块按舞台自适应 */
  function applyEmptyFit() {
    var stage = $id('stage');
    var box = $id('empty-state');
    if (!stage || !box || box.hidden) return;
    var style = getComputedStyle(stage);
    var padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    var padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    var availW = stage.clientWidth - padX;
    var availH = stage.clientHeight - padY;
    if (availW <= 0 || availH <= 0) return;
    var aspect = app.mockAspect > 0 ? app.mockAspect : 1.5;
    var w = availW;
    var h = w / aspect;
    if (h > availH) { h = availH; w = h * aspect; }
    box.style.width = Math.max(1, Math.round(w)) + 'px';
    box.style.height = Math.max(1, Math.round(h)) + 'px';
    box.style.setProperty('--empty-scale', (w / 800).toFixed(3));
  }

  /* 无图状态也在画布上渲染当前模板，模拟一张照片导入后的样子 */
  /* 无图状态：一张空白参考照片 + 当前模板的水印预览 */
  function mockSummary() {
    var summary = meta.buildSummary({
      format: 'jpeg',
      dimensions: { width: 1200, height: 800 },
      file: { name: 'sample.jpg', size: 2400000 },
      exif: null,
      warnings: []
    });
    summary.make = 'Canon';
    summary.model = 'EOS R5';
    summary.modelFull = 'Canon EOS R5';
    summary.lens = 'RF24-70mm F2.8 L IS USM';
    summary.focal = 50;
    summary.focalText = '50mm';
    summary.aperture = 2.8;
    summary.apertureText = 'f/2.8';
    summary.shutter = 1 / 250;
    summary.shutterText = '1/250s';
    summary.iso = 400;
    summary.isoText = 'ISO 400';
    summary.exposureComp = 0.3;
    summary.exposureCompText = '+0.3';
    summary.exposureMode = 'A';
    summary.exposureModeText = 'Av';
    summary.date = meta.parseDateParts('2024-05-01 12:34:56');
    summary.datetimeRaw = '2024-05-01 12:34:56';
    summary.offset = '+08:00';
    summary.latitude = 30.2701;
    summary.longitude = 120.1551;
    summary.altitude = 40;
    summary.coordText = meta.formatCoord(30.2701, 120.1551);
    summary.artist = 'Owen';
    summary.copyright = '© 2024';
    summary.filename = 'sample.jpg';
    return summary;
  }

  function renderMockPreview() {
    var canvas = $id('empty-canvas');
    var box = $id('empty-state');
    if (!canvas) return;
    var hasTemplate = !!settings.template;
    if (box) box.classList.toggle('has-template', hasTemplate);
    if (!hasTemplate) {
      app.mockAspect = 1.5;
      canvas.width = 1200;
      canvas.height = 800;
      canvas.getContext('2d').clearRect(0, 0, 1200, 800);
      app.lastScene = null;
      return;
    }
    var summary = mockSummary();
    var fmt = previewDateFormatter();
    // 参考照片固定 1200×800（3:2）；外框由模板自己决定。
    // 照片区域保持透明，让下面那张磨砂容器透出来，因此深色/浅色主题都能一致。
    var scene = layout.compose({
      imageW: 1200,
      imageH: 800,
      meta: summary,
      settings: settings,
      brandName: 'Canon',
      logoAspect: 3,
      logoEnabled: false,
      luminance: 0.55,
      remoteLocation: '',
      formatDateOnly: fmt.date,
      formatTimeOnly: fmt.time
    });
    app.mockAspect = scene.output.w / scene.output.h;
    render.draw(canvas, scene, { photo: null, logo: null });

    // 把照片区域重新挖空：模板背景（胶片黑底/白边纸/相纸）只留在照片外围，
    // 照片区域露出磨砂容器；照片区域内的水印图元用离屏画布再叠回去。
    var ir = scene.imageRect || { x: 0, y: 0, w: 1200, h: 800 };
    var off = document.createElement('canvas');
    off.width = canvas.width;
    off.height = canvas.height;
    var opsScene = {};
    Object.keys(scene).forEach(function (key) { opsScene[key] = scene[key]; });
    opsScene.background = null;
    render.draw(off, opsScene, { photo: null, logo: null });
    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.beginPath();
    ctx.rect(ir.x, ir.y, ir.w, ir.h);
    ctx.clip();
    ctx.clearRect(ir.x, ir.y, ir.w, ir.h);
    ctx.drawImage(off, 0, 0);
    ctx.restore();

    app.lastScene = scene;
  }

  function refreshPreviewFit() {
    if (!activeFile()) {
      applyEmptyFit();
      return;
    }
    measurePreviewFit();
    applyPreviewZoom();
  }

  /* ------------------------------------------------------------------ *
   * 控件
   * ------------------------------------------------------------------ */
  var T_ALL = ['param-panel', 'polaroid', 'bottom-bar', 'film-frame', 'dv-cam', 'tile-copyright'];
  var T_TEXT = ['param-panel', 'polaroid', 'bottom-bar', 'tile-copyright'];

  var SECTION_DEFS = [
    {
      id: 'template', title: '水印模板', open: true, reset: resetTemplateSettings,
      controls: [
        { type: 'template', label: '' }
      ]
    },
    {
      id: 'content', title: '显示内容', open: true,
      templates: ['param-panel', 'polaroid', 'bottom-bar', 'tile-copyright'],
      controls: [
        { type: 'fields', label: '显示字段', templates: ['param-panel', 'polaroid', 'bottom-bar'] },
        { type: 'textarea', label: '自定义文字', path: 'content.customText',
          templates: ['param-panel', 'polaroid', 'bottom-bar', 'tile-copyright'],
          when: function (s) { return s.template === 'tile-copyright' || s.fields.custom; } },
        { type: 'select', label: '地点来源', path: 'content.locationMode', options: state.LOCATION_MODES,
          templates: ['param-panel', 'polaroid', 'bottom-bar'],
          when: function (s) { return !!s.fields.location; } },
        { type: 'text', label: '手动地点', path: 'content.manualLocation',
          templates: ['param-panel', 'polaroid', 'bottom-bar'],
          when: function (s) { return s.content.locationMode === 'manual'; } },
        { type: 'button', label: '联网查询 GPS 地点', action: 'geocode',
          templates: ['param-panel', 'polaroid', 'bottom-bar'],
          when: function (s) { return s.content.locationMode === 'remote'; } },
        { type: 'select', label: '日期格式', path: 'content.dateStyle', options: state.DATE_STYLES,
          templates: ['param-panel', 'polaroid', 'bottom-bar'],
          when: function (s) { return s.fields.date; } },
        { type: 'select', label: '时间格式', path: 'content.timeStyle', options: state.TIME_STYLES,
          templates: ['param-panel', 'polaroid', 'bottom-bar'],
          when: function (s) { return s.fields.time; } },
        { type: 'toggle', label: '显示星期', path: 'content.showWeekday',
          templates: ['param-panel', 'polaroid', 'bottom-bar'],
          when: function (s) { return s.fields.date; } },
        { type: 'toggle', label: '显示时区', path: 'content.showOffset',
          templates: ['param-panel', 'polaroid', 'bottom-bar'],
          when: function (s) { return s.fields.time; } }
      ]
    },
    {
      id: 'layout', title: '参数卡布局', open: true, templates: ['param-panel'],
      controls: [
        { type: 'anchor', label: '水印位置', path: 'layout.anchor' },
        { type: 'range', label: '外边距', path: 'layout.margin', min: 0, max: 160, step: 1, unit: '‰宽' },
        { type: 'range', label: '最大宽度', path: 'layout.maxWidth', min: 0.2, max: 0.98, step: 0.01, percent: true,
          hint: '仅当内容宽度超过该比例时自动收缩，内容较短时看不出变化。' },
      ]
    },
    {
      id: 'text', title: '文字样式', open: true, templates: ['param-panel', 'polaroid', 'bottom-bar'],
      controls: [
        { type: 'select', label: '字体', path: 'text.family', options: state.FONT_OPTIONS },
        { type: 'range', label: '字号', path: 'text.size', min: 4, max: 60, step: 0.5, unit: '‰宽' },
        { type: 'seg', label: '字重', path: 'text.weight', templates: ['param-panel', 'polaroid'],
          hint: '仅影响参数卡标题与拍立得品牌型号行；拍立得相纸几何不受影响。',
          options: [
          { value: 300, label: '细' }, { value: 400, label: '常规' }, { value: 500, label: '中等' },
          { value: 600, label: '半粗' }, { value: 700, label: '粗' }, { value: 800, label: '特粗' }
        ] },
        { type: 'range', label: '字间距', path: 'text.letterSpacing', min: 0, max: 0.3, step: 0.005, percent: true },
        { type: 'range', label: '行高', path: 'text.lineHeight', min: 1, max: 2.2, step: 0.02 },
        { type: 'color', label: '文字颜色', path: 'text.color',
          templates: ['param-panel', 'polaroid'],
          when: function (s) { return !s.text.autoContrast; } },
        { type: 'toggle', label: '自动对比（按明暗选黑/白）', path: 'text.autoContrast',
          templates: ['param-panel', 'polaroid'] },
        { type: 'toggle', label: '文字阴影', path: 'text.shadow', templates: ['param-panel'] }
      ]
    },
    {
      id: 'panel', title: '参数卡底衬', open: true, templates: ['param-panel'],
      controls: [
        { type: 'seg', label: '底衬样式', path: 'panel.style', options: [
          { value: 'none', label: '无' }, { value: 'solid', label: '纯色' },
          { value: 'glass', label: '毛玻璃' }, { value: 'gradient', label: '渐变' }
        ] },
        { type: 'color', label: '底衬颜色', path: 'panel.color', when: function (s) { return s.panel.style !== 'none'; } },
        { type: 'range', label: '底衬透明度', path: 'panel.opacity', min: 0, max: 0.95, step: 0.01, when: function (s) { return s.panel.style !== 'none'; } },
        { type: 'range', label: '模糊半径', path: 'panel.blur', min: 0, max: 60, step: 1, when: function (s) { return s.panel.style === 'glass'; } },
        { type: 'range', label: '圆角', path: 'panel.radius', min: 0, max: 60, step: 1, unit: '‰宽', when: function (s) { return s.panel.style !== 'none'; } },
        { type: 'range', label: '内边距 横向', path: 'panel.paddingX', min: 0, max: 80, step: 1, unit: '‰宽', when: function (s) { return s.panel.style !== 'none'; } },
        { type: 'range', label: '内边距 纵向', path: 'panel.paddingY', min: 0, max: 80, step: 1, unit: '‰宽', when: function (s) { return s.panel.style !== 'none'; } },
        { type: 'range', label: '描边宽度', path: 'panel.borderWidth', min: 0, max: 6, step: 0.1, unit: '‰宽', when: function (s) { return s.panel.style !== 'none'; } },
        { type: 'color', label: '描边颜色', path: 'panel.borderColor', when: function (s) { return s.panel.style !== 'none' && s.panel.borderWidth > 0; } },
        { type: 'range', label: '描边透明度', path: 'panel.borderOpacity', min: 0, max: 1, step: 0.01, when: function (s) { return s.panel.style !== 'none' && s.panel.borderWidth > 0; } },
        { type: 'toggle', label: '底衬投影', path: 'panel.shadow', when: function (s) { return s.panel.style !== 'none'; } }
      ]
    },
    {
      id: 'polaroid', title: '拍立得相纸', open: true, templates: ['polaroid'],
      controls: [
        { type: 'range', label: '相纸边框厚度', path: 'frame.thickness', min: 0, max: 80, step: 1, unit: '‰宽' },
        { type: 'color', label: '相纸颜色', path: 'frame.color' }
      ]
    },
    {
      id: 'bottomBar', title: '底部白边', open: true, templates: ['bottom-bar'],
      controls: [
        { type: 'range', label: '白边高度', path: 'bottomBar.height', min: 36, max: 220, step: 1, unit: '‰宽' },
        { type: 'color', label: '白边颜色', path: 'bottomBar.color' },
        { type: 'toggle', label: '自动对比文字颜色', path: 'bottomBar.autoContrast' },
        { type: 'color', label: '文字颜色', path: 'bottomBar.textColor', when: function (s) { return !s.bottomBar.autoContrast; } },
        { type: 'range', label: '左右内边距', path: 'bottomBar.paddingX', min: 0, max: 200, step: 1, unit: '‰宽' },
        { type: 'select', label: '徽标位置', path: 'bottomBar.logoPosition', options: [
          { value: 'before-right', label: '右侧文字左侧' },
          { value: 'after-left', label: '左侧文字右侧' }
        ], when: function (s) { return s.logo.source !== 'none'; } },
        { type: 'toggle', label: '徽标与文字间细竖线', path: 'bottomBar.divider',
          when: function (s) { return s.logo.source !== 'none'; } },
        { type: 'color', label: '分隔线颜色', path: 'bottomBar.dividerColor',
          when: function (s) { return s.logo.source !== 'none' && s.bottomBar.divider; } },
        { type: 'select', label: '左侧第一行', path: 'bottomBar.left1', options: state.BOTTOM_SLOTS },
        { type: 'select', label: '左侧第二行', path: 'bottomBar.left2', options: state.BOTTOM_SLOTS },
        { type: 'select', label: '右侧第一行', path: 'bottomBar.right1', options: state.BOTTOM_SLOTS },
        { type: 'select', label: '右侧第二行', path: 'bottomBar.right2', options: state.BOTTOM_SLOTS }
      ]
    },
    {
      id: 'film', title: '胶片样式', open: true, templates: ['film-frame'],
      controls: [
        { type: 'seg', label: '底片类型', path: 'film.type', options: state.FILM_TYPES },
        { type: 'seg', label: '齿孔方向', path: 'film.orientation', options: state.FILM_ORIENTATIONS },
        { type: 'select', label: '齿孔颜色', path: 'film.holeColor', options: state.FILM_HOLE_COLORS }
      ]
    },
    {
      id: 'filmPrint', title: '打印内容', open: true, templates: ['film-frame'],
      controls: [
        { type: 'select', label: '打印风格', path: 'film.printStyle', options: state.FILM_PRINT_STYLES },
        { type: 'text', label: '胶卷型号', path: 'film.stock' },
        { type: 'text', label: '片号起点', path: 'film.frameNo' },
        { type: 'range', label: '打印字号', path: 'film.textSize', min: 8, max: 60, step: 0.5, unit: '‰胶片宽' },
        { type: 'range', label: '打印透明度', path: 'film.textOpacity', min: 0.35, max: 1, step: 0.01 }
      ]
    },
    {
      id: 'dv', title: 'DV 界面', open: true, templates: ['dv-cam'],
      controls: [
        { type: 'range', label: 'OSD 字号', path: 'dv.size', min: 5, max: 40, step: 0.5, unit: '‰宽' },
        { type: 'range', label: 'OSD 透明度', path: 'dv.opacity', min: 0.2, max: 1, step: 0.01 },
        { type: 'toggle', label: '取景框线', path: 'dv.frame' },
        { type: 'range', label: '取景框线宽', path: 'dv.frameWidth', min: 1, max: 12, step: 0.5, unit: '‰宽',
          when: function (s) { return s.dv.frame; } },
        { type: 'range', label: '取景框边距', path: 'dv.frameMargin', min: 4, max: 80, step: 1, unit: '‰宽',
          when: function (s) { return s.dv.frame; } },
        { type: 'range', label: '元素边距', path: 'dv.padding', min: 4, max: 150, step: 1, unit: '‰宽',
          hint: '小于取景框时自动贴合取景框内侧。' },
        { type: 'toggle', label: 'REC 指示', path: 'dv.rec' },
        { type: 'toggle', label: '分辨率', path: 'dv.resolution' },
        { type: 'select', label: '分辨率显示', path: 'dv.resolutionLabel', options: state.DV_RESOLUTIONS,
          when: function (s) { return s.dv.resolution; } },
        { type: 'toggle', label: '电池图标', path: 'dv.battery' },
        { type: 'range', label: '电量', path: 'dv.batteryLevel', min: 0, max: 100, step: 1, unit: '%', when: function (s) { return s.dv.battery; } },
        { type: 'toggle', label: '日期', path: 'dv.showDate' },
        { type: 'select', label: '日期格式', path: 'dv.dateStyle', options: state.DATE_STYLES, when: function (s) { return s.dv.showDate; } },
        { type: 'toggle', label: '时间', path: 'dv.showTime' },
        { type: 'select', label: '时间格式', path: 'dv.timeStyle', options: state.TIME_STYLES, when: function (s) { return s.dv.showTime; } },
        { type: 'toggle', label: '录像计数器', path: 'dv.counter' },
        { type: 'text', label: '计数器显示', path: 'dv.counterText', when: function (s) { return s.dv.counter; } },
        { type: 'select', label: '中心对焦框', path: 'dv.centerFocus', options: state.DV_FOCUS_STYLES },
        { type: 'range', label: '中心对焦框大小', path: 'dv.centerFocusSize', min: 6, max: 45, step: 1, unit: '%',
          when: function (s) { return s.dv.centerFocus !== 'none'; } },
        { type: 'toggle', label: '曝光标尺', path: 'dv.exposure' },
        { type: 'select', label: '曝光标尺位置', path: 'dv.exposurePosition', options: state.DV_EXPOSURE_POSITIONS,
          when: function (s) { return s.dv.exposure; } },
        { type: 'toggle', label: '三分构图线', path: 'dv.grid' },
        { type: 'toggle', label: '显示品牌型号', path: 'dv.showBrand' },
        { type: 'text', label: '模式标签', path: 'dv.modeLabel' }
      ]
    },
    {
      id: 'tile', title: '平铺版权', open: true, templates: ['tile-copyright'],
      controls: [
        { type: 'select', label: '字体', path: 'text.family', options: state.FONT_OPTIONS },
        { type: 'color', label: '文字颜色', path: 'text.color', when: function (s) { return !s.text.autoContrast; } },
        { type: 'toggle', label: '自动对比（按明暗选黑/白）', path: 'text.autoContrast' },
        { type: 'range', label: '旋转角度', path: 'tile.angle', min: -80, max: 80, step: 1, unit: '°' },
        { type: 'range', label: '密度', path: 'tile.density', min: 0.4, max: 3, step: 0.01 },
        { type: 'range', label: '透明度', path: 'tile.opacity', min: 0.02, max: 0.8, step: 0.01 },
        { type: 'range', label: '文字大小', path: 'tile.textSize', min: 6, max: 60, step: 0.5, unit: '‰宽' }
      ]
    },
    {
      id: 'logo', title: '品牌徽标', open: true,
      templates: ['param-panel', 'polaroid', 'bottom-bar', 'tile-copyright'],
      controls: [
        { type: 'seg', label: '徽标来源', path: 'logo.source', options: [
          { value: 'brand', label: '品牌徽标' }, { value: 'custom', label: '自定义图片' }, { value: 'none', label: '不显示' }
        ] },
        { type: 'brandPreview', label: '预览' },
        { type: 'select', label: '品牌', path: 'logo.brandId', options: 'brands', when: function (s) { return s.logo.source === 'brand'; } },
        { type: 'select', label: '自定义 logo', path: 'logo.customLogoId', options: 'logos', when: function (s) { return s.logo.source === 'custom'; } },
        { type: 'button', label: '导入 logo 图片（PNG/SVG/WebP）', action: 'importLogo', when: function (s) { return s.logo.source !== 'none'; } },
        { type: 'button', label: '删除当前自定义 logo', action: 'deleteLogo', when: function (s) { return s.logo.source === 'custom' && (!!s.logo.customLogoId || app.logos.length > 0); } },
        { type: 'seg', label: '配色', path: 'logo.variant', options: [
          { value: 'auto', label: '自动' }, { value: 'light', label: '白色' },
          { value: 'dark', label: '深色' }, { value: 'brand', label: '品牌色' }
        ], when: function (s) { return s.logo.source === 'brand'; } },
        { type: 'range', label: '徽标高度', path: 'logo.height', min: 6, max: 120, step: 1, unit: '‰宽' },
        { type: 'range', label: '徽标圆角', path: 'logo.radius', min: 0, max: 50, step: 1, unit: '%',
          hint: '对带方角背景的自定义 logo 效果明显；品牌字样为透明背景，圆角会裁切边角。' },
        { type: 'range', label: '徽标透明度', path: 'logo.opacity', min: 0.05, max: 1, step: 0.01 },
        { type: 'range', label: '徽标间距', path: 'logo.gap', min: 0, max: 100, step: 1, unit: '‰宽',
          templates: ['param-panel', 'polaroid', 'bottom-bar'] }
      ]
    },
    {
      id: 'output', title: '导出设置', open: true, mount: 'export-modal',
      controls: [
        { type: 'seg', label: '输出格式', path: 'output.format', options: [
          { value: 'original', label: '原格式' },
          { value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }, { value: 'webp', label: 'WebP' }
        ] },
        { type: 'range', label: 'JPEG / WebP 质量', path: 'output.quality', min: 0.3, max: 1, step: 0.01, percent: true,
          hint: '仅影响导出文件，预览画布不会变化。', when: function (s) { return s.output.format !== 'png'; } },
        { type: 'seg', label: '尺寸', path: 'output.resize', options: [
          { value: 'original', label: '原图' }, { value: 'longEdge', label: '长边' }, { value: 'percent', label: '百分比' }
        ] },
        { type: 'number', label: '长边像素', path: 'output.longEdge', min: 64, max: 20000, step: 1, when: function (s) { return s.output.resize === 'longEdge'; } },
        { type: 'number', label: '缩放百分比', path: 'output.percent', min: 1, max: 400, step: 1, unit: '%', when: function (s) { return s.output.resize === 'percent'; } },
        { type: 'toggle', label: '保留 EXIF / 元数据', path: 'output.keepMetadata' },
        { type: 'text', label: '文件名模板', path: 'output.filenamePattern', hint: '可用 {name} {brand} {model} {date} {time} {seq}' },
        { type: 'toggle', label: '多图导出为 ZIP', path: 'output.zipBatch' },
        { type: 'toggle', label: 'ZIP 内附 metadata.json', path: 'output.includeJson' }
      ]
    }
  ];

  var FIELD_LABELS = [
    ['brand', '品牌'], ['model', '型号'], ['lens', '镜头'], ['focal', '焦距'],
    ['aperture', '光圈'], ['shutter', '快门'], ['iso', 'ISO'], ['date', '日期'],
    ['time', '时间'], ['location', '地点'], ['custom', '自定义'], ['filename', '文件名']
  ];

  function register(ctrl, wrapper, refresh) {
    app.ctrlRefs.push({ ctrl: ctrl, wrapper: wrapper, refresh: refresh });
  }

  function buildControls() {
    var root = $id('controls');
    root.textContent = '';
    var exportHost = $id('export-modal-body');
    if (exportHost) exportHost.textContent = '';
    app.ctrlRefs = [];
    app.sectionRefs = [];
    SECTION_DEFS.forEach(function (section) {
      var body = el('div', 'ctrl-body');
      section.controls.forEach(function (ctrl) {
        body.appendChild(buildControl(ctrl));
      });
      if (section.mount === 'export-modal') {
        // 导出设置：控件常驻在隐藏的 host 里，打开弹窗时整体移动进 #modal-body。
        var modalBody = el('div', 'dock-card-body');
        modalBody.dataset.section = section.id;
        while (body.firstChild) modalBody.appendChild(body.firstChild);
        (exportHost || root).appendChild(modalBody);
        app.sectionRefs.push({ def: section, el: modalBody });
        return;
      }
      var details = document.createElement('details');
      details.className = 'ctrl-section';
      details.open = !!section.open;
      details.dataset.section = section.id;
      var summary = document.createElement('summary');
      summary.appendChild(el('span', null, section.title));
      if (typeof section.reset === 'function') {
        var resetBtn = el('button', 'ctrl-reset', '↺');
        resetBtn.type = 'button';
        resetBtn.title = '恢复默认：' + section.title;
        resetBtn.setAttribute('aria-label', resetBtn.title);
        resetBtn.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          section.reset();
        });
        summary.appendChild(resetBtn);
      }
      details.appendChild(summary);
      details.appendChild(body);
      root.appendChild(details);
      app.sectionRefs.push({ def: section, el: details });
    });
  }

  function buildControl(ctrl) {
    switch (ctrl.type) {
      case 'template': return buildTemplateControl(ctrl);
      case 'fields': return buildFieldsControl(ctrl);
      case 'chipGroup': return buildChipGroupControl(ctrl);
      case 'anchor': return buildAnchorControl(ctrl);
      case 'range': return buildRangeControl(ctrl);
      case 'number': return buildNumberControl(ctrl);
      case 'text': return buildTextControl(ctrl);
      case 'textarea': return buildTextareaControl(ctrl);
      case 'color': return buildColorControl(ctrl);
      case 'seg': return buildSegControl(ctrl);
      case 'select': return buildSelectControl(ctrl);
      case 'toggle': return buildToggleControl(ctrl);
      case 'button': return buildButtonControl(ctrl);
      case 'brandPreview': return buildBrandPreviewControl(ctrl);
      case 'presets': return buildPresetsControl(ctrl);
      default: return el('div');
    }
  }

  function controlRow(ctrl, labelText) {
    var wrap = el('div', 'ctrl-row');
    wrap.dataset.control = ctrl.type;
    if (ctrl.path) wrap.dataset.path = ctrl.path;
    var label = el('div', 'ctrl-label');
    label.appendChild(el('span', 'label-text', labelText || ctrl.label || ''));
    wrap.appendChild(label);
    return { wrap: wrap, label: label };
  }

  function addResetButton(label, ctrl, resetFn, title) {
    if (!resetFn) return null;
    var btn = el('button', 'ctrl-reset', '↺');
    btn.type = 'button';
    btn.title = '恢复默认：' + (title || ctrl.label || ctrl.path || '');
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      resetFn();
    });
    label.appendChild(btn);
    return btn;
  }

  function resetPathValue(path, label) {
    var def = getPath(state.DEFAULTS, path);
    setPath(settings, path, def === undefined ? undefined : JSON.parse(JSON.stringify(def)));
    refreshControls();
    schedulePreview();
    updateExportSummary();
    state.saveSettingsDebounced(settings);
    showToast('已恢复默认：' + (label || path));
  }

  function pathReset(ctrl) {
    if (!ctrl.path) return null;
    return function () { resetPathValue(ctrl.path, ctrl.label); };
  }

  function isControlVisible(ctrl) {
    if (ctrl.templates && ctrl.templates.indexOf(settings.template) < 0) return false;
    if (typeof ctrl.when === 'function' && !ctrl.when(settings)) return false;
    return true;
  }

  function applyHidden(wrap, ctrl) {
    var hidden = !isControlVisible(ctrl);
    wrap.classList.toggle('hidden', hidden);
    return hidden;
  }

  function resetTemplateSettings() {
    settings.template = state.DEFAULTS.template;
    refreshControls();
    schedulePreview();
    updateExportSummary();
    state.saveSettingsDebounced(settings);
    showToast('已恢复默认模板：' + templateName(settings.template));
  }

  function buildTemplateControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    wrap.dataset.control = 'template';
    var grid = el('div', 'template-grid');
    var buttons = [];
    state.TEMPLATES.forEach(function (t) {
      var btn = el('button', 'template-card');
      btn.type = 'button';
      btn.appendChild(el('strong', null, t.name));
      btn.appendChild(el('span', null, t.desc));
      btn.dataset.id = t.id;
      btn.addEventListener('click', function () {
        settings.template = settings.template === t.id ? '' : t.id;
        buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.id === settings.template); });
        refreshControls();
        saveAndPreview();
      });
      btn.addEventListener('dblclick', function (e) {
        e.preventDefault();
        e.stopPropagation();
        settings.template = '';
        buttons.forEach(function (b) { b.classList.remove('active'); });
        refreshControls();
        saveAndPreview();
      });
      buttons.push(btn);
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
    register(ctrl, wrap, function () {
      buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.id === settings.template); });
      applyHidden(wrap, ctrl);
    });
    return wrap;
  }

  function buildFieldsControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    wrap.dataset.control = 'fields';
    var label = el('div', 'ctrl-label');
    label.appendChild(el('span', 'label-text', ctrl.label));
    addResetButton(label, ctrl, function () {
      settings.fields = JSON.parse(JSON.stringify(state.DEFAULTS.fields));
      refreshControls();
      schedulePreview();
      state.saveSettingsDebounced(settings);
      showToast('已恢复默认显示字段');
    }, '显示字段');
    wrap.appendChild(label);
    var chips = el('div', 'toggle-chips');
    var refs = [];
    FIELD_LABELS.forEach(function (pair) {
      var btn = el('button', 'chip', pair[1]);
      btn.type = 'button';
      btn.dataset.field = pair[0];
      btn.addEventListener('click', function () {
        settings.fields[pair[0]] = !settings.fields[pair[0]];
        refreshFields();
        saveAndPreview();
      });
      refs.push({ key: pair[0], btn: btn });
      chips.appendChild(btn);
    });
    wrap.appendChild(chips);
    function refreshFields() {
      refs.forEach(function (r) { r.btn.classList.toggle('active', !!settings.fields[r.key]); });
    }
    register(ctrl, wrap, function () {
      refreshFields();
      applyHidden(wrap, ctrl);
    });
    return wrap;
  }

  function buildChipGroupControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    wrap.dataset.control = 'chipGroup';
    var label = el('div', 'ctrl-label');
    label.appendChild(el('span', 'label-text', ctrl.label));
    addResetButton(label, ctrl, function () {
      ctrl.items.forEach(function (item) {
        var def = getPath(state.DEFAULTS, item.path);
        setPath(settings, item.path, !!def);
      });
      refreshControls();
      schedulePreview();
      state.saveSettingsDebounced(settings);
      showToast('已恢复默认打印字段');
    }, ctrl.label);
    wrap.appendChild(label);
    var chips = el('div', 'toggle-chips');
    var refs = [];
    ctrl.items.forEach(function (item) {
      var btn = el('button', 'chip', item.label);
      btn.type = 'button';
      btn.dataset.path = item.path;
      btn.addEventListener('click', function () {
        setPath(settings, item.path, !getPath(settings, item.path));
        refreshChips();
        saveAndPreview();
      });
      refs.push({ item: item, btn: btn });
      chips.appendChild(btn);
    });
    wrap.appendChild(chips);
    function refreshChips() {
      refs.forEach(function (r) { r.btn.classList.toggle('active', !!getPath(settings, r.item.path)); });
    }
    register(ctrl, wrap, function () {
      refreshChips();
      applyHidden(wrap, ctrl);
    });
    return wrap;
  }

  function buildAnchorControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    wrap.dataset.control = 'anchor';
    wrap.dataset.path = ctrl.path;
    var label = el('div', 'ctrl-label');
    label.appendChild(el('span', 'label-text', ctrl.label));
    addResetButton(label, ctrl, pathReset(ctrl), ctrl.label);
    wrap.appendChild(label);
    var grid = el('div', 'anchor-grid');
    var buttons = [];
    state.ANCHORS.forEach(function (a) {
      var btn = el('button', 'anchor-btn', a.label);
      btn.type = 'button';
      btn.dataset.anchor = a.value;
      btn.addEventListener('click', function () {
        settings.layout.anchor = a.value;
        buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.anchor === a.value); });
        saveAndPreview();
      });
      buttons.push(btn);
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
    register(ctrl, wrap, function () {
      buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.anchor === settings.layout.anchor); });
      applyHidden(wrap, ctrl);
    });
    return wrap;
  }

  function formatDisplay(ctrl, value) {
    if (ctrl.percent) return Math.round(Number(value) * 1000) / 10 + '%';
    return (Number(value) >= 0 ? '' : '') + value + (ctrl.unit ? ' ' + ctrl.unit : '');
  }

  function buildRangeControl(ctrl) {
    var row = controlRow(ctrl);
    var val = el('span', 'val');
    row.label.appendChild(val);
    addResetButton(row.label, ctrl, pathReset(ctrl), ctrl.label);
    var input = document.createElement('input');
    input.type = 'range';
    input.min = ctrl.min;
    input.max = ctrl.max;
    input.step = ctrl.step || 1;
    input.dataset.path = ctrl.path;
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      setPath(settings, ctrl.path, v);
      val.textContent = formatDisplay(ctrl, v);
      saveAndPreview();
    });
    row.wrap.appendChild(input);
    register(ctrl, row.wrap, function () {
      var v = getPath(settings, ctrl.path);
      input.value = v;
      val.textContent = formatDisplay(ctrl, v);
      applyHidden(row.wrap, ctrl);
    });
    return row.wrap;
  }

  function buildNumberControl(ctrl) {
    var row = controlRow(ctrl);
    addResetButton(row.label, ctrl, pathReset(ctrl), ctrl.label);
    var input = document.createElement('input');
    input.type = 'number';
    input.className = 'input';
    input.min = ctrl.min;
    input.max = ctrl.max;
    input.step = ctrl.step || 1;
    input.dataset.path = ctrl.path;
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      if (!isFinite(v)) return;
      setPath(settings, ctrl.path, v);
      saveAndPreview();
    });
    row.wrap.appendChild(input);
    register(ctrl, row.wrap, function () {
      input.value = getPath(settings, ctrl.path);
      applyHidden(row.wrap, ctrl);
    });
    return row.wrap;
  }

  function buildTextControl(ctrl) {
    var row = controlRow(ctrl);
    addResetButton(row.label, ctrl, pathReset(ctrl), ctrl.label);
    var input = el('input', 'input');
    input.type = 'text';
    input.dataset.path = ctrl.path;
    input.addEventListener('input', function () {
      setPath(settings, ctrl.path, input.value);
      saveAndPreview();
    });
    row.wrap.appendChild(input);
    register(ctrl, row.wrap, function () {
      input.value = getPath(settings, ctrl.path) || '';
      applyHidden(row.wrap, ctrl);
    });
    return row.wrap;
  }

  function buildTextareaControl(ctrl) {
    var row = controlRow(ctrl);
    addResetButton(row.label, ctrl, pathReset(ctrl), ctrl.label);
    var input = document.createElement('textarea');
    input.className = 'input';
    input.rows = 2;
    input.style.resize = 'vertical';
    input.dataset.path = ctrl.path;
    input.addEventListener('input', function () {
      setPath(settings, ctrl.path, input.value);
      saveAndPreview();
    });
    row.wrap.appendChild(input);
    register(ctrl, row.wrap, function () {
      input.value = getPath(settings, ctrl.path) || '';
      applyHidden(row.wrap, ctrl);
    });
    return row.wrap;
  }

  function buildColorControl(ctrl) {
    var row = controlRow(ctrl);
    addResetButton(row.label, ctrl, pathReset(ctrl), ctrl.label);
    var colorRow = el('div', 'color-row');
    var picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'input';
    picker.dataset.path = ctrl.path;
    var text = el('input', 'input');
    text.type = 'text';
    function fromPicker() {
      setPath(settings, ctrl.path, picker.value.toUpperCase());
      text.value = picker.value.toUpperCase();
      saveAndPreview();
    }
    picker.addEventListener('input', fromPicker);
    text.addEventListener('change', function () {
      var v = text.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        setPath(settings, ctrl.path, v.toUpperCase());
        picker.value = v;
        saveAndPreview();
      } else {
        text.value = getPath(settings, ctrl.path);
      }
    });
    colorRow.appendChild(picker);
    colorRow.appendChild(text);
    row.wrap.appendChild(colorRow);
    register(ctrl, row.wrap, function () {
      var v = getPath(settings, ctrl.path) || '#FFFFFF';
      picker.value = /^#[0-9a-f]{6}$/i.test(v) ? v : '#FFFFFF';
      text.value = v;
      applyHidden(row.wrap, ctrl);
    });
    return row.wrap;
  }

  function buildSegControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    wrap.dataset.control = 'seg';
    if (ctrl.path) wrap.dataset.path = ctrl.path;
    var label = el('div', 'ctrl-label');
    label.appendChild(el('span', 'label-text', ctrl.label));
    addResetButton(label, ctrl, pathReset(ctrl), ctrl.label);
    wrap.appendChild(label);
    var seg = el('div', 'seg');
    var buttons = [];
    ctrl.options.forEach(function (opt) {
      var btn = el('button', 'seg-btn', opt.label);
      btn.type = 'button';
      btn.dataset.value = String(opt.value);
      btn.addEventListener('click', function () {
        var path = ctrl.path;
        var raw = getPath(settings, path);
        var value = typeof raw === 'number' ? Number(opt.value) : opt.value;
        setPath(settings, path, value);
        buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.value === String(value)); });
        refreshConditions();
        saveAndPreview();
      });
      buttons.push(btn);
      seg.appendChild(btn);
    });
    wrap.appendChild(seg);
    register(ctrl, wrap, function () {
      var current = getPath(settings, ctrl.path);
      buttons.forEach(function (b) { b.classList.toggle('active', b.dataset.value === String(current)); });
      applyHidden(wrap, ctrl);
    });
    return wrap;
  }

  function buildSelectControl(ctrl) {
    var row = controlRow(ctrl);
    addResetButton(row.label, ctrl, pathReset(ctrl), ctrl.label);
    var select = document.createElement('select');
    select.className = 'select';
    select.dataset.path = ctrl.path;
    var shell = el('div', 'select-shell');
    shell.appendChild(select);
    row.wrap.appendChild(shell);
    var kind = ctrl.options === 'brands' ? 'brands' : ctrl.options === 'logos' ? 'logos' : 'static';
    function fill() {
      var previous = select.value;
      select.textContent = '';
      if (kind === 'brands') {
        var auto = document.createElement('option');
        auto.value = 'auto';
        auto.textContent = '自动识别';
        select.appendChild(auto);
        brands.list().forEach(function (b) {
          var opt = document.createElement('option');
          opt.value = b.id;
          opt.textContent = b.name + '（' + b.group + '）';
          select.appendChild(opt);
        });
      } else if (kind === 'logos') {
        if (!app.logos.length) {
          var none = document.createElement('option');
          none.value = '';
          none.textContent = '尚未导入 logo';
          select.appendChild(none);
        } else {
          app.logos.forEach(function (l) {
            var opt = document.createElement('option');
            opt.value = l.id;
            opt.textContent = l.name + (l.width ? ' · ' + l.width + '×' + l.height : '');
            select.appendChild(opt);
          });
        }
      } else {
        ctrl.options.forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          select.appendChild(opt);
        });
      }
      select.value = previous;
    }
    fill();
    select.addEventListener('change', function () {
      var value = select.value;
      var raw = getPath(settings, ctrl.path);
      if (typeof raw === 'number' && value !== '') value = Number(value);
      setPath(settings, ctrl.path, value === '' ? null : value);
      refreshConditions();
      saveAndPreview();
    });
    register(ctrl, row.wrap, function () {
      if (kind === 'logos') fill();
      var v = getPath(settings, ctrl.path);
      if (kind === 'logos' && !app.logos.length) v = '';
      select.value = v == null ? '' : String(v);
      if (kind === 'logos' && !select.value && app.logos.length) {
        select.value = app.logos[0].id;
      }
      applyHidden(row.wrap, ctrl);
    });
    return row.wrap;
  }

  function buildToggleControl(ctrl) {
    var wrap = el('div', 'ctrl-row inline');
    wrap.dataset.control = 'toggle';
    wrap.dataset.path = ctrl.path;
    var label = el('div', 'ctrl-label');
    label.appendChild(el('span', 'label-text', ctrl.label));
    addResetButton(label, ctrl, pathReset(ctrl), ctrl.label);
    wrap.appendChild(label);
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.path = ctrl.path;
    checkbox.addEventListener('change', function () {
      setPath(settings, ctrl.path, checkbox.checked);
      refreshConditions();
      saveAndPreview();
    });
    wrap.appendChild(checkbox);
    register(ctrl, wrap, function () {
      checkbox.checked = !!getPath(settings, ctrl.path);
      applyHidden(wrap, ctrl);
    });
    return wrap;
  }

  function buildButtonControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    var btn = el('button', 'btn', ctrl.label);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      handleAction(ctrl.action);
    });
    wrap.appendChild(btn);
    register(ctrl, wrap, function () { applyHidden(wrap, ctrl); });
    return wrap;
  }

  function buildBrandPreviewControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    wrap.appendChild(el('div', 'ctrl-label')).appendChild(el('span', null, ctrl.label));
    var host = el('div', 'brand-preview');
    host.id = 'brand-preview';
    wrap.appendChild(host);
    register(ctrl, wrap, function () { applyHidden(wrap, ctrl); });
    return wrap;
  }

  function buildPresetsControl(ctrl) {
    var wrap = el('div', 'ctrl-row');
    wrap.appendChild(el('div', 'ctrl-label')).appendChild(el('span', null, ctrl.label));
    register(ctrl, wrap, function () { applyHidden(wrap, ctrl); });
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * 预设条（右侧栏底部）+ 上拉浮层
   * ------------------------------------------------------------------ */
  function presetPopoverOpen() {
    var pop = $id('preset-popover');
    return !!pop && !pop.hidden;
  }

  function setPresetPopover(open) {
    var pop = $id('preset-popover');
    var btn = $id('btn-preset-use');
    if (!pop) return;
    pop.hidden = !open;
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) renderPresets();
  }

  /* ------------------------------------------------------------------ *
   * 导出设置弹窗：把常驻的 #export-modal-body 整体移进 #modal-body，
   * 关闭时移回 host（移动节点而非克隆，ctrlRefs 句柄保持有效）。
   * ------------------------------------------------------------------ */
  function openExportSettings() {
    var host = $id('export-settings-host');
    var panel = $id('export-modal-body');
    if (!host || !panel) return;
    var wrap = el('div');
    wrap.appendChild(panel);
    openModal({
      title: '导出设置',
      body: wrap,
      onClose: function () {
        host.appendChild(panel);
        $id('modal-body').textContent = '';
      },
      actions: [
        {
          label: '导出当前照片',
          primary: true,
          onClick: function () {
            closeModal();
            window.setTimeout(function () { exportActive(); }, 80);
            return false;
          }
        },
        {
          label: '全部导出',
          onClick: function () {
            closeModal();
            window.setTimeout(function () { exportAll(); }, 80);
            return false;
          }
        },
        { label: '导出预设 JSON', onClick: function () { exportPresets(); return false; } },
        {
          label: '恢复默认参数',
          onClick: function () {
            // 先关闭本弹窗，再打开确认框，避免复用同一个 #modal 造成覆盖。
            window.setTimeout(function () { resetAll(); }, 60);
          }
        },
        { label: '完成', primary: true }
      ]
    });
  }

  function bindPresetBar() {
    var saveBtn = $id('btn-preset-save');
    if (saveBtn) saveBtn.addEventListener('click', function () { saveCurrentPreset(); });
    var useBtn = $id('btn-preset-use');
    if (useBtn) {
      useBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setPresetPopover(!presetPopoverOpen());
      });
    }
    var importBtn = $id('btn-preset-import');
    if (importBtn) {
      importBtn.addEventListener('click', function () {
        setPresetPopover(false);
        $id('preset-input').click();
      });
    }
    document.addEventListener('click', function (e) {
      if (!presetPopoverOpen()) return;
      var pop = $id('preset-popover');
      var bar = document.querySelector('.preset-bar');
      if (pop && pop.contains(e.target)) return;
      if (bar && bar.contains(e.target)) return;
      setPresetPopover(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && presetPopoverOpen()) setPresetPopover(false);
    });
  }

  function refreshControls() {
    app.ctrlRefs.forEach(function (ref) { ref.refresh(); });
    refreshConditions();
    updateExportButtons();
    updateExportSummary();
  }

  function refreshConditions() {
    app.sectionRefs.forEach(function (ref) {
      var hidden = !!(ref.def.templates && ref.def.templates.indexOf(settings.template) < 0);
      ref.el.hidden = hidden;
    });
    app.ctrlRefs.forEach(function (ref) {
      applyHidden(ref.wrapper, ref.ctrl);
    });
  }

  function saveAndPreview() {
    state.saveSettingsDebounced(settings, function () {
      showToast('设置无法保存到浏览器存储（可能已满）', 'warn');
    });
    refreshConditions();
    schedulePreview();
    updateExportSummary();
  }

  function replaceSettings(next) {
    var clean = state.sanitize(next);
    Object.keys(settings).forEach(function (k) { delete settings[k]; });
    Object.assign(settings, clean);
  }

  /* ------------------------------------------------------------------ *
   * 操作：预设、logo、地点、恢复
   * ------------------------------------------------------------------ */
  async function saveCurrentPreset() {
    var name = await promptDialog('保存预设', '给这套参数起个名字（同名会覆盖）：', '我的水印');
    if (name == null) return;
    state.savePreset(name, settings);
    renderPresets();
    showToast('已保存预设：' + name);
  }

  function renderPresets() {
    var host = $id('preset-popover-list');
    if (!host) return;
    host.textContent = '';
    app.presets = state.listPresets();
    if (!app.presets.length) {
      host.appendChild(el('div', 'preset-empty', '还没有保存的预设'));
      return;
    }
    app.presets.forEach(function (preset) {
      var row = el('div', 'preset-item');
      var apply = el('button', 'preset-item-apply', preset.name);
      apply.type = 'button';
      apply.title = '应用预设：' + preset.name;
      apply.addEventListener('click', function () {
        replaceSettings(preset.settings);
        refreshControls();
        schedulePreview();
        setPresetPopover(false);
        showToast('已应用预设：' + preset.name);
      });
      var del = el('button', 'preset-item-del', '×');
      del.type = 'button';
      del.title = '删除预设';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        state.deletePreset(preset.id);
        renderPresets();
      });
      row.appendChild(apply);
      row.appendChild(del);
      host.appendChild(row);
    });
  }

  function exportPresets() {
    var data = state.listPresets();
    var blob = new Blob([JSON.stringify({ presets: data }, null, 2)], { type: 'application/json' });
    exporter.download(blob, 'watermark-presets.json');
  }

  async function importPresetsFile(file) {
    if (!file) return;
    try {
      var text = await file.text();
      var data = JSON.parse(text);
      var list = Array.isArray(data) ? data : (data && Array.isArray(data.presets) ? data.presets : []);
      if (!list.length) throw new Error('文件中没有预设');
      list.forEach(function (p) {
        if (p && p.name && p.settings) state.savePreset(String(p.name).slice(0, 40), state.sanitize(p.settings));
      });
      renderPresets();
      showToast('已导入 ' + list.length + ' 个预设');
    } catch (e) {
      showToast('预设导入失败：' + e.message, 'error');
    }
  }

  async function resetAll() {
    var ok = await new Promise(function (resolve) {
      openModal({
        title: '恢复默认参数',
        body: '将水印参数恢复为默认值。已保存的预设和导入的 logo 不会被删除。',
        onClose: function () { resolve(false); },
        actions: [
          { label: '取消', onClick: function () { resolve(false); } },
          { label: '恢复默认', primary: true, onClick: function () { resolve(true); } }
        ]
      });
    });
    if (!ok) return;
    replaceSettings({});
    refreshControls();
    schedulePreview();
    showToast('已恢复默认参数');
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.readAsDataURL(file);
    });
  }

  function imageSize(dataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve({ width: img.naturalWidth || img.width, height: img.naturalHeight || img.height }); };
      img.onerror = function () { resolve({ width: 0, height: 0 }); };
      img.src = dataUrl;
    });
  }

  async function importLogoFile(file) {
    if (!file) return;
    try {
      if (!/^image\//.test(file.type || '')) throw new Error('请选择图片文件');
      var dataUrl = await readFileAsDataURL(file);
      var sizeInfo = await imageSize(dataUrl);
      var logo = await state.saveLogo({
        name: baseName(file.name),
        dataUrl: dataUrl,
        width: sizeInfo.width,
        height: sizeInfo.height
      });
      app.logos.unshift(logo);
      settings.logo.source = 'custom';
      settings.logo.customLogoId = logo.id;
      refreshControls();
      schedulePreview();
      showToast('已导入 logo' + (logo._memoryOnly ? '（浏览器存储不可用，仅本次会话有效）' : ''));
    } catch (e) {
      showToast('logo 导入失败：' + e.message, 'error');
    }
  }

  async function deleteCurrentLogo() {
    var logo = customLogo();
    if (!logo) return;
    var ok = await new Promise(function (resolve) {
      openModal({
        title: '删除自定义 logo',
        body: '确定删除「' + logo.name + '」吗？引用该 logo 的预设将回退到品牌徽标。',
        onClose: function () { resolve(false); },
        actions: [
          { label: '取消', onClick: function () { resolve(false); } },
          { label: '删除', primary: true, onClick: function () { resolve(true); } }
        ]
      });
    });
    if (!ok) return;
    await state.deleteLogo(logo.id);
    app.logos = app.logos.filter(function (l) { return l.id !== logo.id; });
    delete app.logoImageCache[logo.id];
    if (settings.logo.customLogoId === logo.id) settings.logo.customLogoId = app.logos.length ? app.logos[0].id : null;
    if (!app.logos.length) settings.logo.source = 'brand';
    refreshControls();
    schedulePreview();
    showToast('已删除 logo');
  }

  async function geocodeActive() {
    var file = activeFile();
    if (!file) {
      showToast('请先载入图片', 'warn');
      return;
    }
    var summary = file.report.summary;
    if (!isFinite(summary.latitude) || !isFinite(summary.longitude)) {
      showToast('这张图片没有可用的 GPS 坐标', 'warn');
      return;
    }
    showProgress('联网查询地点…', 1);
    updateProgress(0, 1, '请求 OpenStreetMap Nominatim');
    try {
      var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=zh-CN' +
        '&lat=' + encodeURIComponent(summary.latitude.toFixed(6)) +
        '&lon=' + encodeURIComponent(summary.longitude.toFixed(6));
      var res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      var name = data.display_name || data.name || '';
      if (!name) throw new Error('没有返回地点');
      file.remoteLocation = name;
      settings.content.locationMode = 'remote';
      refreshControls();
      schedulePreview();
      showToast('已获取地点：' + name);
    } catch (e) {
      showToast('联网查询失败（需要网络）：' + e.message, 'error');
    } finally {
      hideProgress();
    }
  }

  function handleAction(action) {
    switch (action) {
      case 'geocode': geocodeActive(); break;
      case 'importLogo': $id('logo-input').click(); break;
      case 'deleteLogo': deleteCurrentLogo(); break;
      default: break;
    }
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */
  function exportTokens(file, seq) {
    var summary = file.report.summary;
    var brand = currentBrand(summary);
    var d = summary.date;
    return {
      name: baseName(file.name),
      brand: brand.name,
      model: summary.model || '',
      date: d ? d.y + pad2(d.m) + pad2(d.d) : '',
      time: d ? pad2(d.h) + pad2(d.mi) + pad2(d.s) : '',
      seq: pad2(seq || 1)
    };
  }

  function flattenCanvas(source, color) {
    var canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = color || '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
    return canvas;
  }

  async function exportFile(file, seq) {
    var outFormat = settings.output.format;
    if (outFormat === 'original') outFormat = file.parsed.format === 'png' ? 'png' : 'jpeg';
    var summary = file.report.summary;
    var brand = currentBrand(summary);
    var enabled = logoEnabled(summary);
    var aspect = logoAspectFor(summary);
    var bitmap = await decodeBitmap(file.blob);
    var rawSize = rawPixelSize(file.parsed);
    var display = render.displaySize(bitmap, file.parsed.orientation, rawSize.width, rawSize.height);
    var target = exporter.targetDimensions(display.width, display.height, settings.output);
    var photo = render.normalizePhoto(bitmap, file.parsed.orientation, rawSize.width, rawSize.height, target.width, target.height);
    if (bitmap.close) bitmap.close();
    var luminance = render.sampleLuminance(photo);
    var fmt = previewDateFormatter();
    var scene = layout.compose({
      imageW: target.width,
      imageH: target.height,
      meta: summary,
      settings: settings,
      brandName: brand.name,
      logoAspect: aspect,
      logoEnabled: enabled,
      luminance: luminance,
      remoteLocation: file.remoteLocation,
      formatDateOnly: fmt.date,
      formatTimeOnly: fmt.time
    });
    var logoAsset = await buildLogoAsset(scene, summary, 2);
    var canvas = document.createElement('canvas');
    render.draw(canvas, scene, { photo: photo, logo: logoAsset });
    var finalCanvas = canvas;
    if (outFormat === 'jpeg') {
      finalCanvas = flattenCanvas(canvas, settings.output.flattenColor);
    }
    var sourceBytes = null;
    if (outFormat === 'png' && file.parsed.format === 'png') {
      sourceBytes = file.bytes || new Uint8Array(await file.blob.arrayBuffer());
    }
    var result = await exporter.encodeWithMetadata({
      canvas: finalCanvas,
      format: outFormat,
      quality: settings.output.quality,
      keepMetadata: settings.output.keepMetadata,
      parsed: file.parsed,
      sourceBytes: sourceBytes,
      width: finalCanvas.width,
      height: finalCanvas.height
    });
    var tokens = exportTokens(file, seq || 1);
    var filename = exporter.buildFilename(settings.output.filenamePattern, tokens, exporter.extFor(outFormat));
    var warnings = result.warnings || [];
    if (target.limited) warnings.push(target.note);
    try {
      photo.width = 0;
      photo.height = 0;
      canvas.width = 0;
      canvas.height = 0;
      if (finalCanvas !== canvas) {
        finalCanvas.width = 0;
        finalCanvas.height = 0;
      }
    } catch (e) { /* ignore */ }
    return { blob: result.blob, filename: filename, warnings: warnings };
  }

  async function exportActive() {
    if (app.exporting) return;
    var file = activeFile();
    if (!file) {
      showToast('请先载入图片', 'warn');
      return;
    }
    app.exporting = true;
    updateExportButtons();
    showProgress('正在导出水印图片…', 1);
    updateProgress(0, 1, file.name);
    try {
      await new Promise(function (r) { setTimeout(r, 30); });
      var result = await exportFile(file, 1);
      updateProgress(1, 1, result.filename);
      exporter.download(result.blob, result.filename);
      if (result.warnings.length) showToast('已导出（' + result.warnings.length + ' 条提示）：' + result.warnings[0], 'warn');
      else showToast('已导出：' + result.filename);
    } catch (e) {
      showToast('导出失败：' + e.message, 'error');
    } finally {
      app.exporting = false;
      hideProgress();
      updateExportButtons();
    }
  }

  async function exportAll() {
    if (app.exporting) return;
    if (!app.files.length) {
      showToast('请先载入图片', 'warn');
      return;
    }
    app.exporting = true;
    app.cancelExport = false;
    updateExportButtons();
    showProgress('批量导出…', app.files.length);
    var results = [];
    var warnings = [];
    try {
      for (var i = 0; i < app.files.length; i++) {
        if (app.cancelExport) break;
        var file = app.files[i];
        updateProgress(i, app.files.length, file.name);
        var res = await exportFile(file, i + 1);
        results.push({ name: res.filename, blob: res.blob });
        if (res.warnings.length) warnings = warnings.concat(res.warnings);
        updateProgress(i + 1, app.files.length, res.filename);
        await new Promise(function (r) { setTimeout(r, 10); });
      }
      if (app.cancelExport) {
        showToast('已取消批量导出');
        return;
      }
      if (settings.output.includeJson) {
        var jsonData = app.files.map(function (f) {
          return { name: f.name, metadata: meta.reportToJson(f.parsed, f.report) };
        });
        var jsonBlob = new Blob([JSON.stringify(jsonData.length === 1 ? jsonData[0] : jsonData, null, 2)], { type: 'application/json' });
        results.push({ name: 'metadata.json', blob: jsonBlob });
      }
      if (settings.output.zipBatch && results.length > 1) {
        var zipBlob = await exporter.zip(results, function (done, total, name) {
          updateProgress(done, total, name);
        });
        updateProgress(results.length, results.length, '打包完成');
        var stamp = new Date();
        var zipName = 'watermark-' + stamp.getFullYear() + pad2(stamp.getMonth() + 1) + pad2(stamp.getDate()) +
          '-' + pad2(stamp.getHours()) + pad2(stamp.getMinutes()) + '.zip';
        exporter.download(zipBlob, zipName);
        showToast('已导出 ' + results.length + ' 个文件（' + zipName + '）' + (warnings.length ? '，' + warnings.length + ' 条提示' : ''));
      } else {
        for (var j = 0; j < results.length; j++) {
          exporter.download(results[j].blob, results[j].name);
          await new Promise(function (r) { setTimeout(r, 260); });
        }
        showToast('已导出 ' + results.length + ' 张图片' + (warnings.length ? '，' + warnings.length + ' 条提示' : ''));
      }
    } catch (e) {
      showToast('批量导出失败：' + e.message, 'error');
    } finally {
      app.exporting = false;
      hideProgress();
      updateExportButtons();
    }
  }

  function updateExportSummary() {
    var file = activeFile();
    var resolvedFormat = settings.output.format === 'original'
      ? (file && file.parsed.format === 'png' ? 'png' : 'jpeg')
      : settings.output.format;
    var formatLabel = settings.output.format === 'original'
      ? '原格式'
      : settings.output.format === 'jpeg' ? 'JPEG' : settings.output.format === 'png' ? 'PNG' : 'WebP';
    var parts = [formatLabel];
    if (file) {
      var target = exporter.targetDimensions(file.fullW, file.fullH, settings.output);
      parts.push(target.width + ' × ' + target.height);
      if (target.limited) parts.push('已限制');
    } else {
      parts.push('原图尺寸');
    }
    if (resolvedFormat !== 'png') parts.push('质量 ' + Math.round(settings.output.quality * 100) + '%');
    if (!settings.output.keepMetadata) parts.push('不保留元数据');
    var summary = parts.join(' · ');
    var fmtNode = $id('export-format');
    if (fmtNode) fmtNode.textContent = summary;
    var exportBtn = $id('btn-export');
    if (exportBtn) exportBtn.title = summary + (file ? '（当前图片）' : '');
    var hint = '';
    if (app.files.length > 1) hint = '共 ' + app.files.length + ' 张';
    else if (settings.output.keepMetadata) hint = 'EXIF 回写';
    var hintNode = $id('export-hint');
    if (hintNode) hintNode.textContent = hint;
  }

  function updateExportButtons() {
    var has = !!activeFile();
    $id('btn-export').disabled = !has || app.exporting;
    $id('btn-import').disabled = app.exporting;
    $id('btn-compare').disabled = !has;
    updateExifActions();
  }

  /* ------------------------------------------------------------------ *
   * 左右侧栏拖动与宽度记忆
   * ------------------------------------------------------------------ */
  var PANEL_STORAGE_KEY = 'wm.panel-widths.v1';
  var PANEL_LIMITS = {
    left: { min: 280, max: 620, def: 336 },
    right: { min: 300, max: 680, def: 378 }
  };
  var PANEL_CENTER_MIN = 360;
  var PANEL_CHROME_WIDTH = 36; // 2 个 10px 手柄 + 4 个 4px gap

  function clampPanelValue(value, min, max) {
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  function readPanelWidths() {
    try {
      var raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (!raw) return { left: PANEL_LIMITS.left.def, right: PANEL_LIMITS.right.def };
      var parsed = JSON.parse(raw);
      var left = Number(parsed.left);
      var right = Number(parsed.right);
      if (!isFinite(left) || !isFinite(right)) throw new Error('bad widths');
      return {
        left: clampPanelValue(left, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max),
        right: clampPanelValue(right, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max)
      };
    } catch (e) {
      return { left: PANEL_LIMITS.left.def, right: PANEL_LIMITS.right.def };
    }
  }

  function savePanelWidths() {
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(app.panelWidths));
    } catch (e) { /* localStorage may be unavailable */ }
  }

  function panelAvailableWidth() {
    var ws = document.querySelector('.workspace');
    if (!ws) return 0;
    var style = getComputedStyle(ws);
    var padLeft = parseFloat(style.paddingLeft) || 0;
    var padRight = parseFloat(style.paddingRight) || 0;
    return Math.max(0, ws.clientWidth - padLeft - padRight);
  }

  function limitPanelWidths(left, right) {
    var available = panelAvailableWidth();
    if (window.innerWidth <= 1080) {
      return {
        left: clampPanelValue(left, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max),
        right: clampPanelValue(right, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max),
        maxPair: PANEL_LIMITS.left.max + PANEL_LIMITS.right.max
      };
    }
    var maxPair = Math.max(
      PANEL_LIMITS.left.min + PANEL_LIMITS.right.min,
      available - PANEL_CHROME_WIDTH - PANEL_CENTER_MIN
    );
    left = clampPanelValue(left, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max);
    right = clampPanelValue(right, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max);
    if (left + right > maxPair) {
      var over = left + right - maxPair;
      var reducibleLeft = left - PANEL_LIMITS.left.min;
      var reducibleRight = right - PANEL_LIMITS.right.min;
      var reducible = reducibleLeft + reducibleRight;
      if (reducible > 0) {
        left -= over * (reducibleLeft / reducible);
        right -= over * (reducibleRight / reducible);
      }
      left = clampPanelValue(left, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max);
      right = clampPanelValue(right, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max);
    }
    return { left: left, right: right, maxPair: maxPair };
  }

  function applyPanelWidths(left, right) {
    var desired = {
      left: clampPanelValue(left, PANEL_LIMITS.left.min, PANEL_LIMITS.left.max),
      right: clampPanelValue(right, PANEL_LIMITS.right.min, PANEL_LIMITS.right.max)
    };
    app.panelWidths = desired;
    var widths = limitPanelWidths(desired.left, desired.right);
    app.panelApplied = { left: widths.left, right: widths.right };
    // 变量设在 :root 上：.workspace 与 .bottom-dock 同时继承，
    // 底部左右两张卡片的宽度因此与两侧栏像素级对齐。
    var root = document.documentElement;
    root.style.setProperty('--panel-left-width', widths.left + 'px');
    root.style.setProperty('--panel-right-width', widths.right + 'px');
    var ws = document.querySelector('.workspace');
    if (ws) {
      ws.style.setProperty('--panel-left-width', widths.left + 'px');
      ws.style.setProperty('--panel-right-width', widths.right + 'px');
    }
    Array.prototype.forEach.call(document.querySelectorAll('.resize-handle'), function (handle) {
      var side = handle.dataset.resize;
      var min = PANEL_LIMITS[side].min;
      var otherMin = side === 'left' ? PANEL_LIMITS.right.min : PANEL_LIMITS.left.min;
      var max = Math.min(PANEL_LIMITS[side].max, widths.maxPair - otherMin);
      handle.setAttribute('aria-valuemin', String(min));
      handle.setAttribute('aria-valuemax', String(max));
      handle.setAttribute('aria-valuenow', String(app.panelApplied[side]));
      handle.title = '拖动调整' + (side === 'left' ? '左' : '右') + '侧栏宽度，双击恢复默认';
    });
    return app.panelApplied;
  }

  function initPanelResizers() {
    var ws = document.querySelector('.workspace');
    if (!ws) return;
    var stored = readPanelWidths();
    applyPanelWidths(stored.left, stored.right);

    var drag = null;
    var handles = document.querySelectorAll('.resize-handle');

    function finishDrag() {
      if (!drag) return;
      var handle = drag.handle;
      drag = null;
      document.body.classList.remove('resizing');
      if (handle) handle.classList.remove('active');
      savePanelWidths();
    }

    Array.prototype.forEach.call(handles, function (handle) {
      var side = handle.dataset.resize;
      if (!PANEL_LIMITS[side]) return;

      handle.addEventListener('pointerdown', function (e) {
        if (window.innerWidth <= 1080 || e.button !== 0) return;
        e.preventDefault();
        drag = {
          side: side,
          handle: handle,
          startX: e.clientX,
          startLeft: app.panelApplied.left,
          startRight: app.panelApplied.right
        };
        try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        handle.classList.add('active');
        document.body.classList.add('resizing');
      });

      handle.addEventListener('dblclick', function (e) {
        e.preventDefault();
        var nextLeft = side === 'left' ? PANEL_LIMITS.left.def : app.panelWidths.left;
        var nextRight = side === 'right' ? PANEL_LIMITS.right.def : app.panelWidths.right;
        applyPanelWidths(nextLeft, nextRight);
        savePanelWidths();
      });

      handle.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        var step = 16;
        if (side === 'left') {
          applyPanelWidths(app.panelApplied.left + (e.key === 'ArrowRight' ? step : -step), app.panelWidths.right);
        } else {
          applyPanelWidths(app.panelWidths.left, app.panelApplied.right + (e.key === 'ArrowLeft' ? step : -step));
        }
        savePanelWidths();
      });
    });

    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var delta = e.clientX - drag.startX;
      if (drag.side === 'left') {
        applyPanelWidths(drag.startLeft + delta, drag.startRight);
      } else {
        applyPanelWidths(drag.startLeft, drag.startRight - delta);
      }
    });
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);

    var applySoon = (function () {
      var frame = 0;
      return function () {
        if (frame) return;
        frame = requestAnimationFrame(function () {
          frame = 0;
          applyPanelWidths(app.panelWidths.left, app.panelWidths.right);
        });
      };
    })();
    window.addEventListener('resize', applySoon);
    if (window.ResizeObserver) {
      try {
        new ResizeObserver(applySoon).observe(ws);
      } catch (e) { /* ignore */ }
    }
  }

  /* ------------------------------------------------------------------ *
   * 帮助与初始化
   * ------------------------------------------------------------------ */
  function showHelp() {
    var body = el('div');
    var sections = [
      ['快捷键', 'Ctrl / Cmd + V 粘贴图片 · Ctrl / Cmd + S 导出当前图片 · Esc 关闭弹窗或取消导出'],
      ['字段编辑', '左栏常用栏固定列出全部可上水印的字段，双击即可修改或填入；改的只是水印与界面，不写回原图、不影响导出元数据。「显示全部」为只读全量信息。'],
      ['读数范围', 'JPEG：EXIF（IFD0 / Exif / GPS / Interop / 缩略图）、XMP、IPTC、ICC、JFIF、量化表与霍夫曼表；PNG：全部关键块、eXIf、tEXt / zTXt / iTXt、pHYs、tIME、iCCP。厂商 MakerNote 仅展示存在与十六进制，不做私有解码。'],
      ['导出与元数据', 'JPEG 导出默认回写 EXIF / XMP / IPTC：Orientation 归 1，PixelXDimension / PixelYDimension 按新尺寸更新。PNG 导出保留 tEXt / zTXt / iTXt / eXIf / pHYs / tIME。WebP 暂不支持回写。'],
      ['品牌徽标', '内置的是按品牌字体风格排版的「字样徽标」，不是官方图形商标；需要官方 logo 时可在「品牌徽标」里导入自己的 PNG / SVG。'],
      ['隐私', '图片只在本机浏览器内处理，不上传服务器；仅在点击「联网查询 GPS 地点」时会向 OpenStreetMap Nominatim 发送坐标。'],
      ['限制', '浏览器 canvas 单边上限 16384px、面积约 2.68 亿像素，超出会自动限制并提示。处理超大图时请逐张导出。']
    ];
    sections.forEach(function (pair) {
      var p = el('p');
      p.appendChild(el('strong', null, pair[0] + '：'));
      p.appendChild(document.createTextNode(pair[1]));
      body.appendChild(p);
    });
    openModal({
      title: '使用说明',
      body: body,
      actions: [{ label: '知道了', primary: true }]
    });
  }

  async function loadDemo(name) {
    try {
      var res = await fetch('fixtures/' + encodeURIComponent(name));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var blob = await res.blob();
      var file = new File([blob], name, { type: blob.type || 'image/jpeg' });
      await addFiles([file]);
    } catch (e) {
      if (window.console) console.error('[WM] demo', e);
      setStatus('示例载入失败：' + e.message);
      showToast('示例载入失败：' + e.message + '（请通过本地服务器打开）', 'warn');
    }
  }

  function openFilePicker() { $id('file-input').click(); }

  function dragHighlight(on) {
    var stage = $id('stage');
    if (stage) stage.classList.toggle('dragover', !!on);
    var empty = $id('empty-state');
    if (empty) empty.classList.toggle('dragover', !!on);
  }

  function bindEvents() {
    var emptyState = $id('empty-state');
    if (emptyState) {
      emptyState.addEventListener('click', openFilePicker);
      emptyState.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFilePicker();
        }
      });
    }
    $id('file-input').addEventListener('change', function () {
      if (this.files && this.files.length) addFiles(this.files);
      this.value = '';
    });
    $id('logo-input').addEventListener('change', function () {
      if (this.files && this.files[0]) importLogoFile(this.files[0]);
      this.value = '';
    });
    $id('preset-input').addEventListener('change', function () {
      if (this.files && this.files[0]) importPresetsFile(this.files[0]);
      this.value = '';
    });
    $id('btn-help').addEventListener('click', showHelp);
    $id('btn-compare').addEventListener('pointerdown', function () {
      app.compareOriginal = true;
      schedulePreview();
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evt) {
      $id('btn-compare').addEventListener(evt, function () {
        if (!app.compareOriginal) return;
        app.compareOriginal = false;
        schedulePreview();
      });
    });
    var stageEl = $id('stage');
    if (stageEl) {
      // 滚轮缩放：最大 = 自适应；向上滚放大，向下滚缩小
      stageEl.addEventListener('wheel', function (e) {
        if (!activeFile()) return;
        var delta = e.deltaY || e.deltaX;
        if (!delta) return;
        e.preventDefault();
        setPreviewZoom(app.previewZoom + (delta < 0 ? ZOOM_STEP : -ZOOM_STEP));
      }, { passive: false });
      // 双击恢复自适应大小
      stageEl.addEventListener('dblclick', function (e) {
        if (!activeFile()) return;
        e.preventDefault();
        app.previewZoom = 1;
        refreshPreviewFit();
      });
    }
    window.addEventListener('resize', function () {
      if (app.zoomRaf) cancelAnimationFrame(app.zoomRaf);
      app.zoomRaf = requestAnimationFrame(function () {
        app.zoomRaf = 0;
        refreshPreviewFit();
      });
    });
    if (window.ResizeObserver) {
      var stageWatch = $id('stage');
      if (stageWatch) {
        var ro = new ResizeObserver(function () {
          if (app.zoomRaf) cancelAnimationFrame(app.zoomRaf);
          app.zoomRaf = requestAnimationFrame(function () {
            app.zoomRaf = 0;
            refreshPreviewFit();
          });
        });
        ro.observe(stageWatch);
      }
    }
    $id('btn-import').addEventListener('click', openFilePicker);
    $id('btn-export').addEventListener('click', exportActive);
    var exportSettingsBtn = $id('btn-export-settings');
    if (exportSettingsBtn) exportSettingsBtn.addEventListener('click', openExportSettings);
    var exifScopeBtn = $id('btn-exif-all');
    if (exifScopeBtn) exifScopeBtn.addEventListener('click', toggleExifScope);
    bindPresetBar();
    $id('btn-reset-exif').addEventListener('click', resetExifEdits);
    $id('exif-search').addEventListener('input', filterExif);
    $id('modal-close').addEventListener('click', closeModal);
    $id('modal').addEventListener('click', function (e) {
      if (e.target === $id('modal')) closeModal();
    });
    $id('btn-cancel').addEventListener('click', function () {
      app.cancelExport = true;
      showToast('已请求取消…');
    });

    // 底部图片列表：图片过多时用鼠标滚轮左右滑动
    var galleryRow = $id('bottom-gallery');
    if (galleryRow) {
      galleryRow.addEventListener('wheel', function (e) {
        if (galleryRow.scrollWidth <= galleryRow.clientWidth + 1) return;
        var delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!delta) return;
        e.preventDefault();
        galleryRow.scrollLeft += delta;
      }, { passive: false });
    }

    var dragCount = 0;
    var internalDrag = false;
    function hasFiles(e) {
      return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
    }
    document.addEventListener('dragstart', function (e) {
      if (e.target && e.target.closest && e.target.closest('#bottom-gallery')) {
        internalDrag = true;
        e.preventDefault();
      }
    });
    document.addEventListener('dragend', function () { internalDrag = false; });
    window.addEventListener('dragenter', function (e) {
      if (internalDrag || !hasFiles(e)) return;
      e.preventDefault();
      dragCount++;
      $id('drop-overlay').hidden = false;
      dragHighlight(true);
    });
    window.addEventListener('dragover', function (e) {
      if (internalDrag || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      dragCount = Math.max(0, dragCount - 1);
      if (!dragCount) {
        $id('drop-overlay').hidden = true;
        dragHighlight(false);
      }
    });
    window.addEventListener('drop', function (e) {
      if (internalDrag) {
        internalDrag = false;
        dragCount = 0;
        $id('drop-overlay').hidden = true;
        dragHighlight(false);
        return;
      }
      if (!hasFiles(e) || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      dragCount = 0;
      $id('drop-overlay').hidden = true;
      dragHighlight(false);
      addFiles(e.dataTransfer.files);
    });

    document.addEventListener('paste', function (e) {
      var items = e.clipboardData && e.clipboardData.files;
      if (items && items.length) {
        e.preventDefault();
        addFiles(items);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (!$id('modal').hidden) {
        if (e.key === 'Escape') closeModal();
        return;
      }
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        exportActive();
      } else if (e.key === 'Escape' && !$id('progress').hidden) {
        app.cancelExport = true;
      }
    });

    window.addEventListener('beforeunload', function () {
      state.saveSettingsNow(settings);
    });
  }

  async function loadStoredLogos() {
    app.logos = await state.listLogos();
    if (settings.logo.source === 'custom' && !app.logos.length) {
      settings.logo.source = 'brand';
      settings.logo.customLogoId = null;
      state.saveSettingsDebounced(settings);
    }
    refreshControls();
  }

  function init() {
    initTheme();
    app.exifShowAll = state.loadExifShowAll();
    bindEvents();
    initPanelResizers();
    buildControls();
    refreshControls();
    renderPresets();
    updateExifScopeButton();
    renderActivePhoto();
    renderFileList();
    updateExportButtons();
    updateExportSummary();
    var params = new URLSearchParams(location.search);
    loadStoredLogos().then(function () {
      if (params.has('demo') && location.protocol !== 'file:') {
        loadDemo(params.get('demo') || 'canon-r5.jpg');
      }
    });
    schedulePreview();
  }

  WM.ui = {
    init: init,
    addFiles: addFiles,
    loadDemo: loadDemo,
    settings: settings,
    state: app,
    _exportFile: exportFile
  };
})();
