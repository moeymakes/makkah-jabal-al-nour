// ============================================================================
// renderer, camera and input (structure follows Abyssal Garden, MIT)
// ============================================================================
const $ = (id) => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
let loaded = 0, dead;
// loading bar: each stage glides it on the compositor, so it keeps moving while this thread is busy
const say = (m, to, ms) => {
  if (!dead) $('s').textContent = m;
  const a = $('b').animate({ transform: [`scaleX(${loaded})`, `scaleX(${to})`] }, { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.5,.5,1)' });
  loaded = to;
  return new Promise((r) => { a.ready.then(() => setTimeout(r)); setTimeout(r, document.hidden ? 0 : 1e3); });
};
const fail = (m) => { throw new Error(m, { cause: 1 }); };
if (!navigator.gpu) fail('This scene needs WebGPU. Open it in a current Chrome or Edge on a desktop or laptop.');
// some drivers (headless Linux Chrome among them) answer null to a high-performance request but give the GPU
// to a plain one
const adapter = (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) || (await navigator.gpu.requestAdapter());
if (!adapter) fail('WebGPU is switched off or unavailable here. Open it in Chrome or Edge on a desktop or laptop with graphics acceleration turned on.');
$('w').hidden = !!navigator.userAgentData;
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [], requiredLimits: { maxStorageBufferBindingSize: min(adapter.limits.maxStorageBufferBindingSize, 1 << 28), maxBufferSize: min(adapter.limits.maxBufferSize, 1 << 28) } });
device.addEventListener('uncapturederror', (e) => console.error('GPU: ' + e.error.message));
device.lost.then((l) => {
  if (l.reason === 'destroyed') return;
  if (LV < 2) { keep('nour', LV + 1); location.reload(); }
  dead = body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload the page to try again.';
});
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float';
const TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;
const mod = (code) => device.createShaderModule({ code });
const buf = (data, usage) => { const b = device.createBuffer({ size: max(4, (data.byteLength + 3) & ~3), usage: usage | BU.COPY_DST }); if (data.byteLength) Q.writeBuffer(b, 0, data.buffer || data, data.byteOffset || 0, data.byteLength); return b; };
const tex = (w, h, format, usage, o = {}) => device.createTexture({ size: [w, h, o.d || 1], format, usage, mipLevelCount: o.mips || 1, sampleCount: o.samples || 1, dimension: o.d ? '3d' : '2d' });

// ---------------------------------------------------------------- static resources
const sRep = device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: LV > 1 ? 1 : 8 });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const sCmp = device.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });
const tShadow = tex(SHADOW, SHADOW, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDummy = tex(1, 1, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
const tDetail = tex(1024, 1024, 'rgba8unorm', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { mips: 11 });
const tVol = tex(NX / 2, NY / 2, 'rg8unorm', TU.TEXTURE_BINDING | TU.COPY_DST, { d: NZ / 2 });
const tNear = tex(NX, NZ, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);
const tFar = tex(FN, FN, 'rgba8unorm', TU.TEXTURE_BINDING | TU.COPY_DST);
const tLit = tex(NX / 2, NZ / 2, 'r32float', TU.TEXTURE_BINDING | TU.COPY_DST);

const UB = new Float32Array(60), UBS = new Float32Array(60);
const ubo = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST }), uboS = device.createBuffer({ size: 240, usage: BU.UNIFORM | BU.COPY_DST });
const VF = SS.VERTEX | SS.FRAGMENT;
const bgl0 = device.createBindGroupLayout({ entries: [
  { binding: 0, visibility: VF, buffer: {} },
  { binding: 1, visibility: VF, sampler: {} }, { binding: 2, visibility: VF, sampler: {} }, { binding: 3, visibility: VF, sampler: { type: 'comparison' } },
  { binding: 4, visibility: VF, texture: { sampleType: 'depth' } }, { binding: 5, visibility: VF, texture: {} },
  { binding: 6, visibility: VF, texture: { viewDimension: '3d' } }, { binding: 7, visibility: VF, texture: {} }, { binding: 8, visibility: VF, texture: {} }, { binding: 9, visibility: VF, texture: { sampleType: 'unfilterable-float' } }] });
const mkBG0 = (u, sh) => device.createBindGroup({ layout: bgl0, entries: [
  { binding: 0, resource: { buffer: u } }, { binding: 1, resource: sRep }, { binding: 2, resource: sClamp }, { binding: 3, resource: sCmp },
  { binding: 4, resource: sh.createView() }, { binding: 5, resource: tDetail.createView() }, { binding: 6, resource: tVol.createView() },
  { binding: 7, resource: tNear.createView() }, { binding: 8, resource: tFar.createView() }, { binding: 9, resource: tLit.createView() }] });
const bg0 = mkBG0(ubo, tShadow), bg0s = mkBG0(uboS, tDummy);
const pl0 = device.createPipelineLayout({ bindGroupLayouts: [bgl0] });

