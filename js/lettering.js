// Extruded brass lettering for the bank's name and its emblem: the Arabic letter noon (ن),
// drawn as the noon sun over a curved horizon.
// Glyph outlines: Inter Display SemiBold (Latin) and DejaVu Sans Bold (Arabic presentation forms),
// extracted with tools/glyphs.py; units are ems, y up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LATIN = {"upm":2048,"asc":0.96875,"glyphs":{"N":{"adv":0.7202,"c":[["m",0.0605,0.0],["l",0.1895,0.0],["l",0.1895,0.3657],["c",0.1895,0.3975,0.189,0.46,0.186,0.541],["c",0.2305,0.4624,0.269,0.3979,0.2896,0.3652],["l",0.52,0.0],["l",0.6597,0.0],["l",0.6597,0.7275],["l",0.5303,0.7275],["l",0.5303,0.3311],["c",0.5303,0.3022,0.5312,0.2417,0.5332,0.187],["c",0.5044,0.2388,0.4722,0.2944,0.4551,0.3218],["l",0.1997,0.7275],["l",0.0605,0.7275],["z"]]},"O":{"adv":0.748,"c":[["m",0.374,-0.0117],["c",0.5688,-0.0117,0.7129,0.1362,0.7129,0.3633],["c",0.7129,0.5913,0.5688,0.7393,0.374,0.7393],["c",0.1792,0.7393,0.0352,0.5913,0.0352,0.3633],["c",0.0352,0.1367,0.1792,-0.0117,0.374,-0.0117],["z"],["m",0.374,0.104],["c",0.2549,0.104,0.165,0.1973,0.165,0.3633],["c",0.165,0.5298,0.2549,0.6235,0.374,0.6235],["c",0.4927,0.6235,0.5825,0.5298,0.5825,0.3633],["c",0.5825,0.1973,0.4927,0.104,0.374,0.104],["z"]]},"B":{"adv":0.6426,"c":[["m",0.0605,0.0],["l",0.3545,0.0],["c",0.5229,0.0,0.6113,0.082,0.6113,0.2046],["c",0.6113,0.3081,0.5439,0.3682,0.457,0.3784],["l",0.457,0.3794],["c",0.5352,0.4009,0.5835,0.4546,0.5835,0.5386],["c",0.5835,0.6523,0.4951,0.7275,0.3418,0.7275],["l",0.0605,0.7275],["z"],["m",0.1875,0.105],["l",0.1875,0.3184],["l",0.3438,0.3184],["c",0.4297,0.3184,0.479,0.2764,0.479,0.209],["c",0.479,0.1421,0.4287,0.105,0.3408,0.105],["z"],["m",0.1875,0.4194],["l",0.1875,0.6226],["l",0.3359,0.6226],["c",0.4097,0.6226,0.4546,0.5835,0.4546,0.521],["c",0.4546,0.459,0.4097,0.4194,0.3359,0.4194],["z"]]},"A":{"adv":0.6934,"c":[["m",0.0063,0.0],["l",0.145,0.0],["l",0.2046,0.1738],["l",0.4868,0.1738],["l",0.5449,0.0],["l",0.687,0.0],["l",0.4282,0.7275],["l",0.2661,0.7275],["z"],["m",0.2407,0.2798],["l",0.2759,0.3823],["c",0.2979,0.4492,0.3198,0.519,0.3472,0.6108],["c",0.3745,0.519,0.396,0.4492,0.4175,0.3823],["l",0.4517,0.2798],["z"]]},"K":{"adv":0.6685,"c":[["m",0.0605,0.0],["l",0.1895,0.0],["l",0.1895,0.2129],["l",0.2891,0.3257],["l",0.5103,0.0],["l",0.6606,0.0],["l",0.376,0.4126],["l",0.6558,0.7275],["l",0.4966,0.7275],["l",0.3032,0.5083],["c",0.2651,0.4644,0.2275,0.4204,0.1895,0.3765],["l",0.1895,0.7275],["l",0.0605,0.7275],["z"]]}," ":{"adv":0.2261,"c":[]}}};
const ARABIC = {"upm":2048,"asc":0.92822265625,"glyphs":{"ﻥ":{"adv":0.8535,"c":[["m",0.7793,0.1523],["q",0.7798,0.0679,0.7305,-0.019],["q",0.6694,-0.1265,0.5552,-0.1484],["q",0.4688,-0.165,0.4004,-0.165],["q",0.3066,-0.165,0.2319,-0.1436],["q",0.0615,-0.0952,0.0615,0.082],["q",0.0615,0.1504,0.0811,0.2363],["q",0.0811,0.2363,0.2559,0.2363],["q",0.2354,0.1582,0.2354,0.0933],["q",0.2354,0.0063,0.3335,-0.0298],["q",0.3604,-0.0396,0.3984,-0.0396],["q",0.4258,-0.0396,0.4556,-0.0317],["q",0.5596,-0.0054,0.5869,0.0732],["q",0.603,0.1196,0.603,0.1777],["q",0.603,0.2578,0.5537,0.3662],["q",0.5537,0.3662,0.7285,0.3662],["q",0.7788,0.2861,0.7793,0.1523],["z"],["m",0.3296,0.4565],["l",0.4028,0.4565],["l",0.4028,0.3833],["l",0.3296,0.3833],["z"]]},"ﻮ":{"adv":0.627,"c":[["m",0.3491,0.0],["q",0.3335,0.0,0.2852,0.001],["q",0.1763,0.0034,0.1309,0.043],["q",0.083,0.084,0.083,0.1484],["q",0.083,0.1738,0.0869,0.1953],["q",0.1006,0.2739,0.1714,0.3013],["q",0.2246,0.3218,0.2993,0.3223],["q",0.4185,0.3228,0.4648,0.2944],["q",0.5083,0.2676,0.5342,0.1924],["q",0.5439,0.1646,0.5474,0.125],["q",0.5474,0.125,0.6372,0.125],["q",0.6372,0.125,0.6372,0.0],["q",0.6372,0.0,0.5391,0.0],["q",0.5347,-0.0444,0.5039,-0.0938],["q",0.4575,-0.1675,0.3511,-0.2036],["q",0.231,-0.2441,-0.041,-0.2441],["q",-0.041,-0.2441,-0.041,-0.1191],["q",0.0757,-0.123,0.1597,-0.1099],["q",0.2446,-0.0962,0.2871,-0.0698],["q",0.3364,-0.0386,0.3491,0.0],["z"],["m",0.3662,0.1587],["q",0.3633,0.1787,0.3403,0.1978],["q",0.3262,0.2095,0.3071,0.209],["q",0.2866,0.2085,0.2725,0.1943],["q",0.2578,0.1797,0.2578,0.166],["q",0.2578,0.144,0.2749,0.1348],["q",0.2925,0.1255,0.3091,0.1255],["q",0.3091,0.1255,0.3687,0.1255],["q",0.3687,0.1445,0.3662,0.1587],["z"]]},"ﻧ":{"adv":0.3755,"c":[["m",0.2915,0.1812],["q",0.2915,0.0923,0.2583,0.0449],["q",0.2271,0.0,0.1646,0.0],["q",0.1646,0.0,-0.0098,0.0],["q",-0.0098,0.0,-0.0098,0.125],["q",-0.0098,0.125,0.0381,0.125],["q",0.0713,0.125,0.0928,0.1465],["q",0.1167,0.1704,0.1167,0.2222],["q",0.1167,0.2222,0.1167,0.293],["l",0.2915,0.293],["z"],["m",0.1675,0.481],["l",0.2407,0.481],["l",0.2407,0.4077],["l",0.1675,0.4077],["z"]]},"ﻚ":{"adv":0.9312,"c":[["m",0.5239,0.5703],["q",0.5239,0.5703,0.5239,0.5142],["q",0.4951,0.5146,0.4692,0.5112],["q",0.4302,0.5059,0.4302,0.4907],["q",0.4302,0.4697,0.4487,0.459],["q",0.4658,0.4492,0.4761,0.4463],["q",0.5259,0.4307,0.5259,0.3892],["q",0.5254,0.3354,0.4829,0.3149],["q",0.4429,0.2959,0.3774,0.2959],["q",0.3452,0.2959,0.3179,0.3013],["q",0.3179,0.3013,0.3179,0.3604],["q",0.3511,0.356,0.373,0.356],["q",0.4146,0.356,0.4302,0.3628],["q",0.4595,0.3755,0.4595,0.3955],["q",0.4595,0.4067,0.4214,0.416],["q",0.3901,0.4238,0.3765,0.4438],["q",0.3608,0.4668,0.3613,0.4893],["q",0.3623,0.5283,0.3989,0.5474],["q",0.439,0.5684,0.5239,0.5703],["z"],["m",0.7002,0.0259],["q",0.6465,-0.0088,0.5801,-0.0181],["q",0.5117,-0.0273,0.417,-0.0269],["q",0.2632,-0.0259,0.2134,-0.0112],["q",0.0703,0.0317,0.0703,0.127],["q",0.0703,0.1636,0.0781,0.1895],["l",0.2529,0.1895],["q",0.2461,0.1729,0.2461,0.1597],["q",0.2461,0.1372,0.3252,0.1084],["q",0.3535,0.0981,0.4146,0.0981],["q",0.4707,0.0981,0.52,0.1143],["q",0.5791,0.1333,0.604,0.1665],["q",0.6396,0.2139,0.6396,0.2983],["l",0.6396,0.7598],["l",0.8145,0.7598],["l",0.8145,0.2222],["q",0.8145,0.1704,0.8384,0.1465],["q",0.8599,0.125,0.8931,0.125],["q",0.8931,0.125,0.9409,0.125],["q",0.9409,0.125,0.9409,0.0],["q",0.9409,0.0,0.7666,0.0],["q",0.73,0.0,0.7002,0.0259],["z"]]},"ﻨ":{"adv":0.4082,"c":[["m",0.418,0.0],["q",0.418,0.0,0.2954,0.0],["q",0.2417,0.0,0.2041,0.0532],["q",0.1665,0.0,0.1128,0.0],["q",0.1128,0.0,-0.0098,0.0],["q",-0.0098,0.0,-0.0098,0.125],["q",-0.0098,0.125,0.0381,0.125],["q",0.0713,0.125,0.0928,0.1465],["q",0.1167,0.1704,0.1167,0.2222],["q",0.1167,0.2222,0.1167,0.293],["l",0.2915,0.293],["l",0.2915,0.2222],["q",0.2915,0.1704,0.3154,0.1465],["q",0.3369,0.125,0.3701,0.125],["q",0.3701,0.125,0.418,0.125],["q",0.418,0.125,0.418,0.0],["z"],["m",0.1675,0.481],["l",0.2407,0.481],["l",0.2407,0.4077],["l",0.1675,0.4077],["z"]]},"ﺑ":{"adv":0.3755,"c":[["m",0.1675,-0.1001],["l",0.2407,-0.1001],["l",0.2407,-0.1733],["l",0.1675,-0.1733],["z"],["m",0.2915,0.1812],["q",0.2915,0.0923,0.2583,0.0449],["q",0.2271,0.0,0.1646,0.0],["q",0.1646,0.0,-0.0098,0.0],["q",-0.0098,0.0,-0.0098,0.125],["q",-0.0098,0.125,0.0381,0.125],["q",0.0713,0.125,0.0928,0.1465],["q",0.1167,0.1704,0.1167,0.2222],["q",0.1167,0.2222,0.1167,0.293],["l",0.2915,0.293],["z"]]}," ":{"adv":0.3481,"c":[]}}};

