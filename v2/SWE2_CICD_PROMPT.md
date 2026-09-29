# SWE-2 Max Prompt — CounciLog: CI on every push, one gate check before merge

You are a senior product engineer. CounciLog now ships as three deployables —
`v2/api` (FastAPI + pytest, fully self-contained), `v2/web` (Vite/React),
`v2/mobile` (Expo, lives on the `vibed-forReactNative-Expo` branch only) —
plus a static `v2/landing/`. There is **no `.github/` directory at all**:
every push currently lands unverified, and mistakes are only discovered after
merge or on a phone.

Your mission, in three parts:

1. **GitHub Actions CI** — a workflow that runs on every push to every branch
   and on pull requests into `main`: pytest for the API, `vite build` for the
   web app, and a single fan-in **gate job** (`ci`) that fails if either does —
   that job's name is what GitHub branch protection will require.
2. **Repo hygiene** — two directories of generated artifacts were committed by
   accident (`v2/web/test-results/` playwright output, `v2/mobile/dist-check/`
   an expo export). Untrack them and gitignore the patterns.
3. **Branch protection doc** — the workflow makes failures *visible*; the
   GitHub settings step makes them *blocking*. Document the exact clicks in
   `DEPLOY.md` since it's a manual UI change, not repo code.

Work at the repo root (`CouncilLogV2/`). Workflow file lives in
`.github/workflows/` — new directory, first CI ever for this repo.

---

## §1 Read before you touch anything

1. `v2/DEPLOY.md` — existing deploy doc; your branch-protection section
   appends to it. Match its voice (numbered steps, plain language).
2. `v2/api/pytest.ini`, `v2/api/requirements.txt` — pytest is `asyncio_mode =
   auto`; everything is pinned. The suite is pure in-memory sqlite — **no env
   vars, no Supabase, no network needed.**
3. `v2/api/tests/` — `smoke_e2e.py` is a **script against a live API**, not a
   pytest module (filename has no `test_` prefix — pytest ignores it, leave it
   that way and do not try to run it in CI).
4. `v2/web/package.json` — scripts are `dev`/`build`/`preview` only. There is
   no lint or unit-test script; do not invent one. `package-lock.json` is
   committed → use `npm ci`, never `npm install`.
5. `v2/web/src/lib/api.js` — the `VITE_API_URL` fail-fast check throws at
   **runtime in a production bundle**, not during `vite build`. The web CI job
   needs **no env vars and no secrets** — do not add any.
6. `v2/mobile/` — exists only on `vibed-forReactNative-Expo`. Mobile is
   deliberately out of CI scope (see §6) — but the workflow must not assume it
   exists on any branch.
7. `AGENTS.md` (repo root) — no AI/tool attribution anywhere; plain language
   for a non-developer audience; comments explain what a thing *does*, not
   what it's called.
8. Existing prompt files (`v2/SWE2_*_PROMPT.md`) — match their section format.

---

## §2 Hard constraints — violations are regressions

- **No secrets in CI.** The pipeline uses zero repository secrets. If a job
  "needs" a key, the job is wrong — the api suite runs on placeholder settings
  and the web build inlines nothing at build time. Do not add
  `env: SUPABASE_*`/`VITE_*`/`EXPO_PUBLIC_*` blocks.
- **No credentials, tokens, or URLs of real services** in the workflow.
- **Pinned, first-party actions only:** `actions/checkout@v4`,
  `actions/setup-python@v5`, `actions/setup-node@v4`. No third-party actions,
  no `@main`/`@latest` tags.
- **Least privilege:** `permissions: contents: read` at workflow level. No
  `pull-requests: write`, no `id-token`, nothing else.
- **Fast and quiet:** the whole run should finish in ~2 minutes. No artifact
  uploads, no codecov, no matrix builds, no caching beyond `setup-*`'s
  built-in `cache:`.
- **Comment the YAML for a non-dev.** One `#` line above each job/step block
  saying what it checks in plain words ("run the API's test suite"), not what
  the command is called.
- **Don't touch app code.** Zero changes under `v2/api/app`, `v2/web/src`,
  `v2/mobile/src`, `v2/mobile/app`. The workflow adapts to the apps, never the
  reverse.
- **`legacy_code/` is dead code** — nothing in CI references it.
- No AI/tool attribution in any file, commit message, or comment.

---

## §3 Work packages

### WP1 — `.github/workflows/ci.yml`

One file, three jobs. Sketch (fill in exact syntax — this is guidance, not
a paste-ready file):

```yaml
name: ci

on:
  push:                        # every branch — catch breakage before the PR
    paths-ignore: ['**.md']
  pull_request:
    branches: [main]
    paths-ignore: ['**.md']
  workflow_dispatch:           # manual button in the Actions tab

concurrency:
  group: ci-${{ github.ref }}  # a new push cancels the stale run
  cancel-in-progress: true

permissions:
  contents: read               # read-only; we test code, we don't modify it
```

**Job `api`** (`runs-on: ubuntu-latest`):
1. `actions/checkout@v4`.
2. `actions/setup-python@v5` with `python-version: '3.13'` and
   `cache: pip` + `cache-dependency-path: v2/api/requirements.txt`.
