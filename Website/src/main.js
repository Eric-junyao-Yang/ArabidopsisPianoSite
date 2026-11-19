import { plotUMAP } from "./plots/plotUMAP.js"
import { COLOR_MODES, PEAK_HOUR_FIELD, isModeAvailable, modeForGeneSet } from "./umap/colorModes.js"
import { bin_to_array } from "./binHelper.js"
import { plotViolin } from "./plots/plotViolin.js"
import { plotWaveformsClass } from "./plots/plotWaveforms.js"
import { createVoiceOwner, mountMorphExplainers } from "./explainers/explainers.js"
import { mountHarmonicMixer } from "./explainers/harmonicMixer.js"
import { mountHarmonicsTable } from "./explainers/harmonicsTable.js"
import { plotExpressionExplainer } from "./plots/plotExpressionExplainer.js"
import { setupHelpPopUps } from "./helpPopup.js"
import { setupFoldBackToTop } from "./foldBackToTop.js"
import { virtualPiano } from "./virtualPiano.js"
import { searchbar } from "./searchbar.js"
import { initGlobalAudio } from "./audio/globalVolumeControl.js"
import {
    loadMidiEvents,
    createMidiTransport,
    setTrackStatic,
    setTrackGP,
    clearTrack,
    clearAllTracks,
    watchTrack,
} from "./midiplayer.js"
import { midiTrackPlots } from "./plots/midiTrackPlot.js"
import { plotHarmonics, toEnergyPct, hasPeriod } from "./plots/plotHarmonics.js"
import { gpSamplerClass, VSTlookup_to_arr, EXP_HOURS } from "./GaussianProcess/GPalgo.js"

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
const globalAudio = initGlobalAudio({ workletUrl: new URL("./audio/audio_processor.js", import.meta.url) })

// --------------------------------------- load data ---------------------------------------
// Resolved from this file, so the site works at any base path (domain root or a subfolder).
const DAT = new URL("../dat/", import.meta.url).href
// UMAP bins are x/y only (same gene order as Normalized_counts / VST).
const count_arr = await bin_to_array(DAT + "Normalized_counts.bin", DAT + "bin_meta.json")
const VST_arr = await bin_to_array(DAT + "VST.bin", DAT + "bin_meta.json")
const allgenes_VST_arr = await bin_to_array(DAT + "allgenes_VST_umap.bin", DAT + "bin_meta.json")
const allgenes_fft_arr = await bin_to_array(DAT + "allgenes_fft_umap.bin", DAT + "bin_meta.json")
const per_gene_meta = await bin_to_array(DAT + "per_gene_meta.bin", DAT + "bin_meta.json")

const gp_params_arr = await bin_to_array(DAT + "gp_params.bin", DAT + "bin_meta.json")
const circadian_VST_arr = await bin_to_array(DAT + "circadian_VST_umap.bin", DAT + "bin_meta.json")
const circadian_fft_arr = await bin_to_array(DAT + "circadian_fft_umap.bin", DAT + "bin_meta.json")
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
const normalized_counts_lookup = new Map(count_arr.map((val) => [val.GeneID, val]))
const VST_lookup = new Map(VST_arr.map((val) => [val.GeneID, val]))
const per_gene_meta_lookup = new Map(per_gene_meta.map((val) => [val.GeneID, val]))
const gp_params_lookup = new Map(gp_params_arr.map((val) => [val.GeneID, val]))
for (const [GeneID, meta] of per_gene_meta_lookup) {
    const row = VST_lookup.get(GeneID)
    if (row) meta[PEAK_HOUR_FIELD] = EXP_HOURS[d3.maxIndex(VSTlookup_to_arr(row))]
}
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

const ALL_HARMONICS = [1, 2, 3, 4, 5, 6, 7, 8]
const CIRCADIAN_HARMONICS = [1, 2, 3, 4]
const ALL_PERIODS = ALL_HARMONICS.map((k) => 48 / k)
const CIRCADIAN_PERIODS = CIRCADIAN_HARMONICS.map((k) => 24 / k)
const SPECS = {
    All: {
        periods: ALL_PERIODS,
        byGene: new Map(per_gene_meta.map((v) => [v.GeneID, toEnergyPct(
            ALL_HARMONICS.map((k, i) => ({ period: ALL_PERIODS[i], energy: v[`spec${k}`] ** 2 }))
        )])),
    },
    Circadian: {
        periods: CIRCADIAN_PERIODS,
        byGene: new Map(gp_params_arr.map((v) => [v.GeneID, toEnergyPct(
            CIRCADIAN_HARMONICS.map((k, i) => ({
                period: CIRCADIAN_PERIODS[i],
                energy: v[`mean_power_${k}`] + v[`wobble_power_${k}`],
            }))
        )])),
    },
}


// --------------------------------------- Synth waveform ---------------------------------------

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
    const hasGene = Boolean(currentSynthGeneID) && geneInMode(currentSynthGeneID)
    if (synthToMidiPanel) {
        synthToMidiPanel.classList.toggle("is-disabled", !hasGene)
        synthToMidiPanel.setAttribute("aria-disabled", hasGene ? "false" : "true")
    }
    if (synthToMidiTrackSelect) synthToMidiTrackSelect.disabled = !hasGene
    if (synthToMidiSendBtn) synthToMidiSendBtn.disabled = !(hasGene)
}

