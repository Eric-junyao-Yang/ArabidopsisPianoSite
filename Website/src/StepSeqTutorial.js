const tutorialContent = {
    "step0": {
        "highlight_object": {type: "DOM", region: "StepSeqMain"},
        "content": "Here's a tutorial that guides you through the Step Sequencer. \
        You can exit out by clicking the X button at any time. \
        You can restart the tutorial by clicking the (?) button.",
        setup(bus, geneLookup) {
            const gene_list = ["AT3G50845", "AT2G46150", "AT2G20950", "AT1G73820", "AT3G22180", 
                "AT3G56960", "AT5G18670", "AT1G74660", "AT1G15260", "AT2G19830", "AT3G02870", 
                "AT2G23840", "AT4G09760"]
            const selected = new Set(
                gene_list.map((id) => geneLookup.get(id)).filter(Boolean)
            )
            bus.execute_event("selection_set", selected)
        },
        "unmask": "StepSeqMain",
        "block_interaction": true,
        // outside: below|above|middle + left|center|right
        // inside:  inside-top|inside-bottom|inside-center + -left|-center|-right
        "tooltip_position": "inside-bottom-right",
    },
    "step1": {
        "highlight_object": {type: "DOM", region: "StepSeqControls"},
        "content": "Before we dive into the plot, here are some selected genes to show you what the Step Sequencer can do. Press play! You can pause or stop at any time.",
        "unmask": "StepSeqControls",
        "block_interaction": false,
        "tooltip_position": "below-left",
    },
    "step2": {
        "highlight_object": {type: "DOM", region: "StepSeqMain"},
        "content": "Absolutely cursed. Let's dive into what all this means.",
        "unmask": "StepSeqMain",
        "block_interaction": true,
        "tooltip_position": "inside-bottom-center",
    },    
    "step3": {
        "highlight_object": {type: "DOM", region: "StepSeqMain"},
        setup(bus, geneLookup) {
            bus.execute_event("selection_set", new Set())
        },
        "content": "Here are 3286 Arabidopsis genes that are potentially oscillating. Each point is a gene.",
        "unmask": "StepSeqMain",
        "block_interaction": true,
        "tooltip_position": "inside-bottom-center",
    },
    "step4": {
        "highlight_object": {type: "DOM", region: "y-axis"},
        "content": "The y-axis shows the detected oscillating period of the gene. \
        The detection is capped between 6 and 32 hours (see methods for more details).",
        "unmask": "StepSeqMain",
        "block_interaction": true,
        "tooltip_position": "middle-right",
    },
    "step5": {
        "highlight_object": {type: "DOM", region: "x-axis"},
        "content": "The x-axis shows the time where the waveform peaks given a detected period.",
        "unmask": "StepSeqMain",
        "block_interaction": true,
        "tooltip_position": "above-center",
    },
    "step6": {
        "highlight_object": "StepSeqMain - A row",
        "content": "This allows us to separate the multiple genes that share the same frequency, by separating them by when they peak."
    },
    "step7": {
        "highlight_object": "StepSeqMain - AT4G24340",
        "content": "This gene, for instance, completes a cycle about every 9 hours. And it peaks at around 3 hours past dawn."
    },
    "step7": {
        "highlight_object": "StepSeqMain - GPplot",
        "content": "We can confirm that this is the case by looking at the waveform here. \
        Notice the waveform cycles about every 9 hours, and peaks around 3.\
        We'll come back to this plot later."
    },
    "step8": {
        "highlight_object": "StepSeqMain - y-axis - piano + AT4G24340",
        "content": "We can scale the detected oscillating frequency up to the audible range and map it to a keyboard. \
        This makes the relative pitches you hear between notes map to the relative difference in their oscillating speed."
    },
    "step9": {
        "highlight_object": "StepSeqMain - AT4G24340",
        "content": "This gene peaks at around 3 hours after every 9 hour cycling, this means it should peaks around 12 hours and 21 hours as the \
        waveform loops again and again. You can click and drag the point to these equivalent phases."
    },
    "step10": {
        "highlight_object": "StepSeqMain - GPplot",
        "content": "Focusing on the points here first. These are actual experimental data. We can see there is quite a bit of noise \
        and the points look quite clustered together. You can toggle between the full experimental period of 48 hours, or \
        wrap the data around the detected period to see how convincing the period is. Just looking at the points, how sure are we that this gene is really oscillating?"
    },
    "step11": {
        "highlight_object": "StepSeqMain - q-value",
        "content": "The q-value tells us the probability that a random experimental data might be mistaken for oscillation. \
        A hard cutoff of 20% is set for this display and that is TREMENDOUSLY liberal. While this allows for more sounds to play with, \
        They might not all be real oscillations. You can use these violin plots to make your selection more stringent. Click and drag the \
        top and bottom to set a range, and click and drag the entire range itself to reposition it. A q-value of less than 5% is typical."
    },
    "step12": {
        "highlight_object": "StepSeqMain - AT4G08930",
        "content": "Lets pick a gene closer to the beginning of the plot so we can hear it quicker. Have a listen if you want."
    },
    "step13": {
        "highlight_object": "StepSeqMain - AT4G08930",
        "content": "If you have a keen ear, you might hear a slight wobble in the sound. That's because what you're hearing are 10 possible \
        waveforms that match the experimental data."
    },
    "step14": {
        "highlight_object": "StepSeqMain - GPplot",
        "content": "As mentioned earlier, the points here are the experimental data. Compared to the previous gene, it looks more periodic \
        it has a much lower q-value! Notice there are 10 waveforms drawn for each gene. These 10 waveforms are pulled from all possible waveforms \
        that would satisfy the experimental data. The band shows the 95% confidence interval for the waveforms, and the blue line is the average."
    },
    "step15": {
        "highlight_object": "StepSeqMain - AT4G08930",
        "content": "When you here a note, it morphs through the 10 sampled waveforms at a speed matching the confidence interval range. So the more \
        wobble you hear, the less certain we are of the waveform's shape."
    },
    "step16": {
        "highlight_object": "StepSeqMain - relative std",
        "content": "You can also filter how wide the 95% confidence interval you find acceptable by using this violin plot."
    },
    "step17": {
        "highlight_object": "StepSeqMain - gene list",
        "content": "This shows you the list of genes you have selected so far. And clicking on the gene shows you a focused view on the gene."
    },
    "step18": {
        "highlight_object": "StepSeqMain - mainplot, focused on AT5G14740, show Unison",
        "content": "This band shows the 95% confidence interval for the focused gene's detected period. We're farely certain it falls within this band."
    },
    "step19": {
        "highlight_object": "StepSeqMain - mainplot, focused on AT5G14740, show Perfect Fifth",
        "content": "These other bands show frequencies with small integer ratio relationship with the focused gene. For example, a frequency that is \
        a perfect fifth to our selected freqency would indicate for every 2 cycles the selected gene completes, the other gene would have completed 3. \
        If you click on a band, it locks the band in (click away to cancel), and shows you any gene whose detected period's 95% CI intersects with your focused gene. Deeper the color \
        the more they overlap."
    },
    "step20": {
        "highlight_object": "StepSeqMain - mainplot, focused on AT5G14740, select AT4G17680",
        "content": "If you play them together, they should sound pleasant!"
    },
    "step21": {
        "highlight_object": "None",
        "content": "You can zoom in and out, double click to reset view, and use the reset buttom to reset the gene selections. \
        This is mainly it! You can use this to explore sets of genes with mathmatical relationships with each other, or just try and \
        make some music. "
    }
}

