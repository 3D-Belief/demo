import { OrbitControls } from "./OrbitControls.js?v=gallery_v36_simplified_layout";
import * as SPLAT from "https://cdn.jsdelivr.net/npm/gsplat@latest";

const params = new URLSearchParams(window.location.search);
const episodeName = params.get("episode") || "01";
const sliderAssetRoot = params.get("assetRoot") || "scenes";

const RENDER_RESOLUTION = 512;
const CAMERA_FOCAL_FRACTION = 0.82;
const WORLD_UP_RECORD = { x: 0, y: 1, z: 0 };
const WORLD_UP = new SPLAT.Vector3(WORLD_UP_RECORD.x, WORLD_UP_RECORD.y, WORLD_UP_RECORD.z);
const RIGHTWARD_YAW_RADIANS = -Math.PI / 2;
const CAMERA_ROLL_RADIANS = -Math.PI / 2;
const SPLAT_ASSET_ROTATION = new SPLAT.Vector3(0, 0, 0);
const ASSET_VERSION = params.get("v") || "gallery_v36_simplified_layout";
const POSE_DEFAULTS_URL = `./pose_defaults.json?v=${ASSET_VERSION}`;
const SLIDER_CONFIG_URL = `../${sliderAssetRoot}/${episodeName}/config.json?v=${ASSET_VERSION}`;

const FALLBACK_POSE = {
  alpha: RIGHTWARD_YAW_RADIANS,
  beta: 0.04,
  radius: 1.52,
  target: { x: 0, y: 0, z: 0 },
};

const canvas = document.getElementById("viewer");
const progress = document.getElementById("progress");
const progressBar = document.getElementById("progress-bar");
const progressLabel = document.getElementById("progress-label");
const copyPoseButton = document.getElementById("copy-pose");
const poseStatus = document.getElementById("pose-status");

let config = null;
let poseDefaults = {};
let renderer = null;
let camera = null;
let splatScene = null;
let controls = null;
let currentPose = null;
let activeStep = -1;
let loadGeneration = 0;
let animationStarted = false;
let lastPoseUiUpdate = 0;

canvas.tabIndex = 0;

function focusCanvas() {
  try {
    canvas.focus({ preventScroll: true });
  } catch {
    canvas.focus();
  }
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return fallback;
    }
    return await response.json();
  } catch (error) {
    console.warn(`Could not load ${url}:`, error);
    return fallback;
  }
}

function getRenderSize() {
  const displayWidth = Math.max(1, canvas.clientWidth || window.innerWidth || RENDER_RESOLUTION);
  const displayHeight = Math.max(1, canvas.clientHeight || window.innerHeight || RENDER_RESOLUTION);
  const aspect = displayWidth / displayHeight;
  if (aspect >= 1) {
    return {
      width: Math.max(1, Math.round(RENDER_RESOLUTION * aspect)),
      height: RENDER_RESOLUTION,
    };
  }
  return {
    width: RENDER_RESOLUTION,
    height: Math.max(1, Math.round(RENDER_RESOLUTION / aspect)),
  };
}

function sizeCanvas() {
  const nextSize = getRenderSize();
  if (canvas.width !== nextSize.width || canvas.height !== nextSize.height) {
    canvas.width = nextSize.width;
    canvas.height = nextSize.height;
    return true;
  }
  return false;
}

function updateCameraIntrinsics(cameraLike) {
  const cameraData = cameraLike.data || cameraLike;
  const focal = CAMERA_FOCAL_FRACTION * Math.min(canvas.width, canvas.height);
  cameraData.fx = focal;
  cameraData.fy = focal;
  if (typeof cameraData.setSize === "function") {
    cameraData.setSize(canvas.width, canvas.height);
  }
}

function setProgress(visible, value = 0, label = "Loading Gaussian scene...") {
  progress.hidden = !visible;
  progressBar.value = value;
  progressLabel.textContent = label;
}

function defaultPose() {
  return poseDefaults?.[episodeName]?.imagined_first || FALLBACK_POSE;
}

function targetFromPose(pose) {
  const targetValue = Array.isArray(pose.target)
    ? { x: pose.target[0], y: pose.target[1], z: pose.target[2] }
    : pose.target || { x: 0, y: 0, z: 0 };
  return new SPLAT.Vector3(
    Number(targetValue.x) || 0,
    Number(targetValue.y) || 0,
    Number(targetValue.z) || 0,
  );
}

function createCamera(inputPose = null) {
  const pose = inputPose || defaultPose();
  const cameraData = new SPLAT.CameraData();
  updateCameraIntrinsics(cameraData);
  const nextCamera = new SPLAT.Camera(cameraData);
  nextCamera.up = WORLD_UP;
  const nextControls = new OrbitControls(
    nextCamera,
    canvas,
    typeof pose.alpha === "number" ? pose.alpha : FALLBACK_POSE.alpha,
    typeof pose.beta === "number" ? pose.beta : FALLBACK_POSE.beta,
    typeof pose.radius === "number" ? pose.radius : FALLBACK_POSE.radius,
    true,
    targetFromPose(pose),
    WORLD_UP,
    CAMERA_ROLL_RADIANS,
  );
  nextControls.minZoom = 0.16;
  nextControls.maxZoom = 4.2;
  nextControls.zoomSpeed = 0.08;
  nextControls.panSpeed = 0.7;
  nextControls.orbitSpeed = 1.25;
  nextControls.keyMoveSpeed = 0.006;
  nextControls.keyRotateSpeed = 0.003;
  nextControls.verticalOrbitSpeed = 0.35;
  nextControls.dominantAxisOrbit = true;
  nextControls.dominantAxisRatio = 1.15;
  nextControls.orbitDeadzone = 1.5;
  nextControls.setPose(pose);
  return { nextCamera, nextControls };
}

