/**
 * ============================================================================
 *  THE SERVER — Next.js plus the WebRTC signalling channel
 * ============================================================================
 *
 *  Normally you would run `next dev` and never think about a server file. We need
 *  one because Socket.IO requires a long-lived HTTP server it can attach to, and
 *  Next.js does not expose the one it creates internally.
 *
 *  So this file creates the HTTP server itself, hands most requests to Next, and
 *  lets Socket.IO handle the WebSocket upgrade on its own path.
 *
 *      npm run dev    → node server.js with NODE_ENV unset (hot reloading)
 *      npm run build  → next build
 *      npm start      → node server.js with NODE_ENV=production
 *
 *  ---------------------------------------------------------------------------
 *  WHAT "SIGNALLING" MEANS, AND WHY VIDEO NEEDS IT
 *  ---------------------------------------------------------------------------
 *  WebRTC sends audio and video DIRECTLY between the two browsers — the video
 *  never touches this server. That is why 1-to-1 calls cost nothing to run and
 *  have low latency.
 *
 *  But two browsers on opposite sides of the internet cannot find each other
 *  unaided. Before a direct connection exists they must swap:
 *
 *    1. An OFFER      "here are the codecs I support and how to reach me"  (SDP)
 *    2. An ANSWER     "here is what I support and how to reach me"         (SDP)
 *    3. ICE CANDIDATES every network path each side might be reachable on
 *
 *  Something has to carry those three messages while there is no connection yet.
 *  That something is this server, and that job is called signalling. It relays a
 *  handful of small JSON messages, then gets out of the way completely.
 *
 *  A useful mental image: signalling is the receptionist who tells two people
 *  which room to meet in. Once they are in the room talking, the receptionist is
 *  not part of the conversation.
 *
 *  ---------------------------------------------------------------------------
 *  WHY SOCKET.IO RATHER THAN A PLAIN WebSocket
 *  ---------------------------------------------------------------------------
 *  Rooms, automatic reconnection with backoff, and a fallback to HTTP long-polling
 *  on networks that block WebSockets. On Indian mobile networks and hospital or
 *  corporate Wi-Fi that fallback genuinely matters — without it a share of
 *  patients simply cannot connect at all.
 * ============================================================================
 */

const { createServer } = require('node:http')
const path = require('node:path')
const next = require('next')
const { Server } = require('socket.io')
const { verifyVideoToken } = require('./lib/videoToken')

const dev = process.env.NODE_ENV !== 'production'
const port = Number(process.env.PORT || 3000)
const hostname = process.env.HOSTNAME || 'localhost'

