import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const characters = {
  "mr-ghost": {
    name: "Mr Ghost",
    place: "AR Capture Zone",
    asset: "./assets/mr-ghost.glb",
    targetHeight: 1.05,
  },
};

const captureSeconds = 20;
const loader = new GLTFLoader();
const modelCache = new Map();

const introScreen = document.querySelector('[data-screen="intro"]');
const gameScreen = document.querySelector('[data-screen="game"]');
const completeScreen = document.querySelector('[data-screen="complete"]');
const previewViewport = document.querySelector("#previewViewport");
const rewardViewport = document.querySelector("#rewardViewport");
const gameCanvas = document.querySelector("#gameCanvas");
const characterSelect = document.querySelector("#characterSelect");
const arButton = document.querySelector("#arButton");
const startButton = document.querySelector("#startButton");
const exitButton = document.querySelector("#exitButton");
const playAgainButton = document.querySelector("#playAgainButton");
const shareButton = document.querySelector("#shareButton");
const previewName = document.querySelector("#previewName");
const gameTitle = document.querySelector("#gameTitle");
const completeTitle = document.querySelector("#completeTitle");
const rewardName = document.querySelector("#rewardName");
const cameraFeed = document.querySelector("#cameraFeed");
const cameraFallback = document.querySelector("#cameraFallback");
const captureReticle = document.querySelector("#captureReticle");
const statusPill = document.querySelector("#statusPill");
const statusText = document.querySelector("#statusText");
const timerFill = document.querySelector("#timerFill");
const timerText = document.querySelector("#timerText");

let selectedId = getCharacterId();
let selectedCharacter = characters[selectedId] || characters["mr-ghost"];
let stream = null;
let xrSession = null;
let xrSupported = false;
let iosMotionSupported = false;
let motionPermissionGranted = false;
let mode = "preview";
let running = false;
let captured = false;
let remaining = captureSeconds;
let lastFrame = 0;
let nextMoveAt = 0;
let worldTarget = new THREE.Vector3(0, 0, -2.1);
let yaw = 0;
let pitch = 0;
let motionYaw = 0;
let motionPitch = 0;
let motionOrigin = null;
let motionActive = false;
let cameraActive = false;
let iosSessionMessage = "";
let dragStart = null;
let studioRafId = 0;

const gameScene = new THREE.Scene();
const gameCamera = new THREE.PerspectiveCamera(68, 1, 0.01, 40);
gameCamera.position.set(0, 0, 0);
const gameRenderer = new THREE.WebGLRenderer({ canvas: gameCanvas, alpha: true, antialias: true });
gameRenderer.xr.enabled = true;
gameRenderer.xr.setReferenceSpaceType("local");
gameRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
gameRenderer.outputColorSpace = THREE.SRGBColorSpace;
gameRenderer.setClearColor(0x000000, 0);

const characterRig = new THREE.Group();
gameScene.add(characterRig);
gameScene.add(new THREE.HemisphereLight(0xffffff, 0x58427a, 2.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(1.2, 2.2, 1.8);
gameScene.add(keyLight);

const preview = makeStudio(previewViewport, 58);
const reward = makeStudio(rewardViewport, 46);

function getCharacterId() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("character") || params.get("id") || "mr-ghost").toLowerCase();
}

function isIOSDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function setScreen(screen) {
  [introScreen, gameScreen, completeScreen].forEach((node) => node.classList.remove("is-active"));
  screen.classList.add("is-active");
  if (screen === gameScreen) {
    stopStudios();
  } else {
    resizeGame();
    renderStudio(preview);
    renderStudio(reward);
    startStudios();
  }
}

async function loadModel(character) {
  if (!modelCache.has(character.asset)) {
    modelCache.set(character.asset, loader.loadAsync(character.asset).then((gltf) => gltf.scene));
  }
  const source = await modelCache.get(character.asset);
  const model = source.clone(true);
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.frustumCulled = false;
    }
  });
  normalizeModel(model, character.targetHeight);
  return model;
}

function normalizeModel(model, targetHeight) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (size.y > 0) {
    model.scale.multiplyScalar(targetHeight / size.y);
  }
  model.position.sub(center.multiplyScalar(model.scale.x));

  const normalizedBox = new THREE.Box3().setFromObject(model);
  const normalizedCenter = normalizedBox.getCenter(new THREE.Vector3());
  const normalizedSize = normalizedBox.getSize(new THREE.Vector3());
  model.position.x -= normalizedCenter.x;
  model.position.z -= normalizedCenter.z;
  model.position.y -= normalizedCenter.y - normalizedSize.y * 0.5;
}

