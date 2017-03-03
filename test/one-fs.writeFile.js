const test = require('tape')
// eslint-disable-next-line no-unused-vars
const ocat = require('./utils/ocat')
const spok = require('spok')

const { WriteFileProcessor } = require('../')
const OPENID = 10

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/one-file.write-file.json'))

test('\nactivities for one active write file, not including activities', function(t) {
  const includeActivities = false
  const { groups, operations } =
    new WriteFileProcessor({ activities, includeActivities }).process()

  t.equal(groups.size, 1, 'finds one read stream group')
  const groupMembers = [ 10, 11, 12 ]
  groupMembers.$topic = 'group members'
  spok(t, Array.from(groups.get(OPENID)), groupMembers)

  t.equal(operations.size, 1, 'finds one write file operation')
  const op = operations.get(OPENID)
  spok(t, op,
    { $topic: 'operation'
    , lifeCycle: {
        created: { ms: '24.49ms', ns: 24491000 }
      , destroyed: { ms: '33.96ms', ns: 33964000 }
      , timeAlive: { ms: '9.47ms', ns: 9473000 } }
    , createdAt: 'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/write-one-file.js:28:6)'
    , open: { id: 10, triggerId: 1 }
    , write: { id: 11, triggerId: 10 }
    , close: { id: 12, triggerId: 11 } }
  )

  t.equal(typeof op.open.activity, 'undefined', 'does not include activity for open')
  t.equal(typeof op.write.activity, 'undefined', 'does not include activity for write')
  t.equal(typeof op.close.activity, 'undefined', 'does not include activity for close')

  t.end()
})

test('\nactivities for one active write file, including activities', function(t) {
  const includeActivities = true
  const { operations } =
    new WriteFileProcessor({ activities, includeActivities }).process()
  const op = operations.get(OPENID)

  t.equal(typeof op.open.activity, 'object', 'does include activity for open')
  t.equal(typeof op.write.activity, 'object', 'does include activity for write')
  t.equal(typeof op.close.activity, 'object', 'does include activity for close')

  t.end()
})
