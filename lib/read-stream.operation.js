const { prettyNs, safeGetVal, uniqueUserFunctions } = require('./utils')

class ReadStreamOperation {
  constructor({ group, includeActivities }) {
    this._includeActivities = includeActivities
    this._process(group)
  }

  _process(group) {
    this._reads = []
    for (let i = 0; i < group.length; i++) {
      const info = group[i]
      if (info.isopen) {
        this._processOpen(info)
      } else if (info.istick) {
        this._processTick(info)
      } else if (info.isread) {
        this._processRead(info)
      } else if (info.isclose) {
        this._processClose(info)
      }
    }
  }

  _processOpen(info) {
    // An open doesn't have too much info, but we can glean two very important
    // data points.
    // 1. the init timestamp tells us when the stream was created
    // 2. the last frame of the init stack tells us where `createReadStream` was called.
    this._created = prettyNs(info.activity.init[0])

    // Sample init stack:
    // "at Object.fs.open (fs.js:581:11)",
    // "at ReadStream.open (fs.js:1730:6)",
    // "at new ReadStream (fs.js:1717:10)",
    // "at Object.fs.createReadStream (fs.js:1667:10)",
    // "at Test.<anonymous> (/Volumes/d/dev/js/async-hooks/ah-fs/test/readstream-one-file.js:94:6)"
    const initStack = info.activity.initStack
    if (initStack == null || initStack.length < 5) return
    this._createdAt = info.activity.initStack[4]
    this._open = { id: info.activity.id, triggerId: info.activity.triggerId }
    if (this._includeActivities) this._open.activity = info.activity
  }

  _processTick(info) {
    const { id, triggerId } = info.activity

    // only need one tick to pull the info from
    if (this._processedTick) return

    const args = info.activity.resource && info.activity.resource.args
    if (args == null || args.length < 2) return

    // The ReadStream Tick gives us a lot of information. It has an args array with
    // the ReadStream and its ReadableState respectively
    //
    // The ReadStream provides us the following:
    //
    // 1. the path to the file we are streaming
    // 2. the flags with which the file was opened
    // 3. the fd (assuming we are dealing with the tick triggered indirectly by the open)
    //
    // All callbacks on the _events of the ReadStream have been removed, but are present
    // inside the functions object (see below).
    //
    // The ReadableState provides us the following:
    //
    // 1. objectMode `true|false`
    // 2. highWaterMark
    // 3. pipesCount
    // 4. defaultEncoding, i.e. utf8
    // 5. encoding, i.e. utf8

    const stream = args[0]
    const path = safeGetVal(stream.path)
    const flags = safeGetVal(stream.flags)
    const fd = stream.fd

    const state = args[1]
    const objectMode = state.objectMode
    const highWaterMark = state.highWaterMark
    const pipesCount = state.pipesCount
    const defaultEncoding = safeGetVal(state.defaultEncoding)
    const encoding = safeGetVal(state.encoding)

    const functions = info.activity.resource.functions
    const userFunctions = uniqueUserFunctions(functions, { pathPrefix: 'stream.resource' })
    this._stream = {
        id
      , triggerId
      , path
      , flags
      , fd
      , objectMode
      , highWaterMark
      , pipesCount
      , defaultEncoding
      , encoding
      , userFunctions
    }
    if (this._includeActivities) this._stream.activity = info.activity

    this._processedTick = true
  }

  _processRead(info) {
    // The read resource doesn't give us too much information.
    // The stack traces originate in core and we don't see any registred
    // user callbacks, as those are present on the stream instead.
    // However we can count the amount of reads that occurred and deduce how
    // long each read took from the `before` and `after` timestamps.

    const activity = info.activity
    if (activity == null) return

    const before = activity.before && activity.before.length && activity.before[0]
    const after = activity.after && activity.after.length && activity.after[0]
    const timeSpent = before && after ? prettyNs(after - before) : prettyNs(0)

    const read = { id: activity.id, triggerId: activity.triggerId, timeSpent }
    if (this._includeActivities) read.activity = activity
    this._reads.push(read)
  }

  _processClose(info) {
    // The main information we pull from the close resource is the `destroy` timestamp.
    // Combined with the `init` timestamp of the open resource we can deduce how long
    // the read stream was active.

    const activity = info.activity
    if (activity == null) return
    const destroy = activity.destroy && activity.destroy.length && activity.destroy[0]
    this._destroyed = destroy ? prettyNs(destroy) : prettyNs(0)
    this._close = { id: activity.id, triggerId: activity.triggerId }
    if (this._includeActivities) this._close.activity = activity
  }

  get summary() {
    return {
        lifeCycle: {
            created   : this._created
          , destroyed : this._destroyed
          , timeAlive : prettyNs(this._destroyed.ns - this._created.ns)
        }
      , createdAt : this._createdAt
      , open      : this._open
      , stream    : this._stream
      , reads     : this._reads
      , close     : this._close
    }
  }
}

module.exports = ReadStreamOperation
