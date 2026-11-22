# FROSS Android security app

This is the first native Android companion for FROSS. It signs in to an existing FROSS account, verifies the account phone through Firebase Phone Number Verification (PNV), registers this Android installation as a trusted device, and displays browser login requests in the in-app **FROSS Security** bot.

## Firebase setup required before building

1. In Firebase Console, open project `fross-ca5d6`.
2. Add an Android app with package name `com.fross.messenger`.
3. Download its `google-services.json` and put it at `android/app/google-services.json`. Do not commit this file if it contains project-specific configuration you do not want public.
4. Add the app's SHA-256 signing certificate fingerprint in Firebase project settings.
5. Enable Email/Password sign-in (and any provider used by the account).
6. For PNV production, complete Firebase Phone Number Verification onboarding, billing setup, OAuth brand verification, privacy-policy review, and enable production mode. Production PNV is not a free service.

Open the `android/` folder in Android Studio and sync Gradle. The app requires Google Play services. PNV production verification requires a supported carrier and a compatible device (Android 10+). The project minimum SDK is 24 so the app can install on older devices, but PNV may not work there.

## Free development test mode

In Firebase Console → Security → Phone Verification → Settings → Testing, generate a test token. Add it to `android/local.properties` (this file is ignored by Git):

```properties
fpnv.testToken=PASTE_TEST_TOKEN_HERE
```

The token expires after 7 days. Test mode returns a fake number; it is only for development and must never be enabled in production. The backend rejects test tokens unless the Cloud Functions environment variable `FROSS_ALLOW_PNV_TEST_TOKENS=true` is explicitly set for a test deployment.

## Browser approval rollout

The browser approval gate is intentionally **off by default** to avoid locking out existing users before the Android app is registered, built, tested, and released.

After the app and Cloud Functions are deployed and tested, create this Firestore document in the Firebase Console:

- Collection: `system`
- Document: `securityConfig`
- Field: `requireBrowserApproval` (boolean) = `true`

Once enabled:
- Users must have a phone verified through the Android app and at least one active trusted Android device.
- A browser login creates a five-minute request.
- FROSS Security sends a push notification and displays the request inside the Android app.
- The user approves or rejects the request in FROSS.
- The browser session receives access only after approval.

Do not enable the gate until you have a working release APK and have confirmed that the phone's carrier supports Firebase PNV. The current published PNV carrier list does not include Russian carriers; unsupported carriers cannot complete this method. PNV production checks are billed per successful verification. Keep the gate off if your users cannot use PNV.

## Endpoints

Cloud Functions in `functions/phone-security.js`:
- `verifyPhoneWithPnv`
- `createTrustedDeviceSession`
- `registerTrustedDevicePushToken`
- `createBrowserLoginRequest`
- `approveBrowserLogin`
- `rejectBrowserLogin`

All endpoints require a Firebase ID token. PNV JWTs are verified server-side against Google's published JWKS, issuer and audience. Test tokens are rejected unless an explicit test-only environment flag is set.