function updateSynthGeneUI(GeneID) {
    currentSynthGeneID = GeneID || null
    renderWaveformLabel()

    if (synthToMidiGeneEl) {
        synthToMidiGeneEl.textContent = currentSynthGeneID || "selected gene"
        synthToMidiGeneEl.classList.toggle("is-empty", !currentSynthGeneID)
    }
    setSynthToMidiStatus(null)
    syncSynthToMidiControls()
}

// Gene shown above the waveform; "· Vocal" etc. while the plot follows a jukebox track
function renderWaveformLabel() {
    let label = "No gene selected"
    if (currentSynthGeneID) {
        const track = MIDI_TRACKS.find((t) => t.trackIndex === watchedTrack)
        label = track ? `${currentSynthGeneID} · ${track.label}` : currentSynthGeneID
    }
    if (synthWaveformLabelTextEl) synthWaveformLabelTextEl.textContent = label
    else if (synthWaveformLabelEl) synthWaveformLabelEl.textContent = label
    synthWaveformLabelEl?.classList.toggle("has-gene", Boolean(currentSynthGeneID))
}

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
    setJukeboxOpen(!jukeboxContainer.classList.contains("is-open"))
})

const MIDI_TRACKS = [
    { id: "vocal", label: "Vocal", trackIndex: 0 },
    { id: "synth1", label: "Synth1", trackIndex: 1 },
    { id: "synth2", label: "Synth2", trackIndex: 2 },
    { id: "bass", label: "Bass", trackIndex: 3 },
    { id: "brass", label: "Brass", trackIndex: 4 },
]
const MIDI_FILE = DAT + "NGGYU.mid"
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
            const idSpan = document.createElement(displayMode === "Circadian" ? "button" : "span")
            idSpan.className = "midi-gene-name__id"
            idSpan.textContent = GeneID
            if (displayMode === "Circadian") {
                idSpan.type = "button"
                idSpan.classList.add("midi-gene-name__watch")
                idSpan.setAttribute("aria-pressed", "false")
                idSpan.title = "Show this track's waveform while the song plays"
                idSpan.addEventListener("click", () => watchMidiTrack(trackIndex))
            }

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

// Set when a Circadian / All genes switch empties the jukebox; cleared once a gene is assigned
let midiModeNotice = null

function updateMidiLoadHint() {
    const hint = document.getElementById("midi_load_hint")
    if (!hint) return
    const loaded = midiTrackGenes.size
    const total = MIDI_TRACKS.length
    if (loaded === 0 && midiModeNotice) {
        hint.textContent = midiModeNotice
    } else if (loaded === 0) {
        hint.textContent = "Assign a gene to each track to load its sound. Unloaded tracks stay silent."
    } else if (loaded < total) {
        hint.textContent = `${loaded} of ${total} tracks loaded. Unloaded tracks stay silent until you assign a gene.`
    } else {
        hint.textContent = `${loaded} of ${total} tracks loaded.`
    }
}

// What a jukebox track plays for a gene, from VST like the synth: in Circadian mode a morph
// through its GP draws, otherwise its fixed wavetable. Genes without GP params fall back to fixed.
function trackSourceFor(trackIndex, GeneID) {
    if (!midiNode) return // sent later by syncMidiTrackSources once the worklet exists
    const post = displayMode === "Circadian" ? gpSampler.posterior(GeneID) : null
    if (post) {
        setTrackGP(midiNode, trackIndex, post)
        return
    }
    // Loading is restricted to the current mode, so this means a bug
    if (displayMode === "Circadian") console.warn(`Track ${trackIndex}: ${GeneID} has no GP, playing its fixed table`)
    const VSTrow = VST_lookup.get(GeneID)
    if (VSTrow) setTrackStatic(midiNode, trackIndex, VSTlookup_to_arr(VSTrow))
    else clearTrack(midiNode, trackIndex)
}

function syncMidiTrackSources() {
    for (const [trackIndex, GeneID] of midiTrackGenes) trackSourceFor(trackIndex, GeneID)
}

// Circadian and All genes stay separate in the jukebox: switching mode stops the song and
// empties every track, so tracks only ever hold genes (and sounds) from the current mode
function resetJukebox(mode) {
    midiTransport?.stop() // onStop resets the play button
    clearAllTracks(midiNode)
    unwatchMidiTrack()
    midiTrackGenes.clear()
    midiModeNotice = mode === "Circadian"
        ? "Switched to circadian genes. Assign genes to tracks to load their sound."
        : "Switched to all genes. Assign genes to tracks to load their sound."
    for (const track of MIDI_TRACKS) setMidiTrackLoaded(track.trackIndex, null)
}

// ---- Watching a jukebox track: the waveform plot shows its live GP draws (Circadian) ----
let watchedTrack = null

