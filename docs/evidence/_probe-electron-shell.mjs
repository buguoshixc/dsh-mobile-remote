// Read-only probe: locate Electron-shell wiring for the Web GUI URL / transport.
// Prints only; writes nothing.
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const s = readFileSync(file, 'utf8')

const patterns = [
  '19387',
  'loadURL',
  '__DSH_TRANSPORT__',
  'streamBaseUrl',
  'dsh-desktop-host',
  'setWindowOpenHandler',
]

for (const pat of patterns) {
  let i = -1
  let c = 0
  console.log(`\n############ ${pat}`)
  while ((i = s.indexOf(pat, i + 1)) >= 0 && c < 6) {
    const from = Math.max(0, i - 420)
    console.log(`--- @${String(i)} :: ${s.slice(from, i + 420).replace(/\s+/g, ' ')}`)
    c += 1
  }
  if (c === 0) console.log('(not found)')
}
