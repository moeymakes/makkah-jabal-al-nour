// ============================================================================
// audio: procedural ambience of a bare mountain (no sample files, nothing recited)
// ============================================================================
// A fixed Web Audio graph built on the first click / key / touch and driven by a 10 Hz timer, not the frame loop
// (pattern from Abyssal Garden, MIT). Layers: wind over the rock with slow gusts, a thin whistle of the gusts in the
// boulders that grows with height, air rush that follows the camera's speed, a distant hum of the city at night,
// small birds and rock doves at dawn (a few at golden hour, none at night). Each layer feeds its own bus, so the
// menu's presets only move bus levels; the choice and the volume are remembered.
let AC, OUT, BUS, muted = false;
const VOL = 0.7;
// per preset: wind, whistle, city hum, small birds, doves, how often the birds call
const SOUNDS = [[1, 1, 1, 1, 1, 1], [1.4, 1.5, 0, 0, 0, 1], [.45, .4, .5, 1.6, 1.4, 2], [.55, .3, .7, .4, .5, .5], [0, 0, 0, 0, 0, 1]];
const BIRDS = [1.4, .5, 0][TOD], HUM = NIGHT ? 1 : 0;
let sndPreset = 0, sndVol = .7;
try { const s = (localStorage.nourSound || '').split(','); if (s[0]) { sndPreset = +s[0] || 0; sndVol = s[1] === undefined ? .7 : +s[1]; } } catch {}
const masterLevel = () => (muted || sndPreset === 4 ? 0 : VOL * sndVol * 1.43);
function applySound(fade = .4) {
  keep('nourSound', [sndPreset, sndVol]);
  if (!AC) return;
  const t = AC.currentTime, L = SOUNDS[sndPreset];
  for (let i = 0; i < 5; i++) BUS[i].gain.setTargetAtTime(L[i], t, fade);
  OUT.gain.setTargetAtTime(masterLevel(), t, fade);
}
function mkSound(ac) {
  const sr = ac.sampleRate;
  const N = (C, o, ...to) => { const n = new C(ac, o); for (const d of to) n.connect(d); if (n.start) n.start(); return n; };
  const G = (gain, ...to) => N(GainNode, { gain }, ...to);
  const BQ = (type, frequency, Q, ...to) => N(BiquadFilterNode, { type, frequency, Q }, ...to);
  const lfo = (frequency, depth, to) => N(OscillatorNode, { frequency }, G(depth, to));
  const noise = (secs, f) => { const n = sr * secs | 0, b = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: sr }); f(b.getChannelData(0), n); f(b.getChannelData(1), n); return b; };
  // seamless brown noise loop and a white one (the ends cross-fade into the starts)
  const loop = (k) => noise(9, (d, n) => { for (let i = 0, b = 0; i < n + 4096; i++) { const w = rnd() * 2 - 1; b = k ? (b + 0.02 * w) / 1.02 : w * .3; const v = b * (k ? 3.5 : 1); if (i < n) d[i] = v; else { const t = (i - n) / 4096; d[i - n] = d[i - n] * t + v * (1 - t); } } });
  const nb = loop(1), nw = loop(0);
  const ir = noise(3, (d, n) => { for (let i = 0, b = 0; i < n; i++) { const t = i / sr; b += (rnd() * 2 - 1 - b) * (0.08 + 0.5 * exp(-t * 3)); d[i] = b * (1 - exp(-t * 40)) * exp(-t * 2.2) * (1 - i / n); } });
  const lim = N(DynamicsCompressorNode, { threshold: -6, knee: 6, ratio: 20, attack: 0.003, release: 0.3 }, ac.destination);
  const out = OUT = G(0, lim), wet = N(ConvolverNode, { buffer: ir }, out);
  const L = SOUNDS[sndPreset];
  BUS = [0, 1, 2, 3, 4].map((i) => G(L[i], out));
  const src = (buffer, playbackRate, ...to) => N(AudioBufferSourceNode, { buffer, loop: true, playbackRate }, ...to);
  // wind: low brown noise with two slow gust LFOs
  const wind = G(.3, BUS[0]);
  src(nb, 1, BQ('lowpass', 480, .6, wind)); lfo(.045, .13, wind.gain); lfo(.077, .09, wind.gain);
  // whistle: narrow band-passed white noise that sings when the gusts rise
  const whi = G(0, BUS[1]), whiF = BQ('bandpass', 900, 9, whi); src(nw, 1, whiF); lfo(.045, .015, whi.gain); lfo(.031, 120, whiF.frequency);
  const rush = G(0, out), rushF = BQ('bandpass', 300, 0.8, rush); src(nb, .7, rushF);
  // the city far below at night: a low muffled rumble that swells slowly, like traffic heard from a height
  const hum = G(.16 * HUM, BUS[2]);
  src(nb, .5, BQ('lowpass', 160, .7, hum)); src(nw, .6, BQ('bandpass', 420, 1.2, G(.05, hum))); lfo(.021, .05 * HUM, hum.gain);
  const pool = (n, send, bus) => Array.from({ length: n }, () => { const p = N(StereoPannerNode, {}, bus, G(send, wet)), g = G(0, p); return { p, g, o: N(OscillatorNode, {}, g) }; });
  const chirp = pool(4, .3, BUS[3]), dove = pool(3, .5, BUS[4]);
  const play = (vs, t, f0, f1, dur, vol, att, pan) => {
    const v = vs.shift(), f = v.o.frequency, g = v.g.gain; vs.push(v);
    v.p.pan.setValueAtTime(pan, t);
    f.setValueAtTime(f0, t); f.exponentialRampToValueAtTime(f1, t + dur);
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(vol, t + att); g.setTargetAtTime(0, t + att, (dur - att) / 4);
  };
  let lt = ac.currentTime, tB = lt + 3, tD = lt + 9, lx = F[CX], ly = F[CY], lz = F[CZ];
  out.gain.setTargetAtTime(masterLevel(), lt, 1);
  return () => {
    const now = ac.currentTime, t = now + 0.05, dt = now - lt;
    if (dt <= 0) return;
    let v = hypot(F[CX] - lx, F[CY] - ly, F[CZ] - lz) / dt; if (v > 80) v = 0;
    lt = now; lx = F[CX]; ly = F[CY]; lz = F[CZ];
    rush.gain.setTargetAtTime(0.35 * pow(min(v / 40, 1), 1.2), t, 0.3); rushF.frequency.setTargetAtTime(240 + v * 12, t, 0.3);
    const hgt = clamp((F[CY] - 150) / 200, 0, 1), rate = SOUNDS[sndPreset][5] * BIRDS;
    whi.gain.setTargetAtTime(.012 + .035 * hgt, t, 2);
    if (rate > 0 && t > tB) { // a small bird: a burst of quick high chirps
      let tt = t; const pan = rr(-.8, .8), f = rr(2600, 4200);
      for (let n = 2 + rnd() * 5 | 0; n--;) { play(chirp, tt, f * rr(.9, 1.1), f * rr(1.2, 1.5), .07, rr(.012, .026), .005, pan); tt += rr(.08, .16); }
      tB = tt + rr(3, 12) / rate;
    }
    if (rate > 0 && t > tD) { // a rock dove: coo, long rising-falling COO, coo
      let tt = t; const pan = rr(-.7, .7), f = rr(300, 360);
      for (const [a, b, d] of [[1, .96, .25], [.92, 1.08, .55], [1.02, .9, .3]]) { play(dove, tt, f * a, f * b, d, .022, d * .3, pan); tt += d + .12; }
      tD = tt + rr(10, 24) / rate;
    }
  };
}
function sound() {
  if (!AC) { AC = new AudioContext({ latencyHint: 'playback' }); setInterval(mkSound(AC), 100); }
  if (AC.state === 'suspended' && !document.hidden) AC.resume();
}
const mute = () => { muted = !muted; if (AC) OUT.gain.setTargetAtTime(masterLevel(), AC.currentTime, 0.08); };
document.addEventListener('visibilitychange', () => { if (AC) document.hidden ? AC.suspend() : AC.resume(); });
// menu: the Sound row (presets) and the volume slider
{
  const row = $('snd'), vol = $('vol');
  const lit = () => row.querySelectorAll('button').forEach((b, i) => { b.className = i === sndPreset ? 'on' : ''; });
  row.querySelectorAll('button').forEach((b, i) => { b.onclick = () => { sndPreset = i; lit(); sound(); applySound(); }; });
  vol.value = sndVol * 100;
  vol.oninput = () => { sndVol = vol.value / 100; sound(); applySound(.08); };
  lit();
}
