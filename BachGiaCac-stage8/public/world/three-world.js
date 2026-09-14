import * as THREE from '/vendor/three.module.js';

const canvas = document.createElement('canvas');
canvas.id = 'three-world';
canvas.setAttribute('aria-hidden', 'true');
canvas.setAttribute('role', 'presentation');
document.body.prepend(canvas);

let renderer;
let animationFrame = 0;
let observer;
let resizeObserver;
let disposed = false;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const scene = new THREE.Scene();
const sceneRoot = new THREE.Group();
const environment = new THREE.Group();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
const testMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.035, color: 0xa9434b, wireframe: true });
const testObject = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), testMaterial);
const cloudRoot = new THREE.Group();
cloudRoot.name = 'CloudSystem';

const themeProfiles = {
  'hong-lien': {
    sky: 0xfff2e8,
    ground: 0x775b68,
    ambient: 0xfff7ef,
    ambientIntensity: 0.26,
    key: 0xffc08f,
    keyIntensity: 0.34,
    keyPosition: [-3, 4, 4],
    fog: 0xf2ded8,
    fogNear: 7,
    fogFar: 25,
    object: 0xa9434b,
    moon: 0xffc997,
    particles: 0xffb7c4,
    cloud: 0xfff3ed,
    cloudOpacity: [0.06, 0.09, 0.12]
  },
  'bang-tien': {
    sky: 0xe4f3ff,
    ground: 0x3d5a78,
    ambient: 0xe8f5ff,
    ambientIntensity: 0.3,
    key: 0xaedbff,
    keyIntensity: 0.38,
    keyPosition: [-2, 5, 3],
    fog: 0xd7e9f7,
    fogNear: 7,
    fogFar: 26,
    object: 0x5f9fe8,
    moon: 0xb8e8ff,
    particles: 0xbfeaff,
    cloud: 0xe9f6ff,
    cloudOpacity: [0.06, 0.085, 0.11]
  }
};

const hemisphereLight = new THREE.HemisphereLight(0xfff7ef, 0x506070, 0.65);
const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
const keyLight = new THREE.DirectionalLight(0xffd2b5, 0.34);
keyLight.position.set(-3, 4, 4);
keyLight.castShadow = false;

const cloudCanvas = document.createElement('canvas');
cloudCanvas.width = 256;
cloudCanvas.height = 128;
const cloudContext = cloudCanvas.getContext('2d');
if (!cloudContext) throw new Error('Cloud texture canvas is unavailable');
const cloudGradient = cloudContext.createRadialGradient(128, 68, 4, 128, 68, 122);
cloudGradient.addColorStop(0, 'rgba(255,255,255,.8)');
cloudGradient.addColorStop(.55, 'rgba(255,255,255,.38)');
cloudGradient.addColorStop(1, 'rgba(255,255,255,0)');
cloudContext.fillStyle = cloudGradient;
cloudContext.beginPath();
cloudContext.ellipse(128, 70, 116, 42, 0, 0, Math.PI * 2);
cloudContext.fill();
cloudContext.globalCompositeOperation = 'lighter';
for (const puff of [[66, 72, 42, 30], [106, 52, 48, 38], [153, 60, 55, 34], [201, 75, 39, 27]]) {
  cloudContext.beginPath();
  cloudContext.ellipse(...puff, 0, 0, Math.PI * 2);
  cloudContext.fill();
}
cloudContext.globalCompositeOperation = 'source-over';
const cloudTexture = new THREE.CanvasTexture(cloudCanvas);
cloudTexture.colorSpace = THREE.SRGBColorSpace;

const glowCanvas = document.createElement('canvas');
glowCanvas.width = 128;
glowCanvas.height = 128;
const glowContext = glowCanvas.getContext('2d');
if (!glowContext) throw new Error('Glow texture canvas is unavailable');
const glowGradient = glowContext.createRadialGradient(64, 64, 2, 64, 64, 62);
glowGradient.addColorStop(0, 'rgba(255,205,145,.9)');
glowGradient.addColorStop(.35, 'rgba(255,174,125,.34)');
glowGradient.addColorStop(1, 'rgba(255,174,125,0)');
glowContext.fillStyle = glowGradient;
glowContext.fillRect(0, 0, 128, 128);
const glowTexture = new THREE.CanvasTexture(glowCanvas);
glowTexture.colorSpace = THREE.SRGBColorSpace;

