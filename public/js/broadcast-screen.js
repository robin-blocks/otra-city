// Internal television output. No iframe, media decoder, transport or second
// match: the visitor's EXISTING scene gets one broadcast-camera pass, then the
// normal walking-camera pass. The canvas is scratch until that final draw.
// Drawing to the canvas (not a differently colour-managed render target) keeps
// the broadcast's after-tonemap and graphics pipeline identical. Only a GPU
// framebuffer copy crosses into the screen texture; no readPixels/PNG/video.
import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createAfterToneMap } from './after-tonemap.js';
import { createScorebug } from './scorebug.js';
import { createLeagueOverlay } from './league-overlay.js';
import { createBroadcastProgramme } from './broadcast-programme.js';

export function screenMesh(node) {
  let mesh = null;
  node?.traverse?.(o => { if (!mesh && o.isMesh) mesh = o; });
  return mesh;
}

/** Encoded broadcast pixels are already a finished picture. Draw this mesh in
 * afterToneMap(), not through ACES/bloom a second time. Also used by /broadcast. */
export function createBroadcastSurface(mesh, width, height) {
  const original = mesh.material;
  const texture = new THREE.FramebufferTexture(width, height);
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  // FramebufferTexture must stay RGBA8/NoColorSpace: an sRGB copy destination
  // is INVALID_OPERATION on some drivers. The shader samples those bytes raw.
  const material = new THREE.ShaderMaterial({
    uniforms: { frame: { value: texture } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform sampler2D frame; varying vec2 vUv; void main(){gl_FragColor=texture2D(frame,vec2(vUv.x,1.-vUv.y));}',
    toneMapped: false,
  });
  // Conventional map alias for inspection / existing framebuffer diagnostics.
  material.map = texture;
  mesh.material = material;
  let disposed = false;
  return {
    mesh, texture, material,
    attach() { if (!disposed) mesh.material = material; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (mesh.material === material) mesh.material = original;
      texture.dispose(); material.dispose();
    },
  };
}

export function aimBroadcastCamera(camera, root, shot) {
  const p = root.localToWorld(new THREE.Vector3(...shot.pos));
  const t = root.localToWorld(new THREE.Vector3(...shot.lookAt));
  camera.position.copy(p);
  camera.up.set(0, 1, 0);
  camera.lookAt(t);
  if (shot.roll) camera.rotateZ(shot.roll);
  camera.fov = shot.fov || 50;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

/** Lifecycle belongs to the venue: create on entry, suspend outside, dispose
 * before the glTF unloads. ready never starts a render loop of its own. */
export function createStadiumBroadcast({ renderer, scene, venue, root, mesh, module, roots, player, log = console }) {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 220);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  // Never resize the visible canvas. A phone-sized buffer receives a smaller
  // television picture, not a clipped 720p image. Layout still uses 1280x720.
  const scale = Math.min(1, size.x / 1280, size.y / 720);
  const width = Math.max(1, Math.floor(1280 * scale));
  const height = Math.max(1, Math.floor(720 * scale));
  const surface = createBroadcastSurface(mesh, width, height);
  const after = createAfterToneMap({ renderer, camera });
  after.composer.setPixelRatio(1);
  after.composer.setSize(width, height);
  after.composer.addPass(new RenderPass(scene, camera));
  after.composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), 0.12, 0.3, 1));
  after.composer.addPass(new OutputPass());
  const scorebug = createScorebug({ width: 1280, height: 720 });
  const league = createLeagueOverlay({ width: 1280, height: 720, crestFor: team => scorebug.crestFor(team) });
  let programme = null, disposed = false;
  const status = { ready: false, frames: 0, width, height, calls: 0, triangles: 0, cpuMs: 0, error: null, programme: null };
  const ready = createBroadcastProgramme({ venue }).then(p => {
    if (disposed) { p.dispose?.(); return; }
    programme = p; status.ready = true;
  }).catch(e => { status.error = e.message || String(e); log.warn('stadium broadcast:', e); });
  const viewport = new THREE.Vector4(), scissor = new THREE.Vector4();
  return {
    ready, surface,
    state: () => ({ ...status, attached: mesh.material === surface.material, graphics: league.state() }),
    render(dt = 0, nowMs = Date.now()) {
      if (disposed || !programme || renderer.getContext().isContextLost()) return false;
      let mod, result;
      try {
        mod = module();
        result = programme.evaluate({ match: mod?.state ?? null, nowMs, dt, samplePlay: mod?.samplePlay });
        if (!result.camera) return false;
        surface.attach();
        aimBroadcastCamera(camera, root, result.camera);
      } catch (e) { status.error = e.message || String(e); return false; }
      const target = renderer.getRenderTarget();
      renderer.getViewport(viewport); renderer.getScissor(scissor);
      const scissorTest = renderer.getScissorTest();
      const autoClear = renderer.autoClear;
      // In first person the visitor hides their OWN avatar from their eyes,
      // not from television. It is still a real person in the shared scene.
      const avatar = player?.avatar?.group;
      const visible = avatar?.visible;
      const parts = player?.avatar?.firstPersonParts ?? [];
      const partsVisible = parts.map(p => p.visible);
      const before = { ...renderer.info.render };
      const start = performance.now();
      try {
        if (avatar) avatar.visible = true;
        parts.forEach(p => { p.visible = true; });
        renderer.setRenderTarget(null);
        renderer.setViewport(0, 0, width / renderer.getPixelRatio(), height / renderer.getPixelRatio());
        renderer.setScissorTest(false);
        after.render(roots());
        scorebug.draw(mod?.state?.bug ?? null, { compactOnly: !!result.tableCue });
        scorebug.render(renderer);
        league.draw(result.tableCue?.presentation ?? null, result.tableCue?.elapsed ?? 0);
        if (result.tableCue) league.render(renderer);
        renderer.copyFramebufferToTexture(surface.texture);
        status.frames++;
        status.calls = renderer.info.render.calls - before.calls;
        status.triangles = renderer.info.render.triangles - before.triangles;
        status.cpuMs = +(performance.now() - start).toFixed(2);
        status.programme = programme.state();
        return true;
      } catch (e) {
        status.error = e.message || String(e);
        return false; // the walking view still renders; never break the city
      } finally {
        if (avatar) avatar.visible = visible;
        parts.forEach((p, i) => { p.visible = partsVisible[i]; });
        renderer.setRenderTarget(target);
        renderer.setViewport(viewport); renderer.setScissor(scissor);
        renderer.setScissorTest(scissorTest); renderer.autoClear = autoClear;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      programme?.dispose?.();
      surface.dispose(); scorebug.dispose(); league.dispose();
      for (const pass of after.composer.passes) pass.dispose?.();
      after.dispose();
    },
  };
}
