# Hermes Teammates for iOS and Android

The mobile app is a Capacitor 8 client with a phone-specific React interface. It
shares the desktop validation schemas, question forms, editable app-action reviews
and masked private-input cards. Hermes, model credentials, sessions, tools, files
and the scheduler stay on your host. There is no Hermes Python runtime on the phone.

## Build and install

Use Node.js 24+ and `npm ci` in the repository root. Both native projects are
committed under `mobile/`. They use the same app ID, `org.hermesteammates.mobile`.

```sh
npm run mobile:sync
npm run mobile:ios       # opens the Xcode project
npm run mobile:android   # opens the Android Studio project
```

For iOS, install Xcode 26+ on macOS. Swift Package Manager resolves Capacitor and
the secure-storage plugin; CocoaPods is not required. Select a simulator in Xcode
and run App, or build from the root:

```sh
xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath test-artifacts/ios-build CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
```

For Android, install Android Studio, Java 21, SDK platform 36 and build-tools
36.0.0. Configure `ANDROID_HOME` or an untracked `mobile/android/local.properties`.
Create an emulator in Android Studio's Device Manager, then run the app. A local
APK build is also available:

```sh
cd mobile/android
./gradlew assembleDebug
```

The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. A physical iOS device
needs your own Apple signing configuration. Distribution signing, TestFlight,
Google Play and app-store publication are separate maintainer steps. No signing
keys or paid developer account are included.

