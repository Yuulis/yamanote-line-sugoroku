# Public Launch Plan — Codex Prompts

## P1: Prioritised launch plan, written as a Japanese proposal (Sol)

### Objective

Turn two research reports into a prioritised, phased plan for promoting the
game to the general public, and write it as a Japanese proposal for the user at
`docs/manual/public-launch/proposal.md`.

### The user's request (2026-10-20, translated)

"Before we promote and release this widely to the general public, think about
what we should do — e.g. a title logo and favicon, a richer UI design, and the
currently trendy dopamine-inducing ('ドパれる') elements."

### Inputs (read fully)

- `.claude/docs/research/public-launch-readiness-audit.md` — repo audit with
  gaps tagged [blocker]/[should]/[nice] and file:line citations.
- `.claude/docs/research/public-launch-external-research.md` — external
  research (engagement mechanics, branding, Japan launch channels, cautions).
- `docs/manual/development-roadmap/proposal.md` — existing roadmap; especially
  §5 (out of scope: accounts, online ranking, server saves, realtime) and §7
  (open items: production device check, map perf part 2, C3 Low items).
- `.claude/docs/DESIGN.md` Key Decisions (A1: no seed/replay link in the share
  text; B1: edition infrastructure only).
- Rules: `.claude/rules/manual-docs.md`, `.claude/rules/language.md`
  (natural Japanese, concise, conclusion first).

### What the plan must do

1. Separate "must before promotion" (blockers) from "makes it spread / makes
   players come back" and from "later". Give each item: what the player gets,
   size S/M/L, main files/areas, risks, and which user decision it needs.
2. Treat the user's three examples explicitly:
   - logo + favicon/icons (+ OGP image, manifest) — concrete asset list and
     sizes, font licence options, no JR assets, trademark check flag;
   - richer UI — concrete, prioritised changes grounded in the audit's weak
     spots (title hook/onboarding, dice and lottery reveal, clear
     celebration, buttons/typography/theme), with performance cost on phones;
   - "ドパれる" elements — pick the ones that FIT this game (no player
     decisions; seeded RNG; bad-luck/detour is the hook; static site), be
     honest about ones that don't fit (e.g. a plain Wordle-style daily seed
     gives everyone the same game), and state the guard rails (no dark
     patterns, prefers-reduced-motion, sound off by default, WCAG 2.3.1).
3. Include what the user did not ask but the reports show is needed:
   analytics/error monitoring and privacy note, unofficial-work disclaimer and
   contact, domain/canonical decision, caching (vercel.json), data-update
   policy during promotion (saves invalidated by dataVersion), real-device
   check, Vercel Hobby limits (non-commercial), and the launch sequence
   (X clip, Zenn/note write-up, press pitch, 配信ガイドライン).
4. Propose an order as 3–4 phases with a recommended first PR, and list the
   decisions the user must make (max 8), each with options and a recommended
   default.
5. Note where A1's "no seed link" decision would need revisiting
   (seed-replay link / daily journey) — present as a decision, not a done deal.

### Constraints

- Write ONLY `docs/manual/public-launch/proposal.md`. Do not modify any other
  file. Do not commit.
- Japanese prose per `.claude/rules/language.md` "Response Style": natural
  Japanese, conclusion first, no translationese; code identifiers, paths and
  commands stay in English. Prefer tables where they remove reading effort.
- Cite the two reports by relative link for detail; do not copy long
  passages. Mark unverified claims (from the reports' unverified lists) as
  未確認.
- Length: aim for 150–250 lines.

### Output (reply)

≤ 20 lines in English: the phase outline, the recommended first PR, and the
decision list, plus confirmation that only the one file was written.
