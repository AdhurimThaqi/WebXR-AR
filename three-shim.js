// Lets three.js example modules (the USDZExporter used for iPhone AR)
// import from 'three' and receive A-Frame's built-in THREE instead of
// downloading a second copy of three.js. Mapped in index.html's import map.
const THREE = window.THREE;

export const { NoColorSpace, DoubleSide, Color } = THREE;
export default THREE;