const moonCanvas = document.createElement('canvas');
moonCanvas.width = 128;
moonCanvas.height = 128;
const moonContext = moonCanvas.getContext('2d');
if (!moonContext) throw new Error('Moon texture canvas is unavailable');
const moonGradient = moonContext.createRadialGradient(64, 64, 2, 64, 64, 62);
moonGradient.addColorStop(0, 'rgba(238,252,255,.82)');
moonGradient.addColorStop(.32, 'rgba(190,235,255,.34)');
moonGradient.addColorStop(1, 'rgba(154,214,255,0)');
moonContext.fillStyle = moonGradient;
moonContext.fillRect(0, 0, 128, 128);
const moonTexture = new THREE.CanvasTexture(moonCanvas);
moonTexture.colorSpace = THREE.SRGBColorSpace;

const textureLoader = new THREE.TextureLoader();
const hongLienRoot = new THREE.Group();
hongLienRoot.name = 'HongLienScene';
hongLienRoot.userData.assetType = '[2.5D]';
const hongLienBackground = new THREE.Group();
hongLienBackground.name = 'HongLienBackground';
const hongLienFar = new THREE.Group();
hongLienFar.name = 'HongLienFar';
const hongLienMid = new THREE.Group();
hongLienMid.name = 'HongLienMid';

const hongLienMountainMaterial = new THREE.SpriteMaterial({
  color: 0xfff1e7,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  fog: true
});
const hongLienPalaceMaterial = new THREE.SpriteMaterial({
  color: 0xffd9c9,
  transparent: true,
  opacity: 0.52,
  depthWrite: false,
  fog: true
});
const hongLienGlowMaterial = new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffb477,
  transparent: true,
  opacity: 0.14,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false
});
const hongLienMountain = new THREE.Sprite(hongLienMountainMaterial);
hongLienMountain.name = 'HongLienMountainLayer';
hongLienMountain.position.set(0, -1.25, -15.5);
hongLienMountain.scale.set(20, 6.7, 1);
hongLienMountain.userData.assetType = '[2.5D]';
const hongLienPalace = new THREE.Sprite(hongLienPalaceMaterial);
hongLienPalace.name = 'HongLienPalaceLayer';
hongLienPalace.position.set(0, -0.55, -10.5);
hongLienPalace.scale.set(13, 7.2, 1);
hongLienPalace.userData.assetType = '[2.5D]';
const hongLienGlow = new THREE.Sprite(hongLienGlowMaterial);
hongLienGlow.name = 'HongLienWarmGlow';
hongLienGlow.position.set(-1.2, 2.15, -13.5);
hongLienGlow.scale.set(7.5, 7.5, 1);
hongLienGlow.userData.assetType = '[PROCEDURAL THREE.JS]';

hongLienBackground.add(hongLienMountain);
hongLienFar.add(hongLienGlow);
hongLienMid.add(hongLienPalace);
hongLienRoot.add(hongLienBackground, hongLienFar, hongLienMid);

let hongLienLoadedAssets = 0;
function markHongLienAssetLoaded() {
  hongLienLoadedAssets += 1;
  document.documentElement.dataset.threeWorldHongLienAssets = hongLienLoadedAssets === 2 ? 'ready' : 'pending';
}
function markHongLienAssetFailed() {
  document.documentElement.dataset.threeWorldHongLienAssets = 'fallback';
}
const hongLienMountainTexture = textureLoader.load(
  '/assets/themes/hong-lien/textures/mountains-far.png',
  (texture) => { texture.colorSpace = THREE.SRGBColorSpace; hongLienMountainMaterial.map = texture; hongLienMountainMaterial.needsUpdate = true; markHongLienAssetLoaded(); },
  undefined,
  markHongLienAssetFailed
);
const hongLienPalaceTexture = textureLoader.load(
  '/assets/themes/hong-lien/textures/palace-mid.png',
  (texture) => { texture.colorSpace = THREE.SRGBColorSpace; hongLienPalaceMaterial.map = texture; hongLienPalaceMaterial.needsUpdate = true; markHongLienAssetLoaded(); },
  undefined,
  markHongLienAssetFailed
);