// lay a string out left to right: [{ g, x }], total width (ems scaled by size)
function layout(font, str, size, tracking = 0) {
  const out = []; let x = 0;
  for (const ch of str) { const g = font.glyphs[ch]; if (!g) continue; out.push({ g, x }); x += g.adv * size + tracking; }
  return { glyphs: out, width: x - tracking };
}
function glyphPath(g, size, ox, oy, sp) {
  for (const c of g.c) {
    const p = i => (i % 2 ? ox + c[i] * size : oy + c[i] * size); // odd entries are x, even are y
    if (c[0] === 'm') sp.moveTo(p(1), p(2));
    else if (c[0] === 'l') sp.lineTo(p(1), p(2));
    else if (c[0] === 'c') sp.bezierCurveTo(p(1), p(2), p(3), p(4), p(5), p(6));
    else if (c[0] === 'q') sp.quadraticCurveTo(p(1), p(2), p(3), p(4));
  }
}
// the same outlines on a 2D canvas (for the halo glow); k = px per metre, canvas y down
function glyphPath2D(g, size, ox, oy, ctx, k, cx, cy) {
  const X = v => cx + (ox + v * size) * k, Y = v => cy - (oy + v * size) * k;
  for (const c of g.c) {
    if (c[0] === 'm') ctx.moveTo(X(c[1]), Y(c[2]));
    else if (c[0] === 'l') ctx.lineTo(X(c[1]), Y(c[2]));
    else if (c[0] === 'c') ctx.bezierCurveTo(X(c[1]), Y(c[2]), X(c[3]), Y(c[4]), X(c[5]), Y(c[6]));
    else if (c[0] === 'q') ctx.quadraticCurveTo(X(c[1]), Y(c[2]), X(c[3]), Y(c[4]));
    else if (c[0] === 'z') ctx.closePath();
  }
}
function textShapes(font, str, size, tracking, cx, by) {
  const L = layout(font, str, size, tracking), x0 = cx - L.width / 2, shapes = [];
  for (const { g, x } of L.glyphs) { if (!g.c.length) continue; const sp = new THREE.ShapePath(); glyphPath(g, size, x0 + x, by, sp); shapes.push(...sp.toShapes()); }
  return { shapes, L, x0 };
}

