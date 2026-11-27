"""Фейковая комната Телемоста для сквозной проверки входа без живого сервиса.

Повторяет важные для бота элементы:
  * кнопку «Продолжить в браузере» в основной странице;
  * iframe /private-join/MOCK, как у Телемоста 3.0;
  * поле имени, кнопку «Подключиться», панель участников;
  * loopback-звонок с осциллятором и видео, чтобы проверить захват и stats.
"""

MAIN_HTML = """<!doctype html>
<html lang="ru"><meta charset="utf-8"><title>Mock Telemost</title>
<body style="font-family:sans-serif;padding:24px">
<h2>Фейковый Телемост</h2>
<button data-testid="meeting-continue-in-browser-continue"
        onclick="document.getElementById('call').style.display='block';this.remove()">
  Продолжить в браузере
</button>
<iframe id="call" src="/private-join/MOCK" style="display:none;width:900px;height:520px;border:1px solid #ccc"></iframe>
</body></html>
"""

FRAME_HTML = """<!doctype html>
<html lang="ru"><meta charset="utf-8"><title>Mock prejoin</title>
<body style="font-family:sans-serif;padding:16px">
<h3>Подключение к встрече</h3>
<input data-testid="orb-textinput-input" placeholder="Ваше имя" autocomplete="name">
<button data-testid="enter-conference-button" id="join">Подключиться</button>
<button data-testid="participants-button" id="parts" style="display:none">1</button>
<div id="log" style="margin-top:12px;color:#555"></div>
<script>
const log = (t) => { document.getElementById('log').textContent = t; console.log('[mock]', t); };

document.getElementById('join').onclick = async () => {
  document.getElementById('parts').style.display = 'inline-block';
  try {
    const media = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
    log('getUserMedia: ' + media.getTracks().map(t => t.kind + ':' + t.readyState).join(', '));

    const ctx = new AudioContext();
    await ctx.resume().catch(() => {});
    const mk = (freq) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq;
      const d = ctx.createMediaStreamDestination();
      o.connect(d);
      o.start();
      return d;
    };
    const d1 = mk(440);
    const d2 = mk(880);

    const pc1 = new RTCPeerConnection();
    const pc2 = new RTCPeerConnection();
    pc1.onicecandidate = e => e.candidate && pc2.addIceCandidate(e.candidate).catch(() => {});
    pc2.onicecandidate = e => e.candidate && pc1.addIceCandidate(e.candidate).catch(() => {});
    pc2.ontrack = e => log('remote track: ' + e.track.kind);
    pc1.addTrack(d1.stream.getAudioTracks()[0], d1.stream);
    pc1.addTrack(d2.stream.getAudioTracks()[0], d2.stream);
    media.getAudioTracks().forEach(t => pc1.addTrack(t, media));
    media.getVideoTracks().forEach(t => pc1.addTrack(t, media));
    await pc1.setLocalDescription(await pc1.createOffer());
    await pc2.setRemoteDescription(pc1.localDescription);
    await pc2.setLocalDescription(await pc2.createAnswer());
    await pc1.setRemoteDescription(pc2.localDescription);
    log('loopback connected');
    window.__mockReady = true;
  } catch (e) {
    log('error: ' + e);
    window.__mockError = String(e);
  }
};
</script>
</body></html>
"""
