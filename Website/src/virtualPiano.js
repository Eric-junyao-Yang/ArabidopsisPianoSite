import { PALETTE, THEME } from "/src/plots/plotTheme.js"

export class virtualPiano {
    constructor(synth_node, div, bus){
        this.synth_node = synth_node
        this.div = div
        this.bus = bus
        this.keys = ["a","w","s","e","d","f","t","g","y","h","u","j","k","o","l","p",";"] //' is skipped as it is reserved
        this.middle_c = 261.6256
        this.key_freq_map = new Map()
        this.keys.forEach((v, i) => {
            this.key_freq_map.set(v, this.middle_c*Math.pow(Math.pow(2, 1/12), i))
        })
        this.notes_playing = new Set()
        this.isNotePlaying = false
        this.octave = 0 // mirrors the synth worklet's octave shift (same ±3 clamp)
        this.capture = null // { keyDown(key, freq), keyUp(key) } while another instrument borrows the keyboard

        let last = ""
        const build = () => this.drawPiano()
        build()
        new ResizeObserver(() => {
            const key = `${div.clientWidth}x${div.clientHeight}`
            if (key === last) return
            last = key
            build()
        }).observe(div)
        last = `${div.clientWidth}x${div.clientHeight}`

        this.assign_keyboard_keys()


        //buses

        this.bus.subscribe_to("synthetic_keyDown", "virtualPiano", (key) => {
            this.keyDown(key)
        })
        this.bus.subscribe_to("synthetic_keyUp", "virtualPiano", (key) => {
            this.keyUp(key)
        })
        // Another instrument (e.g. the harmonic mixer) takes the note keys; null hands them back to the synth
        this.bus.subscribe_to("piano_capture", "virtualPiano", (handler) => {
            this.releaseSynthNotes() // otherwise their keyUp would go to the new target and they'd hang
            this.capture = handler
        })
    }

