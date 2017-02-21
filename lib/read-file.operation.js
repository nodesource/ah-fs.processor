const {
    prettyNs
  , safeFirstStamp
  , uniqueUserFunctions
  , separateUserFunctions
  , mergeUserFunctions
} = require('./utils')

class ReadFileOperation {
  /**
   * Processes a group of async activities that represent a fs read stream operation.
   * It is used by the [ReadFileProcessor](#readfileprocessor) as part of `process`.
   *
   * Four operation steps are derived from the group, each providing some information
   * about the operation in question.
   *
   * Each step is processed into an operation in the corresponding private method, i.e. `_processOpen`.
   * These methods are documented below for information's sake, they should not be called directly,
   * nor should you have a need to directly instantiate a `ReadFileOperation` in the first place.
   *
   * @name ReadFileOperation
   * @constructor
   * @param {Map.<Number, Set.<Number>>} group the ids of the activities that were part of the operation
   * @param {Boolean} [includeActivities = false] if `true` the activities are attached to
   * each operation step
   */
  constructor({ group, includeActivities }) {
    this._includeActivities = includeActivities
    this._process(group)
  }

  _process(group) {
    for (let i = 0; i < group.length; i++) {
      const info = group[i]
      if (info.isopen) {
        this._processOpen(info)
      } else if (info.isstat) {
        this._processStat(info)
      } else if (info.isread) {
        this._processRead(info)
      } else if (info.isclose) {
        this._processClose(info)
      }
    }
  }

  // All resources have a reference to the same function, the callback registered with
  // the readFile operation.
  // To be consistent we include that same information for all of them, however note
  // that the most information (including arguments) is available with the version of the
  // callback that is captured for the `close` resource.
  // Users can obtain a merged version of these functions when invoking the `summary` method
  // with `{ separateFunctions: true, mergeFunctions: true }`, which is the default.
  _userFunctions(activity, resourceType) {
    const functions = activity.resource.functions
    return uniqueUserFunctions(functions, { pathPrefix: `${resourceType}.resource` })
  }

  /**
   * The open resource tells us where in user code the `fs.readFile` originated
   * via the second frame of the stack trace, as well as when the operation
   * was created.
   *
   * Additionally it has the same user functions attached as all the other resources.
   *
   * @name readFileOperation._processOpen
   * @function
   * @param {Object} info information about the open step, pre-processed by the `ReadFileProcessor`.
   */
  _processOpen(info) {
    this._created = safeFirstStamp(info.activity.init)

    // Sample init stack:
    // "at Object.fs.readFile (fs.js:295:11)",
    // "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:49:6)",

    const initStack = info.activity.initStack
    if (initStack == null || initStack.length < 2) return
    this._createdAt = info.activity.initStack[1]
    this._open = {
        id: info.activity.id
      , triggerId: info.activity.triggerId
      , userFunctions: this._userFunctions(info.activity, 'open')
    }
    if (this._includeActivities) this._open.activity = info.activity
  }

  /**
   * The stat resource gives us no interesting information.
   * Therefore we just capture the `id`, `triggerId` and `userFunctions` and if so desired
   * attach the activities.
   *
   * @name readFileOperation._processStat
   * @function
   * @param {Object} info information about the open step, pre-processed by the `ReadFileProcessor`.
   */
  _processStat(info) {
    const activity = info.activity
    if (activity == null) return

    this._stat = {
        id: activity.id
      , triggerId: activity.triggerId
      , userFunctions: this._userFunctions(info.activity, 'stat')
    }

    if (this._includeActivities) this._stat.activity = activity
  }

  /**
   * The read resource gives us no interesting information.
   * Therefore we just capture the `id`, `triggerId` and `userFunctions` and if so desired
   * attach the activities.
   *
   * @name readFileOperation._processRead
   * @function
   * @param {Object} info information about the read step, pre-processed by the `ReadFileProcessor`.
   */
  _processRead(info) {
    const activity = info.activity
    if (activity == null) return

    this._read = {
        id: activity.id
      , triggerId: activity.triggerId
      , userFunctions: this._userFunctions(info.activity, 'read')
    }

    if (this._includeActivities) this._read.activity = activity
  }

  /**
   * The main information we pull from the close resource is the `destroy` timestamp.
   *
   * Combined with the `init` timestamp of the open resource it allows us to deduce how long
   * the file read took.
   *
   * @name readFileOperation._processClose
   * @function
   * @param {Object} info information about the close step, pre-processed by the `ReadFileProcessor`.
   */
  _processClose(info) {
    const activity = info.activity
    if (activity == null) return
    this._destroyed = safeFirstStamp(activity.destroy)
    this._close = {
        id: activity.id
      , triggerId: activity.triggerId
      , userFunctions: this._userFunctions(info.activity, 'close')
    }

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
   * ## Properties Specific to `fs.readFile`
   *
   * - **open**: see `readFileOperation._processOpen`
   * - **stat**: see `readFileOperation._processStat`
   * - **read**: see `readFileOperation._processRead`
   * - **close**: see `readFileOperation._processClose`
   *
   * @name readFileOperation.summary
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
      , stat      : this._stat
      , read      : this._read
      , close     : this._close
    }

    if (!separateFunctions) return info
    const separated =  separateUserFunctions(info)

    if (!mergeFunctions) return separated
    return mergeUserFunctions(separated)
  }
}

module.exports = ReadFileOperation
