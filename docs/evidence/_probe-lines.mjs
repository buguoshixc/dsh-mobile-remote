// Read-only line/pin locator used for T1 evidence citations.
// PowerShell Select-String reported drifting line numbers on these large UTF-8
// bundles, so every contract citation is pinned with this scanner instead.
// Prints only; writes nothing.
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const patterns = process.argv.slice(3)
const lines = readFileSync(file, 'utf8').split(/\r?\n/)

for (const pat of patterns) {
  const hits = []
  lines.forEach((line, index) => {
    if (line.includes(pat)) hits.push(index + 1)
  })
  console.log(`${JSON.stringify(pat)}\t${hits.join(',') || '(none)'}`)
}
