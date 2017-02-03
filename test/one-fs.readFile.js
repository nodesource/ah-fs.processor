const test = require('tape')
// eslint-disable-next-line no-unused-vars
const ocat = require('./utils/ocat')
const spok = require('spok')

const FsReadFileAnalyzer = require('../')

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/one-file.json'))

test('\nactivities with one file read, including activities .. checking included activities', function(t) {
  const includeActivities = true
  const groups = new FsReadFileAnalyzer({ activities, includeActivities }).analyze()
  t.equal(groups.size, 1, 'finds one group')

  const fd = groups.keys().next().value
  t.ok(spok.gtz(fd), 'grouped by valid file descriptor')

  const group = groups.get(fd)
  const open = group.execution.open
  spok(t, open, {
      $topic: 'execution.open'
    , action: 'open file'
    , id: spok.gtz
    , activity: activities.get(open.id)
  })
  const stat = group.execution.stat
  spok(t, stat, {
      $topic: 'execution.stat'
    , action: 'stat file'
    , id: spok.gtz
    , activity: activities.get(stat.id)
  })
  const read = group.execution.read
  spok(t, read, {
      $topic: 'execution.read'
    , action: 'read file'
    , id: spok.gtz
    , activity: activities.get(read.id)
  })
  const close = group.execution.close
  spok(t, close, {
      $topic: 'execution.close'
    , action: 'close file'
    , id: spok.gtz
    , activity: activities.get(close.id)
  })
  t.end()
})

test('\nactivities with one file read, not including activities .. checking time stamps, calledBy and callback', function(t) {
  const includeActivities = false
  const groups = new FsReadFileAnalyzer({ activities, includeActivities }).analyze()
  t.equal(groups.size, 1, 'finds one group')

  const fd = groups.keys().next().value
  t.ok(spok.gtz(fd), 'grouped by valid file descriptor')

  const group = groups.get(fd)
  const open = group.execution.open
  spok(t, open, {
      $topic: 'execution.open'
    , action: 'open file'
    , id: spok.gtz
  })
  t.ok(spok.gt(open.initialized.ns)(open.destroyed.ns), 'open: initialized before destroyed')

  const stat = group.execution.stat
  spok(t, stat, {
      $topic: 'execution.stat'
    , action: 'stat file'
    , id: spok.gtz
  })
  t.ok(spok.gt(stat.triggered.ns)(stat.initialized.ns), 'stat: triggered before initialized')
  t.ok(spok.gt(stat.initialized.ns)(stat.completed.ns), 'stat: initialized before completed')
  t.ok(spok.gt(stat.completed.ns)(stat.destroyed.ns), 'stat: completed before destroyed')

  const read = group.execution.read
  spok(t, read, {
      $topic: 'execution.read'
    , action: 'read file'
    , id: spok.gtz
  })
  t.ok(spok.gt(read.triggered.ns)(read.initialized.ns), 'read: triggered before initialized')
  t.ok(spok.gt(read.initialized.ns)(read.completed.ns), 'read: initialized before completed')
  t.ok(spok.gt(read.completed.ns)(read.destroyed.ns), 'read: completed before destroyed')

  const close = group.execution.close
  spok(t, close, {
      $topic: 'execution.close'
    , action: 'close file'
    , id: spok.gtz
  })
  t.ok(spok.gt(close.triggered.ns)(close.initialized.ns), 'close: triggered before initialized')
  t.ok(spok.gt(close.initialized.ns)(close.completed.ns), 'close: initialized before completed')
  t.ok(spok.gt(close.completed.ns)(close.destroyed.ns), 'close: completed before destroyed')

  t.ok(typeof open.activity === 'undefined', 'open: does not include actual activity')
  t.ok(typeof stat.activity === 'undefined', 'stat: does not include actual activity')
  t.ok(typeof read.activity === 'undefined', 'read: does not include actual activity')
  t.ok(typeof close.activity === 'undefined', 'close: does not include actual activity')

  t.equal(group.calledBy
    , 'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:49:6)'
    , 'included correct calledBy information'
  )

  spok(t, group.callback,
    { $topic: 'callback'
    , name: 'onread'
    , location: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:51:17' })

  const args = group.callback.arguments
  t.equal(args.err, null, 'arguments: includes null err')

  spok(t, args.src,
    { $topic: 'arguments.src'
    , len: 5237
    , included: 18 }
  )

  spok(t, args.src.val,
      { $topic: 'args.src.val'
      , utf8: 'const test = requi'
      , hex: '636f6e73742074657374203d207265717569' }
  )
  t.end()
})

