/**
 * Every foldable section (details.fold) gets a "back to title" button that floats at the bottom
 * right of its open body (sticky, see .fold__back-to-top in styles.css). It only shows once the
 * section's title has scrolled out of view, and scrolls back to the title on click.
 */
export function setupFoldBackToTop(document, window) {
    const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const titleObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            const btn = entry.target.closest(".fold")?.querySelector(":scope > .fold__body > .fold__back-to-top")
            btn?.classList.toggle("is-visible", !entry.isIntersecting)
        }
    })

    for (const fold of document.querySelectorAll("details.fold")) {
        const summary = fold.querySelector(":scope > .fold__summary")
        const body = fold.querySelector(":scope > .fold__body")
        if (!summary || !body) continue
        const title = summary.querySelector(".fold__title")?.textContent.trim() ?? "section"

        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "fold__back-to-top"
        btn.setAttribute("aria-label", `Back to the top of “${title}”`)
        btn.title = "Back to section title"
        btn.innerHTML = '<span aria-hidden="true">↑</span>'
        btn.addEventListener("click", () => {
            summary.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" })
            summary.focus({ preventScroll: true }) // keyboard users land on the title too
        })
        body.append(btn)
        titleObserver.observe(summary)
    }
}
