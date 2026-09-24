// A pitch that reads as grass, not as a mosaic.
//
// RFL's bundle carries its turf as one 512 x 512 tile covering 4 m
// (`textures/pitchgrass.png`, made by `_stripe_texture` in football.py): the
// two mown bands plus "faint noise" — and that noise is 32-pixel squares, each
// a random shade lighter or darker. 32 px of a 4 m tile is 25 cm, so every
// shot of the match showed a chequerboard of quarter-metre tiles under the
// players. That was the "pixelated" pitch.
//
// This replaces the tile, host-side, with one generated on the GPU once per
// mounted stage:
//
//   Stripes   EXACTLY the SDK's own: the same band() as its parametric turf
//             mode, from the material's own uniforms (uG1, uG2, uMow) — so the
//             two band colours, the phase, the period and the seam width are
//             the publisher's, not ours. Colours are unchanged on average.
//   Grass     blade-scale grain, mower streaks running WITH the cut, soft
//             clumping at 25–50 cm with a slight yellow/blue drift, all
//             zero-mean and periodic in the tile, so it repeats seamlessly.
//   Detail    2048 px over the same 4 m (0.2 cm per texel, 4x the original),
//             mipmapped with full anisotropy, so a long lens at the touchline
//             sees grain and the gantry sees a smooth, even surface.
//
// Only the texture VALUE is swapped. The SDK's shader, its lighting, and its
// world-planar mapping are untouched. The tile is written raw (NoColorSpace,
// sRGB-valued) exactly as their player samples the original; the match
// module's colour-space retag only touches sRGB-tagged textures, so it never
// touches this one. A tile whose size is not a whole number of stripe periods
// could not repeat the stripes, and is left as it came.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const SIZE = 2048;

