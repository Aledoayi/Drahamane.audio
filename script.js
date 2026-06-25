"use strict";

const AUDIO_FOLDER = "audio/";
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "webm"]);

const state = {
  tracks: [],
  trackDurations: new Map(),
  currentIndex: 0,
  isPlaying: false,
  isShuffle: false,
  isLooping: true,
  isPlayOnce: false,
  playIntent: false,
  playOnceRemaining: 0,
  playbackRate: 1,
  skipSeconds: 10,
  configuredMaxDurationMs: 60 * 60 * 1000,
  activeDurationMs: 60 * 60 * 1000,
  startedAt: 0,
  countdownId: 0,
  autoStopId: 0,
  controlsHideId: 0,
  wakeLock: null,
  audioContext: null,
  analyser: null,
  sourceNode: null,
  visualizerFrame: 0,
  loadToken: 0,
};

const appShell = document.querySelector("#appShell");
const audioPlayer = document.querySelector("#audioPlayer");
const trackNumber = document.querySelector("#trackNumber");
const trackTitle = document.querySelector("#trackTitle");
const trackFilename = document.querySelector("#trackFilename");
const modeStatus = document.querySelector("#modeStatus");
const currentTime = document.querySelector("#currentTime");
const trackDuration = document.querySelector("#trackDuration");
const seekBar = document.querySelector("#seekBar");
const playButton = document.querySelector("#playButton");
const playIcon = document.querySelector("#playIcon");
const previousButton = document.querySelector("#previousButton");
const nextButton = document.querySelector("#nextButton");
const rewindButton = document.querySelector("#rewindButton");
const forwardButton = document.querySelector("#forwardButton");
const rewindValue = document.querySelector("#rewindValue");
const forwardValue = document.querySelector("#forwardValue");
const shuffleButton = document.querySelector("#shuffleButton");
const loopButton = document.querySelector("#loopButton");
const playOnceButton = document.querySelector("#playOnceButton");
const slowerButton = document.querySelector("#slowerButton");
const fasterButton = document.querySelector("#fasterButton");
const speedValue = document.querySelector("#speedValue");
const skipSelect = document.querySelector("#skipSelect");
const maxDurationSelect = document.querySelector("#maxDurationSelect");
const countdownValue = document.querySelector("#countdownValue");
const playlistToggle = document.querySelector("#playlistToggle");
const playlistPanel = document.querySelector("#playlistPanel");
const closePlaylist = document.querySelector("#closePlaylist");
const playlist = document.querySelector("#playlist");
const bottomZone = document.querySelector("#bottomZone");
const emptyState = document.querySelector("#emptyState");
const visualizer = document.querySelector("#visualizer");
const visualizerContext = visualizer.getContext("2d");

state.configuredMaxDurationMs = Number(maxDurationSelect.value) * 60 * 1000;
state.activeDurationMs = state.configuredMaxDurationMs;
state.skipSeconds = Number(skipSelect.value);

async function boot() {
  state.tracks = await discoverTracks();
  if (state.tracks.length === 0) {
    emptyState.hidden = false;
    updateCountdown();
    drawIdleVisualizer();
    return;
  }

  state.currentIndex = Math.floor(Math.random() * state.tracks.length);
  renderPlaylist();
  loadTrack(state.currentIndex, false);
  updateCountdown();
  scheduleControlsHide();
  drawIdleVisualizer();
}

async function discoverTracks() {
  const candidates = uniqueTracks([
    ...normalizeManifest(window.AUDIO_TRACKS || []),
    ...(await discoverJsonManifest()),
    ...(await discoverDirectoryTracks()),
  ]).filter(isSupportedAudio);

  const checked = await Promise.all(
    candidates.map(async (src) => ((await audioExists(src)) ? src : "")),
  );
  return checked.filter(Boolean);
}

function normalizeManifest(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((file) => typeof file === "string")
    .map((file) => (file.startsWith(AUDIO_FOLDER) ? file : `${AUDIO_FOLDER}${file}`));
}

async function discoverJsonManifest() {
  try {
    const response = await fetch(`${AUDIO_FOLDER}manifest.json`, { cache: "no-store" });
    if (!response.ok) return [];
    return normalizeManifest(await response.json());
  } catch {
    return [];
  }
}

