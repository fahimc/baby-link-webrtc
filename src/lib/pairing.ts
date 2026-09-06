export type SessionDescription = {
  type: RTCSdpType;
  sdp: string;
};

const PREFIX = 'babylink-v1.';

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function encodeSignal(description: RTCSessionDescriptionInit) {
  const json = JSON.stringify({ type: description.type, sdp: description.sdp });
  const input = new TextEncoder().encode(json);

  if ('CompressionStream' in window) {
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return PREFIX + bytesToBase64Url(compressed);
  }

  return PREFIX + bytesToBase64Url(input);
}

export async function decodeSignal(value: string): Promise<SessionDescription> {
  const cleanValue = value.trim();
  if (!cleanValue.startsWith(PREFIX)) throw new Error('This pairing code is not a BabyLink code.');
  const bytes = base64UrlToBytes(cleanValue.slice(PREFIX.length));
  let jsonBytes = bytes;

  if ('DecompressionStream' in window) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      jsonBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // A code made in a browser without CompressionStream is plain base64.
    }
  }

  const parsed = JSON.parse(new TextDecoder().decode(jsonBytes)) as SessionDescription;
  if ((parsed.type !== 'offer' && parsed.type !== 'answer') || !parsed.sdp) {
    throw new Error('The pairing code is incomplete.');
  }
  return parsed;
}

export function waitForIceGatheringComplete(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onStateChange = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }
    };
    peer.addEventListener('icegatheringstatechange', onStateChange);
    window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onStateChange);
      resolve();
    }, 8000);
  });
}

export function createPeerConnection() {
  return new RTCPeerConnection({
    // STUN helps when the devices are not on the same Wi-Fi. A TURN server can
    // be added later for restrictive mobile networks.
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
}

export function createCallTransceivers(peer: RTCPeerConnection) {
  peer.addTransceiver('audio', { direction: 'sendrecv' });
  peer.addTransceiver('video', { direction: 'sendrecv' });
}

export async function attachCallStream(peer: RTCPeerConnection, stream: MediaStream) {
  const audioTrack = stream.getAudioTracks()[0];
  const videoTrack = stream.getVideoTracks()[0];
  for (const sender of peer.getSenders()) {
    if (sender.track?.kind === 'audio' || (!sender.track && audioTrack)) {
      if (audioTrack && !peer.getSenders().some((item) => item.track === audioTrack)) {
        await sender.replaceTrack(audioTrack);
      }
    }
    if (sender.track?.kind === 'video' || (!sender.track && videoTrack)) {
      if (videoTrack && sender.track !== videoTrack) await sender.replaceTrack(videoTrack);
    }
  }
}

export function stopCallStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
