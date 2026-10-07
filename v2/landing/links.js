/* CounciLog landing links — edit this file to wire the CTAs.
 *
 *   webUrl      The live web app.
 *   androidUrl  The installable Android build. We're not on the Play Store —
 *               hosted as a GitHub Release asset (Supabase free tier caps
 *               files at 50 MB; the APK is ~94 MB). Upload new builds to the
 *               release and update this URL. Leave "" to show a "coming soon"
 *               chip until a build exists.
 *   iosUrl      Unused while iOS ships as the web app — iPhone members get an
 *               "Add to Home Screen" path instead of a store link.
 *   expoQr      Optional URL to a QR image for the Expo Go dev build —
 *               shown in the "try on your phone" card ("" hides it).
 *
 * A button with an empty URL renders as a "coming soon" chip, never a dead link. */
window.COUNCILOG_LINKS = {
  webUrl: "https://council-log.vercel.app",
  androidUrl: "https://github.com/Alexander040105/CouncilLogV2/releases/download/v1.0.0-android/councilog.apk",
  iosUrl: "",
  expoQr: "",
};
