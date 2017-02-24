const { oldestId, immediatelyBeforeId } = require('./utils')
const WriteStreamOperation = require('./write-stream.operation')
const FSReqWrap = 'FSREQWRAP'
const TickObject = 'TickObject'
const askGrama = require('grama')

/*
 * Sample initStack of writeStream open:
 *
 * "at Object.fs.open (fs.js:581:11)",
 * "at WriteStream.open (fs.js:1893:6)",
 * "at new WriteStream (fs.js:1879:10)",
 * "at Object.fs.createWriteStream (fs.js:1841:10)",
 * "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js:29:26)"
 *
 * Bottom frame has the info about where we created the write stream.
 */
const openInitFrame0Rx = /Object\.fs\.open/i
const openInitFrame1Rx = /WriteStream\.open/i

/*
 * Sample initStack of writeStream write:
 *
 *  "at Object.fs.write (fs.js:643:20)",
 *  "at WriteStream._write (fs.js:1919:6)",
 *  "at doWrite (_stream_writable.js:326:12)",
 *  "at writeOrBuffer (_stream_writable.js:312:5)",
 *  "at WriteStream.Writable.write (_stream_writable.js:236:11)"
 */
const writeInitFrame0Rx = /Object\.fs\.write/i
const writeInitFrame1Rx = /WriteStream\._write/i

/* Sample initStack of writeStream close:
 *
 * "at Object.fs.close (fs.js:555:11)",
 * "at close (fs.js:1829:8)",
 * "at WriteStream.ReadStream.close (fs.js:1825:3)",
 * "at WriteStream.<anonymous> (fs.js:1884:12)",
 * "at Object.onceWrapper (events.js:291:19)"
 */
const closeInitFrame0Rx = /Object\.fs\.close/i
const closeInitFrame2Rx = /WriteStream\.ReadStream\.close/i

class WriteStreamProcessor {
  /**
   * Instantiates an fs.createWriteStream data processor to process data collected via
   * [nodesource/ah-fs](https://github.com/nodesource/ah-fs)
   *
   * @name WriteStreamProcessor
   * @constructor
   * @param {Object} $0
   * @param {Map.<string, Object>} {$0.activities} a map of async activities hashed by id
   * @param {boolean} [$0.includeActivities=false] if `true` the actual activities are appended to the output
   *
   * @param {Boolean} [$0.separateFunctions = true] when `true` the user functions are separated out
   * from the specific resources and attached as a `userFunctions` array directly to the returned
   * operations
   */
  constructor({ activities, includeActivities = false, separateFunctions = true }) {
    this._activities = activities
    this._includeActivities = includeActivities
    this._separateFunctions = separateFunctions
    this._clear()
  }

  /**
   * Processes the supplied async activities and splits them into
   * groups, and operations each representing a file write stream `fs.createWriteStream`.
   *
   * ## Groups
   *
   * The returned value has a `groups` property which just lists the ids
   * of async resources that were grouped together to form an operation
   * indexed by the `fd` on which the writeFile operated.
   * Thus the `groups` is a map of sets.
   * If no file write stream was encountered the groups are empty.
   *
   * ## Operations
   *
   * Additionally an `operations` property is included as well. Each operation
   * represents one full `fs.createWriteStream` execution. There will be one operation per
   * group and they are indexed by the corresponding `fd` as well.
   *
   * An `operation` has the following properties:
   *
   * ### `fs.createWriteStream` specific Operation Properties
   *
   *  Data about the async resources that were part of the operation, by default
   *  only `id` and `triggerId` are included:
   *  - **open**: contains data about opening the file
   *  - **stream**: contains data about how the stream was configured, including writeable state and
   *    the path to the file being write, pipes count, encoding, etc.
   *  - **writes**: an Array of writes, each containing data about writing a chunk from the file including
   *    the time spent to complete writeing the particular chunk
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
   * { groups: Map { 10 => Set { 14, 10, 16, 19 } },
   *   operations:
   *   Map {
   *     10 => { lifeCycle:
   *       { created: { ms: '1.12ms', ns: 1123000 },
   *         destroyed: { ms: '18.20ms', ns: 18205000 },
   *         timeAlive: { ms: '17.08ms', ns: 17082000 } },
   *     createdAt: 'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js:29:26)',
   *     open: { id: 10, triggerId: 3 },
   *     stream:
   *       { id: 16,
   *         triggerId: 13,
   *         path: '/dev/null',
   *         flags: 'w',
   *         fd: 19,
   *         mode: 438 },
   *     writes:
   *       [ { id: 14,
   *           triggerId: 13,
   *           timeSpent: { ms: '0.14ms', ns: 139000 } } ],
   *     close: { id: 19, triggerId: 15 },
   *     userFunctions:
   *       [ { file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js',
   *           line: 32,
   *           column: 19,
   *           inferredName: '',
   *           name: 'onfinish',
   *           location: 'onfinish (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-stream-piped-into-write-stream.js:32:19)',
   *           args: null,
   *           propertyPaths: [ 'stream.resource.args[1].pipes._events.finish[1]' ] } ] } } }
   * ```
   *
   * @name writeStreamProcessor.process
   * @return {Object} information about `fs.createWriteStream` operations with the
   * structure outlined above
   */
  process() {
    this._clear()

    // First find all ids of activities that represent a write stream open
    this._findWriteStreamOpenIds()

    // Now we look for the actual writes which are triggered by the stream ticks.
    this._findWriteStreamWriteIds()

    // Find any tick ids that represent a ReadStream that also has information
    // about our WriteStream attached (as part of it's pipes).
    this._findWriteStreamTickIds()

    // Finally we find the write stream close events
    this._findWriteStreamCloseIds()

    this._separateIntoGroups()
    this._addOperations()

    return {
        groups: this._groups
      , operations: this._operations
    }
  }