function setWatchedTrack(trackIndex) {
    watchedTrack = trackIndex
    watchTrack(midiNode, trackIndex)
    for (const [index, el] of midiTrackEls) {
        const btn = el?.querySelector(".midi-gene-name__watch")
        btn?.classList.toggle("is-watched", index === trackIndex)
        btn?.setAttribute("aria-pressed", String(index === trackIndex))
    }
    renderWaveformLabel()
}

function watchMidiTrack(trackIndex) {
    // Select the gene everywhere first (this stops any previous watch), then follow the track
    bus.execute_event("point_select", midiTrackGenes.get(trackIndex))
    setWatchedTrack(trackIndex)
}

function unwatchMidiTrack() {
    if (watchedTrack !== null) setWatchedTrack(null)
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
                if (midiTransport) midiTransport.setEvents(midiEvents, midiSongTime)
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
    if (!geneInMode(GeneID)) {
        setSynthToMidiStatus(displayMode === "Circadian" ? "Not a circadian gene" : "Gene not found", "error")
        return
    }
    bus.execute_event("midi_track_gene", { trackIndex, GeneID })
    const trackLabel =
        MIDI_TRACKS.find((t) => t.trackIndex === trackIndex)?.label || `track ${trackIndex}`
    setSynthToMidiStatus(`Assigned to ${trackLabel}`, "success")
})

function setJukeboxOpen(open) {
    jukeboxContainer?.classList.toggle("is-open", open)
    jukeboxHandle?.setAttribute("aria-expanded", open ? "true" : "false")
}

async function playJukebox() {
    await ensureMidiReady()
    // Sources are already in the worklet: sent on assignment, or by initMidiAudio for earlier ones
    midiTransport.play()
    document.getElementById("midi_play").textContent = "stop"
}

function stopJukebox() {
    if (!midiTransport?.isPlaying) return
    midiTransport.stop()
    document.getElementById("midi_play").textContent = "play"
}

document.getElementById("midi_play").addEventListener("click", async () => {
    await ensureMidiReady()
    if (midiTransport.isPlaying) stopJukebox()
    else await playJukebox()
})

// ------------------------------- Display Mode Switching -------------------------------
let displayMode = "All"

/** Genes the current mode works with: circadian genes have GP params, All = every VST gene. */
function geneInMode(GeneID) {
    return displayMode === "Circadian" ? gpSampler.hasGene(GeneID) : VST_lookup.has(GeneID)
}

function genesForMode() {
    return displayMode === "Circadian" ? gp_params_arr : VST_arr
}

/** Switch gene set ("All" | "Circadian"): syncs the radios, then tells everyone via DisplayModeSet. */
function setDisplayMode(mode) {
    if (mode !== "All" && mode !== "Circadian") return
    displayMode = mode
    const radio = document.querySelector(`input[name="CircadianToggle"][value="${mode}"]`)
    if (radio) radio.checked = true
    bus.execute_event("DisplayModeSet", mode)
}
document.querySelectorAll('input[name="CircadianToggle"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        if (radio.checked) setDisplayMode(radio.value)
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
    // In Circadian mode the worklet samples the GP itself and reports each draw it starts
    // morphing towards, so the plot follows the sound
    synth_node.port.onmessage = (event) => {
        if (event.data.type === "gpDraw" && watchedTrack === null) {
            const color = plotWaveforms.drawSample(event.data.draw)
            harmonics_plot.drawSample(event.data.draw, color) // same color ties the ticks to their curve
        }
    }
    new virtualPiano(synth_node, document.getElementById("Synth_Keyboard_div"), bus)
})().catch((err) => {
    console.error("Synth audio setup failed", err)
})

// Explainer voice: one oscillator shared by the sound explainers (morph explainers, harmonic mixer).
// Connected once; it is silent until an explainer opens its gate.
let explainerNode = null
let explainerReady = null
async function initExplainerAudio() {
    if (!explainerReady) {
        explainerReady = (async () => {
            const ctx = await sharedContext()
            explainerNode = new AudioWorkletNode(ctx, "explainer-voice-processor")
            explainerNode.connect(globalAudio.input)
        })().catch((err) => {
            explainerReady = null
            throw err
        })
    }
    await explainerReady
    await globalAudio.resume()
}

const explainerVoice = {
    ready: initExplainerAudio,
    send: (msg) => explainerNode?.port.postMessage(msg),
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
            // Draws from the watched track feed the waveform and harmonics plots
            midiNode.port.onmessage = (event) => {
                if (event.data.type === "trackDraw" && event.data.trackIndex === watchedTrack) {
                    const color = plotWaveforms.drawSample(event.data.draw)
                    harmonics_plot.drawSample(event.data.draw, color)
                }
            }
            // Genes may have been assigned before the worklet existed — push them now.
            syncMidiTrackSources()
            if (watchedTrack !== null) watchTrack(midiNode, watchedTrack)
        })().catch((err) => {
            midiReady = null
            throw err
        })
    }
    await midiReady
    await globalAudio.resume()
}