async function discoverDirectoryTracks() {
  try {
    const response = await fetch(AUDIO_FOLDER, { cache: "no-store" });
    if (!response.ok) return [];
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return [...parsed.querySelectorAll("a[href]")]
      .map((link) => link.getAttribute("href"))
      .filter(Boolean)
      .map((href) => {
        const url = new URL(href, new URL(AUDIO_FOLDER, window.location.href));
        const filename = decodeURIComponent(url.pathname.split(`/${AUDIO_FOLDER}`).pop() || "");
        return filename ? `${AUDIO_FOLDER}${filename}` : "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function uniqueTracks(tracks) {
  return [...new Set(tracks)];
}

function isSupportedAudio(src) {
  const extension = src.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
  return AUDIO_EXTENSIONS.has(extension || "");
}

function audioExists(src) {
  return new Promise((resolve) => {
    const probe = new Audio();
    const finish = (exists) => {
      probe.removeAttribute("src");
      probe.load();
      resolve(exists);
    };
    const timer = window.setTimeout(() => finish(false), 15000);
    probe.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timer);
        if (Number.isFinite(probe.duration)) {
          state.trackDurations.set(src, probe.duration);
        }
        finish(true);
      },
      { once: true },
    );
    probe.addEventListener(
      "error",
      () => {
        window.clearTimeout(timer);
        finish(false);
      },
      { once: true },
    );
    probe.preload = "metadata";
    probe.src = src;
  });
}

function filenameFromPath(src) {
  const filename = decodeURIComponent(src.split("?")[0].split("#")[0].split("/").pop() || "");
  return filename;
}

