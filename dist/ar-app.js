import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

window.THREE = THREE;

const characters = {
  "mr-ghost": {
    name: "Mr Ghost",
    place: "AR Capture Zone",
    asset: "./assets/mr-ghost.glb",
    targetHeight: 1.05,
  },
  saddie: {
    name: "Saddie",
    place: "AR Capture Zone",
    asset: "./assets/saddie.glb",
    targetHeight: 1.05,
    facingOffset: -Math.PI / 2,
  },
};

const captureSeconds = 5;
const loader = new GLTFLoader();
const modelCache = new Map();

const introScreen = document.querySelector('[data-screen="intro"]');
const gameScreen = document.querySelector('[data-screen="game"]');
const completeScreen = document.querySelector('[data-screen="complete"]');
const previewViewport = document.querySelector("#previewViewport");
const rewardViewport = document.querySelector("#rewardViewport");
const xrCanvas = document.querySelector("#xrCanvas");
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
const startOverlay = document.querySelector("#startOverlay");
const startNowButton = document.querySelector("#startNowButton");

let selectedId = getCharacterId();
let selectedCharacter = characters[selectedId] || characters["mr-ghost"];
let stream = null;
let xrSession = null;
let xrSupported = false;
let eighthWallSupported = false;
let eighthWallActive = false;
let eighthWallCamera = null;
let iosMotionSupported = false;
let motionPermissionGranted = false;
let mode = "preview";
let running = false;
let captured = false;
let gameStarted = false;
let remaining = captureSeconds;
let lastFrame = 0;
let nextMoveAt = 0;
let worldTarget = new THREE.Vector3(0, 0, -2.1);
let yaw = 0;
let pitch = 0;
let motionYaw = 0;
let motionPitch = 0;
let targetMotionYaw = 0;
let targetMotionPitch = 0;
let motionYawOrigin = null;
let motionActive = false;
let motionListenerActive = false;
let cameraActive = false;
let cameraStatus = { ok: false, reason: "" };
let iosSessionMessage = "";
let dragStart = null;
let studioRafId = 0;

const fakeCameraHeight = 1.35;
const previewSpawnHeight = fakeCameraHeight - 0.12;
const motionSmoothRate = 10;
const eighthWallCameraHeight = 1.35;

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
const cameraWorldPosition = new THREE.Vector3();
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
  model.rotation.y = character.facingOffset || 0;
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
  rewardName.textContent = selectedCharacter.name;
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
  const activeCanvas = mode === "8thwall" ? xrCanvas : gameCanvas;
  let rect = activeCanvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) {
    rect = gameScreen.getBoundingClientRect();
  }
  if (rect.width < 2 || rect.height < 2) {
    rect = document.querySelector(".phone-shell").getBoundingClientRect();
  }
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  gameRenderer.setSize(width, height, false);
  xrCanvas.width = width;
  xrCanvas.height = height;
  gameCamera.aspect = width / height;
  gameCamera.updateProjectionMatrix();
  resizeStudio(preview);
  resizeStudio(reward);
}

function setGameCanvasMode(nextMode) {
  const useEighthWall = nextMode === "8thwall";
  xrCanvas.style.display = useEighthWall ? "block" : "none";
  gameCanvas.style.display = useEighthWall ? "none" : "block";
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
  gameStarted = false;
  running = true;
  yaw = 0;
  pitch = 0;
  motionYaw = 0;
  motionPitch = 0;
  targetMotionYaw = 0;
  targetMotionPitch = 0;
  motionYawOrigin = null;
  lastFrame = performance.now();
  nextMoveAt = 0;
  worldTarget.copy(getInitialWorldTarget());
  setScreen(gameScreen);
  setGameCanvasMode(mode);
  if (mode !== "8thwall" && characterRig.parent !== gameScene) {
    gameScene.add(characterRig);
  }
  resizeGame();
  await replaceGameModel();
  showStartOverlay();
  updateTimer(false, true);

  if (mode === "8thwall") {
    await startEighthWallSession();
  } else if (mode === "ar") {
    await startArSession();
  } else if (mode === "ios-motion") {
    await startIOSMotionSession();
  } else {
    await startCameraFallback();
    gameRenderer.setAnimationLoop(renderFrame);
  }
}

