import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserQRCodeReader } from '@zxing/browser';
import QRCode from 'qrcode';
import {
  attachCallStream,
  createCallTransceivers,
  createPeerConnection,
  decodeSignal,
  encodeSignal,
  stopCallStream,
  waitForIceGatheringComplete,
} from './lib/pairing';
import './styles.css';

type Role = 'tablet' | 'controller';
type Screen = 'home' | Role;
type Status = 'idle' | 'pairing' | 'connected' | 'error';

type LocalVideo = {
  id: string;
  name: string;
  url: string;
  size: number;
};

type PlayerState = {
  library: Array<{ id: string; name: string; size: number }>;
  currentId: string | null;
  currentTime: number;
  duration: number;
  paused: boolean;
};

type RemoteCommand =
  | { type: 'command'; command: 'play' | 'pause' | 'call-start' | 'call-end'; value?: never }
  | { type: 'command'; command: 'select' | 'seek'; value: string | number };

type WireMessage =
  | { type: 'hello'; role: Role }
  | { type: 'state'; payload: PlayerState }
  | RemoteCommand;

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0:00';
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

async function makeQr(value: string) {
  return QRCode.toDataURL(value, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'L',
    color: { dark: '#182442', light: '#ffffff' },
  });
}

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');

  return (
    <main className="app-shell">
      {screen === 'home' && <Home onChoose={setScreen} />}
      {screen === 'tablet' && <TabletApp onBack={() => setScreen('home')} />}
      {screen === 'controller' && <ControllerApp onBack={() => setScreen('home')} />}
    </main>
  );
}

function Header({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack?: () => void }) {
  return (
    <header className="topbar">
      <div className="brand-mark" aria-label="BabyLink home">
        <span className="brand-dot" />
        <span>BabyLink</span>
      </div>
      <div className="topbar-context">
        <span className="eyebrow">{eyebrow}</span>
        <strong>{title}</strong>
      </div>
      {onBack ? (
        <button className="icon-button" onClick={onBack} aria-label="Go back">↩</button>
      ) : (
        <span className="privacy-chip">Private by design</span>
      )}
    </header>
  );
}

function Home({ onChoose }: { onChoose: (screen: Screen) => void }) {
  return (
    <div className="home-page page-padding">
      <Header eyebrow="Family journeys" title="Connected calmly" />
      <section className="hero-card">
        <div className="hero-orb orb-one" />
        <div className="hero-orb orb-two" />
        <div className="hero-copy">
          <span className="eyebrow mint">YOUR PRIVATE TRAVEL COMPANION</span>
          <h1>Keep the back seat close.</h1>
          <p>Play local videos on the tablet, control them from the front, and start a gentle two-way call whenever you need to.</p>
          <div className="hero-pills">
            <span>Works with large local files</span>
            <span>Direct WebRTC connection</span>
          </div>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <div className="device tablet-shape"><div className="device-screen"><span className="play-glyph">▶</span></div></div>
          <div className="signal-ring ring-one" /><div className="signal-ring ring-two" />
          <div className="device phone-shape"><div className="phone-screen"><span>⌁</span></div></div>
        </div>
      </section>

      <section className="section-heading">
        <div><span className="eyebrow">START A SESSION</span><h2>Choose this device’s role</h2></div>
        <span className="step-label">01 / 02</span>
      </section>
      <div className="role-grid">
        <button className="role-card tablet-role" onClick={() => onChoose('tablet')}>
          <div className="role-icon">▣</div><div><span className="role-kicker">BACK SEAT</span><h3>Tablet player</h3><p>Choose local videos and keep playback on the tablet.</p></div><span className="arrow">→</span>
        </button>
        <button className="role-card controller-role" onClick={() => onChoose('controller')}>
          <div className="role-icon">⌁</div><div><span className="role-kicker">FRONT SEAT</span><h3>Parent controller</h3><p>Control playback and talk to the tablet remotely.</p></div><span className="arrow">→</span>
        </button>
      </div>
      <p className="footnote"><span className="lock-symbol">⌑</span> No account. No video upload. Pair devices directly for the session.</p>
    </div>
  );
}

