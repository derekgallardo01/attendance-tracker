// Minimal in-memory Firestore stand-in for unit tests.
// Implements the subset of the Node Firestore SDK that our code actually
// uses: doc/collection/get/set/add/where/create with merge semantics,
// FieldValue.serverTimestamp/increment/arrayUnion, and Timestamp.toDate().
//
// Usage in a test file:
//   const { installFirestoreMock } = require('../helpers/firestoreMock');
//   beforeEach(() => { ctx = installFirestoreMock(); });
//   afterEach(() => { ctx.uninstall(); });
//
// `ctx.seed(path, data)` writes a doc at the given slash-path; `ctx.read(path)`
// returns its data. `ctx.docs` exposes the raw store for snapshot assertions.

const path = require('path');

let SERVER_TS_COUNTER = 0;
function makeServerTimestamp() {
  // Each invocation returns a unique Date so ordering tests can rely on it.
  const t = new Date(Date.UTC(2026, 0, 1) + (++SERVER_TS_COUNTER) * 1000);
  return t;
}

function wrapTimestamp(d) {
  // Firestore Timestamp objects expose .toDate(); our code uses that.
  if (!d) return d;
  if (typeof d.toDate === 'function') return d;
  if (d instanceof Date) {
    return { _date: d, toDate: () => d, _seconds: Math.floor(d.getTime() / 1000), _nanoseconds: 0 };
  }
  return d;
}

function deepUnwrapTimestamps(v) {
  // No-op pass-through — values are stored as wrapped already
  return v;
}

class MockSnapshot {
  constructor(id, ref, data) {
    this.id = id;
    this.ref = ref;
    this._data = data;
    this.exists = data !== undefined;
  }
  data() { return this._data === undefined ? undefined : { ...this._data }; }
}

class MockDocRef {
  constructor(store, segments) {
    this._store = store;
    this._segments = segments;
    this.id = segments[segments.length - 1];
    this.path = segments.join('/');
    this.parent = { parent: segments.length >= 3 ? new MockDocRef(store, segments.slice(0, -2)) : null };
  }
  collection(name) {
    return new MockCollectionRef(this._store, [...this._segments, name]);
  }
  async get() {
    const data = this._store.docs.get(this.path);
    return new MockSnapshot(this.id, this, data ? { ...data } : undefined);
  }
  async set(data, opts) {
    const resolved = resolveFieldValues(data, this._store.docs.get(this.path));
    if (opts?.merge) {
      const prev = this._store.docs.get(this.path) || {};
      this._store.docs.set(this.path, { ...prev, ...resolved });
    } else {
      this._store.docs.set(this.path, { ...resolved });
    }
    return { writeTime: makeServerTimestamp() };
  }
  async create(data) {
    if (this._store.docs.has(this.path)) {
      const err = new Error('Already exists');
      err.code = 6; // gRPC ALREADY_EXISTS
      throw err;
    }
    const resolved = resolveFieldValues(data, undefined);
    this._store.docs.set(this.path, { ...resolved });
    return { writeTime: makeServerTimestamp() };
  }
  async update(data) {
    const prev = this._store.docs.get(this.path);
    if (!prev) {
      const err = new Error('Not found');
      err.code = 5;
      throw err;
    }
    const resolved = resolveFieldValues(data, prev);
    this._store.docs.set(this.path, { ...prev, ...resolved });
    return { writeTime: makeServerTimestamp() };
  }
  async delete() {
    this._store.docs.delete(this.path);
    return { writeTime: makeServerTimestamp() };
  }
}

