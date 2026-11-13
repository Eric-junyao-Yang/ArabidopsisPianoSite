import { Synth_Waveform } from "/src/synth_waveform.js"
import { plotUMAP } from "/src/plotUMAP.js"
import { bin_to_array } from "/src/binHelper.js"
import { plotViolin } from "/src/plotViolin.js"
import { plotGPClass } from "/src/GaussianProcess/plotGP.js"
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
import { midiTrackPlots } from "/src/midiTrackPlot.js"
import { plotHarmonics, energyPctAtPeriod } from "/src/plotHarmonics.js"
import { gpSamplerClass } from "/src/GaussianProcess/GPalgo.js"

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
const allgenes_VST_arr = await bin_to_array("/dat/allgenes_VST_umap.bin", "/dat/bin_meta.json")
const allgenes_fft_arr = await bin_to_array("/dat/allgenes_fft_umap.bin", "/dat/bin_meta.json")
const per_gene_meta = await bin_to_array("/dat/per_gene_meta.bin", "/dat/bin_meta.json")

const gp_params_arr = await bin_to_array("/dat/gp_params.bin", "/dat/bin_meta.json")
const circadian_VST_arr = await bin_to_array("/dat/circadian_VST_umap.bin", "/dat/bin_meta.json")
const circadian_fft_arr = await bin_to_array("/dat/circadian_fft_umap.bin", "/dat/bin_meta.json")
if (
    count_arr.length !== allgenes_VST_arr.length ||
    count_arr.length !== allgenes_fft_arr.length ||
    count_arr.length !== VST_arr.length ||
    count_arr.length !== per_gene_meta.length
) {
    throw new Error("Row-count mismatch among Normalized_counts / VST / VST umaps / per_gene_meta")
}

if (
    gp_params_arr.length !== circadian_VST_arr.length ||
    gp_params_arr.length !== circadian_fft_arr.length
) {
    throw new Error("Row-count mismatch among gp_params / circadian UMAPs")
}

for (let i = 0; i < count_arr.length; i++) {
    const GeneID = count_arr[i].GeneID
    const log_TPM = count_arr[i].log_TPM
    allgenes_VST_arr[i].GeneID = GeneID
    allgenes_VST_arr[i].id = GeneID
    allgenes_VST_arr[i].log_TPM = log_TPM
    allgenes_fft_arr[i].GeneID = GeneID
    allgenes_fft_arr[i].id = GeneID
    allgenes_fft_arr[i].log_TPM = log_TPM
    per_gene_meta[i].GeneID = GeneID
}
// const [metaValues, osc_perGene_meta, shared, osc_perGene_mu, osc_perGene_std] =
//     await load_waveforms("/dat/waveforms.bin", "/dat/bin_meta.json")
const normalized_counts_lookup = new Map(count_arr.map((val) => [val.GeneID, val]))
const VST_lookup = new Map(VST_arr.map((val) => [val.GeneID, val]))
const per_gene_meta_lookup = new Map(per_gene_meta.map((val) => [val.GeneID, val]))

// Circadian UMAP bins share row order with gp_params (GeneIDs) but have no rownames / TPM.
for (let i = 0; i < gp_params_arr.length; i++) {
    const GeneID = gp_params_arr[i].GeneID
    const log_TPM = normalized_counts_lookup.get(GeneID)?.log_TPM
    circadian_VST_arr[i].GeneID = GeneID
    circadian_VST_arr[i].id = GeneID
    circadian_VST_arr[i].log_TPM = log_TPM
    circadian_fft_arr[i].GeneID = GeneID
    circadian_fft_arr[i].id = GeneID
    circadian_fft_arr[i].log_TPM = log_TPM
}
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
const synth_waveform = new Synth_Waveform(synth_waveform_canvas, bus, VST_arr)

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

// ------------------------------- Display Mode Switching -------------------------------
let displayMode = "All"

function updateDisplayMode() {
    const el = document.querySelector('input[name="CircadianToggle"]:checked')
    if (el?.value === "All" || el?.value === "Circadian") displayMode = el.value
    return displayMode
}
document.querySelectorAll('input[name="CircadianToggle"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        if (!radio.checked) return
        updateDisplayMode()
        bus.execute_event("DisplayModeSet", radio.value)
    })
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

// --------------------------------------- Plots ---------------------------------------
const umapReadCounts = plotUMAP(600, 500, allgenes_VST_arr, per_gene_meta, specs_lookup, "read_counts", "UMAP of read counts over 48hrs", false, bus)
const umapFft = plotUMAP(600, 500, allgenes_fft_arr, per_gene_meta, specs_lookup, "fft", "UMAP of FFT of waveforms", false, bus)
plotHarmonics(specs_lookup, bus)

// GP sampling
const gpSampler = new gpSamplerClass(gp_params_arr, VST_lookup)
//prototyping
const GeneID = "AT5G61380"
gpSampler.updateMuStdSigma(GeneID) 
const mu = gpSampler.mu
const std = gpSampler.std
const draw1 = gpSampler.drawPosterior()
const plotGP = new plotGPClass()
plotGP.updateGeneID(GeneID, mu, std)
plotGP.drawSample(draw1)


// UMAP color-mode toggles (TPM filter stays independent)
// Oscillating genes / oscillation energy each expand their own options to the right.
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
let umapColorMode = "none"

