/**
 * Combobox search for AGI GeneIDs (e.g. AT5G61380).
 * @param {HTMLInputElement} input
 * @param {HTMLElement} listEl
 * @param {Array<{GeneID: string}>} genes
 * @param {(item: object) => void} onSelect  called with the matched gene object
 */
export function searchbar(input, listEl, genes, onSelect) {
    const MAX_RESULTS = 8
    const optIdPrefix = `${listEl.id || "gene-search"}-opt`
    const index = genes.map((item) => {
        const id = item.GeneID
        return {
            item,
            id,
            lower: id.toLowerCase(),
        }
    })

    let activeIndex = -1
    let currentMatches = []
    let open = false

    function normalizeQuery(raw) {
        return raw.trim().toLowerCase().replace(/\s+/g, "")
    }

    /** Subsequence match: count matched chars, longest consecutive run, first match index. */
    function scoreAgainst(text, query) {
        let qi = 0
        let matched = 0
        let run = 0
        let bestRun = 0
        let first = -1
        let prev = -2

        for (let i = 0; i < text.length && qi < query.length; i++) {
            if (text[i] !== query[qi]) continue
            if (first < 0) first = i
            matched++
            run = i === prev + 1 ? run + 1 : 1
            if (run > bestRun) bestRun = run
            prev = i
            qi++
        }

        if (matched === 0) return null
        return { matched, consecutive: bestRun, start: first }
    }

    function rankMatches(query) {
        if (!query) return []

        const scored = []
        for (let i = 0; i < index.length; i++) {
            const entry = index[i]
            const score = scoreAgainst(entry.lower, query)
            if (!score) continue
            scored.push({ entry, score })
        }

        scored.sort((a, b) => {
            if (a.score.matched !== b.score.matched) return b.score.matched - a.score.matched
            if (a.score.consecutive !== b.score.consecutive) return b.score.consecutive - a.score.consecutive
            if (a.score.start !== b.score.start) return a.score.start - b.score.start
            return a.entry.id.length - b.entry.id.length
        })

        return scored.slice(0, MAX_RESULTS).map((s) => s.entry)
    }

    function appendHighlighted(el, id, query) {
        el.replaceChildren()
        if (!query) {
            el.textContent = id
            return
        }
        const lower = id.toLowerCase()
        const idx = lower.indexOf(query)
        const len = query.length
        if (idx === -1 || len === 0) {
            el.textContent = id
            return
        }
        if (idx > 0) el.append(id.slice(0, idx))
        const mark = document.createElement("mark")
        mark.textContent = id.slice(idx, idx + len)
        el.append(mark)
        if (idx + len < id.length) el.append(id.slice(idx + len))
    }

    function setOpen(next) {
        open = next
        input.setAttribute("aria-expanded", next ? "true" : "false")
        listEl.hidden = !next
        if (!next) {
            activeIndex = -1
            input.removeAttribute("aria-activedescendant")
        }
    }

    function close() {
        listEl.replaceChildren()
        currentMatches = []
        setOpen(false)
    }

    function render(matches, query) {
        currentMatches = matches
        activeIndex = matches.length ? 0 : -1
        listEl.replaceChildren()

        if (!matches.length) {
            if (query) {
                const empty = document.createElement("li")
                empty.className = "gene-search-empty"
                empty.setAttribute("role", "presentation")
                empty.textContent = "No genes found"
                listEl.append(empty)
                setOpen(true)
            } else {
                close()
            }
            return
        }

        const frag = document.createDocumentFragment()
        for (let i = 0; i < matches.length; i++) {
            const { id } = matches[i]
            const li = document.createElement("li")
            li.id = `${optIdPrefix}-${i}`
            li.className = "gene-search-option"
            li.setAttribute("role", "option")
            li.setAttribute("aria-selected", i === 0 ? "true" : "false")
            li.dataset.index = String(i)
            appendHighlighted(li, id, query)

            li.addEventListener("mousedown", (e) => {
                e.preventDefault()
            })
            li.addEventListener("click", () => selectIndex(i))

            frag.append(li)
        }
        listEl.append(frag)
        setOpen(true)
        syncActiveDescendant()
    }

    function syncActiveDescendant() {
        const options = listEl.querySelectorAll(".gene-search-option")
        options.forEach((el, i) => {
            const on = i === activeIndex
            el.classList.toggle("is-active", on)
            el.setAttribute("aria-selected", on ? "true" : "false")
        })
        if (activeIndex >= 0 && options[activeIndex]) {
            input.setAttribute("aria-activedescendant", options[activeIndex].id)
            options[activeIndex].scrollIntoView({ block: "nearest" })
        } else {
            input.removeAttribute("aria-activedescendant")
        }
    }

    function selectIndex(i) {
        const match = currentMatches[i]
        if (!match) return

        input.value = match.id
        close()
        onSelect(match.item)
        input.blur()
        input.value = ""
    }

    function onInput() {
        const query = normalizeQuery(input.value)
        render(rankMatches(query), query)
    }

    function onKeyDown(event) {
        if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            const query = normalizeQuery(input.value)
            if (query) render(rankMatches(query), query)
        }

        if (!open) {
            if (event.key === "Enter") {
                const query = normalizeQuery(input.value)
                const matches = rankMatches(query)
                if (matches.length === 1 || (matches.length && matches[0].lower === query)) {
                    event.preventDefault()
                    currentMatches = matches
                    selectIndex(0)
                }
            }
            return
        }

        switch (event.key) {
            case "ArrowDown":
                event.preventDefault()
                if (!currentMatches.length) return
                activeIndex = (activeIndex + 1) % currentMatches.length
                syncActiveDescendant()
                break
            case "ArrowUp":
                event.preventDefault()
                if (!currentMatches.length) return
                activeIndex = (activeIndex - 1 + currentMatches.length) % currentMatches.length
                syncActiveDescendant()
                break
            case "Enter":
                event.preventDefault()
                if (activeIndex >= 0) selectIndex(activeIndex)
                break
            case "Escape":
                event.preventDefault()
                close()
                break
            case "Tab":
                close()
                break
            default:
                break
        }
    }

    input.setAttribute("role", "combobox")
    input.setAttribute("aria-autocomplete", "list")
    input.setAttribute("aria-expanded", "false")
    input.setAttribute("aria-controls", listEl.id)
    input.setAttribute("autocomplete", "off")
    input.setAttribute("spellcheck", "false")
    listEl.setAttribute("role", "listbox")
    listEl.hidden = true

    input.addEventListener("input", onInput)
    input.addEventListener("keydown", onKeyDown)
    input.addEventListener("focus", () => {
        const query = normalizeQuery(input.value)
        if (query) render(rankMatches(query), query)
    })
    input.addEventListener("blur", () => {
        requestAnimationFrame(() => close())
    })
}
