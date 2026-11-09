import { Synth_Waveform } from "/src/synth_waveform.js"
import { plotUMAP } from "/src/plotUMAP.js"
import { load_waveforms, bin_to_array } from "/src/binHelper.js"
import { plotViolin } from "/src/plotViolin.js"
import { plotStepSeqMain } from "/src/step_sequencer.js"
import { plotGPWave } from "/src/GPplot.js"
import { mountSynthScienceDiv } from "/src/synthScienceDiv.js"
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
    clearTrackWavetable,
} from "/src/midiplayer.js"
import { stepSeqTutorial } from "/src/StepSeqTutorial.js"
import { midiTrackPlots } from "/src/midiTrackPlot.js"
import { plotHarmonics, energyPctAtPeriod } from "/src/plotHarmonics.js"

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
const per_gene_meta = await d3.csv("/dat/per_gene_meta.csv", d3.autoType) // decide if convert to bin later

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

// const [metaValues, osc_perGene_meta, shared, osc_perGene_mu, osc_perGene_std] =
//     await load_waveforms("/dat/waveforms.bin", "/dat/bin_meta.json")
const normalized_counts_lookup = new Map(count_arr.map((val) => [val.GeneID, val]))
const VST_lookup = new Map(VST_arr.map((val) => [val.GeneID, val]))
const per_gene_meta_lookup = new Map(per_gene_meta.map((val) => [val.GeneID, val]))
// Amplitude spectrum per gene (period hours → FFT amplitude). Energy % is derived on read.
const HARMONIC_PERIODS_H = [48, 24, 16, 12, 9.6, 8, 6.8, 6]
const specs_lookup = new Map(per_gene_meta.map((v) => [
    v.GeneID,
    HARMONIC_PERIODS_H.map((period, i) => ({
        period,
        amplitude: v[`spec${i + 1}`],
    })),
]))
// --------------------------------------- Synth waveform ---------------------------------------
const synth_waveform_canvas = document.getElementById("Synth_Waveform")
const synth_waveform = new Synth_Waveform(synth_waveform_canvas, bus, count_arr)

/** Current gene driving the synth waveform (null = custom / preset). */
let currentSynthGeneID = null
let synthToMidiStatusTimer = null

const synthWaveformLabelEl = document.getElementById("synth_waveform_name")
const synthWaveformLabelTextEl = synthWaveformLabelEl?.querySelector(".synth-waveform-label__text")
const synthToMidiGeneEl = document.getElementById("synth_to_midi_gene_id")
const synthToMidiTrackSelect = document.getElementById("synth_to_midi_track_select")
const synthToMidiSendBtn = document.getElementById("send_waveform_to_midi")
const synthToMidiStatusEl = document.getElementById("synth_to_midi_success")
const synthToMidiPanel = document.getElementById("pushSound")

function setSynthToMidiStatus(message, kind = "success") {
    if (!synthToMidiStatusEl) return
    if (synthToMidiStatusTimer) {
        clearTimeout(synthToMidiStatusTimer)
        synthToMidiStatusTimer = null
    }
    if (!message) {
        synthToMidiStatusEl.hidden = true
        synthToMidiStatusEl.textContent = ""
        synthToMidiStatusEl.classList.remove("is-success", "is-error")
        return
    }
    synthToMidiStatusEl.hidden = false
    synthToMidiStatusEl.textContent = message
    synthToMidiStatusEl.classList.toggle("is-success", kind === "success")
    synthToMidiStatusEl.classList.toggle("is-error", kind === "error")
    synthToMidiStatusTimer = setTimeout(() => setSynthToMidiStatus(null), 2200)
}

function syncSynthToMidiControls() {
    const hasGene = Boolean(currentSynthGeneID)
    if (synthToMidiPanel) {
        synthToMidiPanel.classList.toggle("is-disabled", !hasGene)
        synthToMidiPanel.setAttribute("aria-disabled", hasGene ? "false" : "true")
    }
    if (synthToMidiTrackSelect) synthToMidiTrackSelect.disabled = !hasGene
    if (synthToMidiSendBtn) synthToMidiSendBtn.disabled = !(hasGene)
}

