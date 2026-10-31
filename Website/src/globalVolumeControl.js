// Global audio hub + master volume control.
//
// Every sound source on the page (synth, MIDI player, step sequencer, slide demos)
// connects to `input` instead of ctx.destination, so there is exactly ONE AudioContext
// and ONE master volume.
//
//   sources -> input -> limiter -> masterGain -> destination
//
// The limiter sits before the volume stage so it only protects against sources summing
// up, and the slider scales the final output predictably.
//
// Autoplay policy: browsers keep an AudioContext "suspended" until a user gesture.
// The context is built at page load (silently), and resumed automatically on the very
// first click / key / touch anywhere on the page. Until then the volume widget shows
// "Click to enable sound" (and can itself be clicked), so no separate activate button
// is needed.

const STORAGE_KEY = "arabidopsisPiano.volume"
const DEFAULT_VOLUME = 0.8 // slider position 0..1
const UNITY_AT = 0.8 // slider position that maps to gain 1.0 (the pre-existing loudness)
const GESTURE_EVENTS = ["pointerup", "click", "keydown", "touchend"]

/** Perceptual slider -> gain curve (quadratic), 1.0 at UNITY_AT, ~+4 dB headroom at 100%. */
function sliderToGain(v) {
    return (v * v) / (UNITY_AT * UNITY_AT)
}

function loadSavedState() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
        if (saved && typeof saved.volume === "number") {
            return {
                volume: Math.min(1, Math.max(0, saved.volume)),
                muted: !!saved.muted,
            }
        }
    } catch (_) {
        /* storage unavailable or corrupt: fall through */
    }
    return { volume: DEFAULT_VOLUME, muted: false }
}

function saveState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (_) {
        /* private mode etc. */
    }
}

const ICONS = {
    // simple stroke icons, currentColor so CSS controls them
    high:
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>',
    low:
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
    muted:
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/></svg>',
}

/**
 * Create the shared AudioContext, master chain, and volume widget.
 *
 * @param {object}      opts
 * @param {string}      opts.workletUrl  AudioWorklet module registered once for all nodes.
 * @param {HTMLElement} [opts.mount]     Where to place the widget (default: document.body).
 * @returns {{
 *   ctx: AudioContext,
 *   input: GainNode,               connect every source here
 *   ready: Promise<AudioContext>,  resolves once the worklet module is loaded
 *   resume: () => Promise<void>,
 *   setVolume: (v: number) => void, getVolume: () => number,
 *   setMuted: (m: boolean) => void, isMuted: () => boolean,
 * }}
 */
export function initGlobalAudio({ workletUrl, mount = document.body }) {
    const AudioCtor = window.AudioContext || window.webkitAudioContext
    const ctx = new AudioCtor({ latencyHint: "interactive" })

    const input = ctx.createGain()
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -2
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.003
    limiter.release.value = 0.1
    const masterGain = ctx.createGain()

    input.connect(limiter).connect(masterGain).connect(ctx.destination)

    const state = loadSavedState()

    function applyGain() {
        const target = state.muted ? 0 : sliderToGain(state.volume)
        // short ramp avoids zipper noise / clicks when dragging
        masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.015)
    }
    applyGain()

    // ---------------- worklet ----------------
    const ready = ctx.audioWorklet.addModule(workletUrl).then(() => ctx)

    // ---------------- autoplay unlock ----------------
    async function resume() {
        if (ctx.state !== "running") {
            try {
                await ctx.resume()
            } catch (_) {
                /* needs a gesture; we'll try again on the next one */
            }
        }
        updateWidget()
    }
    const onGesture = () => {
        if (ctx.state !== "running") resume()
    }
    // Not { once: true }: some browsers reject resume() on the first (non-activating) event,
    // e.g. modifier keys; and iOS can re-suspend the context after interruptions.
    for (const evt of GESTURE_EVENTS) window.addEventListener(evt, onGesture, { passive: true })
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") onGesture()
    })
    ctx.addEventListener("statechange", updateWidget)

    // ---------------- widget ----------------
    const root = document.createElement("div")
    root.id = "global-volume"
    root.className = "volume-control"
    root.setAttribute("role", "group")
    root.setAttribute("aria-label", "Master volume")
    root.innerHTML = `
        <button type="button" class="volume-control__mute" aria-label="Mute"></button>
        <input class="volume-control__slider" type="range" min="0" max="100" step="1"
               aria-label="Master volume">
        <span class="volume-control__value" aria-hidden="true"></span>
        <span class="volume-control__hint" role="status"></span>
    `
    const muteBtn = root.querySelector(".volume-control__mute")
    const slider = root.querySelector(".volume-control__slider")
    const valueEl = root.querySelector(".volume-control__value")
    const hintEl = root.querySelector(".volume-control__hint")
    mount.appendChild(root)

    function updateWidget() {
        const pct = Math.round(state.volume * 100)
        slider.value = String(pct)
        slider.style.setProperty("--fill", `${pct}%`)
        valueEl.textContent = state.muted ? "muted" : `${pct}%`
        muteBtn.innerHTML = state.muted || pct === 0 ? ICONS.muted : pct < 50 ? ICONS.low : ICONS.high
        muteBtn.setAttribute("aria-label", state.muted ? "Unmute" : "Mute")
        muteBtn.setAttribute("aria-pressed", String(state.muted))
        root.classList.toggle("is-muted", state.muted)
        const locked = ctx.state !== "running"
        root.classList.toggle("is-locked", locked)
        hintEl.textContent = locked ? "Click anywhere to enable sound" : ""
    }

    function setVolume(v) {
        state.volume = Math.min(1, Math.max(0, v))
        // moving the slider while muted is an implicit unmute
        if (state.volume > 0) state.muted = false
        applyGain()
        saveState(state)
        updateWidget()
    }

    function setMuted(m) {
        state.muted = !!m
        // unmuting at volume 0 would stay silent; restore something audible
        if (!state.muted && state.volume === 0) state.volume = DEFAULT_VOLUME
        applyGain()
        saveState(state)
        updateWidget()
    }

    slider.addEventListener("input", () => setVolume(Number(slider.value) / 100))
    muteBtn.addEventListener("click", () => setMuted(!state.muted))

    updateWidget()

    return {
        ctx,
        input,
        ready,
        resume,
        setVolume,
        getVolume: () => state.volume,
        setMuted,
        isMuted: () => state.muted,
    }
}