    drawPiano(){
        const div = this.div
        d3.select(div).selectAll("svg").remove()
        const containerWidth = div.clientWidth
        const containerHeight = div.clientHeight
        if (!containerWidth || !containerHeight) return
        const compact = containerWidth < 520
        const margin = {top: 10, left: 10, bottom: 10, right: 15}
        const innerWidth = containerWidth - (margin.left + margin.right)
        const innerHeight = containerHeight - (margin.top + margin.bottom)

        const octaveWidth = compact ? 38 : 50
        const gap = 10 // between keys and octave buttons
        const pianoWidth = innerWidth - (octaveWidth + gap)

        const wKeyWidth = pianoWidth / 10
        const bKeyWidth = pianoWidth / 20

        const svg = d3.select(div).append("svg")
            .attr("width", containerWidth)
            .attr("height", containerHeight)
            .style("display", "block")

        const root = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`)
        const wKeys = root.append('g')
        const bKeys = root.append('g')
        const octControls = root.append('g')
            .attr("transform", `translate(${pianoWidth + gap}, 0)`)

        const wKeys_list = [
            { key: "a", index: 0},
            { key: "s", index: 1},
            { key: "d", index: 2},
            { key: "f", index: 3},
            { key: "g", index: 4},
            { key: "h", index: 5},
            { key: "j", index: 6},
            { key: "k", index: 7},
            { key: "l", index: 8},
            { key: ";", index: 9}
        ]
        const bKeys_list = [
            { key: "w", index: 0},
            { key: "e", index: 1},
            { key: "t", index: 3},
            { key: "y", index: 4},
            { key: "u", index: 5},
            { key: "o", index: 7},
            { key: "p", index: 8}
        ]

        const bindKeyPointer = (selection) => {
            selection
                .style("cursor", "pointer")
                .on("pointerdown", (event, d) => {
                    event.preventDefault()
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                    this.keyDown(d.key)
                })
                .on("pointerup pointercancel lostpointercapture", (event, d) => {
                    this.keyUp(d.key)
                })
        }

        bindKeyPointer(
            wKeys.selectAll(".piano-key")
                .data(wKeys_list)
                .enter()
                .append("rect")
                .attr("class", "piano-key")
                .attr("id", d => `key-${d.key}`)
                .attr("width", wKeyWidth)
                .attr("height", innerHeight)
                .attr("y", 0)
                .attr("x", d => d.index * wKeyWidth)
                .attr("rx", 5)
                .attr("fill", "#ffffff")
                .attr("stroke", THEME.axis)
                .attr("stroke-width", 1.5)
        )

        function styleKeyHint(selection) {
            return selection
                .attr("class", "key-hint")
                .attr("font-size", compact ? 10 : 11)
                .attr("fill", THEME.muted)
                .style("font-family", THEME.fontMono)
                .attr("pointer-events", "none")
        }

        // computer-keyboard hints at the bottom of each white key
        styleKeyHint(
            wKeys.selectAll("text.key-hint")
                .data(wKeys_list)
                .enter()
                .append("text")
        )
            .attr("x", (d) => d.index * wKeyWidth + wKeyWidth / 2)
            .attr("y", innerHeight - 10)
            .attr("text-anchor", "middle")
            .style("text-transform", "uppercase")
            .text((d) => d.key)

        bindKeyPointer(
            bKeys.selectAll(".piano-key")
                .data(bKeys_list)
                .enter()
                .append("rect")
                .attr("class", "piano-key")
                .attr("id", d => `key-${d.key}`)
                .attr("width", bKeyWidth)
                .attr("height", innerHeight * 2/3)
                .attr("y", 0)
                .attr("x", d => (d.index * wKeyWidth) + (wKeyWidth * 3/4))
                .attr("rx", 4)
                .attr("fill", THEME.ink)
                .attr("stroke", THEME.ink)
                .attr("stroke-width", 1.5)
        )

        const bindOctavePointer = (selection, key) => {
            selection
                .style("cursor", "pointer")
                .on("pointerdown", (event) => {
                    event.preventDefault()
                    event.currentTarget.setPointerCapture?.(event.pointerId)
                    this.keyDown(key)
                })
                .on("pointerup pointercancel lostpointercapture", () => {
                    this.keyUp(key)
                })
        }

        // Octave shift buttons — arrow + corner keyboard cue (same style as key hints)
        const octHintInset = compact ? 7 : 8

        const octUp = octControls.append("g")
            .attr("transform", `translate(0, ${octaveWidth / 2})`)
            .attr("class", "octave-button")
            .attr("id", "octave-up")
        bindOctavePointer(octUp, "]")

        octUp.append("rect")
            .attr("width", octaveWidth)
            .attr("height", octaveWidth)
            .attr("x", 0)
            .attr("y", 0)
            .attr("rx", 10)
            .attr("fill", "#ffffff")
            .attr("stroke", THEME.axis)
            .attr("stroke-width", 1.5)
        octUp.append("polygon")
            .attr("points",
                `${octaveWidth / 2}, 8
                10, ${octaveWidth - 10}
                ${octaveWidth - 10}, ${octaveWidth - 10}`)
            .attr("fill", PALETTE.indigo)
            .attr("pointer-events", "none")
        styleKeyHint(octUp.append("text"))
            .attr("x", octaveWidth - octHintInset)
            .attr("y", octHintInset + 2)
            .attr("text-anchor", "end")
            .attr("dominant-baseline", "hanging")
            .attr("font-weight", "bold")
            .text("]")

        const octDown = octControls.append("g")
            .attr("transform", `translate(0, ${(innerHeight - octaveWidth) - octaveWidth / 2})`)
            .attr("class", "octave-button")
            .attr("id", "octave-down")
        bindOctavePointer(octDown, "[")

        octDown.append("rect")
            .attr("width", octaveWidth)
            .attr("height", octaveWidth)
            .attr("x", 0)
            .attr("y", 0)
            .attr("rx", 10)
            .attr("fill", "#ffffff")
            .attr("stroke", THEME.axis)
            .attr("stroke-width", 1.5)
        octDown.append("polygon")
            .attr("points",
                `10, 10
                ${octaveWidth - 10}, 10
                ${octaveWidth / 2}, ${octaveWidth - 8}`)
            .attr("fill", PALETTE.indigo)
            .attr("pointer-events", "none")
        styleKeyHint(octDown.append("text"))
            .attr("x", octaveWidth - octHintInset)
            .attr("y", octaveWidth - octHintInset)
            .attr("text-anchor", "end")
            .attr("dominant-baseline", "auto")
            .attr("font-weight", "bold")
            .text("[")
    }

    isTypingTarget(el) {
        if (!el || el === document.body) return false
        const tag = el.tagName
        return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
    }

    assign_keyboard_keys(){
        window.addEventListener('keydown', (e) => {
            if (this.isTypingTarget(e.target)) return
            if (e.key === "'") {
                e.preventDefault() // firefox default is quickfind
                return
            }
            if (e.repeat) return
            this.keyDown(e.key)
        })
        // Always release — focus can move into an input while a key is held
        window.addEventListener('keyup', (e) => {
            this.keyUp(e.key)
        })
    }

    notes_playing_message(){
        this.bus.execute_event("notes_playing", this.isNotePlaying)
    }

    updateDownKeys(key){
        const pianoKey = document.getElementById(`key-${key}`)
        if (pianoKey) {
            pianoKey.classList.add("pressed")
            this.notes_playing.add(key)
            if (!this.isNotePlaying){
                this.isNotePlaying = true
                this.notes_playing_message()
            }
            return
        }
        if (key === "[") {
            document.getElementById("octave-down")?.classList.add("pressed")
        }
        if (key === "]") {
            document.getElementById("octave-up")?.classList.add("pressed")
        }
    }

    updateUpKeys(key){
        const pianoKey = document.getElementById(`key-${key}`)
        if (pianoKey) {
            pianoKey.classList.remove("pressed")
            this.notes_playing.delete(key)
            if (this.notes_playing.size === 0) {
                this.isNotePlaying = false
                this.notes_playing_message()
            }
            return
        }
        if (key === "[") {
            document.getElementById("octave-down")?.classList.remove("pressed")
        }
        if (key === "]") {
            document.getElementById("octave-up")?.classList.remove("pressed")
        }
    }

    // The key's pitch including the octave shift
    keyFreq(key){
        return this.key_freq_map.get(key) * Math.pow(2, this.octave)
    }

    releaseSynthNotes(){
        if (this.capture) return // the captured notes never reached the synth
        for (const key of [...this.notes_playing]) {
            this.synth_node?.port.postMessage({type: "keyUpUpdate", freq: this.key_freq_map.get(key)})
            this.updateUpKeys(key)
        }
    }

    keyDown(key){
        const synth_node = this.synth_node
        if (!synth_node) return
        if (this.key_freq_map.has(key)){
            if (this.capture) this.capture.keyDown(key, this.keyFreq(key))
            else synth_node.port.postMessage({type: "keyDownUpdate", freq: this.key_freq_map.get(key)})
            this.updateDownKeys(key)
        } else if (key === "["){
            this.octave = Math.max(-3, this.octave - 1)
            synth_node.port.postMessage({type: "synthFreqShift", dir: "down"})
            this.updateDownKeys(key)
        } else if (key === "]"){
            this.octave = Math.min(3, this.octave + 1)
            synth_node.port.postMessage({type: "synthFreqShift", dir: "up"})
            this.updateDownKeys(key)
        }
    }

    keyUp(key){
        const synth_node = this.synth_node
        if (!synth_node) return
        if (this.key_freq_map.has(key)){
            if (this.capture) this.capture.keyUp(key)
            else synth_node.port.postMessage({type: "keyUpUpdate", freq: this.key_freq_map.get(key)})
            this.updateUpKeys(key)
            return
        }
        if (key === "[" || key === "]") {
            this.updateUpKeys(key)
        }
    }
}