const bangTienRoot = new THREE.Group();
bangTienRoot.name = 'BangTienScene';
bangTienRoot.userData.assetType = '[2.5D]';
const bangTienBackground = new THREE.Group();
bangTienBackground.name = 'BangTienBackground';
const bangTienFar = new THREE.Group();
bangTienFar.name = 'BangTienFar';
const bangTienMid = new THREE.Group();
bangTienMid.name = 'BangTienMid';

const bangTienMountainMaterial = new THREE.SpriteMaterial({
  color: 0xe8f7ff,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  fog: true
});
const bangTienPalaceMaterial = new THREE.SpriteMaterial({
  color: 0xccecff,
  transparent: true,
  opacity: 0.52,
  depthWrite: false,
  fog: true
});
const bangTienMoonGlowMaterial = new THREE.SpriteMaterial({
  map: moonTexture,
  color: 0xb8e8ff,
  transparent: true,
  opacity: 0.17,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false
});
const bangTienMountain = new THREE.Sprite(bangTienMountainMaterial);
bangTienMountain.name = 'BangTienMountainLayer';
bangTienMountain.position.set(0, -1.25, -15.5);
bangTienMountain.scale.set(20, 6.7, 1);
bangTienMountain.userData.assetType = '[2.5D]';
const bangTienPalace = new THREE.Sprite(bangTienPalaceMaterial);
bangTienPalace.name = 'BangTienPalaceLayer';
bangTienPalace.position.set(0, -0.55, -10.5);
bangTienPalace.scale.set(13, 7.2, 1);
bangTienPalace.userData.assetType = '[2.5D]';
const bangTienMoonGlow = new THREE.Sprite(bangTienMoonGlowMaterial);
bangTienMoonGlow.name = 'BangTienMoonGlow';
bangTienMoonGlow.position.set(2.3, 2.1, -13.5);
bangTienMoonGlow.scale.set(7.5, 7.5, 1);
bangTienMoonGlow.userData.assetType = '[PROCEDURAL THREE.JS]';

bangTienBackground.add(bangTienMountain);
bangTienFar.add(bangTienMoonGlow);
bangTienMid.add(bangTienPalace);
bangTienRoot.add(bangTienBackground, bangTienFar, bangTienMid);

const parallaxLayers = [
  { group: hongLienBackground, factor: 0.08 },
  { group: hongLienFar, factor: 0.16 },
  { group: hongLienMid, factor: 0.28 },
  { group: bangTienBackground, factor: 0.08 },
  { group: bangTienFar, factor: 0.16 },
  { group: bangTienMid, factor: 0.28 }
];
parallaxLayers.forEach(({ group, factor }) => {
  group.userData.parallaxFactor = factor;
  group.userData.parallaxBasePosition = group.position.clone();
});

let bangTienLoadedAssets = 0;
function markBangTienAssetLoaded() {
  bangTienLoadedAssets += 1;
  document.documentElement.dataset.threeWorldBangTienAssets = bangTienLoadedAssets === 2 ? 'ready' : 'pending';
}
function markBangTienAssetFailed() {
  document.documentElement.dataset.threeWorldBangTienAssets = 'fallback';
}
const bangTienMountainTexture = textureLoader.load(
  '/assets/themes/bang-tien/textures/mountains-far.png',
  (texture) => { texture.colorSpace = THREE.SRGBColorSpace; bangTienMountainMaterial.map = texture; bangTienMountainMaterial.needsUpdate = true; markBangTienAssetLoaded(); },
  undefined,
  markBangTienAssetFailed
);
const bangTienPalaceTexture = textureLoader.load(
  '/assets/themes/bang-tien/textures/palace-mid.png',
  (texture) => { texture.colorSpace = THREE.SRGBColorSpace; bangTienPalaceMaterial.map = texture; bangTienPalaceMaterial.needsUpdate = true; markBangTienAssetLoaded(); },
  undefined,
  markBangTienAssetFailed
);

