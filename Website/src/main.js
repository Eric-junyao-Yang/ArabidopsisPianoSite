import { plotUMAP, selectedEnergyPeriodHours } from "/src/plots/plotUMAP.js"
import { PEAK_HOUR_FIELD, phaseField, qvalField } from "/src/umap/umapColors.js"
import { bin_to_array } from "/src/binHelper.js"
import { plotViolin } from "/src/plots/plotViolin.js"
import { plotWaveformsClass } from "/src/plots/plotWaveforms.js"
import { mountSynthScienceDiv } from "/src/synthScienceDiv.js"
import { setupHelpPopUps } from "/src/helpPopup.js"
import { virtualPiano } from "/src/virtualPiano.js"
import { searchbar } from "/src/searchbar.js"
import { initGlobalAudio } from "/src/audio/globalVolumeControl.js"
import {
    loadMidiEvents,
    createMidiTransport,
    setTrackStatic,
    setTrackGP,
    clearTrack,
    clearAllTracks,
    watchTrack,
} from "/src/midiplayer.js"
import { midiTrackPlots } from "/src/plots/midiTrackPlot.js"
import { plotHarmonics, energyPctAtPeriod } from "/src/plots/plotHarmonics.js"
import { gpSamplerClass, VSTlookup_to_arr, EXP_HOURS } from "/src/GaussianProcess/GPalgo.js"

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
const globalAudio = initGlobalAudio({ workletUrl: "/src/audio/audio_processor.js" })

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
const gp_params_lookup = new Map(gp_params_arr.map((val) => [val.GeneID, val]))
// GP fit quality rides along with the other per-gene metrics, so UMAP coloring reads it from meta
for (const { GeneID, relative_std } of gp_params_arr) {
    const meta = per_gene_meta_lookup.get(GeneID)
    if (meta) meta.gp_relative_std = relative_std
}
// Peak time = sample hour of the highest measurement, no period fitting or folding. It can only be
// one of the 16 sample hours, so the violin shows it as bars (see violinMetric's levels). All genes only;
// Circadian mode keeps MetaCycle phase (see phaseField).
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
        // Only reached after load, once MIDI_TRACKS / watchedTrack (declared further down) exist
        const track = MIDI_TRACKS.find((t) => t.trackIndex === watchedTrack)
        label = track ? `${currentSynthGeneID} · ${track.label}` : currentSynthGeneID
    }
    if (synthWaveformLabelTextEl) synthWaveformLabelTextEl.textContent = label
    else if (synthWaveformLabelEl) synthWaveformLabelEl.textContent = label
    synthWaveformLabelEl?.classList.toggle("has-gene", Boolean(currentSynthGeneID))
}

function applySynthPreset(fn) {
    fn()
    // Presets / reset leave the gene data behind — clear selection so UI matches the sound.
    bus.execute_event("point_select", null)
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
            // Circadian: clicking the gene shows it in the waveform plot with this track's live draws
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
        if (event.data.type === "gpDraw" && watchedTrack === null) plotWaveforms.drawSample(event.data.draw)
    }
    new virtualPiano(synth_node, document.getElementById("Synth_Keyboard_div"), bus)
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

// The demo plots publish their animated wave every frame while their button is playing
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