const genMat = new THREE.ShaderMaterial({
  uniforms: {
    uG1: { value: new THREE.Vector3() },
    uG2: { value: new THREE.Vector3() },
    uMow: { value: new THREE.Vector4() },
    uScale: { value: new THREE.Vector2(4, 4) },
    uOffset: { value: new THREE.Vector2(-2, -2) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 uG1, uG2;
    uniform vec4 uMow;          // phase m, 1/period, axis (0 x, 1 y, 2 checker), seam half-width in periods
    uniform vec2 uScale, uOffset;
    varying vec2 vUv;

    // The SDK's band(), verbatim (stage.ts fragment shader).
    float band(float s, float phase, float invP, float w) {
      float t = fract((s - phase) * invP + 0.25);
      return clamp((4.0 * abs(t - 0.5) - 1.0) / (8.0 * w) + 0.5, 0.0, 1.0);
    }
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    // Value noise whose lattice wraps at 'period' cells: the tile repeats.
    float vnoise(vec2 p, vec2 period) {
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      float a = h21(mod(i, period)), b = h21(mod(i + vec2(1.0, 0.0), period));
      float c = h21(mod(i + vec2(0.0, 1.0), period)), d = h21(mod(i + vec2(1.0, 1.0), period));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
    }
    float cells(vec2 uv, vec2 n) { return vnoise(uv * n, n); }

    void main() {
      vec2 m = vUv * uScale + uOffset;               // match-space metres, as the SDK maps it
      float w = uMow.w;
      float k = uMow.z > 1.5
        ? abs(band(m.x, uMow.x, uMow.y, w) - band(m.y, uMow.x, uMow.y, w))
        : band(mix(m.x, m.y, uMow.z), uMow.x, uMow.y, w);
      vec3 base = mix(uG2, uG1, k);

      // Grass runs WITH the cut: the mower drove along the stripes, so blades
      // and streaks are long in that direction. q.y is along the cut.
      vec2 q = uMow.z > 0.5 && uMow.z < 1.5 ? vUv.yx : vUv;
      vec2 t = uScale.x > 0.0 ? uScale : vec2(4.0);
      // Cell counts per tile (integers, so the noise wraps): 4 m / count = size.
      float blade  = cells(q, floor(t / vec2(0.004, 0.03)));    // 4 mm × 3 cm
      float blade2 = cells(q + 0.37, floor(t / vec2(0.007, 0.05)));
      float streak = cells(q, floor(t / vec2(0.025, 0.35)));    // mower streaks
      float clump  = 0.6 * cells(q, floor(t / vec2(0.5))) + 0.4 * cells(q + 0.11, floor(t / vec2(0.25)));
      float f = 1.0 + 0.075 * blade + 0.045 * blade2 + 0.030 * streak + 0.040 * clump;
      vec3 c = base * f;
      // Lighter clumps are a touch yellower, darker ones a touch bluer, as
      // real turf is — held small so the stripe colours still read as theirs.
      c *= vec3(1.0 + 0.035 * clump, 1.0, 1.0 - 0.05 * clump);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
const genQuad = new FullScreenQuad(genMat);

/**
 * Keeps the mounted stage's pitch dressed in generated turf.
 *
 *   const turf = createTurf(renderer);
 *   turf.update(stageGroup);   // every frame; does work only when the stage changes
 */
export function createTurf(renderer) {
  const stat = { stage: null, replaced: 0, skipped: null, size: SIZE, generated: 0 };
  let stageGroup = null, rt = null;

  function dress(group) {
    stageGroup = group;
    stat.stage = group?.uuid ?? null;
    stat.replaced = 0; stat.skipped = null;
    if (!group) return;
    const mats = [];
    group.traverse((o) => {
      const u = o.isMesh ? o.material?.uniforms : null;
      if (u?.uTurf?.value === 2 && u.uTex && u.uTexXf && u.uMow && u.uG1 && u.uG2) mats.push(o.material);
    });
    if (!mats.length) { stat.skipped = 'no textured turf in this stage'; return; }
    const u0 = mats[0].uniforms;
    const xf = u0.uTexXf.value;                 // 1/scale.xy, offset.xy
    const scale = new THREE.Vector2(1 / xf.x, 1 / xf.y);
    const mow = u0.uMow.value;
    const periods = scale.x * mow.y;            // stripe periods per tile, along x
    const periodsY = scale.y * mow.y;
    if (!(mow.y > 0) || Math.abs(periods - Math.round(periods)) > 1e-3 || Math.abs(periodsY - Math.round(periodsY)) > 1e-3) {
      stat.skipped = `tile ${scale.x}x${scale.y} m is not a whole number of ${1 / mow.y} m stripe periods`;
      return;
    }
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(SIZE, SIZE, {
        type: THREE.UnsignedByteType,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        depthBuffer: false,
      });
      rt.texture.colorSpace = THREE.NoColorSpace;
      rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());   // the SDK's own value; 16 cost ~1 ms more on a full-frame pitch
      rt.texture.name = 'broadcast-turf';
    }
    // The SDK holds these as THREE.Color, not Vector3: copy the components,
    // never the object (Vector3.copy(Color) reads .x/.y/.z — NaN, a black pitch).
    genMat.uniforms.uG1.value.fromArray(u0.uG1.value.toArray());
    genMat.uniforms.uG2.value.fromArray(u0.uG2.value.toArray());
    genMat.uniforms.uMow.value.copy(mow);
    genMat.uniforms.uScale.value.copy(scale);
    genMat.uniforms.uOffset.value.set(xf.z, xf.w);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    genQuad.render(renderer);
    renderer.setRenderTarget(prev);   // mipmaps are generated as the target is unbound
    stat.generated += 1;
    for (const m of mats) m.uniforms.uTex.value = rt.texture;
    stat.replaced = mats.length;
  }

  return {
    update(group) { if ((group ?? null) !== stageGroup) dress(group ?? null); },
    state: () => ({ ...stat }),
    dispose() { rt?.dispose(); rt = null; },
  };
}
