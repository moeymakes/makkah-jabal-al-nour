// ============================================================================
// quality level and time of day, chosen before anything is built (pattern from Abyssal Garden, MIT)
// ============================================================================
// LV: 0 High, 1 Medium, 2 Low. Medium and Low keep every 2nd / 4th shrub and pebble and bake fewer shadows;
// Low also drops anti-aliasing and uses coarser meshes and fewer light shaft steps.
// localStorage.nour = "level,pixels,detail". nourLoad is set while the world is built: still set on the next visit
// means that load crashed the tab, so this one runs a level lower.
const mob = matchMedia('(pointer:coarse)').matches, mem = navigator.deviceMemory;
const keep = (k, v) => { try { localStorage[k] = v; } catch {} };
let SV = [], LV, bad, TOD = 0;
try { SV = (localStorage.nour || '').split(','); bad = localStorage.nourLoad; TOD = +localStorage.nourTime || 0; } catch {}
LV = SV[0] ? +SV[0] : mob ? (mem > 7 ? 1 : 2) : mem <= 4 ? 2 : 0;
if (bad && LV < 2) { SV = [++LV]; keep('nour', LV); }
const THIN = 1 << LV, SHADOW = LV ? 2048 : 4096, AA = LV > 1 ? 1 : 4, RAYN = LV > 1 ? 10 : 24;
// Time: 0 dawn after Fajr, 1 golden hour, 2 night. Every bake depends on the light, so a change reloads the page.
// az = compass bearing the key light comes from (degrees, 90 = east), el = its elevation. Colours are linear HDR.
if (!(TOD === 1 || TOD === 2)) TOD = 0;
const NIGHT = TOD === 2;
const TP = [
  { az: 100, el: 13, key: [2.2, 1.55, 1.15], zen: [.16, .27, .55], horL: [1.25, .78, .58], horF: [.62, .64, .74], glow: [1, .45, .3], gndL: [.9, .6, .45], gndF: [.42, .44, .5],
    farH: [.52, .58, .74], ambK: [.20, .28, .52], ambG: [.55, .42, .34], ambF: [.085, .075, .075], expo: .8, rays: .8, lights: .2, stars: .25, cirrus: [1.5, .78, .7], city: [0, 0, 0], beta: .28, mist: .55, bloom: 1 },
  { az: 250, el: 9, key: [2.9, 2.1, 1.35], zen: [.10, .24, .58], horL: [1.35, .84, .44], horF: [.74, .68, .66], glow: [1, .5, .2], gndL: [1, .66, .4], gndF: [.46, .46, .5],
    farH: [.62, .64, .74], ambK: [.21, .30, .55], ambG: [.66, .46, .30], ambF: [.10, .08, .065], expo: .74, rays: 1, lights: 1, stars: 0, cirrus: [2.4, 1.3, .62], city: [0, 0, 0], beta: .5, mist: .6, bloom: 1 },
  { az: 140, el: 35, key: [.16, .19, .27], zen: [.004, .008, .022], horL: [.05, .045, .05], horF: [.02, .025, .04], glow: [0, 0, 0], gndL: [.02, .02, .025], gndF: [.015, .015, .02],
    farH: [.03, .028, .03], ambK: [.014, .018, .032], ambG: [.016, .012, .009], ambF: [.004, .004, .005], expo: 2.7, rays: 0, lights: 6, stars: 1, cirrus: [0, 0, 0], city: [.30, .16, .07], beta: .7, mist: .6, bloom: 3 },
][TOD];
const v3 = (a) => `vec3f(${a.map((x) => (+x).toFixed(4)).join(',')})`;
