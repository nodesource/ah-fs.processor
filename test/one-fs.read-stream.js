const test = require('tape')
// eslint-disable-next-line no-unused-vars
const ocat = require('./utils/ocat')
const spok = require('spok')

const { ReadStreamProcessor } = require('../')
const OPENID = 10

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/one-file.read-stream.json'))

test('\nactivities for one active read stream, not including activities, separating user functions', function(t) {
  const includeActivities = false
  const separateFunctions = true
  const { groups, operations } =
    new ReadStreamProcessor({ activities, includeActivities, separateFunctions }).process()

  t.equal(groups.size, 1, 'finds one read stream group')
  const groupMembers = [ 10, 12, 13, 14, 16 ]
  groupMembers.$topic = 'group members'
  spok(t, Array.from(groups.get(OPENID)), groupMembers)

  t.equal(operations.size, 1, 'finds one read stream operation')
  const op = operations.get(OPENID)
  spok(t, op.lifeCycle.created, {
      $topic: 'operation.liveCycle.created'
    , ms: '1.60ms'
    , ns: 1600000
  })
  spok(t, op.lifeCycle.destroyed, {
      $topic: 'operation.liveCycle.destroyed'
    , ms: '14.33ms'
    , ns: 14329000
  })
  spok(t, op.lifeCycle.timeAlive, {
      $topic: 'operation.liveCycle.timeAlive'
    , ms: '12.73ms'
    , ns: 12729000
  })
  t.equal(op.createdAt,
      'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:94:6)'
    , 'includes location in user code where stream was created at'
  )
  // open, close
  spok(t, op.open, { $topic: 'operation.open', id: 10, triggerId: 3 })
  spok(t, op.close, { $topic: 'operation.close', id: 16, triggerId: 13 })
  t.equal(typeof op.open.activity, 'undefined', 'does not include activity for open')
  t.equal(typeof op.close.activity, 'undefined', 'does not include activity for close')

  // reads
  t.equal(op.reads.length, 2, 'finds two reads')

  const read1 = op.reads[0]
  const read2 = op.reads[1]
  spok(t, read1, {
      $topic: 'operation.reads[0]'
    , id: 12
    , triggerId: OPENID
  })
  spok(t, read2, {
      $topic: 'operation.reads[1]'
    , id: 13
    , triggerId: read1.id
  })
  spok(t, read1.timeSpent,
    { $topic: 'first read timeSpent', ms: '0.83ms', ns: 830000 }
  )
  spok(t, read2.timeSpent,
    { $topic: 'second read timeSpent', ms: '0.24ms', ns: 240000 }
  )
  t.equal(typeof read1.activity, 'undefined', 'does not include activity for first read')
  t.equal(typeof read2.activity, 'undefined', 'does not include activity for second read')

  // stream
  spok(t, op.stream, {
      $topic: 'operations.stream'
    , id: 14
    , triggerId: read1.id
    , path: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js'
    , flags: 'r'
    , fd: 19
    , objectMode: false
    , highWaterMark: 65536
    , pipesCount: 0
    , defaultEncoding: 'utf8'
    , encoding: null
    , userFunctions: spok.notDefined
  })
  t.equal(typeof op.stream.activity, 'undefined', 'does not include activity for stream')

  t.equal(op.userFunctions.length, 2
    , 'pulls out two unique user functions attached to the stream and separately attaches them'
  )
  spok(t, op.userFunctions[0],
    { $topic: 'first user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js'
    , line: 99
    , column: 16
    , inferredName: ''
    , name: 'onend'
    , location: 'onend (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:99:16)'
    , propertyPath: spok.notDefined
    , propertyPaths:  [ 'stream.resource.args[0]._events.end[1]' ]
  })
  spok(t, op.userFunctions[1],
    { $topic: 'second user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js'
    , line: 98
    , column: 17
    , inferredName: ''
    , name: 'ondata'
    , location: 'ondata (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:98:17)'
    , propertyPath: spok.notDefined
    , propertyPaths: [ 'stream.resource.args[0]._events.data' ]
  })

  t.end()
})

test('\nactivities for one active read stream, including activities', function(t) {
  const includeActivities = true
  const { operations } =
    new ReadStreamProcessor({ activities, includeActivities }).process()
  const op = operations.get(OPENID)
  const read1 = op.reads[0]
  const read2 = op.reads[1]

  t.equal(typeof op.open.activity, 'object', 'does include activity for open')
  t.equal(typeof op.close.activity, 'object', 'does include activity for close')
  t.equal(typeof read1.activity, 'object', 'does include activity for read1')
  t.equal(typeof read2.activity, 'object', 'does include activity for read2')
  t.equal(typeof op.stream.activity, 'object', 'does include activity for stream')

  t.end()
})

test('\nactivities for one active read stream, not including activities, not separating user functions', function(t) {
  const includeActivities = false
  const separateFunctions = false
  const { operations } =
    new ReadStreamProcessor({ activities, includeActivities, separateFunctions }).process()

  const op = operations.get(OPENID)
  t.equal(op.stream.userFunctions.length, 2
    , 'pulls out two unique user functions attached to the stream'
  )
  spok(t, op.stream.userFunctions[0],
    { $topic: 'first stream user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js'
    , line: 99
    , column: 16
    , inferredName: ''
    , name: 'onend'
    , location: 'onend (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:99:16)'
    , propertyPath: 'stream.resource.args[0]._events.end[1]'
  })
  spok(t, op.stream.userFunctions[1],
    { $topic: 'second stream user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js'
    , line: 98
    , column: 17
    , inferredName: ''
    , name: 'ondata'
    , location: 'ondata (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:98:17)'
    , propertyPath: 'stream.resource.args[0]._events.data'
  })
  t.end()
})
