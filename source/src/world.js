// ============================================================================
// world layout + procedural content generation (load time only)
// ============================================================================
// Axes: +x east, -z north, y up, metres. Jabal al-Nour's summit knob is at the origin; the Haram and the clock tower
// are 3.4 km to the south-west (HARAM in shaders.js). The ground model itself is W_GROUND in shaders.js.

// the key light from the Time preset: the sun at dawn and golden hour, the moon at night
const SUN = (() => { const a = TP.az * PI / 180, e = TP.el * PI / 180; return [sin(a) * cos(e), sin(e), -cos(a) * cos(e)]; })();
// city block sizes (w, h, d, setback storey): houses and apartment blocks, then hotels and towers near the Haram
const CITY = [[26, 6.6, 27, 0], [27, 9.9, 26, 0], [24, 13.2, 27, 1], [28, 16.5, 28, 0], [25, 9.9, 24, 1], [20, 19.8, 28, 0], [28, 46.2, 28, 1], [30, 82.5, 30, 0], [32, 125.4, 32, 1], [22, 6.6, 24, 1]];
const CITY_LOW = [0, 1, 2, 3, 4, 5, 9], NSOLID = 20 + CITY.length * 2;
const KNOB = [3, -5];
// bearings are measured from south (+z) toward east (+x): x = r sin(b), z = r cos(b)
const polar = (r, b) => [r * sin(b), r * cos(b)];
const DEG = PI / 180;
const CAVEB = -40 * DEG, CAVER = 15; // the cave of Hira: below the top on the side facing the Kaaba

// ---------------------------------------------------------------- ground samplers: near 1 m, middle 2 m, far ~23 m
const FN = 1024, FC = 24000 / (FN - 1), FO = -12000, MN = 1024, MC = 2, MO = -1024;
const grid = (A, n, o, c, k = 0) => (x, z) => {
  const gx = clamp((x - o) / c, 0, n - 1.001), gz = clamp((z - o) / c, 0, n - 1.001), ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
  const i = (ix + n * iz) * 4 + k;
  return mix(mix(A[i], A[i + 4], fx), mix(A[i + n * 4], A[i + n * 4 + 4], fx), fz);
};
function groundSampler(NA, MA, FA) {
  const nh = grid(NA, NX, OX, VS), mh = grid(MA, MN, MO, MC), fh = grid(FA, FN, FO, FC);
  return (x, z) => {
    const a = max(abs(x), abs(z));
    if (a < -OX - 1.5) return nh(x, z);
    if (a < 900) return mh(x, z);
    return a > 1010 ? fh(x, z) : mix(mh(x, z), fh(x, z), (a - 900) / 110);
  };
}

// ---------------------------------------------------------------- the path: zig-zag flights up the south-east face
// returns the polyline (x, y, z, half width) with kinds: 0 flight, 1 landing at a turn, 2 rest platform, 3 summit,
// 4 the terrace in front of the cave. Heights follow the ground and only ever climb, then descend to the cave.
function makePath(fh) {
  const P = [], H = 1.25;
  const slope = (r) => .454 * pow(max(1 - r / 600, 0), .45) + (r < 118 ? .9 : 0);
  const centre = (r) => (27 + 9 * sin(r * .011)) * DEG;
  const corners = [];
  let r = 575, side = 1, n = 0;
  while (r > 9) {
    const L = min(21, max(8, r * .55)), b = centre(r) + side * L / r;
    corners.push([...polar(r, b), n % 3 === 2 && r < 470 && r > 60 ? 2 : 1]);
    r -= clamp(13 / slope(r), 4.5, 62); side = -side; n++;
  }
  corners.push([KNOB[0], KNOB[1], 3]);
  // flights between turns, cut into short pieces whose heights follow the ground
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c];
    P.push([a[0], 0, a[1], a[2] === 2 ? 3.4 : a[2] === 3 ? 5.5 : 2.1, a[2]]);
    if (c === corners.length - 1) break;
    const b = corners[c + 1], L = hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const k = max(1, round((L - 5.2) / 9));
    P.push([a[0] + ux * 2.6, 0, a[1] + uz * 2.6, H, 5]);
    for (let j = 1; j < k; j++) { const t = 2.6 + (L - 5.2) * j / k; P.push([a[0] + ux * t, 0, a[1] + uz * t, H, 0]); }
    P.push([b[0] - ux * 2.6, 0, b[1] - uz * 2.6, H, 6]);
  }
  const nUp = P.length;
  // over the top and down the far side to the cave
  const desc = [[12, -105, 1.25, 0], [20, -88, 1.25, 0], [21, -62, 1.25, 0], [CAVER + 3.4, -40, 2.2, 4]];
  for (const [rr_, bb, w, kd] of desc) { const p = polar(rr_, bb * DEG); P.push([p[0], 0, p[1], w, kd]); }
  // heights: smoothed ground, never falling on the way up and never rising on the way down
  const gH = (x, z) => { let s = 0; for (const [dx, dz] of [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) s += fh(x + dx, z + dz); return s / 5; };
  for (let i = 0; i < P.length; i++) P[i][1] = gH(P[i][0], P[i][2]) - .3;
  P[nUp - 1][1] = gH(KNOB[0], KNOB[1]) - 1.2;
  // follow the ground closely (a flight may dip a little), smooth along the way, landings level with their turn
  for (let k = 0; k < 3; k++) for (let i = 1; i < nUp - 1; i++) if (P[i][4] === 0) P[i][1] = (P[i - 1][1] + 2 * P[i][1] + P[i + 1][1]) / 4;
  for (let i = 1; i < nUp; i++) {
    const p = P[i], q = P[i - 1], d = hypot(p[0] - q[0], p[2] - q[2]);
    if (p[4] === 5) p[1] = q[1];
    else p[1] = clamp(p[1], q[1] - d * .25, q[1] + d * (hypot(p[0] - KNOB[0], p[2] - KNOB[1]) < 26 ? 1.4 : 1.05));
  }
  for (let i = nUp - 2; i > 0; i--) if (P[i][4] === 6) P[i][1] = P[i + 1][1];
  for (let i = nUp; i < P.length; i++) {
    const p = P[i], q = P[i - 1], d = hypot(p[0] - q[0], p[2] - q[2]);
    p[1] = clamp(min(p[1] - 1, q[1]), q[1] - d * .8, q[1]);
  }
  const t = P[P.length - 1], cp = polar(CAVER, CAVEB), o = [sin(CAVEB), 0, cos(CAVEB)];
  const cave = [cp[0], t[1], cp[1], 0], dir = [o[0], 0, o[2], 0];
  return { P, nUp, cave, dir };
}
// distance in the ground plane from (x, z) to the path's edge (negative on it)
const pathDist = (P, x, z) => {
  let d = 1e9;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], abx = b[0] - a[0], abz = b[2] - a[2], l2 = abx * abx + abz * abz || 1;
    const t = clamp(((x - a[0]) * abx + (z - a[2]) * abz) / l2, 0, 1), e = hypot(x - a[0] - abx * t, z - a[2] - abz * t) - mix(a[3], b[3], t);
    if (e < d) d = e;
  }
  return d;
};

