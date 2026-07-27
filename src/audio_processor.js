import { interpolate_waveform } from "/src/catmullrom.js"
import { catmullrom } from "/src/catmullrom.js"

const TABLE_SIZE = 2048

class SynthAudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super()
        this.phase = 0
        this.freq = 440
        this.table = new Array(TABLE_SIZE).fill(0)

        this.port.onmessage = (event) => {
            if (event.data.type === "updatePoints") {
                this.table = interpolate_waveform(event.data.points, TABLE_SIZE)
            }
        }
    }

    process(inputs, outputs) { //input is from previous node, should be empty for this; output is what the worklet needs manipulated into real data
        const output = outputs[0]
        const increment = this.freq * TABLE_SIZE / sampleRate // fraction of phase to move per sample

        for (let i=0; i < output[0].length; i ++){
            const i0 = Math.floor(this.phase) % TABLE_SIZE //lookup index in wavetable
            const i1 = (i0 + 1) % TABLE_SIZE
            const frac = this.phase - Math.floor(this.phase)
            const sample = (this.table[i0] * (1-frac) + this.table[i1] * frac) * 2 - 1
            
            for (let ch=0; ch<output.length; ch++){
                output[ch][i] = sample
            }
            this.phase += increment
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