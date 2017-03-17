const { idsTriggeredBy } = require('ah-processor.utils')
const ReadFileOperation = require('./read-file.operation')

const FSReqWrap = 'FSREQWRAP'

/*
 * Sample initStack of readFile open, called as first operation of `fs.readFile`:
 *
 * "at Object.fs.readFile (fs.js:295:11)",
 * "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:49:6)",
 *
 * Code at fs.js:295:
 *
 * `binding.open(pathModule._makeLong(path), ...`
 *
 * Bottom frame has info about where the call `fs.readFile` originated.
 */
const openInitFrame0Rx = /at Object.fs.readFile/i

/*
 * Sample initStack of readFile stat, called after `fs.open` completes:
 *
 * "at FSReqWrap.readFileAfterOpen [as oncomplete] (fs.js:380:11)"
 *
 * Code at fs.js:380:
 *
 * `binding.fstat(fd, req);`
 */
const statInitFrame0Rx = /at FSReqWrap.readFileAfterOpen/i

/*
 * Sample initStack of readFile read, called after `fs.stat` completes:
 *
 * "at ReadFileContext.read (fs.js:340:11)",
 * "at FSReqWrap.readFileAfterStat [as oncomplete] (fs.js:404:11)"
 *
 * Code at fs.js:340:
 *
 * `binding.read(this.fd, buffer, offset, length, -1, req);`
 */
const readInitFrame1Rx = /at FSReqWrap.readFileAfterStat/i

/*
 * Sample initStack of readFile close, called after last `fs.read` completes:
 *
 *  "at ReadFileContext.close (fs.js:363:11)",
 *  "at FSReqWrap.readFileAfterRead [as oncomplete] (fs.js:420:15)"
 *
 *  Code at fs.js:363:
 *
 *  `binding.close(this.fd, req);`
 */
const closeInitFrame0Rx = /at ReadFileContext.close/i

class ReadFileProcessor {

  /**
   * Instantiates an fs.readFile data processor to process data collected via
   * [nodesource/ah-fs](https://github.com/nodesource/ah-fs)
   *
   * @name ReadFileProcessor
   * @constructor
   * @param {Object} $0
   * @param {Map.<string, Object>} {$0.activities} a map of async activities hashed by id
   * @param {boolean} [includeActivities=false] if `true` the actual activities are appended to the output
   *
   * @return {Map.<number, Object} map of fs.readFile activities hashed by the
   * file descriptor they operated on, for more info @see readFileProcessor.process()
   */
  constructor({ activities, includeActivities = false, separateFunctions = true }) {
    this._activities = activities
    this._includeActivities = includeActivities
    this._separateFunctions = separateFunctions
  }

  /**
   * Processes the supplied async activities and splits them into
   * groups, and operations each representing a file read `fs.readFile`.
   *
   * ## Groups
   *
   * The returned value has a `groups` property which just lists the ids
   * of async resources that were grouped together to form an operation
   * indexed by the id of the `open` resource.
   * Thus the `groups` is a map of sets.
   * If no file read was encountered the groups are empty.
   *
   * ## Operations
   *
   * Additionally an `operations` property is included as well. Each operation
   * represents one full `fs.readFile` execution. There will be one operation per
   * group and they are indexed by the corresponding open resource `id` as well.
   *
   * An `operation` has the following properties:
   *
   * ### `fs.readFile` specific Operation Properties
   *
   *  Data about the async resources that were part of the operation, by default
   *  only `id` and `triggerId` are included:
   *  - **open**: contains data about opening the file
   *  - **stat**: contains data about getting file stats
   *  - **read**: contains data about reading the file
   *  - **close**: contains data about closing the file
   *
   * ### General Operation Properties
   *
   * The information below is the same for all `operation`s and thus is only
   * mentioned here and linked from the documentation of all other processors.
   *
   *  Data about the lifetime of the operation:
   *
   *  - **lifeCycle**: contains three timestamps that detail when an operation was created,
   *    for how long it was alive and when it was destroyed.
   *
   *    - **created**: the timestamp when the first resource of the operation was created
   *    - **destroyed**: the timestamp when the last resource of the operation was destroyed
   *    - **timeAlive**: the difference between the `destroyed` and `created` timestamps, i.e.
   *      how long the operation's resources were alive
   *
   *    Each timestamp has the following two properties provided by [utils.prettyNs](#utilsprettyns).
   *    - **ns**: time in nanoseconds {Number}
   *    - **ms**: pretty printed time in milliseconds {String}
   *
   * Data that links to user code that is responsible for the operation occurring.
   *
   * - **createdAt**: provides the line of code that called `fs.readFile`
   * - **userFunctions**: depending on the settings (see constructor docs) each resource
   *   will include it's own array of userFunctions or they are separated out into
   *   one property with duplicates merged. The latter is the default behavior.
   *   In either case `userFunctions` is an Array of Objects with the following properties:
   *
   *   - **name**: the function name
   *   - **inferredName**: the inferred function name, only needed if the `name` is not set
   *   - **file**: the file in which the function was defined
   *   - **line**: the line on which the functino was defined in that file
   *   - **column**: the column on which the functino was defined in that file
   *   - **location**: the file and line + column where the function was defined combined into a string
   *   - **args**: the `err` and information about the `res` of the operation
   *     with which the function was invoked
   *   - **propertyPaths**: the object paths at which the function was found, these could be multiple
   *     since the function could've been attached to multiple resources (only available if the functions
   *     were separated from the resources and merged)
   *   - **propertyPath**: the object path at which the function was found (only available if the
   *     functions weren't separated and thus are still part of each resource)
   *
   * ## Sample Return Value
   *
   * The sample return value was created with default options.
   *
   * ```js
   * { groups: Map { 10 => Set { 10, 11, 12, 13 } },
   *   operations:
   *     Map {
   *       10 => { lifeCycle:
   *         { created: { ms: '44.12ms', ns: 44119000 },
   *           destroyed: { ms: '85.95ms', ns: 85955000 },
   *           timeAlive: { ms: '41.84ms', ns: 41836000 } },
   *       createdAt: 'at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:36:6)',
   *       open: { id: 10, triggerId: 1 },
   *       stat: { id: 11, triggerId: 10 },
   *       read: { id: 12, triggerId: 11 },
   *       close: { id: 13, triggerId: 12 },
   *       userFunctions:
   *         [ { file: '/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js',
   *             line: 39,
   *             column: 17,
   *             inferredName: '',
   *             name: 'onread',
   *             location: 'onread (/Volumes/d/dev/js/async-hooks/ah-fs/test/read-one-file.js:39:17)',
   *             args:
   *             { '0': null,
   *               '1':
   *                 { type: 'Buffer',
   *                   len: 6108,
   *                   included: 18,
   *                   val:
   *                   { utf8: 'const test = requi',
   *                     hex: '636f6e73742074657374203d207265717569' } },
   *               proto: 'Object' },
   *             propertyPaths:
   *             [ 'open.resource.context.callback',
   *               'stat.resource.context.callback',
   *               'read.resource.context.callback',
   *               'close.resource.context.callback' ] } ] } } }
   * ```
   *
   * @name readFileProcessor.process
   * @return {Object} information about `fs.readFile` operations with the
   * structure outlined above
   */
  process() {
    this._clear()

    this._findReadFileOpenIds()
    this._findReadFileStatIds()
    this._findReadFileReadIds()
    this._findReadFileCloseIds()

    this._separateIntoGroups()
    this._addOperations()

    return { groups: this._groups, operations: this._operations }
  }

