const test = require('tape')

const { ReadFileProcessor } = require('../')

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/open.stat.close-only.json'))

test('\nactivities with one file open, stat, close, but no read', function(t) {
  const includeActivities = true
  const { groups, operations } = new ReadFileProcessor({ activities, includeActivities }).process()
  t.equal(groups.size, 0, 'read file processor finds no fs.readFile group')
  t.equal(operations.size, 0, 'read file processor finds no fs.readFile operation')
  t.end()
})