// --------------------------------------- Plots ---------------------------------------
const umapReadCounts = plotUMAP(600, 500, allgenes_VST_arr, "read_counts", "Group by Biology", false, bus)
const umapFft = plotUMAP(600, 500, allgenes_fft_arr, "fft", "Group by Sound", false, bus)
const harmonics_plot = plotHarmonics(SPECS, bus)
const plotWaveforms = new plotWaveformsClass()
plotWaveforms.showAll(null)


// GP sampling
const gpSampler = new gpSamplerClass(gp_params_arr, VST_lookup)



// ---- UMAP color modes ----
// What each mode colors by lives in COLOR_MODES (umap/colorModes.js). Here: the buttons, the
// options their menus set, and applyColorMode, which pushes the mode to the UMAPs, violin and panels.

// Data a mode's metric can read (ctx.data in colorModes.js)
const COLOR_DATA = {
    meta: per_gene_meta_lookup,
    gp: gp_params_lookup,
    counts: normalized_counts_lookup,
    specs: SPECS,
}
const DEFAULT_ENERGY_PERIOD = 24
// Set by the buttons' menus
const colorOptions = { oscillatingType: "circadian", energyPeriod: DEFAULT_ENERGY_PERIOD }

// One row per button. A button with several modes turns on the one its menu picks.
const COLOR_BUTTONS = [
    {
        id: "UMAP_oscillation",
        menuId: "UMAP_oscillation_menu",
        modes: ["qval", "circadian"],
        pick: () => colorOptions.oscillatingType,
    },
    { id: "UMAP_phase", modes: ["phase"] },
    { id: "UMAP_energy", menuId: "UMAP_energy_menu", modes: ["energyPct"] },
    { id: "UMAP_waveConf", modes: ["waveConf"] },
]

let umapColorMode = "none"
let colorMetric = COLOR_MODES.none.metric({ displayMode: "All", options: colorOptions, data: COLOR_DATA })

/** Pressed state and open menu follow umapColorMode. */
function syncColorButtons() {
    for (const { id, menuId, modes } of COLOR_BUTTONS) {
        const active = modes.includes(umapColorMode)
        const open = Boolean(menuId) && active
        const btn = document.getElementById(id)
        btn?.setAttribute("aria-pressed", String(active))
        btn?.setAttribute("aria-expanded", String(open))
        const wrap = btn?.closest(".umap-color-choice-wrap")
        if (wrap) wrap.dataset.expanded = open ? "true" : "false"
        const menu = menuId ? document.getElementById(menuId) : null
        if (!menu) continue
        menu.setAttribute("aria-hidden", String(!open))
        if (open) menu.removeAttribute("inert")
        else menu.setAttribute("inert", "")
    }
}

/**
 * Hide choices the gene set doesn't have: buttons and oscillating types whose mode isn't available
 * (COLOR_MODES availableIn), and energy periods the set's spectrum doesn't have (48 h / 16 h in Circadian).
 * A hidden choice that was picked moves to one that is still there.
 */
function syncColorChoicesToGeneSet() {
    for (const { id, modes } of COLOR_BUTTONS) {
        const btn = document.getElementById(id)
        if (btn) btn.hidden = !modes.some((m) => isModeAvailable(m, displayMode))
    }
    for (const radio of document.querySelectorAll('input[name="oscillating_type"]')) {
        radio.closest("label").hidden = !isModeAvailable(radio.value, displayMode)
    }
    colorOptions.oscillatingType = modeForGeneSet(colorOptions.oscillatingType, displayMode)
    checkRadio("oscillating_type", colorOptions.oscillatingType)

    const spec = SPECS[displayMode]
    for (const radio of document.querySelectorAll('input[name="oscillation_energy"]')) {
        radio.closest("label").hidden = !hasPeriod(spec, radio.value)
    }
    if (!hasPeriod(spec, colorOptions.energyPeriod)) colorOptions.energyPeriod = DEFAULT_ENERGY_PERIOD
    checkRadio("oscillation_energy", colorOptions.energyPeriod)

    umapColorMode = modeForGeneSet(umapColorMode, displayMode)
}

function checkRadio(name, value) {
    const radio = document.querySelector(`input[name="${name}"][value="${value}"]`)
    if (radio) radio.checked = true
}

function setUmapColorMode(mode) {
    umapColorMode = mode
    applyColorMode()
}

/**
 * Push the current mode everywhere: write every point's metricVal (all four embeddings, so a gene-set
 * switch stays in sync), color the UMAPs, rebuild the violin, then the help text and gene panels.
 * Call after the mode, its options or the gene set change.
 */
function applyColorMode() {
    const def = COLOR_MODES[umapColorMode]
    const ctx = { displayMode, options: colorOptions, data: COLOR_DATA }
    colorMetric = def.metric(ctx)

    for (const arr of [allgenes_VST_arr, allgenes_fft_arr, circadian_VST_arr, circadian_fft_arr]) {
        for (const d of arr) d.metricVal = colorMetric.valueOf(d.GeneID)
    }
    // Scales and the violin span the genes currently on the map
    const shownArr = displayMode === "Circadian" ? circadian_VST_arr : allgenes_VST_arr
    const values = shownArr.map((d) => d.metricVal).filter(Number.isFinite)

    syncColorButtons()
    bus.execute_event("umap_color_scale", def.scale(ctx, values))
    swapViolin(values)
    updateColorModeHelp()
    refreshUmapGenePanels()
}