const bglBlit = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const plBlit = device.createPipelineLayout({ bindGroupLayouts: [bglBlit] });
const mBlit = mod(W_BLIT);
const blitPipe = (entry, format, add) => device.createRenderPipeline({ layout: plBlit, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pMip8 = blitPipe('fsMip', 'rgba8unorm'), pDown0 = blitPipe('fsDown0', HDR), pDown = blitPipe('fsDown', HDR), pUp = blitPipe('fsUp', HDR, true);
const blitBG = (view) => device.createBindGroup({ layout: bglBlit, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
const colorAtt = (view, clear) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 0] });

const A = (shaderLocation, offset, format) => ({ shaderLocation, offset, format });
const vbSolid = { arrayStride: 16, attributes: [A(0, 0, 'float32x3'), A(1, 12, 'snorm8x4')] };
const ibSolid = { arrayStride: 48, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4'), A(4, 32, 'float32x4')] };
const ibLeaf = { arrayStride: 36, stepMode: 'instance', attributes: [A(0, 0, 'float32x4'), A(1, 16, 'float32x4'), A(2, 32, 'unorm8x4')] };
const ibAnim = { arrayStride: 32, stepMode: 'instance', attributes: [A(2, 0, 'float32x4'), A(3, 16, 'float32x4')] };
const ibMote = { arrayStride: 16, stepMode: 'instance', attributes: [A(0, 0, 'float32x4')] };

const scenePipe = (m, vsE, fsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: { module: m, entryPoint: fsE, targets: [{ format: HDR, blend: o.blend }] },
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !o.blend, depthCompare: 'greater' }, multisample: { count: AA, alphaToCoverageEnabled: !!o.a2c && AA > 1 } });
const shadowPipe = (m, vsE, buffers, o = {}) => device.createRenderPipeline({ layout: pl0,
  vertex: { module: m, entryPoint: vsE, buffers, constants: o.constants },
  fragment: o.fs ? { module: m, entryPoint: o.fs, targets: [] } : undefined,
  primitive: { topology: o.strip ? 'triangle-strip' : 'triangle-list', cullMode: o.cull || 'none' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 3 } });

await say('Preparing the light…', 0.05, 300);
const mSolid = mod(W_SOLID), mLeaf = mod(W_LEAF), mAnim = mod(W_ANIM), mSky = mod(W_SKY), mSpr = mod(W_SPR);
const pTerrain = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid], { cull: 'back' });
const pSolid = scenePipe(mSolid, 'vs', 'fs', [vbSolid, ibSolid]);
const pGrass = scenePipe(mLeaf, 'vs', 'fs', [ibLeaf], { strip: true, constants: { ROWS: 4, FAR: 70 } });
const pBird = scenePipe(mAnim, 'vs', 'fs', [vbSolid, ibAnim]);
const pSky = scenePipe(mSky, 'vs', 'fs', [], { strip: true });
const ADD = { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } };
const pMote = scenePipe(mSpr, 'vs', 'fs', [ibMote], { strip: true, blend: ADD }), pLamp = scenePipe(mod(W_LAMP), 'vs', 'fs', [ibMote], { strip: true, blend: ADD });
const pSolidSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid]), pTerrSh = shadowPipe(mSolid, 'vs', [vbSolid, ibSolid], { cull: 'front' });
const mRays = mod(W_RAYS), mPost = mod(W_POST), mRB = mod(W_RBLUR);
const pRB = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRB, entryPoint: 'vs' }, fragment: { module: mRB, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pRays = device.createRenderPipeline({ layout: 'auto', vertex: { module: mRays, entryPoint: 'vs' }, fragment: { module: mRays, entryPoint: 'fs', targets: [{ format: HDR }] } });
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });

// ---------------------------------------------------------------- sun + shadow matrix over the near field
{
  const L = SUN, lr = [L[2], 0, -L[0]], ll = hypot(...lr); lr[0] /= ll; lr[2] /= ll;
  const lu = [L[1] * lr[2] - L[2] * lr[1], L[2] * lr[0] - L[0] * lr[2], L[0] * lr[1] - L[1] * lr[0]];
  const ext = [[1e9, -1e9], [1e9, -1e9], [1e9, -1e9]];
  for (const x of [OX, -OX]) for (const y of [OY, OY + NY]) for (const z of [OZ, -OZ]) {
    const p = [x, y, z];
    [lr, lu, L].forEach((a, k) => { const d = p[0] * a[0] + p[1] * a[1] + p[2] * a[2]; ext[k][0] = min(ext[k][0], d); ext[k][1] = max(ext[k][1], d); });
  }
  const m = UBS, hx = (ext[0][1] - ext[0][0]) / 2, cx = (ext[0][1] + ext[0][0]) / 2, hy = (ext[1][1] - ext[1][0]) / 2, cy = (ext[1][1] + ext[1][0]) / 2;
  const d0 = ext[2][0] - 5, d1 = ext[2][1] + 60, dd = d1 - d0;
  m[0] = lr[0] / hx; m[4] = lr[1] / hx; m[8] = lr[2] / hx; m[12] = -cx / hx;
  m[1] = lu[0] / hy; m[5] = lu[1] / hy; m[9] = lu[2] / hy; m[13] = -cy / hy;
  m[2] = -L[0] / dd; m[6] = -L[1] / dd; m[10] = -L[2] / dd; m[14] = d1 / dd;
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  for (let i = 0; i < 16; i++) { UBS[16 + i] = m[i]; UB[16 + i] = m[i]; }
  for (let i = 0; i < 3; i++) { UB[48 + i] = UBS[48 + i] = SUN[i]; }
  UBS[32] = 0; UBS[33] = 300; UBS[34] = 0; UBS[35] = 0; UBS[58] = 1;
  Q.writeBuffer(uboS, 0, UBS);
}

