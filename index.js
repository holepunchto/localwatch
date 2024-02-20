const fs = require('fs')
const path = require('path')
const { Readable } = require('streamx')
const { isLinux } = require('which-runtime')

class TreeEntry {
  constructor (stat, ignore) {
    this.watcher = null
    this.stat = stat
    this.entries = null
    this.tick = 0
    this.ignore = ignore
  }

  watch (filename, onchange) {
    if (this.watcher || this.ignore) return
    this.watcher = fs.watch(filename, { recursive: !isLinux }, (_, sub) => onchange(path.join(filename, sub)))
  }

  update (filename, stat, diff) {
    if (this.stat && this.stat.mtime.getTime() === stat.mtime.getTime()) return
    if (this.stat && this.stat.isDirectory() !== stat.isDirectory()) this.clearAll(filename, diff)
    this.stat = stat
    if (!this.stat.isDirectory()) diff.push({ type: 'update', filename })
  }

  * list (filename) {
    yield [filename, this]
    if (!this.entries) return
    for (const [name, val] of this.entries) {
      yield * val.list(path.join(filename, name))
    }
  }

  ignoreAll () {
    for (const [, node] of this.list('')) {
      node.ignore = true
    }
    this.clearAll('', [])
  }

  clearAll (filename, diff) {
    for (const [entryFilename, node] of this.list(filename)) {
      if (node.watcher) node.watcher.close()
      node.watcher = null
      if (node.entries) continue
      if (!node.ignore) diff.push({ type: 'delete', filename: entryFilename })
    }
    this.entries = null
  }

  get (name) {
    return (this.entries && this.entries.get(name)) || null
  }

  del (filename, name, diff) {
    if (this.entries === null) return

    const existing = this.entries.get(name)
    if (!existing) return

    this.entries.delete(name)
    existing.clearAll(path.join(filename, name), diff)
  }

  put (filename, name, stat, diff, ignore) {
    if (this.entries === null) this.entries = new Map()

    const existing = this.entries.get(name)

    if (existing) {
      if (ignore) existing.ignoreAll()
      else existing.update(filename, stat, diff)
      return existing
    }

    const node = new TreeEntry(stat, ignore)
    this.entries.set(name, node)

    if (!stat.isDirectory() && !node.ignore) diff.push({ type: 'update', filename })

    return node
  }
}

module.exports = class Localwatch extends Readable {
  constructor (root, { filter = defaultFilter, relative = false } = {}) {
    super({ highWaterMark: 0 }) // disable readahead

    this.root = path.resolve('.', root)

    this._tree = new TreeEntry(null, false)
    this._tick = 1
    this._checks = new Set()
    this._readCallback = null
    this._filter = filter
    this._relative = relative
    this._onchangeBound = this._onchange.bind(this)
  }

  static defaultFilter = defaultFilter

  async _open (cb) {
    try {
      await this._walkDirectory(this._tree, this.root, [])
    } catch (err) {
      return cb(err)
    }

    this._tree.watch(this.root, this._onchangeBound)
    cb(null)
  }

  async _read (cb) {
    if (this._checks.size === 0) {
      this._readCallback = cb
      return
    }

    const checks = this._checks
    const diff = []

    this._checks = new Set()
    this._tick++

    try {
      for (const check of checks) await this._check(check, diff)
    } catch (err) {
      return cb(err)
    }

    if (diff.length) {
      if (this._relative) {
        for (const d of diff) d.filename = '.' + d.filename.slice(this.root.length)
      }
      this.push(diff)
      return cb(null)
    }

    this._read(cb)
  }

  _predestroy () {
    if (this._readCallback) {
      const cb = this._readCallback
      this._readCallback = null
      cb(null)
    }
  }

  _destroy (cb) {
    this._tree.clearAll(this.root, [])
    cb(null)
  }

  * watching () {
    for (const [filename] of this._tree.list(this.root)) yield filename
  }

  ignore (entry) {
    entry = path.resolve(this.root, entry)
    if (!isRooted(this.root, entry)) return
    const [nodeEntry, node] = this._getClosestNode(entry)
    if (nodeEntry === entry) node.ignoreAll()
  }

  _onchange (entry) {
    this._checks.add(entry)
    if (!this._readCallback) return
    const cb = this._readCallback
    this._readCallback = null
    this._read(cb)
  }

  _getClosestNode (entry) {
    const parts = entry.slice(this.root.length).split(/[\\/]/)

    let parent = null
    let node = this._tree
    let sub = ''

    for (const p of parts) {
      if (p === '') continue
      const next = node.get(p)
      if (!next) break
      parent = node
      node = next
      sub += '/' + p
    }

    const nodeEntry = path.join(this.root, sub)
    return [nodeEntry, node, parent]
  }

  async _check (entry, diff) {
    const [nodeEntry, node, parent] = this._getClosestNode(entry)
    if (node.ignore) return

    const stat = await lstat(nodeEntry)

    if (stat === null) {
      if (!parent) return // root can't virtually be deleted ever
      const name = path.basename(nodeEntry)
      const parentEntry = path.dirname(nodeEntry)
      parent.del(parentEntry, name, diff)
    } else if (stat.isDirectory()) {
      await this._walkDirectory(node, nodeEntry, diff)
    } else {
      node.update(nodeEntry, stat, diff)
    }
  }

  async _walkDirectory (node, nodeEntry, diff) {
    if (node.tick === this._tick) return
    node.tick = this._tick

    for (const name of await readdir(nodeEntry)) {
      const entry = path.join(nodeEntry, name)
      const stat = await lstat(entry)

      if (stat === null) {
        node.del(entry, name, diff)
        continue
      }

      const ignore = !this._filter(entry, this)
      if (node.ignore) return // side-effect check

      const child = node.put(entry, name, stat, diff, ignore)
      if (!stat.isDirectory() || ignore) continue

      if (isLinux) child.watch(entry, this._onchangeBound)
      await this._walkDirectory(child, entry, diff)
    }
  }
}

async function readdir (entry) {
  try {
    return await fs.promises.readdir(entry)
  } catch {
    return []
  }
}

async function lstat (entry) {
  try {
    return await fs.promises.lstat(entry)
  } catch {
    return null
  }
}

function isRooted (root, filename) {
  if (filename === root) return true
  return filename.startsWith(root + path.sep)
}

function defaultFilter (filename, stream) {
  if (/[/\\]cores[/\\][0-9a-f]{2}[/\\][0-9a-f]{2}[/\\][0-9a-f]{64}$/i.test(filename)) {
    if (stream) stream.ignore(filename.slice(0, -77))
    return false
  }

  if (/[/\\]\.git$/i.test(filename)) {
    return false
  }

  return true
}
