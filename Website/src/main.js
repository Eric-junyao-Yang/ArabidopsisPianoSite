import { Synth_Waveform } from "/src/synth_waveform.js"
import { plotUMAP } from "/src/plotUMAP.js"
import { load_waveforms, bin_to_array } from "/src/binHelper.js"
import { plotViolin } from "/src/plotViolin.js"
import { plotStepSeqMain, plotStepSeqWave } from "/src/step_sequencer.js"
import { SlidesTemplate } from "/src/slideTemplate.js"
import { synthSlides } from "/src/synthSlides.js"
import { plotGene } from "/src/gene_plots.js"
import { setupHelpPopUps } from "/src/helpPopup.js"
import { setupVirtualPiano, assign_keyboard_keys } from "/src/virtualPiano.js"

// ---- add a bus for communication between modules ----
const bus = {
    _listeners: {},
    subscribe_to(event, id, fn) {
        if (!this._listeners[event]) this._listeners[event] = {}
        this._listeners[event][id] = fn
    },
    execute_event(event, data) {
        Object.values(this._listeners[event] || {}).forEach((fn) => fn(data))
    },
}

// --------------------------------------- load data ---------------------------------------
// UMAP bins are x/y only (same gene order as Normalized_counts / VST).
const count_arr = await bin_to_array("/dat/Normalized_counts.bin", "/dat/bin_meta.json")
const VST_arr = await bin_to_array("/dat/VST.bin", "/dat/bin_meta.json")
const count_umap_arr = await bin_to_array("/dat/count_umap.bin", "/dat/bin_meta.json")
const fft_umap_arr = await bin_to_array("/dat/fft_umap.bin", "/dat/bin_meta.json")

if (
    count_arr.length !== count_umap_arr.length ||
    count_arr.length !== fft_umap_arr.length ||
    count_arr.length !== VST_arr.length
) {
    throw new Error("Row-count mismatch among Normalized_counts / VST / UMAP bins")
}

for (let i = 0; i < count_arr.length; i++) {
    const GeneID = count_arr[i].GeneID
    const log_TPM = count_arr[i].log_TPM
    count_umap_arr[i].GeneID = GeneID
    count_umap_arr[i].id = GeneID
    count_umap_arr[i].log_TPM = log_TPM
    fft_umap_arr[i].GeneID = GeneID
    fft_umap_arr[i].id = GeneID
    fft_umap_arr[i].log_TPM = log_TPM
}

const [metaValues, osc_perGene_meta, shared, osc_perGene_mu, osc_perGene_std] =
    await load_waveforms("/dat/waveforms.bin", "/dat/bin_meta.json")

const normalized_counts_lookup = new Map(count_arr.map((val) => [val.GeneID, val]))
const VST_lookup = new Map(VST_arr.map((val) => [val.GeneID, val]))

// --------------------------------------- Synth waveform ---------------------------------------
const synth_waveform_canvas = document.getElementById("Synth_Waveform")
const synth_waveform = new Synth_Waveform(synth_waveform_canvas, bus, count_arr)

document.getElementById("reset").addEventListener("click", () => synth_waveform.reset())
document.getElementById("sine").addEventListener("click", () => synth_waveform.sine())
document.getElementById("square").addEventListener("click", () => synth_waveform.square())
document.getElementById("saw").addEventListener("click", () => synth_waveform.saw())
document.getElementById("triangle").addEventListener("click", () => synth_waveform.triangle())
document.getElementById("activate").addEventListener("click", start)

// Step sequencer transport
const playPauseButton = document.getElementById("SeqPlayPause")
let isPlay = false
playPauseButton.addEventListener("click", async () => {
    await initStepSeqAudio()
    isPlay = !isPlay
    playPauseButton.textContent = isPlay ? "Pause" : "Play"
    bus.execute_event("seqPlayPause", isPlay)
})
document.getElementById("SeqStop").addEventListener("click", () => {
    isPlay = false
    playPauseButton.textContent = "Play"
    bus.execute_event("seqStop", null)
})
document.getElementById("SeqReset").addEventListener("click", () => {
    bus.execute_event("resetSelection", null)
})

// --------------------------------------- Audio ---------------------------------------
let SynthContext = null
let synth_node = null
async function start() {
    if (SynthContext) return
    SynthContext = new AudioContext()
    await SynthContext.audioWorklet.addModule("/src/audio_processor.js")
    synth_node = new AudioWorkletNode(SynthContext, "synth-audio-processor")

    const compressor = SynthContext.createDynamicsCompressor()
    compressor.threshold.value = -3
    compressor.knee.value = 0
    compressor.ratio.value = 20
    compressor.attack.value = 0.003
    compressor.release.value = 0.05
    synth_node.connect(compressor).connect(SynthContext.destination)
    await SynthContext.resume()
    synth_node.port.postMessage({ type: "updatePoints", points: synth_waveform.points })
    assign_keyboard_keys(synth_node)
    setupVirtualPiano(synth_node, document.getElementById("Synth_Keyboard_div"))
}

