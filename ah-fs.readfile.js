const debug = require('debug')('fs:readfile')

// eslint-disable-next-line no-unused-vars
function inspect(obj, depth) {
  console.error(require('util').inspect(obj, false, depth || 5, true))
}
const activities = new Map(require('./test/fixtures/one-file.json'))

const readingFileRx = /at Object.fs.readFile/i
const openedFileRx = /at FSReqWrap.readFileAfterOpen/i
const statedFileRx = /at FSReqWrap.readFileAfterStat/i
const closingFileRx = /at ReadFileContext.close/i

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
  constructor(activities) {
    this._activities = activities
  }

  analyze() {
    const groups = this._groupByFd()
    debug('%d group(s)', groups.size)

    const potentialFsReads = this._filterPotentialFsReadGroups(groups)
    debug('%d potential fs read(s)', potentialFsReads.size)

    const sorted = this._sortIdsByInitTime(potentialFsReads)
    const verified = this._filterDefiniteFsReadGroups(sorted)
    debug('%d verified fs read(s)', verified.size)
    return verified
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
}

const res = new FsReadFileAnalyzer(activities).analyze()
inspect(res)
