const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT = 3000
const ROOT = __dirname
const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.bin':  'application/octet-stream',
    '.css':  'text/css',
    '.mid':  'audio/midi',
    '.midi': 'audio/midi',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg':  'image/svg+xml',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
}

http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy',   'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')

    const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
    const filePath = path.normalize(path.join(ROOT, rel))

    // Block path traversal outside the site root
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403)
        res.end()
        return
    }

    const ext = path.extname(filePath)

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
        res.end(data)
    })
}).listen(PORT, () => console.log(`http://localhost:${PORT}`))
