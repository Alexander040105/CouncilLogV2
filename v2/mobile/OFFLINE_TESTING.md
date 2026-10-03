# Offline testing playbook

How to prove the mobile offline queue works on a real device. Every step says
what to do and what "working" looks like — if anything differs, it's a bug.

## How it works (60-second version)

- The app watches connectivity. Airplane mode = "offline" instantly.
- **Reads** — screens show the last data the app fetched (cache). Old data is
  fine offline; it refreshes when you're back.
- **Writes** — saving anything while offline puts it in a **queue on the
  phone** (SQLite — survives closing the app). The sync banner says
  "N queued". **More → Pending** lists them in send order.
- When signal returns the queue **sends itself, oldest first**. Each item gets
  retried once on flaky networks; items that get a real "no" from the server
  (e.g. permission denied) land in **Needs attention** where you Retry or
  Discard them.
- Duplicates are impossible: every queued write carries an idempotency key the
  server dedupes, so a send that "fails" after reaching the server still ends
  up saved exactly once.

## Setup

1. Install the preview APK on an Android phone with a real account in an org
   that has some data (a project, a document, a journal entry).
2. Open the app **online** once and visit Journal, Tasks, Papers, and Home so
   the cache is warm. Pull-to-refresh each screen if unsure.

## Test matrix

Work top to bottom. After every step, note the sync banner and More → Pending.

### A — Cached reads

| # | Action | Expected |
|---|--------|----------|
| A1 | Airplane mode ON, reopen each tab | Banner shows offline; screens still show the data from setup |
| A2 | Pull to refresh while offline | No crash — data stays, banner stays offline |

### B — Queued writes

| # | Action | Expected |
|---|--------|----------|
| B1 | Journal → Log work (text only) → Save | Toast "saved on this device"; banner count +1; Pending shows "Save: Journal entry" |
| B2 | Tasks → New task → assign someone → Save | Queued; Pending shows "Save: Task" |
| B3 | Journal → Log work **with a photo** → Save | Queued as "Journal entry + photo"; photo copied into app storage (survives a restart) |
| B4 | Papers → open a document → Move paper (with photo) | Queued as "Paper movement + photo" |
| B5 | Pending screen ordering | Entries appear oldest→newest (B1 first) — that's the send order |

### C — Reconnect & replay

| # | Action | Expected |
|---|--------|----------|
| C1 | Airplane mode OFF, wait ~5s | Banner counts down; Pending items flip "sending…" then disappear in order |
| C2 | Check the web app (or pull-refresh mobile) | Every queued item exists **exactly once** — the photo journal entry shows its photo |
| C3 | Pending screen | "All caught up" |

### D — Restart mid-queue

| # | Action | Expected |
|---|--------|----------|
| D1 | Offline, queue 2 items, **force-close the app**, reopen still offline | Both items still in Pending — nothing lost |
| D2 | Go online | Both send |

### E — Flaky network mid-send

| # | Action | Expected |
|---|--------|----------|
| E1 | Offline, queue 3 items. Go online, and while they send, toggle airplane mode back ON fast | Remaining items stay queued — nothing half-sent or duplicated |
| E2 | Go back online | The rest send; server shows each once |

### F — Rejected items (dead-letter)

| # | Action | Expected |
|---|--------|----------|
| F1 | Offline, queue a write you know the server will reject (e.g. an item on a project someone archived online, or a doc movement after losing officer role) | Item lands in Pending under **Needs attention** with the server's reason |
| F2 | Tap **Retry** (after fixing the cause, e.g. role restored) | It sends and disappears |
| F3 | Tap **Discard** on a dead item | It's removed permanently — nothing else in the queue is affected |

### G — Dependent writes

| # | Action | Expected |
|---|--------|----------|
| G1 | Offline: create a document **then** record a movement on it | Pending shows both; on reconnect the movement lands on the real document (temp id resolved) |
| G2 | Discard the dead "create document" op while its movement is queued | The movement dies too rather than sending to a broken id |

## What "done" means for a release

- C2 is the money shot: **zero duplicates, zero losses** after a full
  offline→online round trip with photos.
- No silent failures — anything that couldn't send is visible under
  Needs attention with a reason and a path forward.
- Banner counts always match reality (Pending screen = truth).

## Automated coverage (for developers)

`node --test` in `v2/mobile` runs the engine + real-SQL suites:

```bash
node --test src/lib/offline/outbox.test.js src/lib/offline/store.test.js
```

Covered there: idempotency-key injection, FIFO replay, stop-on-network,
dead-letter on API errors, temp-id resolution, photo sign→upload→record
ordering, UNIQUE op_id, dep-reference LIKE matching, and queue survival across
a "restart" (second store over the same db). The manual matrix above covers
what unit tests can't: radios, OS photo caching, and real server round trips.
