# localwatch

Watch a directory and get a diff of changes

```
npm install localwatch
```

## Usage

``` js
const Localwatch = require('localwatch')

 // watch a dir
const watch = new Localwatch('./my/dir')

// watch is a readable stream

for await (const diff of watch) {
  // diff is the next batch of changes
  // [{ type: update|delete, filename }, ...]
}
```

## API

#### `stream = new Localwatch(dir, [options])`

Make a watch stream.

Options include

```js
{
  // function that returns true if it should watch it, defaults to ignoring .git and corestores
  filter (filename, stream) { ... },
  // use relative paths in the diff
  relative: false
}
```

The stream yields diffs which look like this

```js
[{
  type: 'update' || 'delete',
  filename
}, {
  ...
}]
```

The diff reflects the changes that happens since the last yield

#### `Localwatch.defaultFilter(filename, [stream])`

Does the default filter. Useful if you wanna expand on the defaults.

## License

Apache-2.0
