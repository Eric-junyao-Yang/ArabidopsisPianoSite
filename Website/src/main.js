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
import { searchbar } from "/src/searchbar.js"
import { initGlobalAudio } from "/src/globalVolumeControl.js"
import {
    loadMidiEvents,
    createMidiTransport,
    geneToWavetable,
    setTrackWavetable,
} from "/src/midiplayer.js"

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

// ---- one shared AudioContext + master volume for the whole page ----
// Context is created now and auto-resumes on the first user gesture (see globalVolumeControl.js).
const globalAudio = initGlobalAudio({ workletUrl: "/src/audio_processor.js" })

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

// --------------------------------------- MidiPlayer ---------------------------------------
const MIDI_TRACKS = [
    { id: "vocal", label: "Vocal", trackIndex: 0 },
    { id: "synth1", label: "Synth1", trackIndex: 1 },
    { id: "synth2", label: "Synth2", trackIndex: 2 },
    { id: "bass", label: "Bass", trackIndex: 3 },
    { id: "brass", label: "Brass", trackIndex: 4 },
]
const MIDI_FILE = "/dat/NGGYU.mid"
let midiEvents = null
let midiTransport = null
const midiTrackGenes = new Map() // trackIndex → GeneID

function syncMidiTrackWavetables() {
    for (const [trackIndex, GeneID] of midiTrackGenes) {
        const waveform = geneToWavetable(GeneID, normalized_counts_lookup)
        if (waveform && midiNode) setTrackWavetable(midiNode, trackIndex, waveform)
    }
}

let midiLoadPromise = null
async function ensureMidiLoaded() {
    await initMidiAudio()
    if (!midiEvents) {
        if (!midiLoadPromise) {
            midiLoadPromise = loadMidiEvents(MIDI_FILE, MIDI_TRACKS.length)
                .then((loaded) => {
                    midiEvents = loaded.events
                    midiTransport.setEvents(midiEvents)
                    // Genes chosen before the worklet existed still need uploading
                    syncMidiTrackWavetables()
                })
                .catch((err) => {
                    midiLoadPromise = null
                    throw err
                })
        }
        await midiLoadPromise
    }
}

document.getElementById("play").addEventListener("click", async () => {
    await ensureMidiLoaded()
    if (midiTransport.isPlaying) {
        midiTransport.stop()
        document.getElementById("play").textContent = "play"
    } else {
        midiTransport.play()
        document.getElementById("play").textContent = "stop"
    }
})

// --------------------------------------- Audio ---------------------------------------
// All sources share globalAudio.ctx and feed globalAudio.input (master volume lives there).
// Each init* is idempotent and awaits the shared worklet module; autoplay unlock is handled
// by globalAudio itself
async function sharedContext() {
    const ctx = await globalAudio.ready
    await globalAudio.resume()
    return ctx
}

// Synth (virtual piano + computer keyboard): built at page load, no activate button needed.
let SynthContext = null
let synth_node = null
const synthReady = (async () => {
    SynthContext = await globalAudio.ready
    synth_node = new AudioWorkletNode(SynthContext, "synth-audio-processor")

    const compressor = SynthContext.createDynamicsCompressor()
    compressor.threshold.value = -3
    compressor.knee.value = 0
    compressor.ratio.value = 20
    compressor.attack.value = 0.003
    compressor.release.value = 0.05
    synth_node.connect(compressor).connect(globalAudio.input)
    synth_node.port.postMessage({ type: "updatePoints", points: synth_waveform.points })
    assign_keyboard_keys(synth_node)
    setupVirtualPiano(synth_node, document.getElementById("Synth_Keyboard_div"))
})().catch((err) => {
    console.error("Synth audio setup failed", err)
})

// Step Seq
const activeVoices = new Map()
let stepSeqAudioContext = null
let masterCompressor = null
let stepSeqReady = null
async function initStepSeqAudio() {
    if (!stepSeqReady) {
        stepSeqReady = (async () => {
            stepSeqAudioContext = await sharedContext()
            masterCompressor = stepSeqAudioContext.createDynamicsCompressor()
            masterCompressor.threshold.value = -6
            masterCompressor.knee.value = 3
            masterCompressor.ratio.value = 4
            masterCompressor.attack.value = 0.003
            masterCompressor.release.value = 0.15
            masterCompressor.connect(globalAudio.input)
        })().catch((err) => {
            stepSeqReady = null
            throw err
        })
    }
    await stepSeqReady
    await globalAudio.resume()
}

// SynthSlides
let synthSlidesAudioContext = null
let synthSlides_node = null
let synthSlideDestinationConnection = false
let synthSlidesReady = null
async function initSynthSlidesAudio() {
    if (!synthSlidesReady) {
        synthSlidesReady = (async () => {
            synthSlidesAudioContext = await sharedContext()
            synthSlides_node = new AudioWorkletNode(synthSlidesAudioContext, "synthslides-audio-processor")
            synthSlides_node.connect(globalAudio.input)
            synthSlideDestinationConnection = true
        })().catch((err) => {
            synthSlidesReady = null
            throw err
        })
    }
    await synthSlidesReady
    await globalAudio.resume()
}

