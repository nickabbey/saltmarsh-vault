#!/usr/bin/env node
// Pre-publish build step. Runs in CI before `npx quartz build`.
//
// 1. Image rewrite: ![[file.ext]] per image-map.json (url -> ![](url); else "(image pending)").
// 2. Recent sessions: top 5 session/recap pairs (reverse chron) -> index.md RECENT block.
// 3. Changelog: last-publish..HEAD over content/ -> index.md CHANGELOG block.
// 4. Session archive: ALL session/recap pairs (reverse chron) -> "Session Archive.md" ARCHIVE block.
//
// Image binaries are gitignored and never published; URLs are NOT validated.
// DRY_RUN=1 (or --dry-run) prints planned changes without writing (local testing) so it
// never mutates the working vault. The real run happens only in CI on an ephemeral checkout.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { join, basename, relative } from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = process.cwd()
const CONTENT = join(ROOT, "content")
const DRY = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run")
const log = (...a) => console.log("[prepublish]", ...a)

// inject `body` between <!-- NAME:START --> / <!-- NAME:END --> markers in content/<file>
function injectMarker(file, name, body) {
  const path = join(CONTENT, file)
  if (!existsSync(path)) { log(`WARN: ${file} not found — skipping ${name}`); return }
  const txt = readFileSync(path, "utf8")
  const re = new RegExp(`<!-- ${name}:START -->[\\s\\S]*?<!-- ${name}:END -->`)
  if (!re.test(txt)) { log(`WARN: ${name} markers not found in ${file} — skipping`); return }
  if (DRY) { log(`would write ${name} into ${file}:\n${body}\n`); return }
  writeFileSync(path, txt.replace(re, `<!-- ${name}:START -->\n${body}\n<!-- ${name}:END -->`))
  log(`${name} injected into ${file}`)
}

// ---------- load image map ----------
let images = {}
const mapPath = join(ROOT, "image-map.json")
if (existsSync(mapPath)) images = JSON.parse(readFileSync(mapPath, "utf8")).images ?? {}
else log("WARN: image-map.json not found — all image embeds will be omitted")

// ---------- 1. image rewrite ----------
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
const EMBED = /!\[\[([^\]|]+?\.(?:png|jpe?g|gif|webp))(\|[^\]]*)?\]\]/gi
let linked = 0, omitted = 0
const unmapped = new Set()
for (const file of await mdFiles(CONTENT)) {
  const src = readFileSync(file, "utf8")
  const out = src.replace(EMBED, (_m, target) => {
    const key = basename(target)
    const url = images[key]?.url
    if (url) { linked++; return `![](${url})` }
    omitted++; if (!(key in images)) unmapped.add(key); return "*(image pending)*"
  })
  if (out !== src) {
    if (DRY) log(`would rewrite image embeds in ${relative(ROOT, file)}`)
    else writeFileSync(file, out)
  }
}
log(`images: ${linked} linked, ${omitted} omitted`)
if (unmapped.size) log(`WARN unmapped images (omitted): ${[...unmapped].join(", ")}`)

// ---------- session/recap pairs (shared by recent + archive) ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
function sessionPairs() {
  const re = /^(Session Notes|Narrative Recap) (\d{1,2})-(\d{1,2})-(\d{2})\.md$/
  const byKey = new Map()
  for (const f of readdirSync(CONTENT)) {
    const m = f.match(re)
    if (!m) continue
    const [, type, mo, d, yy] = m
    const key = `20${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`
    const e = byKey.get(key) ?? { key, mo: +mo, d: +d, yy }
    if (type === "Session Notes") e.session = f.replace(/\.md$/, "")
    else e.recap = f.replace(/\.md$/, "")
    byKey.set(key, e)
  }
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? 1 : -1)) // newest first
}
function pairLine(e) {
  const label = `${MONTHS[e.mo - 1]} ${e.d}, 20${e.yy}`
  const notes = e.session ? `[[${e.session}|Notes]]` : "_(no notes)_"
  const recap = e.recap ? `[[${e.recap}|Recap]]` : "_(no recap)_"
  return `- **${label}** — ${notes} · ${recap}`
}
const pairs = sessionPairs()

// ---------- 2. recent sessions (top 5) ----------
injectMarker("index.md", "RECENT",
  pairs.length ? pairs.slice(0, 5).map(pairLine).join("\n") : "*No sessions recorded yet.*")

// ---------- 3. changelog ----------
const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
const tagExists = (t) => { try { git(["rev-parse", "-q", "--verify", `refs/tags/${t}`]); return true } catch { return false } }
const noteLink = (p) => `[[${p.replace(/^content\//, "").replace(/\.md$/, "")}]]`
const lastTs = (p) => { try { return parseInt(git(["log", "-1", "--format=%ct", "--", p]) || "0", 10) } catch { return 0 } }
let changelog
if (tagExists("last-publish")) {
  const diff = git(["diff", "--name-status", "last-publish..HEAD", "--", "content/"])
  const added = [], updated = []
  for (const line of diff.split("\n").filter(Boolean)) {
    const parts = line.split("\t"); const status = parts[0]; const path = parts[parts.length - 1]
    if (!path.endsWith(".md") || path === "content/index.md") continue
    if (status.startsWith("A") || status.startsWith("R")) added.push(path)
    else if (status.startsWith("M")) updated.push(path)
  }
  const fmt = (a) => a.sort((x, y) => lastTs(y) - lastTs(x)).map((p) => `- ${noteLink(p)}`).join("\n")
  const sec = []
  if (added.length) sec.push(`**New**\n\n${fmt(added)}`)
  if (updated.length) sec.push(`**Updated**\n\n${fmt(updated)}`)
  changelog = sec.length ? sec.join("\n\n") : "*No changes since the last publish.*"
} else {
  changelog = "*Initial publication — the full chronicle is now online. After this, new and updated notes since the previous publish will be listed here.*"
}
injectMarker("index.md", "CHANGELOG", changelog)

// ---------- 4. session archive (all pairs) ----------
injectMarker("Session Archive.md", "ARCHIVE",
  pairs.length ? pairs.map(pairLine).join("\n") : "*No sessions recorded yet.*")