// ---------------------------------------------------------------- viewpoints and the scripted flight
// POSES: x, eye height (absolute when flying), z, look-at x, y, z (absolute), flying
function makePoses(PT, fh) {
  const P = PT.P, at = (i) => P[i], up = PT.nUp;
  const turns = []; for (let i = 0; i < up; i++) if (P[i][4] === 1 || P[i][4] === 2) turns.push(i);
  const pick = (f) => { let i = clamp(round(f * (turns.length - 1)), 0, turns.length - 1); while (P[turns[i]][4] !== 1) i++; return P[turns[i]]; };
  const a = pick(.42), b = pick(.7), s = at(up - 1), c = PT.cave, o = PT.dir;
  // pose 2 stands on the turn of the upper flights that sees furthest toward the Haram
  let best = b, bv = -1e9;
  for (const i of turns) { const p = P[i]; if (p[1] < s[1] - 95 || p[1] > s[1] - 25) continue; const v = -p[0] * .643 + p[2] * .766; if (v > bv) { bv = v; best = p; } }
  const term = at(P.length - 1);
  return [
    [a[0], 1.7, a[2], KNOB[0], s[1] - 25, KNOB[1], 0],
    [best[0], 1.7, best[2], HARAM[0], -10, HARAM[1], 0],
    [s[0] + 1, 1.7, s[2] + 3.5, 120, 120, 420, 0],
    [term[0] + o[0] * 1.5 + o[2] * .8, 1.7, term[2] + o[2] * 1.5 - o[0] * .8, c[0], c[1] + 1.3, c[2], 0],
    [c[0] + o[0] * 3 - o[2] * 1.6, 1.7, c[2] + o[2] * 3 + o[0] * 1.6, CLOCK[0], 220, CLOCK[1], 0],
    [420, 560, -330, -1000, 30, 1150, 1],
  ];
}
function makeFly(PT, fh) {
  const P = PT.P, up = PT.nUp, K = [];
  const turns = []; for (let i = 0; i < up; i++) if (P[i][4] === 1 || P[i][4] === 2) turns.push(i);
  const T = (f) => P[turns[clamp(round(f * (turns.length - 1)), 0, turns.length - 1)]];
  const add = (x, y, z, lx, ly, lz) => K.push(x, y, z, lx, ly, lz);
  const s = P[up - 1], c = PT.cave, o = PT.dir;
  for (const f of [.28, .38, .48, .58, .68, .78, .88]) {
    const p = T(f), q = T(min(f + .14, 1)), g = max(fh(p[0], p[2]), p[1]);
    add(p[0], g + 12, p[2], q[0], q[1] + 4, q[2]);
  }
  add(s[0] + 4, s[1] + 16, s[2] + 10, HARAM[0], 0, HARAM[1]);
  add(c[0] + o[0] * 16, c[1] + 12, c[2] + o[2] * 16, c[0], c[1] + 1.5, c[2]);
  add(c[0] + o[0] * 30, c[1] + 8, c[2] + o[2] * 30, c[0], c[1] + 2, c[2]);
  add(c[0] + o[0] * 75 - 30, c[1] + 20, c[2] + o[2] * 75 + 20, CLOCK[0], 200, CLOCK[1]);
  add(-240, 290, 120, HARAM[0], 0, HARAM[1]);
  add(-330, 300, -120, 0, 230, 0);
  add(-150, 360, -380, 0, 220, 0);
  add(180, 450, -420, -600, 60, 700);
  add(420, 560, -330, -1000, 30, 1150);
  return new Float32Array(K);
}