// ---------------------------------------------------------------- world generation
await say('Raising the mountain…', 0.2, 1000);
keep('nourLoad', 1);
addEventListener('pagehide', () => keep('nourLoad', ''));
// the ground model on the GPU, read back: [height, rock, gravel, valley] and [city, Haram plaza, main road] per grid point
const pGround = device.createComputePipeline({ layout: 'auto', compute: { module: mod(W_GROUND), entryPoint: 'main' } });
async function ground(n, ox, oz, cell, keepA) {
  const u = new ArrayBuffer(32), uu = new Uint32Array(u), uf = new Float32Array(u);
  uu[0] = n; uu[1] = n; uf[4] = ox; uf[5] = oz; uf[6] = cell;
  const size = n * n * 16, bu = buf(new Uint8Array(u), BU.UNIFORM);
  const ba = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), bb = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC });
  const ra = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST }), rb = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(pGround); c.setBindGroup(0, device.createBindGroup({ layout: pGround.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: ba } }, { binding: 2, resource: { buffer: bb } }] }));
  c.dispatchWorkgroups(n / 8, n / 8); c.end();
  e.copyBufferToBuffer(ba, 0, ra, 0, size); e.copyBufferToBuffer(bb, 0, rb, 0, size);
  Q.submit([e.finish()]);
  await Promise.all([ra.mapAsync(GPUMapMode.READ), rb.mapAsync(GPUMapMode.READ)]);
  const out = { A: new Float32Array(ra.getMappedRange().slice(0)), B: new Float32Array(rb.getMappedRange().slice(0)) };
  ra.destroy(); rb.destroy(); bb.destroy();
  if (keepA) out.gpuA = ba; else ba.destroy();
  return out;
}
const NEAR = await ground(NX, OX, OZ, VS, true), MID = await ground(MN, MO, MO, MC, false), FAR = await ground(FN, FO, FO, FC, false);
const fh = groundSampler(NEAR.A, MID.A, FAR.A), PT = makePath(fh);
let D;
{
  const m = mod(W_DENS), p = device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
  const size = NX * NY * NZ * 4;
  const u = new ArrayBuffer(64), uu = new Uint32Array(u), uf = new Float32Array(u);
  // only the part of the path inside the near field (and one point either side) is cut into the rock
  const PP = PT.P.filter((p, i, a) => [a[i - 1], p, a[i + 1]].some((q) => q && max(abs(q[0]), abs(q[2])) < -OX + 8));
  uu[0] = NX; uu[1] = NY; uu[2] = NZ; uu[3] = PP.length; uf[4] = OX; uf[5] = OY; uf[6] = OZ; uf[7] = VS;
  uf.set(PT.cave, 8); uf.set(PT.dir, 12);
  const bu = buf(new Uint8Array(u), BU.UNIFORM), bp = buf(new Float32Array(PP.flatMap((p) => p.slice(0, 4))), BU.STORAGE);
  const bd = device.createBuffer({ size, usage: BU.STORAGE | BU.COPY_SRC }), br = device.createBuffer({ size, usage: BU.MAP_READ | BU.COPY_DST });
  const bg = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: bu } }, { binding: 1, resource: { buffer: bd } }, { binding: 2, resource: { buffer: NEAR.gpuA } }, { binding: 3, resource: { buffer: bp } }] });
  const e = device.createCommandEncoder(), c = e.beginComputePass();
  c.setPipeline(p); c.setBindGroup(0, bg); c.dispatchWorkgroups(NX / 4, NY / 4, NZ / 4); c.end();
  e.copyBufferToBuffer(bd, 0, br, 0, size);
  Q.submit([e.finish()]);
  await br.mapAsync(GPUMapMode.READ);
  D = new Float32Array(br.getMappedRange().slice(0));
  br.unmap(); br.destroy(); bd.destroy(); NEAR.gpuA.destroy();
  // rock not connected to the ground (noise specks floating in the air) becomes air
  const S = NX * NY, R = new Uint8Array(D.length), O = [1, -1, NX, -NX, S, -S], b = new Uint8Array(NX), L = [];
  for (let i = 0; i < D.length;) { b.fill(1); for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++, i++) if (D[i] <= 0) b[x] = 0; else if (b[x]) R[i] = 1; else L.push(i); }
  for (let k = 1; k; L.reverse()) { k = 0; for (const i of L) if (!R[i] && O.some((o) => R[i + o])) R[i] = k = 1; }
  for (const i of L) if (!R[i]) D[i] = -D[i];
}
// distance to the rock for collide(), in 1/127 m (> 0 in rock, clamped to ±1 m), in 4x4x4 bricks near the surface
const CO = 4, CN = (NX - 8) / 4, CI = new Uint16Array(CN * CN * NY / 4);
let CG = new Int8Array(64 * 65534);
{
  let n = 0;
  for (let bz = 0; bz < CN; bz++) for (let by = 1; by < NY / 4 - 1; by++) for (let bx = 0; bx < CN; bx++) {
    let lo = 127, hi = -127;
    for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = CO + bx * 4 + x + NX * (by * 4 + y + NY * (CO + bz * 4 + z)), gz = D[i + NX * NY] - D[i - NX * NY];
      const gx = D[i + 1] - D[i - 1], g = D[i + NX] - D[i - NX], l = sqrt(gx * gx + g * g + gz * gz) / 2;
      const q = round(clamp(D[i] / max(l, 0.05), -1, 1) * 127);
      if (n < 65534) CG[n * 64 + x + 4 * y + 16 * z] = q; if (q < lo) lo = q; if (q > hi) hi = q;
    }
    CI[bx + CN * (by + NY / 4 * bz)] = lo === hi && lo * lo === 16129 ? +(lo > 0) : n < 65533 ? (n++, n + 1) : +(lo > 0);
  }
  CG = CG.slice(0, n * 64);
}
await say('Cutting the steps…', 0.35, 500);
const T = buildTerrain(D);

