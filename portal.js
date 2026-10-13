/* =====================================================================
   Teleporter T-42 – walk-through AR portal (8th Wall)
   ---------------------------------------------------------------------
   Used by portal.html. app.js is loaded first, so Sound, UI, lerp,
   seconds(), getGlowTexture() and simple-environment are shared.

   How the portal illusion works ("hider" / occluder technique):
     - Behind the door there is a whole little world ("Dimension 42"),
       about 12 m × 12 m × 7 m, closed in by a sky box.
     - Around that world sits an invisible box (the "hider"). It writes
       depth but no colour, so it shows the camera image while hiding
       every virtual thing behind it. Its front wall has a door-shaped
       hole: through that hole, and only there, the world is visible.
     - Once you walk through the hole you stand inside the sky box, so
       the world surrounds you. Looking back through the door shows the
       real room again, because nothing virtual is rendered there.
     - Walking around the back of the door (not through it) would put
       you inside the world without "teleporting", so the world is
       hidden while you are behind the door.

   Layout (portal-local coordinates, metres):
     door plane = z 0, floor = y 0, the user starts on the +z side,
     the dimension lies at z < 0.
   ===================================================================== */

const PREVIEW = new URLSearchParams(location.search).has('preview');

const DOOR = { halfW: 0.45, height: 2.1 };            // inner opening of the door
DOOR.spring = DOOR.height - DOOR.halfW;               // where the round top begins
const FRAME_W = 0.13;                                 // frame thickness around the opening
const WORLD = { halfW: 6, height: 7, depth: 12 };     // size of the dimension

const ENTER_LINES = [
  ['Teleport complete', '99.7% of your atoms arrived. Close enough.'],
  ['Welcome to Dimension 42', 'Please do not feed the duck.'],
  ['Teleport successful', 'Your left sock stayed on Earth.'],
  ['Arrived', 'Local time: Tuesday. Probably.'],
  ['Teleport complete', 'Side effects may include mild synthwave.']
];
const EXIT_LINES = [
  ['Back on Earth', 'Rent is still due.'],
  ['Welcome back', 'You smell faintly of rubber duck.'],
  ['Reality restored', 'Sorry about the colours. They were nicer there.'],
  ['Earth again', 'Gravity is no longer optional.']
];
const DUCK_LINES = {
  1: 'SQUEAK. The Supreme Leader acknowledges you.',
  2: 'SQUEAK! It is starting to like you.',
  3: 'The duck has added you to its will.',
  5: 'Okay, that is enough. The duck needs a moment.',
  10: 'Achievement unlocked: Professional Duck Squeezer.'
};
const DUCK_RANDOM = ['Squeak.', 'Squeak (passive-aggressively).', 'The duck remains unimpressed.', 'Squeak. Squeak?'];
const UFO_LINES = [
  'UFO: "We come in peace. Do you have snacks?"',
  'UFO: "Please stop tapping the windscreen."',
  'UFO: "We are not lost. We are exploring."'
];
const FRAME_LINES = ['Please do not poke the teleporter.', 'Warranty void if poked.', 'The door is the other way. Walk through it!'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);


/* =====================================================================
   1. GEOMETRY + MATERIAL HELPERS
   ===================================================================== */

// Door outline: two straight sides and a half-circle on top, standing on y = 0.
function drawArch(path, halfW, height, closed = true) {
  const spring = height - halfW;
  path.moveTo(-halfW, 0);
  path.lineTo(-halfW, spring);
  path.absarc(0, spring, halfW, Math.PI, 0, true);
  path.lineTo(halfW, 0);
  if (closed) path.lineTo(-halfW, 0);
  return path;
}

// Is a point (portal-local x, y) inside the door opening?
function insideDoor(x, y, shrink = 0) {
  const hw = DOOR.halfW - shrink;
  if (y < 0 || Math.abs(x) > hw) return false;
  return y <= DOOR.spring || Math.hypot(x, y - DOOR.spring) <= hw;
}

// Big wall (x0..x1, y0..y1) with a door-shaped hole in it, at z = 0.
function wallWithDoor(x0, x1, y0, y1) {
  const shape = new THREE.Shape();
  shape.moveTo(x0, y0);
  shape.lineTo(x1, y0);
  shape.lineTo(x1, y1);
  shape.lineTo(x0, y1);
  shape.lineTo(x0, y0);
  shape.holes.push(drawArch(new THREE.Path(), DOOR.halfW, DOOR.height));
  return new THREE.ShapeGeometry(shape, 24);
}

// A 3D curve that follows the door outline (for glowing tubes).
function archCurve(halfW, height, z = 0) {
  const path = drawArch(new THREE.Path(), halfW, height, false);
  const points = path.getSpacedPoints(90).map((p) => new THREE.Vector3(p.x, p.y, z));
  return new THREE.CatmullRomCurve3(points);
}

// Hex colour -> plain 0..1 values for our own shaders (no colour-space conversion).
function rawColor(hex) {
  const c = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255);
}

// Draws on a canvas and returns it as a texture (signs, labels, floor grid).
function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

// Three-step gradient = cartoon ("toon") shading for the props.
let toonGradient = null;
function toon(color, extra = {}) {
  if (!toonGradient) {
    const data = new Uint8Array([70, 70, 70, 255, 165, 165, 165, 255, 255, 255, 255, 255]);
    toonGradient = new THREE.DataTexture(data, 3, 1);
    toonGradient.minFilter = toonGradient.magFilter = THREE.NearestFilter;
    toonGradient.needsUpdate = true;
  }
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient, ...extra });
}
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, ...extra });

function mesh(geometry, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  return m;
}

// Invisible occluder: writes depth only, so the camera image shows through.
const HIDER_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });


/* =====================================================================
   2. SHADERS
   ===================================================================== */

