// ==UserScript==
// @name         SJTUSpeedup — 课堂回看倍速
// @namespace    https://v.sjtu.edu.cn/jy-application-resourcemanage-ui/
// @version      1.0.2
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
    syncSmooth(rate);
  }

  // ─────────────────────────────────────────────────────────────
  // Safari >2x
  // AVFoundation 在倍速大于 2 时只解关键帧。这节课大约每 3 秒一个关键帧，
  // 所以 2.5x / 3x 会变成一页一页地跳。Chrome / Firefox 会解全部帧，不走这里。
  // 进度仍由 <video> 的 currentTime 走，字幕和两路进度不用另计时。
  // ─────────────────────────────────────────────────────────────
  function isSafariLike() {
    const ua = navigator.userAgent;
    if (/iP(hone|ad|od)/.test(ua)) return true;
    if (/Android/.test(ua)) return false;
    return /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua);
  }

  function needsSmoothRate(rate, safariLike, hasDecoder) {
    return rate > 2 && safariLike === true && hasDecoder === true;
  }

  function readU32(bytes, o) {
    return ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  }

  function readType(bytes, o) {
    return String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  }

  function readU64(bytes, o) {
    return readU32(bytes, o) * 4294967296 + readU32(bytes, o + 4);
  }

  function readI32(bytes, o) {
    const u = readU32(bytes, o);
    return u > 0x7fffffff ? u - 4294967296 : u;
  }

  const MP4_CONTAINERS = { moov: 1, trak: 1, edts: 1, mdia: 1, minf: 1, stbl: 1 };

  function walkBoxes(bytes, start, end, fn) {
    let o = start;
    while (o + 8 <= end) {
      let size = readU32(bytes, o);
      const type = readType(bytes, o + 4);
      let header = 8;
      if (size === 1) {
        if (o + 16 > end) return;
        size = readU64(bytes, o + 8);
        header = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (size < header || o + size > end) return;
      const dive = fn(type, o, size, header);
      if (dive !== false && MP4_CONTAINERS[type]) walkBoxes(bytes, o + header, o + size, fn);
      o += size;
    }
  }

  function parseStts(bytes, o, size, header) {
    const count = readU32(bytes, o + header + 4);
    const entries = [];
    let p = o + header + 8;
    const end = o + size;
    for (let i = 0; i < count && p + 8 <= end; i += 1) {
      entries.push({ n: readU32(bytes, p), d: readU32(bytes, p + 4) });
      p += 8;
    }
    return entries;
  }

  function parseStss(bytes, o, header) {
    const count = readU32(bytes, o + header + 4);
    const keys = new Uint32Array(count);
    let p = o + header + 8;
    for (let i = 0; i < count; i += 1) {
      keys[i] = readU32(bytes, p) - 1;
      p += 4;
    }
    return keys;
  }

  function parseStsc(bytes, o, size, header) {
    const count = readU32(bytes, o + header + 4);
    const entries = [];
    let p = o + header + 8;
    const end = o + size;
    for (let i = 0; i < count && p + 12 <= end; i += 1) {
      entries.push({ first: readU32(bytes, p), spc: readU32(bytes, p + 4) });
      p += 12;
    }
    return entries;
  }

  function parseStsz(bytes, o, header) {
    const fixed = readU32(bytes, o + header + 4);
    const count = readU32(bytes, o + header + 8);
    const sizes = new Uint32Array(count);
    if (fixed) {
      sizes.fill(fixed);
    } else {
      let p = o + header + 12;
      for (let i = 0; i < count; i += 1) {
        sizes[i] = readU32(bytes, p);
        p += 4;
      }
    }
    return sizes;
  }

  function parseChunks(bytes, o, header, width) {
    const count = readU32(bytes, o + header + 4);
    const offsets = new Float64Array(count);
    let p = o + header + 8;
    for (let i = 0; i < count; i += 1) {
      offsets[i] = width === 8 ? readU64(bytes, p) : readU32(bytes, p);
      p += width;
    }
    return offsets;
  }

  function parseElst(bytes, o, size, header, movieTimescale) {
    const ver = bytes[o + header];
    const count = readU32(bytes, o + header + 4);
    let p = o + header + 8;
    let empty = 0;
    for (let i = 0; i < count && p + 8 <= o + size; i += 1) {
      let segDur;
      let mediaTime;
      if (ver === 1) {
        segDur = readU64(bytes, p);
        const hi = readU32(bytes, p + 8);
        const lo = readU32(bytes, p + 12);
        mediaTime = hi * 4294967296 + lo;
        if (hi > 0x7fffffff) mediaTime = -1;
        p += 20;
      } else {
        segDur = readU32(bytes, p);
        mediaTime = readI32(bytes, p + 4);
        p += 12;
      }
      if (mediaTime < 0) {
        empty += movieTimescale ? segDur / movieTimescale : 0;
        continue;
      }
      return { empty, mediaTime };
    }
    return { empty, mediaTime: 0 };
  }

  function parseAvc(bytes, o, size, header) {
    const end = o + size;
    let p = o + header + 8;
    if (p + 8 > end) return null;
    const entrySize = readU32(bytes, p);
    const codecType = readType(bytes, p + 4);
    if (codecType !== 'avc1' && codecType !== 'avc3') return null;
    let c = p + 86;
    const entryEnd = Math.min(end, p + entrySize);
    while (c + 8 <= entryEnd) {
      const csz = readU32(bytes, c);
      const ct = readType(bytes, c + 4);
      if (csz < 8 || c + csz > entryEnd) break;
      if (ct === 'avcC') {
        const description = bytes.slice(c + 8, c + csz);
        if (description.length < 4) return null;
        const hex = [description[1], description[2], description[3]]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        return { codec: 'avc1.' + hex, description };
      }
      c += csz;
    }
    return null;
  }

  function parseMoov(bytes) {
    if (bytes.length < 8 || readType(bytes, 4) !== 'moov') return null;
    let moovSize = readU32(bytes, 0);
    let moovHeader = 8;
    if (moovSize === 1) {
      moovSize = readU64(bytes, 8);
      moovHeader = 16;
    } else if (moovSize === 0) {
      moovSize = bytes.length;
    }
    const moovEnd = Math.min(bytes.length, moovSize);
    let movieTimescale = 1000;
    const traks = [];
    walkBoxes(bytes, moovHeader, moovEnd, (type, o, size, header) => {
      if (type === 'mvhd') {
        const ver = bytes[o + header];
        movieTimescale = ver === 1 ? readU32(bytes, o + header + 20) : readU32(bytes, o + header + 12);
      }
      if (type === 'trak') traks.push([o + header, o + size]);
      return type === 'trak' ? false : undefined;
    });
    for (let i = 0; i < traks.length; i += 1) {
      const index = parseTrak(bytes, traks[i][0], traks[i][1], movieTimescale);
      if (index) return index;
    }
    return null;
  }

  function parseTrak(bytes, start, end, movieTimescale) {
    let handler = '';
    let timescale = 0;
    let elst = null;
    let stbl = null;
    walkBoxes(bytes, start, end, (type, o, size, header) => {
      if (type === 'hdlr') {
        const name = readType(bytes, o + header + 8);
        if (name === 'vide' || name === 'soun') handler = name;
      }
      if (type === 'mdhd') {
        const ver = bytes[o + header];
        timescale = ver === 1 ? readU32(bytes, o + header + 20) : readU32(bytes, o + header + 12);
      }
      if (type === 'elst') elst = parseElst(bytes, o, size, header, movieTimescale);
      if (type === 'stbl') {
        stbl = [o + header, o + size];
        return false;
      }
      return undefined;
    });
    if (handler !== 'vide' || !timescale || !stbl) return null;
    return parseStbl(bytes, stbl[0], stbl[1], timescale, elst || { empty: 0, mediaTime: 0 });
  }

  function parseStbl(bytes, start, end, timescale, elst) {
    let stts = null;
    let stss = null;
    let stsc = null;
    let sizes = null;
    let chunks = null;
    let avc = null;
    walkBoxes(bytes, start, end, (type, o, size, header) => {
      if (type === 'stts') stts = parseStts(bytes, o, size, header);
      if (type === 'stss') stss = parseStss(bytes, o, header);
      if (type === 'stsc') stsc = parseStsc(bytes, o, size, header);
      if (type === 'stsz') sizes = parseStsz(bytes, o, header);
      if (type === 'stco') chunks = parseChunks(bytes, o, header, 4);
      if (type === 'co64') chunks = parseChunks(bytes, o, header, 8);
      if (type === 'stsd') avc = parseAvc(bytes, o, size, header);
      return false;
    });
    if (!avc || !stts || !stsc || !sizes || !chunks || !sizes.length) return null;
    return buildSampleIndex(stts, sizes, stsc, chunks, stss, timescale, elst, avc);
  }

  function buildSampleIndex(stts, sizes, stsc, chunks, stss, timescale, elst, avc) {
    const count = sizes.length;
    if (!count || count > 1000000 || !stsc.length) return null;
    const pts = new Float32Array(count);
    const key = new Uint8Array(count);
    let si = 0;
    let dts = 0;
    for (let e = 0; e < stts.length; e += 1) {
      const n = stts[e].n;
      const d = stts[e].d;
      for (let i = 0; i < n && si < count; i += 1) {
        pts[si] = elst.empty + (dts - elst.mediaTime) / timescale;
        dts += d;
        si += 1;
      }
    }
    if (si !== count) return null;
    if (stss && stss.length) {
      for (let i = 0; i < stss.length; i += 1) {
        const idx = stss[i];
        if (idx >= 0 && idx < count) key[idx] = 1;
      }
    } else {
      key[0] = 1;
    }
    const offset = new Float64Array(count);
    let sample = 0;
    let stscIndex = 0;
    for (let c = 0; c < chunks.length && sample < count; c += 1) {
      while (stscIndex + 1 < stsc.length && stsc[stscIndex + 1].first <= c + 1) stscIndex += 1;
      const spc = stsc[stscIndex].spc;
      let off = chunks[c];
      for (let k = 0; k < spc && sample < count; k += 1) {
        offset[sample] = off;
        off += sizes[sample];
        sample += 1;
      }
    }
    if (sample !== count) return null;
    return {
      codec: avc.codec,
      description: avc.description,
      pts,
      offset,
      size: sizes,
      key,
      count,
    };
  }

  function sampleAtTime(pts, key, time) {
    const count = pts.length;
    if (!count) return 0;
    let lo = 0;
    let hi = count - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid] <= time + 0.001) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    while (ans > 0 && !key[ans]) ans -= 1;
    return ans;
  }

  function parseTotal(header) {
    if (!header) return 0;
    const n = Number(String(header).split('/')[1]);
    return Number.isFinite(n) ? n : 0;
  }

  function locateMoov(head, total) {
    let o = 0;
    while (o + 8 <= head.length) {
      let size = readU32(head, o);
      const type = readType(head, o + 4);
      let header = 8;
      if (size === 1) {
        if (o + 16 > head.length) break;
        size = readU64(head, o + 8);
        header = 16;
      }
      if (size < header) break;
      if (type === 'moov') {
        if (o + size <= head.length) return { bytes: head.slice(o, o + size) };
        return { start: o, size };
      }
      if (o + size > head.length) {
        if (type === 'mdat') return { start: o + size, size: total ? total - (o + size) : 0 };
        break;
      }
      o += size;
    }
    throw new Error('moov not found');
  }

  async function fetchIndex(url) {
    const headRes = await fetch(url, { headers: { Range: 'bytes=0-65535' } });
    if (headRes.status !== 200 && headRes.status !== 206) throw new Error('mp4 head ' + headRes.status);
    const head = new Uint8Array(await headRes.arrayBuffer());
    const total = parseTotal(headRes.headers.get('content-range'));
    const located = locateMoov(head, total);
    let moov = located.bytes;
    if (!moov) {
      const start = located.start;
      const end = located.size ? start + located.size - 1 : total ? total - 1 : '';
      const range = end === '' ? 'bytes=' + start + '-' : 'bytes=' + start + '-' + end;
      const res = await fetch(url, { headers: { Range: range } });
      if (res.status !== 200 && res.status !== 206) throw new Error('mp4 moov ' + res.status);
      moov = new Uint8Array(await res.arrayBuffer());
    }
    const index = parseMoov(moov);
    if (!index) throw new Error('no avc track');
    return index;
  }

  const indexCache = new Map();
  const smoothItems = new Map();
  const smoothFailed = new WeakSet();
  const smoothActive = new Set();
  let smoothRaf = 0;
  let smoothAnnounced = false;

  function loadIndex(url) {
    if (!indexCache.has(url)) {
      indexCache.set(
        url,
        fetchIndex(url).catch((error) => {
          indexCache.delete(url);
          throw error;
        })
      );
    }
    return indexCache.get(url);
  }

  function scheduleSmooth() {
    if (smoothRaf || smoothActive.size === 0) return;
    const step = () => {
      smoothRaf = 0;
      for (const item of smoothActive) item.tick();
      if (smoothActive.size) smoothRaf = requestAnimationFrame(step);
    };
    smoothRaf = requestAnimationFrame(step);
  }

  class SmoothItem {
    constructor(video, index) {
      this.video = video;
      this.index = index;
      this.gen = 0;
      this.decoder = null;
      this.queue = [];
      this.nextSample = 0;
      this.cache = null;
      this.cacheStart = 0;
      this.pumping = false;
      this.lastResync = 0;
      this.anchorWall = null;
      this.anchorMedia = 0;
      this.lastActual = null;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sjtu-smooth-canvas';
      this.canvas.width = video.videoWidth || 1920;
      this.canvas.height = video.videoHeight || 1080;
      this.ctx = this.canvas.getContext('2d');
      video.after(this.canvas);
      this.place();
    }

    place() {
      const parent = this.canvas.parentElement;
      if (!parent) return;
      const pr = parent.getBoundingClientRect();
      const vr = this.video.getBoundingClientRect();
      this.canvas.style.left = vr.left - pr.left + 'px';
      this.canvas.style.top = vr.top - pr.top + 'px';
      this.canvas.style.width = vr.width + 'px';
      this.canvas.style.height = vr.height + 'px';
    }

    openDecoder() {
      const gen = this.gen;
      const decoder = new VideoDecoder({
        output: (frame) => {
          if (gen !== this.gen) {
            frame.close();
            return;
          }
          this.queue.push(frame);
        },
        error: (error) => {
          log('smooth decode', error);
          this.fail();
        },
      });
      decoder.configure({
        codec: this.index.codec,
        description: this.index.description,
        hardwareAcceleration: 'prefer-hardware',
        optimizeForLatency: true,
      });
      this.decoder = decoder;
    }

    dropQueue() {
      for (const frame of this.queue) {
        try {
          frame.close();
        } catch (_) {
          /* ignore */
        }
      }
      this.queue = [];
    }

    resync() {
      this.gen += 1;
      this.lastResync = performance.now();
      this.dropQueue();
      if (this.decoder && this.decoder.state !== 'closed') {
        try {
          this.decoder.close();
        } catch (_) {
          /* ignore */
        }
      }
      this.decoder = null;
      this.cache = null;
      this.nextSample = sampleAtTime(this.index.pts, this.index.key, this.video.currentTime);
      try {
        this.openDecoder();
      } catch (error) {
        log('smooth configure', error);
        this.fail();
      }
    }

    fail() {
      smoothFailed.add(this.video);
      detachSmooth(this.video);
    }

    start() {
      this.resync();
      smoothActive.add(this);
      scheduleSmooth();
      if (!smoothAnnounced) {
        smoothAnnounced = true;
        console.info('[SJTUSpeedup] 高于 2 倍时改为逐帧绘制，避免 Safari 只跳关键帧。');
      }
    }

    destroy() {
      this.gen += 1;
      smoothActive.delete(this);
      this.dropQueue();
      if (this.decoder && this.decoder.state !== 'closed') {
        try {
          this.decoder.close();
        } catch (_) {
          /* ignore */
        }
      }
      this.decoder = null;
      this.canvas.remove();
    }

    mediaNow() {
      const video = this.video;
      const actual = video.currentTime;
      const now = performance.now();
      const rate = video.playbackRate || 1;
      if (this.anchorWall == null) {
        this.anchorWall = now;
        this.anchorMedia = actual;
        this.lastActual = actual;
        return actual;
      }
      const predicted = this.anchorMedia + ((now - this.anchorWall) / 1000) * rate;
      const delta = actual - this.lastActual;
      const caughtUp = Math.abs(actual - predicted) <= 0.8;
      if ((delta < -0.3 || delta > 1.5) && !caughtUp) {
        this.lastActual = actual;
        this.anchorMedia = actual;
        this.anchorWall = now;
        if (now - this.lastResync > 200) this.resync();
        return actual;
      }
      if (Math.abs(delta) > 0.02) {
        this.lastActual = actual;
        this.anchorMedia = actual;
        this.anchorWall = now;
        return actual;
      }
      if (now - this.anchorWall < 250) return actual;
      if (Number.isFinite(video.duration)) return Math.min(video.duration, predicted);
      return predicted;
    }

    tick() {
      const video = this.video;
      if (!video.isConnected || video.paused || video.ended) return;
      const t = this.mediaNow();
      const newest = this.queue[this.queue.length - 1];
      const cursor = Math.min(this.nextSample, this.index.count - 1);
      if (
        newest &&
        newest.timestamp / 1e6 < t - 1.5 &&
        this.index.pts[cursor] < t - 1.5 &&
        performance.now() - this.lastResync > 1000
      ) {
        this.resync();
        return;
      }
      this.place();
      this.paint(t);
      this.pump();
    }

    paint(t) {
      while (this.queue.length >= 2 && this.queue[1].timestamp / 1e6 <= t + 0.02) {
        this.queue.shift().close();
      }
      const frame = this.queue[0];
      if (!frame) return;
      const ft = frame.timestamp / 1e6;
      if (ft > t + 0.04) return;
      if (!this.canvas.width) {
        this.canvas.width = frame.displayWidth || this.video.videoWidth || 1920;
        this.canvas.height = frame.displayHeight || this.video.videoHeight || 1080;
      }
      this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    }

    async readSample(i) {
      const offset = this.index.offset[i];
      const size = this.index.size[i];
      if (this.cache && offset >= this.cacheStart && offset + size <= this.cacheStart + this.cache.length) {
        return this.cache.slice(offset - this.cacheStart, offset - this.cacheStart + size);
      }
      let end = offset + size;
      const limit = offset + 1572864;
      for (let j = i; j < this.index.count; j += 1) {
        const sampleEnd = this.index.offset[j] + this.index.size[j];
        if (sampleEnd > limit) break;
        if (this.index.offset[j] > end + 262144) break;
        end = sampleEnd;
      }
      const res = await fetch(this.video.currentSrc, {
        headers: { Range: 'bytes=' + offset + '-' + (end - 1) },
      });
      if (res.status !== 200 && res.status !== 206) throw new Error('sample ' + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      this.cache = buf;
      this.cacheStart = offset;
      return buf.slice(0, Math.min(size, buf.length));
    }

    async pump() {
      if (this.pumping || !this.decoder || this.decoder.state !== 'configured') return;
      this.pumping = true;
      const gen = this.gen;
      try {
        while (gen === this.gen && this.decoder && this.decoder.state === 'configured') {
          if (this.decoder.decodeQueueSize > 8 || this.queue.length > 16) break;
          if (this.nextSample >= this.index.count) break;
          const i = this.nextSample;
          const pts = this.index.pts[i];
          if (pts > this.video.currentTime + 0.45 && this.queue.length > 1) break;
          const bytes = await this.readSample(i);
          if (gen !== this.gen || !this.decoder || this.decoder.state !== 'configured') break;
          this.decoder.decode(
            new EncodedVideoChunk({
              type: this.index.key[i] ? 'key' : 'delta',
              timestamp: Math.max(0, Math.round(pts * 1e6)),
              data: bytes,
            })
          );
          this.nextSample += 1;
        }
      } catch (error) {
        log('smooth pump', error);
        this.fail();
      } finally {
        this.pumping = false;
      }
    }
  }

  function detachSmooth(video) {
    video.__sjtuSmoothToken = null;
    const item = smoothItems.get(video);
    if (!item) return;
    item.destroy();
    smoothItems.delete(video);
  }

  function stopSmooth() {
    for (const video of [...smoothItems.keys()]) detachSmooth(video);
  }

  function syncSmooth(rate) {
    if (!needsSmoothRate(rate, isSafariLike(), typeof VideoDecoder === 'function')) {
      stopSmooth();
      return;
    }
    const seen = new Set();
    for (const video of document.querySelectorAll('video')) {
      seen.add(video);
      if (video.__sjtuSmoothSrc !== video.currentSrc) {
        video.__sjtuSmoothSrc = video.currentSrc;
        smoothFailed.delete(video);
        detachSmooth(video);
      }
      if (video.paused || video.ended || !video.currentSrc || !video.videoWidth) {
        detachSmooth(video);
        continue;
      }
      if (smoothFailed.has(video) || smoothItems.has(video) || video.__sjtuSmoothToken) continue;
      const token = {};
      video.__sjtuSmoothToken = token;
      loadIndex(video.currentSrc)
        .then((index) => {
          if (video.__sjtuSmoothToken !== token) return;
          video.__sjtuSmoothToken = null;
          if (video.paused || video.ended || !video.isConnected) return;
          const item = new SmoothItem(video, index);
          smoothItems.set(video, item);
          item.start();
        })
        .catch((error) => {
          if (video.__sjtuSmoothToken === token) video.__sjtuSmoothToken = null;
          smoothFailed.add(video);
          log('smooth index', error);
        });
    }
    for (const video of [...smoothItems.keys()]) {
      if (!seen.has(video) || !video.isConnected) detachSmooth(video);
    }
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
      .sjtu-smooth-canvas {
        position: absolute;
        pointer-events: none;
        z-index: 1;
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
      `[SJTUSpeedup] v1.0.2 active — base ${formatControlRate(controller.getBaseRate())}. Hold O/P 0.5s to temp slow/boost.`
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
