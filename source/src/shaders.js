// ============================================================================
// WGSL sources
// ============================================================================
// Noise, detail texture, blit/bloom and the composite chain follow Abyssal Garden (MIT); the ground model, sky and
// air, granite, the path, the Haram, the clock tower, the lamps and the stars are this world's own.

// smoothstep lives in its own string so modules that already have it (via S_G) can take the noise without it
const W_SS = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
`;
const W_NOISE = /*wgsl*/`
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

// ---------------------------------------------------------------- geography (shared by the shaders and world.js)
// Axes: +x east, -z north, y up, metres. Jabal al-Nour's summit is at the origin. Composed, not to scale: the Haram
// is 3.4 km to the south-west (really about 4-5 km) so it reads from the mountain.
const HARAM = [-2190, 2600], CLOCK = [-2160, 2990];
// city valleys: x0, z0, x1, z1, half width of the flat floor
const VALLEYS = [[-2190, 2600, -900, 1250, 300], [-900, 1250, -330, 470, 230], [500, 820, 170, 470, 150], [-900, 1250, 500, 820, 210], [500, 820, 3300, 350, 230], [-900, 1250, -1500, -1800, 220],
  [-2190, 2600, -5200, 3600, 420], [-2190, 2600, -1800, 5800, 320], [-2190, 2600, -4300, 800, 300], [500, 820, 1500, 3600, 210],
  [-1500, -1800, -3600, -3100, 260], [500, 820, 1250, -1300, 170], [-5200, 3600, -6500, 6500, 300]];
const vlist = (a) => a.map((v) => `vec4f(${v.slice(0, 4).map((x) => x.toFixed(1)).join(',')})`).join(',');