// ---------------------------------------------------------------- terrain mesh from the density grid
function buildTerrain(D) {
  const sn = surfaceNets(D, NX, NY, NZ), nv = sn.nv, gp = sn.pos;
  const smp = sampler3(D, NX, NY, NZ);
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const wp = new Float32Array(nv * 3), wn = new Float32Array(nv * 3);
  for (let k = 0; k < nv; k++) {
    const x = gp[k * 3], y = gp[k * 3 + 1], z = gp[k * 3 + 2], e = 0.8;
    let nx = smp(x - e, y, z) - smp(x + e, y, z), ny = smp(x, y - e, z) - smp(x, y + e, z), nz = smp(x, y, z - e) - smp(x, y, z + e);
    const l = hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const X = OX + x * VS, Y = OY + y * VS, Z = OZ + z * VS;
    wp[k * 3] = vf[k * 4] = X; wp[k * 3 + 1] = vf[k * 4 + 1] = Y; wp[k * 3 + 2] = vf[k * 4 + 2] = Z;
    wn[k * 3] = nx; wn[k * 3 + 1] = ny; wn[k * 3 + 2] = nz;
    v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = 127;
  }
  const nq = sn.ni / 6, key = new Uint8Array(nq), cnt = new Uint32Array(CELLS * CELLS + 1);
  const lo = new Float32Array(CELLS * CELLS).fill(1e9), hi = new Float32Array(CELLS * CELLS).fill(-1e9);
  for (let q = 0; q < nq; q++) {
    const a = sn.idx[q * 6] * 3;
    const c = clamp(floor((wp[a] - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((wp[a + 2] - OZ) / CELLW), 0, CELLS - 1);
    key[q] = c; cnt[c + 1]++;
    for (let j = 0; j < 6; j++) { const y = wp[sn.idx[q * 6 + j] * 3 + 1]; if (y < lo[c]) lo[c] = y; if (y > hi[c]) hi[c] = y; }
  }
  for (let c = 0; c < CELLS * CELLS; c++) cnt[c + 1] += cnt[c];
  const ib = new Uint32Array(sn.ni), fill = cnt.slice();
  for (let q = 0; q < nq; q++) { const o = fill[key[q]]++ * 6; for (let j = 0; j < 6; j++) ib[o + j] = sn.idx[q * 6 + j]; }
  return { vb, ib, nv, wp, wn, smp, start: cnt, lo, hi };
}

// ---------------------------------------------------------------- far landscape: polar grid out to 12 km
// starts inside the near field; there it sinks under the detailed terrain, meeting it again at the box edge
function buildFar(fh) {
  const NR = 380, NS = 1024, R0 = 165, R1 = 12000, nv = NR * NS, E = -OX;
  const vb = new ArrayBuffer(nv * 16), vf = new Float32Array(vb), v8 = new Int8Array(vb);
  const sx = SUN[0], sy = SUN[1], sz = SUN[2], sl = hypot(sx, sz), tn = sy / sl;
  for (let r = 0; r < NR; r++) {
    const rad = R0 * pow(R1 / R0, r / (NR - 1));
    for (let s = 0; s < NS; s++) {
      const a = (s + (r & 1) * .5) / NS * TAU, x = cos(a) * rad, z = sin(a) * rad, k = r * NS + s;
      let h = fh(x, z);
      const de = E - max(abs(x), abs(z));
      if (de > 0) h -= min(9, de * .8);
      const e = max(1.2, rad * .004);
      let nx = fh(x - e, z) - fh(x + e, z), ny = 2 * e, nz = fh(x, z - e) - fh(x, z + e); const l = hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      // soft heightfield shadow: march toward the light and keep the smallest clearance over the terrain
      let sh = 1;
      for (let t = 20; t < 7000; t *= 1.07) { const c = h + 4 + t * tn - fh(x + sx / sl * t, z + sz / sl * t); if (c < 0) { sh = 0; break; } sh = min(sh, c / (t * .05 + 4)); }
      vf[k * 4] = x; vf[k * 4 + 1] = h; vf[k * 4 + 2] = z;
      v8[k * 16 + 12] = round(nx * 127); v8[k * 16 + 13] = round(ny * 127); v8[k * 16 + 14] = round(nz * 127); v8[k * 16 + 15] = round(clamp(sh, 0, 1) * 127);
    }
  }
  const ib = new Uint32Array((NR - 1) * NS * 6); let o = 0;
  for (let r = 0; r < NR - 1; r++) for (let s = 0; s < NS; s++) {
    const a = r * NS + s, b = r * NS + (s + 1) % NS, c = (r + 1) * NS + s, d = (r + 1) * NS + (s + 1) % NS;
    if (r & 1) { ib[o++] = a; ib[o++] = c; ib[o++] = b; ib[o++] = b; ib[o++] = c; ib[o++] = d; } else { ib[o++] = a; ib[o++] = c; ib[o++] = d; ib[o++] = a; ib[o++] = d; ib[o++] = b; }
  }
  return { vb, ib, nv };
}

// the height above which each 2 m column of the near field sees the key light past the far mountains (the near
// field's own shadows come from the shadow map; this adds the long shadows of the ranges around it)
function farLit(fh) {
  const n = NX / 2, out = new Float32Array(n * n), sx = SUN[0], sz = SUN[2], sl = hypot(sx, sz), dx = sx / sl, dz = sz / sl, tn = SUN[1] / sl, E = -OX;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = OX + i * 2 + 1, z = OZ + j * 2 + 1;
    let y = -1e4;
    for (let t = 4; t < 7000; t *= 1.06) {
      const px = x + dx * t, pz = z + dz * t;
      if (max(abs(px), abs(pz)) < E) continue;
      y = max(y, fh(px, pz) - t * tn);
    }
    out[i + n * j] = y;
  }
  return out;
}

// ---------------------------------------------------------------- procedural meshes
const box = (m, x0, y0, z0, x1, y1, z1, aux = 1) => {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]) { const q = f.map((i) => m.v(...v[i], aux)); m.quad(q[0], q[1], q[2], q[3]); }
};
// box turned to face (ux, uz) along its length: centre (cx, cz), half length hl, half width hw, from y0 to y1
const obox = (m, cx, cz, ux, uz, hl, hw, y0, y1, aux = 1) => {
  const vx = -uz, vz = ux, P = (i, j, k) => [cx + ux * (i ? hl : -hl) + vx * (k ? hw : -hw), j ? y1 : y0, cz + uz * (i ? hl : -hl) + vz * (k ? hw : -hw)];
  const v = [P(0, 0, 0), P(1, 0, 0), P(1, 1, 0), P(0, 1, 0), P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1)];
  for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]) { const q = f.map((i) => m.v(...v[i], aux)); m.quad(q[0], q[1], q[2], q[3]); }
};
// a wall along a polyline with vertical faces whatever the slope: half thickness hw, from y + lo to y + hi
function vwall(m, pts, hw, lo, hi) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1], L = hypot(b[0] - a[0], b[2] - a[2]) || 1, vx = -(b[2] - a[2]) / L * hw, vz = (b[0] - a[0]) / L * hw;
    const c = (p, s, h) => [p[0] + vx * s, p[1] + h, p[2] + vz * s];
    const v = [c(a, -1, lo), c(b, -1, lo), c(b, -1, hi), c(a, -1, hi), c(a, 1, lo), c(b, 1, lo), c(b, 1, hi), c(a, 1, hi)];
    for (const f of [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]) { const q = f.map((i) => m.v(...v[i], 1)); m.quad(q[0], q[1], q[2], q[3]); }
  }
}
// surface of revolution: prof = [[radius, height, ao]...] bottom to top, seg sides (8 = octagonal)
function lathe(m, prof, seg, cx = 0, cy = 0, cz = 0, rot = PI / seg) {
  const rings = [];
  for (const [r, h, ao = 1] of prof) { const ring = []; for (let s = 0; s < seg; s++) { const a = s / seg * TAU + rot; ring.push(m.v(cx + cos(a) * r, cy + h, cz + sin(a) * r, ao)); } rings.push(ring); }
  for (let k = 0; k < rings.length - 1; k++) for (let s = 0; s < seg; s++) { const s2 = (s + 1) % seg; m.quad(rings[k][s], rings[k + 1][s], rings[k + 1][s2], rings[k][s2]); }
}
const domeProf = (r, drum, point = 1.12) => {
  const p = [[r * 1.04, 0], [r * 1.04, drum], [r * 1.08, drum + .2], [r, drum + .35]];
  for (let i = 1; i <= 12; i++) { const a = i / 12 * PI / 2; p.push([r * cos(a), drum + .35 + r * point * pow(sin(a), .92)]); }
  return p;
};
// Haram minaret: square base, three octagonal stages with balconies, a lantern and a cap
const MINARET = [[3.3, 20], [3.3, 50], [4.4, 50.4], [4.4, 52], [3, 52.4], [3, 68], [4, 68.4], [4, 70], [2.5, 70.4], [2.5, 80], [3.4, 80.4], [3.4, 81.8], [2.1, 82.2], [2.1, 86], [2.35, 86.2], [2.2, 87.8], [1.3, 89.8], [.3, 91.3], [0, 91.5]];
function meshMinaret() {
  const m = new Mesh();
  box(m, -5.4, 0, -5.4, 5.4, 1.4, 5.4); box(m, -4.5, 1.4, -4.5, 4.5, 20, 4.5);
  lathe(m, MINARET, 8);
  return m;
}
// alem: a short pole with stacked spheres and an upturned crescent on top
function meshFinial(s) {
  const m = new Mesh(), ball = (y, r) => { const p = []; for (let i = 0; i <= 8; i++) { const a = -PI / 2 + i / 8 * PI; p.push([cos(a) * r, y + r + sin(a) * r]); } return p; };
  lathe(m, [[.15 * s, 0], [.15 * s, .9 * s], [.1 * s, .9 * s]], 10);
  lathe(m, ball(.9 * s, .34 * s), 12); lathe(m, ball(1.55 * s, .24 * s), 12);
  lathe(m, [[.07 * s, 2 * s], [.07 * s, 2.35 * s], [0, 2.36 * s]], 8);
  const R = .55 * s, cy = 2.3 * s + R * .95, pts = [];
  for (let k = 0; k <= 16; k++) { const a = (200 + k / 16 * 140) * PI / 180; pts.push([cos(a) * R, cy + sin(a) * R, 0]); }
  m.tube(pts, (k) => .015 * s + .1 * s * sin(PI * k / 16), 6, false, () => 1);
  return m;
}
// Masjid al-Haram (local, plaza level 0, north = -z): arcaded wings around the open courtyard, the older inner
// portico, the large northern expansion
function meshHaram() {
  const m = new Mesh();
  box(m, -165, 0, -165, 165, 30, -80); box(m, -165, 0, 80, 165, 30, 165); box(m, -165, 0, -80, -80, 30, 80); box(m, 80, 0, -80, 165, 30, 80);
  box(m, -166, 30, -166, 166, 31.4, -79); box(m, -166, 30, 79, 166, 31.4, 166); box(m, -166, 30, -79, -79, 31.4, 79); box(m, 79, 30, -79, 166, 31.4, 79);
  for (const s of [-1, 1]) { box(m, -72, 0, s * 64 - 4, 72, 10, s * 64 + 4); box(m, s * 64 - 4, 0, -56, s * 64 + 4, 10, 56); }
  box(m, -150, 0, -430, 150, 26, -175); box(m, -151, 26, -431, 151, 27.2, -174);
  return m;
}
function meshHaramDomes() {
  const m = new Mesh();
  for (let x = -60; x <= 60; x += 15) for (const z of [-64, 64]) lathe(m, domeProf(3.4, .8, 1), 12, x, 10, z);
  for (let z = -45; z <= 45; z += 15) for (const x of [-64, 64]) lathe(m, domeProf(3.4, .8, 1), 12, x, 10, z);
  for (let x = -120; x <= 120; x += 40) for (let z = -400; z <= -200; z += 40) lathe(m, domeProf(9, 1.5, 1), 16, x, 27.2, z);
  return m;
}
function meshKaaba() { const m = new Mesh(); box(m, -5.6, 0, -6.4, 5.6, 13.1, 6.4); return m; }
// the clock tower complex (Abraj al-Bait), simplified: podium, six hotel towers, the main tower, clock, crown
function meshClockTower() {
  const m = new Mesh();
  box(m, -150, 0, -110, 150, 70, 110); box(m, -152, 70, -112, 152, 72, 112);
  for (const [x, z, h] of [[-112, -74, 238], [112, -74, 252], [-112, 74, 262], [112, 74, 228], [-26, 80, 205], [56, -82, 196]]) {
    box(m, x - 24, 72, z - 24, x + 24, h, z + 24); box(m, x - 25.5, h, z - 25.5, x + 25.5, h + 5, z + 25.5); box(m, x - 13, h + 5, z - 13, x + 13, h + 17, z + 13);
  }
  box(m, -34, 72, -34, 34, 378, 34); box(m, -38, 378, -38, 38, 382, 38);
  box(m, -37, 382, -37, 37, 456, 37); box(m, -39.5, 456, -39.5, 39.5, 460, 39.5);
  lathe(m, [[30, 460], [30, 488], [25, 490], [25, 512], [18, 514], [18, 536], [11, 538], [7, 560], [3, 575], [1.4, 586]], 8);
  return m;
}
function meshClockFaces() {
  const m = new Mesh(), e = 37.25, w = 27, y0 = CLOCKY - 27, y1 = CLOCKY + 27;
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const sx = -nz, sz = nx, p = (u, y) => m.v(nx * e + sx * u, y, nz * e + sz * u);
    const a = p(-w, y0), b = p(w, y0), c = p(w, y1), d = p(-w, y1);
    m.quad(a, b, c, d);
  }
  return m;
}
function meshRock(sd, sub, round_) {
  if (LV > 1 && sub > 1) sub--;
  rseed(100 + sd);
  const pl = []; for (let i = 0; i < (round_ ? 0 : 8); i++) { const q = qRand(); const l = hypot(q[0], q[1], q[2]) || 1; pl.push([q[0] / l, q[1] / l, q[2] / l, rr(.5, .85)]); }
  return icosphere(sub, (x, y, z) => {
    const r = 1 + (fbm(x * 1.6 + sd, y * 1.6, z * 1.6, 2) - .5) * (round_ ? .5 : .9);
    let px = x * r, py = y * r * (round_ ? .75 : .7), pz = z * r;
    for (const p of pl) { const d = px * p[0] + py * p[1] + pz * p[2] - p[3]; if (d > 0) { px -= p[0] * d; py -= p[1] * d; pz -= p[2] * d; } }
    return [px, py, pz];
  });
}
function meshCityBox(w, h, d, step, v) {
  const m = new Mesh(), tank = (x, z, r, th) => lathe(m, [[r, 0], [r, th], [r * .8, th + .25], [0, th + .3]], 8, x, h + .9, z);
  box(m, -w / 2, 0, -d / 2, w / 2, h, d / 2);
  box(m, -w / 2 - .2, h, -d / 2 - .2, w / 2 + .2, h + .9, d / 2 + .2);
  if (step) { const s = h > 20 ? h * .25 : 3.3; box(m, -w * .3, h, -d * .3, w * .25, h + s, d * .3); box(m, -w * .3 - .15, h + s, -d * .3 - .15, w * .25 + .15, h + s + .7, d * .3 + .15); }
  if (v) { box(m, -w * .42, h + .9, -d * .42, -w * .42 + 3.2, h + 3.6, -d * .42 + 4); for (let k = 0; k < 4; k++) tank(w * (.05 + k * .1), d * .36, .7, 1.5); }
  else { box(m, w * .15, h + .9, -d * .3, w * .15 + 2.4, h + 3.2, -d * .3 + 2.4); tank(-w * .3, d * .25, .9, 1.7); tank(-w * .3 + 2.2, d * .25, .9, 1.7); box(m, w * .3, h + .9, d * .3, w * .3 + 1.2, h + 1.6, d * .3 + .8); }
  return m;
}
function meshBird() {
  const m = new Mesh(), X = [.17, .1, 0, -.12, -.2], H = [.01, .045, .055, .04, .012];
  const rings = [];
  for (let i = 0; i < 5; i++) { const r = []; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; r.push(m.v(sin(a) * H[i] * .9, cos(a) * H[i], X[i], 0)); } rings.push(r); }
  for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) { const k2 = (k + 1) % 6; m.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]); }
  for (const sx of [-1, 1]) {
    const a = m.v(sx * .03, .02, .06, 0), b = m.v(sx * .03, .02, -.06, 0), c = m.v(sx * .36, .03, -.02, sx), d = m.v(sx * .3, .03, -.12, sx);
    m.quad(a, c, d, b);
  }
  const t0 = m.v(0, .01, -.18, 0), t1 = m.v(.07, .01, -.3, 0), t2 = m.v(-.07, .01, -.3, 0); m.tri(t0, t1, t2);
  return m;
}

