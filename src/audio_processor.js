import { interpolate_waveform } from "/src/catmullrom.js"
import { catmullrom } from "/src/catmullrom.js"

const TABLE_SIZE = 2048

class SynthAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.phases = new Map()
        this.table = new Float32Array(TABLE_SIZE)
        this.voices = new Map()
        this.octave = 0

        this.port.onmessage = (event) => {
            if (event.data.type === "updatePoints") {
                this.table = interpolate_waveform(event.data.points, TABLE_SIZE)
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
                this.voices.get(event.data.freq).state = "release"
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
        // let phase = this.phases.get(freq) ?? 0
        const increment = internal_freq * TABLE_SIZE / sampleRate // fraction of phase to move per sample
        
        const attackIncrement = 1 / (sampleRate * 0.005)
        const releaseIncrement = 1/ (sampleRate * 0.03)

        for (let i=0; i < outputLength; i ++){
            // envelope
            if (data.state === "attack"){
                data.lvl += attackIncrement
                if (data.lvl >= 1){
                    data.lvl = 1
                    data.state = "sustain"
                }
            }

            if (data.state === "release"){
                data.lvl -= releaseIncrement

                if (data.lvl <= 0){
                    data.lvl = 0
                    data.state = "finished"
                }
            }

            //wavetable
            const base = Math.floor(data.phase)
            const i0 = base % TABLE_SIZE //lookup index in wavetable
            const i1 = (i0 + 1) % TABLE_SIZE
            const frac = data.phase - base
            const sample = (this.table[i0] * (1-frac) + this.table[i1] * frac) * 2 - 1
            for (const channel of channels){
                channel[i] += sample * gain * data.lvl
            }
            data.phase += increment

            if (data.phase >= TABLE_SIZE){
                data.phase %= TABLE_SIZE
            }
        }
        // this.phases.set(freq, phase)
    }

    process(inputs, outputs) { //input is from previous node, should be empty for this; output is what the worklet needs manipulated into real data
        const channels = outputs[0]
        const bufferSize = channels[0].length
        const totalKeys = this.voices.size

        for (const channel of channels){
            channel.fill(0)
        }

        if (totalKeys === 0) {
            return true
        }

        const gain = 0.2 //1 / totalKeys

        for (const [freq, data] of this.voices){
            this.generateSound(freq, channels, gain, data)
            if (data.state === "finished"){
                this.voices.delete(freq)
            }
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
                for (let i=0; i<this.N_SAMPLES; i++){
                    this.audio_waves[i] = new Float32Array(
                        this.shared,
                        (base + this.N_GRID*i) * 4, //bytesperfloat
                        this.N_GRID
                    )
                }
                this.totalSamples = Math.floor(event.data.duration * sampleRate)
                this.fadeInSamples = Math.floor(event.data.duration * 0.10 * sampleRate) //10% fade in out for testing
                this.fadeOutSamples = Math.floor(event.data.duration * 0.10 * sampleRate)
                this.fadeOutStart = this.totalSamples - this.fadeOutSamples // start fading out before end
                this.sampleCount = 0
                this.active = true
            }
    }
}

    process(inputs, outputs) { //input is from previous node, should be empty for this; output is what the worklet needs manipulated into real data
        if (!this.active) return true

        const output = outputs[0]
        const left = output[0]
        const increment = this.freq * (this.N_GRID / sampleRate) 

        for (let i=0; i < left.length; i ++){
            const table_index = Math.floor(this.phase) % this.N_GRID

            //sweep
            const frac_sample = this.sampleCount / this.totalSamples
            const frame_pos = (this.N_SAMPLES - 1) * 0.5 * ( 1 - Math.cos(2*Math.PI*this.sweep*frac_sample))
            const f0 = Math.min(Math.floor(frame_pos), this.N_SAMPLES - 1)
            const f1 = Math.min(f0+1, this.N_SAMPLES -1)
            const wfrac = frame_pos - f0
            
            const sampleV0 = gatherCatmullrom(this.audio_waves[f0], this.phase, this.N_GRID)
            const sampleV1 = gatherCatmullrom(this.audio_waves[f1], this.phase, this.N_GRID)
            let sample = sampleV0 * (1-wfrac) + sampleV1 * wfrac

            //fade mixing (currently sample is the sound to output)
            if (this.sampleCount < this.fadeInSamples) {
                sample *= this.sampleCount / this.fadeInSamples
            }
            else if (this.sampleCount >= this.fadeOutStart) {
                sample *= (this.totalSamples - this.sampleCount) / this.fadeOutSamples
            }

            for (let ch=0; ch < output.length; ch++){
                output[ch][i] = sample
            }
            this.phase += increment
            this.sampleCount ++

            //self termiantes
            if (this.sampleCount >= this.totalSamples) {
                for (let ch=0; ch < output.length; ch++){
                    output[ch][i] = 0
                }
                this.active = false
                this.port.postMessage({type: 'ended'})
                break // instead of return false
            }
        }
        return true
    }
}

registerProcessor("synth-audio-processor", SynthAudioProcessor)
registerProcessor("stepseq-audio-processor", StepSeqAudioProcessor)