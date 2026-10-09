import { interpolate_waveform } from "/src/catmullrom.js"

const Slides = {
    elements: {
        ""(g){
            
        }
    },

    slides: [
        { text: "By changing the frequency of the waveform to match the keyboard, the Synthesizer above actually throws away important experimental data.", show: [""]},
        { text: "A subset of genes are naturally oscillating, and each have its own innate frequency.", show: [""]},
        { text: "Here are a few known oscillating genes (TOC1 and ???): it is a circadian gene that matches day/night cycle. Compare it to a house keeping gene UBQ1.", show: [""]},
        { text: "We can extract the natural oscillating frequency of all genes and map them to a keyboard by scaling everything up into the audible range.", show: [""]},
        { text: "This way, relative pitches between genes are mapped to their natural oscillation rates!", show: [""]},
        { text: "Using musical harmony to explore relationship between oscillating genes is actually surprisingly appropriate.", show: [""]},
        { text: "Human ears are really good at picking out certain mathmatical relationships between frequencies:", show: [""]},
        { text: "The Pathagoreans supposedly discovered that whole number ratio relationships between freqencies sounds pleasant to our ears.", show: [""]},
        { text: "In fact, the Pythagorean tuning maps each note in a major scale to have the following ratio relationships with the root (first) note: 1/1     9/8     5/4     4/3     3/2     5/3     15/8     2/1.", show: [""]},
        { text: "You can learn more about mathmatics of musical harmony here: https://www.asa3.org/ASA/education/teach/harmony-cr.htm https://aatishb.com/dissonance/", show: [""]},
        { text: "Two genes a perfect fifth apart (example here) suggest whenever one gene completes three cycles, the other one completes two cycles. ", show: [""]},
        { text: "While relationships discovered this way may not be biological (the methods sections discusses the limitations), they might be worth looking further into. At the very least, it is a fun way to explore this dataset and you can also use it to make some music!", show: [""]},

    ],

    TOC1: null,

    updateData(TOC1_dat){
        function extractDat(dat){
            const raw_dat = dat
            const yVals = Object.keys(raw_dat)
                .filter(k => k.startsWith('LD_ZT'))
                .map(k => raw_dat[k])
            return yVals
        }
        this.TOC1 = extractDat(TOC1_dat)
    },

    render(svg, slide) {
        const self = this
        const groups = svg.selectAll("g.layer").data(slide.show, d => d)
        groups.exit().transition().duration(300).style("opacity", 0).remove()
        groups.enter().append("g").attr("class", "layer").style("opacity", 0)
            .each(function (item) {
                self.elements[item](d3.select(this))
            })
            .transition().duration(400).style("opacity", 1)
    },

    bus: null,
    connectBus(bus){
        this.bus = bus
    }
}

export const stepSeqSlides = Slides
