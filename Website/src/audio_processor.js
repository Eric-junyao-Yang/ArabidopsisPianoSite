import { toUnipolarWavetable, catmullrom } from "/src/catmullrom.js"

const TABLE_SIZE = 2048

class SynthAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.table = new Float32Array(TABLE_SIZE).fill(0.5)
        this.voices = new Map()
        this.octave = 0
        this.attackInc = 1 / (sampleRate * 0.005)
        this.releaseInc = 1 / (sampleRate * 0.03)
        this.invSampleRate = 1 / sampleRate

        this.port.onmessage = (event) => {
            if (event.data.type === "updatePoints") {
                // Same path as MIDI / gene tables: interpolate → maxAbs → [0, 1]
                this.table = toUnipolarWavetable(event.data.points, TABLE_SIZE)
            }
            if (event.data.type === "keyDownUpdate") {
                if (this.voices.has(event.data.freq)){
                    this.voices.get(event.data.freq).state = "attack"
                } else {
                    this.voices.set(event.data.freq, {
                        phase: 0,
                        lvl: 0,
                        state: "attack"
                    })
                }
            }
            if (event.data.type === "keyUpUpdate") {
                const voice = this.voices.get(event.data.freq)
                if (voice) voice.state = "release"
            }
            if (event.data.type === "synthFreqShift") {
                if (event.data.dir === "down"){
                    this.octave = Math.max(-3, this.octave - 1)
                }
                if (event.data.dir === "up"){
                    this.octave = Math.min(3, this.octave + 1)
                }
            }
        }
    }

    generateSound(freq, channels, gain, data){
        const internal_freq = freq * Math.pow(2, this.octave)
        const outputLength = channels[0].length
        const increment = internal_freq * TABLE_SIZE * this.invSampleRate

        for (let i=0; i < outputLength; i ++){
            if (data.state === "attack"){
                data.lvl += this.attackInc
                if (data.lvl >= 1){
                    data.lvl = 1
                    data.state = "sustain"
                }
            }

            if (data.state === "release"){
                data.lvl -= this.releaseInc
                if (data.lvl <= 0){
                    data.lvl = 0
                    data.state = "finished"
                }
            }

            const base = Math.floor(data.phase)
            const i0 = base % TABLE_SIZE
            const i1 = (i0 + 1) % TABLE_SIZE
            const frac = data.phase - base
            const sample = (this.table[i0] * (1-frac) + this.table[i1] * frac) * 2 - 1
            const amp = sample * gain * data.lvl
            for (let c = 0; c < channels.length; c++) {
                channels[c][i] += amp
            }
            data.phase += increment

            if (data.phase >= TABLE_SIZE){
                data.phase %= TABLE_SIZE
            }
        }
    }

    process(inputs, outputs) {
        const channels = outputs[0]
        const totalKeys = this.voices.size

        for (let c = 0; c < channels.length; c++) {
            channels[c].fill(0)
        }

        if (totalKeys === 0) {
            return true
        }

        const gain = 0.2
        const finished = []

        for (const [freq, data] of this.voices){
            this.generateSound(freq, channels, gain, data)
            if (data.state === "finished") finished.push(freq)
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
        // 0-based track slots matching UI / Tone.js track indices.
        // Midpoint 0.5 → silence after bipolar map (0*2-1 = -1 would be a loud DC click).
        this.tables = new Map()
        this.tableReady = new Set()
        for (let i = 0; i < 8; i++) {
            this.tables.set(i, new Float32Array(TABLE_SIZE).fill(0.5))
        }
        this.voices = new Map()
        this.voiceGain = 0.15
        this.attackInc = 1 / (sampleRate * 0.005)
        this.releaseInc = 1 / (sampleRate * 0.03)
        this.invSampleRate = 1 / sampleRate

        this.port.onmessage = (event) => {
            const msg = event.data
            if (msg.type === "updateWavetable") {
                const table = msg.waveform
                if (table && table.length) {
                    this.tables.set(msg.trackIndex, table)
                    this.tableReady.add(msg.trackIndex)
                }
            } else if (msg.type === "noteOn") {
                // Skip tracks with no gene assigned yet
                if (!this.tableReady.has(msg.trackIndex)) return
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
                for (const voice of this.voices.values()) {
                    if (voice.state !== "finished") voice.state = "release"
                }
            }
        }
    }

    generateSound(channels, data) {
        const outputLength = channels[0].length
        const table = this.tables.get(data.trackIndex)
        if (!table || table.length === 0) {
            data.state = "finished"
            return
        }
        const tableLen = table.length
        const increment = data.freq * tableLen * this.invSampleRate
        const velGain = this.voiceGain * data.velocity

        for (let i = 0; i < outputLength; i++) {
            const t = currentTime + i * this.invSampleRate

            if (data.state === "pending") {
                if (t < data.when) continue
                data.state = "attack"
            }

            if (data.state === "attack") {
                data.lvl += this.attackInc
                if (data.lvl >= 1) {
                    data.lvl = 1
                    data.state = "sustain"
                }
            }

            if (data.state === "sustain" && t >= data.endTime) {
                data.state = "release"
            }

            if (data.state === "release") {
                data.lvl -= this.releaseInc
                if (data.lvl <= 0) {
                    data.lvl = 0
                    data.state = "finished"
                    continue
                }
            }

            const base = Math.floor(data.phase)
            const i0 = base % tableLen
            const i1 = (i0 + 1) % tableLen
            const frac = data.phase - base
            // Tables are expected in ~[0, 1]; map to bipolar [-1, 1]
            const sample = (table[i0] * (1 - frac) + table[i1] * frac) * 2 - 1
            const amp = sample * velGain * data.lvl
            for (let c = 0; c < channels.length; c++) {
                channels[c][i] += amp
            }

            data.phase += increment
            if (data.phase >= tableLen) data.phase %= tableLen
        }
    }

    process(inputs, outputs) {
        const channels = outputs[0]
        for (let c = 0; c < channels.length; c++) {
            channels[c].fill(0)
        }

        if (this.voices.size === 0) return true

        const finished = []
        for (const [id, data] of this.voices) {
            this.generateSound(channels, data)
            if (data.state === "finished") finished.push(id)
        }
        for (let i = 0; i < finished.length; i++) {
            this.voices.delete(finished[i])
        }
        return true
    }
}


