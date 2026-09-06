# BabyLink MVP

## Purpose

Client-side Android-friendly PWA for a back-seat tablet and front-seat parent controller. The tablet owns local multi-gigabyte video files; the controller sends playback and call commands.

## Decisions

- Use one React/Vite codebase with role-specific tablet/controller surfaces.
- Pair with compressed WebRTC SDP/ICE tokens shown as QR codes and copy/paste. This preserves a backend-free MVP.
- Use a WebRTC data channel for control messages and the same peer connection for optional audio/video calling.
- Keep video playback local to the tablet using object URLs; never transfer the large file to the controller.
- Use LAN-only WebRTC with `iceServers: []`; no public STUN/TURN service is contacted.

## Completed

- Responsive dark mobile UI, PWA manifest, icon, and production app-shell service worker.
- Tablet local file library, playback controls, seek controls, and call permission flow.
- Controller pairing, library mirror, remote play/pause/select/seek, and call controls.
- QR generation and camera scanning using `qrcode` and `@zxing/browser`.

## Verification

- `npm run typecheck` passes.
- `npm run build` passes.
- Manual browser verification completed with two local tabs: QR/clipboard pairing reached Connected on both sides.

## Release

- Published to https://github.com/fahimc/baby-link-webrtc
- Initial implementation commit: `d8b4aaf`
- Deployed production site: https://baby-link-webrtc.netlify.app/
- LAN-only release commit: `3a9fa07`, redeployed to the production site.

## Known limitations

- Signaling requires one-time QR/copy-paste exchange; the app does not yet include a signaling service.
- Devices must share the same reachable Wi-Fi/hotspot; LAN-only mode will not work across separate networks.
- Video fixture upload and automated two-peer playback tests are not yet present.
- Offline app-shell behavior is implemented and the production `/` and `/sw.js` endpoints respond successfully; full offline control of WebRTC is not expected because WebRTC requires a live peer connection.

## Resume point

Keep the static Netlify deployment, add automated same-LAN reconnection testing, and consider persistent tablet file handles for offline library restore.