function updateSynthGeneUI(GeneID) {
    currentSynthGeneID = GeneID || null
    const label = currentSynthGeneID || "Custom Waveform"
    if (synthWaveformLabelTextEl) synthWaveformLabelTextEl.textContent = label
    else if (synthWaveformLabelEl) synthWaveformLabelEl.textContent = label
    synthWaveformLabelEl?.classList.toggle("has-gene", Boolean(currentSynthGeneID))

    if (synthToMidiGeneEl) {
        synthToMidiGeneEl.textContent = currentSynthGeneID || "selected gene"
        synthToMidiGeneEl.classList.toggle("is-empty", !currentSynthGeneID)
    }
    setSynthToMidiStatus(null)
    syncSynthToMidiControls()
}

function applySynthPreset(fn) {
    fn()
    // Presets / reset leave the gene data behind — clear selection so UI matches the sound.
    bus.execute_event("point_select", null)
}

document.getElementById("reset").addEventListener("click", () => applySynthPreset(() => synth_waveform.reset()))
document.getElementById("sine").addEventListener("click", () => applySynthPreset(() => synth_waveform.sine()))
document.getElementById("square").addEventListener("click", () => applySynthPreset(() => synth_waveform.square()))
document.getElementById("saw").addEventListener("click", () => applySynthPreset(() => synth_waveform.saw()))
document.getElementById("triangle").addEventListener("click", () => applySynthPreset(() => synth_waveform.triangle()))

synthToMidiTrackSelect?.addEventListener("change", () => {
    setSynthToMidiStatus(null)
    syncSynthToMidiControls()
})
updateSynthGeneUI(null)

// UMAP hover info
const UMAP_hover_GeneID = document.getElementById("UMAP_hover_gene_id")
const UMAP_hover_Info_Additional_Type = document.getElementById("UMAP_hover_info_additional_type")
const UMAP_hover_Info_Additional_Text = document.getElementById("UMAP_hover_info_additional_text")

// UMAP selected info
const UMAP_selected_GeneID = document.getElementById("UMAP_selected_gene_id")
const UMAP_selected_Info_Additional_Type = document.getElementById("UMAP_selected_info_additional_type")
const UMAP_selected_Info_Additional_Text = document.getElementById("UMAP_selected_info_additional_text")


// // Step sequencer transport
// const playPauseButton = document.getElementById("StepSeqPlayPause")
// let isPlay = false
// playPauseButton.addEventListener("click", async () => {
//     await initStepSeqAudio()
//     isPlay = !isPlay
//     playPauseButton.textContent = isPlay ? "Pause" : "Play"
//     bus.execute_event("seqPlayPause", isPlay)
// })
// document.getElementById("StepSeqStop").addEventListener("click", () => {
//     isPlay = false
//     playPauseButton.textContent = "Play"
//     bus.execute_event("seqStop", null)
// })
// document.getElementById("StepSeqReset").addEventListener("click", () => {
//     bus.execute_event("resetSelection", null)
// })

// --------------------------------------- MidiPlayer ---------------------------------------
// Side drawer: sticky within #SynthDiv, toggled via .is-open on #midi_container
const jukeboxHandle = document.getElementById("midi_handle")
const jukeboxContainer = document.getElementById("midi_container")
jukeboxHandle?.addEventListener("click", () => {
    const open = jukeboxContainer.classList.toggle("is-open")
    jukeboxHandle.setAttribute("aria-expanded", open ? "true" : "false")
})

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
let midiTrackCounts = null
let midiSongTime = null
const midiTrackGenes = new Map() // trackIndex → GeneID
const midiTrackEls = new Map(
    MIDI_TRACKS.map((track) => [
        track.trackIndex,
        document.querySelector(`.midi-track[data-track-index="${track.trackIndex}"]`),
    ])
)

function setMidiTrackLoaded(trackIndex, GeneID) {
    const el = midiTrackEls.get(trackIndex)
    if (!el) return
    const loaded = Boolean(GeneID)
    el.classList.toggle("is-unloaded", !loaded)
    el.classList.toggle("is-loaded", loaded)
    el.setAttribute("aria-busy", loaded ? "false" : "true")

    const badge = el.querySelector("[data-midi-badge]")
    if (badge) badge.textContent = loaded ? "Loaded" : "No sound"

    const geneEl = el.querySelector("[data-midi-gene]")
    if (geneEl) {
        geneEl.replaceChildren()
        if (GeneID) {
            const idSpan = document.createElement("span")
            idSpan.className = "midi-gene-name__id"
            idSpan.textContent = GeneID

            const removeButton = document.createElement("button")
            removeButton.type = "button"
            removeButton.className = "midi-track-remove"
            removeButton.setAttribute("aria-label", `Remove ${GeneID} from track`)
            removeButton.textContent = "×"
            removeButton.addEventListener("click", (e) => {
                e.preventDefault()
                e.stopPropagation()
                bus.execute_event("midi_track_gene", { trackIndex, GeneID: null })
            })

            geneEl.append(idSpan, removeButton)
        }
    }

    updateMidiLoadHint()
}

