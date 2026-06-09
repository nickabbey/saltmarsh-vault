#!/usr/bin/env node
// Pre-publish build step. Runs in CI before `npx quartz build`.
//
// 1. Image rewrite: replace Obsidian image embeds (![[file.ext]]) per image-map.json.
//      mapped url      -> ![](url)
//      url null/unmapped -> omitted, replaced with "(image pending)"
//    (Image binaries are gitignored and never published; URLs are NOT validated.)
//
// 2. Changelog: diff last-publish..HEAD over content/ and inject New/Updated
//    note lists between the <!-- CHANGELOG:START/END --> markers in content/index.md.
//
// DRY_RUN=1 (or --dry-run) prints planned changes without writing — use for local
// testing so it never mutates the working vault. The real run happens only in CI
// on an ephemeral checkout.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join, basename, relative } from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.cwd()
const CONTENT = join(ROOT, "content")
const DRY = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run")
const log = (...a) => console.log("[prepublish]", ...a)

// ---- load image map ----
let images = {}
const mapPath = join(ROOT, "image-map.json")
if (existsSync(mapPath)) {
  images = JSON.parse(readFileSync(mapPath, "utf8")).images ?? {}
} else {
  log("WARN: image-map.json not found — all image embeds will be omitted")
}

// ---- collect markdown files under content/ (skip dotdirs like .obsidian) ----
async function mdFiles(dir) {
  const out = []
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) out.push(...(await mdFiles(p)))
    else if (ent.name.endsWith(".md")) out.push(p)
  }
  return out
}

// ---- 1. image rewrite ----
const EMBED = /!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp))(\|[^\]]*)?\]\]/gi
let linked = 0, omitted = 0
const unmapped = new Set()

for (const file of await mdFiles(CONTENT)) {
  const src = readFileSync(file, "utf8")
  const out = src.replace(EMBED, (_m, target) => {
    const key = basename(target)
    const url = images[key]?.url
    if (url) { linked++; return `![](${url})` }
    omitted++
    if (!(key in images)) unmapped.add(key)
    return "*(image pending)*"
  })
  if (out !== src) {
    if (DRY) log(`would rewrite image embeds in ${relative(ROOT, file)}`)
    else writeFileSync(file, out)
  }
}
log(`images: ${linked} linked, ${omitted} omitted`)
if (unmapped.size) log(`WARN unmapped images (omitted): ${[...unmapped].join(", ")}`)

// ---- 2. changelog ----
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
const tagExists = (t) => {
  try { git(["rev-parse", "-q", "--verify", `refs/tags/${t}`]); return true } catch { return false }
}
const noteLink = (p) => `[[${p.replace(/^content\//, "").replace(/\.md$/, "")}]]`
const lastTs = (p) => {
  try { return parseInt(git(["log", "-1", "--format=%ct", "--", p]) || "0", 10) } catch { return 0 }
}

let changelog
if (tagExists("last-publish")) {
  const diff = git(["diff", "--name-status", "last-publish..HEAD", "--", "content/"])
  const added = [], updated = []
  for (const line of diff.split("\n").filter(Boolean)) {
    const parts = line.split("\t")
    const status = parts[0]
    const path = parts[parts.length - 1] // last col handles renames (R old new)
    if (!path.endsWith(".md") || path === "content/index.md") continue
    if (status.startsWith("A") || status.startsWith("R")) added.push(path)
    else if (status.startsWith("M")) updated.push(path)
  }
  const fmt = (a) => a.sort((x, y) => lastTs(y) - lastTs(x)).map((p) => `- ${noteLink(p)}`).join("\n")
  const sections = []
  if (added.length) sections.push(`**New**\n\n${fmt(added)}`)
  if (updated.length) sections.push(`**Updated**\n\n${fmt(updated)}`)
  changelog = sections.length ? sections.join("\n\n") : "*No changes since the last publish.*"
} else {
  changelog = "*Initial publication — the full chronicle is now online. After this, new and updated notes since the previous publish will be listed here.*"
}

const indexPath = join(CONTENT, "index.md")
const idx = readFileSync(indexPath, "utf8")
const re = /<!-- CHANGELOG:START -->[\s\S]*?<!-- CHANGELOG:END -->/
const block = `<!-- CHANGELOG:START -->\n${changelog}\n<!-- CHANGELOG:END -->`
if (!re.test(idx)) {
  log("WARN: CHANGELOG markers not found in content/index.md — skipping changelog")
} else if (DRY) {
  log("would write changelog:\n" + changelog)
} else {
  writeFileSync(indexPath, idx.replace(re, block))
  log("changelog injected")
}
