#!/usr/bin/env node
/**
 * 通过 Chrome DevTools Protocol 运行浏览器端检查（不依赖三方包）。
 *
 *   node tests/cdp-check.mjs selftest http://127.0.0.1:5173/tests/browser-selftest.html
 *   node tests/cdp-check.mjs app      "http://127.0.0.1:5173/?demo=canon-r5.jpg"
 *   node tests/cdp-check.mjs left     "http://127.0.0.1:5173/"
 *   node tests/cdp-check.mjs resize   "http://127.0.0.1:5173/?demo=canon-r5.jpg"
 *
 * 注意：Chrome 需要命名管道，在受限沙箱中无法启动；请在允许启动浏览器的环境运行。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => {
  try { return fs.existsSync(p); } catch { return false; }
});
if (!chromePath) {
  console.error('找不到 Chrome / Edge，可用 CHROME 环境变量指定路径。');
  process.exit(2);
}

const mode = process.argv[2] || 'selftest';
const url = process.argv[3] || 'http://127.0.0.1:5173/';
const port = Number(process.env.CDP_PORT || (9300 + Math.floor(Math.random() * 300)));
const profile = path.join(os.tmpdir(), 'wm-cdp-' + Date.now() + '-' + port);

const chrome = spawn(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-breakpad',
  '--no-first-run',
  '--hide-scrollbars',
  '--window-size=1600,1000',
  '--remote-debugging-port=' + port,
  '--user-data-dir=' + profile,
  url
], { stdio: 'ignore' });

let finished = false;
function stopChrome() {
  if (finished) return;
  finished = true;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      chrome.kill('SIGKILL');
    }
  } catch { /* ignore */ }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTarget() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      if (res.ok) {
        const list = await res.json();
        const found = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (found) return found;
      }
    } catch { /* not ready */ }
    await sleep(250);
  }
  throw new Error('等待 Chrome DevTools 超时');
}

