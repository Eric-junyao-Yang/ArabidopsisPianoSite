// Explainers: the small teaching sound toys in the folds. They share one oscillator (the explainer voice).
export { mountMorphExplainers } from "./morphExplainers.js"

/**
 * Decides which explainer is sounding: one owner at a time, and claiming the voice releases
 * the previous owner (whose onRelease resets its button).
 * @param {{ ready: () => Promise<void>, send: (msg: object) => void }} voice
 *   ready() builds / resumes the worklet; send() posts to it (dropped until ready)
 */
export function createVoiceOwner(voice) {
    let owner = null
    let onRelease = null

    return {
        get owner() { return owner },

        /** prime() returns the message that sets this explainer's sound, sent before the gate opens */
        async claim(name, release, prime) {
            this.release()
            owner = name
            onRelease = release
            await voice.ready()
            if (owner !== name) return // released while the worklet was starting
            if (prime) voice.send(prime())
            voice.send({ type: "gate", on: true })
        },

        release(name = owner) {
            if (owner === null || name !== owner) return
            const reset = onRelease
            owner = null
            onRelease = null
            voice.send({ type: "gate", on: false })
            reset?.()
        },

        /** Only the current owner gets through */
        send(name, msg) {
            if (owner === name) voice.send(msg)
        },
    }
}
