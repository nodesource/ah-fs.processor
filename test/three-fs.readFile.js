const test = require('tape')
// eslint-disable-next-line no-unused-vars
const ocat = require('./utils/ocat')
const spok = require('spok')

const { ReadFileProcessor } = require('../')
const OPENID = 17

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/three-files.read-file.json'))

test('\nactivities with tree file reads, not including activities, separate functions', function(t) {
  const includeActivities = false
  const separateFunctions = true
  const { groups, operations } =
    new ReadFileProcessor({ activities, includeActivities, separateFunctions }).process()
  inspect(operations)
  t.end()
})