export class stepSeqTutorial {
    constructor(bus, geneLookup) {
        this.bus = bus
        this.geneLookup = geneLookup // Map GeneID → osc_perGene_meta row
        this.tutorialMask = document.getElementById("StepSeqTutorialMask")
        this.Tooltip = document.getElementById("StepSeqTooltip")
        this.parent = document.getElementById("StepSequencerContainer")
        this.prevBtn = document.getElementById("StepSeqTooltipPrev")
        this.nextBtn = document.getElementById("StepSeqTooltipNext")
        this.highlightBox = document.createElement("div")
        this.highlightBox.className = "tutorial-highlight"
        this.parent.appendChild(this.highlightBox)
        this.elevatedEl = null // last unmasked element (so Prev/Next can clear it reliably)
        this.step_counter = 0
        this._stagedStep = -1 // last step index that ran setup()
        // Layout can shift after load (fonts, scroll, resize) — remeasure, don't re-run setup.
        this._onRelayout = () => this.showStep({ restage: false })
        window.addEventListener("resize", this._onRelayout)
        this.showStep()
    }

    /** Viewport rect → coordinates relative to #StepSequencerContainer */
    rectInParent(el) {
        const r = el.getBoundingClientRect()
        const p = this.parent.getBoundingClientRect()
        return {
            left: r.left - p.left + this.parent.scrollLeft,
            top: r.top - p.top + this.parent.scrollTop,
            width: r.width,
            height: r.height,
        }
    }

    placeHighlight(highlightRect, pad = 4) {
        this.highlightBox.style.left = `${highlightRect.left - pad}px`
        this.highlightBox.style.top = `${highlightRect.top - pad}px`
        this.highlightBox.style.width = `${highlightRect.width + pad * 2}px`
        this.highlightBox.style.height = `${highlightRect.height + pad * 2}px`
    }