function gatherCatmullrom(waveTable, phase, N_GRID){
    const p1 = Math.floor(phase) % N_GRID
    const p0 = (p1 - 1 + N_GRID) % N_GRID
    const p2 = (p1 + 1) % N_GRID
    const p3 = (p2 + 1) % N_GRID
    const frac = phase - Math.floor(phase)
    return catmullrom(waveTable[p0], waveTable[p1], waveTable[p2], waveTable[p3], frac)
}

class StepSeqAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super()
        const {metaValues, shared} = options.processorOptions
        this.shared = shared
        this.N_GRID = metaValues.N_GRID
        this.N_SAMPLES = metaValues.N_SAMPLES
        this.N_WAVES = metaValues.N_WAVES
        this.BLOCK = metaValues.BLOCK
        this.nrows = metaValues.nrows
        this.WAVE_KEYS = metaValues.WAVE_KEYS

        this.geneIndex = null
        this.freq = 0
        this.sweep = 1
        this.phase = 0
        this.audio_waves = new Array(this.N_SAMPLES)

        //for sweeping
        this.sampleCount = 0
        this.totalSamples = 0


        //for fade in and out
        this.fadeInSamples = 0
        this.fadeOutSamples = 0
        this.active = false

        this.port.onmessage = (event) => {
            if (event.data.type === "geneSpecifics") {
                this.geneIndex = event.data.Index
                this.freq = event.data.freq
                this.sweep = event.data.sweep

                const base = this.BLOCK * this.geneIndex
                for (let i = 0; i < this.N_SAMPLES; i++) {
                    this.audio_waves[i] = new Float32Array(
                        this.shared,
                        (base + this.N_GRID * i) * 4,
                        this.N_GRID
                    )
                }
                this.totalSamples = Math.floor(event.data.duration * sampleRate)
                this.fadeInSamples = Math.floor(event.data.duration * 0.10 * sampleRate)
                this.fadeOutSamples = Math.floor(event.data.duration * 0.10 * sampleRate)
                this.fadeOutStart = this.totalSamples - this.fadeOutSamples
                this.sampleCount = 0
                this.phase = 0
                this.active = true
            }
        }
    }

    process(inputs, outputs) {
        if (!this.active) return true

        const output = outputs[0]
        const left = output[0]
        const increment = this.freq * (this.N_GRID / sampleRate)

        for (let i = 0; i < left.length; i++) {
            // Morph across posterior samples over the note duration
            const frac_sample = this.sampleCount / Math.max(this.totalSamples, 1)
            const frame_pos = (this.N_SAMPLES - 1) * 0.5 * (1 - Math.cos(2 * Math.PI * this.sweep * frac_sample))
            const f0 = Math.min(Math.floor(frame_pos), this.N_SAMPLES - 1)
            const f1 = Math.min(f0 + 1, this.N_SAMPLES - 1)
            const wfrac = frame_pos - f0

            const sampleV0 = gatherCatmullrom(this.audio_waves[f0], this.phase, this.N_GRID)
            const sampleV1 = gatherCatmullrom(this.audio_waves[f1], this.phase, this.N_GRID)
            let sample = sampleV0 * (1 - wfrac) + sampleV1 * wfrac

            if (this.fadeInSamples > 0 && this.sampleCount < this.fadeInSamples) {
                sample *= this.sampleCount / this.fadeInSamples
            } else if (this.fadeOutSamples > 0 && this.sampleCount >= this.fadeOutStart) {
                sample *= (this.totalSamples - this.sampleCount) / this.fadeOutSamples
            }

            for (let ch = 0; ch < output.length; ch++) {
                output[ch][i] = sample
            }
            this.phase += increment
            this.sampleCount++

            if (this.sampleCount >= this.totalSamples) {
                for (let ch = 0; ch < output.length; ch++) {
                    output[ch][i] = 0
                }
                this.active = false
                this.port.postMessage({ type: "ended" })
                break
            }
        }
        return true
    }
}

class SynthSlidesAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.table = new Float32Array(TABLE_SIZE)
        this.amplitude = 1
        this.freq = 440
        this.shape = 0
        this.phase = 0

        this.updateTable()

        this.port.onmessage = (event) => {
            if (event.data.type === "updateWave") {
                this.amplitude = event.data.amplitude
                this.shape = event.data.shape
                this.freq = 440 * (event.data.cycles / 3)
                this.updateTable()
            }
        }
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

    generateSound(channels, gain){
        const outputLength = channels[0].length
        const increment = this.freq * TABLE_SIZE / sampleRate

        for (let i=0; i < outputLength; i ++){
            //wavetable
            const base = Math.floor(this.phase)
            const i0 = base % TABLE_SIZE //lookup index in wavetable
            const i1 = (i0 + 1) % TABLE_SIZE
            const frac = this.phase - base
            const sample = this.table[i0] * (1-frac) + this.table[i1] * frac
            for (const channel of channels){
                channel[i] += sample * gain
            }
            this.phase += increment

            if (this.phase >= TABLE_SIZE){
                this.phase %= TABLE_SIZE
            }
        }
    }

    process(inputs, outputs) { //input is from previous node, should be empty for this; output is what the worklet needs manipulated into real data
        const channels = outputs[0]
        for (const channel of channels){
            channel.fill(0)
        }

        const gain = 0.2
        this.generateSound(channels, gain)

        return true
    }
}



registerProcessor("synth-audio-processor", SynthAudioProcessor)
registerProcessor("stepseq-audio-processor", StepSeqAudioProcessor)
registerProcessor("synthslides-audio-processor", SynthSlidesAudioProcessor)
registerProcessor("midi-audio-processor", MidiAudioProcessor)