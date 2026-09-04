// Third-person controller (WASD or an analog stick) with raycast collision
// against the loaded shop geometry itself — no separate collider data. The
// shop is axis-aligned, so per-axis movement + ray clamping gives natural
// wall sliding.
//
// The camera is two things that must not be confused: the RIG the visitor
// orbits and zooms (OrbitControls owns it, and `update` hands it over each
// frame), and the position the camera is actually rendered from once the
// world has had its say (`updateCamera`, which the page calls AFTER
// controls.update). Keeping them apart is what stops a doorway from
// rewriting the distance the visitor chose. See the block above the occlusion
// probe for why.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

export const CAM = {
  probe: 0.26,      // half-width of the occlusion probe: the camera is a box,
                    // not a line — half an avatar, the same scale as the body
                    // that would otherwise be inside the wall
  pad: 0.3,         // stand-off from whatever the probe hit
  hold: 0.5,        // seconds a pull-in survives after the view looks clear
  tighten: 20,      // how fast the camera closes on a goal inside the stand-off
  release: 5,       // and eases back out
  out: 2.0,         // metres a second: the cap on coming back out
  // First person is the bottom of the zoom range rather than a mode with
  // controls of its own: the rig keeps orbiting, and at or below fpEnter the
  // camera is simply drawn from the visitor's eyes instead of from the rig.
  //
  // Going IN is a distance: minZoom is controls.minDistance, the rig's floor
  // and also the floor a wall may push the camera to, and fpEnter sits
  // comfortably above it so the mode arrives however coarse the visitor's
  // wheel is — sitting the trigger exactly ON the floor made entry a question
  // of which way a float rounded.
  //
  // Coming OUT is a DIRECTION, not a distance, and the difference is the whole
  // bug. A threshold a little above the floor sounds equivalent: it is not.
  // A trackpad moves the distance a fraction of a percent per event, so
  // leaving took up to 28 of them (measured: 1 on a mouse notch, 3 on a firm
  // swipe, 28 on a gentle one) — and what it handed back was a camera 0.74 m
  // behind the visitor's eyes, which is the inside of their own head and reads
  // as nothing having happened. So ANY growth in the rig since the last frame
  // is the visitor asking to come out, whatever their device sends, and they
  // land at fpBack: far enough to see themselves, near enough that it reads as
  // a step backwards rather than a jump.
  minZoom: 0.7,
  fpEnter: 0.72,
  fpBack: 2.2,
  eye: 0.06,        // first-person eye above the follow target (the visor)
  // In first person the orbit angle IS the pitch, and it runs the other way —
  // a rig above the head looks DOWN. The third-person limits keep the rig out
  // of the pavement; these are +-64 degrees of look, and are swapped in and
  // out with the mode.
  fpPolar: [0.45, 2.7],
};