function updateMidiLoadHint() {
    const hint = document.getElementById("midi_load_hint")
    if (!hint) return
    const loaded = midiTrackGenes.size
    const total = MIDI_TRACKS.length
    if (loaded === 0) {
        hint.textContent = "Assign a gene to each track to load its sound. Unloaded tracks stay silent."
    } else if (loaded < total) {
        hint.textContent = `${loaded} of ${total} tracks loaded. Unloaded tracks stay silent until you assign a gene.`
    } else {
        hint.textContent = `${loaded} of ${total} tracks loaded.`
    }
}

function syncMidiTrackWavetables() {
    for (const [trackIndex, GeneID] of midiTrackGenes) {
        const waveform = geneToWavetable(GeneID, normalized_counts_lookup)
        if (waveform && midiNode) setTrackWavetable(midiNode, trackIndex, waveform)
    }
}

/** Format mm:ss for the scrubber before the transport exists. */
function formatMidiClock(time) {
    const safe = Math.max(0, Number(time) || 0)
    const minutes = Math.floor(safe / 60)
    const seconds = Math.floor(safe % 60)
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

function applyMidiDurationToUi(duration) {
    const total = Math.max(0, Number(duration) || 0)
    const totalEl = document.getElementById("midi_total_time")
    const bar = document.getElementById("midi_progress_bar")
    if (totalEl) totalEl.textContent = ` / ${formatMidiClock(total)}`
    if (bar) {
        bar.max = String(total)
        bar.step = "any"
    }
}

// File + plots load on page start (no AudioContext needed).
// Audio worklet / transport still wait for first play (browser autoplay policy).
let midiDataPromise = null
function loadMidiData() {
    if (!midiDataPromise) {
        midiDataPromise = loadMidiEvents(MIDI_FILE, MIDI_TRACKS.length)
            .then((loaded) => {
                midiEvents = loaded.events
                midiSongTime = loaded.duration
                midiTrackCounts = loaded.trackCount
                applyMidiDurationToUi(midiSongTime)
                midiTrackPlots(midiEvents, MIDI_TRACKS, bus)
                // If the user already hit play, wire events into the live transport
                if (midiTransport) {
                    midiTransport.setEvents(midiEvents, midiSongTime)
                    syncMidiTrackWavetables()
                }
            })
            .catch((err) => {
                midiDataPromise = null
                throw err
            })
    }
    return midiDataPromise
}

loadMidiData()

async function ensureMidiReady() {
    await Promise.all([loadMidiData(), initMidiAudio()])
}

// Assign the currently selected synth gene to a Jukebox track
synthToMidiSendBtn?.addEventListener("click", () => {
    const rawTrack = synthToMidiTrackSelect?.value
    const trackIndex = Number(rawTrack)
    const GeneID = currentSynthGeneID
    // Number("") === 0, so require a non-empty select value before coercing.
    if (!GeneID || rawTrack === "" || rawTrack == null || !Number.isInteger(trackIndex) || trackIndex < 0) {
        setSynthToMidiStatus("Select a gene and track first", "error")
        return
    }
    if (!normalized_counts_lookup.has(GeneID)) {
        setSynthToMidiStatus("Gene not found", "error")
        return
    }
    bus.execute_event("midi_track_gene", { trackIndex, GeneID })
    const trackLabel =
        MIDI_TRACKS.find((t) => t.trackIndex === trackIndex)?.label || `track ${trackIndex}`
    setSynthToMidiStatus(`Assigned to ${trackLabel}`, "success")
})

document.getElementById("midi_play").addEventListener("click", async () => {
    await ensureMidiReady()
    if (midiTransport.isPlaying) {
        midiTransport.stop()
        document.getElementById("midi_play").textContent = "play"
    } else {
        // Re-upload any genes assigned before (or while) the worklet was offline.
        syncMidiTrackWavetables()
        midiTransport.play()
        document.getElementById("midi_play").textContent = "stop"
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

// // Step Seq
// const activeVoices = new Map()
// let stepSeqAudioContext = null
// let masterCompressor = null
// let stepSeqReady = null
// async function initStepSeqAudio() {
//     if (!stepSeqReady) {
//         stepSeqReady = (async () => {
//             stepSeqAudioContext = await sharedContext()
//             masterCompressor = stepSeqAudioContext.createDynamicsCompressor()
//             masterCompressor.threshold.value = -6
//             masterCompressor.knee.value = 3
//             masterCompressor.ratio.value = 4
//             masterCompressor.attack.value = 0.003
//             masterCompressor.release.value = 0.15
//             masterCompressor.connect(globalAudio.input)
//         })().catch((err) => {
//             stepSeqReady = null
//             throw err
//         })
//     }
//     await stepSeqReady
//     await globalAudio.resume()
// }

// Synth science fold demos (same worklet as the old slides)
let synthSlidesAudioContext = null
let synthSlides_node = null
let synthSlideDestinationConnection = false
let synthSlidesReady = null
async function initSynthScienceAudio() {
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
                    const btn = document.getElementById("midi_play")
                    if (btn) btn.textContent = "play"
                },
            }, bus)
            if (midiEvents && midiSongTime) midiTransport.setEvents(midiEvents, midiSongTime)
            // Genes may have been assigned before the worklet existed — push them now.
            syncMidiTrackWavetables()
        })().catch((err) => {
            midiReady = null
            throw err
        })
    }
    await midiReady
    await globalAudio.resume()
}

