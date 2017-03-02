const prettyMs = require('pretty-ms')

/**
 * Finds all ids of activities that are triggered by the given id.
 * This function works recursive, i.e. any activity triggered by
 * a child of the root activity is included as well.
 *
 * For this to work, activities are assumed to be in the order that
 * they were triggered. This can easily be achieved by simply sorting
 * the activities by their init timestamp.
 *
 * @name utils.idsTriggeredBy
 * @param {Map.<number, Activity>} activities collected via [ah-fs](https://github.com/nodesource/ah-fs)
 * @param {number} id the id of the root activity we whose triggered _children_ we are trying to find
 * @param {function} stop a predicate that will finish the activity walk if it returns `true`.
 *  Function signature: `(id, activity)`.
 * @return {Set.<number>} the provided root id and all ids of activities triggered by it or any of it's children,
 * grandchildren, etc.
 */
exports.idsTriggeredBy = function idsTriggeredBy(activities, id, stop) {
  const ids = new Set([ id ])
  for (const [ id, activity ] of activities) {
    if (ids.has(activity.triggerId)) ids.add(id)
    if (stop(id, activity)) break
  }
  return ids
}

/**
 * Finds the oldest activity of the ones supplied via the ids.
 * We consider an activity older than another one if it's init timestamp
 * is further in the past.
 *
 * Any ids we can't find as in the activities are ignored.
 *
 * @name utils.oldestId
 * @function
 * @param {Map.<Number, Object>} activities the collected async activities
 * @param {Set.<Number>} ids the ids to consider when finding the oldest
 * @return {Number} the id of the oldest activity or `null` if no activity for any id was found
 */
exports.oldestId = function oldestId(activities, ids) {
  let oldest = { id: null, init: null }
  for (const id of ids) {
    if (!activities.has(id)) continue
    const init = activities.get(id).init
    if (oldest.id == null || oldest.init > init) {
      oldest.id = id
      oldest.init = init
    }
  }
  return oldest.id
}

/**
 * Finds the activity of the ones supplied via the ids that initialized immediately
 * before the one with the given id initialized.
 *
 * @name immediatelyBeforeId
 * @function
 * @param {Map.<Number, Object>} activities the collected async activities
 * @param {Set.<Number>} ids the ids to consider when finding most immediate
 * @param {Number} the id of the activity for which we will find the activity that initialized immediately before
 * @return {Number} the id that initialized immediately before the activity with `id` or `null` if no activity for any
 * id was found
 */
exports.immediatelyBeforeId = function immediatelyBeforeId(activities, ids, id) {
  if (!activities.has(id)) throw new Error(`The id '${id}' is not part of the given activities!`)
  const baseInit = activities.get(id).init
  const mostImmediate = { id: null, init: null, delta: null }
  for (const id of ids) {
    if (!activities.has(id)) continue
    const init = activities.get(id).init

    if (init > baseInit) continue
    const delta = init - baseInit
    if (mostImmediate.id == null || delta < mostImmediate.delta) {
      mostImmediate.id = id
      mostImmediate.init = init
      mostImmediate.delta = delta
    }
  }
  return mostImmediate.id
}

/**
 * Prettifies the provided timestamp which is expected to be in nanoseconds.
 *
 * @name utils.prettyNs
 * @function
 * @param {number} ns timestamp in nanoseconds
 * @return {Object.<string, number>} an object with an `ms` property which is the prettified version
 * of the provided timestamp in milliseconds and `ns`, the originally passed timestamp.
 */
const prettyNs = exports.prettyNs = function prettyNs(ns) {
  return { ms: prettyMs(ns * 1E-6, { msDecimalDigits: 2 }), ns }
}

/**
 * Safely extracts the `val` property from the object `x`.
 *
 * @name utils.safeGetVal
 * @function
 * @param {Object} x the object which has the `val` property
 * @return the `val` property if `x` was defined, otherwise `null`
 */
exports.safeGetVal = function safeGetVal(x) {
  return x == null ? null : x.val
}

exports.safeFirstStamp = function safeFirstStamp(x) {
  if (x == null || x.length === 0 || x[0] == null) return prettyNs(0)
  return prettyNs(x[0])
}

function isUserFunction(fn) {
  // TODO: how does this work on windows?
  return fn.info.file.startsWith('/')
}

function functionName(info) {
  if (info.name != null && info.name.length > 0) return info.name
  if (info.inferredName != null && info.inferredName.length > 0) return info.name
  return '<Unknown>'
}

