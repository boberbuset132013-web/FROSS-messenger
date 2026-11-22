# FROSS Messenger — Firebase edition

FROSS Messenger runs on Firebase Authentication, Cloud Firestore and Cloud Storage. Cloudflare Workers only serves the static web app.

## Firebase project

- Project ID: `fross-ca5d6`
- Web App ID: `1:200886619645:web:0f1bc9b750eedf22a05d94`
- Auth domain: `fross-ca5d6.firebaseapp.com`
- Storage bucket: `fross-ca5d6.firebasestorage.app`

The Firebase web config in `public/firebase-app.js` is client configuration, not an Admin credential. Never put a service-account JSON or private key in this repository.

## Features in this version

- Firebase Authentication with Google sign-in and real email/password accounts.
- Email verification is required for new password accounts before chats can be opened; Firebase sends a verification link (not a six-digit OTP).
- Existing migrated accounts keep username/password compatibility through their legacy internal Firebase address.
- Username reservation and uniqueness in Firestore.
- Private account settings and public profile documents.
- Profile photo uploads to Cloud Storage.
- Direct and group chats in Firestore.
- Message subscriptions with Firestore `onSnapshot`.
- Search by username.
- Firestore and Storage security rules, plus the chat-list composite index.

### Authentication design

New registrations require a real email address and password. Firebase sends a verification link; until the address is verified, Firestore chat access is denied by Security Rules. Password reset is available by email. Google sign-in is also supported; first-time Google users choose a unique FROSS username.

For accounts migrated from the older username-only version, the previous internal address `<username>@fross-ca5d6.firebaseapp.com` remains supported as a compatibility login. These legacy accounts are not email-verified and therefore do not get the new email-verification gate until a separate account-linking flow is completed. Their optional contact email is not an authentication credential.

Firebase's built-in Email/Password provider sends a verification link, not a numeric one-time code on every login. Requiring a fresh six-digit code at every login needs a trusted server-side OTP service (for example, Cloud Functions plus a transactional email provider); do not implement OTP generation or validation in browser code.

## Enable Firebase services before publishing

1. Open Firebase Console and select project `fross-ca5d6`.
2. Authentication → Sign-in method → enable **Email/Password** and **Google**. Configure the Google OAuth consent screen if Firebase requests it.
3. Authentication → Templates → customize the email verification and password-reset templates with FROSS branding.
4. Firestore Database → create a **Standard** database in the region you prefer. Choose production mode (the repository contains the rules).
5. Storage → Get started → create the default bucket `fross-ca5d6.firebasestorage.app`.
   **Cloud Storage for Firebase requires the Blaze pay-as-you-go plan.** Usage may have no-cost quotas, but billing must be linked for Storage access. Check Google's current pricing and set budget alerts before enabling it.
6. Authentication → Settings → Authorized domains: add the exact hostname of the deployed `workers.dev` site (and your custom domain, if you use one).
7. From the repository root run:
   ```sh
   npm run firebase:deploy
   ```
   This deploys `firestore.rules`, `firestore.indexes.json` and `storage.rules`. Do not use Firebase test mode or permissive rules.

## Safe D1 → Firebase migration

The existing Cloudflare D1 database is treated as a read-only source. The migration does not delete or modify D1 rows. It copies:
- users into Firebase Auth, preserving each existing D1 user ID as the Firebase UID;
- existing PBKDF2-SHA256 password hashes;
- profile fields and settings into Firestore;
- D1 chats and messages into Firestore;
- existing avatar data URLs into Cloud Storage, when present.

The current Worker generated passwords with PBKDF2-SHA256, 100,000 rounds. Firebase Admin user import supports `PBKDF2_SHA256` and this round count, so existing passwords can be retained. The old sessions are not migrated: users must sign in again after cutover.

### Before running the migration

1. Keep the current Cloudflare Worker and D1 live. Do not merge the Firebase branch into `main` yet.
2. First finish and deploy the existing V2 PR (#1), including its one-time D1 schema upgrade if that has not already been applied. V2 adds a maintenance switch to the Worker.
3. Enable Firestore and Cloud Storage in Firebase. Storage requires Blaze billing.
4. Create a Firebase service account with only the required Auth, Firestore and Storage permissions. Download its JSON key to a location outside this repository. Do not upload or paste it into chat.
5. From the `migration` folder install the migration-only dependencies:
   ```sh
   cd migration
   npm install
   cd ..
   ```
6. Set local environment variables:
   - `GOOGLE_APPLICATION_CREDENTIALS`: absolute path to the service-account JSON.
   - `FIREBASE_PROJECT_ID=fross-ca5d6`.
7. Schedule a short maintenance window. In Cloudflare → Workers & Pages → `fross-messenger` → Settings → Variables and Secrets, add the plain-text variable `MAINTENANCE_MODE=true`, then save/deploy. The old API will return HTTP 503 for application routes while `/api/health` remains available. This pauses writes so messages are not lost between export and cutover.
8. While maintenance is enabled, create the final D1 export:
   ```sh
   npm run migration:d1:export
   ```
   The output is `migration/d1-backup.sql`; it is ignored by Git and must remain private. Do not turn maintenance off while the export/import is in progress.
9. Run the import:
   ```sh
   npm run migration:firebase
   ```
   The script creates a private Firestore marker at `systemMigrations/d1-to-firebase-v1`. If the run is interrupted, run it again; already-imported Firebase Auth UIDs are skipped and Firestore writes are idempotent.
10. Check the marker and counts in Firestore. Confirm users, chats and message counts before cutover. Keep maintenance enabled until the Firebase front end and rules are deployed and tested.

The script refuses to start if the target Firestore already contains user documents and no migration marker exists. It validates the legacy password-hash format before importing. If Firebase Auth reports an email/UID collision, stop and resolve it rather than overwriting a different account.

### Cutover

After a successful import and verification:
1. Confirm V2 PR #1 has been merged into `main`.
2. Open Firebase PR #2 and, if its base is still `feature/messenger-v2`, click **Edit** and change the base branch to `main`. Review the changed-file list before merging.
3. Merge Firebase PR #2 into `main`.
4. Workers Builds deploys the new static front end. The new Worker no longer binds or queries D1.
5. Test sign-in with a migrated username and its existing password, then test a new account, a DM, a group and an avatar upload.
6. Keep the D1 database and its backup untouched for rollback until the Firebase version has been used successfully.

## Data model

- `users/{uid}`: private settings and contact email.
- `publicUsers/{uid}`: username, display name, bio, avatar URL and presence.
- `usernameIndex/{lowercaseUsername}`: username reservation and UID.
- `chats/{chatId}`: chat type, member UIDs and last-message metadata.
- `chats/{chatId}/messages/{messageId}`: immutable message records.

## Cloudflare

- `worker.js` only forwards requests to the `ASSETS` binding.
- `wrangler.toml` serves `public/` and no longer binds D1.
- Workers Builds deploy command: `npm run deploy`.

## Current limitations / follow-up work

- Numeric email OTP on every login is not implemented; the current verified-email flow uses Firebase's signed verification link.
- Chat attachments are allowed by Storage Rules but the UI currently uploads profile avatars only.
- Push notifications, voice/video calls, end-to-end encryption, moderation and automated account-recovery are not included yet.
- Firestore listeners provide live updates; watch Firestore read usage and quotas as the app grows.
- Enable Firebase App Check (reCAPTCHA Enterprise for web) after testing it in monitoring mode; App Check complements Auth and Security Rules but does not replace them.
- Account deletion removes the account/profile and removes the user from chats; historical messages remain visible to other participants as conversation history.
