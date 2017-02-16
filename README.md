# ah-fs.processor [![build status](https://secure.travis-ci.org/nodesource/ah-fs.processor.png)](http://travis-ci.org/nodesource/ah-fs.processor)

Processes ah-fs data obtained from async resources related to file system opearations.

## Installation

    npm install ah-fs.processor

## [API](https://nodesource.github.io/ah-fs.processor)

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### ReadFileProcessor

Instantiates an fs.readFile data processor to process data collected via
[nodesource/ah-fs](https://github.com/nodesource/ah-fs)

**Parameters**

-   `$0` **[Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)** 
-   `includeActivities` **[boolean](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Boolean)?** if `true` the actual activities are appended to the output (optional, default `false`)

### readFileProcessor.process

Processes the supplied async activities and splits them into
groups, each representing a file read `fs.readFile`

If no file read was encountered the groups are empty.

All **execution** data contains four timestamps:

-   **triggered** when was this activity triggered from another one, i.e.
    `stat` is triggered by `open` (this timestamp is not available for `open`)
-   **initialized** when was the resource initialized, i.e. its `init` hook fired
-   **completed** when did the async activity complete and gave control back to the
    activity that triggered it (this timestamp is not available for `open`)
-   **destroyed** when was the resource destroyed, i.e. its `destroy` hook fired
    Each group has the following properties:

-   **execution**: information about the execution of the various
    file system operations involved in reading the file
-   **open**: contains data about opening the file
-   **stat**: contains data about getting file stats
-   **read**: contains data about reading the file
-   **close**: contains data about closing the file

-   **calledBy**: provides the line of code that called `fs.readFile` only
    available if stacks were captured
-   **callback**: provides information about the callback that was registered
    for the `fs.readFile` call and has the following properties
    -   **name**: the function name
    -   **location**: the file and line + column where the callback was defined
    -   **arguments**: the `err` and information about the `src` that was
        read. This property is only available _if_ and it's structure depends on
        _how_ arguments were captured.

Returns **[Object](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object)** information about `fs.readFile` operations with the
structure outlined above

### ReadFileProcessor.operationSteps

The number of steps involved to execute `fs.readFile`.

This can be used by higher level processors to group
activities looking for larger operations first and then
operations involving less steps.

## License

MIT
