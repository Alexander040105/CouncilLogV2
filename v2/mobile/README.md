# CounciLog mobile (Expo)

The native client — same backend, same orgs, same data as the web app.
Expo SDK 57, expo-router, plain JSX. Full feature parity including daily
corrections: journal edit/delete, no-tasks retract, movement edit/delete —
all same-day/owner permissioned, identical rules to the web app.

```
app/            routes (expo-router): (tabs)/* + login, onboarding, account,
                admin, notifications, pending, agenda
src/lib/        supabase, api (Bearer JWT + x-org-id + offline write-queue),
                org, auth, me, theme, toast, connectivity, qcache, push,
                rules + starterPack (copied verbatim from web — see below)
src/lib/offline/  outbox.js (pure queue engine — node --test runnable),
                store.js (expo-sqlite persistence), index.js (wiring/replay)
src/components/ ui.jsx primitives, editors, pickers — RN ports of web components
```

## Run it on your phone (Expo Go)

1. **Install Expo Go** from the App Store / Play Store.
2. **Start the API on your LAN** — a phone can't reach `localhost`:

   ```bash
   cd ../api
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

3. **Point the app at your computer's LAN IP** (edit `.env`):

   ```
   EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8000/api/v1
   EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
   ```

   Find your LAN IP: `ipconfig` → "IPv4 Address" (e.g. `192.168.x.x`).
   Copy `.env.example` → `.env` if missing. `.env` is gitignored.

4. **Same Wi-Fi** — the phone and the computer must be on the same network.

5. ```bash
   npx expo start
   ```
   Scan the QR code with the Expo Go app (Android) or the Camera app (iOS).

Email/password sign-in works fully in Expo Go.

## Google sign-in — the Expo Go caveat

The code path exists (`login.jsx` → `AuthSession` + `supabase.auth.setSession`)
but reliability depends on where the app runs:

- **Expo Go**: only works if Supabase Dashboard → Authentication → URL
  Configuration → Redirect URLs includes `exp://**`. Even then the flow is
  best-effort inside Go's sandbox.
- **Development build** (`npx expo run:android` / EAS dev client): reliable —
  add `councilog://**` to the same Supabase redirect list. The scheme is
  declared in `app.json`.

Either way, Google's OAuth consent screen needs the Supabase callback URL
listed as authorized — same setup as the web app.

## Ship it to real users (EAS Build)

Expo Go can't serve real users — it needs your laptop running Metro. To give
the council an installable app:

1. **One-time setup** — free Expo account:

   ```bash
   npm i -g eas-cli        # or: npx eas-cli@latest <command>
   eas login
   eas init                # links the project, writes extra.eas.projectId into app.json
   eas update:configure    # adds updates.url + runtimeVersion (OTA JS fixes)
   ```

2. **Build the Android APK** (internal distribution — a link anyone can install):

   ```bash
   eas build -p android --profile preview
   ```

   The `preview` profile in `eas.json` already bakes the production Supabase +
   API + web URLs — no local `.env` needed on the build server. When it
   finishes, EAS gives you an install page + direct APK link.

3. **Wire the landing page** — paste that link into `v2/landing/links.js` as
   `androidUrl`. iPhone members get the "Add to Home Screen" instructions on
   the landing page instead (native iOS requires Apple's $99/yr developer
   program — there is no free APK equivalent on iOS).

4. **Fixing bugs later** — JS-only fixes ship over-the-air:

   ```bash
   eas update --channel preview --message "what changed"
   ```

   Native changes (new native deps, app.json plugin changes) need a fresh
   `eas build` and members reinstall the new APK.

## Offline support

Every write goes through a durable outbox — if the request fails because the
phone has no data, the change is stored locally and replayed in order when
connectivity returns:

- `src/lib/offline/outbox.js` is the pure queue engine (ordering,
  `op:<id>` dependency tokens, idempotency keys) — no Expo imports, so it
  runs under `node --test src/lib/offline/outbox.test.js`.
- `store.js` persists ops + staged photos in `expo-sqlite`; `index.js` wires
  the API sender, replay guard, and UI subscription surface.
- `api.js` intercepts writes on network failure only — server errors and
  401s are never queued (a replayed failure is still a failure).
- Queued POSTs carry `client_request_id`; the API dedupes on
  `(org_id, client_request_id)` so replays can't double-create.
- Photo-bearing writes (journal entries, custody moves) queue as one
  composite op — sign → upload → record replays atomically.
- The sync banner sits on every screen; **More → Pending changes** lists
  queued/failed ops for review or retry; the React Query cache persists
  across launches so the app opens with last-known data.

## Push notifications

`expo-notifications` registers the device's Expo push token after sign-in
(`src/lib/push.js`); the API fans out assignments/comments/reminders to
inbox + push + email. Tapping a push deep-links into the app via the
`councilog://` scheme. Sign-out and account deletion unregister the token.
Push needs a **development/production build** — Expo Go can't register for
remote push; `eas credentials` manages the APNs/FCM keys at ship time.

## Other known limitations

- **Password reset** sends an email whose link targets the web app — the user
  sets a new password in the browser, then signs in on mobile.
- **Photo uploads** go through signed-URL PUT (same as web) — a large photo
  on a slow connection can take a few seconds (queued retries cover drops).

## Keeping parity

`src/lib/rules.js` and `src/lib/starterPack.js` are **verbatim copies** of
`web/src/lib/` — checklist previews, flag matching, and the starter library
must behave identically on every client. When you change either file on the
web, copy the new version here (and vice versa).

The API client contract is identical: `Authorization: Bearer <supabase JWT>`
+ `x-org-id: <active org uuid>` on every request. Do not change endpoints or
payload shapes without updating web and mobile together.

## Useful commands

```bash
npx expo start                    # dev server + QR
npx expo export --platform android  # bundle sanity check (catches syntax errors)
npx expo install <pkg>            # ALWAYS — picks the SDK-57-compatible version
npx expo lint                     # eslint (eslint-config-expo)
npx expo-doctor                   # dependency/config health check
node --test src/lib/offline/outbox.test.js   # outbox engine tests (pure node)
node scripts/gen-icons.js         # regenerate the icon set (brand document mark)
```