function stringifyPath(path, pathPrefix) {
  let p = pathPrefix
  if (path == null) return p
  for (let i = 0; i < path.length; i++) {
    const prop = path[i]
    if (isNaN(prop)) {
      p = `${p}.${prop}`
    } else {
      // if property name is a number we assume it is an array index
      p = `${p}[${prop}]`
    }
  }
  return p
}

/**
 * Identifies all user functions within the given functions, adds location and
 * propertyPath strings and returns the result.
 *
 * The `propertyPath` is deduced from the `path` array.
 *
 * If a user function is found twice it will only be included once.
 *
 * @name utils.uniqueUserFunctions
 * @function
 * @param {Array.<Object>} fns all functions found attached to a particular async resource
 * @param {Object} $0 options
 * @param {string} [$0.pathPrefix='root'] prefix used for the property paths
 * @return {Array.<Object>} all user functions with the above mentioned details added
 */
exports.uniqueUserFunctions = function uniqueUserFunctions(fns, { pathPrefix = 'root' } = {}) {
  const userFunctions = new Map()
  if (fns == null) return userFunctions
  for (let i = 0; i < fns.length; i++) {
    const fn = fns[i]
    if (!isUserFunction(fn)) continue
    const info = fn.info
    const name = functionName(info)
    // using location as unique id as well
    const location = `${name} (${info.file}:${info.line}:${info.column})`
    const propertyPath = stringifyPath(fn.path, pathPrefix)
    const args = fn.arguments
    userFunctions.set(location, Object.assign({}, info, { location, propertyPath, args }))
  }
  return Array.from(userFunctions.values())
}

function omit(omitKey, obj) {
  return Object.keys(obj).reduce((acc, k) => {
    if (k === omitKey) return acc
    acc[k] = obj[k]
    return acc
  }, {})
}

/**
 * Pulls user functions from all resources of the provided info and attaches
 * them as the `userFunctions` property to the info object directly.
 *
 * As a result, instead of having a `userFunctions` array on each resource
 * we end up with just one on the info object.
 *
 * @name utils.separateUserFunctions
 * @function
 * @param {Object} info the info object which references the resources
 */
exports.separateUserFunctions = function separateUserFunctions(info) {
  const keys = Object.keys(info)
  const fns = keys
    .map(k => info[k].userFunctions)
    .filter(x => x != null)
    .reduce((acc, fn) => acc.concat(fn), [])

  const newInfo = keys.reduce((acc, k) => {
    const val = info[k]
    acc[k] = typeof val === 'object' && val.userFunctions != null
      ? omit('userFunctions', info[k])
      : val
    return acc
  }, {})

  newInfo.userFunctions = fns
  return newInfo
}

function merge(fn1, fn2) {
  fn1.propertyPaths.push(fn2.propertyPath)

  if (fn1.args == null && fn2.args != null) {
    fn1.args = fn2.args
  }

  if ((fn1.name == null || fn1.name.length === 0) &&
      (fn2.name != null && fn2.name.length > 0)) {
    fn1.name = fn2.name
  }

  if ((fn1.inferredName == null || fn1.inferredName.length === 0) &&
      (fn2.inferredName != null && fn2.inferredName.length > 0)) {
    fn1.inferredName = fn2.inferredName
  }
  return fn1
}

/**
 * Merges the `userFunctions` found on the `info` object, such that all functions
 * with the same `location` property are represented as one.
 *
 * As the result the `propertyPath` array is removed from all functions and replaced
 * with the `propertyPaths` array which combines the `propertyPath`s of all functions
 * that matched the `location`.
 *
 * @name utils.mergeUserFunctions
 * @function
 * @param {Object} info the object that references the `userFunctions` property
 */
exports.mergeUserFunctions = function mergeUserFunctions(info) {
  // Walk through all the functions and index them by `location`
  // When we encounter two functions with the same `location` we  merge them.
  const fns = new Map()

  for (let i = 0; i < info.userFunctions.length; i++) {
    const fn = info.userFunctions[i]
    const id = fn.location
    if (fns.has(id)) {
      const previousFn = fns.get(id)
      fns.set(id, merge(previousFn, fn))
    } else {
      const addPaths = Object.assign({}, fn, { propertyPaths: [ fn.propertyPath ] })
      const rmPath = omit('propertyPath', addPaths)
      fns.set(id, rmPath)
    }
  }
  return Object.assign({}, info, { userFunctions: Array.from(fns.values()) })
}
