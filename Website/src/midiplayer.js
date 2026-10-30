import { interpolate_waveform, maxAbsScaling , ldTimepoints} from "/src/catmullrom.js"
import { Midi } from "https://esm.sh/@tonejs/midi@2.0.28";

export async function midiplayer(midiCtx, midiNode, normalized_counts_lookup){
    // playSound("AT5G61380", 440, 5, midiNode, normalized_counts_lookup)
    const file_path = "/dat/NGGYU.mid"
    const file = await fetch(file_path)
    const bytes = new Uint8Array(await file.arrayBuffer());
    const midi = new Midi(bytes);
    const events = []
    midi.tracks.forEach((track, trackIndex) => {
        for (const n of track.notes) {
            events.push({
                time: n.time,
                duration: n.duration,
                midi: n.midi,
                velocity: n.velocity,
                trackIndex
            })
        }
    })

    events.sort((a,b) => a.time - b.time || a.trackIndex - b.trackIndex)
    return events
}

export function play(events, midiCtx, midiNode){
    const LOOKAHEAD = 0.1 //sec
    let playHead = 0
    let songStartAudioTime = midiCtx.currentTime

    function tick() {
        const now = midiCtx.currentTime
        const songTime = now - songStartAudioTime
        while (playHead < events.length && events[playHead].time <= songTime + LOOKAHEAD){
            const e = events[playHead++]
            const when = songStartAudioTime + e.time
            const freq = 440 * 2 ** ((e.midi - 69) / 12)

            midiNode.port.postMessage({
                type: "noteOn",
                uniqueID: `${e.trackIndex}_${playHead}`,
                trackIndex: e.trackIndex,
                freq,
                duration: e.duration,
                velocity: e.velocity,
                when,
            })
        }
        requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
}