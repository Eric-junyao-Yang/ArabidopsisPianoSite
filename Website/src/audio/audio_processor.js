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

class ExplainerVoiceProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.table = new Float32Array(TABLE_SIZE)
        this.amplitude = 1
        this.freq = 440
        this.shape = 0
        this.phase = 0
        this.mode = "morph"
        this.updateTable()

        //Harmonics Mixing
        this.harmonics = [1,2,3,4,5,6,7,8].map((v,i) => ({
            waveform: this.buildHarmonics(v),
            value: 0
        }))

        this.port.onmessage = (event) => {
            if (event.data.type === "updateWave") {
                this.mode = "morph"
                this.amplitude = event.data.amplitude
                this.shape = event.data.shape
                this.freq = 440 * (event.data.cycles / 3)
                this.updateTable()
            }
            if (event.data.type === "updateHarmonics") {
                const harmonic_values = event.data.harmonic_values
                for (let i=0; i<harmonic_values.length; i++){
                    this.harmonics[i].value = Number(harmonic_values[i].value)
                }
            }
            if (event.data.type === "switchMode") {
                this.mode = event.data.mode
                if (this.mode === "harmonics"){
                    this.freq = 440
                }
            }
        }
    }

    buildHarmonics(ratio){
        const wave = new Float32Array(TABLE_SIZE)
        for (let i=0; i<TABLE_SIZE; i++){
            wave[i] = Math.sin(2*Math.PI * (i/TABLE_SIZE) * ratio)
        }
        return wave
    }

    updateTable(){
        for (let i=0;i<TABLE_SIZE;i++){
            const phase = 2 * Math.PI * (i/TABLE_SIZE)
            const sin = Math.sin(phase)
            const square = Math.sign(sin)
            const wave = (1 - this.shape) * sin + this.shape * square
            this.table[i] = this.amplitude * wave
        }
    }

    generateSound(channels, gain, source){
        const outputLength = channels[0].length
        const increment = this.freq * TABLE_SIZE / sampleRate

        for (let i=0; i < outputLength; i ++){
            //wavetable
            const base = Math.floor(this.phase)
            const i0 = base % TABLE_SIZE //lookup index in wavetable
            const i1 = (i0 + 1) % TABLE_SIZE
            const frac = this.phase - base
            const sample = source[i0] * (1-frac) + source[i1] * frac
            for (const channel of channels){
                channel[i] += sample * gain
            }
            this.phase += increment

            if (this.phase >= TABLE_SIZE){
                this.phase %= TABLE_SIZE
            }
        }
    }

    generateSoundHarmonics(channels){
        for (const item of this.harmonics){
            this.generateSound(channels, item.value, item.waveform)
        }
    }

    process(inputs, outputs) { //input is from previous node, should be empty for this; output is what the worklet needs manipulated into real data
        const channels = outputs[0]
        for (const channel of channels){
            channel.fill(0)
        }
        if (this.mode === "morph"){
            const gain = 0.2
            this.generateSound(channels, gain, this.table)
        }
        if (this.mode === "harmonics"){
            this.generateSoundHarmonics(channels)
        }
        return true
    }
}



registerProcessor("synth-audio-processor", SynthAudioProcessor)
registerProcessor("explainer-voice-processor", ExplainerVoiceProcessor)
registerProcessor("midi-audio-processor", MidiAudioProcessor)