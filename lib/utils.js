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
 * Prettifies the provided timestamp which is expected to be in nanoseconds.
 *
 * @name utils.prettyNs
 * @function
 * @param {number} ns timestamp in nanoseconds
 * @return {Object.<string, number>} an object with an `ms` property which is the prettified version
 * of the provided timestamp in milliseconds and `ns`, the originally passed timestamp.
 */
exports.prettyNs = function prettyNs(ns) {
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
    userFunctions.set(location, Object.assign({}, info, { location, propertyPath }))
  }
  return Array.from(userFunctions.values())
}