function PairingPanel({
  role,
  status,
  offerToken,
  answerToken,
  answerQr,
  offerQr,
  onCreateOffer,
  onApplyAnswer,
  onApplyOffer,
  onScan,
  error,
}: {
  role: Role;
  status: Status;
  offerToken: string;
  answerToken: string;
  answerQr: string;
  offerQr: string;
  onCreateOffer?: () => void;
  onApplyAnswer?: (value: string) => void;
  onApplyOffer?: (value: string) => void;
  onScan: (kind: 'offer' | 'answer') => void;
  error: string;
}) {
  const tablet = role === 'tablet';
  const [input, setInput] = useState('');
  const [copied, setCopied] = useState(false);
  const token = tablet ? offerToken : answerToken;
  const qr = tablet ? offerQr : answerQr;

  const copy = async () => {
    if (!token) return;
    await copyText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="pairing-panel panel-card">
      <div className="panel-heading"><div><span className="eyebrow">STEP 1 · PRIVATE PAIRING</span><h2>{tablet ? 'Show this tablet to the controller' : 'Connect to the tablet'}</h2></div><StatusPill status={status} /></div>
      {tablet ? (
        <>
          <p className="muted">Create a one-time connection card, then scan the response from the front-seat device.</p>
          {qr ? <QrCard image={qr} label="Scan this from the controller" onCopy={copy} copied={copied} /> : <button className="primary-button full-width" onClick={onCreateOffer}>Create pairing card <span>↗</span></button>}
          {token && <TokenBox token={token} onCopy={copy} copied={copied} />}
          <div className="divider-label"><span>THEN PASTE OR SCAN THE RESPONSE</span></div>
          <div className="input-with-action"><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste the controller response here" rows={3} /><button className="secondary-button" onClick={() => onScan('answer')}>Scan</button></div>
          <button className="primary-button full-width" disabled={!input.trim()} onClick={() => onApplyAnswer?.(input)}>Complete pairing <span>→</span></button>
        </>
      ) : (
        <>
          <p className="muted">Scan the tablet’s pairing card, or paste its code below. Your videos stay on the tablet.</p>
          <div className="input-with-action"><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="Paste the tablet pairing card here" rows={4} /><button className="secondary-button" onClick={() => onScan('offer')}>Scan</button></div>
          <button className="primary-button full-width" disabled={!input.trim()} onClick={() => onApplyOffer?.(input)}>Connect to tablet <span>→</span></button>
          {qr && <><div className="divider-label"><span>SHOW THIS RESPONSE ON THE TABLET</span></div><QrCard image={qr} label="Scan this from the tablet" onCopy={copy} copied={copied} /><TokenBox token={token} onCopy={copy} copied={copied} /></>}
        </>
      )}
      {error && <div className="error-banner">{error}</div>}
    </section>
  );
}

function TokenBox({ token, onCopy, copied }: { token: string; onCopy: () => void; copied: boolean }) {
  return <div className="token-box"><code>{token.slice(0, 48)}…</code><button className="text-button" onClick={onCopy}>{copied ? 'Copied' : 'Copy code'}</button></div>;
}

function QrCard({ image, label, onCopy, copied }: { image: string; label: string; onCopy: () => void; copied: boolean }) {
  return <div className="qr-card"><img src={image} alt="Pairing QR code" /><div><strong>{label}</strong><p>Keep both screens awake while pairing.</p><button className="text-button" onClick={onCopy}>{copied ? 'Copied to clipboard' : 'Copy pairing code'}</button></div></div>;
}

function StatusPill({ status }: { status: Status }) {
  const label = status === 'connected' ? 'Connected' : status === 'pairing' ? 'Pairing' : status === 'error' ? 'Needs attention' : 'Not paired';
  return <span className={`status-pill status-${status}`}><span />{label}</span>;
}