const hongLienEffectsRoot = new THREE.Group();
hongLienEffectsRoot.name = 'HongLienEffects';
hongLienEffectsRoot.userData.assetType = '[2D SPRITE + PROCEDURAL THREE.JS]';
const bangTienEffectsRoot = new THREE.Group();
bangTienEffectsRoot.name = 'BangTienEffects';
bangTienEffectsRoot.userData.assetType = '[2D SPRITE + PROCEDURAL THREE.JS]';
const hongLienCraneMaterial = new THREE.SpriteMaterial({ color: 0xfff5f2, transparent: true, opacity: 0.18, depthWrite: false, fog: true });
const bangTienCraneMaterial = new THREE.SpriteMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.2, depthWrite: false, fog: true });
const hongLienPetalMaterial = new THREE.SpriteMaterial({ color: 0xffc4cf, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
const bangTienCrystalMaterial = new THREE.SpriteMaterial({ color: 0xc8eeff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });

function addCraneSprites(root, material, prefix, positions) {
  return positions.map(([x, y, z, scale, speed, phase]) => {
    const sprite = new THREE.Sprite(material);
    sprite.name = `${prefix}Crane`;
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale * 0.58, 1);
    sprite.userData.baseY = y;
    sprite.userData.speed = speed;
    sprite.userData.phase = phase;
    sprite.userData.assetType = '[2D SPRITE]';
    root.add(sprite);
    return sprite;
  });
}

function addDriftSprites(root, material, prefix, positions) {
  return positions.map(([x, y, z, scale, phase]) => {
    const sprite = new THREE.Sprite(material);
    sprite.name = `${prefix}Drift`;
    sprite.position.set(x, y, z);
    sprite.scale.set(scale, scale, 1);
    sprite.rotation.z = phase;
    sprite.userData.baseY = y;
    sprite.userData.phase = phase;
    sprite.userData.assetType = '[2D SPRITE]';
    root.add(sprite);
    return sprite;
  });
}

const hongLienCranes = addCraneSprites(hongLienEffectsRoot, hongLienCraneMaterial, 'HongLien', [[-7, 2.1, -8.5, 2.4, 0.00042, 0.2], [2.8, 2.8, -11, 1.55, 0.00027, 1.4]]);
const bangTienCranes = addCraneSprites(bangTienEffectsRoot, bangTienCraneMaterial, 'BangTien', [[-7, 2.3, -8.5, 2.4, 0.00036, 0.5], [3.2, 2.9, -11, 1.6, 0.00023, 1.8]]);
const hongLienDriftSprites = addDriftSprites(hongLienEffectsRoot, hongLienPetalMaterial, 'HongLienPetal', [[-3.8, 1.2, -6.5, 0.34, 0.1], [-1.8, -0.2, -7.8, 0.25, 1.2], [2.8, 1.1, -8.5, 0.3, 2.1], [5.2, -0.4, -6.2, 0.22, 0.7]]);
const bangTienDriftSprites = addDriftSprites(bangTienEffectsRoot, bangTienCrystalMaterial, 'BangTienCrystal', [[-4.2, 1.4, -6.5, 0.3, 0.4], [-1.4, -0.1, -7.6, 0.25, 1.7], [3.5, 1.2, -8.2, 0.32, 2.3], [5.4, -0.3, -6.4, 0.22, 0.9]]);

function createParticleField(name, color, opacity, seedOffset) {
  const count = 56;
  const positions = new Float32Array(count * 3);
  const basePositions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const hash = (value) => Math.sin(value * 12.9898 + seedOffset * 78.233) * 43758.5453 % 1;
    const x = hash(index + 1) * 14;
    const y = hash(index + 31) * 5.6 - 1.4;
    const z = -4.8 - Math.abs(hash(index + 61)) * 12;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    basePositions.set([x, y, z], index * 3);
    phases[index] = Math.abs(hash(index + 91)) * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color, size: 0.055, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, sizeAttenuation: true });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.userData.basePositions = basePositions;
  points.userData.phases = phases;
  points.userData.assetType = '[PROCEDURAL THREE.JS]';
  return { points, material, geometry };
}

