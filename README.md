# The Aether Artifact – WebXR AR Installation

A small augmented-reality installation that runs in a mobile web browser.
A printed **QR code** opens the website. The visitor taps **Enter AR**, points the phone
at the floor, and places a glowing **ancient-futuristic artifact** (≈ 46 cm tall)
into the real room. Tapping the crystal activates it: the glow gets stronger, the
fragments drift outward, the rings spin faster, an energy burst fires and a
synthesised sound plays.

Built with **HTML + CSS + JavaScript + A-Frame 1.7.1**. It uses real WebXR
(`immersive-ar` + `hit-test`). There is no fake camera background, no backend, no build step.

```
printed QR → phone camera → HTTPS website → Enter AR → scan the floor → tap → artifact placed → tap the crystal
```

---

## 1. Project structure

```text
WebXR-AR/                 (repository root = the "webxr-ar" project folder)
├── index.html            Page layout: landing screen, AR overlay, QR section, 3D scene
├── style.css             Look of all 2D UI (landing, AR buttons, QR poster, print layout)
├── app.js                All logic: A-Frame components, WebXR hit testing, sound, UI
├── qr-generator.py       Python script that creates a print-ready QR code PNG
├── README.md             This file
└── assets/
    └── audio/            Empty on purpose (sounds are synthesised, see its README)
```

### What each file does, and why it is needed

| File | What it does | Why it is needed |
|------|--------------|------------------|
| `index.html` | Declares the **landing screen**, the **AR overlay** (`#ar-ui`), the **QR CODE** section and the **A-Frame scene**. The artifact is built from A-Frame primitives (cylinders, cones, octahedrons, tori…). The `webxr` attribute on `<a-scene>` requests the `immersive-ar` session features. | It is the entry point the QR code opens. A-Frame lets you describe the 3D scene as HTML tags. |
| `style.css` | Dark translucent panels, rounded buttons, mobile-first layout, toast and hint animations, and a **print stylesheet** that prints only the QR poster. | Keeps the UI readable on top of a camera image and on small screens. |
| `app.js` | (1) shared state, (2) Web Audio sound effects, (3) custom **A-Frame components**, (4) page/UI logic and the QR generator. The most important component is `ar-placement` (hit testing, placement, anchors, crystal tapping). | A-Frame on its own only renders. Everything interactive and all WebXR logic lives here. |
| `qr-generator.py` | Creates a high-resolution PNG QR code with a label and the URL under it. | A printable QR code for the physical installation, generated offline. |
| `assets/audio/` | Placeholder for optional audio files. | Required by the assignment structure. Audio is synthesised in code, so it is empty. |

### How the files communicate

```
index.html
 ├─ <link href="style.css">              → styles every element with an id/class from index.html
 ├─ <script src="aframe.min.js">         → defines <a-scene>, <a-entity>, primitives and THREE
 ├─ <script src="qrcode.min.js" defer>   → defines qrcode(), used by the QR section in app.js
 └─ <script src="app.js">                → registers components BEFORE <a-scene> is parsed
        │
        ├─ Components used as HTML attributes in index.html:
        │     ar-placement, artifact-energy, spin, orbit-fragment, energy-particles,
        │     soft-glow, shadow-catcher, procedural-stone, preview-turntable, simple-environment
        │
        ├─ ar-placement  ──emits "ar-state" event──▶  UI code (hint text, enabling buttons)
        ├─ UI buttons    ──call──▶ resetPlacement() / toggleArtifact() / sceneEl.exitVR()
        ├─ toggleArtifact() ─▶ ArtifactState.targetEnergy (0 or 1)
        │                     └─ emits "activate" on .fx entities → A-Frame animations in index.html
        └─ ArtifactState.energy (smoothed 0..1) is read every frame by
              spin, orbit-fragment, energy-particles, soft-glow, artifact-energy
```

- **HTML → JS:** custom components are attached as attributes, e.g.
  `<a-entity orbit-fragment="radius: 0.2; height: 0.3">`. A-Frame calls their `init()` and `tick()`.
- **JS → HTML:** `app.js` finds elements by id (`#artifact`, `#reticle`, `#btn-reset`…),
  shows/hides them, and fires the `activate` event that starts the declarative
  `animation__*` effects written in `index.html`.
