const test = require('brittle')
const fs = require('fs')
const path = require('path')
const tmp = require('test-tmp')
const Localwatch = require('localwatch')

test('basic', async function (t) {
  const fixture = await tmp(t)
  const w = new Localwatch(fixture)

  const expected = [
    [{ type: 'update', filename: path.join(fixture, 'foo') }],
    [{ type: 'update', filename: path.join(fixture, 'foo') }, { type: 'update', filename: path.join(fixture, 'bar') }],
    [{ type: 'update', filename: path.join(fixture, 'a/b/c/d/file') }],
    [{ type: 'update', filename: path.join(fixture, 'a/b/c/d/file') }, { type: 'update', filename: path.join(fixture, 'a/b/file') }],
    [{ type: 'delete', filename: path.join(fixture, 'a/b/c/d/file') }, { type: 'delete', filename: path.join(fixture, 'a/b/file') }]
  ]
  const runs = expected.length

  w.opened.then(async function () {
    await fs.promises.writeFile(path.join(fixture, 'foo'), 'foo')
  })

  for await (const diff of w) {
    t.alike(diff.sort(cmp), expected.shift().sort(cmp))

    switch (runs - expected.length) {
      case 1: {
        await fs.promises.writeFile(path.join(fixture, 'foo'), 'foo')
        await fs.promises.writeFile(path.join(fixture, 'bar'), 'bar')
        break
      }

      case 2: {
        await fs.promises.mkdir(path.join(fixture, 'a/b/c/d'), { recursive: true })
        await fs.promises.writeFile(path.join(fixture, 'a/b/c/d/file'), 'file')
        break
      }

      case 3: {
        await fs.promises.writeFile(path.join(fixture, 'a/b/c/d/file'), 'file')
        await fs.promises.writeFile(path.join(fixture, 'a/b/file'), 'file')
        break
      }

      case 4: {
        await fs.promises.rm(path.join(fixture, 'a'), { recursive: true })
        break
      }
    }

    if (expected.length === 0) break
  }
})

function cmp (a, b) {
  const k1 = a.type + '@' + a.filename
  const k2 = b.type + '@' + b.filename
  return k1 < k2 ? -1 : k1 > k2 ? 1 : 0
}