// emblem: thin ring, the bowl of the noon with rounded tips, and its dot (the sun)
function emblemShapes(cx, cy, R) {
  const ring = new THREE.Shape().absarc(cx, cy, R, 0, Math.PI * 2, false);
  ring.holes.push(new THREE.Path().absarc(cx, cy, R * 0.9, 0, Math.PI * 2, true));
  const bx = cx, byc = cy - R * 0.06, ro = R * 0.6, ri = R * 0.42, rm = (ro + ri) / 2, rc = (ro - ri) / 2;
  const a0 = Math.PI - 0.22, a1 = Math.PI * 2 + 0.22;
  const bowl = new THREE.Shape();
  bowl.moveTo(bx + Math.cos(a0) * ro, byc + Math.sin(a0) * ro);
  bowl.absarc(bx, byc, ro, a0, a1, false);
  bowl.absarc(bx + Math.cos(a1) * rm, byc + Math.sin(a1) * rm, rc, a1, a1 + Math.PI, false);
  bowl.absarc(bx, byc, ri, a1, a0, true);
  bowl.absarc(bx + Math.cos(a0) * rm, byc + Math.sin(a0) * rm, rc, a0 + Math.PI, a0 + Math.PI * 2, false);
  const dot = new THREE.Shape().absarc(cx, cy + R * 0.42, R * 0.15, 0, Math.PI * 2, false);
  return [ring, bowl, dot];
}