// // --------------------------------------- Spawn voices ---------------------------------------
// function createVoice(metaValues, sharedBuffer) {
//     if (!stepSeqAudioContext || !masterCompressor) return null
//     const node = new AudioWorkletNode(stepSeqAudioContext, "stepseq-audio-processor", {
//         processorOptions: { metaValues, shared: sharedBuffer },
//     })
//     const gain = stepSeqAudioContext.createGain()
//     gain.gain.value = 0
//     node.connect(gain)
//     gain.connect(masterCompressor)
//     activeVoices.set(node, gain)
//     rescaleGains()

//     node.port.onmessage = (e) => {
//         if (e.data.type === "ended") {
//             node.disconnect()
//             gain.disconnect()
//             activeVoices.delete(node)
//             rescaleGains()
//         }
//     }
//     return node
// }

// // --------------------------------------- StepSquencer ---------------------------------------
// // min-max scale qval. Map qval to sweep_frequency.
// const qvals = osc_perGene_meta.map((d) => d.qval)
// const qval_min = Math.min(...qvals)
// const qval_max = Math.max(...qvals)
// const qval_span = qval_max - qval_min || 1
// const sweep_max = 5
// const sweep_min = 1
// for (let i = 0; i < osc_perGene_meta.length; i++) {
//     // Higher qval (less confident period) → faster morph across posterior samples
//     osc_perGene_meta[i].sweep_frequency =
//         sweep_min + ((qvals[i] - qval_min) * (sweep_max - sweep_min)) / qval_span
//     osc_perGene_meta[i].index = i
// }

// const osc_perGene_meta_lookup = new Map(osc_perGene_meta.map((v) => [v.GeneID, v]))

// export function renderSelectionPanel(selected_genes) {
//     const panel = document.getElementById("StepSeqGPSelectedGenes")
//     panel.innerHTML = ""

//     for (const item of selected_genes) {
//         const GeneID = item.GeneID
//         const tag = document.createElement("div")
//         tag.className = "gene-tag"

//         const label = document.createElement("span")
//         label.className = "gene-tag-label"
//         label.textContent = GeneID
//         label.addEventListener("click", () => {
//             bus.execute_event("gene_label_select", item)
//         })

//         const remove = document.createElement("button")
//         remove.className = "gene-tag-remove"
//         remove.textContent = "×"
//         remove.addEventListener("click", (event) => {
//             bus.execute_event("selection_del", item)
//             event.stopPropagation()
//         })

//         tag.appendChild(label)
//         tag.appendChild(remove)
//         panel.appendChild(tag)
//     }
// }

// function fmtMetaNum(v, digits = 2) {
//     if (v == null || Number.isNaN(Number(v))) return "—"
//     return Number(v).toFixed(digits)
// }

// function renderGPMeta(item) {
//     const panel = document.getElementById("StepSeqGPMeta")
//     const setText = (id, text) => {
//         const el = document.getElementById(id)
//         if (el) el.textContent = text
//     }

