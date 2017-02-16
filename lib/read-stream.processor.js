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
  constructor({ activities, includeActivities = false }) {
    this._activities = activities
    this._includeActivities = includeActivities
    this._clear()
  }

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
    this._operations.set(id, op.summary)
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

module.exports = ReadStreamProcessor

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