const hongLienParticles = createParticleField('HongLienParticles', themeProfiles['hong-lien'].particles, 0.28, 1);
const bangTienParticles = createParticleField('BangTienParticles', themeProfiles['bang-tien'].particles, 0.3, 2);
hongLienEffectsRoot.add(hongLienParticles.points);
bangTienEffectsRoot.add(bangTienParticles.points);

let stage7LoadedAssets = 0;
function markStage7AssetLoaded() {
  stage7LoadedAssets += 1;
  document.documentElement.dataset.threeWorldStage7Assets = stage7LoadedAssets === 4 ? 'ready' : 'pending';
}
function markStage7AssetFailed() {
  document.documentElement.dataset.threeWorldStage7Assets = 'fallback';
}
const hongLienCraneTexture = textureLoader.load('/assets/themes/hong-lien/effects/crane-v2.png', (texture) => { texture.colorSpace = THREE.SRGBColorSpace; hongLienCraneMaterial.map = texture; hongLienCraneMaterial.needsUpdate = true; markStage7AssetLoaded(); }, undefined, markStage7AssetFailed);
const hongLienPetalTexture = textureLoader.load('/assets/themes/hong-lien/effects/petals-sprite.png', (texture) => { texture.colorSpace = THREE.SRGBColorSpace; hongLienPetalMaterial.map = texture; hongLienPetalMaterial.needsUpdate = true; markStage7AssetLoaded(); }, undefined, markStage7AssetFailed);
const bangTienCraneTexture = textureLoader.load('/assets/themes/bang-tien/effects/crane-v2.png', (texture) => { texture.colorSpace = THREE.SRGBColorSpace; bangTienCraneMaterial.map = texture; bangTienCraneMaterial.needsUpdate = true; markStage7AssetLoaded(); }, undefined, markStage7AssetFailed);
const bangTienCrystalTexture = textureLoader.load('/assets/themes/bang-tien/effects/crystals-sprite.png', (texture) => { texture.colorSpace = THREE.SRGBColorSpace; bangTienCrystalMaterial.map = texture; bangTienCrystalMaterial.needsUpdate = true; markStage7AssetLoaded(); }, undefined, markStage7AssetFailed);

const cloudLayerDefinitions = [
  { name: 'CloudFar', z: -16, y: 2.4, scale: [8.4, 2.35], speed: 0.00035, offsets: [-6.5, 2.5] },
  { name: 'CloudMid', z: -10, y: 1.1, scale: [7.2, 2.1], speed: 0.00062, offsets: [-4.8, 3.8] },
  { name: 'CloudNear', z: -5.5, y: -0.35, scale: [5.8, 1.75], speed: 0.0009, offsets: [-3.7, 3.2] }
];

const cloudLayers = cloudLayerDefinitions.map((definition, index) => {
  const group = new THREE.Group();
  group.name = definition.name;
  group.position.set(0, definition.y, definition.z);
  group.userData.speed = definition.speed;
  group.userData.baseY = definition.y;
  const material = new THREE.SpriteMaterial({
    map: cloudTexture,
    color: 0xffffff,
    transparent: true,
    opacity: themeProfiles['hong-lien'].cloudOpacity[index],
    depthWrite: false,
    fog: true
  });
  group.userData.material = material;
  definition.offsets.forEach((offset, spriteIndex) => {
    const sprite = new THREE.Sprite(material);
    sprite.position.set(offset, spriteIndex === 0 ? 0 : 0.24, 0);
    sprite.scale.set(...definition.scale, 1);
    sprite.userData.phase = spriteIndex * 0.7 + index * 0.4;
    group.add(sprite);
  });
  cloudRoot.add(group);
  return group;
});