  _clear() {
    this._readFileOpenIds = new Set()
    this._readFileStatIds = new Set()
    this._readFileReadIds = new Set()
    this._readFileCloseIds = new Set()
    this._groups = new Map()
    this._operations = new Map()
  }

  _findReadFileOpenIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 1) continue
      if (!openInitFrame0Rx.test(a.initStack[0])) continue
      this._readFileOpenIds.add(a.id)
    }
  }

  _findReadFileStatIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 1) continue
      if (!statInitFrame0Rx.test(a.initStack[0])) continue
      this._readFileStatIds.add(a.id)
    }
  }

  _findReadFileReadIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 2) continue
      if (!readInitFrame1Rx.test(a.initStack[1])) continue
      this._readFileReadIds.add(a.id)
    }
  }

  _findReadFileCloseIds() {
    for (const a of this._activities.values()) {
      if (a.type !== FSReqWrap) continue
      if (a.initStack == null || a.initStack.length < 1) continue
      if (!closeInitFrame0Rx.test(a.initStack[0])) continue
      this._readFileCloseIds.add(a.id)
    }
  }

  _separateIntoGroups() {
    // This is a bit naíve as we don't handle the case where the file never
    // was closed, but for now this will work.
    const stop = id => this._readFileCloseIds.has(id)
    for (const openId of this._readFileOpenIds) {
      const group = idsTriggeredBy(this._activities, openId, stop)
      // we only consider complete fs.readFile operations at this point,
      // i.e. open|stat|read|close, anything else should be grouped into
      // smaller operations
      if (group.size < 4) continue
      this._groups.set(openId, group)
    }
  }

  _addOperations() {
    for (const [ id, group ] of this._groups) this._addOperation(id, group)
  }

  _addOperation(id, group) {
    const info = this._resolveGroup(group)
    const op = new ReadFileOperation({
        group: info
      , includeActivities: this._includeActivities
    })
    this._operations.set(id, op.summary({ separateFunctions: this._separateFunctions }))
  }

  _resolveGroup(group) {
    const groupInfo = []
    for (const id of group) {
      const activity = this._activities.get(id)
      const isopen = this._readFileOpenIds.has(id)
      const isstat = this._readFileStatIds.has(id)
      const isread = this._readFileReadIds.has(id)
      const isclose = this._readFileCloseIds.has(id)
      const info = { activity, isopen, isstat, isread, isclose }
      groupInfo.push(info)
    }
    return groupInfo
  }
}

exports = module.exports = ReadFileProcessor

/**
 * The minimum number of steps, represented as an async resource each,
 * involved to execute `fs.readFile`.
 *
 * This can be used by higher level processors to group
 * activities looking for larger operations first and then
 * operations involving less steps.
 *
 * Steps are: open, stat, read+, close
 *
 * @name ReadFileProcessor.operationSteps
 */
exports.operationSteps = 4

/**
 * Description of the operation: 'fs.readFile'.
 *
 * @name ReadFileProcessor.operation.
 */
exports.operation = 'fs.readFile'
