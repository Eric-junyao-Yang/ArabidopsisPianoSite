export function setupHelpPopUps(document, window){
    const helpPopup = document.querySelector("#help-popup")
    const helpPanels = document.querySelectorAll(".help-panel")

    let activeBtn = null

    // Set up button + append to all divs
    helpPanels.forEach(panel => {
        const btn = document.createElement("button")
        btn.textContent = "?"
        btn.className = "help-button"
        btn.style.position = "absolute"
        btn.style.top = "0px"
        btn.style.right = "0px"
        btn.style.width = "24px"
        btn.style.height = "24px"
        btn.style.border = "1px solid #888"
        btn.style.borderRadius = "50%"
        btn.style.cursor = "pointer"
        panel.appendChild(btn)
    })

    document.addEventListener("click", event => {
        const btn = event.target.closest(".help-button")
        if (btn) {
            const panel = btn.closest(".help-panel")
            closeHelp()
            if (activeBtn !== btn) {
                openHelp(panel, btn)
            }
            return
        }

        if (!event.target.closest("#help-popup") && activeBtn) {
            closeHelp()
        }
    })

    function openHelp(panel, btn){
        activeBtn = btn
        
        helpPopup.textContent = panel.dataset.helpText
        helpPopup.classList.add("open")

        activeBtn.textContent = "x"

        positionPopup(activeBtn)
    }

    function closeHelp(){
        if (!activeBtn) {
            return
        }

        activeBtn.textContent = "?"
        activeBtn = null
        helpPopup.classList.remove("open")
    }

    function positionPopup(btn){
        const buttonRect = btn.getBoundingClientRect()
        const popupRect = helpPopup.getBoundingClientRect()

        let left = buttonRect.right - popupRect.width - 20
        let top = buttonRect.bottom

        helpPopup.style.left = `${left}px`;
        helpPopup.style.top = `${top}px`;
    }

    window.addEventListener("resize", () => {
        if (activeBtn){
            positionPopup(activeBtn)
        }
    })

    window.addEventListener("scroll", () => {
        if (activeBtn){
            positionPopup(activeBtn)
        }
    })
}