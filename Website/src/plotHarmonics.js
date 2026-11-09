/**
 * Clarification:
 *   amplitudeSpectrum  = raw FFT coefficient magnitude (from per_gene_meta.spec*)
 *   energy     — amplitude**2
 *   energyShare = energy / total energy in [0, 1]
 *   energyPct   = energyShare * 100
 *   period      = oscillation period in hours (48, 24, …)
 */


export function spectrumToEnergyPct(amplitudeSpectrum) {
    if (!amplitudeSpectrum?.length) return []
    const totalEnergy = amplitudeSpectrum.reduce((sum, d) => sum + d.amplitude ** 2, 0)
    if (!(totalEnergy > 0)) {
        return amplitudeSpectrum.map((d) => ({ period: d.period, energyPct: 0 }))
    }
    return amplitudeSpectrum.map((d) => ({
        period: d.period,
        energyPct: (d.amplitude ** 2 / totalEnergy) * 100,
    }))
}

export function geneSpectrumEnergyPct(geneId, specsLookup) {
    const amplitudeSpectrum = specsLookup.get(geneId)
    if (!amplitudeSpectrum) return []
    return spectrumToEnergyPct(amplitudeSpectrum)
}

export function energyPctAtPeriod(geneId, specsLookup, periodHours) {
    const internal_periodHours = (typeof periodHours === "number")? periodHours : parseInt(periodHours)
    const bin = geneSpectrumEnergyPct(geneId, specsLookup)
        .find((d) => d.period === internal_periodHours)
    return bin ? bin.energyPct : null
}

export function plotHarmonics(specsLookup, bus) {
    const MARGINS = { top: 5, left: 50, bottom: 50, right: 25 }
    const WIDTH = 1000
    const HEIGHT = 100

    const innerWidth = WIDTH - MARGINS.left - MARGINS.right
    const innerHeight = HEIGHT - MARGINS.top - MARGINS.bottom

    const xScale = d3.scaleLinear()
        .domain([0, 48])
        .range([0, innerWidth])

    let yScale = d3.scaleLinear()
        .domain([0, 100])
        .range([innerHeight, 0])
        .nice()

    const svg = d3.select("#Harmonic_div").append("svg")
        .attr("width", WIDTH)
        .attr("height", HEIGHT)
        .style("top", "0")
        .style("left", "0")

    const plotArea = svg.append("g")
        .attr("transform", `translate(${MARGINS.left}, ${MARGINS.top})`)

    // Periods for harmonics 1..8 of a 48h fundamental: 48, 24, 16, …
    const tickPeriods = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => 48 / k)

    plotArea.append("g")
        .attr("transform", `translate(0, ${innerHeight})`)
        .call(
            d3.axisBottom(xScale)
                .tickValues(tickPeriods)
                .tickFormat(d3.format(".1f")),
        )

    plotArea.append("text")
        .attr("transform", `translate(${innerWidth / 2}, ${innerHeight + 35})`)
        .text("Periods")

    plotArea.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -25)
        .text("% Energy")

    const yAxis = plotArea.append("g")
        .call(d3.axisLeft(yScale))

    function updatePlot(energyPctSpectrum) {
        const maxPct = d3.max(energyPctSpectrum, (d) => d.energyPct) ?? 0
        yScale = d3.scaleLinear()
            .domain([0, Math.max(maxPct, 1)])
            .range([innerHeight, 0])
            .nice()
        yAxis.call(d3.axisLeft(yScale))

        plotArea.selectAll("line.frag")
            .data(energyPctSpectrum, (d) => d.period)
            .join("line")
            .attr("class", "frag")
            .attr("x1", (d) => xScale(d.period))
            .attr("y1", yScale(0))
            .attr("x2", (d) => xScale(d.period))
            .attr("y2", (d) => yScale(d.energyPct))
            .attr("stroke", "steelblue")
            .attr("stroke-width", 10)
    }

    bus.subscribe_to("point_select", "harmonics", (geneId) => {
        if (!geneId) {
            updatePlot([])
            return
        }
        updatePlot(geneSpectrumEnergyPct(geneId, specsLookup))
    })
}