3. `pip install -r requirements.txt` — `working-directory: v2/api`.
4. `python -m pytest` — `working-directory: v2/api`.
   The suite (~53 tests) runs on sqlite and placeholder settings — expect a
   green run in under ~30s of test time. If it fails on a clean checkout,
   report the failure; do not patch the code to force green.

**Job `web`** (`runs-on: ubuntu-latest`):
1. `actions/checkout@v4`.
2. `actions/setup-node@v4` with `node-version: '22'` and
   `cache: npm` + `cache-dependency-path: v2/web/package-lock.json`.
3. `npm ci` — `working-directory: v2/web`.
4. `npm run build` — `working-directory: v2/web`.
   Vite inlines `VITE_*` vars but nothing validates them at build time —
   a clean build needs none. If the build emits the existing >500 kB chunk
   warning, that's expected noise, not failure.

**Job `ci`** (the gate):
- `needs: [api, web]`, `runs-on: ubuntu-latest`, single step that echoes a
  green summary. This exists so branch protection requires **one** check
  name (`ci`) that only passes when every real job passed — adding jobs
  later doesn't require editing the protection rule.

**Future-mobile skeleton** — as a *commented-out* block at the bottom of the
file, a `mobile` job: `if: hashFiles('v2/mobile/package.json') != ''` (the
dir is absent on some branches), `npm ci` (`.npmrc` already pins
`legacy-peer-deps`), `EXPO_PUBLIC_API_URL: http://localhost` +
`EXPO_PUBLIC_SUPABASE_URL/ANON_KEY: placeholder` env, then
`npx expo export --platform android --output-dir dist-ci`. It stays
commented — enabling it is a one-line uncomment, documented in the comment.

### WP2 — Untrack committed artifacts

1. `git rm -r --cached v2/web/test-results` — on the branch this lands on
   (currently `vibed-forReact-revised-UI`). Same for `v2/mobile/dist-check`
   when on `vibed-forReactNative-Expo`. Keep the physical dirs — only remove
   them from tracking.
2. Ensure `test-results/` and `dist-*/` are covered by the appropriate
   `.gitignore` files (`v2/.gitignore` already ignores `dist/` — verify
   whether the mobile dir relies on it or needs its own line; root
   `.gitignore` may need `test-results/`).
3. Commit hygiene separately from the workflow file — small commits, plain
   messages, no attribution footers (repo `AGENTS.md`).

### WP3 — Branch protection in `DEPLOY.md`

Append a short section to `v2/DEPLOY.md` titled **"Require CI before merging
to main"**, numbered steps for the GitHub UI, in the doc's existing plain
voice:

1. Repo → **Settings → Branches → Add branch ruleset** (or classic rule) for
   `main`.
2. Enable **Require a pull request before merging**.
3. Enable **Require status checks to pass** → search for and select the
   **`ci`** job (it only appears after the workflow has run once on a PR or
   push — note this gotcha).
4. Optional line: "Require branches to be up to date" for strictness.
5. One sentence on *why*: "the `ci` check turns red on any push that breaks
   the API tests or web build, so broken code can't land on main unnoticed."

Also add a three-line entry in DEPLOY's file-map/structure section if one
exists, noting `.github/workflows/ci.yml` runs pytest + vite build.

---

## §4 Acceptance criteria — the pass/fail list

1. Push any commit to any branch → Actions tab shows a `ci` workflow run with
   three jobs; `api` and `web` green; `ci` green.
2. Deliberately break a pytest (e.g. `assert False`) → `api` red, `ci` red,
   run cancels nothing else mid-flight incorrectly.
3. Deliberately break the web build (syntax error in `main.jsx`) → `web` red.
4. A docs-only push (`**.md` change) does not trigger a run.
5. `act`-free validation: the YAML parses (a GitHub run is the proof) and
   contains no secrets, no third-party actions, no write permissions.
6. `git status` shows `test-results/`/`dist-check/` untracked again after
   WP2; a fresh `git add -A` doesn't re-add them.
7. `DEPLOY.md` has the branch-protection section with the exact UI path.
8. Zero diffs under `v2/api`, `v2/web/src`, `v2/mobile` app code.

## §5 Verification sequence

1. Push the branch → watch the run in `gh run watch` or the Actions tab.
   Paste the run summary.
2. `python -m pytest` inside `v2/api` locally — still green (workflow change
   must not affect it).
3. `npm run build` inside `v2/web` locally — still green.
4. `git check-ignore -v v2/web/test-results/foo` prints a matching rule.
5. Report the Actions tab URL for the first green run.

---

## §6 Out of scope

Mobile `expo export` job (skeleton provided, commented — a bundle takes ~1
min and the dir only exists on one branch), ESLint/ruff (no lint configs
exist — adding them is a separate, noisy task), Playwright e2e (needs a live
API + real Supabase test accounts — stays a local pre-release ritual),
deployment/CD (Vercel already deploys web; Expo EAS is a separate decision),
status badges (optional one-liner in README is fine but not required),
Dependabot, code scanning. Note deliberately-deferred ideas in a short
"future polish" section of your report — don't sneak them in.

## Output format

1. Ordered list of files changed/created with a one-line "why" each.
2. The first CI run's per-job result lines.
3. The §4 checklist with actual pass/fail results.
4. Any deviation from §3 (and why).
5. Short future-polish notes.
