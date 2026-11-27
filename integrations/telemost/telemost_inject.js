// telemost_inject.js — выполняется в каждом фрейме Телемоста до его скриптов.
// 1) перехватывает RTCPeerConnection и собирает удалённый звук в PCM16 16 кГц;
// 2) подменяет камеру на canvas с зацикленным видео-аватаром (если задан videoUrl);
// 3) подменяет микрофон на тишину, чтобы не шуметь в комнате.
(() => {
  'use strict';
  const CFG = window.__TELEMOST_BOT_CONFIG__ || {};
  const LOG = '[tm-bot]';
  const state = {
    pcs: [],
    tracks: new Map(),
    audioCtx: null,
    processor: null,
    sink: null,
    resample: 3,
    pcmBytes: 0,
    pcmFrames: 0,
    pcmRunning: false,
    avatarStream: null,
    blackStream: null,
    silenceTrack: null,
    micFileTrack: null,
    micFileGain: null,
    micFileStart: null,
    micFileStarted: false,
    introRequested: false,
    introStarted: false,
    avatarStart: null,
    errors: [],
  };
  window.__tmBotState = state;

  function log(...a) { if (CFG.debug) console.log(LOG, ...a); }

  // ---------- 1. Перехват WebRTC ----------
  const OrigPC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if (OrigPC) {
    function WrappedPC(...args) {
      const pc = new OrigPC(...args);
      state.pcs.push(pc);
      pc.addEventListener('track', (ev) => {
        if (ev.track && ev.track.kind === 'audio') addTrack(ev.track, 'track');
        if (ev.streams) {
          for (const s of ev.streams) for (const t of s.getAudioTracks()) addTrack(t, 'stream');
        }
      });
      return pc;
    }
    WrappedPC.prototype = OrigPC.prototype;
    Object.setPrototypeOf(WrappedPC, OrigPC);
    for (const k of Object.getOwnPropertyNames(OrigPC)) {
      try { if (!(k in WrappedPC)) WrappedPC[k] = OrigPC[k]; } catch (e) { /* ignore */ }
    }
    window.RTCPeerConnection = WrappedPC;
    if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = WrappedPC;
  }

  function makePcmSender(key) {
    const acc = [];
    let accLen = 0;
    return (ev) => {
      if (!state.pcmRunning) return;
      const ch = ev.inputBuffer.getChannelData(0);
      const step = state.resample;
      for (let i = 0; i < ch.length; i += step) {
        let s = 0, n = 0;
        for (let j = 0; j < step && i + j < ch.length; j++) { s += ch[i + j]; n++; }
        let v = s / n;
        if (v > 1) v = 1; else if (v < -1) v = -1;
        acc.push(v < 0 ? v * 0x8000 : v * 0x7fff);
        accLen++;
      }
      if (accLen >= 8000) {
        const ints = new Int16Array(acc);
        acc.length = 0;
        accLen = 0;
        const bytes = new Uint8Array(ints.buffer);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        state.pcmBytes += bytes.length;
        state.pcmFrames += ints.length;
        const b64 = btoa(bin);
        if (typeof window.__tmBotPcm === 'function') {
          try { window.__tmBotPcm(b64, location.pathname, key); } catch (e) { state.errors.push(String(e)); }
        }
      }
    };
  }

  function ensureAudio() {
    if (!state.audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      state.audioCtx = new AC({ sampleRate: 48000 });
      state.resample = Math.max(1, Math.round(state.audioCtx.sampleRate / 16000));
      state.processor = state.audioCtx.createScriptProcessor(4096, 1, 1);
      state.sink = state.audioCtx.createGain();
      state.sink.gain.value = 0;
      state.processor.connect(state.sink);
      state.sink.connect(state.audioCtx.destination);
      state.processor.onaudioprocess = onAudio;
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume().catch(() => {});
    return state.audioCtx;
  }

  function addTrack(track, source) {
    if (!track || track.kind !== 'audio') return;
    if (state.tracks.has(track.id)) return;
    try {
      const ctx = ensureAudio();
      const src = ctx.createMediaStreamSource(new MediaStream([track]));
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      src.connect(proc);
      proc.connect(sink);
      sink.connect(ctx.destination);
      proc.onaudioprocess = makePcmSender('track:' + track.id);
      state.tracks.set(track.id, { track, src, proc, sink, source });
      track.addEventListener('ended', () => {
        state.tracks.delete(track.id);
        try { src.disconnect(); } catch (e) { /* ignore */ }
        try { proc.disconnect(); } catch (e) { /* ignore */ }
        try { sink.disconnect(); } catch (e) { /* ignore */ }
      });
      log('audio track', track.id, source, 'total', state.tracks.size);
    } catch (e) {
      state.errors.push(String(e));
    }
  }

  // Общий микс остаётся резервом, пока отдельные дорожки не появились.
  let mixSender = null;
  function onAudio(ev) {
    if (state.tracks.size > 0) return;
    if (!mixSender) mixSender = makePcmSender('mix');
    mixSender(ev);
  }

  window.__tmBotStartPcm = () => { ensureAudio(); state.pcmRunning = true; return true; };
  window.__tmBotStopPcm = () => { state.pcmRunning = false; return true; };

  window.__tmBotStatus = async () => {
    const out = {
      pcs: state.pcs.length,
      connected: 0,
      tracks: state.tracks.size,
      pcmBytes: state.pcmBytes,
      pcmFrames: state.pcmFrames,
      pcmRunning: state.pcmRunning,
      audioCtx: state.audioCtx ? state.audioCtx.state : 'none',
      errors: state.errors.slice(0, 5),
      video: { bytes: 0, frames: 0, width: 0, height: 0 },
      audioSent: 0,
    };
    for (const pc of state.pcs) {
      try { if (pc.connectionState === 'connected') out.connected++; } catch (e) { /* ignore */ }
      try {
        const st = await pc.getStats();
        st.forEach((r) => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            out.video.bytes += r.bytesSent || 0;
            out.video.frames += r.framesEncoded || 0;
            if (r.frameWidth) out.video.width = r.frameWidth;
            if (r.frameHeight) out.video.height = r.frameHeight;
          }
          if (r.type === 'outbound-rtp' && r.kind === 'audio') out.audioSent += r.bytesSent || 0;
        });
      } catch (e) { /* ignore */ }
    }
    return out;
  };

  // ---------- 2. Подмена камеры и микрофона ----------
  const MD = navigator.mediaDevices;
  if (MD && MD.getUserMedia) {
    const origGUM = MD.getUserMedia.bind(MD);
    let avatarPromise = null;

    function toneTrack() {
      const ctx = ensureAudio();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = CFG.toneHz || 440;
      const gain = ctx.createGain();
      gain.gain.value = CFG.toneGain || 0.05;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      state.toneOsc = osc;
      return dest.stream.getAudioTracks()[0];
    }

    async function fileTrack() {
      if (state.micFileTrack && state.micFileTrack.readyState === 'live') return state.micFileTrack;
      if (state.micFilePromise) return state.micFilePromise;
      state.micFilePromise = (async () => {
        const ctx = ensureAudio();
        const resp = await fetch(CFG.micFileUrl, { cache: 'no-store' });
        if (!resp.ok) throw new Error('mic file HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(buf);
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.loop = !!CFG.micLoop;
        const dest = ctx.createMediaStreamDestination();
        const gain = ctx.createGain();
        gain.gain.value = CFG.startOnJoin ? 0 : 1;
        src.connect(gain);
        gain.connect(dest);
        state.micFileSource = src;
        state.micFileGain = gain;
        state.micFileTrack = dest.stream.getAudioTracks()[0];
        state.micFileStart = () => {
          if (state.micFileStarted) return;
          state.micFileStarted = true;
          try { gain.gain.setValueAtTime(1, ctx.currentTime); } catch (e) { gain.gain.value = 1; }
          try { src.start(0); } catch (e) { log('mic file start failed', String(e)); }
        };
        if (!CFG.startOnJoin || state.introRequested) state.micFileStart();
        return state.micFileTrack;
      })().catch((e) => { state.micFilePromise = null; throw e; });
      return state.micFilePromise;
    }

    function silenceTrack() {
      if (state.silenceTrack && state.silenceTrack.readyState === 'live') return state.silenceTrack;
      const ctx = ensureAudio();
      const dest = ctx.createMediaStreamDestination();
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(dest);
      state.silenceTrack = dest.stream.getAudioTracks()[0];
      state.silenceTrack.enabled = false;
      log('mic track disabled');
      return state.silenceTrack;
    }

    function blackStream() {
      if (state.blackStream) return state.blackStream;
      const fps = CFG.fps || 24;
      const w = CFG.width || 1280;
      const h = CFG.height || 720;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d', { alpha: false });
      const paint = () => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); };
      paint();
      setInterval(paint, Math.max(10, Math.round(1000 / fps)));
      const stream = c.captureStream(fps);
      const track = stream.getVideoTracks()[0];
      if (track) {
        try { Object.defineProperty(track, 'label', { configurable: true, get: () => CFG.cameraLabel || 'HD Camera' }); } catch (e) { /* ignore */ }
      }
      state.blackStream = stream;
      log('black screen stream ready', w, h, fps);
      return stream;
    }

    async function avatarStream() {
      if (avatarPromise) return avatarPromise;
      avatarPromise = (async () => {
        const urls = (CFG.videoUrls && CFG.videoUrls.length)
          ? CFG.videoUrls.slice()
          : (CFG.videoUrl ? [CFG.videoUrl] : []);
        if (!urls.length) throw new Error('no avatar videos');
        const blobs = [];
        for (const url of urls) {
          const resp = await fetch(url, { cache: 'no-store' });
          if (!resp.ok) throw new Error('avatar fetch HTTP ' + resp.status + ': ' + url);
          blobs.push(await resp.blob());
        }
        const objectUrls = blobs.map((blob) => URL.createObjectURL(blob));
        const fps = CFG.fps || 24;
        const w = CFG.width || 1280;
        const h = CFG.height || 720;
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d', { alpha: false });
        const paintBlack = () => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); };
        paintBlack();

        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.setAttribute('playsinline', '');
        v.loop = false;
        v.style.cssText = 'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
        (document.documentElement || document.body).appendChild(v);

        let idx = 0;
        let ready = false;
        const draw = () => {
          if (ready && v.readyState >= 2 && v.videoWidth) {
            try {
              const scale = Math.max(w / v.videoWidth, h / v.videoHeight);
              const dw = v.videoWidth * scale;
              const dh = v.videoHeight * scale;
              g.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
            } catch (e) { paintBlack(); }
          } else {
            paintBlack();
          }
        };
        draw();
        setInterval(draw, Math.max(10, Math.round(1000 / fps)));

        const loadClip = async (i) => {
          ready = false;
          idx = i % urls.length;
          v.src = objectUrls[idx];
          v.load();
          await new Promise((resolve, reject) => {
            let done = false;
            const ok = () => { if (!done) { done = true; resolve(); } };
            const bad = () => { if (!done) { done = true; reject(new Error('clip failed: ' + urls[idx])); } };
            v.addEventListener('loadeddata', ok, { once: true });
            v.addEventListener('error', bad, { once: true });
            setTimeout(ok, CFG.loadTimeoutMs || 8000);
          });
          try { await v.play(); } catch (e) { log('clip play failed', String(e)); }
          ready = true;
          log('avatar clip', idx + 1, '/', urls.length, v.videoWidth, v.videoHeight);
        };

        const introCount = Math.max(0, Math.min(Number(CFG.introCount) || 0, urls.length));
        const loopStart = introCount > 0 ? introCount : 0;
        const nextIndex = (i) => (i + 1 < urls.length ? i + 1 : loopStart);
        const scheduleNext = (i) => {
          if (!state.introStarted) return;
          loadClip(nextIndex(i)).catch((e) => {
            state.errors.push(String(e));
            setTimeout(() => { if (state.introStarted) loadClip(nextIndex(i)).catch(() => {}); }, 1000);
          });
        };
        v.addEventListener('ended', () => scheduleNext(idx));
        state.avatarStart = () => {
          if (state.introStarted) return;
          state.introStarted = true;
          loadClip(0).catch((e) => {
            state.errors.push(String(e));
            if (urls.length > 1) scheduleNext(0);
          });
        };
        if (!CFG.startOnJoin || state.introRequested) state.avatarStart();

        const stream = c.captureStream(fps);
        const track = stream.getVideoTracks()[0];
        if (track) {
          try { Object.defineProperty(track, 'label', { configurable: true, get: () => CFG.cameraLabel || 'HD Camera' }); } catch (e) { /* ignore */ }
        }
        state.avatarStream = stream;
        log('avatar playlist ready', urls.length, w, h);
        return stream;
      })().catch((e) => { avatarPromise = null; throw e; });
      return avatarPromise;
    }

    MD.getUserMedia = async function (constraints) {
      const c = constraints || {};
      const wantsVideo = !!c.video;
      const wantsAudio = !!c.audio;
      if (!wantsVideo && !wantsAudio) return origGUM(c);
      let native = null;
      try { native = await origGUM(c); } catch (e) { log('native getUserMedia failed', String(e)); }
      const out = [];
      if (wantsVideo) {
        if (CFG.blackScreen) {
          try { out.push(...blackStream().getVideoTracks()); }
          catch (e) { if (native) out.push(...native.getVideoTracks()); }
        } else if (CFG.videoUrl || (CFG.videoUrls && CFG.videoUrls.length)) {
          try { out.push(...(await avatarStream()).getVideoTracks()); }
          catch (e) { if (native) out.push(...native.getVideoTracks()); }
        } else if (native) {
          out.push(...native.getVideoTracks());
        }
      }
      if (wantsAudio) {
        if (CFG.micMode === 'tone') out.push(toneTrack());
        else if (CFG.micMode === 'file') {
          try { out.push(await fileTrack()); }
          catch (e) { state.errors.push(String(e)); if (native) out.push(...native.getAudioTracks()); }
        }
        else if (CFG.micMode === 'silence') out.push(silenceTrack());
        else if (native) out.push(...native.getAudioTracks());
      }
      if (!out.length) {
        if (native) return native;
        throw new Error('no media tracks');
      }
      return new MediaStream(out);
    };
  }

  window.__tmBotStartIntro = () => {
    state.introRequested = true;
    if (state.micFileStart) state.micFileStart();
    if (state.avatarStart) state.avatarStart();
    log('intro requested');
  };

  // Подпись говорящего из DOM: ищем плитку с признаком активного голоса.
  window.__tmBotActiveSpeaker = () => {
    const selectors = [
      '[data-testid*="participant"][class*="speak"]',
      '[class*="speaking"]',
      '[class*="active-speaker"]',
      '[class*="talking"]',
      '[data-testid*="speaker"]'
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el.getAttribute('aria-label') || el.innerText || '').trim();
        if (text) return text.split('\n')[0].trim().slice(0, 80);
      }
    }
    return '';
  };

  window.__tmBotParticipants = () => {
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('[data-testid*="participant"], [class*="participant"]')) {
      if (out.length >= 50) break;
      const key = el.outerHTML.slice(0, 120);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        testid: el.getAttribute('data-testid'),
        cls: String(el.className || '').slice(0, 120),
        aria: el.getAttribute('aria-label'),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      });
    }
    return out;
  };

  window.__tmBotTrackMap = () => {
    const selfName = String(CFG.selfName || '').trim().toLowerCase();
    const names = [];
    for (const el of document.querySelectorAll('[class*="participantName"]')) {
      const name = (el.textContent || '').trim();
      if (name && !(selfName && name.toLowerCase() === selfName) && !names.includes(name)) names.push(name);
    }
    const mediaTracks = [];
    for (const media of document.querySelectorAll('audio, video')) {
      const stream = media.srcObject;
      if (!stream) continue;
      for (const track of stream.getAudioTracks()) mediaTracks.push({ track, media });
    }
    const map = {};
    for (const { track, media } of mediaTracks) {
      let el = media;
      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        const named = el.querySelector && el.querySelector('[class*="participantName"]');
        const name = (named && named.textContent || '').trim();
        if (name && !(selfName && name.toLowerCase() === selfName)) {
          map[track.id] = name;
          break;
        }
      }
    }
    const unmapped = mediaTracks.filter(({ track }) => !map[track.id]);
    unmapped.forEach(({ track }, i) => {
      if (names.length > 1) {
        map[track.id] = names[i % names.length];
      } else if (names.length === 1) {
        map[track.id] = names[0] + ' ' + (i + 1);
      } else {
        map[track.id] = 'Участник ' + (i + 1);
      }
    });
    const counts = {};
    for (const name of Object.values(map)) counts[name] = (counts[name] || 0) + 1;
    const seen = {};
    for (const [trackId, name] of Object.entries(map)) {
      if (counts[name] > 1) {
        seen[name] = (seen[name] || 0) + 1;
        map[trackId] = name + ' ' + seen[name];
      }
    }
    return map;
  };

})();
