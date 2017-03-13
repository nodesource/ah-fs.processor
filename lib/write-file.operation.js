const {
    prettyNs
  , safeFirstStamp
} = require('ah-processor.utils')

class WriteFileOperation {
  /**
   * Processes a group of async activities that represent a fs write file operation.
   * It is used by the [WriteFileProcessor](#WriteFileProcessor) as part of `process`.
   *
   * Three operation steps are derived from the group, each providing some information
   * about the operation in question.
   *
   * Each step is processed into an operation in the corresponding private method, i.e. `_processOpen`.
   * These methods are documented below for information's sake, they should not be called directly,
   * nor should you have a need to directly instantiate a `WriteFileOperation` in the first place.
   *
   * @name WriteFileOperation
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
      } else if (info.iswrite) {
        this._processWrite(info)
      } else if (info.isclose) {
        this._processClose(info)
      }
    }
  }

  /**
   * The open resource tells us where in user code the `fs.writeFile` originated
   * via the second frame of the stack trace, as well as when the operation
   * was created.
   *
   * @name writeFileOperation._processOpen
   * @function
   * @param {Object} info information about the open step, pre-processed by the `WriteFileProcessor`.
   */
  _processOpen(info) {
    this._created = safeFirstStamp(info.activity.init)

    // at Object.fs.open (fs.js:581:11)
    // at Object.fs.writeFile (fs.js:1155:6)
    // at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/write-one-file.js:28:6)

    const initStack = info.activity.initStack
    if (initStack == null || initStack.length < 3) return
    this._createdAt = info.activity.initStack[2]
    this._open = {
        id: info.activity.id
      , triggerId: info.activity.triggerId
    }
    if (this._includeActivities) this._open.activity = info.activity
  }

  /**
   * The write resource gives us no interesting information.
   * Therefore we just capture the `id`, `triggerId` and if so desired
   * attach the activities.
   *
   * @name writeFileOperation._processWrite
   * @function
   * @param {Object} info information about the write step, pre-processed by the `WriteFileProcessor`.
   */
  _processWrite(info) {
    const activity = info.activity
    if (activity == null) return

    this._write = {
        id: activity.id
      , triggerId: activity.triggerId
    }

    if (this._includeActivities) this._write.activity = activity
  }

  /**
   * The main information we pull from the close resource is the `destroy` timestamp.
   *
   * Combined with the `init` timestamp of the open resource it allows us to deduce how long
   * the file write took.
   *
   * @name writeFileOperation._processClose
   * @function
   * @param {Object} info information about the close step, pre-processed by the `WriteFileProcessor`.
   */
  _processClose(info) {
    const activity = info.activity
    if (activity == null) return
    this._destroyed = safeFirstStamp(activity.destroy)
    this._close = {
        id: activity.id
      , triggerId: activity.triggerId
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
   * the `WriteFileProcessor`.
   * Therefore learn more [here](#general-operation-properties).
   *
   * ## Properties Specific to `fs.writeFile`
   *
   * - **open**: see `writeFileOperation._processOpen`
   * - **write**: see `writeFileOperation._processWrite`
   * - **close**: see `writeFileOperation._processClose`
   *
   * Note this summary function takes no parameters (like the other Operations) since
   * we don't find any user functions related to the write file operation and thus
   * have nothing to process.
   *
   * @name writeFileOperation.summary
   * @function
   * @return {Object} all important information about the current operation
   */
  summary() {
    const info = {
        lifeCycle: {
            created   : this._created
          , destroyed : this._destroyed
          , timeAlive : prettyNs(this._destroyed.ns - this._created.ns)
        }
      , createdAt : this._createdAt
      , open      : this._open
      , write     : this._write
      , close     : this._close
    }
    return info
  }
}

module.exports = WriteFileOperation