- **CSS ↔ JS:** `app.js` toggles the classes `in-ar`, `show`, `scanning` and `qr-open`.
  `style.css` decides what those states look like.

### How the AR part works (step by step)

1. **Support check:** `navigator.xr.isSessionSupported('immersive-ar')`. If it returns false,
   the page shows *"AR is not supported on this device/browser. Please use a compatible mobile browser."*
2. **Enter AR:** the button calls `sceneEl.enterAR()`. A-Frame then calls
   `navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'anchors'], domOverlay: { root: #ar-ui } })`.
3. **Hit-test source:** on `enter-vr`, `ar-placement` requests a `viewer` reference space and
   `session.requestHitTestSource({ space: viewerSpace })`. That is a ray from the centre of the screen.
4. **Every frame:** `frame.getHitTestResults(source)` returns real-world surface hits. Only
   **horizontal** hits (surface normal pointing up) are accepted. The reticle ring is moved there.
5. **Tap:** a screen tap is a WebXR `select` event. The *next* frame places the artifact at the
   reticle pose, upright and turned to face you. The artifact is hidden until this
   moment, so it never appears at an arbitrary coordinate.
6. **Anchoring:** if the optional `anchors` feature is available, an `XRAnchor` is created
   from the hit result, and every frame the artifact follows the anchor's pose. Without anchors it
   stays at the hit-test position, which is still world-locked by the device's tracking.
7. **Tapping the crystal:** after placement, each `select` event's ray
   (`inputSource.targetRaySpace`) is raycast against an invisible sphere around the crystal.
   A hit toggles the artifact.
8. **Buttons:** `Reset` removes the artifact (and its anchor) so it can be placed again.
   `Activate` toggles it. `Exit` ends the session. Taps on the buttons are kept out of
   the AR scene with the `beforexrselect` event.

---

## 2. Requirements – what needs what

| Part | WebXR browser | HTTPS | AR-capable device |
|------|:---:|:---:|:---:|
| Landing page, 3D preview, clicking the crystal in the preview | – | – | – |
| QR CODE section (generate / print / download) | – | – | – |
| `Enter AR` → `immersive-ar` session | ✅ | ✅ | ✅ |
| Hit testing (surface detection, reticle, placement) | ✅ | ✅ | ✅ |
| DOM overlay (buttons and messages visible inside AR) | ✅ (optional feature) | ✅ | ✅ |
| Anchors (extra stable placement) | ✅ (optional feature) | ✅ | ✅ |
| Sound (Web Audio API) | – | – | – (needs a tap first) |