const POSES = makePoses(PT, fh), FLY = makeFly(PT, fh);
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flyPts = [];
const F = new Float64Array(32), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21, MX = 22, MY = 23, MZ = 24;
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, sqrt(dx * dx + dz * dz));
}
const lookAt = (x, y, z, tx, ty, tz) => { P6[0] = x; P6[1] = y; P6[2] = z; P6[3] = tx; P6[4] = ty; P6[5] = tz; aim(); };
function flyRaw() {
  const s = F[SPL]; let i = floor(s) | 0; if (i > FLYN - 2) i = FLYN - 2;
  const u = s - i, i0 = (i > 0 ? i - 1 : 0) * 6, i1 = i * 6, i2 = (i + 1) * 6, i3 = (i + 2 < FLYN ? i + 2 : FLYN - 1) * 6;
  for (let o = 0; o < 6; o++) {
    const a = FLY[i0 + o], b = FLY[i1 + o], c = FLY[i2 + o], d = FLY[i3 + o];
    P6[o] = 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
  aim();
}
{
  const M = 4096, len = new Float32Array(M + 1); let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= M; k++) { F[SPL] = k / M * (FLYN - 1); flyRaw(); if (k) len[k] = len[k - 1] + hypot(F[CX] - px, F[CY] - py, F[CZ] - pz); px = F[CX]; py = F[CY]; pz = F[CZ]; }
  for (let k = 0, j = 0; k <= LUTN; k++) { const d = k / LUTN * len[M]; while (j < M - 1 && len[j + 1] < d) j++; flyLUT[k] = (j + (d - len[j]) / max(len[j + 1] - len[j], 1e-6)) / M * (FLYN - 1); }
}
function flyAt() {
  let s = F[FLT] / FLYT; s = s < 0 ? 0 : s > 1 ? 1 : s; s = s * s * (3 - 2 * s) * 0.25 + s * 0.75;
  s *= LUTN; let k = floor(s) | 0; if (k > LUTN - 1) k = LUTN - 1;
  F[SPL] = flyLUT[k] + (flyLUT[k + 1] - flyLUT[k]) * (s - k); flyRaw();
}
for (let t = 0; t <= FLYT; t += 0.1) { F[FLT] = t; flyAt(); flyPts.push([F[CX], F[CY], F[CZ]]); }

await say('Scattering the boulders…', 0.7, 2500);
const Wd = makeWorld(D, T, NEAR.A, MID, FAR, flyPts, PT, fh);
for (const p of POSES) if (!p[6]) p[1] += Wd.gy(p[0], p[2]);
await say('Building the city below…', 0.88, 1200);
const far = buildFar(fh);
D = Wd.gy = T.smp = null;
// mesh ids (world.js solid() calls use the same numbers)
const pm = Wd.pm;
const meshes = [meshRock(1, 2, 0), meshRock(7, 2, 0), meshRock(13, 3, 0), meshRock(22, 1, 0), meshRock(31, 1, 0), meshRock(40, 1, 1), meshRock(47, 2, 1), meshRock(55, 0, 0),
  pm.steps, pm.walls, pm.rails, pm.roof, pm.voidM, meshHaram(), meshHaramDomes(), meshMinaret(), meshFinial(1), meshKaaba(), meshClockTower(), meshClockFaces(),
  ...CITY.flatMap((d) => [meshCityBox(...d, 0), meshCityBox(...d, 1)]), meshBird()].map((m) => m.build());
let nV = 0, nI = 0;
for (const m of meshes) { m.v0 = nV; m.i0 = nI; nV += m.nv; nI += m.ib.length; }
const allV = new Uint8Array(nV * 16), allI = new Uint32Array(nI);
for (const m of meshes) { allV.set(new Uint8Array(m.vb), m.v0 * 16); allI.set(m.ib, m.i0); }
const vbMesh = buf(allV, BU.VERTEX), ibMesh = buf(allI, BU.INDEX);
const vbTerrain = buf(new Uint8Array(T.vb), BU.VERTEX), ibTerrain = buf(T.ib, BU.INDEX);
const vbFar = buf(new Uint8Array(far.vb), BU.VERTEX), ibFar = buf(far.ib, BU.INDEX), nFarI = far.ib.length;
const nSolid = Wd.solids.data.length / 12;
const solidData = new Float32Array((nSolid + 2) * 12); solidData.set(Wd.solids.data);
solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], nSolid * 12); solidData.set([0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0], nSolid * 12 + 12);
const ibSolids = buf(solidData, BU.VERTEX);
const ibCell = Wd.cells.map((c) => buf(c.data, BU.VERTEX));
const ibSmall = buf(new Uint8Array(Wd.small.buf), BU.VERTEX);
const ibBirds = buf(Wd.birds, BU.VERTEX), nBirds = Wd.nBirds, ibMotes = buf(Wd.motes, BU.VERTEX), nMotes = Wd.motes.length / 4;
const ibLamps = buf(Wd.lamps, BU.VERTEX), nLamps = Wd.lamps.length / 4, LAMPS = NIGHT || TOD === 0;
const BIRD = meshes[NSOLID];
Q.writeTexture({ texture: tVol }, Wd.volD, { bytesPerRow: NX, rowsPerImage: NY / 2 }, [NX / 2, NY / 2, NZ / 2]);
Q.writeTexture({ texture: tNear }, Wd.nm, { bytesPerRow: NX * 4 }, [NX, NZ]);
Q.writeTexture({ texture: tFar }, Wd.fmap, { bytesPerRow: FN * 4 }, [FN, FN]);
Q.writeTexture({ texture: tLit }, farLit(fh), { bytesPerRow: NX * 2 }, [NX / 2, NZ / 2]);
// mesh distance bands for the near cell stores: boulders, the big tors, rubble, pebbles, round boulders, gravel
const CELLD = [400, 400, 400, 90, 90, 60, 400, 45];

