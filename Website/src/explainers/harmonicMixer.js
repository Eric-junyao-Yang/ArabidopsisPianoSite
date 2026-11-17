const NAME = "Harmonics"
const DEFAULT_FREQ = 440 // harmonic 1 until a key is pressed

/**
 * Eight sliders and a play / stop button. Each slider is harmonic k's share of the energy
 * (k = 1 is the 48 h cycle); the mix is always played at the same loudness.
 * While playing, the synth keyboard sets harmonic 1's pitch instead of playing the gene synth.
 */
export function mountHarmonicMixer(root, voiceOwner, bus) {
    if (!root) return
    const sliders = [...root.querySelectorAll(".harmonic-mixer__slider")]
    const playBtn = root.querySelector(".harmonic-mixer__play")
    if (!playBtn) return

    let freq = DEFAULT_FREQ
    const heldKeys = new Map() // key -> freq, in press order; the newest held key sets the pitch

    const harmonicsMessage = () => {
        const levels = new Array(sliders.length).fill(0)
        for (const slider of sliders) levels[Number(slider.dataset.harmonic) - 1] = Number(slider.value)
        return { type: "harmonics", levels, freq }
    }
    const update = () => voiceOwner.send(NAME, harmonicsMessage())

    for (const slider of sliders) slider.addEventListener("input", update)

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

    const onRelease = () => {
        playBtn.textContent = "Play"
        heldKeys.clear()
        bus.execute_event("piano_capture", null)
    }
    playBtn.addEventListener("click", () => {
        if (voiceOwner.owner === NAME) {
            voiceOwner.release(NAME)
            return
        }
        voiceOwner.claim(NAME, onRelease, harmonicsMessage)
        bus.execute_event("piano_capture", keyboard)
        playBtn.textContent = "Stop"
    })
}
