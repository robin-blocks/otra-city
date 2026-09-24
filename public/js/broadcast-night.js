// A floodlit night, as television sees one.
//
// Robin's reference frames of floodlit grounds (24 September 2026) settled
// what a night match looks like, and it is not what the audit first assumed:
// a bright, evenly lit pitch in a dark bowl is CORRECT. What our stadium was
// missing is everything around the pitch:
//
//   Sky      a deep blue, lifted toward the horizon by the town's light — not
//            flat black. At dusk it is a clear blue (the behind-the-goal
//            frame); later, navy. Never the void.
//   Masts    each floodlight bank a blinding point with a halo around it, and
//            faint beams through the damp air below it.
//   Stands   lit. Spill from the floods and the roof lights puts the seats'
//            colour on screen; the stands are not silhouettes.
//
// Everything here is scene-referred and goes through the city's ACES pass and
// bloom, like the rest of the venue. Page-only (broadcast.html): the visitor's
// city is unchanged. No light is added or removed — the floodlights' cones
// are only widened, which changes uniforms, not the shader's light count, so
// nothing recompiles (the rule lights.js exists to keep).
import * as THREE from 'three';

const SKY = {
  zenith: new THREE.Color(0x03050d),
  horizon: new THREE.Color(0x142043),
  glow: new THREE.Color(0x2a2140),   // the town's light, low and warm-violet
};
// Floodlight spill: the modelled cone (0.8 rad) stops at the touchlines and
// leaves the stands black. Real floods throw light well past the pitch.
const SPILL = { angle: 1.15, penumbra: 0.75 };

// Atmosphere is light, not matter: nothing here may stop a ray. The
// sightline gate raycasts from the gantry to the pitch corners, and the haze
// cones hang right across that line (broadcast-check caught it as "unnamed,
// under the venue"); so would any pick or collider test.
const noRaycast = (o) => { o.raycast = () => {}; };

/** A soft radial sprite texture for the mast halos. */
function haloTexture() {
  const n = 128, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.08, 'rgba(255,255,255,0.85)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.22)');
  r.addColorStop(0.6, 'rgba(255,255,255,0.05)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const beamMat = new THREE.ShaderMaterial({
  uniforms: { uStrength: { value: 0.1 }, uColor: { value: new THREE.Color(0xf4f6ff) } },
  vertexShader: /* glsl */`
    varying float vAlong;
    varying vec3 vN, vV;
    void main() {
      vAlong = uv.y;                                   // 1 at the lamp, 0 at the far end
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    uniform float uStrength;
    uniform vec3 uColor;
    varying float vAlong;
    varying vec3 vN, vV;
    void main() {
      // Brightest at the lamp and along the beam's axis (faces seen square-on
      // are looking down the middle of the cone), fading to nothing at its
      // walls and toward the pitch. Additive and faint: haze, not searchlights.
      float axis = pow(abs(dot(vN, vV)), 2.0);
      float along = pow(vAlong, 2.2);
      gl_FragColor = vec4(uColor * uStrength * axis * along, 1.0);
    }`,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  fog: false,
});

/**
 * const night = createNight({ scene, camera });
 * night.update(floodlights);   // each frame; builds once per set of lights
 */
export function createNight({ scene, camera }) {
  const stat = { sky: true, masts: 0, spill: 0 };
  const root = new THREE.Group();
  root.name = 'broadcast-night';
  scene.add(root);

  // ---- sky ---------------------------------------------------------------
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: SKY.zenith.clone() },
      uHorizon: { value: SKY.horizon.clone() },
      uGlow: { value: SKY.glow.clone() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;                         // on the far plane: behind everything
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uZenith, uHorizon, uGlow;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
        c += uGlow * exp(-max(h, 0.0) * 9.0);         // light pollution hugging the horizon
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
  sky.name = 'broadcast-night-sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  root.add(sky);
  noRaycast(sky);
  // The distant city fades into the horizon, not into a different colour.
  const fogWas = scene.fog ? scene.fog.color.clone() : null;
  if (scene.fog) scene.fog.color.copy(SKY.horizon);
  const bgWas = scene.background;
  scene.background = SKY.horizon.clone();

  // ---- masts -------------------------------------------------------------
  const halo = haloTexture();
  let builtFor = '';
  const masts = new THREE.Group();
  root.add(masts);
  const spilled = new WeakSet();

  function buildMasts(lights) {
    masts.clear();
    for (const l of lights) {
      const head = l.getWorldPosition(new THREE.Vector3());
      const aimAt = l.target.getWorldPosition(new THREE.Vector3());
      // The bank's glare: a bright core that bloom spreads, and a wide faint halo.
      for (const [size, gain] of [[2.2, 6], [9, 0.9]]) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({
          map: halo, color: new THREE.Color(0xf4f6ff).multiplyScalar(gain),
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false,
        }));
        s.position.copy(head);
        s.scale.setScalar(size);
        s.renderOrder = 10;
        masts.add(s);
      }
      // A haze beam toward the pitch: an open cone whose apex is the lamp.
      // GLTF spot lights aim at a target ONE METRE down the beam (the loader
      // parents it at -z), so the target gives a direction, never a length.
      // The beam runs to where it meets the ground, three quarters of the way.
      const dir = aimAt.clone().sub(head).normalize();
      const len = (dir.y < -0.05 ? head.y / -dir.y : 30) * 0.75;
      const radius = Math.tan(l.angle * 0.55) * len;
      const geo = new THREE.CylinderGeometry(0.4, radius, len, 32, 1, true);
      geo.translate(0, -len / 2, 0);                  // apex at the origin, opening down -y
      const beam = new THREE.Mesh(geo, beamMat);
      beam.position.copy(head);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      beam.renderOrder = 11;
      masts.add(beam);
    }
    masts.traverse(noRaycast);
    stat.masts = lights.length;
  }

  return {
    update(lights = []) {
      sky.position.copy(camera.position);
      sky.scale.setScalar(camera.far * 0.95);
      const floods = lights.filter((l) => l.isSpotLight);
      const key = floods.map((l) => l.uuid).join();
      if (key !== builtFor) { builtFor = key; buildMasts(floods); }
      for (const l of floods) {
        if (spilled.has(l)) continue;
        spilled.add(l);
        l.angle = Math.max(l.angle, SPILL.angle);
        l.penumbra = Math.max(l.penumbra, SPILL.penumbra);
        stat.spill += 1;
      }
    },
    state: () => ({ ...stat }),
    dispose() {
      scene.remove(root);
      if (scene.fog && fogWas) scene.fog.color.copy(fogWas);
      scene.background = bgWas;
      halo.dispose(); skyMat.dispose(); sky.geometry.dispose();
    },
  };
}
