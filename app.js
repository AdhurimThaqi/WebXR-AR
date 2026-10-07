/* =====================================================================
   The Aether Artifact – WebXR AR experience built with A-Frame
   ---------------------------------------------------------------------
   This file has four parts:

     1. Shared state + small helpers
     2. Sound effects (Web Audio API, no audio files needed)
     3. A-Frame components (visuals + the AR placement logic)
     4. Page / UI logic (landing screen, AR buttons, QR code section)

   index.html loads this file in <head>, after A-Frame and before the
   <a-scene> is parsed, so every component below is registered in time.
   ===================================================================== */


/* =====================================================================
   1. SHARED STATE + HELPERS
   ===================================================================== */

// One small object that every component can read.
// energy goes smoothly from 0 (idle) to 1 (activated); components use
// it to scale glow, speed, fragment distance, particle speed, etc.
const ArtifactState = {
  active: false,      // what the user asked for
  targetEnergy: 0,    // 0 or 1
  energy: 0           // smoothed value actually used for animation
};

const lerp = (a, b, t) => a + (b - a) * t;

// A-Frame gives tick() a delta in ms. After a pause (tab switch, entering
// AR) it can be huge, so we cap it to avoid objects jumping.
const seconds = (dtMs) => Math.min(dtMs || 0, 100) / 1000;

// Soft round "glow" texture drawn on a canvas (used by particles and glows).
let glowTexture = null;
function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