//     if (!item) {
//         panel?.classList.add("is-empty")
//         setText("StepSeqGPMeta-gene", "—")
//         setText("StepSeqGPMeta-period-low", "—")
//         setText("StepSeqGPMeta-period", "—")
//         setText("StepSeqGPMeta-period-high", "—")
//         setText("StepSeqGPMeta-phase", "—")
//         setText("StepSeqGPMeta-qval", "—")
//         setText("StepSeqGPMeta-relstd", "—")
//         const ci = document.getElementById("StepSeqGPMeta-period-ci")
//         if (ci) ci.setAttribute("aria-label", "Period 95% confidence interval unavailable")
//         return
//     }

//     panel?.classList.remove("is-empty")
//     const low = fmtMetaNum(item.period_low95)
//     const period = fmtMetaNum(item.period)
//     const high = fmtMetaNum(item.period_high95)
//     setText("StepSeqGPMeta-gene", item.GeneID)
//     setText("StepSeqGPMeta-period-low", low)
//     setText("StepSeqGPMeta-period", period)
//     setText("StepSeqGPMeta-period-high", high)
//     setText("StepSeqGPMeta-logPeriodSD", fmtMetaNum(item.log_period_sd))
//     setText("StepSeqGPMeta-phase", fmtMetaNum(item.phase))
//     setText("StepSeqGPMeta-qval", fmtMetaNum(item.qval, 3))
//     setText("StepSeqGPMeta-relstd", fmtMetaNum(item.relative_std, 3))
//     const ci = document.getElementById("StepSeqGPMeta-period-ci")
//     if (ci) {
//         ci.setAttribute(
//             "aria-label",
//             `Period ${period} hours, 95% CI ${low} to ${high}`
//         )
//     }
// }

// renderGPMeta(null)

// --------------------------------------- Plots ---------------------------------------
plotUMAP(600, 500, count_umap_arr, per_gene_meta, specs_lookup, "read_counts", "UMAP of read counts over 48hrs", false, bus)
plotUMAP(600, 500, fft_umap_arr, per_gene_meta, specs_lookup, "fft", "UMAP of FFT of waveforms", false, bus)
console.log(specs_lookup)
plotHarmonics(specs_lookup, bus)

// UMAP color-mode toggles (TPM filter stays independent)
// Oscillating genes + oscillation energy share one sub-options row beneath the capsule.
const OSCILLATING_MODES = new Set(["qval", "circadian"])
const umapColorChoices = [
    {
        id: "UMAP_oscillation",
        menuId: "UMAP_oscillation_menu",
        isActive: (m) => OSCILLATING_MODES.has(m),
    },
    { id: "UMAP_phase", isActive: (m) => m === "phase" },
    {
        id: "UMAP_energy",
        menuId: "UMAP_energy_menu",
        isActive: (m) => m === "energyPct",
    },
]
const umapSuboptionsRow = document.getElementById("UMAP_color_suboptions")
let umapColorMode = "none"

function selectedOscillatingType() {
    const el = document.querySelector('input[name="oscillating_type"]:checked')
    return OSCILLATING_MODES.has(el?.value) ? el.value : "circadian"
}

function syncUmapColorSuboptions() {
    let openMenuId = null
    for (const { id, menuId, isActive } of umapColorChoices) {
        const open = Boolean(menuId) && isActive(umapColorMode)
        document.getElementById(id)?.setAttribute("aria-expanded", String(open))
        const menu = menuId ? document.getElementById(menuId) : null
        if (menu) menu.hidden = !open
        if (open) openMenuId = menuId
    }
    if (umapSuboptionsRow) umapSuboptionsRow.hidden = !openMenuId
}

function setUmapColorMode(mode) {
    umapColorMode = mode
    for (const { id, isActive } of umapColorChoices) {
        document.getElementById(id)?.setAttribute("aria-pressed", String(isActive(umapColorMode)))
    }
    syncUmapColorSuboptions()
    bus.execute_event("umap_color_mode", umapColorMode)
}

const umapOscillationChoice = umapColorChoices.find((c) => c.id === "UMAP_oscillation")
const umapEnergyChoice = umapColorChoices.find((c) => c.id === "UMAP_energy")

