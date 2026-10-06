# assets/audio

This folder is intentionally empty.

All sound effects (placing, activating, deactivating, resetting) are generated
live in `app.js` with the **Web Audio API** (oscillators + filtered noise), so the
project needs no audio files and works offline once loaded.

If you want to use recorded sounds instead, put files such as `activate.mp3`
here and play them from `app.js`, for example:

```js
const activateSound = new Audio('assets/audio/activate.mp3');
activateSound.play();
```
