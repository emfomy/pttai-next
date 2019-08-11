const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '.env') })

const hyperdrive = require('hyperdrive')
const storage = require('./storage/dat')
const Discovery = require('hyperdiscovery')
const bodyParser = require('body-parser')
const cors = require('cors')
const pino = require('express-pino-logger')()
const View = require('./lib/views/hub')
const fs = require('fs')
const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET

async function main () {
  let view = new View()
  let users = []

  let discovery = null

  await loadExistingArchives()

  var app = require('express')()
  var http = require('http').Server(app)
  var io = require('socket.io')(http)
  app.use(bodyParser.json())
  app.use(pino)
  app.use(cors())

  app.post('/join', async (req, res) => {
    if (!req.query.token) {
      res.status(403)
      return res.json({ error: 'invalid token' })
    }

    let { id } = jwt.verify(req.query.token, JWT_SECRET)
    if (!id) {
      res.status(403)
      return res.json({ error: 'invalid token' })
    }

    if (!users.find(x => x === req.body.public_key)) {
      users.push(req.body.public_key)
      loadArchive(req.body.public_key)
    }
    console.log('users', users)
    res.json({ result: 'ok' })
  })

  app.get('/hub.json', (req, res) => {
    res.json({ moderators: [] })
  })

  let ns = io

  if (process.env.HUB_SOCKET_IO_NAMESPACE) {
    ns = io.of(process.env.HUB_SOCKET_IO_NAMESPACE)
  }

  if (JWT_SECRET) {
    ns.use(function (socket, next) {
      if (!socket.handshake.query.token) {
        return next(new Error('invalid token'))
      }
      let { id } = jwt.verify(socket.handshake.query.token, JWT_SECRET)
      if (!id) {
        return next(new Error('invalid token'))
      }

      socket.archiveID = id
      next()
    })
  }

  ns.on('connection', (socket) => {
    console.log('connected')
    console.log(Object.keys(io.nsps))
    socket.emit('update', view.messages)
    socket.emit('profiles', view.profiles)
  })

  view.on('update', (msgs) => {
    ns.emit('update', msgs)
  })

  view.on('profiles', (profiles) => {
    ns.emit('profiles', profiles)
  })

  let port = process.argv[2] || 3003

  http.listen(port, () => { console.log(`listening ${port}`) })

  function loadArchive (k1) {
    console.log('reading user', k1)
    let d1 = hyperdrive(storage(`hub/storage/${k1}`), Buffer.from(k1, 'hex'), { latest: true })
    d1.on('error', console.error)
    // const net = require('net')

    d1.on('ready', () => {
      if (!discovery) {
        console.log('initing discovery', d1.key.toString('hex'))
        // let socket = net.connect(port)
        // socket.pipe(d1.replicate({ live: true })).pipe(socket)
        discovery = Discovery(d1, { live: true })
      } else {
        console.log('joining discovery', d1.key.toString('hex'))
        discovery.add(d1)
      }
    })

    // d1.metadata.on('download', (idx, data) => console.log('download', idx, data))

    d1.on('sync', () => { console.log('sync') })
    d1.on('update', () => {
      console.log('update')
      console.log(d1.metadata.listenerCount('append'))
      view.apply(d1)
    })
    d1.on('content', () => {
      console.log('content')
      view.apply(d1)
    })
  }

  async function loadExistingArchives () {
    console.log('loading existing archives')
    try {
      let keys = fs.readdirSync(path.resolve('./hub/storage'))
      console.log(keys)
      for (let i = 0; i < keys.length; i++) {
        let k = keys[i]
        await loadArchive(k)
      }
      console.log('loaded')
    } catch (e) {
      // TODO: ignore for now
      console.error(e)
    }
  }
}

main()
