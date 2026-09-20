'use client'

/**
 * ============================================================================
 *  THE VIDEO CONSULTATION ROOM — WebRTC, from scratch
 * ============================================================================
 *
 *  This is the most involved file in the project, so here is the whole picture
 *  before any code.
 *
 *  WHAT WEBRTC ACTUALLY DOES
 *  -------------------------
 *  It creates a direct connection between two browsers. The audio and video travel
 *  peer to peer and never touch our server, which is why a 1-to-1 call costs
 *  nothing to run and has low latency.
 *
 *  THE HANDSHAKE, IN ORDER
 *  -----------------------
 *  Suppose the physiotherapist is already waiting and the patient now joins:
 *
 *    1. Both get their camera and microphone with getUserMedia().
 *    2. Both connect to our Socket.IO signalling server and join the room.
 *    3. The patient is told `shouldInitiate: true` — she arrived second, so she
 *       makes the first move. (Exactly one side must, or you get two competing
 *       connections; the spec calls that glare.)
 *    4. Patient creates an OFFER — a text blob (SDP) describing her codecs and
 *       network candidates — and sends it through the socket.
 *    5. Physio receives the offer, sets it as the remote description, creates an
 *       ANSWER, and sends that back.
 *    6. Both sides exchange ICE CANDIDATES: every network path each might be
 *       reachable on. The browsers try them until one pair works.
 *    7. `ontrack` fires with the other person's media. Video appears. From this
 *       point our server is not involved in the call at all.
 *
 *  WHY THE ORDER MATTERS
 *  ---------------------
 *  ICE candidates can arrive before the offer they belong to. Setting a candidate
 *  on a connection with no remote description throws. So candidates that arrive
 *  early are queued and applied once the description is in place — see
 *  `pendingCandidates` below. Skipping that is the single most common reason a
 *  hand-rolled WebRTC implementation works on localhost and fails in the wild.
 *
 *  WHY useRef AND NOT useState FOR THE CONNECTION
 *  ----------------------------------------------
 *  RTCPeerConnection, MediaStream and the socket are mutable objects with a life
 *  of their own. Putting them in state would trigger a re-render on every change
 *  and, worse, a re-render would read a stale copy mid-handshake. Refs hold a
 *  stable reference across renders, which is exactly what long-lived objects need.
 *  State is reserved here for things the UI actually draws.
 * ============================================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { io } from 'socket.io-client'
import {
  Mic, MicOff, Video as VideoIcon, VideoOff, PhoneOff, MessageSquare, Send, X,
  MonitorUp, Maximize2, Minimize2, Loader2, WifiOff, AlertCircle, Stethoscope,
  ClipboardList, ShieldCheck, RefreshCw,
} from 'lucide-react'
import { toast } from '@/lib/toast'
import { cn, formatTime, formatDateLong, firstName } from '@/lib/utils'
import { painColour } from '@/components/ui/Field'
import Button from '@/components/ui/Button'

export default function VideoRoom({ site, token, iceServers, hasTurn, self, appointment }) {
  const router = useRouter()

  /* ------------------------------------------------------------------ refs */
  // Long-lived mutable objects. See the note above on why these are not state.
  const socketRef = useRef(null)
  const peerRef = useRef(null)
  const localStreamRef = useRef(null)
  const localVideoRef = useRef(null)
  const remoteVideoRef = useRef(null)
  const peerSocketIdRef = useRef(null)
  const pendingCandidatesRef = useRef([])
  const chatEndRef = useRef(null)
  // Tracks whether we already tore down, so cleanup cannot run twice.
  const endedRef = useRef(false)
  // True once the peer connection has been up at least once, so a later 'connected'
  // can be recognised as a RECONNECTION rather than the first hello.
  const hasConnectedRef = useRef(false)

  /* ---------------------------------------------------------------- state */
  // 'requesting-media' | 'connecting' | 'waiting' | 'connected' | 'reconnecting'
  // | 'ended' | 'error'
  const [phase, setPhase] = useState('requesting-media')
  const [errorMessage, setErrorMessage] = useState(null)
  const [peer, setPeer] = useState(null)
  // Our own socket id, kept in STATE rather than read from socketRef during render.
  // The chat panel needs it to tell our messages from theirs, and anything the UI
  // draws has to be state — reading a ref while rendering gives React no reason to
  // re-render when it changes.
  const [selfSocketId, setSelfSocketId] = useState(null)

  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [sharingScreen, setSharingScreen] = useState(false)
  const [peerMedia, setPeerMedia] = useState({ audio: true, video: true })

  const [chatOpen, setChatOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [unread, setUnread] = useState(0)
  const [draft, setDraft] = useState('')

  const [elapsed, setElapsed] = useState(0)
  const [notesOpen, setNotesOpen] = useState(false)

  const isPhysio = self.role === 'physio'
  const otherPersonName = isPhysio ? appointment.patientName : appointment.physioName

  /* ======================================================================== */
  /*  1. CAMERA AND MICROPHONE                                                */
  /* ======================================================================== */

  useEffect(() => {
    let cancelled = false

    async function getMedia() {
      try {
        /**
         * The constraints are chosen for a physiotherapy consultation specifically.
         *
         * 1280x720 rather than the highest available: the physio needs to see a
         * whole body moving, and a wider, lower-resolution picture is far more
         * useful than a razor-sharp close-up of someone's face. It also survives a
         * weak connection much better.
         *
         * echoCancellation and noiseSuppression are essential — without them, a
         * patient in a room with a fan gets unintelligible audio.
         */
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 },
            facingMode: 'user',
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })

        if (cancelled) {
          // The component unmounted while the permission prompt was open. Release
          // the camera immediately, or its light stays on with nothing using it.
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        localStreamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
        setPhase('connecting')
      } catch (error) {
        if (cancelled) return
        // Distinguishing these matters: "denied" needs different instructions from
        // "you have no camera", and a generic failure message helps nobody.
        const messages = {
          NotAllowedError:
            'Camera and microphone access was blocked. Click the padlock icon in your browser’s address bar, allow both, then reload this page.',
          NotFoundError:
            'No camera or microphone was found. Plug one in, or join from a phone instead.',
          NotReadableError:
            'Your camera is already being used by another app. Close Zoom, Teams or any other video app and reload.',
          OverconstrainedError:
            'Your camera does not support the required video settings. Try a different device.',
        }
        const message =
          messages[error.name] ||
          'Could not access your camera and microphone. Check your browser permissions and reload.'
        setErrorMessage(message)
        setPhase('error')
        toast.error(message, { duration: 12000 })
      }
    }

    getMedia()

    return () => {
      cancelled = true
    }
  }, [])

  /* ======================================================================== */
  /*  2. THE PEER CONNECTION                                                  */
  /* ======================================================================== */

  /**
   * Build an RTCPeerConnection and attach every handler it needs.
   *
   * Wrapped in useCallback so the socket effect below can depend on it without
   * being rebuilt on every render.
   */
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers,
      // Gather candidates from up to 4 network interfaces. More than that mostly
      // slows down connection setup without finding new paths.
      iceCandidatePoolSize: 4,
    })

    // Add our own audio and video to the connection. This is what the other side
    // will receive.
    const stream = localStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream))
    }

    /**
     * ICE candidates are discovered ASYNCHRONOUSLY and over several seconds — this
     * fires repeatedly as the browser learns new possible network paths. Each one
     * gets forwarded to the other side as it appears; waiting to collect them all
     * before sending (called "vanilla ICE") makes the call noticeably slower to
     * connect.
     */
    pc.onicecandidate = (event) => {
      if (event.candidate && peerSocketIdRef.current) {
        socketRef.current?.emit('signal', {
          to: peerSocketIdRef.current,
          data: { type: 'ice', candidate: event.candidate },
        })
      }
    }

    // The other person's media has arrived. This is the moment video appears.
    pc.ontrack = (event) => {
      const [remoteStream] = event.streams
      if (remoteVideoRef.current && remoteStream) {
        remoteVideoRef.current.srcObject = remoteStream
      }
      setPhase('connected')
    }

    /**
     * Connection state, and why each branch is handled:
     *
     *   'connected'    the direct path is up
     *   'disconnected' a transient blip — a lift, a tunnel, switching Wi-Fi to
     *                  mobile. WebRTC often recovers by itself within seconds, so
     *                  we show "reconnecting" rather than ending the call.
     *   'failed'       ICE exhausted every candidate pair. This does NOT recover
     *                  on its own; it needs an ICE restart, which is what the
     *                  Reconnect button triggers. Very often this is the
     *                  no-TURN-server case.
     */
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState

      if (state === 'connected') {
        /**
         * Announce a RECOVERY, not the first connect — the video appearing is its own
         * announcement, and a toast on top of that is noise.
         *
         * The check uses a ref rather than reading `phase`. Two reasons: this callback
         * was created inside a memoised function, so a `phase` closure would be stale;
         * and putting the dispatch inside a setPhase updater would make the updater
         * impure, which React is free to call twice.
         */
        if (hasConnectedRef.current) {
          toast.success('Reconnected.')
        }
        hasConnectedRef.current = true
        setPhase('connected')
        setErrorMessage(null)
      } else if (state === 'disconnected') {
        setPhase('reconnecting')
        toast.warning('Connection dropped — trying to reconnect. Stay on this page.')
      } else if (state === 'failed') {
        setPhase('error')
        const message = hasTurn
          ? 'The connection failed. Tap Reconnect to try again, or switch to a different network.'
          : 'Could not establish a direct connection — this usually means one of you is behind a restrictive network. A TURN server is needed for these cases; see TURN_URL in .env.example.'
        setErrorMessage(message)
        toast.error(message, { duration: 12000 })
      }
    }

    peerRef.current = pc
    return pc
  }, [iceServers, hasTurn])

  /* ======================================================================== */
  /*  3. SIGNALLING                                                           */
  /* ======================================================================== */

  useEffect(() => {
    // Wait until the camera is ready — a peer connection with no tracks would
    // connect and then show a black rectangle.
    if (phase !== 'connecting' || socketRef.current) return

    const socket = io({
      path: '/api/socket',
      // The signed token from the server component. The signalling server verifies
      // it before allowing this socket to join anything — see lib/videoToken.js.
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
    socketRef.current = socket

    // Socket.IO assigns the id at connect time, so this is the earliest it exists.
    socket.on('connect', () => setSelfSocketId(socket.id))

    /* ------------------------------------------------------ we are in */
    socket.on('joined', async ({ peers, shouldInitiate }) => {
      if (peers.length === 0) {
        // We are first. Wait for the other person; they will make the offer.
        setPhase('waiting')
        return
      }

      const other = peers[0]
      peerSocketIdRef.current = other.socketId
      setPeer(other)

      if (shouldInitiate) {
        // We arrived second, so we create the offer.
        const pc = createPeerConnection()
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('signal', { to: other.socketId, data: { type: 'offer', sdp: offer } })
      }
    })

    /* ------------------------------------------- the other person arrives */
    socket.on('peer-joined', (joiner) => {
      peerSocketIdRef.current = joiner.socketId
      setPeer(joiner)
      toast.success(`${firstName(joiner.name)} has joined the consultation.`)
      // We do nothing else. THEY are the second arrival, so they send the offer —
      // if we also sent one, both connections would collide.
      setPhase('connecting')
    })

    /* --------------------------------------------- the signalling messages */
    socket.on('signal', async ({ from, data }) => {
      peerSocketIdRef.current = from

      try {
        if (data.type === 'offer') {
          // A peer connection may already exist if this is a renegotiation, e.g.
          // when the other side starts sharing their screen.
          const pc = peerRef.current || createPeerConnection()

          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
          // Hand over the queued candidates and clear the queue in one step.
          await applyCandidates(pc, pendingCandidatesRef.current.splice(0))

          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          socket.emit('signal', { to: from, data: { type: 'answer', sdp: answer } })
        }

        if (data.type === 'answer') {
          const pc = peerRef.current
          if (!pc) return
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
          // Hand over the queued candidates and clear the queue in one step.
          await applyCandidates(pc, pendingCandidatesRef.current.splice(0))
        }

        if (data.type === 'ice') {
          const pc = peerRef.current
          /**
           * THE QUEUE THAT MAKES THIS WORK IN THE REAL WORLD
           *
           * Candidates routinely arrive before the offer or answer they belong to.
           * addIceCandidate on a connection with no remote description throws, so
           * early arrivals are stashed here and applied by applyCandidates() the
           * moment the description is set.
           *
           * Omitting this is why hand-written WebRTC "works on my machine" and
           * then fails intermittently for real users.
           */
          if (pc?.remoteDescription?.type) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate))
          } else {
            pendingCandidatesRef.current.push(data.candidate)
          }
        }
      } catch (error) {
        // A single failed candidate is normal and harmless — ICE tries many paths
        // and most of them fail. Log it; do not alarm the patient.
        console.warn('[webrtc] signalling step failed:', error.message)
      }
    })

    /* --------------------------------------------------- they hung up */
    socket.on('peer-left', ({ reason }) => {
      if (reason === 'left') {
        toast.info(`${firstName(otherPersonName)} has left the consultation.`)
      } else {
        toast.warning(
          `${firstName(otherPersonName)} lost connection. They can rejoin from this page.`
        )
      }

      setPeer(null)
      setPeerMedia({ audio: true, video: true })
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null

      // Close the old connection completely. Reusing a peer connection after the
      // other side has gone leaves it in a broken state that will not renegotiate.
      peerRef.current?.close()
      peerRef.current = null
      pendingCandidatesRef.current = []
      peerSocketIdRef.current = null

      setPhase('waiting')
    })

    socket.on('peer-media-state', ({ audio, video }) => setPeerMedia({ audio, video }))

    socket.on('chat', (message) => {
      setMessages((previous) => [...previous, message])
      // Only count it as unread if it came from the other person. Badging your own
      // message would be silly.
      setUnread((n) => (message.from === socket.id ? n : n + 1))
    })

    socket.on('room-full', () => {
      const message =
        'Two people are already in this consultation. If you were disconnected, wait a few seconds and reload — the room will free up.'
      setErrorMessage(message)
      setPhase('error')
      toast.error(message, { duration: 12000 })
    })

    socket.on('connect_error', (error) => {
      const message =
        error.message === 'UNAUTHORISED'
          ? 'Your access to this room has expired. Reload the page to get a fresh link.'
          : 'Could not reach the consultation server. Check your connection and reload.'
      setErrorMessage(message)
      setPhase('error')
      toast.error(message, { duration: 12000 })
    })

    /* --------------------------------------------------------- cleanup */
    return () => {
      socket.disconnect()
      socketRef.current = null
      setSelfSocketId(null)
    }
  }, [phase, token, createPeerConnection, otherPersonName])

  /* ======================================================================== */
  /*  4. TEARDOWN                                                             */
  /* ======================================================================== */

  const hangUp = useCallback(
    (navigate = true) => {
      if (endedRef.current) return
      endedRef.current = true

      socketRef.current?.emit('leave')
      socketRef.current?.disconnect()
      peerRef.current?.close()

      /**
       * STOPPING EVERY TRACK IS NOT OPTIONAL.
       *
       * Without this the camera light stays on after the call ends. On a medical
       * site that is not a cosmetic bug — a patient who believes they are still
       * being watched will not use the service again.
       */
      localStreamRef.current?.getTracks().forEach((track) => track.stop())

      setPhase('ended')
      if (navigate) {
        // A moment on the "call ended" screen, so hanging up does not feel like a
        // crash, then back to the appointment.
        setTimeout(() => router.push(`/dashboard/appointments/${appointment.id}`), 1600)
      }
    },
    [router, appointment.id]
  )

  // Release the camera if the component unmounts for any reason — a back button,
  // a client-side navigation, a hot reload in development.
  useEffect(() => {
    return () => {
      socketRef.current?.disconnect()
      peerRef.current?.close()
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  /**
   * Warn before closing the tab mid-consultation.
   *
   * Browsers only honour this if the user has interacted with the page, and they
   * show their own generic wording rather than ours — but it does prevent an
   * accidental Cmd-W from silently ending a paid session.
   */
  useEffect(() => {
    if (phase !== 'connected') return
    const warn = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [phase])

  /* ======================================================================== */
  /*  5. CONTROLS                                                             */
  /* ======================================================================== */

  /**
   * Mute by disabling the track, NOT by removing it.
   *
   * `track.enabled = false` keeps the connection intact and simply sends silence.
   * Removing the track would force a full renegotiation, which takes seconds and
   * can drop the video too — a terrible experience for a mute button.
   */
  function toggleMic() {
    const audio = localStreamRef.current?.getAudioTracks()[0]
    if (!audio) return
    audio.enabled = !audio.enabled
    setMicOn(audio.enabled)
    socketRef.current?.emit('media-state', { audio: audio.enabled, video: cameraOn })
  }

  function toggleCamera() {
    const video = localStreamRef.current?.getVideoTracks()[0]
    if (!video) return
    video.enabled = !video.enabled
    setCameraOn(video.enabled)
    socketRef.current?.emit('media-state', { audio: micOn, video: video.enabled })
  }

  /**
   * SCREEN SHARING
   *
   * Genuinely useful here: the physiotherapist can put an X-ray, a diagram of the
   * spine, or an exercise video on screen while explaining it.
   *
   * The clever part is `RTCRtpSender.replaceTrack()`. It swaps the camera track for
   * the screen track inside the existing connection, with NO renegotiation — the
   * other side just sees the picture change. Adding a second track instead would
   * require a fresh offer/answer round trip and a visible interruption.
   */
  async function toggleScreenShare() {
    const pc = peerRef.current
    if (!pc) return

    const sender = pc.getSenders().find((s) => s.track?.kind === 'video')
    if (!sender) return

    if (sharingScreen) {
      // Back to the camera.
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
      if (cameraTrack) await sender.replaceTrack(cameraTrack)
      if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current
      setSharingScreen(false)
      toast.info('Stopped sharing your screen.')
      return
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15 } },   // 15fps is plenty for a diagram
        audio: false,
      })
      const screenTrack = screenStream.getVideoTracks()[0]

      await sender.replaceTrack(screenTrack)
      if (localVideoRef.current) localVideoRef.current.srcObject = screenStream
      setSharingScreen(true)
      toast.info(`${firstName(otherPersonName)} can now see your screen.`)

      // The browser shows its own "Stop sharing" bar. When that is used, this
      // fires — so the UI must follow it back to the camera, or the button lies.
      screenTrack.onended = async () => {
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0]
        if (cameraTrack) await sender.replaceTrack(cameraTrack)
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current
        setSharingScreen(false)
      }
    } catch {
      // The user cancelled the picker. Not an error worth reporting.
    }
  }

  /** An ICE restart: rebuild the network path without tearing down the call. */
  async function reconnect() {
    const pc = peerRef.current
    if (!pc || !peerSocketIdRef.current) {
      // Nothing to restart — start over cleanly.
      window.location.reload()
      return
    }

    setPhase('reconnecting')
    setErrorMessage(null)

    try {
      const offer = await pc.createOffer({ iceRestart: true })
      await pc.setLocalDescription(offer)
      socketRef.current?.emit('signal', {
        to: peerSocketIdRef.current,
        data: { type: 'offer', sdp: offer },
      })
    } catch {
      window.location.reload()
    }
  }

  function sendMessage(event) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    socketRef.current?.emit('chat', { text })
    setDraft('')
  }

  /* ---------------------------------------------------- the call timer */
  useEffect(() => {
    if (phase !== 'connected') return
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [phase])

  /* ----------------------------------------- keep the chat scrolled down */
  // Scrolling the DOM is a side effect of new messages arriving, so it belongs in an
  // effect. Clearing the unread badge does NOT — that happens because the user opened
  // the panel, so it lives in toggleChat() below.
  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatOpen])

  function toggleChat() {
    setChatOpen((open) => {
      // Opening the panel means they have seen the messages.
      if (!open) setUnread(0)
      return !open
    })
  }

  /* ======================================================================== */
  /*  6. RENDER                                                               */
  /* ======================================================================== */

  if (phase === 'ended') {
    return (
      <CallEnded appointmentId={appointment.id} elapsed={elapsed} isPhysio={isPhysio} />
    )
  }

  return (
    <div className="flex h-screen flex-col bg-ink-950 text-white">
      {/* ==================================================== the top bar */}
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-500 to-brand-700">
            <Stethoscope className="size-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{appointment.serviceName}</p>
            <p className="truncate text-xs text-white/50">
              {formatDateLong(appointment.date)} · {formatTime(appointment.startTime)} ·{' '}
              <span className="font-mono">{appointment.code}</span>
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StatusPill phase={phase} elapsed={elapsed} />
        </div>
      </header>

      {/* ================================================== the video area */}
      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex-1">
          {/* ------------------------------------------- the other person */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="video-cover bg-ink-900"
          />

          {/* Their name, and a muted indicator. Small, but it saves the most
              commonly wasted minute of any video call. */}
          {phase === 'connected' && (
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-xl bg-ink-950/70 px-3 py-1.5 backdrop-blur">
              <span className="text-sm font-semibold">{peer?.name || otherPersonName}</span>
              {!peerMedia.audio && <MicOff className="size-3.5 text-red-400" aria-hidden="true" />}
              {!peerMedia.video && <VideoOff className="size-3.5 text-red-400" aria-hidden="true" />}
            </div>
          )}

          {/* ------------------------------------------------- overlays */}
          {phase !== 'connected' && (
            <Overlay
              phase={phase}
              errorMessage={errorMessage}
              otherPersonName={otherPersonName}
              isPhysio={isPhysio}
              onReconnect={reconnect}
            />
          )}

          {/* -------------------------------------------- self preview */}
          {/* `scale-x-[-1]` mirrors your own video, because that is what people
              expect from a mirror. The OTHER person's video is deliberately not
              mirrored — mirroring theirs would make a physio's "raise your left
              arm" instruction ambiguous, which genuinely matters in rehab. */}
          <div className="absolute bottom-4 right-4 w-32 overflow-hidden rounded-2xl border-2 border-white/20 shadow-float sm:w-44 lg:w-52">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted   // Never play your own audio back — it causes a feedback howl.
              className={cn(
                'aspect-video w-full bg-ink-900 object-cover',
                !sharingScreen && 'scale-x-[-1]'
              )}
            />
            {!cameraOn && (
              <div className="absolute inset-0 grid place-items-center bg-ink-900">
                <VideoOff className="size-6 text-white/40" aria-hidden="true" />
              </div>
            )}
            <span className="absolute bottom-1 left-2 text-[10px] font-semibold text-white/70">
              You{sharingScreen && ' · sharing screen'}
            </span>
          </div>
        </div>

        {/* ================================================= side panels */}
        {chatOpen && (
          <ChatPanel
            messages={messages}
            draft={draft}
            setDraft={setDraft}
            onSend={sendMessage}
            onClose={() => setChatOpen(false)}
            selfSocketId={selfSocketId}
            chatEndRef={chatEndRef}
          />
        )}

        {notesOpen && isPhysio && (
          <NotesPanel appointment={appointment} onClose={() => setNotesOpen(false)} />
        )}
      </div>

      {/* ==================================================== the controls */}
      <footer className="flex shrink-0 items-center justify-center gap-2 border-t border-white/10 px-4 py-4 sm:gap-3">
        <ControlButton
          onClick={toggleMic}
          active={micOn}
          icon={micOn ? Mic : MicOff}
          label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          danger={!micOn}
        />
        <ControlButton
          onClick={toggleCamera}
          active={cameraOn}
          icon={cameraOn ? VideoIcon : VideoOff}
          label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          danger={!cameraOn}
        />

        {/* getDisplayMedia does not exist on mobile browsers, so the button is
            hidden there rather than shown broken. */}
        <ControlButton
          onClick={toggleScreenShare}
          active={sharingScreen}
          icon={MonitorUp}
          label={sharingScreen ? 'Stop sharing screen' : 'Share your screen'}
          className="hidden sm:flex"
          highlighted={sharingScreen}
        />

        <ControlButton
          onClick={toggleChat}
          active={chatOpen}
          icon={MessageSquare}
          label="Chat"
          badge={unread > 0 && !chatOpen ? unread : null}
          highlighted={chatOpen}
        />

        {/* The physio's crib sheet: what the patient wrote when booking, and their
            pain score. Reading it mid-consultation beats asking again. */}
        {isPhysio && (
          <ControlButton
            onClick={() => setNotesOpen((v) => !v)}
            active={notesOpen}
            icon={ClipboardList}
            label="Patient notes"
            highlighted={notesOpen}
          />
        )}

        <button
          type="button"
          onClick={() => hangUp()}
          className="ml-2 flex h-12 items-center gap-2 rounded-2xl bg-red-600 px-5 text-sm font-bold transition-colors hover:bg-red-700"
        >
          <PhoneOff className="size-4.5" aria-hidden="true" />
          <span className="hidden sm:inline">End call</span>
        </button>
      </footer>
    </div>
  )
}

