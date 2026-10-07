/* =====================================================================
   The Aether Artifact – AR mode for phones without WebXR AR (8th Wall)
   ---------------------------------------------------------------------
   Used by ar-8thwall.html (iPhone / iPad, Android without ARCore).
   app.js is loaded first, so the artifact components, ArtifactState,
   Sound, UI and toggleArtifact() are shared with the WebXR version.

   The difference to the WebXR version (ar-placement in app.js):
     - 8th Wall's SLAM tracking moves the camera; the real floor is
       always the plane y = 0. There is no hit-test API, so the reticle
       is where a ray from the screen centre meets that plane.
     - Taps are normal DOM clicks on the canvas, not WebXR "select" events.
   ===================================================================== */

AFRAME.registerComponent('xr8-placement', {
  schema: {
    target: { default: '#artifact' },      // the artifact entity (copied from index.html)
    reticle: { default: '#reticle' },
    hitProxy: { default: '#crystal-hit' }  // invisible sphere around the crystal
  },

  init() {
    this.placed = false;
    this.tracking = false;          // true once the camera + SLAM are running
    this.state = '';
    this.target = null;

    this.raycaster = new THREE.Raycaster();
    this.floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hitPoint = new THREE.Vector3();
    this.cameraPosition = new THREE.Vector3();
    this.ndc = new THREE.Vector2();

    this.reticle = document.querySelector(this.data.reticle);   // in ar-8thwall.html, parsed before the scene inits

    this.onTap = this.onTap.bind(this);
    document.addEventListener('click', this.onTap);

    this.el.addEventListener('realityready', () => {
      this.tracking = true;
      if (!this.calibrating) this.setState('searching');
    });

    // scale: absolute – while the coaching overlay measures real-world
    // scale, the floor height isn't known yet, so nothing can be placed.
    this.calibrating = false;
    this.el.addEventListener('coaching-overlay.show', () => {
      this.calibrating = true;
      this.reticle.object3D.visible = false;
      this.setState('calibrating');
    });
    this.el.addEventListener('coaching-overlay.hide', () => {
      this.calibrating = false;
      this.setState(this.placed ? 'placed' : 'searching');
    });

    this.loadArtifact().catch((err) => {
      console.error('Could not load the artifact from index.html:', err);
      UI.hint('Could not load the artifact. Check your connection and reload.', false);
    });
  },

  remove() {
    document.removeEventListener('click', this.onTap);
  },

  // The artifact is defined once, in index.html. Copy that markup into this
  // scene so both AR modes always show exactly the same model.
  async loadArtifact() {
    const html = await (await fetch('index.html')).text();
    const source = new DOMParser().parseFromString(html, 'text/html').querySelector(this.data.target);
    const artifact = document.importNode(source, true);
    artifact.querySelector('#artifact-model').removeAttribute('preview-turntable');
    artifact.setAttribute('position', '0 0 0');
    artifact.setAttribute('visible', 'false');   // only appears once placed
    this.el.appendChild(artifact);
    if (!artifact.hasLoaded) await new Promise((r) => artifact.addEventListener('loaded', r, { once: true }));

    this.target = artifact;
    this.hitProxy = artifact.querySelector(this.data.hitProxy);
  },

  // Tell the UI what is going on (only when the state really changes).
  setState(state) {
    if (state === this.state) return;
    this.state = state;
    this.el.emit('ar-state', { state });
  },

  // Point where the ray through a screen point (-1..1 coordinates)
  // meets the floor, or null when the phone points above the horizon.
  floorHit(x, y) {
    const camera = this.el.camera;
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, camera);
    const p = this.raycaster.ray.intersectPlane(this.floor, this.hitPoint);
    if (!p) return null;
    camera.getWorldPosition(this.cameraPosition);
    return p.distanceTo(this.cameraPosition) < 6 ? p : null;   // ignore points near the horizon
  },

  // ---- Every frame: move the reticle until the artifact is placed ----
  tick() {
    if (!this.tracking || this.calibrating || !this.target || this.placed) return;
    const hit = this.floorHit(0, 0);
    const reticle = this.reticle.object3D;
    if (hit) {
      reticle.position.copy(hit);
      reticle.visible = true;
      this.setState('ready');
    } else {
      reticle.visible = false;
      this.setState('searching');
    }
  },

  // ---- A tap on the camera view ----
  onTap(evt) {
    if (!this.tracking || this.calibrating || !this.target || evt.target !== this.el.canvas) return;
    Sound.unlock();

    if (!this.placed) {
      const hit = this.floorHit(0, 0);
      if (hit) this.place(hit);
      else UI.toast('Point your phone at the floor first');
      return;
    }

    // Placed: did the tap hit the crystal?
    const rect = this.el.canvas.getBoundingClientRect();
    this.ndc.set(
      ((evt.clientX - rect.left) / rect.width) * 2 - 1,
      -((evt.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.ndc, this.el.camera);
    if (this.raycaster.intersectObject(this.hitProxy.object3D, true).length > 0) toggleArtifact();
  },

  place(point) {
    const target = this.target.object3D;
    target.position.copy(point);

    // Stand upright and turn the front towards the user.
    this.el.camera.getWorldPosition(this.cameraPosition);
    target.rotation.set(0, Math.atan2(this.cameraPosition.x - point.x, this.cameraPosition.z - point.z), 0);

    target.visible = true;
    this.reticle.object3D.visible = false;
    this.placed = true;
    this.setState('placed');
    this.target.querySelector('#artifact-model').emit('appear', null, false);
    Sound.play('place');
  },

  // Called by the Reset button.
  resetPlacement() {
    if (!this.target) return;
    this.placed = false;
    this.target.object3D.visible = false;
    setArtifactActive(false, { silent: true });
    this.setState('searching');
    Sound.play('reset');
  }
});


/* ---------------------------------------------------------------------
   Page logic: hint text and the three AR buttons.
   --------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  const sceneEl = document.querySelector('a-scene');
  const placement = () => sceneEl.components['xr8-placement'];

  sceneEl.addEventListener('ar-state', (evt) => UI.showState(evt.detail.state));
  UI.setPlacedControls(false);

  document.getElementById('btn-reset').addEventListener('click', () => placement().resetPlacement());
  document.getElementById('btn-activate').addEventListener('click', () => {
    Sound.unlock();
    toggleArtifact();
  });
  document.getElementById('btn-exit').addEventListener('click', () => { location.href = './'; });
});