async function syncCharacter(id, updateUrl = true) {
  selectedId = characters[id] ? id : "mr-ghost";
  selectedCharacter = characters[selectedId];
  characterSelect.value = selectedId;
  previewName.textContent = selectedCharacter.name;
  gameTitle.textContent = `Find ${selectedCharacter.name}`;
  completeTitle.textContent = `You caught ${selectedCharacter.name}`;
  rewardName.textContent = `${selectedCharacter.name} / ${selectedCharacter.place}`;
  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("character", selectedId);
    window.history.replaceState({}, "", url);
  }

  await putModelInStudio(preview, selectedCharacter);
  await putModelInStudio(reward, selectedCharacter);
}

function makeStudio(host, cameraFov) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(cameraFov, 1, 0.01, 20);
  camera.position.set(0, 0.08, 2.4);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3f2c70, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 2.7);
  light.position.set(1.4, 2, 2.4);
  scene.add(light);
  const group = new THREE.Group();
  scene.add(group);
  return { host, scene, camera, renderer, group };
}

async function putModelInStudio(studio, character) {
  studio.group.clear();
  const model = await loadModel(character);
  model.position.y = -0.18;
  studio.group.add(model);
  resizeStudio(studio);
  renderStudio(studio);
}

function resizeStudio(studio) {
  const rect = studio.host.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  studio.renderer.setSize(width, height, false);
  studio.camera.aspect = width / height;
  studio.camera.updateProjectionMatrix();
}

function renderStudio(studio) {
  studio.group.rotation.y += 0.01;
  studio.renderer.render(studio.scene, studio.camera);
}

function animateStudios() {
  if (!introScreen.classList.contains("is-active") && !completeScreen.classList.contains("is-active")) {
    studioRafId = 0;
    return;
  }
  renderStudio(preview);
  renderStudio(reward);
  studioRafId = requestAnimationFrame(animateStudios);
}

function startStudios() {
  if (!studioRafId) {
    studioRafId = requestAnimationFrame(animateStudios);
  }
}

function stopStudios() {
  if (studioRafId) {
    cancelAnimationFrame(studioRafId);
    studioRafId = 0;
  }
}

function resizeGame() {
  const rect = gameCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  gameRenderer.setSize(width, height, false);
  gameCamera.aspect = width / height;
  gameCamera.updateProjectionMatrix();
  resizeStudio(preview);
  resizeStudio(reward);
}

async function startCameraFallback() {
  cameraFallback.style.display = "block";
  cameraFallback.style.opacity = "1";
  cameraFeed.style.transform = "none";
  cameraActive = false;
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "Camera API is unavailable in this browser." };
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    cameraFeed.srcObject = stream;
    cameraFallback.style.opacity = "0";
    cameraActive = true;
    return { ok: true, reason: "" };
  } catch (error) {
    cameraFallback.style.opacity = "1";
    return { ok: false, reason: getCameraErrorMessage(error) };
  }
}

function getCameraErrorMessage(error) {
  if (!window.isSecureContext) {
    return "Camera needs HTTPS on iPhone. Use GitHub Pages or an HTTPS tunnel.";
  }
  if (error?.name === "NotAllowedError") {
    return "Camera permission was blocked. Allow camera access in Safari.";
  }
  if (error?.name === "NotFoundError") {
    return "No camera was found on this device.";
  }
  return "Camera could not start. Try Safari permissions or HTTPS hosting.";
}

function stopCameraFallback() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  cameraFeed.srcObject = null;
  cameraFallback.style.opacity = "1";
  cameraActive = false;
}

async function startGame(nextMode) {
  mode = nextMode;
  remaining = captureSeconds;
  captured = false;
  running = true;
  yaw = 0;
  pitch = 0;
  motionYaw = 0;
  motionPitch = 0;
  motionOrigin = null;
  lastFrame = performance.now();
  nextMoveAt = 0;
  worldTarget.set(0, 0, -2.1);
  setScreen(gameScreen);
  resizeGame();
  await replaceGameModel();
  updateTimer(false);
  chooseWorldTarget(performance.now(), true);

  if (mode === "ar") {
    await startArSession();
  } else if (mode === "ios-motion") {
    await startIOSMotionSession();
  } else {
    await startCameraFallback();
    gameRenderer.setAnimationLoop(renderFrame);
  }
}

async function replaceGameModel() {
  characterRig.clear();
  const model = await loadModel(selectedCharacter);
  model.position.y = -0.28;
  characterRig.add(model);
}

async function startArSession() {
  stopCameraFallback();
  cameraFallback.style.opacity = "0";
  try {
    xrSession = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["local"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: gameScreen },
    });
    xrSession.addEventListener("end", handleXrEnd);
    await gameRenderer.xr.setSession(xrSession);
    gameRenderer.setAnimationLoop(renderFrame);
  } catch (error) {
    console.warn("AR session failed, using camera preview fallback.", error);
    mode = "preview";
    await startCameraFallback();
    gameRenderer.setAnimationLoop(renderFrame);
    statusText.textContent = "AR unavailable here. Preview mode is running.";
  }
}