// ---------------------------------------------------------------- near-field rock density (compute)
// M holds the ground model per column (x height, y rock mask, z gravel); P the path polyline (x, y, z, half width);
// u.cv the cave mouth (floor centre) and u.cf its outward direction. The path is cut into the rock as a flat bench
// with sloped cut walls above and a filled embankment below; the cave is a cleft under leaning boulders.
const W_DENS = W_SS + W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f, cv: vec4f, cf: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> D: array<f32>;
@group(0) @binding(2) var<storage, read> M: array<vec4f>;
@group(0) @binding(3) var<storage, read> P: array<vec4f>;
fn colAt(x: f32, z: f32) -> vec4f {
  let fx = clamp(x, 0., f32(u.n.x) - 1.001); let fz = clamp(z, 0., f32(u.n.z) - 1.001);
  let ix = u32(fx); let iz = u32(fz); let tx = fx - f32(ix); let tz = fz - f32(iz); let w = u.n.x;
  return mix(mix(M[ix + w * iz], M[ix + 1u + w * iz], tx), mix(M[ix + w * (iz + 1u)], M[ix + 1u + w * (iz + 1u)], tx), tz);
}
fn ell(p: vec3f, c: vec3f, r: vec3f) -> f32 { let k = length((p - c) / r); return (k - 1.) * min(r.x, min(r.y, r.z)); }
fn dens(p: vec3f, gx: f32, gz: f32) -> f32 {
  let ef = ss(0., 16., min(min(gx, f32(u.n.x) - 1. - gx), min(gz, f32(u.n.z) - 1. - gz)));
  let m = colAt(gx, gz) * vec4f(1., ef, ef, 1.);
  var d = m.x - p.y;
  let w = vec3f(fbm(p * .045 + 11., 2), fbm(p * .045 + 47., 2), fbm(p * .045 + 83., 2)) - .5;
  let o = normalize(u.cf.xyz); let sd = vec3f(-o.z, 0., o.x); let r = p - u.cv.xyz;
  let lc = vec3f(dot(r, sd), r.y, dot(r, o));
  // granite: piles of rounded tors and core stones, exfoliating sheets, joints; calmer where gravel collects
  let q = p + w * 4.;
  let tor = (.5 - wor(q * vec3f(.12, .15, .12))) * 4.;
  let sheet = (abs(fract(p.y * .28 + w.x * 1.5) - .5) - .25) * .9;
  let calm = ss(5., 20., length(p.xz - vec2f(3., -5.))) * ss(4., 12., length(lc));
  d += m.y * ((tor * (1. - .55 * m.z) + (fbm(p * .24, 3) - .5) * 2.6) * mix(.35, 1., calm) + sheet + (fbm(p * .95, 2) - .5) * .55);
  // the cave of Hira: boulders leaning together over a narrow cleft, the mouth facing u.cf
  if (dot(lc, lc) < 900.) {
    d = max(d, -ell(lc, vec3f(-3.2, 1.9, .9), vec3f(2.4, 3.2, 2.5)));
    d = max(d, -ell(lc, vec3f(3.3, 2.2, 1.1), vec3f(2.5, 3.4, 2.5)));
    d = max(d, -ell(lc, vec3f(.4, 5.2, .6), vec3f(4.2, 1.5, 2.8)));
    d = max(d, -ell(lc, vec3f(0., 3., -4.), vec3f(5.5, 4.5, 3.)));
    // the cleft: a narrowing slot under the boulders, closed at the back
    let wq = .62 - max(-lc.z, 0.) * .08 - max(lc.y - 2.3, 0.) * .18;
    let bx = vec3f(abs(lc.x) - wq, abs(lc.y - 2.1) - 2.15, abs(lc.z + 1.6) - 2.4);
    let slot = length(max(bx, vec3f(0.))) + min(max(bx.x, max(bx.y, bx.z)), 0.);
    d = min(d, slot);
  }
  // the stepped path: a level bench along the polyline
  var bd = 1e9; var yp = 0.; var hw = 0.;
  for (var i = 0u; i + 1u < u.n.w; i++) {
    let a = P[i]; let b = P[i + 1u];
    let ab = b.xz - a.xz; let t = clamp(dot(p.xz - a.xz, ab) / max(dot(ab, ab), 1e-4), 0., 1.);
    let dd = distance(p.xz, a.xz + ab * t); let w2 = mix(a.w, b.w, t);
    if (dd - w2 < bd) { bd = dd - w2; yp = mix(a.y, b.y, t); hw = w2; }
  }
  if (bd < 12.) {
    let fl = yp - .22 - p.y; let dxz = bd + hw;
    let cut = hw + .9 + max(-fl, 0.) * .7;
    let c = ss(cut + 1.6, cut, dxz) * step(fl, 0.);
    d = min(d, mix(d, fl, c));
    if (fl > 0.) { d = max(d, min(fl, 2.) * ss(hw + 1.6, hw + .6, dxz)); }
  }
  return d;
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (any(id >= u.n.xyz)) { return; }
  var d = dens(u.o.xyz + vec3f(id) * u.o.w, f32(id.x), f32(id.z));
  if (id.y == u.n.y - 1u) { d = -1.; }
  if (id.y == 0u) { d = 1.; }
  D[id.x + u.n.x * (id.y + u.n.y * id.z)] = d;
}
`;

// ---------------------------------------------------------------- ground model (compute, load time)
// One function for the whole 24 km world, sampled three times: 1 m over the near field, 2 m over the middle 2 km,
// ~23 m over everything. A = height, granite rock, gravel/dust, valley · B = city, Haram plaza, main road
const W_GROUND = W_SS + W_NOISE + /*wgsl*/`
struct U { n: vec4u, o: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> A: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> B: array<vec4f>;
const HAR = vec2f(${HARAM[0]}., ${HARAM[1]}.);
const VAL = array<vec4f, ${VALLEYS.length}>(${vlist(VALLEYS)});
const VW = array<f32, ${VALLEYS.length}>(${VALLEYS.map((v) => v[4] + '.').join(',')});
fn segD(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
fn ridged(p: vec2f, s: f32, o: i32) -> f32 { return 1. - abs(fbm(vec3f(p * s, 5.), o) * 2. - 1.); }
fn smax(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.) / k; return max(a, b) + h * h * k * .25; }
// Jabal al-Nour: a broad steep cone carrying a second, steeper knob ("as if two mountains are on top of each other")
fn jabal(p: vec2f) -> f32 {
  let r = length(p * vec2f(1., 1.1)); let a = atan2(p.y, p.x); let cs = vec2f(cos(a), sin(a));
  // spurs and gullies: the base radius swings with the bearing, so the foot is lobed rather than round
  let spur = 1. - abs(fbm(vec3f(cs * 2.2, 3.7), 3) * 2. - 1.);
  let rr = r * (1. + .09 * sin(a * 3. + 1.) + .05 * sin(a * 5. + 2.) - .22 * (spur - .5));
  // a broad body with full shoulders, its top pushed off-centre so the two sides of the peak differ
  let pb = p - vec2f(-30., 20.);
  let rb = length(pb * vec2f(1., 1.18)) * (1. + .09 * sin(a * 3. + 1.) - .2 * (spur - .5));
  var h = 150. * pow(max(1. - rb / 500., 0.), 1.25) + 60. * pow(max(1. - rr / 330., 0.), 1.6);
  let k = length((p - vec2f(3., -5.)) * vec2f(1., 1.22));
  // the summit knob: a rounded crown of piled granite, not a point
  h += 92. * pow(max(1. - pow(k / 118., 1.45), 0.), .95);
  // big piled blocks on the upper slopes make the silhouette lumpy instead of a clean cone
  let tq = vec3f(p.x * .011, 0., p.y * .011) + vec3f(fbm(vec3f(p * .006, 4.), 2), 0., fbm(vec3f(p * .006, 8.), 2)) * 1.2;
  h += 30. * (.5 - wor(tq)) * ss(25., 70., k) * ss(260., 110., r);
  // ribs and gullies running down the flanks
  let rib = 1. - abs(fbm(vec3f(cs * 5.5, r * .011), 3) * 2. - 1.);
  let s1 = length((p - vec2f(150., -150.)) * mat2x2f(.7, .7, -.7, .7) * vec2f(1., 2.1));
  let s2 = length((p - vec2f(-140., -110.)) * mat2x2f(.8, -.6, .6, .8) * vec2f(1., 2.));
  let s3 = length((p - vec2f(260., 40.)) * mat2x2f(.96, .28, -.28, .96) * vec2f(1., 2.4));
  h += 52. * pow(max(1. - s1 / 210., 0.), 1.3) + 38. * pow(max(1. - s2 / 190., 0.), 1.3) + 44. * pow(max(1. - s3 / 260., 0.), 1.2);
  // great stacked blocks of granite break the slopes into crags, larger toward the foot
  let bq = vec3f(p.x * .022, 0., p.y * .022) + vec3f(fbm(vec3f(p * .01, 2.), 2), 0., fbm(vec3f(p * .01, 9.), 2)) * 1.5;
  h += 22. * (.55 - wor(bq)) * ss(10., 70., r) * ss(540., 300., r);
  h += 24. * (rib - .55) * ss(15., 90., r) * ss(500., 220., r) + 9. * (fbm(vec3f(p * .03, 3.), 3) - .5) * ss(480., 250., r);
  // exfoliation ledges: granite sheets step the mid slopes into short cliffs and benches
  let lv = h / 17. + 1.6 * fbm(vec3f(p * .012, 5.), 2); let lf = fract(lv);
  h -= 17. * (lf - ss(.15, .85, lf)) * .55 * ss(70., 150., r) * ss(520., 380., r);
  return h;
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= u.n.x || id.y >= u.n.y) { return; }
  let x = u.o.x + f32(id.x) * u.o.z; let z = u.o.y + f32(id.y) * u.o.z; let p = vec2f(x, z);
  let dh = distance(p, HAR); let rj = length(p);
  // the valley floors fall gently toward the Haram
  let flo = -40. + min(dh * .017, 130.) + 3. * (fbm(vec3f(p * .004, 1.), 2) - .5);
  var vd = 1e9; var rd = 1e9;
  for (var k = 0; k < ${VALLEYS.length}; k++) {
    let v = VAL[k]; let s = segD(p, v.xy, v.zw);
    vd = min(vd, s - VW[k]); rd = min(rd, s);
  }
  let wig = 70. * (fbm(vec3f(p * .0025, 7.), 3) - .5);
  let val = ss(300., 0., vd + wig);
  // bare granite ranges: sharp ridges and peaks 150-400 m above the valleys, kept clear around Jabal al-Nour
  let n1 = ridged(p + vec2f(1300., 400.), .00085, 5); let n2 = ridged(p + vec2f(300., 900.), .0027, 4);
  let n3 = ridged(p + vec2f(77., 31.), .0075, 3);
  let n4 = ridged(p + vec2f(511., 97.), .024, 3);
  var hm = 30. + 360. * pow(n1, 1.8) + 80. * (n2 - .5) + 38. * (n3 - .5) * (.4 + n1) + 20. * (fbm(vec3f(p * .012, 2.), 3) - .5) + 12. * (n4 - .55) * (.3 + n1) * ss(30., 6., u.o.z);
  hm *= ss(430., 950., rj) * (.75 + .5 * fbm(vec3f(p * .0004, 9.), 2)) * mix(.5, 1., ss(1200., 4500., rj));
  let rimR = ss(5500., 10500., length(p - vec2f(-1200., 1500.)));
  hm += rimR * (220. + 380. * pow(ridged(p + vec2f(4000., 0.), .00045, 4), 1.5));
  var h = flo + mix(hm, 2. * (fbm(vec3f(p * .02, 4.), 2) - .5), val * (1. - rimR));
  h = smax(h, flo + 4. + jabal(p) * ss(800., 560., rj), 40.);
  // piles of rounded granite blocks on every slope (only where the grid is fine enough to hold them)
  let rk = ss(3., 25., h - flo) * ss(8., 3., u.o.z) * ss(6., 30., distance(p, vec2f(3., -5.)));
  let wq = vec3f(x * .085, 0., z * .085) + vec3f(fbm(vec3f(p * .02, 1.), 2), 0., fbm(vec3f(p * .02, 6.), 2)) * 1.2;
  h += rk * ((.5 - wor(wq)) * 6. + (fbm(vec3f(p * .3, 8.), 2) - .5) * 1.4);
  let plaza = step(abs(x - HAR.x), 230.) * step(abs(z - HAR.y), 260.);
  h = mix(h, -40., plaza);
  let rise = h - flo;
  let city = ss(.25, .7, val) * ss(9000., 6000., dh) * ss(430., 520., rj) * ss(16., 4., rise);
  let road = ss(22., 12., rd) * city;
  let gravel = ss(.5, .72, fbm(vec3f(p * .021, 12.), 3)) * (1. - city);
  A[id.x + u.n.x * id.y] = vec4f(h, 1. - city, gravel, val);
  B[id.x + u.n.x * id.y] = vec4f(city, plaza, road, 0.);
}
`;

// ---------------------------------------------------------------- fullscreen helpers
const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

// surface detail texture (tileable): rg = slope, b = height, a = mottling
const W_DETAIL = W_SS + W_NOISE + W_FS + /*wgsl*/`
fn hp(p: vec2f, per: f32) -> f32 { return h31(vec3f(p - per * floor(p / per), per)); }
fn tn(p: vec2f, per: f32) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(hp(i, per), hp(i + vec2f(1., 0.), per), u.x), mix(hp(i + vec2f(0., 1.), per), hp(i + vec2f(1., 1.), per), u.x), u.y);
}
fn tf(uv: vec2f, per: f32, n: i32) -> f32 { var a = .5; var s = 0.; var pr = per; for (var i = 0; i < n; i++) { s += a * tn(uv * pr + f32(i) * 7.3, pr); pr *= 2.; a *= .5; } return s / (1. - 2. * a); }
fn tw(p: vec2f, per: f32) -> vec3f {
  let i = floor(p); let f = fract(p); var d = vec2f(9.); var id = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) {
    let o = vec2f(f32(x), f32(y)); let c = i + o; let cw = c - per * floor(c / per);
    let hh = h33(vec3f(cw, per)); let r = o + hh.xy - f; let l = dot(r, r);
    if (l < d.x) { d.y = d.x; d.x = l; id = hh.z; } else if (l < d.y) { d.y = l; }
  } }
  return vec3f(sqrt(d), id);
}
fn H(uv: vec2f) -> f32 {
  let wq = uv + .11 * (vec2f(tf(uv, 3., 4), tf(uv + .5, 3., 4)) - .5);
  let f = tf(wq, 3., 8);
  let r1 = 1. - abs(tf(wq + 1.7, 5., 6) * 2. - 1.);
  let cr = min(abs(tf(wq + 4.1, 4., 5) * 2. - 1.) * 7., 1.);
  let cr2 = min(abs(tf(wq.yx + 2.3, 9., 4) * 2. - 1.) * 9., 1.);
  let pt = tw(wq * 29., 29.);
  let pit = (1. - ss(.0, .34, pt.x)) * step(.62, pt.z);
  return f * .50 + r1 * r1 * .24 + cr * cr2 * .26 - pit * .07;
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / 1024.; let e = 1. / 1024.;
  let h = H(uv);
  let gx = H(uv + vec2f(e, 0.)) - H(uv - vec2f(e, 0.)); let gy = H(uv + vec2f(0., e)) - H(uv - vec2f(0., e));
  let s = clamp(vec2f(gx, gy) * 1024. * .5 * .075, vec2f(-1.), vec2f(1.));
  return vec4f(-s * .5 + .5, h, tf(uv + 3.7, 3., 5));
}
`;

// blit / mip / bloom chain
const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

// ---------------------------------------------------------------- shared: uniforms, sky, air (light from the Time preset)
const S_G = /*wgsl*/`
struct G { vp: mat4x4f, sm: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, sun: vec4f, res: vec4f, mis: vec4f };
const SUNC = ${v3(TP.key)};
const ZEN = ${v3(TP.zen)};
const HORL = ${v3(TP.horL)};
const HORF = ${v3(TP.horF)};
const GLOW = ${v3(TP.glow)};
const GNDL = ${v3(TP.gndL)};
const GNDF = ${v3(TP.gndF)};
const FARH = ${v3(TP.farH)};
const CITYG = ${v3(TP.city)};
const LIGHTS = ${TP.lights.toFixed(3)};
const NIGHT = ${NIGHT};
const BETA = vec3f(.75e-4, .9e-4, 1.15e-4) * ${TP.beta.toFixed(3)};
const MIST = ${TP.mist.toFixed(3)};
const HSCALE = 320.;
const TAU = 6.2831853;
const NEARH = ${-OX}.;
const HAR = vec2f(${HARAM[0]}., ${HARAM[1]}.);
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(.06711056, .00583715)))); }
fn hs(x: f32) -> f32 { return fract(sin(x * 127.1) * 43758.5453); }
fn fin(c: vec3f) -> vec4f { return vec4f(min(max(c, vec3f(0.)), vec3f(60.)), 1.); }
// sky radiance in direction rd: zenith colour overhead, warm along the horizon on the light's side, cooler opposite;
// at night a warm glow of the city low on the horizon, strongest toward the Haram
fn skyCol(rd: vec3f, sun: vec3f) -> vec3f {
  let y = max(rd.y, 0.);
  let h = vec2f(rd.x, rd.z); let hl = max(length(h), 1e-4);
  let tw = select(.5 + .5 * dot(h / hl, normalize(sun.xz)), .5, NIGHT);
  let mu = dot(rd, sun);
  let hor = mix(HORF, HORL, tw * tw);
  var c = mix(hor, ZEN, pow(y, .5));
  c += GLOW * .35 * pow(sat(1. - y * 4.), 3.) * tw * tw * tw;
  if (!NIGHT) { c += SUNC * (.025 * pow(max(mu, 0.), 5.) + .07 * pow(max(mu, 0.), 40.) + .25 * pow(max(mu, 0.), 500.)); }
  let ch = .45 + .55 * pow(max(dot(h / hl, normalize(HAR)), 0.), 3.);
  c += CITYG * pow(sat(1. - y * 7.), 4.) * ch;
  return mix(c, mix(GNDF, GNDL, tw) + CITYG * .4 * ch, sat(-rd.y * 5.));
}
// aerial perspective: exponential-height haze integrated in closed form along the view ray, plus a thin low layer
// that pools in the valleys (thicker at dawn); distant things fade to the sky's horizon colour in their direction
fn aerialSh(c: vec3f, cam: vec3f, wp: vec3f, sun: vec3f, sh: f32) -> vec3f {
  let v = wp - cam; let d = max(length(v), 1e-3); let rd = v / d;
  let k = rd.y / HSCALE;
  let od = select((1. - exp(-k * d)) / k, d, abs(k) < 1e-7) * exp(-max(cam.y, -60.) / HSCALE);
  let k2 = rd.y / 60.;
  let od2 = select((1. - exp(-k2 * d)) / k2, d, abs(k2) < 1e-7) * exp(-max(cam.y + 30., -30.) / 60.);
  let T = exp(-BETA * od - vec3f(1.5e-4, 1.6e-4, 1.75e-4) * MIST * od2);
  let ins = mix(skyCol(normalize(vec3f(rd.x, max(rd.y, 0.) * .3 + .012, rd.z)), sun), FARH, ss(900., 7000., d) * .65);
  return c * T + ins * (1. - T) * mix(vec3f(.30, .36, .52), vec3f(1.), sh);
}
fn aerialAt(c: vec3f, cam: vec3f, wp: vec3f, sun: vec3f) -> vec3f {
  let v = wp - cam; let d = max(length(v), 1e-3); let rd = v / d;
  let k = rd.y / HSCALE;
  let od = select((1. - exp(-k * d)) / k, d, abs(k) < 1e-7) * exp(-max(cam.y, -60.) / HSCALE);
  let k2 = rd.y / 60.;
  let od2 = select((1. - exp(-k2 * d)) / k2, d, abs(k2) < 1e-7) * exp(-max(cam.y + 30., -30.) / 60.);
  let T = exp(-BETA * od - vec3f(1.5e-4, 1.6e-4, 1.75e-4) * MIST * od2);
  let ins = mix(skyCol(normalize(vec3f(rd.x, max(rd.y, 0.) * .3 + .012, rd.z)), sun), FARH, ss(900., 7000., d) * .4);
  return c * T + ins * (1. - T);
}
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;