// ---- Violin / filter: shows (and filters on) whatever the UMAPs are colored by ----
const violinDiv = d3.select("#filter_slider")
let violin = null // handle of the violin on screen ({ domain, setRange, node }); replaced on every swap

// Phones: the violin stacks between the two UMAPs, so it lies flat and spans the full width
const phoneLayout = window.matchMedia("(max-width: 520px)")

function swapViolin(values){
    // keep non-plot children (e.g. the help button)
    violinDiv.selectAll(":scope > svg").remove()
    const horizontal = phoneLayout.matches
    const [width, height, margin] = horizontal
        ? [violinDiv.node().clientWidth, 170, { top: 36, right: 18, bottom: 44, left: 18 }] // top clears the help button
        : [130, 500, { top: 20, right: 20, bottom: 20, left: 50 }]
    violin = plotViolin(
        width, height, margin,
        values, violinDiv, colorMetric.label, bus, "umap_value_filter", null, null,
        { levels: colorMetric.levels ?? null, horizontal }
    )
    // New metric, new units: the old scrubber range is meaningless, so clear the filter
    bus.execute_event("umap_value_filter", [Infinity, -Infinity])
}

// Crossing the phone breakpoint flips the violin (rebuilding it clears the filter, like a mode change)
phoneLayout.addEventListener("change", () => applyColorMode())

// Clicking a button toggles its mode; its menu stays open while the mode is on
for (const { id, modes, pick } of COLOR_BUTTONS) {
    document.getElementById(id)?.addEventListener("click", () => {
        setUmapColorMode(modes.includes(umapColorMode) ? "none" : (pick?.() ?? modes[0]))
    })
}

document.querySelectorAll('input[name="oscillating_type"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        if (!radio.checked) return
        colorOptions.oscillatingType = radio.value
        setUmapColorMode(radio.value)
    })
})

document.querySelectorAll('input[name="oscillation_energy"]').forEach((radio) => {
    radio.addEventListener("change", () => {
        if (!radio.checked) return
        colorOptions.energyPeriod = Number(radio.value)
        setUmapColorMode("energyPct")
    })
})

// ---- Color-mode hint box: text per coloring mode, per gene set (COLOR_MODES help) ----
function updateColorModeHelp() {
    const el = document.getElementById("color_mode_help_text")
    if (!el) return
    el.textContent = COLOR_MODES[umapColorMode]?.help?.[displayMode] ?? ""
    el.hidden = !el.textContent
}

// -------------------------------------------- DEMO --------------------------------------------
const DEMO_ENERGY_PERIOD = "24"
const DEMO_WINDOW_FRACTION = 0.1 // window height as a share of the violin's range (10 points of a 0–100% scale)
const DEMO_SWEEP_MS = 4000
const DEMO_CHORD = ["a", "d", "f", "h"]
const DEMO_CIRCADIAN_GENES = ["AT1G21810", "AT5G45010", "AT5G25810"]
const DEMO_ALL_GENES = ["AT1G73220", "AT1G78600", "AT5G46400"]
// [gene, track index] loaded into the jukebox (All genes mode, since the demo ends there)
const DEMO_TRACKS = [["AT5G46400", 1], ["AT1G78600", 2], ["AT1G73220", 3]]

// Set while a demo runs; aborting it makes every pending delay / animation in runDemo throw
let demoAbort = null

const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
const scrollToEl = (id, block = "start") =>
    document.getElementById(id)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block })

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason)
        const timer = setTimeout(resolve, ms)
        signal?.addEventListener("abort", () => {
            clearTimeout(timer)
            reject(signal.reason)
        }, { once: true })
    })
}

function scrollSettled(signal, timeout = 1000) {
    return new Promise((resolve, reject) => {
        const done = () => {
            clearTimeout(timer)
            window.removeEventListener("scrollend", done)
            resolve()
        }
        const timer = setTimeout(done, timeout)
        window.addEventListener("scrollend", done)
        signal.addEventListener("abort", () => {
            done()
            reject(signal.reason)
        }, { once: true })
    })
}

// Calls step(ease(t)) every frame for ms, t: 0→1
function animateFor(ms, ease, step, signal) {
    return new Promise((resolve, reject) => {
        const timer = d3.timer((elapsed) => {
            const t = Math.min(1, elapsed / ms)
            step(ease(t))
            if (t === 1) {
                timer.stop()
                resolve()
            }
        })
        signal.addEventListener("abort", () => {
            timer.stop()
            reject(signal.reason)
        }, { once: true })
    })
}

// Pulse an element's border (.demo-glow in styles.css) to point the viewer at it
const glow = (selector) => document.querySelector(selector)?.classList.add("demo-glow")
const unglow = (selector) => document.querySelector(selector)?.classList.remove("demo-glow")
const clearGlows = () => document.querySelectorAll(".demo-glow").forEach((el) => el.classList.remove("demo-glow"))