/* ========================================================================== */
/*  SUB-COMPONENTS                                                            */
/* ========================================================================== */

function StatusPill({ phase, elapsed }) {
  const labels = {
    'requesting-media': { text: 'Starting camera', tone: 'bg-white/10', icon: Loader2, spin: true },
    connecting: { text: 'Connecting', tone: 'bg-amber-500/20 text-amber-200', icon: Loader2, spin: true },
    waiting: { text: 'Waiting for the other person', tone: 'bg-white/10', icon: Loader2, spin: true },
    connected: { text: formatElapsed(elapsed), tone: 'bg-emerald-500/20 text-emerald-200', icon: null },
    reconnecting: { text: 'Reconnecting', tone: 'bg-amber-500/20 text-amber-200', icon: WifiOff },
    error: { text: 'Connection problem', tone: 'bg-red-500/20 text-red-200', icon: AlertCircle },
  }
  const state = labels[phase] || labels.connecting

  return (
    <span
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold tabular-nums',
        state.tone
      )}
    >
      {state.icon ? (
        <state.icon className={cn('size-3.5', state.spin && 'animate-spin')} aria-hidden="true" />
      ) : (
        <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
      )}
      {state.text}
    </span>
  )
}

function Overlay({ phase, errorMessage, otherPersonName, isPhysio, onReconnect }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-ink-900/95 p-6 text-center backdrop-blur-sm">
      <div className="max-w-md">
        {phase === 'error' ? (
          <>
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-red-500/15 text-red-400">
              <AlertCircle className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-bold">Something is in the way</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-white/70">{errorMessage}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button onClick={onReconnect} size="sm">
                <RefreshCw className="size-4" aria-hidden="true" />
                Try again
              </Button>
              <Button
                href={`tel:${site.contact.phone.replace(/\s/g, '')}`}
                variant="secondary"
                size="sm"
              >
                Call the clinic instead
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/10">
              <Loader2 className="size-7 animate-spin text-brand-300" aria-hidden="true" />
            </span>

            <h2 className="mt-5 text-lg font-bold">
              {phase === 'requesting-media' && 'Starting your camera'}
              {phase === 'connecting' && 'Connecting you now'}
              {phase === 'waiting' && `Waiting for ${otherPersonName}`}
              {phase === 'reconnecting' && 'Connection dropped — reconnecting'}
            </h2>

            <p className="mt-2.5 text-sm leading-relaxed text-white/60">
              {phase === 'requesting-media' &&
                'Your browser will ask for permission to use your camera and microphone. Please allow both.'}
              {phase === 'connecting' && 'Establishing a direct, private connection between you.'}
              {phase === 'waiting' &&
                (isPhysio
                  ? 'Your patient has not joined yet. They will appear here as soon as they do.'
                  : `${otherPersonName} will join shortly. This is a good moment to check that your whole body is visible in the small preview.`)}
              {phase === 'reconnecting' &&
                'Hold on — this usually recovers within a few seconds without you doing anything.'}
            </p>

            {phase === 'waiting' && (
              <ul className="mx-auto mt-6 max-w-xs space-y-2 text-left text-xs text-white/50">
                {[
                  'Camera at roughly waist height, so your whole body fits in frame',
                  'About two metres of clear floor space behind you',
                  'A chair and a water bottle within reach',
                  'Headphones if you have them — they prevent echo',
                ].map((tip) => (
                  <li key={tip} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 size-3 shrink-0 text-brand-400" aria-hidden="true" />
                    {tip}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ChatPanel({ messages, draft, setDraft, onSend, onClose, selfSocketId, chatEndRef }) {
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-white/10 bg-ink-900 sm:static sm:w-80">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
        <h2 className="text-sm font-bold">Chat</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="Close chat"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-center text-xs leading-relaxed text-white/40">
            Handy for anything hard to say out loud — an exercise name, a link, or a spelling.
          </p>
        )}

        {messages.map((message, index) => {
          const mine = message.from === selfSocketId
          return (
            <div key={index} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-3.5 py-2',
                  mine ? 'bg-brand-600' : 'bg-white/10'
                )}
              >
                {!mine && (
                  <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                    {message.name}
                  </p>
                )}
                {/* wrap-break-word stops a long pasted URL from widening the panel and
                    breaking the layout. */}
                <p className="whitespace-pre-wrap wrap-break-word text-sm">{message.text}</p>
                <p className="mt-0.5 text-[10px] text-white/40">
                  {new Date(message.at).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          )
        })}
        {/* An empty div that we scroll into view — the simplest reliable way to keep
            a chat pinned to the newest message. */}
        <div ref={chatEndRef} />
      </div>

      <form onSubmit={onSend} className="flex shrink-0 gap-2 border-t border-white/10 p-3">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type a message…"
          maxLength={1000}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-white/30 focus:border-brand-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-600 transition-colors hover:bg-brand-700 disabled:opacity-40"
          aria-label="Send message"
        >
          <Send className="size-4" />
        </button>
      </form>
    </aside>
  )
}

/** The physiotherapist's reference panel — visible to staff only. */
function NotesPanel({ appointment, onClose }) {
  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-white/10 bg-ink-900 sm:static sm:w-80">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 p-4">
        <h2 className="text-sm font-bold">Patient notes</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="Close notes"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Patient</p>
          <p className="mt-1 font-semibold">{appointment.patientName}</p>
        </div>

        {appointment.painLevel !== null && appointment.painLevel !== undefined && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              Pain at booking
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className="grid size-9 place-items-center rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: painColour(appointment.painLevel) }}
              >
                {appointment.painLevel}
              </span>
              <span className="text-white/60">out of 10</span>
            </div>
          </div>
        )}

        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            What they wrote
          </p>
          <p className="mt-1.5 whitespace-pre-line leading-relaxed text-white/80">
            {appointment.patientNotes || 'Nothing written at booking.'}
          </p>
        </div>

        <div className="rounded-2xl bg-white/5 p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">
            After the call
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-white/60">
            Write up the SOAP note and prescribe exercises from the admin panel. The patient sees the
            assessment, the plan and their exercises in their own dashboard.
          </p>
          <Link
            href={`/admin/appointments/${appointment.id}`}
            target="_blank"
            className="mt-3 inline-block text-xs font-semibold text-brand-300 underline"
          >
            Open clinical notes →
          </Link>
        </div>
      </div>
    </aside>
  )
}

function ControlButton({ onClick, icon: ButtonIcon, label, danger, highlighted, badge, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      // Both the accessible name and the tooltip. An icon-only button with no
      // aria-label is invisible to a screen reader.
      aria-label={label}
      title={label}
      className={cn(
        'relative grid size-12 place-items-center rounded-2xl transition-colors',
        danger
          ? 'bg-red-600 hover:bg-red-700'
          : highlighted
            ? 'bg-brand-600 hover:bg-brand-700'
            : 'bg-white/10 hover:bg-white/20',
        className
      )}
    >
      <ButtonIcon className="size-5" aria-hidden="true" />
      {badge ? (
        <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

function CallEnded({ appointmentId, elapsed, isPhysio }) {
  return (
    <div className="grid min-h-screen place-items-center bg-ink-950 p-6 text-center text-white">
      <div className="max-w-md">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white/10">
          <PhoneOff className="size-7 text-white/70" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-bold">Consultation ended</h1>
        <p className="mt-2 text-sm text-white/60">
          {elapsed > 0 ? `The call lasted ${formatElapsed(elapsed)}. ` : ''}
          {isPhysio
            ? 'Write up the clinical notes and prescribe exercises while it is fresh.'
            : 'Your physiotherapist’s notes and exercises will appear on your appointment page shortly.'}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button
            href={isPhysio ? `/admin/appointments/${appointmentId}` : `/dashboard/appointments/${appointmentId}`}
          >
            {isPhysio ? 'Write clinical notes' : 'Back to appointment'}
          </Button>
          {!isPhysio && (
            <Button href="/book" variant="secondary">
              Book a follow-up
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * Apply ICE candidates that arrived before the remote description was ready.
 *
 * Defined outside the component on purpose: it depends only on its arguments, so it
 * is not recreated on every render and cannot accidentally close over stale state.
 *
 * A rejected candidate is logged and skipped rather than thrown. ICE deliberately
 * offers many possible network paths and most of them fail — that is how it works,
 * not a sign anything is wrong.
 */
async function applyCandidates(pc, candidates) {
  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (error) {
      console.warn('[webrtc] queued candidate rejected:', error.message)
    }
  }
}
