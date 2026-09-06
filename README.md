# BabyLink

BabyLink is a mobile-first, client-side PWA for family journeys. One device acts as the back-seat tablet player and another acts as the front-seat parent controller.

## Current MVP

- Local video selection and playback on the tablet, including multi-gigabyte files without uploading them.
- QR/copy-paste pairing using a compressed WebRTC offer and answer.
- LAN-only WebRTC data-channel controls for video selection, play, pause, seek, and call state.
- Optional two-way audio/video call using the same peer connection.
- Responsive layout designed for Android Chrome and later Capacitor packaging.
- Install metadata and a lightweight production service worker for app-shell caching.
- Netlify configuration with SPA fallback and service-worker update headers.

## Run locally

```powershell
npm install
npm run dev
```

Then open the displayed local URL in two browser tabs or two devices on a reachable network.

For a production build, run `npm run build` and serve `dist/` from any static host. Netlify is configured with `netlify.toml` and `public/_redirects`.

## Pairing flow

1. Open Tablet player on the tablet and create a pairing card.
2. Open Parent controller on the front-seat device and scan or paste the tablet code.
3. Show the controller response QR/code back to the tablet.
4. Once connected, the controller receives the tablet’s local video library and can control playback.

Signaling is client-only: SDP/ICE data is exchanged through QR or copy/paste. The peer connection is deliberately configured with no STUN or TURN servers, so control and calls stay on the shared local Wi-Fi/hotspot and do not require internet access.

## Important constraints

- The controller can only choose files that have already been approved on the tablet; browsers do not permit a remote device to browse another device’s filesystem.
- Both devices need camera/microphone permission for calling. The tablet should enable call access once during setup if remote call start is desired.
- LAN-only mode requires both devices to share the same reachable Wi-Fi or hotspot. It will not connect across separate networks or the public internet.
- Browser background suspension and auto-answer permissions are Android/browser constraints. A Capacitor Android wrapper is the recommended next step for dependable car use, wake-lock behavior, and trusted-device call handling.
- Offline mode applies after the app shell has loaded once while online. The service worker caches the compiled app shell and uses network-first navigation so new deployments can update cleanly; selected local video files remain device-local and are not cached by the service worker.
- The app is intended for passenger or parked use; interaction should never distract the driver.

## Next production steps

1. Add authenticated, short-lived signaling and TURN credentials.
2. Add persistent tablet library metadata and trusted-device pairing.
3. Add a Capacitor Android shell with wake lock, audio routing, and lifecycle handling.
4. Add end-to-end tests using two browser contexts and a small local media fixture.
