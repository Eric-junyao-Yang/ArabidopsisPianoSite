import { midiToFreq } from "/src/midiplayer.js"

export function midiTrackPlots(events, trackCount, MIDI_TRACKS){
    for (const track of MIDI_TRACKS) {
        const track_id = track.id
        const trackIndex = track.trackIndex
        const d3_obj = d3.select(`#midi-${track_id}-display`)
        plotMidi(d3_obj, events, trackIndex)
    }
}

function plotMidi(d3_obj, events, trackIndex){
    const WIDTH = 1000
    const HEIGHT = 80
    const margin = { top: 5, right: 5, bottom: 5, left: 5 }
    const innerWidth = WIDTH - margin.left - margin.right
    const innerHeight = HEIGHT - margin.top - margin.bottom
    console.log(events)
    const trackEvents = events.filter((v) => v.trackIndex === trackIndex)

    const xScale = d3.scaleLinear()
    .domain(d3.extent(events, d => d.time)) //share same extent across plot
    .range([0, innerWidth])

    const yScale = d3.scaleLinear()
    .domain(d3.extent(trackEvents, d => midiToFreq(d.midi)))
    .range([innerHeight, 0])
    .nice()

    console.log(d3_obj)
    const svg = d3_obj.append("svg")
        .attr('width', WIDTH)
        .attr('height', HEIGHT)
        // .style('position', 'relative')
        .style('top', '0')
        .style('left', '0')
        .style('pointer-events', 'none')
        .style('outline', '2px solid orange')

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)
    
    plotArea.selectAll(".segment")
        .data(trackEvents)
        .join("line")
        .attr("class", "segment")
        .attr("x1", d => xScale(d.time))
        .attr("x2", d => xScale(d.time + d.duration))
        .attr("y1", d => yScale(midiToFreq(d.midi)))
        .attr("y2", d => yScale(midiToFreq(d.midi)))
        .attr("stroke-width", 2)
        .attr("stroke", "steelblue")
    

}