scene.add(sceneRoot);
sceneRoot.add(environment);
environment.add(hemisphereLight, ambientLight, keyLight);
sceneRoot.add(hongLienRoot);
sceneRoot.add(bangTienRoot);
sceneRoot.add(hongLienEffectsRoot);
sceneRoot.add(bangTienEffectsRoot);
sceneRoot.add(cloudRoot);
testObject.position.set(1.5, 0.3, -6);
sceneRoot.add(testObject);
const cameraHomePosition = new THREE.Vector3(0, 0.15, 7);
const cameraHomeTarget = new THREE.Vector3(0, 0, -3);
const cameraLookTarget = new THREE.Vector3();
const pointerMotion = { targetX: 0, targetY: 0, x: 0, y: 0 };
function updatePointerMotion(event) {
  pointerMotion.targetX = THREE.MathUtils.clamp((event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1, -1, 1);
  pointerMotion.targetY = THREE.MathUtils.clamp((event.clientY / Math.max(window.innerHeight, 1)) * 2 - 1, -1, 1);
}
function resetPointerMotion() {
  pointerMotion.targetX = 0;
  pointerMotion.targetY = 0;
}
camera.position.copy(cameraHomePosition);
camera.lookAt(cameraHomeTarget);

let currentThemeKey = null;
let themeTransition = null;
const themeTransitionDuration = 520;
const themeTransitionColor = new THREE.Color();

function setThemeRootOpacity(root, factor) {
  root.visible = factor > 0.001;
  root.traverse((node) => {
    if (!node.material) return;
    if (node.userData.themeBaseOpacity === undefined) node.userData.themeBaseOpacity = node.material.opacity;
    node.material.opacity = node.userData.themeBaseOpacity * factor;
  });
}

function mixHex(from, to, progress) {
  themeTransitionColor.setHex(from).lerp(new THREE.Color(to), progress);
  return themeTransitionColor;
}

function applyThemeProfile(from, to, progress) {
  const sky = mixHex(from.sky, to.sky, progress);
  const ground = mixHex(from.ground, to.ground, progress);
  const ambient = mixHex(from.ambient, to.ambient, progress);
  const key = mixHex(from.key, to.key, progress);
  const fog = mixHex(from.fog, to.fog, progress);
  const object = mixHex(from.object, to.object, progress);
  const cloud = mixHex(from.cloud, to.cloud, progress);
  hemisphereLight.color.copy(sky);
  hemisphereLight.groundColor.copy(ground);
  ambientLight.color.copy(ambient);
  ambientLight.intensity = THREE.MathUtils.lerp(from.ambientIntensity, to.ambientIntensity, progress);
  keyLight.color.copy(key);
  keyLight.intensity = THREE.MathUtils.lerp(from.keyIntensity, to.keyIntensity, progress);
  keyLight.position.lerpVectors(new THREE.Vector3(...from.keyPosition), new THREE.Vector3(...to.keyPosition), progress);
  testMaterial.color.copy(object);
  bangTienMoonGlowMaterial.color.copy(mixHex(from.moon, to.moon, progress));
  hongLienParticles.material.color.copy(mixHex(from.particles, to.particles, progress));
  bangTienParticles.material.color.copy(mixHex(from.particles, to.particles, progress));
  cloudLayers.forEach((layer, index) => {
    layer.userData.material.color.copy(cloud);
    layer.userData.material.opacity = THREE.MathUtils.lerp(from.cloudOpacity[index], to.cloudOpacity[index], progress);
  });
  scene.fog = scene.fog || new THREE.Fog(fog, from.fogNear, from.fogFar);
  scene.fog.color.copy(fog);
  scene.fog.near = THREE.MathUtils.lerp(from.fogNear, to.fogNear, progress);
  scene.fog.far = THREE.MathUtils.lerp(from.fogFar, to.fogFar, progress);
  document.documentElement.dataset.threeWorldFog = `${scene.fog.near.toFixed(1)}-${scene.fog.far.toFixed(1)}`;
  document.documentElement.dataset.threeWorldProfile = document.documentElement.dataset.theme || 'hong-lien';
}

function applyThemeRoots(fromKey, toKey, progress) {
  const hongProgress = fromKey === 'hong-lien' && toKey === 'hong-lien' ? 1 : fromKey === 'hong-lien' ? 1 - progress : toKey === 'hong-lien' ? progress : 0;
  const bangProgress = fromKey === 'bang-tien' && toKey === 'bang-tien' ? 1 : fromKey === 'bang-tien' ? 1 - progress : toKey === 'bang-tien' ? progress : 0;
  setThemeRootOpacity(hongLienRoot, hongProgress);
  setThemeRootOpacity(bangTienRoot, bangProgress);
  setThemeRootOpacity(hongLienEffectsRoot, hongProgress);
  setThemeRootOpacity(bangTienEffectsRoot, bangProgress);
}

function themeProfile() {
  return themeProfiles[document.documentElement.dataset.theme] || themeProfiles['hong-lien'];
}

function syncTheme() {
  const targetKey = document.documentElement.dataset.theme === 'bang-tien' ? 'bang-tien' : 'hong-lien';
  if (currentThemeKey === null || reducedMotion.matches) {
    currentThemeKey = targetKey;
    themeTransition = null;
    applyThemeProfile(themeProfiles[targetKey], themeProfiles[targetKey], 1);
    applyThemeRoots(targetKey, targetKey, 1);
    document.documentElement.dataset.threeWorldThemeTransition = 'idle';
    return;
  }
  if (targetKey === currentThemeKey && !themeTransition) return;
  themeTransition = { from: currentThemeKey, to: targetKey, startedAt: performance.now() };
  document.documentElement.dataset.threeWorldThemeTransition = `${currentThemeKey}-to-${targetKey}`;
}

function render() {
  if (!renderer || disposed) return;
  renderer.render(scene, camera);
}

function frame() {
  if (disposed) return;
  const now = performance.now();
  if (themeTransition) {
    const rawProgress = Math.min(1, (performance.now() - themeTransition.startedAt) / themeTransitionDuration);
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);
    applyThemeProfile(themeProfiles[themeTransition.from], themeProfiles[themeTransition.to], progress);
    applyThemeRoots(themeTransition.from, themeTransition.to, progress);
    if (rawProgress >= 1) {
      currentThemeKey = themeTransition.to;
      themeTransition = null;
      applyThemeProfile(themeProfiles[currentThemeKey], themeProfiles[currentThemeKey], 1);
      applyThemeRoots(currentThemeKey, currentThemeKey, 1);
      document.documentElement.dataset.threeWorldThemeTransition = 'idle';
    }
  }
  if (!reducedMotion.matches) {
    testObject.rotation.y += 0.0018;
    testObject.rotation.x += 0.0005;
    pointerMotion.x += (pointerMotion.targetX - pointerMotion.x) * 0.045;
    pointerMotion.y += (pointerMotion.targetY - pointerMotion.y) * 0.045;
    parallaxLayers.forEach(({ group }) => {
      const basePosition = group.userData.parallaxBasePosition;
      const factor = group.userData.parallaxFactor;
      group.position.x = basePosition.x + pointerMotion.x * factor;
      group.position.y = basePosition.y - pointerMotion.y * factor * 0.55;
    });
    camera.position.x = cameraHomePosition.x + pointerMotion.x * 0.18 + Math.sin(now * 0.00032) * 0.018;
    camera.position.y = cameraHomePosition.y - pointerMotion.y * 0.12 + Math.cos(now * 0.00028) * 0.012;
    camera.position.z = cameraHomePosition.z;
    cameraLookTarget.set(pointerMotion.x * 0.06, -pointerMotion.y * 0.04, cameraHomeTarget.z);
    camera.lookAt(cameraLookTarget);
    cloudLayers.forEach((layer) => {
      layer.position.x += layer.userData.speed;
      if (layer.position.x > 8) layer.position.x = -8;
      layer.children.forEach((sprite) => {
        sprite.position.y = Math.sin(performance.now() * 0.00012 + sprite.userData.phase) * 0.04;
      });
    });
    [...hongLienCranes, ...bangTienCranes].forEach((crane) => {
      crane.position.x += crane.userData.speed;
      if (crane.position.x > 10.5) crane.position.x = -10.5;
      crane.position.y = crane.userData.baseY + Math.sin(now * 0.00055 + crane.userData.phase) * 0.08;
    });
    [...hongLienDriftSprites, ...bangTienDriftSprites].forEach((sprite) => {
      sprite.position.y = sprite.userData.baseY + Math.sin(now * 0.0007 + sprite.userData.phase) * 0.12;
      sprite.rotation.z += 0.00045;
    });
    [hongLienParticles, bangTienParticles].forEach((field) => {
      const positions = field.geometry.attributes.position.array;
      const basePositions = field.points.userData.basePositions;
      const phases = field.points.userData.phases;
      for (let index = 0; index < phases.length; index += 1) {
        positions[index * 3] = basePositions[index * 3] + Math.sin(now * 0.00032 + phases[index]) * 0.06;
        positions[index * 3 + 1] = basePositions[index * 3 + 1] + Math.sin(now * 0.0006 + phases[index]) * 0.08;
      }
      field.geometry.attributes.position.needsUpdate = true;
    });
  }
  render();
  animationFrame = window.requestAnimationFrame(frame);
}