    /**
     * Place the tooltip relative to the highlight rect.
     *
     * tooltip_position options:
     *
     *   outside — "{below|above|middle}-{left|center|right}"
     *     below/above: sit under/over the box; left|center|right = horizontal align
     *     middle:      sit beside the box, Y-centered; left|right = which side
     *                  (middle-center falls back to middle-right)
     *   inside  — "inside-{top|bottom|center}-{left|center|right}"
     */
    placeTooltip(highlightRect, position = "below-left") {
        const gap = 12       // space between highlight box and tooltip when outside
        const inset = 10     // padding from highlight box edges when inside
        const margin = 8     // keep tooltip inside the parent container
        const parentW = this.parent.clientWidth
        const parentH = this.parent.clientHeight
        const tipW = this.Tooltip.offsetWidth
        const tipH = this.Tooltip.offsetHeight

        const parts = String(position).toLowerCase().split("-")
        const inside = parts[0] === "inside"
        // inside-bottom-right → ["inside","bottom","right"]
        // below-left          → ["below","left"]
        // middle-right        → ["middle","right"]
        const side = inside ? parts[1] : parts[0] // below|above|middle|top|bottom|center
        const align = inside ? (parts[2] || "left") : (parts[1] || "left")

        let left
        let top

        if (inside) {
            // --- inside the highlight ---
            if (align === "right") {
                left = highlightRect.left + highlightRect.width - tipW - inset
            } else if (align === "center") {
                left = highlightRect.left + (highlightRect.width - tipW) / 2
            } else {
                left = highlightRect.left + inset
            }

            if (side === "top") {
                top = highlightRect.top + inset
            } else if (side === "center") {
                top = highlightRect.top + (highlightRect.height - tipH) / 2
            } else {
                top = highlightRect.top + highlightRect.height - tipH - inset // bottom
            }
        } else if (side === "middle") {
            // --- outside, vertically centered, to the left or right of the box ---
            top = highlightRect.top + (highlightRect.height - tipH) / 2
            if (align === "left") {
                left = highlightRect.left - tipW - gap
            } else {
                // right (and center → treat as right; overlapping the box is never useful)
                left = highlightRect.left + highlightRect.width + gap
            }
        } else {
            // --- outside above / below; align along the highlight width ---
            if (align === "right") {
                left = highlightRect.left + highlightRect.width - tipW
            } else if (align === "center") {
                left = highlightRect.left + (highlightRect.width - tipW) / 2
            } else {
                left = highlightRect.left
            }

            if (side === "above") {
                top = highlightRect.top - tipH - gap
            } else {
                top = highlightRect.top + highlightRect.height + gap // below
            }
        }

        // Final safety: never leave the parent, even if the requested corner overflows
        left = Math.max(margin, Math.min(left, parentW - tipW - margin))
        top = Math.max(margin, Math.min(top, parentH - tipH - margin))

        this.Tooltip.style.left = `${left}px`
        this.Tooltip.style.top = `${top}px`
    }

    showStep({ restage = true } = {}){
        const total = Object.keys(tutorialContent).length
        const currentContent = tutorialContent[`step${this.step_counter}`]

        // Clear previous unmask + block (works for both Next and Prev)
        if (this.elevatedEl) {
            this.elevatedEl.classList.remove("tutorial-elevated", "tutorial-block-interaction")
            this.elevatedEl = null
        }

        // Run setup only when entering a step (not on every resize remeasure)
        if (restage && this._stagedStep !== this.step_counter) {
            currentContent.setup?.(this.bus, this.geneLookup)
            this._stagedStep = this.step_counter
        }

        let highlightRect = null
        // Remeasure every step — do not reuse a constructor-time parentBbox
        if (currentContent.highlight_object.type === "DOM") {
            const query = `[data-tutorial-region="${currentContent.highlight_object.region}"]`
            const highlightEl = document.querySelector(query)
            highlightRect = this.rectInParent(highlightEl)
            this.placeHighlight(highlightRect)
        }


        // unmask: lift above the dim mask so the target looks bright
        // block_interaction: disable pointer events on that same element (and children)
        const unmaskObject = currentContent.unmask
            ? document.getElementById(currentContent.unmask)
            : null
        if (unmaskObject) {
            unmaskObject.classList.add("tutorial-elevated")
            unmaskObject.classList.toggle(
                "tutorial-block-interaction",
                !!currentContent.block_interaction
            )
            this.elevatedEl = unmaskObject
        }

        // Copy first so tooltip size is correct, then position/clamp
        const body = this.Tooltip.querySelector(".tutorial-tooltip__body")
        const count = this.Tooltip.querySelector(".tutorial-tooltip__count")
        if (body) body.textContent = currentContent.content
        if (count) count.textContent = `${this.step_counter + 1}/${total}`
        this.Tooltip.style.display = "block"
        this.placeTooltip(highlightRect, currentContent.tooltip_position || "below-left")

        if (this.prevBtn) this.prevBtn.disabled = this.step_counter === 0
        if (this.nextBtn) this.nextBtn.disabled = this.step_counter >= total - 1
    }
    prevStep(){
        if (this.step_counter <= 0) return
        this.step_counter--
        this.showStep()
    }
    nextStep(){
        const total = Object.keys(tutorialContent).length
        if (this.step_counter >= total - 1) return
        this.step_counter++
        this.showStep()
    }
    close(){
        if (this.elevatedEl) {
            this.elevatedEl.classList.remove("tutorial-elevated", "tutorial-block-interaction")
            this.elevatedEl = null
        }
        window.removeEventListener("resize", this._onRelayout)
        this.tutorialMask.style.display = "none"
        this.highlightBox.style.display = "none"
        this.Tooltip.style.display = "none"
    }
}