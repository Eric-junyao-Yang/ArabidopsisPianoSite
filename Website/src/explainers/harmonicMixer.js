const NAME = "Harmonics"
const DEFAULT_FREQ = 440 // harmonic 1 until a key is pressed

/**
 * Eight sliders and a play / stop button. Each slider is harmonic k's share of the energy
 * (k = 1 is the 48 h cycle); the mix is always played at the same loudness.
 * While playing, the synth keyboard sets harmonic 1's pitch instead of playing the gene synth.
 *
 * Preset buttons (anywhere on the page) set all eight sliders and play:
 *   <button data-levels="1 0 0 0 0 0 0 0" aria-pressed="false">   (harmonic 1 first)
 * They act like radio buttons that can all be off: the one playing is lit, pressing it again stops,
 * and stopping or moving a slider by hand turns them all off.
 */
export function mountHarmonicMixer(root, voiceOwner, bus, presets = []) {
    if (!root) return
    const sliders = [...root.querySelectorAll(".harmonic-mixer__slider")]
    const playBtn = root.querySelector(".harmonic-mixer__play")
    if (!playBtn) return

    let freq = DEFAULT_FREQ
    const heldKeys = new Map() // key -> freq, in press order; the newest held key sets the pitch
    let activePreset = null

    const isPlaying = () => voiceOwner.owner === NAME

    const harmonicsMessage = () => {
        const levels = new Array(sliders.length).fill(0)
        for (const slider of sliders) levels[Number(slider.dataset.harmonic) - 1] = Number(slider.value)
        return { type: "harmonics", levels, freq }
    }
    const update = () => voiceOwner.send(NAME, harmonicsMessage())

    // Each fader's readout is its share of the total (what is actually heard), not its raw position
    const showLevels = () => {
        const total = sliders.reduce((sum, slider) => sum + Number(slider.value), 0)
        for (const slider of sliders) {
            const value = Number(slider.value)
            slider.style.setProperty("--fill", `${value * 100}%`)
            const readout = slider.closest(".harmonic-mixer__channel")?.querySelector(".harmonic-mixer__value")
            if (readout) readout.textContent = `${total > 0 ? Math.round((value / total) * 100) : 0}%`
        }
    }

    const setActivePreset = (button) => {
        activePreset = button
        for (const preset of presets) preset.setAttribute("aria-pressed", String(preset === button))
    }

    for (const slider of sliders) {
        slider.addEventListener("input", () => {
            setActivePreset(null) // the mix no longer matches a preset
            showLevels()
            update()
        })
    }
    showLevels()

    // Monophonic: the latest held key wins; releasing it falls back to the one held before,
    // and letting go of everything keeps the last pitch so the drone continues
    const keyboard = {
        keyDown(key, keyFreq) {
            heldKeys.delete(key)
            heldKeys.set(key, keyFreq)
            freq = keyFreq
            update()
        },
        keyUp(key) {
            heldKeys.delete(key)
            const previous = [...heldKeys.values()].at(-1)
            if (previous === undefined) return
            freq = previous
            update()
        },
    }

    // Runs on Stop and when another explainer takes the voice
    const onRelease = () => {
        playBtn.textContent = "Play"
        root.classList.remove("is-playing")
        heldKeys.clear()
        setActivePreset(null)
        bus.execute_event("piano_capture", null)
    }

    // Claiming again while playing would restart the voice (a fade out / in), so only claim when idle
    const play = () => {
        if (isPlaying()) return
        voiceOwner.claim(NAME, onRelease, harmonicsMessage)
        bus.execute_event("piano_capture", keyboard)
        playBtn.textContent = "Stop"
        root.classList.add("is-playing")
    }

    playBtn.addEventListener("click", () => {
        if (isPlaying()) voiceOwner.release(NAME)
        else play()
    })

    for (const preset of presets) {
        const levels = preset.dataset.levels.trim().split(/\s+/).map(Number)
        preset.addEventListener("click", () => {
            if (preset === activePreset && isPlaying()) {
                voiceOwner.release(NAME)
                return
            }
            // Set the mix before playing, so the previous mix isn't heard first
            for (const slider of sliders) slider.value = String(levels[Number(slider.dataset.harmonic) - 1] ?? 0)
            showLevels()
            update()
            play()
            setActivePreset(preset)
        })
    }
}
