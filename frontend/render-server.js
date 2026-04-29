import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.join(__dirname, 'dist')
const port = process.env.PORT || 3000

const app = express()

app.disable('x-powered-by')

app.use(
  express.static(distDir, {
    index: false,
    etag: true,
    maxAge: '1h',
  }),
)

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'))
})

app.listen(port, '0.0.0.0', () => {
  console.log(`SmartDispatch frontend serving ${distDir} on port ${port}`)
})
