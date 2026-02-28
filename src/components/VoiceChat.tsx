import { useEffect, useRef, useState, useCallback } from 'react';
import { socket } from '../socket';
import type { ClientPlayer } from '../types';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

interface VoiceChatProps {
  players: ClientPlayer[];
  spectators: { id: string; name: string }[];
  myId: string;
}

export default function VoiceChat({ players, spectators, myId }: VoiceChatProps) {
  const [inVoice, setInVoice] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voiceUserIds, setVoiceUserIds] = useState<string[]>([]);
  const [error, setError] = useState('');

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const audiosRef = useRef(new Map<string, HTMLAudioElement>());
  // Buffer ICE candidates that arrive before remote description is set
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());

  function getPlayerName(id: string) {
    return players.find(p => p.id === id)?.name
        ?? spectators.find(s => s.id === id)?.name
        ?? 'Unknown';
  }

  const removePeer = useCallback((peerId: string) => {
    const pc = peersRef.current.get(peerId);
    if (pc) { pc.close(); peersRef.current.delete(peerId); }
    const audio = audiosRef.current.get(peerId);
    if (audio) { audio.pause(); audio.srcObject = null; audiosRef.current.delete(peerId); }
    pendingCandidatesRef.current.delete(peerId);
    setVoiceUserIds(prev => prev.filter(id => id !== peerId));
  }, []);

  // Flush ICE candidates buffered before remote description was ready
  const flushCandidates = useCallback(async (peerId: string, pc: RTCPeerConnection) => {
    const pending = pendingCandidatesRef.current.get(peerId) ?? [];
    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of pending) {
      try { await pc.addIceCandidate(candidate); } catch { /* ignore */ }
    }
  }, []);

  const createPeer = useCallback((peerId: string): RTCPeerConnection => {
    const old = peersRef.current.get(peerId);
    if (old) { old.close(); peersRef.current.delete(peerId); }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(peerId, pc);

    localStreamRef.current?.getTracks().forEach(track =>
      pc.addTrack(track, localStreamRef.current!)
    );

    pc.ontrack = (event) => {
      let audio = audiosRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audiosRef.current.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
      // Explicitly call play() to handle browsers that block autoplay
      audio.play().catch(() => {});
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('voice_ice', { targetId: peerId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        removePeer(peerId);
      }
    };

    return pc;
  }, [removePeer]);

  useEffect(() => {
    const onPeerList = async ({ peers }: { peers: string[] }) => {
      setVoiceUserIds(prev => [...new Set([...prev, ...peers])]);
      for (const peerId of peers) {
        const pc = createPeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('voice_offer', { targetId: peerId, offer });
        // Local ICE candidates begin flowing after setLocalDescription
      }
    };

    const onPeerJoined = ({ peerId }: { peerId: string }) => {
      // They will send us an offer; just add to display list
      setVoiceUserIds(prev => [...new Set([...prev, peerId])]);
    };

    const onPeerLeft = ({ peerId }: { peerId: string }) => {
      removePeer(peerId);
    };

    const onOffer = async ({ fromId, offer }: { fromId: string; offer: RTCSessionDescriptionInit }) => {
      if (!localStreamRef.current) return;
      // Ensure sender is in the display list (guard against missed onPeerJoined)
      setVoiceUserIds(prev => [...new Set([...prev, fromId])]);
      const pc = createPeer(fromId);
      await pc.setRemoteDescription(offer);
      await flushCandidates(fromId, pc); // drain candidates that arrived early
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('voice_answer', { targetId: fromId, answer });
    };

    const onAnswer = async ({ fromId, answer }: { fromId: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peersRef.current.get(fromId);
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(answer);
        await flushCandidates(fromId, pc); // drain candidates buffered before answer
      }
    };

    const onIce = async ({ fromId, candidate }: { fromId: string; candidate: RTCIceCandidateInit }) => {
      const pc = peersRef.current.get(fromId);
      if (pc && pc.remoteDescription) {
        // Remote description ready — add immediately
        try { await pc.addIceCandidate(candidate); } catch { /* ignore */ }
      } else {
        // Remote description not yet set — buffer for later
        const pending = pendingCandidatesRef.current.get(fromId) ?? [];
        pending.push(candidate);
        pendingCandidatesRef.current.set(fromId, pending);
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
  }, [createPeer, removePeer, flushCandidates]);

  const leaveVoice = useCallback(() => {
    for (const peerId of [...peersRef.current.keys()]) removePeer(peerId);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    socket.emit('voice_leave');
    setInVoice(false);
    setMuted(false);
    setVoiceUserIds([]);
  }, [removePeer]);

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
      setError('Mic denied.');
    }
  }

  function toggleMute() {
    const next = !muted;
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
    setMuted(next);
  }

  const inVoiceCount = voiceUserIds.length;

  return (
    <div className="voice-chat">
      {error && <span className="voice-chat__error">{error}</span>}

      {!inVoice ? (
        <button className="btn btn--ghost voice-chat__btn" onClick={joinVoice} title="Join voice chat">
          🎙️ Voice{inVoiceCount > 0 ? ` (${inVoiceCount})` : ''}
        </button>
      ) : (
        <>
          <button
            className={`btn voice-chat__btn ${muted ? 'btn--pass' : 'btn--draw'}`}
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🎤'} {inVoiceCount > 1 ? inVoiceCount : ''}
          </button>
          <button className="btn btn--ghost voice-chat__btn" onClick={leaveVoice} title="Leave voice">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