class MockQuery {
  constructor(store, segments, filters, limit) {
    this._store = store;
    this._segments = segments;
    this._filters = filters || [];
    this._limit = limit || null;
  }
  where(field, op, value) {
    return new MockQuery(this._store, this._segments, [...this._filters, { field, op, value }], this._limit);
  }
  limit(n) {
    return new MockQuery(this._store, this._segments, this._filters, n);
  }
  orderBy(/* field, direction */) {
    // Pass through — our tests don't assert ordering at the Firestore layer.
    return this;
  }
  count() {
    // Mirror the SDK aggregate query: query.count().get() → snap.data().count
    const self = this;
    return { async get() { const s = await self.get(); return { data: () => ({ count: s.size }) }; } };
  }
  async get() {
    // Match all docs under this collection path
    const colPath = this._segments.join('/');
    const prefix = colPath + '/';
    const docs = [];
    for (const [docPath, data] of this._store.docs) {
      if (!docPath.startsWith(prefix)) continue;
      // Direct children only — no nested subcollection docs
      const remainder = docPath.slice(prefix.length);
      if (remainder.includes('/')) continue;
      if (!this._filters.every(f => applyFilter(data, f))) continue;
      const id = remainder;
      const ref = new MockDocRef(this._store, [...this._segments, id]);
      docs.push(new MockSnapshot(id, ref, { ...data }));
      if (this._limit && docs.length >= this._limit) break;
    }
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

// collectionGroup queries walk every doc whose parent collection segment
// matches the given name, regardless of where they live in the path tree.
// Supports the same where/limit chaining as MockQuery.
class MockCollectionGroupQuery {
  constructor(store, name, filters, limit) {
    this._store = store;
    this._name = name;
    this._filters = filters || [];
    this._limit = limit || null;
  }
  where(field, op, value) {
    return new MockCollectionGroupQuery(this._store, this._name, [...this._filters, { field, op, value }], this._limit);
  }
  limit(n) {
    return new MockCollectionGroupQuery(this._store, this._name, this._filters, n);
  }
  orderBy() { return this; }
  count() {
    const self = this;
    return { async get() { const s = await self.get(); return { data: () => ({ count: s.size }) }; } };
  }
  async get() {
    const docs = [];
    for (const [docPath, data] of this._store.docs) {
      const segs = docPath.split('/');
      if (segs.length < 2) continue;
      // The parent-collection segment is the second-to-last (e.g.
      // tenants/x/users/y → "users"). Match against the requested name.
      if (segs[segs.length - 2] !== this._name) continue;
      if (!this._filters.every(f => applyFilter(data, f))) continue;
      const ref = new MockDocRef(this._store, segs);
      docs.push(new MockSnapshot(segs[segs.length - 1], ref, { ...data }));
      if (this._limit && docs.length >= this._limit) break;
    }
    return { empty: docs.length === 0, size: docs.length, docs };
  }
}

class MockCollectionRef extends MockQuery {
  constructor(store, segments) {
    super(store, segments, []);
  }
  doc(id) {
    return new MockDocRef(this._store, [...this._segments, id]);
  }
  async add(data) {
    const id = 'auto_' + (++this._store.autoCounter);
    const ref = this.doc(id);
    await ref.set(data);
    return ref;
  }
}

function applyFilter(data, { field, op, value }) {
  const v = getField(data, field);
  if (op === '==') return v === value;
  if (op === '!=') return v !== value;
  if (op === '<') return v < value;
  if (op === '<=') return v <= value;
  if (op === '>') return v > value;
  if (op === '>=') return v >= value;
  if (op === 'in') return Array.isArray(value) && value.includes(v);
  if (op === 'array-contains') return Array.isArray(v) && v.includes(value);
  return true;
}

function getField(data, field) {
  if (!field.includes('.')) return data?.[field];
  return field.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
}

// Sentinel detection — our code uses these field values.
const SERVER_TIMESTAMP = Symbol('serverTimestamp');
function isIncrement(v) { return v && v.__type === 'increment'; }
function isArrayUnion(v) { return v && v.__type === 'arrayUnion'; }
function isServerTs(v) { return v === SERVER_TIMESTAMP; }

function resolveFieldValues(data, prev) {
  // Walk one level deep — sufficient for everything our code does. Replaces
  // sentinel values with concrete data (timestamps, incremented numbers,
  // unioned arrays).
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (isServerTs(v)) out[k] = wrapTimestamp(makeServerTimestamp());
    else if (isIncrement(v)) out[k] = (prev?.[k] || 0) + v.value;
    else if (isArrayUnion(v)) {
      const existing = Array.isArray(prev?.[k]) ? prev[k] : [];
      const merged = [...existing];
      for (const item of v.values) if (!merged.includes(item)) merged.push(item);
      out[k] = merged;
    }
    else if (v instanceof Date) out[k] = wrapTimestamp(v);
    else out[k] = v;
  }
  return out;
}

// The mock FieldValue exposed via the mocked module — our code calls e.g.
// FieldValue.serverTimestamp(), so this needs to be a function-returning-sentinel.
const MockFieldValue = {
  serverTimestamp: () => SERVER_TIMESTAMP,
  increment: (n) => ({ __type: 'increment', value: n }),
  arrayUnion: (...values) => ({ __type: 'arrayUnion', values }),
};

class MockBatch {
  constructor(store) { this._store = store; this._ops = []; }
  set(ref, data, opts) { this._ops.push(() => ref.set(data, opts)); return this; }
  update(ref, data) { this._ops.push(() => ref.update(data)); return this; }
  delete(ref) { this._ops.push(() => ref.delete()); return this; }
  async commit() { for (const op of this._ops) await op(); }
}

class MockFirestore {
  constructor(store) { this._store = store; }
  collection(name) { return new MockCollectionRef(this._store, [name]); }
  collectionGroup(name) { return new MockCollectionGroupQuery(this._store, name); }
  batch() { return new MockBatch(this._store); }
  // The in-memory store is single-threaded, so a transaction is just the
  // callback run against the same doc refs. `tx.get/set/update/delete` delegate
  // straight to the ref — no isolation needed for our unit tests, which only
  // exercise the read-then-conditional-write shape.
  async runTransaction(fn) {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, data, opts) => { ref.set(data, opts); return tx; },
      update: (ref, data) => { ref.update(data); return tx; },
      delete: (ref) => { ref.delete(); return tx; },
    };
    return fn(tx);
  }
}

// Public installer — replaces @google-cloud/firestore for the rest of the
// test file. Returns a context with seed/read/clear helpers and an uninstall.
function installFirestoreMock() {
  const store = { docs: new Map(), autoCounter: 0 };
  jest.doMock('@google-cloud/firestore', () => ({
    Firestore: jest.fn(() => new MockFirestore(store)),
    FieldValue: MockFieldValue,
  }));
  // Reset cached firestore service singleton so our mock is picked up
  jest.resetModules();
  return {
    store,
    seed(docPath, data) {
      // Wrap any Date fields so toDate() works the way our production code expects
      const wrapped = {};
      for (const [k, v] of Object.entries(data)) wrapped[k] = v instanceof Date ? wrapTimestamp(v) : v;
      store.docs.set(docPath, wrapped);
    },
    read(docPath) { return store.docs.get(docPath); },
    list(colPrefix) {
      const out = [];
      const prefix = colPrefix.endsWith('/') ? colPrefix : colPrefix + '/';
      for (const [p, d] of store.docs) if (p.startsWith(prefix)) out.push({ path: p, data: d });
      return out;
    },
    uninstall() { jest.dontMock('@google-cloud/firestore'); jest.resetModules(); },
  };
}

module.exports = { installFirestoreMock, wrapTimestamp, MockFieldValue };