// existing sounds needs to be scaled as new sounds join
function rescaleGains() {
    const n = activeVoices.size
    const g = n > 1 ? 1 / Math.sqrt(n) : 0.8
    activeVoices.forEach((gain) => {
        gain.gain.value = g
    })
}

// Midi Player
let midiCtx = null
let midiNode = null
let midiReady = null
async function initMidiAudio() {
    if (!midiReady) {
        midiReady = (async () => {
            midiCtx = await sharedContext()
            midiNode = new AudioWorkletNode(midiCtx, "midi-audio-processor")
            midiNode.connect(globalAudio.input)
            midiTransport = createMidiTransport(midiCtx, midiNode, {
                onStop: () => {
                    const btn = document.getElementById("play")
                    if (btn) btn.textContent = "play"
                },
            })
            if (midiEvents) midiTransport.setEvents(midiEvents)
        })().catch((err) => {
            midiReady = null
            throw err
        })
    }
    await midiReady
    await globalAudio.resume()
}

// --------------------------------------- Spawn voices ---------------------------------------
function createVoice(metaValues, sharedBuffer) {
    if (!stepSeqAudioContext || !masterCompressor) return null
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
    // Higher qval (less confident period) → faster morph across posterior samples
    osc_perGene_meta[i].sweep_frequency =
        sweep_min + ((qvals[i] - qval_min) * (sweep_max - sweep_min)) / qval_span
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
            bus.execute_event("gene_label_select", item)
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

plotStepSeqMain(1800, 1200, "#SeqLeft", osc_perGene_meta, osc_perGene_meta_lookup, metaValues, bus)
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
// viewBox keeps the 800x300 layout but lets the figure scale down on narrow screens
const introSvg = d3.select(step_seq_plot_div).append("svg")
    .attr("viewBox", "0 0 800 300")
    .attr("preserveAspectRatio", "xMidYMid meet")
    .style("width", "100%")
    .style("height", "auto")
const TOC1 = normalized_counts_lookup.get("AT5G61380")
const PP2AA3 = normalized_counts_lookup.get("AT1G13320")
if (TOC1 && PP2AA3) {
    plotGene(introSvg, [PP2AA3, TOC1], ["PP2AA3", "TOC1"])
}

// --------------------------------------- Search Bars ---------------------------------------
searchbar(
    document.querySelector("#stepseq-search"),
    document.querySelector("#stepseq-results"),
    osc_perGene_meta,
    (item) => {
        bus.execute_event("selection_add", item)
        bus.execute_event("gene_label_select", item)
    }
)
searchbar(
    document.querySelector("#synth-search"),
    document.querySelector("#synth-results"),
    count_arr,
    (item) => {
        bus.execute_event("point_select", item.GeneID)
    }
)

// MIDI track gene search → bus → wavetable (0-based trackIndex matches MIDI file tracks)
for (const track of MIDI_TRACKS) {
    const nameEl = document.getElementById(`midi-${track.id}-gene-name`)
    searchbar(
        document.querySelector(`#midi-${track.id}-search`),
        document.querySelector(`#midi-${track.id}-results`),
        count_arr,
        (item) => {
            bus.execute_event("midi_track_gene", {
                trackIndex: track.trackIndex,
                GeneID: item.GeneID,
            })
            if (nameEl) nameEl.textContent = item.GeneID
        }
    )
}
// --------------------------------------- Bus subscriptions ---------------------------------------
bus.subscribe_to("midi_track_gene", "main", ({ trackIndex, GeneID }) => {
    midiTrackGenes.set(trackIndex, GeneID)
    const waveform = geneToWavetable(GeneID, normalized_counts_lookup)
    if (!waveform) return
    // Queue until worklet exists (user may search before Activate)
    if (midiNode) setTrackWavetable(midiNode, trackIndex, waveform)
})

bus.subscribe_to("synth_waveform_changed", "main", (points) => {
    if (synth_node) {
        synth_node.port.postMessage({ type: "updatePoints", points })
    }
})

bus.subscribe_to("playNote", "main", ([mv, GeneID, Index, freq, sweep]) => {
    const node = createVoice(mv, shared)
    if (!node) return
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

bus.subscribe_to("gene_label_select", "main", (item) => {
    if (!item) {
        plotStepSeq.renderEmpty()
        return
    }
    const VST_dat = VST_lookup.get(item.GeneID)
    if (!VST_dat) return
    plotStepSeq.updatePlot({
        metaValues,
        shared,
        cur_mu: osc_perGene_mu[item.index],
        cur_std: osc_perGene_std[item.index],
        meta_item: item,
        VST_dat,
    })
})

bus.subscribe_to("resetSelection", "main", () => {
    plotStepSeq.renderEmpty()
})

bus.subscribe_to("updateParams", "main", (params) => {
    if (!synthSlides_node) return
    if (!synthSlideDestinationConnection) {
        synthSlides_node.connect(globalAudio.input)
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
        synthSlides_node.disconnect(globalAudio.input)
        synthSlideDestinationConnection = false
    }
})




// TODO: Play Sample becomes playing a midi ; adjust font size and point size ; make dynamic adjustable to screen size ; finalize color ; fix gene name display ; add display for selelcted gene (GeneID or sine/square/custom etc.) avoid allowing play sample to be pressed multiple times; Resqueeze catmullrom data to -1,1 (interpolation can bend it past the extremes); May allow mapping of volume to log expression