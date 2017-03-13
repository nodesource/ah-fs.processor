const ReadFileProcessor = require('./lib/read-file.processor')
const ReadStreamProcessor = require('./lib/read-stream.processor')
const WriteFileProcessor = require('./lib/write-file.processor')
const WriteStreamProcessor = require('./lib/write-stream.processor')

function byOperationStepsDescending(a, b) {
  return a.operationSteps > b.operationSteps ? -1 : 1
}

function processActivities({ activities, includeActivities = false }) {
  const processors = [
      ReadFileProcessor
    , ReadStreamProcessor
    , WriteFileProcessor
    , WriteStreamProcessor
  ].sort(byOperationStepsDescending)

  // TODO: we need to remove the ids returned inside the group in order to
  // not process them twice.
  // However {Read|Write}StreamProcessor share a stream tick, thus we need to
  // add logic to only remove those once both of these processors ran.

  const allOperations = []
  for (let i = 0; i < processors.length; i++) {
    const Processor = processors[i]
    const processor = new Processor({ activities, includeActivities })
    const { operations } = processor.process()
    for (const [ rootId, operation ] of operations) {
      allOperations.push({
          name: Processor.operation
        , steps: Processor.operationSteps
        , rootId
        , operation
      })
    }
  }
  return allOperations
}

module.exports = {
    ReadFileProcessor
  , ReadStreamProcessor
  , WriteFileProcessor
  , WriteStreamProcessor
  , processActivities
}
