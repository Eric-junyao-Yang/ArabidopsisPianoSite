export class SlidesTemplate{
    constructor(slideElement, text, leftBtn, rightBtn, slides){
        this.slideElement = slideElement
        this.textElement = text
        this.leftBtn = leftBtn
        this.rightBtn = rightBtn
        this.slides = slides

        this.slideIndex = 0
        this.stepIndex = 0
        this.isTyping = false

        this._init()
        this.goToSlide(0)
    }
    
    _init(){
        // styling buttons
        const arrow = (element, points) => {
            const svg = d3.select(element).append("svg")
                .attr("viewBox", "0 0 24 24")
                .attr("fill", "none")
                .attr("stroke", "purple")
                .attr("stroke-width", 2.5)
                .attr("stroke-linecap", "round")
                .attr("stroke-linejoin", "round")
            svg.append("polyline").attr("points", points)
        }
        arrow(this.leftBtn, "15 18  8 12  15 6")
        arrow(this.rightBtn, "9 18  16 12  9 6")

        // Create Slides
        const parent = this.slideElement
        this.svg = d3.select(this.slideElement).append("svg")
            .attr("width", parent.clientWidth)
            .attr("height", parent.clientHeight)

        // Bind events
        this.leftBtn.addEventListener("click", () => this.prevSlide())
        this.rightBtn.addEventListener("click", () => this.nextSlide())
        this.slideElement.addEventListener("click", () => this.nextStep())
        this.textElement.addEventListener("click", () => this.nextStep())
    }

    // Arrow button functions
    goToSlide(i){
        this.slideIndex = Math.max(0, Math.min(this.slides.length - 1, i))
        this.stepIndex = 0
        this.svg.selectAll("*").remove()
        this._renderStep()
        this._updateArrowState()
    }
    nextSlide(){ if (this.slideIndex < this.slides.length - 1) this.goToSlide(this.slideIndex + 1)}
    prevSlide(){ if (this.slideIndex > 0) this.goToSlide(this.slideIndex - 1)}
    _updateArrowState() {
        this.leftBtn.classList.toggle("disabled", this.slideIndex === 0)
        this.rightBtn.classList.toggle("disabled", this.slideIndex === this.slides.length - 1)
    }

    // Step functions
    nextStep() {
        if (this.isTyping) { this._finishTyping(); return;}
        const slide = this.slides[this.slideIndex]
        if (this.stepIndex < slide.steps.length - 1) {
            this.stepIndex ++
            this._renderStep()
        } else {
            this.nextSlide()
        }
    }

    _renderStep() {
        const slide = this.slides[this.slideIndex]
        const step = slide.steps[this.stepIndex]
        slide.render(this.svg, step)
        this._typeText(step.text)
    }


    // Stylized Type Writer
    _typeText(str) {
        clearInterval(this.typingTimer)
        this.textElement.textContent = ""
        this.isTyping = true
        let i = 0
        this.typingTimer = setInterval(() => {
            this.textElement.textContent += str[i++]
            if (i >= str.length) this._finishTyping(str)
        }, 18)
    }

    _finishTyping(str){
        clearInterval(this.typingTimer)
        if (str !== undefined) this.textElement.textContent = str
        this.isTyping = false
    }
}


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
        }
    },

    steps: [
        { text: "Arabidopsis thaliana is a plant that scientists love to study.", show: ["arabidopsis"]},
        { text: "It has a small genome and a fast reproduction cycle, but is still a complex flowering plant, which makes it an ideal candidate to research.", show: ["arabidopsis", "genome"]},
        { text: "Arabidopsis contains around 27,000 genes. Many of these genes can modulate their activities based on stimuli.", show: ["arabidopsis", "genome", "stimuli"]},
    ],

    render(svg, step) {
        const groups = svg.selectAll("g.layer").data(step.show, d => d)
        groups.exit().transition().duration(300).style("opacity", 0).remove()
        groups.enter().append("g").attr("class", "layer").style("opacity", 0)
            .each(function (item) {
                arabidopsisSlide.elements[item](d3.select(this))
            })
            .transition().duration(400).style("opacity", 1)

    }
}

export const slides = [arabidopsisSlide]