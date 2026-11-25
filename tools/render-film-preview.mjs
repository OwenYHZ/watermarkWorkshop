/* 开发辅助：把指定测试照片套上「胶片齿孔」模板并导出，用于和真实底片对比。
   用法：node tools/render-film-preview.mjs TCC_2629.JPG shots/film-portra.jpg [app.png] */
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';

const fixture = process.argv[2] || 'TCC_2629.JPG';
const out = process.argv[3] || 'shots/film-portra.jpg';
const appShot = process.argv[4] || '';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find((p) => fs.existsSync(p));
const port = 9483;
const profile = fs.mkdtempSync('C:/Users/15756/AppData/Local/Temp/wm-');
const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1600,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port, path: p }, (r) => {
    let b = '';
    r.on('data', (c) => { b += c; });
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
let ws;
for (let i = 0; i < 60; i++) {
  try {
    const list = await getJson('/json/list');
    const pg = list.find((t) => t.type === 'page');
    if (pg) { ws = pg.webSocketDebuggerUrl; break; }
  } catch (e) { /* retry */ }
  await sleep(300);
}
const sock = new WebSocket(ws);
let seq = 0;
const pend = new Map();
sock.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) {
    const { res, rej } = pend.get(m.id);
    pend.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
});
await new Promise((r) => sock.addEventListener('open', r));
const send = (method, params) => new Promise((res, rej) => {
  const id = ++seq;
  pend.set(id, { res, rej });
  sock.send(JSON.stringify({ id, method, params: params || {} }));
});
const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
await sleep(2800);
await ev(`(async () => {
  const r = await fetch('testTruePhoto/${fixture}');
  const b = await r.blob();
  await WM.ui.addFiles([new File([b], '${fixture}', { type: 'image/jpeg' })]);
  return true;
})()`);
await sleep(3000);
await ev(`(() => { const c = document.querySelector('.template-card[data-id="film-frame"]'); if (!c.classList.contains('active')) c.click(); return true; })()`);
await sleep(1000);
if (appShot) {
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(appShot, Buffer.from(shot.data, 'base64'));
}
const data = await ev(`(async () => {
  const f = WM.ui.state.files[0];
  const res = await WM.ui._exportFile(f, 1);
  const bytes = new Uint8Array(await res.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
})()`);
fs.writeFileSync(out, Buffer.from(data, 'base64'));
sock.close();
ch.kill();
console.log('done');
