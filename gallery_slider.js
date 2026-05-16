const pageParams = new URLSearchParams(window.location.search);
const CONFIG_URL = pageParams.get("config") || "./config.json?v=gallery_v36_simplified_layout";
const VIEWER_VERSION = pageParams.get("viewerVersion") || pageParams.get("v") || "gallery_v36_simplified_layout";
const ASSET_ROOT_OVERRIDE = pageParams.get("assetRoot");

const wrapper = document.querySelector(".iframe-wrapper");
const inputImage = document.getElementById("input-image");
const selector = document.querySelector(".results-selector");
const thumbnails = document.querySelector(".results-thumbnails");
const previousButton = document.querySelector(".results-prev");
const nextButton = document.querySelector(".results-next");
const revealSlider = document.getElementById("reveal-slider");
const demoId = document.getElementById("demo-id");

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowLeft",
  "ArrowDown",
  "ArrowRight",
]);
const VIEWER_KEYS = new Set([
  ...MOVEMENT_KEYS,
  "KeyQ",
  "KeyE",
  "KeyR",
  "KeyF",
]);

let config = null;
let episodes = [];
let currentIndex = 0;
let currentStep = 0;
let activeIframe = null;

async function loadConfig() {
  const response = await fetch(CONFIG_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load ${CONFIG_URL}`);
  }
  return response.json();
}

function iframeSrc(episode) {
  const assetRoot = ASSET_ROOT_OVERRIDE
    || episode?.asset_root
    || config?.asset_root
    || "scenes";
  return `./viewer/embed_slider.html?episode=${episode.episode}&assetRoot=${assetRoot}&v=${VIEWER_VERSION}`;
}

function focusIframe(iframe) {
  try {
    iframe.contentWindow.focus();
  } catch {
    // Browser focus rules can be conservative around iframes.
  }
}

function postRevealStep(step) {
  if (!activeIframe?.contentWindow) {
    return;
  }
  activeIframe.contentWindow.postMessage(
    {
      type: "3dbelief-reveal-step",
      step,
    },
    window.location.origin,
  );
}

function createIframe(episode) {
  const iframe = document.createElement("iframe");
  iframe.src = iframeSrc(episode);
  iframe.title = "3D-Belief interactive Gaussian reveal viewer";
  iframe.allow = "clipboard-write";
  iframe.addEventListener("load", () => {
    activeIframe = iframe;
    window.setTimeout(() => {
      focusIframe(iframe);
      postRevealStep(currentStep);
    }, 0);
  });
  iframe.addEventListener("pointerenter", () => focusIframe(iframe));
  iframe.addEventListener("pointerdown", () => focusIframe(iframe));
  return iframe;
}

function postViewerKey(event, pressed) {
  if (!VIEWER_KEYS.has(event.code) || !activeIframe?.contentWindow) {
    return;
  }
  activeIframe.contentWindow.postMessage(
    {
      type: "3dbelief-key",
      code: event.code,
      pressed,
    },
    window.location.origin,
  );
  if (MOVEMENT_KEYS.has(event.code)) {
    event.preventDefault();
  }
}

function setActiveThumbnail(index) {
  thumbnails.querySelectorAll("button").forEach((button, buttonIndex) => {
    button.setAttribute("aria-pressed", String(buttonIndex === index));
  });
  if (index < 9) {
    thumbnails.scrollLeft = 0;
    window.requestAnimationFrame(() => {
      thumbnails.scrollLeft = 0;
    });
    return;
  }
  const selected = thumbnails.children[index];
  if (selected) {
    const scrollLeft = selected.offsetLeft - (thumbnails.clientWidth - selected.clientWidth) / 2;
    thumbnails.scrollTo({ left: scrollLeft, behavior: "smooth" });
  }
}

function updateThumbnailStripWidth() {
  if (!selector || !thumbnails) {
    return;
  }
  const availableWidth = selector.clientWidth;
  const contentWidth = thumbnails.scrollWidth;
  const stripWidth = Math.max(0, Math.min(contentWidth, availableWidth));
  selector.style.setProperty("--thumbnail-strip-width", `${Math.ceil(stripWidth)}px`);
}

function updateSliderForEpisode(index) {
  const episode = episodes[index];
  const maxStep = Math.max(0, Number(episode.step_count || 1) - 1);
  currentStep = 0;
  revealSlider.min = "0";
  revealSlider.max = String(maxStep);
  revealSlider.step = "1";
  revealSlider.value = "0";
}

function showEpisode(index) {
  currentIndex = (index + episodes.length) % episodes.length;
  const episode = episodes[currentIndex];
  updateSliderForEpisode(currentIndex);
  if (demoId) {
    demoId.textContent = episode.display_id || `#${String(currentIndex + 1).padStart(2, "0")}`;
  }
  if (inputImage) {
    inputImage.src = episode.input_image || episode.thumbnail;
  }
  wrapper.replaceChildren(createIframe(episode));
  setActiveThumbnail(currentIndex);
}

function populateThumbnails() {
  thumbnails.replaceChildren();
  episodes.forEach((episode, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `Demo ${episode.display_id || index + 1}`);
    button.setAttribute("aria-pressed", String(index === 0));
    button.addEventListener("click", () => showEpisode(index));

    const image = document.createElement("img");
    image.src = episode.thumbnail;
    image.alt = "";
    image.loading = index < 3 ? "eager" : "lazy";
    const id = document.createElement("span");
    id.className = "thumb-id";
    id.textContent = episode.display_id || `#${String(index + 1).padStart(2, "0")}`;
    button.appendChild(image);
    button.appendChild(id);
    thumbnails.appendChild(button);
  });
  window.requestAnimationFrame(updateThumbnailStripWidth);
}

previousButton.addEventListener("click", () => {
  showEpisode(currentIndex - 1);
});

nextButton.addEventListener("click", () => {
  showEpisode(currentIndex + 1);
});

revealSlider.addEventListener("input", () => {
  currentStep = Number(revealSlider.value) || 0;
  postRevealStep(currentStep);
});

window.addEventListener("keydown", (event) => {
  postViewerKey(event, true);
});

window.addEventListener("keyup", (event) => {
  postViewerKey(event, false);
});

window.addEventListener("resize", updateThumbnailStripWidth);

config = await loadConfig();
episodes = Array.isArray(config.episodes) ? config.episodes : [];
if (!episodes.length) {
  throw new Error("No slider gallery episodes found.");
}
populateThumbnails();

const params = new URLSearchParams(window.location.search);
const requestedEpisode = Number.parseInt(params.get("startEpisode") || params.get("demo") || "1", 10);
const initialIndex = Number.isFinite(requestedEpisode)
  ? Math.min(Math.max(requestedEpisode - 1, 0), episodes.length - 1)
  : 0;

showEpisode(initialIndex);
