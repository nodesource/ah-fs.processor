const {
    prettyNs
  , safeGetVal
  , safeFirstStamp
  , uniqueUserFunctions
  , separateUserFunctions
  , mergeUserFunctions
} = require('./utils')

class ReadStreamOperation {
  /**
   * Processes a group of async activities that represent a fs read stream operation.
   * It is used by the [ReadStreamProcessor](#readstreamprocessor) as part of `process`.
   *
   * Four operation steps are derived from the group, each providing some information
   * about the operation in question.
   *
   * Each step is processed into an operation in the corresponding private method, i.e. `_processOpen`.
   * These methods are documented below for information's sake, they should not be called directly,
   * nor should you have a need to directly instantiate a `ReadStreamOperation` in the first place.
   *
   * @name ReadStreamOperation
   * @constructor
   * @param {Map.<Number, Set.<Number>>} group the ids of the activities that were part of the operation
   * @param {Boolean} [includeActivities = false] if `true` the activities are attached to
   * each operation step
   */
  constructor({ group, includeActivities = false }) {
    this._includeActivities = includeActivities
    this._process(group)
  }

  _process(group) {
    this._reads = []
    for (let i = 0; i < group.length; i++) {
      const info = group[i]
      if (info.isopen) {
        this._processOpen(info)
      } else if (info.istick) {
        this._processTick(info)
      } else if (info.isread) {
        this._processRead(info)
      } else if (info.isclose) {
        this._processClose(info)
      }
    }
  }

  /**
   *  An open doesn't have too much info, but we can glean two very important
   *  data points:
   *
   *  1. the init timestamp tells us when the stream was created
   *  2. the last frame of the init stack tells us where `createReadStream` was called.
   *
   * @name readStreamOperation._processOpen
   * @function
   * @param {Object} info information about the open step, pre-processed by the `ReadStreamProcessor`.
   */
  _processOpen(info) {
    this._created = prettyNs(info.activity.init[0])

    // Sample init stack:
    // "at Object.fs.open (fs.js:581:11)",
    // "at ReadStream.open (fs.js:1730:6)",
    // "at new ReadStream (fs.js:1717:10)",
    // "at Object.fs.createReadStream (fs.js:1667:10)",
    // "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:94:6)"
    const initStack = info.activity.initStack
    if (initStack == null || initStack.length < 5) return
    this._createdAt = info.activity.initStack[4]
    this._open = { id: info.activity.id, triggerId: info.activity.triggerId }
    if (this._includeActivities) this._open.activity = info.activity
  }

   /**
    * The ReadStream Tick gives us a lot of information. It has an args array with
    * the ReadStream and its ReadableState respectively
    *
    * The ReadStream provides us the following:
    *
    * 1. the path to the file we are streaming
    * 2. the flags with which the file was opened
    * 3. the fd (assuming we are dealing with the tick triggered indirectly by the open)
    *
    * All callbacks on the _events of the ReadStream have been removed, but are present
    * inside the functions object (see below).
    *
    * The ReadableState provides us the following:
    *
    * 1. objectMode `true|false`
    * 2. highWaterMark
    * 3. pipesCount
    * 4. defaultEncoding, i.e. utf8
    * 5. encoding, i.e. utf8
    *
    * The information extracted from the tick is attached to a `stream` property
    * provided with the `summary`.
    *
    * @name readStreamOperation._processTick
    * @function
    * @param {Object} info information about the tick step, pre-processed by the `ReadStreamProcessor`.
    */
  _processTick(info) {
    const { id, triggerId } = info.activity

    // only need one tick to pull the info from
    if (this._processedTick) return

    const args = info.activity.resource && info.activity.resource.args
    if (args == null || args.length < 2) return

    const stream = args[0]
    const path = safeGetVal(stream.path)
    const flags = safeGetVal(stream.flags)
    const fd = stream.fd

    const state = args[1]
    const objectMode = state.objectMode
    const highWaterMark = state.highWaterMark
    const pipesCount = state.pipesCount
    const defaultEncoding = safeGetVal(state.defaultEncoding)
    const encoding = safeGetVal(state.encoding)

    const functions = info.activity.resource.functions
    const userFunctions = uniqueUserFunctions(functions, { pathPrefix: 'stream.resource' })
    this._stream = {
        id
      , triggerId
      , path
      , flags
      , fd
      , objectMode
      , highWaterMark
      , pipesCount
      , defaultEncoding
      , encoding
      , userFunctions
    }
    if (this._includeActivities) this._stream.activity = info.activity

    this._processedTick = true
  }