function selectedOscillatingType() {
    const el = document.querySelector('input[name="oscillating_type"]:checked')
    return OSCILLATING_MODES.has(el?.value) ? el.value : "circadian"
}

function syncUmapColorSuboptions() {
    for (const { id, menuId, isActive } of umapColorChoices) {
        const open = Boolean(menuId) && isActive(umapColorMode)
        const btn = document.getElementById(id)
        btn?.setAttribute("aria-expanded", String(open))
        const menu = menuId ? document.getElementById(menuId) : null
        const wrap = btn?.closest(".umap-color-choice-wrap")
        if (wrap) wrap.dataset.expanded = open ? "true" : "false"
        if (!menu) continue
        menu.setAttribute("aria-hidden", String(!open))
        if (open) menu.removeAttribute("inert")
        else menu.setAttribute("inert", "")
    }
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

const umapGenePanels = {
    hover: {
        root: document.getElementById("UMAP_hover_info"),
        geneId: document.getElementById("UMAP_hover_gene_id"),
        metric: document.getElementById("UMAP_hover_metric"),
        metricLabel: document.getElementById("UMAP_hover_info_additional_type"),
        metricValue: document.getElementById("UMAP_hover_info_additional_text"),
    },
    selected: {
        root: document.getElementById("UMAP_selected_info"),
        geneId: document.getElementById("UMAP_selected_gene_id"),
        metric: document.getElementById("UMAP_selected_metric"),
        metricLabel: document.getElementById("UMAP_selected_info_additional_type"),
        metricValue: document.getElementById("UMAP_selected_info_additional_text"),
    },
}
let umapHoverGeneId = null
let umapSelectedGeneId = null

function formatUmapNumber(value, digits = 2) {
    if (value == null || !Number.isFinite(Number(value))) return "—"
    const n = Number(value)
    if (Math.abs(n) > 0 && Math.abs(n) < 1e-3) return n.toExponential(2)
    return n.toFixed(digits)
}

function umapMetricForMode(mode, geneId) {
    if (!OSCILLATING_MODES.has(mode) && mode !== "phase" && mode !== "energyPct") return null
    const meta = geneId ? per_gene_meta_lookup.get(geneId) : null
    const useMetaCycle = displayMode === "Circadian"
    // Categorical circadian coloring is always MetaCycle; continuous qval follows display mode.
    if (mode === "circadian") {
        return { label: "MetaCycle q", value: formatUmapNumber(meta?.metacycle_qval, 3) }
    }
    if (mode === "qval") {
        const q = useMetaCycle ? meta?.metacycle_qval : meta?.LS_qval
        return {
            label: useMetaCycle ? "MetaCycle q" : "LS q",
            value: formatUmapNumber(q, 3),
        }
    }
    if (mode === "phase") {
        const raw = useMetaCycle ? meta?.metacycle_phase : meta?.LS_phase
        const phase = formatUmapNumber(raw, 2)
        return { label: "peak-time", value: phase === "—" ? phase : `${phase} h` }
    }
    const energy = geneId ? energyPctAtPeriod(geneId, specs_lookup, oscillation_energy) : null
    const pct = formatUmapNumber(energy, 1)
    return { label: "energy", value: pct === "—" ? pct : `${pct}%` }
}

function updateUmapGenePanel(panel, geneId) {
    const hasGene = Boolean(geneId)
    panel.root?.classList.toggle("is-empty", !hasGene)
    if (panel.geneId) panel.geneId.textContent = hasGene ? geneId : "—"

    const metric = umapMetricForMode(umapColorMode, geneId)
    if (!panel.metric) return
    if (!metric) {
        panel.metric.hidden = true
        if (panel.metricLabel) panel.metricLabel.textContent = ""
        if (panel.metricValue) panel.metricValue.textContent = "—"
        return
    }
    panel.metric.hidden = false
    if (panel.metricLabel) panel.metricLabel.textContent = metric.label
    if (panel.metricValue) panel.metricValue.textContent = hasGene ? metric.value : "—"
}

function refreshUmapGenePanels() {
    updateUmapGenePanel(umapGenePanels.hover, umapHoverGeneId)
    updateUmapGenePanel(umapGenePanels.selected, umapSelectedGeneId)
}

bus.subscribe_to("point_select", "main", (GeneID) => {
    updateSynthGeneUI(GeneID)
    umapSelectedGeneId = GeneID || null
    updateUmapGenePanel(umapGenePanels.selected, umapSelectedGeneId)
})

bus.subscribe_to("umap_color_mode", "main", () => {
    refreshUmapGenePanels()
})

bus.subscribe_to("point_hover", "main", (GeneID) => {
    umapHoverGeneId = GeneID || null
    updateUmapGenePanel(umapGenePanels.hover, umapHoverGeneId)
})

bus.subscribe_to("DisplayModeSet", "main", (mode) => {
    if (mode === "All") {
        umapReadCounts.setData(allgenes_VST_arr, "All")
        umapFft.setData(allgenes_fft_arr, "All")
    } else if (mode === "Circadian") {
        umapReadCounts.setData(circadian_VST_arr, "Circadian")
        umapFft.setData(circadian_fft_arr, "Circadian")
    }
    refreshUmapGenePanels()
})