// ---------------------------------------------------------------- one-time bakes: detail texture, shadow map
{
  const m = mod(W_DETAIL), p = device.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
  const e = device.createCommandEncoder();
  let r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: 0, mipLevelCount: 1 }), true)] });
  r.setPipeline(p); r.draw(3); r.end();
  for (let i = 1; i < 11; i++) {
    r = e.beginRenderPass({ colorAttachments: [colorAtt(tDetail.createView({ baseMipLevel: i, mipLevelCount: 1 }), true)] });
    r.setPipeline(pMip8); r.setBindGroup(0, blitBG(tDetail.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }))); r.draw(3); r.end();
  }
  r = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: tShadow.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
  r.setBindGroup(0, bg0s);
  r.setPipeline(pTerrSh);
  r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  r.drawIndexed(T.ib.length, 1, 0, 0, nSolid);
  r.setPipeline(pSolidSh); r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (const i of [8, 9, 10, 11]) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  for (let i = 0; i < 8; i++) if (Wd.cells[i].n && (i < 3 || i === 6 || !LV)) { r.setVertexBuffer(1, ibCell[i]); r.drawIndexed(meshes[i].ib.length, Wd.cells[i].n, meshes[i].i0, meshes[i].v0, 0); }
  r.end();
  Q.submit([e.finish()]);
}
for (const o of [Wd.small, ...Wd.cells]) o.buf = o.data = 0;
Wd.volD = Wd.nm = Wd.fmap = Wd.lamps = T.vb = T.ib = T.wp = T.wn = 0;

// ---------------------------------------------------------------- render targets (rebuilt on resize)
const PIXMAX = 2560 * 1440, PIXMIN = mob ? 25e4 : 5e5, DETMIN = 0.4;
let Wpx = 0, Hpx = 0, DW = 0, DH = 0, pix = +SV[1] || (LV > 1 ? 41e4 : mob ? 1280 * 720 : PIXMAX), det = +SV[2] || 1, dynN = 0, dynT = 0, dynG = 0, dynGN = 0, dynBad = 0, dynOk = 0, dynWait = 3;
let passScene, passRays, passBlur, bgBlur, passPost, bgRays, bgPost, bloomPass = [], bloomBG = [], targets = [];
const NB = 6;
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const s = min(1, sqrt(pix / (DW * DH)));
  // sizes snap to 32-pixel steps so near-identical budgets do not rebuild the targets
  const w = s >= 1 ? DW & ~1 : max(32, round(DW * s / 32) * 32), h = s >= 1 ? DH & ~1 : max(32, round(DH * s / 32) * 32);
  if (w === Wpx && h === Hpx) return;
  dynN = dynG = dynGN = 0; dynT = dynT === -Infinity ? dynT : -300;
  Wpx = w; Hpx = h; canvas.width = Wpx; canvas.height = Hpx;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const tMS = tex(AA > 1 ? Wpx : 1, Hpx, HDR, TU.RENDER_ATTACHMENT, { samples: AA }), tDp = tex(Wpx, Hpx, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, { samples: AA });
  const tRes = tex(Wpx, Hpx, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay = tex(Wpx / 2, Hpx / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), tRay2 = tex(Wpx / 2, Hpx / 2, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  targets = [tMS, tDp, tRes, tRay, tRay2];
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, Wpx >> (i + 1)), max(1, Hpx >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); bl.push(t); targets.push(t); }
  const vDp = tDp.createView(), vRes = tRes.createView(), vRay = tRay.createView(), vRay2 = tRay2.createView(), vBl = bl.map((t) => t.createView());
  passScene = { colorAttachments: [{ view: AA > 1 ? tMS.createView() : vRes, resolveTarget: AA > 1 ? vRes : undefined, loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: vDp, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  passRays = { colorAttachments: [colorAtt(vRay, true)] };
  passBlur = { colorAttachments: [colorAtt(vRay2, true)] };
  bgBlur = device.createBindGroup({ layout: pRB.getBindGroupLayout(0), entries: [{ binding: 0, resource: vRay }] });
  passPost = { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] };
  bgRays = device.createBindGroup({ layout: pRays.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sCmp },
    { binding: 2, resource: tShadow.createView() }, { binding: 3, resource: vDp }] });
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vRes },
    { binding: 3, resource: vRay2 }, { binding: 4, resource: vBl[0] }, { binding: 5, resource: vDp }] });
  bloomPass = []; bloomBG = [];
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i], true)] }); bloomBG.push(blitBG(i ? vBl[i - 1] : vRes)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(vBl[i - 1], false)] }); bloomBG.push(blitBG(vBl[i])); }
  UB[52] = Wpx; UB[53] = Hpx; UB[54] = 1 / Wpx; UB[55] = 1 / Hpx;
}
resize();
addEventListener('resize', resize);

// ---------------------------------------------------------------- timing (GPU timestamp queries)
let qs, qResolve, qRead = [], tsBegin, tsEnd;
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 6; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const o = { b, busy: false, done: null };
    o.done = () => {
      const a = new BigInt64Array(b.getMappedRange());
      const ms = Number(a[1] - a[0]) / 1e6; F[GPU] = ms; b.unmap(); o.busy = false;
      if (dynT > 0 && ms > 0 && ms < 1e3) { dynG += ms; dynGN++; }
    };
    qRead.push(o);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

