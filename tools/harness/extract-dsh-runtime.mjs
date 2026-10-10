#!/usr/bin/env node
/**
 * extract-dsh-runtime.mjs — materialize the DSH runtime tree that ships INSIDE
 * `D:\DSHD\resources\app.asar` into a plain directory, so an ordinary console
 * `node.exe` (which has no ASAR support) can `import` the `dsh` CLI from it.
 *
 * Why this exists (route (a) of docs/02-harness.md): Electron patches `fs` with
 * ASAR support, plain Node does not; `app.asar` is a regular file to node.exe.
 * This script is READ-ONLY with respect to the installation: it never writes
 * into `D:\DSHD` and never modifies the archive.
 *
 * Modes
 *   --stats                print file count / total bytes for the subtree, write nothing
 *   (default)              extract the subtree into --dest
 *
 * Layout produced (mirrors what Electron presents at runtime):
 *   <dest>\dsh\node_modules\...          files read out of app.asar
 *   <dest>\dsh\node_modules\...          unpacked files copied from app.asar.unpacked
 *   <dest>\dsh\node_modules\...          `link` entries materialized as real file copies
 *
 * Usage:
 *   node extract-dsh-runtime.mjs --stats
 *   node extract-dsh-runtime.mjs --dest <WS>\_harness\extracted
 */
import { open } from 'node:fs/promises'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULTS = {
  archive: 'D:\\DSHD\\resources\\app.asar',
  unpacked: 'D:\\DSHD\\resources\\app.asar.unpacked',
  subtree: 'dsh',
}

function parseArgs(argv) {
  const out = { ...DEFAULTS, dest: undefined, stats: false }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--stats') out.stats = true
    else if (flag === '--archive') out.archive = argv[++i]
    else if (flag === '--unpacked') out.unpacked = argv[++i]
    else if (flag === '--subtree') out.subtree = argv[++i]
    else if (flag === '--dest') out.dest = argv[++i]
    else throw new Error(`unknown argument: ${flag}`)
  }
  return out
}

/** Read the double-nested pickle header of an ASAR archive. */
async function loadHeader(fh) {
  const sz = Buffer.alloc(16)
  await fh.read(sz, 0, 16, 0)
  const headerBufBytes = sz.readUInt32LE(4)
  const jsonLen = sz.readUInt32LE(12)
  if (jsonLen <= 0 || jsonLen > 64 * 1024 * 1024) {
    throw new Error(`implausible asar header jsonLen=${jsonLen} headerBufBytes=${headerBufBytes}`)
  }
  const buf = Buffer.alloc(jsonLen)
  await fh.read(buf, 0, jsonLen, 16)
  const header = JSON.parse(buf.toString('utf8').replace(/\0+$/, '').trimEnd())
  return { header, base: 8 + headerBufBytes }
}

function walk(node, parts) {
  let cur = node
  for (const part of parts) {
    if (!cur.files) return null
    cur = cur.files[part]
    if (!cur) return null
  }
  return cur
}

/** Depth-first collect of every file entry under `root`, with its posix-style path. */
function collect(root) {
  const files = []
  const visit = (node, prefix) => {
    if (!node.files) {
      files.push({ node, path: prefix })
      return
    }
    for (const [name, child] of Object.entries(node.files)) visit(child, prefix ? `${prefix}/${name}` : name)
  }
  visit(root, '')
  return files
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const fh = await open(args.archive, 'r')
  try {
    const { header, base } = await loadHeader(fh)
    const subtreeParts = args.subtree.split('/').filter(Boolean)
    const root = walk(header, subtreeParts)
    if (!root || !root.files) throw new Error(`subtree not found in archive: ${args.subtree}`)
    const files = collect(root)

    let totalBytes = 0
    let unpackedCount = 0
    let linkCount = 0
    for (const { node } of files) {
      totalBytes += Number(node.size ?? 0)
      if (node.unpacked) unpackedCount++
      if (node.link) linkCount++
    }

    if (args.stats) {
      console.log(JSON.stringify({ subtree: args.subtree, files: files.length, totalBytes, unpackedCount, linkCount }, null, 2))
      return
    }
    if (!args.dest) throw new Error('--dest <dir> is required to extract (or pass --stats)')

    const destRoot = resolve(args.dest, ...subtreeParts)
    const archiveRoot = resolve(args.archive)
    let written = 0
    let bytes = 0

    // Resolve link entries to the bytes of their target, so the extraction has
    // no symlinks (Windows + file-sync tools handle them badly).
    const resolveLink = async (node) => {
      const linkParts = node.link.split('/').filter(Boolean)
      let target = walk(header, linkParts)
      const read = linkParts.includes('..')
        ? await readFile(join(args.unpacked, ...linkParts), null)
        : null
      if (read) return { buffer: read }
      if (!target) throw new Error(`link target not found: ${node.link}`)
      if (target.files) throw new Error(`link target is a directory: ${node.link}`)
      if (target.unpacked) return { copy: join(args.unpacked, ...linkParts) }
      const buf = Buffer.alloc(target.size)
      await fh.read(buf, 0, target.size, base + Number(target.offset || 0))
      return { buffer: buf }
    }

    for (const { node, path } of files) {
      const dest = join(destRoot, ...path.split('/'))
      await mkdir(dirname(dest), { recursive: true })
      if (node.link) {
        const resolved = await resolveLink(node)
        if (resolved.copy) await copyFile(resolved.copy, dest)
        else await writeFile(dest, resolved.buffer)
      } else if (node.unpacked) {
        await copyFile(join(args.unpacked, ...subtreeParts, ...path.split('/')), dest)
      } else {
        const buf = Buffer.alloc(node.size)
        await fh.read(buf, 0, node.size, base + Number(node.offset || 0))
        await writeFile(dest, buf)
      }
      written++
      bytes += Number(node.size ?? 0)
      if (written % 500 === 0) process.stderr.write(`extracting ${written}/${files.length}\r`)
    }
    process.stderr.write(`\n`)
    console.log(JSON.stringify({ destRoot, written, bytes }, null, 2))
  } finally {
    await fh.close()
  }
}

export { loadHeader, walk, collect }

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  await main()
}
