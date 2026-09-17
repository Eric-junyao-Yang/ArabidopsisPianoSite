import { Synth_Waveform, assign_keyboard_keys } from "/src/synth_waveform.js"
import { meta_to_json, bin_to_array, append_id_logCount_to_array, plotUMAP, plotViolin} from "/src/plots.js"
import { load_waveforms, plotMain, plotStepSeqWave } from "/src/step_sequencer.js"
import { SlidesTemplate, slides } from "/src/slides.js"
import { setupHelpPopUps } from "/src/helpPopup.js"

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
let normalized_filtered_arr = await bin_to_array("/dat/normalized_filtered.bin", "/dat/bin_meta.json")
const min_max_meta = await meta_to_json("/dat/bin_meta.json","min_max_norm.bin")

const ids = min_max_meta.rownames
const logCount = min_max_arr.map((val, idx) => val.log_mean_count)

// Add the GeneID (id) + logCount field
count_umap_arr = append_id_logCount_to_array(count_umap_arr, ids, logCount)
fft_umap_arr = append_id_logCount_to_array(fft_umap_arr, ids, logCount)
min_max_arr = append_id_logCount_to_array(min_max_arr, ids, logCount)
normalized_filtered_arr = append_id_logCount_to_array(normalized_filtered_arr, ids, logCount)
const normalized_filtered_lookup = new Map(normalized_filtered_arr.map((val, idx) => [ids[idx], val]))


// ---- Synth Waveform ----
// TODO: make grey dots none interactive; Play Sample becomes playing a midi ; add keyboard piano ; adjust font size and point size ; make dynamic adjustable to screen size ; finalize color ; fix gene name display ; add display for selelcted gene (GeneID or sine/square/custom etc.) Add master volumn for page (or for app); avoid allowing play sample to be pressed multiple times; Resqueeze catmullrom data to -1,1 (interpolation can bend it past the extremes); Change the Synth play button audiocontext handling; Add a piano to allow click and play instead of keyboard interaction, keyboard highlights virtual keybord.
let synth_node = null

const synth_waveform_canvas =
    document.getElementById(
        "Synth_Waveform"
    )

const synth_waveform =
    new Synth_Waveform(synth_waveform_canvas, bus, min_max_arr)

// Virtual Piano


// --------------------------------- handle button presses ---------------------------------
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
document.getElementById("SeqReset").addEventListener('click', () => {
    bus.execute_event("resetSelection", null)
})

// --------------------------------- Connect Audio Processor ---------------------------------
// Synth
let SynthContext = null

async function start() {
    if (SynthContext) return
    SynthContext = new AudioContext()
    await SynthContext.audioWorklet.addModule('/src/audio_processor.js')
    synth_node = new AudioWorkletNode(SynthContext, 'synth-audio-processor') //, {outputChannelCount: [2]} //checking stereo
    
    const compressor = SynthContext.createDynamicsCompressor()
    compressor.threshold.value = -3
    compressor.knee.value = 0
    compressor.ratio.value = 20
    compressor.attack.value = 0.003
    compressor.release.value = 0.05
    synth_node.connect(compressor).connect(SynthContext.destination)
    await SynthContext.resume()
    synth_node.port.postMessage({type: "updatePoints", points: synth_waveform.points})
    assign_keyboard_keys(synth_node)
}

// Step Seq
const activeVoices = new Map()
let stepSeqAudioContext = null
let masterCompressor = null
async function initStepSeqAudio() {
    if (stepSeqAudioContext) return
    stepSeqAudioContext = new AudioContext()
    await stepSeqAudioContext.audioWorklet.addModule('/src/audio_processor.js')
    await stepSeqAudioContext.resume()
    masterCompressor = stepSeqAudioContext.createDynamicsCompressor()
    masterCompressor.threshold.value = -6   // start compressing at this dB
    masterCompressor.knee.value      = 3    // 3~10 is natural ?
    masterCompressor.ratio.value     = 4    // 4:1 compression ratio
    masterCompressor.attack.value    = 0.003 // 3ms
    masterCompressor.release.value   = 0.15  // 150ms
    masterCompressor.connect(stepSeqAudioContext.destination)
}

// SynthSlides
let synthSlidesAudioContext = null
let synthSlides_node = null
let synthSlideDestinationConnection = false
async function initSynthSlidesAudio() {
    if (synthSlidesAudioContext) return
    synthSlidesAudioContext = new AudioContext()
    await synthSlidesAudioContext.audioWorklet.addModule('/src/audio_processor.js')
    await synthSlidesAudioContext.resume()
    synthSlides_node = new AudioWorkletNode(synthSlidesAudioContext, 'synthslides-audio-processor')
    synthSlides_node.connect(synthSlidesAudioContext.destination)
    synthSlideDestinationConnection = true
}