// Procedural stone texture (speckles, blotches and a few cracks).
// Generated once and shared by all stone parts – no image files needed.
let stoneTexture = null;
function getStoneTexture() {
  if (stoneTexture) return stoneTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#cfcfcf';
  ctx.fillRect(0, 0, size, size);

  // Dark and light blotches (weathering)
  for (let i = 0; i < 45; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 10 + Math.random() * 35;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const dark = Math.random() < 0.6;
    g.addColorStop(0, dark ? 'rgba(60,60,60,0.18)' : 'rgba(255,255,255,0.15)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Fine grain
  for (let i = 0; i < 6000; i++) {
    const v = (120 + Math.random() * 135) | 0;
    ctx.fillStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }

  // Thin cracks (random walks)
  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    let x = Math.random() * size, y = Math.random() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) {
      x += (Math.random() - 0.5) * 22;
      y += Math.random() * 14;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  stoneTexture = new THREE.CanvasTexture(canvas);
  stoneTexture.wrapS = stoneTexture.wrapT = THREE.RepeatWrapping;
  stoneTexture.colorSpace = THREE.SRGBColorSpace;
  stoneTexture.anisotropy = 4;
  return stoneTexture;
}


/* =====================================================================
   2. SOUND EFFECTS (Web Audio API)
   All sounds are synthesised from oscillators and noise, so the
   project needs no audio files. Browsers only allow audio after a user
   gesture, so unlock() is called from the "Enter AR" button click.
   ===================================================================== */

const Sound = {
  ctx: null,
  master: null,

  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;                       // no Web Audio: stay silent
    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  // A single oscillator "sweep" with a smooth volume envelope.
  tone(from, to, duration, type = 'sine', volume = 0.2, delay = 0) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  },

  // Filtered white noise = "whoosh".
  whoosh(duration, volume, fromHz, toHz) {
    const t = this.ctx.currentTime;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(fromHz, t);
    filter.frequency.exponentialRampToValueAtTime(toHz, t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  },

  play(name) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    switch (name) {
      case 'place':
        this.tone(180, 90, 0.4, 'sine', 0.35);
        this.tone(880, 660, 0.3, 'triangle', 0.05, 0.02);
        break;
      case 'activate':
        this.tone(160, 640, 0.9, 'triangle', 0.16);
        this.tone(320, 1280, 0.9, 'sine', 0.10, 0.05);
        this.tone(1400, 2800, 0.7, 'sine', 0.04, 0.3);
        this.whoosh(1.0, 0.25, 300, 3000);
        break;
      case 'deactivate':
        this.tone(700, 160, 0.8, 'triangle', 0.14);
        this.tone(1050, 350, 0.6, 'sine', 0.05, 0.05);
        break;
      case 'reset':
        this.tone(520, 260, 0.25, 'sine', 0.12);
        break;
    }
  }
};


/* =====================================================================
   3. A-FRAME COMPONENTS
   ===================================================================== */

/* ---------------------------------------------------------------------
   simple-environment (on <a-scene>)
   Builds a soft studio-like environment map so metal and gold parts
   have reflections. Without it, metallic materials look almost black.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('simple-environment', {
  init() {
    const build = () => {
      const envScene = new THREE.Scene();

      // Big sphere with a vertical colour gradient (light sky, warm floor)
      const geo = new THREE.SphereGeometry(10, 32, 16);
      const top = new THREE.Color('#e4ecff');
      const mid = new THREE.Color('#4d5361');
      const bottom = new THREE.Color('#2b241f');
      const c = new THREE.Color();
      const colors = [];
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / 10;               // -1 (bottom) .. 1 (top)
        if (t > 0) c.lerpColors(mid, top, t); else c.lerpColors(mid, bottom, -t);
        colors.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

      // Two "softbox" panels that create highlights on metal
      const warm = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), new THREE.MeshBasicMaterial({ color: 0xfff2dd, side: THREE.DoubleSide }));
      warm.position.set(5, 6, 3);
      warm.lookAt(0, 0, 0);
      const cool = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ color: 0x9fe9ff, side: THREE.DoubleSide }));
      cool.position.set(-6, 2, -4);
      cool.lookAt(0, 0, 0);
      envScene.add(warm, cool);

      const pmrem = new THREE.PMREMGenerator(this.el.renderer);
      this.el.object3D.environment = pmrem.fromScene(envScene, 0.04).texture;
      pmrem.dispose();
    };

    if (this.el.renderer) build();
    else this.el.addEventListener('renderstart', build, { once: true });
  }
});

/* ---------------------------------------------------------------------
   procedural-stone
   Adds the shared stone texture (colour + bump) to an entity's material.
   Done in the first tick, because by then A-Frame has created the final
   material for the entity.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('procedural-stone', {
  tick() {
    if (this.applied) return;
    const mesh = this.el.getObject3D('mesh');
    if (!mesh || !mesh.material) return;
    const tex = getStoneTexture();
    mesh.material.map = tex;
    mesh.material.bumpMap = tex;
    mesh.material.bumpScale = 0.6;
    mesh.material.needsUpdate = true;
    this.applied = true;
  }
});

/* ---------------------------------------------------------------------
   spin – rotates an entity; spins faster while the artifact is active.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('spin', {
  schema: {
    axis: { default: 'y', oneOf: ['x', 'y', 'z'] },
    speed: { default: 30 },     // degrees per second (negative = reverse)
    boost: { default: 4 }       // extra speed multiplier at full energy
  },
  tick(time, dt) {
    const d = this.data;
    const multiplier = 1 + d.boost * ArtifactState.energy;
    this.el.object3D.rotation[d.axis] += THREE.MathUtils.degToRad(d.speed) * multiplier * seconds(dt);
  }
});

/* ---------------------------------------------------------------------
   preview-turntable – slowly turns the model on the landing page.
   In AR it stops, so the placed object keeps a stable orientation.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('preview-turntable', {
  schema: { speed: { default: 14 } },
  tick(time, dt) {
    if (this.el.sceneEl.is('ar-mode')) return;
    this.el.object3D.rotation.y += THREE.MathUtils.degToRad(this.data.speed) * seconds(dt);
  }
});

/* ---------------------------------------------------------------------
   orbit-fragment – a floating fragment that circles the crystal,
   bobs up and down and tumbles. When active it drifts outward and up.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('orbit-fragment', {
  schema: {
    radius: { default: 0.2 },   // orbit radius in metres
    height: { default: 0.3 },   // height above the floor
    angle: { default: 0 },      // start angle in degrees
    speed: { default: 14 },     // orbit speed in degrees per second
    bob: { default: 0.012 },    // up/down amplitude
    push: { default: 0.13 },    // extra radius at full energy
    lift: { default: 0.05 }     // extra height at full energy
  },
  init() {
    this.angle = THREE.MathUtils.degToRad(this.data.angle);
    this.phase = Math.random() * Math.PI * 2;
    this.tumble = new THREE.Vector3(Math.random() + 0.3, Math.random() + 0.3, Math.random() * 0.5);
  },
  tick(time, dt) {
    const d = this.data;
    const s = seconds(dt);
    const e = ArtifactState.energy;
    const obj = this.el.object3D;

    this.angle += THREE.MathUtils.degToRad(d.speed) * (1 + 2.5 * e) * s;
    const r = d.radius + d.push * e;
    const y = d.height + d.lift * e + Math.sin(time / 1000 * 1.3 + this.phase) * d.bob;
    obj.position.set(Math.cos(this.angle) * r, y, Math.sin(this.angle) * r);

    const tumbleSpeed = 0.8 * (1 + 3 * e) * s;
    obj.rotation.x += this.tumble.x * tumbleSpeed;
    obj.rotation.y += this.tumble.y * tumbleSpeed;
    obj.rotation.z += this.tumble.z * tumbleSpeed;
  }
});

/* ---------------------------------------------------------------------
   energy-particles – small glowing motes rising around the crystal
   (one THREE.Points object = one draw call, cheap on mobile).
   --------------------------------------------------------------------- */
AFRAME.registerComponent('energy-particles', {
  schema: {
    count: { default: 90 },
    radius: { default: 0.17 },
    bottom: { default: 0.05 },
    top: { default: 0.62 },
    color: { type: 'color', default: '#8ff8ff' },
    size: { default: 0.011 }
  },
  init() {
    const d = this.data;
    this.positions = new Float32Array(d.count * 3);
    this.particles = [];
    for (let i = 0; i < d.count; i++) {
      this.particles.push(this.spawn({}, true));
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: new THREE.Color(d.color),
      size: d.size,
      map: getGlowTexture(),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;          // positions change every frame
    this.el.setObject3D('particles', this.points);
  },
  // Give a particle a new random start (anywhere on first spawn, else at the bottom).
  spawn(p, anywhere) {
    const d = this.data;
    p.angle = Math.random() * Math.PI * 2;
    p.radius = 0.02 + Math.random() * d.radius;
    p.y = anywhere ? lerp(d.bottom, d.top, Math.random()) : d.bottom;
    p.speed = 0.03 + Math.random() * 0.06;      // metres per second
    p.swirl = (Math.random() - 0.5) * 1.2;      // radians per second
    return p;
  },
  tick(time, dt) {
    const d = this.data;
    const s = seconds(dt);
    const e = ArtifactState.energy;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.y += p.speed * (1 + 3 * e) * s;
      p.angle += p.swirl * (1 + 2 * e) * s;
      if (p.y > d.top) this.spawn(p, false);
      const r = p.radius * (1 + 0.5 * e);
      this.positions[i * 3] = Math.cos(p.angle) * r;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = Math.sin(p.angle) * r;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.material.opacity = lerp(0.6, 1, e);
    this.material.size = d.size * (1 + 0.7 * e);
  },
  remove() {
    this.el.removeObject3D('particles');
    this.points.geometry.dispose();
    this.material.dispose();
  }
});

/* ---------------------------------------------------------------------
   soft-glow – a soft radial glow. Either a camera-facing sprite (halo
   around the crystal) or a flat disc on the floor (flat: true).
   Size and opacity blend towards the "active" values with energy.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('soft-glow', {
  schema: {
    color: { type: 'color', default: '#3fe8ff' },
    size: { default: 0.3 },
    opacity: { default: 0.5 },
    activeSize: { default: -1 },     // -1 = same as size
    activeOpacity: { default: -1 },  // -1 = same as opacity
    flat: { default: false },
    additive: { default: true }
  },
  init() {
    const d = this.data;
    const params = {
      map: getGlowTexture(),
      color: new THREE.Color(d.color),
      transparent: true,
      opacity: d.opacity,
      depthWrite: false,
      blending: d.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    };
    if (d.flat) {
      this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(params));
      this.glow.rotation.x = -Math.PI / 2;      // lie flat on the ground
    } else {
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial(params));
    }
    this.el.setObject3D('glow', this.glow);
  },
  tick(time) {
    const d = this.data;
    const e = ArtifactState.energy;
    const size = lerp(d.size, d.activeSize < 0 ? d.size : d.activeSize, e);
    let opacity = lerp(d.opacity, d.activeOpacity < 0 ? d.opacity : d.activeOpacity, e);
    if (d.additive) opacity *= 0.9 + 0.1 * Math.sin(time * 0.005);   // gentle flicker
    this.glow.scale.set(size, size, 1);
    this.glow.material.opacity = opacity;
  },
  remove() {
    this.el.removeObject3D('glow');
    this.glow.material.dispose();
  }
});

/* ---------------------------------------------------------------------
   shadow-catcher – an invisible floor disc that only shows shadows.
   In AR this makes the artifact cast a shadow onto the real floor.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('shadow-catcher', {
  schema: {
    radius: { default: 0.6 },
    opacity: { default: 0.4 }
  },
  init() {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(this.data.radius, 48),
      new THREE.ShadowMaterial({ opacity: this.data.opacity })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.el.setObject3D('mesh', mesh);
  }
});

/* ---------------------------------------------------------------------
   artifact-energy (on #artifact)
   Smoothly moves ArtifactState.energy towards its target and drives the
   materials that react to it: crystal glow + colour, rune glow, light.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('artifact-energy', {
  init() {
    this.idleColor = new THREE.Color('#00b4e6');
    this.activeColor = new THREE.Color('#a8fdff');
    this.parts = null;
  },
  // Find the meshes/materials once they exist (child entities load after init).
  findParts() {
    const crystal = this.el.querySelector('#crystal').getObject3D('mesh');
    const core = this.el.querySelector('#crystal-core').getObject3D('mesh');
    const light = this.el.querySelector('#crystal-light').getObject3D('light');
    const runes = Array.from(this.el.querySelectorAll('.rune')).map((el) => el.getObject3D('mesh'));
    if (!crystal || !core || !light || runes.some((m) => !m)) return null;
    return {
      crystal: crystal.material,
      core: core.material,
      light,
      runes: runes.map((m) => m.material)
    };
  },
  tick(time, dt) {
    // 1. Smooth the energy value (exponential ease, frame-rate independent)
    const k = 1 - Math.exp(-3.5 * seconds(dt));
    ArtifactState.energy += (ArtifactState.targetEnergy - ArtifactState.energy) * k;
    const e = ArtifactState.energy;

    // 2. Apply it to the glowing materials
    if (!this.parts) this.parts = this.findParts();
    if (!this.parts) return;
    const pulse = 1 + 0.08 * Math.sin(time * 0.004);
    this.parts.crystal.emissive.lerpColors(this.idleColor, this.activeColor, e);
    this.parts.crystal.emissiveIntensity = lerp(1.1, 3.2, e) * pulse;
    this.parts.core.emissiveIntensity = lerp(2.5, 7, e) * pulse;
    this.parts.light.intensity = lerp(0.04, 0.16, e) * pulse;
    const runeIntensity = lerp(1.2, 3.6, e) * (0.92 + 0.08 * Math.sin(time * 0.003));
    for (const m of this.parts.runes) m.emissiveIntensity = runeIntensity;
  }
});

/* ---------------------------------------------------------------------
   ar-placement – the core WebXR logic.

   On entering AR:
     - asks the session for a "viewer" reference space and creates a
       hit-test source (a ray from the centre of the screen).
   Every frame (tick):
     - reads the hit-test results, shows the reticle on horizontal
       surfaces, and places the artifact when the user has tapped.
     - if an anchor exists, keeps the artifact on the anchor's pose.
   On every screen tap (WebXR "select" event):
     - before placement: request placement at the reticle.
     - after placement: cast a ray from the tap; if it hits the crystal,
       toggle the artifact.
   --------------------------------------------------------------------- */
AFRAME.registerComponent('ar-placement', {
  schema: {
    target: { type: 'selector' },     // the artifact entity
    reticle: { type: 'selector' },    // the placement ring
    hitProxy: { type: 'selector' },   // invisible sphere around the crystal
    camera: { type: 'selector' }
  },

  init() {
    this.session = null;
    this.hitTestSource = null;
    this.placed = false;
    this.placeRequested = false;
    this.anchor = null;
    this.state = '';
    this.hasDomOverlay = true;

    // Re-used objects (avoid creating garbage every frame)
    this.hitPosition = new THREE.Vector3();
    this.hitQuaternion = new THREE.Quaternion();
    this.up = new THREE.Vector3();
    this.raycaster = new THREE.Raycaster();
    this.rayOrigin = new THREE.Vector3();
    this.rayDirection = new THREE.Vector3();
    this.rayQuaternion = new THREE.Quaternion();

    this.onEnterXR = this.onEnterXR.bind(this);
    this.onExitXR = this.onExitXR.bind(this);
    this.onSelect = this.onSelect.bind(this);
    this.el.sceneEl.addEventListener('enter-vr', this.onEnterXR);
    this.el.sceneEl.addEventListener('exit-vr', this.onExitXR);
  },

  remove() {
    this.el.sceneEl.removeEventListener('enter-vr', this.onEnterXR);
    this.el.sceneEl.removeEventListener('exit-vr', this.onExitXR);
  },

  async onEnterXR() {
    const sceneEl = this.el.sceneEl;
    if (!sceneEl.is('ar-mode')) return;               // only handle AR sessions

    this.session = sceneEl.xrSession;
    this.session.addEventListener('select', this.onSelect);
    this.hasDomOverlay = !!this.session.domOverlayState;

    // Remember the landing-page preview pose so exiting AR can restore it.
    const camera = this.data.camera.object3D;
    const target = this.data.target.object3D;
    this.previewPose = {
      cameraPosition: camera.position.clone(),
      cameraRotation: camera.rotation.clone(),
      targetPosition: target.position.clone()
    };

    // Start AR with the artifact hidden – it only appears after placement.
    camera.position.set(0, 0, 0);
    this.data.target.object3D.rotation.set(0, 0, 0);
    this.data.target.querySelector('#artifact-model').object3D.rotation.set(0, 0, 0);
    this.resetPlacement({ silent: true });

    try {
      // "viewer" space = the phone itself; the hit-test ray goes straight
      // out of the centre of the screen.
      const viewerSpace = await this.session.requestReferenceSpace('viewer');
      this.hitTestSource = await this.session.requestHitTestSource({ space: viewerSpace });
    } catch (err) {
      console.error('Hit test could not be started:', err);
      this.setState('no-hit-test');
    }
  },

  onExitXR() {
    if (this.session) this.session.removeEventListener('select', this.onSelect);
    if (this.hitTestSource) this.hitTestSource.cancel();
    this.hitTestSource = null;
    this.session = null;
    this.deleteAnchor();
    this.placed = false;
    this.placeRequested = false;
    this.data.reticle.object3D.visible = false;
    setArtifactActive(false, { silent: true });
    this.state = '';

    // Back to the landing-page preview
    const target = this.data.target.object3D;
    target.rotation.set(0, 0, 0);
    target.visible = true;
    if (this.previewPose) {
      target.position.copy(this.previewPose.targetPosition);
      this.data.camera.object3D.position.copy(this.previewPose.cameraPosition);
      this.data.camera.object3D.rotation.copy(this.previewPose.cameraRotation);
    }
  },

  // Called by the Reset button (and when AR starts).
  resetPlacement({ silent = false } = {}) {
    this.deleteAnchor();
    this.placed = false;
    this.placeRequested = false;
    this.data.target.object3D.visible = false;
    setArtifactActive(false, { silent: true });
    this.setState('searching');
    if (!silent) Sound.play('reset');
  },

  deleteAnchor() {
    if (this.anchor) {
      try { this.anchor.delete(); } catch (e) { /* already gone */ }
    }
    this.anchor = null;
  },

  // Tell the UI what is going on (only when the state really changes).
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.el.sceneEl.emit('ar-state', { state });
  },

  // ---- The tap handler (WebXR "select" event) ----
  onSelect(evt) {
    if (!this.placed) {
      this.placeRequested = true;          // handled in the next tick()
      return;
    }

    // Build a ray from the tap position (the input source's target ray).
    const refSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();
    const pose = evt.frame.getPose(evt.inputSource.targetRaySpace, refSpace);
    if (!pose) return;
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    this.rayOrigin.set(p.x, p.y, p.z);
    this.rayQuaternion.set(q.x, q.y, q.z, q.w);
    this.rayDirection.set(0, 0, -1).applyQuaternion(this.rayQuaternion);
    this.raycaster.set(this.rayOrigin, this.rayDirection);

    const hits = this.raycaster.intersectObject(this.data.hitProxy.object3D, true);
    if (hits.length > 0) {
      toggleArtifact();
    } else if (!this.hasDomOverlay) {
      // Without DOM overlay there is no Reset button, so tapping
      // somewhere else moves the artifact instead.
      this.resetPlacement();
      this.placeRequested = true;
    }
  },

  // ---- Every frame ----
  tick() {
    const sceneEl = this.el.sceneEl;
    const frame = sceneEl.frame;                 // current XRFrame (set by A-Frame)
    if (!sceneEl.is('ar-mode') || !frame) return;
    const refSpace = sceneEl.renderer.xr.getReferenceSpace();

    // A) Already placed: follow the anchor (if the device supports anchors).
    if (this.placed) {
      this.followAnchor(frame, refSpace);
      return;
    }

    if (!this.hitTestSource) return;

    // B) Find a horizontal surface in the middle of the screen.
    const results = frame.getHitTestResults(this.hitTestSource);
    let hit = null;
    if (results.length > 0) {
      const pose = results[0].getPose(refSpace);
      if (pose && this.isHorizontal(pose)) hit = { result: results[0], pose };
    }

    const reticle = this.data.reticle.object3D;
    if (hit) {
      const { position, orientation } = hit.pose.transform;
      reticle.position.set(position.x, position.y, position.z);
      reticle.quaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
      reticle.visible = true;
      this.setState('ready');
    } else {
      reticle.visible = false;
      this.setState('searching');
    }

    // C) The user tapped: place the artifact on the detected surface.
    if (this.placeRequested) {
      this.placeRequested = false;
      if (hit) this.placeArtifact(hit, frame, refSpace);
      else UI.toast('No surface found yet – keep scanning');
    }
  },

  // A hit is "horizontal" when its surface normal (local +Y) points up.
  isHorizontal(pose) {
    const o = pose.transform.orientation;
    this.hitQuaternion.set(o.x, o.y, o.z, o.w);
    this.up.set(0, 1, 0).applyQuaternion(this.hitQuaternion);
    return this.up.y > 0.75;
  },

  placeArtifact(hit, frame, refSpace) {
    const target = this.data.target.object3D;
    const p = hit.pose.transform.position;
    target.position.set(p.x, p.y, p.z);

    // Stand upright and turn the front towards the user.
    const viewer = frame.getViewerPose(refSpace);
    if (viewer) {
      const v = viewer.transform.position;
      target.rotation.set(0, Math.atan2(v.x - p.x, v.z - p.z), 0);
    }

    target.visible = true;
    this.data.reticle.object3D.visible = false;
    this.placed = true;
    this.setState('placed');
    this.data.target.querySelector('#artifact-model').emit('appear', null, false);
    Sound.play('place');

    // Optional: create a WebXR anchor so the device keeps the object
    // locked to the real world while its understanding of the room improves.
    // Anchors are an optional feature; if unsupported we keep the fixed pose.
    if (typeof hit.result.createAnchor === 'function') {
      try {
        hit.result.createAnchor().then((anchor) => {
          if (this.placed && !this.anchor) this.anchor = anchor;
          else anchor.delete();
        }).catch((err) => console.info('Anchors not available:', err.message));
      } catch (err) {
        console.info('Anchors not available:', err.message);
      }
    }
  },

  followAnchor(frame, refSpace) {
    if (!this.anchor) return;
    if (frame.trackedAnchors && !frame.trackedAnchors.has(this.anchor)) return;
    const pose = frame.getPose(this.anchor.anchorSpace, refSpace);
    if (!pose) return;
    const p = pose.transform.position;
    this.data.target.object3D.position.set(p.x, p.y, p.z);
  }
});


/* =====================================================================
   4. PAGE / UI LOGIC
   ===================================================================== */

const UNSUPPORTED_TEXT = 'AR is not supported on this device/browser. Please use a compatible mobile browser.';

const UI = {
  toastTimer: null,

  toast(text) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  },

  hint(text, scanning) {
    document.getElementById('ar-hint-text').textContent = text;
    document.getElementById('ar-hint').classList.toggle('scanning', !!scanning);
  },

  setPlacedControls(enabled) {
    document.getElementById('btn-reset').disabled = !enabled;
    document.getElementById('btn-activate').disabled = !enabled;
  },

  updateActivateButton() {
    document.getElementById('btn-activate').textContent = ArtifactState.active ? 'Deactivate' : 'Activate';
  }
};