// Step Seq
const activeVoices = new Map()
let stepSeqAudioContext = null
let masterCompressor = null
async function initStepSeqAudio() {
    if (stepSeqAudioContext) return
    stepSeqAudioContext = new AudioContext()
    await stepSeqAudioContext.audioWorklet.addModule("/src/audio_processor.js")
    await stepSeqAudioContext.resume()
    masterCompressor = stepSeqAudioContext.createDynamicsCompressor()
    masterCompressor.threshold.value = -6
    masterCompressor.knee.value = 3
    masterCompressor.ratio.value = 4
    masterCompressor.attack.value = 0.003
    masterCompressor.release.value = 0.15
    masterCompressor.connect(stepSeqAudioContext.destination)
}

// SynthSlides
let synthSlidesAudioContext = null
let synthSlides_node = null
let synthSlideDestinationConnection = false
async function initSynthSlidesAudio() {
    if (synthSlidesAudioContext) return
    synthSlidesAudioContext = new AudioContext()
    await synthSlidesAudioContext.audioWorklet.addModule("/src/audio_processor.js")
    await synthSlidesAudioContext.resume()
    synthSlides_node = new AudioWorkletNode(synthSlidesAudioContext, "synthslides-audio-processor")
    synthSlides_node.connect(synthSlidesAudioContext.destination)
    synthSlideDestinationConnection = true
}

// existing sounds needs to be scaled as new sounds join
function rescaleGains() {
    const n = activeVoices.size
    const g = n > 1 ? 1 / Math.sqrt(n) : 0.8
    activeVoices.forEach((gain) => {
        gain.gain.value = g
    })
}

// --------------------------------------- Spawn voices ---------------------------------------
function createVoice(metaValues, sharedBuffer) {
    const node = new AudioWorkletNode(stepSeqAudioContext, "stepseq-audio-processor", {
        processorOptions: { metaValues, shared: sharedBuffer },
    })
    const gain = stepSeqAudioContext.createGain()
    gain.gain.value = 0
    node.connect(gain)
    gain.connect(masterCompressor)
    activeVoices.set(node, gain)
    rescaleGains()

    node.port.onmessage = (e) => {
        if (e.data.type === "ended") {
            node.disconnect()
            gain.disconnect()
            activeVoices.delete(node)
            rescaleGains()
        }
    }
    return node
}

// --------------------------------------- StepSquencer ---------------------------------------
// min-max scale qval. Map qval to sweep_frequency.
const qvals = osc_perGene_meta.map((d) => d.qval)
const qval_min = Math.min(...qvals)
const qval_max = Math.max(...qvals)
const qval_span = qval_max - qval_min || 1
const sweep_max = 5
const sweep_min = 1
for (let i = 0; i < osc_perGene_meta.length; i++) {
    osc_perGene_meta[i].sweep_frequency =
        0.2 + ((qvals[i] - qval_min) * (sweep_max - sweep_min)) / qval_span
    osc_perGene_meta[i].index = i
}

const osc_perGene_meta_lookup = new Map(osc_perGene_meta.map((v) => [v.GeneID, v]))

export function renderSelectionPanel(selected_genes) {
    const panel = document.getElementById("SeqRightSelectedGeneDisplay")
    panel.innerHTML = ""

    for (const item of selected_genes) {
        const GeneID = item.GeneID
        const tag = document.createElement("div")
        tag.className = "gene-tag"

        const label = document.createElement("span")
        label.className = "gene-tag-label"
        label.textContent = GeneID
        label.addEventListener("click", () => {
            bus.execute_event("gene_label_select", GeneID)
        })

        const remove = document.createElement("button")
        remove.className = "gene-tag-remove"
        remove.textContent = "×"
        remove.addEventListener("click", (event) => {
            bus.execute_event("selection_del", item)
            event.stopPropagation()
        })

        tag.appendChild(label)
        tag.appendChild(remove)
        panel.appendChild(tag)
    }
}