const S_B = S_G + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sR: sampler;
@group(0) @binding(2) var sC: sampler;
@group(0) @binding(3) var sS: sampler_comparison;
@group(0) @binding(4) var tSh: texture_depth_2d;
@group(0) @binding(5) var tD: texture_2d<f32>;
@group(0) @binding(6) var tV: texture_3d<f32>;
@group(0) @binding(7) var tN: texture_2d<f32>;
@group(0) @binding(8) var tF: texture_2d<f32>;
@group(0) @binding(9) var tL: texture_2d<f32>;
const AMBK = ${v3(TP.ambK)};
const AMBG = ${v3(TP.ambG)};
const AMBF = ${v3(TP.ambF)};
fn nearK(p: vec3f) -> f32 { return 1. - ss(NEARH - 12., NEARH - 2., max(abs(p.x), abs(p.z))); }
// shadows of the far ranges over the near field: the light reaches p only above the column's lit height
fn farSh(p: vec3f) -> f32 {
  let gq = (p.xz - vec2f(${OX}., ${OZ}.)) * .5 - .5; let i = vec2i(floor(gq)); let f = fract(gq); let mx = vec2i(${NX / 2 - 1});
  let a = textureLoad(tL, clamp(i, vec2i(0), mx), 0).r; let b = textureLoad(tL, clamp(i + vec2i(1, 0), vec2i(0), mx), 0).r;
  let c = textureLoad(tL, clamp(i + vec2i(0, 1), vec2i(0), mx), 0).r; let d = textureLoad(tL, clamp(i + vec2i(1, 1), vec2i(0), mx), 0).r;
  return mix(1., ss(-1.5, 2.5, p.y - mix(mix(a, b, f.x), mix(c, d, f.x), f.y)), nearK(p));
}
fn shUV(p: vec3f) -> vec3f { let s = g.sm * vec4f(p, 1.); return vec3f(s.x * .5 + .5, .5 - s.y * .5, s.z - .0004); }
fn shadow1(p: vec3f) -> f32 {
  let s = shUV(p);
  return mix(1., textureSampleCompareLevel(tSh, sS, s.xy, s.z), nearK(p)) * farSh(p);
}
fn shadow9(p: vec3f) -> f32 {
  if (LOW) { return shadow1(p); }
  let s = shUV(p); let e = 1.4 / ${SHADOW}.; var a = 0.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { a += textureSampleCompareLevel(tSh, sS, s.xy + vec2f(f32(x), f32(y)) * e, s.z); } }
  return mix(1., a / 9., nearK(p)) * farSh(p);
}
// r = openness, g = skylight; outside the near field everything is open sky
fn vol(p: vec3f) -> vec2f {
  let v = textureSampleLevel(tV, sC, (p - vec3f(${OX}., ${OY}., ${OZ}.)) / vec3f(${NX}., ${NY}., ${NZ}.), 0.).rg;
  return mix(vec2f(1.), v, nearK(p));
}
fn amb(n: vec3f, sky: f32) -> vec3f {
  let up = n.y * .5 + .5;
  return (AMBK * up * up + AMBG * .36 * (1. - up) + AMBF + CITYG * .05 * (1. - up)) * (.3 + .7 * sky);
}
fn aerial(c: vec3f, wp: vec3f) -> vec3f { return aerialAt(c, g.cam.xyz, wp, g.sun.xyz); }
`;
// ---------------------------------------------------------------- solids: terrain, rocks, the path, buildings
// instance c: x material, y seed, z distance at which the mesh has shrunk away (0 = never), w building height
// clock hands per time: dawn 5:50, golden hour 17:20, night 20:45
const CLOCKT = [5 + 50 / 60, 5 + 20 / 60, 8 + 45 / 60][TOD], CLOCKY = 418, CLOCKR = 24;
const W_SOLID = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) on: vec3f,
  @location(4) @interpolate(flat) m: vec4f, @location(5) @interpolate(flat) q: vec4f, @location(6) ao: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  var sc = i.a.w;
  if (i.c.z > .5 && g.res.x > 0.) { sc *= 1. - ss(i.c.z * .7, i.c.z, distance(i.a.xyz, g.cam.xyz) / g.mis.z); }
  let lp = i.p * sc;
  let w = i.a.xyz + qrot(i.b, lp);
  let mt = i.c.x;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = qrot(i.b, i.n.xyz);
  o.op = select(select(lp + i.c.y * 37., lp, mt > 4.5), w, mt < 1.5); o.on = i.n.xyz;
  o.m = i.c; o.q = i.b; o.ao = i.n.w;
  return o;
}
struct TP { h: f32, c: f32, n: vec3f };
fn tri(p: vec3f, n: vec3f, s: f32) -> TP {
  var w = pow(abs(n), vec3f(4.)); w /= (w.x + w.y + w.z);
  let x = textureSample(tD, sR, p.zy * s); let y = textureSample(tD, sR, p.xz * s); let z = textureSample(tD, sR, p.xy * s);
  var o: TP;
  o.h = x.b * w.x + y.b * w.y + z.b * w.z;
  o.c = x.a * w.x + y.a * w.y + z.a * w.z;
  let a = x.rg * 2. - 1.; let b = y.rg * 2. - 1.; let c = z.rg * 2. - 1.;
  o.n = vec3f(0., a.y, a.x) * w.x + vec3f(b.x, 0., b.y) * w.y + vec3f(c.x, c.y, 0.) * w.z;
  return o;
}
// pointed-arch arcade on facades: bay width bw, opening height ah; returns 1 inside an opening
fn arcade(u: f32, v: f32, bw: f32, ah: f32, v0: f32) -> f32 {
  let x = (fract(u / bw) - .5) * bw; let hw = bw * .36;
  let y = v - v0;
  let top = ah + hw * 1.15 * sqrt(max(1. - (x / hw) * (x / hw), 0.)) - abs(x) * .35;
  return step(abs(x), hw) * step(0., y) * step(y, top);
}
fn segDist(p: vec2f, b: vec2f) -> f32 { let h = clamp(dot(p, b) / dot(b, b), 0., 1.); return length(p - b * h); }
// granite: dark weathered stone with rust stains, desert varnish on steep faces, pale dust on ledges
fn granite(A: TP, B: TP, C: TP, Lg: vec4f, flt: f32, k: f32) -> vec3f {
  var a = mix(vec3f(.105, .088, .074), vec3f(.205, .17, .142), sat(A.c * .9 + Lg.a * .9 - .55 + k)) * (.7 + .45 * mix(B.h, Lg.b, .45)) * (.84 + .32 * C.c);
  a = mix(a, vec3f(.27, .16, .10) * (.8 + .4 * B.h), ss(.55, .85, Lg.a + .25 * A.h - .1) * .35);
  a *= .75 + .5 * ss(.2, .8, A.h);
  a *= mix(1., .7, (1. - flt) * ss(.4, .75, B.c + .2 * C.h));
  return a;
}
@fragment fn fs(i: VO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let mat = i32(i.m.x + .5); let sd = i.m.y; let fl_ = select(select(-1., 1., ff), 1., mat == 1);
  let on = normalize(i.on) * fl_; let n0 = normalize(i.n) * fl_;
  let dist = length(i.wp - g.cam.xyz);
  let far = mat == 1;
  let ts = select(select(1., mix(1., .035, ss(250., 2500., dist)), far), .5, mat >= 5);
  let A = tri(i.op, on, .07 * ts); let B = tri(i.op, on, .31 * ts); let C = tri(i.op, on, 1.3 * ts); let F = tri(i.op, on, 5.1 * ts);
  let fk = ss(14., 2., dist) * f32(mat <= 4);
  let Lg = textureSample(tD, sR, i.wp.xz * .0045 + .31);
  let nm = textureSample(tN, sC, i.wp.xz / ${NX}. + .5);
  let fm = textureSample(tF, sC, i.wp.xz / 24000. + .5);
  var bump = 1.2; var gloss = .08; var alb = vec3f(.5); var emi = vec3f(0.); var metal = 0.; var vao = 1.;
  let flt = ss(.7, .92, n0.y);
  let nk = nearK(i.wp);
  // facade coordinates for building materials: along the wall and up it
  let fu = select(i.op.z, i.op.x, abs(on.z) > abs(on.x)); let fv = i.op.y; let wall = 1. - ss(.45, .7, abs(on.y));
  // window grid fades before it can sparkle (derivatives must be taken outside the material branches)
  let wfade = 1. - ss(.25, .6, fwidth(fu / 3.4) + fwidth(fv / 3.3));
  let cfw = fwidth(fu) + fwidth(fv);
  if (mat == 11) { return fin(aerial(vec3f(.0015, .0012, .001), i.wp)); }
  if (mat <= 1) {
    let rock = mix(fm.r, nm.g, nk); let grav = mix(fm.g, nm.r, nk); let city = fm.b * (1. - nk);
    let plaza = ss(.75, .9, fm.a) * (1. - nk); let road = ss(.3, .45, fm.a) * (1. - plaza) * (1. - nk);
    alb = granite(A, B, C, Lg, flt, 0.) * select(1., mix(.78, 1., ss(3000., 9000., dist)), far);
    alb = mix(alb, vec3f(.30, .25, .20) * (.85 + .3 * C.h), sat(max(flt * ss(.6, .85, Lg.a + .3 * B.c) * select(.3, .12, far), grav * (.15 + .35 * flt))) * rock);
    alb *= mix(1., .6 + .8 * F.h, fk);
    let street = mix(vec3f(.14, .135, .13) * (.9 + .15 * C.c), vec3f(.26, .24, .21) * (.9 + .12 * B.c), ss(.5, .75, Lg.a));
    alb = mix(alb, street * (.9 + .2 * B.h), ss(.05, .3, city));
    alb = mix(alb, vec3f(.13, .13, .14) * (.9 + .2 * B.c), road * .85);
    let tile = 1. - ss(.0, .05, min(abs(fract(i.wp.x / 6.) - .5), abs(fract(i.wp.z / 6.) - .5)) * 2. - .86);
    alb = mix(alb, vec3f(.86, .85, .82) * (1. - .1 * tile), plaza);
    emi = vec3f(1., .85, .7) * .04 * LIGHTS * plaza;
    bump = select(1.3, mix(mix(.6, .3, ss(800., 4000., dist)), .15, ss(.05, .3, city)), far); gloss = .04;
  } else if (mat == 2 || mat == 3) {
    alb = granite(A, B, C, Lg, flt, select(-.05, .12, mat == 3)) * (.75 + .5 * hs(sd * 7.));
    bump = 1.5; gloss = .05;
  } else if (mat == 4) {
    alb = mix(vec3f(.26, .21, .17), vec3f(.18, .15, .12), hs(sd * 91.)) * (.75 + .4 * B.h); bump = .6; gloss = .06;
  } else if (mat == 5) {
    // concrete steps: pale treads worn smooth in the middle, darker risers, dust in the corners
    let top = ss(.6, .85, on.y);
        let jn = max(ss(.88, .97, abs(fract(i.wp.x / .6 + hs(floor(i.wp.z / .6)) * .5) - .5) * 2.), ss(.88, .97, abs(fract(i.wp.z / .6) - .5) * 2.)) * top * wfade;
    let cell = floor(i.wp.xz / .6) + floor(i.wp.y / .17) * 7.;
    alb = mix(vec3f(.24, .19, .14), vec3f(.34, .27, .19), top) * (.82 + .3 * hs(cell.x * 3.1 + cell.y * 1.7)) * (.85 + .25 * B.h) * (.92 + .12 * C.c) * (1. - .15 * jn);
    alb = mix(alb, vec3f(.46, .38, .29), ss(.5, .8, Lg.a + .25 * B.c) * .45);
    bump = .12; gloss = .05;
  } else if (mat == 6) {
    // low walls of rough-cut stone laid in courses, lime mortar, a cement coping on top
    let row = floor(fv / .32); let bx = fract(fu / .62 + row * .5); let by = fract(fv / .32);
    let mortar = (1. - ss(.0, .12, by) * ss(1., .88, by)) * .6 + (1. - ss(.0, .08, bx) * ss(1., .92, bx)) * .5;
    let hh = hs(row * 7.1 + floor(fu / .62 + row * .5));
    alb = mix(mix(vec3f(.26, .22, .18), vec3f(.34, .29, .24), hh), vec3f(.21, .18, .15), step(.8, hh)) * (.8 + .35 * C.h);
    alb = mix(alb, vec3f(.50, .47, .42), sat(mortar) * .6 * wall);
    alb = mix(alb, vec3f(.30, .26, .21) * (.85 + .2 * B.h), ss(.6, .85, on.y));
    bump = .5;
  } else if (mat == 7 || mat == 14 || mat == 17) {
    // the Haram's white stone (7), the clock tower's stone (14), the city (17) with windows by floor
    let hh = hs(sd * 3.7);
    let ct = select(select(select(select(select(vec3f(.56, .47, .36), vec3f(.44, .40, .35), hh > .22), vec3f(.62, .61, .58), hh > .45), vec3f(.50, .36, .26), hh > .66), vec3f(.38, .37, .36), hh > .8), vec3f(.60, .53, .42), hh > .92);
    let tone = select(select(vec3f(.88, .87, .84), vec3f(.66, .62, .55), mat == 14), ct, mat == 17);
    alb = tone * (.86 + .2 * B.h) * (.94 + .1 * C.c) * select(1., .82, mat == 17);
    if (mat != 7) {
      let bw = select(mix(2.6, 4.6, hs(sd * 11.)), 3.2, mat == 14); let ww = select(mix(.18, .34, hs(sd * 13.)), .3, mat == 14);
      let wx = fract(fu / bw); let wy = fract(fv / 3.3); let flr = floor(fv / 3.3); let bay = floor(fu / bw);
      let top = i.m.w - 1.;
      let win = step(.5 - ww, wx) * step(wx, .5 + ww) * step(.3, wy) * step(wy, .74) * step(1., flr) * wall * step(fv, top) * wfade * step(.15, hs(bay * 3.1 + flr * 5.7 + sd));
      let litF = select(select(.07, .14, LIGHTS > .5), .38, NIGHT);
      let lit = step(1. - litF, hs(flr * 13.1 + bay * 7.7 + sd * 31.));
      alb = mix(alb, vec3f(.05, .055, .06), win * .85);
      alb *= 1. - .1 * ss(.06, .0, abs(fract(fv / 3.3))) * wall * step(1., flr) * wfade;
      alb *= mix(.82, 1., ss(0., 6., fv));
      alb = mix(alb, alb * vec3f(.6, .58, .56), (1. - wfade) * wall * .4);
      let wc = mix(vec3f(1., .62, .30), vec3f(1., .9, .78), step(.6, hs(bay * 1.7 + sd * 5.)));
      emi = wc * .9 * LIGHTS * (win * lit + (1. - wfade) * wall * step(3.3, fv) * step(fv, top) * litF * .07);
      alb = mix(alb, mix(mix(vec3f(.22, .21, .20), vec3f(.44, .39, .33), hs(sd * 41.)), vec3f(.58, .55, .5), step(.82, hs(sd * 23.))) * (.85 + .3 * B.h), ss(.6, .9, on.y));
      gloss = mix(.08, .55, win);
    } else {
      let a1 = arcade(fu, fv, 6.5, 8.5, 1.) * wall;
      let a1i = arcade(fu, fv + .25, 6.5 * .86, 8., 1.) * wall;
      let a2 = arcade(fu + 3.25, fv, 6.5, 2.4, 12.6) * wall * step(fv, 26.);
      let inner = mix(vec3f(.36, .32, .28), vec3f(.10, .09, .08), ss(.6, 10., fv));
      alb = mix(alb, inner, a1i * step(.5, i.m.w));
      alb = mix(alb, vec3f(.06, .06, .07), a2 * .9 * step(.5, i.m.w));
      let band = ss(.92, .97, fract(fv / 16.6)) * wall;
      alb = mix(alb, alb * vec3f(.92, .86, .76), band * .6);
      emi = vec3f(1., .92, .8) * LIGHTS * (.10 * a1i + .12 * a2) * step(.5, i.m.w) + alb * LIGHTS * .035 * f32(NIGHT);
      gloss = mix(.1, .5, a2);
    }
    bump = .04;
  } else if (mat == 8) {
    // the clock: white dial, hour marks, black hands, a green frame; lit at night
    let u = select(select(i.op.z, -i.op.z, on.x > 0.), select(-i.op.x, i.op.x, on.z > 0.), abs(on.z) > abs(on.x));
    let p = vec2f(u, i.op.y - ${CLOCKY}.) / ${CLOCKR}.; let r = length(p);
    let aa = cfw / ${CLOCKR}. + .004;
    let dial = 1. - ss(.97 - aa, .97 + aa, r);
    let ang = atan2(p.x, p.y) / TAU * 12.;
    let tick = (1. - ss(.04, .04 + aa * 6., abs(fract(ang + .5) - .5))) * ss(.78, .8, r) * ss(.93, .91, r);
    let th = ${(CLOCKT / 12 * Math.PI * 2).toFixed(4)}; let tm = ${(CLOCKT % 1 * Math.PI * 2).toFixed(4)};
    let hand = max(1. - ss(.035, .035 + aa, segDist(p, vec2f(sin(th), cos(th)) * .5)), 1. - ss(.022, .022 + aa, segDist(p, vec2f(sin(tm), cos(tm)) * .78)));
    let face = mix(vec3f(.86, .87, .84), vec3f(.05), max(tick, hand));
    alb = mix(vec3f(.10, .32, .20), face, dial);
    emi = (mix(vec3f(.05, .9, .25) * .25, vec3f(1., 1., .96) * .5 * (1. - max(tick, hand)), dial)) * LIGHTS * (.5 + .5 * f32(NIGHT));
    gloss = .3; bump = 0.;
  } else if (mat == 9) {
    alb = vec3f(.15, .17, .15) * (.85 + .3 * B.h); gloss = .18; metal = .1; bump = .1;
  } else if (mat == 10) {
    alb = vec3f(1., .70, .28); gloss = .9; metal = 1.; bump = 0.;
    emi = vec3f(1., .75, .35) * .12 * LIGHTS * f32(NIGHT);
  } else if (mat == 12) {
    alb = vec3f(.74, .74, .72) * (.92 + .1 * B.h); gloss = .15; bump = .1;
  } else if (mat == 13) {
    // the Kaaba: black cloth with a plain gold band
    let band = step(9., fv) * step(fv, 10.2) * wall;
    alb = mix(vec3f(.016, .016, .018), vec3f(.55, .42, .16), band); gloss = mix(.05, .6, band); bump = 0.;
  }
  let N = normalize(qrot(i.q, normalize(on + (A.n * .8 + B.n * .6 * select(1., 0., far) + C.n * .4 * ss(70., 10., dist) * select(1., 0., far) + F.n * .5 * fk) * bump)));
  let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  let vv = vol(i.wp + n0 * 1.2); let v2 = vol(i.wp + n0 * 4.);
  var ao = (sat((vv.x - .5) * 6.) * .5 + sat((v2.x - .5) * 2.5) * .5) * vao * mix(1., i.ao, f32(mat == 1));
  ao = mix(ao, vao * select(1., .7 + .3 * i.ao, far), 1. - nk);
  ao = select(ao, .5 + .5 * ao, mat >= 5);
  ao = select(ao, .25 + .75 * ao, mat == 2 || mat == 3);
  var sh = select(shadow9(i.wp + n0 * (.45 + dist * .003) + g.sun.xyz * .25), sat(i.ao * 1.6 - .3), far);
  // far buildings carry the height above which the ranges let the light through
  if (i.m.z < -1000.) { sh *= ss(-3., 3., i.wp.y + i.m.z + 2000.); }
  let E = SUNC * sh;
  let ndl = sat(dot(N, L));
  let am = amb(N, vv.y) * ao;
  var c = alb * (E * ndl + am) + emi;
  let Hh = normalize(V + L);
  let spc = mix(vec3f(.04), alb, metal);
  c += E * spc * pow(sat(dot(N, Hh)), mix(8., 120., gloss)) * gloss * ndl * 4.;
  c += skyCol(reflect(-V, N), L) * ao * spc * gloss * pow(1. - sat(dot(N, V)), 3.) * 1.5;
  return fin(aerialSh(c, g.cam.xyz, i.wp, L, select(1., sh, mat <= 1 || mat >= 7)));
}
`;
// ---------------------------------------------------------------- dry shrubs and thorn bushes
// instance: a = anchor xyz + length, b = yaw, tilt from vertical, half width, height of the anchor above ground,
// c (unorm8) = type, seed1, seed2, bend
const W_LEAF = S_B + /*wgsl*/`
override ROWS: f32 = 4.;
override FAR: f32 = 70.;
struct LI { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) c: vec4f };
struct LO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f,
  @location(3) @interpolate(flat) col: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, i: LI) -> LO {
  var o: LO;
  let u = f32(vi & 1u) * 2. - 1.; let v = f32(vi >> 1u) / (ROWS - 1.);
  let s1 = i.c.y; let s2 = i.c.z;
  let t = g.cam.w; let len = i.a.w; let hA = i.b.w;
  let cy = cos(i.b.x); let sy = sin(i.b.x); let ct = cos(i.b.y); let st = sin(i.b.y);
  let d = vec3f(st * cy, ct, st * sy); let pe = vec3f(ct * cy, -st, ct * sy); let sd = vec3f(-sy, 0., cy);
  let col = mix(vec3f(.20, .19, .13), vec3f(.30, .24, .14), s1);
  let ka = (i.c.w - .2) * 1.5 + .05;
  let sK = sin(ka * v); let cK = cos(ka * v);
  let c = i.a.xyz + len * (d * (sK / ka) + pe * ((1. - cK) / ka));
  let N = normalize(pe * cK - d * sK);
  let cd = distance(i.a.xyz, g.cam.xyz);
  let farK = select((1. - ss(FAR * g.mis.z * .8, FAR * g.mis.z, cd)), 1., g.res.x == 0.);
  let w = i.b.z * pow(max(sin(3.14159 * pow(v, .6)), 0.), .7);
  var p = c + sd * u * w * farK;
  let ph = dot(i.a.xz, vec2f(.071, .043)); let hh = p.y - i.a.y + hA;
  p.x += .03 * hh * sin(t * 1.3 + ph + s2 * 6.); p.z += .03 * hh * cos(t * 1.1 + ph * 1.3);
  o.cp = g.vp * vec4f(p, 1.); o.wp = p; o.n = normalize(-N); o.uv = vec2f(u, v); o.col = col;
  return o;
}
@fragment fn fs(i: LO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var n = normalize(i.n); if (!ff) { n = -n; }
  let L = g.sun.xyz; let vv = vol(i.wp + vec3f(0., .5, 0.));
  let E = SUNC * mix(shadow1(i.wp + L * .4), 1., .25);
  let alb = i.col * mix(.7, 1.1, i.uv.y);
  let am = (amb(n, vv.y) + amb(-n, vv.y) * .4) * (.35 + .65 * sat((vv.x - .5) * 5.));
  let c = E * alb * (max(dot(n, L), 0.) + max(-dot(n, L), 0.) * .3) + alb * am;
  return fin(aerial(c, i.wp));
}
`;