// Switch the artifact between idle and activated.
// silent = no sound/effects/message (used when resetting).
function setArtifactActive(active, { silent = false } = {}) {
  ArtifactState.active = active;
  ArtifactState.targetEnergy = active ? 1 : 0;
  UI.updateActivateButton();
  if (silent) {
    ArtifactState.energy = ArtifactState.targetEnergy;
    return;
  }
  if (active) {
    // Fire the one-shot effects (shockwave, burst, beam, crystal pop)
    document.querySelectorAll('.fx, #crystal-group').forEach((el) => el.emit('activate', null, false));
    Sound.play('activate');
    UI.toast('Artifact activated');
  } else {
    Sound.play('deactivate');
    UI.toast('Artifact returned to idle');
  }
}

function toggleArtifact() {
  setArtifactActive(!ArtifactState.active);
}

/* ---------------------------------------------------------------------
   iPhone / iPad: AR Quick Look
   No browser on iOS supports WebXR "immersive-ar" (Chrome, the Google
   app, Firefox… on iOS all use Apple's WebKit engine). Instead the
   artifact is exported in the browser to a USDZ file and opened in
   Apple's built-in AR viewer, which does the floor detection and
   placement itself. Quick Look shows a static model, so the tap-to-
   activate effects stay Android-only.
   --------------------------------------------------------------------- */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS reports "Mac"

