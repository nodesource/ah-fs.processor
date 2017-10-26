const { processActivities } = require('ah-processor.utils')
const ReadFileProcessor = require('./lib/read-file.processor')
const ReadStreamProcessor = require('./lib/read-stream.processor')
const WriteFileProcessor = require('./lib/write-file.processor')
const WriteStreamProcessor = require('./lib/write-stream.processor')

// TODO: we need to remove the ids returned inside the group in order to
// not process them twice.
// However {Read|Write}StreamProcessor share a stream tick, thus we need to
// add logic to only remove those once both of these processors ran.
// This could be via some flag and a callback that's passed to processActivities

/**
 * @name processFileSystem
 * @param {Object} $0
 * @param {Map.<string, Object>} $0.activities a map of async activities hashed by id
 * @param {boolean} [$0.includeActivities=false] if `true` the actual activities are appended to the output
 *
 * @return {Map.<number, Object} map of fs.readFile activities hashed by the fs resource id
 */
function processFileSystem({ activities, includeActivities = false }) {
  const processors = [
      ReadFileProcessor
    , ReadStreamProcessor
    , WriteFileProcessor
    , WriteStreamProcessor
  ]
  return processActivities({ activities, processors, includeActivities })
}

module.exports = {
    ReadFileProcessor
  , ReadStreamProcessor
  , WriteFileProcessor
  , WriteStreamProcessor
  , processFileSystem
}
