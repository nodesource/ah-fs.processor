const test = require('tape')
// eslint-disable-next-line no-unused-vars
const ocat = require('./utils/ocat')
const spok = require('spok')

const activities = new Map(require('./fixtures/five-files.read-file.json'))
const { ReadFileProcessor } = require('../')

const userFunctions = [
  { file: '/Volumes/d/dev/js/async-hooks/ah-demos/demos/tcp-fs/server'
  , line: 51
  , column: 21
  , inferredName: ''
  , name: 'onreadFile'
  , location: 'onreadFile (/Volumes/d/dev/js/async-hooks/ah-demos/demos/tcp-fs/server:51:21)'
  , args: null
  , propertyPaths:
    [ 'open.resource.context.callback'
    , 'stat.resource.context.callback'
    , 'read.resource.context.callback'
    , 'close.resource.context.callback' ] } ]

test('\nactivities with five file reads', function(t) {
  const includeActivities = false
  const separateFunctions = true
  const { groups, operations } =
    new ReadFileProcessor({ activities, includeActivities, separateFunctions }).process()

  t.equal(groups.size, 5, 'finds 5 read file groups')
  const OPENID1 = 5
  const OPENID2 = 14
  const OPENID3 = 21
  const OPENID4 = 28
  const OPENID5 = 35

  spok(t, Array.from(groups.keys()), [ OPENID1, OPENID2, OPENID3, OPENID4, OPENID5 ])

  const op1 = operations.get(OPENID1)
  const op2 = operations.get(OPENID2)
  const op3 = operations.get(OPENID3)
  const op4 = operations.get(OPENID4)
  const op5 = operations.get(OPENID5)
  spok(t, op1,
    { $topic: 'operation 1'
    , lifeCycle:
      { created: { ms: '208.48ms', ns: 208481000 }
      , destroyed: { ms: '227.51ms', ns: 227514000 }
      , timeAlive: { ms: '19.03ms', ns: 19033000 } }
    , createdAt: 'at Server.onconnection (/Volumes/d/dev/js/async-hooks/ah-demos/demos/tcp-fs/server:50:6)'
    , open: { id: 5, triggerId: 2 }
    , stat: { id: 6, triggerId: 5 }
    , read: { id: 7, triggerId: 6 }
    , close: { id: 8, triggerId: 7 }
    , userFunctions
  })
  spok(t, op2,
    { $topic: 'operation 2'
    , lifeCycle:
      { created: { ms: '320.06ms', ns: 320064000 }
      , destroyed: { ms: '335.44ms', ns: 335437000 }
      , timeAlive: { ms: '15.37ms', ns: 15373000 } }
    , createdAt: 'at Server.onconnection (/Volumes/d/dev/js/async-hooks/ah-demos/demos/tcp-fs/server:50:6)'
    , open: { id: 14, triggerId: 2 }
    , stat: { id: 15, triggerId: 14 }
    , read: { id: 16, triggerId: 15 }
    , close: { id: 17, triggerId: 16 }
    , userFunctions
  })
  spok(t, op3,
    { $topic: 'operation 3'
    , lifeCycle:
      { created: { ms: '424.17ms', ns: 424167000 }
      , destroyed: { ms: '428.56ms', ns: 428556000 }
      , timeAlive: { ms: '4.39ms', ns: 4389000 } }
    , createdAt: 'at Server.onconnection (/Volumes/d/dev/js/async-hooks/ah-demos/demos/tcp-fs/server:50:6)'
    , open: { id: 21, triggerId: 2 }
    , stat: { id: 22, triggerId: 21 }
    , read: { id: 23, triggerId: 22 }
    , close: { id: 24, triggerId: 23 }
    , userFunctions
  })
  spok(t, op4,
    { $topic: 'operation 4'
    , lifeCycle:
      { created: { ms: '517.06ms', ns: 517058000 }
      , destroyed: { ms: '523.55ms', ns: 523552000 }
      , timeAlive: { ms: '6.49ms', ns: 6494000 } }
    , createdAt: 'at Server.onconnection (/Volumes/d/dev/js/async-hooks/ah-demos/demos/tcp-fs/server:50:6)'
    , open: { id: 28, triggerId: 2 }
    , stat: { id: 29, triggerId: 28 }
    , read: { id: 30, triggerId: 29 }
    , close: { id: 31, triggerId: 30 }
    , userFunctions
  })
  spok(t, op5,
    { $topic: 'operation 5'
    , lifeCycle:
      { created: { ms: '619.89ms', ns: 619886000 }
      , destroyed: { ms: '625.96ms', ns: 625957000 }
      , timeAlive: { ms: '6.07ms', ns: 6071000 } }
    , createdAt: 'at Server.onconnection (/Volumes/d/dev/js/async-hooks/ah-demos/demos/tcp-fs/server:50:6)'
    , open: { id: 35, triggerId: 2 }
    , stat: { id: 36, triggerId: 35 }
    , read: { id: 37, triggerId: 36 }
    , close: { id: 38, triggerId: 37 }
    , userFunctions
  })

  t.end()
})
