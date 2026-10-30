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

/**
 * Lookahead scheduler that drives noteOn messages into the MIDI AudioWorklet.
 * Uses AudioContext.currentTime as the clock; setInterval for the schedule loop.
 */
export function createMidiTransport(midiCtx, midiNode, { onStop } = {}) {
    let events = []
    let playHead = 0
    let songStartAudioTime = 0
    let timerId = null
    let noteSerial = 0

    function clearTimer() {
        if (timerId != null) {
            clearInterval(timerId)
            timerId = null
        }
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
        if (playHead >= events.length) stop()
    }

    function stop() {
        const wasPlaying = timerId != null
        clearTimer()
        midiNode.port.postMessage({ type: "allNotesOff" })
        if (wasPlaying && onStop) onStop()
    }

    return {
        setEvents(nextEvents) {
            events = nextEvents
            playHead = 0
        },
        play() {
            if (!events.length) return
            // Clear timer without allNotesOff/onStop so restart is seamless
            clearTimer()
            playHead = 0
            noteSerial = 0
            songStartAudioTime = midiCtx.currentTime + 0.05
            timerId = setInterval(schedule, SCHEDULER_MS)
            schedule()
        },
        stop,
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
