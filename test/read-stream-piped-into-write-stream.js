const test = require('tape')
// eslint-disable-next-line no-unused-vars
const ocat = require('./utils/ocat')
const spok = require('spok')

const { WriteStreamProcessor } = require('../')
const OPENID = 10

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/read-stream-piped-into-write-stream-fs-only.json'))

test('\nactivities for one active read stream piped into one write stream, not including activities, separating user functions', function(t) {
  const includeActivities = false
  const separateFunctions = true
  const { groups, operations } =
    new WriteStreamProcessor({ activities, includeActivities, separateFunctions }).process()

  const groupMembers = [ 14, 10, 16, 19 ]
  groupMembers.$topic = 'group members'
  spok(t, Array.from(groups.get(OPENID)), groupMembers)

  t.equal(operations.size, 1, 'finds one read stream operation')
  const op = operations.get(OPENID)
  spok(t, op.lifeCycle,
      { $topic: 'lifeCycle'
      , created: { ms: '1.12ms', ns: 1123000 }
      , destroyed: { ms: '18.20ms', ns: 18205000 }
      , timeAlive: { ms: '17.08ms', ns: 17082000 } }
  )

  spok(t, op.open, { $topic: 'operation.open', id: 10, triggerId: 3 })
  spok(t, op.close, { $topic: 'operation.close', id: 19, triggerId: 15 })
  t.equal(typeof op.open.activity, 'undefined', 'does not include activity for open')
  t.equal(typeof op.close.activity, 'undefined', 'does not include activity for close')

  t.equal(op.writes.length, 1, 'finds one write')
  const write = op.writes[0]
  spok(t, write,
    { $topic: 'operation.writes[0]'
    , id: 14
    , triggerId: 13
    , timeSpent: { ms: '0.14ms', ns: 139000 } }
  )
  t.equal(typeof write.activity, 'undefined', 'does not include activity for write')

  spok(t, op.stream,
    { $topic: 'operation.stream'
    , id: 16
    , triggerId: 13
    , path: '/dev/null'
    , flags: 'w'
    , fd: 19
    , mode: 438 }
  )
  t.equal(typeof op.stream.activity, 'undefined', 'does not include activity for stream')

  t.equal(op.userFunctions.length, 1
    , 'pulls out one unique user function attached to the stream and separately attaches it'
  )
  spok(t, op.userFunctions[0],
    { $topic: 'user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js'
    , line: 32
    , column: 19
    , inferredName: ''
    , name: 'onfinish'
    , location: 'onfinish (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js:32:19)'
    , args: null
    , propertyPaths: [ 'stream.resource.args[1].pipes._events.finish[1]' ]
  })

  t.end()
})

test('\nactivities for one active read stream piped into one write stream, including activities', function(t) {
  const includeActivities = true
  const { operations } =
    new WriteStreamProcessor({ activities, includeActivities }).process()
  const op = operations.get(OPENID)
  const write = op.writes[0]

  t.equal(typeof op.open.activity, 'object', 'does include activity for open')
  t.equal(typeof op.close.activity, 'object', 'does include activity for close')
  t.equal(typeof write.activity, 'object', 'does include activity for write')
  t.equal(typeof op.stream.activity, 'object', 'does include activity for stream')

  t.end()
})

test('\nactivities for one active read stream piped into one write stream, including activities, not separating user functions', function(t) {
  const includeActivities = false
  const separateFunctions = false
  const { operations } =
    new WriteStreamProcessor({ activities, includeActivities, separateFunctions }).process()
  const op = operations.get(OPENID)

  t.equal(op.stream.userFunctions.length, 1
    , 'pulls out one unique user function attached to the stream'
  )
  spok(t, op.stream.userFunctions[0],
    { $topic: 'stream user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js'
    , line: 32
    , column: 19
    , inferredName: ''
    , name: 'onfinish'
    , location: 'onfinish (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js:32:19)'
    , args: null
    , propertyPath: 'stream.resource.args[1].pipes._events.finish[1]'
  })
  t.end()
})
