export function setupVirtualPiano(synth_node, div){
    const containerWidth = div.clientWidth
    const containerHeight = div.clientHeight
    const margin = {top: 10, left: 10, bottom: 10, right: 10}
    const innerWidth = containerWidth - (margin.left + margin.right)
    const innerHeight = containerHeight - (margin.top + margin.bottom)

    const octaveWidth = 50
    const pianoWidth = innerWidth - (octaveWidth + margin.left)

    const wKeyWidth = pianoWidth / 10
    const bKeyWidth = pianoWidth / 20

    const svg = d3.select(div).append("svg")
        .attr("width", innerWidth)
        .attr("height", innerHeight)
        .attr("transform", `translate(${margin.left}, ${margin.top})`)

    const wKeys = svg.append('g')
    const bKeys = svg.append('g')
    const octControls = svg.append('g')
        .attr("transform", `translate(${pianoWidth + margin.right}, 0)`)

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

    function bindKeyPointer(selection) {
        selection
            .style("cursor", "pointer")
            .on("pointerdown", function(event, d) {
                event.preventDefault()
                this.setPointerCapture?.(event.pointerId)
                keyDown(synth_node, d.key)
            })
            .on("pointerup pointercancel lostpointercapture", function(event, d) {
                keyUp(synth_node, d.key)
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
            .attr("fill", "ivory")
            .attr("stroke", "black")
            .attr("stroke-width", 2)
    )

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
            .attr("fill", "ebony")
            .attr("stroke", "black")
            .attr("stroke-width", 2)
    )

    function bindOctavePointer(selection, key) {
        selection
            .style("cursor", "pointer")
            .on("pointerdown", function(event) {
                event.preventDefault()
                this.setPointerCapture?.(event.pointerId)
                keyDown(synth_node, key)
            })
            .on("pointerup pointercancel lostpointercapture", () => {
                keyUp(synth_node, key)
            })
    }

    // Set up Octaves control buttons
    const octUp = octControls.append('g')
        .attr("transform", `translate(0, ${octaveWidth/2})`)
        .attr("class", "octave-button")
        .attr("id", "octave-up")
    bindOctavePointer(octUp, "]")
    
    octUp.append('rect')
        .attr("width", octaveWidth)
        .attr("height", octaveWidth)
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "red")
    octUp.append("polygon")
        .attr("points", 
            `${octaveWidth / 2}, 8
            10, ${octaveWidth - 10}
            ${octaveWidth - 10}, ${octaveWidth - 10}`)
        .attr("fill", "orange")

    const octDown = octControls.append("g")
        .attr("transform", `translate(0, ${(innerHeight - octaveWidth) - octaveWidth/2})`)
        .attr("class", "octave-button")
        .attr("id", "octave-down")
    bindOctavePointer(octDown, "[")
    octDown.append('rect')
        .attr("width", octaveWidth)
        .attr("height", octaveWidth)
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "red")
    octDown.append("polygon")
        .attr("points", 
            `10, 10
            ${octaveWidth - 10}, 10
            ${octaveWidth / 2}, ${octaveWidth - 8}`)
        .attr("fill", "orange")    
}


function isTypingTarget(el) {
    if (!el || el === document.body) return false
    const tag = el.tagName
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable
}

export function assign_keyboard_keys(synth_node){
    window.addEventListener('keydown', (e) => {
        if (isTypingTarget(e.target)) return
        if (e.key === "'") {
            e.preventDefault() // firefox default is quickfind
            return
        }
        if (e.repeat) return
        keyDown(synth_node, e.key)
    })
    // Always release — focus can move into an input while a key is held
    window.addEventListener('keyup', (e) => {
        keyUp(synth_node, e.key)
    })
}


// shared helper function
const keys = ["a","w","s","e","d","f","t","g","y","h","u","j","k","o","l","p",";"] //' is skipped as it is reserved
const middle_c = 261.6256
const key_freq_map = new Map()
keys.forEach((v, i) => {
    key_freq_map.set(v, middle_c*Math.pow(Math.pow(2, 1/12), i))
})

function updateDownKeys(key){
    const pianoKey = document.getElementById(`key-${key}`)
    if (pianoKey) {
        pianoKey.classList.add("pressed")
        return
    }
    if (key === "[") {
        document.getElementById("octave-down")?.classList.add("pressed")
    }
    if (key === "]") {
        document.getElementById("octave-up")?.classList.add("pressed")
    }
}

function updateUpKeys(key){
    const pianoKey = document.getElementById(`key-${key}`)
    if (pianoKey) {
        pianoKey.classList.remove("pressed")
        return
    }
    if (key === "[") {
        document.getElementById("octave-down")?.classList.remove("pressed")
    }
    if (key === "]") {
        document.getElementById("octave-up")?.classList.remove("pressed")
    }
}

function keyDown(synth_node, key){
    if (!synth_node) return
    if (key_freq_map.has(key)){
        synth_node.port.postMessage({type: "keyDownUpdate", freq: key_freq_map.get(key)})
        updateDownKeys(key)
    } else if (key === "["){
        synth_node.port.postMessage({type: "synthFreqShift", dir: "down"})
        updateDownKeys(key)
    } else if (key === "]"){
        synth_node.port.postMessage({type: "synthFreqShift", dir: "up"})
        updateDownKeys(key)
    }
}

function keyUp(synth_node, key){
    if (!synth_node) return
    if (key_freq_map.has(key)){
        synth_node.port.postMessage({type: "keyUpUpdate", freq: key_freq_map.get(key)})
        updateUpKeys(key)
        return
    }
    if (key === "[" || key === "]") {
        updateUpKeys(key)
    }
}