async function beginCapture() {
  if (!running || captured || gameStarted) return;
  if (mode === "ios-motion") {
    const motion = await requestIOSMotionPermission();
    if (motion.ok) {
      startMotionListener();
    }
    const messages = [];
    if (!cameraStatus.ok) messages.push(cameraStatus.reason);
    if (!motion.ok) messages.push(motion.reason);
    iosSessionMessage = messages.length
      ? `${messages[0]} Drag still works as backup.`
      : "Turn your phone to find the object.";
  }
  gameStarted = true;
  startOverlay.classList.add("is-hidden");
  lastFrame = performance.now();
  nextMoveAt = lastFrame + 650;
  updateTimer(isCharacterInsideReticle(getActiveCamera()));
}

function startMotionListener() {
  if (motionListenerActive) return;
  window.addEventListener("deviceorientation", handleDeviceOrientation, true);
  motionListenerActive = true;
}

function stopMotionListener() {
  if (!motionListenerActive) return;
  window.removeEventListener("deviceorientation", handleDeviceOrientation, true);
  motionListenerActive = false;
}

function stopEighthWallSession() {
  if (!eighthWallActive) return;
  window.XR8?.stop?.();
  eighthWallActive = false;
  eighthWallCamera = null;
  if (characterRig.parent !== gameScene) {
    gameScene.add(characterRig);
  }
  setGameCanvasMode("preview");
}

function showStartOverlay() {
  startOverlay.classList.remove("is-hidden");
  statusPill.classList.remove("is-escaped");
  statusPill.classList.add("is-capturing");
}

async function replaceGameModel() {
  characterRig.clear();
  const model = await loadModel(selectedCharacter);
  model.position.y = -0.28;
  model.userData.baseY = model.position.y;
  characterRig.add(model);
}

async function startEighthWallSession() {
  stopCameraFallback();
  cameraFallback.style.opacity = "0";

  try {
    const XR8 = await getEighthWall();
    XR8.stop?.();
    XR8.clearCameraPipelineModules?.();
    XR8.addCameraPipelineModules([
      XR8.XrController.pipelineModule(),
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      makeEighthWallGameModule(XR8),
    ]);
    XR8.run({
      canvas: xrCanvas,
      cameraConfig: { direction: XR8.XrConfig.camera().BACK },
      allowedDevices: XR8.XrConfig.device().MOBILE,
      glContextConfig: { alpha: true, antialias: true },
    });
    eighthWallActive = true;
  } catch (error) {
    console.warn("8th Wall failed, falling back to iOS motion/WebXR.", error);
    eighthWallActive = false;
    eighthWallCamera = null;
    mode = xrSupported ? "ar" : iosMotionSupported ? "ios-motion" : "preview";
    setGameCanvasMode(mode);
    if (characterRig.parent !== gameScene) {
      gameScene.add(characterRig);
    }
    if (mode === "ar") {
      await startArSession();
    } else if (mode === "ios-motion") {
      await startIOSMotionSession();
    } else {
      await startCameraFallback();
      gameRenderer.setAnimationLoop(renderFrame);
    }
  }
}

function makeEighthWallGameModule(XR8) {
  return {
    name: "capture-object-game",
    onStart: () => {
      const { scene, camera, renderer } = XR8.Threejs.xrScene();
      eighthWallCamera = camera;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.autoClearColor = false;
      renderer.autoClearStencil = false;
      scene.add(characterRig);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x58427a, 2.3));
      const light = new THREE.DirectionalLight(0xffffff, 2.4);
      light.position.set(1.2, 2.2, 1.8);
      scene.add(light);
      camera.position.set(0, eighthWallCameraHeight, 0);
      camera.quaternion.identity();
      XR8.XrController.updateCameraProjectionMatrix({
        origin: camera.position,
        facing: camera.quaternion,
      });
      XR8.XrController.recenter();
      lastFrame = performance.now();
    },
    onUpdate: () => {
      renderFrame(performance.now(), { skipRender: true });
    },
    onDetach: () => {
      eighthWallCamera = null;
    },
  };
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
  cameraStatus = await startCameraFallback();
  statusText.textContent = "Press start when the object is in front of you.";
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