export class PlayerController {
  constructor(avatar, camera, controls) {
    this.avatar = avatar;
    this.camera = camera;
    this.controls = controls;
    this.pos = avatar.group.position; // feet
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI; // face -z (toward the shop) at spawn
    this.keys = new Set();
    this.stick = new THREE.Vector2(); // analog input: x right, y forward, unit disc
    this.colliders = [];   // the world: ground, street, plots
    this.extra = [];       // added and removed at runtime (venues)
    this.all = [];
    this.enabled = false;
    this.ray = new THREE.Raycaster();
    this.radius = 0.28;
    this.rayHeights = [0.35, 0.95, 1.45]; // shins, hips, head — catches plinth/planks/bolt
    this.walkSpeed = 3.2;
    this.runSpeed = 5.6;
    this.followPos = new THREE.Vector3();
    // The camera, as three separate facts:
    //   camDir   which way the rig points, unit, target -> camera
    //   camWant  how far back the VISITOR asked to be. Only the orbit
    //            controls ever change it; no wall may.
    //   camDist  how far back the camera actually is, after the world
    this.camDir = new THREE.Vector3(0, 0, 1);
    this.camWant = 4.6;
    this.camDist = 4.6;
    this.camHold = 0;          // seconds left on the current pull-in
    this.camClear = Infinity;  // the closest thing the probe has seen lately
    this.camRigLast = 4.6;     // the rig distance as of the last frame's end
    this.camWrote = new THREE.Vector3(NaN, NaN, NaN);  // where we last put it
    this.firstPerson = false;
    this.orbitPolar = null;    // the third-person polar limits, while in first
    // scratch, so the per-frame camera work allocates nothing. 0..3 belong to
    // probeCamera; 4 is everyone else's, so no caller has to know.
    this._v = [0, 1, 2, 3, 4].map(() => new THREE.Vector3());
    // How far a visitor may wander: a { x, z } box, or an (x, z) => boolean
    // for a world that is no longer a rectangle — the city passes
    // world.contains once roads and venues are in, and that predicate is
    // built from the street's own extent. The default is the street
    // otra.city launched with, so this module stands alone.
    this.bounds = { x: 40, z: 40 };

    addEventListener('keydown', (e) => {
      if (KEYS.has(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  // Touch joystick feed. Push to the rim to run; below the dead zone it's idle.
  setStick(x, y) {
    this.stick.set(x, y);
    if (this.stick.length() < 0.12) this.stick.set(0, 0);
    else if (this.stick.length() > 1) this.stick.normalize();
  }

  setColliders(list) {
    this.colliders = list;
    this.all = [...this.colliders, ...this.extra];
    this.enabled = true;
    this.followPos.set(this.pos.x, this.pos.y + 1.15, this.pos.z);
    this.controls.target.copy(this.followPos);
    this.aimCamera();
  }

  // First person, as an orbit rig: the camera sits at the visitor's eyes and
  // the ORBIT TARGET moves camWant metres in front of them.
  //
  // The obvious arrangement — camera on the target, look along -camDir — is
  // the one that does not work. OrbitControls runs its own update() from
  // inside its wheel and pointer handlers, between our frames, and it rebuilds
  // its angles from whatever `camera.position - target` happens to be; a
  // camera sitting ON its target is a zero-length offset, so every scroll and
  // every drag arrived with the look angle already collapsed onto a limit and
  // the zoom clamped back up off the floor. With the target ahead the offset
  // is honest — radius camWant, direction camDir — and because the pair is
  // rebuilt from camDir every frame, orbiting it turns the visitor in place.
  eyeRig() {
    this.camera.position.copy(this.followPos).addScaledVector(UP, CAM.eye);
    this.controls.target.copy(this.camera.position).addScaledVector(this.camDir, -this.camWant);
    this.camera.lookAt(this.controls.target);
  }

  // Read the rig back off the camera: which way it points and how far back the
  // visitor has it. OrbitControls calls its own update() from inside its
  // pointer and wheel handlers, so between our frames the camera moves — and
  // that movement is the visitor's input, not something to overwrite.
  readRig() {
    const eye = this._v[4].subVectors(this.camera.position, this.controls.target);
    const d = eye.length();
    if (d <= 1e-4) return;
    this.camDir.copy(eye).divideScalar(d);
    this.camWant = d;
  }

  // Take the camera's current position as the rig, and forget everything the
  // last one had learned about walls. The page calls this after placing a shot
  // by hand — a spawn, a permalink establishing shot, a teleport in the client
  // check — because otherwise the next frame would put the camera back where
  // the old rig said, at the distance the old room allowed.
  aimCamera() {
    this.readRig();
    this.camDist = this.camWant;
    this.camClear = Infinity;
    this.camHold = 0;
    // a hand-placed shot is the rig, not a scroll: it must not read as the
    // visitor asking to leave first person, and it decides the mode itself
    this.camRigLast = this.camWant;
    this.setFirstPerson(this.camWant <= CAM.fpEnter);
  }

  // First person is the bottom of the zoom range, not a mode with controls of
  // its own: the visitor scrolls in past CAM.fpEnter and the camera becomes
  // their eyes, keeping the orbit as the look direction. The head goes with
  // it — at the visor you would otherwise be inside your own skull — and the
  // body stays, because looking down at it is most of what makes the view
  // feel like standing somewhere.
  setFirstPerson(on) {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    if (this.avatar.setFirstPerson) this.avatar.setFirstPerson(on);
    const c = this.controls;
    if (on) {
      this.orbitPolar = [c.minPolarAngle, c.maxPolarAngle];
      [c.minPolarAngle, c.maxPolarAngle] = CAM.fpPolar;
    } else if (this.orbitPolar) {
      [c.minPolarAngle, c.maxPolarAngle] = this.orbitPolar;
      this.orbitPolar = null;
    }
  }

  addColliders(list) {
    this.extra.push(...list);
    this.all = [...this.colliders, ...this.extra];
  }

  removeColliders(list) {
    const drop = new Set(list);
    this.extra = this.extra.filter((c) => !drop.has(c));
    this.all = [...this.colliders, ...this.extra];
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  inBounds(x, z) {
    const b = this.bounds;
    return typeof b === 'function' ? b(x, z) : Math.abs(x) <= b.x && Math.abs(z) <= b.z;
  }

  castAxis(dir, dist) {
    let allowed = dist;
    for (const h of this.rayHeights) {
      this.ray.set(new THREE.Vector3(this.pos.x, this.pos.y + h, this.pos.z), dir);
      this.ray.far = dist + this.radius;
      const hit = this.ray.intersectObjects(this.all, false)[0];
      if (hit) allowed = Math.min(allowed, Math.max(0, hit.distance - this.radius));
    }
    return allowed;
  }

  // The closest the camera may sit along `camDir` without the world getting
  // into the lens, or Infinity if the view is clear all the way back to where
  // the visitor asked to be.
  //
  // Two things here are the difference between a camera that works indoors
  // and the one that used to strobe:
  //
  //   * The probe reaches to the distance the visitor WANTS, never to where
  //     the camera currently is. A ray that stops at a camera already pulled
  //     in to a metre cannot see the wall two metres out that pulled it in;
  //     it reports a clear view, the camera eases back, hits the wall again,
  //     and the shot oscillates for as long as you stand in the room.
  //   * It is a bundle, not a line. A doorway edge, the gap between two
  //     treads, a rail with air under it — a single ray threads all of them
  //     and reports open sky from inside a wall for the odd frame. The
  //     offsets are half an avatar apart at the camera end and converge on
  //     the visitor, so the probe is the cone an avatar-sized camera sweeps.
  probeCamera(want) {
    const [dir, right, up, tmp] = this._v;
    right.crossVectors(this.camDir, UP);
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);   // looking straight down
    right.normalize();
    up.crossVectors(right, this.camDir).normalize();
    const t = this.controls.target;
    let clear = Infinity;
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      dir.copy(this.camDir).multiplyScalar(want)
        .addScaledVector(right, ox * CAM.probe)
        .addScaledVector(up, oy * CAM.probe);
      const reach = dir.length();
      dir.divideScalar(reach);
      this.ray.set(tmp.copy(t), dir);
      this.ray.far = reach;
      const hit = this.ray.intersectObjects(this.all, false)[0];
      // along the rig, not along this ray: an off-axis ray runs further for
      // the same stand-off, and using its raw distance would let the camera
      // creep into the surface the outer rays found
      if (hit) clear = Math.min(clear, hit.distance * dir.dot(this.camDir) - CAM.pad);
    }
    return clear;
  }

  // Resolve the camera against the world. The page calls this AFTER
  // controls.update(), so what it reads is the visitor's own orbit and zoom
  // with nothing of last frame's wall in it, and what it writes is the last
  // word before the frame is drawn.
  updateCamera(dt) {
    const target = this.controls.target;
    const eye = this._v[4].subVectors(this.camera.position, target);
    const d = eye.length();
    if (d > 1e-4) {
      this.camDir.copy(eye).divideScalar(d);
      this.camWant = d;
    }
    if (this.firstPerson) {
      if (this.camWant > this.camRigLast + 1e-4) {   // scrolled OUT, any amount
        this.setFirstPerson(false);
        this.camWant = CAM.fpBack;
      }
    } else if (this.camWant <= CAM.fpEnter) {
      this.setFirstPerson(true);
    }
    if (this.firstPerson) {
      this.camDist = 0;
      this.eyeRig();
    } else {
      this.controls.target.copy(this.followPos);   // no-op except on the way out
      const want = Math.max(CAM.minZoom, this.camWant);
      const clear = this.enabled ? this.probeCamera(want) : Infinity;
      const allowed = Math.max(CAM.minZoom, Math.min(want, clear));
      // A pull-in is held for a moment after the probe next says "clear": a
      // door leaf sweeping past, a peer crossing behind you or a tread the
      // bundle only half catches would otherwise let the camera start back
      // out and be slapped in again, which is the jerk itself.
      if (allowed <= this.camClear) {
        this.camClear = allowed;
        this.camHold = CAM.hold;
      } else if ((this.camHold -= dt) <= 0) {
        this.camClear = allowed;
      }
      // Coming out is capped at a WALKING PACE. It used to be a plain
      // proportional ease, which means the further out the camera wants to
      // be the faster it goes — so walking along a colonnade, where a column
      // crosses the lens about twice a second, the camera slammed in 3.3 m,
      // glided back out 1.2 m and was slammed in again, over and over. That
      // sawtooth is what a visitor calls shudder. A cap plus a longer hold
      // turns the same geometry into a breath of about 20 cm.
      //
      // Going in stays immediate when a wall arrives all at once, because a
      // frame of wall interior is worse than any jump. Only that: the probe
      // keeps CAM.pad of stand-off from whatever it hit, so a goal inside
      // that margin is still short of the surface and can be eased to.
      const goal = this.camClear;
      if (goal < this.camDist) {
        this.camDist = goal < this.camDist - CAM.pad
          ? goal
          : THREE.MathUtils.lerp(this.camDist, goal, 1 - Math.exp(-CAM.tighten * dt));
      } else {
        const eased = THREE.MathUtils.lerp(this.camDist, goal, 1 - Math.exp(-CAM.release * dt));
        this.camDist = Math.min(eased, this.camDist + CAM.out * dt);
      }
      this.camera.position.copy(target).addScaledVector(this.camDir, this.camDist);
    }
    this.camRigLast = this.camWant;
    this.camWrote.copy(this.camera.position);
  }

  update(dt, time) {
    const k = (c) => this.keys.has(c);
    let iz = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
    let ix = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let maxSpeed = k('ShiftLeft') || k('ShiftRight') ? this.runSpeed : this.walkSpeed;
    if (!iz && !ix && this.stick.lengthSq() > 0) {
      // keys win when both are present; the stick walks, and runs at the rim
      ix = this.stick.x;
      iz = this.stick.y;
      maxSpeed = THREE.MathUtils.lerp(this.walkSpeed, this.runSpeed,
        THREE.MathUtils.smoothstep(this.stick.length(), 0.7, 1));
    }

    const desired = new THREE.Vector3();
    if (this.enabled && (iz || ix)) {
      const fwd = this.camera.getWorldDirection(new THREE.Vector3());
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, UP);
      desired.addScaledVector(fwd, iz).addScaledVector(right, ix).normalize();
      desired.multiplyScalar(maxSpeed);
      this.yaw = Math.atan2(desired.x, desired.z);
    }
    this.vel.lerp(desired, 1 - Math.exp(-12 * dt));
    if (this.vel.lengthSq() < 1e-4) this.vel.set(0, 0, 0);

    // per-axis move with ray clamping (axis-aligned world -> free wall sliding)
    const mx = this.vel.x * dt;
    const mz = this.vel.z * dt;
    // an axis move that would leave the walkable world is dropped, which
    // slides you along its edge exactly like a wall
    if (mx) {
      const nx = this.pos.x + Math.sign(mx) * this.castAxis(new THREE.Vector3(Math.sign(mx), 0, 0), Math.abs(mx));
      if (this.inBounds(nx, this.pos.z)) this.pos.x = nx;
    }
    if (mz) {
      const nz = this.pos.z + Math.sign(mz) * this.castAxis(new THREE.Vector3(0, 0, Math.sign(mz)), Math.abs(mz));
      if (this.inBounds(this.pos.x, nz)) this.pos.z = nz;
    }

    // ground snap (handles the 0.25 m floor slab + runway lip as walkable steps)
    if (this.enabled) {
      this.ray.set(new THREE.Vector3(this.pos.x, this.pos.y + 1.6, this.pos.z), DOWN);
      this.ray.far = 4;
      const hit = this.ray.intersectObjects(this.all, false)[0];
      const gy = hit ? hit.point.y : 0;
      if (gy - this.pos.y < 0.45) this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-25 * dt));
    }

    // face movement direction (shortest arc)
    const cur = this.avatar.group.rotation.y;
    let d = this.yaw - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.avatar.group.rotation.y = cur + d * (1 - Math.exp(-14 * dt));

    // Chase camera, first half: the target follows the visitor and the RIG is
    // handed to OrbitControls at the distance the visitor asked for — never at
    // the one a wall imposed last frame. The world gets its say in
    // updateCamera(), which the page calls after controls.update().
    //
    // Anything that moved the camera since we last wrote it — a drag, a
    // scroll, a spawn, a teleport from the client check — is the rig now.
    if (!this.camera.position.equals(this.camWrote)) this.readRig();
    this.followPos.lerp(this._v[4].set(this.pos.x, this.pos.y + 1.15, this.pos.z), 1 - Math.exp(-10 * dt));
    if (this.firstPerson) {
      this.eyeRig();
    } else {
      this.controls.target.copy(this.followPos);
      this.camera.position.copy(this.controls.target).addScaledVector(this.camDir, this.camWant);
    }

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.avatar.update(dt, speed, time);
    return speed;
  }
}