// The worklet never stops generating, so silence it by unplugging it
bus.subscribe_to("stopSlideSound", "main", () => {
    if (synthSlides_node && synthSlideDestinationConnection) {
        synthSlides_node.disconnect(globalAudio.input)
        synthSlideDestinationConnection = false
    }
})

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
            // Draws from the watched track feed the waveform plot
            midiNode.port.onmessage = (event) => {
                if (event.data.type === "trackDraw" && event.data.trackIndex === watchedTrack) {
                    plotWaveforms.drawSample(event.data.draw)
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
const umapReadCounts = plotUMAP(600, 500, allgenes_VST_arr, per_gene_meta, specs_lookup, "read_counts", "Group by Biology", false, bus)
const umapFft = plotUMAP(600, 500, allgenes_fft_arr, per_gene_meta, specs_lookup, "fft", "Group by Sound", false, bus)
plotHarmonics(specs_lookup, bus)
const plotWaveforms = new plotWaveformsClass()
plotWaveforms.showAll(null)


// GP sampling
const gpSampler = new gpSamplerClass(gp_params_arr, VST_lookup)



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
    { id: "UMAP_waveConf", isActive: (m) => m === "waveConf" },
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

/**
 * Color choices that only make sense for one gene set:
 * - waveform confidence needs a GP fit, so Circadian only
 * - the binary "circadian" split is trivial when every gene shown is circadian, so All only
 * Moves the color mode off a choice that just disappeared.
 */
function syncColorChoicesToGeneSet(mode) {
    const circadian = mode === "Circadian"
    document.getElementById("UMAP_waveConf").hidden = !circadian
    document.getElementById("oscillating_type_circadian").hidden = circadian
    if (circadian) {
        const qvalRadio = document.querySelector('input[name="oscillating_type"][value="qval"]')
        if (qvalRadio) qvalRadio.checked = true
    }

    if (circadian && umapColorMode === "circadian") setUmapColorMode("qval")
    else if (!circadian && umapColorMode === "waveConf") setUmapColorMode("none")
}
// ---- Violin / filter: shows (and filters on) whatever the UMAPs are colored by ----
// "none" and "circadian" (binary) fall back to mean expression.
function violinMetric(mode){
    if (mode === "qval") {
        const field = qvalField(displayMode)
        return {
            label: `−log10 q (${displayMode === "Circadian" ? "MetaCycle" : "LS"})`,
            valueOf: (GeneID) => {
                const q = per_gene_meta_lookup.get(GeneID)?.[field]
                return Number.isFinite(q) ? -Math.log10(Math.max(q, 1e-300)) : NaN
            },
        }
    }
    if (mode === "phase") {
        const field = phaseField(displayMode)
        const isRawPeak = field === PEAK_HOUR_FIELD
        return {
            label: isRawPeak ? "peak hour (h)" : "MetaCycle peak (h)",
            valueOf: (GeneID) => per_gene_meta_lookup.get(GeneID)?.[field] ?? NaN,
            levels: isRawPeak ? EXP_HOURS : null, // only the raw peak is limited to sample hours
        }
    }
    if (mode === "energyPct") {
        const period = selectedEnergyPeriodHours()
        return {
            label: `% ${period}h energy`,
            valueOf: (GeneID) => energyPctAtPeriod(GeneID, specs_lookup, period) ?? NaN,
        }
    }
    if (mode === "waveConf") {
        return {
            label: "relative std",
            valueOf: (GeneID) => gp_params_lookup.get(GeneID)?.relative_std ?? NaN,
        }
    }
    return {
        label: "log10(mean TPM)",
        valueOf: (GeneID) => normalized_counts_lookup.get(GeneID)?.log_TPM ?? NaN,
    }
}

const violinDiv = d3.select("#filter_slider")
let violin = null // handle of the violin on screen ({ domain, setRange, node }); replaced on every swap

function swapViolin(mode){
    const { label, valueOf, levels = null } = violinMetric(mode)

    // UMAP points filter on filterVal; set it on every embedding so a later mode switch stays in sync
    for (const arr of [allgenes_VST_arr, allgenes_fft_arr, circadian_VST_arr, circadian_fft_arr]) {
        for (const d of arr) d.filterVal = valueOf(d.GeneID)
    }

    // Distribution of the genes currently on the map
    const shownArr = displayMode === "Circadian" ? circadian_VST_arr : allgenes_VST_arr
    const values = shownArr.map((d) => d.filterVal).filter(Number.isFinite)

    // keep non-plot children (e.g. the help button)
    violinDiv.selectAll(":scope > svg").remove()
    // Shorter on phones, where the violin stacks between the two UMAPs
    const violinHeight = window.innerWidth <= 520 ? 320 : 500
    violin = plotViolin(
        130, violinHeight, { top: 20, right: 20, bottom: 20, left: 50 },
        values, violinDiv, label, bus, "umap_value_filter", null, null, { levels }
    )
    // New metric, new units: the old scrubber range is meaningless, so clear the filter
    bus.execute_event("umap_value_filter", [Infinity, -Infinity])
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
document.getElementById("UMAP_waveConf")?.addEventListener("click", () => {
    setUmapColorMode(umapColorMode === "waveConf" ? "none" : "waveConf")
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

// umap_color_mode also fires when the energy period or oscillating type changes within a mode
bus.subscribe_to("umap_color_mode", "violin", swapViolin)
swapViolin(umapColorMode)

// ---- Color-mode hint box: text per coloring mode, per gene set ----
const COLOR_MODE_HELP = {
    none: { All: "Color Mode Help Text", Circadian: "Color Mode Help Text" },
    circadian: { 
        All: "Binary cutoff with q-value of 0.01. Circadian is <= 0.01", 
        Circadian: "Binary cutoff with q-value of 0.01. Circadian is <= 0.01" },
    qval: { 
        All: "How confident we are that a gene is oscillating. A q-value cut off of 0.01 would mean a 1% false discovery rate when calling an oscillating gene.", 
        Circadian: "How confident we are that a gene is oscillating around 20~28hrs (Circadian). A q-value cut off of 0.01 would mean a 1% false positive rate when calling a circadian gene." },
    phase: { 
        All: "The sample hour at which the gene's measured expression is highest.", 
        Circadian: "Within the detected period (20~28 hrs), the hour at which the fitted MetaCycle curve peaks."},
    energyPct: { 
        All: "% composition of the selected frequency component", 
        Circadian: "% composition of the selected frequency component" },
    waveConf: { All: "", Circadian: 'A metric for "spread" of the sampled wave.'},
}

function updateColorModeHelp() {
    const el = document.getElementById("color_mode_help_text")
    if (!el) return
    el.textContent = COLOR_MODE_HELP[umapColorMode]?.[displayMode] ?? ""
    el.hidden = !el.textContent
}
bus.subscribe_to("umap_color_mode", "colorModeHelp", updateColorModeHelp)
bus.subscribe_to("DisplayModeSet", "colorModeHelp", updateColorModeHelp)
updateColorModeHelp()

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
    oscillation_energy = "24"
    const periodRadio = document.querySelector('input[name="oscillation_energy"][value="24"]')
    if (periodRadio) periodRadio.checked = true
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

// Any real user input mid-demo stops it and resets the page (synthetic events have isTrusted = false).
// Capture phase so it runs first; a grab on the violin is swallowed so d3-drag doesn't start on a
// violin the reset is about to replace (d3-drag starts on mousedown / touchstart).
for (const type of ["pointerdown", "mousedown", "touchstart", "keydown"]) {
    window.addEventListener(type, (e) => {
        if (!demoAbort || !e.isTrusted) return
        if (violinDiv.node()?.contains(e.target) && e.target.closest("svg")) e.stopPropagation()
        stopDemo()
    }, { capture: true, passive: type === "wheel" || type === "touchstart" ? true : undefined })
}

setupHelpPopUps(document, window)

// --------------------------------------- Synth science fold ---------------------------------------
const TOC1 = VSTlookup_to_arr(VST_lookup.get("AT5G61380"))
const PP2AA3 = VSTlookup_to_arr(VST_lookup.get("AT1G13320"))
mountSynthScienceDiv({
    root: document.getElementById("Synth_Science_div"),
    geneRows: {TOC1, PP2AA3},
    bus,
    initAudio: initSynthScienceAudio,
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

function formatUmapNumber(value, digits = 2) {
    if (value == null || !Number.isFinite(Number(value))) return "—"
    const n = Number(value)
    if (Math.abs(n) > 0 && Math.abs(n) < 1e-3) return n.toExponential(2)
    return n.toFixed(digits)
}

function umapMetricForMode(mode, geneId) {
    if (!OSCILLATING_MODES.has(mode) && !["phase", "energyPct", "waveConf"].includes(mode)) return null
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
        if (useMetaCycle) {
            const phase = formatUmapNumber(meta?.metacycle_phase, 2)
            return { label: "MetaCycle peak", value: phase === "—" ? phase : `${phase} h` }
        }
        const peak = meta?.[PEAK_HOUR_FIELD]
        return { label: "peak hour", value: Number.isFinite(peak) ? `${peak} h` : "—" }
    }
    if (mode === "waveConf") {
        return { label: "relative std", value: formatUmapNumber(meta?.gp_relative_std, 3) }
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

bus.subscribe_to("umap_color_mode", "main", () => {
    refreshUmapGenePanels()
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
    if (mode === "All") {
        umapReadCounts.setData(allgenes_VST_arr, "All")
        umapFft.setData(allgenes_fft_arr, "All")
    } else if (mode === "Circadian") {
        umapReadCounts.setData(circadian_VST_arr, "Circadian")
        umapFft.setData(circadian_fft_arr, "Circadian")
    }
    syncColorChoicesToGeneSet(mode)
    // Tints the synth panel and jukebox (see .gene-set-scope in styles.css) so the switch to a different dataset is obvious
    for (const el of document.querySelectorAll(".gene-set-scope")) el.dataset.geneSet = mode
    syncSynthToMidiControls() // Assign depends on whether the gene is in the new mode
    refreshUmapGenePanels()
    updateWaveformDisplay()
    swapViolin(umapColorMode) // gene set and LS vs MetaCycle fields changed
})
