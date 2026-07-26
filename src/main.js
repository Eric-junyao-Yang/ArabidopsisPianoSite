import { Synth_Waveform } from "/src/synth_waveform.js"
import { meta_to_json, bin_to_array, append_id_logCount_to_array, plotUMAP, plotViolin} from "/src/plots.js"
import { load_waveforms, plotMain, renderSelectionPanel } from "/src/step_sequencer.js"

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


// ----------- handle button presses -----------
// setup synth_waveform_buttons
document.getElementById("reset").addEventListener("click", () => synth_waveform.reset())
document.getElementById("sine").addEventListener("click", () => synth_waveform.sine())
document.getElementById("square").addEventListener("click", () => synth_waveform.square())
document.getElementById("saw").addEventListener("click", () => synth_waveform.saw())
document.getElementById("triangle").addEventListener("click", () => synth_waveform.triangle())
document.getElementById('play_sample').addEventListener('click', start)

// Step sequencer buttons
const playPauseButton = document.getElementById("SeqPlayPause")
let isPlay = false
playPauseButton.addEventListener('click', async () => {
    await initStepSeqAudio() //init on first click, then ignore for subsequent
    isPlay = !isPlay
    if (isPlay) {playPauseButton.textContent = "Pause"}
    else {playPauseButton.textContent = "Play"}
    bus.execute_event("seqPlayPause", isPlay)
}) 
document.getElementById("SeqStop").addEventListener('click', () => {
    isPlay = false
    playPauseButton.textContent = "Play"
    bus.execute_event("seqStop", null)}
)


// ---- Connect Audio Processor ----
// Synth
const context = new AudioContext()

async function start() {
  await context.audioWorklet.addModule('/src/audio_processor.js')
  node = new AudioWorkletNode(context, 'synth-audio-processor')
  node.connect(context.destination)
  await context.resume()
  node.port.postMessage({type: "updatePoints", points: synth_waveform.points})
}

// Step Seq
const activeVoices = new Set()
let stepSeqAudioContext = null
async function initStepSeqAudio() {
    if (stepSeqAudioContext) return
    stepSeqAudioContext = new AudioContext()
    await stepSeqAudioContext.audioWorklet.addModule('/src/audio_processor.js')
    await stepSeqAudioContext.resume()
}

// --------- Spawn voices -----------
function createVoice(metaValues, shared){
    const node = new AudioWorkletNode(stepSeqAudioContext, 'stepseq-audio-processor', {
        processorOptions: {
            metaValues: metaValues,
            shared: shared,
        }
    })
    activeVoices.add(node)

    // gain
    const gain = stepSeqAudioContext.createGain()
    const n = activeVoices.size
    gain.gain.value = n > 0 ? 1 / Math.sqrt(n) : 0.8

    node.connect(gain)
    gain.connect(stepSeqAudioContext.destination)
    // node.connect(stepSeqAudioContext.destination)

    // terminate node
    node.port.onmessage = e=>{
        if (e.data.type === 'ended'){
            node.disconnect()
            gain.disconnect()
            activeVoices.delete(node)
        }
    }
    return node
}

// ---- StepSquencer ----
const [metaValues, meta, shared, mu, std] = await load_waveforms("/dat/waveforms.bin", "/dat/waveforms_meta.json")
const period_phase_fap = meta.meta

//min-max norm fap then scale to 1 ~ 10
const fap = period_phase_fap.map(d => d.fap)
const fap_min = Math.min(...fap)
const fap_max = Math.max(...fap)
const sweep_max = 5
const sweep_min = 1
for (let i=0; i<fap.length; i++){
    period_phase_fap[i]['sweep_frequency'] = 0.2 + (fap[i] - fap_min) * (sweep_max - sweep_min)/(fap_max - fap_min)
    period_phase_fap[i]['index'] = i
}

//lookup tables
const period_phase_fap_lookup = new Map(period_phase_fap.map(r => [r.GeneID, r]))




// ---- Plotting Functions ---- 
// Synth
const count_svg = plotUMAP(600, 500, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
const fft_svg = plotUMAP(600, 500, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)
plotViolin(130, 500, min_max_arr, "filter_slider", bus)

// StepSeq
plotMain(600, 400, "#StepSequencer", period_phase_fap, period_phase_fap_lookup, metaValues, bus)

// ---- main.js bus subscription ----
bus.subscribe_to("synth_waveform_changed", "main", points => {
    if (node) {
        node.port.postMessage({type: "updatePoints", points})
    }
})

bus.subscribe_to("playNote", "main", ([metaValues, GeneID, Index, freq, sweep]) =>{
    const node = createVoice(metaValues, shared)
    node.port.postMessage({
        type: "geneSpecifics",
        GeneID: GeneID,
        Index: Index,
        freq: freq,
        sweep: sweep,
        duration: 1, //s  maybe let user adjust this
    })
})

bus.subscribe_to("selection_modified", "main", (selection) => {
    renderSelectionPanel(selection)
})