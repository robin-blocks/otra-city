// Third-person controller (WASD or an analog stick) with raycast collision
// against the loaded shop geometry itself — no separate collider data. The
// shop is axis-aligned, so per-axis movement + ray clamping gives natural
// wall sliding.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight',
]);

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

    // chase camera: target follows, camera keeps its user-orbited offset
    this.followPos.lerp(new THREE.Vector3(this.pos.x, this.pos.y + 1.15, this.pos.z), 1 - Math.exp(-10 * dt));
    const delta = new THREE.Vector3().subVectors(this.followPos, this.controls.target);
    this.controls.target.copy(this.followPos);
    this.camera.position.add(delta);

    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.avatar.update(dt, speed, time);
    return speed;
  }
}