const USDZ_EXPORTER_URL = 'https://cdn.jsdelivr.net/npm/three@0.173.0/examples/jsm/exporters/USDZExporter.js';

function canUseQuickLook() {
  if (!IS_IOS) return false;
  const a = document.createElement('a');
  if (a.relList && a.relList.supports && a.relList.supports('ar')) return true;   // Safari
  // Chrome, the Google app, Firefox and Edge on iOS report false here,
  // but still hand rel="ar" links to Quick Look.
  return /CriOS\/|GSA\/|FxiOS\/|EdgiOS\//.test(navigator.userAgent);
}

const QuickLook = {
  link: null,

  // Exports #artifact-model to a USDZ blob. Done ahead of time so the
  // button click can open Quick Look straight away (inside the gesture).
  async prepare(sceneEl) {
    let USDZExporter;
    try {
      ({ USDZExporter } = await import(USDZ_EXPORTER_URL));           // import map -> A-Frame's THREE
    } catch (err) {
      ({ USDZExporter } = await import(USDZ_EXPORTER_URL + '/+esm'));  // older iOS without import maps
    }

    const model = sceneEl.querySelector('#artifact-model').object3D.clone(true);
    model.position.set(0, 0, 0);
    model.rotation.set(0, 0, 0);
    model.scale.set(1, 1, 1);

    // Keep only what Quick Look can show: drop the invisible tap sphere,
    // the shadow catcher and the flat/additive glow and burst effects.
    const drop = [];
    model.traverse((o) => {
      if (o.isMesh && (!o.material.isMeshStandardMaterial || o.material.opacity < 0.05)) drop.push(o);
    });
    drop.forEach((o) => o.parent.remove(o));

    const scene = new THREE.Scene();
    scene.add(model);
    scene.updateMatrixWorld(true);

    const data = await new USDZExporter().parseAsync(scene, { quickLookCompatible: true, maxTextureSize: 512 });
    const url = URL.createObjectURL(new Blob([data], { type: 'model/vnd.usdz+zip' }));

    // Quick Look only reacts to <a rel="ar"> links whose first child is an <img>.
    this.link = document.createElement('a');
    this.link.rel = 'ar';
    this.link.href = url;
    this.link.download = 'aether-artifact.usdz';
    this.link.hidden = true;
    this.link.appendChild(document.createElement('img'));
    document.body.appendChild(this.link);
  },

  open() {
    if (this.link) this.link.click();
  }
};

