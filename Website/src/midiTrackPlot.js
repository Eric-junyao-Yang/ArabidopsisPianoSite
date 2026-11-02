import { midiToFreq } from "/src/midiplayer.js"

const DISPLAY_WIDTH_SEC = 30
const WIDTH = 1000
const HEIGHT = 80
const MARGIN = { top: 5, right: 5, bottom: 5, left: 5 }

/**
 * Piano-roll style note display per MIDI track.
 * Pans by translating one group (O(1) per tick) instead of transitioning every note.
 */
export function midiTrackPlots(events, MIDI_TRACKS, bus) {
    // One pass → notes grouped by track (avoids filtering the full list N times)
    const byTrack = new Map()
    for (const track of MIDI_TRACKS) byTrack.set(track.trackIndex, [])
    for (const e of events) {
        const list = byTrack.get(e.trackIndex)
        if (list) list.push(e)
    }

    const pans = []

    for (const track of MIDI_TRACKS) {
        const host = d3.select(`#midi-${track.id}-display`)
        if (host.empty()) continue
        const pan = plotMidi(host, byTrack.get(track.trackIndex) || [])
        if (pan) pans.push(pan)
    }

    // Single bus listener updates every track (avoids N identical subscriptions)
    bus.subscribe_to("midi_time_change", "midi_track_plots", (songTime) => {
        const t = Math.max(0, Number(songTime) || 0)
        for (const pan of pans) pan(t)
    })
}

function plotMidi(host, trackEvents) {
    const innerWidth = WIDTH - MARGIN.left - MARGIN.right
    const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom
    const pxPerSec = innerWidth / DISPLAY_WIDTH_SEC

    // Idempotent: reloading MIDI replaces the previous SVG
    host.selectAll("svg").remove()

    const notes = trackEvents.map((e) => ({
        x: e.time * pxPerSec,
        w: Math.max(2, (e.duration || 0) * pxPerSec),
        freq: midiToFreq(e.midi),
    }))

    let yDomain = d3.extent(notes, (d) => d.freq)
    if (yDomain[0] == null || yDomain[1] == null) {
        yDomain = [midiToFreq(60), midiToFreq(72)]
    } else if (yDomain[0] === yDomain[1]) {
        yDomain = [yDomain[0] * 0.9, yDomain[1] * 1.1]
    }

    const yScale = d3.scaleLinear().domain(yDomain).range([innerHeight, 0]).nice()

    const svg = host
        .append("svg")
        .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`)
        .attr("preserveAspectRatio", "none")
        .attr("aria-hidden", "true")
        .style("pointer-events", "none")

    const clipId = `midi-clip-${Math.random().toString(36).slice(2, 9)}`
    svg.append("defs")
        .append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("width", innerWidth)
        .attr("height", innerHeight)

    const plotArea = svg
        .append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`)
        .attr("clip-path", `url(#${clipId})`)

    const panGroup = plotArea.append("g").attr("class", "midi-notes")

    panGroup
        .selectAll("line")
        .data(notes)
        .join("line")
        .attr("x1", (d) => d.x)
        .attr("x2", (d) => d.x + d.w)
        .attr("y1", (d) => yScale(d.freq))
        .attr("y2", (d) => yScale(d.freq))
        .attr("stroke-width", 2)
        .attr("stroke", "currentColor")

    // Playhead stays at the left edge of the visible window
    plotArea
        .append("line")
        .attr("class", "midi-playhead")
        .attr("x1", 0)
        .attr("x2", 0)
        .attr("y1", 0)
        .attr("y2", innerHeight)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.35)
        .attr("stroke-width", 1)

    return function panTo(songTime) {
        panGroup.attr("transform", `translate(${-songTime * pxPerSec},0)`)
    }
}
