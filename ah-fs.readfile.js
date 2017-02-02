const debug = require('debug')('fs:readfile')
const prettyMs = require('pretty-ms')

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./test/fixtures/one-file.json'))

const readingFileRx = /at Object.fs.readFile/i
const openedFileRx = /at FSReqWrap.readFileAfterOpen/i
const statedFileRx = /at FSReqWrap.readFileAfterStat/i
const closingFileRx = /at ReadFileContext.close/i

function pretty(ns) {
  return prettyMs(ns * 1E-6, { msDecimalDigits: 2 })
}

function safeFirstStamp(x) {
  if (x == null || x.length === 0) return null
  return pretty(x[0])
}

function processArguments(args) {
  if (args == null) return { err: 'N/A', src: 'N/A' }
  const err = args[0]
  const srcInfo = args[1]
  let src
  if (srcInfo == null) {
    src = 'N/A'
  } else {
    src = { len: srcInfo.len }
    if (srcInfo.val) {
      src.included = srcInfo.included
      src.val = srcInfo.val
    }
  }
  return { err, src }
}

function processFunction(fn) {
  const name =
      fn.name != null && fn.name.length > 0         ? fn.name
    : fn.inferredName != null && fn.name.length > 0 ? fn.inferredName
    : 'N/A'
  const location = fn.file != null && fn.file.length > 0
    ? `${fn.file}:${fn.line}:${fn.column}`
    : 'N/A'
  return { name, location }
}

//
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

class FsReadFileAnalyzer {
  constructor({ activities, includeActivities }) {
    this._activities = activities
    this._includeActivities = includeActivities
  }

  analyze() {
    const groups = this._groupByFd()
    debug('%d group(s)', groups.size)

    const potentialFsReads = this._filterPotentialFsReadGroups(groups)
    debug('%d potential fs read(s)', potentialFsReads.size)

    const sorted = this._sortIdsByInitTime(potentialFsReads)
    const verified = this._filterDefiniteFsReadGroups(sorted)
    debug('%d verified fs read(s)', verified.size)

    const descriptions = this._describe(verified)
    return descriptions
  }

  _groupByFd() {
    const map = new Map()
    for (const v of activities.values()) {
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
    const verified = new Map()
    for (const [ k, v ] of sortedGroups) {
      // readFile inits first activity and causes file to open
      const keys = v.keys()
      let id = keys.next().value
      if (!testInitStack(readingFileRx, this._activities.get(id))) continue
      // stat inits second activity after file opened
      id = keys.next().value
      if (!testInitStack(openedFileRx, this._activities.get(id))) continue
      // read inits third activity after file stated
      id = keys.next().value
      if (!testInitStack(statedFileRx, this._activities.get(id))) continue
      // final activity closes file
      id = keys.next().value
      if (!testInitStack(closingFileRx, this._activities.get(id))) continue
      // passed all tests
      verified.set(k, v)
    }
    return verified
  }

  _describe(verified) {
    const descriptions = new Map()
    for (const [ k, v ] of verified) {
      const desc = { execution: this._describeGroupExecution(v) }
      this._addCalledBy(desc)
      this._addCallback(desc)
      descriptions.set(k, desc)
    }
    return descriptions
  }

  _addCalledBy(desc) {
    const open = desc.execution.open
    const oa = this._activities.get(open.id)
    // top most line is fs.readFile, the frame of the call is right before
    const openInitStack = oa.initStack != null && oa.initStack[1]
    const calledBy = openInitStack != null
      ? openInitStack
      : 'N/A, ensure to pass a proper stack capturer:\n' +
        'See: https://github.com/nodesource/ah-collector#activitycollector'
    desc.calledBy = calledBy
  }

  _addCallback(desc) {
    // close callback capture has most information, i.e. it includes the arguments
    // passed when the callback was invoked
    const close = desc.execution.close
    const ca = this._activities.get(close.id)
    const callback = ca.resource && ca.resource.context && ca.resource.context.callback
    if (!callback) {
      desc.callback = 'N/A, ensure to capture the resources properly.'
      return
    }
    const { err, src } = processArguments(callback.arguments)
    const { location, name } = processFunction(callback)
    const srcViz = (src.val && src.val.utf8) || 'N/A'
    desc.callback = {
        name
      , location
      , arguments: { err, src }
      , viz: `function ${name}(${err}, '${srcViz} ...')`
    }
  }

  _describeGroupExecution(group) {
    const keys = group.keys()

    // open
    let id = keys.next().value
    const oa = this._activities.get(id)
    const open = {
        action      : 'open file'
      , id          : id
      , initialized : safeFirstStamp(oa.init)
      , destroyed   : safeFirstStamp(oa.destroy)
    }

    // stat is triggered by open
    id = keys.next().value
    const sa = this._activities.get(id)
    const stat = {
        action      : 'stat file'
      , id          : id
      , triggered   : safeFirstStamp(oa.before)
      , initialized : safeFirstStamp(sa.init)
      , completed   : safeFirstStamp(oa.after)
      , destroyed   : safeFirstStamp(sa.destroy)
    }

    // read is triggered by stat
    id = keys.next().value
    const ra = this._activities.get(id)
    const read = {
        action      : 'read file'
      , id          : id
      , triggered   : pretty(sa.before[0])
      , initialized : safeFirstStamp(ra.init)
      , completed   : safeFirstStamp(sa.after)
      , destroyed   : safeFirstStamp(ra.destroy)
    }

    // close is triggered by read
    id = keys.next().value
    const ca = this._activities.get(id)
    const close = {
        action      : 'close file'
      , id          : id
      , triggered   : safeFirstStamp(ra.before)
      , initialized : safeFirstStamp(ca.init)
      , completed   : safeFirstStamp(ra.after)
      , destroyed   : safeFirstStamp(ca.destroy)
    }

    if (this._includeActivities) {
      open.activity  = oa
      stat.activity  = sa
      read.activity  = ra
      close.activity = ca
    }
    return { open, stat, read, close }
  }
}

const includeActivities = false
const res = new FsReadFileAnalyzer({ activities, includeActivities }).analyze()
inspect(res)