// Decide how this device gets AR: WebXR (Android), Quick Look (iOS) or not at all.
async function checkARSupport() {
  const webxr = await checkWebXRSupport();
  if (webxr.ok || !IS_IOS) return webxr;
  if (canUseQuickLook()) return { ok: true, mode: 'quicklook' };
  return {
    ok: false,
    reason: UNSUPPORTED_TEXT,
    detail: 'This in-app browser cannot open AR. Open the menu and choose "Open in Safari" (or Chrome).'
  };
}

// Check whether this browser can run WebXR immersive-ar at all.
async function checkWebXRSupport() {
  if (!window.isSecureContext) {
    return { ok: false, reason: UNSUPPORTED_TEXT, detail: 'WebXR only works on HTTPS pages (or http://localhost).' };
  }
  if (!navigator.xr) {
    return { ok: false, reason: UNSUPPORTED_TEXT, detail: 'This browser has no WebXR support. On Android, use Chrome. iPhone Safari does not support WebXR AR.' };
  }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    return supported
      ? { ok: true, mode: 'webxr' }
      : { ok: false, reason: UNSUPPORTED_TEXT, detail: 'WebXR exists, but immersive AR is not available (desktop browser or no ARCore support).' };
  } catch (err) {
    return { ok: false, reason: UNSUPPORTED_TEXT, detail: err.message };
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const sceneEl = document.querySelector('a-scene');
  const enterBtn = document.getElementById('enter-ar');
  const supportMsg = document.getElementById('support-message');

  function showSupportMessage(text, detail) {
    supportMsg.hidden = false;
    supportMsg.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = text;
    supportMsg.appendChild(strong);
    if (detail) {
      const small = document.createElement('span');
      small.textContent = detail;
      supportMsg.appendChild(small);
    }
  }

  // ---- 4.1 Support check -> Enter AR button state ----
  const support = await checkARSupport();
  if (support.mode === 'quicklook') {
    setupQuickLook(sceneEl, enterBtn, supportMsg);
  } else if (support.ok) {
    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter AR';
  } else {
    enterBtn.disabled = true;
    enterBtn.textContent = 'AR unavailable';
    showSupportMessage(support.reason, support.detail);
  }

  // ---- 4.2 Enter AR (must happen inside a user gesture) ----
  enterBtn.addEventListener('click', async () => {
    if (support.mode === 'quicklook') {
      QuickLook.open();
      return;
    }
    Sound.unlock();                       // allow audio from now on
    enterBtn.disabled = true;
    enterBtn.textContent = 'Starting AR…';
    document.body.classList.add('in-ar'); // overlay must be visible when the session starts
    try {
      if (!sceneEl.hasLoaded) await new Promise((r) => sceneEl.addEventListener('loaded', r, { once: true }));
      await sceneEl.enterAR();            // -> navigator.xr.requestSession('immersive-ar', ...)
    } catch (err) {
      console.error(err);
      document.body.classList.remove('in-ar');
      const cause = err.cause && err.cause.message ? err.cause.message : err.message;
      showSupportMessage('Could not start AR.', cause);
      enterBtn.disabled = false;
      enterBtn.textContent = 'Enter AR';
    }
  });

  // ---- 4.3 React to entering / leaving AR ----
  sceneEl.addEventListener('enter-vr', () => {
    if (!sceneEl.is('ar-mode')) return;
    document.body.classList.add('in-ar');
    UI.setPlacedControls(false);
  });

  sceneEl.addEventListener('exit-vr', () => {
    document.body.classList.remove('in-ar');
    enterBtn.disabled = false;
    enterBtn.textContent = 'Enter AR';
  });

  // Messages from the ar-placement component
  sceneEl.addEventListener('ar-state', (evt) => {
    switch (evt.detail.state) {
      case 'searching':
        UI.hint('Point your phone at the floor and move it slowly', true);
        UI.setPlacedControls(false);
        break;
      case 'ready':
        UI.hint('Tap the screen to place the artifact', false);
        break;
      case 'placed':
        UI.hint('Tap the crystal to activate it · walk around it', false);
        UI.setPlacedControls(true);
        break;
      case 'no-hit-test':
        UI.hint('Surface detection is not available on this device', false);
        break;
    }
  });

  // ---- 4.4 AR buttons ----
  document.getElementById('btn-reset').addEventListener('click', () => {
    sceneEl.querySelector('#ar-manager').components['ar-placement'].resetPlacement();
  });
  document.getElementById('btn-activate').addEventListener('click', toggleArtifact);
  document.getElementById('btn-exit').addEventListener('click', () => sceneEl.exitVR());

  // Taps on the buttons must not ALSO count as a tap into the AR scene.
  // "beforexrselect" + preventDefault() suppresses the WebXR select event.
  document.querySelector('.ar-controls').addEventListener('beforexrselect', (e) => e.preventDefault());

  // ---- 4.5 Landing preview: click the crystal with mouse/touch ----
  document.getElementById('crystal-hit').addEventListener('click', () => {
    if (sceneEl.is('ar-mode')) return;    // in AR the select handler does this
    Sound.unlock();
    toggleArtifact();
  });

  // ---- 4.6 QR code section ----
  initQRSection();
});