// ---------------------------------------------------------------- birds: flight and flapping in the shader
const W_ANIM = S_B + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f, @location(3) @interpolate(flat) sd: f32 };
@vertex fn vs(i: VI) -> VO {
  var o: VO;
  let s = i.b.x; let h = vec3f(hs(s), hs(s + .37), hs(s + .71));
  let R = i.a.w; let t = g.cam.w;
  let ta = t * i.b.y + i.b.w * 6.3 + (h.x - .5) * (14. / R);
  let ph = i.b.w * 17.;
  let P = i.a.xyz + vec3f(R * cos(ta), 4. * sin(2. * ta + ph), R * .8 * sin(ta));
  let T = normalize(vec3f(-R * sin(ta), 8. * cos(2. * ta + ph), R * .8 * cos(ta))) * sign(i.b.y);
  let S = normalize(cross(vec3f(0., 1., 0.), T)); let Up = cross(T, S);
  let off = S * ((h.y - .5) * 9. + sin(t * .5 + s * 40.) * 1.5) + Up * ((h.z - .5) * 5. + cos(t * .4 + s * 31.) * 1.);
  var l = i.p * i.b.z;
  let au = abs(i.n.w);
  let flap = ss(-.3, .4, sin(t * .45 + s * 23.));
  l.y += sin(t * 13. + s * 50.) * .55 * au * au * i.b.z * flap + au * .12 * i.b.z * (1. - flap);
  let w = P + off + S * l.x + Up * l.y + T * l.z;
  o.cp = g.vp * vec4f(w, 1.); o.wp = w; o.n = S * i.n.x + Up * i.n.y + T * i.n.z; o.op = i.p; o.sd = s;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let n = normalize(i.n); let L = g.sun.xyz; let V = normalize(g.cam.xyz - i.wp);
  var alb = mix(vec3f(.30, .32, .36), vec3f(.48, .49, .52), ss(-.02, .02, i.op.y));
  alb = mix(alb, vec3f(.12, .13, .15), ss(.7, .9, abs(i.op.x)));
  let E = SUNC * shadow1(i.wp);
  var c = alb * (E * (.2 + .8 * sat(dot(n, L))) + amb(n, 1.) * 1.2) + E * pow(sat(dot(n, normalize(V + L))), 20.) * .2;
  return fin(aerial(c, i.wp));
}
`;

// ---------------------------------------------------------------- sky dome behind everything
// stars sit on a fixed grid of directions with a size of at least one pixel, so they never sparkle under motion
const W_SKY = S_B + W_NOISE + /*wgsl*/`
const STARS = ${TP.stars.toFixed(3)};
const CIRRUS = ${v3(TP.cirrus)};
struct VO { @builtin(position) cp: vec4f, @location(0) d: vec3f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var o: VO;
  let p = vec2f(f32(i & 1u), f32(i >> 1u)) * 2. - 1.;
  o.d = g.fwd.xyz + g.right.xyz * (p.x * g.right.w) + g.up.xyz * (p.y * g.up.w);
  o.cp = vec4f(p, 1e-9, 1.);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let rd = normalize(i.d); let L = g.sun.xyz; let mu = dot(rd, L);
  var c = skyCol(rd, L);
  if (rd.y > .004 && CIRRUS.x > 0.) {
    let q = rd.xz / rd.y * 6000.;
    let r = vec2f(q.x * .96 + q.y * .28, q.y * .96 - q.x * .28) * vec2f(.00011, .00042) + vec2f(g.cam.w * .002, 0.);
    let n = fbm(vec3f(r, 1.3), 5) + .35 * (fbm(vec3f(r * 3.1, 4.1), 3) - .5);
    let cov = ss(.6, .86, n) * ss(.03, .2, rd.y) * (1. - ss(.35, .9, rd.y));
    let lit = mix(CIRRUS * .5, CIRRUS, pow(max(mu, 0.), 3.)) * (.75 + .5 * fbm(vec3f(r * 7., 2.), 2));
    c = mix(c, lit, cov * .45);
  }
  if (STARS > 0.) {
    let px = 2. * g.up.w * g.res.w;
    let k = rd * 90.; let cell = floor(k);
    let h = fract(sin(vec3f(dot(cell, vec3f(127.1, 311.7, 74.7)), dot(cell, vec3f(269.5, 183.3, 246.1)), dot(cell, vec3f(113.5, 271.9, 124.6)))) * 43758.5453);
    let sp = normalize(cell + .2 + .6 * h);
    let ang = length(rd - sp);
    let b = pow(fract(h.x * 17.3 + h.y * 5.1), 14.);
    let rad = max(px * .9, .0004);
    let st = exp(-ang * ang / (rad * rad)) * b * (px * .9 / rad) * (px * .9 / rad);
    let col = mix(vec3f(.75, .85, 1.), vec3f(1., .9, .75), h.z);
    c += col * st * .25 * STARS * ss(.02, .25, rd.y) * select(ss(.25, .8, rd.y), 1., NIGHT);
  }
  if (NIGHT) {
    // the moon: a disc with soft maria and a faint halo
    let md = acos(clamp(mu, -1., 1.));
    let mr = .0085;
    let disc = 1. - ss(mr * .92, mr, md);
    let mp = (rd - L * mu) / mr;
    let mar = .78 + .22 * ss(.35, .65, fbm(mp * 2.2 + 3., 3));
    c += vec3f(1., .97, .9) * 1.6 * disc * mar + vec3f(.10, .11, .14) * .25 * exp(-md * 18.);
  } else {
    c += SUNC * 5. * ss(.99988, .99994, mu);
  }
  return fin(c);
}
`;

// ---------------------------------------------------------------- dust motes (additive)
const W_SPR = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) pr: vec4f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.; let t = g.cam.w;
  let B = 26.;
  var p = a.xyz * B + vec3f(t * .25, t * .03, t * .09) + .4 * vec3f(sin(t * .3 + a.x * 60.), sin(t * .23 + a.y * 50.), cos(t * .27 + a.z * 70.));
  p = g.cam.xyz + (fract((p - g.cam.xyz) / B + .5) - .5) * B;
  let d = length(p - g.cam.xyz);
  let sz = .006 + .02 * a.w * a.w * a.w;
  let w = p + (g.right.xyz * q.x + g.up.xyz * q.y) * max(sz, d * .0016);
  o.cp = g.vp * vec4f(w, 1.); o.uv = q;
  let fade = ss(B * .5, B * .3, d) * ss(.4, 2., d) * min(1., sz / (d * .0016)) * .08;
  let mu = dot(normalize(p - g.cam.xyz), g.sun.xyz);
  let ph = .15 + 2.2 * pow(max(mu, 0.), 6.);
  o.pr = vec4f(fade * ph * shadow1(p), a.w, 0., 0.);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let m = ss(1., .15, length(i.uv));
  return vec4f(min(SUNC * mix(vec3f(1.), vec3f(1., .9, .6), i.pr.y) * m * m * i.pr.x * .9, vec3f(6.)), 0.);
}
`;

