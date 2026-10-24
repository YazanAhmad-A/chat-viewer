// Dev-only static file server: `node scripts/serve.mjs` then browse localhost.
// Browsers only grant IndexedDB over http(s), so file:// isn't enough.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'

const root = process.cwd()
const port = Number(process.env.PORT) || 8080
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
}

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname.endsWith('/')) pathname += 'index.html'
    const file = resolve(root, '.' + pathname)
    if (file !== root && !file.startsWith(root + sep)) throw new Error('traversal')
    const body = await readFile(file)
    res.writeHead(200, { 'Content-Type': types[extname(file).toLowerCase()] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
}).listen(port, () => console.log(`serving ${root} at http://localhost:${port}`))