function TabletApp({ onBack }: { onBack: () => void }) {
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState<Status>('idle');
  const [offerToken, setOfferToken] = useState('');
  const [offerQr, setOfferQr] = useState('');
  const [answerToken, setAnswerToken] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [callEnabled, setCallEnabled] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const lastBroadcastRef = useRef(0);

  const currentVideo = useMemo(() => videos.find((video) => video.id === currentId) ?? null, [videos, currentId]);

  const send = (message: WireMessage) => {
    if (channelRef.current?.readyState === 'open') channelRef.current.send(JSON.stringify(message));
  };

  const broadcastState = () => {
    const video = videoRef.current;
    send({ type: 'state', payload: { library: videos.map(({ id, name, size }) => ({ id, name, size })), currentId, currentTime: video?.currentTime ?? currentTime, duration: video?.duration ?? duration, paused: video?.paused ?? paused } });
  };

  const attachDataChannel = (channel: RTCDataChannel) => {
    channelRef.current = channel;
    channel.onopen = () => { setStatus('connected'); send({ type: 'hello', role: 'tablet' }); broadcastState(); };
    channel.onclose = () => setStatus('idle');
    channel.onerror = () => setError('The direct connection had a problem. Please pair again.');
    channel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as RemoteCommand;
        if (message.type !== 'command') return;
        if (message.command === 'select' && typeof message.value === 'string') setCurrentId(message.value);
        if (message.command === 'play') void videoRef.current?.play();
        if (message.command === 'pause') videoRef.current?.pause();
        if (message.command === 'seek' && typeof message.value === 'number' && videoRef.current) videoRef.current.currentTime = message.value;
        if (message.command === 'call-start') {
          if (callEnabled) setCallActive(true);
          else setNotice('Tap Enable call once on the tablet to allow the front-seat call.');
        }
        if (message.command === 'call-end') setCallActive(false);
      } catch { setError('Received an unreadable control message.'); }
    };
  };

  const makePeer = () => {
    const peer = createPeerConnection();
    createCallTransceivers(peer);
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') setStatus('connected');
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') setStatus('error');
    };
    peer.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) remoteVideoRef.current.srcObject = event.streams[0];
    };
    peerRef.current = peer;
    return peer;
  };

  const createOffer = async () => {
    try {
      setError(''); setStatus('pairing');
      const peer = makePeer();
      const channel = peer.createDataChannel('control');
      attachDataChannel(channel);
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIceGatheringComplete(peer);
      const token = await encodeSignal(peer.localDescription!);
      setOfferToken(token); setOfferQr(await makeQr(token));
      setNotice('Pairing card ready. Scan it from the controller.');
    } catch (cause) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'Could not create a pairing card.'); }
  };

  const applyAnswer = async (value: string) => {
    try {
      setError(''); await peerRef.current?.setRemoteDescription(await decodeSignal(value)); setAnswerToken(value.trim()); setStatus('pairing');
    } catch (cause) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'That response code is not valid.'); }
  };

  const chooseFiles = (files: FileList | null) => {
    if (!files) return;
    const additions = Array.from(files).filter((file) => file.type.startsWith('video/')).map((file) => ({ id: crypto.randomUUID(), name: file.name, url: URL.createObjectURL(file), size: file.size }));
    setVideos((current) => [...current, ...additions]);
    if (!currentId && additions[0]) setCurrentId(additions[0].id);
  };

  const enableCall = async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
      streamRef.current = stream; setCallEnabled(true); setNotice('Call access is ready. The controller can now call this tablet.');
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      if (peerRef.current) await attachCallStream(peerRef.current, stream);
    } catch { setError('Camera and microphone access was not granted. You can still play videos.'); }
  };

  useEffect(() => {
    if (currentVideo && videoRef.current) { videoRef.current.load(); setCurrentTime(0); setPaused(true); }
  }, [currentVideo]);

  useEffect(() => { if (channelRef.current?.readyState === 'open') broadcastState(); }, [videos, currentId]);

  useEffect(() => () => { peerRef.current?.close(); stopCallStream(streamRef.current); }, []);

  const onPlay = () => { setPaused(false); broadcastState(); };
  const onPause = () => { setPaused(true); broadcastState(); };
  const onTimeUpdate = () => { const value = videoRef.current?.currentTime ?? 0; setCurrentTime(value); if (Date.now() - lastBroadcastRef.current > 1200) { lastBroadcastRef.current = Date.now(); broadcastState(); } };
  const togglePlayback = () => { if (videoRef.current?.paused) void videoRef.current.play(); else videoRef.current?.pause(); };
  const skip = (amount: number) => { if (videoRef.current) { videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime + amount); broadcastState(); } };
  const selectVideo = (id: string) => { setCurrentId(id); send({ type: 'state', payload: { library: videos.map(({ id: itemId, name, size }) => ({ id: itemId, name, size })), currentId: id, currentTime: 0, duration: 0, paused: true } }); };
  const toggleCall = () => { const next = !callActive; setCallActive(next); send({ type: 'command', command: next ? 'call-start' : 'call-end' }); };

  return <div className="workspace-page">
    <Header eyebrow="Back seat" title="Tablet player" onBack={onBack} />
    <div className="page-padding workspace-content">
      <div className="workspace-intro"><div><span className="eyebrow mint">TABLET MODE</span><h1>Ready for a little adventure?</h1><p>Load videos onto this device. The controller will see the library once paired.</p></div><StatusPill status={status} /></div>
      <div className="tablet-layout">
        <section className="player-card panel-card">
          <div className="video-stage">
            {currentVideo ? <video ref={videoRef} src={currentVideo.url} playsInline onPlay={onPlay} onPause={onPause} onTimeUpdate={onTimeUpdate} onLoadedMetadata={() => setDuration(videoRef.current?.duration ?? 0)} /> : <div className="empty-player"><div className="empty-player-icon">▶</div><strong>Add a video to get started</strong><span>Files stay on this tablet.</span></div>}
            {callActive && <div className="call-overlay"><video ref={remoteVideoRef} autoPlay playsInline /><span>Two-way call active</span></div>}
            {currentVideo && <div className="video-gradient" />}
            {currentVideo && <div className="player-title"><span>{paused ? 'Paused' : 'Playing now'}</span><strong>{currentVideo.name}</strong></div>}
          </div>
          <div className="player-controls"><button className="round-control" onClick={() => skip(-10)} aria-label="Back 10 seconds">↶<small>10</small></button><button className="play-control" onClick={togglePlayback} disabled={!currentVideo}>{paused ? '▶' : 'Ⅱ'}</button><button className="round-control" onClick={() => skip(10)} aria-label="Forward 10 seconds">↷<small>10</small></button><div className="timeline"><div className="timeline-labels"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div><input type="range" min="0" max={duration || 1} value={Math.min(currentTime, duration || 1)} onChange={(event) => { if (videoRef.current) videoRef.current.currentTime = Number(event.target.value); }} /></div></div>
        </section>
        <aside className="side-stack">
          <section className="library-card panel-card"><div className="panel-heading compact"><div><span className="eyebrow">ON THIS TABLET</span><h2>Video library</h2></div><label className="add-file-button">＋ Add<input type="file" accept="video/*" multiple onChange={(event) => chooseFiles(event.target.files)} /></label></div>{videos.length === 0 ? <div className="library-empty">Add one or more local video files. Multi-gigabyte files are played from storage without uploading.</div> : <div className="video-list">{videos.map((video, index) => <button className={`video-row ${video.id === currentId ? 'selected' : ''}`} key={video.id} onClick={() => selectVideo(video.id)}><span className="video-index">{String(index + 1).padStart(2, '0')}</span><span className="video-row-copy"><strong>{video.name}</strong><small>{formatBytes(video.size)}</small></span><span className="video-row-state">{video.id === currentId ? 'Selected' : 'Open'}</span></button>)}</div>}</section>
          <section className="call-card panel-card"><div className="call-card-icon">⌁</div><div className="call-copy"><span className="eyebrow">STAY CLOSE</span><h2>{callActive ? 'Call in progress' : 'Two-way call'}</h2><p>{callEnabled ? 'The front-seat controller can talk to this tablet.' : 'Enable access once to let the controller call.'}</p></div><button className={`call-button ${callActive ? 'active' : ''}`} onClick={callEnabled ? toggleCall : enableCall}>{callActive ? 'End call' : callEnabled ? 'Start call' : 'Enable call'}</button><video ref={localVideoRef} muted autoPlay playsInline className="hidden-video" /></section>
          <PairingPanel role="tablet" status={status} offerToken={offerToken} answerToken={answerToken} offerQr={offerQr} answerQr="" onCreateOffer={createOffer} onApplyAnswer={applyAnswer} onScan={() => setScanOpen(true)} error={error} />
        </aside>
      </div>
      {notice && <div className="notice-banner" onClick={() => setNotice('')}>{notice}<span>×</span></div>}
    </div>
    {scanOpen && <ScanModal onClose={() => setScanOpen(false)} onResult={(value) => { setScanOpen(false); void applyAnswer(value); }} />}
  </div>;
}