const pressChord = () => DEMO_CHORD.forEach((key) => bus.execute_event("synthetic_keyDown", key))
const releaseChord = () => DEMO_CHORD.forEach((key) => bus.execute_event("synthetic_keyUp", key))

// What the page looks like on load: All genes, nothing selected, no coloring, jukebox empty and closed
function resetToDefault() {
    clearGlows()
    releaseChord()
    stopJukebox()
    setJukeboxOpen(false)
    bus.execute_event("point_select", null)
    setDisplayMode("All") // also empties the jukebox and rebuilds the violin
    colorOptions.energyPeriod = DEFAULT_ENERGY_PERIOD
    checkRadio("oscillation_energy", DEFAULT_ENERGY_PERIOD)
    setUmapColorMode("none") // rebuilds the violin at full range and clears the filter
    scrollToEl("Synth_Waveform_container")
}

function stopDemo() {
    if (!demoAbort) return
    demoAbort.abort()
    demoAbort = null
    resetToDefault()
}

// Holds the chord while selecting each gene in turn
async function playGenes(genes, signal) {
    scrollToEl("Synth_Keyboard_div", "center")
    await delay(1000, signal)
    pressChord()
    await delay(1000, signal)

    scrollToEl("fft")
    glow("#read_counts")
    glow("#fft")
    await delay(2000, signal)
    for (const GeneID of genes) {
        bus.execute_event("point_select", GeneID)
        await delay(2000, signal)
    }
    unglow("#read_counts")
    unglow("#fft")
    releaseChord()
}

// Same steps a user takes: select the gene, pick the track, press Assign
async function assignTrack(GeneID, trackIndex, signal, speed) {
    let long_wait = null
    let short_wait = null
    if (speed === "slow"){
        long_wait = 800
        short_wait = 600
    } else {
        long_wait = 2000
        short_wait = 600
    }

    glow(".synth-to-jukebox__gene")
    await delay(long_wait, signal)
    bus.execute_event("point_select", GeneID)
    await delay(short_wait, signal)
    unglow(".synth-to-jukebox__gene")

    glow(".synth-to-jukebox__select")
    await delay(long_wait, signal)
    synthToMidiTrackSelect.value = String(trackIndex)
    await delay(short_wait, signal)
    unglow(".synth-to-jukebox__select")

    glow("#send_waveform_to_midi")
    await delay(long_wait, signal)
    synthToMidiSendBtn.click()
    await delay(short_wait, signal)
    unglow("#send_waveform_to_midi")

    speed = "fast"
}

// const testing = new AbortController()
// console.log(testing.signal)
// testing.abort()
// console.log(testing.signal)

async function runDemo() {
    stopDemo()
    const controller = new AbortController()
    demoAbort = controller
    const { signal } = controller

    try {
        // Step 1: All vs Circadian gene sets
        scrollToEl("gene_set_label")
        await scrollSettled(signal)
        glow(".gene-set-toggle__options")
        await delay(2000, signal)
        for (const mode of ["All", "Circadian", "All", "Circadian"]) {
            setDisplayMode(mode)
            await delay(800, signal)
        }
        unglow(".gene-set-toggle__options")

        // Step 2: cycle the UMAP color options
        glow(".capsule-toggle")
        await delay(2000, signal)
        for (const mode of ["qval", "phase", "energyPct", "waveConf", "phase"]) {
            setUmapColorMode(mode)
            await delay(1000, signal)
        }
        unglow(".capsule-toggle")
        // Step 3: sweep the violin filter up through % 24 h energy
        scrollToEl("filter_slider")
        glow("#filter_slider")
        await delay(2000, signal)


        const v = violin
        const [ymin, ymax] = v.domain
        const windowSize = (ymax - ymin) * DEMO_WINDOW_FRACTION
        const top = ymax - windowSize
        v.setRange(ymin, ymin + windowSize, { animate: true })
        await delay(500, signal) // let the 400 ms scrubber transition finish before driving it per frame
        await animateFor(DEMO_SWEEP_MS, d3.easeCubicInOut, (t) => {
            const low = ymin + t * (top - ymin)
            v.setRange(low, low + windowSize)
        }, signal)
        await delay(400, signal)
        v.setRange(ymin, ymax, { animate: true })
        unglow("#filter_slider")
        // Step 4: play circadian genes, then all genes
        
        await playGenes(DEMO_CIRCADIAN_GENES, signal)

        scrollToEl("gene_set_label")
        glow(".gene-set-toggle__options")
        await delay(1300, signal)
        
        setDisplayMode("All")
        await delay(1000, signal)
        glow(".gene-set-toggle__options")

        await playGenes(DEMO_ALL_GENES, signal)

        // Step 5: load genes into the jukebox and play the song
        scrollToEl("pushSound", "center")
        glow("#pushSound")
        await delay(2000, signal)
        unglow("#pushSound")
        let speed = "slow"
        for (const [GeneID, trackIndex] of DEMO_TRACKS) await assignTrack(GeneID, trackIndex, signal, speed)

        glow("#midi_handle")
        await delay(2000, signal)
        setJukeboxOpen(true)
        unglow("#midi_handle")
        await delay(1000, signal)
        await playJukebox()
        await delay(8000, signal)
        stopJukebox()
        await delay(1000, signal)
    } catch (err) {
        if (signal.aborted) return // stopDemo already reset the page
        throw err
    }

    // Natural finish: same reset as an interruption
    if (demoAbort === controller) stopDemo()
}

