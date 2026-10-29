// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 0, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio || 1);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
dirLight.position.set(4, 6, 5);
scene.add(dirLight);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

const shapeGroup = new THREE.Group();
worldGroup.add(shapeGroup);

const pointColorHex = 0x5ec8ff;
const highlightColorHex = 0xffd166;
let stellGlowMaterials = []; // materials pulsed each frame in animate() for the stellation map's focused-region glow
const faceColorHex = 0x2b6fb8;
const sphereGeo = new THREE.SphereGeometry(0.09, 16, 16);

const settings = { transparent: true };
