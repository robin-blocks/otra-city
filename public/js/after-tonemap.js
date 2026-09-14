// Drawing what is already a picture AFTER the city's tone mapping.
//
// The city renders scene-referred: HDR floodlights, emissive signs above 1.0,
// and an EffectComposer whose OutputPass squeezes all of it through ACES at
// exposure 1.15 and then encodes to sRGB. Everything authored for the city is
// authored for that pipeline.
//
// The 4DGSX stage is not. Its shader lights the match itself and writes a
// display-ready colour — `pow(c, 0.9091)` and out — which is what their own
// player puts straight on the canvas, and which is the look of every match
// they have ever shown. Rendered inside the composer that finished picture is
// taken for linear light, tone mapped, and encoded a second time: the pitch
// comes out grey-green and lifted, the kits lose their saturation, and the
// stadium looks nothing like the broadcast RFL viewers know. Measured on
// s3-m28 from the gantry, light stripe: their player [94,166,96], the
// composer [122,182,119].
//
// There is no per-object opt-out of a full-screen pass, so the stage is
// simply not in it. The composer draws the city without the stage; the
// scene's depth is copied into the canvas; the stage is then drawn straight
// to the canvas, depth-tested against the city, with no tone mapping and no
// encoding — exactly the path their player uses. Cost: one full-screen
// triangle for the depth copy, and the stage's own draws, which were being
// made anyway. Nothing is rendered twice.
//
// The depth copy is the part that makes this a composite rather than an
// overlay: a player behind the near stand is still behind it. It needs the
// composer's targets to carry a depth TEXTURE, which is why the composer is
// built here and not in the page — a depth texture attached after a target's
// first use is never wired into its framebuffer.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * A composer whose frame can be finished by objects that are already
 * display-referred.
 *
 *   const after = createAfterToneMap({ renderer, camera });
 *   after.composer.addPass(new RenderPass(scene, camera));   // as before
 *   ...
 *   after.render(venues.afterToneMap());   // instead of composer.render()
 *
 * `render(roots)` hides each root for the composer's passes, then draws it
 * on top of the tone-mapped frame with the scene's depth restored. With no
 * roots it is `composer.render()` and nothing else. A root may be any
 * Object3D already in the scene; it is drawn with its world transform, and
 * with no fog, background or lights — a display-referred object has already
 * decided what colour it is.
 */
export function createAfterToneMap({ renderer, camera }) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const w = Math.max(1, Math.round(size.width * pr));
  const h = Math.max(1, Math.round(size.height * pr));
  // The same target EffectComposer would have made for itself, plus the depth
  // texture. The composer clones it for its second buffer, and a clone gets a
  // depth texture of its own; setSize resizes both.
  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(w, h),
  });
  target.texture.name = 'EffectComposer.rt1';
  const composer = new EffectComposer(renderer, target);

  // The depth copy: a full-screen triangle that writes the scene's depth and
  // no colour. depthTest stays ON with an always-pass function, because a
  // disabled depth test also disables depth WRITES in WebGL — off, this quad
  // would draw nothing at all and the stage would float over the stands.
  const copyMat = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: null } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDepth;
      varying vec2 vUv;
      void main() {
        gl_FragDepthEXT = texture2D(tDepth, vUv).r;
        gl_FragColor = vec4(0.0);
      }`,
    colorWrite: false,
    depthTest: true,
    depthFunc: THREE.AlwaysDepth,
    depthWrite: true,
  });
  const copy = new FullScreenQuad(copyMat);
  const stat = { roots: 0, copies: 0, error: null };

  // THE CANVAS MUST NOT BE MULTISAMPLED. The copied depth was rasterised at
  // pixel centres; a multisampled canvas tests a root's surfaces at sample
  // positions up to half a pixel away from where that depth was taken, and on
  // a plane seen at a grazing angle half a pixel is more than the 5 mm the
  // 4DGSX pitch sits above the venue's own turf. Half the samples lost: a
  // dark, dithered pitch with the venue's centre circle showing through it
  // (measured, 2026-09-14). A slope-scaled polygon offset hides that and
  // opens a worse hole — an edge-on polygon (the halfway line, from
  // pitchside) is offset by its whole slope and pokes through the arena wall
  // as a bright seam. So the pages create their renderer with
  // `antialias: false`, which costs the composed frame nothing: the composer
  // draws into targets that were never multisampled, and the canvas only
  // ever received its finished quad. With one sample per pixel the copy is
  // exact — the same rasteriser, the same positions — and needs no offset.
  const attrs = renderer.getContext().getContextAttributes?.();
  if (attrs?.antialias) {
    stat.error = 'the canvas is multisampled; after-tonemap needs antialias: false on the renderer';
    console.warn(`after-tonemap: ${stat.error}`);
  }

  function render(roots = []) {
    const list = roots.filter(Boolean);
    stat.roots = list.length;
    if (!list.length) { composer.render(); return; }
    // The read buffer is what the RenderPass draws into, and the last pass
    // swaps the two — so it is taken now, before the swap moves it.
    const drawn = composer.readBuffer;
    const wasVisible = list.map((o) => o.visible);
    for (const o of list) o.visible = false;
    try { composer.render(); }
    finally { list.forEach((o, i) => { o.visible = wasVisible[i]; }); }

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    try {
      copyMat.uniforms.tDepth.value = drawn.depthTexture;
      copy.render(renderer);
      stat.copies += 1;
      for (const o of list) if (o.visible) renderer.render(o, camera);
    } catch (e) {
      stat.error = e.message || String(e);
      throw e;
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  return {
    composer,
    render,
    state: () => ({ ...stat }),
    dispose() { copyMat.dispose(); copy.dispose(); composer.dispose(); },
  };
}
