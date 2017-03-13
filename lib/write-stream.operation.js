const {
    prettyNs
  , safeGetVal
  , safeFirstStamp
  , uniqueUserFunctions
  , separateUserFunctions
  , mergeUserFunctions
} = require('ah-processor.utils')

class WriteStreamOperation {
  /**
   * Processes a group of async activities that represent a fs write stream operation.
   * It is used by the [writeStreamProcessor](#writestreamprocessor) as part of `process`.
   *
   * Four operation steps are derived from the group, each providing some information
   * about the operation in question.
   *
   * Each step is processed into an operation in the corresponding private method, i.e. `_processOpen`.
   * These methods are documented below for information's sake, they should not be called directly,
   * nor should you have a need to directly instantiate a `writeStreamOperation` in the first place.
   *
   * @name WriteStreamOperation
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
    this._writes = []
    for (let i = 0; i < group.length; i++) {
      const info = group[i]
      if (info.isopen) {
        this._processOpen(info)
      } else if (info.istick) {
        this._processTick(info)
      } else if (info.iswrite) {
        this._processWrite(info)
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
   *  2. the last frame of the init stack tells us where `createWriteStream` was called.
   *
   * @name writeStreamOperation._processOpen
   * @function
   * @param {Object} info information about the open step, pre-processed by the `WriteStreamProcessor`.
   */
  _processOpen(info) {
    this._created = prettyNs(info.activity.init[0])

    // Sample init stack:
    // "at Object.fs.open (fs.js:581:11)",
    // "at WriteStream.open (fs.js:1893:6)",
    // "at new WriteStream (fs.js:1879:10)",
    // "at Object.fs.createWriteStream (fs.js:1841:10)",
    // "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js:29:26)"
    const initStack = info.activity.initStack
    if (initStack == null || initStack.length < 5) return
    this._createdAt = info.activity.initStack[4]
    this._open = { id: info.activity.id, triggerId: info.activity.triggerId }
    if (this._includeActivities) this._open.activity = info.activity
  }

   /**
    * The WriteStream Tick gives us a lot of information. It is the same tick object that we process
    * in the ReadStreamOperation to glean data about the read stream.
    * It has an args array with the ReadStream and its ReadableState respectively.
    *
    * The ReadableState included the WritableState which the [ah-fs](https://github.com/nodesource/ah-fs) pre-processor
    * already plucked for us and added as the 3rd argument.
    * Additionally it includes lots of functions including user functions registered with the
    * WriteStream, i.e. `on('finish')`.
    *
    * Ergo the WriteStream provides us the following as part of the WritableState:
    *
    * 1. the path to the file we are writing into
    * 2. the flags with which the file was opened
    * 3. the fd (assuming we are dealing with the tick triggered indirectly by the open)
    *
    * All callbacks on the _events of the ReadStream and WriteStream have been removed, but are present
    * inside the functions object (see below).
    *
    * The information extracted from the tick is attached to a `stream` property
    * provided with the `summary`.
    *
    * @name writeStreamOperation._processTick
    * @function
    * @param {Object} info information about the tick step, pre-processed by the `WriteStreamProcessor`.
    */
  _processTick(info) {
    const { id, triggerId } = info.activity

    // only need one tick to pull the info from
    if (this._processedTick) return

    const args = info.activity.resource && info.activity.resource.args
    if (args == null || args.length < 3) return

    const writableState = args[2]
    const path = safeGetVal(writableState.path)
    const flags = safeGetVal(writableState.flags)
    const fd = writableState.fd
    const mode = writableState.mode

    const functions = info.activity.resource.functions
    const userFunctions = uniqueUserFunctions(functions, { pathPrefix: 'stream.resource' })
    this._stream = {
        id
      , triggerId
      , path
      , flags
      , fd
      , mode
      , userFunctions
    }
    if (this._includeActivities) this._stream.activity = info.activity

    this._processedTick = true
  }

  /**
   * The write resource doesn't give us too much information.
   *
   * The stack traces originate in core and we don't see any registred
   * user callbacks, as those are present on the stream instead.
   * However we can count the amount of writes that occurred and deduce how
   * long each write took from the `before` and `after` timestamps.
   *
   * @name writeStreamOperation._processwrite
   * @function
   * @param {Object} info information about the write step, pre-processed by the `WriteStreamProcessor`.
   */
  _processWrite(info) {
    const activity = info.activity
    if (activity == null) return

    const before = safeFirstStamp(activity.before)
    const after = safeFirstStamp(activity.after)
    const timeSpent = before && after ? prettyNs(after.ns - before.ns) : prettyNs(0)

    const write = { id: activity.id, triggerId: activity.triggerId, timeSpent }
    if (this._includeActivities) write.activity = activity
    this._writes.push(write)
  }

  /**
   * The main information we pull from the close resource is the `destroy` timestamp.
   *
   * Combined with the `init` timestamp of the open resource it allows us to deduce how long
   * the write stream was active.
   *
   * @name writeStreamOperation._processClose
   * @function
   * @param {Object} info information about the close step, pre-processed by the `WriteStreamProcessor`.
   */
  _processClose(info) {
    const activity = info.activity
    if (activity == null) return
    this._destroyed = safeFirstStamp(activity.destroy)
    this._close = { id: activity.id, triggerId: activity.triggerId }
    if (this._includeActivities) this._close.activity = activity
  }

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
      , writes    : this._writes
      , close     : this._close
    }

    if (!separateFunctions) return info
    const separated = separateUserFunctions(info)

    if (!mergeFunctions) return separated
    return mergeUserFunctions(separated)
  }
}

module.exports = WriteStreamOperation
