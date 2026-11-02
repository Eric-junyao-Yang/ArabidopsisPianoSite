import { toUnipolarWavetable, ldTimepoints } from "/src/catmullrom.js"
import { Midi } from "https://esm.sh/@tonejs/midi@2.0.28"

const LOOKAHEAD_SEC = 0.1
const SCHEDULER_MS = 25
const A4_MIDI = 69
const A4_HZ = 440

export function midiToFreq(midiNote) {
    return A4_HZ * 2 ** ((midiNote - A4_MIDI) / 12)
}

export function geneToWavetable(GeneID, normalized_counts_lookup, tableSize = 2048) {
    const item = normalized_counts_lookup.get(GeneID)
    if (!item) return null
    return toUnipolarWavetable(ldTimepoints(item), tableSize)
}

export async function loadMidiEvents(filePath, maxTracks = Infinity) {
    const response = await fetch(filePath)
    if (!response.ok) throw new Error(`Failed to load MIDI: ${filePath} (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const midi = new Midi(bytes)

    const events = []
    midi.tracks.forEach((track, trackIndex) => {
        if (trackIndex >= maxTracks) return
        for (const n of track.notes) {
            events.push({
                time: n.time,
                duration: n.duration,
                midi: n.midi,
                velocity: n.velocity,
                trackIndex,
            })
        }
    })
    events.sort((a, b) => a.time - b.time || a.trackIndex - b.trackIndex)

    return {
        events,
        duration: midi.duration,
        trackCount: Math.min(midi.tracks.length, maxTracks),
    }
}

/** First index with event.time >= t (events are sorted by time). */
function lowerBoundByTime(events, t) {
    let lo = 0
    let hi = events.length
    while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (events[mid].time < t) lo = mid + 1
        else hi = mid
    }
    return lo
}

/**
 * Lookahead scheduler that drives noteOn messages into the MIDI AudioWorklet.
 * Uses AudioContext.currentTime as the clock; setInterval for the schedule loop.
 */
export function createMidiTransport(midiCtx, midiNode, { onStop } = {}, bus) {
    let events = []
    let playHead = 0
    let songStartAudioTime = 0
    let songPosition = 0 // song time (sec) when stopped / last seek
    let timerId = null
    let noteSerial = 0
    let totalSongTime = 0
    let isScrubbing = false

    const timeDisplayEl = document.getElementById("midi_time_display")
    const totalSongTimeEl = document.getElementById("midi_total_time")
    const progressBarEl = document.getElementById("midi_progress_bar")

    function clearTimer() {
        if (timerId != null) {
            clearInterval(timerId)
            timerId = null
        }
    }

    function formatClock(time) {
        const safe = Math.max(0, Number(time) || 0)
        const minutes = Math.floor(safe / 60)
        const seconds = Math.floor(safe % 60)
        return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    }

    function getSongTime() {
        if (timerId != null) return midiCtx.currentTime - songStartAudioTime
        return songPosition
    }

    function setScrubberFill(songTime) {
        if (!progressBarEl) return
        const pct = totalSongTime > 0 ? (songTime / totalSongTime) * 100 : 0
        progressBarEl.style.setProperty("--fill", `${Math.min(100, Math.max(0, pct))}%`)
    }

    function syncUi(songTime) {
        const t = Math.min(Math.max(0, songTime), totalSongTime || 0)
        if (timeDisplayEl) timeDisplayEl.textContent = formatClock(t)
        if (progressBarEl && !isScrubbing) {
            progressBarEl.value = String(t)
        }
        bus?.execute_event("midi_time_change", songTime)
        setScrubberFill(t)
    }

    function setTotalSongTime(time) {
        totalSongTime = Math.max(0, Number(time) || 0)
        if (totalSongTimeEl) totalSongTimeEl.textContent = ` / ${formatClock(totalSongTime)}`
        if (progressBarEl) {
            progressBarEl.max = String(totalSongTime || 0)
            progressBarEl.step = "any"
        }
        syncUi(getSongTime())
    }

    function seekTo(songTime) {
        const t = Math.min(Math.max(0, Number(songTime) || 0), totalSongTime || 0)
        songPosition = t
        playHead = lowerBoundByTime(events, t)
        if (timerId != null) {
            songStartAudioTime = midiCtx.currentTime - t
            // Drop notes already sounding / queued past the new playhead
            midiNode.port.postMessage({ type: "allNotesOff" })
        }
        syncUi(t)
    }

    function schedule() {
        const songTime = midiCtx.currentTime - songStartAudioTime
        while (playHead < events.length && events[playHead].time <= songTime + LOOKAHEAD_SEC) {
            const e = events[playHead++]
            noteSerial += 1
            midiNode.port.postMessage({
                type: "noteOn",
                uniqueID: `${e.trackIndex}_${noteSerial}`,
                trackIndex: e.trackIndex,
                freq: midiToFreq(e.midi),
                duration: e.duration,
                velocity: e.velocity,
                when: songStartAudioTime + e.time,
            })
        }
        // Update UI once per tick (not once per note), and during note gaps
        syncUi(songTime)
        // Wait for full duration so the last notes can finish in the worklet
        if (totalSongTime > 0 && songTime >= totalSongTime) stop()
    }

    function stop() {
        const wasPlaying = timerId != null
        if (wasPlaying) songPosition = 0
        noteSerial = 0
        playHead = 0
        clearTimer()
        midiNode.port.postMessage({ type: "allNotesOff" })
        syncUi(0)
        if (wasPlaying && onStop) onStop()
    }

    if (progressBarEl) {
        progressBarEl.addEventListener("pointerdown", () => {
            isScrubbing = true
        })
        progressBarEl.addEventListener("pointerup", () => {
            isScrubbing = false
            seekTo(Number(progressBarEl.value))
        })
        progressBarEl.addEventListener("pointercancel", () => {
            isScrubbing = false
        })
        progressBarEl.addEventListener("input", (e) => {
            const t = Number(e.target.value)
            // Live clock / fill while dragging; commit seek on pointerup (or immediately if not dragging)
            if (timeDisplayEl) timeDisplayEl.textContent = formatClock(t)
            setScrubberFill(t)
            if (!isScrubbing) seekTo(t)
        })
        // Keyboard / accessibility: input fires without pointerdown
        progressBarEl.addEventListener("change", (e) => {
            isScrubbing = false
            seekTo(Number(e.target.value))
        })
    }

    function play() {
        if (!events.length) return
        // Clear timer without allNotesOff/onStop so restart is seamless
        clearTimer()
        playHead = lowerBoundByTime(events, songPosition)
        songStartAudioTime = midiCtx.currentTime + 0.05 - songPosition
        timerId = setInterval(schedule, SCHEDULER_MS)
        schedule()
    }

    return {
        setEvents(nextEvents, totalTime) {
            events = nextEvents
            // Prefer explicit duration; otherwise infer from last note end.
            const inferred =
                events.length > 0
                    ? Math.max(...events.map((e) => e.time + (e.duration || 0)))
                    : 0
            songPosition = 0
            playHead = 0
            setTotalSongTime(totalTime ?? inferred)
        },
        play,
        stop,
        seekTo,
        get isPlaying() {
            return timerId != null
        },
    }
}

/** Upload a per-track wavetable (copies into the worklet). */
export function setTrackWavetable(midiNode, trackIndex, waveform) {
    if (!midiNode || !waveform) return
    // Structured clone is fine at gene-select rate; keep main-thread buffer intact for re-use.
    midiNode.port.postMessage({
        type: "updateWavetable",
        trackIndex,
        waveform,
    })
}

/** Mark a track as having no gene assigned (silent until a new table is uploaded). */
export function clearTrackWavetable(midiNode, trackIndex) {
    if (!midiNode) return
    midiNode.port.postMessage({
        type: "clearWavetable",
        trackIndex,
    })
}
