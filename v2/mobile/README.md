# CounciLog mobile (Expo)

The native client — same backend, same orgs, same data as the web app.
Expo SDK 57, expo-router, plain JSX. Full feature parity including daily
corrections: journal edit/delete, no-tasks retract, movement edit/delete —
all same-day/owner permissioned, identical rules to the web app.

```
app/            routes (expo-router): (tabs)/* + login, onboarding, account, admin
src/lib/        supabase, api (Bearer JWT + x-org-id), org, auth, me, theme,
                toast, rules + starterPack (copied verbatim from web — see below)
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

## Other known limitations

- **Password reset** sends an email whose link targets the web app — the user
  sets a new password in the browser, then signs in on mobile.
- **Photo uploads** go through signed-URL PUT (same as web) — a large photo
  on a slow connection can take a few seconds.
- No offline queue, no push notifications (out of scope — see
  `../SWE2_MOBILE_LANDING_PROMPT.md`).

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
```
