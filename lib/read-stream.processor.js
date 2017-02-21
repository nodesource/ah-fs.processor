// const debug = require('debug')('fs:readfile')
// const prettyMs = require('pretty-ms')

const { idsTriggeredBy } = require('./utils')
const ReadStreamOperation = require('./read-stream.operation')

const FSReqWrap = 'FSREQWRAP'
const TickObject = 'TickObject'

/*
 * Sample initStack of readStream open:
 *
 * "at Object.fs.open (fs.js:581:11)",
 * "at ReadStream.open (fs.js:1730:6)",
 * "at new ReadStream (fs.js:1717:10)",
 * "at Object.fs.createReadStream (fs.js:1667:10)",
 * "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:94:6)"
 *
 * Bottom frame has the info about where we created the readstream.
 * Maybe useful to pull out that info
 *
 */
const openInitFrame0Rx = /Object\.fs\.open/i
const openInitFrame1Rx = /ReadStream\.open/i

/*
 * Sample initStack of readStream read:
 *
 *  "at Object.fs.read (fs.js:608:11)",
 *  "at ReadStream._read (fs.js:1778:6)",
 *  "at ReadStream.<anonymous> (fs.js:1749:12)",
 *  "at Object.onceWrapper (events.js:291:19)",
 *  "at emitOne (events.js:96:13)"
 */
const readInitFrame0Rx = /Object\.fs\.read/i
const readInitFrame1Rx = /ReadStream\._read/i

/* Sample initStack of readStream close:
 *
 * "at Object.fs.close (fs.js:555:11)",
 * "at close (fs.js:1829:8)",
 * "at ReadStream.close (fs.js:1825:3)",
 * "at ReadStream.destroy (fs.js:1808:8)",
 * "at ReadStream.<anonymous> (fs.js:1721:12)"
 */
const closeInitFrame0Rx = /Object\.fs\.close/i
const closeInitFrame2Rx = /ReadStream\.close/i

class ReadStreamProcessor {
  /**
   * Instantiates an fs.createReadStream data processor to process data collected via
   * [nodesource/ah-fs](https://github.com/nodesource/ah-fs)
   *
   * @name ReadStreamProcessor
   * @constructor
   * @param {Object} $0
   * @param {Map.<string, Object>} {$0.activities} a map of async activities hashed by id
   * @param {boolean} [includeActivities=false] if `true` the actual activities are appended to the output
   *
   * @return {Map.<number, Object} map of fs.createReadStream activities hashed by the
   * file descriptor they operated on, for more info @see readStreamProcessor.process()
   */
  constructor({ activities, includeActivities = false, separateFunctions = true }) {
    this._activities = activities
    this._includeActivities = includeActivities
    this._separateFunctions = separateFunctions
    this._clear()
  }

  /**
   * Processes the supplied async activities and splits them into
   * groups, and operations each representing a file read stream `fs.createReadStream`.
   *
   * ## Groups
   *
   * The returned value has a `groups` property which just lists the ids
   * of async resources that were grouped together to form an operation
   * indexed by the `fd` on which the readFile operated.
   * Thus the `groups` is a map of sets.
   * If no file read stream was encountered the groups are empty.
   *
   * ## Operations
   *
   * Additionally an `operations` property is included as well. Each operation
   * represents one full `fs.createReadStream` execution. There will be one operation per
   * group and they are indexed by the corresponding `fd` as well.
   *
   * An `operation` has the following properties:
   *
   * ### `fs.createReadStream` specific Operation Properties
   *
   *  Data about the async resources that were part of the operation, by default
   *  only `id` and `triggerId` are included:
   *  - **open**: contains data about opening the file
   *  - **stream**: contains data about how the stream was configured, including readable state and
   *    the path to the file being read, pipes count, encoding, etc.
   *  - **reads**: an Array of reads, each containing data about reading a chunk from the file including
   *    the time spent to complete reading the particular chunk
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
   * { groups: Map { 10 => Set { 10, 12, 13, 14, 16 } },
   *   operations:
   *   Map {
   *     10 => { lifeCycle:
   *       { created: { ms: '1.60ms', ns: 1600000 },
   *         destroyed: { ms: '14.33ms', ns: 14329000 },
   *         timeAlive: { ms: '12.73ms', ns: 12729000 } },
   *     createdAt: 'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:94:6)',
   *     open: { id: 10, triggerId: 3 },
   *     stream:
   *       { id: 14,
   *         triggerId: 12,
   *         path: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js',
   *         flags: 'r',
   *         fd: 19,
   *         objectMode: false,
   *         highWaterMark: 65536,
   *         pipesCount: 0,
   *         defaultEncoding: 'utf8',
   *         encoding: null },
   *     reads:
   *       [ { id: 12,
   *           triggerId: 10,
   *           timeSpent: { ms: '0.83ms', ns: 830000 } },
   *         { id: 13,
   *           triggerId: 12,
   *           timeSpent: { ms: '0.24ms', ns: 240000 } } ],
   *     close: { id: 16, triggerId: 13 },
   *     userFunctions:
   *       [ { file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js',
   *           line: 99,
   *           column: 16,
   *           inferredName: '',
   *           name: 'onend',
   *           location: 'onend (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:99:16)',
   *           args: null,
   *           propertyPaths: [ 'stream.resource.args[0]._events.end[1]' ] },
   *         { file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js',
   *           line: 98,
   *           column: 17,
   *           inferredName: '',
   *           name: 'ondata',
   *           location: 'ondata (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:98:17)',
   *           args: null,
   *           propertyPaths: [ 'stream.resource.args[0]._events.data' ] } ] } } }
   * ```
   *
   * @name readStreamProcessor.process
   * @return {Object} information about `fs.createReadStream` operations with the
   * structure outlined above
   */
  process() {
    this._clear()

    // First find all ids of activities that represent a read stream open
    this._findReadStreamOpenIds()

    // Then we find the TickObject that has the readable state as part
    // of it args along with lots of functions, a few of which are
    // callbacks the user registered for events like on('data'), on('error'), on('end')
    this._findReadStreamTickIds()

    // Now we look for the actual reads which are triggered by the stream ticks.
    this._findReadStreamReadIds()

    // Finally we find the read stream close events, which are each triggered by
    // the last read of their stream respectively
    this._findReadStreamCloseIds()

    this._separateIntoGroups()
    this._addOperations()

    return {
        groups: this._groups
      , operations: this._operations
    }
  }