// ---------------------------------------------------------------- city lamps (additive, dawn and night)
// one sprite per street light; never smaller than a pixel and dimmed in proportion when it would be, so the far
// city reads as a steady field of lights instead of sparkling
const W_LAMP = S_B + /*wgsl*/`
struct VO { @builtin(position) cp: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) c: vec3f };
@vertex fn vs(@builtin(vertex_index) vi: u32, @location(0) a: vec4f) -> VO {
  var o: VO; let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2. - 1.;
  let d = distance(a.xyz, g.cam.xyz);
  let px = 2. * g.up.w * g.res.w * d * 1.4;
  let sz = max(.9, px);
  let w = a.xyz + (g.right.xyz * q.x + g.up.xyz * q.y) * sz;
  o.cp = g.vp * vec4f(w, 1.); o.uv = q;
  let k = (.9 / sz) * (.9 / sz);
  let hue = fract(a.w * 7.31);
  var col = select(vec3f(1., .55, .22), vec3f(1., .88, .72), hue > .55) * mix(.6, 1.4, fract(a.w * 3.7));
  col = col * select(1., 2.5, a.w > .985);
  o.c = aerialAt(col * 7. * LIGHTS * k, g.cam.xyz, a.xyz, g.sun.xyz) - aerialAt(vec3f(0.), g.cam.xyz, a.xyz, g.sun.xyz);
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let r = length(i.uv); let m = exp(-r * r * 4.) * step(r, 1.);
  return vec4f(max(i.c, vec3f(0.)) * m, 0.);
}
`;

