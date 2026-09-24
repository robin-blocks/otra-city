// The broadcast camera: what happens to a finished frame between the scene
// and the television picture.
//
// /broadcast used to draw straight onto its 1280 x 720 canvas: the city
// through the composer, then the 4DGSX match on top (after-tonemap.js). That
// left three things no pass could fix, because nothing of ours ever saw the
// whole frame — the match included:
//
//   Aliasing   one sample per pixel, no AA of any kind. Every limb, line and
//              hoarding edge stair-stepped and crawled in motion.
//   Shadows    nothing cast one. Robots floated over the turf, where RFL's own
//              offline render and every real floodlit match ground them.
//   A lens     the picture was mathematically clean: no falloff, no grain, no
//              depth of field on a long lens at pitch level.
//
// So the frame is now composed OFFSCREEN, at `ss` times the output size, and
// finished by one full-screen pass onto the canvas:
//
//   composer (city, ACES, bloom) ─┐
//                                 ├─> frame target (colour + depth, ss×) ─> finish ─> canvas
//   stage, boards, pitch shadows ─┘                                      downsample, DoF,
//                                                                        sharpen, vignette, (grain)
//
// The match still never goes through ACES: the frame target holds DISPLAY
// values, exactly what the canvas held before, and the finish pass reads them
// raw. It is flagged `isXRRenderTarget` for one reason, stated so nobody
// "tidies" it away: three encodes stock materials (the SDK's label sprites,
// our boards) for the canvas only when the target is null OR an XR target —
// any other target gets linear values, and the labels came out a gamma dark.
// The flag's only other effects in r185 are tone mapping (cleared on every
// display-referred material by after-tonemap's prepare()) and multisampled
// renderbuffer formats (this target is not multisampled).
//
// Everything here is a pure function of the scene and the frame number, so
// ?capture=1 stays deterministic: grain is hashed from (pixel, frame), never
// Math.random, and nothing reads a clock.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { createTurf } from './broadcast-turf.js';

// The receiver sits 12 mm above the SDK pitch (z = 0): above its markings
// (z = 0.011) so a shadow darkens the lines too, and far too thin to see from
// any camera. It covers the arena floor and a margin, match-space metres.
const RECEIVER = { halfX: 10, halfY: 7, z: 0.012 };
// World-space push toward the light before the depth comparison. Kills acne
// on the floor and on the receiver itself without detaching shadows from feet.
const SHADOW_BIAS_M = 0.03;
// The SDK's own lighting: sun (0.25,0.15,1), c = base·(0.34 + 0.30·hemi +
// 0.48·dif), out pow 0.9091. On flat turf the direct term is 0.46 of 1.10,
// so a surface the sun cannot see is (0.64/1.10)^0.9091 = 0.611 of lit —
// derived from their shader, not tuned by eye. Used for the daylight rig.
const SDK_SUN = new THREE.Vector3(0.25, 0.15, 1).normalize();
const SUN_SHADOW = 0.611;
// Under four masts each lamp is roughly a quarter of the light, but real
// floodlit footage shows each player's four shadows clearly — floodlights are
// hard, directional sources and the turf's ambient is low. 0.84 per mast,
// compounding where they overlap, so the feet (all four) sit near 0.5.
const FLOOD_SHADOW = 0.84;
// Elevation the floodlight shadows are cast from (see rig()).
const FLOOD_ELEVATION = 55;

const MAX_LIGHTS = 4;
const _lamp = new THREE.Vector3();

/**
 * A broadcast camera for one renderer.
 *
 *   const look = createBroadcastLook({ renderer, width: 1280, height: 720, ss: 2 });
 *   look.update({ stage, scene, camera, frame, focus });   // before after.render
 *   after.render(roots, { target: look.target, beforeRoots: look.beforeRoots });
 *   look.finish(camera);                                    // onto the canvas
 */
