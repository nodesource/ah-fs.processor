const ReadFileOperation = require('./read-file.operation')

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

/**
 * Tries to pull the `fd` property from the context of
 * the activity's resource.
 *
 * @private
 * @param {Object} activity the async-hooks activity
 * @return {Number} the fd if found or `-1`
 */
function queryFd(activity) {
  return (activity != null && activity.resource != null
      && activity.resource.context != null
      && typeof activity.resource.context.fd === 'number')
  ? activity.resource.context.fd
  : -1
}

function createSet() {
  return new Set()
}

function testInitStack(rx, activity) {
  const initStack = activity.initStack
  if (initStack == null || initStack.length === 0) return false
  return initStack.some(x => rx.test(x))
}

function getOrCreate(map, key, create) {
  if (map.has(key)) return map.get(key)
  const initialValue = create()
  map.set(key, initialValue)
  return initialValue
}

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
   * indexed by the `fd` on which the readFile operated.
   * Thus the `groups` is a map of sets.
   * If no file read was encountered the groups are empty.
   *
   * ## Operations
   *
   * Additionally an `operations` property is included as well. Each operation
   * represents one full `fs.readFile` execution. There will be one operation per
   * group and they are indexed by the corresponding `fd` as well.
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
   * { groups: Map { 17 => Set { 10, 11, 12, 13 } },
   *   operations:
   *     Map {
   *       17 => { lifeCycle:
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

    // First group all activities by fd since we know that all resourses related to
    // one fs.readFile will share the same fd.
    const fdGroups = this._groupByFd()

    // Since we know that an fs.readFile has exactly 4 operations:
    // open, stat, read and close, we can filter out all candidates that have more or less.
    const potentialFsReads = this._filterPotentialFsReadGroups(fdGroups)

    // Now we sort them by init time
    const sorted = this._sortIdsByInitTime(potentialFsReads)

    // And since we know the order they need to occur in we can use that
    // fact to verify that we deal with a legit fs.readFile group
    this._groups = this._filterDefiniteFsReadGroups(sorted)

    // Finally we process the groups further to create proper representations
    // of fs.readFile operations.
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

  _groupByFd() {
    const map = new Map()
    for (const v of this._activities.values()) {
      const fd = queryFd(v)
      getOrCreate(map, fd, createSet).add(v.id)
    }
    return map
  }

  _filterPotentialFsReadGroups(groups) {
    const potentials = new Map()
    if (groups.size === 0) return potentials
    for (const [ k, set ] of groups) {
      if (k < 0) continue
      // looking for fds that showed exactly four operations
      // open, stat, read, close
      if (set.size !== 4) continue
      potentials.set(k, set)
    }
    return potentials
  }

  _idsByInitTime(id1, id2) {
    const a1 = this._activities.get(id1)
    const a2 = this._activities.get(id2)
    return a1.init[0] - a2.init[0]
  }

  _sortIdsByInitTime(groups) {
    const sorted = new Map()
    // Most likely they are already sorted as they were
    // entered into the groups sets in the order they were
    // seen, but here we enforce it.
    for (const [ k, v ] of groups) {
      const sortedArray = Array.from(v).sort(this._idsByInitTime.bind(this))
      sorted.set(k, new Set(sortedArray))
    }
    return sorted
  }

  _filterDefiniteFsReadGroups(sortedGroups) {
    // Here we verify that a group does indeed represent an fs.readFile operation.
    // While doing so we update the open, stat, read and close ids sets respectively.
    // We need those later when we convert each group into an operation.
    const verified = new Map()
    for (const [ k, v ] of sortedGroups) {
      // readFile inits first activity and causes file to open
      const keys = v.keys()
      let id = keys.next().value
      if (!testInitStack(openInitFrame0Rx, this._activities.get(id))) continue
      this._readFileOpenIds.add(id)

      // stat inits second activity after file opened
      id = keys.next().value
      if (!testInitStack(statInitFrame0Rx, this._activities.get(id))) continue
      this._readFileStatIds.add(id)

      // read inits third activity after file stated
      id = keys.next().value
      if (!testInitStack(readInitFrame1Rx, this._activities.get(id))) continue
      this._readFileReadIds.add(id)

      // final activity closes file
      id = keys.next().value
      if (!testInitStack(closeInitFrame0Rx, this._activities.get(id))) continue
      this._readFileCloseIds.add(id)

      // passed all tests
      verified.set(k, v)
    }
    return verified
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

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 15, true))
}

if (!module.parent && typeof window === 'undefined') {
const activities = new Map(require('../test/fixtures/one-file.read-file.json'))
const ops = new ReadFileProcessor({ activities }).process()

inspect(ops)
}