// Next reads .env.local itself, but this file's own code (the AUTH_SECRET used to
// verify tokens) runs before that happens, so load it here too.
try {
  process.loadEnvFile(path.join(__dirname, '.env.local'))
} catch {
  // No .env.local — defaults and any real environment variables still apply.
}

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('[server] request failed:', error)
      res.statusCode = 500
      res.end('Internal server error')
    })
  })

  /* ======================================================================== */
  /*  SOCKET.IO                                                               */
  /* ======================================================================== */

  const io = new Server(httpServer, {
    // A dedicated path so it can never collide with a Next.js route.
    path: '/api/socket',
    // Try WebSocket first, fall back to long-polling. Do not remove 'polling':
    // it is what makes the call work on restrictive networks.
    transports: ['websocket', 'polling'],
    // Same origin only. In production the browser and the server share a domain,
    // so nothing else needs to connect.
    cors: { origin: dev ? true : false },
    // If no heartbeat arrives for 20 seconds, treat the peer as gone. Tuned so a
    // patient walking between rooms is not dropped, but a closed laptop is
    // noticed reasonably quickly.
    pingTimeout: 20000,
    pingInterval: 10000,
  })

  /**
   * ------------------------------------------------------------------------
   *  AUTHENTICATION
   * ------------------------------------------------------------------------
   *  Middleware runs once per connection, before any event is handled. Reject
   *  here and the client never joins anything.
   *
   *  The token was minted by the consultation page, which had already confirmed
   *  through the database that this user is a participant in this appointment.
   *  See lib/videoToken.js for the reasoning.
   */
  io.use((socket, nextMiddleware) => {
    const claims = verifyVideoToken(socket.handshake.auth?.token)

    if (!claims) {
      return nextMiddleware(new Error('UNAUTHORISED'))
    }

    // Attach the verified identity to the socket. From here on we trust `socket.data`
    // and never anything the client sends about who it claims to be — a client
    // that could name itself could impersonate the physiotherapist.
    socket.data.roomId = claims.roomId
    socket.data.userId = claims.userId
    socket.data.name = claims.name
    socket.data.role = claims.role
    socket.data.appointmentId = claims.appointmentId

    nextMiddleware()
  })

  io.on('connection', (socket) => {
    const { roomId, userId, name, role } = socket.data

    /* ------------------------------------------------------ join the room */
    // A consultation is strictly one-to-one, so a third connection is refused.
    // Without this check, a leaked token could be used to add a silent observer
    // to a private medical appointment.
    const room = io.sockets.adapter.rooms.get(roomId)
    const occupants = room ? room.size : 0

    if (occupants >= 2) {
      socket.emit('room-full')
      socket.disconnect(true)
      return
    }

    socket.join(roomId)
    console.log(`[socket] ${name} (${role}) joined ${roomId} — ${occupants + 1} in room`)

    /**
     * Tell the joiner what it found.
     *
     * `shouldInitiate` decides which side creates the WebRTC offer. Exactly one
     * side must — if both do, you get two competing connections and a mess the
     * spec calls signalling glare. The simple, reliable rule: whoever arrives
     * SECOND makes the offer, because it knows for certain that someone is
     * already there to answer it.
     */
    const peers = []
    for (const socketId of io.sockets.adapter.rooms.get(roomId) || []) {
      if (socketId === socket.id) continue
      const peer = io.sockets.sockets.get(socketId)
      if (peer) peers.push({ socketId, name: peer.data.name, role: peer.data.role })
    }

    socket.emit('joined', {
      self: { socketId: socket.id, name, role },
      peers,
      shouldInitiate: peers.length > 0,
    })

    // Let whoever was already waiting know that the other person has arrived.
    socket.to(roomId).emit('peer-joined', { socketId: socket.id, name, role })

    /* ------------------------------------------------- relay the signalling */
    /**
     * The heart of it — and notice how little it does.
     *
     * The server never looks inside `data`. Offers, answers and ICE candidates are
     * opaque to it; it simply passes the envelope to the other person in the room.
     * That is what makes this signalling rather than media handling, and it is why
     * a single small server can host any number of concurrent calls: the video
     * itself never passes through here.
     */
    socket.on('signal', ({ to, data }) => {
      // Only ever relay within the sender's own room. Without this check a client
      // could pass any socket id and inject signalling into someone else's call.
      if (!io.sockets.adapter.rooms.get(roomId)?.has(to)) return
      io.to(to).emit('signal', { from: socket.id, data })
    })

    /* ------------------------------------------------------ mute indicators */
    // Purely cosmetic — it drives the little crossed-out microphone on the other
    // person's tile. Worth having: "can you hear me?" is the most common minute
    // wasted in any video consultation.
    socket.on('media-state', (state) => {
      socket.to(roomId).emit('peer-media-state', {
        socketId: socket.id,
        audio: Boolean(state?.audio),
        video: Boolean(state?.video),
      })
    })

    /* ------------------------------------------------------------ text chat */
    // Genuinely useful in a physiotherapy consultation: the physio can type an
    // exercise name or a website link that would be hard to spell out loud, and a
    // patient with a poor connection can still communicate.
    socket.on('chat', (message) => {
      const text = String(message?.text || '').slice(0, 1000)
      if (!text.trim()) return
      // Echoed to the whole room, including the sender, so both transcripts are
      // identical and ordered the same way.
      io.to(roomId).emit('chat', {
        from: socket.id,
        name,
        role,
        text,
        // The server stamps the time. A clock skewed by ten minutes on one
        // participant's laptop would otherwise scramble the message order.
        at: new Date().toISOString(),
      })
    })

    /* ------------------------------------------------------- leaving nicely */
    socket.on('leave', () => {
      socket.to(roomId).emit('peer-left', { socketId: socket.id, reason: 'left' })
      socket.disconnect(true)
    })

    socket.on('disconnect', (reason) => {
      // Fires on a closed tab, a dead battery, or a lost network — as well as a
      // deliberate hang-up. The other side needs to know either way, or it sits
      // staring at a frozen frame.
      socket.to(roomId).emit('peer-left', { socketId: socket.id, reason })
      console.log(`[socket] ${name} left ${roomId} (${reason})`)
    })
  })

  /* ======================================================================== */
  /*  LISTEN                                                                  */
  /* ======================================================================== */

  httpServer.listen(port, async () => {
    // config/platform.js is an ES module and this file has to be CommonJS — a
    // Next custom server is loaded by node directly, before any bundling. A
    // dynamic import bridges the two, which is worth the small awkwardness: the
    // company name then lives in exactly one place in the whole codebase.
    const { platform } = await import('./config/platform.js')

    console.log(`\n  ▲ ${platform.name} ready on http://${hostname}:${port}`)
    console.log(`    Video signalling on ws://${hostname}:${port}/api/socket`)
    console.log(`    Mode: ${dev ? 'development' : 'production'}\n`)
  })

  /**
   * Shut down cleanly on Ctrl-C or a container stop signal.
   *
   * Without this, in-flight requests are killed mid-response and, more visibly,
   * anyone in a consultation gets no "peer left" message — their screen simply
   * freezes. Closing Socket.IO first lets those disconnect events fire.
   */
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\n  Received ${signal}, shutting down…`)
      io.close(() => {
        httpServer.close(() => process.exit(0))
      })
      // A hard backstop, in case a socket refuses to close.
      setTimeout(() => process.exit(0), 5000)
    })
  }
})