function ControllerApp({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [offerToken, setOfferToken] = useState('');
  const [answerToken, setAnswerToken] = useState('');
  const [answerQr, setAnswerQr] = useState('');
  const [player, setPlayer] = useState<PlayerState>({ library: [], currentId: null, currentTime: 0, duration: 0, paused: true });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [callEnabled, setCallEnabled] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const send = (message: RemoteCommand) => { if (channelRef.current?.readyState === 'open') channelRef.current.send(JSON.stringify(message)); };

  const attachChannel = (channel: RTCDataChannel) => {
    channelRef.current = channel;
    channel.onopen = () => { setStatus('connected'); setNotice('Connected to the tablet.'); };
    channel.onclose = () => setStatus('idle');
    channel.onerror = () => setError('The direct connection had a problem. Please pair again.');
    channel.onmessage = (event) => { try { const message = JSON.parse(event.data) as WireMessage; if (message.type === 'state') setPlayer(message.payload); } catch { setError('Received an unreadable tablet update.'); } };
  };

  const makePeer = () => {
    const peer = createPeerConnection(); createCallTransceivers(peer);
    peer.ondatachannel = (event) => attachChannel(event.channel);
    peer.ontrack = (event) => { if (remoteVideoRef.current && event.streams[0]) remoteVideoRef.current.srcObject = event.streams[0]; };
    peer.onconnectionstatechange = () => { if (peer.connectionState === 'connected') setStatus('connected'); if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') setStatus('error'); };
    peerRef.current = peer; return peer;
  };

  const applyOffer = async (value: string) => {
    try {
      setError(''); setStatus('pairing'); setOfferToken(value.trim()); const peer = makePeer();
      await peer.setRemoteDescription(await decodeSignal(value)); await peer.setLocalDescription(await peer.createAnswer()); await waitForIceGatheringComplete(peer);
      const answer = await encodeSignal(peer.localDescription!); setAnswerToken(answer); setAnswerQr(await makeQr(answer));
    } catch (cause) { setStatus('error'); setError(cause instanceof Error ? cause.message : 'That tablet code is not valid.'); }
  };

  const enableCall = async () => {
    try {
      setError(''); const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: { facingMode: 'user' } });
      streamRef.current = stream; setCallEnabled(true); if (localVideoRef.current) localVideoRef.current.srcObject = stream; if (peerRef.current) await attachCallStream(peerRef.current, stream);
    } catch { setError('Camera and microphone access was not granted. Playback control still works.'); }
  };

  const startCall = async () => { if (!callEnabled) await enableCall(); setCallActive(true); send({ type: 'command', command: 'call-start' }); };
  const endCall = () => { setCallActive(false); send({ type: 'command', command: 'call-end' }); };
  const control = (command: RemoteCommand['command'], value?: string | number) => send(value === undefined ? { type: 'command', command: command as 'play' | 'pause' | 'call-start' | 'call-end' } : { type: 'command', command: command as 'select' | 'seek', value });
  const selectedVideo = player.library.find((video) => video.id === player.currentId);

  useEffect(() => () => { peerRef.current?.close(); stopCallStream(streamRef.current); }, []);

  return <div className="workspace-page controller-page">
    <Header eyebrow="Front seat" title="Parent controller" onBack={onBack} />
    <div className="page-padding workspace-content">
      <div className="workspace-intro"><div><span className="eyebrow purple">CONTROLLER MODE</span><h1>Everything is one tap away.</h1><p>Choose a video on the tablet, adjust playback, or open a call from the front seat.</p></div><StatusPill status={status} /></div>
      <div className="controller-layout">
        <section className="remote-card panel-card"><div className="remote-card-top"><div><span className="eyebrow">TABLET PREVIEW</span><h2>{status === 'connected' ? 'Back seat is ready' : 'Waiting for the tablet'}</h2></div><div className="remote-live-dot"><span /> direct link</div></div><div className="remote-video-stage"><video ref={remoteVideoRef} autoPlay playsInline /><div className="remote-placeholder"><div className="tablet-mini-icon">▣</div><strong>{status === 'connected' ? 'Select a video below' : 'Pair the tablet to begin'}</strong><span>{status === 'connected' ? 'The tablet plays the file locally.' : 'No camera or video leaves the tablet.'}</span></div>{status === 'connected' && <div className="remote-call-badge">{callActive ? '● Call active' : 'Video preview'}</div>}</div><div className="remote-actions"><button className="primary-button" onClick={callActive ? endCall : startCall} disabled={status !== 'connected'}>{callActive ? 'End two-way call' : '⌁ Start two-way call'}</button><button className="secondary-button" onClick={enableCall} disabled={callEnabled || status !== 'connected'}>{callEnabled ? 'Call access ready' : 'Enable camera & mic'}</button></div><video ref={localVideoRef} muted autoPlay playsInline className="hidden-video" /></section>
        <aside className="controller-side">
          <PairingPanel role="controller" status={status} offerToken={offerToken} answerToken={answerToken} offerQr="" answerQr={answerQr} onApplyOffer={applyOffer} onScan={() => setScanOpen(true)} error={error} />
          <section className="remote-library panel-card"><div className="panel-heading compact"><div><span className="eyebrow">TABLET LIBRARY</span><h2>Choose something to play</h2></div><span className="library-count">{player.library.length} files</span></div>{player.library.length === 0 ? <div className="library-empty">Pair the tablet to see its local video library here.</div> : <div className="video-list">{player.library.map((video, index) => <button className={`video-row ${video.id === player.currentId ? 'selected' : ''}`} key={video.id} onClick={() => control('select', video.id)}><span className="video-index">{String(index + 1).padStart(2, '0')}</span><span className="video-row-copy"><strong>{video.name}</strong><small>{formatBytes(video.size)}</small></span><span className="video-row-state">{video.id === player.currentId ? 'On screen' : 'Play next'}</span></button>)}</div>}</section>
          <section className="remote-controls panel-card"><div className="remote-controls-heading"><div><span className="eyebrow">PLAYBACK</span><h2>{selectedVideo?.name ?? 'No video selected'}</h2></div><span className="time-chip">{formatTime(player.currentTime)} / {formatTime(player.duration)}</span></div><input className="remote-range" type="range" min="0" max={player.duration || 1} value={Math.min(player.currentTime, player.duration || 1)} onChange={(event) => control('seek', Number(event.target.value))} disabled={status !== 'connected' || !selectedVideo} /><div className="remote-control-row"><button onClick={() => control('seek', Math.max(0, player.currentTime - 10))} disabled={status !== 'connected'}>↶ <small>10</small></button><button className="remote-play" onClick={() => control(player.paused ? 'play' : 'pause')} disabled={status !== 'connected' || !selectedVideo}>{player.paused ? '▶ Play' : 'Ⅱ Pause'}</button><button onClick={() => control('seek', Math.min(player.duration, player.currentTime + 10))} disabled={status !== 'connected'}>↷ <small>10</small></button></div></section>
        </aside>
      </div>
      {notice && <div className="notice-banner" onClick={() => setNotice('')}>{notice}<span>×</span></div>}
    </div>
    {scanOpen && <ScanModal onClose={() => setScanOpen(false)} onResult={(value) => { setScanOpen(false); void applyOffer(value); }} />}
  </div>;
}

function ScanModal({ onClose, onResult }: { onClose: () => void; onResult: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [scanError, setScanError] = useState('');
  useEffect(() => {
    if (!videoRef.current) return;
    const reader = new BrowserQRCodeReader();
    let stop = () => {};
    let cancelled = false;
    void reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
      if (!cancelled && result) onResult(result.getText());
    }).then((controls) => { stop = () => controls.stop(); }).catch(() => setScanError('Camera access is unavailable. Paste the pairing code instead.'));
    return () => { cancelled = true; stop(); };
  }, [onResult]);
  return <div className="modal-scrim"><div className="scan-modal panel-card"><div className="modal-heading"><div><span className="eyebrow">SCAN PAIRING CARD</span><h2>Point at the other screen</h2></div><button className="icon-button" onClick={onClose}>×</button></div><div className="scanner-frame"><video ref={videoRef} muted playsInline /><div className="scanner-corners" /></div>{scanError && <div className="error-banner">{scanError}</div>}<button className="secondary-button full-width" onClick={onClose}>Cancel</button></div></div>;
}

export default App;
