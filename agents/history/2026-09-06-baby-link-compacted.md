# BabyLink MVP

## Purpose

Client-side Android-friendly PWA for a back-seat tablet and front-seat parent controller. The tablet owns local multi-gigabyte video files; the controller sends playback and call commands.

## Decisions

- Use one React/Vite codebase with role-specific tablet/controller surfaces.
- Pair with compressed WebRTC SDP/ICE tokens shown as QR codes and copy/paste. This preserves a backend-free MVP.
- Use a WebRTC data channel for control messages and the same peer connection for optional audio/video calling.
- Keep video playback local to the tablet using object URLs; never transfer the large file to the controller.
- Include STUN for basic connectivity; TURN and ephemeral signaling remain production follow-ups.

## Completed

- Responsive dark mobile UI, PWA manifest, icon, and production app-shell service worker.
- Tablet local file library, playback controls, seek controls, and call permission flow.
- Controller pairing, library mirror, remote play/pause/select/seek, and call controls.
- QR generation and camera scanning using `qrcode` and `@zxing/browser`.

## Verification

- `npm run typecheck` passes.
- `npm run build` passes.
- Manual browser verification completed with two local tabs: QR/clipboard pairing reached Connected on both sides.

## Known limitations

- Signaling requires one-time QR/copy-paste exchange; the app does not yet include a signaling service.
- TURN is not configured, so restrictive networks may fail direct WebRTC.
- Video fixture upload and automated two-peer playback tests are not yet present.

## Resume point

Configure GitHub Pages or another static host, add an ephemeral signaling/TURN deployment, then package the app with Capacitor for Android car use.
