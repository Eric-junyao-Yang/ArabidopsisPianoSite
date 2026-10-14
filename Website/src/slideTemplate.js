export class SlidesTemplate{
    constructor(slideElement, text, leftBtn, rightBtn, slideDeck){
        this.slideElement = slideElement
        this.textElement = text
        this.textBody = this.textElement.querySelector(".textBody")
        this.slideCounter = this.textElement.querySelector(".slideCounter")
        this.leftBtn = leftBtn
        this.rightBtn = rightBtn
        this.slideDeck = slideDeck

        this.slideIndex = 0
        this.isTyping = false

        this._init()
        this._renderSlide()
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
        this.rightBtn.addEventListener("click", () => this.nextSlide(true))
        this.slideElement.addEventListener("click", () => this.nextSlide())
        this.textElement.addEventListener("click", () => this.nextSlide())

        // Place the slide counter
        this.textElement.style.position = "relative"
        this.slideCounter.style.position = "absolute"
        this.slideCounter.style.right = 0
        this.slideCounter.style.bottom = 0
    }

    _updateArrowState() {
        this.leftBtn.classList.toggle("disabled", this.slideIndex === 0)
        this.rightBtn.classList.toggle("disabled", this.slideIndex === this.slideDeck.slides.length - 1)
    }

    // Slide functions
    nextSlide(immediate = false) {
        const slide = this.slideDeck.slides[this.slideIndex]
        if (!immediate){
            if (this.isTyping) { this._finishTyping(slide.text); return;}
        }
        if (this.slideIndex < this.slideDeck.slides.length - 1) {
            this.slideIndex ++
            this._renderSlide()
            this._updateArrowState()
        }
    }

    prevSlide() {
        if (this.slideIndex > 0) {
            this.slideIndex --
            this._renderSlide()
            this._updateArrowState()
        }
    }

    _renderSlide() {
        const slide = this.slideDeck.slides[this.slideIndex]
        this.slideDeck.render(this.svg, slide)
        this._typeText(slide.text)
        this._updateSlideCounter()
    }

    _updateSlideCounter(){
        this.slideCounter.textContent = `${this.slideIndex + 1} / ${this.slideDeck.slides.length}`
    }

    // Stylized Type Writer
    _typeText(str) {
        clearInterval(this.typingTimer)
        this.textBody.textContent = ""
        this.isTyping = true
        let i = 0
        this.typingTimer = setInterval(() => {
            this.textBody.textContent += str[i++]
            if (i >= str.length) this._finishTyping(str)
        }, 18)
    }

    _finishTyping(str){
        clearInterval(this.typingTimer)
        if (str !== undefined) this.textBody.textContent = str
        this.isTyping = false
    }
}















// By changing the frequency of the waveform to match the keyboard, the Synthesizer above actually throws away important experimental data.
// Certain genes naturally oscillates, and have its own innate frequency.
// Take TOC1 as an example: it is a circadian gene that matches day/night cycle.
// We can extract the natural oscillating frequency of all genes and map them to a keyboard by scaling everything up into the audible range.
// This way, relative pitch between genes are mapped to their natural oscillation rate!
// Using musical harmony to explore relationship between genes is actually surprisingly appropriate.
// Human ears are really good at picking out certain mathmatical relationships between frequencies:
// The Pathagoreans supposedly discovered that whole number ratio relationships between freqencies sounds pleasant to our ears.
// In fact, the Pythagorean tuning maps each note in a major scale to have the following ratio relationships with the root (first) note: 1/1     9/8     5/4     4/3     3/2     5/3     15/8     2/1.
// You can learn more about mathmatics of musical harmony here: 
// https://www.asa3.org/ASA/education/teach/harmony-cr.htm
// https://aatishb.com/dissonance/
// Two genes a perfect fifth apart (example here) suggest whenever one gene completes three cycles, the other one completes two cycles. 
// While relationships discovered this way may not be biological (the methods sections discusses the limitations), they might be worth looking further into. At the very least, it is a fun way to explore this dataset and you can also use it to make some music!