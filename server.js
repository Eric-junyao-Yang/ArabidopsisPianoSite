const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT = 3000
const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.json': 'application/json',
    '.bin':  'application/octet-stream',
    '.css':  'text/css',
}

http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy',   'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')

    const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url)
    const ext      = path.extname(filePath)

    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' })
        res.end(data)
    })
}).listen(PORT, () => console.log(`http://localhost:${PORT}`))