function resize() {
  if (!renderer || disposed) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  render();
}

function cleanup() {
  disposed = true;
  window.cancelAnimationFrame(animationFrame);
  observer?.disconnect();
  resizeObserver?.disconnect();
  window.removeEventListener('resize', resize);
  window.removeEventListener('pointermove', updatePointerMotion);
  window.removeEventListener('blur', resetPointerMotion);
  testObject.geometry.dispose();
  testMaterial.dispose();
  cloudLayers.forEach((layer) => {
    layer.userData.material.dispose();
    layer.clear();
  });
  cloudTexture.dispose();
  glowTexture.dispose();
  moonTexture.dispose();
  hongLienCraneTexture.dispose();
  hongLienPetalTexture.dispose();
  bangTienCraneTexture.dispose();
  bangTienCrystalTexture.dispose();
  hongLienMountainTexture.dispose();
  hongLienPalaceTexture.dispose();
  bangTienMountainTexture.dispose();
  bangTienPalaceTexture.dispose();
  hongLienMountainMaterial.dispose();
  hongLienPalaceMaterial.dispose();
  hongLienGlowMaterial.dispose();
  bangTienMountainMaterial.dispose();
  bangTienPalaceMaterial.dispose();
  bangTienMoonGlowMaterial.dispose();
  hongLienCraneMaterial.dispose();
  bangTienCraneMaterial.dispose();
  hongLienPetalMaterial.dispose();
  bangTienCrystalMaterial.dispose();
  hongLienParticles.geometry.dispose();
  bangTienParticles.geometry.dispose();
  hongLienParticles.material.dispose();
  bangTienParticles.material.dispose();
  hongLienRoot.clear();
  bangTienRoot.clear();
  hongLienEffectsRoot.clear();
  bangTienEffectsRoot.clear();
  cloudRoot.clear();
  environment.children.forEach((light) => light.dispose?.());
  scene.fog = null;
  renderer?.dispose();
  canvas.remove();
}