// iPhone / iPad: export the model once the scene has rendered (so the
// stone textures exist), then turn the button into "View in AR".
function setupQuickLook(sceneEl, enterBtn, supportMsg) {
  enterBtn.disabled = true;
  enterBtn.textContent = 'Preparing AR…';

  const steps = document.getElementById('steps');
  steps.innerHTML = '';
  [
    'Press <strong>View in AR</strong>. Apple\'s AR viewer opens.',
    'Point your phone at the floor and move it slowly.',
    'The artifact snaps onto the floor. Drag to move it, twist with two fingers to turn it.',
    'Walk around it. Tap <strong>Object</strong> at the top to see it without the camera.'
  ].forEach((html) => {
    const li = document.createElement('li');
    li.innerHTML = html;
    steps.appendChild(li);
  });

  const message = (text, detail, isError) => {
    supportMsg.hidden = false;
    supportMsg.classList.toggle('info', !isError);
    supportMsg.innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = text;
    const small = document.createElement('span');
    small.textContent = detail;
    supportMsg.append(strong, small);
  };

  const rendered = new Promise((resolve) => {
    const afterTwoFrames = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
    if (sceneEl.renderStarted) afterTwoFrames();
    else sceneEl.addEventListener('renderstart', afterTwoFrames, { once: true });
  });

  rendered
    .then(() => QuickLook.prepare(sceneEl))
    .then(() => {
      enterBtn.disabled = false;
      enterBtn.textContent = 'View in AR';
      message('iPhone / iPad detected',
        'The artifact opens in Apple AR Quick Look. Tapping the crystal to activate it only works on Android.');
    })
    .catch((err) => {
      console.error('USDZ export failed:', err);
      enterBtn.textContent = 'AR unavailable';
      message('Could not prepare the AR model.', 'Check your internet connection and reload the page. ' + err.message, true);
    });
}