  _clear() {
    this._writeStreamOpenIds = new Set()
    this._writeStreamTickIds = new Set()
    this._writeStreamWriteIds = new Set()
    this._writeStreamCloseIds = new Set()
    this._groups = new Map()
    this._operations = new Map()
  }

  _findWriteStreamOpenIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 2) continue
      if (!openInitFrame0Rx.test(a.initStack[0])) continue
      if (!openInitFrame1Rx.test(a.initStack[1])) continue
      this._writeStreamOpenIds.add(a.id)
    }
  }

  _findWriteStreamTickIds() {
    for (const a of this._activities.values()) {
      if (a.type !== TickObject) continue
      if (a.resource == null) continue
      const args = a.resource.args
      if (args == null || !Array.isArray(args) || args.length < 3) continue
      const writeStream = args[2]
      if (writeStream.proto !== 'WriteStream') continue
      if (!writeStream.writable) continue
      this._writeStreamTickIds.add(a.id)
    }
  }

  _findWriteStreamWriteIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 2) continue
      if (!writeInitFrame0Rx.test(a.initStack[0])) continue
      if (!writeInitFrame1Rx.test(a.initStack[1])) continue
      this._writeStreamWriteIds.add(a.id)
    }
  }

  _findWriteStreamCloseIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 3) continue
      if (!closeInitFrame0Rx.test(a.initStack[0])) continue
      if (!closeInitFrame2Rx.test(a.initStack[2])) continue
      this._writeStreamCloseIds.add(a.id)
    }
  }

  /**
  * Here we try our best to piece together the parts of a WriteStream,
  * Open | Write+ | WriteStreamTick | Close.
  *
  * Since they aren't linked by a common file descriptor or similar we rely
  * on async resource graph structure and the timestamps to take a best guess.
  *
  * We just don't have the data available to piece this together with 100% certainty.
  *
  * Below is a sample of collected async resources with all but types and ids removed.
  *
  * ```
  *  { type: 'FSREQWRAP', id: 10, tid: 3 }   open, write stream triggered by root
  *  { type: 'FSREQWRAP', id: 11, tid: 3 }   open, read stream triggered by root
  *  { type: 'TickObject', id: 12, tid: 3 }  read stream tick, triggered by root
  *  { type: 'FSREQWRAP', id: 13, tid: 11 }  read, triggerd by open of read steam
  *  { type: 'FSREQWRAP', id: 14, tid: 13 }  write, triggerd by read of read steam
  *  { type: 'FSREQWRAP', id: 15, tid: 13 }  read, next chunk, triggered by first read
  *  { type: 'TickObject', id: 16, tid: 13 } stream tick, triggerd by first read
  *  { type: 'FSREQWRAP', id: 18, tid: 15 }  close read stream, triggered by last read
  *  { type: 'FSREQWRAP', id: 19, tid: 15 }  close write stream, triggered by last read
  * ```
  *
  * We reason about that data as follows in order to piece together the WriteStream.
  *
  * ## Connecting WriteSteam Write to WriteStream Close
  *
  * Write (id: 14) is triggered by read of read stream (id: 13).
  * The same read triggers the last read (id: 15).
  * That last read triggers the close of the write stream (id: 19).
  *
  * Therefore we can connect the write stream write to the write stream close since they
  * have a common parent in their ancestry (the first read of the read stream).
  *
  * ```
  *            -- Read2:15 -- WriteStream:Close:19
  *          /
  * Read1:13
  *          \
  *            -- WriteStream:Write:14
  * ```
  *
  * However I would imagine that this breaks down once we have on read stream piped into multiple
  * write streams as then the writes have the same Read parent.
  *
  * ## Connecting WriteStream Open to WriteStream Write
  *
  * There is no 100% way to get this right, but if we assume that the first write happens right after
  * the opening of the write stream in the same context we can do the following.
  *
  * We already know that the common parent of WriteStream:Write and
  * WriteStream:Close is Read1:13.
  * Therefore we find all WriteStream:Opens that share a parent with Read1:13.
  * The ones with the closest parent win.
  *
  * If we find more than one, we pick the one that was initialized closest to
  * the WriteStream:Write timewise, assuming that we write to the stream
  * immediately after opening it.
  *
  * ```
  *            -- ReadStream:Open:11 -- Read1:13 -- Read2:15 -- WriteStream:Close:19
  *          /                                   \
  * Parent:3                                       -- WriteStream:Write:14
  *          \
  *            -- WriteStream:Open:10
  * ```
  * @name writeStreamProcessor._separteIntoGroups
  * @function
  */
  _separateIntoGroups() {
    const remainingWriteIds = new Set(this._writeStreamWriteIds)
    const remainingOpenIds = new Set(this._writeStreamOpenIds)
    const grama = askGrama({
        nodes: Array.from(this._activities.values())
      , id: 'id'
      , parentId: 'triggerId'
    })

    // For each close that we see we work our way backwards.
    for (const closeId of this._writeStreamCloseIds.keys()) {
      const writeSiblings = grama.allSiblings(
          closeId
        , ({ descendantId }) => remainingWriteIds.has(descendantId)
      )
      // if we find no related writes we give up and ignore the close id
      if (writeSiblings.size === 0) continue

      // now we find the open related to the first write that happened
      const oldestWriteId = oldestId(this._activities, writeSiblings)

      // now we find the write stream open that happened immediately before
      // the oldest write
      const openSiblings = grama.allSiblings(
          oldestWriteId
        , ({ descendantId }) => remainingOpenIds.has(descendantId)
      )

      // if we find no related writes we give up and ignore the close id
      if (openSiblings.size === 0) continue

      const mostImmediateOpen = immediatelyBeforeId(
          this._activities
        , openSiblings
        , oldestWriteId
      )

      // Now we pieced the WriteStream together, but also want to include one related
      // WriteStreamTick (even if it is more related to a Read) as it has all
      // the info related to user functions.
      // This one is a descendant the first read, which is also the ancestor of the write close.
      const closestStreamTickAncestor = grama.closestSibling(
          closeId
        , ({ descendantId }) => this._writeStreamTickIds.has(descendantId)
      )

      // Now we create and add the group for this WriteStream
      const group = new Set(writeSiblings)
      group
        .add(mostImmediateOpen)
        .add(closestStreamTickAncestor)
        .add(closeId)
      this._groups.set(mostImmediateOpen, group)

      // And finally we remove the ids we used for this WriteStream
      // so they won't be used for the remaining ones
      remainingOpenIds.delete(mostImmediateOpen)
      for (const wid of writeSiblings) {
        remainingWriteIds.delete(wid)
      }
    }
  }

  _addOperations() {
    for (const [ id, group ] of this._groups) this._addOperation(id, group)
  }

  _addOperation(id, group) {
    const info = this._resolveGroup(group)
    const op = new WriteStreamOperation({
        group: info
      , includeActivities: this._includeActivities
    })
    this._operations.set(id, op.summary({ separateFunctions: this._separateFunctions }))
  }

  _resolveGroup(group) {
    const groupInfo = []
    for (const id of group) {
      const activity = this._activities.get(id)
      const isopen = this._writeStreamOpenIds.has(id)
      const istick = this._writeStreamTickIds.has(id)
      const iswrite = this._writeStreamWriteIds.has(id)
      const isclose = this._writeStreamCloseIds.has(id)
      const info = { activity, isopen, istick, iswrite, isclose }
      groupInfo.push(info)
    }
    return groupInfo
  }
}

exports = module.exports = WriteStreamProcessor

/**
 * The minimum number of steps, represented as an async resource each,
 * involved to execute `fs.createWriteStream`.
 *
 * This can be used by higher level processors to group
 * activities looking for larger operations first and then
 * operations involving less steps.
 *
 * Steps are: open, stream, write+, close
 *
 * @name WriteStreamProcessor.operationSteps
 */
exports.operationSteps = 4