// Intro button and the inline link in How To
for (const el of document.querySelectorAll("[data-demo]")) el.addEventListener("click", runDemo)

// Real user input mid-demo stops it and resets the page (synthetic events have isTrusted = false).
// Mouse, pen and keys stop it on press. A finger only stops it when it picks something: grabbing a
// drag surface (touch-action: none, e.g. the UMAPs, violin, sliders) stops it on touch, and tapping a
// control stops it on click, which the browser doesn't fire when the finger scrolled.
// Capture phase so it runs first; a grab on the violin is swallowed so d3-drag doesn't start on a
// violin the reset is about to replace (d3-drag starts on mousedown / touchstart).
const TAPPABLE = 'a, button, input, select, textarea, label, summary, [role="button"], #Synth_Keyboard_div'
const TOUCH_MOUSE_GRACE_MS = 1000 // browsers send compatibility mouse events after a tap
let lastTouchTime = -Infinity

function isDragSurface(el) {
    if (el.closest?.('input[type="range"]')) return true
    for (let node = el; node instanceof Element; node = node.parentElement) {
        if (getComputedStyle(node).touchAction === "none") return true
    }
    return false
}

function stopDemoFrom(e) {
    if (violinDiv.node()?.contains(e.target) && e.target.closest("svg")) e.stopPropagation()
    stopDemo()
}

const demoInterrupts = {
    pointerdown: (e) => {
        if (e.pointerType === "touch") {
            lastTouchTime = e.timeStamp
            if (!isDragSurface(e.target)) return // could be a scroll; a tap is caught on click
        }
        stopDemoFrom(e)
    },
    touchstart: (e) => {
        lastTouchTime = e.timeStamp
        if (isDragSurface(e.target)) stopDemoFrom(e)
    },
    mousedown: (e) => {
        if (e.timeStamp - lastTouchTime < TOUCH_MOUSE_GRACE_MS) return // a tap's compatibility event
        stopDemoFrom(e)
    },
    click: (e) => {
        if (e.timeStamp - lastTouchTime < TOUCH_MOUSE_GRACE_MS && e.target.closest(TAPPABLE)) stopDemo()
    },
    keydown: stopDemoFrom,
}
for (const [type, handler] of Object.entries(demoInterrupts)) {
    window.addEventListener(type, (e) => {
        if (demoAbort && e.isTrusted) handler(e)
    }, { capture: true, passive: type === "touchstart" ? true : undefined })
}

setupHelpPopUps(document, window)
setupFoldBackToTop(document, window)

// --------------------------------------- Sound explainers ---------------------------------------
const TOC1 = VSTlookup_to_arr(VST_lookup.get("AT5G61380"))
const PP2AA3 = VSTlookup_to_arr(VST_lookup.get("AT1G13320"))
const expressionHost = document.getElementById("Expression_Explainer_plot")
if (expressionHost) plotExpressionExplainer(expressionHost, { TOC1, PP2AA3 })
// One owner for both, so starting one explainer stops the other
const explainerVoiceOwner = createVoiceOwner(explainerVoice)
mountMorphExplainers(document.getElementById("Morph_Explainers"), explainerVoiceOwner)
mountHarmonicMixer(
    document.getElementById("Harmonic_Mixer"),
    explainerVoiceOwner,
    bus,
    [...document.querySelectorAll(".mixer-presets [data-levels]")],
)
mountHarmonicsTable(document.getElementById("Harmonics_Table"))

// Example sounds in Discussion: each button switches gene set and selects its gene
const soundExampleBtns = document.querySelectorAll(".sound-examples__btn")
soundExampleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        setDisplayMode(btn.closest(".sound-examples").dataset.mode)
        bus.execute_event("point_select", btn.dataset.geneId)
    })
})
bus.subscribe_to("point_select", "sound_examples", (geneId) => {
    soundExampleBtns.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.geneId === geneId)))
})

// --------------------------------------- Search Bars ---------------------------------------
// Each search only offers genes from the current mode (lists swapped on DisplayModeSet)
const geneSearches = []
geneSearches.push(searchbar(
    document.querySelector("#synth-search"),
    document.querySelector("#synth-results"),
    genesForMode(),
    (item) => {
        bus.execute_event("point_select", item.GeneID)
    }
))

// MIDI track gene search
for (const track of MIDI_TRACKS) {
    setMidiTrackLoaded(track.trackIndex, null) // start unloaded
    geneSearches.push(searchbar(
        document.querySelector(`#midi-${track.id}-search`),
        document.querySelector(`#midi-${track.id}-results`),
        genesForMode(),
        (item) => {
            bus.execute_event("midi_track_gene", {
                trackIndex: track.trackIndex,
                GeneID: item.GeneID,
            })
        }
    ))
}