// ---------------------------------------------------------------- the path's stonework: steps, walls, railings
function buildPath(PT, fh) {
  const P = PT.P, steps = new Mesh(), walls = new Mesh(), rails = new Mesh(), roof = new Mesh(), voidM = new Mesh();
  rseed(20);
  const slab = (x, z, ux, uz, hl, hw, y) => obox(steps, x, z, ux, uz, hl, hw, y - .7, y - .1);
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], L = hypot(b[0] - a[0], b[2] - a[2]), ux = (b[0] - a[0]) / L, uz = (b[2] - a[2]) / L, dy = b[1] - a[1], hw = min(a[3], b[3]);
    if (abs(dy) / L < .05) { slab((a[0] + b[0]) / 2, (a[2] + b[2]) / 2, ux, uz, L / 2 + .3, hw, (a[1] + b[1]) / 2); continue; }
    // a flight: risers of about 17 cm, each tread straddling the ramp the walker's body slides on
    const n = max(1, round(abs(dy) / .17)), run = L / n;
    for (let j = 0; j < n; j++) {
      const t = (j + .5) / n, y = a[1] + dy * t + abs(dy) / n * .5;
      obox(steps, a[0] + ux * L * t, a[2] + uz * L * t, ux, uz, run / 2 + .02, hw, y - .45, y);
    }
  }
  // landings, rest platforms, the summit and the cave terrace are paved
  for (const p of P) if (p[4] >= 1 && p[4] <= 4) { const s = p[3] * .72; slab(p[0], p[2], 1, 0, s, s, p[1]); }
  // low stone walls on the downhill side of each flight, a railing on top where it is steep, a curb uphill
  const legs = []; let cur = [];
  for (let i = 0; i < P.length; i++) { cur.push(P[i]); if ((i > 0 && P[i][4] >= 1 && P[i][4] <= 4) || i === P.length - 1) { legs.push(cur); cur = [P[i]]; } }
  for (let leg of legs) {
    if (leg.length < 2) continue;
    const a = leg[0], b = leg[leg.length - 1], L = hypot(b[0] - a[0], b[2] - a[2]);
    if (L < 4) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[2] - a[2]) / L, vx = -uz, vz = ux, m = leg[leg.length >> 1];
    const gl = fh(m[0] + vx * 4.5, m[2] + vz * 4.5), gr = fh(m[0] - vx * 4.5, m[2] - vz * 4.5);
    for (const s of [1, -1]) {
      const low = s > 0 ? gl < gr : gr < gl, off = 1.25 + (low ? .2 : .14);
      if (leg[leg.length - 1][4] === 4) leg = leg.slice(0, -1);
      const pts = leg.map((p, k) => { const e = k === 0 || k === leg.length - 1 ? 1.6 : 0; return [p[0] + vx * s * off + ux * (k ? -e : e), p[1] + (low ? -.1 : -.18), p[2] + vz * s * off + uz * (k ? -e : e)]; });
      if (pts.length < 2) continue;
      if (!low) vwall(walls, pts, .18, -.52, 1.08);
      if (low) {
        vwall(walls, pts, .18, -.75, .75);
        const grade = abs(b[1] - a[1]) / L;
        if (grade > .18) {
          const top = pts.map((p) => [p[0], p[1] + 1.15, p[2]]);
          rails.tube(top, .032, 5, false, () => 1);
          for (let k = 0; k + 1 < top.length; k++) {
            const q = top[k], r = top[k + 1], l = hypot(r[0] - q[0], r[2] - q[2]), np = max(1, round(l / 2.4));
            for (let j = 0; j < np; j++) { const t = j / np, x = mix(q[0], r[0], t), y = mix(q[1], r[1], t), z = mix(q[2], r[2], t); rails.tube([[x, y - .55, z], [x, y, z]], .028, 5, false, () => 1); }
          }
        }
      }
    }
  }
  // shade roofs on the rest platforms
  for (const p of P) if (p[4] === 2) {
    const y = p[1] + .1;
    for (const [dx, dz] of [[-1.7, -1.3], [1.7, -1.3], [-1.7, 1.3], [1.7, 1.3]]) rails.tube([[p[0] + dx, y, p[2] + dz], [p[0] + dx, y + 2.6, p[2] + dz]], .06, 6, false, () => 1);
    box(roof, p[0] - 2.3, y + 2.6, p[2] - 1.8, p[0] + 2.3, y + 2.75, p[2] + 1.8);
  }
  // the summit: a ring of low wall with gaps where the paths arrive
  {
    const s = P[PT.nUp - 1], R = 5.4;
    for (let k = 0; k < 10; k++) {
      const a0 = k / 10 * TAU + .2, a1 = (k + .8) / 10 * TAU + .2, mid = (a0 + a1) / 2, gx = s[0] + cos(mid) * R, gz = s[2] + sin(mid) * R;
      if (pathDist([P[PT.nUp - 2], P[PT.nUp - 1], P[PT.nUp]], gx, gz) < 1.5) continue;
      walls.sweep([[s[0] + cos(a0) * R, s[1] - .3, s[2] + sin(a0) * R], [s[0] + cos(a1) * R, s[1] - .3, s[2] + sin(a1) * R]], .36, 1.3, () => [0, 1, 0]);
    }
  }
  // the dark inside of the cave, seen through the mouth
  {
    const c = PT.cave, o = PT.dir, ux = -o[2], uz = o[0];
    // an arched dark opening, not a rectangle
    const bx = c[0] - o[0] * 2.9, bz = c[2] - o[2] * 2.9, ctr = voidM.v(bx, c[1] + 1.1, bz, 0), ring = [];
    for (let k = 0; k <= 20; k++) { const a = k / 20 * TAU, rx = 1.05, ry = a < PI ? 1.45 : 1.3; ring.push(voidM.v(bx + ux * cos(a) * rx, c[1] + 1.1 + sin(a) * ry, bz + uz * cos(a) * rx, 0)); }
    for (let k = 0; k < 20; k++) { voidM.tri(ctr, ring[k], ring[k + 1]); voidM.tri(ctr, ring[k + 1], ring[k]); }
  }
  return { steps, walls, rails, roof, voidM };
}