try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  document.documentElement.dataset.threeWorld = 'ready';
  document.documentElement.dataset.threeWorldStage = '7';
  document.documentElement.dataset.threeWorldHongLien = 'ready';
  document.documentElement.dataset.threeWorldBangTien = 'ready';
  document.documentElement.dataset.threeWorldBangTienAssets = 'pending';
  document.documentElement.dataset.threeWorldStage7 = 'ready';
  document.documentElement.dataset.threeWorldStage7Assets = 'pending';
  document.documentElement.dataset.threeWorldStage7Effects = 'HongLienEffects,BangTienEffects';
  document.documentElement.dataset.threeWorldStage = '8';
  document.documentElement.dataset.threeWorldStage8 = 'ready';
  document.documentElement.dataset.threeWorldStage8Parallax = parallaxLayers.map(({ group }) => group.name).join(',');
  document.documentElement.dataset.threeWorldStage8Camera = 'pointer-idle';
  document.documentElement.dataset.threeWorldClouds = cloudLayers.map((layer) => layer.name).join(',');
  syncTheme();
  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', updatePointerMotion, { passive: true });
  window.addEventListener('blur', resetPointerMotion, { passive: true });
  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(document.documentElement);
  observer = new MutationObserver(syncTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (reducedMotion.matches) render();
  else frame();
  window.addEventListener('pagehide', cleanup, { once: true });
} catch (error) {
  document.documentElement.dataset.threeWorld = 'fallback';
  canvas.remove();
  console.warn('Three.js unavailable; using the CSS theme fallback.', error);
}