async function main() {
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const consoleMessages = [];
  const exceptions = [];
  let messageId = 0;

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const args = (msg.params.args || []).map((a) => {
        if (a.value !== undefined) return String(a.value);
        if (a.description) return a.description;
        return a.type;
      });
      consoleMessages.push(msg.params.type + ': ' + args.join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push((d && (d.exception?.description || d.text)) || 'unknown exception');
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')), { once: true });
  });

  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }

  await send('Runtime.enable');
  await send('Page.enable');

  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      const ex = result.exceptionDetails.exception || {};
      const detail = ex.description || ex.value || result.exceptionDetails.text || 'evaluate 失败';
      throw new Error(detail);
    }
    return result.result ? result.result.value : undefined;
  }

  const probe = `(() => {
    const banner = document.getElementById('wm-error-banner');
    const files = (window.WM && WM.ui && WM.ui.state && WM.ui.state.files) ? WM.ui.state.files.map(f => ({
      name: f.name,
      orient: f.parsed && f.parsed.orientation,
      full: f.fullW + 'x' + f.fullH,
      preview: f.previewPhoto ? f.previewPhoto.width + 'x' + f.previewPhoto.height : '',
      scene: f.report ? 'ok' : ''
    })) : [];
    return JSON.stringify({
      title: document.title,
      summary: (document.getElementById('summary') || {}).textContent || '',
      results: ((document.getElementById('results') || {}).textContent || '').slice(0, 20000),
      banner: banner ? banner.textContent : '',
      fileCards: document.querySelectorAll('#bottom-gallery .file-card').length,
      activeThumb: !!document.querySelector('#bottom-gallery .file-card.active img'),
      activeName: (document.querySelector('#bottom-gallery .file-card.active') || { dataset: {} }).dataset.name || '',
      activeTab: '',
      hasLeftExport: !!document.querySelector('.panel-left .exportbar'),
      hasRightExport: !!document.querySelector('.panel-right .exportbar'),
      hasBottomDock: !!document.querySelector('.bottom-dock'),
      hasDockExport: !!document.querySelector('.dock-gallery #btn-export'),
      hasPhotoBackdrop: !!(document.getElementById('photo-backdrop') && document.body.classList.contains('has-photo')),
      status: (document.getElementById('preview-status') || {}).textContent || '',
      exifRows: document.querySelectorAll('#exif-body .exif-row').length,
      controls: document.querySelectorAll('.ctrl-section').length,
      files,
      template: (window.WM && WM.ui) ? WM.ui.settings.template : '',
      canvas: (() => { const c = document.getElementById('preview'); return c && !c.hidden ? c.width + 'x' + c.height : ''; })()
    });
  })()`;

  const deadline = Date.now() + (mode === 'selftest' ? 90000 : 45000);
  let state = null;
  while (Date.now() < deadline) {
    await sleep(500);
    try {
      state = JSON.parse(await evaluate(probe));
    } catch (e) {
      continue;
    }
    if (mode === 'selftest') {
      if (state.title.indexOf('SELFTEST') === 0) break;
    } else if (mode === 'file') {
      if (state.controls > 2 || state.banner) break;
    } else if (mode === 'real') {
      if (state.controls > 2 || state.banner) break;
    } else if (mode === 'files') {
      if (state.controls > 2 || state.banner) break;
    } else if (mode === 'left') {
      if (state.controls > 2 || state.banner) break;
    } else {
      if (state.banner || /失败/.test(state.status)) break;
      if (state.activeThumb && (state.canvas || /已渲染/.test(state.status))) break;
    }
  }

  if (mode === 'selftest') {
    const passed = state && state.title.indexOf('SELFTEST PASSED') === 0;
    console.log(state ? state.summary : '没有拿到测试结果');
    if (state && state.results) {
      const lines = state.results.split('\n');
      lines.filter((l) => l.startsWith('FAIL')).forEach((l) => console.log(l));
      console.log('（共 ' + lines.length + ' 条断言）');
    }
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    if (consoleMessages.length) console.log('控制台：\n' + consoleMessages.slice(-20).join('\n'));
    stopChrome();
    process.exit(passed ? 0 : 1);
  } else if (mode === 'logo') {
    const expression = `(async () => {
      const blob = await (await fetch('fixtures/minimal.png')).blob();
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'selftest-logo.png', { type: 'image/png' }));
      const input = document.getElementById('logo-input');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1000));
      return JSON.stringify({
        source: WM.ui.settings.logo.source,
        count: WM.ui.state.logos.length,
        logoId: WM.ui.settings.logo.customLogoId,
        status: document.getElementById('preview-status').textContent,
        banner: (document.getElementById('wm-error-banner') || {}).textContent || ''
      });
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    await sleep(600);
    const dir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, 'custom-logo.png'), Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    try {
      await evaluate(`(async () => { const id = WM.ui.settings.logo.customLogoId; if (id) await WM.state.deleteLogo(id); return true; })()`);
    } catch { /* ignore */ }
    const healthy = result.source === 'custom' && result.count > 0 && !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'files') {
    const expression = `(async () => {
      const load = async (name, type) => {
        const res = await fetch('fixtures/' + name);
        if (!res.ok) throw new Error('fixture HTTP ' + res.status);
        const blob = await res.blob();
        return new File([blob], name, { type });
      };
      await WM.ui.addFiles([await load('canon-r5.jpg', 'image/jpeg')]);
      const firstActive = WM.ui.state.activeId;
      await WM.ui.addFiles([await load('nikon-z6.png', 'image/png')]);
      await new Promise((r) => setTimeout(r, 1200));
      const active = WM.ui.state.files.find((f) => f.id === WM.ui.state.activeId);
      const cards = Array.from(document.querySelectorAll('#bottom-gallery .file-card'));
      return JSON.stringify({
        count: WM.ui.state.files.length,
        activeName: active ? active.name : '',
        switched: firstActive !== WM.ui.state.activeId,
        fileCards: cards.length,
        activeCard: !!document.querySelector('#bottom-gallery .file-card.active'),
        activeThumb: !!document.querySelector('#bottom-gallery .file-card.active img'),
        activeNameText: (document.querySelector('#bottom-gallery .file-card.active') || { dataset: {} }).dataset.name || '',
        exifHidden: document.getElementById('panel-exif').hidden,
        hasBottomDock: !!document.querySelector('.bottom-dock'),
        hasDockExport: !!document.querySelector('.dock-gallery #btn-export'),
        hasLeftExport: !!document.querySelector('.panel-left .exportbar'),
        hasRightExport: !!document.querySelector('.panel-right .exportbar'),
        hasPhotoBackdrop: !!(document.getElementById('photo-backdrop') && document.body.classList.contains('has-photo')),
        canvas: (() => { const c = document.getElementById('preview'); return c && !c.hidden ? c.width + 'x' + c.height : ''; })(),
        banner: (document.getElementById('wm-error-banner') || {}).textContent || ''
      });
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const healthy = result.count === 2 && result.activeName === 'nikon-z6.png' && result.switched &&
      result.fileCards === 2 && result.activeCard && result.activeThumb &&
      result.activeNameText === 'nikon-z6.png' && !result.exifHidden &&
      result.hasBottomDock && result.hasDockExport && !result.hasLeftExport && !result.hasRightExport &&
      result.hasPhotoBackdrop && result.canvas && !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'real') {
    const expression = `(async () => {
      const res = await fetch('testTruePhoto/IMG_6507.PNG');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      const file = new File([blob], 'IMG_6507.PNG', { type: 'image/png' });
      await WM.ui.addFiles([file]);
      await new Promise((r) => setTimeout(r, 1500));
      const f = WM.ui.state.files[0];
      const s = f ? f.report.summary : {};
      const c = document.getElementById('preview');
      document.querySelectorAll('#exif-body details').forEach((d) => { d.open = true; });
      const makeRow = document.querySelector('#exif-body .exif-row[data-field="make"]');
      let editAfter = null;
      let editReset = null;
      if (makeRow) {
        makeRow.querySelector('.exif-value').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 80));
        const input = makeRow.querySelector('.exif-edit-input');
        if (input) {
          input.value = 'CanonEdit';
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          await new Promise((r) => setTimeout(r, 350));
          editAfter = {
            make: f.report.summary.make,
            resetDisabled: document.getElementById('btn-reset-exif').disabled,
            editedMark: !!document.querySelector('#bottom-gallery .file-card.active .fc-badge')
          };
          document.getElementById('btn-reset-exif').click();
          await new Promise((r) => setTimeout(r, 350));
          editReset = {
            make: f.report.summary.make,
            resetDisabled: document.getElementById('btn-reset-exif').disabled
          };
        }
      }
      const currentSummary = f ? f.report.summary : {};
      return JSON.stringify({
        chips: WM.ui.state.files.length,
        dims: f ? f.fullW + 'x' + f.fullH : '',
        canvas: c && !c.hidden ? c.width + 'x' + c.height : '',
        summary: {
          source: currentSummary.metaSource, make: currentSummary.make, model: currentSummary.model,
          lens: currentSummary.lens,
          focal: currentSummary.focalText, aperture: currentSummary.apertureText,
          shutter: currentSummary.shutterText, iso: currentSummary.isoText
        },
        editAfter,
        editReset,
        status: document.getElementById('preview-status').textContent,
        banner: (document.getElementById('wm-error-banner') || {}).textContent || ''
      });
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    const dir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(dir, { recursive: true });
    await sleep(3400);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, 'real-png.png'), Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const healthy = result.summary && result.summary.iso === 'ISO 800' &&
      result.summary.make === 'Canon' && result.summary.model === 'EOS 200D II' &&
      result.summary.aperture === 'f/7.1' && result.summary.shutter === '1/200s' &&
      result.editAfter && result.editAfter.make === 'CanonEdit' && !result.editAfter.resetDisabled &&
      result.editAfter.editedMark && result.editReset && result.editReset.make === 'Canon' &&
      result.editReset.resetDisabled && result.canvas && !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'left') {
    const expression = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const load = async (name, type) => {
        const res = await fetch('fixtures/' + name);
        if (!res.ok) throw new Error('fixture HTTP ' + res.status);
        const blob = await res.blob();
        return new File([blob], name, { type });
      };
      const hash = () => {
        const c = document.getElementById('preview');
        const hc = document.createElement('canvas');
        hc.width = 160; hc.height = 160;
        hc.getContext('2d').drawImage(c, 0, 0, 160, 160);
        const d = hc.getContext('2d').getImageData(0, 0, 160, 160).data;
        let h = 2166136261;
        for (let i = 0; i < d.length; i += 4) {
          h = Math.imul(h ^ d[i], 16777619) >>> 0;
          h = Math.imul(h ^ d[i + 1], 16777619) >>> 0;
          h = Math.imul(h ^ d[i + 2], 16777619) >>> 0;
        }
        return h;
      };
      const editRow = async (field, text) => {
        document.querySelectorAll('#exif-body details').forEach((d) => { d.open = true; });
        await sleep(80);
        const row = document.querySelector('#exif-body .exif-row[data-field="' + field + '"]');
        if (!row) return { found: false };
        const before = hash();
        row.querySelector('.exif-value').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await sleep(80);
        const input = row.querySelector('.exif-edit-input');
        if (!input) return { found: true, input: false };
        input.value = text;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(350);
        return { found: true, input: true, before, after: hash() };
      };

      await WM.ui.addFiles([await load('canon-r5.jpg', 'image/jpeg'), await load('nikon-z6.png', 'image/png')]);
      await sleep(1100);
      const originalMake = WM.ui.state.files.find((f) => f.id === WM.ui.state.activeId).report.summary.make;
      const originalAperture = WM.ui.state.files.find((f) => f.id === WM.ui.state.activeId).report.summary.apertureText;

      const defaultExifHidden = document.getElementById('panel-exif').hidden;
      const activeThumb = !!document.querySelector('#bottom-gallery .file-card.active img');
      const activeNameBefore = (document.querySelector('#bottom-gallery .file-card.active') || { dataset: {} }).dataset.name || '';
      const exifVisibleAfterClick = !document.getElementById('panel-exif').hidden;

      const makeEdit = await editRow('make', 'TestCam');
      const file1 = WM.ui.state.files.find((f) => f.id === WM.ui.state.activeId);
      const resetAfterMake = {
        disabled: document.getElementById('btn-reset-exif').disabled,
        summaryMake: file1.report.summary.make,
        editedMark: !!document.querySelector('#bottom-gallery .file-card.active .fc-badge')
      };
      document.getElementById('btn-reset-exif').click();
      await sleep(300);
      const afterReset = {
        disabled: document.getElementById('btn-reset-exif').disabled,
        make: file1.report.summary.make,
        editedMark: !!document.querySelector('#bottom-gallery .file-card.active .fc-badge')
      };

      const apertureEdit = await editRow('aperture', '3.5');
      const apertureValue = file1.report.summary.apertureText;
      document.getElementById('btn-reset-exif').click();
      await sleep(300);

      const modelEdit = await editRow('model', 'TestModel');
      const modelValue = file1.report.summary.model;
      document.getElementById('btn-reset-exif').click();
      await sleep(300);

      const countBeforeRemove = WM.ui.state.files.length;
      const fileCardsBefore = document.querySelectorAll('#bottom-gallery .file-card').length;
      document.querySelector('#bottom-gallery .file-card.active .fc-x').click();
      await sleep(500);
      const removed = {
        count: WM.ui.state.files.length,
        activeName: (WM.ui.state.files.find((f) => f.id === WM.ui.state.activeId) || {}).name || '',
        activeThumb: !!document.querySelector('#bottom-gallery .file-card.active img')
      };

      return JSON.stringify({
        noChips: !document.getElementById('file-chips'),
        defaultExifHidden,
        exifVisibleAfterClick,
        activeThumb,
        activeNameText: activeNameBefore,
        fileCards: fileCardsBefore,
        hasLeftExport: !!document.querySelector('.panel-left .exportbar'),
        hasRightExport: !!document.querySelector('.panel-right .exportbar'),
        hasBottomDock: !!document.querySelector('.bottom-dock'),
        hasDockExport: !!document.querySelector('.dock-gallery #btn-export'),
        originalMake,
        originalAperture,
        makeEdit,
        makeChangedHash: makeEdit.found && makeEdit.input && makeEdit.before !== makeEdit.after,
        resetAfterMake,
        afterReset,
        apertureEdit,
        apertureChangedHash: apertureEdit.found && apertureEdit.input && apertureEdit.before !== apertureEdit.after,
        apertureValue,
        modelEdit,
        modelChangedHash: modelEdit.found && modelEdit.input && modelEdit.before !== modelEdit.after,
        modelValue,
        apertureRestored: file1.report.summary.apertureText === originalAperture,
        countBeforeRemove,
        removed,
        banner: (document.getElementById('wm-error-banner') || {}).textContent || ''
      });
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const shotDir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    await sleep(3400);
    const leftShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, 'left-panel.png'), Buffer.from(leftShot.data, 'base64'));
    const healthy = result.noChips && !result.defaultExifHidden && result.exifVisibleAfterClick &&
      result.activeThumb && result.activeNameText === 'nikon-z6.png' &&
      result.fileCards === 2 && result.hasBottomDock && result.hasDockExport &&
      !result.hasLeftExport && !result.hasRightExport &&
      result.makeEdit.found && result.makeEdit.input &&
      result.resetAfterMake.summaryMake === 'TestCam' && !result.resetAfterMake.disabled &&
      result.resetAfterMake.editedMark === true &&
      result.afterReset.make === result.originalMake && result.afterReset.disabled &&
      result.afterReset.editedMark === false &&
      result.apertureEdit.found && result.apertureEdit.input && result.apertureChangedHash &&
      result.apertureValue === 'f/3.5' && result.apertureRestored &&
      result.modelEdit.found && result.modelEdit.input && result.modelChangedHash &&
      result.modelValue === 'TestModel' &&
      result.countBeforeRemove === 2 && result.removed.count === 1 &&
      result.removed.activeName === 'canon-r5.jpg' && result.removed.activeThumb &&
      !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'resize') {
    const expression = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const ws = document.querySelector('.workspace');
      const center = document.querySelector('.panel-center');
      const leftHandle = document.querySelector('.resize-handle[data-resize="left"]');
      const rightHandle = document.querySelector('.resize-handle[data-resize="right"]');
      const state = () => {
        const leftPanel = document.querySelector('.panel-left').getBoundingClientRect();
        const rightPanel = document.querySelector('.panel-right').getBoundingClientRect();
        const centerCol = document.querySelector('.center-col').getBoundingClientRect();
        const previewPanel = document.querySelector('.panel-center');
        const previewRect = previewPanel.getBoundingClientRect();
        const dockGallery = document.querySelector('.dock-gallery').getBoundingClientRect();
        const presetBar = document.querySelector('.preset-bar');
        const controls = document.getElementById('controls');
        const meta = document.querySelector('.dock-gallery .dock-card-head');
        const cards = Array.from(document.querySelectorAll('#bottom-gallery .file-card'));
        const cardImgs = cards.map((c) => c.querySelector('img'));
        return {
          widths: { left: WM.ui.state.panelWidths.left, right: WM.ui.state.panelWidths.right },
          grid: getComputedStyle(ws).gridTemplateColumns,
          center: Math.round(centerCol.width),
          centerLeft: Math.round(centerCol.left),
          centerRight: Math.round(centerCol.right),
          leftAria: leftHandle.getAttribute('aria-valuenow'),
          rightAria: rightHandle.getAttribute('aria-valuenow'),
          dock: {
            galleryWidth: Math.round(dockGallery.width),
            galleryLeft: Math.round(dockGallery.left),
            galleryRight: Math.round(dockGallery.right),
            galleryHeight: Math.round(dockGallery.height),
            leftPanelWidth: Math.round(leftPanel.width),
            rightPanelWidth: Math.round(rightPanel.width),
            leftPanelBottom: Math.round(leftPanel.bottom),
            rightPanelBottom: Math.round(rightPanel.bottom),
            workspaceTop: Math.round(ws.getBoundingClientRect().top),
            workspaceBottom: Math.round(ws.getBoundingClientRect().bottom),
            exifPanelTop: Math.round(document.getElementById('panel-exif').getBoundingClientRect().top),
            exifPanelBottom: Math.round(document.getElementById('panel-exif').getBoundingClientRect().bottom),
            previewHeight: Math.round(previewRect.height),
            previewBottom: Math.round(previewRect.bottom),
            presetBarBottom: presetBar ? Math.round(presetBar.getBoundingClientRect().bottom) : null,
            controlsBottom: controls ? Math.round(controls.getBoundingClientRect().bottom) : null,
            titleText: meta ? (meta.querySelector('strong') || {}).textContent || '' : '',
            hasActions: !!document.querySelector('.dock-gallery .dock-card-head .dock-actions #btn-export'),
            actionsRight: (() => {
              const a = document.querySelector('.dock-gallery .dock-card-head .dock-actions');
              return a ? Math.round(a.getBoundingClientRect().right) : null;
            })(),
            headRight: meta ? Math.round(meta.getBoundingClientRect().right) : null,
            // Dock 放大：每张卡的 --dock-scale 与缩放后的实际高度/底边
            scales: cards.map((c) => Number(getComputedStyle(c).getPropertyValue('--dock-scale').trim() || '1')),
            cardHeights: cards.map((c) => Math.round(c.getBoundingClientRect().height)),
            cardBottoms: cards.map((c) => Math.round(c.getBoundingClientRect().bottom)),
            imgRatios: cardImgs.map((im) => im && im.naturalWidth && im.naturalHeight
              ? Number((im.naturalWidth / im.naturalHeight).toFixed(3)) : 0),
            activeIndex: WM.ui.state.files.findIndex((f) => f.id === WM.ui.state.activeId),
            // 预览区必须是「干净的一张照片」：没有工具栏/页脚，也没有卡片衬底
            hasPreviewToolbar: !!document.querySelector('.preview-toolbar'),
            hasPreviewFooter: !!document.querySelector('.preview-footer'),
            previewBg: getComputedStyle(previewPanel).backgroundColor,
            previewShadow: getComputedStyle(previewPanel).boxShadow,
            canvasRadius: (() => {
              const c = document.getElementById('preview');
              return c ? getComputedStyle(c).borderRadius : '';
            })(),
            cardGlow: getComputedStyle(document.querySelector('.dock-card')).boxShadow
          }
        };
      };
      const drag = (handle, dx) => {
        const rect = handle.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + Math.min(120, rect.height / 2);
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: y }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientX: x + dx, clientY: y }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: x + dx, clientY: y }));
      };
      const fonts = {
        body: parseFloat(getComputedStyle(document.body).fontSize),
        ctrl: parseFloat(getComputedStyle(document.querySelector('.ctrl-label')).fontSize),
        exif: parseFloat(getComputedStyle(document.querySelector('.exif-row') || document.body).fontSize),
        small: parseFloat(getComputedStyle(document.querySelector('.small')).fontSize)
      };
      // Dock 放大需要至少 4 张图（选中第 2 张，才能同时看到距离 0/1/2/≥3 四档）。
      const loadFixture = async (name, type) => {
        const res = await fetch('fixtures/' + name);
        if (!res.ok) throw new Error('fixture HTTP ' + res.status);
        const blob = await res.blob();
        return new File([blob], name, { type });
      };
      await WM.ui.addFiles([
        await loadFixture('canon-r5.jpg', 'image/jpeg'),
        await loadFixture('nikon-z6.png', 'image/png'),
        await loadFixture('canon-r5.jpg', 'image/jpeg'),
        await loadFixture('nikon-z6.png', 'image/png')
      ]);
      await sleep(1400);
      if (WM.ui.state.files.length > 1) {
        WM.ui.state.activeId = WM.ui.state.files[1].id;
        document.querySelectorAll('#bottom-gallery .file-card')[1].click();
        await sleep(420);
      }
      const initial = state();
      const handles = document.querySelectorAll('.resize-handle').length;
      const roles = Array.from(document.querySelectorAll('.resize-handle')).map((h) => ({
        role: h.getAttribute('role'), tabindex: h.getAttribute('tabindex')
      }));
      drag(leftHandle, 80);
      await sleep(120);
      const afterLeft = state();
      drag(rightHandle, -60);
      await sleep(120);
      const afterRight = state();
      leftHandle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(120);
      const afterReset = state();
      leftHandle.focus();
      leftHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      await sleep(120);
      const afterKey = state();
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('wm.panel-widths.v1')); } catch (e) { /* ignore */ }
      return JSON.stringify({
        fonts,
        handles,
        roles,
        initial,
        afterLeft,
        afterRight,
        afterReset,
        afterKey,
        stored,
        pageScroll: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        leftHandleVisible: getComputedStyle(leftHandle).display !== 'none',
        banner: (document.getElementById('wm-error-banner') || {}).textContent || ''
      });
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    const handleBox = JSON.parse(await evaluate(`(() => {
      const r = document.querySelector('.resize-handle[data-resize="left"]').getBoundingClientRect();
      return JSON.stringify({ x: r.left + r.width / 2, y: r.top + 120 });
    })()`));
    const beforeRealDrag = result.afterKey.widths.left;
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: handleBox.x, y: handleBox.y, button: 'left', clickCount: 1
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: handleBox.x + 50, y: handleBox.y, button: 'left', buttons: 1
    });
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: handleBox.x + 50, y: handleBox.y, button: 'left', clickCount: 1
    });
    await sleep(180);
    const realDrag = JSON.parse(await evaluate(`(() => {
      const ws = document.querySelector('.workspace');
      return JSON.stringify({
        left: WM.ui.state.panelWidths.left,
        center: Math.round(document.querySelector('.panel-center').getBoundingClientRect().width),
        grid: getComputedStyle(ws).gridTemplateColumns,
        resizing: document.body.classList.contains('resizing')
      });
    })()`));
    const shotDir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    await sleep(3400);
    const resizeShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, 'sidebar-resize.png'), Buffer.from(resizeShot.data, 'base64'));
    await evaluate(`(() => {
      const h = document.querySelector('.resize-handle[data-resize="left"]');
      h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    })()`);
    await sleep(120);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 900, height: 800, deviceScaleFactor: 1, mobile: false
    });
    await sleep(350);
    const mobile = JSON.parse(await evaluate(`(() => {
      const ws = document.querySelector('.workspace');
      const handles = Array.from(document.querySelectorAll('.resize-handle'));
      return JSON.stringify({
        grid: getComputedStyle(ws).gridTemplateColumns,
        handlesHidden: handles.every((h) => getComputedStyle(h).display === 'none'),
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth
      });
    })()`));
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(200);
    await send('Page.reload', { ignoreCache: true });
    await sleep(1800);
    const reloaded = JSON.parse(await evaluate(`(() => {
      const ws = document.querySelector('.workspace');
      return JSON.stringify({
        widths: window.WM && WM.ui ? { left: WM.ui.state.panelWidths.left, right: WM.ui.state.panelWidths.right } : null,
        grid: ws ? getComputedStyle(ws).gridTemplateColumns : ''
      });
    })()`));
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1100, height: 800, deviceScaleFactor: 1, mobile: false
    });
    await sleep(350);
    const narrow = JSON.parse(await evaluate(`(() => {
      const ws = document.querySelector('.workspace');
      const center = document.querySelector('.panel-center');
      const handles = Array.from(document.querySelectorAll('.resize-handle'));
      return JSON.stringify({
        grid: getComputedStyle(ws).gridTemplateColumns,
        center: Math.round(center.getBoundingClientRect().width),
        handlesVisible: handles.every((h) => getComputedStyle(h).display !== 'none'),
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        wide: Array.from(document.querySelectorAll('body *')).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > window.innerWidth + 2 || r.width > window.innerWidth + 2;
        }).slice(0, 12).map((el) => ({
          tag: el.tagName, cls: el.className, id: el.id,
          text: (el.textContent || '').trim().slice(0, 24),
          parent: el.parentElement ? el.parentElement.className : '',
          right: Math.round(el.getBoundingClientRect().right),
          width: Math.round(el.getBoundingClientRect().width)
        }))
      });
    })()`));
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(350);
    const restored = JSON.parse(await evaluate(`(() => {
      const ws = document.querySelector('.workspace');
      return JSON.stringify({
        grid: getComputedStyle(ws).gridTemplateColumns,
        widths: { left: WM.ui.state.panelApplied.left, right: WM.ui.state.panelApplied.right }
      });
    })()`));
    console.log(JSON.stringify({ ...result, realDrag, mobile, reloaded, narrow, restored }, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const ratio = (actual, base) => Math.abs(actual / base - 1.25) < 0.01;
    const grew = (before, after, delta) => after - before >= delta - 4;
    // 底部图片列表卡与中间列同宽同缘；头部有标题与右上三个导出按钮。
    const dockAligned = (snapshot) => {
      const d = snapshot.dock;
      if (!d) return false;
      return Math.abs(d.galleryLeft - snapshot.centerLeft) <= 1 &&
        Math.abs(d.galleryRight - snapshot.centerRight) <= 1 &&
        Math.abs(d.galleryWidth - snapshot.center) <= 1 &&
        d.titleText.indexOf('图片列表') >= 0 &&
        d.hasActions &&
        d.actionsRight != null && d.headRight != null &&
        d.headRight - d.actionsRight <= 18;
    };
    // 左右侧栏各自通高到底（不再有底部栏横跨三列）。
    const panelsHealthy = (snapshot) => {
      const d = snapshot.dock;
      const contentBottom = d.workspaceBottom - 12;   // workspace padding
      return d &&
        Math.abs(d.leftPanelBottom - contentBottom) <= 2 &&
        Math.abs(d.rightPanelBottom - contentBottom) <= 2 &&
        d.exifPanelTop > d.workspaceTop &&
        Math.abs(d.exifPanelBottom - d.leftPanelBottom) <= 2 &&
        d.previewBottom <= d.leftPanelBottom &&
        d.presetBarBottom != null && Math.abs(d.presetBarBottom - d.rightPanelBottom) <= 2 &&
        d.controlsBottom != null && d.controlsBottom <= d.presetBarBottom;
    };
    // 预览区必须干净：没有工具栏/页脚，也没有卡片衬底。
    const previewClean = (snapshot) => {
      const d = snapshot.dock;
      return d && !d.hasPreviewToolbar && !d.hasPreviewFooter &&
        d.previewBg === 'rgba(0, 0, 0, 0)' && d.previewShadow === 'none' &&
        d.canvasRadius === '0px';
    };
    // 卡片柔光：dock-card 的 box-shadow 应含多段（含柔光/光晕）。
    const glowHealthy = (snapshot) => {
      const shadow = (snapshot.dock && snapshot.dock.cardGlow) || 'none';
      return shadow !== 'none' && shadow.split('rgb').length >= 3;
    };
    // Dock 放大：选中项最大，距离越远越小，距离 >=3 恒为 1，且所有卡片底边对齐。
    // 底栏：所有缩略图等大、底边对齐（Dock 放大已移除）
    const dockUniform = (snapshot) => {
      const d = snapshot.dock;
      if (!d || d.cardHeights.length < 2) return false;
      const hs = d.cardHeights;
      const bs = d.cardBottoms;
      const sameH = hs.every((h) => Math.abs(h - hs[0]) <= 1);
      const sameB = bs.every((b) => Math.abs(b - bs[0]) <= 1);
      const inRange = hs[0] >= 90 && hs[0] <= 130;
      const noScale = d.scales.every((v) => Math.abs(v - 1) <= 0.001);
      return sameH && sameB && inRange && noScale;
    };
    const dockGrows = (before, after) =>
      before.dock.galleryWidth - after.dock.galleryWidth >= 78 &&
      after.dock.galleryLeft - before.dock.galleryLeft >= 78;
    const healthy = result.handles === 2 &&
      result.roles.every((r) => r.role === 'separator' && r.tabindex === '0') &&
      ratio(result.fonts.body, 13) && ratio(result.fonts.ctrl, 11.5) &&
      ratio(result.fonts.exif, 11.5) && ratio(result.fonts.small, 11) &&
      Math.abs(result.initial.widths.left - 336) <= 1 &&
      Math.abs(result.initial.widths.right - 378) <= 1 &&
      dockAligned(result.initial) && dockAligned(result.afterLeft) && dockAligned(result.afterRight) &&
      panelsHealthy(result.initial) && panelsHealthy(result.afterLeft) && panelsHealthy(result.afterRight) &&
      previewClean(result.initial) && glowHealthy(result.initial) &&
      dockUniform(result.initial) && dockUniform(result.afterLeft) &&
      dockGrows(result.initial, result.afterLeft) &&
      grew(result.initial.widths.left, result.afterLeft.widths.left, 80) &&
      result.afterLeft.center >= 360 &&
      grew(result.initial.widths.right, result.afterRight.widths.right, 60) &&
      result.afterRight.center >= 360 &&
      Math.abs(result.afterReset.widths.left - 336) <= 1 &&
      grew(result.afterReset.widths.left, result.afterKey.widths.left, 16) &&
      result.stored && result.stored.left === result.afterKey.widths.left &&
      result.stored.right === result.afterKey.widths.right &&
      result.pageScroll <= result.viewport && result.leftHandleVisible &&
      realDrag.left >= beforeRealDrag + 46 && realDrag.center >= 360 &&
      !realDrag.resizing &&
      reloaded.widths && Math.abs(reloaded.widths.left - 336) <= 1 &&
      Math.abs(reloaded.widths.right - 438) <= 1 &&
      narrow.center >= 360 && narrow.handlesVisible &&
      narrow.scrollWidth <= narrow.viewport &&
      Math.abs(restored.widths.left - 336) <= 1 &&
      Math.abs(restored.widths.right - 438) <= 1 &&
      mobile.handlesHidden && mobile.scrollWidth <= mobile.viewport &&
      !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'controls') {
    const expression = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const hash = () => {
        const c = document.getElementById('preview');
        const hc = document.createElement('canvas');
        hc.width = 160;
        hc.height = 160;
        const hctx = hc.getContext('2d');
        hctx.drawImage(c, 0, 0, 160, 160);
        const d = hctx.getImageData(0, 0, 160, 160).data;
        let h = 2166136261;
        for (let i = 0; i < d.length; i += 4) {
          h = Math.imul(h ^ d[i], 16777619) >>> 0;
          h = Math.imul(h ^ d[i + 1], 16777619) >>> 0;
          h = Math.imul(h ^ d[i + 2], 16777619) >>> 0;
        }
        return h;
      };
      const getDefault = (path) => {
        let cur = WM.state.DEFAULTS;
        for (const key of path.split('.')) cur = cur == null ? undefined : cur[key];
        return cur;
      };
      const getValue = (path) => {
        let cur = WM.ui.settings;
        for (const key of path.split('.')) cur = cur == null ? undefined : cur[key];
        return cur;
      };
      const results = { templates: {}, failures: [], tested: 0 };
      document.querySelectorAll('#controls details').forEach((d) => { d.open = true; });
      await sleep(120);
      for (const template of WM.state.TEMPLATES.map((t) => t.id)) {
        const card = document.querySelector('.template-card[data-id="' + template + '"]');
        if (!card.classList.contains('active')) card.click();
        await sleep(350);
        const ranges = Array.from(document.querySelectorAll('#controls input[type="range"]'))
          .filter((el) => el.offsetParent !== null && el.dataset.path && el.dataset.path.indexOf('output.') !== 0)
          .filter((el) => el.dataset.path !== 'layout.maxWidth' && el.dataset.path !== 'logo.radius');
        const resetCount = Array.from(document.querySelectorAll('#controls .ctrl-row'))
          .filter((row) => row.offsetParent !== null && row.dataset.path).length;
        const pathRows = Array.from(document.querySelectorAll('#controls .ctrl-row'))
          .filter((row) => row.offsetParent !== null && row.dataset.path);
        const missingReset = pathRows.filter((row) => !row.querySelector('.ctrl-reset')).map((row) => row.dataset.path);
        missingReset.forEach((path) => results.failures.push({ template, path, changed: false, hasReset: false, restored: false, reason: 'missing-reset' }));
        results.templates[template] = { ranges: ranges.length, resetCount, missingReset };
        for (const input of ranges) {
          const path = input.dataset.path;
          const before = hash();
          const max = Number(input.max);
          const min = Number(input.min);
          const current = Number(input.value);
          const target = Math.abs(current - max) < Math.abs(current - min) ? min : max;
          input.value = String(target);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(260);
          const after = hash();
          const changed = before !== after;
          const settingAfter = getValue(path);
          const row = input.closest('.ctrl-row');
          const reset = row ? row.querySelector('.ctrl-reset') : null;
          let restored = false;
          if (reset) {
            reset.click();
            await sleep(260);
            restored = String(getValue(path)) === String(getDefault(path));
          }
          results.tested++;
          if (!changed || !reset || !restored) {
            results.failures.push({
              template, path, changed, hasReset: !!reset, restored,
              before, after, settingAfter, value: getValue(path), def: getDefault(path)
            });
          }
        }
      }
      return JSON.stringify(results);
    })()`;
    const raw = await evaluate(expression);
    const results = JSON.parse(raw);
    console.log(JSON.stringify(results, null, 2));
    stopChrome();
    process.exit(results.failures.length ? 1 : 0);
  } else if (mode === 'features') {
    const expression = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const qs = (s) => document.querySelector(s);
      const hash = () => {
        const c = document.getElementById('preview');
        const hc = document.createElement('canvas');
        hc.width = 160; hc.height = 160;
        hc.getContext('2d').drawImage(c, 0, 0, 160, 160);
        const d = hc.getContext('2d').getImageData(0, 0, 160, 160).data;
        let h = 2166136261;
        for (let i = 0; i < d.length; i += 4) {
          h = Math.imul(h ^ d[i], 16777619) >>> 0;
          h = Math.imul(h ^ d[i + 1], 16777619) >>> 0;
          h = Math.imul(h ^ d[i + 2], 16777619) >>> 0;
        }
        return h;
      };
      const template = (id) => {
        const el = qs('.template-card[data-id="' + id + '"]');
        if (el && !el.classList.contains('active')) el.click();
        return el;
      };
      const selectValue = (path, value) => {
        const el = qs('#controls select[data-path="' + path + '"]');
        if (!el) return false;
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      const clickSeg = (path, value) => {
        const el = qs('#controls .ctrl-row[data-path="' + path + '"] .seg-btn[data-value="' + value + '"]');
        if (el) el.click();
        return !!el;
      };
      const clickChip = (field) => {
        const el = qs('#controls .chip[data-field="' + field + '"]');
        if (el) el.click();
        return !!el;
      };
      const textOps = () => (WM.ui.state.lastScene ? WM.ui.state.lastScene.ops : [])
        .filter((op) => op.kind === 'text');
      const result = {};
      // 保证至少有一张照片，不依赖 ?demo 的异步加载时机
      if (!WM.ui.state.files.length) {
        const res = await fetch('fixtures/canon-r5.jpg');
        const blob = await res.blob();
        await WM.ui.addFiles([new File([blob], 'canon-r5.jpg', { type: 'image/jpeg' })]);
        await sleep(1200);
      }
      document.querySelectorAll('#controls details').forEach((d) => { d.open = true; });

      template('param-panel');
      await sleep(450);
      const sel = qs('#controls select.select');
      if (sel) {
        const cs = getComputedStyle(sel);
        result.selectStyle = {
          appearance: cs.appearance || cs.webkitAppearance,
          backgroundImage: cs.backgroundImage,
          backgroundSize: cs.backgroundSize,
          paddingRight: cs.paddingRight
        };
      }
      const beforeDate = hash();
      result.dateToggle = clickChip('date');
      await sleep(350);
      result.dateOff = { value: WM.ui.settings.fields.date, changed: hash() !== beforeDate };
      clickChip('date');
      await sleep(300);
      result.dateStyle = selectValue('content.dateStyle', 'cn');
      await sleep(400);
      result.dateStyleValue = WM.ui.settings.content.dateStyle;
      result.dateStyleText = textOps().some((op) => String(op.text).indexOf('2024年') >= 0);

      const f = WM.ui.state.files[0];
      if (f) f.report.summary.model = 'Canon EOS R5';
      clickChip('time');
      await sleep(350);
      clickChip('time');
      await sleep(550);
      const brandTexts = textOps().map((op) => op.text);
      result.brand = {
        hasLogo: !!(WM.ui.state.lastScene && WM.ui.state.lastScene.ops.some((op) => op.kind === 'image' && op.role === 'logo')),
        duplicate: brandTexts.some((t) => t === 'Canon EOS R5' || t === 'Canon'),
        texts: brandTexts.slice(0, 6)
      };

      template('polaroid');
      await sleep(450);
      clickSeg('text.weight', '300');
      await sleep(350);
      const lightScene = WM.ui.state.lastScene;
      const lightPrimary = lightScene.ops.filter((op) => op.kind === 'text')[0];
      clickSeg('text.weight', '800');
      await sleep(350);
      const heavyScene = WM.ui.state.lastScene;
      const heavyPrimary = heavyScene.ops.filter((op) => op.kind === 'text')[0];
      result.polaroid = {
        sameSize: lightScene.output.w === heavyScene.output.w && lightScene.output.h === heavyScene.output.h,
        lightWeight: lightPrimary && lightPrimary.weight,
        heavyWeight: heavyPrimary && heavyPrimary.weight
      };

      template('bottom-bar');
      await sleep(450);
      const bar = WM.ui.state.lastScene;
      const barLogo = bar.ops.find((op) => op.kind === 'image' && op.role === 'logo');
      const barLine = bar.ops.find((op) => op.kind === 'line');
      result.bottomBar = {
        logo: !!barLogo,
        line: !!barLine,
        lineX: barLine ? Math.round(barLine.x1) : null,
        logoX: barLogo ? Math.round(barLogo.x) : null,
        width: bar.output.w
      };
      selectValue('bottomBar.logoPosition', 'after-left');
      await sleep(350);
      const bar2 = WM.ui.state.lastScene;
      const line2 = bar2.ops.find((op) => op.kind === 'line');
      const logo2 = bar2.ops.find((op) => op.kind === 'image' && op.role === 'logo');
      result.bottomBar.afterLeft = {
        lineX: line2 ? Math.round(line2.x1) : null,
        logoX: logo2 ? Math.round(logo2.x) : null
      };
      clickSeg('logo.source', 'none');
      await sleep(400);
      result.bottomBar.noLogoLine = WM.ui.state.lastScene.ops.some((op) => op.kind === 'line');
      clickSeg('logo.source', 'brand');
      await sleep(300);

      template('film-frame');
      await sleep(500);
      const film = WM.ui.state.lastScene;
      result.film = {
        output: film.output,
        background: film.background && film.background.color,
        holes: film.ops.filter((op) => op.kind === 'rect' && op.fill === '#F4F1E8').length,
        orientation: WM.ui.settings.film.orientation,
        holeShapeOk: film.ops.filter((op) => op.kind === 'rect' && op.fill === '#F4F1E8')
          .every((op) => WM.ui.settings.film.orientation === 'vertical' ? op.w > op.h : op.w < op.h),
        texts: film.ops.filter((op) => op.kind === 'text').map((op) => ({
          text: op.text, color: op.color, blur: op.shadowBlur
        }))
      };
      result.film.stockCount = result.film.texts.filter((t) => t.text === 'KODAK PORTRA 400').length;
      const stockSelect = () => document.querySelector('#controls select[data-path="film.stockId"]');
      result.film.stockOptions = stockSelect()
        ? Array.from(stockSelect().options).map((o) => o.textContent) : [];
      clickSeg('film.type', 'bw-negative');
      await sleep(380);
      result.film.bwStock = {
        value: WM.ui.settings.film.stockId,
        options: stockSelect() ? Array.from(stockSelect().options).map((o) => o.textContent) : []
      };
      clickSeg('film.type', 'color-negative');
      await sleep(380);
      result.film.labels = result.film.texts.filter((t) => t.text === '12' || t.text === '12A').map((t) => t.text);
      selectValue('film.holeColor', 'black');
      await sleep(350);
      result.film.blackHoles = WM.ui.state.lastScene.ops
        .filter((op) => op.kind === 'rect' && op.fill === '#000000').length;
      selectValue('film.holeColor', 'white');
      await sleep(300);
      // 片号间隔在更长的片长上验证（竖向 1200px 才有足够孔位）
      clickSeg('film.orientation', 'vertical');
      await sleep(380);
      result.film.labels = WM.ui.state.lastScene.ops
        .filter((op) => op.kind === 'text' && (op.text === '12' || op.text === '12A'))
        .map((op) => op.text);
      clickSeg('film.orientation', 'horizontal');
      await sleep(320);
      const filmMeta = WM.ui.state.lastScene.tokens.meta;
      result.film.pentaxMode = filmMeta.exposureModeText || 'P';
      result.film.pentaxComp = filmMeta.exposureCompText || '±0.0';
      result.film.pentaxFields = [result.film.pentaxMode, result.film.pentaxComp, '400'];
      // 演示照片是竖构图；齿孔方向是 seg 控件，这里显式切到横向再验证 Minolta 竖排。
      clickSeg('film.orientation', 'horizontal');
      await sleep(300);
      selectValue('film.printStyle', 'minolta');
      await sleep(400);
      const minoltaFilm = WM.ui.state.lastScene;
      const minoltaText = minoltaFilm.ops.find((op) => op.kind === 'text' && op.shadowBlur > 0);
      const minoltaBox = minoltaText && WM.render.textBounds(minoltaText);
      result.film.minolta = {
        text: minoltaText ? minoltaText.text : '',
        glow: minoltaText ? minoltaText.shadowBlur : 0,
        rotation: minoltaText ? Math.round(minoltaText.rotation * 180 / Math.PI) : 0,
        rightGap: minoltaBox
          ? Math.round(minoltaFilm.imageRect.x + minoltaFilm.imageRect.w - minoltaBox.x1)
          : null,
        mm: minoltaFilm.output.h / 35,
        centerOffsetY: minoltaBox
          ? Math.round((minoltaBox.y0 + minoltaBox.y1) / 2 -
            (minoltaFilm.imageRect.y + minoltaFilm.imageRect.h / 2))
          : null
      };

      // 竖向齿孔：整幅旋转，文字不得压齿孔，也不得超出画布。
      clickSeg('film.orientation', 'vertical');
      await sleep(400);
      const vFilm = WM.ui.state.lastScene;
      const vHoles = vFilm.ops.filter((op) => op.kind === 'rect' &&
        (op.fill === '#F4F1E8' || op.fill === '#000000') && op.w > 2 && op.h > 2);
      const vTexts = vFilm.ops.filter((op) => op.kind === 'text');
      result.film.verticalMinolta = {
        portrait: vFilm.output.w < vFilm.output.h,
        holes: vHoles.length,
        overlap: vTexts.filter((op) => {
          const b = WM.render.textBounds(op);
          return vHoles.some((h) => b.x0 < h.x + h.w && b.x1 > h.x && b.y0 < h.y + h.h && b.y1 > h.y);
        }).map((op) => op.text),
        outside: vTexts.filter((op) => {
          if (!(op.shadowBlur > 0)) return false; // 边字允许被裁切，只有打印内容必须完整
          const b = WM.render.textBounds(op);
          return b.x0 < -1 || b.y0 < -1 || b.x1 > vFilm.output.w + 1 || b.y1 > vFilm.output.h + 1;
        }).map((op) => op.text)
      };
      clickSeg('film.orientation', 'horizontal');
      await sleep(300);
      selectValue('film.printStyle', 'canon-date');
      await sleep(400);
      const canonFilm = WM.ui.state.lastScene;
      const canonText = canonFilm.ops.find((op) => op.kind === 'text' && String(op.text).indexOf("'24") === 0);
      result.film.canonDate = { text: canonText ? canonText.text : '', glow: canonText ? canonText.shadowBlur : 0 };
      selectValue('film.printStyle', 'none');
      await sleep(350);
      result.film.noPrintGlow = WM.ui.state.lastScene.ops
        .some((op) => op.kind === 'text' && op.shadowBlur > 0);
      selectValue('film.printStyle', 'pentax');
      await sleep(300);
      clickSeg('film.type', 'bw-negative');
      await sleep(400);
      const bw = WM.ui.state.lastScene;
      result.film.bw = {
        background: bw.background && bw.background.color,
        colors: Array.from(new Set(bw.ops.filter((op) => op.kind === 'text').map((op) => op.color)))
      };
      clickSeg('film.type', 'color-negative');
      await sleep(300);

      template('dv-cam');
      await sleep(450);
      const dv = WM.ui.state.lastScene;
      const rec = dv.ops.find((op) => op.kind === 'text' && op.text === 'REC');
      const dateText = dv.ops.find((op) => op.kind === 'text' && String(op.text).indexOf('2024-') === 0);
      result.dv = {
        rec: !!rec,
        date: !!dateText,
        lines: dv.ops.filter((op) => op.kind === 'line').length,
        resolution: dv.ops.some((op) => op.kind === 'text' && op.text === '4K'),
        focusRects: dv.ops.filter((op) => op.kind === 'rect' && !op.fill).length,
        symmetric: rec && dateText
          ? Math.abs((rec.y - rec.size / 2) - (dv.output.h - (dateText.y + dateText.size / 2))) < 2
          : false
      };
      selectValue('dv.centerFocus', 'none');
      await sleep(350);
      result.dv.focusOff = WM.ui.state.lastScene.ops.filter((op) => op.kind === 'rect' && !op.fill).length;
      const resToggle = qs('#controls input[data-path="dv.resolution"]');
      if (resToggle) {
        resToggle.click();
        await sleep(350);
      }
      result.dv.noResolution = !WM.ui.state.lastScene.ops.some((op) => op.kind === 'text' && op.text === '4K');

      // 导出设置弹窗：点击底部栏右上角按钮，背景模糊，控件在弹窗内可见；关闭后回到 host。
      const exportBtn = document.getElementById('btn-export-settings');
      exportBtn.click();
      await sleep(350);
      const modalEl = document.getElementById('modal');
      result.exportModal = {
        open: !modalEl.hidden,
        blur: (getComputedStyle(modalEl).backdropFilter || getComputedStyle(modalEl).webkitBackdropFilter || ''),
        hasFormatControl: !!document.querySelector('#modal-body .ctrl-row[data-path="output.format"]'),
        hasQualityControl: !!document.querySelector('#modal-body .ctrl-row[data-path="output.quality"]'),
        inModalBody: document.querySelectorAll('#modal-body #export-modal-body').length,
        title: (document.getElementById('modal-title') || {}).textContent || '',
        actions: Array.from(document.querySelectorAll('#modal-actions .btn'))
          .map((b) => (b.textContent || '').trim()),
        dock: Array.from(document.querySelectorAll('.dock-gallery .dock-actions .btn'))
          .map((b) => b.id)
      };
      document.getElementById('modal-close').click();
      await sleep(250);
      result.exportModal.closedHidden = document.getElementById('modal').hidden;
      result.exportModal.backInHost = !!document.querySelector('#export-settings-host #export-modal-body');

      // 预设条：两个按钮 + 上拉浮层，最后一项是「导入预设」。
      const presetBar = document.querySelector('.preset-bar');
      const popover = document.getElementById('preset-popover');
      document.getElementById('btn-preset-use').click();
      await sleep(250);
      const popChildren = popover ? Array.from(popover.children).filter((c) => c.offsetParent !== null) : [];
      const lastVisible = popChildren[popChildren.length - 1];
      result.presetBar = {
        exists: !!presetBar,
        buttons: presetBar ? Array.from(presetBar.querySelectorAll(':scope > .btn')).map((b) => b.id) : [],
        popoverOpened: popover ? !popover.hidden : false,
        ariaExpanded: document.getElementById('btn-preset-use').getAttribute('aria-expanded'),
        lastChildIsImport: !!lastVisible && lastVisible.id === 'btn-preset-import',
        lastChildText: lastVisible ? (lastVisible.textContent || '').trim() : ''
      };
      document.getElementById('btn-preset-use').click();
      await sleep(200);
      result.presetBar.popoverClosed = popover ? popover.hidden : true;

      // 底部栏：图片过多时滚轮可左右滑动
      await (async () => {
        const load = async (name, type) => {
          const res = await fetch('fixtures/' + name);
          const blob = await res.blob();
          return new File([blob], name, { type });
        };
        const more = [];
        for (let k = 0; k < 16; k++) more.push(await load('canon-r5.jpg', 'image/jpeg'));
        await WM.ui.addFiles(more);
        await sleep(1200);
        const row = document.getElementById('bottom-gallery');
        const before = row.scrollLeft;
        const overflow = row.scrollWidth > row.clientWidth + 1;
        row.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }));
        await sleep(160);
        result.galleryWheel = {
          overflow,
          cards: row.querySelectorAll('.file-card').length,
          before,
          after: row.scrollLeft,
          scrollWidth: row.scrollWidth,
          clientWidth: row.clientWidth
        };
      })();

      // EXIF 精简：默认隐藏字段数 > 0，按钮可切到「显示全部」。
      const scopeBtn = document.getElementById('btn-exif-all');
      // 常用模式：4 张分组卡，固定 17 行且全部可编辑
      const scopedGroups = document.querySelectorAll('#exif-body .exif-group');
      const scopedRows = document.querySelectorAll('#exif-body .exif-row');
      const scopedEditable = document.querySelectorAll('#exif-body .exif-value.editable');
      const beforeRows = scopedRows.length;
      const scopedTitles = Array.from(scopedGroups).map((g) =>
        (g.querySelector('summary span') || {}).textContent || '');
      scopeBtn.click();
      await sleep(320);
      const afterRows = document.querySelectorAll('#exif-body .exif-row').length;
      const rawEditable = document.querySelectorAll('#exif-body .exif-value.editable').length;
      const rawGroups = document.querySelectorAll('#exif-body .exif-group').length;
      result.exifScope = {
        scopedGroupCount: scopedGroups.length,
        scopedRows: scopedRows.length,
        scopedEditable: scopedEditable.length,
        scopedTitles,
        expectedFields: (WM.meta.WATERMARK_FIELDS || []).length,
        rawEditable,
        rawGroups,
        beforeRows,
        afterRows,
        labelAfter: scopeBtn.textContent,
        pressed: scopeBtn.getAttribute('aria-pressed')
      };

      // 下拉选择栏：自定义箭头 + 统一圆角（美化是否生效）
      const selectEl = document.querySelector('#controls select.select');
      const selStyle = selectEl ? getComputedStyle(selectEl) : null;
      const shellAfter = selectEl && selectEl.closest('.select-shell')
        ? getComputedStyle(selectEl.closest('.select-shell'), '::after') : null;
      result.selectSkin = selStyle ? {
        noNativeArrow: (selStyle.backgroundImage || '').indexOf('url(') < 0,
        radius: parseFloat(selStyle.borderRadius),
        minHeight: parseFloat(selStyle.minHeight),
        shellArrow: shellAfter ? parseFloat(shellAfter.borderRightWidth) : 0
      } : null;
      scopeBtn.click();
      await sleep(250);
      result.exifScope.restoredRows = document.querySelectorAll('#exif-body .exif-row').length;

      // 预览缩放：滚轮缩小 / 放大封顶在自适应 / 双击恢复自适应
      const stageEl = document.getElementById('stage');
      const canvasEl = document.getElementById('preview');
      const canvasH = () => Math.round(canvasEl.getBoundingClientRect().height);
      const wheel = (dy) => stageEl.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true }));
      const fitH = canvasH();
      wheel(120);
      wheel(120);
      await sleep(240);
      const zoomedOutH = canvasH();
      wheel(-120);
      await sleep(240);
      const midH = canvasH();
      stageEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await sleep(240);
      const restoredH = canvasH();
      wheel(-120);
      wheel(-120);
      await sleep(240);
      const maxH = canvasH();
      result.zoom = { fitH, zoomedOutH, midH, restoredH, maxH, hasPill: !!document.getElementById('zoom-pill') };

      // 所有二级卡片默认展开；胶片拆成「胶片样式 / 打印内容」
      const sectionState = {};
      for (const tid of WM.state.TEMPLATES.map((t) => t.id)) {
        const cardEl = document.querySelector('.template-card[data-id="' + tid + '"]');
        if (!cardEl.classList.contains('active')) cardEl.click();
        await sleep(320);
        const secs = Array.from(document.querySelectorAll('#controls .ctrl-section'))
          .filter((el) => !el.hidden);
        sectionState[tid] = {
          sections: secs.length,
          allOpen: secs.every((el) => el.open),
          titles: secs.map((el) => el.querySelector('summary span').textContent)
        };
      }
      result.sections = sectionState;

      // 显示内容按字段条件出现
      const paramCard = document.querySelector('.template-card[data-id="param-panel"]');
      if (!paramCard.classList.contains('active')) paramCard.click();
      await sleep(320);
      const chip = (f) => document.querySelector('#controls .chip[data-field="' + f + '"]');
      chip('location').click();
      await sleep(220);
      const locationHidden = document.querySelector('#controls .ctrl-row[data-path="content.locationMode"]').classList.contains('hidden');
      chip('custom').click();
      await sleep(220);
      const customShown = !document.querySelector('#controls .ctrl-row[data-control="textarea"]').classList.contains('hidden');
      chip('location').click();
      chip('custom').click();
      await sleep(220);
      result.conditions = { locationHidden, customShown };

      // DV 全扁平
      const dvCard = document.querySelector('.template-card[data-id="dv-cam"]');
      if (!dvCard.classList.contains('active')) dvCard.click();
      await sleep(420);
      const dvScene = WM.ui.state.lastScene;
      result.dvFlat = {
        shadowed: dvScene.ops.filter((op) => op.shadow || op.shadowBlur > 0 || op.shadowColor).length,
        sections: Array.from(document.querySelectorAll('#controls .ctrl-section'))
          .filter((el) => !el.hidden).map((el) => el.querySelector('summary span').textContent)
      };

      // 底栏：无「添加」瓦片；拖拽不重复添加；空列表虚线框可点
      const beforeCount = WM.ui.state.files.length;
      result.dragGuard = {
        addTile: !!document.querySelector('.gallery-add'),
        imgDraggable: Array.from(document.querySelectorAll('#bottom-gallery .file-card img'))
          .some((im) => im.draggable === true),
        count: beforeCount
      };
      while (document.querySelector('#bottom-gallery .file-card .fc-x')) {
        document.querySelector('#bottom-gallery .file-card .fc-x').click();
        await sleep(160);
      }
      const emptyBtn = document.querySelector('.gallery-empty');
      result.emptyGallery = {
        button: emptyBtn ? emptyBtn.tagName : '',
        text: emptyBtn ? emptyBtn.textContent.trim() : '',
        files: WM.ui.state.files.length
      };

      result.banner = (document.getElementById('wm-error-banner') || {}).textContent || '';
      return JSON.stringify(result);
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const style = result.selectStyle || {};
    // 下拉现在由 .select-shell 自绘箭头：select 本身无贴图箭头，箭头在外壳伪元素上。
    const styleHealthy = style.appearance === 'none' &&
      !/url\(/i.test(style.backgroundImage || '') &&
      parseFloat(style.paddingRight) >= 34;
    const filmTexts = result.film ? result.film.texts : [];
    const stock = filmTexts.find((t) => t.text === 'KODAK PORTRA 400');
    const printItem = filmTexts.find((t) => t.text === (result.film && result.film.pentaxMode ? result.film.pentaxMode : 'P'));
    const healthy = styleHealthy &&
      result.dateToggle && result.dateOff && result.dateOff.value === false && result.dateOff.changed &&
      result.dateStyle && result.dateStyleValue === 'cn' && result.dateStyleText &&
      result.brand && result.brand.hasLogo && !result.brand.duplicate &&
      result.polaroid && result.polaroid.sameSize &&
      result.polaroid.lightWeight === 300 && result.polaroid.heavyWeight === 800 &&
      result.bottomBar && result.bottomBar.logo && result.bottomBar.line &&
      result.bottomBar.lineX > result.bottomBar.logoX &&
      result.bottomBar.afterLeft && result.bottomBar.afterLeft.logoX > result.bottomBar.afterLeft.lineX &&
      result.bottomBar.noLogoLine === false &&
      result.film && result.film.background === '#0B0B0B' && result.film.holes >= 8 &&
      result.film.holeShapeOk && result.film.stockCount >= 2 &&
      result.film.stockOptions.join(',') === 'KODAK PORTRA 400' &&
      result.film.bwStock && result.film.bwStock.value === 'hp5' &&
      result.film.bwStock.options.join(',') === 'ILFORD HP5 PLUS 400' &&
      result.film.labels.indexOf('12') >= 0 && result.film.labels.indexOf('12A') >= 0 &&
      result.film.blackHoles >= 8 &&
      result.film.pentaxFields.every((t) => filmTexts.some((op) => op.text === t)) &&
      stock && printItem && stock.blur === 0 && printItem.blur > 0 &&
      result.film.minolta && result.film.minolta.text.indexOf('50mm') >= 0 && result.film.minolta.glow > 0 &&
      Math.abs(result.film.minolta.rotation) === 90 &&
      result.film.minolta.rightGap != null &&
      result.film.minolta.rightGap <= result.film.minolta.mm * 1.6 &&
      Math.abs(result.film.minolta.centerOffsetY) <= 2 &&
      result.film.verticalMinolta && result.film.verticalMinolta.portrait &&
      result.film.verticalMinolta.holes >= 8 &&
      result.film.verticalMinolta.overlap.length === 0 &&
      result.film.verticalMinolta.outside.length === 0 &&
      result.film.canonDate && result.film.canonDate.text.indexOf("'24") === 0 && result.film.canonDate.glow > 0 &&
      result.film.noPrintGlow === false &&
      result.film.bw && result.film.bw.background === '#0B0B0B' &&
      result.film.bw.colors.indexOf('#F4F4F4') >= 0 &&
      result.dv && result.dv.rec && result.dv.date && result.dv.lines >= 6 &&
      result.dv.resolution && result.dv.symmetric &&
      result.dv.focusOff < result.dv.focusRects && result.dv.noResolution &&
      result.exportModal && result.exportModal.open && /blur/i.test(result.exportModal.blur) &&
      result.exportModal.hasFormatControl && result.exportModal.hasQualityControl &&
      result.exportModal.inModalBody === 1 && result.exportModal.closedHidden &&
      result.exportModal.actions.indexOf('导出当前照片') >= 0 &&
      result.exportModal.actions.indexOf('全部导出') >= 0 &&
      result.exportModal.dock.join(',') === 'btn-import,btn-export,btn-export-settings' &&
      result.exportModal.backInHost &&
      result.presetBar && result.presetBar.exists &&
      result.presetBar.buttons.join(',') === 'btn-preset-save,btn-preset-use' &&
      result.presetBar.popoverOpened && result.presetBar.ariaExpanded === 'true' &&
      result.presetBar.lastChildIsImport && result.presetBar.lastChildText === '导入预设' &&
      result.presetBar.popoverClosed &&
      result.exifScope && result.exifScope.scopedGroupCount === 4 &&
      result.exifScope.scopedTitles.join(',') === '相机与器材,曝光参数,文件信息,地理位置' &&
      result.exifScope.scopedRows === result.exifScope.expectedFields &&
      result.exifScope.scopedEditable === result.exifScope.expectedFields &&
      result.exifScope.rawGroups > 1 && result.exifScope.rawEditable === 0 &&
      result.zoom && result.zoom.hasPill === false &&
      result.zoom.zoomedOutH < result.zoom.fitH &&
      result.zoom.midH > result.zoom.zoomedOutH && result.zoom.midH < result.zoom.fitH &&
      Math.abs(result.zoom.restoredH - result.zoom.fitH) <= 2 &&
      Math.abs(result.zoom.maxH - result.zoom.fitH) <= 2 &&
      result.sections && Object.keys(result.sections).length === 6 &&
      Object.keys(result.sections).every((k) => result.sections[k].allOpen) &&
      result.sections['film-frame'].sections === 3 &&
      result.sections['film-frame'].titles.indexOf('胶片样式') >= 0 &&
      result.sections['film-frame'].titles.indexOf('打印内容') >= 0 &&
      result.sections['dv-cam'].sections === 2 &&
      result.conditions && result.conditions.locationHidden && result.conditions.customShown &&
      result.dvFlat && result.dvFlat.shadowed === 0 &&
      result.dragGuard && result.dragGuard.addTile === false && result.dragGuard.imgDraggable === false &&
      result.emptyGallery && result.emptyGallery.button === 'BUTTON' &&
      result.emptyGallery.text.indexOf('还没有图片') >= 0 && result.emptyGallery.files === 0 &&
      result.exifScope.rawGroups > 1 && result.exifScope.rawEditable === 0 &&
      result.exifScope.afterRows > result.exifScope.beforeRows &&
      result.exifScope.labelAfter === '只看常用' && result.exifScope.pressed === 'true' &&
      result.exifScope.restoredRows === result.exifScope.beforeRows &&
      result.galleryWheel && result.galleryWheel.overflow &&
      result.galleryWheel.cards >= 8 &&
      result.galleryWheel.after > result.galleryWheel.before &&
      result.selectSkin && result.selectSkin.noNativeArrow &&
      result.selectSkin.radius >= 10 && result.selectSkin.minHeight >= 30 &&
      result.selectSkin.shellArrow > 0 &&
      !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'theme') {
    const initialRaw = await evaluate(`(() => {
      const themeSwitch = document.getElementById('theme-switch');
      const actions = document.querySelector('.top-actions');
      const buttons = themeSwitch ? Array.from(themeSwitch.querySelectorAll('button')) : [];
      const cs = getComputedStyle(document.documentElement);
      return JSON.stringify({
        theme: document.documentElement.dataset.theme,
        stored: JSON.parse(localStorage.getItem('wm.theme.v1')),
        buttons: buttons.map((b) => ({ mode: b.dataset.themeMode, active: b.classList.contains('active') })),
        inTopActions: !!themeSwitch && !!actions && actions.contains(themeSwitch),
        nearRight: themeSwitch ? Math.round(window.innerWidth - themeSwitch.getBoundingClientRect().right) : null,
        photoH: cs.getPropertyValue('--photo-h').trim(),
        photoS: cs.getPropertyValue('--photo-s').trim(),
        backdrop: (() => {
          const el = document.getElementById('photo-backdrop');
          return !!el && getComputedStyle(el).backgroundImage !== 'none' && document.body.classList.contains('has-photo');
        })(),
        backdropFilter: (() => {
          const el = document.getElementById('photo-backdrop');
          return el ? getComputedStyle(el).filter : '';
        })(),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        panelBg: getComputedStyle(document.querySelector('.panel')).backgroundColor,
        topbarBg: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
        // 右栏分区必须与左栏分组完全同构（同样式大卡片）
        rightCard: (() => {
          const sec = document.querySelector('#controls .ctrl-section');
          const grp = document.querySelector('#exif-body .exif-group');
          if (!sec || !grp) return null;
          const a = getComputedStyle(sec), b = getComputedStyle(grp);
          return {
            radius: a.borderRadius === b.borderRadius,
            borderStyle: a.borderTopStyle === b.borderTopStyle && a.borderTopWidth === b.borderTopWidth,
            bg: a.backgroundColor === b.backgroundColor
          };
        })(),
        exifFixed: (() => {
          const rows = document.querySelectorAll('#exif-body .exif-row');
          return {
            groups: document.querySelectorAll('#exif-body .exif-group').length,
            rows: rows.length,
            editable: document.querySelectorAll('#exif-body .exif-value.editable').length
          };
        })()
      });
    })()`);
    const result = JSON.parse(initialRaw);
    const clickTheme = async (mode) => {
      await evaluate(`document.querySelector('#theme-switch button[data-theme-mode="${mode}"]').click()`);
      await sleep(350);
      return JSON.parse(await evaluate(`(() => JSON.stringify({
        theme: document.documentElement.dataset.theme,
        stored: JSON.parse(localStorage.getItem('wm.theme.v1')),
        active: (document.querySelector('#theme-switch button.active') || {}).dataset
          ? document.querySelector('#theme-switch button.active').dataset.themeMode : '',
        bodyBg: getComputedStyle(document.body).backgroundColor,
        panelBg: getComputedStyle(document.querySelector('.panel')).backgroundColor,
        topbarBg: getComputedStyle(document.querySelector('.topbar')).backgroundColor
      }))()`));
    };
    result.light = await clickTheme('light');
    result.dark = await clickTheme('dark');
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'dark' }]
    });
    result.systemDark = await clickTheme('system');
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: 'light' }]
    });
    await sleep(350);
    result.systemLight = JSON.parse(await evaluate(`(() => JSON.stringify({
      theme: document.documentElement.dataset.theme,
      stored: JSON.parse(localStorage.getItem('wm.theme.v1')),
      active: (document.querySelector('#theme-switch button.active') || {}).dataset
        ? document.querySelector('#theme-switch button.active').dataset.themeMode : ''
    }))()`));
    await send('Emulation.setEmulatedMedia', { features: [] });
    result.lightAgain = await clickTheme('light');
    const dir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(dir, { recursive: true });
    await sleep(500);
    const lightShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, 'theme-light.png'), Buffer.from(lightShot.data, 'base64'));
    result.darkShot = await clickTheme('dark');
    await sleep(400);
    const darkShot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(dir, 'theme-dark.png'), Buffer.from(darkShot.data, 'base64'));
    await evaluate(`document.querySelector('#theme-switch button[data-theme-mode="light"]').click()`);
    await sleep(300);
    await send('Page.reload');
    await sleep(1600);
    result.reloaded = JSON.parse(await evaluate(`(() => JSON.stringify({
      theme: document.documentElement.dataset.theme,
      stored: JSON.parse(localStorage.getItem('wm.theme.v1')),
      active: (document.querySelector('#theme-switch button.active') || {}).dataset
        ? document.querySelector('#theme-switch button.active').dataset.themeMode : ''
    }))()`));
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const sat = parseFloat(result.photoS);
    const healthy = result.buttons.length === 3 &&
      result.buttons.map((b) => b.mode).join(',') === 'dark,light,system' &&
      result.inTopActions && result.nearRight != null && result.nearRight < 40 &&
      result.photoH !== '' && isFinite(sat) && sat >= 14 && sat <= 30 &&
      result.backdrop && /blur/i.test(result.backdropFilter) &&
      result.light.theme === 'light' && result.light.stored === 'light' && result.light.active === 'light' &&
      result.dark.theme === 'dark' && result.dark.stored === 'dark' && result.dark.active === 'dark' &&
      result.systemDark.theme === 'dark' && result.systemDark.stored === 'system' &&
      result.systemDark.active === 'system' &&
      result.systemLight.theme === 'light' && result.systemLight.active === 'system' &&
      result.lightAgain.theme === 'light' && result.lightAgain.stored === 'light' &&
      result.reloaded.theme === 'light' && result.reloaded.stored === 'light' &&
      result.reloaded.active === 'light' &&
      result.light.panelBg !== result.dark.panelBg &&
      result.light.topbarBg !== result.dark.topbarBg &&
      result.rightCard && result.rightCard.radius && result.rightCard.borderStyle &&
      result.exifFixed && result.exifFixed.groups === 4 &&
      result.exifFixed.rows === 17 && result.exifFixed.editable === 17 &&
      !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'shots') {
    const shotDir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    const templates = ['param-panel', 'polaroid', 'bottom-bar', 'film-frame', 'dv-cam', 'tile-copyright'];
    const files = [];
    for (const template of templates) {
      await evaluate(`(() => { const c = document.querySelector('.template-card[data-id="${template}"]'); if (!c.classList.contains('active')) c.click(); return true; })()`);
      await sleep(900);
      const probeNow = JSON.parse(await evaluate(probe));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(shotDir, template + '.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      files.push({ template, file, canvas: probeNow.canvas, status: probeNow.status, banner: probeNow.banner });
    }
    async function captureState(name) {
      await sleep(700);
      const probeNow = JSON.parse(await evaluate(probe));
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(shotDir, name + '.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      files.push({ template: name, file, canvas: probeNow.canvas, status: probeNow.status, banner: probeNow.banner });
    }
    await evaluate(`(() => { const c = document.querySelector('.template-card[data-id="film-frame"]'); if (!c.classList.contains('active')) c.click(); return true; })()`);
    await sleep(400);
    await evaluate(`(() => {
      const el = document.querySelector('#controls .ctrl-row[data-path="film.type"] .seg-btn[data-value="bw-negative"]');
      if (el) el.click();
      return true;
    })()`);
    await captureState('film-bw');

    await evaluate(`(() => {
      const type = document.querySelector('#controls .ctrl-row[data-path="film.type"] .seg-btn[data-value="color-negative"]');
      if (type) type.click();
      const el = document.querySelector('#controls select[data-path="film.printStyle"]');
      if (el) { el.value = 'minolta'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await captureState('film-minolta');
    await evaluate(`(() => {
      const el = document.querySelector('#controls select[data-path="film.printStyle"]');
      if (el) { el.value = 'canon-date'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await captureState('film-canon-date');

    // 竖向齿孔（演示照片是竖构图，auto 即为竖向）：Minolta / Canon 随画幅一起旋转。
    await evaluate(`(() => {
      const orient = document.querySelector('#controls .ctrl-row[data-path="film.orientation"] .seg-btn[data-value="horizontal"]');
      if (orient) orient.click();
      const el = document.querySelector('#controls select[data-path="film.printStyle"]');
      if (el) { el.value = 'minolta'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await captureState('film-vertical-minolta');
    await evaluate(`(() => {
      const el = document.querySelector('#controls select[data-path="film.printStyle"]');
      if (el) { el.value = 'canon-date'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await captureState('film-vertical-canon');

    // 横向齿孔：参数竖排贴右缘、垂直居中。
    await evaluate(`(() => {
      const orient = document.querySelector('#controls .ctrl-row[data-path="film.orientation"] .seg-btn[data-value="horizontal"]');
      if (orient) orient.click();
      const el = document.querySelector('#controls select[data-path="film.printStyle"]');
      if (el) { el.value = 'minolta'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await captureState('film-horizontal-minolta');
    await evaluate(`(() => {
      const orient = document.querySelector('#controls .ctrl-row[data-path="film.orientation"] .seg-btn[data-value="horizontal"]');
      if (orient) orient.click();
      return true;
    })()`);

    await evaluate(`(() => { const c = document.querySelector('.template-card[data-id="bottom-bar"]'); if (!c.classList.contains('active')) c.click(); return true; })()`);
    await sleep(400);
    await evaluate(`(() => {
      const el = document.querySelector('#controls select[data-path="bottomBar.logoPosition"]');
      if (el) { el.value = 'after-left'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await captureState('bottom-bar-logo-left');

    await evaluate(`(() => { const c = document.querySelector('.template-card[data-id="dv-cam"]'); if (!c.classList.contains('active')) c.click(); return true; })()`);
    await sleep(400);
    await evaluate(`(() => {
      const el = document.querySelector('#controls select[data-path="dv.centerFocus"]');
      if (el) { el.value = 'square'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      return true;
    })()`);
    await captureState('dv-center-focus');

    // 导出设置弹窗（背景模糊）
    await evaluate(`document.getElementById('btn-export-settings').click()`);
    await captureState('export-settings-modal');
    await evaluate(`document.getElementById('modal-close').click()`);
    await sleep(300);

    // 预设上拉浮层
    await evaluate(`(() => {
      const save = document.getElementById('btn-preset-save');
      if (save) { /* 只打开浮层，避免弹窗 */ }
      const use = document.getElementById('btn-preset-use');
      if (use) use.click();
      return true;
    })()`);
    await captureState('preset-popover');
    await evaluate(`document.getElementById('btn-preset-use').click()`);
    await sleep(200);

    // 底栏滚轮横滑：加载多张图，让列表溢出，并向右滚动
    await evaluate(`(async () => {
      const load = async (name, type) => {
        const res = await fetch('fixtures/' + name);
        const blob = await res.blob();
        return new File([blob], name, { type });
      };
      const more = [];
      for (let k = 0; k < 10; k++) more.push(await load('nikon-z6.png', 'image/png'));
      await WM.ui.addFiles(more);
      return true;
    })()`);
    await sleep(1800);
    await evaluate(`(() => {
      const row = document.getElementById('bottom-gallery');
      row.scrollLeft = 160;
      return true;
    })()`);
    await sleep(400);
    await captureState('dock-scroll');

    // 无 EXIF 的图片：常用栏仍然固定 15 行且可填写
    await evaluate(`(async () => {
      const res = await fetch('fixtures/no-exif.jpg');
      const blob = await res.blob();
      await WM.ui.addFiles([new File([blob], 'no-exif.jpg', { type: 'image/jpeg' })]);
      return true;
    })()`);
    await sleep(1600);
    await evaluate(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const row = Array.from(document.querySelectorAll('#exif-body .exif-row')).find((r) => r.dataset.field === 'make');
      if (!row) return false;
      const val = row.querySelector('.exif-value');
      val.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await sleep(150);
      const input = val.querySelector('input');
      if (input) {
        input.value = 'LEICA';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      await sleep(600);
      return true;
    })()`);
    await sleep(600);
    await captureState('no-exif-filled');

    console.log(JSON.stringify({ state, files }, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    stopChrome();
    process.exit(exceptions.length || (state && state.banner) ? 1 : 0);
  } else if (mode === 'file') {
    const shotDir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(shotDir, 'file-mode.png'), Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify(state, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    if (consoleMessages.length) console.log('控制台：\n' + consoleMessages.slice(-10).join('\n'));
    const healthy = state && state.controls > 2 && !state.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'mock') {
    const expression = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const box = document.getElementById('empty-state');
      const canvas = document.getElementById('empty-canvas');
      const cs = getComputedStyle(box);
      const card = (id) => document.querySelector('.template-card[data-id="' + id + '"]');
      const activeCount = () => document.querySelectorAll('.template-card.active').length;
      const filled = () => {
        const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] !== 0) return true;
        }
        return false;
      };
      const boxRatio = () => {
        const r = box.getBoundingClientRect();
        return Number((r.width / r.height).toFixed(3));
      };
      const promptVisible = () => getComputedStyle(document.querySelector('.empty-copy')).display !== 'none';
      const sceneInfo = () => {
        const s = WM.ui.state.lastScene;
        if (!s) return { ops: 0, ratio: 0, photoRatio: 0 };
        return {
          ops: s.ops.length,
          ratio: Number((s.output.w / s.output.h).toFixed(3)),
          photoRatio: Number((s.imageRect.w / s.imageRect.h).toFixed(3))
        };
      };

      const initial = {
        template: WM.ui.settings.template,
        active: activeCount(),
        ratio: boxRatio(),
        canvasFilled: filled(),
        promptVisible: promptVisible(),
        scene: sceneInfo()
      };

      // 取消默认模板 → 纯 3:2 空白参考照片
      card('param-panel').click();
      await sleep(480);
      const afterClear = {
        template: WM.ui.settings.template,
        active: activeCount(),
        ratio: boxRatio(),
        canvasFilled: filled(),
        promptVisible: promptVisible()
      };

      // 底部白边：外框变高，但照片区仍是 3:2
      card('bottom-bar').click();
      await sleep(520);
      const probeTheme = (() => {
        const scene = WM.ui.state.lastScene;
        const ir = scene && scene.imageRect ? scene.imageRect : { x: 0, y: 0, w: 1200, h: 800 };
        const d = canvas.getContext('2d').getImageData(
          Math.round(ir.x + ir.w / 2), Math.round(ir.y + ir.h / 2), 1, 1).data;
        const tr = getComputedStyle(document.querySelector('.empty-copy')).transform;
        const m = tr.match(/matrix\\(([^,]+)/);
        const boxW = box.getBoundingClientRect().width;
        return {
          photoAlpha: d[3],
          promptScale: m ? Number(Number(m[1]).toFixed(3)) : 0,
          expectedScale: Number((boxW / 800).toFixed(3))
        };
      })();
      const bottomBar = {
        template: WM.ui.settings.template,
        active: activeCount(),
        ratio: boxRatio(),
        canvasFilled: filled(),
        promptVisible: promptVisible(),
        scene: sceneInfo(),
        ...probeTheme
      };

      card('bottom-bar').click();
      await sleep(420);
      const afterToggle = {
        template: WM.ui.settings.template,
        ratio: boxRatio(),
        canvasFilled: filled(),
        promptVisible: promptVisible()
      };

      // 胶片：外框更高更窄，照片区仍 3:2
      card('film-frame').click();
      await sleep(520);
      const probeFilm = (() => {
        const scene = WM.ui.state.lastScene;
        const ir = scene && scene.imageRect ? scene.imageRect : { x: 0, y: 0, w: 1200, h: 800 };
        const d = canvas.getContext('2d').getImageData(
          Math.round(ir.x + ir.w / 2), Math.round(ir.y + ir.h / 2), 1, 1).data;
        const tr = getComputedStyle(document.querySelector('.empty-copy')).transform;
        const m = tr.match(/matrix\\(([^,]+)/);
        const boxW = box.getBoundingClientRect().width;
        return {
          photoAlpha: d[3],
          promptScale: m ? Number(Number(m[1]).toFixed(3)) : 0,
          expectedScale: Number((boxW / 800).toFixed(3))
        };
      })();
      const film = {
        template: WM.ui.settings.template,
        ratio: boxRatio(),
        canvasFilled: filled(),
        promptVisible: promptVisible(),
        scene: sceneInfo(),
        ...probeFilm
      };

      card('film-frame').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await sleep(480);
      const afterDbl = {
        template: WM.ui.settings.template,
        ratio: boxRatio(),
        canvasFilled: filled(),
        promptVisible: promptVisible()
      };

      const lightBg = getComputedStyle(box).backgroundColor;
      document.querySelector('#theme-switch button[data-theme-mode="dark"]').click();
      await sleep(420);
      const darkBg = getComputedStyle(box).backgroundColor;
      document.querySelector('#theme-switch button[data-theme-mode="light"]').click();
      await sleep(300);

      return JSON.stringify({
        radius: cs.borderRadius,
        lightBg,
        darkBg,
        prompt: (document.querySelector('.empty-title') || {}).textContent || '',
        topbarOpen: !!document.getElementById('btn-open'),
        topbarDemo: !!document.getElementById('btn-demo'),
        previewHidden: document.getElementById('preview').hidden,
        emptyVisible: !box.hidden,
        initial,
        afterClear,
        bottomBar,
        afterToggle,
        film,
        afterDbl,
        banner: (document.getElementById('wm-error-banner') || {}).textContent || ''
      });
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const close = (a, b, tol) => Math.abs(a - b) <= tol;
    const healthy = result.radius === '0px' &&
      result.prompt.indexOf('拖入') >= 0 &&
      result.topbarOpen === false && result.topbarDemo === false &&
      result.previewHidden && result.emptyVisible &&
      result.initial.template === 'param-panel' && result.initial.active === 1 &&
      close(result.initial.ratio, 1.5, 0.02) && result.initial.canvasFilled &&
      result.initial.scene.photoRatio === 1.5 &&
      result.afterClear.template === '' && result.afterClear.active === 0 &&
      close(result.afterClear.ratio, 1.5, 0.02) &&
      result.afterClear.canvasFilled === false && result.afterClear.promptVisible &&
      result.bottomBar.template === 'bottom-bar' && result.bottomBar.active === 1 &&
      close(result.bottomBar.scene.photoRatio, 1.5, 0.012) &&
      close(result.bottomBar.ratio, result.bottomBar.scene.ratio, 0.01) &&
      result.bottomBar.scene.ratio < 1.45 &&
      result.bottomBar.canvasFilled && result.bottomBar.promptVisible &&
      result.bottomBar.scene.ops > 0 &&
      result.bottomBar.photoAlpha === 0 &&
      Math.abs(result.bottomBar.promptScale - result.bottomBar.expectedScale) <= 0.02 &&
      result.afterToggle.template === '' && close(result.afterToggle.ratio, 1.5, 0.02) &&
      result.afterToggle.canvasFilled === false && result.afterToggle.promptVisible &&
      result.film.template === 'film-frame' &&
      close(result.film.scene.photoRatio, 1.5, 0.012) &&
      close(result.film.ratio, result.film.scene.ratio, 0.01) &&
      result.film.scene.ratio < 1.2 && result.film.canvasFilled && result.film.promptVisible &&
      result.film.photoAlpha === 0 &&
      Math.abs(result.film.promptScale - result.film.expectedScale) <= 0.02 &&
      result.film.promptScale < result.bottomBar.promptScale &&
      result.afterDbl.template === '' && close(result.afterDbl.ratio, 1.5, 0.02) &&
      result.afterDbl.canvasFilled === false && result.afterDbl.promptVisible &&
      result.lightBg !== result.darkBg &&
      !result.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'thumbs') {
    const expression = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const make = (w, h, name) => new Promise((ok) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#8aa6a0';
        ctx.fillRect(0, 0, w, h);
        c.toBlob((b) => ok(new File([b], name, { type: 'image/png' })), 'image/png');
      });
      const list = [await make(250, 100, 'r2.5.png'), await make(600, 100, 'r6.png')];
      try {
        const r = await fetch('testTruePhoto/0.75@0.75x.png');
        if (r.ok) {
          const b = await r.blob();
          list.push(new File([b], 'wide-real.png', { type: 'image/png' }));
        }
      } catch (e) { /* 本地样张可选 */ }
      await WM.ui.addFiles(list);
      await sleep(1800);
      const cards = Array.from(document.querySelectorAll('#bottom-gallery .file-card'));
      return JSON.stringify(cards.map((card) => {
        const im = card.querySelector('img');
        const r = im.getBoundingClientRect();
        return {
          name: card.dataset.name,
          ratio: Number((r.width / r.height).toFixed(3)),
          natural: im.naturalWidth && im.naturalHeight
            ? Number((im.naturalWidth / im.naturalHeight).toFixed(3)) : 0,
          w: Math.round(r.width),
          h: Math.round(r.height)
        };
      }));
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    const by = (name) => result.find((x) => x.name === name);
    const r25 = by('r2.5.png');
    const r6 = by('r6.png');
    const real = by('wide-real.png');
    const healthy = r25 && Math.abs(r25.ratio - 2.5) <= 0.06 &&
      r6 && Math.abs(r6.ratio - 3) <= 0.06 && r6.w <= 290 &&
      (!real || (Math.abs(real.ratio - 3) <= 0.06 && real.w <= 290)) &&
      result.every((x) => Math.abs(x.h - 96) <= 1);
    stopChrome();
    process.exit(healthy ? 0 : 1);
  } else if (mode === 'export') {
    const expression = `(async () => {
      const f = WM.ui.state.files[0];
      const res = await WM.ui._exportFile(f, 1);
      const bytes = new Uint8Array(await res.blob.arrayBuffer());
      let bin = '';
      const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
      }
      const defaults = {
        format: WM.ui.settings.output.format,
        quality: WM.ui.settings.output.quality,
        resize: WM.ui.settings.output.resize
      };
      const pngInfo = await (async () => {
        const r = await fetch('fixtures/nikon-z6.png');
        const b = await r.blob();
        await WM.ui.addFiles([new File([b], 'nikon-z6.png', { type: 'image/png' })]);
        await new Promise((ok) => setTimeout(ok, 1400));
        const f2 = WM.ui.state.files.find((x) => x.name === 'nikon-z6.png');
        const res2 = await WM.ui._exportFile(f2, 2);
        return { filename: res2.filename, type: res2.blob.type, size: res2.blob.size };
      })();
      return JSON.stringify({ filename: res.filename, warnings: res.warnings, type: res.blob.type,
        size: res.blob.size, data: btoa(bin), defaults, png: pngInfo });
    })()`;
    const raw = await evaluate(expression);
    const result = JSON.parse(raw);
    const dir = path.resolve(process.cwd(), 'shots');
    fs.mkdirSync(dir, { recursive: true });
    const outFile = path.join(dir, 'exported-' + result.filename.replace(/[^A-Za-z0-9._-]+/g, '_'));
    fs.writeFileSync(outFile, Buffer.from(result.data, 'base64'));
    delete result.data;
    result.file = outFile;
    console.log(JSON.stringify(result, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    stopChrome();
    const healthy = result.size > 1000 &&
      result.defaults && result.defaults.format === 'original' &&
      result.defaults.quality === 1 && result.defaults.resize === 'original' &&
      result.png && result.png.type === 'image/png' &&
      /\.png$/.test(result.png.filename) && result.png.size > 1000;
    process.exit(healthy ? 0 : 1);
  } else {
    console.log(JSON.stringify(state, null, 2));
    if (exceptions.length) console.log('页面异常：\n' + exceptions.join('\n'));
    if (consoleMessages.length) console.log('控制台：\n' + consoleMessages.slice(-20).join('\n'));
    const healthy = state && state.activeThumb && state.fileCards > 0 && state.canvas && !state.banner;
    stopChrome();
    process.exit(healthy ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  stopChrome();
  process.exit(2);
});
