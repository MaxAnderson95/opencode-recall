// @bun
// packages/plugin/src/index.ts
import { homedir as homedir3 } from "os";
import { join as join2 } from "path";
import { Plugin } from "@opencode/plugin";

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Pipeable.js
var pipeArguments = (self, args) => {
  switch (args.length) {
    case 0:
      return self;
    case 1:
      return args[0](self);
    case 2:
      return args[1](args[0](self));
    case 3:
      return args[2](args[1](args[0](self)));
    case 4:
      return args[3](args[2](args[1](args[0](self))));
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))));
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
    case 8:
      return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
    case 9:
      return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
    default: {
      let ret = self;
      for (let i = 0, len = args.length;i < len; i++) {
        ret = args[i](ret);
      }
      return ret;
    }
  }
};
var Prototype = {
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var Class = /* @__PURE__ */ function() {
  function PipeableBase() {}
  PipeableBase.prototype = Prototype;
  return PipeableBase;
}();

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Function.js
var dual = function(arity, body) {
  if (typeof arity === "function") {
    return function() {
      return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
    };
  }
  switch (arity) {
    case 0:
    case 1:
      throw new RangeError(`Invalid arity ${arity}`);
    case 2:
      return function(a, b) {
        if (arguments.length >= 2) {
          return body(a, b);
        }
        return function(self) {
          return body(self, a);
        };
      };
    case 3:
      return function(a, b, c) {
        if (arguments.length >= 3) {
          return body(a, b, c);
        }
        return function(self) {
          return body(self, a, b);
        };
      };
    default:
      return function() {
        if (arguments.length >= arity) {
          return body.apply(this, arguments);
        }
        const args = arguments;
        return function(self) {
          return body(self, ...args);
        };
      };
  }
};
var identity = (a) => a;
var constant = (value) => () => value;
var constTrue = /* @__PURE__ */ constant(true);
var constFalse = /* @__PURE__ */ constant(false);
var constUndefined = /* @__PURE__ */ constant(undefined);
var constVoid = constUndefined;
function flow(ab, bc, cd, de, ef, fg, gh, hi, ij) {
  switch (arguments.length) {
    case 1:
      return ab;
    case 2:
      return function() {
        return bc(ab.apply(this, arguments));
      };
    case 3:
      return function() {
        return cd(bc(ab.apply(this, arguments)));
      };
    case 4:
      return function() {
        return de(cd(bc(ab.apply(this, arguments))));
      };
    case 5:
      return function() {
        return ef(de(cd(bc(ab.apply(this, arguments)))));
      };
    case 6:
      return function() {
        return fg(ef(de(cd(bc(ab.apply(this, arguments))))));
      };
    case 7:
      return function() {
        return gh(fg(ef(de(cd(bc(ab.apply(this, arguments)))))));
      };
    case 8:
      return function() {
        return hi(gh(fg(ef(de(cd(bc(ab.apply(this, arguments))))))));
      };
    case 9:
      return function() {
        return ij(hi(gh(fg(ef(de(cd(bc(ab.apply(this, arguments)))))))));
      };
  }
  return;
}
function memoize(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    return result;
  };
}
function memoizeIdempotent(f) {
  const cache = new WeakMap;
  return (a) => {
    const cached = cache.get(a);
    if (cached !== undefined)
      return cached;
    const result = f(a);
    cache.set(a, result);
    cache.set(result, result);
    return result;
  };
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/equal.js
var getAllObjectKeys = (obj) => {
  const keys = new Set(Reflect.ownKeys(obj));
  if (obj.constructor === Object)
    return keys;
  if (obj instanceof Error) {
    keys.delete("stack");
  }
  const proto = Object.getPrototypeOf(obj);
  let current = proto;
  while (current !== null && current !== Object.prototype) {
    const ownKeys = Reflect.ownKeys(current);
    for (let i = 0;i < ownKeys.length; i++) {
      keys.add(ownKeys[i]);
    }
    current = Object.getPrototypeOf(current);
  }
  if (keys.has("constructor") && typeof obj.constructor === "function" && proto === obj.constructor.prototype) {
    keys.delete("constructor");
  }
  return keys;
};
var byReferenceInstances = /* @__PURE__ */ new WeakSet;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Predicate.js
function isString(input) {
  return typeof input === "string";
}
function isNumber(input) {
  return typeof input === "number";
}
function isBoolean(input) {
  return typeof input === "boolean";
}
function isFunction(input) {
  return typeof input === "function";
}
function isNotNullish(input) {
  return input != null;
}
function isUnknown(_) {
  return true;
}
function isObject(input) {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
function isObjectKeyword(input) {
  return typeof input === "object" && input !== null || isFunction(input);
}
var hasProperty = /* @__PURE__ */ dual(2, (self, property) => isObjectKeyword(self) && (property in self));
var isTagged = /* @__PURE__ */ dual(2, (self, tag) => hasProperty(self, "_tag") && self["_tag"] === tag);
function isError(input) {
  return input instanceof Error;
}
function isIterable(input) {
  return hasProperty(input, Symbol.iterator) || isString(input);
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Hash.js
var symbol = "~effect/Hash";
var hash = (self) => {
  switch (typeof self) {
    case "number":
      return number(self);
    case "bigint":
      return string(self.toString(10));
    case "string":
      return string(self);
    case "undefined":
      return string("undefined");
    case "function":
    case "object": {
      if (self === null) {
        return string("null");
      } else if (self instanceof Date) {
        if (Number.isNaN(self.getTime())) {
          return string("Invalid Date");
        }
        return string(self.toISOString());
      } else if (self instanceof RegExp) {
        return string(self.toString());
      } else {
        if (byReferenceInstances.has(self)) {
          return random(self);
        }
        if (hashCache.has(self)) {
          return hashCache.get(self);
        }
        const h = withVisitedTracking(self, () => {
          if (isHash(self)) {
            return self[symbol]();
          } else if (typeof self === "function") {
            return random(self);
          } else if (self instanceof DataView) {
            return array(new Uint8Array(self.buffer, self.byteOffset, self.byteLength));
          } else if (Array.isArray(self) || ArrayBuffer.isView(self)) {
            return array(self);
          } else if (self instanceof Map) {
            return hashMap(self);
          } else if (self instanceof Set) {
            return hashSet(self);
          }
          return structure(self);
        });
        hashCache.set(self, h);
        return h;
      }
    }
    default:
      return string(String(self));
  }
};
var random = (self) => {
  if (!randomHashCache.has(self)) {
    randomHashCache.set(self, number(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
  }
  return randomHashCache.get(self);
};
var combine = /* @__PURE__ */ dual(2, (self, b) => self * 53 ^ b);
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
var isHash = (u) => hasProperty(u, symbol);
var number = (n) => {
  if (n !== n || n === Infinity || n === -Infinity) {
    return string(String(n));
  }
  let h = n | 0;
  if (h !== n) {
    h ^= n * 4294967295;
  }
  while (n > 4294967295) {
    h ^= n /= 4294967295;
  }
  return optimize(h);
};
var string = (str) => {
  let h = 5381, i = str.length;
  while (i) {
    h = h * 33 ^ str.charCodeAt(--i);
  }
  return optimize(h);
};
var structureKeys = (o, keys) => {
  let h = 12289;
  for (const key of keys) {
    h ^= combine(hash(key), hash(o[key]));
  }
  return optimize(h);
};
var structure = (o) => structureKeys(o, getAllObjectKeys(o));
var iterableWith = (seed, f) => (iter) => {
  let h = seed;
  for (const element of iter) {
    h ^= f(element);
  }
  return optimize(h);
};
var array = /* @__PURE__ */ iterableWith(6151, hash);
var hashMap = /* @__PURE__ */ iterableWith(/* @__PURE__ */ string("Map"), ([k, v]) => combine(hash(k), hash(v)));
var hashSet = /* @__PURE__ */ iterableWith(/* @__PURE__ */ string("Set"), hash);
var randomHashCache = /* @__PURE__ */ new WeakMap;
var hashCache = /* @__PURE__ */ new WeakMap;
var visitedObjects = /* @__PURE__ */ new WeakSet;
function withVisitedTracking(obj, fn) {
  if (visitedObjects.has(obj)) {
    return string("[Circular]");
  }
  visitedObjects.add(obj);
  const result = fn();
  visitedObjects.delete(obj);
  return result;
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Equal.js
var symbol2 = "~effect/Equal";
function equals() {
  if (arguments.length === 1) {
    return (self) => compareBoth(self, arguments[0]);
  }
  return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
  if (self === that)
    return true;
  if (self == null || that == null)
    return false;
  const selfType = typeof self;
  if (selfType !== typeof that) {
    return false;
  }
  if (selfType === "number" && self !== self && that !== that) {
    return true;
  }
  if (selfType !== "object" && selfType !== "function") {
    return false;
  }
  if (byReferenceInstances.has(self) || byReferenceInstances.has(that)) {
    return false;
  }
  return withCache(self, that, compareObjects);
}
function withVisitedTracking2(self, that, fn) {
  const hasLeft = visitedLeft.has(self);
  const hasRight = visitedRight.has(that);
  if (hasLeft && hasRight) {
    return true;
  }
  if (hasLeft || hasRight) {
    return false;
  }
  visitedLeft.add(self);
  visitedRight.add(that);
  const result = fn();
  visitedLeft.delete(self);
  visitedRight.delete(that);
  return result;
}
var visitedLeft = /* @__PURE__ */ new WeakSet;
var visitedRight = /* @__PURE__ */ new WeakSet;
function compareObjects(self, that) {
  if (hash(self) !== hash(that)) {
    return false;
  } else if (self instanceof Date) {
    if (!(that instanceof Date))
      return false;
    const selfTime = self.getTime();
    const thatTime = that.getTime();
    return selfTime === thatTime || Number.isNaN(selfTime) && Number.isNaN(thatTime);
  } else if (self instanceof RegExp) {
    if (!(that instanceof RegExp))
      return false;
    return self.toString() === that.toString();
  }
  const selfIsEqual = isEqual(self);
  const thatIsEqual = isEqual(that);
  if (selfIsEqual !== thatIsEqual)
    return false;
  const bothEquals = selfIsEqual && thatIsEqual;
  if (typeof self === "function" && !bothEquals) {
    return false;
  }
  return withVisitedTracking2(self, that, () => {
    if (bothEquals) {
      return self[symbol2](that);
    } else if (Array.isArray(self)) {
      if (!Array.isArray(that) || self.length !== that.length) {
        return false;
      }
      return compareArrays(self, that);
    } else if (ArrayBuffer.isView(self)) {
      const selfIsDataView = self instanceof DataView;
      if (!ArrayBuffer.isView(that) || self.byteLength !== that.byteLength || selfIsDataView !== that instanceof DataView) {
        return false;
      }
      if (selfIsDataView) {
        const thatDataView = that;
        return compareTypedArrays(new Uint8Array(self.buffer, self.byteOffset, self.byteLength), new Uint8Array(thatDataView.buffer, thatDataView.byteOffset, thatDataView.byteLength));
      }
      return compareTypedArrays(self, that);
    } else if (self instanceof Map) {
      if (!(that instanceof Map) || self.size !== that.size) {
        return false;
      }
      return compareMaps(self, that);
    } else if (self instanceof Set) {
      if (!(that instanceof Set) || self.size !== that.size) {
        return false;
      }
      return compareSets(self, that);
    }
    return compareRecords(self, that);
  });
}
function withCache(self, that, f) {
  let selfMap = equalityCache.get(self);
  if (!selfMap) {
    selfMap = new WeakMap;
    equalityCache.set(self, selfMap);
  } else if (selfMap.has(that)) {
    return selfMap.get(that);
  }
  const result = f(self, that);
  selfMap.set(that, result);
  let thatMap = equalityCache.get(that);
  if (!thatMap) {
    thatMap = new WeakMap;
    equalityCache.set(that, thatMap);
  }
  thatMap.set(self, result);
  return result;
}
var equalityCache = /* @__PURE__ */ new WeakMap;
function compareArrays(self, that) {
  for (let i = 0;i < self.length; i++) {
    if (!compareBoth(self[i], that[i])) {
      return false;
    }
  }
  return true;
}
function compareTypedArrays(self, that) {
  if (self.length !== that.length) {
    return false;
  }
  for (let i = 0;i < self.length; i++) {
    if (self[i] !== that[i]) {
      return false;
    }
  }
  return true;
}
function compareRecords(self, that) {
  const selfKeys = getAllObjectKeys(self);
  const thatKeys = getAllObjectKeys(that);
  if (selfKeys.size !== thatKeys.size) {
    return false;
  }
  for (const key of selfKeys) {
    if (!thatKeys.has(key) || !compareBoth(self[key], that[key])) {
      return false;
    }
  }
  return true;
}
function makeCompareMap(keyEquivalence, valueEquivalence) {
  return function compareMaps(self, that) {
    const thatEntries = Array.from(that);
    for (const [selfKey, selfValue] of self) {
      let found = false;
      for (let i = 0;i < thatEntries.length; i++) {
        const [thatKey, thatValue] = thatEntries[i];
        if (keyEquivalence(selfKey, thatKey) && valueEquivalence(selfValue, thatValue)) {
          thatEntries[i] = thatEntries[thatEntries.length - 1];
          thatEntries.pop();
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  };
}
var compareMaps = /* @__PURE__ */ makeCompareMap(compareBoth, compareBoth);
function makeCompareSet(equivalence) {
  return function compareSets(self, that) {
    const thatValues = Array.from(that);
    for (const selfValue of self) {
      let found = false;
      for (let i = 0;i < thatValues.length; i++) {
        const thatValue = thatValues[i];
        if (equivalence(selfValue, thatValue)) {
          thatValues[i] = thatValues[thatValues.length - 1];
          thatValues.pop();
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }
    return true;
  };
}
var compareSets = /* @__PURE__ */ makeCompareSet(compareBoth);
var isEqual = (u) => hasProperty(u, symbol2);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/array.js
var isArrayNonEmpty = (self) => self.length > 0;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/record.js
function assignProperty(self, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(self, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  } else {
    self[key] = value;
  }
}
function assignProperties(self, source) {
  for (const key of Reflect.ownKeys(source)) {
    if (Object.prototype.propertyIsEnumerable.call(source, key)) {
      assignProperty(self, key, source[key]);
    }
  }
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Redactable.js
var symbolRedactable = /* @__PURE__ */ Symbol.for("~effect/Redactable");
var isRedactable = (u) => hasProperty(u, symbolRedactable);
function redact(u) {
  if (isRedactable(u))
    return getRedacted(u);
  return u;
}
function getRedacted(redactable) {
  return redactable[symbolRedactable](globalThis[currentFiberTypeId]?.context ?? emptyContext);
}
var currentFiberTypeId = "~effect/Fiber/currentFiber";
var emptyMap = /* @__PURE__ */ new Map;
var emptyContext = {
  "~effect/Context": {},
  base: emptyMap,
  depth: 0,
  mapUnsafe: emptyMap,
  pipe() {
    return pipeArguments(this, arguments);
  }
};

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Formatter.js
function format(input, options) {
  const space = options?.space ?? 0;
  const ancestors = new WeakSet;
  const gap = !space ? "" : typeof space === "number" ? " ".repeat(space) : space;
  const ind = (d) => gap.repeat(d);
  const wrap = (v, body) => {
    const ctor = v?.constructor;
    return ctor && ctor !== Object.prototype.constructor && ctor.name ? `${ctor.name}(${body})` : body;
  };
  const ownKeys = (o) => {
    try {
      return Reflect.ownKeys(o);
    } catch {
      return ["[ownKeys threw]"];
    }
  };
  function recur(v, d = 0) {
    try {
      return recurUnsafe(v, d);
    } catch {
      if (typeof v === "object" && v !== null || typeof v === "function")
        ancestors.delete(v);
      return "[inspection threw]";
    }
  }
  function recurUnsafe(v, d = 0) {
    if (typeof v === "string")
      return JSON.stringify(v);
    if (typeof v === "number" || v == null || typeof v === "boolean" || typeof v === "symbol")
      return String(v);
    if (typeof v === "bigint")
      return String(v) + "n";
    if (typeof v === "object" || typeof v === "function") {
      if (ancestors.has(v))
        return CIRCULAR;
      ancestors.add(v);
      let output;
      if (symbolRedactable in v) {
        output = recur(getRedacted(v), d);
      } else if (Array.isArray(v)) {
        output = !gap || v.length <= 1 ? `[${v.map((x) => recur(x, d)).join(",")}]` : `[
${ind(d + 1)}${v.map((x) => recur(x, d + 1)).join(`,
` + ind(d + 1))}
${ind(d)}]`;
      } else if (v instanceof Date) {
        output = formatDate(v);
      } else if (!options?.ignoreToString && hasProperty(v, "toString") && typeof v["toString"] === "function" && v["toString"] !== Object.prototype.toString && v["toString"] !== Array.prototype.toString) {
        const s = safeToString(v);
        output = v instanceof Error && v.cause !== undefined ? `${s} (cause: ${recur(v.cause, d)})` : s;
      } else if (Symbol.iterator in v) {
        output = `${v.constructor.name}(${recur(Array.from(v), d)})`;
      } else {
        const keys = ownKeys(v);
        if (!gap || keys.length <= 1) {
          const body = `{${keys.map((k) => `${formatPropertyKey(k)}:${recur(safeGet(v, k), d)}`).join(",")}}`;
          output = wrap(v, body);
        } else {
          const body = `{
${keys.map((k) => `${ind(d + 1)}${formatPropertyKey(k)}: ${recur(safeGet(v, k), d + 1)}`).join(`,
`)}
${ind(d)}}`;
          output = wrap(v, body);
        }
      }
      ancestors.delete(v);
      return output;
    }
    return String(v);
  }
  return recur(input, 0);
}
var CIRCULAR = "[Circular]";
function formatPropertyKey(name) {
  return typeof name === "string" ? JSON.stringify(name) : String(name);
}
function formatPath(path) {
  return path.map((key) => `[${formatPropertyKey(key)}]`).join("");
}
function formatDate(date) {
  try {
    return date.toISOString();
  } catch {
    return "Invalid Date";
  }
}
function safeToString(input) {
  try {
    const s = input.toString();
    return typeof s === "string" ? s : String(s);
  } catch {
    return "[toString threw]";
  }
}
function safeGet(input, key) {
  try {
    return input[key];
  } catch {
    return "[property access threw]";
  }
}
function formatJson(input, options) {
  const ancestors = [];
  return JSON.stringify(input, function(key, value) {
    const original = Object.getOwnPropertyDescriptor(this, key)?.value;
    const redacted = hasProperty(original, symbolRedactable) ? redact(original) : redact(value);
    if (typeof redacted === "bigint") {
      return format(redacted);
    }
    if (typeof redacted !== "object" || redacted === null) {
      return redacted;
    }
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
      ancestors.pop();
    }
    if (ancestors.includes(redacted)) {
      return;
    }
    ancestors.push(redacted);
    return redacted;
  }, options?.space) ?? "null";
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Inspectable.js
var NodeInspectSymbol = /* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom");
var toJson = (input) => {
  try {
    input = redact(input);
    if (hasProperty(input, "toJSON") && isFunction(input["toJSON"]) && input["toJSON"].length === 0) {
      return input.toJSON();
    } else if (Array.isArray(input)) {
      return input.map(toJson);
    }
    return input;
  } catch {
    return "[toJSON threw]";
  }
};
var toStringUnknown = (u, whitespace = 2) => {
  if (typeof u === "string") {
    return u;
  }
  try {
    return typeof u === "object" ? formatJson(u, {
      space: whitespace
    }) : format(u, {
      space: whitespace
    });
  } catch {
    return String(u);
  }
};
var BaseProto = {
  toJSON() {
    return toJson(this);
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  toString() {
    return format(this.toJSON());
  }
};

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/stackTraceLimit.js
var isStackTraceLimitWritable = () => {
  const desc = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit");
  if (desc === undefined) {
    return Object.isExtensible(Error);
  }
  return Object.hasOwn(desc, "writable") ? desc.writable === true : desc.set !== undefined;
};
var canWriteStackTraceLimit = /* @__PURE__ */ isStackTraceLimitWritable();
var getStackTraceLimit = () => Error.stackTraceLimit;
var setStackTraceLimit = (value) => {
  if (canWriteStackTraceLimit) {
    Error.stackTraceLimit = value;
  }
};

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Utils.js
class SingleShotGen {
  called = false;
  self;
  constructor(self) {
    this.self = self;
  }
  next(a) {
    return this.called ? {
      value: a,
      done: true
    } : (this.called = true, {
      value: this.self,
      done: false
    });
  }
  [Symbol.iterator]() {
    return new SingleShotGen(this.self);
  }
}
var pickInternalCall = () => {
  const InternalTypeId = "~effect/Utils/internal";
  const standard = {
    [InternalTypeId]: (body) => {
      return body();
    }
  };
  const forced = {
    [InternalTypeId]: (body) => {
      try {
        return body();
      } finally {}
    }
  };
  const isNotOptimizedAway = getStackTraceLimit() !== 0 && standard[InternalTypeId](() => new Error().stack)?.includes(InternalTypeId) === true;
  return isNotOptimizedAway ? standard[InternalTypeId] : forced[InternalTypeId];
};
var internalCall = /* @__PURE__ */ pickInternalCall();

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/core.js
var EffectTypeId = `~effect/Effect`;
var ExitTypeId = `~effect/Exit`;
var effectVariance = {
  _A: identity,
  _E: identity,
  _R: identity
};
var identifier = `${EffectTypeId}/identifier`;
var args = `${EffectTypeId}/args`;
var evaluate = `${EffectTypeId}/evaluate`;
var contA = `${EffectTypeId}/successCont`;
var contE = `${EffectTypeId}/failureCont`;
var contAll = `${EffectTypeId}/ensureCont`;
var Yield = /* @__PURE__ */ Symbol.for("effect/Effect/Yield");
var PipeInspectableProto = {
  pipe() {
    return pipeArguments(this, arguments);
  },
  toJSON() {
    return {
      ...this
    };
  },
  toString() {
    return format(this.toJSON(), {
      ignoreToString: true,
      space: 2
    });
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
};
var StructuralProto = {
  [symbol]() {
    return structureKeys(this, Object.keys(this));
  },
  [symbol2](that) {
    const selfKeys = Object.keys(this);
    const thatKeys = Object.keys(that);
    if (selfKeys.length !== thatKeys.length)
      return false;
    for (let i = 0;i < selfKeys.length; i++) {
      if (selfKeys[i] !== thatKeys[i] || !equals(this[selfKeys[i]], that[selfKeys[i]])) {
        return false;
      }
    }
    return true;
  }
};
var EffectProto = {
  [EffectTypeId]: effectVariance,
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  },
  toJSON() {
    return {
      _id: "Effect",
      op: this[identifier],
      ...args in this ? {
        args: this[args]
      } : undefined
    };
  }
};
var isEffect = (u) => hasProperty(u, EffectTypeId);
var isExit = (u) => hasProperty(u, ExitTypeId);
var CauseTypeId = "~effect/Cause";
var CauseReasonTypeId = "~effect/Cause/Reason";
var isCause = (self) => hasProperty(self, CauseTypeId);
class CauseImpl {
  constructor(failures) {
    this[CauseTypeId] = CauseTypeId;
    this.reasons = failures;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toJSON() {
    return {
      _id: "Cause",
      failures: this.reasons.map((f) => f.toJSON())
    };
  }
  toString() {
    return `Cause(${format(this.reasons)})`;
  }
  [NodeInspectSymbol]() {
    return this.toJSON();
  }
  [symbol2](that) {
    return isCause(that) && this.reasons.length === that.reasons.length && this.reasons.every((e, i) => equals(e, that.reasons[i]));
  }
  [symbol]() {
    return array(this.reasons);
  }
}
var annotationsMap = /* @__PURE__ */ new WeakMap;

class ReasonBase {
  [CauseReasonTypeId];
  annotations;
  _tag;
  constructor(_tag, annotations, originalError) {
    this[CauseReasonTypeId] = CauseReasonTypeId;
    this._tag = _tag;
    if (annotations !== constEmptyAnnotations && typeof originalError === "object" && originalError !== null && annotations.size > 0) {
      const prevAnnotations = annotationsMap.get(originalError);
      if (prevAnnotations) {
        annotations = new Map([...prevAnnotations, ...annotations]);
      }
      annotationsMap.set(originalError, annotations);
    }
    this.annotations = annotations;
  }
  annotate(annotations, options) {
    if (annotations.mapUnsafe.size === 0)
      return this;
    const newAnnotations = new Map(this.annotations);
    annotations.mapUnsafe.forEach((value, key) => {
      if (options?.overwrite !== true && newAnnotations.has(key))
        return;
      newAnnotations.set(key, value);
    });
    const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    self.annotations = newAnnotations;
    return self;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  toString() {
    return format(this);
  }
  [NodeInspectSymbol]() {
    return this.toString();
  }
}
var constEmptyAnnotations = /* @__PURE__ */ new Map;

class Fail extends ReasonBase {
  constructor(error, annotations = constEmptyAnnotations) {
    super("Fail", annotations, error);
    this.error = error;
  }
  toString() {
    return `Fail(${format(this.error)})`;
  }
  toJSON() {
    return {
      _tag: "Fail",
      error: this.error
    };
  }
  [symbol2](that) {
    return isFailReason(that) && equals(this.error, that.error) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.error))(hash(this.annotations)));
  }
}
var causeFromReasons = (reasons) => new CauseImpl(reasons);
var causeEmpty = /* @__PURE__ */ new CauseImpl([]);
var causeFail = (error) => new CauseImpl([new Fail(error)]);

class Die extends ReasonBase {
  constructor(defect, annotations = constEmptyAnnotations) {
    super("Die", annotations, defect);
    this.defect = defect;
  }
  toString() {
    return `Die(${format(this.defect)})`;
  }
  toJSON() {
    return {
      _tag: "Die",
      defect: this.defect
    };
  }
  [symbol2](that) {
    return isDieReason(that) && equals(this.defect, that.defect) && equals(this.annotations, that.annotations);
  }
  [symbol]() {
    return combine(string(this._tag))(combine(hash(this.defect))(hash(this.annotations)));
  }
}
var causeDie = (defect) => new CauseImpl([new Die(defect)]);
var causeAnnotate = /* @__PURE__ */ dual((args) => isCause(args[0]), (self, annotations, options) => {
  if (annotations.mapUnsafe.size === 0)
    return self;
  return new CauseImpl(self.reasons.map((f) => f.annotate(annotations, options)));
});
var isFailReason = (self) => self._tag === "Fail";
var isDieReason = (self) => self._tag === "Die";
var isInterruptReason = (self) => self._tag === "Interrupt";
function defaultEvaluate(_fiber) {
  return exitDie(`Effect.evaluate: Not implemented`);
}
var makePrimitiveProto = (options) => ({
  ...EffectProto,
  [identifier]: options.op,
  [evaluate]: options[evaluate] ?? defaultEvaluate,
  [contA]: options[contA],
  [contE]: options[contE],
  [contAll]: options[contAll]
});
var makePrimitive = (options) => {
  const Proto = makePrimitiveProto(options);
  const PrimitiveImpl = function(value) {
    this[args] = value;
  };
  PrimitiveImpl.prototype = Proto;
  return function(value) {
    return new PrimitiveImpl(value);
  };
};
var makeExit = (options) => {
  const Proto = {
    [ExitTypeId]: ExitTypeId,
    _tag: options.op,
    get [options.prop]() {
      return this[args];
    },
    ...makePrimitiveProto(options),
    toString() {
      return `${options.op}(${format(this[args])})`;
    },
    toJSON() {
      return {
        _id: "Exit",
        _tag: options.op,
        [options.prop]: this[args]
      };
    },
    [symbol2](that) {
      return isExit(that) && that._tag === this._tag && equals(this[args], that[args]);
    },
    [symbol]() {
      return combine(string(options.op), hash(this[args]));
    }
  };
  const ExitPrimitive = function(value) {
    this[args] = value;
  };
  ExitPrimitive.prototype = Proto;
  return function(value) {
    return new ExitPrimitive(value);
  };
};
var exitSucceed = /* @__PURE__ */ makeExit({
  op: "Success",
  prop: "value",
  [evaluate](fiber) {
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](this[args], fiber, this) : fiber.yieldWith(this);
  }
});
var StackTraceKey = {
  key: "effect/Cause/StackTrace"
};
var InterruptorStackTrace = {
  key: "effect/Cause/InterruptorStackTrace"
};
var exitFailCause = /* @__PURE__ */ makeExit({
  op: "Failure",
  prop: "cause",
  [evaluate](fiber) {
    let cause = this[args];
    let annotated = false;
    if (fiber.cache.stackFrame) {
      cause = causeAnnotate(cause, {
        mapUnsafe: new Map([[StackTraceKey.key, fiber.cache.stackFrame]])
      });
      annotated = true;
    }
    let cont = fiber.getCont(contE);
    while (fiber.interruptible && fiber._interruptedCause && cont) {
      cont = fiber.getCont(contE);
    }
    return cont ? cont[contE](cause, fiber, annotated ? undefined : this) : fiber.yieldWith(annotated ? exitFailCause(cause) : this);
  }
});
var exitFail = (e) => exitFailCause(causeFail(e));
var exitDie = (defect) => exitFailCause(causeDie(defect));
var withFiber = /* @__PURE__ */ makePrimitive({
  op: "WithFiber",
  [evaluate](fiber) {
    return this[args](fiber);
  }
});
var withFiberSucceed = /* @__PURE__ */ makePrimitive({
  op: "WithFiberSucceed",
  [evaluate](fiber) {
    const value = this[args](fiber);
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var YieldableError = /* @__PURE__ */ function() {

  class YieldableError extends globalThis.Error {
  }
  const proto = /* @__PURE__ */ makePrimitiveProto({
    op: "YieldableError",
    [evaluate]() {
      return exitFail(this);
    }
  });
  delete proto.toString;
  Object.assign(YieldableError.prototype, proto);
  return YieldableError;
}();
var Error2 = /* @__PURE__ */ function() {
  const plainArgsSymbol = /* @__PURE__ */ Symbol.for("effect/Data/Error/plainArgs");
  return class Base extends YieldableError {
    constructor(args) {
      super(args?.message, args?.cause ? {
        cause: args.cause
      } : undefined);
      if (args) {
        assignProperties(this, args);
        Object.defineProperty(this, plainArgsSymbol, {
          value: args,
          enumerable: false
        });
      }
    }
    toJSON() {
      return {
        ...this[plainArgsSymbol],
        ...this
      };
    }
  };
}();
var TaggedError = (tag) => {

  class Base extends Error2 {
    _tag = tag;
  }
  Base.prototype.name = tag;
  return Base;
};
var DoneTypeId = "~effect/Cause/Done";
var isDone = (u) => hasProperty(u, DoneTypeId);
var DoneVoid = {
  [DoneTypeId]: DoneTypeId,
  _tag: "Done",
  value: undefined
};
var Done = (value) => {
  if (value === undefined)
    return DoneVoid;
  return {
    [DoneTypeId]: DoneTypeId,
    _tag: "Done",
    value
  };
};
var doneVoid = /* @__PURE__ */ exitFail(DoneVoid);
var done = (value) => {
  if (value === undefined)
    return doneVoid;
  return exitFail(Done(value));
};

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/option.js
var TypeId = "~effect/Option";
var CommonProto = {
  [TypeId]: {
    _A: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SomeProto = /* @__PURE__ */ Object.defineProperty(/* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "Some",
  _op: "Some",
  [symbol2](that) {
    return isOption(that) && isSome(that) && equals(this.value, that.value);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.value));
  },
  toString() {
    return `some(${format(this.value)})`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag,
      value: toJson(this.value)
    };
  }
}), "valueOrUndefined", {
  get() {
    return this.value;
  }
});
var NoneHash = /* @__PURE__ */ hash("None");
var NoneProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto), {
  _tag: "None",
  _op: "None",
  valueOrUndefined: undefined,
  [symbol2](that) {
    return isOption(that) && isNone(that);
  },
  [symbol]() {
    return NoneHash;
  },
  toString() {
    return `none()`;
  },
  toJSON() {
    return {
      _id: "Option",
      _tag: this._tag
    };
  }
});
var isOption = (input) => hasProperty(input, TypeId);
var isNone = (fa) => fa._tag === "None";
var isSome = (fa) => fa._tag === "Some";
var none = /* @__PURE__ */ Object.create(NoneProto);
var SomeImpl = function(value) {
  this.value = value;
};
SomeImpl.prototype = SomeProto;
var some = (value) => new SomeImpl(value);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/result.js
var TypeId2 = "~effect/Result";
var CommonProto2 = {
  [TypeId2]: {
    _A: (_) => _,
    _E: (_) => _
  },
  ...PipeInspectableProto,
  [Symbol.iterator]() {
    return new SingleShotGen(this);
  }
};
var SuccessProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Success",
  _op: "Success",
  [symbol2](that) {
    return isResult(that) && isSuccess(that) && equals(this.success, that.success);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.success));
  },
  toString() {
    return `success(${format(this.success)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      value: toJson(this.success)
    };
  }
});
var FailureProto = /* @__PURE__ */ Object.assign(/* @__PURE__ */ Object.create(CommonProto2), {
  _tag: "Failure",
  _op: "Failure",
  [symbol2](that) {
    return isResult(that) && isFailure(that) && equals(this.failure, that.failure);
  },
  [symbol]() {
    return combine(hash(this._tag))(hash(this.failure));
  },
  toString() {
    return `failure(${format(this.failure)})`;
  },
  toJSON() {
    return {
      _id: "Result",
      _tag: this._tag,
      failure: toJson(this.failure)
    };
  }
});
var isResult = (input) => hasProperty(input, TypeId2);
var isFailure = (result) => result._tag === "Failure";
var isSuccess = (result) => result._tag === "Success";
var FailureImpl = function(failure) {
  this.failure = failure;
};
FailureImpl.prototype = FailureProto;
var fail = (failure) => new FailureImpl(failure);
var SuccessImpl = function(success) {
  this.success = success;
};
SuccessImpl.prototype = SuccessProto;
var succeed = (success) => new SuccessImpl(success);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Order.js
function make(compare) {
  return (self, that) => self === that ? 0 : compare(self, that);
}
var Number2 = /* @__PURE__ */ make((self, that) => {
  if (globalThis.Number.isNaN(self) && globalThis.Number.isNaN(that))
    return 0;
  if (globalThis.Number.isNaN(self))
    return -1;
  if (globalThis.Number.isNaN(that))
    return 1;
  return self < that ? -1 : 1;
});
var mapInput = /* @__PURE__ */ dual(2, (self, f) => make((b1, b2) => self(f(b1), f(b2))));
var isLessThan = (O) => dual(2, (self, that) => O(self, that) === -1);
var isGreaterThan = (O) => dual(2, (self, that) => O(self, that) === 1);
var isLessThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== 1);
var isGreaterThanOrEqualTo = (O) => dual(2, (self, that) => O(self, that) !== -1);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Option.js
var none2 = () => none;
var some2 = some;
var isNone2 = isNone;
var isSome2 = isSome;
var match = /* @__PURE__ */ dual(2, (self, {
  onNone,
  onSome
}) => isNone2(self) ? onNone() : onSome(self.value));
var getOrElse = /* @__PURE__ */ dual(2, (self, onNone) => isNone2(self) ? onNone() : self.value);
var fromNullishOr = (a) => a == null ? none2() : some2(a);
var getOrUndefined = /* @__PURE__ */ getOrElse(constUndefined);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Result.js
var succeed2 = succeed;
var fail2 = fail;
var isFailure2 = isFailure;
var mapError = /* @__PURE__ */ dual(2, (self, f) => isFailure2(self) ? fail2(f(self.failure)) : self);
var match2 = /* @__PURE__ */ dual(2, (self, {
  onFailure,
  onSuccess
}) => isFailure2(self) ? onFailure(self.failure) : onSuccess(self.success));

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Iterable.js
var constEmpty = {
  [Symbol.iterator]() {
    return constEmptyIterator;
  }
};
var constEmptyIterator = {
  next() {
    return {
      done: true,
      value: undefined
    };
  }
};
var empty = () => constEmpty;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Record.js
var map = /* @__PURE__ */ dual(2, (self, f) => {
  const out = {
    ...self
  };
  for (const key of keys(self)) {
    assignProperty(out, key, f(self[key], key));
  }
  return out;
});
var keys = (self) => Object.keys(self);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Array.js
var Array2 = globalThis.Array;
var fromIterable = (collection) => Array2.isArray(collection) ? collection : Array2.from(collection);
var append = /* @__PURE__ */ dual(2, (self, last) => [...self, last]);
var isArray = Array2.isArray;
var isArrayNonEmpty2 = isArrayNonEmpty;
var isReadonlyArrayNonEmpty = isArrayNonEmpty;
function isCanonicalArrayIndex(key) {
  const index = Number(key);
  return String(index) === key && Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1;
}
var empty2 = () => [];
var of = (a) => [a];
var map2 = /* @__PURE__ */ dual(2, (self, f) => self.map(f));
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Effectable.js
var Prototype2 = (options) => makePrimitiveProto({
  op: options.label,
  [evaluate]: options.evaluate
});

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Context.js
var ServiceTypeId = "~effect/Context/Service";
var Service = function() {
  function KeyClass() {}
  const self = KeyClass;
  Object.setPrototypeOf(self, ServiceProto);
  const init = (key, options) => {
    self.key = key;
    if (options?.defaultValue) {
      self[ReferenceTypeId] = ReferenceTypeId;
      self.defaultValue = options.defaultValue;
    }
    if (options?.make) {
      self.make = options.make;
    }
    if (options?.fiberCached) {
      cacheKeys.add(key);
    }
    return self;
  };
  return arguments.length > 0 ? init(arguments[0], arguments[1]) : init;
};
var ServiceProto = {
  [ServiceTypeId]: ServiceTypeId,
  .../* @__PURE__ */ Prototype2({
    label: "Service",
    evaluate(fiber) {
      return exitSucceed(get(fiber.context, this));
    }
  }),
  toJSON() {
    return {
      _id: "Service",
      key: this.key
    };
  },
  of(self) {
    return self;
  },
  context(self) {
    return make2(this, self);
  },
  use(f) {
    return withFiber((fiber) => f(get(fiber.context, this)));
  },
  useSync(f) {
    return withFiber((fiber) => exitSucceed(f(get(fiber.context, this))));
  }
};
var cacheKeys = /* @__PURE__ */ new Set;
var ReferenceTypeId = "~effect/Context/Reference";
var TypeId3 = "~effect/Context";
var MaxDepth = 8;
var FlattenAfterBaseHits = 8;
var makeImpl = (cacheRoot, base, overlay, depth) => {
  const self = Object.create(Proto);
  self.cacheRoot = cacheRoot ?? self;
  self.base = base;
  self.overlay = overlay;
  self.depth = depth;
  self._flat = undefined;
  self.baseHits = 0;
  return self;
};
var applyOverlays = (map, overlay) => {
  if (!overlay)
    return;
  applyOverlays(map, overlay.parent);
  map.set(overlay.key, overlay.value);
};
var flatten = (self) => {
  if (self._flat)
    return self._flat;
  if (!self.overlay)
    return self._flat = self.base;
  const map = new Map(self.base);
  applyOverlays(map, self.overlay);
  return self._flat = map;
};
var withFlat = (self, f) => {
  const map = new Map(self.mapUnsafe);
  f(map);
  return makeUnsafe(map);
};
var notFound = /* @__PURE__ */ Symbol();
var lookup = (self, key) => {
  const impl = self;
  for (let overlay = impl.overlay;overlay; overlay = overlay.parent) {
    if (overlay.key === key)
      return overlay.value;
  }
  const value = impl.base.get(key);
  if (value === undefined && !impl.base.has(key))
    return notFound;
  if (impl.overlay && ++impl.baseHits >= FlattenAfterBaseHits) {
    impl.base = flatten(impl);
    impl.overlay = undefined;
    impl.depth = 0;
  }
  return value;
};
var makeUnsafe = (mapUnsafe) => makeImpl(undefined, mapUnsafe, undefined, 0);
var Proto = {
  get mapUnsafe() {
    return flatten(this);
  },
  ...PipeInspectableProto,
  [TypeId3]: {
    _Services: (_) => _
  },
  toJSON() {
    return {
      _id: "Context",
      services: Array.from(this.mapUnsafe).map(([key, value]) => ({
        key,
        value
      }))
    };
  },
  [symbol2](that) {
    if (!isContext(that))
      return false;
    const self = this.mapUnsafe;
    const other = that.mapUnsafe;
    if (self.size !== other.size)
      return false;
    for (const [key, value] of self) {
      if (!other.has(key) || !equals(value, other.get(key)))
        return false;
    }
    return true;
  },
  [symbol]() {
    return number(this.mapUnsafe.size);
  }
};
var hasSameCache = (self, that) => self.cacheRoot === that.cacheRoot;
var isContext = (u) => hasProperty(u, TypeId3);
var isReference = (u) => !!u[ReferenceTypeId];
var empty3 = () => emptyContext2;
var emptyContext2 = /* @__PURE__ */ makeUnsafe(/* @__PURE__ */ new Map);
var make2 = (key, service) => makeUnsafe(new Map([[key.key, service]]));
var add = /* @__PURE__ */ dual(3, (self, key, service) => addUnsafe(self, key.key, service));
var addUnsafe = (self, key, service) => {
  const impl = self;
  const cacheRoot = cacheKeys.has(key) ? undefined : impl.cacheRoot;
  if (impl.depth >= MaxDepth) {
    const map = new Map(impl.mapUnsafe);
    map.set(key, service);
    return makeImpl(cacheRoot, map, undefined, 0);
  }
  return makeImpl(cacheRoot, impl.base, {
    key,
    value: service,
    parent: impl.overlay
  }, impl.depth + 1);
};
var getOrUndefined2 = /* @__PURE__ */ dual(2, (self, key) => getOrUndefinedUnsafe(self, key.key));
var getOrUndefinedUnsafe = (self, key) => {
  const value = lookup(self, key);
  return value === notFound ? undefined : value;
};
var getUnsafe = /* @__PURE__ */ dual(2, (self, service) => {
  const value = lookup(self, service.key);
  if (value === notFound) {
    if (isReference(service))
      return getDefaultValue(service);
    throw serviceNotFoundError(service);
  }
  return value;
});
var get = getUnsafe;
var defaultValueCacheKey = "~effect/Context/defaultValue";
var getDefaultValue = (ref) => {
  if (defaultValueCacheKey in ref) {
    return ref[defaultValueCacheKey];
  }
  return ref[defaultValueCacheKey] = ref.defaultValue();
};
var serviceNotFoundError = (service) => {
  const error = new Error(`Service not found${service.key ? `: ${String(service.key)}` : ""}`);
  if (error.stack) {
    const lines = error.stack.split(`
`);
    lines.splice(1, 3);
    error.stack = lines.join(`
`);
  }
  return error;
};
var merge = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.mapUnsafe.size === 0)
    return that;
  if (that.mapUnsafe.size === 0)
    return self;
  return withFlat(self, (map) => that.mapUnsafe.forEach((value, key) => map.set(key, value)));
});
var mergeAll = (...ctxs) => {
  const map = new Map;
  for (let i = 0;i < ctxs.length; i++) {
    ctxs[i].mapUnsafe.forEach((value, key) => {
      map.set(key, value);
    });
  }
  return makeUnsafe(map);
};
var Reference = Service;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Duration.js
var TypeId4 = "~effect/Duration";
var bigint0 = /* @__PURE__ */ BigInt(0);
var bigint1 = /* @__PURE__ */ BigInt(1);
var bigint2 = /* @__PURE__ */ BigInt(2);
var bigint10 = /* @__PURE__ */ BigInt(10);
var bigint1e3 = /* @__PURE__ */ BigInt(1000);
var roundTiesAwayFromZero = (input) => BigInt(input < 0 ? Math.ceil(input - 0.5) : Math.floor(input + 0.5));
var roundMillisToNanos = (millis) => roundTiesAwayFromZero(millis * 1e6);
var parseNanos = (input, scale) => {
  const decimalIndex = input.indexOf(".");
  if (decimalIndex === -1)
    return BigInt(input) * scale;
  const isNegative = input[0] === "-";
  const fractional = input.slice(decimalIndex + 1);
  const fractionalScale = bigint10 ** BigInt(fractional.length);
  const scaled = (BigInt(input.slice(isNegative ? 1 : 0, decimalIndex)) * fractionalScale + BigInt(fractional)) * scale;
  const rounded = scaled / fractionalScale + (scaled % fractionalScale * bigint2 >= fractionalScale ? bigint1 : bigint0);
  return isNegative ? -rounded : rounded;
};
var DURATION_REGEXP = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
var fromInputUnsafe = (input) => {
  switch (typeof input) {
    case "number":
      return millis(input);
    case "bigint":
      return nanos(input);
    case "string": {
      if (input === "Infinity") {
        return infinity;
      }
      if (input === "-Infinity") {
        return negativeInfinity;
      }
      const match = DURATION_REGEXP.exec(input);
      if (!match)
        break;
      const [_, valueStr, unit] = match;
      if (unit === "nano" || unit === "nanos") {
        return nanos(parseNanos(valueStr, bigint1));
      }
      if (unit === "micro" || unit === "micros") {
        return nanos(parseNanos(valueStr, bigint1e3));
      }
      const value = Number(valueStr);
      switch (unit) {
        case "milli":
        case "millis":
          return millis(value);
        case "second":
        case "seconds":
          return seconds(value);
        case "minute":
        case "minutes":
          return minutes(value);
        case "hour":
        case "hours":
          return hours(value);
        case "day":
        case "days":
          return days(value);
        case "week":
        case "weeks":
          return weeks(value);
      }
      break;
    }
    case "object": {
      if (input === null)
        break;
      if (TypeId4 in input)
        return input;
      if (Array.isArray(input)) {
        if (input.length !== 2 || !input.every(isNumber)) {
          return invalid(input);
        }
        if (Number.isNaN(input[0]) || Number.isNaN(input[1])) {
          return zero;
        }
        if (input[0] === -Infinity || input[1] === -Infinity) {
          return negativeInfinity;
        }
        if (input[0] === Infinity || input[1] === Infinity) {
          return infinity;
        }
        return make3(roundTiesAwayFromZero(input[0] * 1e9 + input[1]));
      }
      const obj = input;
      let millis = 0;
      if (obj.weeks)
        millis += obj.weeks * 604800000;
      if (obj.days)
        millis += obj.days * 86400000;
      if (obj.hours)
        millis += obj.hours * 3600000;
      if (obj.minutes)
        millis += obj.minutes * 60000;
      if (obj.seconds)
        millis += obj.seconds * 1000;
      if (obj.milliseconds)
        millis += obj.milliseconds;
      if (!obj.microseconds && !obj.nanoseconds)
        return make3(millis);
      return make3(roundTiesAwayFromZero(millis * 1e6 + (obj.microseconds ?? 0) * 1000 + (obj.nanoseconds ?? 0)));
    }
  }
  return invalid(input);
};
var invalid = (input) => {
  throw new Error(`Invalid Input: ${input}`);
};
var zeroDurationValue = {
  _tag: "Millis",
  millis: 0
};
var infinityDurationValue = {
  _tag: "Infinity"
};
var negativeInfinityDurationValue = {
  _tag: "NegativeInfinity"
};
var DurationProto = {
  [TypeId4]: TypeId4,
  [symbol]() {
    switch (this.value._tag) {
      case "Millis": {
        const nanos = this.value.millis * 1e6;
        return Number.isFinite(nanos) ? hash(roundTiesAwayFromZero(nanos)) : number(this.value.millis);
      }
      case "Nanos":
        return hash(this.value.nanos);
      default:
        return structure(this.value);
    }
  },
  [symbol2](that) {
    return isDuration(that) && equals2(this, that);
  },
  toString() {
    switch (this.value._tag) {
      case "Infinity":
        return "Infinity";
      case "NegativeInfinity":
        return "-Infinity";
      case "Nanos":
        return `${this.value.nanos} nanos`;
      case "Millis":
        return `${this.value.millis} millis`;
    }
  },
  toJSON() {
    switch (this.value._tag) {
      case "Millis":
        return {
          _id: "Duration",
          _tag: "Millis",
          millis: this.value.millis
        };
      case "Nanos":
        return {
          _id: "Duration",
          _tag: "Nanos",
          nanos: String(this.value.nanos)
        };
      case "Infinity":
        return {
          _id: "Duration",
          _tag: "Infinity"
        };
      case "NegativeInfinity":
        return {
          _id: "Duration",
          _tag: "NegativeInfinity"
        };
    }
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var make3 = (input) => {
  const duration = Object.create(DurationProto);
  if (typeof input === "number") {
    if (isNaN(input) || input === 0 || Object.is(input, -0)) {
      duration.value = zeroDurationValue;
    } else if (!Number.isFinite(input)) {
      duration.value = input > 0 ? infinityDurationValue : negativeInfinityDurationValue;
    } else if (!Number.isInteger(input)) {
      duration.value = {
        _tag: "Nanos",
        nanos: roundMillisToNanos(input)
      };
    } else {
      duration.value = {
        _tag: "Millis",
        millis: input
      };
    }
  } else if (input === bigint0) {
    duration.value = zeroDurationValue;
  } else {
    duration.value = {
      _tag: "Nanos",
      nanos: input
    };
  }
  return duration;
};
var isDuration = (u) => hasProperty(u, TypeId4);
var zero = /* @__PURE__ */ make3(0);
var infinity = /* @__PURE__ */ make3(Infinity);
var negativeInfinity = /* @__PURE__ */ make3(-Infinity);
var nanos = (nanos) => make3(nanos);
var millis = (millis) => make3(millis);
var seconds = (seconds) => make3(seconds * 1000);
var minutes = (minutes) => make3(minutes * 60000);
var hours = (hours) => make3(hours * 3600000);
var days = (days) => make3(days * 86400000);
var weeks = (weeks) => make3(weeks * 604800000);
var toMillis = (self) => match3(fromInputUnsafe(self), {
  onMillis: identity,
  onNanos: (nanos) => Number(nanos) / 1e6,
  onInfinity: () => Infinity,
  onNegativeInfinity: () => -Infinity
});
var toNanosUnsafe = (input) => {
  const self = fromInputUnsafe(input);
  switch (self.value._tag) {
    case "Infinity":
    case "NegativeInfinity":
      throw new Error("Cannot convert infinite duration to nanos");
    case "Nanos":
      return self.value.nanos;
    case "Millis":
      return roundMillisToNanos(self.value.millis);
  }
};
var match3 = /* @__PURE__ */ dual(2, (self, options) => {
  switch (self.value._tag) {
    case "Millis":
      return options.onMillis(self.value.millis);
    case "Nanos":
      return options.onNanos(self.value.nanos);
    case "Infinity":
      return options.onInfinity();
    case "NegativeInfinity":
      return (options.onNegativeInfinity ?? options.onInfinity)();
  }
});
var matchPair = /* @__PURE__ */ dual(3, (self, that, options) => {
  if (self.value._tag === "Infinity" || self.value._tag === "NegativeInfinity" || that.value._tag === "Infinity" || that.value._tag === "NegativeInfinity")
    return options.onInfinity(self, that);
  if (self.value._tag === "Millis") {
    return that.value._tag === "Millis" ? options.onMillis(self.value.millis, that.value.millis) : options.onNanos(toNanosUnsafe(self), that.value.nanos);
  } else {
    return options.onNanos(self.value.nanos, toNanosUnsafe(that));
  }
});
var Equivalence = (self, that) => matchPair(self, that, {
  onMillis: (self, that) => self === that,
  onNanos: (self, that) => self === that,
  onInfinity: (self, that) => self.value._tag === that.value._tag
});
var equals2 = /* @__PURE__ */ dual(2, (self, that) => Equivalence(self, that));

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Filter.js
var toPredicate = (self) => (input) => !isFailure2(self(input));
var has = (key) => (input) => input.has(key) ? succeed2(input) : fail2(input);
var compose = /* @__PURE__ */ dual(2, (left, right) => (input) => {
  const leftOut = left(input);
  if (isFailure2(leftOut))
    return leftOut;
  return right(leftOut.success);
});

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Scheduler.js
var Scheduler = /* @__PURE__ */ Reference("effect/Scheduler", {
  fiberCached: true,
  defaultValue: () => new MixedScheduler
});
var setMicrotask = (f) => {
  let cancelled = false;
  Promise.resolve().then(() => {
    if (!cancelled)
      f();
  });
  return () => {
    cancelled = true;
  };
};
var setTimer = "setImmediate" in globalThis ? (f) => {
  const timer = globalThis.setImmediate(f);
  return () => globalThis.clearImmediate(timer);
} : (f) => {
  const timer = setTimeout(f, 0);
  return () => clearTimeout(timer);
};
var setImmediate = (f) => {
  try {
    return setTimer(f);
  } catch {
    return setMicrotask(f);
  }
};

class PriorityBuckets {
  buckets = [];
  scheduleTask(task, priority) {
    const buckets = this.buckets;
    const len = buckets.length;
    let bucket;
    let index = 0;
    for (;index < len; index++) {
      if (buckets[index][0] > priority)
        break;
      bucket = buckets[index];
    }
    if (bucket && bucket[0] === priority) {
      bucket[1].push(task);
    } else if (index === len) {
      buckets.push([priority, [task]]);
    } else {
      buckets.splice(index, 0, [priority, [task]]);
    }
  }
  drain() {
    const buckets = this.buckets;
    this.buckets = [];
    return buckets;
  }
}

class MixedScheduler {
  executionMode;
  setImmediate;
  constructor(executionMode = "async", setImmediateFn) {
    this.executionMode = executionMode;
    this.setImmediate = setImmediateFn ?? (executionMode === "sync" ? setMicrotask : setImmediate);
  }
  shouldYield(fiber) {
    return fiber.currentOpCount >= fiber.cache.maxOpsBeforeYield;
  }
  makeDispatcher() {
    return new MixedSchedulerDispatcher(this.setImmediate);
  }
}

class MixedSchedulerDispatcher {
  tasks = /* @__PURE__ */ new PriorityBuckets;
  running = undefined;
  setImmediate;
  constructor(setImmediateFn = setImmediate) {
    this.setImmediate = setImmediateFn;
  }
  scheduleTask(task, priority) {
    this.tasks.scheduleTask(task, priority);
    if (this.running === undefined) {
      this.running = this.setImmediate(this.afterScheduled);
    }
  }
  afterScheduled = () => {
    this.running = undefined;
    this.runTasks();
  };
  runTasks() {
    const buckets = this.tasks.drain();
    for (let i = 0;i < buckets.length; i++) {
      const toRun = buckets[i][1];
      for (let j = 0;j < toRun.length; j++) {
        toRun[j]();
      }
    }
  }
  flush() {
    while (this.tasks.buckets.length > 0) {
      if (this.running !== undefined) {
        this.running();
        this.running = undefined;
      }
      this.runTasks();
    }
  }
}
var MaxOpsBeforeYield = /* @__PURE__ */ Reference("effect/Scheduler/MaxOpsBeforeYield", {
  fiberCached: true,
  defaultValue: () => 2048
});
var PreventSchedulerYield = /* @__PURE__ */ Reference("effect/Scheduler/PreventSchedulerYield", {
  fiberCached: true,
  defaultValue: () => false
});

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Data.js
var TaggedError2 = TaggedError;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Encoding.js
var EncodingErrorTypeId = "~effect/Encoding/EncodingError";

class EncodingError extends (/* @__PURE__ */ TaggedError2("EncodingError")) {
  [EncodingErrorTypeId] = EncodingErrorTypeId;
}
var encodeBase64 = (input) => typeof input === "string" ? base64EncodeUint8Array(encoder.encode(input)) : base64EncodeUint8Array(input);
var decodeBase64 = (str) => {
  const stripped = stripCrlf(str);
  const length = stripped.length;
  if (length % 4 !== 0) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Length must be a multiple of 4, but is ${length}`
    }));
  }
  const index = stripped.indexOf("=");
  if (index !== -1 && (index < length - 2 || index === length - 2 && stripped[length - 1] !== "=")) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: `Found a '=' character, but it is not at the end`
    }));
  }
  try {
    const missingOctets = stripped.endsWith("==") ? 2 : stripped.endsWith("=") ? 1 : 0;
    const result = new Uint8Array(3 * (length / 4) - missingOctets);
    for (let i = 0, j = 0;i < length; i += 4, j += 3) {
      const buffer = getBase64Code(stripped.charCodeAt(i)) << 18 | getBase64Code(stripped.charCodeAt(i + 1)) << 12 | getBase64Code(stripped.charCodeAt(i + 2)) << 6 | getBase64Code(stripped.charCodeAt(i + 3));
      result[j] = buffer >> 16;
      result[j + 1] = buffer >> 8 & 255;
      result[j + 2] = buffer & 255;
    }
    return succeed2(result);
  } catch (e) {
    return fail2(new EncodingError({
      kind: "Decode",
      module: "Base64",
      input: stripped,
      message: e instanceof Error ? e.message : "Invalid input"
    }));
  }
};
var randomHex = (length) => {
  switch (length) {
    case 16:
      return randomHex16();
    case 32:
      return randomHex32();
    default: {
      let result = "";
      for (let i = length >>> 3;i > 0; i--) {
        result += randomHex8();
      }
      return result;
    }
  }
};
var hexCharCodes = /* @__PURE__ */ Uint8Array.from("0123456789abcdef", (c) => c.charCodeAt(0));
var randomWord = () => Math.random() * 4294967296 >>> 0;
var randomHex8 = () => {
  const a = randomWord();
  return String.fromCharCode(hexCharCodes[a >>> 28], hexCharCodes[a >>> 24 & 15], hexCharCodes[a >>> 20 & 15], hexCharCodes[a >>> 16 & 15], hexCharCodes[a >>> 12 & 15], hexCharCodes[a >>> 8 & 15], hexCharCodes[a >>> 4 & 15], hexCharCodes[a & 15]);
};
var randomHex16 = () => {
  const a = randomWord();
  const b = randomWord();
  return String.fromCharCode(hexCharCodes[a >>> 28], hexCharCodes[a >>> 24 & 15], hexCharCodes[a >>> 20 & 15], hexCharCodes[a >>> 16 & 15], hexCharCodes[a >>> 12 & 15], hexCharCodes[a >>> 8 & 15], hexCharCodes[a >>> 4 & 15], hexCharCodes[a & 15], hexCharCodes[b >>> 28], hexCharCodes[b >>> 24 & 15], hexCharCodes[b >>> 20 & 15], hexCharCodes[b >>> 16 & 15], hexCharCodes[b >>> 12 & 15], hexCharCodes[b >>> 8 & 15], hexCharCodes[b >>> 4 & 15], hexCharCodes[b & 15]);
};
var randomHex32 = () => {
  const a = randomWord();
  const b = randomWord();
  const c = randomWord();
  const d = randomWord();
  return String.fromCharCode(hexCharCodes[a >>> 28], hexCharCodes[a >>> 24 & 15], hexCharCodes[a >>> 20 & 15], hexCharCodes[a >>> 16 & 15], hexCharCodes[a >>> 12 & 15], hexCharCodes[a >>> 8 & 15], hexCharCodes[a >>> 4 & 15], hexCharCodes[a & 15], hexCharCodes[b >>> 28], hexCharCodes[b >>> 24 & 15], hexCharCodes[b >>> 20 & 15], hexCharCodes[b >>> 16 & 15], hexCharCodes[b >>> 12 & 15], hexCharCodes[b >>> 8 & 15], hexCharCodes[b >>> 4 & 15], hexCharCodes[b & 15], hexCharCodes[c >>> 28], hexCharCodes[c >>> 24 & 15], hexCharCodes[c >>> 20 & 15], hexCharCodes[c >>> 16 & 15], hexCharCodes[c >>> 12 & 15], hexCharCodes[c >>> 8 & 15], hexCharCodes[c >>> 4 & 15], hexCharCodes[c & 15], hexCharCodes[d >>> 28], hexCharCodes[d >>> 24 & 15], hexCharCodes[d >>> 20 & 15], hexCharCodes[d >>> 16 & 15], hexCharCodes[d >>> 12 & 15], hexCharCodes[d >>> 8 & 15], hexCharCodes[d >>> 4 & 15], hexCharCodes[d & 15]);
};
var encoder = /* @__PURE__ */ new TextEncoder;
var stripCrlf = (str) => str.replace(/[\n\r]/g, "");
var base64EncodeUint8Array = (bytes) => {
  const length = bytes.length;
  let result = "";
  let i;
  for (i = 2;i < length; i += 3) {
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += base64abc[(bytes[i - 1] & 15) << 2 | bytes[i] >> 6];
    result += base64abc[bytes[i] & 63];
  }
  if (i === length + 1) {
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[(bytes[i - 2] & 3) << 4];
    result += "==";
  }
  if (i === length) {
    result += base64abc[bytes[i - 2] >> 2];
    result += base64abc[(bytes[i - 2] & 3) << 4 | bytes[i - 1] >> 4];
    result += base64abc[(bytes[i - 1] & 15) << 2];
    result += "=";
  }
  return result;
};
function getBase64Code(charCode) {
  if (charCode >= base64codes.length) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  const code = base64codes[charCode];
  if (code === 255) {
    throw new TypeError(`Invalid character ${String.fromCharCode(charCode)}`);
  }
  return code;
}
var base64abc = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "+", "/"];
var base64codes = [255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 62, 255, 255, 255, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 255, 255, 255, 0, 255, 255, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 255, 255, 255, 255, 255, 255, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51];

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Tracer.js
var ParentSpanKey = "effect/Tracer/ParentSpan";

class ParentSpan extends (/* @__PURE__ */ Service()(ParentSpanKey, {
  fiberCached: true
})) {
}
var make4 = (options) => options;
var DisablePropagation = /* @__PURE__ */ Reference("effect/Tracer/DisablePropagation", {
  defaultValue: constFalse
});
var CurrentTraceLevel = /* @__PURE__ */ Reference("effect/Tracer/CurrentTraceLevel", {
  defaultValue: () => "Info"
});
var MinimumTraceLevel = /* @__PURE__ */ Reference("effect/Tracer/MinimumTraceLevel", {
  defaultValue: () => "All"
});
var TracerKey = "effect/Tracer";
var Tracer = /* @__PURE__ */ Reference(TracerKey, {
  fiberCached: true,
  defaultValue: () => nativeTracer
});
var nativeTracer = /* @__PURE__ */ make4({
  span: (options) => new NativeSpan(options)
});

class NativeSpan {
  _tag = "Span";
  sampled;
  name;
  parent;
  annotations;
  links;
  startTime;
  kind;
  status;
  _traceId = undefined;
  _spanId = undefined;
  _attributes = undefined;
  _events = undefined;
  constructor(options) {
    this.name = options.name;
    this.parent = options.parent;
    this.annotations = options.annotations;
    this.links = options.links;
    this.startTime = options.startTime;
    this.kind = options.kind;
    this.sampled = options.sampled;
    this.status = {
      _tag: "Started",
      startTime: options.startTime
    };
  }
  get traceId() {
    return this._traceId ??= getOrUndefined(this.parent)?.traceId ?? randomHex(32);
  }
  get spanId() {
    return this._spanId ??= randomHex(16);
  }
  get attributes() {
    return this._attributes ??= new Map;
  }
  get events() {
    return this._events ??= [];
  }
  end(endTime, exit) {
    this.status = {
      _tag: "Ended",
      endTime,
      exit,
      startTime: this.status.startTime
    };
  }
  attribute(key, value) {
    this.attributes.set(key, value);
  }
  event(name, startTime, attributes) {
    this.events.push([name, startTime, attributes ?? {}]);
  }
  addLinks(links) {
    this.links.push(...links);
  }
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/metric.js
var FiberRuntimeMetricsKey = "effect/Metric/FiberRuntimeMetrics";

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/references.js
var CurrentStackFrame = /* @__PURE__ */ Reference("effect/References/CurrentStackFrame", {
  fiberCached: true,
  defaultValue: constUndefined
});
var TracerEnabled = /* @__PURE__ */ Reference("effect/References/TracerEnabled", {
  fiberCached: true,
  defaultValue: constTrue
});
var TracerTimingEnabled = /* @__PURE__ */ Reference("effect/References/TracerTimingEnabled", {
  defaultValue: constTrue
});
var TracerSpanAnnotations = /* @__PURE__ */ Reference("effect/References/TracerSpanAnnotations", {
  defaultValue: () => ({})
});
var TracerSpanLinks = /* @__PURE__ */ Reference("effect/References/TracerSpanLinks", {
  defaultValue: () => []
});
var CurrentLogAnnotations = /* @__PURE__ */ Reference("effect/References/CurrentLogAnnotations", {
  defaultValue: () => ({})
});
var CurrentLogLevel = /* @__PURE__ */ Reference("effect/References/CurrentLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var MinimumLogLevel = /* @__PURE__ */ Reference("effect/References/MinimumLogLevel", {
  fiberCached: true,
  defaultValue: () => "Info"
});
var CurrentLogSpans = /* @__PURE__ */ Reference("effect/References/CurrentLogSpans", {
  defaultValue: () => []
});

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/tracer.js
var makeStackCleaner = (line) => (stack) => {
  let cache;
  return () => {
    if (cache !== undefined)
      return cache;
    const trace = stack();
    if (!trace)
      return;
    const lines = trace.split(`
`);
    if (lines[line] !== undefined) {
      cache = lines[line].trim();
      return cache;
    }
  };
};

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/effect.js
class Interrupt extends ReasonBase {
  constructor(fiberId, annotations = constEmptyAnnotations) {
    super("Interrupt", annotations, "Interrupted");
    this.fiberId = fiberId;
  }
  toString() {
    return `Interrupt(${this.fiberId})`;
  }
  toJSON() {
    return {
      _tag: "Interrupt",
      fiberId: this.fiberId
    };
  }
  [symbol2](that) {
    return isInterruptReason(that) && this.fiberId === that.fiberId && this.annotations === that.annotations;
  }
  [symbol]() {
    return combine(string(`${this._tag}:${this.fiberId}`))(random(this.annotations));
  }
}
var causeInterrupt = (fiberId) => new CauseImpl([new Interrupt(fiberId)]);
var findError = (self) => {
  for (let i = 0;i < self.reasons.length; i++) {
    const reason = self.reasons[i];
    if (reason._tag === "Fail") {
      return succeed2(reason.error);
    }
  }
  return fail2(self);
};
var findDefect = (self) => {
  const reason = self.reasons.find(isDieReason);
  return reason ? succeed2(reason.defect) : fail2(self);
};
var hasInterrupts = (self) => self.reasons.some(isInterruptReason);
var causeFilterInterruptors = (self) => {
  let interruptors;
  for (let i = 0;i < self.reasons.length; i++) {
    const f = self.reasons[i];
    if (f._tag !== "Interrupt")
      continue;
    interruptors ??= new Set;
    if (f.fiberId !== undefined) {
      interruptors.add(f.fiberId);
    }
  }
  return interruptors ? succeed2(interruptors) : fail2(self);
};
var hasInterruptsOnly = (self) => self.reasons.length > 0 && self.reasons.every(isInterruptReason);
var dedupeReasons = (self, that) => {
  const buckets = new Map;
  const out = [];
  for (const reason of self.concat(that)) {
    const hash2 = hash(reason);
    const bucket = buckets.get(hash2);
    if (bucket === undefined) {
      buckets.set(hash2, [reason]);
    } else if (bucket.some((previous) => equals(previous, reason))) {
      continue;
    } else {
      bucket.push(reason);
    }
    out.push(reason);
  }
  return out;
};
var causeCombine = /* @__PURE__ */ dual(2, (self, that) => {
  if (self.reasons.length === 0) {
    return that;
  } else if (that.reasons.length === 0) {
    return self;
  }
  const newCause = new CauseImpl(dedupeReasons(self.reasons, that.reasons));
  return equals(self, newCause) ? self : newCause;
});
var causeMap = /* @__PURE__ */ dual(2, (self, f) => {
  let hasFail = false;
  const failures = self.reasons.map((failure) => {
    if (isFailReason(failure)) {
      hasFail = true;
      return new Fail(f(failure.error), failure.annotations);
    }
    return failure;
  });
  return hasFail ? causeFromReasons(failures) : self;
});
var causePartition = (self) => {
  const obj = {
    Fail: [],
    Die: [],
    Interrupt: []
  };
  for (let i = 0;i < self.reasons.length; i++) {
    obj[self.reasons[i]._tag].push(self.reasons[i]);
  }
  return obj;
};
var causeSquash = (self) => {
  const partitioned = causePartition(self);
  if (partitioned.Fail.length > 0) {
    return partitioned.Fail[0].error;
  } else if (partitioned.Die.length > 0) {
    return partitioned.Die[0].defect;
  } else if (partitioned.Interrupt.length > 0) {
    return new globalThis.Error("All fibers interrupted without error");
  }
  return new globalThis.Error("Empty cause");
};
var causePrettyErrors = (self, options) => {
  const errors = [];
  const interrupts = [];
  if (self.reasons.length === 0)
    return errors;
  const prevStackLimit = getStackTraceLimit();
  if (prevStackLimit !== 0)
    setStackTraceLimit(1);
  for (const failure of self.reasons) {
    if (failure._tag === "Interrupt") {
      interrupts.push(failure);
      continue;
    }
    errors.push(causePrettyError(failure._tag === "Die" ? failure.defect : failure.error, failure.annotations, options));
  }
  if (errors.length === 0) {
    const cause = new Error("The fiber was interrupted by:");
    cause.name = "InterruptCause";
    cause.stack = interruptCauseStack(cause, interrupts);
    const error = new globalThis.Error("All fibers interrupted without error", {
      cause
    });
    error.name = "InterruptError";
    error.stack = `${error.name}: ${error.message}`;
    errors.push(causePrettyError(error, interrupts[0].annotations, options));
  }
  if (prevStackLimit !== 0)
    setStackTraceLimit(prevStackLimit);
  return errors;
};
var causePrettyError = (original, annotations, options) => {
  const kind = typeof original;
  let error;
  if (original && kind === "object") {
    error = new globalThis.Error(causePrettyMessage(original), {
      cause: original.cause ? causePrettyError(original.cause) : undefined
    });
    if (typeof original.name === "string") {
      error.name = original.name;
    }
    if (typeof original.stack === "string") {
      error.stack = cleanErrorStack(original.stack, error, annotations);
    } else {
      const stack = `${error.name}: ${error.message}`;
      error.stack = annotations ? addStackAnnotations(stack, annotations) : stack;
    }
    if (options?.includeCauseInStack) {
      error.stack = renderPrettyError(error);
    }
    for (const key of Object.keys(original)) {
      if (!(key in error)) {
        error[key] = original[key];
      }
    }
  } else {
    error = new globalThis.Error(!original ? `Unknown error: ${original}` : kind === "string" ? original : formatJson(original));
  }
  return error;
};
var causePrettyMessage = (u) => {
  if (typeof u.message === "string") {
    return u.message;
  } else if (typeof u.toString === "function" && u.toString !== Object.prototype.toString && u.toString !== Array.prototype.toString) {
    try {
      return u.toString();
    } catch {}
  }
  return formatJson(u);
};
var locationRegExp = /\((.*)\)/g;
var cleanErrorStack = (stack, error, annotations) => {
  const message = `${error.name}: ${error.message}`;
  const lines = (stack.startsWith(message) ? stack.slice(message.length) : stack).split(`
`);
  const out = [message];
  for (let i = 1;i < lines.length; i++) {
    if (/(?:Generator\.next|~effect\/Effect)/.test(lines[i])) {
      break;
    }
    out.push(lines[i]);
  }
  return annotations ? addStackAnnotations(out.join(`
`), annotations) : out.join(`
`);
};
var addStackAnnotations = (stack, annotations) => {
  const frame = annotations?.get(StackTraceKey.key);
  if (frame) {
    stack = `${stack}
${currentStackTrace(frame)}`;
  }
  return stack;
};
var interruptCauseStack = (error, interrupts) => {
  const out = [`${error.name}: ${error.message}`];
  for (const current of interrupts) {
    const fiberId = current.fiberId !== undefined ? `#${current.fiberId}` : "unknown";
    const frame = current.annotations.get(InterruptorStackTrace.key);
    out.push(`    at fiber (${fiberId})`);
    if (frame)
      out.push(currentStackTrace(frame));
  }
  return out.join(`
`);
};
var currentStackTrace = (frame) => {
  const out = [];
  let current = frame;
  let i = 0;
  while (current && i < 10) {
    const stack = current.stack();
    if (stack) {
      const locationMatchAll = stack.matchAll(locationRegExp);
      let match = false;
      for (const [, location] of locationMatchAll) {
        match = true;
        out.push(`    at ${current.name} (${location})`);
      }
      if (!match) {
        out.push(`    at ${current.name} (${stack.replace(/^at /, "")})`);
      }
    } else {
      out.push(`    at ${current.name}`);
    }
    current = current.parent;
    i++;
  }
  return out.join(`
`);
};
var causePretty = (cause) => causePrettyErrors(cause).map(renderPrettyError).join(`
`);
var renderPrettyError = (e) => e.cause ? `${e.stack} {
${renderErrorCause(e.cause, "  ")}
}` : e.stack;
var renderErrorCause = (cause, prefix) => {
  const lines = cause.stack.split(`
`);
  let stack = `${prefix}[cause]: ${lines[0]}`;
  for (let i = 1, len = lines.length;i < len; i++) {
    stack += `
${prefix}${lines[i]}`;
  }
  if (cause.cause) {
    stack += ` {
${renderErrorCause(cause.cause, `${prefix}  `)}
${prefix}}`;
  }
  return stack;
};
var FiberTypeId = "~effect/Fiber";
var fiberVariance = {
  _A: identity,
  _E: identity
};
var fiberIdStore = {
  id: 0
};
var getCurrentFiber = () => globalThis[currentFiberTypeId];

class FiberImpl {
  constructor(context, interruptible = true) {
    this[FiberTypeId] = fiberVariance;
    this.setContext(context);
    this.id = ++fiberIdStore.id;
    this.currentOpCount = 0;
    this.interruptible = interruptible;
    this._stack = [];
    this._observers = undefined;
    this._exit = undefined;
    this._children = undefined;
    this._interruptedCause = undefined;
    this._yielded = undefined;
    this._running = false;
    this._deferredInterrupt = false;
    this._parent = undefined;
    this.cache.runtimeMetrics?.recordFiberStart(this.context);
  }
  [FiberTypeId];
  id;
  interruptible;
  currentOpCount;
  _stack;
  _observers;
  _exit;
  _children;
  _interruptedCause;
  _yielded;
  _running;
  _deferredInterrupt;
  _parent;
  context;
  cache;
  _dispatcher = undefined;
  get currentDispatcher() {
    return this._dispatcher ??= this.cache.scheduler.makeDispatcher();
  }
  getRef(ref) {
    return get(this.context, ref);
  }
  addObserver(cb) {
    if (this._exit) {
      cb(this._exit);
      return constVoid;
    }
    if (this._observers === undefined) {
      this._observers = [cb];
    } else {
      this._observers.push(cb);
    }
    return () => {
      if (this._exit || this._observers === undefined)
        return;
      const index = this._observers.indexOf(cb);
      if (index >= 0) {
        this._observers.splice(index, 1);
      }
    };
  }
  interruptUnsafe(fiberId, annotations) {
    if (this._exit) {
      return;
    }
    let cause = causeInterrupt(fiberId);
    if (this.cache.stackFrame) {
      cause = causeAnnotate(cause, make2(StackTraceKey, this.cache.stackFrame));
    }
    if (annotations) {
      cause = causeAnnotate(cause, annotations);
    }
    this._interruptedCause = this._interruptedCause ? causeCombine(this._interruptedCause, cause) : cause;
    if (this.interruptible) {
      if (this._running) {
        this._deferredInterrupt = true;
      } else {
        this.evaluate(failCause(this._interruptedCause));
      }
    }
  }
  pollUnsafe() {
    return this._exit;
  }
  evaluate(effect) {
    if (this._exit) {
      return;
    } else if (this._yielded !== undefined) {
      const yielded = this._yielded;
      this._yielded = undefined;
      yielded();
    }
    const exit = this.runLoop(effect);
    if (exit === Yield) {
      return;
    }
    const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
    if (interruptChildren !== undefined) {
      return this.evaluate(flatMap(interruptChildren, () => exit));
    }
    this._exit = exit;
    this.cache.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
    if (this._parent) {
      this._parent._children?.delete(this);
      this._parent = undefined;
    }
    if (this._observers !== undefined) {
      const observers = this._observers;
      this._observers = undefined;
      for (let i = 0;i < observers.length; i++) {
        observers[i](exit);
      }
    }
    this._stack.length = 0;
    this._children = undefined;
    this.context = empty3();
  }
  runLoop(effect) {
    const prevFiber = globalThis[currentFiberTypeId];
    globalThis[currentFiberTypeId] = this;
    const prevRunning = this._running;
    this._running = true;
    let yielding = false;
    let current = effect;
    this.currentOpCount = 0;
    try {
      while (true) {
        if (this._deferredInterrupt) {
          this._deferredInterrupt = false;
          current = failCause(this._interruptedCause);
        }
        this.currentOpCount++;
        const cache = this.cache;
        if (!yielding && !cache.preventYield && cache.scheduler.shouldYield(this)) {
          yielding = true;
          const prev = current;
          current = flatMap(yieldNow, () => prev);
        }
        current = cache.tracerContext ? cache.tracerContext(current, this) : current[evaluate](this);
        if (current === Yield) {
          const yielded = this._yielded;
          if (ExitTypeId in yielded) {
            this._deferredInterrupt = false;
            this._yielded = undefined;
            return yielded;
          } else if (this._deferredInterrupt) {
            this._yielded = undefined;
            yielded();
            continue;
          }
          return Yield;
        }
      }
    } catch (error) {
      if (!hasProperty(current, evaluate)) {
        return exitDie(`Fiber.runLoop: Not a valid effect: ${String(current)}`);
      }
      return this.runLoop(exitDie(error));
    } finally {
      this._running = prevRunning;
      globalThis[currentFiberTypeId] = prevFiber;
    }
  }
  getCont(symbol) {
    if (this._deferredInterrupt) {
      this._deferredInterrupt = false;
      return deferredInterruptCont;
    }
    while (true) {
      const op = this._stack.pop();
      if (!op)
        return;
      const all = op[contAll];
      if (all !== undefined) {
        const cont = all.call(op, this);
        if (cont) {
          cont[symbol] = cont;
          return cont;
        }
      }
      if (op[symbol])
        return op;
    }
  }
  yieldWith(value) {
    this._yielded = value;
    return Yield;
  }
  children() {
    return this._children ??= new Set;
  }
  pipe() {
    return pipeArguments(this, arguments);
  }
  setContext(context) {
    const previous = this.context;
    this.context = context;
    if (previous !== undefined && hasSameCache(previous, context))
      return;
    const root = context.cacheRoot;
    const cache = root._fiberCache ??= makeFiberContextCache(context);
    if (this.cache !== undefined && this.cache.scheduler !== cache.scheduler) {
      this._dispatcher = undefined;
    }
    this.cache = cache;
  }
  get currentSpanLocal() {
    const span = this.cache.span;
    return span?._tag === "Span" ? span : undefined;
  }
}
var makeFiberContextCache = (context) => {
  const currentTracer = getOrUndefinedUnsafe(context, TracerKey);
  return {
    scheduler: get(context, Scheduler),
    tracer: currentTracer,
    tracerContext: currentTracer ? currentTracer["context"] : undefined,
    tracerEnabled: get(context, TracerEnabled),
    span: getOrUndefinedUnsafe(context, ParentSpanKey),
    logLevel: get(context, CurrentLogLevel),
    minimumLogLevel: get(context, MinimumLogLevel),
    stackFrame: get(context, CurrentStackFrame),
    runtimeMetrics: getOrUndefinedUnsafe(context, FiberRuntimeMetricsKey),
    maxOpsBeforeYield: get(context, MaxOpsBeforeYield),
    preventYield: get(context, PreventSchedulerYield)
  };
};
var deferredInterruptCont = {
  [contA](_value, fiber) {
    return failCause(fiber._interruptedCause);
  },
  [contE](_cause, fiber) {
    return failCause(fiber._interruptedCause);
  }
};
var fiberMiddleware = {
  interruptChildren: undefined
};
var fiberStackAnnotations = (fiber) => {
  if (!fiber.cache.stackFrame)
    return;
  const annotations = new Map;
  annotations.set(InterruptorStackTrace.key, fiber.cache.stackFrame);
  return makeUnsafe(annotations);
};
var fiberAwait = (self) => {
  const impl = self;
  if (impl._exit)
    return succeed3(impl._exit);
  return callback((resume) => {
    if (impl._exit)
      return resume(succeed3(impl._exit));
    return sync(self.addObserver((exit) => resume(succeed3(exit))));
  });
};
var fiberAwaitAll = (self) => callback((resume) => {
  const iter = self[Symbol.iterator]();
  const exits = [];
  let cancel = undefined;
  function loop() {
    let result = iter.next();
    while (!result.done) {
      if (result.value._exit) {
        exits.push(result.value._exit);
        result = iter.next();
        continue;
      }
      cancel = result.value.addObserver((exit) => {
        exits.push(exit);
        loop();
      });
      return;
    }
    resume(succeed3(exits));
  }
  loop();
  return sync(() => cancel?.());
});
var fiberInterrupt = (self) => withFiber((fiber) => fiberInterruptAs(self, fiber.id));
var fiberInterruptAs = /* @__PURE__ */ dual((args) => hasProperty(args[0], FiberTypeId), (self, fiberId, annotations) => withFiber((parent) => {
  let ann = fiberStackAnnotations(parent);
  ann = ann && annotations ? merge(ann, annotations) : ann ?? annotations;
  self.interruptUnsafe(fiberId, ann);
  return asVoid(fiberAwait(self));
}));
var fiberInterruptAll = (fibers) => withFiber((parent) => {
  const annotations = fiberStackAnnotations(parent);
  let fiberArr = empty2();
  for (const fiber of fibers) {
    fiber.interruptUnsafe(parent.id, annotations);
    fiberArr.push(fiber);
  }
  return asVoid(fiberAwaitAll(fiberArr));
});
var succeed3 = exitSucceed;
var failCause = exitFailCause;
var fail3 = exitFail;
var sync = /* @__PURE__ */ makePrimitive({
  op: "Sync",
  [evaluate](fiber) {
    const value = this[args]();
    const cont = fiber.getCont(contA);
    return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
  }
});
var suspend = /* @__PURE__ */ makePrimitive({
  op: "Suspend",
  [evaluate](_fiber) {
    return this[args]();
  }
});
var fromResult = /* @__PURE__ */ match2({
  onFailure: fail3,
  onSuccess: succeed3
});
var yieldNowWith = /* @__PURE__ */ makePrimitive({
  op: "Yield",
  [evaluate](fiber) {
    let resumed = false;
    fiber.currentDispatcher.scheduleTask(() => {
      if (resumed)
        return;
      fiber.evaluate(exitVoid);
    }, this[args] ?? 0);
    return fiber.yieldWith(() => {
      resumed = true;
    });
  }
});
var yieldNow = /* @__PURE__ */ yieldNowWith(0);
var succeedNone = /* @__PURE__ */ succeed3(/* @__PURE__ */ none2());
var failCauseSync = (evaluate) => suspend(() => failCause(internalCall(evaluate)));
var die = (defect) => exitDie(defect);
var failSync = (error) => suspend(() => fail3(internalCall(error)));
var void_ = /* @__PURE__ */ succeed3(undefined);
var try_ = (options) => {
  const evaluate = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.try") : options.catch;
  return suspend(() => {
    try {
      return succeed3(internalCall(evaluate));
    } catch (err) {
      return fail3(internalCall(() => catcher(err)));
    }
  });
};
var promise = (evaluate) => callbackOptions(function(resume, signal) {
  internalCall(() => evaluate(signal)).then((a) => resume(succeed3(a)), (e) => resume(die(e)));
}, evaluate.length !== 0);
var tryPromise = (options) => {
  const f = typeof options === "function" ? options : options.try;
  const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.tryPromise") : options.catch;
  return callbackOptions(function(resume, signal) {
    const failWithCatch = (cause) => {
      try {
        resume(fail3(internalCall(() => catcher(cause))));
      } catch (err) {
        resume(die(err));
      }
    };
    try {
      internalCall(() => f(signal)).then((a) => resume(succeed3(a)), failWithCatch);
    } catch (err) {
      failWithCatch(err);
    }
  }, f.length !== 0);
};
var withFiberId = (f) => withFiber((fiber) => f(fiber.id));
var callbackOptions = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Async",
    [evaluate](fiber) {
      const register = internalCall(() => this.register.bind(fiber.cache.scheduler));
      let resumed = false;
      let yielded = false;
      const controller = this.withSignal ? new AbortController : undefined;
      const onCancel = register((effect) => {
        if (resumed)
          return;
        resumed = true;
        if (yielded) {
          fiber.evaluate(effect);
        } else {
          yielded = effect;
        }
      }, controller?.signal);
      if (yielded !== false)
        return yielded;
      yielded = true;
      fiber._yielded = () => {
        resumed = true;
      };
      if (controller === undefined && onCancel === undefined) {
        return Yield;
      }
      fiber._stack.push(asyncFinalizer(() => {
        resumed = true;
        controller?.abort();
        return onCancel ?? exitVoid;
      }));
      return Yield;
    }
  });
  const AsyncImpl = function(register, withSignal) {
    this.register = register;
    this.withSignal = withSignal;
  };
  AsyncImpl.prototype = Proto;
  return function(register, withSignal) {
    return new AsyncImpl(register, withSignal);
  };
}();
var asyncFinalizer = /* @__PURE__ */ makePrimitive({
  op: "AsyncFinalizer",
  [contAll](fiber) {
    if (fiber.interruptible) {
      fiber.interruptible = false;
      fiber._stack.push(setInterruptibleTrue);
    }
  },
  [contE](cause, _fiber) {
    return hasInterrupts(cause) ? flatMap(this[args](), () => failCause(cause)) : failCause(cause);
  }
});
var callback = (register) => callbackOptions(register, register.length >= 2);
var never = /* @__PURE__ */ callback(constVoid);
var gen = (...args) => {
  if (args.length === 1) {
    const body = args[0];
    return suspend(() => fromIteratorUnsafe(body()));
  }
  const [options, body] = args;
  return suspend(() => fromIteratorUnsafe(body.call(options.self)));
};
var fnUntraced = (body, ...pipeables) => {
  const fn = pipeables.length === 0 ? function() {
    return suspend(() => fromIteratorUnsafe(body.apply(this, arguments)));
  } : function() {
    let effect = suspend(() => fromIteratorUnsafe(body.apply(this, arguments)));
    for (let i = 0;i < pipeables.length; i++) {
      effect = pipeables[i](effect, ...arguments);
    }
    return effect;
  };
  return defineFunctionLength(body.length, fn);
};
var defineFunctionLength = (length, fn) => Object.defineProperty(fn, "length", {
  value: length,
  configurable: true
});
var fnStackCleaner = /* @__PURE__ */ makeStackCleaner(2);
var fn = function() {
  const nameFirst = typeof arguments[0] === "string";
  const name = nameFirst ? arguments[0] : "Effect.fn";
  const spanOptions = nameFirst ? arguments[1] : undefined;
  const prevLimit = getStackTraceLimit();
  let defError;
  if (prevLimit !== 0) {
    setStackTraceLimit(2);
    defError = new globalThis.Error;
    setStackTraceLimit(prevLimit);
  }
  if (nameFirst) {
    return (body, ...pipeables) => makeFn(name, body, defError, pipeables, nameFirst, spanOptions);
  }
  return makeFn(name, arguments[0], defError, Array.prototype.slice.call(arguments, 1), nameFirst, spanOptions);
};
var makeFn = (name, bodyOrOptions, defError, pipeables, addSpan, spanOptions) => {
  const body = typeof bodyOrOptions === "function" ? bodyOrOptions : pipeables.shift().bind(bodyOrOptions.self);
  return defineFunctionLength(body.length, function(...args) {
    let result = suspend(() => {
      const iter = body.apply(this, arguments);
      return isEffect(iter) ? iter : fromIteratorUnsafe(iter);
    });
    for (let i = 0;i < pipeables.length; i++) {
      result = pipeables[i](result, ...args);
    }
    if (!isEffect(result)) {
      return result;
    }
    const prevLimit = getStackTraceLimit();
    let callError;
    if (prevLimit !== 0) {
      setStackTraceLimit(2);
      callError = new globalThis.Error;
      setStackTraceLimit(prevLimit);
    }
    return updateService(addSpan ? useSpan(name, spanOptions, (span) => provideParentSpan(result, span)) : result, CurrentStackFrame, (prev) => ({
      name,
      stack: callError ? fnStackCleaner(() => callError.stack) : constUndefined,
      parent: {
        name: `${name} (definition)`,
        stack: defError ? fnStackCleaner(() => defError.stack) : constUndefined,
        parent: prev
      }
    }));
  });
};
var fnUntracedEager = (body, ...pipeables) => defineFunctionLength(body.length, pipeables.length === 0 ? function() {
  return fromIteratorEagerUnsafe(() => body.apply(this, arguments));
} : function() {
  let effect = fromIteratorEagerUnsafe(() => body.apply(this, arguments));
  for (const pipeable of pipeables) {
    effect = pipeable(effect, ...arguments);
  }
  return effect;
});
var fromIteratorEagerUnsafe = (evaluate) => {
  try {
    const iterator = evaluate();
    let value = undefined;
    while (true) {
      const state = iterator.next(value);
      if (state.done) {
        return succeed3(state.value);
      }
      const primitive = state.value;
      if (primitive && primitive._tag === "Success") {
        value = primitive.value;
        continue;
      } else if (primitive && primitive._tag === "Failure") {
        return state.value;
      } else {
        let isFirstExecution = true;
        return suspend(() => {
          if (isFirstExecution) {
            isFirstExecution = false;
            return flatMap(state.value, (value) => fromIteratorUnsafe(iterator, value));
          } else {
            return suspend(() => fromIteratorUnsafe(evaluate()));
          }
        });
      }
    }
  } catch (error) {
    return die(error);
  }
};
var fromIteratorUnsafe = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "Iterator",
    [contA](value, fiber) {
      const iter = this.iterator;
      while (true) {
        const state = iter.next(value);
        if (state.done)
          return succeed3(state.value);
        if (!effectIsExit(state.value)) {
          fiber._stack.push(this);
          return state.value;
        } else if (state.value._tag === "Failure") {
          return state.value;
        }
        value = state.value.value;
      }
    },
    [evaluate](fiber) {
      return this[contA](this.initial, fiber);
    }
  });
  const IteratorImpl = function(iterator, initial) {
    this.iterator = iterator;
    this.initial = initial;
  };
  IteratorImpl.prototype = Proto;
  return function(iterator, initial) {
    return new IteratorImpl(iterator, initial);
  };
}();
var as = /* @__PURE__ */ dual(2, (self, value) => new ContImpl(self, returnPayload, succeed3(value)));
var evaluateCont = function(fiber) {
  fiber._stack.push(this);
  return this[args];
};
var OnSuccessProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccess",
  [evaluate]: evaluateCont
});
var OnSuccessImpl = function(self, f) {
  this[args] = self;
  this[contA] = f;
};
OnSuccessImpl.prototype = OnSuccessProto;
var ContImpl = function(self, cont, payload) {
  this[args] = self;
  this[contA] = cont;
  this.payload = payload;
};
ContImpl.prototype = OnSuccessProto;
var returnPayload = function() {
  return this.payload;
};
var mapCont = function(value) {
  const f = this.payload;
  return succeed3(internalCall(() => f(value)));
};
var andThenCont = function(value) {
  const f = this.payload;
  return internalCall(() => f(value));
};
var tapCont = function(value) {
  const f = this.payload;
  return new ContImpl(internalCall(() => f(value)), returnPayload, exitSucceed(value));
};
var tapEffectCont = function(value) {
  return new ContImpl(this.payload, returnPayload, exitSucceed(value));
};
var asSome = (self) => map4(self, some2);
var andThen = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, isEffect(f) ? returnPayload : andThenCont, f));
var tap = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, isEffect(f) ? tapEffectCont : tapCont, f));
var asVoid = (self) => new ContImpl(self, returnPayload, exitVoid);
var raceAllFirst = (all, options) => withFiber((parent) => callback((resume) => {
  let done = false;
  const fibers = new Set;
  const onExit = (exit) => {
    done = true;
    resume(fibers.size === 0 ? exit : flatMap(uninterruptible(fiberInterruptAll(fibers)), () => exit));
  };
  let i = 0;
  for (const effect of all) {
    if (done)
      break;
    const index = i++;
    const fiber = forkUnsafe(parent, effect, true, true, false);
    fibers.add(fiber);
    fiber.addObserver((exit) => {
      fibers.delete(fiber);
      const isWinner = !done;
      onExit(exit);
      if (isWinner && options?.onWinner) {
        options.onWinner({
          fiber,
          index,
          parentFiber: parent
        });
      }
    });
  }
  return fiberInterruptAll(fibers);
}));
var raceFirst = /* @__PURE__ */ dual((args) => isEffect(args[1]), (self, that, options) => raceAllFirst([self, that], options));
var flatMap = /* @__PURE__ */ dual(2, (self, f) => new OnSuccessImpl(self, f.length !== 1 ? (a) => f(a) : f));
var effectIsExit = (effect) => effect[ExitTypeId] !== undefined;
var flatMapEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    return self._tag === "Success" ? f(self.value) : self;
  }
  return flatMap(self, f);
});
var flatten2 = (self) => flatMap(self, identity);
var map4 = /* @__PURE__ */ dual(2, (self, f) => new ContImpl(self, mapCont, f));
var mapEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMap(self, f) : map4(self, f));
var mapErrorEager = /* @__PURE__ */ dual(2, (self, f) => effectIsExit(self) ? exitMapError(self, f) : mapError2(self, f));
var catchEager = /* @__PURE__ */ dual(2, (self, f) => {
  if (effectIsExit(self)) {
    if (self._tag === "Success")
      return self;
    const error = findError(self.cause);
    if (isFailure2(error))
      return self;
    return f(error.success);
  }
  return catch_(self, f);
});
var exitIsSuccess = (self) => self._tag === "Success";
var exitIsFailure = (self) => self._tag === "Failure";
var exitVoid = /* @__PURE__ */ exitSucceed(undefined);
var exitMap = /* @__PURE__ */ dual(2, (self, f) => self._tag === "Success" ? exitSucceed(f(self.value)) : self);
var exitMapError = /* @__PURE__ */ dual(2, (self, f) => {
  if (self._tag === "Success")
    return self;
  const error = findError(self.cause);
  if (isFailure2(error))
    return self;
  return exitFail(f(error.success));
});
var exitAsVoidAll = (exits) => {
  const failures = [];
  for (const exit of exits) {
    if (exit._tag === "Failure") {
      failures.push(...exit.cause.reasons);
    }
  }
  return failures.length === 0 ? exitVoid : exitFailCause(causeFromReasons(failures));
};
var updateContext = /* @__PURE__ */ dual(2, (self, f) => withFiber((fiber) => {
  const prevContext = fiber.context;
  const nextContext = f(prevContext);
  if (prevContext === nextContext)
    return self;
  fiber.setContext(nextContext);
  return onExitPrimitive(self, () => {
    fiber.setContext(prevContext);
    return;
  });
}));
var updateService = /* @__PURE__ */ dual(3, (self, service, f) => updateContext(self, (s) => {
  const prev = getUnsafe(s, service);
  const next = f(prev);
  if (prev === next)
    return s;
  return add(s, service, next);
}));
var context = () => getContext;
var getContext = /* @__PURE__ */ withFiber((fiber) => succeed3(fiber.context));
var contextWith = (f) => withFiber((fiber) => f(fiber.context));
var provideContext = /* @__PURE__ */ dual(2, (self, context) => {
  if (effectIsExit(self))
    return self;
  return updateContext(self, merge(context));
});
var provideService = function() {
  if (arguments.length === 1) {
    return dual(2, (self, impl) => provideServiceImpl(self, arguments[0], impl));
  }
  return dual(3, (self, service, impl) => provideServiceImpl(self, service, impl)).apply(this, arguments);
};
var provideServiceImpl = (self, service, implementation) => updateContext(self, add(service, implementation));
var forever = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, options) => whileLoop({
  while: constTrue,
  body: constant(options?.disableYield ? self : flatMap(self, (_) => yieldNow)),
  step: constVoid
}));
var catchCause = /* @__PURE__ */ dual(2, (self, f) => new OnFailureImpl(self, f.length !== 1 ? (cause) => f(cause) : f));
var OnFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnFailure",
  [evaluate]: evaluateCont
});
var OnFailureImpl = function(self, f) {
  this[args] = self;
  this[contE] = f;
};
OnFailureImpl.prototype = OnFailureProto;
var catchCauseFilter = /* @__PURE__ */ dual(3, (self, filter, f) => catchCause(self, (cause) => {
  const eb = filter(cause);
  return isFailure2(eb) ? failCause(eb.failure) : internalCall(() => f(eb.success, cause));
}));
var catch_ = /* @__PURE__ */ dual(2, (self, f) => catchCauseFilter(self, findError, (e) => f(e)));
var catchDefect = /* @__PURE__ */ dual(2, (self, f) => catchCauseFilter(self, findDefect, f));
var catchIf = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, predicate, f, orElse) => catchCause(self, (cause) => {
  const error = findError(cause);
  if (isFailure2(error))
    return failCause(error.failure);
  if (!predicate(error.success)) {
    return orElse ? internalCall(() => orElse(error.success)) : failCause(cause);
  }
  return internalCall(() => f(error.success));
}));
var catchFilter = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, filter, f, orElse) => catchCause(self, (cause) => {
  const error = findError(cause);
  if (isFailure2(error))
    return failCause(error.failure);
  const result = filter(error.success);
  if (isFailure2(result)) {
    return orElse ? internalCall(() => orElse(result.failure)) : failCause(cause);
  }
  return internalCall(() => f(result.success));
}));
var catchTag = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, k, f, orElse) => {
  const pred = Array.isArray(k) ? (e) => hasProperty(e, "_tag") && k.includes(e._tag) : isTagged(k);
  return catchIf(self, pred, f, orElse);
});
var catchTags = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, cases, orElse) => {
  let keys;
  return catchFilter(self, (e) => {
    keys ??= Object.keys(cases);
    return hasProperty(e, "_tag") && isString(e["_tag"]) && keys.includes(e["_tag"]) ? succeed2(e) : fail2(e);
  }, (e) => internalCall(() => cases[e["_tag"]](e)), orElse);
});
var mapError2 = /* @__PURE__ */ dual(2, (self, f) => catch_(self, (error) => failSync(() => f(error))));
var orDie = (self) => catch_(self, die);
var orElseSucceed = /* @__PURE__ */ dual(2, (self, f) => catch_(self, (error) => sync(() => f(error))));
var option = (self) => match4(self, {
  onFailure: none2,
  onSuccess: some2
});
var result = (self) => matchEager(self, {
  onFailure: fail2,
  onSuccess: succeed2
});
var matchCauseEffect = /* @__PURE__ */ dual(2, (self, options) => new OnSuccessAndFailureImpl(self, options.onSuccess.length !== 1 ? (a) => options.onSuccess(a) : options.onSuccess, options.onFailure.length !== 1 ? (cause) => options.onFailure(cause) : options.onFailure));
var OnSuccessAndFailureProto = /* @__PURE__ */ makePrimitiveProto({
  op: "OnSuccessAndFailure",
  [evaluate]: evaluateCont
});
var OnSuccessAndFailureImpl = function(self, onSuccess, onFailure) {
  this[args] = self;
  this[contA] = onSuccess;
  this[contE] = onFailure;
};
OnSuccessAndFailureImpl.prototype = OnSuccessAndFailureProto;
var matchEffect = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onFailure: (cause) => {
    const fail = cause.reasons.find(isFailReason);
    return fail ? internalCall(() => options.onFailure(fail.error)) : failCause(cause);
  },
  onSuccess: options.onSuccess
}));
var match4 = /* @__PURE__ */ dual(2, (self, options) => matchEffect(self, {
  onFailure: (error) => sync(() => options.onFailure(error)),
  onSuccess: (value) => sync(() => options.onSuccess(value))
}));
var matchEager = /* @__PURE__ */ dual(2, (self, options) => {
  if (effectIsExit(self)) {
    if (self._tag === "Success")
      return exitSucceed(options.onSuccess(self.value));
    const error = findError(self.cause);
    if (isFailure2(error))
      return self;
    return exitSucceed(options.onFailure(error.success));
  }
  return match4(self, options);
});
var exit = (self) => effectIsExit(self) ? exitSucceed(self) : exitPrimitive(self);
var exitPrimitive = /* @__PURE__ */ makePrimitive({
  op: "Exit",
  [evaluate](fiber) {
    fiber._stack.push(this);
    return this[args];
  },
  [contA](value, _, exit) {
    return succeed3(exit ?? exitSucceed(value));
  },
  [contE](cause, _, exit) {
    return succeed3(exit ?? exitFailCause(cause));
  }
});
var delay = /* @__PURE__ */ dual(2, (self, duration) => andThen(sleep(duration), self));
var timeoutOrElse = /* @__PURE__ */ dual(2, (self, options) => flatMap(timeoutOption(self, options.duration), (option) => isNone2(option) ? options.orElse() : succeed3(option.value)));
var timeoutOption = /* @__PURE__ */ dual(2, (self, duration) => raceFirst(asSome(self), as(sleep(duration), none2())));
var ScopeTypeId = "~effect/Scope";
var ScopeCloseableTypeId = "~effect/Scope/Closeable";
var scopeTag = /* @__PURE__ */ Service("effect/Scope");
var scopeClose = (self, exit_) => suspend(() => scopeCloseUnsafe(self, exit_) ?? void_);
var scopeCloseUnsafe = (self, exit_) => {
  if (self.state._tag === "Closed")
    return;
  const closed = {
    _tag: "Closed",
    exit: exit_
  };
  if (self.state._tag === "Empty") {
    self.state = closed;
    return;
  }
  const state = self.state;
  self.state = closed;
  if (state.finalizer !== undefined) {
    return state.finalizer(exit_);
  }
  const finalizers = state.finalizers;
  if (finalizers === undefined || finalizers.size === 0) {
    return;
  } else if (finalizers.size === 1) {
    return finalizers.values().next().value(exit_);
  }
  return scopeCloseFinalizers(self, finalizers, exit_);
};
var combineFinalizerCause = (exit_, finalizer) => exitIsSuccess(exit_) ? finalizer : catchCause(finalizer, (cause) => failCause(causeCombine(exit_.cause, cause)));
var scopeCloseFinalizers = /* @__PURE__ */ fnUntraced(function* (self, finalizers, exit_) {
  let exits = [];
  const fibers = [];
  const arr = Array.from(finalizers.values());
  const parent = getCurrentFiber();
  for (let i = arr.length - 1;i >= 0; i--) {
    const finalizer = arr[i];
    if (self.strategy === "sequential") {
      exits.push(yield* exit(finalizer(exit_)));
    } else {
      fibers.push(forkUnsafe(parent, finalizer(exit_), true, true, "inherit"));
    }
  }
  if (fibers.length > 0) {
    exits = yield* fiberAwaitAll(fibers);
  }
  return yield* exitAsVoidAll(exits);
});
var scopeForkUnsafe = (scope, finalizerStrategy) => {
  const newScope = scopeMakeUnsafe(finalizerStrategy);
  if (scope.state._tag === "Closed") {
    newScope.state = scope.state;
    return newScope;
  }
  const key = {};
  scopeAddFinalizerUnsafe(scope, key, (exit) => scopeClose(newScope, exit));
  scopeAddFinalizerUnsafe(newScope, key, (_) => sync(() => scopeRemoveFinalizerUnsafe(scope, key)));
  return newScope;
};
var scopeAddFinalizerExit = (scope, finalizer) => {
  return suspend(() => {
    if (scope.state._tag === "Closed") {
      return finalizer(scope.state.exit);
    }
    scopeAddFinalizerUnsafe(scope, {}, finalizer);
    return void_;
  });
};
var scopeAddFinalizer = (scope, finalizer) => scopeAddFinalizerExit(scope, constant(finalizer));
var scopeAddFinalizerUnsafe = (scope, key, finalizer) => {
  if (scope.state._tag === "Empty") {
    scope.state = {
      _tag: "Open",
      finalizerKey: key,
      finalizer,
      finalizers: undefined
    };
  } else if (scope.state._tag === "Open") {
    const state = scope.state;
    if (state.finalizer !== undefined) {
      state.finalizers = new Map([[state.finalizerKey, state.finalizer]]);
      state.finalizerKey = undefined;
      state.finalizer = undefined;
      state.finalizers.set(key, finalizer);
    } else if (state.finalizers === undefined) {
      state.finalizerKey = key;
      state.finalizer = finalizer;
    } else {
      state.finalizers.set(key, finalizer);
    }
  }
};
var scopeRemoveFinalizerUnsafe = (scope, key) => {
  if (scope.state._tag === "Open") {
    const state = scope.state;
    if (state.finalizerKey === key) {
      state.finalizerKey = undefined;
      state.finalizer = undefined;
    } else if (state.finalizers !== undefined) {
      state.finalizers.delete(key);
    }
  }
};
var scopeMakeUnsafe = (finalizerStrategy = "sequential") => ({
  [ScopeCloseableTypeId]: ScopeCloseableTypeId,
  [ScopeTypeId]: ScopeTypeId,
  strategy: finalizerStrategy,
  state: constScopeEmpty
});
var constScopeEmpty = {
  _tag: "Empty"
};
var scope = scopeTag;
var provideScope = /* @__PURE__ */ provideService(scopeTag);
var scoped = (self) => withFiber((fiber) => {
  const prev = fiber.context;
  const scope = scopeMakeUnsafe();
  fiber.setContext(add(fiber.context, scopeTag, scope));
  return onExitPrimitive(self, (exit) => {
    fiber.setContext(prev);
    return scopeCloseUnsafe(scope, exit);
  });
});
var acquireRelease = (acquire, release, options) => contextWith((context) => uninterruptibleMask((restore) => flatMap(scope, (scope) => tap(options?.interruptible ? restore(acquire) : acquire, (a) => scopeAddFinalizerExit(scope, (exit) => provideContext(release(a, exit), context))))));
var onExitPrimitive = /* @__PURE__ */ function() {
  const Proto = /* @__PURE__ */ makePrimitiveProto({
    op: "OnExit",
    [evaluate](fiber) {
      fiber._stack.push(this);
      return this.effect;
    },
    [contAll](fiber) {
      if (fiber.interruptible && this.interruptible !== true) {
        fiber._stack.push(setInterruptibleTrue);
        fiber.interruptible = false;
      }
    },
    [contA](value, _, exit) {
      exit ??= exitSucceed(value);
      const eff = this.onExit(exit);
      return eff ? flatMap(eff, (_) => exit) : exit;
    },
    [contE](cause, _, exit) {
      exit ??= exitFailCause(cause);
      const eff = this.onExit(exit);
      return eff ? flatMap(combineFinalizerCause(exit, eff), (_) => exit) : exit;
    }
  });
  const OnExitImpl = function(effect, onExit, interruptible) {
    this.effect = effect;
    this.onExit = onExit;
    this.interruptible = interruptible;
  };
  OnExitImpl.prototype = Proto;
  return function(effect, onExit, interruptible) {
    return new OnExitImpl(effect, onExit, interruptible);
  };
}();
var onExit = /* @__PURE__ */ dual(2, onExitPrimitive);
var ensuring = /* @__PURE__ */ dual(2, (self, finalizer) => onExit(self, (_) => finalizer));
var interrupt = /* @__PURE__ */ withFiber((fiber) => failCause(causeInterrupt(fiber.id)));
var uninterruptible = (self) => withFiber((fiber) => {
  if (!fiber.interruptible)
    return self;
  fiber.interruptible = false;
  fiber._stack.push(setInterruptibleTrue);
  return self;
});
var setInterruptible = /* @__PURE__ */ makePrimitive({
  op: "SetInterruptible",
  [contAll](fiber) {
    fiber.interruptible = this[args];
    if (fiber._interruptedCause && fiber.interruptible) {
      return () => failCause(fiber._interruptedCause);
    }
  }
});
var setInterruptibleTrue = /* @__PURE__ */ setInterruptible(true);
var setInterruptibleFalse = /* @__PURE__ */ setInterruptible(false);
var setFiberInterruptible = (fiber) => {
  fiber.interruptible = true;
  fiber._stack.push(setInterruptibleFalse);
  if (fiber._interruptedCause)
    return failCause(fiber._interruptedCause);
};
var interruptible = (self) => withFiber((fiber) => {
  if (fiber.interruptible)
    return self;
  return setFiberInterruptible(fiber) ?? self;
});
var uninterruptibleMask = (f) => withFiber((fiber) => {
  if (!fiber.interruptible)
    return f(identity);
  fiber.interruptible = false;
  fiber._stack.push(setInterruptibleTrue);
  return f(interruptible);
});
var all = (arg, options) => {
  if (isIterable(arg)) {
    return options?.mode === "result" ? forEach(arg, result, options) : forEach(arg, identity, options);
  } else if (options?.discard) {
    return options.mode === "result" ? forEach(Object.values(arg), result, options) : forEach(Object.values(arg), identity, options);
  }
  return suspend(() => {
    const out = {};
    return as(forEach(Object.entries(arg), ([key, effect]) => map4(options?.mode === "result" ? result(effect) : effect, (value) => {
      assignProperty(out, key, value);
    }), {
      discard: true,
      concurrency: options?.concurrency
    }), out);
  });
};
var whileLoop = /* @__PURE__ */ makePrimitive({
  op: "While",
  [contA](value, fiber) {
    this[args].step(value);
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  },
  [evaluate](fiber) {
    if (this[args].while()) {
      fiber._stack.push(this);
      return this[args].body();
    }
    return exitVoid;
  }
});
var forEach = /* @__PURE__ */ dual((args) => typeof args[1] === "function", (iterable, f, options) => suspend(() => {
  const concurrency = resolveConcurrency(options?.concurrency);
  if (concurrency === 1) {
    return forEachSequential(iterable, f, options);
  }
  const items = fromIterable(iterable);
  let length = items.length;
  if (length === 0) {
    return options?.discard ? void_ : succeed3([]);
  }
  const out = options?.discard ? undefined : new Array(length);
  const eff = forEachConcurrent({
    f,
    out
  }, items, {
    concurrency
  });
  return eff ? as(eff, out) : succeed3(out);
}));
var forEachSequential = (iterable, f, options) => suspend(() => {
  const out = options?.discard ? undefined : [];
  const iterator = iterable[Symbol.iterator]();
  let state = iterator.next();
  let index = 0;
  return as(whileLoop({
    while: () => !state.done,
    body: () => f(state.value, index++),
    step: (b) => {
      if (out)
        out.push(b);
      state = iterator.next();
    }
  }), out);
});
var resolveConcurrency = (concurrency) => concurrency === "unbounded" ? Number.POSITIVE_INFINITY : Math.max(1, concurrency ?? 1);
var iterateEager = () => (options) => {
  const onItem = options.onItem;
  const step = options.step;
  const runSequential = (state, items, index = 0, end = items.length) => {
    for (;index < end; index++) {
      const item = items[index];
      const effect = onItem(state, item, index);
      if (!effectIsExit(effect)) {
        return flatMap(exit(effect), (itemExit) => step(state, item, itemExit, index) ?? runSequential(state, items, index + 1, end) ?? void_);
      }
      const terminal = step(state, item, effect, index);
      if (terminal)
        return terminal._tag === "Failure" ? terminal : undefined;
    }
  };
  return runSequential;
};
var iterateConcurrentImpl = (options) => {
  const onItem = options.onItem;
  const step = options.step;
  return (state, items, opts) => {
    let index = 0;
    const end = opts.end ?? items.length;
    const concurrency = opts.concurrency;
    let done = false;
    let parentFiber;
    let fibers;
    let resume;
    let interrupted = false;
    let terminal;
    let effect;
    const failDefect = (error) => {
      const defect = exitDie(error);
      terminal = defect;
      done = true;
      interrupted = true;
      return fibers && fibers.size > 0 ? flatMap(uninterruptible(fiberInterruptAll(Array.from(fibers))), () => defect) : defect;
    };
    const go = () => {
      let paused = false;
      for (;!terminal && index < end; index++) {
        const item = items[index];
        const eff = effect ?? onItem(state, item, index);
        if (effectIsExit(eff)) {
          terminal = step(state, item, eff, index);
          if (terminal)
            break;
        } else if (!parentFiber) {
          return callback((cb) => {
            parentFiber = getCurrentFiber();
            fibers = new Set;
            effect = eff;
            resume = cb;
            let result;
            try {
              result = go();
            } catch (error) {
              return cb(failDefect(error));
            }
            if (result)
              return cb(result);
            return suspend(() => {
              terminal = exitVoid;
              interrupted = true;
              return fibers ? fiberInterruptAll(fibers) : void_;
            });
          });
        } else {
          effect = undefined;
          const fiber = forkUnsafe(parentFiber, eff, true, true, "inherit");
          if (fiber._exit) {
            terminal = step(state, item, fiber._exit, index);
            if (terminal)
              break;
            continue;
          }
          fibers.add(fiber);
          const currentIndex = index;
          fiber.addObserver((exit) => {
            fibers.delete(fiber);
            try {
              if (terminal) {
                if (!interrupted && exit._tag === "Failure") {
                  for (const reason of exit.cause.reasons) {
                    if (reason._tag === "Interrupt")
                      continue;
                    else if (terminal._tag === "Failure") {
                      terminal.cause.reasons.push(reason);
                    } else {
                      terminal = exitFailCause(causeFromReasons([reason]));
                    }
                  }
                }
              } else {
                const result = step(state, item, exit, currentIndex);
                if (result) {
                  terminal = result._tag === "Failure" ? exitFailCause(causeFromReasons(result.cause.reasons.slice())) : result;
                  go();
                }
              }
              if (paused) {
                const eff = go();
                if (eff)
                  resume(eff);
              } else if (done && fibers.size === 0) {
                resume(terminal ?? void_);
              }
            } catch (error) {
              resume(failDefect(error));
            }
          });
          if (fibers.size < concurrency)
            continue;
          paused = true;
          index++;
          return;
        }
      }
      done = true;
      if (terminal) {
        if (fibers && fibers.size > 0) {
          const annotations = fiberStackAnnotations(parentFiber);
          fibers.forEach((f) => f.interruptUnsafe(parentFiber.id, annotations));
          return;
        }
        if (resume || terminal._tag === "Failure") {
          return terminal;
        }
      } else if (resume) {
        if (!fibers) {
          return exitVoid;
        } else if (fibers.size === 0) {
          resume(void_);
        }
      }
    };
    return go();
  };
};
var iterateConcurrent = () => (options) => iterateConcurrentImpl(options);
var forEachConcurrent = /* @__PURE__ */ iterateConcurrentImpl({
  onItem(state, item, index) {
    return state.f(item, index);
  },
  step(state, _, exit, index) {
    if (exit._tag === "Failure")
      return exit;
    else if (state.out) {
      state.out[index] = exit.value;
    }
  }
});
var forkUnsafe = (parent, effect, immediate = false, daemon = false, uninterruptible = false) => {
  const parentRuntime = parent;
  const interruptible = uninterruptible === "inherit" ? parentRuntime.interruptible : !uninterruptible;
  const child = new FiberImpl(parentRuntime.context, interruptible);
  if (immediate) {
    child.evaluate(effect);
  } else {
    parentRuntime.currentDispatcher.scheduleTask(() => child.evaluate(effect), 0);
  }
  if (!daemon && !child._exit) {
    parentRuntime.children().add(child);
    child._parent = parentRuntime;
  }
  return child;
};
var forkIn = /* @__PURE__ */ dual((args) => isEffect(args[0]), (self, scope, options) => withFiber((parent) => {
  const fiber = forkUnsafe(parent, self, options?.startImmediately, true, options?.uninterruptible);
  if (!fiber._exit) {
    if (scope.state._tag !== "Closed") {
      const key = {};
      const finalizer = () => withFiberId((interruptor) => interruptor === fiber.id ? void_ : fiberInterrupt(fiber));
      scopeAddFinalizerUnsafe(scope, key, finalizer);
      fiber.addObserver(() => scopeRemoveFinalizerUnsafe(scope, key));
    } else {
      fiber.interruptUnsafe(parent.id, fiberStackAnnotations(parent));
    }
  }
  return succeed3(fiber);
}));
var runForkWith = (context) => (effect, options) => {
  const fiber = new FiberImpl(options?.scheduler ? add(context, Scheduler, options.scheduler) : context, options?.uninterruptible !== true);
  fiber.evaluate(effect);
  if (fiber._exit)
    return fiber;
  if (options?.signal) {
    if (options.signal.aborted) {
      fiber.interruptUnsafe();
    } else {
      const abort = () => fiber.interruptUnsafe();
      options.signal.addEventListener("abort", abort, {
        once: true
      });
      fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
    }
  }
  if (options?.onFiberStart) {
    options.onFiberStart(fiber);
  }
  return fiber;
};
var fiberRunIn = /* @__PURE__ */ dual(2, (self, scope) => {
  if (self._exit) {
    return self;
  } else if (scope.state._tag === "Closed") {
    self.interruptUnsafe(self.id);
    return self;
  }
  const key = {};
  scopeAddFinalizerUnsafe(scope, key, () => fiberInterrupt(self));
  self.addObserver(() => scopeRemoveFinalizerUnsafe(scope, key));
  return self;
});
var runFork = /* @__PURE__ */ runForkWith(/* @__PURE__ */ empty3());
var runCallbackWith = (context) => {
  const runFork = runForkWith(context);
  return (effect, options) => {
    const fiber = runFork(effect, options);
    if (options?.onExit) {
      fiber.addObserver(options.onExit);
    }
    return (interruptor) => {
      return fiber.interruptUnsafe(interruptor);
    };
  };
};
var runCallback = /* @__PURE__ */ runCallbackWith(/* @__PURE__ */ empty3());
var runPromiseExitWith = (context) => {
  const runFork = runForkWith(context);
  return (effect, options) => {
    const fiber = runFork(effect, options);
    return new Promise((resolve) => {
      fiber.addObserver((exit) => resolve(exit));
    });
  };
};
var runPromiseExit = /* @__PURE__ */ runPromiseExitWith(/* @__PURE__ */ empty3());
var runPromiseWith = (context) => {
  const runPromiseExit = runPromiseExitWith(context);
  return (effect, options) => runPromiseExit(effect, options).then((exit) => {
    if (exit._tag === "Failure") {
      throw causeSquash(exit.cause);
    }
    return exit.value;
  });
};
var runPromise = /* @__PURE__ */ runPromiseWith(/* @__PURE__ */ empty3());
var runSyncExitWith = (context) => {
  const runFork = runForkWith(context);
  return (effect) => {
    if (effectIsExit(effect))
      return effect;
    const scheduler = new MixedScheduler("sync");
    const fiber = runFork(effect, {
      scheduler
    });
    fiber._dispatcher?.flush();
    return fiber._exit ?? exitDie(new AsyncFiberError(fiber));
  };
};
var runSyncExit = /* @__PURE__ */ runSyncExitWith(/* @__PURE__ */ empty3());
var runSyncWith = (context) => {
  const runSyncExit = runSyncExitWith(context);
  return (effect) => {
    const exit = runSyncExit(effect);
    if (exit._tag === "Failure")
      throw causeSquash(exit.cause);
    return exit.value;
  };
};
var runSync = /* @__PURE__ */ runSyncWith(/* @__PURE__ */ empty3());
var bigint02 = /* @__PURE__ */ BigInt(0);
var NoopSpanProto = {
  _tag: "Span",
  spanId: "noop",
  traceId: "noop",
  sampled: false,
  status: {
    _tag: "Ended",
    startTime: bigint02,
    endTime: bigint02,
    exit: exitVoid
  },
  attributes: /* @__PURE__ */ new Map,
  links: [],
  kind: "internal",
  attribute() {},
  event() {},
  end() {},
  addLinks() {}
};
var noopSpan = (options) => Object.assign(Object.create(NoopSpanProto), options);
var filterDisablePropagation = (span) => {
  if (!span)
    return none2();
  return get(span.annotations, DisablePropagation) ? span._tag === "Span" ? filterDisablePropagation(getOrUndefined(span.parent)) : none2() : some2(span);
};
var makeSpanUnsafe = (fiber, name, options) => {
  const disablePropagation = !fiber.getRef(TracerEnabled) || options?.annotations && get(options.annotations, DisablePropagation);
  const parent = options?.parent !== undefined ? some2(options.parent) : options?.root ? none2() : filterDisablePropagation(fiber.cache.span);
  let span;
  if (disablePropagation) {
    span = noopSpan({
      name,
      parent,
      annotations: add(options?.annotations ?? empty3(), DisablePropagation, true)
    });
  } else {
    const tracer = fiber.getRef(Tracer);
    const clock = fiber.getRef(ClockRef);
    const timingEnabled = fiber.getRef(TracerTimingEnabled);
    const annotationsFromEnv = fiber.getRef(TracerSpanAnnotations);
    const linksFromEnv = fiber.getRef(TracerSpanLinks);
    const level = options?.level ?? fiber.getRef(CurrentTraceLevel);
    const links = options?.links !== undefined ? [...linksFromEnv, ...options.links] : linksFromEnv.length === 0 ? [] : linksFromEnv.slice();
    span = tracer.span({
      name,
      parent,
      annotations: options?.annotations ?? empty3(),
      links,
      startTime: timingEnabled ? clock.currentTimeNanosUnsafe() : bigint02,
      kind: options?.kind ?? "internal",
      root: options?.root ?? isNone2(parent),
      sampled: options?.sampled ?? (isSome2(parent) && parent.value.sampled === false ? false : !isLogLevelGreaterThan(fiber.getRef(MinimumTraceLevel), level))
    });
    for (const key in annotationsFromEnv) {
      span.attribute(key, annotationsFromEnv[key]);
    }
    if (options?.attributes !== undefined) {
      for (const key in options.attributes) {
        span.attribute(key, options.attributes[key]);
      }
    }
  }
  return span;
};
var endSpan = (span, exit, clock, timingEnabled) => sync(() => {
  if (span.status._tag === "Ended")
    return;
  span.end(timingEnabled ? clock.currentTimeNanosUnsafe() : bigint02, exit);
});
var useSpan = (name, ...args) => {
  const options = args.length === 1 ? undefined : args[0];
  const evaluate = args[args.length - 1];
  return withFiber((fiber) => {
    const span = makeSpanUnsafe(fiber, name, options);
    const clock = fiber.getRef(ClockRef);
    const timingEnabled = fiber.getRef(TracerTimingEnabled);
    return onExit(suspend(() => internalCall(() => evaluate(span))), (exit) => endSpan(span, exit, clock, timingEnabled));
  });
};
var provideParentSpan = /* @__PURE__ */ provideService(ParentSpan);
var ClockRef = /* @__PURE__ */ Reference("effect/Clock", {
  defaultValue: () => new ClockImpl
});
var MAX_TIMER_MILLIS = 2 ** 31 - 1;

class ClockImpl {
  currentTimeMillisUnsafe() {
    return Date.now();
  }
  currentTimeMillis = /* @__PURE__ */ sync(() => this.currentTimeMillisUnsafe());
  currentTimeNanosUnsafe() {
    return wallTimeNanos();
  }
  currentTimeNanos = /* @__PURE__ */ sync(() => this.currentTimeNanosUnsafe());
  monotonicTimeNanosUnsafe() {
    return monotonicNowNanos();
  }
  monotonicTimeNanos = /* @__PURE__ */ sync(() => this.monotonicTimeNanosUnsafe());
  sleep(duration) {
    return this.sleepMillis(toMillis(duration));
  }
  sleepMillis(millis) {
    if (millis <= 0)
      return yieldNow;
    else if (!Number.isFinite(millis))
      return never;
    return callback((resume) => {
      const continuation = millis > MAX_TIMER_MILLIS ? this.sleepMillis(millis - MAX_TIMER_MILLIS) : void_;
      const handle = setTimeout(() => resume(continuation), Math.min(millis, MAX_TIMER_MILLIS));
      return sync(() => clearTimeout(handle));
    });
  }
}
var nanosPerMilli = /* @__PURE__ */ BigInt(1e6);
var monotonicNowNanos = /* @__PURE__ */ function() {
  const processHrtime = globalThis.process?.hrtime;
  if (typeof processHrtime?.bigint === "function") {
    return () => processHrtime.bigint();
  }
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return () => BigInt(Math.round(performance.now() * 1e6));
  }
  let previous = /* @__PURE__ */ BigInt(0);
  return () => {
    const current = BigInt(Date.now()) * nanosPerMilli;
    if (current > previous) {
      previous = current;
    }
    return previous;
  };
}();
var wallTimeNanos = /* @__PURE__ */ function() {
  const reanchorThresholdNanos = /* @__PURE__ */ BigInt(1e9);
  let origin;
  return () => {
    const monotonic = monotonicNowNanos();
    const wall = BigInt(Date.now()) * nanosPerMilli;
    if (origin === undefined) {
      origin = wall - monotonic;
    } else {
      const projected = origin + monotonic;
      const skew = wall > projected ? wall - projected : projected - wall;
      if (skew > reanchorThresholdNanos) {
        origin = wall - monotonic;
      }
    }
    return origin + monotonic;
  };
}();
var clockWith = (f) => withFiber((fiber) => f(fiber.getRef(ClockRef)));
var sleep = (duration) => clockWith((clock) => clock.sleep(fromInputUnsafe(duration)));
var currentTimeMillis = /* @__PURE__ */ clockWith((clock) => clock.currentTimeMillis);
var AsyncFiberErrorTypeId = "~effect/Cause/AsyncFiberError";
class AsyncFiberError extends (/* @__PURE__ */ TaggedError("AsyncFiberError")) {
  [AsyncFiberErrorTypeId] = AsyncFiberErrorTypeId;
  constructor(fiber) {
    super({
      message: "An asynchronous Effect was executed with Effect.runSync",
      fiber
    });
  }
}
var UnknownErrorTypeId = "~effect/Cause/UnknownError";
class UnknownError extends (/* @__PURE__ */ TaggedError("UnknownError")) {
  [UnknownErrorTypeId] = UnknownErrorTypeId;
  constructor(cause, message) {
    super({
      message,
      cause
    });
  }
}
var ConsoleRef = /* @__PURE__ */ Reference("effect/Console", {
  defaultValue: () => globalThis.console
});
var logLevelToOrder = (level) => {
  switch (level) {
    case "All":
      return Number.MIN_SAFE_INTEGER;
    case "Fatal":
      return 50000;
    case "Error":
      return 40000;
    case "Warn":
      return 30000;
    case "Info":
      return 20000;
    case "Debug":
      return 1e4;
    case "Trace":
      return 0;
    case "None":
      return Number.MAX_SAFE_INTEGER;
  }
};
var LogLevelOrder = /* @__PURE__ */ mapInput(Number2, logLevelToOrder);
var isLogLevelGreaterThan = /* @__PURE__ */ isGreaterThan(LogLevelOrder);
var CurrentLoggers = /* @__PURE__ */ Reference("effect/Logger/CurrentLoggers", {
  defaultValue: () => new Set([defaultLogger, tracerLogger])
});
var LogToStderr = /* @__PURE__ */ Reference("effect/Logger/LogToStderr", {
  defaultValue: constFalse
});
var LoggerTypeId = "~effect/Logger";
var LoggerProto = {
  [LoggerTypeId]: {
    _Message: identity,
    _Output: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var loggerMake = (log) => {
  const self = Object.create(LoggerProto);
  self.log = log;
  return self;
};
var formatLabel = (key) => key.replace(/[\s="]/g, "_");
var formatLogSpan = (self, now) => {
  const label = formatLabel(self[0]);
  return `${label}=${now - self[1]}ms`;
};
var logWithLevel = (level) => (...message) => {
  let cause = undefined;
  for (let i = 0, len = message.length;i < len; i++) {
    const msg = message[i];
    if (isCause(msg)) {
      if (cause) {
        message.splice(i, 1);
      } else {
        message = message.slice(0, i).concat(message.slice(i + 1));
      }
      cause = cause ? causeFromReasons(cause.reasons.concat(msg.reasons)) : msg;
      i--;
    }
  }
  if (cause === undefined) {
    cause = causeEmpty;
  }
  return withFiber((fiber) => {
    const logLevel = level ?? fiber.cache.logLevel;
    if (isLogLevelGreaterThan(fiber.cache.minimumLogLevel, logLevel)) {
      return void_;
    }
    const clock = fiber.getRef(ClockRef);
    const loggers = fiber.getRef(CurrentLoggers);
    if (loggers.size > 0) {
      const date = new Date(clock.currentTimeMillisUnsafe());
      for (const logger of loggers) {
        logger.log({
          cause,
          fiber,
          date,
          logLevel,
          message
        });
      }
    }
    return void_;
  });
};
var colors = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  cyan: "36",
  white: "37",
  gray: "90",
  black: "30",
  bgBrightRed: "101"
};
var logLevelColors = {
  None: [],
  All: [],
  Trace: [colors.gray],
  Debug: [colors.blue],
  Info: [colors.green],
  Warn: [colors.yellow],
  Error: [colors.red],
  Fatal: [colors.bgBrightRed, colors.black]
};
var defaultDateFormat = (date) => `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
var defaultLogger = /* @__PURE__ */ loggerMake(({
  cause,
  date,
  fiber,
  logLevel,
  message
}) => {
  const message_ = Array.isArray(message) ? message.slice() : [message];
  if (cause.reasons.length > 0) {
    message_.push(causePretty(cause));
  }
  const now = date.getTime();
  const spans = fiber.getRef(CurrentLogSpans);
  let spanString = "";
  for (const span of spans) {
    spanString += ` ${formatLogSpan(span, now)}`;
  }
  const annotations = fiber.getRef(CurrentLogAnnotations);
  if (Object.keys(annotations).length > 0) {
    message_.push(annotations);
  }
  const console2 = fiber.getRef(ConsoleRef);
  const log = fiber.getRef(LogToStderr) ? console2.error : console2.log;
  log(`[${defaultDateFormat(date)}] ${logLevel.toUpperCase()} (#${fiber.id})${spanString}:`, ...message_);
});
var tracerLogger = /* @__PURE__ */ loggerMake(({
  cause,
  fiber,
  logLevel,
  message
}) => {
  const clock = fiber.getRef(ClockRef);
  const annotations = fiber.getRef(CurrentLogAnnotations);
  const span = fiber.cache.span;
  if (span === undefined || span._tag === "ExternalSpan")
    return;
  const attributes = {};
  for (const [key, value] of Object.entries(annotations)) {
    assignProperty(attributes, key, value);
  }
  attributes["effect.fiberId"] = fiber.id;
  attributes["effect.logLevel"] = logLevel.toUpperCase();
  if (cause.reasons.length > 0) {
    attributes["effect.cause"] = causePretty(cause);
  }
  span.event(toStringUnknown(Array.isArray(message) && message.length === 1 ? message[0] : message), clock.currentTimeNanosUnsafe(), attributes);
});

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Cause.js
var isFailReason2 = isFailReason;
var fromReasons = causeFromReasons;
var die2 = causeDie;
var hasInterruptsOnly2 = hasInterruptsOnly;
var map5 = causeMap;
var filterInterruptors = causeFilterInterruptors;
var isDone2 = isDone;
var done2 = done;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Exit.js
var succeed4 = exitSucceed;
var failCause2 = exitFailCause;
var fail4 = exitFail;
var void_2 = exitVoid;
var isSuccess3 = exitIsSuccess;
var isFailure3 = exitIsFailure;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Deferred.js
var TypeId5 = "~effect/Deferred";
var DeferredProto = {
  [TypeId5]: {
    _A: identity,
    _E: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var DeferredImpl = function() {
  this.resumes = undefined;
  this.effect = undefined;
};
DeferredImpl.prototype = DeferredProto;
var makeUnsafe2 = () => new DeferredImpl;
var make5 = () => sync(() => makeUnsafe2());
var _await = (self) => callback((resume) => {
  if (self.effect)
    return resume(self.effect);
  self.resumes ??= [];
  self.resumes.push(resume);
  return sync(() => {
    const resumes = self.resumes;
    if (resumes === undefined)
      return;
    const index = resumes.indexOf(resume);
    if (index >= 0)
      resumes.splice(index, 1);
  });
});
var completeWith = /* @__PURE__ */ dual(2, (self, effect) => sync(() => doneUnsafe(self, effect)));
var done3 = completeWith;
var doneUnsafe = (self, effect) => {
  if (self.effect)
    return false;
  self.effect = effect;
  if (self.resumes) {
    const resumes = self.resumes;
    self.resumes = undefined;
    for (let i = 0;i < resumes.length; i++) {
      resumes[i](effect);
    }
  }
  return true;
};
var into = /* @__PURE__ */ dual(2, (self, deferred) => uninterruptibleMask((restore) => flatMap(exit(restore(self)), (exit) => done3(deferred, exit))));

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Scope.js
var makeUnsafe3 = scopeMakeUnsafe;
var provide = provideScope;
var addFinalizer = scopeAddFinalizer;
var forkUnsafe2 = scopeForkUnsafe;
var close = scopeClose;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Layer.js
var TypeId6 = "~effect/Layer";
var MemoMapTypeId = "~effect/Layer/MemoMap";
var memoMapReuse = (entry, scope) => {
  entry.observers++;
  return andThen(scopeAddFinalizerExit(scope, (exit) => entry.finalizer(exit)), entry.effect);
};
var LayerProto = {
  [TypeId6]: {
    _ROut: identity,
    _E: identity,
    _RIn: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromBuildUnsafe = (build) => {
  const self = Object.create(LayerProto);
  self.build = build;
  return self;
};
var fromBuild = (build) => fromBuildUnsafe((memoMap, scope) => {
  const layerScope = forkUnsafe2(scope);
  return onExit(build(memoMap, layerScope), (exit) => exit._tag === "Failure" ? close(layerScope, exit) : void_);
});
var fromBuildMemo = (build) => {
  const self = fromBuild((memoMap, scope) => memoMap.getOrElseMemoize(self, scope, build));
  return self;
};
var memoMapBuild = (memoMap, layer, scope, build) => {
  const layerScope = makeUnsafe3();
  const deferred = makeUnsafe2();
  const entry = {
    observers: 1,
    effect: _await(deferred),
    finalizer: (exit) => suspend(() => {
      entry.observers--;
      if (entry.observers === 0) {
        memoMap.map.delete(layer);
        return close(layerScope, exit);
      }
      return void_;
    })
  };
  memoMap.map.set(layer, entry);
  return scopeAddFinalizerExit(scope, entry.finalizer).pipe(flatMap(() => build(memoMap, layerScope)), onExit((exit) => {
    entry.effect = exit;
    return done3(deferred, exit);
  }));
};

class MemoMapImpl {
  get [MemoMapTypeId]() {
    return MemoMapTypeId;
  }
  parent;
  constructor(parent) {
    this.parent = parent;
  }
  map = /* @__PURE__ */ new Map;
  get(layer, scope) {
    const local = this.map.get(layer);
    if (local) {
      return memoMapReuse(local, scope);
    }
    return this.parent?.get(layer, scope);
  }
  getOrElseMemoize(layer, scope, build) {
    return suspend(() => {
      const existing = this.get(layer, scope);
      if (existing) {
        return existing;
      }
      return memoMapBuild(this, layer, scope, build);
    });
  }
}
var makeMemoMapUnsafe = () => new MemoMapImpl;
var forkMemoMapUnsafe = (parent) => new MemoMapImpl(parent);
class CurrentMemoMap extends (/* @__PURE__ */ Service()("effect/Layer/CurrentMemoMap")) {
  static forkOrCreate(self) {
    const current = getOrUndefined2(self, CurrentMemoMap);
    return current ? forkMemoMapUnsafe(current) : makeMemoMapUnsafe();
  }
}
var buildWithMemoMap = /* @__PURE__ */ dual(3, (self, memoMap, scope) => provideService(map4(self.build(memoMap, scope), add(CurrentMemoMap, memoMap)), CurrentMemoMap, memoMap));
var succeed5 = function() {
  if (arguments.length === 1) {
    return (resource) => succeedContext(make2(arguments[0], resource));
  }
  return succeedContext(make2(arguments[0], arguments[1]));
};
var succeedContext = (context) => fromBuildUnsafe(constant(succeed3(context)));
var sync2 = function() {
  if (arguments.length === 1) {
    return (evaluate) => syncContext(() => make2(arguments[0], evaluate()));
  }
  return syncContext(() => make2(arguments[0], arguments[1]()));
};
var syncContext = (evaluate) => fromBuildMemo(constant(sync(evaluate)));
var effect = function() {
  if (arguments.length === 1) {
    return (effect) => effectImpl(arguments[0], effect);
  }
  return effectImpl(arguments[0], arguments[1]);
};
var effectImpl = (service, effect) => effectContext(map4(effect, (value) => make2(service, value)));
var effectContext = (effect) => fromBuildMemo((_, scope) => provide(effect, scope));
var unwrapKey = /* @__PURE__ */ Service("effect/Layer/unwrap");
var unwrap = (self) => flatMap2(effect(unwrapKey)(self), get(unwrapKey));
var mergeAllEffect = (layers, memoMap, scope) => {
  const parentScope = forkUnsafe2(scope, "parallel");
  return forEach(layers, (layer) => layer.build(memoMap, forkUnsafe2(parentScope, "sequential")), {
    concurrency: layers.length
  }).pipe(map4((context) => mergeAll(...context)));
};
var mergeAll2 = (...layers) => fromBuild((memoMap, scope) => mergeAllEffect(layers, memoMap, scope));
var provideWith = (self, that, f) => fromBuild((memoMap, scope) => flatMap(Array.isArray(that) ? mergeAllEffect(that, memoMap, scope) : that.build(memoMap, scope), (context) => self.build(memoMap, scope).pipe(provideContext(context), map4((merged) => f(merged, context)))));
var provideMerge = /* @__PURE__ */ dual(2, (self, that) => provideWith(self, that, (self, that) => merge(that, self)));
var flatMap2 = /* @__PURE__ */ dual(2, (self, f) => fromBuild((memoMap, scope) => flatMap(self.build(memoMap, scope), (context) => f(context).build(memoMap, scope))));

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Clock.js
var currentTimeMillis2 = currentTimeMillis;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Pull.js
var catchDone = /* @__PURE__ */ dual(2, (effect, f) => catchCauseFilter(effect, filterDoneLeftover, (l) => f(l)));
var isDoneFailure = (failure) => failure._tag === "Fail" && isDone2(failure.error);
var filterDone = (cause) => {
  let done;
  let hasFailure = false;
  for (const reason of cause.reasons) {
    if (isDoneFailure(reason)) {
      done ??= reason.error;
    } else if (reason._tag !== "Interrupt") {
      hasFailure = true;
    }
  }
  if (done === undefined)
    return fail2(cause);
  return hasFailure ? fail2(fromReasons(cause.reasons.filter((reason) => !isDoneFailure(reason)))) : succeed2(done);
};
var filterDoneLeftover = (cause) => {
  const done = filterDone(cause);
  return isFailure2(done) ? done : succeed2(done.success.value);
};
var matchEffect2 = /* @__PURE__ */ dual(2, (self, options) => matchCauseEffect(self, {
  onSuccess: options.onSuccess,
  onFailure: (cause) => {
    const halt = filterDone(cause);
    return !isFailure2(halt) ? options.onDone(halt.success.value) : options.onFailure(halt.failure);
  }
}));

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Schedule.js
var TypeId7 = "~effect/Schedule";
var CurrentMetadata = /* @__PURE__ */ Reference("effect/Schedule/CurrentMetadata", {
  defaultValue: /* @__PURE__ */ constant({
    input: undefined,
    output: undefined,
    duration: zero,
    attempt: 0,
    start: 0,
    now: 0,
    elapsed: 0,
    elapsedSincePrevious: 0
  })
});
var ScheduleProto = {
  [TypeId7]: {
    _Out: identity,
    _In: identity,
    _Env: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var isSchedule = (u) => hasProperty(u, TypeId7);
var fromStep = (step) => {
  const self = Object.create(ScheduleProto);
  self.step = step;
  return self;
};
var metadataFn = () => {
  let n = 0;
  let previous;
  let start;
  return (now, input) => {
    if (start === undefined)
      start = now;
    const elapsed = now - start;
    const elapsedSincePrevious = previous === undefined ? 0 : now - previous;
    previous = now;
    return {
      input,
      attempt: ++n,
      start,
      now,
      elapsed,
      elapsedSincePrevious
    };
  };
};
var fromStepWithMetadata = (step) => fromStep(map4(step, (f) => {
  const meta = metadataFn();
  return (now, input) => f(meta(now, input));
}));
var toStep = (schedule) => catchCause(schedule.step, (cause) => succeed3(() => failCause(cause)));
var toStepWithMetadata = (schedule) => clockWith((clock) => map4(toStep(schedule), (step) => {
  const metaFn = metadataFn();
  return (input) => suspend(() => {
    const now = clock.currentTimeMillisUnsafe();
    return flatMap(step(now, input), ([output, duration]) => {
      const meta = metaFn(now, input);
      meta.output = output;
      meta.duration = duration;
      return as(sleep(duration), meta);
    });
  });
}));
var passthrough = (self) => fromStep(map4(toStep(self), (step) => (now, input) => matchEffect2(step(now, input), {
  onSuccess: (result) => succeed3([input, result[1]]),
  onFailure: failCause,
  onDone: () => done2(input)
})));
var spaced = (duration) => {
  const decoded = fromInputUnsafe(duration);
  return fromStepWithMetadata(succeed3((meta) => succeed3([meta.attempt - 1, decoded])));
};
var while_ = /* @__PURE__ */ dual(2, (self, predicate) => fromStep(map4(toStep(self), (step) => {
  const meta = metadataFn();
  return (now, input) => flatMap(step(now, input), (result) => {
    const [output, duration] = result;
    const eff = predicate({
      ...meta(now, input),
      output,
      duration
    });
    return flatMap(isEffect(eff) ? eff : succeed3(eff), (check) => check ? succeed3(result) : done2(output));
  });
})));
var forever2 = /* @__PURE__ */ spaced(zero);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schedule.js
var repeatOrElse = /* @__PURE__ */ dual(3, (self, schedule, orElse) => flatMap(toStepWithMetadata(schedule), (step) => {
  let meta = CurrentMetadata.defaultValue();
  return catch_(forever(tap(flatMap(suspend(() => provideService(self, CurrentMetadata, meta)), step), (meta_) => sync(() => {
    meta = meta_;
  })), {
    disableYield: true
  }), (error) => isDone(error) ? succeed3(error.value) : orElse(error, meta.attempt === 0 ? none2() : some2(meta)));
}));
var repeat = /* @__PURE__ */ dual(2, (self, options) => {
  const schedule = typeof options === "function" ? options(identity) : isSchedule(options) ? options : buildFromOptions(options);
  return repeatOrElse(self, schedule, fail3);
});
var passthroughForever = /* @__PURE__ */ passthrough(forever2);
var buildFromOptions = (options) => {
  let schedule = options.schedule ? passthrough(options.schedule) : passthroughForever;
  if (options.while) {
    schedule = while_(schedule, ({
      input
    }) => {
      const applied = options.while(input);
      return isEffect(applied) ? applied : succeed3(applied);
    });
  }
  if (options.until) {
    schedule = while_(schedule, ({
      input
    }) => {
      const applied = options.until(input);
      return isEffect(applied) ? map4(applied, (b) => !b) : succeed3(!applied);
    });
  }
  if (options.times !== undefined) {
    schedule = while_(schedule, ({
      attempt
    }) => succeed3(attempt <= options.times));
  }
  return schedule;
};

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Effect.js
var isEffect2 = isEffect;
var all2 = all;
var forEach2 = forEach;
var whileLoop2 = whileLoop;
var promise2 = promise;
var tryPromise2 = tryPromise;
var succeed6 = succeed3;
var suspend2 = suspend;
var sync3 = sync;
var void_3 = void_;
var gen2 = gen;
var fail5 = fail3;
var failCause3 = failCause;
var failCauseSync2 = failCauseSync;
var die3 = die;
var try_2 = try_;
var withFiber2 = withFiber;
var fromResult2 = fromResult;
var flatMap3 = flatMap;
var flatten3 = flatten2;
var andThen2 = andThen;
var tap2 = tap;
var result2 = result;
var option2 = option;
var exit2 = exit;
var map6 = map4;
var as2 = as;
var asVoid2 = asVoid;
var catch_2 = catch_;
var catchTag2 = catchTag;
var catchTags2 = catchTags;
var catchCause2 = catchCause;
var catchDefect2 = catchDefect;
var catchIf2 = catchIf;
var mapError3 = mapError2;
var orDie2 = orDie;
var orElseSucceed2 = orElseSucceed;
var timeoutOrElse2 = timeoutOrElse;
var delay2 = delay;
var sleep2 = sleep;
var context2 = context;
var provideContext2 = provideContext;
var scope2 = scope;
var scoped2 = scoped;
var acquireRelease2 = acquireRelease;
var ensuring2 = ensuring;
var onExit2 = onExit;
var interrupt2 = interrupt;
var uninterruptibleMask2 = uninterruptibleMask;
var forever3 = forever;
var repeat2 = repeat;
var forkIn2 = forkIn;
var runFork2 = runFork;
var runForkWith2 = runForkWith;
var runCallbackWith2 = runCallbackWith;
var runCallback2 = runCallback;
var runPromise2 = runPromise;
var runPromiseWith2 = runPromiseWith;
var runPromiseExit2 = runPromiseExit;
var runPromiseExitWith2 = runPromiseExitWith;
var runSync2 = runSync;
var runSyncWith2 = runSyncWith;
var runSyncExit2 = runSyncExit;
var runSyncExitWith2 = runSyncExitWith;
var fnUntraced2 = fnUntraced;
var fn2 = fn;
var logWarning = /* @__PURE__ */ logWithLevel("Warn");
var logError = /* @__PURE__ */ logWithLevel("Error");
var logInfo = /* @__PURE__ */ logWithLevel("Info");
var mapEager2 = mapEager;
var mapErrorEager2 = mapErrorEager;
var flatMapEager2 = flatMapEager;
var catchEager2 = catchEager;
var fnUntracedEager2 = fnUntracedEager;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schema/annotations.js
function resolve(ast) {
  return ast.checks ? ast.checks[ast.checks.length - 1].annotations : ast.annotations;
}
var STRUCTURAL_ANNOTATION_KEY = "~structural";
var SENTINELS_ANNOTATION_KEY = "~sentinels";
var CONSTRUCTOR_ANNOTATION_KEY = "~constructor";
var getExpected = /* @__PURE__ */ memoize((ast) => {
  const identifier = resolve(ast)?.identifier;
  if (typeof identifier === "string")
    return identifier;
  return ast.getExpected(getExpected);
});

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schema/parser.js
var missing = /* @__PURE__ */ Symbol();
var succeed7 = succeed4;
var missingExit = /* @__PURE__ */ succeed7(missing);
var sameExit = /* @__PURE__ */ succeed7(missing);
var toOption = (value) => value === missing ? none2() : some2(value);
var fromOptionExit = (option) => option._tag === "None" ? missingExit : succeed7(option.value);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/SchemaIssue.js
var TypeId8 = "~effect/SchemaIssue/Issue";
function isIssue(u) {
  return hasProperty(u, TypeId8) && u[TypeId8] === TypeId8;
}
function hasInput(issue) {
  return Object.hasOwn(issue, "input");
}

class IssueNodeImpl {
  [TypeId8] = TypeId8;
  constructor(input, options) {
    if (options?.reportInput === true && input !== missing) {
      this.input = input;
    }
  }
}
var Filter = class extends IssueNodeImpl {
  _tag = "Filter";
  filter;
  issue;
  constructor(filter, issue, input, options) {
    super(input, options);
    this.filter = filter;
    this.issue = issue;
  }
};
var Encoding = class extends IssueNodeImpl {
  _tag = "Encoding";
  ast;
  issue;
  constructor(ast, issue, input, options) {
    super(input, options);
    this.ast = ast;
    this.issue = issue;
  }
};
var Pointer = class extends IssueNodeImpl {
  _tag = "Pointer";
  path;
  issue;
  constructor(path, issue) {
    super();
    this.path = path;
    this.issue = issue;
  }
};
var MissingKey = class extends IssueNodeImpl {
  _tag = "MissingKey";
  annotations;
  constructor(annotations) {
    super();
    this.annotations = annotations;
  }
};
var UnexpectedKey = class extends IssueNodeImpl {
  _tag = "UnexpectedKey";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var Composite = class extends IssueNodeImpl {
  _tag = "Composite";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var InvalidType = class extends IssueNodeImpl {
  _tag = "InvalidType";
  ast;
  constructor(ast, input, options) {
    super(input, options);
    this.ast = ast;
  }
};
var InvalidValue = class extends IssueNodeImpl {
  _tag = "InvalidValue";
  annotations;
  constructor(annotations, input, options) {
    super(input, options);
    this.annotations = annotations;
  }
};
var AnyOf = class extends IssueNodeImpl {
  _tag = "AnyOf";
  ast;
  issues;
  constructor(ast, issues, input, options) {
    super(input, options);
    this.ast = ast;
    this.issues = issues;
  }
};
var OneOf = class extends IssueNodeImpl {
  _tag = "OneOf";
  ast;
  successes;
  constructor(ast, successes, input, options) {
    super(input, options);
    this.ast = ast;
    this.successes = successes;
  }
};
function makeFilterIssue(entry, input, options) {
  if (isIssue(entry)) {
    return entry;
  }
  if (typeof entry === "string") {
    return new InvalidValue({
      message: entry
    }, input, options);
  }
  const inner = typeof entry.issue === "string" ? new InvalidValue({
    message: entry.issue
  }, input, options) : entry.issue;
  return new Pointer(entry.path, inner);
}
function makeSingle(out, input, options) {
  if (out === undefined) {
    return;
  }
  if (typeof out === "boolean") {
    return out ? undefined : new InvalidValue(undefined, input, options);
  }
  return makeFilterIssue(out, input, options);
}
function normalizeFilterOutput(ast, out, input, options) {
  if (Array.isArray(out)) {
    if (!isReadonlyArrayNonEmpty(out)) {
      return;
    }
    return out.length === 1 ? makeFilterIssue(out[0], input, options) : new Composite(ast, map2(out, (entry) => makeFilterIssue(entry, input, options)), input, options);
  }
  return makeSingle(out, input, options);
}
var defaultLeafHook = (issue) => {
  const message = findMessage(issue);
  if (message !== undefined)
    return message;
  switch (issue._tag) {
    case "InvalidType":
      return getExpectedMessage(getExpected(issue.ast), issue);
    case "InvalidValue": {
      const expected = findExpected(issue);
      if (expected !== undefined)
        return getExpectedMessage(expected, issue);
      const input = formatInput(issue);
      return input === undefined ? "Expected a valid value" : `Invalid data ${input}`;
    }
    case "MissingKey":
      return "Missing key";
    case "UnexpectedKey": {
      const input = formatInput(issue);
      return input === undefined ? "Expected no excess property" : `Unexpected key with value ${input}`;
    }
    case "Forbidden":
      return "Forbidden operation";
    case "OneOf": {
      const input = formatInput(issue);
      return input === undefined ? "Expected exactly one member to match" : `Expected exactly one member to match the input ${input}`;
    }
  }
};
var defaultCheckHook = (issue) => findMessage(issue.issue) ?? findMessage(issue);
function formatInput(issue) {
  return hasInput(issue) ? format(issue.input) : undefined;
}
function findExpected(issue) {
  const expected = issue.annotations?.expected;
  return typeof expected === "string" ? expected : undefined;
}
function getExpectedMessage(expected, issue) {
  const input = formatInput(issue);
  return input === undefined ? `Expected ${expected}` : `Expected ${expected}, got ${input}`;
}
function formatCheck(check) {
  const expected = check.annotations?.expected;
  if (typeof expected === "string")
    return expected;
  switch (check._tag) {
    case "Filter":
      return "<filter>";
    case "FilterGroup":
      return check.checks.map((check) => formatCheck(check)).join(" & ");
  }
}
function makeFormatterDefault() {
  return (issue) => formatIssue(issue, "");
}
var defaultFormatter = /* @__PURE__ */ makeFormatterDefault();
function formatIssue(issue, path) {
  let message;
  switch (issue._tag) {
    case "Filter": {
      const annotated = defaultCheckHook(issue);
      if (annotated !== undefined) {
        message = annotated;
      } else {
        if (issue.issue._tag !== "InvalidValue") {
          return formatIssue(issue.issue, path);
        }
        const expected = findExpected(issue.issue);
        message = expected === undefined ? getExpectedMessage(formatCheck(issue.filter), issue) : getExpectedMessage(expected, issue.issue);
      }
      break;
    }
    case "Encoding":
      return formatIssue(issue.issue, path);
    case "Pointer":
      return formatIssue(issue.issue, path + formatPath(issue.path));
    case "Composite":
    case "AnyOf": {
      if (issue._tag === "Composite" || issue.issues.length > 0) {
        return issue.issues.map((issue) => formatIssue(issue, path)).join(`
`);
      }
      message = findMessage(issue) ?? getExpectedMessage(getExpected(issue.ast), issue);
      break;
    }
    default:
      message = defaultLeafHook(issue);
      break;
  }
  return path ? `${message}
  at ${path}` : message;
}
function findMessage(issue) {
  if (issue._tag === "Pointer")
    return;
  if (issue._tag === "Encoding")
    return findMessage(issue.issue);
  const annotations = issue._tag === "Filter" ? issue.filter.annotations : ("annotations" in issue) ? issue.annotations : issue.ast.annotations;
  const message = annotations?.[issue._tag === "MissingKey" ? "messageMissingKey" : issue._tag === "UnexpectedKey" ? "messageUnexpectedKey" : "message"];
  if (typeof message === "string")
    return message;
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schema/cause.js
function getSchemaIssue(cause) {
  let issue;
  for (const reason of cause.reasons) {
    if (!isFailReason2(reason) || !isIssue(reason.error)) {
      return;
    }
    issue ??= reason.error;
  }
  return issue;
}
function getSchemaIssueOrThrow(cause, message) {
  const issue = getSchemaIssue(cause);
  if (issue === undefined) {
    throw new Error(message, {
      cause
    });
  }
  return issue;
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/SchemaGetter.js
var makeGetter = (fields) => Object.assign(Object.create(Prototype), fields);
var passthrough_ = /* @__PURE__ */ makeGetter({
  _tag: "Passthrough"
});
function passthrough2() {
  return passthrough_;
}
function transform(f) {
  return makeGetter({
    _tag: "Transform",
    transform: f
  });
}
function transformEffect(f) {
  return makeGetter({
    _tag: "TransformEffect",
    transform: f
  });
}
function String2() {
  return transform(globalThis.String);
}
function Number3() {
  return transform(globalThis.Number);
}
function encodeBase642() {
  return transform(encodeBase64);
}
function decodeBase642() {
  return transformEffect((input, options) => mapErrorEager2(fromResult2(decodeBase64(input)), () => new InvalidValue({
    expected: "a valid Base64 string"
  }, input, options)));
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/SchemaTransformation.js
var TypeId9 = "~effect/SchemaTransformation/Transformation";
var Transformation = class extends Class {
  [TypeId9] = TypeId9;
  _tag = "Transformation";
  decode;
  encode;
  constructor(decode, encode) {
    super();
    this.decode = decode;
    this.encode = encode;
  }
  flip() {
    return new Transformation(this.encode, this.decode);
  }
};
function isTransformation(u) {
  return hasProperty(u, TypeId9) && u[TypeId9] === TypeId9;
}
var makeTransformation = (options) => {
  if (isTransformation(options)) {
    return options;
  }
  return new Transformation(options.decode, options.encode);
};
function transformEffect2(options) {
  return new Transformation(transformEffect(options.decode), transformEffect(options.encode));
}
function transform2(options) {
  return new Transformation(transform(options.decode), transform(options.encode));
}
var passthrough_2 = /* @__PURE__ */ new Transformation(/* @__PURE__ */ passthrough2(), /* @__PURE__ */ passthrough2());
function passthrough3() {
  return passthrough_2;
}
var numberFromString = /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ String2());
var isJsonError = (input) => isObject(input) && typeof input["message"] === "string";
var decodeJsonError = (input) => {
  const hasCause = Object.hasOwn(input, "cause");
  const err = hasCause ? new Error(input.message, {
    cause: decodeDefect(input.cause)
  }) : new Error(input.message);
  if (typeof input.name === "string" && input.name !== "Error")
    err.name = input.name;
  if (typeof input.stack === "string")
    err.stack = input.stack;
  return err;
};
var encodeUnknownAsJson = (input) => {
  try {
    const json = formatJson(input);
    return json === undefined ? format(input) : JSON.parse(json);
  } catch {
    return format(input);
  }
};
var encodeJsonError = (input, options, encodeDefect) => {
  const encoded = {
    name: input.name,
    message: typeof input.message === "string" ? input.message : ""
  };
  if (options?.includeStack && typeof input.stack === "string") {
    encoded.stack = input.stack;
  }
  if (!options?.excludeCause && input.cause !== undefined) {
    encoded.cause = encodeDefect(input.cause);
  }
  return encoded;
};
var makeEncodeDefect = (options) => {
  const seen = new WeakSet;
  const encode = (input) => {
    if (isError(input)) {
      if (seen.has(input)) {
        return "[Circular]";
      }
      seen.add(input);
      const encoded = encodeJsonError(input, options, encode);
      seen.delete(input);
      return encoded;
    }
    return encodeUnknownAsJson(input);
  };
  return encode;
};
var decodeDefect = (input) => isJsonError(input) ? decodeJsonError(input) : input;
var defectFromJson = (options) => transform2({
  decode: decodeDefect,
  encode: makeEncodeDefect(options)
});
var urlFromString = /* @__PURE__ */ transformEffect2({
  decode: (s, options) => URL.canParse(s) ? succeed6(new URL(s)) : fail5(new InvalidValue({
    expected: "a valid URL string"
  }, s, options)),
  encode: (url) => succeed6(url.href)
});
var uint8ArrayFromBase64String = /* @__PURE__ */ new Transformation(/* @__PURE__ */ decodeBase642(), /* @__PURE__ */ encodeBase642());

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/SchemaAST.js
function makeGuard(tag) {
  return (ast) => ast._tag === tag;
}
var isDeclaration = /* @__PURE__ */ makeGuard("Declaration");
var isNever2 = /* @__PURE__ */ makeGuard("Never");
var isLiteral = /* @__PURE__ */ makeGuard("Literal");
var isUniqueSymbol = /* @__PURE__ */ makeGuard("UniqueSymbol");
var isArrays = /* @__PURE__ */ makeGuard("Arrays");
var isObjects = /* @__PURE__ */ makeGuard("Objects");
var isSuspend = /* @__PURE__ */ makeGuard("Suspend");
var Link = class {
  to;
  transformation;
  constructor(to, transformation) {
    this.to = to;
    this.transformation = transformation;
  }
};
var defaultParseOptions = {};
var Context = class {
  isOptional;
  isMutable;
  constructorDefault;
  annotations;
  constructor(isOptional, isMutable, constructorDefault = undefined, annotations = undefined) {
    this.isOptional = isOptional;
    this.isMutable = isMutable;
    this.constructorDefault = constructorDefault;
    this.annotations = annotations;
  }
};
var TypeId10 = "~effect/Schema";

class ASTNodeImpl {
  [TypeId10] = TypeId10;
  annotations;
  checks;
  encoding;
  context;
  constructor(annotations = undefined, checks = undefined, encoding = undefined, context = undefined) {
    this.annotations = annotations;
    this.checks = checks;
    this.encoding = encoding;
    this.context = context;
  }
  toString() {
    return `<${this._tag}>`;
  }
}
var Declaration = class extends ASTNodeImpl {
  _tag = "Declaration";
  typeParameters;
  run;
  encodingChecks;
  encodingRun;
  constructor(typeParameters, run, annotations, checks, encoding, context, encodingChecks, encodingRun) {
    super(annotations, checks, encoding, context);
    this.typeParameters = typeParameters;
    this.run = run;
    this.encodingChecks = encodingChecks;
    this.encodingRun = encodingRun;
  }
  getParser() {
    let run;
    return (input, options) => {
      if (input === missing)
        return missingExit;
      return (run ??= this.run(this.typeParameters))(input, this, options);
    };
  }
  _rebuild(recur, checks, encodingChecks, run, encodingRun) {
    const tps = mapOrSame(this.typeParameters, recur);
    return tps === this.typeParameters && checks === this.checks && encodingChecks === this.encodingChecks && run === this.run && encodingRun === this.encodingRun ? this : new Declaration(tps, run, this.annotations, checks, undefined, this.context, encodingChecks, encodingRun);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks, this.run, this.encodingRun);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks, this.encodingRun ?? this.run, this.run);
  }
  getExpected() {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    return "<Declaration>";
  }
};
var Null = class extends ASTNodeImpl {
  _tag = "Null";
  getParser() {
    return fromConst(this, null);
  }
  getExpected() {
    return "null";
  }
};
var null_ = /* @__PURE__ */ new Null;
var Unknown = class extends ASTNodeImpl {
  _tag = "Unknown";
  getParser() {
    return fromRefinement(this, isUnknown);
  }
  getExpected() {
    return "unknown";
  }
};
var unknown = /* @__PURE__ */ new Unknown;
var Literal = class extends ASTNodeImpl {
  _tag = "Literal";
  literal;
  constructor(literal, annotations, checks, encoding, context) {
    super(annotations, checks, encoding, context);
    if (typeof literal === "number" && !globalThis.Number.isFinite(literal)) {
      throw new Error(`A numeric literal must be finite, got ${format(literal)}`);
    }
    this.literal = literal;
  }
  getParser() {
    return fromConst(this, this.literal);
  }
  matchPart(s, _options) {
    return s === globalThis.String(this.literal) ? this.literal : undefined;
  }
  toCodecJson() {
    return typeof this.literal === "bigint" ? literalToString(this) : this;
  }
  toCodecStringTree() {
    return typeof this.literal === "string" ? this : literalToString(this);
  }
  getExpected() {
    return typeof this.literal === "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
  }
};
function literalToString(ast) {
  const literalAsString = globalThis.String(ast.literal);
  return replaceEncoding(ast, [new Link(new Literal(literalAsString), new Transformation(transform(() => ast.literal), transform(() => literalAsString)))]);
}
var String3 = class extends ASTNodeImpl {
  _tag = "String";
  getParser() {
    return fromRefinement(this, isString);
  }
  matchPart(s, options) {
    const checks = this.checks;
    return checks && !options.disableChecks && collectIssues(checks, s, undefined, this, options) ? undefined : s;
  }
  getExpected() {
    return "string";
  }
};
var string2 = /* @__PURE__ */ new String3;
var Number4 = class extends ASTNodeImpl {
  _tag = "Number";
  getParser() {
    return fromRefinement(this, isNumber);
  }
  matchKey(s, options) {
    return this._match(isStringNumberRegExp, s, options);
  }
  matchPart(s, options) {
    return this._match(isStringFiniteRegExp, s, options);
  }
  _match(regexp, s, options) {
    if (!regexp.test(s))
      return;
    const value = globalThis.Number(s);
    if (options.disableChecks || !this.checks)
      return value;
    return collectIssues(this.checks, value, undefined, this, options) ? undefined : value;
  }
  toCodecJson() {
    if (this.checks && (hasCheck(this.checks, "effect/schema/isFinite") || hasCheck(this.checks, "effect/schema/isInt"))) {
      return this;
    }
    return replaceEncoding(this, [numberToJson]);
  }
  toCodecStringTree() {
    if (this.toCodecJson() === this) {
      return replaceEncoding(this, [finiteToString]);
    }
    return replaceEncoding(this, [numberToString]);
  }
  getExpected() {
    return "number";
  }
};
function hasCheck(checks, id) {
  return checks.some((check) => check.annotations?.representation?.id === id || check._tag === "FilterGroup" && hasCheck(check.checks, id));
}
var number2 = /* @__PURE__ */ new Number4;
var Boolean2 = class extends ASTNodeImpl {
  _tag = "Boolean";
  getParser() {
    return fromRefinement(this, isBoolean);
  }
  getExpected() {
    return "boolean";
  }
};
var boolean = /* @__PURE__ */ new Boolean2;
var Arrays = class extends ASTNodeImpl {
  _tag = "Arrays";
  isMutable;
  elements;
  rest;
  encodingChecks;
  constructor(isMutable, elements, rest, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.isMutable = isMutable;
    this.elements = elements;
    this.rest = rest;
    this.encodingChecks = encodingChecks;
    let hasOptional = false;
    for (let i = 0;i < elements.length; i++) {
      if (isOptional(elements[i])) {
        hasOptional = true;
      } else if (hasOptional) {
        throw new Error("A required element cannot follow an optional element. ts(1257)");
      }
    }
    if (hasOptional && rest.length > 1) {
      throw new Error("A required element cannot follow an optional element. ts(1257)");
    }
    for (let i = 1;i < rest.length; i++) {
      if (isOptional(rest[i])) {
        throw new Error("An optional element cannot follow a rest element. ts(1266)");
      }
    }
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    let elements;
    let rest;
    const elementLen = ast.elements.length;
    const tailLen = Math.max(0, ast.rest.length - 1);
    function getParser(tailThreshold, index) {
      if (index < elementLen) {
        return elements[index];
      } else if (index >= tailThreshold) {
        return rest[index - tailThreshold + 1];
      }
      return rest[0];
    }
    return fnUntracedEager2(function* (input, options) {
      if (input === missing) {
        return missing;
      }
      if (!Array.isArray(input)) {
        return yield* fail5(new InvalidType(ast, input, options));
      }
      if (!elements) {
        elements = ast.elements.map((ast) => ({
          ast,
          parser: compileField(ast)
        }));
        rest = ast.rest.map((ast) => ({
          ast,
          parser: compileField(ast)
        }));
      }
      const len = input.length;
      const state = {
        ast,
        getParser,
        input,
        len,
        tailThreshold: Math.max(elementLen, len - tailLen),
        output: new globalThis.Array(len),
        issues: undefined,
        options
      };
      const end = ast.rest.length === 0 ? elementLen : Math.max(len, elementLen + tailLen);
      const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
      const eff = concurrency === 1 ? parseArray(state, input, 0, end) : parseArrayConcurrent(state, input, {
        concurrency,
        end
      });
      if (eff)
        yield* eff;
      if (ast.rest.length === 0 && len > elementLen) {
        for (let i = elementLen;i <= len - 1; i++) {
          const unexpected = new UnexpectedKey(ast, input[i], options);
          const issue = new Pointer([i], unexpected);
          if (options.errors === "all") {
            if (state.issues)
              state.issues.push(issue);
            else
              state.issues = [issue];
          } else {
            return yield* fail5(new Composite(ast, [issue], input, options));
          }
        }
      }
      if (state.issues) {
        return yield* fail5(new Composite(ast, state.issues, input, options));
      }
      return state.output;
    });
  }
  _rebuild(recur, checks, encodingChecks) {
    const elements = mapOrSame(this.elements, recur);
    const rest = mapOrSame(this.rest, recur);
    return elements === this.elements && rest === this.rest && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Arrays(this.isMutable, elements, rest, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  getExpected() {
    return "array";
  }
};
function stepArray(s, item, exit, i) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, i, exit);
  }
  const value = exit === sameExit ? item : exit[args];
  if (value !== missing) {
    s.output[i] = value;
  } else {
    const p = s.getParser(s.tailThreshold, i);
    if (isOptional(p.ast))
      return;
    const issue = new Pointer([i], new MissingKey(p.ast.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      return fail4(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parseArrayOptions = {
  onItem(s, item, i) {
    const value = i < s.len ? item : missing;
    return s.getParser(s.tailThreshold, i).parser(value, s.options);
  },
  step: stepArray
};
var parseArray = /* @__PURE__ */ iterateEager()(parseArrayOptions);
var parseArrayConcurrent = /* @__PURE__ */ iterateConcurrent()(parseArrayOptions);
var wrapPropertyKeyIssue = (s, ast, key, exit) => {
  if (exit.cause.reasons.length === 0) {
    return exit;
  }
  const issue = getSchemaIssue(exit.cause);
  if (issue === undefined) {
    return failCause2(map5(exit.cause, (issue) => new Composite(ast, [new Pointer([key], issue)], s.input, s.options)));
  }
  const pointer = new Pointer([key], issue);
  if (s.options.errors === "all") {
    if (s.issues)
      s.issues.push(pointer);
    else
      s.issues = [pointer];
  } else {
    return fail4(new Composite(ast, [pointer], s.input, s.options));
  }
};
var FINITE_PATTERN = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?";
function getIndexSignatureKeys(input, parameter, options = defaultParseOptions) {
  let stringKeys;
  let symbolKeys;
  function go(parameter) {
    switch (parameter._tag) {
      case "String":
      case "TemplateLiteral":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchPart(k, options) !== undefined);
      case "Number":
        return (stringKeys ??= Object.keys(input)).filter((k) => parameter.matchKey(k, options) !== undefined);
      case "Symbol":
        return (symbolKeys ??= Object.getOwnPropertySymbols(input)).filter((k) => parameter.matchKey(k, options) !== undefined);
      case "Union":
        return [...new Set(parameter.types.flatMap(go))];
      default:
        return [];
    }
  }
  return go(parameterFromPropertyKey(toEncoded(parameter)));
}
var PropertySignature = class {
  name;
  type;
  constructor(name, type) {
    this.name = name;
    this.type = type;
  }
};
function isIndexSignatureParameterSide(ast) {
  switch (ast._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return ast.types.every(isIndexSignatureParameterSide);
    default:
      return false;
  }
}
function isIndexSignatureParameterEncodedSide(ast) {
  const encoded = getLastEncoding(ast);
  switch (encoded._tag) {
    case "String":
    case "Number":
    case "Symbol":
    case "TemplateLiteral":
      return true;
    case "Union":
      return encoded.types.every(isIndexSignatureParameterEncodedSide);
    default:
      return false;
  }
}
function isIndexSignatureParameter(ast) {
  return isIndexSignatureParameterSide(ast) && isIndexSignatureParameterEncodedSide(ast);
}
var IndexSignature = class {
  parameter;
  type;
  constructor(parameter, type) {
    if (!isIndexSignatureParameter(parameter)) {
      throw new Error(`Invalid index signature parameter ${parameter._tag}`);
    }
    this.parameter = parameter;
    this.type = type;
    if (isOptional(type) && !containsUndefined(type)) {
      throw new Error("Cannot use `Schema.optionalKey` with index signatures, use `Schema.optional` instead.");
    }
  }
};
var Objects = class extends ASTNodeImpl {
  _tag = "Objects";
  propertySignatures;
  indexSignatures;
  encodingChecks;
  constructor(propertySignatures, indexSignatures, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.propertySignatures = propertySignatures;
    this.indexSignatures = indexSignatures;
    this.encodingChecks = encodingChecks;
    const seen = new Set;
    const duplicates = [];
    for (const propertySignature of propertySignatures) {
      const name = propertySignature.name;
      if (seen.has(name)) {
        duplicates.push(name);
      } else {
        seen.add(name);
      }
    }
    if (duplicates.length > 0) {
      throw new Error(`Duplicate identifiers: ${JSON.stringify(duplicates)}. ts(2300)`);
    }
  }
  getParser(compile, compileField = compile) {
    const ast = this;
    const expectedKeys = [];
    for (const ps of ast.propertySignatures) {
      expectedKeys.push(typeof ps.name === "number" ? globalThis.String(ps.name) : ps.name);
    }
    const hasProperties = expectedKeys.length;
    const indexCount = ast.indexSignatures.length;
    let expectedKeysSet = hasProperties && indexCount ? new Set(expectedKeys) : undefined;
    if (!hasProperties && !indexCount) {
      return fromRefinement(ast, isNotNullish);
    }
    let properties;
    let indexes;
    const finishIndex = (s, key, k2, inputValue, exitValue) => {
      if (exitValue._tag === "Failure") {
        return wrapPropertyKeyIssue(s, ast, key, exitValue) ?? void_2;
      }
      const value = exitValue === sameExit ? inputValue : exitValue[args];
      if (k2 !== missing && value !== missing) {
        if (hasProperties && (expectedKeysSet.has(key) || expectedKeysSet.has(typeof k2 === "number" ? globalThis.String(k2) : k2)))
          return void_2;
        assignProperty(s.out, k2, value);
      }
      return void_2;
    };
    const parseIndex = (s, key, index, exitKey) => {
      if (!exitKey) {
        const eff = index.parserKey(key, s.options);
        if (!effectIsExit(eff)) {
          return flatMap3(exit2(eff), (exit) => parseIndex(s, key, index, exit));
        }
        exitKey = eff;
      }
      if (exitKey._tag === "Failure") {
        return wrapPropertyKeyIssue(s, ast, key, exitKey) ?? void_2;
      }
      const k2 = exitKey === sameExit ? key : exitKey[args];
      const inputValue = s.input[key];
      const result = index.parserValue(inputValue, s.options);
      return effectIsExit(result) ? finishIndex(s, key, k2, inputValue, result) : flatMap3(exit2(result), (exit) => finishIndex(s, key, k2, inputValue, exit));
    };
    const parseStringIndex = (s, key, index) => {
      const inputValue = s.input[key];
      const result = index.parserValue(inputValue, s.options);
      return effectIsExit(result) ? finishIndex(s, key, key, inputValue, result) : flatMap3(exit2(result), (exit) => finishIndex(s, key, key, inputValue, exit));
    };
    const parseIndexes = indexCount ? iterateConcurrent()({
      onItem: (s, [key, index]) => index.is.parameter === string2 ? parseStringIndex(s, key, index) : parseIndex(s, key, index),
      step: (_s, _item, exit) => exit._tag === "Failure" ? exit : undefined
    }) : undefined;
    const compileMembers = () => {
      if (!properties) {
        properties = ast.propertySignatures.map((ps) => ({
          parser: compileField(ps.type),
          name: ps.name,
          type: ps.type
        }));
        indexes = indexCount ? ast.indexSignatures.map((is) => ({
          is,
          parserKey: compile(parameterFromPropertyKey(is.parameter)),
          parserValue: compileField(is.type)
        })) : undefined;
      }
      return properties;
    };
    const fallback = fnUntracedEager2(function* (input, options) {
      if (input === missing) {
        return missing;
      }
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return yield* fail5(new InvalidType(ast, input, options));
      }
      compileMembers();
      const record = input;
      const out = {};
      const state = {
        ast,
        input: record,
        out,
        issues: undefined,
        options
      };
      const errorsAllOption = options.errors === "all";
      const onExcessPropertyError = options.onExcessProperty === "error";
      const concurrency = options.concurrency === undefined ? 1 : resolveConcurrency(options.concurrency);
      const indexKeys = indexCount && onExcessPropertyError ? ast.indexSignatures.map((index) => getIndexSignatureKeys(record, index.parameter, options)) : undefined;
      if (onExcessPropertyError) {
        expectedKeysSet ??= new Set(expectedKeys);
        const coveredKeys = indexKeys ? new Set(expectedKeysSet) : expectedKeysSet;
        if (indexKeys) {
          for (const keys of indexKeys) {
            for (const key of keys)
              coveredKeys.add(key);
          }
        }
        const inputKeys = Reflect.ownKeys(record);
        for (let i = 0;i < inputKeys.length; i++) {
          const key = inputKeys[i];
          if (!coveredKeys.has(key)) {
            const unexpected = new UnexpectedKey(ast, record[key], options);
            const issue = new Pointer([key], unexpected);
            if (errorsAllOption) {
              if (state.issues) {
                state.issues.push(issue);
              } else {
                state.issues = [issue];
              }
              continue;
            } else {
              return yield* fail5(new Composite(ast, [issue], input, options));
            }
          }
        }
      }
      if (hasProperties) {
        const eff = concurrency === 1 ? parseProperties(state, properties) : parsePropertiesConcurrent(state, properties, {
          concurrency
        });
        if (eff)
          yield* eff;
      }
      if (indexCount && concurrency === 1) {
        for (let i = 0;i < indexCount; i++) {
          const index = indexes[i];
          const parse = index.is.parameter === string2 ? parseStringIndex : parseIndex;
          const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
          for (let j = 0;j < keys.length; j++) {
            const eff = parse(state, keys[j], index);
            if (!effectIsExit(eff))
              yield* eff;
            else if (eff._tag === "Failure")
              return yield* eff;
          }
        }
      } else if (parseIndexes) {
        const keyPairs = empty2();
        for (let i = 0;i < indexCount; i++) {
          const index = indexes[i];
          const keys = indexKeys?.[i] ?? (index.is.parameter === string2 ? Object.keys(record) : getIndexSignatureKeys(record, index.is.parameter, options));
          for (let j = 0;j < keys.length; j++) {
            keyPairs.push([keys[j], index]);
          }
        }
        const eff = parseIndexes(state, keyPairs, {
          concurrency
        });
        if (eff)
          yield* eff;
      }
      if (state.issues) {
        return yield* fail5(new Composite(ast, state.issues, input, options));
      }
      return out;
    });
    if (indexCount)
      return fallback;
    const resume = (state, index, pending) => {
      const property = properties[index];
      return flatMap3(exit2(pending), (exit) => {
        const terminal = stepProperty(state, property, exit);
        if (terminal)
          return terminal;
        const done = () => succeed7(state.out);
        const eff = parseProperties(state, properties.slice(index + 1));
        return eff ? flatMapEager2(eff, done) : done();
      });
    };
    return (input, options) => {
      if (input === missing)
        return missingExit;
      if (options.errors === "all" || options.onExcessProperty !== undefined || options.concurrency !== undefined && resolveConcurrency(options.concurrency) !== 1) {
        return fallback(input, options);
      }
      if (!(typeof input === "object" && input !== null && !Array.isArray(input))) {
        return fail5(new InvalidType(ast, input, options));
      }
      const props = compileMembers();
      const record = input;
      const out = {};
      const state = {
        ast,
        input: record,
        out,
        issues: undefined,
        options
      };
      try {
        for (let index = 0;index < props.length; index++) {
          const property = props[index];
          const name = property.name;
          const hasKey = hasPropertySignature(record, name);
          const value = hasKey ? record[name] : missing;
          const exit = property.parser(value, options);
          if (!effectIsExit(exit)) {
            return resume(state, index, exit);
          }
          if (exit === sameExit) {
            if (hasKey)
              assignProperty(out, name, value);
            continue;
          }
          const terminal = stepProperty(state, property, exit);
          if (terminal)
            return terminal;
        }
      } catch (error) {
        return die3(error);
      }
      return succeed7(out);
    };
  }
  _rebuild(recur, recurParameter, checks, encodingChecks) {
    const props = mapOrSame(this.propertySignatures, (ps) => {
      const t = recur(ps.type);
      return t === ps.type ? ps : new PropertySignature(ps.name, t);
    });
    const indexes = mapOrSame(this.indexSignatures, (is) => {
      const p = recurParameter(is.parameter);
      const t = recur(is.type);
      return p === is.parameter && t === is.type ? is : new IndexSignature(p, t);
    });
    return props === this.propertySignatures && indexes === this.indexSignatures && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Objects(props, indexes, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, recur, this.encodingChecks, this.checks);
  }
  recur(recur, recurParameter = recur) {
    return this._rebuild(recur, recurParameter, this.checks, this.encodingChecks);
  }
  getExpected() {
    if (this.propertySignatures.length === 0 && this.indexSignatures.length === 0)
      return "object | array";
    return "object";
  }
};
function stepProperty(s, p, exit) {
  if (exit._tag === "Failure") {
    return wrapPropertyKeyIssue(s, s.ast, p.name, exit);
  }
  if (exit === sameExit)
    return;
  const value = exit[args];
  if (value !== missing) {
    assignProperty(s.out, p.name, value);
    return;
  }
  delete s.out[p.name];
  if (!isOptional(p.type)) {
    const issue = new Pointer([p.name], new MissingKey(p.type.context?.annotations));
    if (s.options.errors === "all") {
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
      return;
    } else {
      return fail4(new Composite(s.ast, [issue], s.input, s.options));
    }
  }
}
var parsePropertiesOptions = {
  onItem(s, p) {
    if (!hasPropertySignature(s.input, p.name)) {
      return p.parser(missing, s.options);
    }
    const value = s.input[p.name];
    assignProperty(s.out, p.name, value);
    return p.parser(value, s.options);
  },
  step: stepProperty
};
var parseProperties = /* @__PURE__ */ iterateEager()(parsePropertiesOptions);
var parsePropertiesConcurrent = /* @__PURE__ */ iterateConcurrent()(parsePropertiesOptions);
function combineChecks(a, b) {
  if (!a)
    return b;
  if (!b)
    return a;
  return [...a, ...b];
}
function struct(fields, checks, annotations) {
  return new Objects(Reflect.ownKeys(fields).map((key) => {
    return new PropertySignature(key, fields[key].ast);
  }), [], annotations, checks);
}
function getAST(self) {
  return self.ast;
}
function tuple(elements, checks = undefined) {
  return new Arrays(false, elements.map((e) => e.ast), [], undefined, checks);
}
function union(members, options, checks) {
  return new Union(members.map(getAST), options, undefined, checks);
}
var toCandidate = /* @__PURE__ */ memoizeIdempotent((ast) => {
  while (true) {
    if (isSuspend(ast))
      return unknown;
    const encoding = ast.encoding;
    if (!encoding) {
      return ast.recur?.(toCandidate, identity) ?? ast;
    }
    if (encoding.some((link) => link.transformation._tag === "Middleware" && link.transformation.decode !== identity))
      return unknown;
    ast = encoding[encoding.length - 1].to;
  }
});
function getCandidateTypes(ast) {
  switch (ast._tag) {
    case "Null":
      return ["null"];
    case "Undefined":
      return ["undefined"];
    case "String":
    case "TemplateLiteral":
      return ["string"];
    case "Number":
      return ["number"];
    case "Boolean":
      return ["boolean"];
    case "Symbol":
    case "UniqueSymbol":
      return ["symbol"];
    case "BigInt":
      return ["bigint"];
    case "Arrays":
      return ["array"];
    case "ObjectKeyword":
      return ["object", "array", "function"];
    case "Objects":
      return ast.propertySignatures.length || ast.indexSignatures.length ? ["object"] : ["string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
    case "Enum":
      return Array.from(new Set(ast.enums.map(([, v]) => typeof v)));
    case "Literal":
      return [typeof ast.literal];
    case "Union":
      return Array.from(new Set(ast.types.flatMap(getCandidateTypes)));
    default:
      return ["null", "undefined", "string", "number", "boolean", "symbol", "bigint", "object", "array", "function"];
  }
}
function collectSentinels(ast) {
  switch (ast._tag) {
    default:
      return [];
    case "Declaration": {
      const s = ast.annotations?.[SENTINELS_ANNOTATION_KEY];
      return Array.isArray(s) ? s : [];
    }
    case "Objects":
      return ast.propertySignatures.flatMap((ps) => {
        const type = ps.type;
        if (!isOptional(type)) {
          if (isLiteral(type)) {
            return [{
              key: ps.name,
              literal: type.literal
            }];
          }
          if (isUniqueSymbol(type)) {
            return [{
              key: ps.name,
              literal: type.symbol
            }];
          }
        }
        return [];
      });
    case "Arrays":
      return ast.elements.flatMap((e, i) => {
        if (!isOptional(e)) {
          if (isLiteral(e)) {
            return [{
              key: i,
              literal: e.literal
            }];
          }
          if (isUniqueSymbol(e)) {
            return [{
              key: i,
              literal: e.symbol
            }];
          }
        }
        return [];
      });
    case "Union": {
      if (ast.types.length === 0)
        return [];
      const members = ast.types.map((type) => collectSentinels(toCandidate(type)));
      return members[0].filter((s) => members.every((sentinels) => sentinels.some((o) => o.key === s.key && o.literal === s.literal)));
    }
    case "Suspend":
      return collectSentinels(ast.thunk());
  }
}
var candidateIndexCache = /* @__PURE__ */ new WeakMap;
var emptyCandidates = /* @__PURE__ */ Object.freeze([]);
var hasPropertySignature = (input, key) => key === "__proto__" ? Object.hasOwn(input, key) : (key in input);
function getIndex(types) {
  let index = candidateIndexCache.get(types);
  if (index)
    return index;
  let bySentinel;
  let sentinelCandidateCount = 0;
  let otherwise;
  let literalCandidates;
  let onlyLiterals = true;
  for (let i = 0;i < types.length; i++) {
    const a = types[i];
    const encoded = toCandidate(a);
    if (isNever2(encoded))
      continue;
    if (onlyLiterals) {
      if (isLiteral(encoded) || isUniqueSymbol(encoded)) {
        literalCandidates ??= new Map;
        const literal = isLiteral(encoded) ? encoded.literal : encoded.symbol;
        let arr = literalCandidates.get(literal);
        if (!arr)
          literalCandidates.set(literal, arr = []);
        arr.push(a);
      } else {
        onlyLiterals = false;
      }
    }
    const sentinels = collectSentinels(encoded);
    if (sentinels.length) {
      bySentinel ??= new Map;
      sentinelCandidateCount++;
      for (const {
        key,
        literal
      } of sentinels) {
        let entry = bySentinel.get(key);
        if (!entry)
          bySentinel.set(key, entry = [new Map, new Set]);
        entry[1].add(i);
        let indexes = entry[0].get(literal);
        if (!indexes)
          entry[0].set(literal, indexes = new Set);
        indexes.add(i);
      }
    } else {
      otherwise ??= {};
      const candidateTypes = getCandidateTypes(encoded);
      for (const t of candidateTypes)
        (otherwise[t] ??= []).push(i);
    }
  }
  if (onlyLiterals && literalCandidates) {
    literalCandidates.forEach(Object.freeze);
    index = (input) => literalCandidates.get(input) ?? emptyCandidates;
  } else if (bySentinel?.size === 1 && !otherwise) {
    const [key, [byValue]] = bySentinel.entries().next().value;
    const candidates = byValue;
    for (const [literal, indexes] of byValue) {
      candidates.set(literal, Object.freeze(Array.from(indexes, (index) => types[index])));
    }
    index = (input, isConstructor) => {
      if (isObjectKeyword(input)) {
        const value = hasPropertySignature(input, key) ? input[key] : undefined;
        if (value !== undefined)
          return candidates.get(value) ?? emptyCandidates;
        if (isConstructor)
          return types;
      }
      return emptyCandidates;
    };
  } else if (bySentinel) {
    let commonSentinel;
    for (const entry of bySentinel) {
      if ((!commonSentinel || entry[1][0].size > commonSentinel[1][0].size) && entry[1][1].size === sentinelCandidateCount) {
        commonSentinel = entry;
      }
    }
    index = (input, isConstructor) => {
      const runtimeType = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
      const base = otherwise?.[runtimeType] ?? emptyCandidates;
      if (!isObjectKeyword(input))
        return base.map((i) => types[i]);
      const selected = new Set(base);
      let directKey;
      if (commonSentinel) {
        const [key, [byValue]] = commonSentinel;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          if (!match)
            return base.map((i) => types[i]);
          for (const i of match)
            selected.add(i);
          directKey = key;
        }
      }
      if (directKey === undefined) {
        for (const [key, [byValue, all]] of bySentinel) {
          const hasKey = hasPropertySignature(input, key);
          const value = hasKey ? input[key] : undefined;
          if (hasKey && (!isConstructor || value !== undefined)) {
            const match = byValue.get(value);
            if (match) {
              for (const i of match)
                selected.add(i);
            }
          } else if (isConstructor) {
            for (const i of all)
              selected.add(i);
          }
        }
      }
      for (const [key, [byValue, all]] of bySentinel) {
        if (key === directKey)
          continue;
        const hasKey = hasPropertySignature(input, key);
        const value = hasKey ? input[key] : undefined;
        if (hasKey && (!isConstructor || value !== undefined)) {
          const match = byValue.get(value);
          for (const i of selected) {
            if (all.has(i) && !match?.has(i))
              selected.delete(i);
          }
        }
      }
      return Array.from(selected).sort((a, b) => a - b).map((i) => types[i]);
    };
  } else {
    index = (input) => {
      const runtimeType = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
      return (otherwise?.[runtimeType] ?? emptyCandidates).map((i) => types[i]).filter(filterLiterals(input));
    };
  }
  candidateIndexCache.set(types, index);
  return index;
}
function filterLiterals(input) {
  return (ast) => {
    const encoded = toCandidate(ast);
    return encoded._tag === "Literal" ? encoded.literal === input : encoded._tag === "UniqueSymbol" ? encoded.symbol === input : true;
  };
}
function getCandidates(input, types, isConstructor = false) {
  return getIndex(types)(input, isConstructor);
}
var Union = class extends ASTNodeImpl {
  _tag = "Union";
  types;
  options;
  encodingChecks;
  constructor(types, options, annotations, checks, encoding, context, encodingChecks) {
    super(annotations, checks, encoding, context);
    this.types = types;
    this.options = options;
    this.encodingChecks = encodingChecks;
  }
  getParser(compile, compileField) {
    const ast = this;
    return (input, options) => {
      if (input === missing) {
        return missingExit;
      }
      const candidates = getCandidates(input, ast.types, compileField !== undefined);
      if (candidates.length === 0) {
        return fail5(new AnyOf(ast, [], input, options));
      }
      if (candidates.length === 1) {
        const result = compile(candidates[0])(input, options);
        if (result._tag === "Success")
          return result;
        return effectIsExit(result) ? failSingleUnionCandidate(ast, result.cause, input, options) : catchCause2(result, (cause) => failSingleUnionCandidate(ast, cause, input, options));
      }
      const state = {
        ast,
        compile,
        input,
        out: undefined,
        successes: ast.options?.mode === "oneOf" ? [] : undefined,
        issues: undefined,
        options
      };
      const eff = parseUnion(state, candidates);
      if (!eff) {
        if (state.out)
          return state.out;
        return fail5(new AnyOf(ast, state.issues ?? [], input, options));
      }
      return flatMapEager2(eff, (_) => {
        if (state.out === sameExit)
          return succeed6(input);
        if (state.out)
          return state.out;
        return fail5(new AnyOf(ast, state.issues ?? [], input, options));
      });
    };
  }
  _rebuild(recur, checks, encodingChecks) {
    const types = mapOrSame(this.types, recur);
    return types === this.types && checks === this.checks && encodingChecks === this.encodingChecks ? this : new Union(types, this.options, this.annotations, checks, undefined, this.context, encodingChecks);
  }
  recur(recur) {
    return this._rebuild(recur, this.checks, this.encodingChecks);
  }
  flip(recur) {
    return this._rebuild(recur, this.encodingChecks, this.checks);
  }
  matchPart(s, options) {
    for (const type of this.types) {
      const out = type.matchPart(s, options);
      if (out !== undefined)
        return out;
    }
    return;
  }
  getExpected(getExpected) {
    const expected = this.annotations?.expected;
    if (typeof expected === "string")
      return expected;
    if (this.types.length === 0)
      return "never";
    const types = this.types.map((type) => {
      const encoded = toEncoded(type);
      switch (encoded._tag) {
        case "Arrays": {
          const literals = encoded.elements.filter(isLiteral);
          if (literals.length > 0) {
            return `${formatIsMutable(encoded.isMutable)}[ ${literals.map((e) => getExpected(e) + formatIsOptional(e.context?.isOptional)).join(", ")}, ... ]`;
          }
          break;
        }
        case "Objects": {
          const literals = encoded.propertySignatures.filter((ps) => isLiteral(ps.type));
          if (literals.length > 0) {
            return `{ ${literals.map((ps) => `${formatIsMutable(ps.type.context?.isMutable)}${formatPropertyKey(ps.name)}${formatIsOptional(ps.type.context?.isOptional)}: ${getExpected(ps.type)}`).join(", ")}, ... }`;
          }
          break;
        }
      }
      return getExpected(encoded);
    });
    return Array.from(new Set(types)).join(" | ");
  }
};
function failSingleUnionCandidate(ast, cause, input, options) {
  const issue = getSchemaIssue(cause);
  if (!issue)
    return failCause2(cause);
  return fail4(new AnyOf(ast, [issue], input, options));
}
var parseUnion = /* @__PURE__ */ iterateEager()({
  onItem(s, ast) {
    const parser = s.compile(ast);
    return parser(s.input, s.options);
  },
  step(s, candidate, exit) {
    if (exit._tag === "Failure") {
      const issue = getSchemaIssue(exit.cause);
      if (issue === undefined) {
        return exit;
      }
      if (s.issues)
        s.issues.push(issue);
      else
        s.issues = [issue];
    } else {
      if (s.out && s.successes) {
        s.successes.push(candidate);
        return fail4(new OneOf(s.ast, s.successes, s.input, s.options));
      }
      s.out = exit;
      if (s.successes) {
        s.successes.push(candidate);
      } else {
        return void_2;
      }
    }
  }
});
var nonFiniteLiterals = /* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("Infinity"), /* @__PURE__ */ new Literal("-Infinity"), /* @__PURE__ */ new Literal("NaN")]);
function formatIsMutable(isMutable) {
  return isMutable ? "" : "readonly ";
}
function formatIsOptional(isOptional) {
  return isOptional ? "?" : "";
}
var Filter2 = class extends Class {
  _tag = "Filter";
  run;
  annotations;
  aborted;
  constructor(run, annotations = undefined, aborted = false) {
    super();
    this.run = run;
    this.annotations = annotations;
    this.aborted = aborted;
  }
  annotate(annotations) {
    return new Filter2(this.run, {
      ...this.annotations,
      ...annotations
    }, this.aborted);
  }
  abort() {
    return new Filter2(this.run, this.annotations, true);
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
var FilterGroup = class extends Class {
  _tag = "FilterGroup";
  checks;
  annotations;
  constructor(checks, annotations = undefined) {
    super();
    this.checks = checks;
    this.annotations = annotations;
  }
  annotate(annotations) {
    return new FilterGroup(this.checks, {
      ...this.annotations,
      ...annotations
    });
  }
  and(other, annotations) {
    return new FilterGroup([this, other], annotations);
  }
};
function makeFilter(filter, annotations, aborted = false) {
  return new Filter2((input, ast, options) => normalizeFilterOutput(ast, filter(input, ast, options), input, options), annotations, aborted);
}
function isFinite(annotations) {
  return makeFilter((n) => globalThis.Number.isFinite(n), {
    expected: "a finite number",
    representation: {
      id: "effect/schema/isFinite",
      payload: null
    },
    toJsonSchema: () => ({
      type: "number"
    }),
    toCode: () => ({
      runtime: "Schema.isFinite()"
    }),
    arbitraryConstraint: {
      number: "finite"
    },
    ...annotations
  });
}
var finite = /* @__PURE__ */ appendChecks(number2, [/* @__PURE__ */ isFinite()]);
var numberToJson = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finite, nonFiniteLiterals]), /* @__PURE__ */ new Transformation(/* @__PURE__ */ Number3(), /* @__PURE__ */ transform((n) => globalThis.Number.isFinite(n) ? n : globalThis.String(n))));
function isPattern(regExp, annotations) {
  const source = regExp.source;
  const pattern = new globalThis.RegExp(source, regExp.flags);
  return makeFilter((s) => {
    pattern.lastIndex = 0;
    return pattern.test(s);
  }, {
    expected: `a string matching the RegExp ${source}`,
    representation: {
      id: "effect/schema/isPattern",
      payload: {
        source,
        flags: regExp.flags
      }
    },
    toJsonSchema: () => ({
      pattern: source
    }),
    arbitraryConstraint: {
      patterns: [{
        source: regExp.source,
        flags: regExp.flags
      }]
    },
    ...annotations
  });
}
function modifyOwnPropertyDescriptors(ast, f) {
  const d = Object.getOwnPropertyDescriptors(ast);
  f(d);
  return Object.create(Object.getPrototypeOf(ast), d);
}
var contextOwners = /* @__PURE__ */ new WeakMap;
function getContextOwner(ast) {
  return contextOwners.get(ast) ?? ast;
}
function replaceEncoding(ast, encoding) {
  if (ast.encoding === encoding) {
    return ast;
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.encoding.value = encoding;
  });
}
function replaceContext(ast, context) {
  if (ast.context === context) {
    return ast;
  }
  const owner = getContextOwner(ast);
  if (owner.context === context) {
    return owner;
  }
  const out = modifyOwnPropertyDescriptors(ast, (d) => {
    d.context.value = context;
  });
  contextOwners.set(out, owner);
  return out;
}
function getLastEncoding(ast) {
  return ast.encoding ? getLastEncoding(ast.encoding[ast.encoding.length - 1].to) : ast;
}
function annotate(ast, annotations) {
  if (ast.checks) {
    const last = ast.checks[ast.checks.length - 1];
    return replaceChecks(ast, append(ast.checks.slice(0, -1), last.annotate(annotations)));
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.annotations.value = {
      ...d.annotations.value,
      ...annotations
    };
  });
}
function replaceChecks(ast, checks) {
  if (ast._tag === "Suspend" && checks) {
    throw new Error("Cannot add checks to Suspend");
  }
  if (ast.checks === checks) {
    return ast;
  }
  return modifyOwnPropertyDescriptors(ast, (d) => {
    d.checks.value = checks;
  });
}
function appendChecks(ast, checks) {
  return replaceChecks(ast, combineChecks(ast.checks, checks));
}
function mapLink(link, f) {
  const to = f(link.to);
  return to === link.to ? link : new Link(to, link.transformation);
}
function updateLastLink(encoding, f) {
  const links = encoding;
  const last = links[links.length - 1];
  const out = mapLink(last, f);
  return out === last ? encoding : append(encoding.slice(0, encoding.length - 1), out);
}
function applyToLastLink(f) {
  return (ast) => ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, f)) : ast;
}
function replaceContextLastLink(ast, context) {
  return applyToLastLink((ast) => replaceContext(ast, context))(ast);
}
function applyToSelfOrLastLinkEncoding(f) {
  function out(ast) {
    return ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, out)) : f(ast);
  }
  return memoize(out);
}
function applyToSelfOrLastLinkEncodingIdempotent(f, options) {
  function out(ast) {
    if (ast.encoding) {
      const last = ast.encoding[ast.encoding.length - 1];
      return options?.stopAt?.(last) ? ast : replaceEncoding(ast, updateLastLink(ast.encoding, out));
    }
    return f(ast);
  }
  return memoizeIdempotent(out);
}
function appendTransformation(from, transformation, to) {
  const link = new Link(from, transformation);
  return replaceEncoding(to, to.encoding ? [...to.encoding, link] : [link]);
}
function mapOrSame(as, f) {
  let changed = false;
  const out = new Array(as.length);
  for (let i = 0;i < as.length; i++) {
    const a = as[i];
    const fa = f(a);
    if (fa !== a) {
      changed = true;
    }
    out[i] = fa;
  }
  return changed ? out : as;
}
function annotateKey(ast, annotations) {
  const context = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, ast.context.constructorDefault, {
    ...ast.context.annotations,
    ...annotations
  }) : new Context(false, false, undefined, annotations);
  return replaceContext(ast, context);
}
var optionalKey = /* @__PURE__ */ memoizeIdempotent((ast) => {
  const context = ast.context ? ast.context.isOptional === false ? new Context(true, ast.context.isMutable, ast.context.constructorDefault, ast.context.annotations) : ast.context : new Context(true, false);
  return optionalKeyLastLink(replaceContext(ast, context));
});
var optionalKeyLastLink = /* @__PURE__ */ applyToLastLink(optionalKey);
function withConstructorDefault(ast, defaultValue) {
  const context = ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, defaultValue, ast.context.annotations) : new Context(false, false, defaultValue);
  return replaceContext(ast, context);
}
function decodeTo(from, to, transformation) {
  return appendTransformation(from, transformation, to);
}
function isOptional(ast) {
  return ast.context?.isOptional ?? false;
}
function isStructuralCheck(check) {
  return check.annotations?.[STRUCTURAL_ANNOTATION_KEY] === true || check._tag === "FilterGroup" && check.checks.every(isStructuralCheck);
}
function extractStructuralChecks(checks) {
  function extract(check) {
    if (isStructuralCheck(check))
      return [check];
    return check._tag === "FilterGroup" ? check.checks.flatMap(extract) : [];
  }
  const out = checks.flatMap(extract);
  return isArrayNonEmpty2(out) ? out : undefined;
}
var toType = /* @__PURE__ */ memoizeIdempotent((ast) => {
  if (ast.encoding) {
    return toType(replaceEncoding(ast, undefined));
  }
  const out = ast;
  const type = out.recur?.(toType) ?? out;
  const encodingChecks = type.encodingChecks;
  if (encodingChecks) {
    const checks = type === ast ? encodingChecks : isArrays(type) || isObjects(type) || isDeclaration(type) && type.typeParameters.length > 0 ? extractStructuralChecks(encodingChecks) : undefined;
    return modifyOwnPropertyDescriptors(type, (d) => {
      d.encodingChecks.value = undefined;
      d.checks.value = combineChecks(type.checks, checks);
    });
  }
  return type;
});
var toEncoded = /* @__PURE__ */ memoizeIdempotent((ast) => {
  return toType(flip2(ast));
});
function flipEncoding(ast, encoding) {
  const links = encoding;
  const len = links.length;
  const last = links[len - 1];
  const ls = [new Link(flip2(replaceEncoding(ast, undefined)), links[0].transformation.flip())];
  for (let i = 1;i < len; i++) {
    ls.unshift(new Link(flip2(links[i - 1].to), links[i].transformation.flip()));
  }
  const to = flip2(last.to);
  if (to.encoding) {
    return replaceEncoding(to, [...to.encoding, ...ls]);
  } else {
    return replaceEncoding(to, ls);
  }
}
var flip2 = /* @__PURE__ */ memoize((ast) => {
  if (ast.encoding) {
    return flipEncoding(ast, ast.encoding);
  }
  const out = ast;
  return out.flip?.(flip2) ?? out.recur?.(flip2) ?? out;
});
function containsUndefined(ast) {
  switch (ast._tag) {
    case "Undefined":
      return true;
    case "Union":
      return ast.types.some(containsUndefined);
    default:
      return false;
  }
}
function fromConst(ast, value) {
  const succeed = value === 0 ? sameExit : succeed7(value);
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (input === value)
      return succeed;
    return fail5(new InvalidType(ast, input, options));
  };
}
function fromRefinement(ast, refinement) {
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (refinement(input))
      return sameExit;
    return fail5(new InvalidType(ast, input, options));
  };
}
var parameterFromPropertyKey = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Number":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromPropertyKey);
  }
});
var parameterFromString = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  switch (ast._tag) {
    default:
      return ast;
    case "Symbol":
    case "UniqueSymbol":
      return ast.toCodecStringTree();
    case "Union":
      return ast.recur(parameterFromString);
  }
});
var isStringFiniteRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${FINITE_PATTERN}$`);
var isStringNumberRegExp = /* @__PURE__ */ new globalThis.RegExp(`^(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)$`);
function isStringFinite(annotations) {
  return isPattern(isStringFiniteRegExp, {
    expected: "a string representing a finite number",
    representation: {
      id: "effect/schema/isStringFinite",
      payload: null
    },
    toJsonSchema: () => ({
      pattern: isStringFiniteRegExp.source
    }),
    ...annotations
  });
}
var finiteString = /* @__PURE__ */ appendChecks(string2, [/* @__PURE__ */ isStringFinite()]);
var finiteToString = /* @__PURE__ */ new Link(finiteString, numberFromString);
var numberToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([finiteString, nonFiniteLiterals]), numberFromString);
var BIGINT_PATTERN = "-?\\d+";
var isStringBigIntRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${BIGINT_PATTERN}$`);
var REGEXP_PATTERN = "Symbol\\(([\\s\\S]*)\\)";
var isStringSymbolRegExp = /* @__PURE__ */ new globalThis.RegExp(`^${REGEXP_PATTERN}$`);
function collectIssues(checks, value, issues, ast, options) {
  for (let i = 0;i < checks.length; i++) {
    const check = checks[i];
    if (check._tag === "FilterGroup") {
      issues = collectIssues(check.checks, value, issues, ast, options);
      if (issues && (options.errors !== "all" || issues[issues.length - 1].filter.aborted)) {
        return issues;
      }
    } else {
      const issue = check.run(value, ast, options);
      if (issue) {
        const filter = new Filter(check, issue, value, options);
        if (issues)
          issues.push(filter);
        else
          issues = [filter];
        if (options.errors !== "all" || check.aborted) {
          return issues;
        }
      }
    }
  }
  return issues;
}
function getConstructorDescriptor(ast) {
  if (!isDeclaration(ast))
    return;
  const getDescriptor = ast.annotations?.[CONSTRUCTOR_ANNOTATION_KEY];
  return isFunction(getDescriptor) ? getDescriptor(ast.typeParameters) : undefined;
}
function isJsonLeaf(u) {
  return u === null || typeof u === "string" || typeof u === "boolean" || typeof u === "number" && globalThis.Number.isFinite(u);
}
function isStringTreeLeaf(u) {
  return u === undefined || typeof u === "string";
}
function isTree(u, isLeaf) {
  const cache = new WeakMap;
  const stack = [];
  outer:
    while (true) {
      if (typeof u !== "object" || u === null) {
        if (!isLeaf(u)) {
          return false;
        }
      } else {
        const value = u;
        const cached = cache.get(value);
        if (cached === false) {
          return false;
        }
        if (cached === undefined) {
          const isArray = Array.isArray(value);
          if (!isArray) {
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== null && prototype !== Object.prototype && Object.getPrototypeOf(prototype) !== null) {
              return false;
            }
          }
          cache.set(value, false);
          stack.push({
            value,
            keys: isArray ? value.length : Object.keys(value),
            index: 0
          });
        }
      }
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const keys = frame.keys;
        if (typeof keys === "number") {
          if (frame.index < keys) {
            u = frame.value[frame.index++];
            continue outer;
          }
        } else if (frame.index < keys.length) {
          u = frame.value[keys[frame.index++]];
          continue outer;
        }
        cache.set(frame.value, true);
        stack.pop();
      }
      return true;
    }
}
function isJson(u) {
  return isTree(u, isJsonLeaf);
}
var Json = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isJson(input) ? sameExit : fail5(new InvalidType(ast, input, options)), {
  representation: {
    id: "effect/schema/Json",
    payload: null
  },
  expected: "JSON value",
  toCodecJson: () => {
    return;
  },
  toCodecStringTree: () => unknownToStringTree
});
function isStringTree(u) {
  return isTree(u, isStringTreeLeaf);
}
var StringTree = /* @__PURE__ */ new Declaration([], () => (input, ast, options) => isStringTree(input) ? sameExit : fail5(new InvalidType(ast, input, options)), {
  expected: "StringTree",
  toCodecStringTree: () => {
    return;
  }
});
var unknownToStringTree = /* @__PURE__ */ new Link(StringTree, /* @__PURE__ */ passthrough3());
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/MutableHashMap.js
var TypeId11 = "~effect/MutableHashMap";
var MutableHashMapProto = {
  [TypeId11]: TypeId11,
  [Symbol.iterator]() {
    return this.backing[Symbol.iterator]();
  },
  toString() {
    return `MutableHashMap(${format(Array.from(this))})`;
  },
  toJSON() {
    return {
      _id: "MutableHashMap",
      values: toJson(Array.from(this))
    };
  },
  [NodeInspectSymbol]() {
    return this.toJSON();
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var empty4 = () => {
  const self = Object.create(MutableHashMapProto);
  self.backing = new Map;
  self.buckets = new Map;
  return self;
};
var get2 = /* @__PURE__ */ dual(2, (self, key) => {
  if (self.backing.has(key)) {
    return some2(self.backing.get(key));
  } else if (isSimpleKey(key)) {
    return none2();
  }
  const refKey = referentialKeysCache.get(self);
  if (refKey !== undefined) {
    return self.backing.has(refKey) ? some2(self.backing.get(refKey)) : none2();
  }
  const hash2 = hash(key);
  const bucket = self.buckets.get(hash2);
  if (bucket === undefined) {
    return none2();
  }
  return getFromBucket(self, bucket, key);
});
var referentialKeysCache = /* @__PURE__ */ new WeakMap;
var isSimpleKey = (u) => typeof u !== "object" && typeof u !== "function";
var values = (self) => self.backing.values();
var getFromBucket = (self, bucket, key) => {
  for (let i = 0, len = bucket.length;i < len; i++) {
    if (equals(key, bucket[i])) {
      const refKey = bucket[i];
      referentialKeysCache.set(key, refKey);
      return some2(self.backing.get(refKey));
    }
  }
  return none2();
};
var has2 = /* @__PURE__ */ dual(2, (self, key) => isSome2(get2(self, key)));
var set = /* @__PURE__ */ dual(3, (self, key, value) => {
  if (self.backing.has(key) || isSimpleKey(key)) {
    self.backing.set(key, value);
    return self;
  }
  let refKey = referentialKeysCache.get(self);
  if (refKey !== undefined && self.backing.has(refKey)) {
    self.backing.set(refKey, value);
    return self;
  }
  const hash2 = hash(key);
  const bucket = self.buckets.get(hash2);
  if (bucket === undefined) {
    self.buckets.set(hash2, [key]);
    self.backing.set(key, value);
    return self;
  }
  refKey = getRefKey(bucket, key);
  if (refKey === undefined) {
    bucket.push(key);
    refKey = key;
  }
  self.backing.set(refKey, value);
  return self;
});
var getRefKey = (bucket, key) => {
  for (let i = 0, len = bucket.length;i < len; i++) {
    if (equals(key, bucket[i])) {
      referentialKeysCache.set(key, bucket[i]);
      return bucket[i];
    }
  }
};
var remove = /* @__PURE__ */ dual(2, (self, key_) => {
  if (isSimpleKey(key_)) {
    self.backing.delete(key_);
    return self;
  }
  const key = referentialKeysCache.get(self) ?? key_;
  const hash2 = hash(key);
  const bucket = self.buckets.get(hash2);
  if (bucket === undefined) {
    return self;
  }
  for (let i = 0, len = bucket.length;i < len; i++) {
    const bkey = bucket[i];
    if (bkey === key || equals(key, bkey)) {
      self.backing.delete(bkey);
      bucket.splice(i, 1);
      break;
    }
  }
  if (bucket.length === 0) {
    self.buckets.delete(hash2);
  }
  return self;
});
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Fiber.js
var await_ = fiberAwait;
var interruptAs = fiberInterruptAs;
var interruptAll = fiberInterruptAll;
var runIn = fiberRunIn;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Semaphore.js
var waitForPermits = (self, n, effect) => callback((resume) => {
  if (self.free >= n)
    return resume(effect);
  const observer = () => {
    if (self.free < n)
      return;
    self.waiters.delete(observer);
    resume(effect);
  };
  self.waiters.add(observer);
  return sync(() => {
    self.waiters.delete(observer);
  });
});

class SemaphoreImpl {
  waiters = /* @__PURE__ */ new Set;
  taken = 0;
  permits;
  constructor(permits) {
    this.permits = permits;
  }
  get free() {
    return this.permits - this.taken;
  }
  take(n) {
    const take = suspend(() => {
      if (this.free < n) {
        return waitForPermits(this, n, take);
      }
      this.taken += n;
      return succeed3(n);
    });
    return take;
  }
  takeIfAvailable(n) {
    return suspend(() => {
      if (this.free < n)
        return succeed3(false);
      this.taken += n;
      return succeed3(true);
    });
  }
  releaseUnsafe(fiber, n) {
    this.taken -= n;
    if (this.waiters.size > 0) {
      fiber.currentDispatcher.scheduleTask(() => {
        for (const observer of this.waiters) {
          if (this.free <= 0)
            break;
          observer();
        }
      }, 0);
    }
    return this.free;
  }
  resize(permits) {
    return withFiber((fiber) => {
      this.permits = permits;
      if (this.free < 0)
        return void_;
      this.releaseUnsafe(fiber, 0);
      return void_;
    });
  }
  release(n) {
    return withFiber((fiber) => succeed3(this.releaseUnsafe(fiber, n)));
  }
  get releaseAll() {
    return withFiber((fiber) => succeed3(this.releaseUnsafe(fiber, this.taken)));
  }
  withPermits(n) {
    return (self) => uninterruptibleMask((restore) => {
      const acquire = suspend(() => {
        if (this.free < n) {
          const wait = waitForPermits(this, n, void_);
          return flatMap(restore(wait), () => acquire);
        }
        this.taken += n;
        return onExitPrimitive(restore(self), () => {
          this.releaseUnsafe(getCurrentFiber(), n);
          return;
        }, true);
      });
      return acquire;
    });
  }
  withPermit = /* @__PURE__ */ this.withPermits(1);
  withPermitsIfAvailable(n) {
    return (self) => uninterruptibleMask((restore) => {
      if (this.free < n)
        return succeedNone;
      this.taken += n;
      return onExitPrimitive(restore(asSome(self)), () => {
        this.releaseUnsafe(getCurrentFiber(), n);
        return;
      }, true);
    });
  }
}
var make6 = (permits) => sync(() => new SemaphoreImpl(permits));

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Channel.js
var TypeId12 = "~effect/Channel";
var ChannelProto = {
  [TypeId12]: {
    _Env: identity,
    _InErr: identity,
    _InElem: identity,
    _OutErr: identity,
    _OutElem: identity
  },
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromTransform = (transform) => {
  const self = Object.create(ChannelProto);
  self.transform = (upstream, scope) => catchCause2(transform(upstream, scope), (cause) => succeed6(failCause3(cause)));
  return self;
};
var transformPull = (self, f) => fromTransform((upstream, scope) => flatMap3(toTransform(self)(upstream, scope), (pull) => f(pull, scope)));
var toTransform = (channel) => channel.transform;
var fromAsyncIterable = (iterable, onError) => fromTransform(fnUntraced2(function* (_, scope) {
  const iter = iterable[Symbol.asyncIterator]();
  if (iter.return) {
    yield* addFinalizer(scope, promise2(() => iter.return()));
  }
  return flatMap3(tryPromise2({
    try: () => iter.next(),
    catch: onError
  }), (result) => result.done ? done2(result.value) : succeed6(result.value));
}));
var fromAsyncIterableArray = (iterable, onError) => map7(fromAsyncIterable(iterable, onError), of);
var map7 = /* @__PURE__ */ dual(2, (self, f) => transformPull(self, (pull) => sync3(() => {
  let i = 0;
  return map6(pull, (o) => f(o, i++));
})));
var filterArray = /* @__PURE__ */ dual(2, (self, predicate) => transformPull(self, (pull) => succeed6(flatMap3(pull, function loop(arr) {
  const passes = [];
  for (let i = 0;i < arr.length; i++) {
    if (predicate(arr[i])) {
      passes.push(arr[i]);
    }
  }
  return isReadonlyArrayNonEmpty(passes) ? succeed6(passes) : flatMap3(pull, loop);
}))));
var runWith = (self, f, onHalt) => suspend2(() => {
  const scope = makeUnsafe3();
  const makePull = toTransform(self)(done2(), scope);
  return catchDone(flatMap3(makePull, f), onHalt ? onHalt : succeed6).pipe(onExit2((exit) => close(scope, exit)));
});
var runForEach = /* @__PURE__ */ dual(2, (self, f) => runWith(self, (pull) => forever3(flatMap3(pull, f), {
  disableYield: true
})));
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schema/interpreter.js
var flatMapTransformation = (result, current, f) => result === sameExit ? f(current) : flatMapEager2(result, f);
function compileTransformation(transformation) {
  if (transformation._tag === "Middleware") {
    return (result, current, options) => {
      const transformed = result === sameExit ? transformation.decode(succeed7(toOption(current)), options) : transformation.decode(mapEager2(result, toOption), options);
      return fromOptionalEffect(transformed);
    };
  }
  const getter = transformation.decode;
  switch (getter._tag) {
    case "Passthrough":
      return (result, current) => result === sameExit ? succeed7(current) : result;
    case "Transform": {
      const transform = (value) => value === missing ? missingExit : succeed7(getter.transform(value));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformOptional": {
      const transform = (value) => fromOptionExit(getter.transform(toOption(value)));
      return (result, current) => flatMapTransformation(result, current, transform);
    }
    case "TransformEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => value === missing ? missingExit : getter.transform(value, options));
    case "TransformOptionalEffect":
      return (result, current, options) => flatMapTransformation(result, current, (value) => fromOptionalEffect(getter.transform(toOption(value), options)));
  }
}
var fromOptionalEffect = (effect) => flatMapEager2(effect, fromOptionExit);
var wrapEncoding = (ast, input, options, effect) => catchCause2(effect, (cause) => failCauseSync2(() => map5(cause, (issue) => new Encoding(ast, issue, input, options))));
function makeConstructorParser(descriptor, compile) {
  const transform = compileTransformation(descriptor.link.transformation);
  let sourceParser;
  return (input, options) => {
    if (input === missing)
      return missingExit;
    if (descriptor.isConstructed(input))
      return sameExit;
    const result = (sourceParser ??= compile(descriptor.link.to))(input, options);
    return transform(result, input, options);
  };
}
function withDefault(ast, parser) {
  const defaultValue = ast.context.constructorDefault;
  return (input, options) => {
    if (input !== missing && input !== undefined)
      return parser(input, options);
    const result = defaultValue;
    if (effectIsExit(result) && result._tag === "Success") {
      const local = parser(result[args], options);
      return local === sameExit ? result : local;
    }
    return flatMapEager2(wrapEncoding(ast, input, options, result), (value) => {
      const local = parser(value, options);
      return local === sameExit ? succeed7(value) : local;
    });
  };
}
function compileField(ast, compile) {
  const parser = compile(ast);
  return ast.context?.constructorDefault === undefined ? parser : withDefault(ast, parser);
}
function compile(ast, compile, compileField, base, specialize) {
  if (ast._tag === "Declaration") {
    for (const parameter of ast.typeParameters)
      compile(parameter);
  }
  const descriptor = compileField ? getConstructorDescriptor(ast) : undefined;
  const parser = descriptor ? makeConstructorParser(descriptor, compile) : base ?? ast.getParser(compile, compileField);
  const checks = ast.checks;
  const links = ast.encoding;
  const transformations = links?.map((link) => compileTransformation(link.transformation));
  const encodingChecks = ast.encodingChecks;
  if (!links && !checks && !encodingChecks) {
    return parser;
  }
  let encodingParsers;
  const parseChecks = (input, options) => {
    let result = parser(input, options);
    if (encodingChecks && !options.disableChecks) {
      if (effectIsExit(result)) {
        if (result._tag === "Success") {
          const output = result === sameExit ? input : result[args];
          if (input !== missing && output !== missing) {
            const issues = collectIssues(encodingChecks, input, undefined, ast, options);
            if (issues) {
              result = fail5(new Composite(ast, issues, input, options));
            }
          }
        }
      } else {
        result = flatMap3(result, (value) => {
          if (input !== missing && value !== missing) {
            const issues = collectIssues(encodingChecks, input, undefined, ast, options);
            if (issues) {
              return fail5(new Composite(ast, issues, input, options));
            }
          }
          return succeed6(value);
        });
      }
    }
    if (checks && !options.disableChecks) {
      if (effectIsExit(result)) {
        if (result._tag === "Success") {
          const value = result === sameExit ? input : result[args];
          if (value === missing)
            return result;
          const issues = collectIssues(checks, value, undefined, ast, options);
          if (issues) {
            result = fail5(new Composite(ast, issues, value, options));
          }
        }
      } else {
        result = flatMap3(result, (value) => {
          if (value !== missing) {
            const issues = collectIssues(checks, value, undefined, ast, options);
            if (issues) {
              return fail5(new Composite(ast, issues, value, options));
            }
          }
          return succeed6(value);
        });
      }
    }
    return result;
  };
  const parseLocal = specialize === undefined ? parseChecks : specialize(parseChecks);
  if (!links) {
    return parseLocal;
  }
  return (input, options) => {
    const parsers = encodingParsers ??= links.map((link) => compile(link.to));
    let current = input;
    let result = parsers[parsers.length - 1](input, options);
    for (let i = links.length - 1;i >= 0; i--) {
      result = transformations[i](result, current, options);
      if (i !== 0) {
        const next = parsers[i - 1];
        if (result._tag === "Success") {
          current = result[args];
          result = next(current, options);
        } else {
          result = flatMapEager2(result, (value) => {
            const nextResult = next(value, options);
            return nextResult === sameExit ? succeed7(value) : nextResult;
          });
        }
      }
    }
    if (result._tag === "Success") {
      const value = result[args];
      const local = parseLocal(value, options);
      return local === sameExit ? result : local;
    }
    result = wrapEncoding(ast, input, options, result);
    return flatMapEager2(result, (value) => {
      const local = parseLocal(value, options);
      return local === sameExit ? succeed7(value) : local;
    });
  };
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schema/compilerRegistry.js
var invalid2 = /* @__PURE__ */ Symbol();
var cache = /* @__PURE__ */ new WeakMap;
var compiler;
var compilerAdaptersEnabled = false;
var decodeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve2, ast, "parser") : resolve2(ast).parser;
var makeChild = (ast) => compilerAdaptersEnabled ? lazyParser(resolve2, ast, "makeEffect") : resolve2(ast).makeEffect;
var makeField = (ast) => compileField(ast, makeChild);

class InterpretedEntry {
  ast;
  constructor(ast) {
    this.ast = ast;
  }
  get decodeEffect() {
    return this.cachedDecodeEffect ??= compile(this.ast, decodeChild);
  }
  get parser() {
    return this.decodeEffect;
  }
  get makeEffect() {
    return this.cachedMakeEffect ??= compile(this.ast, makeChild, makeField);
  }
}

class CompilerEntry extends InterpretedEntry {
  compiled;
  resolve;
  constructor(ast, compiled, resolve) {
    super(ast);
    this.compiled = compiled;
    this.resolve = resolve;
  }
  save(key, value) {
    Object.defineProperty(this, key, {
      value
    });
    return value;
  }
  operation(key) {
    const compiled = this.compiled;
    return typeof compiled === "function" ? compiled(this.ast, this.resolve, key) : compiled?.[key];
  }
  get is() {
    return this.save("is", this.operation("is"));
  }
  get decode() {
    return this.save("decode", this.operation("decode"));
  }
  get make() {
    return this.save("make", this.operation("make"));
  }
  get decodeEffect() {
    return this.save("decodeEffect", this.operation("decodeEffect") ?? compile(this.ast, (ast) => lazyParser(this.resolve, ast, "parser")));
  }
  get parser() {
    const decode = this.decode;
    return decode === undefined ? this.decodeEffect : this.save("parser", withDecode(decode, () => this.decodeEffect));
  }
  get makeEffect() {
    const makeEffect = this.operation("makeEffect");
    if (makeEffect !== undefined)
      return this.save("makeEffect", makeEffect);
    const child = (ast) => lazyParser(this.resolve, ast, "makeEffect");
    return this.save("makeEffect", compile(this.ast, child, (ast) => compileField(ast, child)));
  }
}
function withDecode(fastDecode, decodeEffect) {
  let detailed;
  return (input, options) => {
    if (input !== missing) {
      try {
        const value = fastDecode(input, options);
        if (value !== invalid2)
          return value === input ? sameExit : succeed7(value);
      } catch (error) {
        return die3(error);
      }
    }
    return (detailed ??= decodeEffect())(input, options);
  };
}
function lazyParser(resolve, ast, operation) {
  const entry = resolve(ast);
  if (entry.compiled === undefined || Object.hasOwn(entry, operation)) {
    return entry[operation];
  }
  let parser;
  return (input, options) => (parser ??= entry[operation])(input, options);
}
function resolve2(ast) {
  const cached = cache.get(ast);
  if (cached !== undefined)
    return cached;
  const entry = compiler === undefined ? new InterpretedEntry(ast) : new CompilerEntry(ast, compiler(ast, resolve2), resolve2);
  cache.set(ast, entry);
  return entry;
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/SchemaParser.js
function makeEffect(schema) {
  const ast = schema.ast;
  let parser;
  return (input, options) => {
    return (parser ??= runWithCompiler(constructorCompiler, toType(ast)))(input, options?.disableChecks ? options?.parseOptions ? {
      ...options.parseOptions,
      disableChecks: true
    } : {
      disableChecks: true
    } : options?.parseOptions);
  };
}
function makeOption(schema) {
  const parser = makeEffect(schema);
  return (input, options) => {
    const exit = runSyncExit2(parser(input, options));
    if (isSuccess3(exit)) {
      return some2(exit.value);
    }
    getSchemaIssueOrThrow(exit.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function make7(schema) {
  return makeConstructorSync(toType(schema.ast));
}
function is(schema) {
  return _is(schema.ast);
}
function makeIs(ast) {
  if (!compilerAdaptersEnabled) {
    const parser = asExit(run(ast));
    return (input) => {
      const exit = parser(input, defaultParseOptions);
      if (isSuccess3(exit))
        return true;
      getSchemaIssueOrThrow(exit.cause, "Type guard adapter can only return false for schema issues");
      return false;
    };
  }
  const entry = resolve2(ast);
  const guard = entry.is;
  if (guard !== undefined) {
    return (input) => {
      try {
        return guard(input, defaultParseOptions);
      } catch (error) {
        getSchemaIssueOrThrow(die2(error), "Type guard adapter can only return false for schema issues");
        return false;
      }
    };
  }
  const parser = entry.parser;
  return (input) => {
    const exit = runSyncExit2(parserResult(parser(input, defaultParseOptions), input));
    if (isSuccess3(exit))
      return true;
    getSchemaIssueOrThrow(exit.cause, "Type guard adapter can only return false for schema issues");
    return false;
  };
}
function _is(ast) {
  const typeAST = toType(ast);
  let guard = (input) => {
    guard = makeIs(typeAST);
    return guard(input);
  };
  return (input) => {
    return guard(input);
  };
}
function decodeUnknownEffect(schema, options) {
  const parser = run(schema.ast);
  return options === undefined ? parser : (input, overrideOptions) => parser(input, mergeParseOptions(options, overrideOptions));
}
function decodeUnknownExit(schema, options) {
  return asExit(decodeUnknownEffect(schema, options));
}
function decodeUnknownOption(schema, options) {
  return asOption(decodeUnknownEffect(schema, options));
}
function decodeUnknownResult(schema, options) {
  return asResult(decodeUnknownEffect(schema, options));
}
var mergeParseOptions = (options, overrideOptions) => overrideOptions ? {
  ...options,
  ...overrideOptions
} : options;
var getValue = (value) => {
  if (value === missing) {
    return fail5(new InvalidValue);
  }
  return succeed6(value);
};
function run(ast) {
  return runWithCompiler(normalCompiler, ast);
}
function parserResult(result, input) {
  if (result === sameExit) {
    return succeed6(input);
  }
  if (!effectIsExit(result)) {
    return flatMapEager2(result, getValue);
  }
  return result[args] === missing ? getValue(missing) : result;
}
function runWithCompiler(compiler, ast) {
  let parser;
  return (input, options) => {
    const result = (parser ??= compiler(ast))(input, options ?? defaultParseOptions);
    if (result === sameExit) {
      return succeed6(input);
    }
    if (!effectIsExit(result)) {
      return flatMapEager2(result, getValue);
    }
    return result[args] === missing ? getValue(missing) : result;
  };
}
function asExit(parser) {
  return (input, options) => runSyncExit2(parser(input, options));
}
function asOption(parser) {
  const parserExit = asExit(parser);
  return (input, options) => {
    const exit = parserExit(input, options);
    if (isSuccess3(exit)) {
      return some2(exit.value);
    }
    getSchemaIssueOrThrow(exit.cause, "Option adapter can only return none for schema issues");
    return none2();
  };
}
function asResult(parser) {
  const parserExit = asExit(parser);
  return (input, options) => {
    const exit = parserExit(input, options);
    if (isSuccess3(exit)) {
      return succeed2(exit.value);
    }
    return fail2(getSchemaIssueOrThrow(exit.cause, "Result adapter can only return schema issues"));
  };
}
function runSync3(effect, message) {
  const exit = runSyncExit2(effect);
  if (isSuccess3(exit)) {
    return exit.value;
  }
  const issue = getSchemaIssueOrThrow(exit.cause, message);
  throw new Error("Schema validation failed", {
    cause: issue
  });
}
function makeConstructorSync(ast) {
  let entry;
  let parser;
  return (input, options) => {
    entry ??= resolve2(ast);
    const parseOptions = options?.disableChecks ? options.parseOptions ? {
      ...options.parseOptions,
      disableChecks: true
    } : {
      disableChecks: true
    } : options?.parseOptions ?? defaultParseOptions;
    const make = entry.make;
    if (make !== undefined && input !== missing) {
      let output;
      try {
        output = make(input, parseOptions);
      } catch (error) {
        getSchemaIssueOrThrow(die2(error), "Constructor adapter can only throw schema issues");
        throw error;
      }
      if (output !== invalid2 && output !== missing)
        return output;
    }
    const result = (parser ??= entry.makeEffect)(input, parseOptions);
    return runSync3(parserResult(result, input), "Constructor adapter can only throw schema issues");
  };
}
var normalCompiler = (ast) => resolve2(ast).parser;
var constructorCompiler = (ast) => resolve2(ast).makeEffect;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schema/make.js
var TypeId13 = "~effect/Schema/Schema";
var SchemaProto = {
  [TypeId13]: TypeId13,
  pipe() {
    return pipeArguments(this, arguments);
  },
  annotate(annotations) {
    return this.rebuild(annotate(this.ast, annotations));
  },
  annotateKey(annotations) {
    return this.rebuild(annotateKey(this.ast, annotations));
  },
  check(...checks) {
    return this.rebuild(appendChecks(this.ast, checks));
  }
};
function make8(ast, options) {
  function Schema() {}
  const self = Object.setPrototypeOf(Schema, SchemaProto);
  if (options && (Object.hasOwn(options, "name") || Object.hasOwn(options, "length") || Object.hasOwn(options, "__proto__"))) {
    Object.defineProperties(self, Object.getOwnPropertyDescriptors({
      ...options
    }));
  } else {
    Object.assign(self, options);
  }
  self.ast = ast;
  self.rebuild = (ast) => make8(ast, options);
  self.makeEffect = makeEffect(self);
  self.make = make7(self);
  self.makeOption = makeOption(self);
  return self;
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schema/toCodec.js
function withoutConstructorDefault(context) {
  return context.constructorDefault === undefined ? context : new Context(context.isOptional, context.isMutable, undefined, context.annotations);
}
function validateCanonicalObjectPropertyNames(ast) {
  if (ast.propertySignatures.some((ps) => typeof ps.name !== "string")) {
    throw new globalThis.Error("Objects property names must be strings", {
      cause: ast
    });
  }
}
function makeReorder(getPriority) {
  return (types) => {
    const indexMap = new Map;
    for (let i = 0;i < types.length; i++) {
      indexMap.set(toEncoded(types[i]), i);
    }
    const sortedTypes = [...types].sort((a, b) => {
      a = toEncoded(a);
      b = toEncoded(b);
      const pa = getPriority(a);
      const pb = getPriority(b);
      if (pa !== pb)
        return pa - pb;
      return indexMap.get(a) - indexMap.get(b);
    });
    const orderChanged = sortedTypes.some((ast, index) => ast !== types[index]);
    if (!orderChanged)
      return types;
    return sortedTypes;
  };
}
function toCodecStringTree(schema) {
  return make8(toCodecStringTreeAST(schema.ast), {
    schema
  });
}
var toStringTreeReorder = /* @__PURE__ */ makeReorder((ast) => {
  switch (ast._tag) {
    case "Null":
    case "Boolean":
    case "Number":
    case "BigInt":
    case "Symbol":
    case "UniqueSymbol":
      return 0;
    default:
      return 1;
  }
});
function toCodecStringTreeASTStep(ast, recur, onMissingAnnotation) {
  switch (ast._tag) {
    case "Declaration": {
      const typeParameters = ast.typeParameters.map((tp) => make8(recur(toEncoded(tp))));
      const getStringTreeLink = ast.annotations?.toCodecStringTree;
      if (isFunction(getStringTreeLink)) {
        const link = getStringTreeLink(typeParameters);
        if (link === undefined)
          return ast;
        return replaceEncoding(ast, [mapLink(link, recur)]);
      }
      const getJsonLink = ast.annotations?.toCodecJson;
      const jsonLink = isFunction(getJsonLink) ? getJsonLink(typeParameters) : undefined;
      const getLink = jsonLink === undefined ? ast.annotations?.toCodec : undefined;
      const link = jsonLink ?? (isFunction(getLink) ? getLink(typeParameters) : undefined);
      return link === undefined ? onMissingAnnotation(ast) : replaceEncoding(ast, [mapLink(link, recur)]);
    }
    case "Null":
      return replaceEncoding(ast, [nullToString]);
    case "Boolean":
      return replaceEncoding(ast, [booleanToString]);
    case "Unknown":
    case "ObjectKeyword":
      return replaceEncoding(ast, [unknownToStringTree]);
    case "Enum":
    case "Number":
    case "Literal":
    case "UniqueSymbol":
    case "Symbol":
    case "BigInt":
      return ast.toCodecStringTree();
    case "Objects": {
      validateCanonicalObjectPropertyNames(ast);
      return ast.recur(recur, parameterFromString);
    }
    case "Union": {
      const sortedTypes = toStringTreeReorder(ast.types);
      if (sortedTypes !== ast.types) {
        return new Union(sortedTypes, ast.options, ast.annotations, ast.checks, ast.encoding, ast.context, ast.encodingChecks).recur(recur);
      }
      return ast.recur(recur);
    }
    case "Arrays":
    case "Suspend":
      return ast.recur(recur);
  }
  return ast;
}
var nullToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Literal("null"), /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform(() => null), /* @__PURE__ */ transform(() => "null")));
var booleanToString = /* @__PURE__ */ new Link(/* @__PURE__ */ new Union([/* @__PURE__ */ new Literal("true"), /* @__PURE__ */ new Literal("false")]), /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform((s) => s === "true"), /* @__PURE__ */ String2()));
var arrayFromSingleTransformation = /* @__PURE__ */ new Transformation(/* @__PURE__ */ transform((input) => typeof input === "string" ? [input] : input), /* @__PURE__ */ passthrough2());
var isCodecArrayFromSingleLink = (link) => link.transformation === arrayFromSingleTransformation;
var toCodecStringTreeAST = /* @__PURE__ */ applyToSelfOrLastLinkEncodingIdempotent((ast) => {
  const out = toCodecStringTreeASTStep(ast, toCodecStringTreeAST, (ast) => {
    throw new globalThis.Error("Missing structural codec for StringTree", {
      cause: ast
    });
  });
  if (out !== ast && ast.context !== undefined) {
    return replaceContextLastLink(out, withoutConstructorDefault(ast.context));
  }
  return out;
}, {
  stopAt: isCodecArrayFromSingleLink
});

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Struct.js
var lambda = (f) => f;

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/schemaError.js
var SchemaErrorTypeId = "~effect/Schema/SchemaError";

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Schema.js
var TypeId14 = TypeId13;
function declareConstructor() {
  return (typeParameters, run, annotations) => {
    return make9(new Declaration(typeParameters.map(getAST), (typeParameters) => run(typeParameters.map((ast) => make9(ast))), annotations));
  };
}
function declare(is, annotations) {
  return declareConstructor()([], () => (input, ast, options) => is(input) ? succeed6(input) : fail5(new InvalidType(ast, input, options)), annotations);
}
class SchemaError extends (/* @__PURE__ */ TaggedError2("SchemaError")) {
  [SchemaErrorTypeId] = SchemaErrorTypeId;
  constructor(issue) {
    const stackTraceLimit = getStackTraceLimit();
    setStackTraceLimit(0);
    try {
      super({
        issue
      });
    } finally {
      setStackTraceLimit(stackTraceLimit);
    }
  }
  get message() {
    return defaultFormatter(this.issue);
  }
  toString() {
    return `SchemaError(${this.message})`;
  }
}
function fromIssueEffect(self) {
  if (effectIsExit(self)) {
    return fromIssueExit(self);
  }
  return catchCause2(self, (cause) => failCauseSync2(() => map5(cause, (issue) => new SchemaError(issue))));
}
function fromIssueExit(exit) {
  return isSuccess3(exit) ? exit : failCause2(map5(exit.cause, (issue) => new SchemaError(issue)));
}
var is2 = is;
function decodeUnknownEffect2(schema, options) {
  const parser = decodeUnknownEffect(schema, options);
  return (input, options) => {
    return fromIssueEffect(parser(input, options));
  };
}
function decodeUnknownExit2(schema, options) {
  const parser = decodeUnknownExit(schema, options);
  return (input, options) => {
    return fromIssueExit(parser(input, options));
  };
}
var decodeUnknownOption2 = decodeUnknownOption;
function decodeUnknownResult2(schema, options) {
  const parser = decodeUnknownResult(schema, options);
  return (input, options) => {
    return mapError(parser(input, options), (issue) => new SchemaError(issue));
  };
}
var make9 = make8;
function isSchema(u) {
  return hasProperty(u, TypeId14) && u[TypeId14] === TypeId14;
}
var optionalKey2 = /* @__PURE__ */ lambda((schema) => make9(optionalKey(schema.ast), {
  schema
}));
function Literal2(literal) {
  const out = make9(new Literal(literal), {
    literal,
    transform(to) {
      return out.pipe(decodeTo2(Literal2(to), {
        decode: transform(() => to),
        encode: transform(() => literal)
      }));
    }
  });
  return out;
}
var Unknown2 = /* @__PURE__ */ make9(unknown);
var Null2 = /* @__PURE__ */ make9(null_);
var String4 = /* @__PURE__ */ make9(string2);
var Number5 = /* @__PURE__ */ make9(number2);
var Boolean3 = /* @__PURE__ */ make9(boolean);
function makeStruct(ast, fields) {
  return make9(ast, {
    fields,
    mapFields(f, options) {
      const fields = f(this.fields);
      return makeStruct(struct(fields, options?.unsafePreserveChecks ? this.ast.checks : undefined), fields);
    }
  });
}
function Struct(fields) {
  return makeStruct(struct(fields, undefined), fields);
}
function makeTuple(ast, elements) {
  return make9(ast, {
    elements,
    mapElements(f, options) {
      const elements = f(this.elements);
      return makeTuple(tuple(elements, options?.unsafePreserveChecks ? this.ast.checks : undefined), elements);
    }
  });
}
function Tuple(elements) {
  return makeTuple(tuple(elements), elements);
}
var ArraySchema = /* @__PURE__ */ lambda((schema) => make9(new Arrays(false, [], [schema.ast]), {
  value: schema
}));
function makeUnion(ast, members) {
  return make9(ast, {
    members,
    mapMembers(f, options) {
      const members = f(this.members);
      return makeUnion(union(members, this.ast.options, options?.unsafePreserveChecks ? this.ast.checks : undefined), members);
    }
  });
}
function Union2(members, options) {
  return makeUnion(union(members, options, undefined), members);
}
function Literals(literals) {
  const members = literals.map(Literal2);
  return make9(union(members, undefined, undefined), {
    literals,
    members,
    mapMembers(f) {
      return Union2(f(this.members));
    },
    pick(literals) {
      return Literals(literals);
    },
    transform(to) {
      return Union2(members.map((member, index) => member.transform(to[index])));
    }
  });
}
var NullOr = /* @__PURE__ */ lambda((self) => Union2([self, Null2]));
function decodeTo2(to, transformation) {
  return (from) => {
    return make9(decodeTo(from.ast, to.ast, transformation ? makeTransformation(transformation) : passthrough3()), {
      from,
      to
    });
  };
}
function withConstructorDefault2(defaultValue) {
  return (schema) => make9(withConstructorDefault(schema.ast, defaultValue), {
    schema
  });
}
function tag(literal) {
  return Literal2(literal).pipe(withConstructorDefault2(succeed6(literal)));
}
function TaggedStruct(value, fields) {
  return Struct({
    _tag: tag(value),
    ...fields
  });
}
function instanceOf(constructor, annotations) {
  return declare((u) => u instanceof constructor, annotations);
}
function link() {
  return (encodeTo, transformation) => {
    return new Link(encodeTo.ast, makeTransformation(transformation));
  };
}
var makeFilter2 = makeFilter;
function isPattern2(regExp, annotations) {
  const source = regExp.source;
  const flags = regExp.flags;
  const runtimeRegExp = flags === "" ? `new RegExp(${format(source)})` : `new RegExp(${format(source)}, ${format(flags)})`;
  return isPattern(regExp, {
    toCode: () => ({
      runtime: `Schema.isPattern(${runtimeRegExp})`
    }),
    ...annotations
  });
}
function isBase64(annotations) {
  const regExp = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
  return isPattern2(regExp, {
    expected: "a base64 encoded string",
    representation: {
      id: "effect/schema/isBase64",
      payload: null
    },
    toJsonSchema: () => ({
      pattern: regExp.source
    }),
    toCode: () => ({
      runtime: "Schema.isBase64()"
    }),
    ...annotations
  });
}
function makeIsGreaterThan(options) {
  const gt = isGreaterThan(options.order);
  const formatter = options.formatter ?? format;
  return (exclusiveMinimum, annotations) => {
    return makeFilter2((input) => gt(input, exclusiveMinimum), {
      expected: `a value greater than ${formatter(exclusiveMinimum)}`,
      arbitraryConstraint: {
        order: options.order,
        minimum: exclusiveMinimum,
        exclusiveMinimum: true
      },
      ...options.annotate?.(exclusiveMinimum),
      ...annotations
    });
  };
}
function makeIsGreaterThanOrEqualTo(options) {
  const gte = isGreaterThanOrEqualTo(options.order);
  const formatter = options.formatter ?? format;
  return (minimum, annotations) => {
    return makeFilter2((input) => gte(input, minimum), {
      expected: `a value greater than or equal to ${formatter(minimum)}`,
      arbitraryConstraint: {
        order: options.order,
        minimum
      },
      ...options.annotate?.(minimum),
      ...annotations
    });
  };
}
function makeIsBetween(deriveOptions) {
  const greaterThanOrEqualTo = isGreaterThanOrEqualTo(deriveOptions.order);
  const greaterThan = isGreaterThan(deriveOptions.order);
  const lessThanOrEqualTo = isLessThanOrEqualTo(deriveOptions.order);
  const lessThan = isLessThan(deriveOptions.order);
  const formatter = deriveOptions.formatter ?? format;
  return (options, annotations) => {
    const gte = options.exclusiveMinimum ? greaterThan : greaterThanOrEqualTo;
    const lte = options.exclusiveMaximum ? lessThan : lessThanOrEqualTo;
    return makeFilter2((input) => gte(input, options.minimum) && lte(input, options.maximum), {
      expected: `a value between ${formatter(options.minimum)}${options.exclusiveMinimum ? " (excluded)" : ""} and ${formatter(options.maximum)}${options.exclusiveMaximum ? " (excluded)" : ""}`,
      arbitraryConstraint: {
        order: deriveOptions.order,
        minimum: options.minimum,
        maximum: options.maximum,
        ...options.exclusiveMinimum && {
          exclusiveMinimum: true
        },
        ...options.exclusiveMaximum && {
          exclusiveMaximum: true
        }
      },
      ...deriveOptions.annotate?.(options),
      ...annotations
    });
  };
}
function encodeNumberPayload(number) {
  if (!globalThis.Number.isFinite(number)) {
    throw new globalThis.RangeError(`Expected a finite number, got ${format(number)}`);
  }
  return number;
}
var isGreaterThan2 = /* @__PURE__ */ makeIsGreaterThan({
  order: Number2,
  annotate: (exclusiveMinimum) => ({
    representation: {
      id: "effect/schema/isGreaterThan",
      payload: {
        exclusiveMinimum: encodeNumberPayload(exclusiveMinimum)
      }
    },
    toJsonSchema: () => ({
      exclusiveMinimum
    }),
    toCode: () => ({
      runtime: `Schema.isGreaterThan(${format(exclusiveMinimum)})`
    })
  })
});
var isGreaterThanOrEqualTo2 = /* @__PURE__ */ makeIsGreaterThanOrEqualTo({
  order: Number2,
  annotate: (minimum) => ({
    representation: {
      id: "effect/schema/isGreaterThanOrEqualTo",
      payload: {
        minimum: encodeNumberPayload(minimum)
      }
    },
    toJsonSchema: () => ({
      minimum
    }),
    toCode: () => ({
      runtime: `Schema.isGreaterThanOrEqualTo(${format(minimum)})`
    })
  })
});
var isBetween = /* @__PURE__ */ makeIsBetween({
  order: Number2,
  annotate: (options) => {
    const exclusiveMinimum = options.exclusiveMinimum ? true : undefined;
    const exclusiveMaximum = options.exclusiveMaximum ? true : undefined;
    const payload = {
      minimum: encodeNumberPayload(options.minimum),
      maximum: encodeNumberPayload(options.maximum),
      ...exclusiveMinimum && {
        exclusiveMinimum
      },
      ...exclusiveMaximum && {
        exclusiveMaximum
      }
    };
    return {
      representation: {
        id: "effect/schema/isBetween",
        payload
      },
      toJsonSchema: () => ({
        [exclusiveMinimum ? "exclusiveMinimum" : "minimum"]: options.minimum,
        [exclusiveMaximum ? "exclusiveMaximum" : "maximum"]: options.maximum
      }),
      toCode: () => ({
        runtime: `Schema.isBetween({ minimum: ${format(options.minimum)}, maximum: ${format(options.maximum)}, exclusiveMinimum: ${format(exclusiveMinimum)}, exclusiveMaximum: ${format(exclusiveMaximum)} })`
      })
    };
  }
});
function isInt(annotations) {
  return makeFilter2((n) => globalThis.Number.isSafeInteger(n), {
    expected: "an integer",
    representation: {
      id: "effect/schema/isInt",
      payload: null
    },
    toJsonSchema: () => ({
      type: "integer"
    }),
    toCode: () => ({
      runtime: "Schema.isInt()"
    }),
    arbitraryConstraint: {
      number: "integer"
    },
    ...annotations
  });
}
var Int = /* @__PURE__ */ Number5.check(/* @__PURE__ */ isInt());
function isMinLength(minLength, annotations) {
  minLength = Math.max(0, Math.floor(minLength));
  return makeFilter2((input) => input.length >= minLength, {
    expected: `a value with a length of at least ${minLength}`,
    representation: {
      id: "effect/schema/isMinLength",
      payload: {
        minLength
      }
    },
    toJsonSchema: ({
      type
    }) => type === "array" ? {
      minItems: minLength
    } : {
      minLength
    },
    toCode: () => ({
      runtime: `Schema.isMinLength(${minLength})`
    }),
    [STRUCTURAL_ANNOTATION_KEY]: true,
    arbitraryConstraint: {
      minLength
    },
    ...annotations
  });
}
function isNonEmpty(annotations) {
  return isMinLength(1, annotations);
}
var getErrorOptionsKey = (options) => (options?.includeStack === true ? 1 : 0) | (options?.excludeCause === true ? 2 : 0);
var getErrorOptions = (key) => {
  switch (key) {
    case 0:
      return;
    case 1:
      return {
        includeStack: true
      };
    case 2:
      return {
        excludeCause: true
      };
    case 3:
      return {
        includeStack: true,
        excludeCause: true
      };
  }
};
var defectSchemaCache = [];
function Defect(options) {
  const key = getErrorOptionsKey(options);
  const cached = defectSchemaCache[key];
  if (cached !== undefined) {
    return cached;
  }
  const schema = Json2.pipe(decodeTo2(Unknown2, defectFromJson(getErrorOptions(key))));
  defectSchemaCache[key] = schema;
  return schema;
}
var RegExp2 = /* @__PURE__ */ instanceOf(globalThis.RegExp, {
  representation: {
    id: "effect/schema/RegExp",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.RegExp`,
    Type: `globalThis.RegExp`
  }),
  expected: "RegExp",
  toCodecJson: () => link()(Struct({
    source: String4,
    flags: String4
  }), transformEffect2({
    decode: (e, options) => try_2({
      try: () => new globalThis.RegExp(e.source, e.flags),
      catch: () => new InvalidValue({
        expected: "valid RegExp source and flags"
      }, e, options)
    }),
    encode: (regExp) => succeed6({
      source: regExp.source,
      flags: regExp.flags
    })
  }))
});
var URLString = /* @__PURE__ */ String4.annotate({
  expected: "a string that will be decoded as a URL"
});
var URL2 = /* @__PURE__ */ instanceOf(globalThis.URL, {
  representation: {
    id: "effect/schema/URL",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URL`,
    Type: `globalThis.URL`
  }),
  expected: "URL",
  toCodecJson: () => link()(URLString, urlFromString)
});
var File = /* @__PURE__ */ instanceOf(globalThis.File, {
  representation: {
    id: "effect/schema/File",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.File`,
    Type: `globalThis.File`
  }),
  expected: "File",
  toCodecJson: () => link()(Struct({
    data: String4.check(isBase64()),
    type: String4,
    name: String4,
    lastModified: Int
  }), transformEffect2({
    decode: (e, options) => match2(decodeBase64(e.data), {
      onFailure: () => fail5(new InvalidValue({
        expected: "a valid Base64 string"
      }, e.data, options)),
      onSuccess: (bytes) => {
        const buffer = new globalThis.Uint8Array(bytes);
        return succeed6(new globalThis.File([buffer], e.name, {
          type: e.type,
          lastModified: e.lastModified
        }));
      }
    }),
    encode: (file, options) => tryPromise2({
      try: async () => {
        const bytes = new globalThis.Uint8Array(await file.arrayBuffer());
        return {
          data: encodeBase64(bytes),
          type: file.type,
          name: file.name,
          lastModified: file.lastModified
        };
      },
      catch: () => new InvalidValue({
        expected: "a readable File"
      }, file, options)
    })
  }))
});
var FormData2 = /* @__PURE__ */ instanceOf(globalThis.FormData, {
  representation: {
    id: "effect/schema/FormData",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.FormData`,
    Type: `globalThis.FormData`
  }),
  expected: "FormData",
  toCodecJson: () => link()(ArraySchema(Tuple([String4, Union2([Struct({
    _tag: tag("String"),
    value: String4
  }), Struct({
    _tag: tag("File"),
    value: File
  })])])), transformEffect2({
    decode: (e) => {
      const out = new globalThis.FormData;
      for (const [key, entry] of e) {
        out.append(key, entry.value);
      }
      return succeed6(out);
    },
    encode: (formData) => {
      return succeed6(globalThis.Array.from(formData.entries()).map(([key, value]) => {
        if (typeof value === "string") {
          return [key, {
            _tag: "String",
            value
          }];
        } else {
          return [key, {
            _tag: "File",
            value
          }];
        }
      }));
    }
  }))
});
var URLSearchParams2 = /* @__PURE__ */ instanceOf(globalThis.URLSearchParams, {
  representation: {
    id: "effect/schema/URLSearchParams",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.URLSearchParams`,
    Type: `globalThis.URLSearchParams`
  }),
  expected: "URLSearchParams",
  toCodecJson: () => link()(String4.annotate({
    expected: "a query string that will be decoded as URLSearchParams"
  }), transform2({
    decode: (e) => new globalThis.URLSearchParams(e),
    encode: (params) => params.toString()
  }))
});
var Base64String = /* @__PURE__ */ String4.annotate({
  expected: "a base64 encoded string that will be decoded as Uint8Array",
  format: "byte",
  contentEncoding: "base64"
});
var Uint8Array2 = /* @__PURE__ */ instanceOf(globalThis.Uint8Array, {
  representation: {
    id: "effect/schema/Uint8Array",
    payload: null
  },
  toCode: () => ({
    runtime: `Schema.Uint8Array`,
    Type: `globalThis.Uint8Array`
  }),
  expected: "Uint8Array",
  toCodecJson: () => link()(Base64String, uint8ArrayFromBase64String)
});
var arbitraryMinimumDateTimestamp = -8640000000000000;
var arbitraryMaximumDateTimestamp = 8640000000000000;
var arbitraryMinimumZonedDateTimeTimestamp = arbitraryMinimumDateTimestamp + 14 * 60 * 60 * 1000;
var arbitraryMaximumZonedDateTimeTimestamp = arbitraryMaximumDateTimestamp - 14 * 60 * 60 * 1000;
var arbitraryMinimumTimeZoneOffset = -12 * 60 * 60 * 1000;
var arbitraryMaximumTimeZoneOffset = 14 * 60 * 60 * 1000;
var immerable = /* @__PURE__ */ globalThis.Symbol.for("immer-draftable");
var payloadToken = {};
function makeClass(Inherited, identifier, struct2, annotations, proto) {
  const getClassSchema = getClassSchemaFactory(struct2, identifier, annotations);
  const ClassTypeId = getClassTypeId(identifier);
  const out = class extends Inherited {
    constructor(...[input, options]) {
      const internalOptions = options;
      const payload = internalOptions?.["~payload"];
      const value = payload?.token === payloadToken ? payload.value : struct2.make(input ?? {}, options);
      super(value, {
        ...options,
        disableChecks: true,
        "~payload": {
          token: payloadToken,
          value
        }
      });
    }
    static [TypeId14] = TypeId14;
    get [ClassTypeId]() {
      return ClassTypeId;
    }
    static [immerable] = true;
    static identifier = identifier;
    static fields = struct2.fields;
    static get ast() {
      return getClassSchema(this).ast;
    }
    static pipe() {
      return pipeArguments(this, arguments);
    }
    static rebuild(ast) {
      return getClassSchema(this).rebuild(ast);
    }
    static make(input, options) {
      return make7(getClassSchema(this))(input ?? {}, options);
    }
    static makeOption(input, options) {
      return makeOption(getClassSchema(this))(input ?? {}, options);
    }
    static makeEffect(input, options) {
      return getClassSchema(this).makeEffect(input ?? {}, options);
    }
    static annotate(annotations) {
      return this.rebuild(annotate(this.ast, annotations));
    }
    static annotateKey(annotations) {
      return this.rebuild(annotateKey(this.ast, annotations));
    }
    static check(...checks) {
      return this.rebuild(appendChecks(this.ast, checks));
    }
    static extend(identifier2) {
      return (schema, annotations) => {
        const extension = isStruct(schema) ? schema : Struct(schema);
        const fields = {
          ...struct2.fields,
          ...extension.fields
        };
        const ast = struct(fields, struct2.ast.checks, {
          identifier: identifier2
        });
        return makeClass(this, identifier2, makeStruct(appendChecks(ast, extension.ast.checks), fields), annotations, proto);
      };
    }
    static mapFields(f, options) {
      return struct2.mapFields(f, options);
    }
  };
  if (proto !== undefined) {
    Object.assign(out.prototype, proto(identifier));
  }
  return out;
}
function getClassTransformation(self) {
  return new Transformation(transform((input) => new self(input, {
    "~payload": {
      token: payloadToken,
      value: input
    }
  })), passthrough2());
}
function getClassTypeId(identifier) {
  return `~effect/Schema/Class/${identifier}`;
}
function getClassSchemaFactory(from, identifier, annotations) {
  let memo;
  return (self) => {
    if (memo !== undefined) {
      return memo;
    }
    const ClassTypeId = getClassTypeId(identifier);
    const isClassValue = (input) => input instanceof self || hasProperty(input, ClassTypeId);
    const transformation = getClassTransformation(self);
    const to = make9(new Declaration([from.ast], () => (input, ast, options) => {
      return isClassValue(input) ? succeed6(input) : fail5(new InvalidType(ast, input, options));
    }, {
      identifier,
      [CONSTRUCTOR_ANNOTATION_KEY]: ([from]) => ({
        isConstructed: isClassValue,
        link: new Link(from, transformation)
      }),
      toCodec: ([from]) => new Link(from.ast, transformation),
      toEquivalence: ([from]) => from,
      toFormatter: ([from]) => (t) => `${self.identifier}(${from(t)})`,
      [SENTINELS_ANNOTATION_KEY]: collectSentinels(from.ast),
      ...annotations
    }));
    return memo = decodeTo2(to, transformation)(from);
  };
}
function isStruct(schema) {
  return isSchema(schema);
}
var Error3 = (identifier) => (schema, annotations) => {
  const struct = isStruct(schema) ? schema : Struct(schema);
  const self = makeClass(Error2, identifier, struct, annotations, (identifier) => ({
    name: identifier
  }));
  return self;
};
var TaggedError3 = (identifier) => {
  return (tagValue, schema, annotations) => {
    const struct = isStruct(schema) ? schema.mapFields((fields) => ({
      _tag: tag(tagValue),
      ...fields
    }), {
      unsafePreserveChecks: true
    }) : TaggedStruct(tagValue, schema);
    return Error3(identifier ?? tagValue)(struct, annotations);
  };
};
var toCodecStringTree2 = toCodecStringTree;
var Json2 = /* @__PURE__ */ make9(/* @__PURE__ */ annotate(Json, {
  toCode: () => ({
    runtime: "Schema.Json",
    Type: "Schema.Json"
  })
}));
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/internal/stream.js
var TypeId15 = "~effect/Stream";
var streamVariance = {
  _R: identity,
  _E: identity,
  _A: identity
};
var Stream = function(channel) {
  this.channel = channel;
};
Stream.prototype = {
  [TypeId15]: streamVariance,
  pipe() {
    return pipeArguments(this, arguments);
  }
};
var fromChannel = (channel) => new Stream(channel);

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Stream.js
var fromChannel2 = fromChannel;
var toChannel = (stream) => stream.channel;
var fromAsyncIterable2 = (iterable, onError) => fromChannel2(fromAsyncIterableArray(iterable, onError));
var filter4 = /* @__PURE__ */ dual(2, (self, predicate) => fromChannel2(filterArray(toChannel(self), predicate)));
var runForEach2 = /* @__PURE__ */ dual(2, (self, f) => runForEach(self.channel, (arr) => {
  let i = 0;
  return whileLoop2({
    while: () => i < arr.length,
    body: () => f(arr[i++]),
    step: constVoid
  });
}));

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/ConfigProvider.js
function makeValue(value) {
  return {
    _tag: "Value",
    value
  };
}
function makeRecord(keys, value) {
  return {
    _tag: "Record",
    keys,
    value
  };
}
function makeArray(length, value) {
  return {
    _tag: "Array",
    length,
    value
  };
}
var ConfigProvider = /* @__PURE__ */ Reference("effect/ConfigProvider", {
  defaultValue: () => fromEnv()
});
var Proto2 = {
  ...PipeInspectableProto,
  toJSON() {
    return {
      _id: "ConfigProvider"
    };
  }
};
var identityPath = (path) => path;
function makeProvider(load, mapInput) {
  const self = Object.create(Proto2);
  self.load = load;
  self.mapInput = mapInput;
  return self;
}
function makeSource(get, transform) {
  return makeProvider((path) => get(transform(path)), (f) => makeSource(get, flow(transform, f)));
}
function make10(get) {
  return makeSource(get, identityPath);
}
function emptyStringAsMissing(value, preserveEmptyStrings) {
  return value === "" && !preserveEmptyStrings ? undefined : value;
}
function fromEnvRecord(env, options) {
  const preserveEmptyStrings = options?.preserveEmptyStrings === true;
  const trie = buildEnvTrie(env);
  return make10((path) => succeed6(nodeAtEnv(trie, env, path, preserveEmptyStrings)));
}
function fromEnv(options) {
  const env = options?.env ?? {
    ...globalThis.process?.env,
    ...import.meta?.env
  };
  return fromEnvRecord(env, {
    preserveEmptyStrings: options?.preserveEmptyStrings
  });
}
function buildEnvTrie(env) {
  const trie = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined)
      continue;
    const segments = name.split("_");
    let node = trie;
    for (const seg of segments) {
      const children = node.children ??= Object.create(null);
      node = children[seg] ??= {};
    }
  }
  return trie;
}
function nodeAtEnv(trie, env, path, preserveEmptyStrings) {
  const key = path.map(String).join("_");
  const leafValue = emptyStringAsMissing(Object.hasOwn(env, key) ? env[key] : undefined, preserveEmptyStrings);
  const trieNode = trieNodeAt(trie, path);
  const children = trieNode?.children ? Object.keys(trieNode.children) : [];
  if (children.length === 0) {
    return leafValue === undefined ? undefined : makeValue(leafValue);
  }
  const allNumeric = children.every(isCanonicalArrayIndex);
  if (allNumeric) {
    const length = Math.max(...children.map((k) => parseInt(k, 10))) + 1;
    return makeArray(length, leafValue);
  }
  return makeRecord(new Set(children), leafValue);
}
function trieNodeAt(root, path) {
  if (path.length === 0)
    return root;
  let node = root;
  for (const seg of path) {
    node = node?.children?.[String(seg)];
    if (!node)
      return;
  }
  return node;
}

// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Config.js
var TypeId16 = "~effect/Config";
class ConfigError {
  _tag = "ConfigError";
  name = "ConfigError";
  cause;
  constructor(cause) {
    this.cause = cause;
  }
  get message() {
    return this.cause.toString();
  }
  toString() {
    return `ConfigError(${this.message})`;
  }
}
var Proto3 = {
  .../* @__PURE__ */ Prototype2({
    label: "Config",
    evaluate(fiber) {
      return this.parse(fiber.getRef(ConfigProvider));
    }
  }),
  [TypeId16]: TypeId16,
  toJSON() {
    return {
      _id: "Config"
    };
  }
};
function make11(evaluator) {
  const self = Object.create(Proto3);
  self.evaluator = evaluator;
  self.parse = (provider) => evaluator(provider, []).pipe(mapErrorEager2((failure) => failure.error), flatMapEager2((resolution) => resolution._tag === "Resolved" ? succeed6(resolution.value) : fail5(resolution.error)));
  return self;
}
var evaluateAt = (self, provider, pathPrefix) => self.evaluator(provider, pathPrefix);
var resolved = (value, hasInput) => ({
  _tag: "Resolved",
  value,
  hasInput
});
var absent = (error) => ({
  _tag: "Absent",
  error
});
var evaluationFailure = (error, hasInput) => ({
  error,
  hasInput
});
var isSourceError = (u) => isTagged(u, "SourceError");
var catchSourceError = (self, hasInput) => self.pipe(catchDefect2((defect) => isSourceError(defect) ? fail5(evaluationFailure(new ConfigError(defect), hasInput)) : die3(defect)));
var map8 = /* @__PURE__ */ dual(2, (self, f) => {
  return make11((provider, pathPrefix) => map6(evaluateAt(self, provider, pathPrefix), (resolution) => resolution._tag === "Resolved" ? resolved(f(resolution.value), resolution.hasInput) : resolution));
});
function all3(arg) {
  const configs = globalThis.Array.isArray(arg) ? arg : (Symbol.iterator in arg) ? [...arg] : arg;
  if (globalThis.Array.isArray(configs)) {
    return make11((provider, pathPrefix) => flatMapEager2(all2(configs.map((config) => result2(evaluateAt(config, provider, pathPrefix)))), resolveArray));
  } else {
    return make11((provider, pathPrefix) => flatMapEager2(all2(map(configs, (config) => result2(evaluateAt(config, provider, pathPrefix)))), resolveRecord));
  }
}
var resolveArray = (results) => {
  const values = [];
  let firstFailure;
  let firstAbsent;
  let hasInput = false;
  for (const result of results) {
    if (isFailure2(result)) {
      firstFailure ??= result.failure;
      hasInput = hasInput || result.failure.hasInput;
      continue;
    }
    const resolution = result.success;
    if (resolution._tag === "Absent") {
      firstAbsent ??= resolution;
    } else {
      values.push(resolution.value);
      hasInput = hasInput || resolution.hasInput;
    }
  }
  if (firstFailure !== undefined) {
    return fail5(evaluationFailure(firstFailure.error, hasInput));
  }
  if (firstAbsent !== undefined) {
    return hasInput ? fail5(evaluationFailure(firstAbsent.error, true)) : succeed6(firstAbsent);
  }
  return succeed6(resolved(values, hasInput));
};
var resolveRecord = (results) => {
  const values = {};
  let firstFailure;
  let firstAbsent;
  let hasInput = false;
  for (const key in results) {
    const result = results[key];
    if (isFailure2(result)) {
      firstFailure ??= result.failure;
      hasInput = hasInput || result.failure.hasInput;
      continue;
    }
    const resolution = result.success;
    if (resolution._tag === "Absent") {
      firstAbsent ??= resolution;
    } else {
      assignProperty(values, key, resolution.value);
      hasInput = hasInput || resolution.hasInput;
    }
  }
  if (firstFailure !== undefined) {
    return fail5(evaluationFailure(firstFailure.error, hasInput));
  }
  if (firstAbsent !== undefined) {
    return hasInput ? fail5(evaluationFailure(firstAbsent.error, true)) : succeed6(firstAbsent);
  }
  return succeed6(resolved(values, hasInput));
};
var withDefault3 = /* @__PURE__ */ dual(2, (self, defaultValue) => {
  return make11((provider, pathPrefix) => mapEager2(evaluateAt(self, provider, pathPrefix), (resolution) => resolution._tag === "Absent" ? resolved(defaultValue, false) : resolution));
});
var option3 = (self) => self.pipe(map8(some2), withDefault3(none2()));
var cursorToString = () => "<configuration>";
var loadCursor = (provider, path) => provider.load(path).pipe(orDie2, mapEager2((node) => ({
  provider,
  path,
  node,
  toString: cursorToString
})));
var loadChildCursor = (cursor, segment) => loadCursor(cursor.provider, [...cursor.path, segment]);
var getScalar = (node) => node?.value;
var decodeFromCursor = (ast, decode) => decodeTo(unknown, ast, new Transformation(transformEffect((input) => decode(input)), passthrough2()));
var isScalarInput = (ast) => {
  switch (ast._tag) {
    case "Union":
      return ast.types.every(isScalarInput);
    case "Objects":
    case "Arrays":
    case "Suspend":
      return false;
    default:
      return true;
  }
};
var hasProviderInput = (ast, node) => {
  switch (ast._tag) {
    case "Objects":
      return node?._tag === "Record";
    case "Arrays":
      return node?._tag === "Array";
    case "Union":
      return ast.types.some((ast) => hasProviderInput(ast, node));
    case "Suspend":
      return hasProviderInput(ast.thunk(), node);
    default:
      return getScalar(node) !== undefined;
  }
};
var toConfigCursorAST = /* @__PURE__ */ memoize((root) => {
  const seen = new WeakSet;
  const recur = applyToSelfOrLastLinkEncoding((ast) => {
    seen.add(ast);
    switch (ast._tag) {
      case "Objects": {
        const matchesIndex = ast.indexSignatures.map((is) => _is(is.parameter));
        const materialize = fnUntraced2(function* (cursor) {
          if (cursor.node?._tag !== "Record") {
            return;
          }
          const node = cursor.node;
          const keys = new Set;
          for (const property of ast.propertySignatures) {
            if (typeof property.name === "string")
              keys.add(property.name);
          }
          if (matchesIndex.length > 0) {
            for (const key of node.keys) {
              if (matchesIndex.some((matches) => matches(key)))
                keys.add(key);
            }
          }
          const out = {};
          for (const key of keys) {
            const child = yield* loadChildCursor(cursor, key);
            if (child.node !== undefined)
              assignProperty(out, key, child);
          }
          return out;
        });
        return decodeFromCursor(ast.recur(recur, (ast) => ast), materialize);
      }
      case "Arrays": {
        const materialize = fnUntraced2(function* (cursor) {
          if (cursor.node?._tag !== "Array") {
            return;
          }
          const out = [];
          for (let i = 0;i < cursor.node.length; i++) {
            out.push(yield* loadChildCursor(cursor, i));
          }
          return out;
        });
        return decodeFromCursor(ast.recur(recur), materialize);
      }
      case "Union":
        for (const member of ast.types) {
          recur(member);
        }
        return isScalarInput(ast) ? decodeFromCursor(ast, (cursor) => succeed6(getScalar(cursor.node))) : ast.recur(recur);
      case "Suspend": {
        const target = ast.thunk();
        if (!seen.has(target))
          recur(target);
        return ast.recur(recur);
      }
      case "Declaration":
      case "Any":
        throw new globalThis.Error("Config.schema does not support opaque StringTree encodings", {
          cause: ast
        });
      default:
        return decodeFromCursor(ast, (cursor) => succeed6(getScalar(cursor.node)));
    }
  });
  return recur(root);
});
function schema(codec, path) {
  const codecStringTree = toCodecStringTree2(codec);
  const encodedAst = toEncoded(codecStringTree.ast);
  const decodeCursor = decodeUnknownEffect(make9(toConfigCursorAST(codecStringTree.ast)));
  const localPath = typeof path === "string" ? [path] : path ?? [];
  return make11((provider, pathPrefix) => {
    const fullPath = [...pathPrefix, ...localPath];
    return catchSourceError(loadCursor(provider, fullPath), false).pipe(flatMapEager2((cursor) => {
      const hasInput = hasProviderInput(encodedAst, cursor.node);
      return catchSourceError(decodeCursor(cursor).pipe(mapEager2((value) => resolved(value, hasInput)), catchEager2((issue) => {
        const error = new ConfigError(new SchemaError(fullPath.length > 0 ? new Pointer(fullPath, issue) : issue));
        return hasInput ? fail5(evaluationFailure(error, true)) : succeed6(absent(error));
      })), hasInput);
    }));
  });
}
function String5(name) {
  return schema(String4, name);
}
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/FiberHandle.js
var TypeId17 = "~effect/FiberHandle";
var isFiberHandle = (u) => hasProperty(u, TypeId17);
var Proto4 = {
  [TypeId17]: TypeId17,
  ...PipeInspectableProto,
  toJSON() {
    return {
      _id: "FiberHandle",
      state: this.state
    };
  }
};
var makeUnsafe4 = () => {
  const self = Object.create(Proto4);
  self.state = {
    _tag: "Open",
    fiber: undefined
  };
  self.deferred = makeUnsafe2();
  return self;
};
var make12 = () => acquireRelease2(sync3(() => makeUnsafe4()), (handle) => {
  const state = handle.state;
  if (state._tag === "Closed")
    return void_3;
  handle.state = {
    _tag: "Closed"
  };
  return state.fiber ? into(asVoid2(interruptAs(state.fiber, internalFiberId)), handle.deferred) : done3(handle.deferred, void_2);
});
var internalFiberId = -1;
var isInternalInterruption = /* @__PURE__ */ toPredicate(/* @__PURE__ */ compose(filterInterruptors, /* @__PURE__ */ has(internalFiberId)));
var setUnsafe = /* @__PURE__ */ dual((args) => isFiberHandle(args[0]), (self, fiber, options) => {
  if (self.state._tag === "Closed") {
    fiber.interruptUnsafe(internalFiberId);
    return;
  } else if (self.state.fiber !== undefined) {
    if (self.state.fiber === fiber) {
      return;
    } else if (options?.onlyIfMissing === true) {
      fiber.interruptUnsafe(internalFiberId);
      return;
    }
    self.state.fiber.interruptUnsafe(internalFiberId);
    self.state.fiber = undefined;
  }
  self.state.fiber = fiber;
  fiber.addObserver((exit) => {
    if (self.state._tag === "Open" && fiber === self.state.fiber) {
      self.state.fiber = undefined;
    }
    if (isFailure3(exit) && (options?.propagateInterruption === true ? !isInternalInterruption(exit.cause) : !hasInterruptsOnly2(exit.cause))) {
      doneUnsafe(self.deferred, exit);
    }
  });
});
var clear = (self) => uninterruptibleMask2((restore) => {
  if (self.state._tag === "Closed" || self.state.fiber === undefined) {
    return void_3;
  }
  const fiber = self.state.fiber;
  return andThen2(restore(interruptAs(fiber, internalFiberId)), sync3(() => {
    if (self.state._tag === "Open" && self.state.fiber === fiber) {
      self.state.fiber = undefined;
    }
  }));
});
var constInterruptedFiber = /* @__PURE__ */ function() {
  let fiber = undefined;
  return () => {
    if (fiber === undefined) {
      fiber = runFork2(interrupt2);
    }
    return fiber;
  };
}();
var run2 = function() {
  const self = arguments[0];
  if (isEffect2(arguments[1])) {
    return runImpl(self, arguments[1], arguments[2]);
  }
  const options = arguments[1];
  return (effect) => runImpl(self, effect, options);
};
var runImpl = (self, effect, options) => withFiber2((parent) => {
  if (self.state._tag === "Closed") {
    return interrupt2;
  } else if (self.state.fiber !== undefined && options?.onlyIfMissing === true) {
    return sync3(constInterruptedFiber);
  }
  const fiber = runForkWith2(parent.context)(effect);
  setUnsafe(self, fiber, options);
  return succeed6(fiber);
});
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/FiberMap.js
var TypeId18 = "~effect/FiberMap";
var isFiberMap = (u) => hasProperty(u, TypeId18);
var Proto5 = {
  [TypeId18]: TypeId18,
  [Symbol.iterator]() {
    if (this.state._tag === "Closed") {
      return empty();
    }
    return this.state.backing[Symbol.iterator]();
  },
  ...PipeInspectableProto,
  toJSON() {
    return {
      _id: "FiberMap",
      state: this.state
    };
  }
};
var makeUnsafe5 = (backing, deferred) => {
  const self = Object.create(Proto5);
  self.state = {
    _tag: "Open",
    backing
  };
  self.deferred = deferred;
  return self;
};
var make13 = () => acquireRelease2(sync3(() => makeUnsafe5(empty4(), makeUnsafe2())), (map) => suspend2(() => {
  const state = map.state;
  if (state._tag === "Closed")
    return void_3;
  map.state = {
    _tag: "Closed"
  };
  return interruptAll(values(state.backing)).pipe(into(map.deferred));
}));
var internalFiberId2 = -1;
var isInternalInterruption2 = /* @__PURE__ */ toPredicate(/* @__PURE__ */ compose(filterInterruptors, /* @__PURE__ */ has(internalFiberId2)));
var setUnsafe2 = /* @__PURE__ */ dual((args) => isFiberMap(args[0]), (self, key, fiber, options) => {
  if (self.state._tag === "Closed") {
    fiber.interruptUnsafe(internalFiberId2);
    return;
  }
  const previous = get2(self.state.backing, key);
  if (previous._tag === "Some") {
    if (previous.value === fiber) {
      return;
    } else if (options?.onlyIfMissing === true) {
      fiber.interruptUnsafe(internalFiberId2);
      return;
    }
  }
  set(self.state.backing, key, fiber);
  if (previous._tag === "Some") {
    previous.value.interruptUnsafe(internalFiberId2);
  }
  fiber.addObserver((exit) => {
    if (self.state._tag === "Closed") {
      return;
    }
    const current = get2(self.state.backing, key);
    if (isSome2(current) && fiber === current.value) {
      remove(self.state.backing, key);
    }
    if (isFailure3(exit) && (options?.propagateInterruption === true ? !isInternalInterruption2(exit.cause) : !hasInterruptsOnly2(exit.cause))) {
      doneUnsafe(self.deferred, exit);
    }
  });
});
var hasUnsafe = /* @__PURE__ */ dual(2, (self, key) => self.state._tag === "Closed" ? false : has2(self.state.backing, key));
var constInterruptedFiber2 = /* @__PURE__ */ function() {
  let fiber = undefined;
  return () => {
    if (fiber === undefined) {
      fiber = runFork2(interrupt2);
    }
    return fiber;
  };
}();
var run3 = function() {
  const self = arguments[0];
  if (isEffect2(arguments[2])) {
    return runImpl2(self, arguments[1], arguments[2], arguments[3]);
  }
  const key = arguments[1];
  const options = arguments[2];
  return (effect) => runImpl2(self, key, effect, options);
};
var runImpl2 = (self, key, effect, options) => withFiber2((parent) => {
  if (self.state._tag === "Closed") {
    return interrupt2;
  } else if (options?.onlyIfMissing === true && hasUnsafe(self, key)) {
    return sync3(constInterruptedFiber2);
  }
  const fiber = runForkWith2(parent.context)(effect);
  setUnsafe2(self, key, fiber, options);
  return succeed6(fiber);
});
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/Logger.js
var CurrentLoggers2 = CurrentLoggers;
var make14 = loggerMake;
var layer = (loggers, options) => effect(CurrentLoggers2, withFiber(fnUntraced(function* (fiber) {
  const currentLoggers = new Set(options?.mergeWithExisting === true ? fiber.getRef(CurrentLoggers) : []);
  for (const logger of loggers) {
    currentLoggers.add(isEffect(logger) ? yield* logger : logger);
  }
  return currentLoggers;
})));
// node_modules/.bun/effect@4.0.0-rc.117/node_modules/effect/dist/ManagedRuntime.js
var TypeId19 = "~effect/ManagedRuntime";
var make15 = (layer, options) => {
  const memoMap = options?.memoMap ?? makeMemoMapUnsafe();
  const scope = makeUnsafe3("parallel");
  const layerScope = forkUnsafe2(scope, "sequential");
  const defaultRunOptions = {
    onFiberStart: runIn(scope)
  };
  const mergeRunOptions = (options) => options ? {
    ...options,
    onFiberStart: options.onFiberStart ? (fiber) => {
      defaultRunOptions.onFiberStart(fiber);
      options.onFiberStart(fiber);
    } : defaultRunOptions.onFiberStart
  } : defaultRunOptions;
  let buildFiber;
  const contextEffect = withFiber2((fiber) => {
    if (!buildFiber) {
      buildFiber = runFork2(tap2(buildWithMemoMap(layer, memoMap, layerScope), (context) => sync3(() => {
        self.cachedContext = context;
      })), {
        ...defaultRunOptions,
        scheduler: fiber.cache.scheduler
      });
    }
    return flatten3(await_(buildFiber));
  });
  const self = {
    [TypeId19]: TypeId19,
    memoMap,
    scope,
    contextEffect,
    cachedContext: undefined,
    context() {
      return self.cachedContext === undefined ? runPromise2(self.contextEffect) : Promise.resolve(self.cachedContext);
    },
    dispose() {
      return runPromise2(self.disposeEffect);
    },
    [Symbol.asyncDispose]() {
      return self.dispose();
    },
    disposeEffect: suspend2(() => {
      self.contextEffect = die3("ManagedRuntime disposed");
      self.cachedContext = undefined;
      return close(self.scope, void_2);
    }),
    runFork(effect, options) {
      return self.cachedContext === undefined ? runFork2(provide3(self, effect), mergeRunOptions(options)) : runForkWith2(self.cachedContext)(effect, mergeRunOptions(options));
    },
    runCallback(effect, options) {
      return self.cachedContext === undefined ? runCallback2(provide3(self, effect), mergeRunOptions(options)) : runCallbackWith2(self.cachedContext)(effect, mergeRunOptions(options));
    },
    runSyncExit(effect) {
      return self.cachedContext === undefined ? runSyncExit2(provide3(self, effect)) : runSyncExitWith2(self.cachedContext)(effect);
    },
    runSync(effect) {
      return self.cachedContext === undefined ? runSync2(provide3(self, effect)) : runSyncWith2(self.cachedContext)(effect);
    },
    runPromiseExit(effect, options) {
      return self.cachedContext === undefined ? runPromiseExit2(provide3(self, effect), mergeRunOptions(options)) : runPromiseExitWith2(self.cachedContext)(effect, mergeRunOptions(options));
    },
    runPromise(effect, options) {
      return self.cachedContext === undefined ? runPromise2(provide3(self, effect), mergeRunOptions(options)) : runPromiseWith2(self.cachedContext)(effect, mergeRunOptions(options));
    }
  };
  return self;
};
function provide3(managed, effect) {
  return flatMap3(managed.contextEffect, (context) => provideContext2(effect, context));
}
// packages/plugin/src/config.ts
import { stat } from "fs/promises";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve as resolvePath, sep } from "path";

// packages/protocol/src/index.ts
import { isIP } from "net";
import { connect } from "tls";
import { promisify } from "util";
import { gzip as gzipCallback } from "zlib";
var PROTOCOL_VERSION = 5;
var Int2 = Int;
var NonNegativeInt = Int2.check(isGreaterThanOrEqualTo2(0));
var NonEmptyString2 = String4.check(isNonEmpty());
var Part = Union2([
  Struct({ kind: Literals(["text", "reasoning"]), text: String4 }),
  Struct({
    kind: Literal2("tool"),
    tool: String4,
    title: String4,
    status: NonEmptyString2,
    error: optionalKey2(String4),
    text: String4,
    searchable: Boolean3
  })
]);
var MessageType = Literals(["user", "synthetic", "assistant", "compaction", "shell", "skill"]);
var Message = Struct({
  id: NonEmptyString2,
  type: MessageType,
  timeCreated: Int2,
  parts: ArraySchema(Part)
});
var Session = Struct({
  id: NonEmptyString2,
  slug: String4,
  title: String4,
  directory: String4,
  parentId: NullOr(String4),
  timeCreated: Int2,
  timeUpdated: Int2,
  messages: ArraySchema(Message)
});
var Snapshot = Struct({
  session: Session,
  revision: NonNegativeInt,
  lastActivity: Int2,
  contentHash: NonEmptyString2,
  extractorVersion: Int2.check(isGreaterThan2(0))
});
var Tombstone = Struct({
  sessionId: NonEmptyString2,
  revision: NonNegativeInt,
  timeDeleted: Int2,
  reason: Literals(["deleted", "excluded"])
});
var Search = Struct({
  query: String4,
  mode: optionalKey2(Literals(["hybrid", "lexical", "semantic"])),
  scope: optionalKey2(Literals(["all", "user-messages"])),
  since: optionalKey2(Int2),
  until: optionalKey2(Int2),
  directory: optionalKey2(String4),
  source: optionalKey2(String4),
  sessionId: optionalKey2(String4),
  includeTools: optionalKey2(Boolean3),
  limit: Int2.check(isBetween({ minimum: 1, maximum: 25 })),
  exclude: optionalKey2(Struct({ sessionId: NonEmptyString2, before: Int2 }))
});
var SessionRef = NonEmptyString2;
var Inspect = Struct({
  session: SessionRef,
  query: optionalKey2(String4),
  mode: Search.fields.mode,
  scope: Search.fields.scope,
  includeTools: Search.fields.includeTools,
  limit: Int2.check(isBetween({ minimum: 1, maximum: 30 })),
  exclude: Search.fields.exclude
});
var Expand = Struct({
  session: SessionRef,
  messageId: optionalKey2(String4),
  window: Int2.check(isBetween({ minimum: 2, maximum: 60 })),
  maxChars: Int2.check(isBetween({ minimum: 100, maximum: 4000 }))
});
var Transcript = Struct({
  session: SessionRef,
  budget: Int2.check(isBetween({ minimum: 1000, maximum: 1e6 })),
  maxChars: Int2.check(isBetween({ minimum: 100, maximum: 4000 }))
});
var summaryKeyFields = {
  provider: NonEmptyString2,
  model: NonEmptyString2,
  variant: optionalKey2(NonEmptyString2),
  focus: String4,
  recipe: Int2.check(isGreaterThan2(0))
};
var SummaryGet = Struct({ session: SessionRef, ...summaryKeyFields });
var SummaryPut = Struct({
  sessionId: NonEmptyString2,
  contentHash: NonEmptyString2,
  ...summaryKeyFields,
  summary: NonEmptyString2,
  omitted: NonNegativeInt,
  clipped: NonNegativeInt
});
var version = { protocolVersion: Literal2(PROTOCOL_VERSION) };
var requests = {
  snapshot: Struct({ ...version, ...Snapshot.fields }),
  tombstone: Struct({ ...version, ...Tombstone.fields }),
  manifest: Struct(version),
  search: Struct({ ...version, ...Search.fields }),
  inspect: Struct({ ...version, ...Inspect.fields }),
  expand: Struct({ ...version, ...Expand.fields }),
  transcript: Struct({ ...version, ...Transcript.fields }),
  "summary.get": Struct({ ...version, ...SummaryGet.fields }),
  "summary.put": Struct({ ...version, ...SummaryPut.fields }),
  status: Struct(version)
};
var Envelope = Struct({ protocolVersion: Int2 });
var Position = { revision: NonNegativeInt, lastActivity: Int2, contentHash: NonEmptyString2, extractorVersion: Int2 };
var Manifest = Struct({
  sessions: ArraySchema(Struct({ sessionId: String4, ...Position })),
  tombstones: ArraySchema(Struct({ sessionId: String4, timeDeleted: Int2, excludedByCaller: Boolean3 }))
});
var hitFields = {
  messageId: String4,
  time: Int2,
  snippet: String4
};
var SearchHit = Union2([
  Struct({
    ...hitFields,
    branch: Literal2("lexical"),
    messageType: MessageType,
    kind: Literals(["text", "reasoning", "tool"])
  }),
  Struct({ ...hitFields, branch: Literal2("semantic"), score: Number5 })
]);
var archivedFields = {
  sessionId: String4,
  slug: String4,
  title: String4,
  directory: String4,
  parentId: NullOr(String4),
  timeUpdated: Int2,
  source: String4,
  ownSource: Boolean3,
  revision: Int2
};
var resolvedFields = {
  session: Struct({ ...archivedFields, timeCreated: Int2 }),
  sameSlug: ArraySchema(Struct({ sessionId: String4, title: String4, timeUpdated: Int2 }))
};
var Missing = Struct({ kind: Literal2("missing") });
var WindowMessage = Struct({
  messageId: String4,
  type: MessageType,
  time: Int2,
  text: String4,
  tools: ArraySchema(Struct({ tool: String4, title: String4, status: String4, error: optionalKey2(String4) }))
});
var SearchResult = Struct({
  ...archivedFields,
  lexicalMatches: Int2,
  semanticMatches: Int2,
  hits: ArraySchema(SearchHit)
});
var SpaceRecipe = Struct({
  model: String4,
  revision: String4,
  dtype: String4,
  dims: Int2,
  runtime: String4,
  pooling: Literal2("mean"),
  normalize: Boolean3,
  queryPrefix: String4,
  chunkChars: Int2,
  chunkOverlap: Int2,
  turnChars: Int2,
  rendering: Int2
});
var Divergence = Struct({
  sessionId: String4,
  title: String4,
  heldFrom: String4,
  refusedFrom: String4,
  timeFirst: Int2,
  timeLast: Int2
});
var Rewind = Struct({
  sessionId: String4,
  source: String4,
  fromRevision: Int2,
  toRevision: Int2,
  time: Int2
});
var responses = {
  snapshot: Struct({ outcome: Literals(["archived", "rewound", "unchanged"]) }),
  tombstone: Struct({ removed: Boolean3 }),
  manifest: Manifest,
  search: Struct({ sessions: ArraySchema(SearchResult), semanticUnavailable: optionalKey2(String4) }),
  inspect: Union2([
    Missing,
    Struct({
      kind: Literal2("outline"),
      ...resolvedFields,
      messages: Int2,
      turns: ArraySchema(Struct({ messageId: String4, time: Int2, text: String4 }))
    }),
    Struct({
      kind: Literal2("matches"),
      ...resolvedFields,
      total: Int2,
      hits: ArraySchema(SearchHit),
      semanticUnavailable: optionalKey2(String4)
    })
  ]),
  expand: Union2([
    Missing,
    Struct({
      kind: Literal2("window"),
      ...resolvedFields,
      total: Int2,
      start: Int2,
      messages: ArraySchema(WindowMessage)
    })
  ]),
  transcript: Union2([
    Missing,
    Struct({
      kind: Literal2("transcript"),
      ...resolvedFields,
      contentHash: String4,
      messages: Int2,
      omitted: Int2,
      clipped: Int2,
      text: String4
    })
  ]),
  "summary.get": Union2([
    Missing,
    Struct({ kind: Literal2("absent"), ...resolvedFields }),
    Struct({
      kind: Literal2("cached"),
      ...resolvedFields,
      summary: String4,
      timeCreated: Int2,
      omitted: Int2,
      clipped: Int2
    })
  ]),
  "summary.put": Struct({}),
  status: Struct({
    sessions: Int2,
    chunks: Int2,
    embeddedChunks: Int2,
    activeSpace: Struct({ recipe: SpaceRecipe, matchesConfigured: Boolean3 }),
    sources: ArraySchema(Struct({ source: String4, archived: Int2, searchable: Int2, embedded: Int2 })),
    summaries: Int2,
    divergences: ArraySchema(Divergence),
    rewinds: Struct({ total: Int2, recent: ArraySchema(Rewind) })
  })
};
var utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")}Z`;
var divergenceRemedy = (d) => `rename the session on ${d.heldFrom} to keep the archived copy, or on ${d.refusedFrom} to archive ${d.refusedFrom}'s copy instead. ` + "The rename makes that host's next upload later than the held position, so it is accepted and the divergence clears; turns only the other copy holds stay out of the archive.";
function renderHubStatus(s) {
  const { recipe, matchesConfigured } = s.activeSpace;
  const lines = [
    `sessions archived: ${s.sessions}`,
    ...s.sources.map((c) => `  from ${c.source || "(no source)"}: ${c.archived} archived, ${c.searchable} searchable, ${c.embedded} embedded`),
    `chunks: ${s.chunks}, ${s.embeddedChunks} embedded, ${s.chunks - s.embeddedChunks} waiting to be embedded`,
    `vector space: ${recipe.model}@${recipe.revision.slice(0, 12)} (${recipe.dtype}, ${recipe.dims}d, rendering v${recipe.rendering})${matchesConfigured ? "" : "; differs from this hub's configured space, run reindex"}`,
    `cached summaries: ${s.summaries}`,
    `rewinds accepted: ${s.rewinds.total}`,
    ...s.rewinds.recent.map((r) => `  ${r.sessionId} from ${r.source}: revision ${r.fromRevision} -> ${r.toRevision} at ${utc(r.time)}`)
  ];
  if (!s.divergences.length)
    return [...lines, "hash_divergence: none"].join(`
`);
  return [
    ...lines,
    `hash_divergence: ${s.divergences.length} session${s.divergences.length === 1 ? "" : "s"} where two hosts hold different copies`,
    ...s.divergences.flatMap((d) => [
      `  ${d.sessionId} "${d.title}": archived copy from ${d.heldFrom}; ${d.refusedFrom}'s copy refused (first ${utc(d.timeFirst)}, latest ${utc(d.timeLast)})`,
      `    remedy: ${divergenceRemedy(d)}`
    ])
  ].join(`
`);
}
var ErrorCode = Literals([
  "invalid_token",
  "protocol_version",
  "invalid_request",
  "unknown_verb",
  "stale_revision",
  "hash_divergence",
  "tombstoned",
  "payload_too_large",
  "rate_limited",
  "request_timeout",
  "internal"
]);
var CODE_BY_STATUS = {
  408: "request_timeout",
  413: "payload_too_large",
  429: "rate_limited"
};

class HubError extends TaggedError3()("HubError", {
  code: ErrorCode,
  message: String4,
  status: Number5
}) {
}

class TransportError extends TaggedError3()("TransportError", {
  message: String4,
  cause: Defect()
}) {
}
var ErrorEnvelope = Struct({
  error: Struct({ code: optionalKey2(ErrorCode), message: optionalKey2(String4) })
});
var messageOf = (cause) => cause instanceof Error ? cause.message : String(cause);
var gzip = promisify(gzipCallback);
function normalizeFingerprint(fingerprint) {
  const hex = fingerprint.replace(/[\s:]/g, "").toUpperCase();
  return /^[0-9A-F]{64}$/.test(hex) ? hex.match(/../g).join(":") : undefined;
}
var mismatch = (got, pin) => new Error(`the hub's TLS certificate ${got ?? "(none)"} does not match the pinned ${pin}`);
var pinnedCertificates = new Map;
var readCertificate = (url, pin, signal) => new Promise((resolve, reject) => {
  const socket = connect({
    host: url.hostname,
    port: Number(url.port || 443),
    servername: isIP(url.hostname) ? undefined : url.hostname,
    rejectUnauthorized: false
  }, () => {
    const cert = socket.getPeerCertificate();
    socket.end();
    if (cert.fingerprint256 !== pin)
      return reject(mismatch(cert.fingerprint256, pin));
    resolve(`-----BEGIN CERTIFICATE-----
${cert.raw.toString("base64").replace(/.{64}/g, `$&
`)}
-----END CERTIFICATE-----
`);
  });
  socket.once("error", reject);
  socket.setTimeout(1e4, () => socket.destroy(new Error("TLS handshake with the hub timed out")));
  signal.addEventListener("abort", () => socket.destroy(new Error("aborted")), { once: true });
});
var pinnedTls = async (url, pin, signal) => {
  let pem = pinnedCertificates.get(pin);
  if (!pem) {
    pem = readCertificate(url, pin, signal);
    pinnedCertificates.set(pin, pem);
    pem.catch(() => pinnedCertificates.delete(pin));
  }
  return {
    ca: await pem,
    checkServerIdentity: (_host, cert) => cert.fingerprint256 === pin ? undefined : mismatch(cert.fingerprint256, pin)
  };
};
function makeClient({ url, token, certSha256, fetch: fetcher = fetch }) {
  const base = url.replace(/\/+$/, "");
  const parsed = new URL(base);
  const pin = parsed.protocol === "https:" ? certSha256 : undefined;
  const call = fnUntraced2(function* (verb, input) {
    const transport = (cause) => new TransportError({ message: messageOf(cause), cause });
    const gzipped = yield* tryPromise2({
      try: () => gzip(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...input })),
      catch: transport
    });
    const res = yield* tryPromise2({
      try: async (signal) => fetcher(`${base}/v1/${verb}`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-encoding": "gzip", authorization: `Bearer ${token}` },
        body: gzipped,
        signal,
        ...pin && { tls: await pinnedTls(parsed, pin, signal) }
      }),
      catch: transport
    });
    if (res.ok) {
      const body = yield* tryPromise2({ try: () => res.json(), catch: transport });
      const decoded = yield* decodeUnknownEffect2(responses[verb])(body).pipe(mapError3(transport));
      return decoded;
    }
    const body = yield* promise2(() => res.json().catch(() => null));
    const { error } = getOrElse(decodeUnknownOption2(ErrorEnvelope)(body), () => ({ error: {} }));
    return yield* new HubError({
      code: error.code ?? CODE_BY_STATUS[res.status] ?? "internal",
      message: error.message ?? `HTTP ${res.status}`,
      status: res.status
    });
  });
  return {
    snapshot: (snapshot) => call("snapshot", snapshot),
    tombstone: (tombstone) => call("tombstone", tombstone),
    manifest: () => call("manifest", {}),
    search: (search) => call("search", search),
    inspect: (inspect) => call("inspect", inspect),
    expand: (expand) => call("expand", expand),
    transcript: (transcript) => call("transcript", transcript),
    summaryGet: (key) => call("summary.get", key),
    summaryPut: (summary) => call("summary.put", summary),
    status: () => call("status", {})
  };
}

// packages/plugin/src/config.ts
var Hub = Struct({ url: String4, token: String4, certSha256: optionalKey2(String4) });
var NonEmptyString3 = String4.check(isNonEmpty());
var SummaryModel = Struct({
  providerID: NonEmptyString3,
  modelID: NonEmptyString3,
  variant: optionalKey2(NonEmptyString3)
});
var DEFAULT_SUMMARY_MODEL = { providerID: "openai", modelID: "gpt-5.6-luna", variant: "low" };
var File2 = Struct({
  hub: optionalKey2(Struct({
    url: optionalKey2(Unknown2),
    token: optionalKey2(Unknown2),
    certSha256: optionalKey2(Unknown2)
  })),
  summary: optionalKey2(Struct({ model: optionalKey2(Unknown2) })),
  index: optionalKey2(Struct({ excludeDirectories: optionalKey2(Unknown2) }))
});

class Invalid extends TaggedError3()("PluginConfig.Invalid", { message: String4 }) {
}
var invalid3 = (cause) => new Invalid({ message: cause instanceof Error ? cause.message : String(cause) });
var optional2 = (name) => option3(String5(name)).pipe(map8(getOrUndefined));
var filePath = optional2("XDG_CONFIG_HOME").pipe(map8((configHome) => join(configHome ?? join(homedir(), ".config"), "opencode", "recall.json")));
var isMissing = (e) => e instanceof Error && ("code" in e) && e.code === "ENOENT";
var readText = (path) => tryPromise2({
  try: () => Bun.file(path).text().catch((e) => isMissing(e) ? undefined : Promise.reject(e)),
  catch: invalid3
});
var parse = fnUntraced2(function* (text) {
  const json = text === undefined ? {} : yield* try_2({ try: () => JSON.parse(text), catch: invalid3 });
  return yield* decodeUnknownEffect2(File2)(json).pipe(mapError3(invalid3));
});
var readFile = (path) => flatMap3(readText(path), parse);
var stamp = (path) => tryPromise2({
  try: () => stat(path).then(({ mtimeMs, size }) => `${mtimeMs}:${size}`, (e) => isMissing(e) ? "missing" : Promise.reject(e)),
  catch: invalid3
});
var cachedRead = (path) => {
  let cached;
  return gen2(function* () {
    const current = yield* stamp(path);
    if (cached?.stamp !== current) {
      const text = yield* readText(path);
      cached = { stamp: current, read: yield* exit2(parse(text)) };
    }
    return yield* cached.read;
  });
};
var resolve3 = fnUntraced2(function* (path, read) {
  const { hub } = yield* read;
  const env = yield* all3({
    url: optional2("OPENCODE_RECALL_HUB_URL"),
    token: optional2("OPENCODE_RECALL_TOKEN"),
    certSha256: optional2("OPENCODE_RECALL_HUB_CERT_SHA256")
  }).pipe(mapError3(invalid3));
  const url = env.url || hub?.url;
  const token = env.token || hub?.token;
  const pin = env.certSha256 || hub?.certSha256;
  const from = (variable, fromEnv, fromFile) => fromEnv ? variable : fromFile ? path : "not set";
  const source = `hub.url: ${from("OPENCODE_RECALL_HUB_URL", env.url, hub?.url)}; hub.token: ${from("OPENCODE_RECALL_TOKEN", env.token, hub?.token)}`;
  if (!url || !token)
    return { hub: none2(), source };
  const decoded = yield* decodeUnknownEffect2(Hub)({ url, token, ...pin !== undefined && { certSha256: pin } }).pipe(mapError3(invalid3));
  if (decoded.certSha256 === undefined)
    return { hub: some2(decoded), source };
  const certSha256 = normalizeFingerprint(decoded.certSha256);
  if (!certSha256)
    return yield* invalid3(`hub.certSha256 ${JSON.stringify(decoded.certSha256)} is not a SHA-256 fingerprint`);
  if (!decoded.url.startsWith("https://"))
    return yield* invalid3(`hub.certSha256 is set, but hub.url ${decoded.url} is not https`);
  return {
    hub: some2({ ...decoded, certSha256 }),
    source: `${source}; hub.certSha256: ${from("OPENCODE_RECALL_HUB_CERT_SHA256", env.certSha256, hub?.certSha256)}`
  };
});
var load = fn2("PluginConfig.load")(function* (path) {
  return (yield* resolve3(path, readFile(path))).hub;
});
var VARIANTS = ["minimal", "none", "low", "medium", "high", "xhigh", "max", "thinking", "default"];
function parseModelSpec(spec) {
  const [providerID, ...rest] = spec.split("/").filter(Boolean);
  if (!providerID || !rest.length)
    return;
  const variant = rest.length > 1 ? rest.at(-1) : "";
  if (VARIANTS.includes(variant))
    return { providerID, modelID: rest.slice(0, -1).join("/"), variant };
  return { providerID, modelID: rest.join("/") };
}
var loadSummaryModel = fn2("PluginConfig.loadSummaryModel")(function* (path) {
  return yield* summaryModel(readFile(path));
});
var summaryModel = fnUntraced2(function* (read) {
  const env = yield* optional2("OPENCODE_RECALL_SUMMARY_MODEL").pipe(mapError3(invalid3));
  if (env) {
    const parsed = parseModelSpec(env);
    if (!parsed)
      return yield* invalid3(`OPENCODE_RECALL_SUMMARY_MODEL=${env} is not provider/model[/variant]`);
    return parsed;
  }
  const { summary } = yield* read;
  if (summary?.model === undefined)
    return DEFAULT_SUMMARY_MODEL;
  return yield* decodeUnknownEffect2(SummaryModel)(summary.model).pipe(mapError3(invalid3));
});
var expandRoot = (entry, home) => {
  const trimmed = entry.trim();
  if (trimmed === "~")
    return home;
  if (trimmed.startsWith(`~${sep}`))
    return resolvePath(home, trimmed.slice(2));
  return isAbsolute(trimmed) ? resolvePath(trimmed) : undefined;
};
var loadExcludeDirectories = fn2("PluginConfig.loadExcludeDirectories")(function* (path, home = homedir()) {
  return yield* excludeDirectories(readFile(path), home);
});
var excludeDirectories = fnUntraced2(function* (read, home = homedir()) {
  const { index } = yield* read;
  if (index?.excludeDirectories === undefined)
    return [];
  const entries = yield* decodeUnknownEffect2(ArraySchema(String4))(index.excludeDirectories).pipe(mapError3((e) => invalid3(`index.excludeDirectories: ${e.message}`)));
  const roots = new Set;
  for (const entry of entries) {
    const root = expandRoot(entry, home);
    if (root === undefined)
      return yield* invalid3(`index.excludeDirectories entry ${JSON.stringify(entry)} is not an absolute or ~/ path`);
    roots.add(root);
  }
  return [...roots];
});
var isExcluded = (roots, directory) => roots.some((root) => {
  const inner = relative(root, resolvePath(directory));
  return inner === "" || inner !== ".." && !inner.startsWith(`..${sep}`) && !isAbsolute(inner);
});

class Service2 extends Service()("@opencode-recall/plugin/PluginConfig") {
}
var layer2 = (path) => sync2(Service2, () => {
  const read = cachedRead(path);
  return Service2.of({
    file: path,
    hub: map6(resolve3(path, read), (r) => r.hub),
    hubSource: map6(resolve3(path, read), (r) => r.source),
    summaryModel: summaryModel(read),
    excludeDirectories: excludeDirectories(read)
  });
});

// packages/plugin/src/tools.ts
import { homedir as homedir2 } from "os";
class CouldNotLook extends TaggedError3()("Tools.CouldNotLook", { message: String4 }) {
}
var withHub = fnUntraced2(function* (call) {
  const hub = yield* (yield* Service2).hub.pipe(mapError3((e) => new CouldNotLook({ message: `recall could not look: the recall config is invalid (${e.message}). This is not an empty result.` })));
  if (isNone2(hub))
    return yield* new CouldNotLook({
      message: "recall could not look: no hub is configured. Set OPENCODE_RECALL_HUB_URL and OPENCODE_RECALL_TOKEN, or hub.url and hub.token in recall.json. This is not an empty result."
    });
  return yield* call(makeClient(hub.value)).pipe(mapError3((e) => new CouldNotLook({
    message: `recall could not look: the hub request failed (${e._tag === "HubError" ? `${e.code}: ${e.message}` : e.message}). This is not an empty result.`
  })));
});
var parseWhen = (s) => {
  const ms = s ? Date.parse(s) : NaN;
  return Number.isNaN(ms) ? undefined : ms;
};
var clampInt = (v, lo, hi, dflt) => v === undefined || !Number.isFinite(v) ? dflt : Math.max(lo, Math.min(Math.round(v), hi));
var pad = (n) => String(n).padStart(2, "0");
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(ms) {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
var home = homedir2();
var shortDir = (dir) => home && dir.startsWith(home) ? "~" + dir.slice(home.length) : dir;
var origin = (s) => `from ${s.source || "an unknown host"}${s.ownSource ? " (this host)" : ""}, archived revision ${s.revision}`;
function via(hit, parentId, scope) {
  if (hit.branch === "semantic")
    return `semantic ${hit.score.toFixed(2)} \xB7 ${scope === "user-messages" ? "Top-level user message" : "Conversation context (mixed origins)"}`;
  const kind = hit.kind === "tool" ? "Tool output" : hit.messageType === "user" ? parentId ? "Child user message" : "Top-level user message" : hit.messageType === "synthetic" ? "Synthetic context" : `${hit.messageType} text`;
  return `lexical/${hit.kind} \xB7 ${kind}`;
}
function header({ session: s, sameSlug }, ref, verb) {
  const note = sameSlug.length ? `NOTE: ${sameSlug.length + 1}+ sessions share slug '${ref}'; ${verb} the most recent. Others: ${sameSlug.map((o) => `${o.sessionId} (${o.title.slice(0, 40)}, ${fmtDate(o.timeUpdated)})`).join("; ")}
` : "";
  return `${note}# ${s.title || "(untitled)"}
session_id=${s.sessionId} slug=${s.slug} \xB7 ${shortDir(s.directory)} \xB7 ${fmtDate(s.timeCreated)} \u2192 ${fmtDate(s.timeUpdated)} \xB7 ${origin(s)}`;
}
var notFound2 = (ref) => `No archived session found for '${ref}'. A session appears once its host uploads a finished turn.`;

// packages/plugin/src/expand.ts
var Args = Struct({
  session_id: String4,
  message_id: optionalKey2(String4),
  window: optionalKey2(Number5),
  max_chars: optionalKey2(Number5)
});
var INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["session_id"],
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    message_id: {
      type: "string",
      description: "Center the window on this message (msg_...); defaults to the end of the session"
    },
    window: { type: "number", description: "Number of messages to include (default 12, max 60)" },
    max_chars: { type: "number", description: "Max characters per message (default 800, max 4000)" }
  }
};
var DESCRIPTION = "Read a transcript excerpt from a past OpenCode conversation found via recall_search, from any host sharing this recall hub. Given a session_id (or slug) and optionally a message_id to center on, returns the surrounding user/assistant turns with timestamps and one-line tool-call summaries.";
var BUDGET = 20000;
function toolLine({ tool, title, status, error }) {
  const line = `[tool ${tool}] ${title}`.trimEnd();
  if (status === "completed")
    return line;
  return status === "error" ? `${line} (failed: ${error || "no error message"})` : `${line} (${status})`;
}
function block(m) {
  const tools = [];
  let last = "";
  let count = 0;
  const flush = () => {
    if (count)
      tools.push(count > 1 ? `${last} (\xD7${count})` : last);
  };
  for (const line of m.tools.map(toolLine)) {
    if (line === last)
      count++;
    else {
      flush();
      last = line;
      count = 1;
    }
  }
  flush();
  const body = [...tools, m.text].filter(Boolean).join(`
`);
  return body ? `\u2500\u2500 ${m.type} @ ${fmtDateTime(m.time)} (${m.messageId})
${body}` : null;
}
var make16 = fnUntraced2(function* () {
  const execute = fn2("recall_expand")(function* (input) {
    const args = decodeUnknownResult2(Args)(input);
    if (isFailure2(args))
      return { content: `Invalid recall_expand arguments: ${args.failure.message}` };
    const { session_id: ref, message_id: messageId } = args.success;
    const window = clampInt(args.success.window, 2, 60, 12);
    const answer = yield* withHub((hub) => hub.expand({
      session: ref,
      messageId,
      window,
      maxChars: clampInt(args.success.max_chars, 100, 4000, 800)
    }));
    if (answer.kind !== "window")
      return { content: notFound2(ref) };
    if (!answer.total)
      return { content: `Session ${answer.session.sessionId} has no archived messages.` };
    const lines = [
      header(answer, ref, "showing"),
      `messages ${answer.start + 1}-${answer.start + answer.messages.length} of ${answer.total}`,
      ""
    ];
    let budget = BUDGET;
    for (const m of answer.messages) {
      const rendered = block(m);
      if (!rendered)
        continue;
      const text = `${rendered}
`;
      if (text.length > budget)
        break;
      budget -= text.length;
      lines.push(text);
    }
    lines.push(`(widen with window=${Math.min(window * 2, 60)} or center on another message_id)`);
    return { content: lines.join(`
`), metadata: { title: `recall: ${answer.session.title}` } };
  }, catchTag2("Tools.CouldNotLook", (e) => succeed6({ content: e.message })));
  const context = yield* context2();
  const info = {
    name: "recall_expand",
    description: DESCRIPTION,
    input: INPUT,
    options: { codemode: false },
    execute: (input) => runPromiseWith2(context)(execute(input))
  };
  return info;
});

// packages/plugin/src/source.ts
import { Database } from "bun:sqlite";
import { createHash } from "crypto";

// packages/plugin/src/extract.ts
var WORKER_PREFIX = "recall-summarizer worker: ";
var TOOL_TEXT_CHARS = 16000;
var UNSEARCHABLE_TOOLS = new Set([
  "recall_search",
  "recall_expand",
  "recall_inspect",
  "recall_status",
  "recall_summarize"
]);
var ANSI_RE = /[\u001b\u009b](?:\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\[[0-9;?]*[0-9A-ORZcf-nqry=><]|[()#][0-9A-Za-z])/g;
var stripAnsi = (text) => text.replace(ANSI_RE, "");
var isObject2 = (value) => typeof value === "object" && value !== null;
var nonBlank = (text) => typeof text === "string" && text.trim() !== "";
function toolTitle(input, metadata) {
  if (isObject2(metadata) && typeof metadata.title === "string")
    return metadata.title;
  if (!isObject2(input))
    return "";
  return Object.values(input).filter((v) => typeof v === "string").join(" ").slice(0, 200);
}
function toolOutput(content) {
  if (!Array.isArray(content))
    return "";
  return content.filter((c) => isObject2(c) && c.type === "text" && typeof c.text === "string").map((c) => c.text).join(`
`);
}
function toolPart(tool, title, status, output, error) {
  const body = status === "completed" ? output : error;
  const text = body === undefined ? "" : `${tool} ${title}
${stripAnsi(body)}`.slice(0, TOOL_TEXT_CHARS);
  return {
    kind: "tool",
    tool,
    title,
    status,
    ...error !== undefined && { error },
    text,
    searchable: !UNSEARCHABLE_TOOLS.has(tool) && text.trim() !== ""
  };
}
function assistantItem(item) {
  if (!isObject2(item))
    return [];
  if ((item.type === "text" || item.type === "reasoning") && nonBlank(item.text))
    return [{ kind: item.type, text: item.text }];
  if (item.type !== "tool" || typeof item.name !== "string")
    return [];
  const state = isObject2(item.state) ? item.state : {};
  const status = typeof state.status === "string" ? state.status : "unknown";
  const error = status === "error" && isObject2(state.error) ? state.error.message : undefined;
  return [
    toolPart(item.name, toolTitle(state.input, state.metadata), status, status === "completed" ? toolOutput(state.content) : "", typeof error === "string" ? error : undefined)
  ];
}
function extractParts(type, data) {
  switch (type) {
    case "user":
    case "synthetic":
      return nonBlank(data.text) ? [{ kind: "text", text: data.text }] : [];
    case "compaction":
      return data.status === "completed" && nonBlank(data.summary) ? [{ kind: "text", text: data.summary }] : [];
    case "shell": {
      const output = isObject2(data.output) ? data.output.output : undefined;
      const command = typeof data.command === "string" ? data.command : "";
      return [toolPart("shell", command, "completed", typeof output === "string" ? output : "")];
    }
    case "skill":
      return [
        toolPart("skill", typeof data.name === "string" ? data.name : "", "completed", typeof data.text === "string" ? data.text : "")
      ];
    case "assistant":
      return Array.isArray(data.content) ? data.content.flatMap(assistantItem) : [];
  }
}

// packages/plugin/src/source.ts
var EXTRACTOR_VERSION = 2;
var Position2 = Struct({ lastActivity: Int, revision: Int });
var isMessageType = is2(MessageType);
function toMessage(m) {
  const type = m.type;
  if (!isMessageType(type))
    return null;
  return { id: m.id, type, timeCreated: m.time_created, parts: extractParts(type, JSON.parse(m.data)) };
}
var UPLOADED = `substr(coalesce(s.title, ''), 1, ${WORKER_PREFIX.length}) <> '${WORKER_PREFIX}'`;
var POSITIONS = `SELECT * FROM (SELECT s.id AS sessionId, s.directory,
    coalesce((SELECT seq FROM event_sequence WHERE aggregate_id = s.id), 0) AS revision,
    max(s.time_updated, coalesce((SELECT max(time_created) FROM session_message WHERE session_id = s.id), 0))
      AS lastActivity
  FROM session_v2 s WHERE ${UPLOADED}) WHERE revision >= 0`;
function readPosition(db, sessionId) {
  const row = db.query(`${POSITIONS} AND sessionId = ?`).get(sessionId);
  return row && { revision: row.revision, lastActivity: row.lastActivity };
}
function readPositions(db) {
  const rows = db.query(POSITIONS).all();
  return new Map(rows.map(({ sessionId, directory, revision, lastActivity }) => [sessionId, { position: { revision, lastActivity }, directory }]));
}
function toSnapshot(position, session) {
  const contentHash = createHash("sha256").update(JSON.stringify(session)).digest("hex");
  return { session, ...position, contentHash, extractorVersion: EXTRACTOR_VERSION };
}
var CACHE_LIMITS = { sessions: 16, bytes: 64 * 1024 * 1024 };
function cachedSnapshots(db, limits = CACHE_LIMITS) {
  const entries = new Map;
  let held = 0;
  const forget = (sessionId) => {
    held -= entries.get(sessionId)?.bytes ?? 0;
    entries.delete(sessionId);
  };
  return (sessionId) => {
    const readAt = Date.now();
    return db.transaction(() => {
      const cached = entries.get(sessionId)?.messages;
      forget(sessionId);
      const position = readPosition(db, sessionId);
      const row = readSessionRow(db, sessionId);
      if (!position || !row)
        return null;
      const rows = db.query("SELECT id, type, time_created, time_updated FROM session_message WHERE session_id = ? ORDER BY seq").all(sessionId).filter((m) => isMessageType(m.type));
      const stale = rows.filter((m) => cached?.get(m.id)?.timeUpdated !== m.time_updated).map((m) => m.id);
      const fresh = new Map(db.query(`SELECT id, type, time_created, time_updated, data FROM session_message
               WHERE session_id = ? AND id IN (SELECT value FROM json_each(?))`).all(sessionId, JSON.stringify(stale)).flatMap((m) => {
        const extracted = toMessage(m);
        if (!extracted)
          return [];
        const message = structuredClone(extracted);
        return [[m.id, { message, timeUpdated: m.time_updated, bytes: JSON.stringify(message).length * 2 }]];
      }));
      const kept = new Map;
      const messages = rows.flatMap((m) => {
        const extracted = fresh.get(m.id) ?? cached?.get(m.id);
        if (!extracted)
          return [];
        if (extracted.timeUpdated < readAt)
          kept.set(m.id, extracted);
        return [extracted.message];
      });
      const bytes = [...kept.values()].reduce((sum, m) => sum + m.bytes, 0);
      if (bytes <= limits.bytes) {
        entries.set(sessionId, { messages: kept, bytes });
        held += bytes;
        for (const oldest of entries.keys()) {
          if (entries.size <= limits.sessions && held <= limits.bytes)
            break;
          forget(oldest);
        }
      }
      return toSnapshot(position, toSession(row, messages));
    })();
  };
}
function compactionBoundary(db, sessionId) {
  const row = db.query(`SELECT max(time_created) AS t FROM session_message
       WHERE session_id = ? AND type = 'compaction' AND json_extract(data, '$.status') = 'completed'`).get(sessionId);
  return row.t ?? 0;
}
function readSessionRow(db, sessionId) {
  return db.query(`SELECT id, slug, title, directory, parent_id, time_created, time_updated FROM session_v2 s
       WHERE ${UPLOADED} AND id = ?`).get(sessionId);
}
function toSession(row, messages) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title ?? "",
    directory: row.directory,
    parentId: row.parent_id,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    messages
  };
}

class Service3 extends Service()("@opencode-recall/plugin/Source") {
}
var fromDatabase = (db) => sync2(Service3, () => {
  const snapshot = cachedSnapshots(db);
  return Service3.of({
    position: (sessionId) => sync3(() => fromNullishOr(readPosition(db, sessionId))),
    positions: () => sync3(() => readPositions(db)),
    snapshot: (sessionId) => sync3(() => fromNullishOr(snapshot(sessionId))),
    compactionBoundary: (sessionId) => sync3(() => compactionBoundary(db, sessionId))
  });
});
var layer3 = (path) => unwrap(acquireRelease2(sync3(() => new Database(path, { readonly: true })), (db) => sync3(() => db.close())).pipe(map6(fromDatabase)));

// packages/plugin/src/inspect.ts
var Args2 = Struct({
  session_id: String4,
  query: optionalKey2(String4),
  scope: optionalKey2(Inspect.fields.scope.schema),
  mode: optionalKey2(Inspect.fields.mode.schema),
  include_tools: optionalKey2(Boolean3),
  limit: optionalKey2(Number5)
});
var INPUT2 = {
  type: "object",
  additionalProperties: false,
  required: ["session_id"],
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    query: { type: "string", description: "Search within the session (omit for a user-turn outline)" },
    scope: {
      type: "string",
      enum: ["all", "user-messages"],
      description: "Search scope in query mode: all (default), or top-level user messages without known synthetic context or child assignments."
    },
    mode: {
      type: "string",
      enum: ["hybrid", "lexical", "semantic"],
      description: "hybrid (default) fuses both; lexical = exact terms only; semantic = meaning only"
    },
    include_tools: {
      type: "boolean",
      description: "Include tool outputs (bash/file contents) in lexical matching (default true)"
    },
    limit: { type: "number", description: "Max hits in query mode (default 12, max 30)" }
  }
};
var DESCRIPTION2 = "Look inside ONE past session, from any host sharing this recall hub: the cheap, instant first stop after recall_search finds it, before reaching for recall_summarize. With a query: hybrid-search within that session, returning message-level hits in chronological order with message_ids ready for recall_expand. Without a query: an outline of the session's user turns (its intent skeleton). No worker model, no wait.";
function outline(answer, ref) {
  const line = (t, i) => `${i + 1}. ${fmtDateTime(t.time)} (${t.messageId}) ${t.text}`;
  const { turns } = answer;
  const toc = turns.length > 60 ? [
    ...turns.slice(0, 30).map(line),
    `[... ${turns.length - 60} turns omitted \u2014 search them with query=... ]`,
    ...turns.slice(-30).map((t, i) => line(t, turns.length - 30 + i))
  ] : turns.map(line);
  return [
    header(answer, ref, "inspecting"),
    `${answer.messages} messages \xB7 ${turns.length} user turns`,
    "",
    "USER TURNS:",
    ...toc,
    "",
    "Search within: query=...; read around a turn: recall_expand(session_id, message_id); whole-session story: recall_summarize."
  ].join(`
`);
}
var make17 = fnUntraced2(function* () {
  const source = yield* Service3;
  const execute = fn2("recall_inspect")(function* (input, ctx) {
    const args = decodeUnknownResult2(Args2)(input);
    if (isFailure2(args))
      return { content: `Invalid recall_inspect arguments: ${args.failure.message}` };
    const { session_id: ref, query } = args.success;
    const title = (t) => ({ title: `recall inspect: ${t}` });
    if (!query?.trim()) {
      if (args.success.scope === "user-messages")
        return { content: "scope=user-messages requires a query; omit scope for the standard user-turn outline." };
      const answer = yield* withHub((hub) => hub.inspect({ session: ref, limit: 12 }));
      if (answer.kind !== "outline")
        return { content: notFound2(ref) };
      return { content: outline(answer, ref), metadata: title(answer.session.title) };
    }
    const mode = args.success.mode ?? "hybrid";
    const scope = args.success.scope ?? "all";
    const request = {
      session: ref,
      query,
      mode,
      scope,
      includeTools: args.success.include_tools,
      limit: clampInt(args.success.limit, 1, 30, 12),
      exclude: { sessionId: ctx.sessionID, before: yield* source.compactionBoundary(ctx.sessionID) }
    };
    const answer = yield* withHub((hub) => hub.inspect(request));
    if (answer.kind !== "matches")
      return { content: notFound2(ref) };
    const { semanticUnavailable } = answer;
    if (semanticUnavailable !== undefined && mode === "semantic")
      return {
        content: `recall could not look: semantic search is unavailable (${semanticUnavailable}). Retry with mode=lexical or hybrid. This is not an empty result.`
      };
    const note = semanticUnavailable === undefined ? "" : `semantic search is unavailable (${semanticUnavailable}); these results are lexical only.
`;
    const head = note + header(answer, ref, "inspecting");
    if (!answer.hits.length)
      return {
        content: `${head}

No matches for "${query}" (${mode}, scope=${scope}) in this session. Likely not discussed in this session, or only in a turn not archived yet. Try different keywords, mode=semantic (unfiltered ranking), or omit query for a user-turn outline. User-message scope excludes child sessions.`
      };
    const lines = [
      head,
      `${answer.hits.length} of ${answer.total} matches for "${query}" (${mode}) \u2014 chronological:`,
      "",
      ...answer.hits.flatMap((h, i) => [
        `${i + 1}. ${fmtDateTime(h.time)} (${h.messageId})`,
        `   [${via(h, answer.session.parentId, scope)}] ${h.snippet}`
      ]),
      "",
      "Read around a hit: recall_expand(session_id, message_id). Escalate to recall_summarize only if this doesn't answer it."
    ];
    return { content: lines.join(`
`), metadata: title(answer.session.title) };
  }, catchTag2("Tools.CouldNotLook", (e) => succeed6({ content: e.message })));
  const context = yield* context2();
  const info = {
    name: "recall_inspect",
    description: DESCRIPTION2,
    input: INPUT2,
    options: { codemode: false },
    execute: (input, ctx) => runPromiseWith2(context)(execute(input, ctx))
  };
  return info;
});

// packages/plugin/src/instructions.ts
var TEXT = `# Persistent memory (recall)

Every past OpenCode conversation from every host sharing this recall hub is archived and searchable via the recall tools (\`recall_search\`, \`recall_inspect\`, \`recall_expand\`, \`recall_summarize\`, \`recall_status\`). This is your long-term memory: the sessions themselves are the record, so nothing needs to be saved or summarized. Treat searching it as part of the default workflow, not an optional tool.

- **Search before answering.** Whenever the user references prior work that isn't in your context (an existing project, bug, feature, decision, follow-up, or anything phrased in the past tense: "we discussed", "last time", "the X we built", "do you remember"), run \`recall_search\` before answering. The user will assume you remember; searching is how you do.
- **Check recall when troubleshooting.** Before digging into a bug, failure, or unexpected behavior, run one focused \`recall_search\` to see whether it has been investigated or fixed before. Prior sessions may contain the root cause, fix, or known dead ends. If that quick check produces no useful hit, move on with normal troubleshooting rather than spending time forcing recall to help.
- **Climb the ladder, cheapest rung first.** \`recall_search\` finds the session; \`recall_inspect\` finds where inside it (or outlines its user turns with no query); \`recall_expand\` reads the transcript around a hit. All three are instant; for a targeted question about a session, they usually answer it.
- When the user provides a \`ses_...\` ID for review, read that session with \`recall_expand\` directly.
- **Summarize is the escalation, not the default.** \`recall_summarize\` runs a worker model (10-30 s fresh). Reach for it only when inspect/expand can't answer cleanly, the session is too large to page, or you genuinely need the whole-session story. When you do, use a \`focus\` question, and batch several sessions in one \`session_ids\` call (they run concurrently; results are cached in the hub for every host).
- **Pick the right mode.** Default hybrid. Use \`lexical\` for exact identifiers, error strings, commands, and filenames; \`semantic\` for fuzzy "I know this came up before" recall. Scope with \`directory\`/\`since\`/\`until\` when the ask is scoped.
- **Filter by host with \`source\`.** \`source\` is a \`recall_search\` filter alongside \`directory\`, \`since\`, and \`until\`: pass a host name as results show it to search only sessions archived from that host.
- **Results name their origin.** Every result names the host its session was archived from (marked "this host" when it is yours) and the archived revision. A session's newest turn may not be archived yet, so the archive can trail what its host holds.
- **"Could not look" is not "nothing found".** A result that says recall could not look means the hub was unreachable, unconfigured, or refused the request, so no search happened. Never conclude from it that no prior work exists: retry, check \`recall_status\`, or tell the user recall is unavailable.
- **Hand back ses_ ids.** When the user asks you to find a session, give the bare \`ses_...\` id; sessions are continued in the TUI with \`opencode -s <id>\`.
- **Recover from compaction.** If this session was compacted and a detail seems missing, search for it; recall returns this session's own pre-compaction history, labeled as such.
- **Recalled context can be stale.** When a past conversation disagrees with the current state of code or config, trust the present, and say when an answer leans on recalled context.
- **Don't spam it.** Self-contained asks need no search; one well-chosen query beats several vague ones. Recall is a quick context check, not a detour from the task.`;
function inject(request) {
  request.system.push({ type: "text", text: TEXT });
}

// packages/plugin/src/search.ts
var Args3 = Struct({
  query: String4,
  scope: optionalKey2(Search.fields.scope.schema),
  mode: optionalKey2(Search.fields.mode.schema),
  directory: optionalKey2(String4),
  source: optionalKey2(String4),
  since: optionalKey2(String4),
  until: optionalKey2(String4),
  include_tools: optionalKey2(Boolean3),
  limit: optionalKey2(Number5)
});
var INPUT3 = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: {
    query: { type: "string", description: "Search query: natural language or exact keywords/identifiers" },
    scope: {
      type: "string",
      enum: ["all", "user-messages"],
      description: "Default all. Use user-messages to search top-level user text, excluding known synthetic context and child assignments."
    },
    mode: {
      type: "string",
      enum: ["hybrid", "lexical", "semantic"],
      description: "hybrid (default) fuses both; lexical = exact terms only; semantic = meaning only"
    },
    directory: {
      type: "string",
      description: "Substring filter on the session working directory, e.g. 'infrastructure' or 'Projects_personal'"
    },
    source: { type: "string", description: "Only sessions archived from this host, by the name shown in results" },
    since: { type: "string", description: "Only sessions after this ISO date, e.g. 2026-05-01" },
    until: { type: "string", description: "Only sessions before this ISO date" },
    include_tools: {
      type: "boolean",
      description: "Include tool outputs (bash/file contents) in lexical matching (default true)"
    },
    limit: { type: "number", description: "Max sessions returned (default 8, max 25)" }
  }
};
function render(sessions, scope, callerSessionId) {
  const lines = sessions.flatMap((s, i) => {
    const self = s.sessionId === callerSessionId ? " \u2190 THIS session, before its last compaction" : "";
    return [
      `${i + 1}. ${s.title || "(untitled)"} \u2014 ${fmtDate(s.timeUpdated)} \xB7 ${shortDir(s.directory)} \xB7 ${origin(s)}${self}`,
      `   session_id=${s.sessionId} message_id=${s.hits[0]?.messageId} matches(lex=${s.lexicalMatches},sem=${s.semanticMatches})`,
      ...s.hits.map((h) => `   [${via(h, s.parentId, scope)}] ${h.snippet}`)
    ];
  });
  return lines.join(`
`);
}
var DESCRIPTION3 = "Search ALL past OpenCode conversations from every host sharing this recall hub (every project, full history) with hybrid lexical (FTS5/BM25 over messages, reasoning, and tool outputs) + semantic (embedding) search. Use when the user references a previous discussion ('do you remember', 'we discussed', 'in another session'), or when past decisions, fixes, commands, or error messages would help. Also searches THIS session's history from before its last compaction, useful for recovering details lost to context compaction. Results name the host each session came from and its archived revision; the newest turn of a session may not be archived yet.";
var make18 = fnUntraced2(function* () {
  const source = yield* Service3;
  const execute = fn2("recall_search")(function* (input, ctx) {
    const args = decodeUnknownResult2(Args3)(input);
    if (isFailure2(args))
      return { content: `Invalid recall_search arguments: ${args.failure.message}` };
    const { query } = args.success;
    const mode = args.success.mode ?? "hybrid";
    const search = {
      query,
      mode,
      scope: args.success.scope,
      since: parseWhen(args.success.since),
      until: parseWhen(args.success.until),
      directory: args.success.directory,
      source: args.success.source,
      includeTools: args.success.include_tools,
      limit: clampInt(args.success.limit, 1, 25, 8),
      exclude: { sessionId: ctx.sessionID, before: yield* source.compactionBoundary(ctx.sessionID) }
    };
    const { sessions, semanticUnavailable } = yield* withHub((hub) => hub.search(search));
    if (semanticUnavailable !== undefined && mode === "semantic")
      return {
        content: `recall could not look: semantic search is unavailable (${semanticUnavailable}). Retry with mode=lexical or hybrid. This is not an empty result.`
      };
    const note = semanticUnavailable === undefined ? "" : `semantic search is unavailable (${semanticUnavailable}); these results are lexical only.
`;
    if (!sessions.length)
      return {
        content: `${note}No matches for "${query}" (${mode}, scope=${search.scope ?? "all"}). Try mode=semantic for fuzzy recall, fewer or different keywords, or drop filters.`
      };
    return { content: note + render(sessions, search.scope, ctx.sessionID), metadata: { title: `recall: ${query}` } };
  }, catchTag2("Tools.CouldNotLook", (e) => succeed6({ content: e.message })));
  const context = yield* context2();
  const info = {
    name: "recall_search",
    description: DESCRIPTION3,
    input: INPUT3,
    options: { codemode: false },
    execute: (input, ctx) => runPromiseWith2(context)(execute(input, ctx))
  };
  return info;
});

// packages/plugin/src/storage.ts
class Failed extends TaggedError3()("Storage.Failed", { message: String4, cause: Defect() }) {
}
var failed = (cause) => new Failed({ message: cause instanceof Error ? cause.message : String(cause), cause });
var PAGE = 1000;

class Service4 extends Service()("@opencode-recall/plugin/Storage") {
}
var fromDomain = (domain) => succeed5(Service4, Service4.of({
  get: fn2("Storage.get")(function* (key, schema) {
    const value = yield* tryPromise2({ try: () => domain.get(key), catch: failed });
    if (value === undefined)
      return;
    return yield* decodeUnknownEffect2(schema)(value).pipe(mapError3(failed));
  }),
  set: (key, value) => tryPromise2({ try: () => domain.set(key, value), catch: failed }),
  remove: (key) => tryPromise2({ try: () => domain.remove(key), catch: failed }),
  scan: fn2("Storage.scan")(function* (prefix, schema) {
    const decode = decodeUnknownExit2(schema);
    const found = [];
    let after;
    do {
      const page = yield* tryPromise2({ try: () => domain.scan({ prefix, after, limit: PAGE }), catch: failed });
      for (const { key, value } of page.entries)
        found.push({ key, value: yield* mapError3(decode(value), failed) });
      after = page.next;
    } while (after !== undefined);
    return found;
  })
}));

// packages/plugin/src/uploader.ts
var PAUSING = new Set(["invalid_token", "protocol_version"]);
var TERMINAL = new Set([
  "stale_revision",
  "hash_divergence",
  "tombstoned",
  "payload_too_large",
  "invalid_request",
  "unknown_verb"
]);
var RETRYABLE = new Set(["rate_limited", "request_timeout"]);
function classify(e) {
  if (!(e instanceof HubError))
    return "retry";
  if (PAUSING.has(e.code))
    return "pause";
  if (TERMINAL.has(e.code))
    return "terminal";
  if (RETRYABLE.has(e.code))
    return "retry";
  return e.status >= 500 ? "retry" : "terminal";
}
var describe = (e) => e instanceof HubError ? `${e.code}: ${e.message}` : e.message;
var DIRTY = "dirty/";
var DELETED = "deleted/";
var ACKED = "acked/";
var sessionPrefix = (sessionId) => `${DIRTY}${sessionId}/`;
var entryKey = (sessionId, p) => `${sessionPrefix(sessionId)}${p.lastActivity}-${p.revision}`;
var deletedPrefix = (sessionId) => `${DELETED}${sessionId}/`;
var later = (a, b) => a.lastActivity - b.lastActivity || a.revision - b.revision;
var keyCount = (value) => typeof value === "object" && value !== null ? Object.keys(value).length : 0;
var newestFirst = (sessions) => [...sessions].sort(([, a], [, b]) => later(b.position, a.position));
var Deletion = Struct({ revision: Tombstone.fields.revision, timeDeleted: Tombstone.fields.timeDeleted });
var Queued = Struct({ ...Deletion.fields, reason: Tombstone.fields.reason });

class Service5 extends Service()("@opencode-recall/plugin/Uploader") {
}
var defectMessage = (defect) => defect instanceof Error ? defect.message : String(defect);
var layer4 = ({
  quietMs = 2000,
  retryMs = 30000,
  probeIntervalMs = 30000,
  sweepIntervalMs = 300000,
  configPollMs = 5000,
  uploadIntervalMs = 500
} = {}) => effect(Service5, gen2(function* () {
  const source = yield* Service3;
  const storage = yield* Service4;
  const config = yield* Service2;
  const scope = yield* scope2;
  const due = new Set;
  const activity = new Map;
  const noteActivity = (sessionId, time) => activity.set(sessionId, Math.max(time, activity.get(sessionId) ?? time));
  const newestDue = () => {
    let newest;
    let latest = -Infinity;
    for (const sessionId of due) {
      const time = activity.get(sessionId) ?? 0;
      if (time > latest)
        [newest, latest] = [sessionId, time];
    }
    return newest;
  };
  let nextRequestAt = 0;
  const timers = yield* make13();
  const probing = yield* make12();
  const reconcileRetry = yield* make12();
  const sweeping = yield* make12();
  const draining = yield* make6(1);
  let pausedBy = null;
  let reconciling;
  let reconcileOnResume = false;
  let lastReconciled = null;
  let lastError = null;
  const warn = (message) => gen2(function* () {
    yield* logWarning(message);
    lastError = { message, time: yield* currentTimeMillis2 };
  });
  const logAndContinue = (message) => (self) => self.pipe(catch_2((e) => warn(message(describe(e)))), catchDefect2((defect) => warn(message(defectMessage(defect)))));
  const background = (effect2) => asVoid2(forkIn2(effect2, scope));
  const scanKept = fnUntraced2(function* (prefix, schema) {
    const decode = decodeUnknownOption2(schema);
    const kept = [];
    for (const { key, value } of yield* storage.scan(prefix, Unknown2)) {
      const decoded = decode(value);
      if (isSome2(decoded))
        kept.push({ key, value: decoded.value, excess: keyCount(value) > keyCount(decoded.value) });
      else {
        yield* warn(`dropped unreadable work-list entry ${key}: ${JSON.stringify(value)}`);
        yield* storage.remove(key);
      }
    }
    return kept;
  });
  const entries = (sessionId) => scanKept(sessionPrefix(sessionId), Position2).pipe(map6((found) => found.map(({ key, value }) => ({ key, position: value }))));
  const acknowledged = gen2(function* () {
    const held = new Map;
    for (const { key, value, excess } of yield* scanKept(ACKED, Position2)) {
      held.set(key.slice(ACKED.length), value);
      if (excess)
        yield* storage.set(key, value);
    }
    return held;
  });
  const schedule = (sessionId, ms) => asVoid2(run3(timers, sessionId, sleep2(ms).pipe(andThen2(sync3(() => due.add(sessionId))), andThen2(background(drain)))));
  const dueNow = (sessionId, work) => tap2(work, () => sync3(() => due.add(sessionId)));
  const markDirty = (sessionId, position) => storage.set(entryKey(sessionId, position), position).pipe(andThen2(sync3(() => noteActivity(sessionId, position.lastActivity))));
  const markDeleted = (sessionId, queued) => storage.set(`${deletedPrefix(sessionId)}${queued.timeDeleted}`, queued).pipe(andThen2(sync3(() => noteActivity(sessionId, queued.timeDeleted))));
  const recordAcked = fnUntraced2(function* (sessionId, position, held) {
    const current = held ?? (yield* storage.get(ACKED + sessionId, Position2));
    if (!current || later(position, current) > 0)
      yield* storage.set(ACKED + sessionId, { lastActivity: position.lastActivity, revision: position.revision });
  });
  const pause = (reason) => gen2(function* () {
    if (pausedBy === null)
      yield* warn(`uploads paused until configuration is fixed: ${reason}`);
    pausedBy = reason;
    yield* run2(probing, probeUntilResumed, { onlyIfMissing: true });
  });
  const probe = gen2(function* () {
    const hub = yield* config.hub;
    yield* config.excludeDirectories;
    if (isNone2(hub))
      return false;
    yield* makeClient(hub.value).status();
    return true;
  }).pipe(catch_2((e) => sync3(() => {
    if (e instanceof HubError && PAUSING.has(e.code))
      pausedBy = describe(e);
    return false;
  })));
  const probeUntilResumed = gen2(function* () {
    yield* probe.pipe(delay2(probeIntervalMs), repeat2({ until: (accepted) => accepted }));
    yield* logInfo("configuration accepted by the hub; uploads resumed");
    pausedBy = null;
    if (reconcileOnResume)
      yield* background(reconcile);
    yield* background(drain);
  });
  const acknowledge = fnUntraced2(function* (sessionId, sent) {
    for (const { key, position } of yield* entries(sessionId))
      if (later(position, sent) <= 0)
        yield* storage.remove(key);
    yield* recordAcked(sessionId, sent);
  });
  const exclude = fnUntraced2(function* (sessionId, revision) {
    const timeDeleted = yield* currentTimeMillis2;
    yield* markDeleted(sessionId, { revision, timeDeleted, reason: "excluded" });
  });
  const awaitTurn = gen2(function* () {
    const wait = nextRequestAt - (yield* currentTimeMillis2);
    if (wait > 0)
      yield* sleep2(wait);
  });
  const attempt = (sessionId, request) => request.pipe(ensuring2(flatMap3(currentTimeMillis2, (now) => sync3(() => nextRequestAt = now + uploadIntervalMs))), as2("done"), catch_2((e) => {
    const kind = classify(e);
    if (kind === "pause")
      return sync3(() => due.add(sessionId)).pipe(andThen2(pause(describe(e))), as2("pause"));
    if (kind === "retry")
      return warn(`upload of ${sessionId} failed, retrying: ${describe(e)}`).pipe(andThen2(schedule(sessionId, retryMs)), as2("retry"));
    return warn(`upload of ${sessionId} rejected and dropped: ${describe(e)}`).pipe(as2("done"));
  }));
  const sendTombstone = fnUntraced2(function* (client, sessionId, deletions) {
    const { value: deletion } = deletions.reduce((a, b) => b.value.timeDeleted > a.value.timeDeleted ? b : a);
    const pending = yield* entries(sessionId);
    const outcome = yield* attempt(sessionId, client.tombstone({ sessionId, ...deletion }));
    if (outcome !== "done")
      return outcome;
    for (const { key } of deletions)
      yield* storage.remove(key);
    yield* storage.remove(ACKED + sessionId);
    let reimported = false;
    for (const { key, position } of pending)
      if (position.lastActivity <= deletion.timeDeleted)
        yield* storage.remove(key);
      else
        reimported = true;
    if (reimported)
      yield* schedule(sessionId, quietMs);
    return outcome;
  });
  const send = fnUntraced2(function* (client, sessionId) {
    const deletions = yield* scanKept(deletedPrefix(sessionId), Queued);
    if (deletions.length > 0)
      return yield* sendTombstone(client, sessionId, deletions);
    const pending = yield* entries(sessionId);
    if (pending.length === 0)
      return "done";
    const snapshot = yield* source.snapshot(sessionId);
    const excluded = map6(config.excludeDirectories, (roots) => isSome2(snapshot) && isExcluded(roots, snapshot.value.session.directory));
    if (isNone2(snapshot) || (yield* excluded)) {
      for (const { key } of pending)
        yield* storage.remove(key);
      if (isSome2(snapshot) && (yield* storage.get(ACKED + sessionId, Position2))) {
        yield* exclude(sessionId, snapshot.value.revision);
        yield* schedule(sessionId, quietMs);
      }
      return "done";
    }
    const outcome = yield* attempt(sessionId, client.snapshot(snapshot.value));
    if (outcome !== "done")
      return outcome;
    yield* acknowledge(sessionId, snapshot.value);
    if (yield* excluded) {
      yield* exclude(sessionId, snapshot.value.revision);
      yield* schedule(sessionId, quietMs);
    }
    return outcome;
  });
  const pass = gen2(function* () {
    if (pausedBy !== null)
      return;
    const hub = yield* config.excludeDirectories.pipe(andThen2(config.hub), catch_2((e) => pause(`config could not be read: ${e.message}`).pipe(as2(undefined))));
    if (hub === undefined)
      return;
    if (isNone2(hub))
      return yield* pause("hub URL or token is not configured");
    const client = makeClient(hub.value);
    while (due.size > 0) {
      yield* awaitTurn;
      const sessionId = newestDue();
      if (sessionId === undefined)
        return;
      due.delete(sessionId);
      const retry = (reason) => warn(`upload of ${sessionId} failed, retrying: ${reason}`).pipe(andThen2(schedule(sessionId, retryMs)), as2("retry"));
      const outcome = yield* send(client, sessionId).pipe(catch_2((e) => retry(e.message)), catchDefect2((defect) => retry(defectMessage(defect))));
      if (outcome === "pause")
        return;
    }
  });
  const drain = gen2(function* () {
    const ran = yield* pass.pipe(draining.withPermitsIfAvailable(1));
    if (isSome2(ran) && due.size > 0 && pausedBy === null)
      yield* drain;
  });
  const queuedSessions = gen2(function* () {
    const ids = new Set;
    for (const { key } of yield* storage.scan(DIRTY, Unknown2))
      ids.add(key.slice(DIRTY.length, key.lastIndexOf("/")));
    for (const { key } of yield* storage.scan(DELETED, Unknown2))
      ids.add(key.slice(DELETED.length, key.lastIndexOf("/")));
    return ids;
  });
  const resume = gen2(function* () {
    const found = [
      ...(yield* scanKept(DIRTY, Position2)).map(({ key, value }) => ({ key, time: value.lastActivity })),
      ...(yield* scanKept(DELETED, Queued)).map(({ key, value }) => ({ key, time: value.timeDeleted }))
    ];
    for (const { key, time } of found) {
      const sessionId = key.slice(key.indexOf("/") + 1, key.lastIndexOf("/"));
      noteActivity(sessionId, time);
      due.add(sessionId);
    }
  });
  const sweep = gen2(function* () {
    const acked = yield* acknowledged;
    const roots = yield* config.excludeDirectories;
    const tombstoning = new Set((yield* storage.scan(DELETED, Unknown2)).map(({ key }) => key.split("/")[1]));
    for (const [sessionId, { position, directory }] of newestFirst(yield* source.positions())) {
      const held = acked.get(sessionId);
      if (isExcluded(roots, directory)) {
        if (held && !tombstoning.has(sessionId))
          yield* dueNow(sessionId, exclude(sessionId, position.revision));
        continue;
      }
      if (!held || later(position, held) > 0)
        yield* dueNow(sessionId, markDirty(sessionId, position));
    }
    if (due.size > 0)
      yield* background(drain);
  });
  const sweepForever = sweep.pipe(logAndContinue((reason) => `sweep failed: ${reason}`), delay2(sweepIntervalMs), repeat2(forever2));
  const diffManifest = gen2(function* () {
    const hub = yield* config.hub;
    if (isNone2(hub) || pausedBy !== null) {
      reconcileOnResume = true;
      if (isNone2(hub))
        yield* pause("hub URL or token is not configured");
      return;
    }
    const roots = yield* config.excludeDirectories;
    const manifest = yield* makeClient(hub.value).manifest();
    const held = new Map(manifest.sessions.map((s) => [s.sessionId, s]));
    const tombstones = new Map(manifest.tombstones.map((t) => [t.sessionId, t]));
    const acked = yield* acknowledged;
    const queued = new Map;
    for (const { key, value } of yield* scanKept(DIRTY, Position2)) {
      const sessionId = key.slice(DIRTY.length, key.lastIndexOf("/"));
      queued.set(sessionId, [...queued.get(sessionId) ?? [], { key, position: value }]);
    }
    for (const [sessionId, { position: local, directory }] of newestFirst(yield* source.positions())) {
      const tombstone = tombstones.get(sessionId);
      const hubCopy = held.get(sessionId);
      if (isExcluded(roots, directory)) {
        if (hubCopy !== undefined)
          yield* dueNow(sessionId, exclude(sessionId, local.revision));
        continue;
      }
      const current = !tombstone?.excludedByCaller && (tombstone !== undefined ? local.lastActivity <= tombstone.timeDeleted : hubCopy !== undefined && hubCopy.extractorVersion >= EXTRACTOR_VERSION && (later(local, hubCopy) <= 0 || getOrUndefined(yield* source.snapshot(sessionId))?.contentHash === hubCopy.contentHash));
      if (current) {
        for (const { key, position } of queued.get(sessionId) ?? [])
          if (later(position, local) <= 0)
            yield* storage.remove(key);
        yield* recordAcked(sessionId, local, acked.get(sessionId));
      } else
        yield* dueNow(sessionId, markDirty(sessionId, local));
    }
    if (due.size > 0)
      yield* background(drain);
    reconcileOnResume = false;
    lastReconciled = yield* currentTimeMillis2;
    yield* run2(sweeping, sweepForever, { onlyIfMissing: true });
  }).pipe(catch_2((e) => {
    if (classify(e) !== "pause")
      return retryReconcile(describe(e));
    reconcileOnResume = true;
    return pause(describe(e));
  }), catchDefect2((defect) => retryReconcile(defectMessage(defect))));
  const retryReconcile = (reason) => warn(`reconciliation failed, retrying: ${reason}`).pipe(andThen2(run2(reconcileRetry, delay2(reconcile, retryMs))), asVoid2);
  const reconcile = gen2(function* () {
    if (reconciling)
      return yield* _await(reconciling);
    const done = yield* make5();
    reconciling = done;
    const run = diffManifest.pipe(ensuring2(sync3(() => reconciling = undefined)), exit2, flatMap3((exit) => done3(done, exit)));
    yield* forkIn2(run, scope);
    yield* _await(done);
  });
  const reconcileAgain = gen2(function* () {
    if (reconciling)
      yield* _await(reconciling);
    yield* reconcile;
  });
  const exclusionsKey = config.excludeDirectories.pipe(map6((roots) => JSON.stringify(roots)), option2);
  let appliedExclusions = yield* exclusionsKey;
  const watchExclusions = gen2(function* () {
    const key = yield* exclusionsKey;
    if (isNone2(key) || getOrUndefined(appliedExclusions) === key.value)
      return;
    appliedExclusions = key;
    yield* logInfo(`excluded directories changed to ${key.value}; reconciling`);
    yield* reconcileAgain;
  }).pipe(delay2(configPollMs), repeat2(forever2));
  yield* forkIn2(watchExclusions, scope);
  yield* resume.pipe(logAndContinue((reason) => `work list could not be read: ${reason}`));
  yield* background(drain);
  return Service5.of({
    enqueue: (sessionId) => source.position(sessionId).pipe(flatMap3(match({
      onNone: () => void_3,
      onSome: (position) => markDirty(sessionId, position).pipe(andThen2(schedule(sessionId, quietMs)))
    })), logAndContinue((reason) => `could not record ${sessionId} as dirty: ${reason}`)),
    delete: (sessionId, deletion) => markDeleted(sessionId, { ...deletion, reason: "deleted" }).pipe(andThen2(schedule(sessionId, quietMs)), logAndContinue((reason) => `could not record ${sessionId} as deleted: ${reason}`)),
    reconcile,
    state: gen2(function* () {
      const queued = yield* queuedSessions;
      const acked = yield* acknowledged;
      const roots = yield* config.excludeDirectories.pipe(orElseSucceed2(() => []));
      let local = 0;
      let answered = 0;
      for (const [sessionId, { position, directory }] of yield* source.positions()) {
        if (isExcluded(roots, directory))
          continue;
        local++;
        const held = acked.get(sessionId);
        if (held && later(position, held) <= 0)
          answered++;
      }
      return {
        queued: queued.size,
        local,
        answered,
        reconciling: reconciling !== undefined,
        lastReconciled: fromNullishOr(lastReconciled),
        pausedBy: fromNullishOr(pausedBy),
        lastError: fromNullishOr(lastError)
      };
    })
  });
}));

// packages/plugin/src/status.ts
var INPUT4 = { type: "object", properties: {}, additionalProperties: false };
var DESCRIPTION4 = "Show recall's status in two parts. Host: hub reachability, upload queue, backfill progress, last error, excluded directories, and where the config came from. Hub: sessions per source host (archived, searchable, embedded), chunks waiting to be embedded, the vector space, cached summaries, rewinds, and any session two hosts hold different copies of. Use to check recall's health or to explain missing recall_* results.";
var indent = (text) => text.replace(/^/gm, "  ");
var make19 = fnUntraced2(function* () {
  const config = yield* Service2;
  const uploader = yield* Service5;
  const execute = fn2("recall_status")(function* () {
    const [hub, url, configSource, state, excluded] = yield* all2([
      result2(withHub((client) => client.status())),
      config.hub.pipe(map6(match({ onNone: () => "", onSome: (h) => ` at ${h.url}` })), orElseSucceed2(() => "")),
      config.hubSource.pipe(catch_2((e) => succeed6(`invalid (${e.message})`))),
      result2(uploader.state),
      result2(config.excludeDirectories)
    ], { concurrency: "unbounded" });
    const host = [`hub${url}: ${hub._tag === "Success" ? "reachable" : hub.failure.message}`, `config: ${configSource}`];
    if (state._tag === "Failure")
      host.push(`uploads: the work list could not be read (${state.failure.message})`);
    else {
      const s = state.success;
      const reconciled = s.reconciling ? "running" : match(s.lastReconciled, { onNone: () => "not completed yet", onSome: (t) => `last completed ${fmtDateTime(t)}` });
      host.push(`upload queue: ${s.queued} session${s.queued === 1 ? "" : "s"} waiting`, `backfill: ${s.answered} of ${s.local} eligible local sessions answered by the hub at their current position; reconciliation ${reconciled}`, ...match(s.pausedBy, { onNone: () => [], onSome: (reason) => [`uploads paused: ${reason}`] }), `last error: ${match(s.lastError, { onNone: () => "none", onSome: (e) => `${fmtDateTime(e.time)} ${e.message}` })}`);
    }
    host.push(excluded._tag === "Failure" ? `excluded directories: unreadable, so uploads are held (${excluded.failure.message})` : `excluded directories (index.excludeDirectories in ${config.file}): ${excluded.success.join(", ") || "none"}`);
    const hubSection = hub._tag === "Success" ? renderHubStatus(hub.success) : "unknown: the hub could not be asked, so nothing here means the archive is empty.";
    const reachable = hub._tag === "Success" ? "" : " \xB7 hub unreachable";
    return {
      content: `host
${indent(host.join(`
`))}

hub
${indent(hubSection)}`,
      metadata: { title: `recall status${reachable}` }
    };
  });
  const context = yield* context2();
  const info = {
    name: "recall_status",
    description: DESCRIPTION4,
    input: INPUT4,
    options: { codemode: false },
    execute: () => runPromiseWith2(context)(execute())
  };
  return info;
});

// packages/plugin/src/summarize.ts
var BATCH_MAX = 24;
var CONCURRENCY = 4;
var RECIPE = 1;
var BUDGET2 = 300000;
var MESSAGE_CHARS = 2000;
var TIMEOUT_MS = 180000;
var WORKER_SYSTEM = "You analyze recorded OpenCode agent session transcripts. Follow the task instructions in this message exactly, and answer ONLY from the transcript provided. No preamble.";
var TASK_FOCUSED = "Answer the question below using only the transcript. Be specific: name files, commands, ids, and decisions. If the transcript does not contain the answer, say so plainly.";
var TASK_GENERAL = "Produce a tight summary of the transcript structured as: Goal; What was done (bullets); Key decisions & why; Gotchas/discoveries; Final state; Loose ends. Be specific: name files, commands, and ids. At most 350 words.";
var Args4 = Struct({
  session_id: optionalKey2(String4),
  session_ids: optionalKey2(ArraySchema(String4)),
  focus: optionalKey2(String4),
  refresh: optionalKey2(Boolean3),
  providerID: optionalKey2(String4),
  modelID: optionalKey2(String4),
  variant: optionalKey2(String4)
});
var INPUT5 = {
  type: "object",
  additionalProperties: false,
  properties: {
    session_id: { type: "string", description: "Session id (ses_...) or slug from recall_search" },
    session_ids: {
      type: "array",
      items: { type: "string" },
      description: `Batch: several session ids/slugs summarized concurrently in one call (max ${BATCH_MAX})`
    },
    focus: {
      type: "string",
      description: "Optional question to answer from each session instead of a general summary, e.g. 'what did we decide about auth?'"
    },
    refresh: { type: "boolean", description: "Bypass the cache and re-summarize (default false)" },
    providerID: { type: "string", description: "Provider override (default from the recall config)" },
    modelID: { type: "string", description: "Model override (default from the recall config)" },
    variant: { type: "string", description: "Reasoning-effort variant override, or 'default' for the provider's own" }
  }
};
var DESCRIPTION5 = "ESCALATION rung: summarize entire past OpenCode sessions from any host sharing this recall hub (or answer a focused question about them) with a model this host has credentials for. Defaults to the summary model in the recall config (openai/gpt-5.6-luna at low reasoning unless configured otherwise); providerID, modelID, and variant may override that per call. Each fresh summary takes 10-30s, so try the instant tools first: recall_inspect to search within the session, recall_expand to read around a hit. Reach for this when inspection can't answer cleanly, the session is too large to page, or you genuinely need the whole-session story (results are cached in the hub, so repeats are instant from any host). Batch multiple sessions in one call via session_ids; they run concurrently.";
var truncation = ({ omitted, clipped }) => (omitted ? ` \xB7 ${omitted} messages omitted from the middle to fit ${BUDGET2} characters` : "") + (clipped ? ` \xB7 ${clipped} messages cut to ${MESSAGE_CHARS} characters` : "");

class Failed2 extends TaggedError3()("Summarize.Failed", { message: String4 }) {
}
var messageOf2 = (cause) => cause instanceof Error ? cause.message : String(cause);
var make20 = fnUntraced2(function* (generate) {
  const config = yield* Service2;
  const summarize = fnUntraced2(function* (ref, key, refresh, tag, permits) {
    const suffix = key.focus ? ` \xB7 focus: ${key.focus}` : "";
    let session = ref;
    if (!refresh) {
      const cached = yield* withHub((hub) => hub.summaryGet({ ...key, session: ref }));
      if (cached.kind === "missing")
        return notFound2(ref);
      if (cached.kind === "cached")
        return `${header(cached, ref, "summarizing")}
(cached ${fmtDateTime(cached.timeCreated)} \xB7 ${tag}${truncation(cached)}${suffix})

${cached.summary}`;
      session = cached.session.sessionId;
    }
    const fresh = yield* permits.withPermit(gen2(function* () {
      const transcript = yield* withHub((hub) => hub.transcript({ session, budget: BUDGET2, maxChars: MESSAGE_CHARS }));
      if (transcript.kind === "missing")
        return notFound2(ref);
      if (!transcript.text)
        return `${header(transcript, ref, "summarizing")}
Nothing to summarize: the archived session has no transcript content.`;
      const s = transcript.session;
      const prompt = [
        WORKER_SYSTEM,
        "",
        key.focus ? TASK_FOCUSED : TASK_GENERAL,
        "",
        ...key.focus ? [`QUESTION: ${key.focus}`, ""] : [],
        `SESSION: ${s.title} (${shortDir(s.directory)}, ${fmtDate(s.timeCreated)})`,
        "TRANSCRIPT:",
        transcript.text
      ].join(`
`);
      const started = yield* currentTimeMillis2;
      const model = { providerID: key.provider, id: key.model, ...key.variant !== undefined && { variant: key.variant } };
      const { text } = yield* tryPromise2({
        try: (signal) => generate.text({ prompt, model }, { signal }),
        catch: (e) => new Failed2({ message: messageOf2(e) })
      }).pipe(timeoutOrElse2({
        duration: TIMEOUT_MS,
        orElse: () => fail5(new Failed2({ message: `the model did not answer within ${TIMEOUT_MS / 1000}s` }))
      }));
      const summary = text.trim();
      if (!summary)
        return yield* new Failed2({ message: "the model returned no text" });
      const secs = ((yield* currentTimeMillis2) - started) / 1000;
      return { transcript, summary, secs };
    }));
    if (typeof fresh === "string")
      return fresh;
    const { transcript, summary, secs } = fresh;
    const s = transcript.session;
    const { omitted, clipped } = transcript;
    const put = { ...key, sessionId: s.sessionId, contentHash: transcript.contentHash, summary, omitted, clipped };
    const cachedNote = yield* withHub((hub) => hub.summaryPut(put).pipe(as2(""), catchIf2((e) => e._tag === "HubError" && e.code === "stale_revision", () => succeed6(" \xB7 not cached: the session advanced while it was summarized")))).pipe(catchTag2("Tools.CouldNotLook", (e) => succeed6(` \xB7 not cached: ${e.message}`)));
    const status = `(fresh \xB7 ${tag} \xB7 ${transcript.messages} messages${truncation(transcript)} \xB7 ${secs.toFixed(1)}s${suffix}${cachedNote})`;
    return `${header(transcript, ref, "summarizing")}
${status}

${summary}`;
  });
  const execute = fn2("recall_summarize")(function* (input, ctx) {
    const args = decodeUnknownResult2(Args4)(input);
    if (isFailure2(args))
      return { content: `Invalid recall_summarize arguments: ${args.failure.message}` };
    const { session_id, session_ids = [], focus = "", refresh = false } = args.success;
    const ids = [...new Set([session_id, ...session_ids].flatMap((id) => id?.trim() ? [id.trim()] : []))];
    if (!ids.length)
      return { content: "Provide session_id or session_ids." };
    if (ids.length > BATCH_MAX)
      return { content: `Too many sessions (${ids.length}); max ${BATCH_MAX} per call. Split into batches.` };
    const configured = yield* config.summaryModel.pipe(mapError3((e) => new CouldNotLook({ message: `recall_summarize: the recall config is invalid (${e.message}).` })));
    const provider = args.success.providerID?.trim() || configured.providerID;
    const model = args.success.modelID?.trim() || configured.modelID;
    const isConfigured = provider === configured.providerID && model === configured.modelID;
    const requested = args.success.variant?.trim() || (isConfigured ? configured.variant : undefined);
    const variant = requested && requested.toLowerCase() !== "default" ? requested : undefined;
    const key = { provider, model, ...variant && { variant }, focus: focus.trim(), recipe: RECIPE };
    const tag = `${provider}/${model}${variant ? `/${variant}` : ""}`;
    const permits = yield* make6(CONCURRENCY);
    let done = 0;
    const blocks = yield* forEach2(ids, (ref) => summarize(ref, key, refresh, tag, permits).pipe(catchTags2({
      "Tools.CouldNotLook": (e) => succeed6(`# ${ref}
${e.message}`),
      "Summarize.Failed": (e) => logWarning("summarize failed", ref, e.message).pipe(as2(`# ${ref}
Summarization failed with ${tag}: ${e.message}`))
    }), tap2(() => {
      done++;
      return ids.length > 1 ? promise2(() => ctx.progress({ title: `recall summarize: ${done}/${ids.length}` }).catch(() => {})) : void_3;
    })), { concurrency: "unbounded" });
    if (blocks.length === 1)
      return { content: blocks[0], metadata: { title: `recall summary: ${ids[0]}` } };
    return { content: blocks.join(`

---

`), metadata: { title: `recall summaries: ${blocks.length} sessions` } };
  }, catchTag2("Tools.CouldNotLook", (e) => succeed6({ content: e.message })));
  const context = yield* context2();
  const info = {
    name: "recall_summarize",
    description: DESCRIPTION5,
    input: INPUT5,
    options: { codemode: false },
    execute: (input, ctx) => runPromiseWith2(context)(execute(input, ctx), { signal: ctx.signal })
  };
  return info;
});

// packages/plugin/src/index.ts
var sourceDbPath = gen2(function* () {
  const explicit = yield* option3(String5("OPENCODE_RECALL_SOURCE_DB"));
  if (isSome2(explicit))
    return explicit.value;
  const data = yield* String5("XDG_DATA_HOME").pipe(withDefault3(join2(homedir3(), ".local", "share")));
  return join2(data, "opencode", "opencode.db");
});
var log = layer([make14(({ message }) => console.error(`opencode-recall: ${[message].flat().join(" ")}`))]);
var instances = new Set;
var oldest = () => {
  for (const ctx of instances)
    return ctx;
  throw new Error("no opencode-recall plugin instance is loaded");
};
var storage = {
  get: (key) => oldest().storage.get(key),
  set: (key, value) => oldest().storage.set(key, value),
  remove: (key) => oldest().storage.remove(key),
  scan: (options) => oldest().storage.scan(options)
};
var RELEVANT = new Set([
  "server.connected",
  "session.deleted",
  "session.execution.succeeded",
  "session.execution.failed",
  "session.execution.interrupted",
  "session.renamed",
  "session.moved"
]);

class Subscription extends Service()("@opencode-recall/plugin/Subscription") {
}
var subscription = effect(Subscription, gen2(function* () {
  const uploader = yield* Service5;
  const scope = yield* scope2;
  const following = yield* make12();
  const reconcile = asVoid2(forkIn2(uploader.reconcile, scope));
  const read = (ctx) => gen2(function* () {
    const abort = yield* acquireRelease2(sync3(() => new AbortController), (abort) => sync3(() => abort.abort()));
    yield* fromAsyncIterable2(ctx.event.subscribe({ signal: abort.signal }), (e) => e).pipe(filter4((event) => RELEVANT.has(event.type)), runForEach2((event) => gen2(function* () {
      if (event.type === "server.connected")
        yield* reconcile;
      if (event.type === "session.deleted")
        yield* uploader.delete(event.data.sessionID, { revision: event.durable.seq, timeDeleted: Math.ceil(event.created) });
      const changed = event.type === "session.execution.succeeded" || event.type === "session.execution.failed" || event.type === "session.execution.interrupted" && event.data.reason !== "shutdown" || event.type === "session.renamed" || event.type === "session.moved";
      if (changed)
        yield* uploader.enqueue(event.data.sessionID);
    })), catch_2((e) => logError("event stream failed:", e)));
  }).pipe(scoped2);
  return Subscription.of({
    follow: fn2("Subscription.follow")(function* (ctx) {
      yield* clear(following);
      yield* run2(following, read(ctx));
      yield* reconcile;
    })
  });
}));
var makeRuntime = () => make15(subscription.pipe(provideMerge(layer4()), provideMerge(unwrap(gen2(function* () {
  const source = layer3(yield* sourceDbPath);
  const config = layer2(yield* filePath);
  return mergeAll2(source, config, fromDomain(storage));
}))), provideMerge(log)));
var runtime;
var turn = Promise.resolve();
var serially = (change) => {
  const result = turn.then(change);
  turn = result.catch(() => {});
  return result;
};
var follow = (ctx) => Subscription.use((s) => s.follow(ctx));
var enter = async (ctx) => {
  instances.add(ctx);
  runtime ??= makeRuntime();
  if (oldest() === ctx)
    await runtime.runPromise(follow(ctx));
  return runtime;
};
var leave = async (ctx) => {
  if (!instances.has(ctx))
    return;
  if (instances.size === 1) {
    const last = runtime;
    runtime = undefined;
    await last?.dispose();
    instances.delete(ctx);
    return;
  }
  const followed = oldest() === ctx;
  instances.delete(ctx);
  if (followed && runtime)
    await runtime.runPromise(follow(oldest()));
};
var src_default = Plugin.define({
  id: "opencode-recall",
  setup: async (ctx) => {
    try {
      const shared = await serially(() => enter(ctx));
      const tools = await shared.runPromise(all2([make18(), make17(), make16(), make20(ctx.generate), make19()]));
      await ctx.tool.transform((editor) => {
        for (const tool of tools)
          editor.add(tool);
      });
      await ctx.session.hook("context", inject);
    } catch (e) {
      await serially(() => leave(ctx));
      throw e;
    }
    return () => serially(() => leave(ctx));
  }
});
export {
  src_default as default
};