function getEighthWall(timeoutMs = 6000) {
  if (window.XR8) return Promise.resolve(window.XR8);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener("xrloaded", handleLoaded);
      reject(new Error("8th Wall engine did not load."));
    }, timeoutMs);
    const handleLoaded = () => {
      window.clearTimeout(timeout);
      resolve(window.XR8);
    };
    window.addEventListener("xrloaded", handleLoaded, { once: true });
  });
}

async function detectEighthWallSupport() {
  try {
    const XR8 = await getEighthWall(1800);
    eighthWallSupported = Boolean(XR8?.XrController && XR8?.Threejs && XR8?.GlTextureRenderer);
  } catch {
    eighthWallSupported = false;
  }
  return eighthWallSupported;
}

function handleDeviceOrientation(event) {
  if (mode !== "ios-motion" || !running || event.alpha == null) return;
  motionActive = true;
  const heading = typeof event.webkitCompassHeading === "number"
    ? 360 - event.webkitCompassHeading
    : event.alpha || 0;
  if (motionYawOrigin == null) {
    motionYawOrigin = heading;
  }
  targetMotionYaw = THREE.MathUtils.degToRad(THREE.MathUtils.euclideanModulo(heading - motionYawOrigin + 180, 360) - 180);

  // iOS reports beta around 90deg when the phone is upright. Preserve absolute
  // pitch so looking down at the floor shows the model from above.
  const beta = event.beta ?? 90;
  targetMotionPitch = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(beta - 90), -1.25, 0.55);
}

function handleXrEnd() {
  xrSession = null;
  if (running && !captured) exitGame();
}

function exitGame() {
  running = false;
  gameStarted = false;
  gameRenderer.setAnimationLoop(null);
  stopEighthWallSession();
  stopMotionListener();
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
  gameStarted = false;
  gameRenderer.setAnimationLoop(null);
  stopEighthWallSession();
  stopMotionListener();
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

function renderFrame(now, options = {}) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (gameStarted && now > nextMoveAt) {
    chooseWorldTarget(now, false);
  }

  smoothMotion(dt);

  if (mode === "preview" || mode === "ios-motion") {
    updatePreviewCamera();
  }

  const activeCamera = getActiveCamera();
  characterRig.position.lerp(worldTarget, 1 - Math.pow(0.025, dt));
  faceCamera(activeCamera);
  const activeModel = characterRig.children[0];
  if (activeModel) {
    const bobAmount = mode === "ar" ? 0.055 : 0.045;
    activeModel.position.y = activeModel.userData.baseY + Math.sin(now * 0.006) * bobAmount;
  }

  const inside = isCharacterInsideReticle(activeCamera);
  if (gameStarted && inside) remaining = Math.max(0, remaining - dt);
  updateTimer(inside, !gameStarted);

  if (!options.skipRender) {
    gameRenderer.render(gameScene, gameCamera);
  }

  if (remaining <= 0 && !captured) {
    completeGame();
  }
}

function getActiveCamera() {
  if (mode === "8thwall" && eighthWallCamera) return eighthWallCamera;
  if (mode === "ar") return gameRenderer.xr.getCamera(gameCamera);
  return gameCamera;
}

function smoothMotion(dt) {
  if (mode !== "ios-motion") return;
  const amount = 1 - Math.exp(-motionSmoothRate * dt);
  motionYaw += shortestAngleDelta(motionYaw, targetMotionYaw) * amount;
  motionPitch = THREE.MathUtils.lerp(motionPitch, targetMotionPitch, amount);
}

function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function faceCamera(camera) {
  camera.getWorldPosition(cameraWorldPosition);
  const dx = cameraWorldPosition.x - characterRig.position.x;
  const dz = cameraWorldPosition.z - characterRig.position.z;
  characterRig.rotation.set(0, Math.atan2(dx, dz), 0);
}

