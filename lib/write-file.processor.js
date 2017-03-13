const { idsTriggeredBy } = require('ah-processor.utils')
const WriteFileOperation = require('./write-file.operation')

const FSReqWrap = 'FSREQWRAP'

/**
 * Sample initStack of writeFile open, calles as first operation of `fs.writeFile`.
 * In order to be sure this is a writeFile open we need to check the two topmost frames.
 *
 * "at Object.fs.open (fs.js:581:11)",
 * "at Object.fs.writeFile (fs.js:1155:6)",
 * "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/write-one-file.js:28:6)",
 *
 * Code at fs.js:581:
 *
 * `binding.open(pathModule._makeLong(path), ...`
 *
 * Code at fs.js:1155:
 *
 * `fs.open(path, flag, options.mode, function(openErr, fd) ...`
 *
 * Bottom frame has info about where the call `fs.writeFile` originated.
 */
const openInitFrame0Rx = /at Object\.fs\.open/i
const openInitFrame1Rx = /at Object\.fs\.writeFile/i

/**
 * Sample init stack of writeFile write, called afer `fs.open` completes:
 *
 * "at Object.fs.write (fs.js:643:20)",
 * "at writeAll (fs.js:1117:6)",
 * "at writeFd (fs.js:1168:5)",
 * "at fs.js:1159:7",
 * "at FSReqWrap.oncomplete (fs.js:117:15)"
 *
 * Code at fs.js:643:
 *
 * `binding.writeBuffer(fd, buffer, offset, length, position, req);`
 *
 */
const writeInitFrame0Rx = /at Object\.fs\.write/i

/**
 * Sample initStack of writeFile close, called after last `fs.write` completes:
 *
 * "at Object.fs.close (fs.js:555:11)",
 * "at fs.js:1131:14",
 * "at FSReqWrap.wrapper [as oncomplete] (fs.js:626:5)"
 *
 * Code at fs.js:555:
 *
 * `binding.close(fd, req);`
 */

const closeInitFrame0Rx = /at Object\.fs\.close/i

class WriteFileProcessor {
  /**
   * Instantiates an fs.writeFile data processor to process data collected via
   * [nodesource/ah-fs](https://github.com/nodesource/ah-fs)
   *
   * @name WriteFileProcessor
   * @constructor
   * @param {Object} $0
   * @param {Map.<string, Object>} {$0.activities} a map of async activities hashed by id
   * @param {boolean} [includeActivities=false] if `true` the actual activities are appended to the output
   *
   * @return {Map.<number, Object} map of fs.writeFile activities hashed by the
   * file open id, for more info @see writeFile.process()
   */
  constructor({ activities, includeActivities = false }) {
    this._activities = activities
    this._includeActivities = includeActivities
    this._clear()
  }

  /**
   * Processes the supplied async activities and splits them into
   * groups, and operations each representing a file read stream `fs.createWriteFile`.
   *
   * ## Groups
   *
   * The returned value has a `groups` property which just lists the ids
   * of async resources that were grouped together to form an operation
   * indexed by the id of the `fs.open` activity that was part of the `fs.writeFile`.
   * Thus the `groups` is a map of sets.
   * If no file write file was encountered the groups are empty.
   *
   * ## Operations
   *
   * Additionally an `operations` property is included as well. Each operation
   * represents one full `fs.writeFile` execution. There will be one operation per
   * group and they are indexed by the corresponding open id as well.
   *
   * An `operation` has the following properties:
   *
   * ### `fs.createWriteFile` specific Operation Properties
   *
   *  Data about the async resources that were part of the operation, by default
   *  only `id` and `triggerId` are included:
   *  - **open**: contains data about opening the file
   *  - **writes**: an Array of writes, each containing data about writing a
   *  chunk from the file including the time spent to complete writing the
   *  particular chunk
   *  - **close**: contains data about closing the file
   *
   * ### General Operation Properties
   *
   * - [see ReadFileProcessor.process](https://nodesource.github.io/ah-fs.processor/#general-operation-properties)
   *
   * ## Sample Return Value
   *
   * The sample return value was created with default options.
   *
   * ```js
   *
   * { groups: Map { 10 => Set { 10, 11, 12 } },
   *   operations:
   *   Map {
   *     10 => { lifeCycle:
   *       { created: { ms: '24.49ms', ns: 24491000 },
   *         destroyed: { ms: '33.96ms', ns: 33964000 },
   *         timeAlive: { ms: '9.47ms', ns: 9473000 } },
   *     createdAt: 'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/write-one-file.js:28:6)',
   *     open: { id: 10, triggerId: 1 },
   *     write: { id: 11, triggerId: 10 },
   *     close: { id: 12, triggerId: 11 } } } }
   * ```
   *
   * @name writeFileProcessor.process
   * @return {Object} information about `fs.createWriteFile` operations with the
   * structure outlined above
   */
  process() {
    this._clear()

    // First we bucket all activities into open, write and close
    this._findWriteFileOpenIds()
    this._findWriteFileWriteIds()
    this._findWriteFileCloseIds()

    // Then we group them by triggerId and add the operations
    this._separateIntoGroups()
    this._addOperations()

    return {
        groups: this._groups
      , operations: this._operations
    }
  }

  _clear() {
    this._writeFileOpenIds = new Set()
    this._writeFileWriteIds = new Set()
    this._writeFileCloseIds = new Set()
    this._groups = new Map()
    this._operations = new Map()
  }

  _findWriteFileOpenIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 2) continue
      if (!openInitFrame0Rx.test(a.initStack[0])) continue
      if (!openInitFrame1Rx.test(a.initStack[1])) continue
      this._writeFileOpenIds.add(a.id)
    }
  }

  _findWriteFileWriteIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 1) continue
      if (!writeInitFrame0Rx.test(a.initStack[0])) continue
      this._writeFileWriteIds.add(a.id)
    }
  }

  _findWriteFileCloseIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 1) continue
      if (!closeInitFrame0Rx.test(a.initStack[0])) continue
      this._writeFileCloseIds.add(a.id)
    }
  }

  _separateIntoGroups(id) {
    const stop = id => this._writeFileCloseIds.has(id)

    for (const openId of this._writeFileOpenIds) {
      const group = idsTriggeredBy(this._activities, openId, stop)
      this._groups.set(openId, group)
    }
  }

  _addOperations() {
    for (const [ id, group ] of this._groups) this._addOperation(id, group)
  }

  _addOperation(id, group) {
    const info = this._resolveGroup(group)
    const op = new WriteFileOperation({
        group: info
      , includeActivities: this._includeActivities
    })
    this._operations.set(id, op.summary())
  }

  _resolveGroup(group) {
    const groupInfo = []
    for (const id of group) {
      const activity = this._activities.get(id)
      const isopen = this._writeFileOpenIds.has(id)
      const iswrite = this._writeFileWriteIds.has(id)
      const isclose = this._writeFileCloseIds.has(id)
      const info = { activity, isopen, iswrite, isclose }
      groupInfo.push(info)
    }
    return groupInfo
  }
}

module.exports = WriteFileProcessor