const LOCAL_VERTEX = `
  varying vec3 vPos;
  varying vec2 vUv;
  void main() {
    vPos = position;
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// Sunset gradient + twinkling stars, based on the view direction from the
// middle of the world, so the corners of the sky box don't show.
const SKY_FRAGMENT = `
  uniform float uTime;
  uniform vec3 cLow, cMid, cHigh, cTop;
  varying vec3 vPos;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vPos - vec3(0.0, 1.2, -6.0));
    float h = d.y;
    vec3 col = mix(cLow, cMid, smoothstep(-0.05, 0.12, h));
    col = mix(col, cHigh, smoothstep(0.12, 0.42, h));
    col = mix(col, cTop, smoothstep(0.42, 0.85, h));
    vec2 uv = vec2(atan(d.x, -d.z), h) * 38.0;
    vec2 cell = floor(uv);
    float rnd = hash(cell);
    float star = step(0.965, rnd) * smoothstep(0.32, 0.0, length(fract(uv) - 0.5));
    star *= smoothstep(0.25, 0.55, h) * (0.55 + 0.45 * sin(uTime * 2.0 + rnd * 60.0));
    gl_FragColor = vec4(col + star, 1.0);
  }`;

// Striped synthwave sun.
const SUN_FRAGMENT = `
  uniform float uTime;
  uniform vec3 cBottom, cTop;
  varying vec2 vUv;
  void main() {
    float y = vUv.y;
    float stripes = fract(y * 11.0 - uTime * 0.25);
    if (y < 0.55 && stripes < (0.55 - y) * 1.3) discard;
    gl_FragColor = vec4(mix(cBottom, cTop, smoothstep(0.1, 0.95, y)), 1.0);
  }`;

// Swirling energy film inside the door, brightest at its edge.
const FILM_FRAGMENT = `
  uniform float uTime, uSwirl, uBoost, uHalfW, uSpring;
  uniform vec3 cA, cB;
  varying vec3 vPos;
  void main() {
    vec2 p = vPos.xy;
    float d = p.y > uSpring ? uHalfW - length(vec2(p.x, p.y - uSpring)) : uHalfW - abs(p.x);
    float edge = exp(-max(d, 0.0) * 16.0);
    vec2 q = p - vec2(0.0, uSpring * 0.75);
    float a = atan(q.y, q.x);
    float r = length(q);
    float s1 = 0.5 + 0.5 * sin(a * 6.0 + r * 9.0 - uTime * 2.6);
    float s2 = 0.5 + 0.5 * sin(a * -4.0 + r * 15.0 + uTime * 1.8);
    vec3 col = mix(cA, cB, s1);
    float alpha = edge * (0.75 + 0.25 * uBoost) + s1 * s2 * 0.3 * uSwirl;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }`;


/* =====================================================================
   3. THE TELEPORTER COMPONENT (on <a-scene>)
   ===================================================================== */

AFRAME.registerComponent('teleporter-portal', {
  schema: {
    reticle: { default: '#reticle' }
  },

  init() {
    this.tracking = false;          // camera + SLAM running
    this.calibrating = false;       // coaching overlay is measuring scale
    this.placed = false;
    this.state = '';                // UI hint state
    this.zone = 'earth';            // earth | inside | behind
    this.openT = 1;                 // 0..1 opening animation
    this.speed = 1;                 // animation speed (3 when overclocked)
    this.targetSpeed = 1;
    this.phase = 0;                 // time scaled by speed
    this.duckTaps = 0;
    this.duckJump = 1;              // 0..1 jump animation, 1 = idle
    this.trips = 0;
    this.spawnCarry = 0;

    this.raycaster = new THREE.Raycaster();
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hitPoint = new THREE.Vector3();
    this.cam = new THREE.Vector3();
    this.camLocal = new THREE.Vector3();
    this.prevCam = null;
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();

    this.anim = [];                 // per-frame animation callbacks (t, s)
    this.tapTargets = [];           // [{ object, onTap }]

    this.portal = this.buildPortal();
    this.portal.visible = false;
    this.el.object3D.add(this.portal);

    this.reticle = document.querySelector(this.data.reticle);
    this.ghost = this.buildGhost();
    this.reticle.object3D.add(this.ghost);

    this.onTap = this.onTap.bind(this);
    document.addEventListener('click', this.onTap);

    this.el.addEventListener('realityready', () => {
      this.tracking = true;
      if (!this.calibrating) this.setState(this.placed ? 'placed' : 'searching');
    });
    this.el.addEventListener('coaching-overlay.show', () => {
      this.calibrating = true;
      this.reticle.object3D.visible = false;
      this.setState('calibrating');
    });
    this.el.addEventListener('coaching-overlay.hide', () => {
      this.calibrating = false;
      this.setState(this.placed ? 'placed' : 'searching');
    });

    // Desktop preview: no AR, open the portal 3 m in front of the camera.
    if (PREVIEW) {
      this.tracking = true;
      const start = () => setTimeout(() => this.place(new THREE.Vector3(0, 0, 0), 0), 300);
      if (this.el.renderStarted) start(); else this.el.addEventListener('renderstart', start, { once: true });
    }
  },

  remove() {
    document.removeEventListener('click', this.onTap);
  },

  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.el.emit('portal-state', { state });
  },

  /* -------------------------------------------------------------------
     Building the portal
     ------------------------------------------------------------------- */
  buildPortal() {
    const portal = new THREE.Group();
    portal.name = 'teleporter';

    this.world = this.buildWorld();
    portal.add(this.world);
    portal.add(this.buildFrame());
    portal.add(this.buildSparkles());

    return portal;
  },

  // The door frame, glowing rims, chase lights, sign and floor sticker.
  buildFrame() {
    const g = new THREE.Group();

    // Metal frame: the outer arch with the door cut out, extruded.
    const outer = drawArch(new THREE.Shape(), DOOR.halfW + FRAME_W, DOOR.height + FRAME_W);
    outer.holes.push(drawArch(new THREE.Path(), DOOR.halfW, DOOR.height));
    const frameGeo = new THREE.ExtrudeGeometry(outer, {
      depth: 0.16, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 48
    });
    frameGeo.translate(0, 0, -0.08);
    const metal = new THREE.MeshStandardMaterial({ color: '#2a2f3d', metalness: 0.85, roughness: 0.32 });
    const frame = mesh(frameGeo, metal);
    frame.name = 'frame';
    g.add(frame);
    this.tapTargets.push({ object: frame, onTap: () => this.say(pick(FRAME_LINES)) });

    // Glowing inner rim (front and back) and a thin violet outer rim.
    const rimMat = basic('#7ff6ff');
    const rimBase = rimMat.color.clone();
    [0.095, -0.095].forEach((z) => {
      g.add(mesh(new THREE.TubeGeometry(archCurve(DOOR.halfW + 0.012, DOOR.height + 0.012, z), 160, 0.014, 8), rimMat));
    });
    const outerRimMat = basic('#b28bff');
    g.add(mesh(new THREE.TubeGeometry(archCurve(DOOR.halfW + FRAME_W + 0.006, DOOR.height + FRAME_W + 0.006, 0), 160, 0.01, 6), outerRimMat));

    // Chase lights along the frame.
    const lampCurve = archCurve(DOOR.halfW + FRAME_W / 2, DOOR.height + FRAME_W / 2, 0.1);
    const lampGeo = new THREE.SphereGeometry(0.022, 12, 8);
    const glowMat = new THREE.SpriteMaterial({ map: getGlowTexture(), color: '#7ff6ff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const lamps = [];
    const LAMPS = 13;
    for (let i = 0; i < LAMPS; i++) {
      const p = lampCurve.getPointAt((i + 0.5) / LAMPS);
      const mat = basic('#ffffff');
      const lamp = mesh(lampGeo, mat, p.x, p.y, p.z);
      const glow = new THREE.Sprite(glowMat.clone());
      glow.scale.setScalar(0.16);
      lamp.add(glow);
      g.add(lamp);
      lamps.push({ mat, glow });
    }

    // Swirling energy film in the opening.
    const film = mesh(new THREE.ShapeGeometry(drawArch(new THREE.Shape(), DOOR.halfW, DOOR.height), 32),
      new THREE.ShaderMaterial({
        vertexShader: LOCAL_VERTEX,
        fragmentShader: FILM_FRAGMENT,
        uniforms: {
          uTime: { value: 0 }, uSwirl: { value: 1 }, uBoost: { value: 0 },
          uHalfW: { value: DOOR.halfW }, uSpring: { value: DOOR.spring },
          cA: { value: rawColor('#45e6ff') }, cB: { value: rawColor('#b06bff') }
        },
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
      }), 0, 0, 0.004);
    film.renderOrder = 5;
    g.add(film);

    // Holographic sign above the door.
    const signTex = canvasTexture(1024, 300, (ctx, w, h) => {
      ctx.textAlign = 'center';
      ctx.shadowColor = '#45e6ff';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#c9fbff';
      ctx.font = `800 118px ${FONT}`;
      ctx.fillText('TELEPORTER T-42', w / 2, 140);
      ctx.shadowColor = '#b06bff';
      ctx.fillStyle = '#e4d4ff';
      ctx.font = `600 50px ${FONT}`;
      ctx.fillText('Dept. of Questionable Physics', w / 2, 225);
      // Scan lines, only over the text
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2);
    });
    const signMat = basic('#ffffff', { map: signTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const sign = mesh(new THREE.PlaneGeometry(1.15, 0.34), signMat, 0, DOOR.height + FRAME_W + 0.3, 0.02);
    g.add(sign);

    // Floor sticker in front of the threshold.
    const stickerTex = canvasTexture(1024, 160, (ctx, w, h) => {
      for (let i = 0, x = -h; x < w + h; i++, x += 32) {
        ctx.fillStyle = i % 2 ? '#111' : '#ffd23f';
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x + 32, 0); ctx.lineTo(x + 32 - h, h); ctx.lineTo(x - h, h);
        ctx.fill();
      }
      ctx.fillStyle = '#111';
      ctx.fillRect(40, 34, w - 80, h - 68);
      ctx.fillStyle = '#ffd23f';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 46px ${FONT}`;
      ctx.fillText('MIND THE GAP BETWEEN DIMENSIONS', w / 2, h / 2 + 2, w - 110);
    });
    const sticker = mesh(new THREE.PlaneGeometry(1.05, 0.16), basic('#ffffff', { map: stickerTex, transparent: true }), 0, 0.003, 0.22);
    sticker.rotation.x = -Math.PI / 2;
    g.add(sticker);

    // Soft glow pool on the floor.
    const pool = mesh(new THREE.CircleGeometry(0.9, 48),
      basic('#45e6ff', { map: getGlowTexture(), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }), 0, 0.002, 0.1);
    pool.rotation.x = -Math.PI / 2;
    g.add(pool);

    this.anim.push((t) => {
      const ph = this.phase;
      const pulse = 0.75 + 0.25 * Math.sin(ph * 3);
      rimMat.color.copy(rimBase).multiplyScalar(pulse + (this.speed - 1) * 0.15);
      lamps.forEach((l, i) => {
        const k = Math.pow(Math.max(0, Math.sin(ph * 4 - i * 0.55)), 6);
        const v = 0.25 + 0.75 * k;
        l.mat.color.setRGB(0.5 * v + 0.2, v, v);
        l.glow.material.opacity = 0.15 + 0.85 * k;
      });
      film.material.uniforms.uTime.value = ph;
      film.material.uniforms.uBoost.value = this.speed - 1;
      // Fade the swirl when the visitor is close, so walking through stays clear.
      const dist = this.camLocal.distanceTo(this.tmp.set(0, 1.1, 0));
      film.material.uniforms.uSwirl.value = clamp01((dist - 0.5) / 1.3) * (this.zone === 'inside' ? 0.3 : 1);
      signMat.opacity = Math.random() < 0.015 ? 0.4 : 0.92 + 0.08 * Math.sin(t * 9);
      pool.material.opacity = 0.25 + 0.12 * Math.sin(ph * 3) + (this.speed - 1) * 0.1;
    });

    return g;
  },

  // Sparkles that leak out of the door into the real room.
  buildSparkles() {
    const N = 90;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.045, map: getGlowTexture(), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    points.frustumCulled = false;
    points.renderOrder = 6;

    const palette = ['#45e6ff', '#b06bff', '#ff6fd8', '#ffffff'].map((c) => new THREE.Color(c));
    const parts = Array.from({ length: N }, () => ({ life: 0, max: 1, vel: new THREE.Vector3(), color: palette[0] }));

    const spawn = (p) => {
      let x, y;
      do { x = (Math.random() * 2 - 1) * DOOR.halfW; y = Math.random() * DOOR.height; } while (!insideDoor(x, y, 0.03));
      p.pos = p.pos || new THREE.Vector3();
      p.pos.set(x, y, -0.05);
      p.vel.set((Math.random() - 0.5) * 0.12, 0.03 + Math.random() * 0.1, 0.12 + Math.random() * 0.3);
      p.max = 1.8 + Math.random() * 1.8;
      p.life = p.max;
      p.color = palette[(Math.random() * palette.length) | 0];
    };

    this.anim.push((t, s) => {
      this.spawnCarry += s * 22 * this.speed * this.speed;
      parts.forEach((p, i) => {
        if (p.life <= 0 && this.spawnCarry >= 1) { spawn(p); this.spawnCarry -= 1; }
        if (p.life > 0) {
          p.life -= s;
          p.pos.addScaledVector(p.vel, s * this.speed);
          const k = Math.sin(Math.PI * clamp01(p.life / p.max));
          pos[i * 3] = p.pos.x; pos[i * 3 + 1] = p.pos.y; pos[i * 3 + 2] = p.pos.z;
          col[i * 3] = p.color.r * k; col[i * 3 + 1] = p.color.g * k; col[i * 3 + 2] = p.color.b * k;
        } else {
          col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        }
      });
      this.spawnCarry = Math.min(this.spawnCarry, 5);
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    });
    return points;
  },

  // Everything behind the door: the hider box, the sky and the props.
  buildWorld() {
    const world = new THREE.Group();
    world.name = 'dimension-42';
    const { halfW, height, depth } = WORLD;
    const pad = 0.35;                // gap between hider and sky (keeps them from z-fighting)

    // --- Hider box (bigger than the sky box) ---
    // One closed box without its front face (watertight edges, no cracks),
    // plus a front wall with the door hole that reaches past the box.
    const hider = new THREE.Group();
    const W = (halfW + pad) * 2, H = height + pad * 2, D = depth + pad;
    const boxGeo = new THREE.BoxGeometry(W, H, D);
    boxGeo.groups.splice(4, 1);                 // groups: +x, -x, +y, -y, +z (front), -z
    const box = mesh(boxGeo, Array(6).fill(HIDER_MATERIAL), 0, height / 2, -D / 2);
    const o = 0.3;
    const frontWall = mesh(wallWithDoor(-halfW - pad - o, halfW + pad + o, -pad - o, height + pad + o), HIDER_MATERIAL);
    [box, frontWall].forEach((m) => { m.renderOrder = -10; hider.add(m); });   // draw before everything else
    world.add(hider);

    // --- Sky: box walls + a front wall with the door hole, all one shader ---
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: LOCAL_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        cLow: { value: rawColor('#ff9a62') }, cMid: { value: rawColor('#ff4f9a') },
        cHigh: { value: rawColor('#6b35e8') }, cTop: { value: rawColor('#120a33') }
      },
      side: THREE.DoubleSide
    });
    const skyWall = (geo) => {
      geo.computeBoundingSphere();
      world.add(new THREE.Mesh(geo, skyMat));
    };
    const plane = (w, h, x, y, z, rx, ry) => {
      const geo = new THREE.PlaneGeometry(w, h);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0)));
      geo.translate(x, y, z);
      return geo;
    };
    // The sky starts 12 cm behind the hider's front wall, so no edge touches it.
    const inset = 0.12, skyD = depth - inset, skyZ = -(depth + inset) / 2;
    skyWall(plane(halfW * 2, height, 0, height / 2, -depth, 0, 0));
    skyWall(plane(skyD, height, -halfW, height / 2, skyZ, 0, Math.PI / 2));
    skyWall(plane(skyD, height, halfW, height / 2, skyZ, 0, -Math.PI / 2));
    skyWall(plane(halfW * 2, skyD, 0, height, skyZ, Math.PI / 2, 0));
    const front = wallWithDoor(-halfW, halfW, 0, height);
    front.translate(0, 0, -inset);
    skyWall(front);
    this.anim.push(() => { skyMat.uniforms.uTime.value = this.phase; });

    // --- Synthwave floor grid ---
    const gridTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#1c0b3d';
      ctx.fillRect(0, 0, w, h);
      ctx.shadowColor = '#ff4fd8';
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#ff6fe0';
      ctx.lineWidth = 6;
      ctx.strokeRect(0, 0, w, h);
    });
    gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(halfW * 2 / 0.75, depth / 0.75);
    const ground = mesh(new THREE.PlaneGeometry(halfW * 2, depth), basic('#ffffff', { map: gridTex }), 0, 0.001, -depth / 2 - 0.02);
    ground.rotation.x = -Math.PI / 2;
    world.add(ground);

    // --- Sun and a ringed planet in the distance ---
    const sun = mesh(new THREE.CircleGeometry(2.4, 64), new THREE.ShaderMaterial({
      vertexShader: LOCAL_VERTEX, fragmentShader: SUN_FRAGMENT,
      uniforms: { uTime: { value: 0 }, cBottom: { value: rawColor('#ff3d8b') }, cTop: { value: rawColor('#ffe66b') } }
    }), 0, 2.0, -depth + 0.15);
    world.add(sun);
    const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: getGlowTexture(), color: '#ff7ab8', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    sunGlow.scale.setScalar(9);
    sunGlow.position.set(0, 2.2, -depth + 0.3);
    world.add(sunGlow);
    this.anim.push(() => { sun.material.uniforms.uTime.value = this.phase; });

    const planet = new THREE.Group();
    planet.position.set(-4.1, 5.2, -9.8);
    planet.add(mesh(new THREE.SphereGeometry(0.9, 32, 20), toon('#3fd6c6')));
    const ring = mesh(new THREE.RingGeometry(1.2, 1.7, 64), basic('#ffd27a', { side: THREE.DoubleSide, transparent: true, opacity: 0.75 }));
    ring.rotation.set(-1.2, 0.3, 0);
    planet.add(ring);
    world.add(planet);
    this.anim.push((t, s) => { planet.rotation.y += s * 0.1 * this.speed; });

    world.add(this.buildDuck());
    world.add(this.buildSignpost());
    this.buildDonuts(world);
    this.buildIslands(world);
    this.buildCrystals(world);
    world.add(this.buildUFO());

    // Light for the cartoon props.
    const sunLight = new THREE.DirectionalLight('#ffe2f0', 1.3);
    sunLight.position.set(2, 6, 3);
    world.add(sunLight, sunLight.target);
    world.add(new THREE.PointLight('#ff6fb5', 1.5, 9, 1.5).translateY(2.5).translateZ(-9));

    return world;
  },

  // The Supreme Leader: a giant rubber duck with a crown that watches you.
  buildDuck() {
    const pedestal = new THREE.Group();
    pedestal.position.set(0, 0, -4.6);

    pedestal.add(mesh(new THREE.BoxGeometry(1.2, 0.45, 1.2), toon('#2d1d63'), 0, 0.225, 0));
    pedestal.add(mesh(new THREE.BoxGeometry(1.26, 0.05, 1.26), toon('#ffcf5a'), 0, 0.45, 0));
    const labelTex = canvasTexture(512, 96, (ctx, w, h) => {
      ctx.fillStyle = '#ffcf5a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `800 54px ${FONT}`;
      ctx.fillText('SUPREME LEADER', w / 2, h / 2 + 2);
    });
    pedestal.add(mesh(new THREE.PlaneGeometry(1.0, 0.19), basic('#ffffff', { map: labelTex, transparent: true }), 0, 0.22, 0.602));

    const duck = new THREE.Group();
    duck.position.y = 0.475;
    const yellow = toon('#ffd23f');
    const orange = toon('#ff8a1f');
    const black = basic('#111111');
    const white = basic('#ffffff');
    const gold = new THREE.MeshStandardMaterial({ color: '#ffc845', metalness: 1, roughness: 0.25, side: THREE.DoubleSide });

    const body = mesh(new THREE.SphereGeometry(0.45, 32, 24), yellow, 0, 0.36, 0);
    body.scale.set(1, 0.78, 1.15);
    const tail = mesh(new THREE.ConeGeometry(0.2, 0.36, 20), yellow, 0, 0.55, -0.48);
    tail.rotation.x = -0.75;
    const head = mesh(new THREE.SphereGeometry(0.3, 32, 24), yellow, 0, 0.9, 0.22);
    const beak = mesh(new THREE.SphereGeometry(0.16, 24, 16), orange, 0, 0.84, 0.5);
    beak.scale.set(1.25, 0.42, 1.1);
    duck.add(body, tail, head, beak);
    [-1, 1].forEach((side) => {
      duck.add(mesh(new THREE.SphereGeometry(0.055, 16, 12), black, side * 0.12, 0.97, 0.47));
      duck.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), white, side * 0.12 + 0.015, 0.99, 0.52));
      const wing = mesh(new THREE.SphereGeometry(0.22, 20, 14), yellow, side * 0.42, 0.4, -0.02);
      wing.scale.set(0.35, 0.6, 1);
      wing.rotation.z = side * 0.3;
      duck.add(wing);
    });

    const crown = new THREE.Group();
    crown.position.set(0, 1.17, 0.2);
    crown.rotation.x = -0.15;
    crown.add(mesh(new THREE.CylinderGeometry(0.14, 0.155, 0.1, 24, 1, true), gold));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      crown.add(mesh(new THREE.ConeGeometry(0.032, 0.1, 8), gold, Math.sin(a) * 0.14, 0.1, Math.cos(a) * 0.14));
    }
    crown.add(mesh(new THREE.SphereGeometry(0.025, 12, 8), basic('#ff2d6f'), 0, 0.005, 0.15));
    duck.add(crown);

    duck.scale.setScalar(1.3);
    pedestal.add(duck);

    // Turn to face the visitor, bob gently, jump when tapped.
    let yaw = 0;
    this.anim.push((t, s) => {
      const dx = this.camLocal.x - pedestal.position.x;
      const dz = this.camLocal.z - pedestal.position.z;
      let diff = Math.atan2(dx, dz) - yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      yaw += diff * (1 - Math.exp(-s * 2.5));
      duck.rotation.y = yaw;

      this.duckJump = Math.min(1, this.duckJump + s * 1.6);
      const j = this.duckJump;
      const hop = j < 1 ? Math.sin(Math.PI * j) * 0.45 : 0;
      const squash = j < 0.12 ? 1 - Math.sin((j / 0.12) * Math.PI) * 0.25 : 1;
      duck.position.y = 0.475 + hop + Math.sin(t * 1.6) * 0.015;
      duck.scale.set(1.3 / Math.sqrt(squash), 1.3 * squash, 1.3 / Math.sqrt(squash));
      duck.rotation.z = Math.sin(t * 1.1) * 0.03;
    });

    this.tapTargets.push({ object: duck, onTap: () => this.squeezeDuck() });
    return pedestal;
  },

  buildSignpost() {
    const post = new THREE.Group();
    post.position.set(-1.45, 0, -2.1);
    post.rotation.y = Math.atan2(1.45, 2.1);
    post.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.5, 12), toon('#6b4a2b'), 0, 0.75, 0));
    const tex = canvasTexture(640, 420, (ctx, w, h) => {
      ctx.fillStyle = '#7a5532';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 18; y < h; y += 34) ctx.fillRect(0, y, w, 3);
      ctx.strokeStyle = '#4a321c';
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, w - 14, h - 14);
      ctx.fillStyle = '#fff3dc';
      ctx.textAlign = 'center';
      ctx.font = `800 70px ${FONT}`;
      ctx.fillText('DIMENSION 42', w / 2, 100);
      ctx.font = `600 40px ${FONT}`;
      ['Population: 1 duck', 'Wi-Fi: none', 'Gravity: optional', 'Please wipe your feet'].forEach((line, i) => {
        ctx.fillText(line, w / 2, 175 + i * 58);
      });
    });
    const board = mesh(new THREE.BoxGeometry(0.85, 0.56, 0.04),
      [toon('#5a3d22'), toon('#5a3d22'), toon('#5a3d22'), toon('#5a3d22'), basic('#ffffff', { map: tex }), toon('#5a3d22')],
      0, 1.25, 0.03);
    board.rotation.z = 0.04;
    post.add(board);
    return post;
  },

  buildDonuts(world) {
    const centre = new THREE.Vector3(0, 1.9, -4.6);
    const sprinkleColors = ['#ffffff', '#45e6ff', '#ffd23f', '#7cff8a', '#b06bff'];
    const donuts = [];
    for (let i = 0; i < 6; i++) {
      const d = new THREE.Group();
      d.add(mesh(new THREE.TorusGeometry(0.15, 0.07, 14, 28), toon('#d9a05b')));
      const icing = mesh(new THREE.TorusGeometry(0.15, 0.072, 14, 28, Math.PI * 2), toon(i % 2 ? '#ff7ac8' : '#7a4a2a'));
      icing.position.z = 0.018;
      icing.scale.set(1.02, 1.02, 0.7);
      d.add(icing);
      for (let k = 0; k < 10; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.15 + (Math.random() - 0.5) * 0.07;
        const sp = mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), basic(sprinkleColors[k % sprinkleColors.length]), Math.cos(a) * r, Math.sin(a) * r, 0.075);
        sp.rotation.z = Math.random() * Math.PI;
        d.add(sp);
      }
      world.add(d);
      donuts.push({ d, a: (i / 6) * Math.PI * 2, r: 1.55 + (i % 3) * 0.25, h: (i % 2) * 0.5, spin: 0.6 + Math.random() });
    }
    this.anim.push((t, s) => {
      donuts.forEach((o) => {
        o.a += s * 0.35 * this.speed;
        o.d.position.set(centre.x + Math.cos(o.a) * o.r, centre.y + o.h + Math.sin(t * 1.3 + o.a) * 0.12, centre.z + Math.sin(o.a) * o.r);
        o.d.rotation.x += s * o.spin * this.speed;
        o.d.rotation.y += s * 0.4 * this.speed;
      });
    });
  },

  buildIslands(world) {
    const spots = [[-3.4, 3.0, -7.2, 1.1], [3.7, 2.3, -5.6, 0.8], [-2.2, 4.7, -9.6, 0.7], [2.6, 4.2, -9.0, 0.9]];
    const islands = spots.map(([x, y, z, size], i) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.scale.setScalar(size);
      const rock = mesh(new THREE.ConeGeometry(0.5, 0.9, 7), toon('#5b3f8f'), 0, -0.45, 0);
      rock.rotation.x = Math.PI;
      g.add(rock);
      g.add(mesh(new THREE.CylinderGeometry(0.52, 0.5, 0.1, 7), toon('#3fe0b0'), 0, 0.03, 0));
      // A tiny pink tree on every island.
      g.add(mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.3, 6), toon('#6b4a2b'), 0.12, 0.23, 0));
      g.add(mesh(new THREE.IcosahedronGeometry(0.16, 0), toon(i % 2 ? '#ff7ac8' : '#ffb3e6'), 0.12, 0.45, 0));
      world.add(g);
      return { g, y, off: i * 1.7 };
    });
    this.anim.push((t) => {
      islands.forEach((o) => {
        o.g.position.y = o.y + Math.sin(t * 0.7 + o.off) * 0.12;
        o.g.rotation.y = Math.sin(t * 0.2 + o.off) * 0.3;
      });
    });
  },

  buildCrystals(world) {
    const spots = [[-2.6, -3.2], [2.4, -2.8], [-3.8, -5.5], [3.2, -7.4], [-1.6, -8.6], [1.8, -10], [4.6, -3.6], [-4.8, -9.4]];
    spots.forEach(([x, z], i) => {
      const h = 0.35 + (i % 3) * 0.22;
      const c = mesh(new THREE.ConeGeometry(0.1 + (i % 2) * 0.04, h, 5),
        new THREE.MeshStandardMaterial({ color: i % 2 ? '#45e6ff' : '#ff6fd8', emissive: i % 2 ? '#1a8fb0' : '#a0247f', roughness: 0.2, flatShading: true }),
        x, h / 2, z);
      c.rotation.set((i % 3 - 1) * 0.2, i, (i % 2 - 0.5) * 0.3);
      world.add(c);
    });
  },

  buildUFO() {
    const ufo = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(0.5, 32, 16), new THREE.MeshStandardMaterial({ color: '#c8d0e0', metalness: 0.9, roughness: 0.25 }));
    body.scale.set(1, 0.22, 1);
    const dome = mesh(new THREE.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#7ff6ff', transparent: true, opacity: 0.6, roughness: 0.05, emissive: '#1a6f88' }), 0, 0.06, 0);
    ufo.add(body, dome);
    const alien = mesh(new THREE.SphereGeometry(0.08, 16, 12), toon('#7cff8a'), 0, 0.12, 0);
    ufo.add(alien);

    const lights = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const l = mesh(new THREE.SphereGeometry(0.03, 8, 6), basic('#ffd23f'), Math.cos(a) * 0.44, 0, Math.sin(a) * 0.44);
      ufo.add(l);
      lights.push(l);
    }
    const beam = mesh(new THREE.ConeGeometry(0.75, 3.6, 32, 1, true),
      basic('#7cff8a', { transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), 0, -1.85, 0);
    ufo.add(beam);

    let a = 0;
    this.anim.push((t, s) => {
      a += s * 0.4 * this.speed;
      ufo.position.set(Math.cos(a) * 3, 4.4 + Math.sin(t * 1.5) * 0.15, -6.5 + Math.sin(a) * 2.6);
      ufo.rotation.y += s * 1.5 * this.speed;
      ufo.rotation.z = Math.sin(t * 2) * 0.08;
      lights.forEach((l, i) => l.material.color.set((Math.floor(t * 6) + i) % 3 === 0 ? '#ff6fd8' : '#ffd23f'));
      beam.material.opacity = 0.08 + 0.05 * Math.sin(t * 5);
    });

    this.tapTargets.push({ object: ufo, onTap: () => { this.say(pick(UFO_LINES)); this.playSound('ufo'); } });
    return ufo;
  },

  // Hologram outline of the door on the reticle, so you see where and how big it will be.
  buildGhost() {
    const ghost = new THREE.Group();
    ghost.add(mesh(new THREE.TubeGeometry(archCurve(DOOR.halfW, DOOR.height), 120, 0.008, 6),
      basic('#7ff6ff', { transparent: true, opacity: 0.55, depthWrite: false })));
    ghost.add(mesh(new THREE.ShapeGeometry(drawArch(new THREE.Shape(), DOOR.halfW, DOOR.height), 24),
      basic('#45e6ff', { transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })));
    return ghost;
  },

  /* -------------------------------------------------------------------
     Placement (same idea as ar-8thwall.js: the floor is the plane y = 0)
     ------------------------------------------------------------------- */
  floorHit(x, y) {
    const camera = this.el.camera;
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, camera);
    const p = this.raycaster.ray.intersectPlane(this.floor, this.hitPoint);
    if (!p) return null;
    camera.getWorldPosition(this.cam);
    return p.distanceTo(this.cam) < 7 ? p : null;
  },

  // Rotation (around y) that turns the door's front towards the camera.
  faceCamera(point) {
    this.el.camera.getWorldPosition(this.cam);
    return Math.atan2(this.cam.x - point.x, this.cam.z - point.z);
  },

  place(point, yaw = this.faceCamera(point)) {
    this.portal.position.copy(point);
    this.portal.rotation.set(0, yaw, 0);
    this.portal.scale.setScalar(0.001);
    this.portal.visible = true;
    this.world.visible = true;
    this.reticle.object3D.visible = false;
    this.placed = true;
    this.openT = 0;
    this.prevCam = null;
    this.zone = 'earth';
    this.setState('placed');
    this.el.emit('portal-zone', { zone: 'earth', trips: this.trips });
    this.playSound('open');
    Hum.start();
    setTimeout(() => this.say('Teleporter installed. Walk through the door!', 3000), 900);
  },

  resetPlacement() {
    this.placed = false;
    this.portal.visible = false;
    this.zone = 'earth';
    this.el.emit('portal-zone', { zone: 'earth', trips: this.trips });
    this.setState('searching');
    Hum.stop();
    this.playSound('reset');
  },

  setOverclock(on) {
    this.targetSpeed = on ? 3 : 1;
    this.playSound(on ? 'overclock' : 'reset');
    this.say(on ? 'Overclocking the teleporter… warranty void.' : 'Back to factory settings. The duck is relieved.', 2600);
  },

  /* -------------------------------------------------------------------
     Walking through the door
     ------------------------------------------------------------------- */
  checkCrossing(p) {
    const prev = this.prevCam;
    if (!prev) { this.prevCam = p.clone(); return; }
    if ((prev.z > 0) !== (p.z > 0)) {
      // x where the path crossed the door plane
      const k = prev.z / (prev.z - p.z);
      const x = prev.x + (p.x - prev.x) * k;
      const throughDoor = Math.abs(x) < DOOR.halfW + 0.12;
      if (p.z <= 0) {
        this.setZone(throughDoor && this.zone === 'earth' ? 'inside' : 'behind');
      } else {
        this.setZone('earth', { throughDoor });
      }
    }
    prev.copy(p);
  },

  setZone(zone, { throughDoor = true } = {}) {
    if (zone === this.zone) return;
    const from = this.zone;
    this.zone = zone;
    this.world.visible = zone !== 'behind';

    if (zone === 'inside') {
      this.trips++;
      const [title, sub] = pick(ENTER_LINES);
      Teleport.flash(title, sub);
      this.playSound('enter');
      setTimeout(() => this.say('Tap the duck. You know you want to.', 3000), 1600);
    } else if (zone === 'earth' && from === 'inside') {
      const [title, sub] = throughDoor ? pick(EXIT_LINES) : ['You walked through a wall', 'The duck is deeply impressed.'];
      Teleport.flash(title, sub, true);
      this.playSound('exit');
    } else if (zone === 'behind') {
      this.say('Psst… this is the back of the teleporter. The magic is on the front.', 3200);
    }
    this.el.emit('portal-zone', { zone, trips: this.trips });
    this.setState(zone === 'inside' ? 'inside' : zone === 'behind' ? 'behind' : 'placed');
  },

  squeezeDuck() {
    this.duckTaps++;
    this.duckJump = 0;
    this.playSound('squeak');
    this.say(DUCK_LINES[this.duckTaps] || pick(DUCK_RANDOM));
  },

  say(text, ms = 2400) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  },

  /* -------------------------------------------------------------------
     Taps
     ------------------------------------------------------------------- */
  onTap(evt) {
    if (!this.tracking || this.calibrating || evt.target !== this.el.canvas) return;
    Sound.unlock();

    if (!this.placed) {
      const hit = this.floorHit(0, 0);
      if (hit) this.place(hit);
      else this.say('Point your phone at the floor first');
      return;
    }

    const rect = this.el.canvas.getBoundingClientRect();
    this.ndc.set(((evt.clientX - rect.left) / rect.width) * 2 - 1, -((evt.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.el.camera);
    // Things inside the dimension only count when visible (seen through the door or from inside).
    const targets = this.tapTargets.filter((t) => this.world.visible || !this.isInWorld(t.object));
    const hits = this.raycaster.intersectObjects(targets.map((t) => t.object), true);
    if (!hits.length) return;
    // From outside, a hit behind the hider wall (not through the door) does not count.
    const first = hits[0];
    if (this.zone === 'earth' && this.isInWorld(this.findTarget(first.object).object) && !this.seenThroughDoor(first.point)) return;
    this.findTarget(first.object).onTap();
  },

  isInWorld(object) {
    for (let o = object; o; o = o.parent) if (o === this.world) return true;
    return false;
  },

  findTarget(object) {
    for (let o = object; o; o = o.parent) {
      const t = this.tapTargets.find((x) => x.object === o);
      if (t) return t;
    }
    return null;
  },

  // Does the line from the camera to a world point pass through the door opening?
  seenThroughDoor(worldPoint) {
    const a = this.camLocal;
    const b = this.portal.worldToLocal(this.tmp.copy(worldPoint));
    if (a.z <= 0 || b.z >= 0) return false;
    const k = a.z / (a.z - b.z);
    return insideDoor(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
  },

  /* -------------------------------------------------------------------
     Every frame
     ------------------------------------------------------------------- */
  tick(time, dt) {
    if (!this.tracking || this.calibrating) return;

    if (!this.placed) {
      const hit = this.floorHit(0, 0);
      const reticle = this.reticle.object3D;
      if (hit) {
        reticle.position.copy(hit);
        reticle.rotation.set(0, this.faceCamera(hit), 0);
        reticle.visible = true;
        this.setState('ready');
      } else {
        reticle.visible = false;
        this.setState('searching');
      }
      return;
    }

    const t = time / 1000;
    const s = seconds(dt);

    // Opening animation: the door "pops" out of the floor.
    if (this.openT < 1) {
      this.openT = Math.min(1, this.openT + s / 1.1);
      this.portal.scale.setScalar(Math.max(0.001, easeOutBack(this.openT)));
    }

    this.speed = lerp(this.speed, this.targetSpeed, 1 - Math.exp(-s * 2.5));
    this.phase += s * this.speed;

    this.el.camera.getWorldPosition(this.cam);
    this.camLocal.copy(this.cam);
    this.portal.worldToLocal(this.camLocal);
    if (this.openT >= 1) this.checkCrossing(this.camLocal);
    else this.prevCam = null;

    this.anim.forEach((fn) => fn(t, s));

    const dist = this.camLocal.distanceTo(this.tmp.set(0, 1.1, 0));
    Hum.update(this.zone === 'inside' ? 0.5 : clamp01(1 - dist / 4), this.speed);
  }
});


/* =====================================================================
   4. SOUND (built on Sound from app.js)
   ===================================================================== */

// Low teleporter hum that gets louder near the door.
const Hum = {
  nodes: null,
  start() {
    if (this.nodes || !Sound.ctx) return;
    const ctx = Sound.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const a = ctx.createOscillator();
    const b = ctx.createOscillator();
    a.type = 'sawtooth'; a.frequency.value = 55;
    b.type = 'sine';     b.frequency.value = 110.6;
    a.connect(filter); b.connect(filter);
    filter.connect(gain).connect(Sound.master);
    a.start(); b.start();
    this.nodes = { gain, a, b, filter };
  },
  update(level, speed) {
    if (!this.nodes) return;
    const now = Sound.ctx.currentTime;
    this.nodes.gain.gain.setTargetAtTime(0.012 + level * 0.06, now, 0.2);
    this.nodes.a.frequency.setTargetAtTime(55 * speed, now, 0.3);
    this.nodes.b.frequency.setTargetAtTime(110.6 * speed, now, 0.3);
    this.nodes.filter.frequency.setTargetAtTime(420 + (speed - 1) * 300, now, 0.3);
  },
  stop() {
    if (!this.nodes) return;
    const now = Sound.ctx.currentTime;
    this.nodes.gain.gain.setTargetAtTime(0, now, 0.1);
    this.nodes.a.stop(now + 0.5);
    this.nodes.b.stop(now + 0.5);
    this.nodes = null;
  }
};

AFRAME.components['teleporter-portal'].Component.prototype.playSound = function (name) {
  if (!Sound.ctx) return;           // audio not unlocked yet (no tap so far)
  switch (name) {
    case 'open':
      Sound.tone(80, 320, 1.1, 'sawtooth', 0.08);
      Sound.tone(220, 880, 1.0, 'triangle', 0.1, 0.1);
      Sound.tone(660, 1760, 0.6, 'sine', 0.06, 0.6);
      Sound.whoosh(1.2, 0.3, 200, 2500);
      break;
    case 'enter':
      Sound.whoosh(0.9, 0.45, 400, 5000);
      Sound.tone(1200, 300, 0.6, 'sine', 0.12);
      [0, 0.08, 0.16, 0.24].forEach((d, i) => Sound.tone(880 * (1 + i * 0.25), 880 * (1 + i * 0.25), 0.25, 'triangle', 0.06, 0.35 + d));
      break;
    case 'exit':
      Sound.whoosh(0.9, 0.4, 5000, 300);
      Sound.tone(300, 1200, 0.5, 'sine', 0.1);
      break;
    case 'squeak':
      Sound.tone(1300, 1900, 0.09, 'square', 0.05);
      Sound.tone(1900, 1100, 0.16, 'square', 0.05, 0.09);
      break;
    case 'ufo':
      Sound.tone(600, 1400, 0.4, 'sine', 0.08);
      Sound.tone(1400, 500, 0.4, 'sine', 0.08, 0.4);
      break;
    case 'overclock':
      Sound.tone(110, 880, 1.2, 'sawtooth', 0.06);
      Sound.whoosh(1.0, 0.25, 300, 4000);
      break;
    case 'reset':
      Sound.tone(520, 260, 0.25, 'sine', 0.12);
      break;
  }
};


/* =====================================================================
   5. PAGE LOGIC
   ===================================================================== */

// Full-screen flash while crossing between dimensions.
const Teleport = {
  flash(title, sub, exiting = false) {
    const el = document.getElementById('teleport-fx');
    document.getElementById('teleport-fx-title').textContent = title;
    document.getElementById('teleport-fx-sub').textContent = sub;
    el.classList.toggle('exiting', exiting);
    el.classList.remove('play');
    void el.offsetWidth;            // restart the CSS animation
    el.classList.add('play');
  }
};

const PORTAL_HINTS = {
  calibrating: ['Measuring the room – move your phone slowly forward and back', true],
  searching: ['Point your phone at the floor and move it slowly', true],
  ready: ['Tap to install the teleporter (no screws needed)', false],
  placed: ['Walk through the door. Seriously, go.', false],
  inside: ['You are in Dimension 42 · walk back through the door to return', false],
  behind: ['Wrong side! Walk around to the front of the door', false]
};

// Desktop preview: drop the AR components before the scene starts.
// (A-Frame waits for DOMContentLoaded before initialising the scene, and this
// listener is registered first, so it runs first.)
if (PREVIEW) {
  document.addEventListener('DOMContentLoaded', () => {
    const scene = document.querySelector('a-scene');
    ['xrweb', 'coaching-overlay', 'xrextras-loading', 'xrextras-runtime-error'].forEach((a) => scene.removeAttribute(a));
    scene.setAttribute('background', 'color: #3a4150');
    // Optional for screenshots: ?preview&pos=0 1.6 -2&rot=0 180 0
    const query = new URLSearchParams(location.search);
    const cam = document.getElementById('camera');
    cam.setAttribute('position', query.get('pos') || '0 1.6 3');
    cam.setAttribute('wasd-controls', 'acceleration: 20');
    if (query.get('rot')) {
      cam.setAttribute('look-controls', 'enabled: false');
      cam.setAttribute('rotation', query.get('rot'));
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const sceneEl = document.querySelector('a-scene');
  const portal = () => sceneEl.components['teleporter-portal'];
  const resetBtn = document.getElementById('btn-reset');
  const overclockBtn = document.getElementById('btn-overclock');
  let overclocked = false;

  sceneEl.addEventListener('portal-state', (evt) => {
    const [text, scanning] = PREVIEW && evt.detail.state === 'placed'
      ? ['Preview · drag to look, WASD to walk through the door, click the duck', false]
      : PORTAL_HINTS[evt.detail.state] || ['', false];
    UI.hint(text, scanning);
    const placed = ['placed', 'inside', 'behind'].includes(evt.detail.state);
    resetBtn.disabled = !placed;
    overclockBtn.disabled = !placed;
  });

  sceneEl.addEventListener('portal-zone', (evt) => {
    const { zone, trips } = evt.detail;
    const badge = document.getElementById('location');
    badge.classList.toggle('elsewhere', zone === 'inside');
    document.getElementById('location-text').textContent = zone === 'inside'
      ? `Location: Dimension 42 · trip #${trips}`
      : 'Location: Earth';
  });

  resetBtn.addEventListener('click', () => {
    overclocked = false;
    overclockBtn.textContent = 'Overclock';
    portal().targetSpeed = 1;
    portal().resetPlacement();
  });
  overclockBtn.addEventListener('click', () => {
    Sound.unlock();
    overclocked = !overclocked;
    overclockBtn.textContent = overclocked ? 'Calm down' : 'Overclock';
    portal().setOverclock(overclocked);
  });
  document.getElementById('btn-exit').addEventListener('click', () => { location.href = './'; });

});