function chooseWorldTarget(now, first) {
  const mostlyVisible = first || Math.random() > 0.46;
  const angle = mostlyVisible
    ? THREE.MathUtils.degToRad(THREE.MathUtils.randFloatSpread(48))
    : THREE.MathUtils.degToRad(THREE.MathUtils.randFloat(70, 170) * (Math.random() > 0.5 ? 1 : -1));
  const radius = THREE.MathUtils.randFloat(1.65, 2.25);
  const height = mode === "8thwall"
    ? THREE.MathUtils.randFloat(eighthWallCameraHeight - 0.75, eighthWallCameraHeight + 0.9)
    : mode === "ar"
    ? THREE.MathUtils.randFloat(-0.65, 1.15)
    : THREE.MathUtils.randFloat(fakeCameraHeight - 0.8, fakeCameraHeight + 0.85);
  worldTarget.set(Math.sin(angle) * radius, height, -Math.cos(angle) * radius);
  nextMoveAt = now + THREE.MathUtils.randFloat(1200, 2500);
}

function getInitialWorldTarget() {
  if (mode === "8thwall") {
    return new THREE.Vector3(0, eighthWallCameraHeight - 0.12, -1.9);
  }
  return mode === "ar"
    ? new THREE.Vector3(0, 0, -2.1)
    : new THREE.Vector3(0, previewSpawnHeight, -1.9);
}

function updatePreviewCamera() {
  if (mode === "ios-motion") {
    gameCamera.position.set(0, fakeCameraHeight, 0);
    gameCamera.rotation.set(motionPitch + pitch, motionYaw + yaw, 0, "YXZ");
    return;
  }

  const x = Math.sin(yaw) * 0.12;
  const z = Math.cos(yaw) * 0.12;
  gameCamera.position.set(x, fakeCameraHeight + Math.sin(pitch) * 0.08, z);
  gameCamera.rotation.set(pitch, yaw, 0, "YXZ");
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

function updateTimer(inside, waitingToStart = false) {
  const progress = (captureSeconds - remaining) / captureSeconds;
  timerFill.style.width = `${Math.round(progress * 100)}%`;
  timerText.textContent = `${Math.ceil(remaining)}s`;
  statusPill.classList.toggle("is-capturing", inside || waitingToStart);
  statusPill.classList.toggle("is-escaped", !inside && !waitingToStart);
  statusText.textContent = waitingToStart
    ? "Press start when the object is in front of you."
    : inside
    ? "Hold steady. Capture is charging!"
    : mode === "ar" || mode === "8thwall"
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
  arButton.textContent = "Loading AR";
  await detectEighthWallSupport();
  xrSupported = Boolean(navigator.xr && await navigator.xr.isSessionSupported("immersive-ar").catch(() => false));
  iosMotionSupported = isIOSDevice();
  arButton.disabled = !eighthWallSupported && !xrSupported && !iosMotionSupported;
  if (eighthWallSupported || xrSupported) {
    arButton.textContent = "Start Catch The Object";
  } else if (iosMotionSupported) {
    arButton.textContent = window.isSecureContext ? "Start Catch The Object" : "iOS Needs HTTPS";
  } else {
    arButton.textContent = "AR Not Available";
  }
}

function getPreferredGameMode() {
  if (eighthWallSupported || window.XR8) return "8thwall";
  if (xrSupported) return "ar";
  if (iosMotionSupported) return "ios-motion";
  return "preview";
}

function markEighthWallReady() {
  eighthWallSupported = Boolean(window.XR8?.XrController && window.XR8?.Threejs && window.XR8?.GlTextureRenderer);
  if (eighthWallSupported) {
    arButton.disabled = false;
    arButton.textContent = "Start Catch The Object";
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
arButton.addEventListener("click", () => startGame(getPreferredGameMode()));
startButton.addEventListener("click", () => startGame("preview"));
startNowButton.addEventListener("click", () => beginCapture());
exitButton.addEventListener("click", exitGame);
playAgainButton.addEventListener("click", () => startGame(getPreferredGameMode()));
shareButton.addEventListener("click", copyLink);
window.addEventListener("resize", resizeGame);
window.addEventListener("xrloaded", markEighthWallReady);
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