// --------------------------------------- Plots ---------------------------------------
plotUMAP(600, 500, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
plotUMAP(600, 500, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)

plotViolin(
    130, 500, { top: 20, right: 20, bottom: 20, left: 50 },
    count_arr.map((v) => v.log_TPM),
    d3.select("#filter_slider"), "log10(mean TPM)", bus, "synth_TPM_filter"
)

plotStepSeqMain(1200, 800, "#SeqLeft", osc_perGene_meta, osc_perGene_meta_lookup, metaValues, bus)
const plotStepSeq = plotStepSeqWave(600, 400, "#SeqRightPlot")

const violinOpts = { top: 20, right: 20, bottom: 20, left: 50 }
plotViolin(
    130, 500, violinOpts,
    osc_perGene_meta.map((v) => v.log_TPM),
    d3.select("#violin-TPM"), "log10(mean TPM)", bus, "StepSeqTPMUpdate"
)
plotViolin(
    130, 500, violinOpts,
    osc_perGene_meta.map((v) => v.qval),
    d3.select("#violin-qVal"), "q-value", bus, "StepSeqqValUpdate"
)
plotViolin(
    130, 500, violinOpts,
    osc_perGene_meta.map((v) => v.relative_std),
    d3.select("#violin-Std"), "relative std", bus, "StepSeqStdUpdate"
)

setupHelpPopUps(document, window)

// --------------------------------------- Slides ---------------------------------------
const synthSlides_div = document.getElementById("SynthSlides")
const synthSlides_leftBtn = document.getElementById("SynthSlides-left-btn")
const synthSlides_rightBtn = document.getElementById("SynthSlides-right-btn")
const synthSlides_text = document.getElementById("SynthText")
synthSlides.updateData(normalized_counts_lookup.get("AT5G61380"))
synthSlides.connectBus(bus)
synthSlides.setInternalInitAudio(initSynthSlidesAudio)
new SlidesTemplate(
    synthSlides_div,
    synthSlides_text,
    synthSlides_leftBtn,
    synthSlides_rightBtn,
    synthSlides
)

const step_seq_plot_div = document.getElementById("Gene_Plots")
const introSvg = d3.select(step_seq_plot_div).append("svg").attr("width", 800).attr("height", 300)
const TOC1 = normalized_counts_lookup.get("AT5G61380")
const PP2AA3 = normalized_counts_lookup.get("AT1G13320")
if (TOC1 && PP2AA3) {
    plotGene(introSvg, [PP2AA3, TOC1], ["PP2AA3", "TOC1"])
}

// --------------------------------------- Bus subscriptions ---------------------------------------
bus.subscribe_to("synth_waveform_changed", "main", (points) => {
    if (synth_node) {
        synth_node.port.postMessage({ type: "updatePoints", points })
    }
})

bus.subscribe_to("playNote", "main", ([mv, GeneID, Index, freq, sweep]) => {
    const node = createVoice(mv, shared)
    node.port.postMessage({
        type: "geneSpecifics",
        GeneID,
        Index,
        freq,
        sweep,
        duration: 1,
    })
})

bus.subscribe_to("selection_modified", "main", (selection) => {
    renderSelectionPanel(selection)
})

bus.subscribe_to("gene_label_select", "main", (GeneID) => {
    const meta_item = osc_perGene_meta_lookup.get(GeneID)
    const VST_dat = VST_lookup.get(GeneID)
    if (!meta_item || !VST_dat) return
    plotStepSeq.updatePlot({
        metaValues,
        shared,
        cur_mu: osc_perGene_mu[meta_item.index],
        cur_std: osc_perGene_std[meta_item.index],
        meta_item,
        VST_dat,
    })
})

bus.subscribe_to("resetSelection", "main", () => {
    plotStepSeq.renderEmpty()
})

bus.subscribe_to("updateParams", "main", (params) => {
    if (!synthSlides_node) return
    if (!synthSlideDestinationConnection) {
        synthSlides_node.connect(synthSlidesAudioContext.destination)
        synthSlideDestinationConnection = true
    }
    synthSlides_node.port.postMessage({
        type: "updateWave",
        amplitude: params.amplitude,
        shape: params.shape,
        cycles: params.cycles,
    })
})

bus.subscribe_to("stopSlideSound", "main", () => {
    if (synthSlides_node && synthSlideDestinationConnection) {
        synthSlides_node.disconnect(synthSlidesAudioContext.destination)
        synthSlideDestinationConnection = false
    }
})




// TODO: Play Sample becomes playing a midi ; adjust font size and point size ; make dynamic adjustable to screen size ; finalize color ; fix gene name display ; add display for selelcted gene (GeneID or sine/square/custom etc.) Add master volumn for page (or for app); avoid allowing play sample to be pressed multiple times; Resqueeze catmullrom data to -1,1 (interpolation can bend it past the extremes); Change the Synth play button audiocontext handling; May allow mapping of volume to log expression