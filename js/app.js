/*!
 * app.js — 启动入口
 */
(function () {
  'use strict';

  function reportError(message) {
    if (!message) return;
    if (window.console) console.error('[WM]', message);
    var box = document.getElementById('wm-error-banner');
    if (!box) {
      box = document.createElement('div');
      box.id = 'wm-error-banner';
      box.className = 'error-banner';
      document.body.appendChild(box);
    }
    var line = String(message);
    box.textContent = box.textContent ? box.textContent + '\n' + line : '运行错误：' + line;
  }

  window.addEventListener('error', function (event) {
    if (event && event.message) reportError(event.message);
  });
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event && event.reason;
    reportError(reason && reason.message ? reason.message : String(reason));
  });

  function boot() {
    if (!window.WM || !window.WM.ui) {
      reportError('脚本加载失败：请确认 js/ 目录下的文件完整。');
      return;
    }
    try {
      window.WM.ui.init();
    } catch (e) {
      reportError('初始化失败：' + (e && e.message ? e.message : e));
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