function currentPoseRecord() {
  if (!controls || typeof controls.getPose !== "function") {
    return null;
  }
  return {
    [episodeName]: {
      imagined_first: controls.getPose(),
    },
  };
}

function viewerStateRecord() {
  return {
    episode: episodeName,
    asset_root: sliderAssetRoot,
    active_step: activeStep,
    active_step_ply: config?.steps?.[activeStep]?.ply || null,
    render_resolution: RENDER_RESOLUTION,
    camera_focal_fraction: CAMERA_FOCAL_FRACTION,
    camera_roll_radians: CAMERA_ROLL_RADIANS,
    world_up: WORLD_UP_RECORD,
    url: window.location.href,
  };
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function updatePoseStatus(force = false) {
  if (!poseStatus || !controls || typeof controls.getPose !== "function") {
    return;
  }
  const now = performance.now();
  if (!force && now - lastPoseUiUpdate < 180) {
    return;
  }
  lastPoseUiUpdate = now;
  const pose = controls.getPose();
  const target = pose.target || { x: 0, y: 0, z: 0 };
  poseStatus.textContent = [
    `zoom ${formatNumber(pose.radius)}`,
    `alpha ${formatNumber(pose.alpha)}`,
    `beta ${formatNumber(pose.beta)}`,
    `target ${formatNumber(target.x, 2)}, ${formatNumber(target.y, 2)}, ${formatNumber(target.z, 2)}`,
  ].join(" | ");
}

async function copyPoseRecord() {
  if (!copyPoseButton) {
    return;
  }
  const posePatch = currentPoseRecord();
  if (!posePatch) {
    return;
  }
  const payload = {
    pose_defaults_patch: posePatch,
    viewer_state: viewerStateRecord(),
  };
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    copyPoseButton.textContent = "Copied";
  } catch {
    window.prompt("Copy pose JSON:", text);
    copyPoseButton.textContent = "Copy pose";
  }
  window.setTimeout(() => {
    if (copyPoseButton) {
      copyPoseButton.textContent = "Copy pose";
    }
  }, 1200);
}

async function loadStep(stepIndex, { force = false } = {}) {
  if (!config?.steps?.length) {
    return;
  }
  const clampedStep = Math.min(Math.max(Number(stepIndex) || 0, 0), config.steps.length - 1);
  if (!force && clampedStep === activeStep) {
    return;
  }
  activeStep = clampedStep;
  const generation = ++loadGeneration;
  const step = config.steps[clampedStep];

  if (controls && typeof controls.getPose === "function") {
    currentPose = controls.getPose();
  }
  if (controls) {
    controls.dispose();
    controls = null;
  }

  setProgress(true, 0, "Loading reveal...");
  sizeCanvas();

  const nextScene = new SPLAT.Scene();
  const nextRenderer = renderer || new SPLAT.WebGLRenderer(canvas);
  const { nextCamera, nextControls } = createCamera(currentPose);

  const loadedSplat = await SPLAT.PLYLoader.LoadAsync(`../${step.ply}?v=${ASSET_VERSION}`, nextScene, (value) => {
    if (generation === loadGeneration) {
      progressBar.value = Math.round(value * 100);
    }
  });
  loadedSplat.rotation = SPLAT.Quaternion.FromEuler(SPLAT_ASSET_ROTATION);

  if (generation !== loadGeneration) {
    return;
  }

  splatScene = nextScene;
  renderer = nextRenderer;
  camera = nextCamera;
  controls = nextControls;
  setProgress(false);
  updatePoseStatus(true);
  focusCanvas();
}

function animate() {
  const resized = sizeCanvas();
  if (resized && camera) {
    updateCameraIntrinsics(camera);
  }
  if (controls && renderer && splatScene && camera) {
    controls.update();
    updatePoseStatus();
    renderer.render(splatScene, camera);
  }
  requestAnimationFrame(animate);
}

canvas.addEventListener("pointerdown", focusCanvas);
canvas.addEventListener("pointerenter", focusCanvas);
copyPoseButton?.addEventListener("click", copyPoseRecord);

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) {
    return;
  }
  const data = event.data || {};
  if (data.type === "3dbelief-key" && controls && typeof controls.setKeyState === "function") {
    controls.setKeyState(data.code, Boolean(data.pressed));
    return;
  }
  if (data.type === "3dbelief-reveal-step") {
    loadStep(data.step).catch((error) => {
      console.error(error);
      setProgress(true, 0, `Failed to load reveal step: ${error.message}`);
    });
  }
});

window.addEventListener("resize", () => {
  const resized = sizeCanvas();
  if (resized && camera) {
    updateCameraIntrinsics(camera);
  }
});

window.__3DBELIEF_VIEWER__ = {
  getPose: currentPoseRecord,
  getViewerState: viewerStateRecord,
  loadStep,
};

poseDefaults = await loadJson(POSE_DEFAULTS_URL, {});
config = await loadJson(SLIDER_CONFIG_URL, null);
if (!config?.steps?.length) {
  throw new Error(`No slider steps found for ${episodeName}.`);
}

loadStep(config.default_step || 0, { force: true }).catch((error) => {
  console.error(error);
  setProgress(true, 0, `Failed to load reveal viewer: ${error.message}`);
});

if (!animationStarted) {
  animationStarted = true;
  requestAnimationFrame(animate);
}