  /**
   * The read resource doesn't give us too much information.
   *
   * The stack traces originate in core and we don't see any registred
   * user callbacks, as those are present on the stream instead.
   * However we can count the amount of reads that occurred and deduce how
   * long each read took from the `before` and `after` timestamps.
   *
   * @name readStreamOperation._processRead
   * @function
   * @param {Object} info information about the read step, pre-processed by the `ReadStreamProcessor`.
   */
  _processRead(info) {
    const activity = info.activity
    if (activity == null) return

    const before = safeFirstStamp(activity.before)
    const after = safeFirstStamp(activity.after)
    const timeSpent = before && after ? prettyNs(after.ns - before.ns) : prettyNs(0)

    const read = { id: activity.id, triggerId: activity.triggerId, timeSpent }
    if (this._includeActivities) read.activity = activity
    this._reads.push(read)
  }

  /**
   * The main information we pull from the close resource is the `destroy` timestamp.
   *
   * Combined with the `init` timestamp of the open resource it allows us to deduce how long
   * the read stream was active.
   *
   * @name readStreamOperation._processClose
   * @function
   * @param {Object} info information about the close step, pre-processed by the `ReadStreamProcessor`.
   */
  _processClose(info) {
    const activity = info.activity
    if (activity == null) return
    this._destroyed = safeFirstStamp(activity.destroy)
    this._close = { id: activity.id, triggerId: activity.triggerId }
    if (this._includeActivities) this._close.activity = activity
  }

  /**
   * Returns the summary of processing the group into an operation.
   *
   * The summary of all operations has a very similar structure, but includes some properties that are specific to this
   * particular operation.
   *
   * The general properties `lifeCycle` and `createdAt` are documented as part of
   * the `ReadFileProcessor`.
   * Therefore learn more [here](#general-operation-properties).
   *
   * ## Properties Specific to `fs.createReadStream`
   *
   * - **open**: see `readStreamOperation._processOpen`
   * - **stream**: see `readStreamOperation._processTick`
   * - **read**: see `readStreamOperation._processRead`
   * - **close**: see `readStreamOperation._processClose`
   *
   * @name readStreamOperation.summary
   * @function
   * @param {Object} $0 options
   * @param {Boolean} [$0.separateFunctions = true] when `true` the user functions are separated out
   * from the specific operations and attached as a `userFunctions` array directly to the returned
   * result
   *
   * @param {Boolean} [$0.mergeFunctions = true] if `true` when a duplicate function is found in the
   * separated functions Array, they are merged into one while preserving all information
   * from both version. Note that this setting only activates if `separateFunctions` is `true` as well.
   *
   * @return {Object} all important information about the current operation
   */
  summary({ separateFunctions = true, mergeFunctions = true } = {}) {
    const info = {
        lifeCycle: {
            created   : this._created
          , destroyed : this._destroyed
          , timeAlive : prettyNs(this._destroyed.ns - this._created.ns)
        }
      , createdAt : this._createdAt
      , open      : this._open
      , stream    : this._stream
      , reads     : this._reads
      , close     : this._close
    }

    if (!separateFunctions) return info
    const separated =  separateUserFunctions(info)

    if (!mergeFunctions) return separated
    return mergeUserFunctions(separated)
  }
}

module.exports = ReadStreamOperation