[Capacitor environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup)
and [native HTTP documentation](https://capacitorjs.com/docs/apis/http) describe the
underlying platform prerequisites.

## Connect to your host

The desktop HTTP listener remains on `127.0.0.1`. Mobile access is a separate,
opt-in HTTPS listener. Never forward the desktop port, remove its Host/Origin
checks, or expose it by changing its bind address.

Provide a TLS certificate and private key for an address reachable from your
phone. The certificate must validate using the device's trust store and match
that address. A private network or VPN is recommended. The app rejects cleartext
HTTP, URL credentials, URL paths and redirects. There is no certificate-validation
bypass or production test certificate bundled with the app.

On iOS, allow Local Network access when connecting to a host on the same Wi-Fi
network. If access was denied, enable it for Hermes Teammates in Settings →
Privacy & Security → Local Network, then retry. This permission does not replace
TLS validation or device pairing. See [Apple's local-network privacy guidance](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

For example, on the backend host:

```sh
TEAMMATES_MOBILE_URL=https://hermes.example.com:4311 \
TEAMMATES_MOBILE_BIND=0.0.0.0 \
TEAMMATES_MOBILE_TLS_CERT=/absolute/path/fullchain.pem \
TEAMMATES_MOBILE_TLS_KEY=/absolute/path/privkey.pem \
npm start
```

Choose a private interface address instead of `0.0.0.0` when appropriate. Firewall
the listener to your own devices or VPN. DNS, certificates, their renewal, host
firewalls and an always-on service are operator responsibilities. Set the public
URL to the exact address entered on the phone, including a nonstandard port.
The gateway validates that Host header. It does not implement forwarded-host or
TLS-terminating reverse-proxy trust.

| Variable                    | Default     | Meaning                                         |
| --------------------------- | ----------- | ----------------------------------------------- |
| `TEAMMATES_MOBILE_URL`      | unset       | Enable gateway with this canonical HTTPS origin |
| `TEAMMATES_MOBILE_TLS_CERT` | unset       | PEM certificate chain                           |
| `TEAMMATES_MOBILE_TLS_KEY`  | unset       | PEM private key                                 |
| `TEAMMATES_MOBILE_BIND`     | `127.0.0.1` | Separate mobile listener interface              |
| `TEAMMATES_MOBILE_PORT`     | `4311`      | Separate mobile listener port                   |

Open **Mobile devices** in the desktop sidebar, then **Create pairing code**.
Enter the host address, a device name and that code in the mobile app. Each code
has 192 bits of randomness, expires after five minutes, works once, and replaces
any previous unconsumed code. Codes are never written to the host's device store.
Protect them as credentials. There is no deep link containing a token.

The host issues a 256-bit bearer token valid for 90 days. Only its SHA-256 hash,
device ID, name and expiry are saved in owner-only `mobile-devices.json`.
Pairing attempts are rate-limited without trusting forwarded addresses. Up to 32
unexpired devices can be paired. Revoke a lost or retired phone in the desktop
sidebar. Reinstalling the app does not replace host-side revocation.

The phone stores its connection in iOS Keychain with device-only, unlocked access
and iCloud synchronization disabled, or Android Keystore-backed encrypted storage.
Android backups are disabled. Native bridge logging is disabled in both debug
and release app configuration. Tokens are held in memory while connected and
sent only as Authorization headers to the selected host. No token, chat history
or draft is saved in browser localStorage. Browser acceptance uses memory only.

**Host → Revoke access and disconnect** removes this device on the host and clears
its secure local connection. **Forget connection on this device** works offline
but leaves host access valid until you revoke it there. Expired or revoked access
returns to pairing. Devices have single-owner workspace control, not per-Bot or
read-only permissions. Do not pair another person's phone as a shared account.

## Mobile coverage

| Desktop capability                                   | Mobile coverage                                                                         |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Bot roster, colors, role and search                  | Browse, search, create and edit                                                         |
| Claude and compatible/Ollama models                  | Configure each Bot; inference and login reuse stay on host                              |
| API credentials                                      | Add or replace a named masked credential; names only return; removal is on desktop      |
| Private Bot Chat and named conversations             | History, send, open/create named conversations, durable unread                          |
| Groups and visible Bot attribution                   | Create group, send, read member replies; same sequential backend execution              |
| Native teammate messages                             | Visible in canonical transcripts and the reply inbox                                    |
| Proactive work                                       | Native routine replies and pending decisions in Activity; host must remain awake        |
| Questions and native approvals                       | Same validated question and offered approval-scope cards as desktop                     |
| App action review                                    | Same editable JSON and Deny/Run reviewed action cards; native expiry and Stop semantics |
| Private credential/login/code/unlock prompts         | Same masked request cards; secret values go to native Hermes, not composer              |
| Steering and Stop                                    | Steering for the selected private turn; per-Bot Stop, including group member work       |
| Routines                                             | Create, pause/resume, read run results; remove on desktop                               |
| Memory                                               | Read/edit MEMORY.md; USER.md editing remains on desktop                                 |
| Skills and files                                     | Counts in details; management and file transfer remain on desktop                       |
| MCP connections and saved website logins             | Management remains on desktop; interactive reviews/private requests work on phone       |
| Bot computers and manual takeover                    | Desktop only; gateway excludes VM views, control and internal tool capabilities         |
| Voice, rich media, push, widgets, background sync    | Not included                                                                            |
| Multiple users/teams or simultaneous backend writers | Not included; one owner and one backend per data directory                              |

The app refreshes serially every two seconds while foregrounded and refreshes on
resume. It does not promise live background updates or notifications. It clears
read cursors only for the loaded visible transcript, preserving the backend's
observed-message rule. Backgrounding hides the workspace and unmounts private
forms. Pending native requests reconnect from the host on resume; local typed
secret values are not restored.

Native routine follow-up questions depend on an interactive Hermes gateway for
that Bot. Sending a chat task starts that gateway for the current backend process.
After an interruption, send a new chat task to re-establish the live session.
On a freshly started host where a Bot has not chatted yet, Hermes can deliver a
routine result through its unattended fallback, which cannot wait for an answer.
This existing backend limitation applies to desktop and mobile. Routine execution
and results still remain on the host.

## Security boundaries

The gateway proxies an explicit method/path allowlist into the loopback backend.
It strips the device Authorization header and supplies its own loopback request.
It excludes internal computer tools, action-review callbacks, device administration,
WebSockets, static web assets and vault-management routes. It accepts native HTTP
requests without an Origin header and has no browser CORS grant. Pairing and
ordinary API responses use `Cache-Control: no-store`. The app uses CapacitorHttp,
which validates TLS through platform networking. The bundled client is loaded
locally rather than from the remote host. Do not add arbitrary WebView navigation
or bypass TLS checks.

A paired device can ask Hermes to use powerful native host tools and can authorize
its pending actions. This preserves the desktop single-owner trust model. Bot
profiles are organizational separation, not an OS sandbox. App reviews gate only
the managed MCP connections covered by the desktop contract. Native vault secrets
and the Computer VM remain distinct; a mobile login card does not fill the VM.
The device credential is not a model API key, and the app never runs provider
inference directly. Use the same provider setup and billing rules as the README.

See [mobile verification](mobile-verification.md) for native builds, device checks,
controlled inference and remaining provider/distribution boundaries.