// --------- existing sounds needs to be scaled as new sounds join --------
function rescaleGains() {
    const n = activeVoices.size
    const g = n > 1 ? 1 / Math.sqrt(n) : 0.8
    activeVoices.forEach((gain, node) => gain.gain.value = g)
}

// --------- Spawn voices -----------
function createVoice(metaValues, shared){
    const node = new AudioWorkletNode(stepSeqAudioContext, 'stepseq-audio-processor', {
        processorOptions: {
            metaValues: metaValues,
            shared: shared,
        }
    })
    const gain = stepSeqAudioContext.createGain()
    gain.gain.value = 0
    node.connect(gain)
    gain.connect(masterCompressor)
    activeVoices.set(node, gain)
    rescaleGains()

    // terminate node
    node.port.onmessage = e=>{
        if (e.data.type === 'ended'){
            node.disconnect()
            gain.disconnect()
            activeVoices.delete(node)
            rescaleGains()
        }
    }
    return node
}

// --------------------------------------- StepSquencer ---------------------------------------
// TODO: investigate sampled wave vs mean/std mismatch
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

// --------- gene selection display ---------
export function renderSelectionPanel(selected_genes){
    const panel = document.getElementById("SeqRightSelectedGeneDisplay")
    panel.innerHTML = ''

    for (const item of selected_genes){
        const GeneID = item.GeneID
        const tag = document.createElement('div')
        tag.className = 'gene-tag'

        const label = document.createElement('span')
        label.className = 'gene-tag-label'
        label.textContent = GeneID
        label.addEventListener('click', (event) => {
            bus.execute_event("gene_label_select", GeneID)
        })

        const remove = document.createElement('button')
        remove.className = 'gene-tag-remove'
        remove.textContent = "×"
        remove.addEventListener('click', (event) => {
            bus.execute_event("selection_del", item)
            event.stopPropagation()
        })

        tag.appendChild(label)
        tag.appendChild(remove)
        panel.appendChild(tag)
    }
}

// --------------------------------------- Plotting Functions --------------------------------------- 
// Synth
const count_svg = plotUMAP(600, 500, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
const fft_svg = plotUMAP(600, 500, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)
plotViolin(130, 500, min_max_arr, "filter_slider", bus)

// StepSeq
plotMain(1200, 800, "#StepSequencer", period_phase_fap, period_phase_fap_lookup, metaValues, bus)
const plotStepSeq = plotStepSeqWave(600, 400, "#SeqRightPlot")


// --------------------------------------- Help PopUps ---------------------------------------
setupHelpPopUps(document, window)




// --------------------------------------- Slides ---------------------------------------
const synthSlides = document.getElementById("SynthSlides")
const synthSlides_leftBtn = document.getElementById("SynthSlides-left-btn")
const synthSlides_rightBtn = document.getElementById("SynthSlides-right-btn")
const synthSlides_text = document.getElementById("SynthText")
slides.updateData(normalized_filtered_lookup.get("AT5G61380"))
slides.connectBus(bus)
slides.setInternalInitAudio(initSynthSlidesAudio)
const buildSynthSlides = new SlidesTemplate(synthSlides, synthSlides_text, synthSlides_leftBtn, synthSlides_rightBtn, slides)














// --------------------------------- main.js bus subscriptions ---------------------------------
bus.subscribe_to("synth_waveform_changed", "main", points => {
    if (synth_node) {
        synth_node.port.postMessage({type: "updatePoints", points})
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

bus.subscribe_to("gene_label_select", "main", (GeneID) => {
    const meta_item = period_phase_fap_lookup.get(GeneID)
    const count_dat = normalized_filtered_lookup.get(GeneID)
    const cur_mu = mu[meta_item.index]
    const cur_std = std[meta_item.index]
    plotStepSeq.updatePlot({ metaValues, period_phase_fap, shared, cur_mu, cur_std, meta_item, count_dat })
})

bus.subscribe_to("resetSelection", "main", ()=>{
    plotStepSeq.renderEmpty()
})

bus.subscribe_to("updateParams", "main", (params) => {
    if (!synthSlideDestinationConnection){
        synthSlides_node.connect(synthSlidesAudioContext.destination)
        synthSlideDestinationConnection = true
    }
    if (synthSlides_node) {
        synthSlides_node.port.postMessage({
        type: "updateWave",
        amplitude: params.amplitude,
        shape: params.shape,
        cycles: params.cycles
        })
    }
})

bus.subscribe_to("stopSlideSound", "main", () => {
    if (synthSlides_node && synthSlideDestinationConnection) {
        synthSlides_node.disconnect(synthSlidesAudioContext.destination)
        synthSlideDestinationConnection = false
    }
})