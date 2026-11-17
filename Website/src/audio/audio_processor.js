import { TABLE_SIZE, StaticSource, GPSource, stepEnvelope } from "/src/audio/sources.js"

const SYNTH_SWEEP_SECONDS = 0.05 // keep in sync with SWEEP_TIME in plotWaveforms.js

class SynthAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.voices = new Map()
        this.octave = 0
        this.gain = 0.2
        this.attackInc = 1 / (sampleRate * 0.005)
        this.releaseInc = 1 / (sampleRate * 0.03)
        this.invSampleRate = 1 / sampleRate

        // What every voice plays: a gene's fixed table (All genes) or a morph through its
        // GP posterior draws (Circadian). null = no gene, silent.
        this.source = null

        this.port.onmessage = (event) => {
            const msg = event.data
            if (msg.type === "setStatic") {
                this.source = new StaticSource(msg.points)
            } else if (msg.type === "setGP") {
                this.source = new GPSource(msg.mu, msg.L, {
                    sweepSeconds: SYNTH_SWEEP_SECONDS,
                    // posts a copy, so the source can reuse its buffer
                    onTarget: (draw) => this.port.postMessage({ type: "gpDraw", draw }),
                })
            } else if (msg.type === "clearSource") {
                this.source = null
            } else if (msg.type === "keyDownUpdate") {
                const voice = this.voices.get(msg.freq)
                if (voice) voice.state = "attack"
                else this.voices.set(msg.freq, { phase: 0, lvl: 0, state: "attack" })
            } else if (msg.type === "keyUpUpdate") {
                const voice = this.voices.get(msg.freq)
                if (voice) voice.state = "release"
            } else if (msg.type === "synthFreqShift") {
                if (msg.dir === "down") this.octave = Math.max(-3, this.octave - 1)
                if (msg.dir === "up") this.octave = Math.min(3, this.octave + 1)
            }
        }
    }

    renderVoice(freq, voice, channels, source){
        const outputLength = channels[0].length
        const increment = freq * Math.pow(2, this.octave) * TABLE_SIZE * this.invSampleRate

        for (let i = 0; i < outputLength; i++) {
            stepEnvelope(voice, this.attackInc, this.releaseInc)

            // No source: envelope still runs, so a released key finishes and is removed
            const amp = (source ? source.sample(voice.phase, i) : 0) * this.gain * voice.lvl
            for (let c = 0; c < channels.length; c++) {
                channels[c][i] += amp
            }

            voice.phase += increment
            if (voice.phase >= TABLE_SIZE) voice.phase %= TABLE_SIZE
        }
    }

    process(inputs, outputs) {
        const channels = outputs[0]
        for (let c = 0; c < channels.length; c++) {
            channels[c].fill(0)
        }
        if (this.voices.size === 0) return true

        // Once per block, before any voice: a GP source advances its shared morph clock here
        const source = this.source
        source?.prepareBlock(channels[0].length)

        const finished = []
        for (const [freq, voice] of this.voices) {
            this.renderVoice(freq, voice, channels, source)
            if (voice.state === "finished") finished.push(freq)
        }
        for (let i = 0; i < finished.length; i++) {
            this.voices.delete(finished[i])
        }
        return true
    }
}

class MidiAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        // trackIndex (0-based, matching the UI / MIDI file tracks) -> what that track plays:
        // a gene's fixed VST table, or a morph through its GP draws. No entry = no gene, silent.
        this.sources = new Map()
        this.watchedTrack = null // track whose GP draws are posted to main for the plot
        this.activeTracks = new Set() // reused every block: tracks with voices to render
        this.voices = new Map()
        this.voiceGain = 0.15
        this.attackInc = 1 / (sampleRate * 0.005)
        this.releaseInc = 1 / (sampleRate * 0.03)
        this.invSampleRate = 1 / sampleRate

        this.port.onmessage = (event) => {
            const msg = event.data
            if (msg.type === "setTrackStatic") {
                this.sources.set(msg.trackIndex, new StaticSource(msg.points))
            } else if (msg.type === "setTrackGP") {
                const source = new GPSource(msg.mu, msg.L)
                this.sources.set(msg.trackIndex, source)
                if (msg.trackIndex === this.watchedTrack) source.setOnTarget(this.postTrackDraw(msg.trackIndex))
            } else if (msg.type === "watchTrack") {
                this.sources.get(this.watchedTrack)?.setOnTarget?.(null)
                this.watchedTrack = msg.trackIndex
                this.sources.get(msg.trackIndex)?.setOnTarget?.(this.postTrackDraw(msg.trackIndex))
            } else if (msg.type === "clearTrack") {
                this.sources.delete(msg.trackIndex)
                this.releaseVoices((voice) => voice.trackIndex === msg.trackIndex)
            } else if (msg.type === "clearAllTracks") {
                this.sources.clear()
                this.releaseVoices(() => true)
            } else if (msg.type === "noteOn") {
                // Skip tracks with no gene assigned yet
                if (!this.sources.has(msg.trackIndex)) return
                this.voices.set(msg.uniqueID, {
                    trackIndex: msg.trackIndex,
                    freq: msg.freq,
                    velocity: msg.velocity ?? 1,
                    when: msg.when ?? currentTime,
                    endTime: (msg.when ?? currentTime) + (msg.duration ?? 0),
                    state: "pending",
                    lvl: 0,
                    phase: 0,
                })
            } else if (msg.type === "allNotesOff") {
                this.releaseVoices(() => true)
            }
        }
    }

    // Posts a copy of each draw the track starts morphing towards
    postTrackDraw(trackIndex) {
        return (draw) => this.port.postMessage({ type: "trackDraw", trackIndex, draw })
    }

    releaseVoices(match) {
        for (const voice of this.voices.values()) {
            if (voice.state !== "finished" && match(voice)) voice.state = "release"
        }
    }

    renderVoice(channels, voice) {
        const outputLength = channels[0].length
        const source = this.sources.get(voice.trackIndex) // gone if the track was cleared mid-note
        const increment = voice.freq * TABLE_SIZE * this.invSampleRate
        const velGain = this.voiceGain * voice.velocity

        for (let i = 0; i < outputLength; i++) {
            const t = currentTime + i * this.invSampleRate

            if (voice.state === "pending") {
                if (t < voice.when) continue
                voice.state = "attack"
            }

            stepEnvelope(voice, this.attackInc, this.releaseInc)
            // Scheduled note end: release starts this frame
            if (voice.state === "sustain" && t >= voice.endTime) {
                voice.state = "release"
                stepEnvelope(voice, this.attackInc, this.releaseInc)
            }
            if (voice.state === "finished") continue

            const amp = (source ? source.sample(voice.phase, i) : 0) * velGain * voice.lvl
            for (let c = 0; c < channels.length; c++) {
                channels[c][i] += amp
            }

            voice.phase += increment
            if (voice.phase >= TABLE_SIZE) voice.phase %= TABLE_SIZE
        }
    }

    process(inputs, outputs) {
        const channels = outputs[0]
        for (let c = 0; c < channels.length; c++) {
            channels[c].fill(0)
        }

        if (this.voices.size === 0) return true

        // Each track's source advances once per block (its own morph clock), only while it has notes
        this.activeTracks.clear()
        for (const voice of this.voices.values()) this.activeTracks.add(voice.trackIndex)
        for (const trackIndex of this.activeTracks) {
            this.sources.get(trackIndex)?.prepareBlock(channels[0].length)
        }

        const finished = []
        for (const [id, voice] of this.voices) {
            this.renderVoice(channels, voice)
            if (voice.state === "finished") finished.push(id)
        }
        for (let i = 0; i < finished.length; i++) {
            this.voices.delete(finished[i])
        }
        return true
    }
}