// --------------------------------------- Bus subscriptions ---------------------------------------
bus.subscribe_to("midi_track_gene", "main", ({ trackIndex, GeneID }) => {
    if (trackIndex === watchedTrack) unwatchMidiTrack() // its gene is being removed or replaced
    if (!GeneID) {
        midiTrackGenes.delete(trackIndex)
        setMidiTrackLoaded(trackIndex, null)
        clearTrack(midiNode, trackIndex)
        return
    }
    midiModeNotice = null
    midiTrackGenes.set(trackIndex, GeneID)
    setMidiTrackLoaded(trackIndex, GeneID)
    trackSourceFor(trackIndex, GeneID)
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


function updateUmapGenePanel(panel, geneId) {
    const hasGene = Boolean(geneId)
    panel.root?.classList.toggle("is-empty", !hasGene)
    if (panel.geneId) panel.geneId.textContent = hasGene ? geneId : "—"

    if (!panel.metric) return
    // Uncolored map: nothing extra to show
    if (umapColorMode === "none") {
        panel.metric.hidden = true
        if (panel.metricLabel) panel.metricLabel.textContent = ""
        if (panel.metricValue) panel.metricValue.textContent = "—"
        return
    }
    panel.metric.hidden = false
    if (panel.metricLabel) panel.metricLabel.textContent = colorMetric.short
    if (panel.metricValue) panel.metricValue.textContent = hasGene ? colorMetric.format(colorMetric.valueOf(geneId)) : "—"
}

function refreshUmapGenePanels() {
    updateUmapGenePanel(umapGenePanels.hover, umapHoverGeneId)
    updateUmapGenePanel(umapGenePanels.selected, umapSelectedGeneId)
}

// Circadian mode: GP posterior for the gene, and posterior draws feed the synth.
// Genes without GP params (not circadian) show an empty band.
function showGPWaveform(GeneID){
    const post = GeneID ? gpSampler.posterior(GeneID) : null // null for non-circadian genes
    const dat_points = VST_lookup.get(GeneID)
    plotWaveforms.showGP(post?.mu ?? null, post?.std ?? null, dat_points? VSTlookup_to_arr(dat_points):null)
    // Copied, not transferred: the posterior stays cached for reuse (e.g. jukebox tracks)
    if (post) synth_node?.port.postMessage({ type: "setGP", mu: post.mu, L: post.L })
    else synth_node?.port.postMessage({ type: "clearSource" })
}

// All genes mode: experimental points and the interpolated wavetable the synth plays
function showAllWaveform(GeneID){
    const VSTrow = GeneID ? VST_lookup.get(GeneID) : null
    if (!VSTrow) {
        plotWaveforms.showAll(null)
        synth_node?.port.postMessage({ type: "clearSource" })
        return
    }
    const values = VSTlookup_to_arr(VSTrow)
    plotWaveforms.showAll(values)
    synth_node?.port.postMessage({ type: "setStatic", points: values })
}

function updateWaveformDisplay(){
    if (displayMode === "Circadian") showGPWaveform(umapSelectedGeneId)
    else showAllWaveform(umapSelectedGeneId)
}

bus.subscribe_to("point_select", "main", (GeneID) => {
    unwatchMidiTrack() // watchMidiTrack re-watches right after its own point_select
    updateSynthGeneUI(GeneID)
    umapSelectedGeneId = GeneID || null
    updateUmapGenePanel(umapGenePanels.selected, umapSelectedGeneId)
    updateWaveformDisplay()
})

bus.subscribe_to("point_hover", "main", (GeneID) => {
    umapHoverGeneId = GeneID || null
    updateUmapGenePanel(umapGenePanels.hover, umapHoverGeneId)
})

bus.subscribe_to("DisplayModeSet", "main", (mode) => {
    resetJukebox(mode)
    for (const search of geneSearches) search.setGenes(genesForMode())
    // A selected gene that isn't circadian has nothing to show or play in Circadian mode
    if (umapSelectedGeneId && !geneInMode(umapSelectedGeneId)) bus.execute_event("point_select", null)
    // Metric fields and scale ranges depend on the gene set; recolor before the UMAPs redraw on the new points
    syncColorChoicesToGeneSet()
    applyColorMode()
    if (mode === "All") {
        umapReadCounts.setData(allgenes_VST_arr)
        umapFft.setData(allgenes_fft_arr)
    } else if (mode === "Circadian") {
        umapReadCounts.setData(circadian_VST_arr)
        umapFft.setData(circadian_fft_arr)
    }
    // Tints the synth panel and jukebox (see .gene-set-scope in styles.css) so the switch to a different dataset is obvious
    for (const el of document.querySelectorAll(".gene-set-scope")) el.dataset.geneSet = mode
    syncSynthToMidiControls() // Assign depends on whether the gene is in the new mode
    updateWaveformDisplay()
})

// Initial coloring (none): violin on mean expression, hint text, gene panels
syncColorChoicesToGeneSet()
applyColorMode()