function titleFromPath(src) {
  return filenameFromPath(src)
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderPlaylist() {
  playlist.textContent = "";
  state.tracks.forEach((src, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "track-option";
    button.dataset.index = String(index);
    button.setAttribute("role", "option");
    button.innerHTML = `
      <span class="track-option-index">${String(index + 1).padStart(2, "0")}</span>
      <span class="track-option-title"></span>
    `;
    button.querySelector(".track-option-title").textContent = titleFromPath(src);
    button.addEventListener("click", () => {
      loadTrack(index, state.isPlaying);
      closePlaylistPanel();
    });
    playlist.append(button);
  });
  updatePlaylistSelection();
}

function updatePlaylistSelection() {
  playlist.querySelectorAll(".track-option").forEach((button) => {
    const active = Number(button.dataset.index) === state.currentIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function loadTrack(index, autoplay = false) {
  if (state.tracks.length === 0) return;
  const loadToken = ++state.loadToken;
  state.currentIndex = (index + state.tracks.length) % state.tracks.length;
  const src = state.tracks[state.currentIndex];
  audioPlayer.src = src;
  audioPlayer.load();
  trackNumber.textContent =
    `${String(state.currentIndex + 1).padStart(2, "0")} / ${String(state.tracks.length).padStart(2, "0")}`;
  trackTitle.textContent = titleFromPath(src);
  trackFilename.textContent = filenameFromPath(src);
  currentTime.textContent = "00:00";
  trackDuration.textContent = "00:00";
  seekBar.value = "0";
  audioPlayer.playbackRate = state.playbackRate;
  audioPlayer.defaultPlaybackRate = state.playbackRate;
  audioPlayer.preservesPitch = true;
  audioPlayer.webkitPreservesPitch = true;
  updatePlaylistSelection();
  updateMediaSessionMetadata();
  if (autoplay) {
    state.playIntent = true;
    const resumePlayback = () => {
      if (
        loadToken === state.loadToken &&
        state.playIntent &&
        audioPlayer.paused
      ) {
        void playAudio();
      }
    };
    audioPlayer.addEventListener("canplay", resumePlayback, { once: true });
    void playAudio();
  }
}

async function playAudio() {
  if (state.tracks.length === 0) return;
  state.playIntent = true;
  try {
    await setupVisualizer();
  } catch {
    drawIdleVisualizer();
  }
  try {
    await audioPlayer.play();
  } catch (error) {
    state.isPlaying = false;
    console.warn("Lecture audio impossible :", error);
    updatePlaybackUi();
  }
}

function pauseAudio() {
  state.playIntent = false;
  audioPlayer.pause();
}

function togglePlayback() {
  state.isPlaying ? pauseAudio() : void playAudio();
}

function previousTrack() {
  const shouldResume = state.playIntent || state.isPlaying;
  if (audioPlayer.currentTime > 4) {
    audioPlayer.currentTime = 0;
    return;
  }
  loadTrack(state.currentIndex - 1, shouldResume);
}

function seekBy(seconds) {
  if (!Number.isFinite(audioPlayer.duration)) return;
  audioPlayer.currentTime = Math.min(
    Math.max(audioPlayer.currentTime + seconds, 0),
    audioPlayer.duration,
  );
  updateMediaSessionPosition();
}

function updateSkipControls() {
  rewindValue.textContent = String(state.skipSeconds);
  forwardValue.textContent = String(state.skipSeconds);
  rewindButton.setAttribute(
    "aria-label",
    `Reculer de ${state.skipSeconds} secondes`,
  );
  forwardButton.setAttribute(
    "aria-label",
    `Avancer de ${state.skipSeconds} secondes`,
  );
}

function changePlaybackRate(delta) {
  const nextRate = Math.min(
    3,
    Math.max(0.5, Math.round((state.playbackRate + delta) * 20) / 20),
  );
  state.playbackRate = nextRate;
  audioPlayer.defaultPlaybackRate = nextRate;
  audioPlayer.playbackRate = nextRate;
  speedValue.textContent = `${nextRate.toFixed(2).replace(".", ",")}×`;
  updateMediaSessionPosition();

  if (state.isPlayOnce) {
    state.activeDurationMs = getPlayOnceDurationMs();
    if (state.isPlaying) restartSessionTimer();
    else updateCountdown();
  }
}

function nextTrack(manual = true, forceAutoplay = false) {
  if (state.tracks.length === 0) return;
  const shouldAutoplay =
    forceAutoplay || state.playIntent || state.isPlaying;

  if (!manual && state.isPlayOnce) {
    state.playOnceRemaining -= 1;
    if (state.playOnceRemaining <= 0) {
      stopPlayback();
      return;
    }
  }

  if (
    !manual &&
    !state.isPlayOnce &&
    !state.isLooping &&
    !state.isShuffle &&
    state.currentIndex >= state.tracks.length - 1
  ) {
    stopPlayback();
    return;
  }

  let nextIndex = state.currentIndex + 1;
  if (state.isShuffle && state.tracks.length > 1) {
    do {
      nextIndex = Math.floor(Math.random() * state.tracks.length);
    } while (nextIndex === state.currentIndex);
  }
  loadTrack(nextIndex, shouldAutoplay);
}

function stopPlayback() {
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  state.isPlaying = false;
  state.playIntent = false;
  state.startedAt = 0;
  state.playOnceRemaining = 0;
  window.clearTimeout(state.autoStopId);
  stopCountdown();
  void releaseWakeLock();
  state.activeDurationMs = state.isPlayOnce
    ? getPlayOnceDurationMs()
    : state.configuredMaxDurationMs;
  updatePlaybackUi();
  updateCountdown();
  scheduleControlsHide();
}

function toggleShuffle() {
  state.isShuffle = !state.isShuffle;
  shuffleButton.classList.toggle("is-active", state.isShuffle);
  shuffleButton.setAttribute("aria-pressed", String(state.isShuffle));
}

function toggleLoop() {
  state.isLooping = !state.isLooping;
  loopButton.classList.toggle("is-active", state.isLooping);
  loopButton.setAttribute("aria-pressed", String(state.isLooping));
  if (state.isLooping && state.isPlayOnce) {
    state.isPlayOnce = false;
    playOnceButton.classList.remove("is-active");
    playOnceButton.setAttribute("aria-pressed", "false");
    maxDurationSelect.disabled = false;
    state.activeDurationMs = state.configuredMaxDurationMs;
    updateCountdown();
  }
}

function togglePlayOnce() {
  state.isPlayOnce = !state.isPlayOnce;
  playOnceButton.classList.toggle("is-active", state.isPlayOnce);
  playOnceButton.setAttribute("aria-pressed", String(state.isPlayOnce));
  maxDurationSelect.disabled = state.isPlayOnce;

  if (state.isPlayOnce) {
    state.isLooping = false;
    loopButton.classList.remove("is-active");
    loopButton.setAttribute("aria-pressed", "false");
    state.playOnceRemaining = state.tracks.length;
    state.activeDurationMs = getPlayOnceDurationMs();
  } else {
    state.playOnceRemaining = 0;
    state.activeDurationMs = state.configuredMaxDurationMs;
  }

  if (state.isPlaying) restartSessionTimer();
  else updateCountdown();
}

function getPlayOnceDurationMs() {
  const fallbackPerTrackSeconds = 5 * 60;
  const totalSeconds = state.tracks.reduce(
    (total, src) =>
      total + (state.trackDurations.get(src) || fallbackPerTrackSeconds),
    0,
  );
  return (totalSeconds / state.playbackRate) * 1000;
}

function startSessionTimer() {
  state.activeDurationMs = state.isPlayOnce
    ? getPlayOnceDurationMs()
    : state.configuredMaxDurationMs;
  state.playOnceRemaining = state.isPlayOnce ? state.tracks.length : 0;
  state.startedAt = performance.now();
  scheduleAutoStop();
  startCountdown();
}

function restartSessionTimer() {
  state.startedAt = performance.now();
  state.activeDurationMs = state.isPlayOnce
    ? getPlayOnceDurationMs()
    : state.configuredMaxDurationMs;
  scheduleAutoStop();
  startCountdown();
}

function scheduleAutoStop() {
  window.clearTimeout(state.autoStopId);
  const remaining = getRemainingMs();
  state.autoStopId = window.setTimeout(stopPlayback, remaining);
}

function getRemainingMs() {
  if (!state.startedAt) return state.activeDurationMs;
  return Math.max(state.activeDurationMs - (performance.now() - state.startedAt), 0);
}

function startCountdown() {
  stopCountdown();
  updateCountdown();
  state.countdownId = window.setInterval(() => {
    updateCountdown();
    if (getRemainingMs() <= 0) stopPlayback();
  }, 250);
}

function stopCountdown() {
  window.clearInterval(state.countdownId);
  state.countdownId = 0;
}

function updateCountdown() {
  countdownValue.textContent = formatTime(getRemainingMs() / 1000, true);
}

function formatTime(seconds, allowHours = false) {
  const total = Math.max(0, Math.ceil(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (allowHours || hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function updatePlaybackUi() {
  playIcon.textContent = state.isPlaying ? "❚❚" : "▶";
  playButton.setAttribute("aria-label", state.isPlaying ? "Mettre en pause" : "Lire");
  modeStatus.textContent = state.isPlaying ? "Lecture" : "En pause";
  appShell.classList.toggle("is-playing", state.isPlaying);
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
  }
}

function updateMediaSessionMetadata() {
  if (
    !("mediaSession" in navigator) ||
    !("MediaMetadata" in window) ||
    state.tracks.length === 0
  ) {
    return;
  }
  const src = state.tracks[state.currentIndex];
  const trackPosition = `Piste ${state.currentIndex + 1} sur ${state.tracks.length}`;
  const artworkBaseUrl = new URL("assets/", document.baseURI);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: titleFromPath(src),
    artist: "Drahamane Audio",
    album: `Écoute immersive • ${trackPosition}`,
    artwork: [
      {
        src: new URL("audio-cover-192.png", artworkBaseUrl).href,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: new URL("audio-cover-512.png", artworkBaseUrl).href,
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: new URL("audio-cover-1024.png", artworkBaseUrl).href,
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  });
  document.title = `${titleFromPath(src)} — Écoute immersive`;
  updateMediaSessionPosition();
}

function updateMediaSessionPosition() {
  if (
    !("mediaSession" in navigator) ||
    typeof navigator.mediaSession.setPositionState !== "function" ||
    !Number.isFinite(audioPlayer.duration) ||
    audioPlayer.duration <= 0
  ) {
    return;
  }
  try {
    navigator.mediaSession.setPositionState({
      duration: audioPlayer.duration,
      playbackRate: audioPlayer.playbackRate,
      position: Math.min(audioPlayer.currentTime, audioPlayer.duration),
    });
  } catch {
    // Position state is optional and varies between browsers.
  }
}

function setupMediaSessionActions() {
  if (!("mediaSession" in navigator)) return;
  const actions = {
    play: () => void playAudio(),
    pause: pauseAudio,
    previoustrack: previousTrack,
    nexttrack: () => nextTrack(true, state.playIntent || state.isPlaying),
    seekbackward: (details) =>
      seekBy(-(details.seekOffset || state.skipSeconds)),
    seekforward: (details) =>
      seekBy(details.seekOffset || state.skipSeconds),
    seekto: (details) => {
      if (!Number.isFinite(details.seekTime)) return;
      if (details.fastSeek && typeof audioPlayer.fastSeek === "function") {
        audioPlayer.fastSeek(details.seekTime);
      } else {
        audioPlayer.currentTime = details.seekTime;
      }
      updateMediaSessionPosition();
    },
    stop: stopPlayback,
  };

  Object.entries(actions).forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Ignore unsupported Media Session actions.
    }
  });
}

async function acquireWakeLock() {
  if (!navigator.wakeLock?.request || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    });
  } catch {
    state.wakeLock = null;
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) return;
  try {
    await state.wakeLock.release();
  } catch {
    // Wake Lock is optional; playback remains functional if release fails.
  } finally {
    state.wakeLock = null;
  }
}

function openPlaylistPanel() {
  playlistPanel.classList.add("is-open");
  playlistPanel.setAttribute("aria-hidden", "false");
  playlistToggle.setAttribute("aria-expanded", "true");
}

function closePlaylistPanel() {
  playlistPanel.classList.remove("is-open");
  playlistPanel.setAttribute("aria-hidden", "true");
  playlistToggle.setAttribute("aria-expanded", "false");
}

function togglePlaylistPanel() {
  playlistPanel.classList.contains("is-open")
    ? closePlaylistPanel()
    : openPlaylistPanel();
}

function revealControls() {
  window.clearTimeout(state.controlsHideId);
  appShell.classList.remove("controls-hidden");
}

function scheduleControlsHide() {
  window.clearTimeout(state.controlsHideId);
  state.controlsHideId = window.setTimeout(() => {
    if (!bottomZone.matches(":hover") && !bottomZone.matches(":focus-within")) {
      appShell.classList.add("controls-hidden");
    }
  }, 1400);
}

async function setupVisualizer() {
  // Web Audio can mute local media routed through MediaElementSource on file://.
  // Keep native audio output in direct-file mode so playback remains audible.
  if (window.location.protocol === "file:" || isIOSDevice()) {
    drawIdleVisualizer();
    return;
  }

  if (state.audioContext) {
    if (state.audioContext.state === "suspended") await state.audioContext.resume();
    return;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  state.audioContext = new AudioContext();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 128;
  state.analyser.smoothingTimeConstant = 0.84;
  state.sourceNode = state.audioContext.createMediaElementSource(audioPlayer);
  state.sourceNode.connect(state.analyser);
  state.analyser.connect(state.audioContext.destination);
  drawVisualizer();
}

function isIOSDevice() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const rect = visualizer.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  if (visualizer.width !== width || visualizer.height !== height) {
    visualizer.width = width;
    visualizer.height = height;
  }
  return { width, height, ratio };
}

function drawVisualizer() {
  cancelAnimationFrame(state.visualizerFrame);
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  const frame = () => {
    const { width, height } = resizeCanvas();
    state.analyser.getByteFrequencyData(data);
    visualizerContext.clearRect(0, 0, width, height);
    const barWidth = width / data.length;
    data.forEach((value, index) => {
      const normalized = value / 255;
      const barHeight = Math.max(2, normalized * height * 0.86);
      const hue = index / data.length;
      visualizerContext.fillStyle =
        hue < 0.55 ? "rgba(99, 197, 218, 0.78)" : "rgba(233, 180, 76, 0.78)";
      visualizerContext.fillRect(
        index * barWidth + 1,
        (height - barHeight) / 2,
        Math.max(1, barWidth - 2),
        barHeight,
      );
    });
    state.visualizerFrame = requestAnimationFrame(frame);
  };
  frame();
}

function drawIdleVisualizer() {
  const { width, height } = resizeCanvas();
  visualizerContext.clearRect(0, 0, width, height);
  const bars = 48;
  const barWidth = width / bars;
  for (let index = 0; index < bars; index += 1) {
    const wave = 0.1 + Math.sin(index * 0.48) ** 2 * 0.16;
    const barHeight = height * wave;
    visualizerContext.fillStyle =
      index < bars / 2 ? "rgba(99, 197, 218, 0.28)" : "rgba(233, 180, 76, 0.28)";
    visualizerContext.fillRect(
      index * barWidth + 1,
      (height - barHeight) / 2,
      Math.max(1, barWidth - 2),
      barHeight,
    );
  }
}

audioPlayer.addEventListener("play", () => {
  state.isPlaying = true;
  state.playIntent = true;
  if (!state.startedAt) startSessionTimer();
  // Let the device lock naturally; Media Session keeps supported browsers playing.
  void releaseWakeLock();
  updatePlaybackUi();
  scheduleControlsHide();
});

audioPlayer.addEventListener("pause", () => {
  state.isPlaying = false;
  void releaseWakeLock();
  updatePlaybackUi();
});

audioPlayer.addEventListener("ended", () => {
  if (
    state.isPlayOnce ||
    state.isLooping ||
    state.isShuffle ||
    state.currentIndex < state.tracks.length - 1
  ) {
    state.playIntent = true;
    nextTrack(false, true);
  } else {
    stopPlayback();
  }
});

audioPlayer.addEventListener("loadedmetadata", () => {
  trackDuration.textContent = formatTime(audioPlayer.duration);
  updateMediaSessionMetadata();
  if (state.isPlayOnce && !state.isPlaying) {
    state.activeDurationMs = getPlayOnceDurationMs();
    updateCountdown();
  }
});

audioPlayer.addEventListener("timeupdate", () => {
  currentTime.textContent = formatTime(audioPlayer.currentTime);
  if (Number.isFinite(audioPlayer.duration) && audioPlayer.duration > 0) {
    seekBar.value = String(Math.round((audioPlayer.currentTime / audioPlayer.duration) * 1000));
  }
  updateMediaSessionPosition();
});

audioPlayer.addEventListener("ratechange", updateMediaSessionPosition);

seekBar.addEventListener("input", () => {
  if (Number.isFinite(audioPlayer.duration)) {
    audioPlayer.currentTime = (Number(seekBar.value) / 1000) * audioPlayer.duration;
  }
});

playButton.addEventListener("click", togglePlayback);
previousButton.addEventListener("click", previousTrack);
nextButton.addEventListener("click", () => nextTrack(true));
rewindButton.addEventListener("click", () => seekBy(-state.skipSeconds));
forwardButton.addEventListener("click", () => seekBy(state.skipSeconds));
shuffleButton.addEventListener("click", toggleShuffle);
loopButton.addEventListener("click", toggleLoop);
playOnceButton.addEventListener("click", togglePlayOnce);
slowerButton.addEventListener("click", () => changePlaybackRate(-0.05));
fasterButton.addEventListener("click", () => changePlaybackRate(0.05));
playlistToggle.addEventListener("click", togglePlaylistPanel);
closePlaylist.addEventListener("click", closePlaylistPanel);

skipSelect.addEventListener("change", () => {
  state.skipSeconds = Number(skipSelect.value);
  updateSkipControls();
});

maxDurationSelect.addEventListener("change", () => {
  state.configuredMaxDurationMs = Number(maxDurationSelect.value) * 60 * 1000;
  if (state.isPlayOnce) return;
  state.activeDurationMs = state.configuredMaxDurationMs;
  if (state.isPlaying) restartSessionTimer();
  else updateCountdown();
});

bottomZone.addEventListener("pointerenter", revealControls);
bottomZone.addEventListener("pointermove", revealControls);
bottomZone.addEventListener("pointerleave", scheduleControlsHide);

appShell.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "mouse") {
    revealControls();
    scheduleControlsHide();
  }
  if (
    playlistPanel.classList.contains("is-open") &&
    !event.target.closest("#playlistPanel") &&
    !event.target.closest("#playlistToggle")
  ) {
    closePlaylistPanel();
  }
});

window.addEventListener("resize", () => {
  if (!state.analyser) drawIdleVisualizer();
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  }
  if (event.code === "ArrowRight") nextTrack(true);
  if (event.code === "ArrowLeft") previousTrack();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    void releaseWakeLock();
  }
});

loopButton.classList.add("is-active");
updateSkipControls();
setupMediaSessionActions();
boot();