export function createBroadcastLook({ renderer, width, height, ss = 2, shadows = true, dof = true, lens = true, grain = false, turf = true, pitch = 'turf' }) {
  ss = Math.max(1, Math.min(2, ss));
  const tw = Math.round(width * ss), th = Math.round(height * ss);
  const target = new THREE.WebGLRenderTarget(tw, th, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(tw, th),
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  target.texture.name = 'broadcast-look.frame';
  target.texture.colorSpace = THREE.SRGBColorSpace;
  target.isXRRenderTarget = true;   // see the header: stock materials encode as for the canvas

  const stat = {
    ss, width: tw, height: th, shadows: { enabled: !!shadows, rig: null, lights: 0, casters: 0, statics: 0, stage: null },
    dof: { enabled: !!dof, focus: null, maxCocPx: 0 }, lens: !!lens, grain: !!grain, anisotropy: { raised: 0 }, finishes: 0, error: null,
  };

  // ------------------------------------------------------------------ shadows
  const shadow = shadows ? createPitchShadows(renderer, stat.shadows) : null;
  // The pitch's own tile, regenerated without the 25 cm squares (broadcast-turf.js).
  const turfer = turf ? createTurf(renderer, { grade: pitch }) : null;

  // ------------------------------------------------------------------ finish
  const finishMat = new THREE.ShaderMaterial({
    uniforms: {
      tFrame: { value: target.texture },
      tDepth: { value: target.depthTexture },
      uSrc: { value: new THREE.Vector2(tw, th) },
      uDst: { value: new THREE.Vector2(width, height) },
      uNearFar: { value: new THREE.Vector2(0.1, 220) },
      uCoc: { value: new THREE.Vector3(0, 0, 0) },       // focus m, scale px·m, max px (output pixels)
      uFrame: { value: 0 },
      uLens: { value: lens ? 1 : 0 },
      uSharpen: { value: 0.22 },
      uVignette: { value: 0.11 },
      // Off unless asked for: noise that changes every frame is exactly what
      // a CBR encoder spends its bits on, and at stream bitrates it is mostly
      // smeared away anyway (RFL asked for encoder-friendly pictures, §2).
      uGrain: { value: grain ? 1.6 / 255 : 0 },
      // Floodlight heads in frame: uv.xy, window depth, strength. See ghosts().
      uLamp: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
      uLamps: { value: 0 },
      uAspect: { value: width / height },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tFrame, tDepth;
      uniform vec2 uSrc, uDst, uNearFar;
      uniform vec3 uCoc;
      uniform float uFrame, uLens, uSharpen, uVignette, uGrain, uAspect;
      uniform vec4 uLamp[4];
      uniform int uLamps;
      varying vec2 vUv;



      // One output pixel from the ss× frame: four bilinear taps a quarter of
      // an output pixel off centre — a box over 2×2 source pixels at ss = 2,
      // a slightly wider tent at 1.5 — so edges resolve without ringing.
      vec3 down(vec2 uv) {
        vec2 o = 0.25 / uDst;
        return 0.25 * (texture2D(tFrame, uv + vec2(-o.x, -o.y)).rgb + texture2D(tFrame, uv + vec2(o.x, -o.y)).rgb
                     + texture2D(tFrame, uv + vec2(-o.x, o.y)).rgb + texture2D(tFrame, uv + vec2(o.x, o.y)).rgb);
      }
      float linDepth(vec2 uv) {
        float z = texture2D(tDepth, uv).r * 2.0 - 1.0;
        float n = uNearFar.x, f = uNearFar.y;
        return 2.0 * n * f / (f + n - z * (f - n));
      }
      // Circle of confusion in OUTPUT pixels for a thin lens focused at uCoc.x:
      // |d - s| / d, scaled by (A·f / (s - f)) / sensor height · H, which the
      // page computes from the real field of view. A wide gantry lens gives
      // well under a pixel everywhere — physically, not by a switch.
      float coc(float d) { return min(uCoc.z, uCoc.y * abs(d - uCoc.x) / max(d, 1e-3)); }
      // LENS GHOSTS. A bright source in shot is reflected between a zoom
      // lens's elements into a string of faint, tinted discs on the line from
      // the source through the centre of frame — the rings in the
      // behind-the-goal reference. Only a lamp the frame can actually SEE
      // throws them: its depth is tested against the frame's own, so a mast
      // behind a stand roof does not flare through it.
      vec3 ghosts(vec2 uv) {
        vec3 acc = vec3(0.0);
        for (int i = 0; i < 4; i++) {
          if (i >= uLamps) break;
          vec4 L = uLamp[i];
          float vis = 0.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
            vis += step(L.z - 2.0, linDepth(L.xy + vec2(float(x), float(y)) * 2.0 / uSrc));
          float s = L.w * vis / 9.0;
          if (s <= 0.0) continue;
          vec2 axis = vec2(0.5) - L.xy;
          vec2 asp = vec2(uAspect, 1.0);
          // position along the axis, radius (frame heights), tint, gain
          vec2 c0 = L.xy + axis * 0.55; float d0 = length((uv - c0) * asp);
          vec2 c1 = L.xy + axis * 1.30; float d1 = length((uv - c1) * asp);
          vec2 c2 = L.xy + axis * 1.75; float d2 = length((uv - c2) * asp);
          vec2 c3 = L.xy + axis * 2.40; float d3 = length((uv - c3) * asp);
          acc += s * vec3(0.55, 1.0, 0.70) * 0.030 * smoothstep(0.045, 0.036, d0);
          acc += s * vec3(1.0, 0.60, 0.90) * 0.022 * smoothstep(0.090, 0.075, d1);
          acc += s * vec3(0.60, 0.85, 1.0) * 0.016 * smoothstep(0.030, 0.022, d2);
          acc += s * vec3(0.90, 0.80, 1.0) * 0.018 * (smoothstep(0.26, 0.24, d3) - smoothstep(0.235, 0.20, d3));
        }
        return acc;
      }
      float hash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

      void main() {
        vec3 c = down(vUv);
        // Sharpen against the four neighbouring OUTPUT pixels, as a broadcast
        // camera's detail circuit does after its own downscale.
        if (uLens > 0.5 && uSharpen > 0.0) {
          vec2 px = 1.0 / uDst;
          vec3 n4 = down(vUv + vec2(px.x, 0.0)) + down(vUv - vec2(px.x, 0.0)) + down(vUv + vec2(0.0, px.y)) + down(vUv - vec2(0.0, px.y));
          c = max(c + uSharpen * (c - 0.25 * n4), 0.0);
        }
        // Depth of field: a 32-tap golden-angle disc sized by this pixel's CoC.
        // A tap only counts when its OWN CoC reaches back to this pixel, so a
        // sharp subject does not smear into the blurred crowd behind it.
        if (uCoc.y > 0.0) {
          float r0 = coc(linDepth(vUv));
          if (r0 > 0.6) {
            vec3 acc = c; float wsum = 1.0;
            for (int i = 1; i < 32; i++) {
              float fi = float(i);
              float rr = r0 * sqrt(fi / 31.0);
              float a = fi * 2.39996323;
              vec2 uv = vUv + vec2(cos(a), sin(a)) * rr / uDst;
              float rs = coc(linDepth(uv));
              float w = smoothstep(rr - 1.0, rr + 1.0, max(rs, r0 * step(linDepth(vUv), linDepth(uv))));
              acc += texture2D(tFrame, uv).rgb * w; wsum += w;
            }
            c = acc / wsum;
          }
        }
        if (uLens > 0.5) {
          if (uLamps > 0) c += ghosts(vUv);
          // Optical falloff toward the corners, gentle.
          vec2 q = vUv * 2.0 - 1.0; q.x *= uDst.x / uDst.y;
          float r2 = dot(q, q) / (1.0 + (uDst.x / uDst.y) * (uDst.x / uDst.y));
          c *= 1.0 - uVignette * r2 * r2 * 1.6;
          // Sensor noise: seeded by pixel and frame, so a capture repeats.
          // Strongest in the mids, as a camera's is.
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float g = (hash(gl_FragCoord.xy + uFrame * vec2(17.0, 59.0)) + hash(gl_FragCoord.yx * 1.37 + uFrame * 7.0) - 1.0);
          c += g * uGrain * (0.4 + 2.4 * l * (1.0 - l));
        }
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const finishQuad = new FullScreenQuad(finishMat);

  // ------------------------------------------------------------ anisotropy
  // A hoarding seen along the touchline is a texture at a grazing angle: at
  // anisotropy 1 its artwork smears to a bar exactly where a pitchside
  // camera reads it. Raised once per texture, on this page only.
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const raised = new WeakSet();
  function raiseAnisotropy(scene) {
    scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        const t = m?.map;
        if (!t || raised.has(t)) continue;
        raised.add(t);
        if (t.generateMipmaps !== false && t.minFilter !== THREE.NearestFilter && t.anisotropy < maxAniso) {
          t.anisotropy = maxAniso;
          t.needsUpdate = true;
          stat.anisotropy.raised += 1;
        }
      }
    });
  }

  let frameNo = 0;
  return {
    target,
    /** Once per drawn frame, before after.render(). */
    update({ scene, camera, stage, frame, focus, lights, lens }) {
      frameNo = frame;
      if (frame % 50 === 0) raiseAnisotropy(scene);
      turfer?.update(stage);
      if (shadow) {
        try { shadow.update({ stage, lights }); }
        catch (e) { stat.error = `shadows: ${e.message || e}`; throw e; }
      }
      // Thin-lens CoC scale for the current shot. A broadcast camera's
      // 2/3-inch sensor (16:9, 5.39 mm tall) at f/2.8 unless the shot names
      // its own lens — the iso is a full-frame stills body, which is where
      // the reference's soft stand comes from. Only a long lens gets blur.
      if (dof && focus && focus > 0.5) {
        const sensorH = lens?.sensor_mm ?? 5.39, fNum = lens?.fstop ?? 2.8;
        const fmm = (sensorH / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        const s = focus * 1000;
        const scale = (fmm / fNum) * fmm / Math.max(1, s - fmm) / sensorH * height;  // px per unit |d-s|/d
        finishMat.uniforms.uCoc.value.set(focus, scale, 12);
        stat.dof.focus = +focus.toFixed(2);
        stat.dof.maxCocPx = +Math.min(12, scale).toFixed(2);
      } else {
        finishMat.uniforms.uCoc.value.set(0, 0, 0);
        stat.dof.focus = null; stat.dof.maxCocPx = 0;
      }
      finishMat.uniforms.uNearFar.value.set(camera.near, camera.far);
      // Floodlight heads for the lens ghosts: projected into the frame, with
      // their distance from the camera in metres. The finish pass calls a lamp
      // visible when the frame's own depth there is no nearer than 2 m in
      // front of it — the lamp's housing is itself geometry a little in front
      // of the light, and a window-depth test read every lamp as hidden behind
      // its own casing. A lamp just off the edge still flares a little.
      let n = 0;
      if (stat.lens) {   // the page's lens switch — `lens` here is the SHOT's optics
        for (const l of (lights || [])) {
          if (!l.isSpotLight || n >= 4) continue;
          l.getWorldPosition(_lamp);
          const dist = -_lamp.clone().applyMatrix4(camera.matrixWorldInverse).z;
          const p = _lamp.project(camera);
          if (dist <= camera.near || p.z > 1) continue;   // behind the camera or past the far plane
          const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
          const s = THREE.MathUtils.clamp((1.25 - edge) / 0.25, 0, 1);
          if (s <= 0) continue;
          finishMat.uniforms.uLamp.value[n++].set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, dist, s);
        }
      }
      finishMat.uniforms.uLamps.value = n;
      stat.ghosts = n;
      finishMat.uniforms.uFrame.value = frame % 997;
    },
    /** Runs inside after.render(), with the frame target bound and the city's depth in it. */
    beforeRoots() { shadow?.attach(); },
    /**
     * The finished frame onto the canvas — and the canvas LEFT BOUND. Every
     * reader after this (the scorebug, LIVE, the stadium screen's
     * copyFramebufferToTexture, pixels(), clean output) works on whatever
     * framebuffer is current. Restoring the offscreen target here put the
     * scorebug into the wrong frame and made the screen copy fail with
     * INVALID_OPERATION (half float into RGBA8), caught by broadcast-check.
     */
    finish() {
      renderer.setRenderTarget(null);
      finishQuad.render(renderer);
      stat.finishes += 1;
    },
    state: () => JSON.parse(JSON.stringify({ ...stat, turf: turfer ? turfer.state() : null, frame: frameNo })),
    dispose() { target.dispose(); finishMat.dispose(); finishQuad.dispose(); shadow?.dispose(); turfer?.dispose(); },
  };
}

/**
 * Shadows of the match on the pitch, without touching the SDK.
 *
 * The 4DGSX stage is ordinary three meshes posed each frame, so their shadow
 * can be drawn from outside it: depth maps from each light, and one thin
 * receiver quad over the pitch that multiplies the turf where a light is
 * blocked. The SDK's shader and its colours are untouched.
 *
 * The casters are STAND-INS. A mounted match is ~2.3 M triangles — 510k per
 * G1 robot, 197k in the ball — and re-drawing that for every light would
 * double or quintuple the frame. So each opaque part of each moving body
 * casts as an ellipsoid inscribed in its own bounds (computed once per part
 * from its index list: the SDK shares one vertex buffer across every part, so
 * three's computeBoundingBox would measure the whole bundle), all in ONE
 * instanced draw per light. Soft-shadowed at 720p from 10 m, a limb's
 * ellipsoid is a limb. The static world (walls, goals, hoardings) is cheap
 * and casts with its real geometry.
 *
 * Lights: the stadium's own floodlight masts when it has them — four hard
 * sources and four shadows per player, as under any floodlit match — else
 * the SDK's sun. Either way the lit surface keeps the SDK's shading; only the
 * occlusion is added.
 */
function createPitchShadows(renderer, stat) {
  const MAP = 1024;
  const maps = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const rt = new THREE.WebGLRenderTarget(MAP, MAP, { depthTexture: new THREE.DepthTexture(MAP, MAP), type: THREE.UnsignedByteType });
    rt.texture.generateMipmaps = false;
    rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
    maps.push({ rt, cam: null, strength: 1 });
  }
  const depthMat = new THREE.MeshBasicMaterial({ colorWrite: false });
  const depthMatInst = new THREE.MeshBasicMaterial({ colorWrite: false });

  const proxyScene = new THREE.Scene();
  proxyScene.matrixWorldAutoUpdate = false;
  let proxies = null, records = [], statics = [], staticSet = new Set(), world = null;

  const recvMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: maps.map((m) => m.rt.depthTexture) },
      uMat: { value: maps.map(() => new THREE.Matrix4()) },
      uLightPos: { value: maps.map(() => new THREE.Vector3()) },
      uDir: { value: maps.map(() => new THREE.Vector3()) },   // ortho: direction TO light; persp: zero
      uStrength: { value: maps.map(() => 1) },
      uCount: { value: 0 },
      uTexel: { value: 1 / MAP },
      uBias: { value: SHADOW_BIAS_M },
    },
    vertexShader: /* glsl */`
      out vec3 vWorld;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap[${MAX_LIGHTS}];
      uniform mat4 uMat[${MAX_LIGHTS}];
      uniform vec3 uLightPos[${MAX_LIGHTS}];
      uniform vec3 uDir[${MAX_LIGHTS}];
      uniform float uStrength[${MAX_LIGHTS}];
      uniform int uCount;
      uniform float uTexel, uBias;
      in vec3 vWorld;
      out highp vec4 shadowOut;
      // 12 Poisson taps: a soft penumbra a couple of centimetres wide, which
      // is what a bank of lamps 40 m away gives a limb a metre off the grass.
      const vec2 P[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621),
        vec2(0.962,-0.195), vec2(0.473,-0.480), vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064),
        vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
      float lit(sampler2D map, mat4 M, vec3 toLight) {
        vec4 clip = M * vec4(vWorld + toLight * uBias, 1.0);
        vec3 ndc = clip.xyz / clip.w;
        vec2 uv = ndc.xy * 0.5 + 0.5;
        if (clip.w <= 0.0 || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
        float z = ndc.z * 0.5 + 0.5;
        float s = 0.0;
        for (int i = 0; i < 12; i++) s += step(z, texture(map, uv + P[i] * 2.6 * uTexel).r);
        return s / 12.0;
      }
      void main() {
        float k = 1.0;
        // Sampler arrays need constant indices in GLSL ES 3.0, hence spelled out.
        ${Array.from({ length: MAX_LIGHTS }, (_, i) => `if (uCount > ${i}) {
          vec3 L${i} = length(uDir[${i}]) > 0.0 ? uDir[${i}] : normalize(uLightPos[${i}] - vWorld);
          k *= mix(uStrength[${i}], 1.0, lit(uMap[${i}], uMat[${i}], L${i}));
        }`).join('\n        ')}
        shadowOut = vec4(vec3(k), 1.0);
      }`,
    glslVersion: THREE.GLSL3,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    // Multiply: dst · src. The turf keeps the SDK's colour where lit.
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
  });
  const receiver = new THREE.Mesh(new THREE.PlaneGeometry(RECEIVER.halfX * 2, RECEIVER.halfY * 2), recvMat);
  receiver.position.z = RECEIVER.z;           // match space is Z-up; the plane is XY
  receiver.name = 'otra-pitch-shadows';
  receiver.userData.otraLook = true;
  receiver.renderOrder = 9000;                // after markings, before the SDK's labels (10000)
  receiver.frustumCulled = false;
  receiver.raycast = () => {};              // a shadow is not a surface: never a pick or a sightline hit

  let stageGroup = null, matchRoot = null;
  const tmpM = new THREE.Matrix4(), tmpS = new THREE.Matrix4();

  /** Local bounds of one SDK part, from its own indices. Cached per geometry. */
  const boundsCache = new WeakMap();
  function partBounds(geo) {
    let b = boundsCache.get(geo);
    if (b) return b;
    const idx = geo.index?.array, pos = geo.attributes.position;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    if (idx && pos) {
      for (let i = 0; i < idx.length; i++) {
        const v = idx[i];
        const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
        if (x < min.x) min.x = x; if (y < min.y) min.y = y; if (z < min.z) min.z = z;
        if (x > max.x) max.x = x; if (y > max.y) max.y = y; if (z > max.z) max.z = z;
      }
    }
    b = min.x <= max.x ? { c: min.clone().add(max).multiplyScalar(0.5), h: max.clone().sub(min).multiplyScalar(0.5) } : null;
    boundsCache.set(geo, b);
    return b;
  }

  const opaqueMesh = (o) => o.isMesh && !o.userData?.otraLook && o.visible
    && !([].concat(o.material)).some((m) => !m || m.transparent || m.opacity < 0.99 || m.visible === false);

  function rebuild(group) {
    stageGroup = group;
    matchRoot = group?.getObjectByName?.('4dgsx-match-space') || group?.children?.[0] || null;
    if (proxies) { proxyScene.remove(proxies); proxies.dispose(); proxies = null; }
    records = []; statics = []; world = null;
    if (!matchRoot) { staticSet = new Set(); return; }
    const [first, ...bodies] = matchRoot.children.filter((c) => !c.userData?.otraLook);
    world = first ?? null;
    world?.traverse((o) => { if (opaqueMesh(o)) statics.push(o); });
    staticSet = new Set(statics);
    for (const body of bodies) {
      body.traverse((o) => {
        if (!opaqueMesh(o)) return;
        const b = partBounds(o.geometry);
        // Ignore degenerate parts (a flat decal, a zero-size helper).
        if (!b || Math.min(b.h.x, b.h.y, b.h.z) < 1e-4 && Math.max(b.h.x, b.h.y, b.h.z) < 0.01) return;
        records.push({ mesh: o, b });
      });
    }
    proxies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), depthMatInst, Math.max(1, records.length));
    proxies.count = records.length;
    proxies.frustumCulled = false;
    proxies.matrixAutoUpdate = false;
    proxyScene.add(proxies);
    stat.casters = records.length;
    stat.statics = statics.length;
    stat.stage = group.uuid;
  }

  /**
   * Where the lights are, in world space. Venue floodlights (the stadium GLB's
   * SpotLights on its masts) when present, else the SDK's sun transformed out
   * of match space.
   */
  function rig(lights) {
    const out = [];
    const floods = (lights || []).filter((l) => l.isSpotLight).slice(0, MAX_LIGHTS);
    const centre = matchRoot.localToWorld(new THREE.Vector3(0, 0, 0));
    if (floods.length >= 2) {
      for (const l of floods) {
        // Keep each mast's bearing, but light from FLOOD_ELEVATION. The
        // stadium's masts are modelled low (~17 m at ~32°), which throws
        // two-metre shadows off a robot; broadcast floodlighting is rigged
        // high so shadows stay compact under the players, as in the footage.
        const mast = l.getWorldPosition(new THREE.Vector3());
        const flat = mast.clone().sub(centre); flat.y = 0;
        const reach = Math.max(1, flat.length());
        flat.normalize();
        const el = THREE.MathUtils.degToRad(FLOOD_ELEVATION);
        const p = centre.clone().addScaledVector(flat, reach).setY(centre.y + reach * Math.tan(el));
        const d = p.distanceTo(centre);
        const fov = THREE.MathUtils.radToDeg(2 * Math.atan(12.5 / Math.max(1, d)));
        const cam = new THREE.PerspectiveCamera(fov, 1, Math.max(0.5, d - 25), d + 25);
        cam.position.copy(p);
        cam.lookAt(centre);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        out.push({ cam, strength: FLOOD_SHADOW, ortho: false });
      }
      stat.rig = 'floodlights';
    } else {
      const toSun = SDK_SUN.clone().transformDirection(matchRoot.matrixWorld);
      const cam = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 60);
      cam.position.copy(centre).addScaledVector(toSun, 30);
      cam.up.set(0, 0, 1).transformDirection(matchRoot.matrixWorld);   // any axis not parallel to the sun
      if (Math.abs(cam.up.dot(toSun)) > 0.95) cam.up.set(1, 0, 0);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      out.push({ cam, strength: SUN_SHADOW, ortho: true, dir: toSun });
      stat.rig = 'sun';
    }
    return out;
  }

  const swapped = [];
  function update({ stage, lights }) {
    const group = stage ?? null;
    if (group !== stageGroup) rebuild(group);
    if (!matchRoot || !stageGroup?.visible) { recvMat.uniforms.uCount.value = 0; stat.lights = 0; return; }
    stageGroup.updateWorldMatrix(true, true);

    // Pose the stand-ins: part world matrix · centre · half-extents.
    for (let i = 0; i < records.length; i++) {
      const { mesh, b } = records[i];
      tmpS.makeScale(Math.max(b.h.x, 0.004), Math.max(b.h.y, 0.004), Math.max(b.h.z, 0.004)).setPosition(b.c);
      tmpM.multiplyMatrices(mesh.matrixWorld, tmpS);
      proxies.setMatrixAt(i, tmpM);
    }
    if (proxies) proxies.instanceMatrix.needsUpdate = true;
    proxies?.updateMatrixWorld(true);

    const lightsNow = rig(lights);
    const prevTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    try {
      lightsNow.forEach((L, i) => {
        const m = maps[i];
        renderer.setRenderTarget(m.rt);
        renderer.clear(true, true, false);
        renderer.autoClear = false;
        renderer.render(proxyScene, L.cam);
        // The static world with its own geometry, drawn depth-only in ONE
        // render: opaque parts get the depth material, everything else
        // (markings, glass, sprites, panels) is hidden for the pass.
        if (world) {
          world.traverse((o) => {
            if (o === world) return;
            if (staticSet.has(o)) { swapped.push([o, o.material, o.visible]); o.material = depthMat; }
            else if (o.isMesh || o.isSprite || o.isPoints || o.isLine) { swapped.push([o, o.material, o.visible]); o.visible = false; }
          });
          try { renderer.render(world, L.cam); }
          finally { for (const [o, mat, vis] of swapped) { o.material = mat; o.visible = vis; } swapped.length = 0; }
        }
        renderer.autoClear = true;
        recvMat.uniforms.uMat.value[i].multiplyMatrices(L.cam.projectionMatrix, L.cam.matrixWorldInverse);
        recvMat.uniforms.uLightPos.value[i].copy(L.cam.position);
        recvMat.uniforms.uDir.value[i].copy(L.ortho ? L.dir : new THREE.Vector3());
        recvMat.uniforms.uStrength.value[i] = L.strength;
      });
    } finally {
      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = autoClear;
    }
    recvMat.uniforms.uCount.value = lightsNow.length;
    stat.lights = lightsNow.length;
  }

  return {
    update,
    /** Put the receiver into the stage for this frame's display-referred draw. */
    attach() {
      if (matchRoot && receiver.parent !== matchRoot) matchRoot.add(receiver);
      receiver.visible = recvMat.uniforms.uCount.value > 0;
    },
    dispose() {
      receiver.removeFromParent(); receiver.geometry.dispose(); recvMat.dispose();
      for (const m of maps) m.rt.dispose();
      proxies?.dispose(); depthMat.dispose(); depthMatInst.dispose();
    },
  };
}
