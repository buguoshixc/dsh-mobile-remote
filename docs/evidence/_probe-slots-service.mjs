// Read-only probe helper: locate the client 'slots' service registration in the
// packaged shell bundle dump. Writes nothing; prints only.
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const s = readFileSync(file, 'utf8')
const patterns = process.argv.slice(3)

for (const pat of patterns) {
  let i = -1
  let c = 0
  while ((i = s.indexOf(pat, i + 1)) >= 0 && c < 8) {
    const from = Math.max(0, i - 260)
    console.log(`--- ${pat} @${String(i)} :: ${s.slice(from, i + 260).replace(/\s+/g, ' ')}`)
    c += 1
  }
}
