import { interpolate_waveform } from "/src/catmullrom.js"

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
        const left = output[0]
        const increment = this.freq * TABLE_SIZE / sampleRate

        for (let i=0; i < left.length; i ++){
            const index = Math.floor(this.phase) % TABLE_SIZE
            left[i] = Math.sin(this.table[index] * 2 - 1)
            this.phase += increment
        }
        return true
    }
}

registerProcessor("synth-audio-processor", SynthAudioProcessor)