  _clear() {
    this._readStreamOpenIds = new Set()
    this._readStreamTickIds = new Set()
    this._readStreamReadIds = new Set()
    this._readStreamCloseIds = new Set()
    this._groups = new Map()
    this._operations = new Map()
  }

  _findReadStreamOpenIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 2) continue
      if (!openInitFrame0Rx.test(a.initStack[0])) continue
      if (!openInitFrame1Rx.test(a.initStack[1])) continue
      this._readStreamOpenIds.add(a.id)
    }
  }

  _findReadStreamTickIds() {
    for (const a of this._activities.values()) {
      if (a.type !== TickObject) continue
      if (a.resource == null) continue
      const args = a.resource.args
      if (args == null || !Array.isArray(args) || args.length === 0) continue
      const readStream = args[0]
      if (readStream.proto !== 'ReadStream') continue
      if (!readStream.readable) continue
      this._readStreamTickIds.add(a.id)
    }
  }

  _findReadStreamReadIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 2) continue
      if (!readInitFrame0Rx.test(a.initStack[0])) continue
      if (!readInitFrame1Rx.test(a.initStack[1])) continue
      this._readStreamReadIds.add(a.id)
    }
  }

  _findReadStreamCloseIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 3) continue
      if (!closeInitFrame0Rx.test(a.initStack[0])) continue
      if (!closeInitFrame2Rx.test(a.initStack[2])) continue
      this._readStreamCloseIds.add(a.id)
    }
  }

  _separateIntoGroups(id) {
    const stop = id => this._readStreamCloseIds.has(id)

    // With this approach we are omitting one of the streamTicks which is
    // triggered in the same context as the open itself.
    // We could easily find it as it is inited right after, however we
    // don't really needed as all the information is also present on the
    // second stream tick which is part of the triggerId chain.
    for (const openId of this._readStreamOpenIds) {
      const group = idsTriggeredBy(this._activities, openId, stop)
      this._groups.set(openId, group)
    }
  }

  _addOperations() {
    for (const [ id, group ] of this._groups) this._addOperation(id, group)
  }

  _addOperation(id, group) {
    const info = this._resolveGroup(group)
    const op = new ReadStreamOperation({
        group: info
      , includeActivities: this._includeActivities
    })
    this._operations.set(id, op.summary({ separateFunctions: this._separateFunctions }))
  }

  _resolveGroup(group) {
    const groupInfo = []
    for (const id of group) {
      const activity = this._activities.get(id)
      const isopen = this._readStreamOpenIds.has(id)
      const istick = this._readStreamTickIds.has(id)
      const isread = this._readStreamReadIds.has(id)
      const isclose = this._readStreamCloseIds.has(id)
      const info = { activity, isopen, istick, isread, isclose }
      groupInfo.push(info)
    }
    return groupInfo
  }
}

exports = module.exports = ReadStreamProcessor

/**
 * The minimum number of steps, represented as an async resource each,
 * involved to execute `fs.createReadStream`.
 *
 * This can be used by higher level processors to group
 * activities looking for larger operations first and then
 * operations involving less steps.
 *
 * Steps are: open, stream+, read+, close
 *
 * @name ReadStreamProcessor.operationSteps
 */
exports.operationSteps = 4

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}

// Test
if (!module.parent && typeof window === 'undefined') {
const activities = new Map(require('../test/fixtures/one-file.read-stream.json'))
const processor = new ReadStreamProcessor({ activities })
const ops = processor.process()
inspect(ops)
}