// ---------------------------------------------------------------- frame
let hud = false, fly = false;
let kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0, hN = 0, hMax = 0, hMin = 1e9, hPer = 1e9, hLate = 0, hTot = 0, tId = -1, tN = 0, tx0 = 0, ty0 = 0, tx = 0, ty = 0;
const TANH = 0.58, NEAR_ = 0.1, EXPO = TP.expo, RAYS = TP.rays;
const submitList = [null];
const rowOrd = new Uint8Array(CELLS);
// draws the cells of a cell-sorted buffer that are in view and within [minD, maxD) (scaled by det, except the
// terrain) as merged runs, nearest rows first
function drawCells(r, start, lo, hi, mar, indexed, verts, minD, maxD) {
  const cx = F[CX], cy = F[CY], cz = F[CZ], fx = F[FX], fy = F[FY], fz = F[FZ], rx = F[RX], rz = F[RZ], ux = F[UX], uy = F[UY], uz = F[UZ];
  const ds = indexed === 1 ? 1 : det * det;
  const tx = TANH * Wpx / Hpx, hw = CELLW * 0.5, ex = hw + mar, min2 = minD * minD * ds, max2 = maxD * maxD * ds;
  for (let k = 0; k < CELLS; k++) {
    const rw = rowOrd[k], row = rw * CELLS, pz = OZ + (rw + 0.5) * CELLW - cz, hz = max(abs(pz) - hw, 0);
    let run = -1;
    for (let x = 0; x <= CELLS; x++) {
      const c = row + x; let v = false;
      if (x < CELLS) {
        const l = lo[c], h = hi[c];
        if (l <= h) {
          const px = OX + (x + 0.5) * CELLW - cx, py = (l + h) * 0.5 - cy, ey = (h - l) * 0.5 + mar, hx = max(abs(px) - hw, 0), h2 = hx * hx + hz * hz;
          if (h2 < max2 && h2 >= min2) {
            const lim = px * fx + py * fy + pz * fz + ex * abs(fx) + ey * abs(fy) + ex * abs(fz);
            if (lim >= 0 && abs(px * rx + pz * rz) - ex * (abs(rx) + abs(rz)) <= lim * tx) v = abs(px * ux + py * uy + pz * uz) - ex * (abs(ux) + abs(uz)) - ey * abs(uy) <= lim * TANH;
          }
        }
      }
      if (v) { if (run < 0) run = c; } else if (run >= 0) {
        const a = start[run], n = start[c] - a;
        if (n > 0) { if (indexed === 1) r.drawIndexed(n * 6, 1, a * 6, 0, nSolid); else if (indexed) r.drawIndexed(indexed.ib.length, n, indexed.i0, indexed.v0, a); else r.draw(verts, n, 0, a); }
        run = -1;
      }
    }
  }
}
function render() {
  const cx = F[CX], cy = F[CY], cz = F[CZ], pitch = F[PIT], yaw = F[YAW];
  const cp = cos(pitch), fy = sin(pitch), rx = cos(yaw), rz = sin(yaw), fx = cp * rz, fz = -cp * rx;
  const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  const asp = Wpx / Hpx, sx = 1 / (TANH * asp), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR_;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[32] = cx; m[33] = cy; m[34] = cz; m[35] = F[TIME];
  m[36] = rx; m[37] = 0; m[38] = rz; m[39] = TANH * asp;
  m[40] = ux; m[41] = uy; m[42] = uz; m[43] = TANH;
  m[44] = fx; m[45] = fy; m[46] = fz; m[47] = NEAR_;
  m[56] = EXPO; m[57] = RAYS; m[58] = det;
  Q.writeBuffer(ubo, 0, UB);

  { let cr = floor((cz - OZ) / CELLW) | 0; cr = cr < 0 ? 0 : cr > CELLS - 1 ? CELLS - 1 : cr; let n = 0; rowOrd[n++] = cr; for (let d = 1; d < CELLS; d++) { if (cr - d >= 0) rowOrd[n++] = cr - d; if (cr + d < CELLS) rowOrd[n++] = cr + d; } }
  const e = device.createCommandEncoder();
  let slot = null;
  if (hasTS) { for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; } }
  passScene.timestampWrites = slot ? tsBegin : undefined;
  passPost.timestampWrites = slot ? tsEnd : undefined;
  let r = e.beginRenderPass(passScene);
  r.setBindGroup(0, bg0);
  r.setPipeline(pTerrain); r.setVertexBuffer(0, vbTerrain); r.setVertexBuffer(1, ibSolids); r.setIndexBuffer(ibTerrain, 'uint32');
  drawCells(r, T.start, T.lo, T.hi, 1.5, 1, 0, 0, 1e4);
  r.setPipeline(pSolid);
  r.setVertexBuffer(0, vbFar); r.setIndexBuffer(ibFar, 'uint32'); r.drawIndexed(nFarI, 1, 0, 0, nSolid + 1);
  r.setVertexBuffer(0, vbMesh); r.setIndexBuffer(ibMesh, 'uint32');
  for (let i = 8; i < NSOLID; i++) { const g = Wd.solids.ranges[i]; if (g[1]) r.drawIndexed(meshes[i].ib.length, g[1], meshes[i].i0, meshes[i].v0, g[0]); }
  for (let i = 0; i < 8; i++) { const c = Wd.cells[i]; if (!c.n) continue; r.setVertexBuffer(1, ibCell[i]); drawCells(r, c.start, c.lo, c.hi, 3, meshes[i], 0, 0, CELLD[i]); }
  if (nBirds) { r.setPipeline(pBird); r.setVertexBuffer(1, ibBirds); r.drawIndexed(BIRD.ib.length, nBirds, BIRD.i0, BIRD.v0, 0); }
  r.setPipeline(pGrass); r.setVertexBuffer(0, ibSmall); drawCells(r, Wd.small.start, Wd.small.lo, Wd.small.hi, 1.5, false, 8, 0, 70);
  r.setPipeline(pSky); r.draw(4);
  if (!NIGHT) { r.setPipeline(pMote); r.setVertexBuffer(0, ibMotes); r.draw(4, nMotes); }
  if (LAMPS) { r.setPipeline(pLamp); r.setVertexBuffer(0, ibLamps); r.draw(4, nLamps); }
  r.end();
  if (RAYS > 0) {
    r = e.beginRenderPass(passRays); r.setPipeline(pRays); r.setBindGroup(0, bgRays); r.draw(3); r.end();
    r = e.beginRenderPass(passBlur); r.setPipeline(pRB); r.setBindGroup(0, bgBlur); r.draw(3); r.end();
  }
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish();
  Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done); }
}

