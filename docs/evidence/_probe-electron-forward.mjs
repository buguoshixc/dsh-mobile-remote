// Read-only probe: Electron shell scheme / host-cookie / web-request forwarding.
// Prints only; writes nothing.
import { readFileSync } from 'node:fs'

const s = readFileSync(process.argv[2], 'utf8')
const patterns = ['forwardWebRequest', 'SCHEME =', 'authenticateWebHost', 'registerSchemesAsPrivileged']

for (const pat of patterns) {
  let i = -1
  let c = 0
  console.log(`\n############ ${pat}`)
  while ((i = s.indexOf(pat, i + 1)) >= 0 && c < 4) {
    console.log(`--- @${String(i)} :: ${s.slice(Math.max(0, i - 500), i + 700).replace(/\s+/g, ' ')}`)
    c += 1
  }
  if (c === 0) console.log('(not found)')
}
