import { Synth_Waveform } from "/src/synth_waveform.js"
import { plotUMAP } from "/src/plots.js"

let node = null

const synth_waveform_canvas =
    document.getElementById(
        "Synth_Waveform"
    )

const synth_waveform =
    new Synth_Waveform(synth_waveform_canvas, (points) => {
        if (node) {
            node.port.postMessage({type: "updatePoints", points: points})
        }
    })

// setup synth_waveform_buttons
document.getElementById("reset").addEventListener("click", () => synth_waveform.reset())
document.getElementById("sine").addEventListener("click", () => synth_waveform.sine())
document.getElementById("square").addEventListener("click", () => synth_waveform.square())
document.getElementById("saw").addEventListener("click", () => synth_waveform.saw())
document.getElementById("triangle").addEventListener("click", () => synth_waveform.triangle())

// Connect Audio Processor
const context = new AudioContext()

async function start() {
  await context.audioWorklet.addModule('/src/audio_processor.js')
  node = new AudioWorkletNode(context, 'audio-processor')
  node.connect(context.destination)
  await context.resume();
  node.port.postMessage({type: "updatePoints", points: synth_waveform.points})
}

document.getElementById('play_sample').addEventListener('click', start)

// Plot UMAPs
const countUMAP = await plotUMAP(
    "/dat/count_umap.bin", 
    "/dat/bin_meta.json",
    "read_counts",
    "UMAP of Counts over 48 hrs"
)

const fftUMAP = await plotUMAP(
    "/dat/fft_umap.bin", 
    "/dat/bin_meta.json",
    "fft",
    "UMAP of waveform FFT"
)