**Known to work:** Chrome for Android on an ARCore-supported phone
([list of devices](https://developers.google.com/ar/devices)) with *Google Play Services for AR* installed.
Samsung Internet also supports WebXR AR on many Samsung phones.

**Not supported:** iPhone / iPad Safari. Apple does not expose `immersive-ar` in WebXR on iOS.
Desktop browsers don't support it either. These devices still see the landing page, the 3D
preview and the fallback message.

**HTTPS:** browsers only expose WebXR on secure origins: `https://…` or `http://localhost`.
GitHub Pages, Netlify and Vercel all serve HTTPS automatically.

---

## 3. Setup

No installation or build step is needed for the website. A-Frame and the QR library load from CDNs.

Optional, only for the Python QR generator:

```bash
pip install "qrcode[pil]"
```

---

## 4. Run it locally

```bash
# in the project folder
python -m http.server 8000
# or:  npx serve .
```

Open <http://localhost:8000> on your computer. You will see the landing page and a turning
3D preview. Click the crystal to test the activation animation and sound. The desktop
browser will (correctly) say AR is not supported.

### Testing AR on your phone during development

A phone cannot open `http://192.168.x.x:8000` in AR because that is **not HTTPS**. Use one of these:

1. **USB port forwarding (recommended, free):**
   - Enable *Developer options → USB debugging* on the Android phone and connect it by USB.
   - On the computer open `chrome://inspect/#devices` in Chrome → **Port forwarding…** →
     add `8000` → `localhost:8000` → enable.
   - On the phone, open `http://localhost:8000` in Chrome. `localhost` counts as secure, so AR works.
   - You also get the phone's console in `chrome://inspect`, which helps with debugging.
2. **HTTPS tunnel:** run `npx localtunnel --port 8000` (or `ngrok http 8000`) and open the
   `https://…` URL it prints on the phone.
3. **Just deploy** (next section). Every push updates the live HTTPS site.

---

## 5. Deploy

### GitHub Pages

This repository already has the remote `https://github.com/AdhurimThaqi/WebXR-AR.git`.

```bash
git add .
git commit -m "WebXR AR artifact"
git push origin main
```

Then on GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a branch" →
Branch: `main`, folder `/ (root)` → Save.** After about a minute the site is live at:

```
https://adhurimthaqi.github.io/WebXR-AR/
```

(GitHub Pages URLs are case-sensitive in the path, so keep `WebXR-AR` exactly as the repo name.)

### Netlify

- **Drag & drop:** go to <https://app.netlify.com/drop> and drop the project folder. You get an
  `https://something.netlify.app` URL immediately.
- **From Git:** *Add new site → Import an existing project → GitHub → WebXR-AR*. Leave
  **build command empty** and set **publish directory** to `.` (root). Deploy.

### Vercel

*Add New → Project → import the GitHub repo*. Framework preset: **Other**, no build command,
output directory: root. Deploy. You get `https://webxr-ar-xxx.vercel.app`.

---

## 6. Generate the QR code

Use the **final HTTPS URL** of your deployment. The QR code should point directly to the page
that contains the AR experience (`index.html`, i.e. the site root).

**Option A – in the website itself (easiest):** open the deployed site on a computer, press
**QR CODE** (or go to `https://…/#qr`). The URL field is already filled with the current address.
Press **Print** or **Download SVG**. The SVG is vector, so it stays sharp at any size.

**Option B – Python:**

```bash
pip install "qrcode[pil]"
python qr-generator.py https://adhurimthaqi.github.io/WebXR-AR/
python qr-generator.py https://adhurimthaqi.github.io/WebXR-AR/ -o poster.png --label "Scan to awaken the artifact"
```

This creates `qr-code.png` (≈ 1350 × 1620 px, 300 dpi metadata) with error correction **H**
(about 30 % of the code can be damaged or covered and it still scans).

**Option C – JavaScript snippet** (works in any page that loads `qrcode-generator`):

```js
const qr = qrcode(0, 'H');                       // auto size, high error correction
qr.addData('https://adhurimthaqi.github.io/WebXR-AR/');
qr.make();
document.body.innerHTML = qr.createSvgTag({ cellSize: 8, margin: 4 });
```

Always **test the QR code with a phone before printing**. It must open the HTTPS URL.

---

## 7. Print the QR code

- **Size:** at least **4 × 4 cm** for hand-held scanning, **8–10 cm** for a poster on a wall or
  stand. Rule of thumb: scanning distance ÷ 10 = minimum QR width.
- **Quiet zone:** keep the white border (4 modules) around the code. Don't crop it.
- **Contrast:** black on white, matte paper. Glossy paper or laminate can reflect light and
  fail to scan.
- **Printer settings:** print at **100 % / "Actual size"**, not "fit to page", so it isn't blurred.
- **Placement:** put it next to a clear, well-lit **floor or table area**. Hit testing needs a
  textured, non-reflective surface, so avoid glass, mirrors and plain white surfaces.
- Add a short instruction next to it, e.g. *"Scan with your Android phone camera → Enter AR →
  point at the floor"*. The built-in **Print** button already lays this out as a poster.

---

## 8. The visitor journey

1. **Printed QR:** the visitor points the phone's camera app at the poster.
2. **Phone:** the camera recognises the URL and shows a link. Tap it, and the site opens in the
   default browser (on Android usually Chrome).
3. **Website:** the landing screen appears with the turning artifact preview and the
   **Enter AR** button. The page has already checked `immersive-ar` support. Unsupported
   devices see the fallback message instead.
4. **AR:** tap **Enter AR** and allow camera access the first time. The camera view appears
   with the hint *"Point your phone at the floor and move it slowly"*.
5. **Surface detection:** after 1–3 seconds of moving the phone, a glowing ring (reticle) sits
   on the floor. The hint changes to *"Tap the screen to place the artifact"*.
6. **Placed object:** tap. The artifact grows out of the floor where the ring was, facing
   the visitor, with a soft shadow on the real floor. Walk around it, crouch, look from above.
7. **Interaction:** tap the crystal (or the **Activate** button). It flares up, fragments drift
   outward, rings spin faster, a shockwave and beam fire, and *"Artifact activated"* appears.
   Tap again to return it to idle. **Reset** lets you place it somewhere else. **Exit** returns
   to the landing page.

---

## 9. Common problems and fixes

| Problem | Cause | Fix |
|---------|-------|-----|
| "AR is not supported on this device/browser" on an Android phone | Not Chrome, ARCore not installed or the phone isn't ARCore-certified | Open in Chrome. Install/update **Google Play Services for AR** from the Play Store. Check the [device list](https://developers.google.com/ar/devices). |
| Same message on iPhone | iOS Safari has no WebXR AR | Use an Android phone. iOS is not supported by WebXR `immersive-ar`. |
| Fallback message says "WebXR only works on HTTPS pages" | Opened via `http://192.168…` | Use the deployed HTTPS URL, USB port forwarding to `localhost`, or an HTTPS tunnel. |
| QR code opens the page inside another app (e.g. a scanner app's built-in browser) and AR fails | In-app browsers often have no WebXR | Use the phone's normal camera app, or choose "Open in Chrome". |
| "Could not start AR" after pressing the button | Camera permission denied, or the session was refused | Allow the camera in Chrome site settings (lock icon → Permissions), then reload. |
| The ring never appears | Surface too dark, shiny or featureless, or the phone isn't moving | Turn on lights, aim at a textured floor/table, move the phone slowly side to side for a few seconds. |
| The artifact drifts slightly | Tracking is still learning the room | Scan the room a bit longer before placing. On devices with anchors this improves automatically. Press **Reset** and place it again. |
| Buttons are not visible in AR | Browser does not support the DOM overlay | Tapping away from the crystal moves the artifact instead (fallback). Use the phone's back gesture to leave AR. |
| No sound | Phone in silent mode, or the audio context was blocked | Turn the ringer/media volume up. The sound unlocks with the **Enter AR** tap. |
| Changes don't show after deploying | Browser / CDN cache | Hard-reload, or wait 1–2 minutes (GitHub Pages caches for up to 10 min). |
| 404 on GitHub Pages | Pages not enabled, wrong branch/folder or case-sensitive path | Settings → Pages → `main` / `root`. Use the exact URL `…/WebXR-AR/`. |
| Blank page locally when opening `index.html` by double-click | `file://` pages lack a secure context for XR | Always use a local server (`python -m http.server`). |

---

## 10. Customising

- **Size of the artifact:** change `scale` on `#artifact-model` in `index.html`
  (e.g. `scale="1.5 1.5 1.5"` for ≈ 70 cm). The `animation__appear` `to:` value must match.
- **Colours:** the cyan glow is `#22e4ff` / `#00b4e6`, the gold is `#c9a35a`. Search and replace them.
- **Activation strength:** values in `artifact-energy` (`lerp(1.1, 3.2, e)` etc.) and the
  `boost` / `push` values on `spin` and `orbit-fragment`.
- **Your own 3D model:** replace `#artifact-model`'s contents with
  `<a-entity gltf-model="url(assets/model.glb)"></a-entity>`. The placement logic stays the same.

---

## Technologies

- [A-Frame 1.7.1](https://aframe.io) (bundles three.js r173) – scene description and WebXR session handling
- [WebXR Device API](https://immersive-web.github.io/webxr/) – `immersive-ar`
- [WebXR Hit Test Module](https://immersive-web.github.io/hit-test/) – surface detection
- [WebXR DOM Overlays](https://immersive-web.github.io/dom-overlays/) – HTML UI inside AR (optional)
- [WebXR Anchors](https://immersive-web.github.io/anchors/) – world-locked placement (optional)
- Web Audio API – synthesised sound effects
- [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (browser) and
  [qrcode](https://pypi.org/project/qrcode/) (Python) – QR codes
