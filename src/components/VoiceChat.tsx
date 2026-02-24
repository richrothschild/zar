import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../socket';
import type { ClientPlayer } from '../types';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

interface VoiceChatProps {
  players: ClientPlayer[];
  myId: string;
}

export default function VoiceChat({ players, myId }: VoiceChatProps) {
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceUserIds, setVoiceUserIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const audiosRef = useRef(new Map<string, HTMLAudioElement>());

  function getPlayerName(id: string) {
    return players.find(p => p.id === id)?.name ?? 'Unknown';
  }

  const removePeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) { pc.close(); peersRef.current.delete(peerId); }
    const audio = audiosRef.current.get(peerId);
    if (audio) { audio.srcObject = null; audiosRef.current.delete(peerId); }
    setVoiceUserIds(prev => prev.filter(id => id !== peerId));
  }, []);

  const createPeer = useCallback((peerId: string): RTCPeerConnection => {
    // Clean up any existing connection to this peer
    const old = peersRef.current.get(peerId);
    if (old) { old.close(); peersRef.current.delete(peerId); }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, pc);

    // Add local audio tracks to the connection
    localStreamRef.current?.getTracks().forEach(track =>
      pc.addTrack(track, localStreamRef.current!)
    );

    // Play incoming audio from this peer
    pc.ontrack = (event) => {
      let audio = audiosRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audiosRef.current.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
    };

    // Forward ICE candidates through the server
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice_ice', { targetId: peerId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') removePeer(peerId);
    };

    return pc;
  }, [removePeer]);

  // Socket listeners for WebRTC signaling
  useEffect(() => {
    // Server sends us the list of peers already in voice when we join
    const onPeerList = async ({ peers }: { peers: string[] }) => {
      setVoiceUserIds(prev => [...new Set([...prev, ...peers])]);
      // We initiate the offer to each existing peer
      for (const peerId of peers) {
        const pc = createPeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice_offer', { targetId: peerId, offer });
      }
    };

    // A new peer joined after us — they will send us an offer
    const onPeerJoined = ({ peerId }: { peerId: string }) => {
      setVoiceUserIds(prev => [...new Set([...prev, peerId])]);
    };

    const onPeerLeft = ({ peerId }: { peerId: string }) => {
      removePeer(peerId);
    };

    // Receive an offer from a peer who joined before us
    const onOffer = async ({ fromId, offer }: { fromId: string; offer: RTCSessionDescriptionInit }) => {
      if (!localStreamRef.current) return;
      const pc = createPeer(fromId);
      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice_answer', { targetId: fromId, answer });
    };

    const onAnswer = async ({ fromId, answer }: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peersRef.current.get(fromId);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(answer);
      }
    };

    const onIce = async ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
      const pc = peersRef.current.get(fromId);
      if (pc) {
        try { await pc.addIceCandidate(candidate); } catch { /* ignore */ }
      }
    };

    socket.on('voice_peer_list', onPeerList);
    socket.on('voice_peer_joined', onPeerJoined);
    socket.on('voice_peer_left', onPeerLeft);
    socket.on('voice_offer', onOffer);
    socket.on('voice_answer', onAnswer);
    socket.on('voice_ice', onIce);

    return () => {
      socket.off('voice_peer_list', onPeerList);
      socket.off('voice_peer_joined', onPeerJoined);
      socket.off('voice_peer_left', onPeerLeft);
      socket.off('voice_offer', onOffer);
      socket.off('voice_answer', onAnswer);
      socket.off('voice_ice', onIce);
    };
  }, [createPeer, removePeer]);

  const leaveVoice = useCallback(() => {
    for (const peerId of [...peersRef.current.keys()]) removePeer(peerId);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    socket.emit('voice_leave');
    setInVoice(false);
    setMuted(false);
    setVoiceUserIds([]);
  }, [removePeer]);

  // Clean up on unmount
  useEffect(() => {
    return () => { if (localStreamRef.current) leaveVoice(); };
  }, [leaveVoice]);

  async function joinVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      socket.emit('voice_join');
      setInVoice(true);
      setVoiceUserIds([myId]);
      setError('');
    } catch {
      setError('Microphone access denied.');
    }
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
  }

  return (
    <div className="voice-chat">
      <div className="voice-chat__header">🎙️ Voice</div>

      {error && <p className="voice-chat__error">{error}</p>}

      {!inVoice ? (
        <button className="btn btn--ghost voice-chat__btn" onClick={joinVoice}>
          Join Voice
        </button>
      ) : (
        <div className="voice-chat__controls">
          <button
            className={`btn voice-chat__btn ${muted ? 'btn--pass' : 'btn--draw'}`}
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇 Muted' : '🎤 Live'}
          </button>
          <button className="btn btn--ghost voice-chat__btn" onClick={leaveVoice}>
            Leave
          </button>
        </div>
      )}

      {voiceUserIds.length > 0 && (
        <div className="voice-chat__users">
          {voiceUserIds.map(id => (
            <div key={id} className="voice-chat__user">
              {muted && id === myId ? '🔇' : '🎤'} {getPlayerName(id)}{id === myId ? ' (you)' : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