const EXPLAINER_GAIN = 0.2
const EXPLAINER_FADE_SECONDS = 0.01 // gate fade, so starting / stopping doesn't click

/**
 * One oscillator shared by the sound explainers. Every sound is a single wavetable read at freq;
 * the messages only rewrite that table:
 *   { type: "morph", amplitude, shape, cycles }  sine→square blend at 440 Hz × cycles / 3
 *   { type: "harmonics", levels, freq }           harmonic k gets levels[k-1] as its share of the energy;
 *                                                 freq is harmonic 1
 *   { type: "gate", on }                          fade the output in / out
 */
class ExplainerVoiceProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.table = new Float32Array(TABLE_SIZE)
        this.freq = 440
        this.phase = 0
        this.gain = 0
        this.targetGain = 0
        this.fadeCoef = 1 - Math.exp(-1 / (EXPLAINER_FADE_SECONDS * sampleRate))
        this.setMorph({ amplitude: 1, shape: 0, cycles: 3 })

        this.port.onmessage = ({ data }) => {
            if (data.type === "morph") this.setMorph(data)
            else if (data.type === "harmonics") this.setHarmonics(data.levels, data.freq)
            else if (data.type === "gate") this.targetGain = data.on ? EXPLAINER_GAIN : 0
        }
    }

    setMorph({ amplitude, shape, cycles }) {
        this.freq = 440 * (cycles / 3)
        for (let i = 0; i < TABLE_SIZE; i++) {
            const sin = Math.sin(2 * Math.PI * (i / TABLE_SIZE))
            const square = Math.sign(sin)
            this.table[i] = amplitude * ((1 - shape) * sin + shape * square)
        }
    }

    // levels are energy shares: amplitude_k = sqrt(level_k / Σ levels), so Σ amplitude² = 1 and every
    // mix has the RMS of a full-scale sine (equal loudness). Only the balance changes the sound.
    setHarmonics(levels, freq = 440) {
        this.freq = freq
        const total = levels.reduce((a, b) => a + b, 0)
        const amps = levels.map((level) => (total > 0 ? Math.sqrt(level / total) : 0))
        for (let i = 0; i < TABLE_SIZE; i++) {
            const theta = 2 * Math.PI * (i / TABLE_SIZE)
            let sample = 0
            for (let k = 0; k < amps.length; k++) {
                if (amps[k]) sample += amps[k] * Math.sin((k + 1) * theta)
            }
            this.table[i] = sample
        }
    }

    process(inputs, outputs) {
        const channels = outputs[0]
        const increment = this.freq * TABLE_SIZE / sampleRate
        for (let i = 0; i < channels[0].length; i++) {
            const base = Math.floor(this.phase)
            const i0 = base % TABLE_SIZE
            const i1 = (i0 + 1) % TABLE_SIZE
            const frac = this.phase - base
            this.gain += (this.targetGain - this.gain) * this.fadeCoef
            const sample = (this.table[i0] * (1 - frac) + this.table[i1] * frac) * this.gain
            for (const channel of channels) channel[i] = sample
            this.phase = (this.phase + increment) % TABLE_SIZE
        }
        return true
    }
}



registerProcessor("synth-audio-processor", SynthAudioProcessor)
registerProcessor("explainer-voice-processor", ExplainerVoiceProcessor)
registerProcessor("midi-audio-processor", MidiAudioProcessor)