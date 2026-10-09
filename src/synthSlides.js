import { interpolate_waveform } from "/src/catmullrom.js"

const arabidopsisSlide = {
    elements: {
        arabidopsis(g) {
            g.append("image")
                .attr("href", "/img/Athaliana.png")
                .attr("width", 150)
                .attr("height", 290)
                .attr("x", 0)
                .attr("y", 0)
            g.append("text")
                .attr("x", 5)
                .attr("y", 290)
                .attr("font-size", "8px")
                .style("fill", "grey")
                .text("modified from SciGrafik and Agrisera")
        },
        genome(g) {
            g.append("image")
                .attr("href", "/img/Genome.png")
                .attr("width", 500).attr("height", 200)
                .attr("x", 150).attr("y", 80)
            g.append("text")
                .attr("x", 530).attr("y", 290)
                .attr("font-size", "8px").style("fill", "grey")
                .text("modified from lumencandela")
            g.append("text")
                .attr("x", 390).attr("y", 240)
                .attr("font-size", "15px").style("fill", "red")
                .text("gene")
            g.append("text")
                .attr("x", 526).attr("y", 240)
                .attr("font-size", "15px").style("fill", "red")
                .text("gene")
        },
        stimuli(g){
            g.append("image")
                .attr("href", "/img/Stimuli_sun.png")
                .attr("width", 120).attr("height", 120)
                .attr("x", 290).attr("y", 10)        
            g.append("image")
                .attr("href", "/img/Stimuli_rain.png")
                .attr("width", 120).attr("height", 120)
                .attr("x", 430).attr("y", 20)
            g.append("image")
                .attr("href", "/img/Stimuli_bug.png")
                .attr("width", 100).attr("height", 100)
                .attr("x", 380).attr("y", 120)
        },
        axis(g, deck){
            const width = 650
            const height = 300
            const margin = { top: 20, right: 20, bottom: 40, left: 50 }
            const innerWidth = width - margin.left - margin.right
            const innerHeight = height - margin.top - margin.bottom
            if (deck.TOC1){
                const xScale = d3.scaleLinear()
                    .domain([0, 48])
                    .range([0, innerWidth])
                const yScale = d3.scaleLinear()
                    .domain(d3.extent(deck.TOC1))
                    .range([innerHeight, 0])
                    .nice()
                const chart = g.append('g').attr("transform", `translate(${margin.left}, ${margin.top})`)

                const tickVals = d3.range(16).map(i => 2 + 3 * i)
                const xAxis = chart.append('g')
                    .attr('transform', `translate(0, ${innerHeight})`)
                    .call(d3.axisBottom(xScale).tickValues(tickVals))
                const yAxis = chart.append("g")
                    .attr("transform", `translate(0, 0)`)
                    .call(d3.axisLeft(yScale))

                chart.append("rect")
                    .attr("x", xScale(0)).attr("y", 0)
                    .attr("width", xScale(16)).attr("height", innerHeight)
                    .attr("fill", "orange").attr("opacity", 0.3)
                chart.append("rect")
                    .attr("x", xScale(24)).attr("y", 0)
                    .attr("width", xScale(16)).attr("height", innerHeight)
                    .attr("fill", "orange").attr("opacity", 0.3)
                chart.append("rect")
                    .attr("x", xScale(16)).attr("y", 0)
                    .attr("width", xScale(8)).attr("height", innerHeight)
                    .attr("fill", "grey").attr("opacity", 0.3)
                chart.append("rect")
                    .attr("x", xScale(40)).attr("y", 0)
                    .attr("width", xScale(8)).attr("height", innerHeight)
                    .attr("fill", "grey").attr("opacity", 0.3)
                
                const circles_TOC = chart.selectAll("circle.TOC").data(deck.TOC1, (d, i) => i)
                circles_TOC.exit().remove()
                circles_TOC.enter()
                    .append("circle")
                    .attr("class", "TOC")
                    .attr("r", 3)
                    .attr("fill", "blue")
                    .merge(circles_TOC)
                    .attr("cx", (d, i) => xScale(2 + 3 * i))
                    .attr("cy", d => yScale(d))
                
                // smooth curve
                var interp_points_TOC = interpolate_waveform(deck.TOC1, 2000)
                interp_points_TOC = interp_points_TOC.map((value, i) => ({pos: i * (16 / 2000), value})).filter(d => d.pos <= 16 -1)
                const lineGen = d3.line()
                    .x((d, i) => xScale(2 + 3 * d.pos))
                    .y(d => yScale(d.value))
                    .curve(d3.curveLinear)
                const path_TOC = chart.selectAll("path.TOC").data([interp_points_TOC])

                path_TOC.enter()
                    .append("path")
                    .attr("class", "TOC")
                    .attr("fill", "none")
                    .attr("stroke", "salmon")
                    .attr("stroke-width", 1)
                    .merge(path_TOC)
                    .attr("d", lineGen)
            }
        },
        wave(g, deck) {deck.makeWavePlot(g, deck, {varyingParam: null, slotIndex: 0, slotWidth: 630, myName: "wave"})},
        waveAmp(g, deck) {deck.makeWavePlot(g, deck, {varyingParam: "amplitude", slotIndex: 0, playSoundBtn: true, myName: "Amplitude"})},
        waveFreq(g, deck) {deck.makeWavePlot(g, deck, {varyingParam: "cycles", slotIndex: 1, playSoundBtn: true, myName: "Frequency"})},
        waveMorph(g, deck) {deck.makeWavePlot(g, deck, {varyingParam: "shape", slotIndex: 2, playSoundBtn: true, myName: "Shape"})}
    },

    slides: [
        { text: "Arabidopsis thaliana is a plant that scientists love to study.", show: ["arabidopsis"]},
        { text: "It has a small genome and a fast reproduction cycle, but is still a complex flowering plant, which makes it an ideal candidate to research.", show: ["arabidopsis", "genome"]},
        { text: "Arabidopsis contains around 27,000 genes. Many of these genes can modulate their activities based on stimuli.", show: ["arabidopsis", "genome", "stimuli"]},
        { text: "Yuchen Yang and colleagues (https://doi.org/10.1074/jbc.RA120.013513) wanted to study the effect of day/night cycle on gene activities.", show: ['axis']},
        { text: "They grew Arabidopsis under 16hr light and 8hr dark cycles, and measured activities of each of the 27,000 genes every 3 hours over 2 days: totaling 16 data points per gene.", show: ['axis']},
        { text: "We can 'hear' the data, if we treat the resulting plot as an audio waveform.", show: ['axis']}, //change axis labels to time and amplitude
        { text: "An audio waveform is a representation of sound.", show: ['wave']},
        { text: "Amplitude controls volume.", show: ['waveAmp']},
        { text: "How fast the waveform repeats (frequency) controls pitch", show: ['waveAmp', 'waveFreq']},
        { text: "The shape of the waveform itself, controls the quality of the sound. Think of each unique waveform as its own instrument!", show: ['waveAmp', 'waveFreq', 'waveMorph']},
        { text: "For the synthesizer below, the amplitude is locked, and the frequency is mapped to the keyboard, this allows us to focus on the shape of the waveform.", show: ['waveAmp', 'waveFreq', 'waveMorph']},
        { text: "This way, we have about 27,000 'instruments' derived from the Arabidposis genome. Use the Synthesizer below to explore the Arabidopsis soundscape.", show: ['waveAmp', 'waveFreq', 'waveMorph']},
    ],

    TOC1: null,

    updateData(TOC1_dat){
        function extractDat(dat){
            const raw_dat = dat
            const yVals = Object.keys(raw_dat)
                .filter(k => k.startsWith('LD_ZT'))
                .map(k => raw_dat[k])
            // const mu = d3.mean(yVals)
            // const sd = d3.deviation(yVals)
            // const z = yVals.map(x => (x - mu) / sd)
            return yVals
        }
        this.TOC1 = extractDat(TOC1_dat)
    },

    drawWave({steps = 2000, cycles = 4, amplitude = 1, shape = 0}) {
        return Array.from({length: steps}, (_, i) => {
            const phase = 2 * Math.PI  * cycles * (i / steps)
            const sin = Math.sin(phase)

            const square = Math.sign(sin)
            const wave = (1 - shape) * sin + shape * square

            return amplitude * wave
        })
    },

    soundFocus: null, // this controls which param gets to feed data to the audioContext
    internalInitAudio: null,
    soundTimer: null, // shared timer
    activeResetBtn: null,

    setInternalInitAudio(fn){
        this.internalInitAudio = fn
    },
    async playSound(myName, resetBtn){
        this.stopSound()
        if (this.internalInitAudio){
            await this.internalInitAudio()
        }
        this.soundFocus = myName
        this.activeResetBtn = resetBtn
        clearTimeout(this.soundTimer)
        this.soundTimer = setTimeout(() => {this.stopSound()}, 4000)
    },

    stopSound(){
        clearTimeout(this.soundTimer)
        const resetBtn = this.activeResetBtn
        this.activeResetBtn = null
        if (resetBtn){
            resetBtn()
        }
        this.soundFocus = null
        this.soundTimer = null
        this.bus.execute_event("stopSlideSound", null)
    },

    makeWavePlot(g, deck, {varyingParam, slotIndex, slotWidth = 210, playSoundBtn = false, myName = null}) {
        const width = slotWidth - 10
        const height = 220
        const margin = { top: 50, right: 10, bottom: 24, left: 30 }
        const innerWidth = width - margin.left - margin.right
        const innerHeight = height - margin.top - margin.bottom
            
        const xScale = d3.scaleLinear().domain([0, 2000]).range([0, innerWidth]).nice()
        const yScale = d3.scaleLinear().domain([-1, 1]).range([innerHeight, 0]).nice()

        const chart = g.append('g').attr("transform", `translate(${slotIndex * slotWidth + margin.left}, ${margin.top})`)
        chart.append('g').attr('transform', `translate(0, ${innerHeight})`).call(d3.axisBottom(xScale).ticks(4))
        chart.append("g").attr("transform", `translate(0, 0)`).call(d3.axisLeft(yScale).ticks(4))

        if (playSoundBtn) {
            chart.append("text")
                .attr("x", innerWidth/2)
                .attr("y", -20)
                .attr("text-anchor", "middle")
                .attr("font-size", "20px")
                .text(myName)

            const button = chart.append('g')
                .attr("class", "button")
                .attr("transform", `translate(${innerWidth/2}, ${innerHeight + 50})`)
                .style("cursor", "pointer")

            button.append("rect")
                .attr("x", -50)
                .attr("y", -15)
                .attr("width", 100)
                .attr("height", 30)
                .attr("rx", 5)
                .attr("fill", "orange")
            
            button.append('rect') // progress bar
                .attr('class', 'progress-bar')
                .attr("x", -50)
                .attr("y", -15)
                .attr("width", 0) //max 100
                .attr("height", 30)
                .attr("rx", 5)
                .attr("fill", "red")

            button.append("text")
                .attr('class', 'text')
                .attr("text-anchor", "middle")
                .attr("dominant-baseline", "middle")
                .text("Play Sound")

            const progress = button.select(".progress-bar")
            const text = button.select(".text")
            function resetBtn(){
                progress
                    .interrupt()
                    .attr("width", 0)
                text.text("Play Sound")
            }
            button
                .on("click", async (event) => {
                    event.stopPropagation()
                    if (this.soundFocus == myName){
                        deck.stopSound()
                        return
                    }

                    const started = await deck.playSound(myName, resetBtn)

                    progress
                        .interrupt()
                        .attr("width", 0)
                        .transition()
                        .duration(4000)
                        .ease(d3.easeLinear)
                        .attr("width", 100)
                        .on("end", () => {
                            if (deck.soundFocus !== myName) {
                                return
                            }
                            deck.stopSound()
                        })
                    text.text("Stop")
                })
        }

        const lineGen = d3.line()
                .x((d, i) => xScale(i))
                .y(d => yScale(d))
                .curve(d3.curveLinear)
        const path = chart.append("path")
            .attr("class", "sin")
            .attr("fill", "none")
            .attr("stroke", "salmon")
            .attr("stroke-width", 1)
            
        let t = 0
        function animate(){
            if (!g.node().isConnected) return
            t += 0.05
            const params = {steps: 2000, cycles: 3, amplitude: 1, shape:0 }
            if (varyingParam === "amplitude") params.amplitude = 0.6 + 0.4 * Math.sin(t)
            if (varyingParam === "cycles") params.cycles = 3 + 1 * Math.sin(t)
            if (varyingParam === "shape") params.shape = Math.abs(Math.sin(t * 0.5))
            
            if (deck.bus && deck.soundFocus == myName){
                deck.bus.execute_event("updateParams", params)
            }
            
            const waveDat = deck.drawWave(params)
            path.datum(waveDat).attr("d", lineGen)
            requestAnimationFrame(animate)
        }
        animate()
    },

    render(svg, slide) {
        const self = this
        const groups = svg.selectAll("g.layer").data(slide.show, d => d)
        groups.exit().transition().duration(300).style("opacity", 0).remove()
        groups.enter().append("g").attr("class", "layer").style("opacity", 0)
            .each(function (item) {
                self.elements[item](d3.select(this), self)
            })
            .transition().duration(400).style("opacity", 1)
    },

    bus: null,
    connectBus(bus){
        this.bus = bus
    }
}

export const synthSlides = arabidopsisSlide