async function startIOSMotionSession() {
  motionActive = false;
  iosSessionMessage = "";
  const motion = await requestIOSMotionPermission();
  const camera = await startCameraFallback();
  if (motion.ok) {
    window.addEventListener("deviceorientation", handleDeviceOrientation, true);
  }
  const messages = [];
  if (!camera.ok) messages.push(camera.reason);
  if (!motion.ok) messages.push(motion.reason);
  if (messages.length) {
    iosSessionMessage = `${messages[0]} Drag still works as backup.`;
    statusText.textContent = iosSessionMessage;
  } else {
    iosSessionMessage = "Turn your phone to find the object.";
    statusText.textContent = iosSessionMessage;
  }
  gameRenderer.setAnimationLoop(renderFrame);
}

async function requestIOSMotionPermission() {
  if (motionPermissionGranted) return { ok: true, reason: "" };
  if (typeof DeviceOrientationEvent === "undefined") {
    return { ok: false, reason: "Motion sensor is unavailable in this browser." };
  }
  if (!window.isSecureContext) {
    return { ok: false, reason: "Motion control needs HTTPS on iPhone." };
  }
  if (typeof DeviceOrientationEvent.requestPermission !== "function") {
    motionPermissionGranted = true;
    return { ok: true, reason: "" };
  }
  try {
    const result = await DeviceOrientationEvent.requestPermission();
    motionPermissionGranted = result === "granted";
    return motionPermissionGranted
      ? { ok: true, reason: "" }
      : { ok: false, reason: "Motion permission was denied. Allow motion access in Safari." };
  } catch {
    motionPermissionGranted = false;
    return { ok: false, reason: "Motion permission could not be requested." };
  }
}

function handleDeviceOrientation(event) {
  if (mode !== "ios-motion" || !running || event.alpha == null) return;
  motionActive = true;
  const heading = typeof event.webkitCompassHeading === "number"
    ? 360 - event.webkitCompassHeading
    : event.alpha || 0;
  const current = {
    alpha: THREE.MathUtils.degToRad(heading),
    beta: THREE.MathUtils.degToRad(event.beta || 0),
  };
  if (!motionOrigin) {
    motionOrigin = current;
  }
  motionYaw = THREE.MathUtils.euclideanModulo(current.alpha - motionOrigin.alpha + Math.PI, Math.PI * 2) - Math.PI;
  motionPitch = THREE.MathUtils.clamp((current.beta - motionOrigin.beta) * 0.72, -0.62, 0.62);
}

function handleXrEnd() {
  xrSession = null;
  if (running && !captured) exitGame();
}

function exitGame() {
  running = false;
  gameRenderer.setAnimationLoop(null);
  window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
  motionActive = false;
  iosSessionMessage = "";
  if (xrSession) {
    const endingSession = xrSession;
    xrSession = null;
    endingSession.end();
  }
  stopCameraFallback();
  setScreen(introScreen);
  renderStudio(preview);
}

function completeGame() {
  running = false;
  captured = true;
  gameRenderer.setAnimationLoop(null);
  window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
  motionActive = false;
  iosSessionMessage = "";
  if (xrSession) {
    const endingSession = xrSession;
    xrSession = null;
    endingSession.end();
  }
  stopCameraFallback();
  setScreen(completeScreen);
  renderStudio(reward);
}

function renderFrame(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (now > nextMoveAt) {
    chooseWorldTarget(now, false);
  }

  characterRig.position.lerp(worldTarget, 1 - Math.pow(0.025, dt));
  characterRig.rotation.y += dt * 0.9;
  characterRig.position.y += Math.sin(now * 0.004) * 0.0018;

  if (mode === "preview" || mode === "ios-motion") {
    updatePreviewCamera();
  }

  const activeCamera = mode === "ar" ? gameRenderer.xr.getCamera(gameCamera) : gameCamera;
  const inside = isCharacterInsideReticle(activeCamera);
  if (inside) remaining = Math.max(0, remaining - dt);
  updateTimer(inside);

  gameRenderer.render(gameScene, gameCamera);

  if (remaining <= 0 && !captured) {
    completeGame();
  }
}

function chooseWorldTarget(now, first) {
  const mostlyVisible = first || Math.random() > 0.46;
  const angle = mostlyVisible
    ? THREE.MathUtils.degToRad(THREE.MathUtils.randFloatSpread(48))
    : THREE.MathUtils.degToRad(THREE.MathUtils.randFloat(70, 170) * (Math.random() > 0.5 ? 1 : -1));
  const radius = THREE.MathUtils.randFloat(1.65, 2.25);
  worldTarget.set(Math.sin(angle) * radius, THREE.MathUtils.randFloat(-0.42, 0.56), -Math.cos(angle) * radius);
  nextMoveAt = now + THREE.MathUtils.randFloat(1200, 2500);
}

