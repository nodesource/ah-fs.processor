const test = require('tape')

const FsReadFileAnalyzer = require('../')

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./fixtures/open.stat.close-only.json'))

test('\nactivities with one file open, stat, close, but no read', function(t) {
  const includeActivities = true
  const groups = new FsReadFileAnalyzer({ activities, includeActivities }).analyze()
  t.equal(groups.size, 0, 'finds no fs.readFile group')
  t.end()
})