// ---------------------------------------------------------------- instance stores
function makeWorld(D, T, NA, MID, FAR, flyPts, PT, fh) {
  const gi = (x, y, z) => x + NX * (y + NY * z);
  const nCells = CELLS * CELLS;
  const cellOf = (x, z) => clamp(floor((x - OX) / CELLW), 0, CELLS - 1) + CELLS * clamp(floor((z - OZ) / CELLW), 0, CELLS - 1);
  const small = Array.from({ length: nCells }, () => []);
  let nth = 0;
  // leaf record: x y z length · yaw tilt halfwidth anchor-height · type seed1 seed2 bend
  const leaf = (L, x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend) => { L[cellOf(x, z)].push(x, y, z, len, yaw, tilt, wid, hA, type, s1, s2, bend); };
  const grass = (x, y, z, len, yaw, tilt, wid, hA, s1, s2, bend) => { if (!(nth++ % THIN)) leaf(small, x, y, z, len, yaw, tilt, wid * (1 + LV / 2), hA, 3, s1, s2, bend); };
  const cells = Array.from({ length: 8 }, () => Array.from({ length: nCells }, () => []));
  const solids = [];
  // instance record: x y z scale · quaternion · material seed shrink-distance extra
  const solid = (mesh, x, y, z, sc, q, mat, seed, far = 0, ex = 0) => {
    if (mesh < 8) cells[mesh][cellOf(x, z)].push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, far, ex);
    else (solids[mesh] ||= []).push(x, y, z, sc, q[0], q[1], q[2], q[3], mat, seed, far, ex);
  };
  const Q0 = [0, 0, 0, 1], yawQ = (a) => qAxis(0, 1, 0, a);
  // lit height for far buildings: the key light reaches a building above this height (see the shader)
  const lsl = hypot(SUN[0], SUN[2]), ldx = SUN[0] / lsl, ldz = SUN[2] / lsl, ltn = SUN[1] / lsl;
  const litC = (x, z) => { let y = -1e4; for (let t = 25; t < 7000; t *= 1.07) y = max(y, fh(x + ldx * t, z + ldz * t) - t * ltn); return -(y + 2000); };
  const mB = grid(MID.B, MN, MO, MC), fB = grid(FAR.B, FN, FO, FC);
  const cityAt = (x, z) => (max(abs(x), abs(z)) < 1000 ? mB(x, z) : fB(x, z));
  const nearA = (x, z, c) => { const ix = clamp(round(x - OX), 0, NX - 1), iz = clamp(round(z - OZ), 0, NZ - 1); return NA[(ix + NX * iz) * 4 + c]; };
  const P = PT.P;

  // --- surface queries
  const fl = [];
  const floorsAt = (x, z) => {
    const ix = clamp(round((x - OX) / VS), 1, NX - 2), iz = clamp(round((z - OZ) / VS), 1, NZ - 2);
    fl.length = 0; let ceil = OY + NY;
    for (let gy = NY - 2; gy >= 0; gy--) {
      const d = D[gi(ix, gy, iz)], da = D[gi(ix, gy + 1, iz)];
      if (da <= 0 && d > 0) { const y = OY + (gy + d / (d - da)) * VS; fl.push(y, ceil - y); } else if (da > 0 && d <= 0) ceil = OY + (gy + 0.5) * VS;
    }
    return fl;
  };
  const gy = (x, z) => { if (max(abs(x), abs(z)) > -OX - 4) return fh(x, z); const f = floorsAt(x, z); return f.length ? f[0] : fh(x, z); };
  const pickV = () => ((rnd() * T.nv) | 0) * 3;
  const nearFly = (x, y, z, r) => { for (const p of flyPts) if (hypot(x - p[0], y - p[1], z - p[2]) < r) return true; return false; };
  const nearPose = (x, z, r = 3) => { for (const p of POSES) if (!p[6] && hypot(x - p[0], z - p[2]) < r) return true; return false; };
  const cv = PT.cave, cdir = PT.dir;
  const nearCave = (x, z, r) => hypot(x - cv[0] - cdir[0] * 2, z - cv[2] - cdir[2] * 2) < r;

  // --- the path's stonework and the cave mouth, one world-space mesh each
  const pm = buildPath(PT, fh);
  solid(8, 0, 0, 0, 1, Q0, 5, .1, 0, 0); solid(9, 0, 0, 0, 1, Q0, 6, .2, 0, 0); solid(10, 0, 0, 0, 1, Q0, 9, .3, 0, 0);
  solid(11, 0, 0, 0, 1, Q0, 12, .4, 0, 0); solid(12, 0, 0, 0, 1, Q0, 11, .5, 0, 0);

  // --- granite boulders, rubble and gravel over the mountain, kept off the path, the poses and the flight
  rseed(12);
  for (let i = 0; i < 90000; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2], ny = T.wn[k + 1];
    if (max(abs(x), abs(z)) > -OX - 6 || nearPose(x, z, 6) || nearCave(x, z, 4.5)) continue;
    const pd = pathDist(P, x, z), gr = nearA(x, z, 2);
    if (pd < .6) continue;
    const q = qRand(), r = rnd();
    if (r < .16 * (1 - gr * .6) && pd > 2.2) {
      const big = rnd() < .18, sc = big ? rr(1.6, 4.2) : rr(.4, 1.6);
      if (nearFly(x, y, z, sc + 3)) continue;
      solid(big ? 2 : (rnd() < .5 ? 0 : 1), x - T.wn[k] * sc * .35, y - ny * sc * .4, z - T.wn[k + 2] * sc * .35, sc, q, rnd() < .65 ? 2 : 3, rnd(), 0, 0);
    } else if (r < .42 && ny > .5) {
      const sc = .12 + .45 * pow(rnd(), 2);
      if (!(nth++ % THIN)) solid(rnd() < .5 ? 3 : 4, x, y - sc * .25, z, sc, q, rnd() < .5 ? 2 : 4, rnd(), 90, 0);
    } else if (ny > .5 && r < .42 + .3 * (gr + ny * .5)) {
      const sc = .04 + .12 * pow(rnd(), 2);
      if (!(nth++ % THIN)) solid(rnd() < .6 ? 7 : 5, x, y - sc * .2, z, sc, q, 4, rnd(), 40, 0);
    }
  }
  // loose stones along the path edges and on the landings
  rseed(14);
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1], L = hypot(b[0] - a[0], b[2] - a[2]);
    for (let t = 0; t < L; t += 1.1) {
      if (rnd() < .5) continue;
      const u = t / L, s = rnd() < .5 ? -1 : 1, vx = -(b[2] - a[2]) / L, vz = (b[0] - a[0]) / L, o = s * rr(1.7, 3.2);
      const x = mix(a[0], b[0], u) + vx * o, z = mix(a[2], b[2], u) + vz * o;
      if (max(abs(x), abs(z)) > -OX - 6 || nearCave(x, z, 6.5)) continue;
      const sc = rr(.15, .7);
      solid(rnd() < .5 ? 0 : 6, x, gy(x, z) - sc * .3, z, sc, qRand(), rnd() < .7 ? 2 : 3, rnd(), 0, 0);
    }
  }
  // the boulders that frame the cave terrace
  rseed(15);
  {
    const ux = -cdir[2], uz = cdir[0];
    for (const [s, f, sc] of [[-3.6, 4.6, .9], [3.9, 5.2, 1.1]]) {
      const x = cv[0] + ux * s + cdir[0] * f, z = cv[2] + uz * s + cdir[2] * f;
      solid(2, x, gy(x, z) - sc * .35, z, sc, qRand(), 2, rnd(), 0, 0);
    }
  }

  // --- a few thorny shrubs in the gullies (the mountain is almost bare)
  rseed(9);
  for (let i = 0; i < 2600; i++) {
    const k = pickV(), x = T.wp[k], y = T.wp[k + 1], z = T.wp[k + 2];
    if (T.wn[k + 1] < .8 || max(abs(x), abs(z)) > -OX - 6 || nearPose(x, z, 2) || pathDist(P, x, z) < 1 || rnd() > .07 + .5 * nearA(x, z, 2)) continue;
    const yw = rnd() * TAU, s = rr(.5, 1.1);
    for (let j = 0; j < 9; j++) grass(x + rr(-.2, .2), y - .05, z + rr(-.2, .2), rr(.25, .7) * s, yw + j * 2.4, rr(.3, 1.2), rr(.02, .04), 0, rnd(), rnd(), rr(.3, .7));
  }

  // --- Masjid al-Haram and the clock tower, far to the south-west
  const hy = fh(HARAM[0], HARAM[1]), hl = litC(...HARAM);
  solid(13, HARAM[0], hy, HARAM[1], 1, Q0, 7, .1, hl, 1);
  solid(14, HARAM[0], hy, HARAM[1], 1, Q0, 7, .2, hl, 0);
  solid(17, HARAM[0] + 2, hy, HARAM[1] + 3, 1, yawQ(.3), 13, .3, hl, 0);
  for (const [x, z] of [[-165, -165], [165, -165], [-165, 165], [165, 165], [-166, -22], [-166, 22], [-150, -430], [150, -430], [166, 0], [0, 166]]) {
    solid(15, HARAM[0] + x, hy, HARAM[1] + z, 1.3, yawQ(PI / 8), 7, .5, hl, 0);
    solid(16, HARAM[0] + x, hy + 91.3 * 1.3, HARAM[1] + z, 2, Q0, 10, 0, 0, 0);
  }
  const cy = fh(CLOCK[0], CLOCK[1]);
  solid(18, CLOCK[0], cy, CLOCK[1], 1, Q0, 14, .6, litC(...CLOCK), 376);
  solid(19, CLOCK[0], cy, CLOCK[1], 1, Q0, 8, .7, litC(...CLOCK), 0);
  solid(16, CLOCK[0], cy + 585, CLOCK[1], 7.5, Q0, 10, 0, 0, 0);

  // --- the city: houses filling the valleys, hotels and towers close to the Haram, lamps along the streets
  rseed(5);
  const lamps = [];
  const sx_ = -HARAM[0], sz_ = -HARAM[1], sl_ = hypot(sx_, sz_), ax = sx_ / sl_, az = sz_ / sl_;
  for (let dz = -4300; dz < 7400; dz += 360) for (let dx = -7600; dx < 4400; dx += 360) {
    if (hypot(dx, dz) > 8200) continue;
    const ang = rr(-.6, .6), ca = cos(ang), sa = sin(ang);
    const sx = 5 + (rnd() * 3 | 0), sz = 5 + (rnd() * 3 | 0), lane = rnd() * 12 | 0;
    for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) {
      const lx = i * 30 - 165 + rr(-3, 3), lz = j * 30 - 165 + rr(-3, 3), x = dx + lx * ca - lz * sa, z = dz + lx * sa + lz * ca, c = cityAt(x, z);
      const street = i % sx === 0 || j % sz === 0 || (i === lane && j > 6);
      if (street) { if (c > .3 && rnd() < .7) lamps.push(x + rr(-6, 6), fh(x, z) + 7, z + rr(-6, 6), rnd()); continue; }
      if (c < .06 || rnd() > min(1, c * 4) || rnd() < .03) continue;
      if (max(abs(x - HARAM[0]), abs(z - HARAM[1])) < 240 || (abs(x - HARAM[0]) < 160 && z - HARAM[1] < -150 && z - HARAM[1] > -440)) continue;
      if (max(abs(x - CLOCK[0]) - 160, abs(z - CLOCK[1]) - 120) < 0) continue;
      const dm = hypot(x - HARAM[0], z - HARAM[1]);
      let t = CITY_LOW[(rnd() * CITY_LOW.length) | 0];
      if (dm < 900 && rnd() < .5) t = rnd() < .5 ? 6 : rnd() < .8 ? 7 : 8;
      else if (dm < 1800 && rnd() < .1) t = 6;
      // keep the sight line from the mountain to the Haram low
      const vx = x - HARAM[0], vz = z - HARAM[1], along = vx * ax + vz * az;
      if (t >= 6 && along > 0 && along < 2200 && abs(vx * az - vz * ax) < 170 + along * .05) t = CITY_LOW[(rnd() * 4) | 0];
      const sc = rr(.85, 1.05), yaw = -ang + (rnd() < .5 ? 0 : PI / 2) + rr(-.025, .025);
      solid(20 + t * 2 + (rnd() < .5 ? 1 : 0), x, fh(x, z) - .5, z, sc, yawQ(yaw), 17, rnd(), litC(x, z), CITY[t][1] * sc);
    }
  }
  // the Haram floodlights: a ring of bright lamps on its roof edge
  for (let k = 0; k < 160; k++) { const a = k / 160 * TAU; lamps.push(HARAM[0] + clamp(cos(a) * 240, -167, 167), hy + 33, HARAM[1] + clamp(sin(a) * 240, -167, 167), .99); }

  // --- life: a few birds wheeling around the summit and over the slopes (none at night)
  rseed(13);
  const birds = [];
  if (!NIGHT) for (const f of [[0, 330, 0, 45, 7, 1], [-60, 270, 80, 70, 6, -1], [90, 220, 140, 60, 5, 1]]) {
    const ss_ = rnd();
    for (let i = 0; i < f[4]; i++) birds.push(f[0], f[1], f[2], f[3], ss_ + rnd() * .2, f[5] * rr(.9, 1.1) * 7 / f[3], rr(1.2, 1.5), rnd());
  }
  const motes = new Float32Array(3000 * 4);
  for (let i = 0; i < motes.length; i++) motes[i] = rnd();

  // --- packing
  const pack = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const buf = new ArrayBuffer(max(36, n * 36)), f = new Float32Array(buf), u8 = new Uint8Array(buf), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12, k++) {
      for (let j = 0; j < 8; j++) f[k * 9 + j] = a[i + j];
      u8[k * 36 + 32] = a[i + 8]; u8[k * 36 + 33] = a[i + 9] * 255; u8[k * 36 + 34] = a[i + 10] * 255; u8[k * 36 + 35] = a[i + 11] * 255;
      const y = a[i + 1], l = a[i + 3]; if (y - l < lo[c]) lo[c] = y - l; if (y + l > hi[c]) hi[c] = y + l;
    } }
    return { buf, n, start, lo, hi };
  };
  const packC = (L) => {
    let n = 0; const start = new Uint32Array(nCells + 1);
    for (let c = 0; c < nCells; c++) { start[c] = n; n += L[c].length / 12; }
    start[nCells] = n;
    const data = new Float32Array(max(12, n * 12)), lo = new Float32Array(nCells).fill(1e9), hi = new Float32Array(nCells).fill(-1e9);
    let k = 0;
    for (let c = 0; c < nCells; c++) { const a = L[c]; for (let i = 0; i < a.length; i += 12) { for (let j = 0; j < 12; j++) data[k++] = a[i + j]; lo[c] = min(lo[c], a[i + 1] - 5); hi[c] = max(hi[c], a[i + 1] + 5); } }
    return { data, n, start, lo, hi };
  };

  // --- half-res volume: r = openness, g = skylight
  const hx = NX / 2, hy2 = NY / 2, hz = NZ / 2, volD = new Uint8Array(hx * hy2 * hz * 2);
  let Lp = new Float32Array(hx * hz).fill(1), Ln = new Float32Array(hx * hz), tmp = new Float32Array(hx * hz);
  for (let y = hy2 - 1; y >= 0; y--) {
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) { const i = x + hx * z; tmp[i] = (Lp[x > 0 ? i - 1 : i] + 2 * Lp[i] + Lp[x < hx - 1 ? i + 1 : i]) * 0.25; }
    for (let z = 0; z < hz; z++) for (let x = 0; x < hx; x++) {
      const i = x + hx * z, b = (tmp[z > 0 ? i - hx : i] + 2 * tmp[i] + tmp[z < hz - 1 ? i + hx : i]) * 0.25;
      const g0 = gi(x * 2, y * 2, z * 2);
      const d = (D[g0] + D[g0 + 1] + D[g0 + NX] + D[g0 + NX + 1] + D[g0 + NX * NY] + D[g0 + NX * NY + 1] + D[g0 + NX * NY + NX] + D[g0 + NX * NY + NX + 1]) * 0.125;
      const o = x + hx * (y + hy2 * z);
      Ln[i] = b * clamp(0.5 - d / 1.5, 0, 1);
      volD[o * 2] = clamp(0.5 - d / 10, 0, 1) * 255; volD[o * 2 + 1] = min(1, b) * 255;
    }
    const t = Lp; Lp = Ln; Ln = t;
  }

  // --- maps: near (1 m): gravel, rock · far (~23 m): rock, gravel, city, plaza (1) or main road (.5)
  const nm = new Uint8Array(NX * NZ * 4);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const o = (i + NX * j) * 4; nm[o] = NA[o + 2] * 255; nm[o + 1] = NA[o + 1] * 255; }
  const fmap = new Uint8Array(FN * FN * 4);
  for (let k = 0; k < FN * FN; k++) { fmap[k * 4] = FAR.A[k * 4 + 1] * 255; fmap[k * 4 + 1] = FAR.A[k * 4 + 2] * 255; fmap[k * 4 + 2] = FAR.B[k * 4] * 255; fmap[k * 4 + 3] = max(FAR.B[k * 4 + 1], FAR.B[k * 4 + 2] * .5) * 255; }

  const sol = { data: [], ranges: [] }; let si = 0;
  for (let m = 0; m < NSOLID; m++) { const a = solids[m] || []; sol.ranges.push([si, a.length / 12]); si += a.length / 12; for (let i = 0; i < a.length; i++) sol.data.push(a[i]); }
  return { gy, pm, cells: cells.map(packC), small: pack(small),
    solids: { data: new Float32Array(sol.data), ranges: sol.ranges }, birds: new Float32Array(birds.length ? birds : [0, -1e4, 0, 1, 0, 0, 0, 0]), nBirds: birds.length / 8,
    motes, lamps: new Float32Array(lamps), volD, nm, fmap };
}
const qrot3 = (q, v) => {
  const [x, y, z, w] = q, cx = y * v[2] - z * v[1] + w * v[0], cy = z * v[0] - x * v[2] + w * v[1], cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)];
};