function updatePreviewCamera() {
  const activeYaw = mode === "ios-motion" ? motionYaw + yaw : yaw;
  const activePitch = mode === "ios-motion" ? motionPitch + pitch : pitch;
  const x = Math.sin(activeYaw) * 0.12;
  const z = Math.cos(activeYaw) * 0.12;
  gameCamera.position.set(x, Math.sin(activePitch) * 0.08, z);
  gameCamera.rotation.set(activePitch, activeYaw, 0, "YXZ");
}

function isCharacterInsideReticle(camera) {
  if (!characterRig.children.length) return false;
  const point = characterRig.position.clone().project(camera);
  if (point.z < -1 || point.z > 1) return false;
  const px = (point.x * 0.5 + 0.5) * window.innerWidth;
  const py = (-point.y * 0.5 + 0.5) * window.innerHeight;
  const rect = captureReticle.getBoundingClientRect();
  const margin = Math.min(rect.width, rect.height) * 0.16;
  return px > rect.left + margin && px < rect.right - margin && py > rect.top + margin && py < rect.bottom - margin;
}

function updateTimer(inside) {
  const progress = (captureSeconds - remaining) / captureSeconds;
  timerFill.style.width = `${Math.round(progress * 100)}%`;
  timerText.textContent = `${Math.ceil(remaining)}s`;
  statusPill.classList.toggle("is-capturing", inside);
  statusPill.classList.toggle("is-escaped", !inside);
  statusText.textContent = inside
    ? "Hold steady. Capture is charging!"
    : mode === "ar"
      ? "Object is outside the box. Move your phone!"
      : mode === "ios-motion"
        ? getIOSStatusText()
        : "Object is outside the box. Drag to look around.";
}

function getIOSStatusText() {
  if (iosSessionMessage && (!cameraActive || !motionPermissionGranted)) return iosSessionMessage;
  return motionActive
    ? "Object is outside the box. Turn your phone!"
    : "Waiting for motion. Turn your phone or drag.";
}

async function copyLink() {
  const url = new URL(window.location.href);
  url.searchParams.set("character", selectedId);
  await navigator.clipboard?.writeText(url.href);
  shareButton.textContent = "Link Copied";
  window.setTimeout(() => {
    shareButton.textContent = "Copy Test Link";
  }, 1300);
}

async function detectArSupport() {
  xrSupported = Boolean(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));
  iosMotionSupported = isIOSDevice();
  arButton.disabled = !xrSupported && !iosMotionSupported;
  if (xrSupported) {
    arButton.textContent = "Enter AR";
  } else if (iosMotionSupported) {
    arButton.textContent = window.isSecureContext ? "Start iOS AR" : "iOS Needs HTTPS";
  } else {
    arButton.textContent = "AR Not Available";
  }
}

function onDragStart(event) {
  if ((mode !== "preview" && mode !== "ios-motion") || !running) return;
  const touch = event.touches?.[0] || event;
  dragStart = { x: touch.clientX, y: touch.clientY, yaw, pitch };
}

function onDragMove(event) {
  if (!dragStart || (mode !== "preview" && mode !== "ios-motion")) return;
  const touch = event.touches?.[0] || event;
  yaw = dragStart.yaw - (touch.clientX - dragStart.x) * 0.008;
  pitch = THREE.MathUtils.clamp(dragStart.pitch - (touch.clientY - dragStart.y) * 0.006, -0.55, 0.55);
}

function onDragEnd() {
  dragStart = null;
}

characterSelect.addEventListener("change", (event) => syncCharacter(event.target.value));
arButton.addEventListener("click", () => startGame(xrSupported ? "ar" : "ios-motion"));
startButton.addEventListener("click", () => startGame("preview"));
exitButton.addEventListener("click", exitGame);
playAgainButton.addEventListener("click", () => startGame(xrSupported ? "ar" : iosMotionSupported ? "ios-motion" : "preview"));
shareButton.addEventListener("click", copyLink);
window.addEventListener("resize", resizeGame);
gameScreen.addEventListener("pointerdown", onDragStart);
gameScreen.addEventListener("pointermove", onDragMove);
gameScreen.addEventListener("pointerup", onDragEnd);
gameScreen.addEventListener("pointercancel", onDragEnd);
gameScreen.addEventListener("touchstart", onDragStart, { passive: true });
gameScreen.addEventListener("touchmove", onDragMove, { passive: true });
gameScreen.addEventListener("touchend", onDragEnd);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) exitGame();
});

resizeGame();
await syncCharacter(selectedId, false);
await detectArSupport();
startStudios();