// ---------------------------------------------------------------- sun shafts in the mountain air (half res)
const W_RAYS = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sS: sampler_comparison;
@group(0) @binding(2) var tSh: texture_depth_2d;
@group(0) @binding(3) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let dp = textureLoad(tDp, vec2i(fc.xy) * 2, 0);
  let uv = fc.xy * 2. * g.res.zw;
  let nd = vec2f(uv.x * 2. - 1., 1. - uv.y * 2.);
  let rv = g.fwd.xyz + g.right.xyz * (nd.x * g.right.w) + g.up.xyz * (nd.y * g.up.w);
  let rl = length(rv); let rd = rv / rl;
  let zl = g.fwd.w / max(dp, 1e-6);
  let tm = min(zl * rl, 220.);
  let ro = g.cam.xyz; let sx = g.sun.xyz;
  let dt = tm / ${RAYN}.;
  let j = ign(fc.xy);
  var acc = 0.;
  for (var n = 0; n < ${RAYN}; n++) {
    let t = (f32(n) + j) * dt;
    let p = ro + rd * t;
    let s = g.sm * vec4f(p, 1.);
    let inb = 1. - ss(NEARH - 12., NEARH - 2., max(abs(p.x), abs(p.z)));
    let vis = mix(1., textureSampleCompareLevel(tSh, sS, vec2f(s.x * .5 + .5, .5 - s.y * .5), s.z - .0004), inb);
    acc += vis * .5 * exp(-t * .004);
  }
  let mu = dot(rd, sx);
  let gg = .72;
  let ph = (1. - gg * gg) / pow(1. + gg * gg - 2. * gg * mu, 1.5) * .07 + .1;
  return vec4f(min(SUNC * vec3f(1., .84, .62) * acc * dt * .015 * ph * g.mis.y, vec3f(20.)), zl);
}
`;
// depth-aware 3x3 blur of the half-res shafts (hides the sampling dither)
const W_RBLUR = W_FS + /*wgsl*/`
@group(0) @binding(0) var tR: texture_2d<f32>;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let p = vec2i(fc.xy); let mx = vec2i(textureDimensions(tR)) - 1;
  let c = textureLoad(tR, p, 0);
  var acc = vec3f(0.); var ws = 0.;
  for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let r = textureLoad(tR, clamp(p + vec2i(x, y), vec2i(0), mx), 0);
    let w = 1. / (.03 + abs(r.a - c.a) / c.a);
    acc += r.rgb * w; ws += w;
  } }
  return vec4f(acc / ws, c.a);
}
`;

// ---------------------------------------------------------------- final composite
const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var sC: sampler;
@group(0) @binding(2) var tS: texture_2d<f32>;
@group(0) @binding(3) var tR: texture_2d<f32>;
@group(0) @binding(4) var tB: texture_2d<f32>;
@group(0) @binding(5) var tDp: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
const BLOOM = ${TP.bloom.toFixed(3)};
fn tmap(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), vec3f(0.), vec3f(1.)); }
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let px = vec2i(fc.xy);
  let uv = fc.xy * g.res.zw;
  let zf = g.fwd.w / max(textureLoad(tDp, px, 0), 1e-6);
  let h = fc.xy * .5 - .5; let b = floor(h); let f = h - b; let bi = vec2i(b);
  let mx = vec2i(textureDimensions(tR)) - 1;
  var acc = vec3f(0.); var ws = 0.;
  for (var k = 0; k < 4; k++) {
    let o = vec2i(k & 1, k >> 1);
    let r = textureLoad(tR, clamp(bi + o, vec2i(0), mx), 0);
    let bw = mix(1. - f.x, f.x, f32(o.x)) * mix(1. - f.y, f.y, f32(o.y));
    let w = (bw + .02) / (.02 + abs(r.a - zf) / zf);
    acc += r.rgb * w; ws += w;
  }
  var c = textureLoad(tS, px, 0).rgb + acc / ws;
  let bl = textureSampleLevel(tB, sC, uv, 0.).rgb;
  c = mix(c, bl, .025 * BLOOM) + bl * .012 * BLOOM;
  c *= g.mis.x;
  let q = uv - .5;
  c *= 1. - dot(q, q) * .45;
  c = tmap(c);
  let l0 = dot(c, vec3f(.2126, .7152, .0722));
  let l = mix(l0, l0 * l0 * (3. - 2. * l0), .4);
  c *= l / max(l0, 1e-4);
  c = mix(vec3f(l), c, 1.04) + vec3f(.006, .003, 0.) * select(1., .3, NIGHT);
  c = pow(max(c, vec3f(0.)), vec3f(1. / 2.2));
  let n = ign(fc.xy) + ign(fc.xy + 37.) - 1.;
  return vec4f(c + n / 255., 1.);
}
`;
