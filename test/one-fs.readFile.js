const test = require('tape')
// eslint-disable-next-line no-unused-vars
const ocat = require('./utils/ocat')
const spok = require('spok')

const { ReadFileProcessor } = require('../')
const OPENID = 10

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/one-file.read-file.json'))

test('\nactivities with one file read, not including activities, separate functions', function(t) {
  const includeActivities = false
  const separateFunctions = true
  const { groups, operations } =
    new ReadFileProcessor({ activities, includeActivities, separateFunctions }).process()
  t.equal(groups.size, 1, 'finds one read file group')
  const groupMembers = [ 10, 11, 12, 13 ]
  groupMembers.$topic = 'group members'
  spok(t, Array.from(groups.get(OPENID)), groupMembers)

  t.equal(operations.size, 1, 'finds one read file operation')
  const op = operations.get(OPENID)

  // life cycle
  spok(t, op.lifeCycle.created, {
      $topic: 'operation.liveCycle.created'
    , ms: '44.12ms'
    , ns: 44119000
  })
  spok(t, op.lifeCycle.destroyed, {
      $topic: 'operation.liveCycle.destroyed'
    , ms: '85.95ms'
    , ns: 85955000
  })
  spok(t, op.lifeCycle.timeAlive, {
      $topic: 'operation.liveCycle.timeAlive'
    , ms: '41.84ms'
    , ns: 41836000
  })
  t.equal(op.createdAt,
      'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:36:6)'
    , 'includes location in user code where file was created at'
  )

  // ids + triggerIds .. each activity triggers the next
  spok(t, op.open, { $topic: 'operation.open', id: 10, triggerId: 1 })
  spok(t, op.stat, { $topic: 'operation.stat', id: 11, triggerId: 10 })
  spok(t, op.read, { $topic: 'operation.read', id: 12, triggerId: 11 })
  spok(t, op.close, { $topic: 'operation.close', id: 13, triggerId: 12 })
  // no activities or user functions attached
  t.equal(typeof op.open.activity, 'undefined', 'does not include activity for open')
  t.equal(typeof op.stat.activity, 'undefined', 'does not include activity for stat')
  t.equal(typeof op.read.activity, 'undefined', 'does not include activity for read')
  t.equal(typeof op.close.activity, 'undefined', 'does not include activity for close')

  t.equal(typeof op.open.userFunctions, 'undefined', 'does not include userFunctions for open')
  t.equal(typeof op.stat.userFunctions, 'undefined', 'does not include userFunctions for stat')
  t.equal(typeof op.read.userFunctions, 'undefined', 'does not include userFunctions for read')
  t.equal(typeof op.close.userFunctions, 'undefined', 'does not include userFunctions for close')

  // user functions
  t.equal(op.userFunctions.length, 1
    , 'pulls out one unique user function and separately attaches it'
  )
  spok(t, op.userFunctions[0], {
      $topic: 'user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js'
    , line: 39
    , column: 17
    , inferredName: ''
    , name: 'onread'
    , location: 'onread (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:39:17)'
    , propertyPaths:
      [ 'open.resource.context.callback'
      , 'stat.resource.context.callback'
      , 'read.resource.context.callback'
      , 'close.resource.context.callback' ]
    , args:
      { '0': null
      , '1':
        { type: 'Buffer'
        , len: 6108
        , included: 18
        , val:
            { utf8: 'const test = requi'
            , hex: '636f6e73742074657374203d207265717569' } }
      , proto: 'Object' }
  })

  t.end()
})

test('\nactivities with one file read, including activities', function(t) {
  const includeActivities = true
  const { operations } = new ReadFileProcessor({ activities, includeActivities }).process()
  const op = operations.get(OPENID)
  t.equal(typeof op.open.activity, 'object', 'does include activity for open')
  t.equal(typeof op.stat.activity, 'object', 'does include activity for stat')
  t.equal(typeof op.read.activity, 'object', 'does include activity for read')
  t.equal(typeof op.close.activity, 'object', 'does include activity for close')
  t.end()
})

test('\nactivities for one active read file, not including activities, not separating user functions', function(t) {
  const includeActivities = false
  const separateFunctions = false
  const { operations } =
    new ReadFileProcessor({ activities, includeActivities, separateFunctions }).process()

  const op = operations.get(OPENID)
  t.equal(op.open.userFunctions.length, 1
    , 'pulls out one unique user function attached to the open'
  )
  spok(t, op.open.userFunctions[0],
    { $topic: 'open user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js'
    , line: 39
    , column: 17
    , inferredName: ''
    , name: 'onread'
    , location: 'onread (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:39:17)'
    , propertyPath: 'open.resource.context.callback'
    , args: null }
  )
  spok(t, op.stat.userFunctions[0],
    { $topic: 'stat user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js'
    , line: 39
    , column: 17
    , inferredName: ''
    , name: 'onread'
    , location: 'onread (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:39:17)'
    , propertyPath: 'stat.resource.context.callback'
    , args: null }
  )
  spok(t, op.read.userFunctions[0],
    { $topic: 'read user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js'
    , line: 39
    , column: 17
    , inferredName: ''
    , name: 'onread'
    , location: 'onread (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:39:17)'
    , propertyPath: 'read.resource.context.callback'
    , args: null }
  )
  spok(t, op.close.userFunctions[0],
    { $topic: 'close user function'
    , file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js'
    , line: 39
    , column: 17
    , inferredName: ''
    , name: 'onread'
    , location: 'onread (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:39:17)'
    , propertyPath: 'close.resource.context.callback'
    , args:
      { '0': null
      , '1':
        { type: 'Buffer'
        , len: 6108
        , included: 18
        , val:
            { utf8: 'const test = requi'
            , hex: '636f6e73742074657374203d207265717569' } }
      , proto: 'Object' } }
  )
  t.end()
})