// "NOON BANK" in brass over the elevators, the noon emblem above, the Arabic name below.
// Built facing +z, its English baseline centred on (x, y) on a wall at z.
export function buildNoonSign(x, y, z, opts = {}) {
  const grp = new THREE.Group(); grp.position.set(x, y, z);
  const cap = opts.cap ?? 0.46, em = cap / 0.7275, R = cap * 1.2;
  const en = textShapes(LATIN, 'NOON BANK', em, cap * 0.24, 0, 0);
  const arSize = cap * 1.15;
  const ar = textShapes(ARABIC, 'ﻥﻮﻧ ﻚﻨﺑ', arSize, 0, 0, -cap * 1.05);
  const emY = cap + 0.22 * cap / 0.46 + R;
  const em3 = emblemShapes(0, emY, R);
  const ex = (shapes, depth, bevel, segs) => new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 2, curveSegments: segs });
  const geo = mergeGeometries([ex(en.shapes, 0.045, 0.008, 6), ex(ar.shapes, 0.035, 0.006, 5), ex(em3, 0.05, 0.008, 24)]);
  geo.translate(0, 0, 0.05); // stand-offs: the letters float a little off the wall
  const brass = new THREE.MeshStandardMaterial({ color: 0xe6c070, metalness: 1, roughness: 0.24, envMapIntensity: 1.7, emissive: 0x4a3410, emissiveIntensity: 1 });
  const mesh = new THREE.Mesh(geo, brass); mesh.castShadow = true; mesh.receiveShadow = true; grp.add(mesh);
  // halo: a soft warm glow on the wall behind the letters (they're lit from behind)
  const k = 150, pad = 0.35, W = Math.max(en.L.width, R * 2) + pad * 2, top = emY + R + pad, bot = -cap * 1.05 - arSize * 0.45 - pad;
  const Hh = top - bot, c = document.createElement('canvas'); c.width = Math.ceil(W * k); c.height = Math.ceil(Hh * k);
  const ctx = c.getContext('2d'), cx = c.width / 2, cy = top * k;
  ctx.filter = 'blur(' + Math.round(k * 0.05) + 'px)'; ctx.fillStyle = '#fff'; ctx.beginPath();
  for (const { g, x: gx } of en.L.glyphs) glyphPath2D(g, em, en.x0 + gx, 0, ctx, k, cx, cy);
  for (const { g, x: gx } of ar.L.glyphs) glyphPath2D(g, arSize, ar.x0 + gx, -cap * 1.05, ctx, k, cx, cy);
  ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy - emY * k, R * k, 0, Math.PI * 2); ctx.arc(cx, cy - emY * k, R * 0.88 * k, 0, Math.PI * 2, true); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy - (emY + R * 0.42) * k, R * 0.2 * k, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy - (emY - R * 0.06) * k, R * 0.51 * k, -(Math.PI - 0.22), -(Math.PI * 2 + 0.22), true); ctx.lineWidth = R * 0.2 * k; ctx.lineCap = 'round'; ctx.strokeStyle = '#fff'; ctx.stroke();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(W, Hh), new THREE.MeshBasicMaterial({ map: tex, color: opts.halo ?? 0xffc98a, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  halo.position.set(0, (top + bot) / 2, 0.012); halo.userData.noAO = true; halo.userData.noReflect = true; grp.add(halo);
  return grp;
}