/* ---------------------------------------------------------------------
   QR CODE SECTION
   Generates a QR code for the deployment URL with the small
   "qrcode-generator" library and lets the user print or download it.
   --------------------------------------------------------------------- */
function initQRSection() {
  const section = document.getElementById('qr-section');
  const input = document.getElementById('qr-input');
  const image = document.getElementById('qr-image');
  const urlText = document.getElementById('qr-url');
  const warning = document.getElementById('qr-warning');
  let currentSvg = '';

  // Default: the URL this page was opened from (without #hash or ?query).
  input.value = location.protocol === 'file:'
    ? 'https://your-name.github.io/WebXR-AR/'
    : location.origin + location.pathname;

  function render(url) {
    urlText.textContent = url;
    warning.hidden = url.startsWith('https://');
    if (typeof qrcode !== 'function') {
      image.textContent = 'QR library could not be loaded (offline?). Use qr-generator.py instead.';
      return;
    }
    if (qrcode.stringToBytesFuncs) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
    const qr = qrcode(0, 'H');             // 0 = automatic size, H = 30% error correction
    qr.addData(url);
    qr.make();
    currentSvg = qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true, title: 'QR code: ' + url });
    image.innerHTML = currentSvg;
  }

  function open() {
    section.hidden = false;
    document.body.classList.add('qr-open');
    render(input.value);
  }

  function close() {
    section.hidden = true;
    document.body.classList.remove('qr-open');
    if (location.hash === '#qr') history.replaceState(null, '', location.pathname + location.search);
  }

  document.getElementById('open-qr').addEventListener('click', open);
  document.getElementById('close-qr').addEventListener('click', close);
  document.getElementById('qr-form').addEventListener('submit', (e) => {
    e.preventDefault();
    render(input.value.trim());
  });
  document.getElementById('qr-print').addEventListener('click', () => window.print());
  document.getElementById('qr-download').addEventListener('click', () => {
    if (!currentSvg) return;
    const blob = new Blob([currentSvg], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'webxr-ar-qr-code.svg';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });

  // Opening index.html#qr shows the QR section directly.
  // (window "load" waits for the deferred QR library.)
  if (location.hash === '#qr') {
    if (document.readyState === 'complete') open();
    else window.addEventListener('load', open, { once: true });
  }
}
