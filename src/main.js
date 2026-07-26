import { Synth_Waveform } from "/src/synth_waveform.js"
import { meta_to_json, bin_to_array, append_id_logCount_to_array, plotUMAP, plotViolin} from "/src/plots.js"

// ---- add a bus for communication between plots ----
const bus = {
    _listeners: {},
    subscribe_to(event, id, fn){
        if (!this._listeners[event]) this._listeners[event] = {}
        this._listeners[event][id] = fn
    },
    execute_event(event, data) {
        Object.values(this._listeners[event] || {}).forEach(fn => fn(data))
    }
}

// ---- set up data ----
let count_umap_arr = await bin_to_array("/dat/count_umap.bin", "/dat/bin_meta.json")
let fft_umap_arr = await bin_to_array("/dat/fft_umap.bin", "/dat/bin_meta.json")
let min_max_arr = await bin_to_array("/dat/min_max_norm.bin", "/dat/bin_meta.json")
const min_max_meta = await meta_to_json("/dat/bin_meta.json","min_max_norm.bin")

const ids = min_max_meta.rownames
const logCount = min_max_arr.map((val, idx) => val.log_mean_count)

// Add the GeneID (id) + logCount field
count_umap_arr = append_id_logCount_to_array(count_umap_arr, ids, logCount)
fft_umap_arr = append_id_logCount_to_array(fft_umap_arr, ids, logCount)
min_max_arr = append_id_logCount_to_array(min_max_arr, ids, logCount)


// ---- Synth Waveform ----
// TODO: Fix and check if circle match data (I think currently wrong poitns are highlighted) ; make grey dots none interactive; Play Sample becomes playing a midi ; add keyboard piano ; adjust font size and point size ; make dynamic adjustable to screen size ; finalize color ; fix gene name display ; add display for selelcted gene (GeneID or sine/square/custom etc.) Add master volumn for page (or for app); avoid allowing play sample to be pressed multiple times; Resqueeze catmullrom data to -1,1 (interpolation can bend it past the extremes)
let node = null

const synth_waveform_canvas =
    document.getElementById(
        "Synth_Waveform"
    )

const synth_waveform =
    new Synth_Waveform(synth_waveform_canvas, bus, min_max_arr)

// setup synth_waveform_buttons
document.getElementById("reset").addEventListener("click", () => synth_waveform.reset())
document.getElementById("sine").addEventListener("click", () => synth_waveform.sine())
document.getElementById("square").addEventListener("click", () => synth_waveform.square())
document.getElementById("saw").addEventListener("click", () => synth_waveform.saw())
document.getElementById("triangle").addEventListener("click", () => synth_waveform.triangle())

// ---- Connect Audio Processor ----
const context = new AudioContext()

async function start() {
  await context.audioWorklet.addModule('/src/audio_processor.js')
  node = new AudioWorkletNode(context, 'synth-audio-processor')
  node.connect(context.destination)
  await context.resume()
  node.port.postMessage({type: "updatePoints", points: synth_waveform.points})
}

document.getElementById('play_sample').addEventListener('click', start)

// ---- Plot UMAPs ---- 
const count_svg = plotUMAP(600, 500, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
const fft_svg = plotUMAP(600, 500, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)
plotViolin(130, 500, min_max_arr, "filter_slider", bus)


// ---- main.js bus subscription ----
bus.subscribe_to("synth_waveform_changed", "main", points => {
    if (node) {
        node.port.postMessage({type: "updatePoints", points})
    }
})