document.getElementById("UMAP_oscillation")?.addEventListener("click", () => {
    setUmapColorMode(
        umapOscillationChoice.isActive(umapColorMode) ? "none" : selectedOscillatingType()
    )
})
document.getElementById("UMAP_phase")?.addEventListener("click", () => {
    setUmapColorMode(umapColorMode === "phase" ? "none" : "phase")
})
document.getElementById("UMAP_energy")?.addEventListener("click", () => {
    setUmapColorMode(umapEnergyChoice.isActive(umapColorMode) ? "none" : "energyPct")
})

document.querySelectorAll('input[name="oscillating_type"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        if (!radio.checked || !OSCILLATING_MODES.has(radio.value)) return
        if (umapColorMode !== radio.value) setUmapColorMode(radio.value)
        else bus.execute_event("umap_color_mode", radio.value)
    })
})

let oscillation_energy = "24"
document.querySelectorAll('input[name="oscillation_energy"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        if (!radio.checked) return
        oscillation_energy = radio.value
        if (umapColorMode !== "energyPct") setUmapColorMode("energyPct")
        else bus.execute_event("umap_color_mode", "energyPct")
    })
})

plotViolin(
    130, 500, { top: 20, right: 20, bottom: 20, left: 50 },
    count_arr.map((v) => v.log_TPM),
    d3.select("#filter_slider"), "log10(mean TPM)", bus, "synth_TPM_filter"
)

// // Main plot first (violin column width is reserved in CSS). Then size violins to the
// // combined height of #StepSeqMain + #StepSeqControls so they share one visual column.
// plotStepSeqMain(1800, 1200, "#StepSeqMain", osc_perGene_meta, osc_perGene_meta_lookup, metaValues, bus)

// const stepSeqContainer = document.getElementById("StepSequencerContainer")
// const stepSeqMainEl = document.getElementById("StepSeqMain")
// const stepSeqControlsEl = document.getElementById("StepSeqControls")
// const stepSeqViolinEl = document.getElementById("StepSeqViolin")
// const stepSeqViolinStyles = getComputedStyle(stepSeqViolinEl)
// const stepSeqRowGap = parseFloat(getComputedStyle(stepSeqContainer).rowGap) || 0
// const violinChromeY =
//     (parseFloat(stepSeqViolinStyles.paddingTop) || 0) +
//     (parseFloat(stepSeqViolinStyles.paddingBottom) || 0) +
//     (parseFloat(stepSeqViolinStyles.borderTopWidth) || 0) +
//     (parseFloat(stepSeqViolinStyles.borderBottomWidth) || 0)
// const violinHeight = Math.max(
//     320,
//     Math.round(
//         stepSeqMainEl.offsetHeight + stepSeqControlsEl.offsetHeight + stepSeqRowGap - violinChromeY
//     )
// )

// const violinOpts = { top: 16, right: 8, bottom: 16, left: 50 }
// console.log(osc_perGene_meta)
// plotViolin(
//     100, violinHeight, violinOpts,
//     osc_perGene_meta.map((v) => v.period_high95 - v.period_low95),
//     d3.select("#violin-logPeriodSD"), "95% CI range (hrs)", bus, "StepSeqPeriodSDUpdate"
// )
// plotViolin(
//     100, violinHeight, violinOpts,
//     osc_perGene_meta.map((v) => v.qval),
//     d3.select("#violin-qVal"), "q-value", bus, "StepSeqqValUpdate", 0.05, 0.00
// )
// plotViolin(
//     100, violinHeight, violinOpts,
//     osc_perGene_meta.map((v) => v.relative_std),
//     d3.select("#violin-Std"), "mean(posterior std) / std(posterior mean)", bus, "StepSeqStdUpdate"
// )

// const plotGP = plotGPWave(600, 400, "#StepSeqGPPlot")

setupHelpPopUps(document, window)

// --------------------------------------- Synth science fold ---------------------------------------
mountSynthScienceDiv({
    root: document.getElementById("Synth_Science_div"),
    geneRow: normalized_counts_lookup.get("AT5G61380"),
    bus,
    initAudio: initSynthScienceAudio,
})

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
// searchbar(
//     document.querySelector("#StepSeqGPSearch"),
//     document.querySelector("#StepSeqGPResults"),
//     osc_perGene_meta,
//     (item) => {
//         bus.execute_event("selection_add", item)
//         bus.execute_event("gene_label_select", item)
//     }
// )
searchbar(
    document.querySelector("#synth-search"),
    document.querySelector("#synth-results"),
    count_arr,
    (item) => {
        bus.execute_event("point_select", item.GeneID)
    }
)

