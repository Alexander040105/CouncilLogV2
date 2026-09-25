# AGENTS.md

## Attribution & branding

- Do NOT add AI-tool attribution or branding anywhere in this repository. This
  includes "Generated with Devin", "Made by Devin", "Co-Authored-By: Devin",
  "Powered by …", or any equivalent footer/badge/credit for any tool.
- Commit messages contain only the change description — no generated-by
  footers, no co-author trailers, no links to tool vendors.
- No attribution in code comments, README files, HTML meta tags, UI footers,
  or docs.
- Applies to all future work in this repo, including `v2/` and `legacy_code/`.

## UX guidance (always-on)

- **Dumb features down.** Assume the reader is not a developer. Plain language,
  no jargon — explain what a thing does, not what it's called.
- **Never a silent no-op.** Any automated or invisible behavior (auto-matched
  signatory chains, generated checklists, emailed notifications, filtered
  items) must be previewable or explainable in the UI.
- **Every empty state and error names the cause AND the next step** — a link
  to where to fix it, or "ask an owner" when the fix needs higher permission.
- **Preview before commit.** Prefer showing what WILL happen (matched route,
  item count, due dates) before the user submits.
- If a mismatch can't be fixed from the current screen, offer an escape hatch
  (manual picker, override) gated to the appropriate role instead of a dead
  end.
