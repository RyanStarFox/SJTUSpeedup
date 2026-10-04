// ==UserScript==
// @name         SJTUSpeedup — 课堂回看倍速
// @namespace    https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/
// @version      1.0.1
// @description  为交大课堂回看增加更多倍速、记忆上次倍速，并支持长按 O/P 临时变速
// @author       SJTUSpeedup
// @match        https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/*
// @grant        none
// @inject-into  page
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  if (window.top !== window.self) return;

  // Safari Userscripts、Chrome/Edge/Firefox 油猴都在页面上下文执行（@grant none）。
  try {
    if (document.documentElement && document.documentElement.dataset.sjtuSpeeder === '1') return;
    if (document.documentElement) document.documentElement.dataset.sjtuSpeeder = '1';
  } catch (_) {
    /* ignore */
  }

  // ─────────────────────────────────────────────────────────────
  // CONFIG — 改这里即可
  // ─────────────────────────────────────────────────────────────
  const CONFIG = {
    // 原生菜单是 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2，这里在保留它们的同时加上 2.5 和 3。
    presets: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3],
    min: 0.1,
    max: 10,
    holdDelayMs: 500,
    holdBoost: 1.5, // 长按 P
    holdSlow: 0.5, // 长按 O
    seekStep: 5,
    debug: false,
  };

  const log = (...args) => {
    if (CONFIG.debug) console.log('[SJTUSpeedup]', ...args);
  };

  // ─────────────────────────────────────────────────────────────
  // Rate math
  // ─────────────────────────────────────────────────────────────
  function clampRate(n) {
    return Math.min(CONFIG.max, Math.max(CONFIG.min, n));
  }

  function roundRate(n) {
    // 两位小数，避免 0.75、1.25 被一位小数的四舍五入吃掉。
    return Math.round(n * 100) / 100;
  }

  function effectiveRate(baseRate, holdMultiplier) {
    return clampRate(roundRate(baseRate * holdMultiplier));
  }

  function parseCustomRate(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return clampRate(roundRate(n));
  }

  function formatControlRate(rate) {
    const rounded = clampRate(roundRate(rate));
    const text = Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
    return text + 'x';
  }

  function formatMenuRate(rate) {
    const rounded = roundRate(rate);
    return (Number.isInteger(rounded) ? String(rounded) : String(rounded)) + 'X';
  }

  // ─────────────────────────────────────────────────────────────
  // Storage — 页面 localStorage，Safari / 油猴通用
  // ─────────────────────────────────────────────────────────────
  const Storage = {
    getRate() {
      try {
        const value = localStorage.getItem('sjtu-speeder:rate');
        const n = Number(value);
        return Number.isFinite(n) && n > 0 ? clampRate(n) : 1;
      } catch (_) {
        return 1;
      }
    },
    setRate(rate) {
      try {
        localStorage.setItem('sjtu-speeder:rate', String(clampRate(rate)));
      } catch (_) {
        /* ignore */
      }
    },
  };

  // ─────────────────────────────────────────────────────────────
  // Player
  // 回看页有两路 KMedia（教师 / PPT）。playbackRate(数字) 会同时改播放器状态。
  // 直播等实时模式会拒绝改倍速，这时不要硬写 <video>，避免和播放器对着干。
  // ─────────────────────────────────────────────────────────────
  function getPool() {
    const pool = window.KMedia && window.KMedia.KMediaUniPool;
    return Array.isArray(pool) ? pool.slice() : [];
  }

  let writingVideos = 0;
  let lastApiSetAt = 0;
  let apiRejected = false;

  function writeVideos(rate) {
    writingVideos += 1;
    try {
      for (const video of document.querySelectorAll('video')) {
        try {
          if (Math.abs(video.playbackRate - rate) > 0.02) video.playbackRate = rate;
        } catch (_) {
          /* ignore */
        }
      }
    } finally {
      writingVideos -= 1;
    }
  }

  function applyRate(rate) {
    const pool = getPool();
    let allowVideo = pool.length === 0;
    const now = Date.now();
    const canCallApi = !apiRejected && now - lastApiSetAt >= 300;
    if (canCallApi) {
      let attempted = false;
      let rejectedNow = false;
      for (const player of pool) {
        try {
          const current = player.playbackRate();
          if (typeof current === 'number' && Math.abs(current - rate) <= 0.02) {
            allowVideo = true;
            continue;
          }
          attempted = true;
          const result = player.playbackRate(rate);
          if (typeof result === 'number' && Math.abs(result - rate) > 0.05) rejectedNow = true;
          else allowVideo = true;
        } catch (error) {
          log('playbackRate failed', error);
        }
      }
      if (attempted) lastApiSetAt = now;
      if (rejectedNow && !allowVideo) apiRejected = true;
    } else if (!apiRejected) {
      allowVideo = true;
    }
    if (!allowVideo) return;
    writeVideos(rate);
    requestAnimationFrame(() => writeVideos(rate));
  }

  function seekAll(delta) {
    const pool = getPool();
    if (pool.length) {
      for (const player of pool) {
        try {
          const current = player.currentTime();
          if (typeof current !== 'number' || !Number.isFinite(current)) continue;
          let duration = NaN;
          try {
            duration = player.duration();
          } catch (_) {
            /* ignore */
          }
          let next = Math.max(0, current + delta);
          if (typeof duration === 'number' && duration > 0) next = Math.min(duration, next);
          player.currentTime(next);
        } catch (error) {
          log('seek failed', error);
        }
      }
      return;
    }
    for (const video of document.querySelectorAll('video')) {
      try {
        const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
        video.currentTime = Math.max(0, Math.min(duration, video.currentTime + delta));
      } catch (_) {
        /* ignore */
      }
    }
  }

  function isVideoPlaying() {
    for (const video of document.querySelectorAll('video')) {
      if (!video.paused && !video.ended) return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // SpeedController
  // ─────────────────────────────────────────────────────────────
  class SpeedController {
    constructor() {
      this.baseRate = Storage.getRate();
      this.holdMultiplier = 1;
      this._holdKey = null;
      this._holdTimer = null;
      this._speedKey = null;
      this._speedHoldTimer = null;
      this._speedRepeatTimer = null;
      this._listeners = new Set();
    }

    getBaseRate() {
      return this.baseRate;
    }

    getEffectiveRate() {
      return effectiveRate(this.baseRate, this.holdMultiplier);
    }

    setBaseRate(rate) {
      this.baseRate = clampRate(rate);
      Storage.setRate(this.baseRate);
      this._emit();
    }

    onChange(callback) {
      this._listeners.add(callback);
      return () => this._listeners.delete(callback);
    }

    _emit() {
      const rate = this.getEffectiveRate();
      for (const callback of this._listeners) {
        try {
          callback(rate, this);
        } catch (error) {
          console.warn('[SJTUSpeedup] onChange error', error);
        }
      }
    }

    _isEditableTarget(node) {
      while (node && node !== document) {
        if (node.nodeType === 1) {
          const tag = (node.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
          if (node.isContentEditable) return true;
        }
        if (node.nodeType === 11 && node.host) {
          node = node.host;
          continue;
        }
        node = node.parentElement || node.parentNode;
      }
      return false;
    }

    _isTextEditing(event) {
      let active = document.activeElement;
      while (active && active.shadowRoot && active.shadowRoot.activeElement) {
        active = active.shadowRoot.activeElement;
      }
      if (this._isEditableTarget(active) || this._isEditableTarget(event.target)) return true;
      const path = event.composedPath ? event.composedPath() : [];
      return path.some((node) => {
        if (!node || node.nodeType !== 1) return false;
        const tag = (node.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
      });
    }

    bindKeys() {
      const clearSpeedRepeat = () => {
        if (this._speedHoldTimer) clearTimeout(this._speedHoldTimer);
        if (this._speedRepeatTimer) clearTimeout(this._speedRepeatTimer);
        this._speedHoldTimer = null;
        this._speedRepeatTimer = null;
        this._speedKey = null;
      };

      const clearHold = () => {
        if (this._holdTimer) {
          clearTimeout(this._holdTimer);
          this._holdTimer = null;
        }
        this._holdKey = null;
        if (this.holdMultiplier !== 1) {
          this.holdMultiplier = 1;
          this._emit();
        }
      };

      const onKeyDown = (event) => {
        if (event.repeat) {
          if (['Comma', 'Period', 'Semicolon', 'Quote'].includes(event.code)) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (this._isTextEditing(event)) return;

        const step = { Comma: -0.1, Period: 0.1, Semicolon: -0.5, Quote: 0.5 }[event.code];
        if (step && isVideoPlaying()) {
          event.preventDefault();
          event.stopPropagation();
          this.setBaseRate(roundRate(this.baseRate + step));
          if (this._speedKey) return;
          this._speedKey = event.code;
          const repeatEvery = event.code === 'Semicolon' || event.code === 'Quote' ? 200 : 100;
          this._speedHoldTimer = setTimeout(() => {
            const tick = () => {
              if (!this._speedKey) return;
              this.setBaseRate(roundRate(this.baseRate + step));
              this._speedRepeatTimer = setTimeout(tick, repeatEvery);
            };
            tick();
          }, CONFIG.holdDelayMs);
          return;
        }

        let kind = null;
        if (event.code === 'KeyP') kind = 'p';
        if (event.code === 'KeyO') kind = 'o';
        if (!kind || !isVideoPlaying() || this._holdKey) return;
        event.preventDefault();
        event.stopPropagation();
        this._holdKey = kind;
        const multiplier = kind === 'p' ? CONFIG.holdBoost : CONFIG.holdSlow;
        this._holdTimer = setTimeout(() => {
          this._holdTimer = null;
          this.holdMultiplier = multiplier;
          this._emit();
        }, CONFIG.holdDelayMs);
      };

      const onKeyUp = (event) => {
        if (['Comma', 'Period', 'Semicolon', 'Quote'].includes(event.code)) {
          clearSpeedRepeat();
          return;
        }
        if ((event.code === 'KeyO' || event.code === 'KeyP') && this._holdKey) {
          const pendingShortPress = this._holdTimer != null;
          const holdKey = this._holdKey;
          clearHold();
          if (pendingShortPress) seekAll(holdKey === 'o' ? -CONFIG.seekStep : CONFIG.seekStep);
        }
      };

      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('blur', () => {
        clearHold();
        clearSpeedRepeat();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          clearHold();
          clearSpeedRepeat();
        }
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Menu — 替换控制栏里原有的倍速列表。Vue 重新渲染时再补一次。
  // ─────────────────────────────────────────────────────────────
  const STYLE_ID = 'sjtu-speeder-style';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .control-popper .popper-ul.sjtu-speeder-menu {
        max-height: min(420px, 70vh);
        overflow-y: auto;
      }
      .sjtu-speeder-custom {
        padding: 4px 0 6px !important;
      }
      .sjtu-speeder-input {
        width: 76px;
        height: 28px;
        box-sizing: border-box;
        padding: 0 6px;
        border: 0;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
        font: inherit;
        font-size: 14px;
        text-align: center;
        outline: none;
        -webkit-appearance: none;
        appearance: none;
      }
      .sjtu-speeder-input::-webkit-outer-spin-button,
      .sjtu-speeder-input::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function isNativeSpeedList(ul) {
    const items = [...ul.children].filter((node) => node.tagName === 'LI');
    if (!items.length) return false;
    return items.every((item) => /^\d+(\.\d+)?X$/i.test((item.textContent || '').trim()));
  }

  function expectedRates() {
    return [...CONFIG.presets].reverse().map((rate) => String(rate));
  }

  function menuReady(ul) {
    if (!ul || ul.dataset.sjtuSpeeder !== '1') return false;
    const rates = [...ul.querySelectorAll('[data-sjtu-rate]')].map((item) => item.dataset.sjtuRate);
    if (rates.join(',') !== expectedRates().join(',')) return false;
    return Boolean(ul.querySelector('input.sjtu-speeder-input'));
  }

  function findSpeedPoppers() {
    return [...document.querySelectorAll('.control-popper')].filter((popper) => {
      const ul = popper.querySelector('.popper-ul');
      if (!ul) return false;
      return ul.dataset.sjtuSpeeder === '1' || isNativeSpeedList(ul);
    });
  }

  function rebuildMenu(ul, controller) {
    const active = document.activeElement;
    if (active && ul.contains(active) && active.classList.contains('sjtu-speeder-input')) return;

    ul.dataset.sjtuSpeeder = '1';
    ul.classList.add('sjtu-speeder-menu');
    ul.textContent = '';

    const custom = document.createElement('li');
    custom.className = 'sjtu-speeder-custom';
    custom.dataset.sjtuSpeederItem = '1';
    const input = document.createElement('input');
    input.className = 'sjtu-speeder-input';
    input.type = 'number';
    input.step = '0.1';
    input.min = String(CONFIG.min);
    input.max = String(CONFIG.max);
    input.placeholder = CONFIG.min + '-' + CONFIG.max;
    input.setAttribute('aria-label', '自定义倍速');
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        applyCustom(input, controller);
        input.blur();
      }
    });
    input.addEventListener('keyup', (event) => event.stopPropagation());
    input.addEventListener('keypress', (event) => event.stopPropagation());
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('mousedown', (event) => event.stopPropagation());
    input.addEventListener('blur', () => applyCustom(input, controller));
    custom.appendChild(input);
    ul.appendChild(custom);

    for (const rate of [...CONFIG.presets].reverse()) {
      const item = document.createElement('li');
      item.dataset.sjtuSpeederItem = '1';
      item.dataset.sjtuRate = String(rate);
      item.textContent = formatMenuRate(rate);
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        controller.setBaseRate(rate);
      });
      ul.appendChild(item);
    }
  }

  function applyCustom(input, controller) {
    const parsed = parseCustomRate(input.value);
    if (parsed == null) {
      input.value = '';
      return;
    }
    input.value = String(roundRate(parsed));
    controller.setBaseRate(parsed);
  }

  function paintPopper(popper, controller) {
    const ul = popper.querySelector('.popper-ul');
    if (!ul) return;
    const base = controller.getBaseRate();
    for (const item of ul.querySelectorAll('[data-sjtu-rate]')) {
      const selected = Math.abs(parseFloat(item.dataset.sjtuRate) - base) < 0.05;
      if (item.classList.contains('active') !== selected) item.classList.toggle('active', selected);
    }
    const input = ul.querySelector('input.sjtu-speeder-input');
    if (input && document.activeElement !== input) {
      const onPreset = CONFIG.presets.some((preset) => Math.abs(preset - base) < 0.05);
      const nextValue = onPreset ? '' : String(roundRate(base));
      if (input.value !== nextValue) input.value = nextValue;
    }
    const label = popper.querySelector(':scope > .popper-text');
    if (!label) return;
    const text = formatControlRate(controller.getEffectiveRate());
    if (label.textContent !== text) label.textContent = text;
    if (label.title !== 'SJTUSpeedup 倍速') label.title = 'SJTUSpeedup 倍速';
  }

  function ensurePopper(popper, controller) {
    const ul = popper.querySelector('.popper-ul');
    if (!ul) return;
    if (ul.dataset.sjtuSpeeder !== '1' && !isNativeSpeedList(ul)) return;
    const observer = popper.__sjtuSpeederObserver;
    if (observer) observer.disconnect();
    try {
      if (!menuReady(ul)) rebuildMenu(ul, controller);
      paintPopper(popper, controller);
    } finally {
      if (observer) {
        observer.observe(popper, { childList: true, subtree: true, characterData: true });
      }
    }
  }

  function watchPopper(popper, controller) {
    if (popper.__sjtuSpeederObserver) return;
    const observer = new MutationObserver(() => ensurePopper(popper, controller));
    popper.__sjtuSpeederObserver = observer;
    observer.observe(popper, { childList: true, subtree: true, characterData: true });
  }

  function mountMenus(controller) {
    injectStyle();
    for (const popper of findSpeedPoppers()) {
      watchPopper(popper, controller);
      ensurePopper(popper, controller);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Boot
  // ─────────────────────────────────────────────────────────────
  function boot() {
    const controller = new SpeedController();
    controller.onChange(() => {
      applyRate(controller.getEffectiveRate());
      mountMenus(controller);
    });
    controller.bindKeys();

    const onMedia = (event) => {
      if (writingVideos) return;
      const target = event.target;
      if (!target || target.tagName !== 'VIDEO') return;
      const expected = controller.getEffectiveRate();
      if (Math.abs(target.playbackRate - expected) > 0.05) applyRate(expected);
    };
    document.addEventListener('ratechange', onMedia, true);
    document.addEventListener('playing', onMedia, true);
    document.addEventListener('seeked', onMedia, true);

    const tick = () => {
      mountMenus(controller);
      if (document.querySelector('video') || getPool().length) {
        applyRate(controller.getEffectiveRate());
      }
    };
    tick();
    setInterval(tick, 500);

    console.info(
      `[SJTUSpeedup] v1.0.1 active — base ${formatControlRate(controller.getBaseRate())}. Hold O/P 0.5s to temp slow/boost.`
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