// CS[j] = distance to the rock (metres, < 0 in air) at the body + CE[3j..3j+2]
const CE = new Float64Array([0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375, 0, 0, 0, .375, 0, 0, -.375]), CS = new Float64Array(7);
const cv = (x, y, z) => { const b = CI[(x >> 2) + CN * ((y >> 2) + NY / 4 * (z >> 2))]; return b > 1 ? CG[b * 64 - 128 + (x & 3) + 4 * (y & 3) + 16 * (z & 3)] : b * 254 - 127; };
function sd(j) {
  const x = (F[CX] + CE[j * 3] - OX) / VS - CO, y = (F[CY] + CE[j * 3 + 1] - OY) / VS, z = (F[CZ] + CE[j * 3 + 2] - OZ) / VS - CO;
  const ix = x | 0, iy = y | 0, iz = z | 0, u = x - ix, v = y - iy, a = cv(ix, iy, iz), b = cv(ix, iy + 1, iz), c = cv(ix, iy, iz + 1), d = cv(ix, iy + 1, iz + 1);
  const p = a + (cv(ix + 1, iy, iz) - a) * u, q = b + (cv(ix + 1, iy + 1, iz) - b) * u, r = c + (cv(ix + 1, iy, iz + 1) - c) * u, s = d + (cv(ix + 1, iy + 1, iz + 1) - d) * u;
  const e = p + (q - p) * v; CS[j] = (e + (r + (s - r) * v - e) * (z - iz)) / 127;
}
// moves the body by F[MX..MZ] in steps shorter than its radius, pushing it out of the rock after each step and
// dropping velocity into the rock, so it slides (and stands on the ground)
const CR = 0.5;
let grounded = false;
function collide() {
  const n = floor(sqrt(F[MX] * F[MX] + F[MY] * F[MY] + F[MZ] * F[MZ]) / 0.4) + 1;
  grounded = false;
  for (let i = 0; i < n; i++) {
    F[CX] += F[MX] / n; F[CY] += F[MY] / n; F[CZ] += F[MZ] / n;
    if (abs(F[CX]) > -OX - 10 || abs(F[CZ]) > -OZ - 10 || F[CY] > OY + NY - 6 || F[CY] < OY + 6) continue;
    for (let k = 0; k < 2; k++) {
      sd(0); const s = CS[0] + CR; if (s <= 0) break;
      for (let j = 1; j < 7; j++) sd(j);
      let gx = CS[1] - CS[2], gy = CS[3] - CS[4], gz = CS[5] - CS[6]; const l = sqrt(gx * gx + gy * gy + gz * gz);
      if (l < 0.075) break;
      gx /= l; gy /= l; gz /= l; const vn = F[VX] * gx + F[VY] * gy + F[VZ] * gz;
      F[CX] -= gx * s; F[CY] -= gy * s; F[CZ] -= gz * s;
      if (gy < -.5) grounded = true;
      if (vn > 0) { F[VX] -= gx * vn; F[VY] -= gy * vn; F[VZ] -= gz * vn; }
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dtr = now - F[LAST]; F[LAST] = now;
  let dt = dtr / 1000; if (dt > 0.1) dt = 0.1;
  // dynamic resolution for 60 fps: every 2 s (0.4 s behind the menu) scale the load by k. Every resize rebuilds all
  // render targets (a visible hitch), so small corrections are ignored and upward probes are rare.
  if (dtr < 1e3 && (dynT += dtr) > 0 && (dynN++, dynT > (menu ? 400 : 2000))) {
    const a = dynT / dynN, g = dynGN ? dynG / dynGN : 0; let k = 1;
    if (g) { if (g > 13.6 || g < 9.8) k = 11.7 / g; }
    else if (a > 17.6) { dynOk = 0; if (++dynBad > 1) { k = 15 / a; dynBad = 0; dynWait = min(dynWait * 2, 60); } }
    else { dynBad = 0; if (a < 12.5) k = 15 / a; else if (++dynOk > dynWait * 2) { k = 1.17; dynOk = 0; } }
    if (abs(k - 1) < .12 && !menu) k = 1;
    k = k < 0.5 ? 0.5 : k > 1.7 ? 1.7 : k; const top = min(PIXMAX, DW * DH), mid = max(top / 2, PIXMIN), was = pix + det;
    if (k < 1 ? pix > mid || det <= DETMIN : pix < mid || det >= 1) {
      const end = k < 1 ? (det > DETMIN ? mid : PIXMIN) : det < 1 ? mid : top;
      pix *= k; if (k < 1 ? pix < end : pix > end) pix = end;
    } else { det *= sqrt(k); det = det < DETMIN ? DETMIN : det > 1 ? 1 : det; }
    if (was !== pix + det) keep('nour', [LV, pix < top ? pix | 0 : '', det]);
    dynN = dynT = dynG = dynGN = 0; resize();
  }
  F[TIME] += dt;
  {
    if (tId >= 0) {
      const tr = 4 / (innerWidth < innerHeight ? innerWidth : innerHeight); let jx = (tx - tx0) * tr, jy = (ty - ty0) * tr;
      jx = jx > 1 ? 1 : jx < -1 ? -1 : jx; jy = jy > 1 ? 1 : jy < -1 ? -1 : jy;
      lkx += jx * 1.5 * dt; lky += jy * dt;
    }
    // mouse look through two cascaded low-pass stages
    const kq = 1 - exp(-dt * 30); lkx += mdx * 0.0022; lky += mdy * 0.0022; mdx = 0; mdy = 0;
    const ax = lkx * kq, ay = lky * kq; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyw = l2x * kq, dpt = l2y * kq; l2x -= dyw; l2y -= dpt;
    const yaw = F[YAW] + dyw; let pitch = F[PIT] - dpt; pitch = pitch < -1.5 ? -1.5 : pitch > 1.5 ? 1.5 : pitch;
    const run = ks || tN > 1, mf = tId >= 0 ? 0.7 : kf - kb, mr = kr - kl, cp = cos(pitch), sy = sin(yaw), cw = cos(yaw);
    let vx, vy, vz;
    if (fly) {
      const sp = run ? 48 : 13, k = 1 - exp(-dt * 3), mu = ku - kd;
      vx = F[VX] + ((sy * cp * mf + cw * mr) * sp - F[VX]) * k; vy = F[VY] + ((sin(pitch) * mf + mu) * sp - F[VY]) * k; vz = F[VZ] + ((-cw * cp * mf + sy * mr) * sp - F[VZ]) * k;
    } else {
      const sp = run ? 9 : 3.8, k = 1 - exp(-dt * 7), l = hypot(mf, mr) || 1, f2 = mf / max(l, 1), r2 = mr / max(l, 1);
      vx = F[VX] + ((sy * f2 + cw * r2) * sp - F[VX]) * k; vz = F[VZ] + ((-cw * f2 + sy * r2) * sp - F[VZ]) * k; vy = max(F[VY] - 22 * dt, -40);
    }
    let x = F[CX] + vx * dt, y = F[CY] + vy * dt, z = F[CZ] + vz * dt;
    const lim = fly ? 2600 : 1100, rad = sqrt(x * x + z * z); if (rad > lim) { x *= lim / rad; z *= lim / rad; }
    if (y > 900) y = 900;
    const fl = fh(x, z) + (fly ? 3 : 1.7); if (max(abs(x), abs(z)) > -OX - 12 && y < fl) { y = fl; vy = max(vy, 0); }
    F[YAW] = yaw; F[PIT] = pitch; F[VX] = vx; F[VY] = vy; F[VZ] = vz; F[MX] = x - F[CX]; F[MY] = y - F[CY]; F[MZ] = z - F[CZ];
    // walking: the body is a ball 1.2 m below the eyes; flying: the camera itself
    const off = fly ? 0 : 1.2;
    F[CY] -= off; collide(); F[CY] += off;
    if (fly && kd && (grounded || (max(abs(F[CX]), abs(F[CZ])) > -OX - 12 && F[CY] <= fl + .05))) { fly = false; F[VY] = 0; }
  }
  render();
  if (hud) {
    hN++; if (dtr > hMax) hMax = dtr; if (dtr < hMin) hMin = dtr; if (dtr > hPer * 1.5) { hLate++; hTot++; }
    F[HUDT] += dtr / 1000;
    if (F[HUDT] > 0.5) { info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps  ·  worst frame ${hMax.toFixed(1)} ms  ·  late frames ${hLate} (total ${hTot})  ·  GPU ${F[GPU].toFixed(2)} ms  ·  ${Wpx}x${Hpx} (${Wpx * 100 / DW | 0}%)  ·  ${fly ? 'flying' : 'walking'}`; F[HUDT] = 0; hPer = hMin; hN = 0; hMax = 0; hMin = 1e9; hLate = 0; }
  }
}

// ---------------------------------------------------------------- input
const pose = (i) => { const p = POSES[i]; fly = !!p[6]; F[VX] = F[VY] = F[VZ] = 0; lookAt(p[0], p[1], p[2], p[3], p[4], p[5]); };
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    // E lifts off from walking; Q descends, and touching the ground while descending lands back to walking
    case 'KeyE': ku = v; if (v && !fly) { fly = true; F[VY] = 0; } break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'KeyF') { fly = !fly; F[VY] = 0; }
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit6') pose(e.code.charCodeAt(5) - 49);
    }
  }
};
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { kf = kb = kl = kr = ku = kd = ks = 0; tId = -1; tN = 0; };
const capture = () => { sound(); const p = canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => canvas.requestPointerLock()).catch(() => 0); };
canvas.addEventListener('click', capture);
// where pointer lock is refused (embedded pages, some browsers) dragging with the left button looks around instead
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas || (e.buttons & 1 && !menu)) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
const touch = (e) => {
  e.preventDefault(); sound(); tN = e.touches.length;
  let f = null, first = false; for (let i = 0; i < tN; i++) if (e.touches[i].identifier === tId) f = e.touches[i];
  if (!f) { tId = -1; if (tN) { f = e.touches[0]; tId = f.identifier; first = true; } }
  if (f) {
    const x = rot.matches ? f.clientY : f.clientX, y = rot.matches ? -f.clientX : f.clientY, s = 1100 / min(innerWidth, innerHeight);
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; }
    tx = x; ty = y;
  }
};
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- menu: the scene keeps rendering, blurred, behind it
let menu = true;
const bDive = $('d');
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  if (m) { release(); setTimeout(() => menu && bDive.focus(), 100); } else document.activeElement.blur();
};
const go = () => {
  sound(); ui(false); bDive.textContent = 'Resume';
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
$('tm').querySelectorAll('button').forEach((b, i) => { if (i === TOD) b.className = 'on'; else b.onclick = () => { keep('nourTime', i); location.reload(); }; });
bDive.onclick = go; $('o').onclick = () => ui(true); $('fl').onclick = () => { fly = !fly; F[VY] = 0; };
$('q').querySelectorAll('button').forEach((b, i) => { if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('nour', 2 - i); location.reload(); }; });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

pose(0);
await say('Letting the light in…', 1, 400);
render(); await Q.onSubmittedWorkDone();
setTimeout(keep, 15e3, 'nourLoad', '');
ui(true);
requestAnimationFrame((t) => { F[LAST] = t; requestAnimationFrame(frame); });
