# FROSS for Android

Android shell for the existing FROSS Messenger website.

- Minimum Android: 8.0 (API 26)
- Target SDK: 34
- Web app: https://fross-messenger.boberbuset132013.workers.dev/
- Supports WebView JavaScript/storage, cookies, file uploads and runtime microphone/camera permissions for the FROSS site.
- The APK does not yet implement native phone-number verification, push notifications, or the FROSS Security browser-approval flow. Those require backend and Firebase changes; the WebView wrapper alone cannot provide them.
- Google sign-in may be restricted inside embedded WebViews by Google's OAuth security policy. Use the website's supported sign-in method until native OAuth is integrated.

Build locally from this directory with Gradle 8.9 and JDK 17:

```sh
gradle assembleDebug
```

APK output: `app/build/outputs/apk/debug/app-debug.apk`.