// MIDI track gene search
for (const track of MIDI_TRACKS) {
    setMidiTrackLoaded(track.trackIndex, null) // start unloaded
    searchbar(
        document.querySelector(`#midi-${track.id}-search`),
        document.querySelector(`#midi-${track.id}-results`),
        count_arr,
        (item) => {
            bus.execute_event("midi_track_gene", {
                trackIndex: track.trackIndex,
                GeneID: item.GeneID,
            })
        }
    )
}

// // --------------------------------------- Tutorial ---------------------------------------
// const tutorial = new stepSeqTutorial(bus, osc_perGene_meta_lookup)
// document.getElementById("StepSeqTooltipPrev").addEventListener("click", () => {
//     tutorial.prevStep()
// })
// document.getElementById("StepSeqTooltipNext").addEventListener("click", () => {
//     tutorial.nextStep()
// })
// document.getElementById("StepSeqTooltipClose").addEventListener("click", () => {
//     tutorial.close()
// })

// --------------------------------------- Bus subscriptions ---------------------------------------
bus.subscribe_to("midi_track_gene", "main", ({ trackIndex, GeneID }) => {
    if (!GeneID) {
        midiTrackGenes.delete(trackIndex)
        setMidiTrackLoaded(trackIndex, null)
        if (midiNode) clearTrackWavetable(midiNode, trackIndex)
        return
    }
    midiTrackGenes.set(trackIndex, GeneID)
    setMidiTrackLoaded(trackIndex, GeneID)
    const waveform = geneToWavetable(GeneID, normalized_counts_lookup)
    if (!waveform) return
    // Queue until worklet exists (user may search before first play)
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
        plotGP.renderEmpty()
        renderGPMeta(null)
        return
    }
    const VST_dat = VST_lookup.get(item.GeneID)
    if (!VST_dat) return
    plotGP.updatePlot({
        metaValues,
        shared,
        cur_mu: osc_perGene_mu[item.index],
        cur_std: osc_perGene_std[item.index],
        meta_item: item,
        VST_dat,
    })
    renderGPMeta(item)
})

bus.subscribe_to("resetSelection", "main", () => {
    plotGP.renderEmpty()
    renderGPMeta(null)
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

bus.subscribe_to("point_select", "main", (GeneID) => {
    updateSynthGeneUI(GeneID)
    UMAP_selected_GeneID.textContent = GeneID
    const cur_meta = per_gene_meta_lookup.get(GeneID)
    if (OSCILLATING_MODES.has(umapColorMode)) {
        UMAP_selected_Info_Additional_Text.textContent = cur_meta? cur_meta.LS_qval : "—"
    } else if (umapColorMode === "phase") {
        UMAP_selected_Info_Additional_Text.textContent = cur_meta? cur_meta.phase : "—"
    } else if (umapColorMode === "energyPct") {
        UMAP_selected_Info_Additional_Text.textContent = cur_meta? energyPctAtPeriod(GeneID, specs_lookup, oscillation_energy) : "—"
    }
})


bus.subscribe_to("umap_color_mode", "main", (mode) => {
    if (OSCILLATING_MODES.has(mode)) {
        UMAP_hover_Info_Additional_Type.textContent = "q-value: "
        UMAP_selected_Info_Additional_Type.textContent = "q-value: "
    } else if (mode === "phase") {
        UMAP_hover_Info_Additional_Type.textContent = "peak-time: "
        UMAP_selected_Info_Additional_Type.textContent = "peak-time: "
    } else if (mode === "energyPct") {
        UMAP_hover_Info_Additional_Type.textContent = "energy percentage: "
        UMAP_selected_Info_Additional_Type.textContent = "energy percentage: "
    }
})

bus.subscribe_to("point_hover", "main", (GeneID) => {
    UMAP_hover_GeneID.textContent = GeneID
    const cur_meta = per_gene_meta_lookup.get(GeneID)
    if (OSCILLATING_MODES.has(umapColorMode)) {
        UMAP_hover_Info_Additional_Text.textContent = cur_meta? cur_meta.LS_qval : "—"
    } else if (umapColorMode === "phase") {
        UMAP_hover_Info_Additional_Text.textContent = cur_meta? cur_meta.phase : "—"
    } else if (umapColorMode === "energyPct") {
        UMAP_hover_Info_Additional_Text.textContent = cur_meta? energyPctAtPeriod(GeneID, specs_lookup, oscillation_energy) : "—"
    }
})

console.log(per_gene_meta)