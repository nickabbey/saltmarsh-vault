# Saltmarsh vault (player campaign — Viltevar)

Obsidian vault + Quartz static site for a *Ghosts of Saltmarsh* game in which the human plays **Viltevar**, a **PLAYER** (not the GM). Published at https://nickabbey.github.io/saltmarsh-vault/.

## Player/GM firewall — non-negotiable

The human must never ingest GM-level campaign content (secrets, plot, mechanics, hidden motives), and **neither may this context** — it writes the player-voiced recaps and must stay spoiler-clean.

- **Never** read the *Ghosts of Saltmarsh* book data in this main context — not the `5e.tools` adventure JSON, not rendered pages, not any cached copy.
- All book reading happens inside a **throwaway subagent** that returns ONLY player-safe drafts (read-aloud + public description); GM content is discarded with the subagent's context. See the `/flesh-out` command.
- Only surface what the party actually encountered (gated by the `Session Notes`). Leave unknowns as **Open Questions**; never answer them from the book.

## Structure

- `content/` — **the Obsidian vault** (open *this* folder in Obsidian). Notes, `Session Notes *.md`, `Narrative Recap *.md`, `index.md`, `Session Archive.md`.
- Quartz 5 scaffolding at repo root; `scripts/prepublish.mjs` runs at publish (image rewrite + recent-sessions + changelog + archive); `image-map.json` maps campaign images to external URLs (binaries are gitignored and never published).
- **Publish:** edit in `content/`, commit + push to `main` → GitHub Action auto-deploys.

## Recap voice

Recaps are the third-person "Sir Viltevar" chronicle, player-knowledge-limited by construction (the firewall above protects this). See the user's memory for the full voice spec.

## Commands

- `/flesh-out [name]` — firewalled, player-safe note enrichment from the GoS book.

## Environment & tooling

This is a Node project (Quartz). For environment isolation and tool-choice conventions (Node `nvm`/`.nvmrc`/repo-local `node_modules`, etc.), follow the user-level `~/.claude/CLAUDE.md`.
