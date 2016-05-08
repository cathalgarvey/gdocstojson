"use strict";
(function() {

Error.stackTraceLimit = Infinity;

var $global, $module;
if (typeof window !== "undefined") { /* web page */
  $global = window;
} else if (typeof self !== "undefined") { /* web worker */
  $global = self;
} else if (typeof global !== "undefined") { /* Node.js */
  $global = global;
  $global.require = require;
} else { /* others (e.g. Nashorn) */
  $global = this;
}

if ($global === undefined || $global.Array === undefined) {
  throw new Error("no global object found");
}
if (typeof module !== "undefined") {
  $module = module;
}

var $packages = {}, $idCounter = 0;
var $keys = function(m) { return m ? Object.keys(m) : []; };
var $flushConsole = function() {};
var $throwRuntimeError; /* set by package "runtime" */
var $throwNilPointerError = function() { $throwRuntimeError("invalid memory address or nil pointer dereference"); };
var $call = function(fn, rcvr, args) { return fn.apply(rcvr, args); };
var $makeFunc = function(fn) { return function() { return fn(new ($sliceType($jsObjectPtr))($global.Array.prototype.slice.call(arguments, []))); } };

var $mapArray = function(array, f) {
  var newArray = new array.constructor(array.length);
  for (var i = 0; i < array.length; i++) {
    newArray[i] = f(array[i]);
  }
  return newArray;
};

var $methodVal = function(recv, name) {
  var vals = recv.$methodVals || {};
  recv.$methodVals = vals; /* noop for primitives */
  var f = vals[name];
  if (f !== undefined) {
    return f;
  }
  var method = recv[name];
  f = function() {
    $stackDepthOffset--;
    try {
      return method.apply(recv, arguments);
    } finally {
      $stackDepthOffset++;
    }
  };
  vals[name] = f;
  return f;
};

var $methodExpr = function(typ, name) {
  var method = typ.prototype[name];
  if (method.$expr === undefined) {
    method.$expr = function() {
      $stackDepthOffset--;
      try {
        if (typ.wrapped) {
          arguments[0] = new typ(arguments[0]);
        }
        return Function.call.apply(method, arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return method.$expr;
};

var $ifaceMethodExprs = {};
var $ifaceMethodExpr = function(name) {
  var expr = $ifaceMethodExprs["$" + name];
  if (expr === undefined) {
    expr = $ifaceMethodExprs["$" + name] = function() {
      $stackDepthOffset--;
      try {
        return Function.call.apply(arguments[0][name], arguments);
      } finally {
        $stackDepthOffset++;
      }
    };
  }
  return expr;
};

var $subslice = function(slice, low, high, max) {
  if (low < 0 || high < low || max < high || high > slice.$capacity || max > slice.$capacity) {
    $throwRuntimeError("slice bounds out of range");
  }
  var s = new slice.constructor(slice.$array);
  s.$offset = slice.$offset + low;
  s.$length = slice.$length - low;
  s.$capacity = slice.$capacity - low;
  if (high !== undefined) {
    s.$length = high - low;
  }
  if (max !== undefined) {
    s.$capacity = max - low;
  }
  return s;
};

var $sliceToArray = function(slice) {
  if (slice.$length === 0) {
    return [];
  }
  if (slice.$array.constructor !== Array) {
    return slice.$array.subarray(slice.$offset, slice.$offset + slice.$length);
  }
  return slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
};

var $decodeRune = function(str, pos) {
  var c0 = str.charCodeAt(pos);

  if (c0 < 0x80) {
    return [c0, 1];
  }

  if (c0 !== c0 || c0 < 0xC0) {
    return [0xFFFD, 1];
  }

  var c1 = str.charCodeAt(pos + 1);
  if (c1 !== c1 || c1 < 0x80 || 0xC0 <= c1) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xE0) {
    var r = (c0 & 0x1F) << 6 | (c1 & 0x3F);
    if (r <= 0x7F) {
      return [0xFFFD, 1];
    }
    return [r, 2];
  }

  var c2 = str.charCodeAt(pos + 2);
  if (c2 !== c2 || c2 < 0x80 || 0xC0 <= c2) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF0) {
    var r = (c0 & 0x0F) << 12 | (c1 & 0x3F) << 6 | (c2 & 0x3F);
    if (r <= 0x7FF) {
      return [0xFFFD, 1];
    }
    if (0xD800 <= r && r <= 0xDFFF) {
      return [0xFFFD, 1];
    }
    return [r, 3];
  }

  var c3 = str.charCodeAt(pos + 3);
  if (c3 !== c3 || c3 < 0x80 || 0xC0 <= c3) {
    return [0xFFFD, 1];
  }

  if (c0 < 0xF8) {
    var r = (c0 & 0x07) << 18 | (c1 & 0x3F) << 12 | (c2 & 0x3F) << 6 | (c3 & 0x3F);
    if (r <= 0xFFFF || 0x10FFFF < r) {
      return [0xFFFD, 1];
    }
    return [r, 4];
  }

  return [0xFFFD, 1];
};

var $encodeRune = function(r) {
  if (r < 0 || r > 0x10FFFF || (0xD800 <= r && r <= 0xDFFF)) {
    r = 0xFFFD;
  }
  if (r <= 0x7F) {
    return String.fromCharCode(r);
  }
  if (r <= 0x7FF) {
    return String.fromCharCode(0xC0 | r >> 6, 0x80 | (r & 0x3F));
  }
  if (r <= 0xFFFF) {
    return String.fromCharCode(0xE0 | r >> 12, 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
  }
  return String.fromCharCode(0xF0 | r >> 18, 0x80 | (r >> 12 & 0x3F), 0x80 | (r >> 6 & 0x3F), 0x80 | (r & 0x3F));
};

var $stringToBytes = function(str) {
  var array = new Uint8Array(str.length);
  for (var i = 0; i < str.length; i++) {
    array[i] = str.charCodeAt(i);
  }
  return array;
};

var $bytesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i += 10000) {
    str += String.fromCharCode.apply(undefined, slice.$array.subarray(slice.$offset + i, slice.$offset + Math.min(slice.$length, i + 10000)));
  }
  return str;
};

var $stringToRunes = function(str) {
  var array = new Int32Array(str.length);
  var rune, j = 0;
  for (var i = 0; i < str.length; i += rune[1], j++) {
    rune = $decodeRune(str, i);
    array[j] = rune[0];
  }
  return array.subarray(0, j);
};

var $runesToString = function(slice) {
  if (slice.$length === 0) {
    return "";
  }
  var str = "";
  for (var i = 0; i < slice.$length; i++) {
    str += $encodeRune(slice.$array[slice.$offset + i]);
  }
  return str;
};

var $copyString = function(dst, src) {
  var n = Math.min(src.length, dst.$length);
  for (var i = 0; i < n; i++) {
    dst.$array[dst.$offset + i] = src.charCodeAt(i);
  }
  return n;
};

var $copySlice = function(dst, src) {
  var n = Math.min(src.$length, dst.$length);
  $copyArray(dst.$array, src.$array, dst.$offset, src.$offset, n, dst.constructor.elem);
  return n;
};

var $copyArray = function(dst, src, dstOffset, srcOffset, n, elem) {
  if (n === 0 || (dst === src && dstOffset === srcOffset)) {
    return;
  }

  if (src.subarray) {
    dst.set(src.subarray(srcOffset, srcOffset + n), dstOffset);
    return;
  }

  switch (elem.kind) {
  case $kindArray:
  case $kindStruct:
    if (dst === src && dstOffset > srcOffset) {
      for (var i = n - 1; i >= 0; i--) {
        elem.copy(dst[dstOffset + i], src[srcOffset + i]);
      }
      return;
    }
    for (var i = 0; i < n; i++) {
      elem.copy(dst[dstOffset + i], src[srcOffset + i]);
    }
    return;
  }

  if (dst === src && dstOffset > srcOffset) {
    for (var i = n - 1; i >= 0; i--) {
      dst[dstOffset + i] = src[srcOffset + i];
    }
    return;
  }
  for (var i = 0; i < n; i++) {
    dst[dstOffset + i] = src[srcOffset + i];
  }
};

var $clone = function(src, type) {
  var clone = type.zero();
  type.copy(clone, src);
  return clone;
};

var $pointerOfStructConversion = function(obj, type) {
  if(obj.$proxies === undefined) {
    obj.$proxies = {};
    obj.$proxies[obj.constructor.string] = obj;
  }
  var proxy = obj.$proxies[type.string];
  if (proxy === undefined) {
    var properties = {};
    for (var i = 0; i < type.elem.fields.length; i++) {
      (function(fieldProp) {
        properties[fieldProp] = {
          get: function() { return obj[fieldProp]; },
          set: function(value) { obj[fieldProp] = value; }
        };
      })(type.elem.fields[i].prop);
    }
    proxy = Object.create(type.prototype, properties);
    proxy.$val = proxy;
    obj.$proxies[type.string] = proxy;
    proxy.$proxies = obj.$proxies;
  }
  return proxy;
};

var $append = function(slice) {
  return $internalAppend(slice, arguments, 1, arguments.length - 1);
};

var $appendSlice = function(slice, toAppend) {
  if (toAppend.constructor === String) {
    var bytes = $stringToBytes(toAppend);
    return $internalAppend(slice, bytes, 0, bytes.length);
  }
  return $internalAppend(slice, toAppend.$array, toAppend.$offset, toAppend.$length);
};

var $internalAppend = function(slice, array, offset, length) {
  if (length === 0) {
    return slice;
  }

  var newArray = slice.$array;
  var newOffset = slice.$offset;
  var newLength = slice.$length + length;
  var newCapacity = slice.$capacity;

  if (newLength > newCapacity) {
    newOffset = 0;
    newCapacity = Math.max(newLength, slice.$capacity < 1024 ? slice.$capacity * 2 : Math.floor(slice.$capacity * 5 / 4));

    if (slice.$array.constructor === Array) {
      newArray = slice.$array.slice(slice.$offset, slice.$offset + slice.$length);
      newArray.length = newCapacity;
      var zero = slice.constructor.elem.zero;
      for (var i = slice.$length; i < newCapacity; i++) {
        newArray[i] = zero();
      }
    } else {
      newArray = new slice.$array.constructor(newCapacity);
      newArray.set(slice.$array.subarray(slice.$offset, slice.$offset + slice.$length));
    }
  }

  $copyArray(newArray, array, newOffset + slice.$length, offset, length, slice.constructor.elem);

  var newSlice = new slice.constructor(newArray);
  newSlice.$offset = newOffset;
  newSlice.$length = newLength;
  newSlice.$capacity = newCapacity;
  return newSlice;
};

var $equal = function(a, b, type) {
  if (type === $jsObjectPtr) {
    return a === b;
  }
  switch (type.kind) {
  case $kindComplex64:
  case $kindComplex128:
    return a.$real === b.$real && a.$imag === b.$imag;
  case $kindInt64:
  case $kindUint64:
    return a.$high === b.$high && a.$low === b.$low;
  case $kindArray:
    if (a.length !== b.length) {
      return false;
    }
    for (var i = 0; i < a.length; i++) {
      if (!$equal(a[i], b[i], type.elem)) {
        return false;
      }
    }
    return true;
  case $kindStruct:
    for (var i = 0; i < type.fields.length; i++) {
      var f = type.fields[i];
      if (!$equal(a[f.prop], b[f.prop], f.typ)) {
        return false;
      }
    }
    return true;
  case $kindInterface:
    return $interfaceIsEqual(a, b);
  default:
    return a === b;
  }
};

var $interfaceIsEqual = function(a, b) {
  if (a === $ifaceNil || b === $ifaceNil) {
    return a === b;
  }
  if (a.constructor !== b.constructor) {
    return false;
  }
  if (a.constructor === $jsObjectPtr) {
    return a.object === b.object;
  }
  if (!a.constructor.comparable) {
    $throwRuntimeError("comparing uncomparable type " + a.constructor.string);
  }
  return $equal(a.$val, b.$val, a.constructor);
};

var $min = Math.min;
var $mod = function(x, y) { return x % y; };
var $parseInt = parseInt;
var $parseFloat = function(f) {
  if (f !== undefined && f !== null && f.constructor === Number) {
    return f;
  }
  return parseFloat(f);
};

var $froundBuf = new Float32Array(1);
var $fround = Math.fround || function(f) {
  $froundBuf[0] = f;
  return $froundBuf[0];
};

var $imul = Math.imul || function(a, b) {
  var ah = (a >>> 16) & 0xffff;
  var al = a & 0xffff;
  var bh = (b >>> 16) & 0xffff;
  var bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0) >> 0);
};

var $floatKey = function(f) {
  if (f !== f) {
    $idCounter++;
    return "NaN$" + $idCounter;
  }
  return String(f);
};

var $flatten64 = function(x) {
  return x.$high * 4294967296 + x.$low;
};

var $shiftLeft64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high << y | x.$low >>> (32 - y), (x.$low << y) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$low << (y - 32), 0);
  }
  return new x.constructor(0, 0);
};

var $shiftRightInt64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(x.$high >> 31, (x.$high >> (y - 32)) >>> 0);
  }
  if (x.$high < 0) {
    return new x.constructor(-1, 4294967295);
  }
  return new x.constructor(0, 0);
};

var $shiftRightUint64 = function(x, y) {
  if (y === 0) {
    return x;
  }
  if (y < 32) {
    return new x.constructor(x.$high >>> y, (x.$low >>> y | x.$high << (32 - y)) >>> 0);
  }
  if (y < 64) {
    return new x.constructor(0, x.$high >>> (y - 32));
  }
  return new x.constructor(0, 0);
};

var $mul64 = function(x, y) {
  var high = 0, low = 0;
  if ((y.$low & 1) !== 0) {
    high = x.$high;
    low = x.$low;
  }
  for (var i = 1; i < 32; i++) {
    if ((y.$low & 1<<i) !== 0) {
      high += x.$high << i | x.$low >>> (32 - i);
      low += (x.$low << i) >>> 0;
    }
  }
  for (var i = 0; i < 32; i++) {
    if ((y.$high & 1<<i) !== 0) {
      high += x.$low << i;
    }
  }
  return new x.constructor(high, low);
};

var $div64 = function(x, y, returnRemainder) {
  if (y.$high === 0 && y.$low === 0) {
    $throwRuntimeError("integer divide by zero");
  }

  var s = 1;
  var rs = 1;

  var xHigh = x.$high;
  var xLow = x.$low;
  if (xHigh < 0) {
    s = -1;
    rs = -1;
    xHigh = -xHigh;
    if (xLow !== 0) {
      xHigh--;
      xLow = 4294967296 - xLow;
    }
  }

  var yHigh = y.$high;
  var yLow = y.$low;
  if (y.$high < 0) {
    s *= -1;
    yHigh = -yHigh;
    if (yLow !== 0) {
      yHigh--;
      yLow = 4294967296 - yLow;
    }
  }

  var high = 0, low = 0, n = 0;
  while (yHigh < 2147483648 && ((xHigh > yHigh) || (xHigh === yHigh && xLow > yLow))) {
    yHigh = (yHigh << 1 | yLow >>> 31) >>> 0;
    yLow = (yLow << 1) >>> 0;
    n++;
  }
  for (var i = 0; i <= n; i++) {
    high = high << 1 | low >>> 31;
    low = (low << 1) >>> 0;
    if ((xHigh > yHigh) || (xHigh === yHigh && xLow >= yLow)) {
      xHigh = xHigh - yHigh;
      xLow = xLow - yLow;
      if (xLow < 0) {
        xHigh--;
        xLow += 4294967296;
      }
      low++;
      if (low === 4294967296) {
        high++;
        low = 0;
      }
    }
    yLow = (yLow >>> 1 | yHigh << (32 - 1)) >>> 0;
    yHigh = yHigh >>> 1;
  }

  if (returnRemainder) {
    return new x.constructor(xHigh * rs, xLow * rs);
  }
  return new x.constructor(high * s, low * s);
};

var $divComplex = function(n, d) {
  var ninf = n.$real === Infinity || n.$real === -Infinity || n.$imag === Infinity || n.$imag === -Infinity;
  var dinf = d.$real === Infinity || d.$real === -Infinity || d.$imag === Infinity || d.$imag === -Infinity;
  var nnan = !ninf && (n.$real !== n.$real || n.$imag !== n.$imag);
  var dnan = !dinf && (d.$real !== d.$real || d.$imag !== d.$imag);
  if(nnan || dnan) {
    return new n.constructor(NaN, NaN);
  }
  if (ninf && !dinf) {
    return new n.constructor(Infinity, Infinity);
  }
  if (!ninf && dinf) {
    return new n.constructor(0, 0);
  }
  if (d.$real === 0 && d.$imag === 0) {
    if (n.$real === 0 && n.$imag === 0) {
      return new n.constructor(NaN, NaN);
    }
    return new n.constructor(Infinity, Infinity);
  }
  var a = Math.abs(d.$real);
  var b = Math.abs(d.$imag);
  if (a <= b) {
    var ratio = d.$real / d.$imag;
    var denom = d.$real * ratio + d.$imag;
    return new n.constructor((n.$real * ratio + n.$imag) / denom, (n.$imag * ratio - n.$real) / denom);
  }
  var ratio = d.$imag / d.$real;
  var denom = d.$imag * ratio + d.$real;
  return new n.constructor((n.$imag * ratio + n.$real) / denom, (n.$imag - n.$real * ratio) / denom);
};

var $kindBool = 1;
var $kindInt = 2;
var $kindInt8 = 3;
var $kindInt16 = 4;
var $kindInt32 = 5;
var $kindInt64 = 6;
var $kindUint = 7;
var $kindUint8 = 8;
var $kindUint16 = 9;
var $kindUint32 = 10;
var $kindUint64 = 11;
var $kindUintptr = 12;
var $kindFloat32 = 13;
var $kindFloat64 = 14;
var $kindComplex64 = 15;
var $kindComplex128 = 16;
var $kindArray = 17;
var $kindChan = 18;
var $kindFunc = 19;
var $kindInterface = 20;
var $kindMap = 21;
var $kindPtr = 22;
var $kindSlice = 23;
var $kindString = 24;
var $kindStruct = 25;
var $kindUnsafePointer = 26;

var $methodSynthesizers = [];
var $addMethodSynthesizer = function(f) {
  if ($methodSynthesizers === null) {
    f();
    return;
  }
  $methodSynthesizers.push(f);
};
var $synthesizeMethods = function() {
  $methodSynthesizers.forEach(function(f) { f(); });
  $methodSynthesizers = null;
};

var $ifaceKeyFor = function(x) {
  if (x === $ifaceNil) {
    return 'nil';
  }
  var c = x.constructor;
  return c.string + '$' + c.keyFor(x.$val);
};

var $identity = function(x) { return x; };

var $typeIDCounter = 0;

var $idKey = function(x) {
  if (x.$id === undefined) {
    $idCounter++;
    x.$id = $idCounter;
  }
  return String(x.$id);
};

var $newType = function(size, kind, string, name, pkg, constructor) {
  var typ;
  switch(kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $identity;
    break;

  case $kindString:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return "$" + x; };
    break;

  case $kindFloat32:
  case $kindFloat64:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = function(x) { return $floatKey(x); };
    break;

  case $kindInt64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindUint64:
    typ = function(high, low) {
      this.$high = (high + Math.floor(Math.ceil(low) / 4294967296)) >>> 0;
      this.$low = low >>> 0;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$high + "$" + x.$low; };
    break;

  case $kindComplex64:
    typ = function(real, imag) {
      this.$real = $fround(real);
      this.$imag = $fround(imag);
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindComplex128:
    typ = function(real, imag) {
      this.$real = real;
      this.$imag = imag;
      this.$val = this;
    };
    typ.keyFor = function(x) { return x.$real + "$" + x.$imag; };
    break;

  case $kindArray:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, "", "", function(array) {
      this.$get = function() { return array; };
      this.$set = function(v) { typ.copy(this, v); };
      this.$val = array;
    });
    typ.init = function(elem, len) {
      typ.elem = elem;
      typ.len = len;
      typ.comparable = elem.comparable;
      typ.keyFor = function(x) {
        return Array.prototype.join.call($mapArray(x, function(e) {
          return String(elem.keyFor(e)).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }), "$");
      };
      typ.copy = function(dst, src) {
        $copyArray(dst, src, 0, 0, src.length, elem);
      };
      typ.ptr.init(typ);
      Object.defineProperty(typ.ptr.nil, "nilCheck", { get: $throwNilPointerError });
    };
    break;

  case $kindChan:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.keyFor = $idKey;
    typ.init = function(elem, sendOnly, recvOnly) {
      typ.elem = elem;
      typ.sendOnly = sendOnly;
      typ.recvOnly = recvOnly;
    };
    break;

  case $kindFunc:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(params, results, variadic) {
      typ.params = params;
      typ.results = results;
      typ.variadic = variadic;
      typ.comparable = false;
    };
    break;

  case $kindInterface:
    typ = { implementedBy: {}, missingMethodFor: {} };
    typ.keyFor = $ifaceKeyFor;
    typ.init = function(methods) {
      typ.methods = methods;
      methods.forEach(function(m) {
        $ifaceNil[m.prop] = $throwNilPointerError;
      });
    };
    break;

  case $kindMap:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.init = function(key, elem) {
      typ.key = key;
      typ.elem = elem;
      typ.comparable = false;
    };
    break;

  case $kindPtr:
    typ = constructor || function(getter, setter, target) {
      this.$get = getter;
      this.$set = setter;
      this.$target = target;
      this.$val = this;
    };
    typ.keyFor = $idKey;
    typ.init = function(elem) {
      typ.elem = elem;
      typ.wrapped = (elem.kind === $kindArray);
      typ.nil = new typ($throwNilPointerError, $throwNilPointerError);
    };
    break;

  case $kindSlice:
    typ = function(array) {
      if (array.constructor !== typ.nativeArray) {
        array = new typ.nativeArray(array);
      }
      this.$array = array;
      this.$offset = 0;
      this.$length = array.length;
      this.$capacity = array.length;
      this.$val = this;
    };
    typ.init = function(elem) {
      typ.elem = elem;
      typ.comparable = false;
      typ.nativeArray = $nativeArray(elem.kind);
      typ.nil = new typ([]);
    };
    break;

  case $kindStruct:
    typ = function(v) { this.$val = v; };
    typ.wrapped = true;
    typ.ptr = $newType(4, $kindPtr, "*" + string, "", "", constructor);
    typ.ptr.elem = typ;
    typ.ptr.prototype.$get = function() { return this; };
    typ.ptr.prototype.$set = function(v) { typ.copy(this, v); };
    typ.init = function(fields) {
      typ.fields = fields;
      fields.forEach(function(f) {
        if (!f.typ.comparable) {
          typ.comparable = false;
        }
      });
      typ.keyFor = function(x) {
        var val = x.$val;
        return $mapArray(fields, function(f) {
          return String(f.typ.keyFor(val[f.prop])).replace(/\\/g, "\\\\").replace(/\$/g, "\\$");
        }).join("$");
      };
      typ.copy = function(dst, src) {
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          switch (f.typ.kind) {
          case $kindArray:
          case $kindStruct:
            f.typ.copy(dst[f.prop], src[f.prop]);
            continue;
          default:
            dst[f.prop] = src[f.prop];
            continue;
          }
        }
      };
      /* nil value */
      var properties = {};
      fields.forEach(function(f) {
        properties[f.prop] = { get: $throwNilPointerError, set: $throwNilPointerError };
      });
      typ.ptr.nil = Object.create(constructor.prototype, properties);
      typ.ptr.nil.$val = typ.ptr.nil;
      /* methods for embedded fields */
      $addMethodSynthesizer(function() {
        var synthesizeMethod = function(target, m, f) {
          if (target.prototype[m.prop] !== undefined) { return; }
          target.prototype[m.prop] = function() {
            var v = this.$val[f.prop];
            if (f.typ === $jsObjectPtr) {
              v = new $jsObjectPtr(v);
            }
            if (v.$val === undefined) {
              v = new f.typ(v);
            }
            return v[m.prop].apply(v, arguments);
          };
        };
        fields.forEach(function(f) {
          if (f.name === "") {
            $methodSet(f.typ).forEach(function(m) {
              synthesizeMethod(typ, m, f);
              synthesizeMethod(typ.ptr, m, f);
            });
            $methodSet($ptrType(f.typ)).forEach(function(m) {
              synthesizeMethod(typ.ptr, m, f);
            });
          }
        });
      });
    };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  switch (kind) {
  case $kindBool:
  case $kindMap:
    typ.zero = function() { return false; };
    break;

  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8 :
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindUnsafePointer:
  case $kindFloat32:
  case $kindFloat64:
    typ.zero = function() { return 0; };
    break;

  case $kindString:
    typ.zero = function() { return ""; };
    break;

  case $kindInt64:
  case $kindUint64:
  case $kindComplex64:
  case $kindComplex128:
    var zero = new typ(0, 0);
    typ.zero = function() { return zero; };
    break;

  case $kindPtr:
  case $kindSlice:
    typ.zero = function() { return typ.nil; };
    break;

  case $kindChan:
    typ.zero = function() { return $chanNil; };
    break;

  case $kindFunc:
    typ.zero = function() { return $throwNilPointerError; };
    break;

  case $kindInterface:
    typ.zero = function() { return $ifaceNil; };
    break;

  case $kindArray:
    typ.zero = function() {
      var arrayClass = $nativeArray(typ.elem.kind);
      if (arrayClass !== Array) {
        return new arrayClass(typ.len);
      }
      var array = new Array(typ.len);
      for (var i = 0; i < typ.len; i++) {
        array[i] = typ.elem.zero();
      }
      return array;
    };
    break;

  case $kindStruct:
    typ.zero = function() { return new typ.ptr(); };
    break;

  default:
    $panic(new $String("invalid kind: " + kind));
  }

  typ.id = $typeIDCounter;
  $typeIDCounter++;
  typ.size = size;
  typ.kind = kind;
  typ.string = string;
  typ.typeName = name;
  typ.pkg = pkg;
  typ.methods = [];
  typ.methodSetCache = null;
  typ.comparable = true;
  return typ;
};

var $methodSet = function(typ) {
  if (typ.methodSetCache !== null) {
    return typ.methodSetCache;
  }
  var base = {};

  var isPtr = (typ.kind === $kindPtr);
  if (isPtr && typ.elem.kind === $kindInterface) {
    typ.methodSetCache = [];
    return [];
  }

  var current = [{typ: isPtr ? typ.elem : typ, indirect: isPtr}];

  var seen = {};

  while (current.length > 0) {
    var next = [];
    var mset = [];

    current.forEach(function(e) {
      if (seen[e.typ.string]) {
        return;
      }
      seen[e.typ.string] = true;

      if(e.typ.typeName !== "") {
        mset = mset.concat(e.typ.methods);
        if (e.indirect) {
          mset = mset.concat($ptrType(e.typ).methods);
        }
      }

      switch (e.typ.kind) {
      case $kindStruct:
        e.typ.fields.forEach(function(f) {
          if (f.name === "") {
            var fTyp = f.typ;
            var fIsPtr = (fTyp.kind === $kindPtr);
            next.push({typ: fIsPtr ? fTyp.elem : fTyp, indirect: e.indirect || fIsPtr});
          }
        });
        break;

      case $kindInterface:
        mset = mset.concat(e.typ.methods);
        break;
      }
    });

    mset.forEach(function(m) {
      if (base[m.name] === undefined) {
        base[m.name] = m;
      }
    });

    current = next;
  }

  typ.methodSetCache = [];
  Object.keys(base).sort().forEach(function(name) {
    typ.methodSetCache.push(base[name]);
  });
  return typ.methodSetCache;
};

var $Bool          = $newType( 1, $kindBool,          "bool",           "bool",       "", null);
var $Int           = $newType( 4, $kindInt,           "int",            "int",        "", null);
var $Int8          = $newType( 1, $kindInt8,          "int8",           "int8",       "", null);
var $Int16         = $newType( 2, $kindInt16,         "int16",          "int16",      "", null);
var $Int32         = $newType( 4, $kindInt32,         "int32",          "int32",      "", null);
var $Int64         = $newType( 8, $kindInt64,         "int64",          "int64",      "", null);
var $Uint          = $newType( 4, $kindUint,          "uint",           "uint",       "", null);
var $Uint8         = $newType( 1, $kindUint8,         "uint8",          "uint8",      "", null);
var $Uint16        = $newType( 2, $kindUint16,        "uint16",         "uint16",     "", null);
var $Uint32        = $newType( 4, $kindUint32,        "uint32",         "uint32",     "", null);
var $Uint64        = $newType( 8, $kindUint64,        "uint64",         "uint64",     "", null);
var $Uintptr       = $newType( 4, $kindUintptr,       "uintptr",        "uintptr",    "", null);
var $Float32       = $newType( 4, $kindFloat32,       "float32",        "float32",    "", null);
var $Float64       = $newType( 8, $kindFloat64,       "float64",        "float64",    "", null);
var $Complex64     = $newType( 8, $kindComplex64,     "complex64",      "complex64",  "", null);
var $Complex128    = $newType(16, $kindComplex128,    "complex128",     "complex128", "", null);
var $String        = $newType( 8, $kindString,        "string",         "string",     "", null);
var $UnsafePointer = $newType( 4, $kindUnsafePointer, "unsafe.Pointer", "Pointer",    "", null);

var $nativeArray = function(elemKind) {
  switch (elemKind) {
  case $kindInt:
    return Int32Array;
  case $kindInt8:
    return Int8Array;
  case $kindInt16:
    return Int16Array;
  case $kindInt32:
    return Int32Array;
  case $kindUint:
    return Uint32Array;
  case $kindUint8:
    return Uint8Array;
  case $kindUint16:
    return Uint16Array;
  case $kindUint32:
    return Uint32Array;
  case $kindUintptr:
    return Uint32Array;
  case $kindFloat32:
    return Float32Array;
  case $kindFloat64:
    return Float64Array;
  default:
    return Array;
  }
};
var $toNativeArray = function(elemKind, array) {
  var nativeArray = $nativeArray(elemKind);
  if (nativeArray === Array) {
    return array;
  }
  return new nativeArray(array);
};
var $arrayTypes = {};
var $arrayType = function(elem, len) {
  var typeKey = elem.id + "$" + len;
  var typ = $arrayTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(12, $kindArray, "[" + len + "]" + elem.string, "", "", null);
    $arrayTypes[typeKey] = typ;
    typ.init(elem, len);
  }
  return typ;
};

var $chanType = function(elem, sendOnly, recvOnly) {
  var string = (recvOnly ? "<-" : "") + "chan" + (sendOnly ? "<- " : " ") + elem.string;
  var field = sendOnly ? "SendChan" : (recvOnly ? "RecvChan" : "Chan");
  var typ = elem[field];
  if (typ === undefined) {
    typ = $newType(4, $kindChan, string, "", "", null);
    elem[field] = typ;
    typ.init(elem, sendOnly, recvOnly);
  }
  return typ;
};
var $Chan = function(elem, capacity) {
  if (capacity < 0 || capacity > 2147483647) {
    $throwRuntimeError("makechan: size out of range");
  }
  this.$elem = elem;
  this.$capacity = capacity;
  this.$buffer = [];
  this.$sendQueue = [];
  this.$recvQueue = [];
  this.$closed = false;
};
var $chanNil = new $Chan(null, 0);
$chanNil.$sendQueue = $chanNil.$recvQueue = { length: 0, push: function() {}, shift: function() { return undefined; }, indexOf: function() { return -1; } };

var $funcTypes = {};
var $funcType = function(params, results, variadic) {
  var typeKey = $mapArray(params, function(p) { return p.id; }).join(",") + "$" + $mapArray(results, function(r) { return r.id; }).join(",") + "$" + variadic;
  var typ = $funcTypes[typeKey];
  if (typ === undefined) {
    var paramTypes = $mapArray(params, function(p) { return p.string; });
    if (variadic) {
      paramTypes[paramTypes.length - 1] = "..." + paramTypes[paramTypes.length - 1].substr(2);
    }
    var string = "func(" + paramTypes.join(", ") + ")";
    if (results.length === 1) {
      string += " " + results[0].string;
    } else if (results.length > 1) {
      string += " (" + $mapArray(results, function(r) { return r.string; }).join(", ") + ")";
    }
    typ = $newType(4, $kindFunc, string, "", "", null);
    $funcTypes[typeKey] = typ;
    typ.init(params, results, variadic);
  }
  return typ;
};

var $interfaceTypes = {};
var $interfaceType = function(methods) {
  var typeKey = $mapArray(methods, function(m) { return m.pkg + "," + m.name + "," + m.typ.id; }).join("$");
  var typ = $interfaceTypes[typeKey];
  if (typ === undefined) {
    var string = "interface {}";
    if (methods.length !== 0) {
      string = "interface { " + $mapArray(methods, function(m) {
        return (m.pkg !== "" ? m.pkg + "." : "") + m.name + m.typ.string.substr(4);
      }).join("; ") + " }";
    }
    typ = $newType(8, $kindInterface, string, "", "", null);
    $interfaceTypes[typeKey] = typ;
    typ.init(methods);
  }
  return typ;
};
var $emptyInterface = $interfaceType([]);
var $ifaceNil = {};
var $error = $newType(8, $kindInterface, "error", "error", "", null);
$error.init([{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}]);

var $mapTypes = {};
var $mapType = function(key, elem) {
  var typeKey = key.id + "$" + elem.id;
  var typ = $mapTypes[typeKey];
  if (typ === undefined) {
    typ = $newType(4, $kindMap, "map[" + key.string + "]" + elem.string, "", "", null);
    $mapTypes[typeKey] = typ;
    typ.init(key, elem);
  }
  return typ;
};
var $makeMap = function(keyForFunc, entries) {
  var m = {};
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    m[keyForFunc(e.k)] = e;
  }
  return m;
};

var $ptrType = function(elem) {
  var typ = elem.ptr;
  if (typ === undefined) {
    typ = $newType(4, $kindPtr, "*" + elem.string, "", "", null);
    elem.ptr = typ;
    typ.init(elem);
  }
  return typ;
};

var $newDataPointer = function(data, constructor) {
  if (constructor.elem.kind === $kindStruct) {
    return data;
  }
  return new constructor(function() { return data; }, function(v) { data = v; });
};

var $indexPtr = function(array, index, constructor) {
  array.$ptr = array.$ptr || {};
  return array.$ptr[index] || (array.$ptr[index] = new constructor(function() { return array[index]; }, function(v) { array[index] = v; }));
};

var $sliceType = function(elem) {
  var typ = elem.slice;
  if (typ === undefined) {
    typ = $newType(12, $kindSlice, "[]" + elem.string, "", "", null);
    elem.slice = typ;
    typ.init(elem);
  }
  return typ;
};
var $makeSlice = function(typ, length, capacity) {
  capacity = capacity || length;
  if (length < 0 || length > 2147483647) {
    $throwRuntimeError("makeslice: len out of range");
  }
  if (capacity < 0 || capacity < length || capacity > 2147483647) {
    $throwRuntimeError("makeslice: cap out of range");
  }
  var array = new typ.nativeArray(capacity);
  if (typ.nativeArray === Array) {
    for (var i = 0; i < capacity; i++) {
      array[i] = typ.elem.zero();
    }
  }
  var slice = new typ(array);
  slice.$length = length;
  return slice;
};

var $structTypes = {};
var $structType = function(fields) {
  var typeKey = $mapArray(fields, function(f) { return f.name + "," + f.typ.id + "," + f.tag; }).join("$");
  var typ = $structTypes[typeKey];
  if (typ === undefined) {
    var string = "struct { " + $mapArray(fields, function(f) {
      return f.name + " " + f.typ.string + (f.tag !== "" ? (" \"" + f.tag.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"") : "");
    }).join("; ") + " }";
    if (fields.length === 0) {
      string = "struct {}";
    }
    typ = $newType(0, $kindStruct, string, "", "", function() {
      this.$val = this;
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var arg = arguments[i];
        this[f.prop] = arg !== undefined ? arg : f.typ.zero();
      }
    });
    $structTypes[typeKey] = typ;
    typ.init(fields);
  }
  return typ;
};

var $assertType = function(value, type, returnTuple) {
  var isInterface = (type.kind === $kindInterface), ok, missingMethod = "";
  if (value === $ifaceNil) {
    ok = false;
  } else if (!isInterface) {
    ok = value.constructor === type;
  } else {
    var valueTypeString = value.constructor.string;
    ok = type.implementedBy[valueTypeString];
    if (ok === undefined) {
      ok = true;
      var valueMethodSet = $methodSet(value.constructor);
      var interfaceMethods = type.methods;
      for (var i = 0; i < interfaceMethods.length; i++) {
        var tm = interfaceMethods[i];
        var found = false;
        for (var j = 0; j < valueMethodSet.length; j++) {
          var vm = valueMethodSet[j];
          if (vm.name === tm.name && vm.pkg === tm.pkg && vm.typ === tm.typ) {
            found = true;
            break;
          }
        }
        if (!found) {
          ok = false;
          type.missingMethodFor[valueTypeString] = tm.name;
          break;
        }
      }
      type.implementedBy[valueTypeString] = ok;
    }
    if (!ok) {
      missingMethod = type.missingMethodFor[valueTypeString];
    }
  }

  if (!ok) {
    if (returnTuple) {
      return [type.zero(), false];
    }
    $panic(new $packages["runtime"].TypeAssertionError.ptr("", (value === $ifaceNil ? "" : value.constructor.string), type.string, missingMethod));
  }

  if (!isInterface) {
    value = value.$val;
  }
  if (type === $jsObjectPtr) {
    value = value.object;
  }
  return returnTuple ? [value, true] : value;
};

var $stackDepthOffset = 0;
var $getStackDepth = function() {
  var err = new Error();
  if (err.stack === undefined) {
    return undefined;
  }
  return $stackDepthOffset + err.stack.split("\n").length;
};

var $panicStackDepth = null, $panicValue;
var $callDeferred = function(deferred, jsErr, fromPanic) {
  if (!fromPanic && deferred !== null && deferred.index >= $curGoroutine.deferStack.length) {
    throw jsErr;
  }
  if (jsErr !== null) {
    var newErr = null;
    try {
      $curGoroutine.deferStack.push(deferred);
      $panic(new $jsErrorPtr(jsErr));
    } catch (err) {
      newErr = err;
    }
    $curGoroutine.deferStack.pop();
    $callDeferred(deferred, newErr);
    return;
  }
  if ($curGoroutine.asleep) {
    return;
  }

  $stackDepthOffset--;
  var outerPanicStackDepth = $panicStackDepth;
  var outerPanicValue = $panicValue;

  var localPanicValue = $curGoroutine.panicStack.pop();
  if (localPanicValue !== undefined) {
    $panicStackDepth = $getStackDepth();
    $panicValue = localPanicValue;
  }

  try {
    while (true) {
      if (deferred === null) {
        deferred = $curGoroutine.deferStack[$curGoroutine.deferStack.length - 1];
        if (deferred === undefined) {
          /* The panic reached the top of the stack. Clear it and throw it as a JavaScript error. */
          $panicStackDepth = null;
          if (localPanicValue.Object instanceof Error) {
            throw localPanicValue.Object;
          }
          var msg;
          if (localPanicValue.constructor === $String) {
            msg = localPanicValue.$val;
          } else if (localPanicValue.Error !== undefined) {
            msg = localPanicValue.Error();
          } else if (localPanicValue.String !== undefined) {
            msg = localPanicValue.String();
          } else {
            msg = localPanicValue;
          }
          throw new Error(msg);
        }
      }
      var call = deferred.pop();
      if (call === undefined) {
        $curGoroutine.deferStack.pop();
        if (localPanicValue !== undefined) {
          deferred = null;
          continue;
        }
        return;
      }
      var r = call[0].apply(call[2], call[1]);
      if (r && r.$blk !== undefined) {
        deferred.push([r.$blk, [], r]);
        if (fromPanic) {
          throw null;
        }
        return;
      }

      if (localPanicValue !== undefined && $panicStackDepth === null) {
        throw null; /* error was recovered */
      }
    }
  } finally {
    if (localPanicValue !== undefined) {
      if ($panicStackDepth !== null) {
        $curGoroutine.panicStack.push(localPanicValue);
      }
      $panicStackDepth = outerPanicStackDepth;
      $panicValue = outerPanicValue;
    }
    $stackDepthOffset++;
  }
};

var $panic = function(value) {
  $curGoroutine.panicStack.push(value);
  $callDeferred(null, null, true);
};
var $recover = function() {
  if ($panicStackDepth === null || ($panicStackDepth !== undefined && $panicStackDepth !== $getStackDepth() - 2)) {
    return $ifaceNil;
  }
  $panicStackDepth = null;
  return $panicValue;
};
var $throw = function(err) { throw err; };

var $dummyGoroutine = { asleep: false, exit: false, deferStack: [], panicStack: [], canBlock: false };
var $curGoroutine = $dummyGoroutine, $totalGoroutines = 0, $awakeGoroutines = 0, $checkForDeadlock = true;
var $mainFinished = false;
var $go = function(fun, args, direct) {
  $totalGoroutines++;
  $awakeGoroutines++;
  var $goroutine = function() {
    try {
      $curGoroutine = $goroutine;
      var r = fun.apply(undefined, args);
      if (r && r.$blk !== undefined) {
        fun = function() { return r.$blk(); };
        args = [];
        return;
      }
      $goroutine.exit = true;
    } catch (err) {
      if (!$goroutine.exit) {
        throw err;
      }
    } finally {
      $curGoroutine = $dummyGoroutine;
      if ($goroutine.exit) { /* also set by runtime.Goexit() */
        $totalGoroutines--;
        $goroutine.asleep = true;
      }
      if ($goroutine.asleep) {
        $awakeGoroutines--;
        if (!$mainFinished && $awakeGoroutines === 0 && $checkForDeadlock) {
          console.error("fatal error: all goroutines are asleep - deadlock!");
          if ($global.process !== undefined) {
            $global.process.exit(2);
          }
        }
      }
    }
  };
  $goroutine.asleep = false;
  $goroutine.exit = false;
  $goroutine.deferStack = [];
  $goroutine.panicStack = [];
  $goroutine.canBlock = true;
  $schedule($goroutine, direct);
};

var $scheduled = [], $schedulerActive = false;
var $runScheduled = function() {
  try {
    var r;
    while ((r = $scheduled.shift()) !== undefined) {
      r();
    }
    $schedulerActive = false;
  } finally {
    if ($schedulerActive) {
      setTimeout($runScheduled, 0);
    }
  }
};
var $schedule = function(goroutine, direct) {
  if (goroutine.asleep) {
    goroutine.asleep = false;
    $awakeGoroutines++;
  }

  if (direct) {
    goroutine();
    return;
  }

  $scheduled.push(goroutine);
  if (!$schedulerActive) {
    $schedulerActive = true;
    setTimeout($runScheduled, 0);
  }
};

var $setTimeout = function(f, t) {
  $awakeGoroutines++;
  return setTimeout(function() {
    $awakeGoroutines--;
    f();
  }, t);
};

var $block = function() {
  if (!$curGoroutine.canBlock) {
    $throwRuntimeError("cannot block in JavaScript callback, fix by wrapping code in goroutine");
  }
  $curGoroutine.asleep = true;
};

var $send = function(chan, value) {
  if (chan.$closed) {
    $throwRuntimeError("send on closed channel");
  }
  var queuedRecv = chan.$recvQueue.shift();
  if (queuedRecv !== undefined) {
    queuedRecv([value, true]);
    return;
  }
  if (chan.$buffer.length < chan.$capacity) {
    chan.$buffer.push(value);
    return;
  }

  var thisGoroutine = $curGoroutine;
  chan.$sendQueue.push(function() {
    $schedule(thisGoroutine);
    return value;
  });
  $block();
  return {
    $blk: function() {
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
    }
  };
};
var $recv = function(chan) {
  var queuedSend = chan.$sendQueue.shift();
  if (queuedSend !== undefined) {
    chan.$buffer.push(queuedSend());
  }
  var bufferedValue = chan.$buffer.shift();
  if (bufferedValue !== undefined) {
    return [bufferedValue, true];
  }
  if (chan.$closed) {
    return [chan.$elem.zero(), false];
  }

  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.value; } };
  var queueEntry = function(v) {
    f.value = v;
    $schedule(thisGoroutine);
  };
  chan.$recvQueue.push(queueEntry);
  $block();
  return f;
};
var $close = function(chan) {
  if (chan.$closed) {
    $throwRuntimeError("close of closed channel");
  }
  chan.$closed = true;
  while (true) {
    var queuedSend = chan.$sendQueue.shift();
    if (queuedSend === undefined) {
      break;
    }
    queuedSend(); /* will panic because of closed channel */
  }
  while (true) {
    var queuedRecv = chan.$recvQueue.shift();
    if (queuedRecv === undefined) {
      break;
    }
    queuedRecv([chan.$elem.zero(), false]);
  }
};
var $select = function(comms) {
  var ready = [];
  var selection = -1;
  for (var i = 0; i < comms.length; i++) {
    var comm = comms[i];
    var chan = comm[0];
    switch (comm.length) {
    case 0: /* default */
      selection = i;
      break;
    case 1: /* recv */
      if (chan.$sendQueue.length !== 0 || chan.$buffer.length !== 0 || chan.$closed) {
        ready.push(i);
      }
      break;
    case 2: /* send */
      if (chan.$closed) {
        $throwRuntimeError("send on closed channel");
      }
      if (chan.$recvQueue.length !== 0 || chan.$buffer.length < chan.$capacity) {
        ready.push(i);
      }
      break;
    }
  }

  if (ready.length !== 0) {
    selection = ready[Math.floor(Math.random() * ready.length)];
  }
  if (selection !== -1) {
    var comm = comms[selection];
    switch (comm.length) {
    case 0: /* default */
      return [selection];
    case 1: /* recv */
      return [selection, $recv(comm[0])];
    case 2: /* send */
      $send(comm[0], comm[1]);
      return [selection];
    }
  }

  var entries = [];
  var thisGoroutine = $curGoroutine;
  var f = { $blk: function() { return this.selection; } };
  var removeFromQueues = function() {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var queue = entry[0];
      var index = queue.indexOf(entry[1]);
      if (index !== -1) {
        queue.splice(index, 1);
      }
    }
  };
  for (var i = 0; i < comms.length; i++) {
    (function(i) {
      var comm = comms[i];
      switch (comm.length) {
      case 1: /* recv */
        var queueEntry = function(value) {
          f.selection = [i, value];
          removeFromQueues();
          $schedule(thisGoroutine);
        };
        entries.push([comm[0].$recvQueue, queueEntry]);
        comm[0].$recvQueue.push(queueEntry);
        break;
      case 2: /* send */
        var queueEntry = function() {
          if (comm[0].$closed) {
            $throwRuntimeError("send on closed channel");
          }
          f.selection = [i];
          removeFromQueues();
          $schedule(thisGoroutine);
          return comm[1];
        };
        entries.push([comm[0].$sendQueue, queueEntry]);
        comm[0].$sendQueue.push(queueEntry);
        break;
      }
    })(i);
  }
  $block();
  return f;
};

var $jsObjectPtr, $jsErrorPtr;

var $needsExternalization = function(t) {
  switch (t.kind) {
    case $kindBool:
    case $kindInt:
    case $kindInt8:
    case $kindInt16:
    case $kindInt32:
    case $kindUint:
    case $kindUint8:
    case $kindUint16:
    case $kindUint32:
    case $kindUintptr:
    case $kindFloat32:
    case $kindFloat64:
      return false;
    default:
      return t !== $jsObjectPtr;
  }
};

var $externalize = function(v, t) {
  if (t === $jsObjectPtr) {
    return v;
  }
  switch (t.kind) {
  case $kindBool:
  case $kindInt:
  case $kindInt8:
  case $kindInt16:
  case $kindInt32:
  case $kindUint:
  case $kindUint8:
  case $kindUint16:
  case $kindUint32:
  case $kindUintptr:
  case $kindFloat32:
  case $kindFloat64:
    return v;
  case $kindInt64:
  case $kindUint64:
    return $flatten64(v);
  case $kindArray:
    if ($needsExternalization(t.elem)) {
      return $mapArray(v, function(e) { return $externalize(e, t.elem); });
    }
    return v;
  case $kindFunc:
    return $externalizeFunction(v, t, false);
  case $kindInterface:
    if (v === $ifaceNil) {
      return null;
    }
    if (v.constructor === $jsObjectPtr) {
      return v.$val.object;
    }
    return $externalize(v.$val, v.constructor);
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var entry = v[keys[i]];
      m[$externalize(entry.k, t.key)] = $externalize(entry.v, t.elem);
    }
    return m;
  case $kindPtr:
    if (v === t.nil) {
      return null;
    }
    return $externalize(v.$get(), t.elem);
  case $kindSlice:
    if ($needsExternalization(t.elem)) {
      return $mapArray($sliceToArray(v), function(e) { return $externalize(e, t.elem); });
    }
    return $sliceToArray(v);
  case $kindString:
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "", r;
    for (var i = 0; i < v.length; i += r[1]) {
      r = $decodeRune(v, i);
      var c = r[0];
      if (c > 0xFFFF) {
        var h = Math.floor((c - 0x10000) / 0x400) + 0xD800;
        var l = (c - 0x10000) % 0x400 + 0xDC00;
        s += String.fromCharCode(h, l);
        continue;
      }
      s += String.fromCharCode(c);
    }
    return s;
  case $kindStruct:
    var timePkg = $packages["time"];
    if (timePkg !== undefined && v.constructor === timePkg.Time.ptr) {
      var milli = $div64(v.UnixNano(), new $Int64(0, 1000000));
      return new Date($flatten64(milli));
    }

    var noJsObject = {};
    var searchJsObject = function(v, t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      switch (t.kind) {
      case $kindPtr:
        if (v === t.nil) {
          return noJsObject;
        }
        return searchJsObject(v.$get(), t.elem);
      case $kindStruct:
        var f = t.fields[0];
        return searchJsObject(v[f.prop], f.typ);
      case $kindInterface:
        return searchJsObject(v.$val, v.constructor);
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(v, t);
    if (o !== noJsObject) {
      return o;
    }

    o = {};
    for (var i = 0; i < t.fields.length; i++) {
      var f = t.fields[i];
      if (f.pkg !== "") { /* not exported */
        continue;
      }
      o[f.name] = $externalize(v[f.prop], f.typ);
    }
    return o;
  }
  $throwRuntimeError("cannot externalize " + t.string);
};

var $externalizeFunction = function(v, t, passThis) {
  if (v === $throwNilPointerError) {
    return null;
  }
  if (v.$externalizeWrapper === undefined) {
    $checkForDeadlock = false;
    v.$externalizeWrapper = function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = [];
          for (var j = i; j < arguments.length; j++) {
            varargs.push($internalize(arguments[j], vt));
          }
          args.push(new (t.params[i])(varargs));
          break;
        }
        args.push($internalize(arguments[i], t.params[i]));
      }
      var canBlock = $curGoroutine.canBlock;
      $curGoroutine.canBlock = false;
      try {
        var result = v.apply(passThis ? this : undefined, args);
      } finally {
        $curGoroutine.canBlock = canBlock;
      }
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $externalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $externalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  }
  return v.$externalizeWrapper;
};

var $internalize = function(v, t, recv) {
  if (t === $jsObjectPtr) {
    return v;
  }
  if (t === $jsObjectPtr.elem) {
    $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
  }
  if (v && v.__internal_object__ !== undefined) {
    return $assertType(v.__internal_object__, t, false);
  }
  var timePkg = $packages["time"];
  if (timePkg !== undefined && t === timePkg.Time) {
    if (!(v !== null && v !== undefined && v.constructor === Date)) {
      $throwRuntimeError("cannot internalize time.Time from " + typeof v + ", must be Date");
    }
    return timePkg.Unix(new $Int64(0, 0), new $Int64(0, v.getTime() * 1000000));
  }
  switch (t.kind) {
  case $kindBool:
    return !!v;
  case $kindInt:
    return parseInt(v);
  case $kindInt8:
    return parseInt(v) << 24 >> 24;
  case $kindInt16:
    return parseInt(v) << 16 >> 16;
  case $kindInt32:
    return parseInt(v) >> 0;
  case $kindUint:
    return parseInt(v);
  case $kindUint8:
    return parseInt(v) << 24 >>> 24;
  case $kindUint16:
    return parseInt(v) << 16 >>> 16;
  case $kindUint32:
  case $kindUintptr:
    return parseInt(v) >>> 0;
  case $kindInt64:
  case $kindUint64:
    return new t(0, v);
  case $kindFloat32:
  case $kindFloat64:
    return parseFloat(v);
  case $kindArray:
    if (v.length !== t.len) {
      $throwRuntimeError("got array with wrong size from JavaScript native");
    }
    return $mapArray(v, function(e) { return $internalize(e, t.elem); });
  case $kindFunc:
    return function() {
      var args = [];
      for (var i = 0; i < t.params.length; i++) {
        if (t.variadic && i === t.params.length - 1) {
          var vt = t.params[i].elem, varargs = arguments[i];
          for (var j = 0; j < varargs.$length; j++) {
            args.push($externalize(varargs.$array[varargs.$offset + j], vt));
          }
          break;
        }
        args.push($externalize(arguments[i], t.params[i]));
      }
      var result = v.apply(recv, args);
      switch (t.results.length) {
      case 0:
        return;
      case 1:
        return $internalize(result, t.results[0]);
      default:
        for (var i = 0; i < t.results.length; i++) {
          result[i] = $internalize(result[i], t.results[i]);
        }
        return result;
      }
    };
  case $kindInterface:
    if (t.methods.length !== 0) {
      $throwRuntimeError("cannot internalize " + t.string);
    }
    if (v === null) {
      return $ifaceNil;
    }
    if (v === undefined) {
      return new $jsObjectPtr(undefined);
    }
    switch (v.constructor) {
    case Int8Array:
      return new ($sliceType($Int8))(v);
    case Int16Array:
      return new ($sliceType($Int16))(v);
    case Int32Array:
      return new ($sliceType($Int))(v);
    case Uint8Array:
      return new ($sliceType($Uint8))(v);
    case Uint16Array:
      return new ($sliceType($Uint16))(v);
    case Uint32Array:
      return new ($sliceType($Uint))(v);
    case Float32Array:
      return new ($sliceType($Float32))(v);
    case Float64Array:
      return new ($sliceType($Float64))(v);
    case Array:
      return $internalize(v, $sliceType($emptyInterface));
    case Boolean:
      return new $Bool(!!v);
    case Date:
      if (timePkg === undefined) {
        /* time package is not present, internalize as &js.Object{Date} so it can be externalized into original Date. */
        return new $jsObjectPtr(v);
      }
      return new timePkg.Time($internalize(v, timePkg.Time));
    case Function:
      var funcType = $funcType([$sliceType($emptyInterface)], [$jsObjectPtr], true);
      return new funcType($internalize(v, funcType));
    case Number:
      return new $Float64(parseFloat(v));
    case String:
      return new $String($internalize(v, $String));
    default:
      if ($global.Node && v instanceof $global.Node) {
        return new $jsObjectPtr(v);
      }
      var mapType = $mapType($String, $emptyInterface);
      return new mapType($internalize(v, mapType));
    }
  case $kindMap:
    var m = {};
    var keys = $keys(v);
    for (var i = 0; i < keys.length; i++) {
      var k = $internalize(keys[i], t.key);
      m[t.key.keyFor(k)] = { k: k, v: $internalize(v[keys[i]], t.elem) };
    }
    return m;
  case $kindPtr:
    if (t.elem.kind === $kindStruct) {
      return $internalize(v, t.elem);
    }
  case $kindSlice:
    return new t($mapArray(v, function(e) { return $internalize(e, t.elem); }));
  case $kindString:
    v = String(v);
    if (v.search(/^[\x00-\x7F]*$/) !== -1) {
      return v;
    }
    var s = "";
    var i = 0;
    while (i < v.length) {
      var h = v.charCodeAt(i);
      if (0xD800 <= h && h <= 0xDBFF) {
        var l = v.charCodeAt(i + 1);
        var c = (h - 0xD800) * 0x400 + l - 0xDC00 + 0x10000;
        s += $encodeRune(c);
        i += 2;
        continue;
      }
      s += $encodeRune(h);
      i++;
    }
    return s;
  case $kindStruct:
    var noJsObject = {};
    var searchJsObject = function(t) {
      if (t === $jsObjectPtr) {
        return v;
      }
      if (t === $jsObjectPtr.elem) {
        $throwRuntimeError("cannot internalize js.Object, use *js.Object instead");
      }
      switch (t.kind) {
      case $kindPtr:
        return searchJsObject(t.elem);
      case $kindStruct:
        var f = t.fields[0];
        var o = searchJsObject(f.typ);
        if (o !== noJsObject) {
          var n = new t.ptr();
          n[f.prop] = o;
          return n;
        }
        return noJsObject;
      default:
        return noJsObject;
      }
    };
    var o = searchJsObject(t);
    if (o !== noJsObject) {
      return o;
    }
  }
  $throwRuntimeError("cannot internalize " + t.string);
};

$packages["github.com/gopherjs/gopherjs/js"] = (function() {
	var $pkg = {}, $init, Object, Error, sliceType, sliceType$1, ptrType, ptrType$1, Keys, init;
	Object = $pkg.Object = $newType(0, $kindStruct, "js.Object", "Object", "github.com/gopherjs/gopherjs/js", function(object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.object = null;
			return;
		}
		this.object = object_;
	});
	Error = $pkg.Error = $newType(0, $kindStruct, "js.Error", "Error", "github.com/gopherjs/gopherjs/js", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	sliceType = $sliceType($emptyInterface);
	sliceType$1 = $sliceType($String);
	ptrType = $ptrType(Object);
	ptrType$1 = $ptrType(Error);
	Object.ptr.prototype.Get = function(key) {
		var $ptr, key, o;
		o = this;
		return o.object[$externalize(key, $String)];
	};
	Object.prototype.Get = function(key) { return this.$val.Get(key); };
	Object.ptr.prototype.Set = function(key, value) {
		var $ptr, key, o, value;
		o = this;
		o.object[$externalize(key, $String)] = $externalize(value, $emptyInterface);
	};
	Object.prototype.Set = function(key, value) { return this.$val.Set(key, value); };
	Object.ptr.prototype.Delete = function(key) {
		var $ptr, key, o;
		o = this;
		delete o.object[$externalize(key, $String)];
	};
	Object.prototype.Delete = function(key) { return this.$val.Delete(key); };
	Object.ptr.prototype.Length = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object.length);
	};
	Object.prototype.Length = function() { return this.$val.Length(); };
	Object.ptr.prototype.Index = function(i) {
		var $ptr, i, o;
		o = this;
		return o.object[i];
	};
	Object.prototype.Index = function(i) { return this.$val.Index(i); };
	Object.ptr.prototype.SetIndex = function(i, value) {
		var $ptr, i, o, value;
		o = this;
		o.object[i] = $externalize(value, $emptyInterface);
	};
	Object.prototype.SetIndex = function(i, value) { return this.$val.SetIndex(i, value); };
	Object.ptr.prototype.Call = function(name, args) {
		var $ptr, args, name, o, obj;
		o = this;
		return (obj = o.object, obj[$externalize(name, $String)].apply(obj, $externalize(args, sliceType)));
	};
	Object.prototype.Call = function(name, args) { return this.$val.Call(name, args); };
	Object.ptr.prototype.Invoke = function(args) {
		var $ptr, args, o;
		o = this;
		return o.object.apply(undefined, $externalize(args, sliceType));
	};
	Object.prototype.Invoke = function(args) { return this.$val.Invoke(args); };
	Object.ptr.prototype.New = function(args) {
		var $ptr, args, o;
		o = this;
		return new ($global.Function.prototype.bind.apply(o.object, [undefined].concat($externalize(args, sliceType))));
	};
	Object.prototype.New = function(args) { return this.$val.New(args); };
	Object.ptr.prototype.Bool = function() {
		var $ptr, o;
		o = this;
		return !!(o.object);
	};
	Object.prototype.Bool = function() { return this.$val.Bool(); };
	Object.ptr.prototype.String = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $String);
	};
	Object.prototype.String = function() { return this.$val.String(); };
	Object.ptr.prototype.Int = function() {
		var $ptr, o;
		o = this;
		return $parseInt(o.object) >> 0;
	};
	Object.prototype.Int = function() { return this.$val.Int(); };
	Object.ptr.prototype.Int64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Int64);
	};
	Object.prototype.Int64 = function() { return this.$val.Int64(); };
	Object.ptr.prototype.Uint64 = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $Uint64);
	};
	Object.prototype.Uint64 = function() { return this.$val.Uint64(); };
	Object.ptr.prototype.Float = function() {
		var $ptr, o;
		o = this;
		return $parseFloat(o.object);
	};
	Object.prototype.Float = function() { return this.$val.Float(); };
	Object.ptr.prototype.Interface = function() {
		var $ptr, o;
		o = this;
		return $internalize(o.object, $emptyInterface);
	};
	Object.prototype.Interface = function() { return this.$val.Interface(); };
	Object.ptr.prototype.Unsafe = function() {
		var $ptr, o;
		o = this;
		return o.object;
	};
	Object.prototype.Unsafe = function() { return this.$val.Unsafe(); };
	Error.ptr.prototype.Error = function() {
		var $ptr, err;
		err = this;
		return "JavaScript error: " + $internalize(err.Object.message, $String);
	};
	Error.prototype.Error = function() { return this.$val.Error(); };
	Error.ptr.prototype.Stack = function() {
		var $ptr, err;
		err = this;
		return $internalize(err.Object.stack, $String);
	};
	Error.prototype.Stack = function() { return this.$val.Stack(); };
	Keys = function(o) {
		var $ptr, a, i, o, s;
		if (o === null || o === undefined) {
			return sliceType$1.nil;
		}
		a = $global.Object.keys(o);
		s = $makeSlice(sliceType$1, $parseInt(a.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(a.length))) { break; }
			((i < 0 || i >= s.$length) ? $throwRuntimeError("index out of range") : s.$array[s.$offset + i] = $internalize(a[i], $String));
			i = i + (1) >> 0;
		}
		return s;
	};
	$pkg.Keys = Keys;
	init = function() {
		var $ptr, e;
		e = new Error.ptr(null);
	};
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [ptrType], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "Delete", name: "Delete", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [ptrType], false)}, {prop: "SetIndex", name: "SetIndex", pkg: "", typ: $funcType([$Int, $emptyInterface], [], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([$String, sliceType], [ptrType], true)}, {prop: "Invoke", name: "Invoke", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "New", name: "New", pkg: "", typ: $funcType([sliceType], [ptrType], true)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Int64", name: "Int64", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Uint64", name: "Uint64", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Unsafe", name: "Unsafe", pkg: "", typ: $funcType([], [$Uintptr], false)}];
	ptrType$1.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Stack", name: "Stack", pkg: "", typ: $funcType([], [$String], false)}];
	Object.init([{prop: "object", name: "object", pkg: "github.com/gopherjs/gopherjs/js", typ: ptrType, tag: ""}]);
	Error.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime/internal/sys"] = (function() {
	var $pkg = {}, $init;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["runtime"] = (function() {
	var $pkg = {}, $init, js, sys, TypeAssertionError, errorString, ptrType$4, init, GOROOT, Goexit;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	sys = $packages["runtime/internal/sys"];
	TypeAssertionError = $pkg.TypeAssertionError = $newType(0, $kindStruct, "runtime.TypeAssertionError", "TypeAssertionError", "runtime", function(interfaceString_, concreteString_, assertedString_, missingMethod_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.interfaceString = "";
			this.concreteString = "";
			this.assertedString = "";
			this.missingMethod = "";
			return;
		}
		this.interfaceString = interfaceString_;
		this.concreteString = concreteString_;
		this.assertedString = assertedString_;
		this.missingMethod = missingMethod_;
	});
	errorString = $pkg.errorString = $newType(8, $kindString, "runtime.errorString", "errorString", "runtime", null);
	ptrType$4 = $ptrType(TypeAssertionError);
	init = function() {
		var $ptr, e, jsPkg;
		jsPkg = $packages[$externalize("github.com/gopherjs/gopherjs/js", $String)];
		$jsObjectPtr = jsPkg.Object.ptr;
		$jsErrorPtr = jsPkg.Error.ptr;
		$throwRuntimeError = (function(msg) {
			var $ptr, msg;
			$panic(new errorString(msg));
		});
		e = $ifaceNil;
		e = new TypeAssertionError.ptr("", "", "", "");
	};
	GOROOT = function() {
		var $ptr, goroot, process;
		process = $global.process;
		if (process === undefined) {
			return "/";
		}
		goroot = process.env.GOROOT;
		if (!(goroot === undefined)) {
			return $internalize(goroot, $String);
		}
		return "/usr/local/go";
	};
	$pkg.GOROOT = GOROOT;
	Goexit = function() {
		var $ptr;
		$curGoroutine.exit = $externalize(true, $Bool);
		$throw(null);
	};
	$pkg.Goexit = Goexit;
	TypeAssertionError.ptr.prototype.RuntimeError = function() {
		var $ptr;
	};
	TypeAssertionError.prototype.RuntimeError = function() { return this.$val.RuntimeError(); };
	TypeAssertionError.ptr.prototype.Error = function() {
		var $ptr, e, inter;
		e = this;
		inter = e.interfaceString;
		if (inter === "") {
			inter = "interface";
		}
		if (e.concreteString === "") {
			return "interface conversion: " + inter + " is nil, not " + e.assertedString;
		}
		if (e.missingMethod === "") {
			return "interface conversion: " + inter + " is " + e.concreteString + ", not " + e.assertedString;
		}
		return "interface conversion: " + e.concreteString + " is not " + e.assertedString + ": missing method " + e.missingMethod;
	};
	TypeAssertionError.prototype.Error = function() { return this.$val.Error(); };
	errorString.prototype.RuntimeError = function() {
		var $ptr, e;
		e = this.$val;
	};
	$ptrType(errorString).prototype.RuntimeError = function() { return new errorString(this.$get()).RuntimeError(); };
	errorString.prototype.Error = function() {
		var $ptr, e;
		e = this.$val;
		return "runtime error: " + e;
	};
	$ptrType(errorString).prototype.Error = function() { return new errorString(this.$get()).Error(); };
	ptrType$4.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.methods = [{prop: "RuntimeError", name: "RuntimeError", pkg: "", typ: $funcType([], [], false)}, {prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	TypeAssertionError.init([{prop: "interfaceString", name: "interfaceString", pkg: "runtime", typ: $String, tag: ""}, {prop: "concreteString", name: "concreteString", pkg: "runtime", typ: $String, tag: ""}, {prop: "assertedString", name: "assertedString", pkg: "runtime", typ: $String, tag: ""}, {prop: "missingMethod", name: "missingMethod", pkg: "runtime", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sys.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["errors"] = (function() {
	var $pkg = {}, $init, errorString, ptrType, New;
	errorString = $pkg.errorString = $newType(0, $kindStruct, "errors.errorString", "errorString", "errors", function(s_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.s = "";
			return;
		}
		this.s = s_;
	});
	ptrType = $ptrType(errorString);
	New = function(text) {
		var $ptr, text;
		return new errorString.ptr(text);
	};
	$pkg.New = New;
	errorString.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		return e.s;
	};
	errorString.prototype.Error = function() { return this.$val.Error(); };
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	errorString.init([{prop: "s", name: "s", pkg: "errors", typ: $String, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["internal/race"] = (function() {
	var $pkg = {}, $init, Acquire, Release, ReleaseMerge, Disable, Enable;
	Acquire = function(addr) {
		var $ptr, addr;
	};
	$pkg.Acquire = Acquire;
	Release = function(addr) {
		var $ptr, addr;
	};
	$pkg.Release = Release;
	ReleaseMerge = function(addr) {
		var $ptr, addr;
	};
	$pkg.ReleaseMerge = ReleaseMerge;
	Disable = function() {
		var $ptr;
	};
	$pkg.Disable = Disable;
	Enable = function() {
		var $ptr;
	};
	$pkg.Enable = Enable;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync/atomic"] = (function() {
	var $pkg = {}, $init, js, CompareAndSwapInt32, AddInt32, LoadUint32, StoreUint32;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	CompareAndSwapInt32 = function(addr, old, new$1) {
		var $ptr, addr, new$1, old;
		if (addr.$get() === old) {
			addr.$set(new$1);
			return true;
		}
		return false;
	};
	$pkg.CompareAndSwapInt32 = CompareAndSwapInt32;
	AddInt32 = function(addr, delta) {
		var $ptr, addr, delta, new$1;
		new$1 = addr.$get() + delta >> 0;
		addr.$set(new$1);
		return new$1;
	};
	$pkg.AddInt32 = AddInt32;
	LoadUint32 = function(addr) {
		var $ptr, addr;
		return addr.$get();
	};
	$pkg.LoadUint32 = LoadUint32;
	StoreUint32 = function(addr, val) {
		var $ptr, addr, val;
		addr.$set(val);
	};
	$pkg.StoreUint32 = StoreUint32;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["sync"] = (function() {
	var $pkg = {}, $init, race, runtime, atomic, Pool, Mutex, Locker, Once, poolLocal, syncSema, RWMutex, rlocker, ptrType, sliceType, ptrType$1, chanType, sliceType$1, ptrType$4, ptrType$6, sliceType$3, ptrType$7, ptrType$8, funcType, ptrType$12, funcType$1, ptrType$13, arrayType$1, semWaiters, allPools, runtime_Syncsemcheck, runtime_registerPoolCleanup, runtime_Semacquire, runtime_Semrelease, runtime_canSpin, poolCleanup, init, indexLocal, init$1, runtime_doSpin;
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	atomic = $packages["sync/atomic"];
	Pool = $pkg.Pool = $newType(0, $kindStruct, "sync.Pool", "Pool", "sync", function(local_, localSize_, store_, New_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.local = 0;
			this.localSize = 0;
			this.store = sliceType$3.nil;
			this.New = $throwNilPointerError;
			return;
		}
		this.local = local_;
		this.localSize = localSize_;
		this.store = store_;
		this.New = New_;
	});
	Mutex = $pkg.Mutex = $newType(0, $kindStruct, "sync.Mutex", "Mutex", "sync", function(state_, sema_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.state = 0;
			this.sema = 0;
			return;
		}
		this.state = state_;
		this.sema = sema_;
	});
	Locker = $pkg.Locker = $newType(8, $kindInterface, "sync.Locker", "Locker", "sync", null);
	Once = $pkg.Once = $newType(0, $kindStruct, "sync.Once", "Once", "sync", function(m_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.m = new Mutex.ptr(0, 0);
			this.done = 0;
			return;
		}
		this.m = m_;
		this.done = done_;
	});
	poolLocal = $pkg.poolLocal = $newType(0, $kindStruct, "sync.poolLocal", "poolLocal", "sync", function(private$0_, shared_, Mutex_, pad_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.private$0 = $ifaceNil;
			this.shared = sliceType$3.nil;
			this.Mutex = new Mutex.ptr(0, 0);
			this.pad = arrayType$1.zero();
			return;
		}
		this.private$0 = private$0_;
		this.shared = shared_;
		this.Mutex = Mutex_;
		this.pad = pad_;
	});
	syncSema = $pkg.syncSema = $newType(0, $kindStruct, "sync.syncSema", "syncSema", "sync", function(lock_, head_, tail_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lock = 0;
			this.head = 0;
			this.tail = 0;
			return;
		}
		this.lock = lock_;
		this.head = head_;
		this.tail = tail_;
	});
	RWMutex = $pkg.RWMutex = $newType(0, $kindStruct, "sync.RWMutex", "RWMutex", "sync", function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	rlocker = $pkg.rlocker = $newType(0, $kindStruct, "sync.rlocker", "rlocker", "sync", function(w_, writerSem_, readerSem_, readerCount_, readerWait_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.w = new Mutex.ptr(0, 0);
			this.writerSem = 0;
			this.readerSem = 0;
			this.readerCount = 0;
			this.readerWait = 0;
			return;
		}
		this.w = w_;
		this.writerSem = writerSem_;
		this.readerSem = readerSem_;
		this.readerCount = readerCount_;
		this.readerWait = readerWait_;
	});
	ptrType = $ptrType(Pool);
	sliceType = $sliceType(ptrType);
	ptrType$1 = $ptrType($Uint32);
	chanType = $chanType($Bool, false, false);
	sliceType$1 = $sliceType(chanType);
	ptrType$4 = $ptrType($Int32);
	ptrType$6 = $ptrType(poolLocal);
	sliceType$3 = $sliceType($emptyInterface);
	ptrType$7 = $ptrType(rlocker);
	ptrType$8 = $ptrType(RWMutex);
	funcType = $funcType([], [$emptyInterface], false);
	ptrType$12 = $ptrType(Mutex);
	funcType$1 = $funcType([], [], false);
	ptrType$13 = $ptrType(Once);
	arrayType$1 = $arrayType($Uint8, 128);
	runtime_Syncsemcheck = function(size) {
		var $ptr, size;
	};
	Pool.ptr.prototype.Get = function() {
		var $ptr, _r, p, x, x$1, x$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; p = $f.p; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		p = this;
		/* */ if (p.store.$length === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (p.store.$length === 0) { */ case 1:
			/* */ if (!(p.New === $throwNilPointerError)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(p.New === $throwNilPointerError)) { */ case 3:
				_r = p.New(); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 6; case 6:
				return _r;
			/* } */ case 4:
			return $ifaceNil;
		/* } */ case 2:
		x$2 = (x = p.store, x$1 = p.store.$length - 1 >> 0, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		p.store = $subslice(p.store, 0, (p.store.$length - 1 >> 0));
		return x$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Pool.ptr.prototype.Get }; } $f.$ptr = $ptr; $f._r = _r; $f.p = p; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Pool.prototype.Get = function() { return this.$val.Get(); };
	Pool.ptr.prototype.Put = function(x) {
		var $ptr, p, x;
		p = this;
		if ($interfaceIsEqual(x, $ifaceNil)) {
			return;
		}
		p.store = $append(p.store, x);
	};
	Pool.prototype.Put = function(x) { return this.$val.Put(x); };
	runtime_registerPoolCleanup = function(cleanup) {
		var $ptr, cleanup;
	};
	runtime_Semacquire = function(s) {
		var $ptr, _entry, _key, _r, ch, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; _r = $f._r; ch = $f.ch; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ if (s.$get() === 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (s.$get() === 0) { */ case 1:
			ch = new $Chan($Bool, 0);
			_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: $append((_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil), ch) };
			_r = $recv(ch); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_r[0];
		/* } */ case 2:
		s.$set(s.$get() - (1) >>> 0);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: runtime_Semacquire }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f._r = _r; $f.ch = ch; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_Semrelease = function(s) {
		var $ptr, _entry, _key, ch, s, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _key = $f._key; ch = $f.ch; s = $f.s; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		s.$set(s.$get() + (1) >>> 0);
		w = (_entry = semWaiters[ptrType$1.keyFor(s)], _entry !== undefined ? _entry.v : sliceType$1.nil);
		if (w.$length === 0) {
			return;
		}
		ch = (0 >= w.$length ? $throwRuntimeError("index out of range") : w.$array[w.$offset + 0]);
		w = $subslice(w, 1);
		_key = s; (semWaiters || $throwRuntimeError("assignment to entry in nil map"))[ptrType$1.keyFor(_key)] = { k: _key, v: w };
		if (w.$length === 0) {
			delete semWaiters[ptrType$1.keyFor(s)];
		}
		$r = $send(ch, true); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: runtime_Semrelease }; } $f.$ptr = $ptr; $f._entry = _entry; $f._key = _key; $f.ch = ch; $f.s = s; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	runtime_canSpin = function(i) {
		var $ptr, i;
		return false;
	};
	Mutex.ptr.prototype.Lock = function() {
		var $ptr, awoke, iter, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; awoke = $f.awoke; iter = $f.iter; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), 0, 1)) {
			if (false) {
				race.Acquire(m);
			}
			return;
		}
		awoke = false;
		iter = 0;
		/* while (true) { */ case 1:
			old = m.state;
			new$1 = old | 1;
			/* */ if (!(((old & 1) === 0))) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(((old & 1) === 0))) { */ case 3:
				if (runtime_canSpin(iter)) {
					if (!awoke && ((old & 2) === 0) && !(((old >> 2 >> 0) === 0)) && atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, old | 2)) {
						awoke = true;
					}
					runtime_doSpin();
					iter = iter + (1) >> 0;
					/* continue; */ $s = 1; continue;
				}
				new$1 = old + 4 >> 0;
			/* } */ case 4:
			if (awoke) {
				if ((new$1 & 2) === 0) {
					$panic(new $String("sync: inconsistent mutex state"));
				}
				new$1 = (new$1 & ~(2)) >> 0;
			}
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 5; continue; }
			/* */ $s = 6; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 5:
				if ((old & 1) === 0) {
					/* break; */ $s = 2; continue;
				}
				$r = runtime_Semacquire((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				awoke = true;
				iter = 0;
			/* } */ case 6:
		/* } */ $s = 1; continue; case 2:
		if (false) {
			race.Acquire(m);
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.awoke = awoke; $f.iter = iter; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Lock = function() { return this.$val.Lock(); };
	Mutex.ptr.prototype.Unlock = function() {
		var $ptr, m, new$1, old, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; m = $f.m; new$1 = $f.new$1; old = $f.old; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		m = this;
		if (false) {
			race.Release(m);
		}
		new$1 = atomic.AddInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), -1);
		if ((((new$1 + 1 >> 0)) & 1) === 0) {
			$panic(new $String("sync: unlock of unlocked mutex"));
		}
		old = new$1;
		/* while (true) { */ case 1:
			if (((old >> 2 >> 0) === 0) || !(((old & 3) === 0))) {
				return;
			}
			new$1 = ((old - 4 >> 0)) | 2;
			/* */ if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.CompareAndSwapInt32((m.$ptr_state || (m.$ptr_state = new ptrType$4(function() { return this.$target.state; }, function($v) { this.$target.state = $v; }, m))), old, new$1)) { */ case 3:
				$r = runtime_Semrelease((m.$ptr_sema || (m.$ptr_sema = new ptrType$1(function() { return this.$target.sema; }, function($v) { this.$target.sema = $v; }, m)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				return;
			/* } */ case 4:
			old = m.state;
		/* } */ $s = 1; continue; case 2:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Mutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.m = m; $f.new$1 = new$1; $f.old = old; $f.$s = $s; $f.$r = $r; return $f;
	};
	Mutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = this;
		if (atomic.LoadUint32((o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o)))) === 1) {
			return;
		}
		$r = o.m.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(o.m, "Unlock"), []]);
		/* */ if (o.done === 0) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (o.done === 0) { */ case 2:
			$deferred.push([atomic.StoreUint32, [(o.$ptr_done || (o.$ptr_done = new ptrType$1(function() { return this.$target.done; }, function($v) { this.$target.done = $v; }, o))), 1]]);
			$r = f(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	poolCleanup = function() {
		var $ptr, _i, _i$1, _ref, _ref$1, i, i$1, j, l, p, x;
		_ref = allPools;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= allPools.$length) ? $throwRuntimeError("index out of range") : allPools.$array[allPools.$offset + i] = ptrType.nil);
			i$1 = 0;
			while (true) {
				if (!(i$1 < (p.localSize >> 0))) { break; }
				l = indexLocal(p.local, i$1);
				l.private$0 = $ifaceNil;
				_ref$1 = l.shared;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					j = _i$1;
					(x = l.shared, ((j < 0 || j >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + j] = $ifaceNil));
					_i$1++;
				}
				l.shared = sliceType$3.nil;
				i$1 = i$1 + (1) >> 0;
			}
			p.local = 0;
			p.localSize = 0;
			_i++;
		}
		allPools = new sliceType([]);
	};
	init = function() {
		var $ptr;
		runtime_registerPoolCleanup(poolCleanup);
	};
	indexLocal = function(l, i) {
		var $ptr, i, l, x;
		return (x = l, (x.nilCheck, ((i < 0 || i >= x.length) ? $throwRuntimeError("index out of range") : x[i])));
	};
	init$1 = function() {
		var $ptr, s;
		s = new syncSema.ptr(0, 0, 0);
		runtime_Syncsemcheck(12);
	};
	runtime_doSpin = function() {
		$throwRuntimeError("native function not implemented: sync.runtime_doSpin");
	};
	RWMutex.ptr.prototype.RLock = function() {
		var $ptr, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		/* */ if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1) < 0) { */ case 1:
			$r = runtime_Semacquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RLock }; } $f.$ptr = $ptr; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RLock = function() { return this.$val.RLock(); };
	RWMutex.ptr.prototype.RUnlock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.ReleaseMerge((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1);
		/* */ if (r < 0) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (r < 0) { */ case 1:
			if (((r + 1 >> 0) === 0) || ((r + 1 >> 0) === -1073741824)) {
				race.Enable();
				$panic(new $String("sync: RUnlock of unlocked RWMutex"));
			}
			/* */ if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), -1) === 0) { */ case 3:
				$r = runtime_Semrelease((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* } */ case 4:
		/* } */ case 2:
		if (false) {
			race.Enable();
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.RUnlock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.RUnlock = function() { return this.$val.RUnlock(); };
	RWMutex.ptr.prototype.Lock = function() {
		var $ptr, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Disable();
		}
		$r = rw.w.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), -1073741824) + 1073741824 >> 0;
		/* */ if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((r === 0)) && !((atomic.AddInt32((rw.$ptr_readerWait || (rw.$ptr_readerWait = new ptrType$4(function() { return this.$target.readerWait; }, function($v) { this.$target.readerWait = $v; }, rw))), r) === 0))) { */ case 2:
			$r = runtime_Semacquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw)))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 3:
		if (false) {
			race.Enable();
			race.Acquire((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Acquire((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Lock = function() { return this.$val.Lock(); };
	RWMutex.ptr.prototype.Unlock = function() {
		var $ptr, i, r, rw, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; i = $f.i; r = $f.r; rw = $f.rw; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		rw = this;
		if (false) {
			race.Release((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw))));
			race.Release((rw.$ptr_writerSem || (rw.$ptr_writerSem = new ptrType$1(function() { return this.$target.writerSem; }, function($v) { this.$target.writerSem = $v; }, rw))));
			race.Disable();
		}
		r = atomic.AddInt32((rw.$ptr_readerCount || (rw.$ptr_readerCount = new ptrType$4(function() { return this.$target.readerCount; }, function($v) { this.$target.readerCount = $v; }, rw))), 1073741824);
		if (r >= 1073741824) {
			race.Enable();
			$panic(new $String("sync: Unlock of unlocked RWMutex"));
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < (r >> 0))) { break; } */ if(!(i < (r >> 0))) { $s = 2; continue; }
			$r = runtime_Semrelease((rw.$ptr_readerSem || (rw.$ptr_readerSem = new ptrType$1(function() { return this.$target.readerSem; }, function($v) { this.$target.readerSem = $v; }, rw)))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		$r = rw.w.Unlock(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (false) {
			race.Enable();
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: RWMutex.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.i = i; $f.r = r; $f.rw = rw; $f.$s = $s; $f.$r = $r; return $f;
	};
	RWMutex.prototype.Unlock = function() { return this.$val.Unlock(); };
	RWMutex.ptr.prototype.RLocker = function() {
		var $ptr, rw;
		rw = this;
		return $pointerOfStructConversion(rw, ptrType$7);
	};
	RWMutex.prototype.RLocker = function() { return this.$val.RLocker(); };
	rlocker.ptr.prototype.Lock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$8).RLock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Lock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Lock = function() { return this.$val.Lock(); };
	rlocker.ptr.prototype.Unlock = function() {
		var $ptr, r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; r = $f.r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = this;
		$r = $pointerOfStructConversion(r, ptrType$8).RUnlock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: rlocker.ptr.prototype.Unlock }; } $f.$ptr = $ptr; $f.r = r; $f.$s = $s; $f.$r = $r; return $f;
	};
	rlocker.prototype.Unlock = function() { return this.$val.Unlock(); };
	ptrType.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "Put", name: "Put", pkg: "", typ: $funcType([$emptyInterface], [], false)}, {prop: "getSlow", name: "getSlow", pkg: "sync", typ: $funcType([], [$emptyInterface], false)}, {prop: "pin", name: "pin", pkg: "sync", typ: $funcType([], [ptrType$6], false)}, {prop: "pinSlow", name: "pinSlow", pkg: "sync", typ: $funcType([], [ptrType$6], false)}];
	ptrType$12.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	ptrType$13.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType$1], [], false)}];
	ptrType$8.methods = [{prop: "RLock", name: "RLock", pkg: "", typ: $funcType([], [], false)}, {prop: "RUnlock", name: "RUnlock", pkg: "", typ: $funcType([], [], false)}, {prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}, {prop: "RLocker", name: "RLocker", pkg: "", typ: $funcType([], [Locker], false)}];
	ptrType$7.methods = [{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}];
	Pool.init([{prop: "local", name: "local", pkg: "sync", typ: $UnsafePointer, tag: ""}, {prop: "localSize", name: "localSize", pkg: "sync", typ: $Uintptr, tag: ""}, {prop: "store", name: "store", pkg: "sync", typ: sliceType$3, tag: ""}, {prop: "New", name: "New", pkg: "", typ: funcType, tag: ""}]);
	Mutex.init([{prop: "state", name: "state", pkg: "sync", typ: $Int32, tag: ""}, {prop: "sema", name: "sema", pkg: "sync", typ: $Uint32, tag: ""}]);
	Locker.init([{prop: "Lock", name: "Lock", pkg: "", typ: $funcType([], [], false)}, {prop: "Unlock", name: "Unlock", pkg: "", typ: $funcType([], [], false)}]);
	Once.init([{prop: "m", name: "m", pkg: "sync", typ: Mutex, tag: ""}, {prop: "done", name: "done", pkg: "sync", typ: $Uint32, tag: ""}]);
	poolLocal.init([{prop: "private$0", name: "private", pkg: "sync", typ: $emptyInterface, tag: ""}, {prop: "shared", name: "shared", pkg: "sync", typ: sliceType$3, tag: ""}, {prop: "Mutex", name: "", pkg: "", typ: Mutex, tag: ""}, {prop: "pad", name: "pad", pkg: "sync", typ: arrayType$1, tag: ""}]);
	syncSema.init([{prop: "lock", name: "lock", pkg: "sync", typ: $Uintptr, tag: ""}, {prop: "head", name: "head", pkg: "sync", typ: $UnsafePointer, tag: ""}, {prop: "tail", name: "tail", pkg: "sync", typ: $UnsafePointer, tag: ""}]);
	RWMutex.init([{prop: "w", name: "w", pkg: "sync", typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", pkg: "sync", typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", pkg: "sync", typ: $Int32, tag: ""}]);
	rlocker.init([{prop: "w", name: "w", pkg: "sync", typ: Mutex, tag: ""}, {prop: "writerSem", name: "writerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerSem", name: "readerSem", pkg: "sync", typ: $Uint32, tag: ""}, {prop: "readerCount", name: "readerCount", pkg: "sync", typ: $Int32, tag: ""}, {prop: "readerWait", name: "readerWait", pkg: "sync", typ: $Int32, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = race.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = atomic.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		allPools = sliceType.nil;
		semWaiters = {};
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["io"] = (function() {
	var $pkg = {}, $init, errors, sync, Reader, Writer, sliceType, errWhence, errOffset;
	errors = $packages["errors"];
	sync = $packages["sync"];
	Reader = $pkg.Reader = $newType(8, $kindInterface, "io.Reader", "Reader", "io", null);
	Writer = $pkg.Writer = $newType(8, $kindInterface, "io.Writer", "Writer", "io", null);
	sliceType = $sliceType($Uint8);
	Reader.init([{prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	Writer.init([{prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrShortWrite = errors.New("short write");
		$pkg.ErrShortBuffer = errors.New("short buffer");
		$pkg.EOF = errors.New("EOF");
		$pkg.ErrUnexpectedEOF = errors.New("unexpected EOF");
		$pkg.ErrNoProgress = errors.New("multiple Read calls return no data or error");
		errWhence = errors.New("Seek: invalid whence");
		errOffset = errors.New("Seek: invalid offset");
		$pkg.ErrClosedPipe = errors.New("io: read/write on closed pipe");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode"] = (function() {
	var $pkg = {}, $init, CaseRange, d, arrayType, sliceType$3, _CaseRanges, to, To, ToLower;
	CaseRange = $pkg.CaseRange = $newType(0, $kindStruct, "unicode.CaseRange", "CaseRange", "unicode", function(Lo_, Hi_, Delta_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Lo = 0;
			this.Hi = 0;
			this.Delta = arrayType.zero();
			return;
		}
		this.Lo = Lo_;
		this.Hi = Hi_;
		this.Delta = Delta_;
	});
	d = $pkg.d = $newType(12, $kindArray, "unicode.d", "d", "unicode", null);
	arrayType = $arrayType($Int32, 3);
	sliceType$3 = $sliceType(CaseRange);
	to = function(_case, r, caseRange) {
		var $ptr, _case, _q, caseRange, cr, delta, hi, lo, m, r, x;
		if (_case < 0 || 3 <= _case) {
			return 65533;
		}
		lo = 0;
		hi = caseRange.$length;
		while (true) {
			if (!(lo < hi)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			cr = ((m < 0 || m >= caseRange.$length) ? $throwRuntimeError("index out of range") : caseRange.$array[caseRange.$offset + m]);
			if ((cr.Lo >> 0) <= r && r <= (cr.Hi >> 0)) {
				delta = (x = cr.Delta, ((_case < 0 || _case >= x.length) ? $throwRuntimeError("index out of range") : x[_case]));
				if (delta > 1114111) {
					return (cr.Lo >> 0) + ((((((r - (cr.Lo >> 0) >> 0)) & ~1) >> 0) | ((_case & 1) >> 0))) >> 0;
				}
				return r + delta >> 0;
			}
			if (r < (cr.Lo >> 0)) {
				hi = m;
			} else {
				lo = m + 1 >> 0;
			}
		}
		return r;
	};
	To = function(_case, r) {
		var $ptr, _case, r;
		return to(_case, r, $pkg.CaseRanges);
	};
	$pkg.To = To;
	ToLower = function(r) {
		var $ptr, r;
		if (r <= 127) {
			if (65 <= r && r <= 90) {
				r = r + (32) >> 0;
			}
			return r;
		}
		return To(1, r);
	};
	$pkg.ToLower = ToLower;
	CaseRange.init([{prop: "Lo", name: "Lo", pkg: "", typ: $Uint32, tag: ""}, {prop: "Hi", name: "Hi", pkg: "", typ: $Uint32, tag: ""}, {prop: "Delta", name: "Delta", pkg: "", typ: d, tag: ""}]);
	d.init($Int32, 3);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_CaseRanges = new sliceType$3([new CaseRange.ptr(65, 90, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(97, 122, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(181, 181, $toNativeArray($kindInt32, [743, 0, 743])), new CaseRange.ptr(192, 214, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(216, 222, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(224, 246, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(248, 254, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(255, 255, $toNativeArray($kindInt32, [121, 0, 121])), new CaseRange.ptr(256, 303, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(304, 304, $toNativeArray($kindInt32, [0, -199, 0])), new CaseRange.ptr(305, 305, $toNativeArray($kindInt32, [-232, 0, -232])), new CaseRange.ptr(306, 311, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(313, 328, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(330, 375, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(376, 376, $toNativeArray($kindInt32, [0, -121, 0])), new CaseRange.ptr(377, 382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(383, 383, $toNativeArray($kindInt32, [-300, 0, -300])), new CaseRange.ptr(384, 384, $toNativeArray($kindInt32, [195, 0, 195])), new CaseRange.ptr(385, 385, $toNativeArray($kindInt32, [0, 210, 0])), new CaseRange.ptr(386, 389, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(390, 390, $toNativeArray($kindInt32, [0, 206, 0])), new CaseRange.ptr(391, 392, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(393, 394, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(395, 396, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(398, 398, $toNativeArray($kindInt32, [0, 79, 0])), new CaseRange.ptr(399, 399, $toNativeArray($kindInt32, [0, 202, 0])), new CaseRange.ptr(400, 400, $toNativeArray($kindInt32, [0, 203, 0])), new CaseRange.ptr(401, 402, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(403, 403, $toNativeArray($kindInt32, [0, 205, 0])), new CaseRange.ptr(404, 404, $toNativeArray($kindInt32, [0, 207, 0])), new CaseRange.ptr(405, 405, $toNativeArray($kindInt32, [97, 0, 97])), new CaseRange.ptr(406, 406, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(407, 407, $toNativeArray($kindInt32, [0, 209, 0])), new CaseRange.ptr(408, 409, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(410, 410, $toNativeArray($kindInt32, [163, 0, 163])), new CaseRange.ptr(412, 412, $toNativeArray($kindInt32, [0, 211, 0])), new CaseRange.ptr(413, 413, $toNativeArray($kindInt32, [0, 213, 0])), new CaseRange.ptr(414, 414, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(415, 415, $toNativeArray($kindInt32, [0, 214, 0])), new CaseRange.ptr(416, 421, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(422, 422, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(423, 424, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(425, 425, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(428, 429, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(430, 430, $toNativeArray($kindInt32, [0, 218, 0])), new CaseRange.ptr(431, 432, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(433, 434, $toNativeArray($kindInt32, [0, 217, 0])), new CaseRange.ptr(435, 438, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(439, 439, $toNativeArray($kindInt32, [0, 219, 0])), new CaseRange.ptr(440, 441, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(444, 445, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(447, 447, $toNativeArray($kindInt32, [56, 0, 56])), new CaseRange.ptr(452, 452, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(453, 453, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(454, 454, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(455, 455, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(456, 456, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(457, 457, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(458, 458, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(459, 459, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(460, 460, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(461, 476, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(477, 477, $toNativeArray($kindInt32, [-79, 0, -79])), new CaseRange.ptr(478, 495, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(497, 497, $toNativeArray($kindInt32, [0, 2, 1])), new CaseRange.ptr(498, 498, $toNativeArray($kindInt32, [-1, 1, 0])), new CaseRange.ptr(499, 499, $toNativeArray($kindInt32, [-2, 0, -1])), new CaseRange.ptr(500, 501, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(502, 502, $toNativeArray($kindInt32, [0, -97, 0])), new CaseRange.ptr(503, 503, $toNativeArray($kindInt32, [0, -56, 0])), new CaseRange.ptr(504, 543, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(544, 544, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(546, 563, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(570, 570, $toNativeArray($kindInt32, [0, 10795, 0])), new CaseRange.ptr(571, 572, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(573, 573, $toNativeArray($kindInt32, [0, -163, 0])), new CaseRange.ptr(574, 574, $toNativeArray($kindInt32, [0, 10792, 0])), new CaseRange.ptr(575, 576, $toNativeArray($kindInt32, [10815, 0, 10815])), new CaseRange.ptr(577, 578, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(579, 579, $toNativeArray($kindInt32, [0, -195, 0])), new CaseRange.ptr(580, 580, $toNativeArray($kindInt32, [0, 69, 0])), new CaseRange.ptr(581, 581, $toNativeArray($kindInt32, [0, 71, 0])), new CaseRange.ptr(582, 591, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(592, 592, $toNativeArray($kindInt32, [10783, 0, 10783])), new CaseRange.ptr(593, 593, $toNativeArray($kindInt32, [10780, 0, 10780])), new CaseRange.ptr(594, 594, $toNativeArray($kindInt32, [10782, 0, 10782])), new CaseRange.ptr(595, 595, $toNativeArray($kindInt32, [-210, 0, -210])), new CaseRange.ptr(596, 596, $toNativeArray($kindInt32, [-206, 0, -206])), new CaseRange.ptr(598, 599, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(601, 601, $toNativeArray($kindInt32, [-202, 0, -202])), new CaseRange.ptr(603, 603, $toNativeArray($kindInt32, [-203, 0, -203])), new CaseRange.ptr(604, 604, $toNativeArray($kindInt32, [42319, 0, 42319])), new CaseRange.ptr(608, 608, $toNativeArray($kindInt32, [-205, 0, -205])), new CaseRange.ptr(609, 609, $toNativeArray($kindInt32, [42315, 0, 42315])), new CaseRange.ptr(611, 611, $toNativeArray($kindInt32, [-207, 0, -207])), new CaseRange.ptr(613, 613, $toNativeArray($kindInt32, [42280, 0, 42280])), new CaseRange.ptr(614, 614, $toNativeArray($kindInt32, [42308, 0, 42308])), new CaseRange.ptr(616, 616, $toNativeArray($kindInt32, [-209, 0, -209])), new CaseRange.ptr(617, 617, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(619, 619, $toNativeArray($kindInt32, [10743, 0, 10743])), new CaseRange.ptr(620, 620, $toNativeArray($kindInt32, [42305, 0, 42305])), new CaseRange.ptr(623, 623, $toNativeArray($kindInt32, [-211, 0, -211])), new CaseRange.ptr(625, 625, $toNativeArray($kindInt32, [10749, 0, 10749])), new CaseRange.ptr(626, 626, $toNativeArray($kindInt32, [-213, 0, -213])), new CaseRange.ptr(629, 629, $toNativeArray($kindInt32, [-214, 0, -214])), new CaseRange.ptr(637, 637, $toNativeArray($kindInt32, [10727, 0, 10727])), new CaseRange.ptr(640, 640, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(643, 643, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(647, 647, $toNativeArray($kindInt32, [42282, 0, 42282])), new CaseRange.ptr(648, 648, $toNativeArray($kindInt32, [-218, 0, -218])), new CaseRange.ptr(649, 649, $toNativeArray($kindInt32, [-69, 0, -69])), new CaseRange.ptr(650, 651, $toNativeArray($kindInt32, [-217, 0, -217])), new CaseRange.ptr(652, 652, $toNativeArray($kindInt32, [-71, 0, -71])), new CaseRange.ptr(658, 658, $toNativeArray($kindInt32, [-219, 0, -219])), new CaseRange.ptr(669, 669, $toNativeArray($kindInt32, [42261, 0, 42261])), new CaseRange.ptr(670, 670, $toNativeArray($kindInt32, [42258, 0, 42258])), new CaseRange.ptr(837, 837, $toNativeArray($kindInt32, [84, 0, 84])), new CaseRange.ptr(880, 883, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(886, 887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(891, 893, $toNativeArray($kindInt32, [130, 0, 130])), new CaseRange.ptr(895, 895, $toNativeArray($kindInt32, [0, 116, 0])), new CaseRange.ptr(902, 902, $toNativeArray($kindInt32, [0, 38, 0])), new CaseRange.ptr(904, 906, $toNativeArray($kindInt32, [0, 37, 0])), new CaseRange.ptr(908, 908, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(910, 911, $toNativeArray($kindInt32, [0, 63, 0])), new CaseRange.ptr(913, 929, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(931, 939, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(940, 940, $toNativeArray($kindInt32, [-38, 0, -38])), new CaseRange.ptr(941, 943, $toNativeArray($kindInt32, [-37, 0, -37])), new CaseRange.ptr(945, 961, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(962, 962, $toNativeArray($kindInt32, [-31, 0, -31])), new CaseRange.ptr(963, 971, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(972, 972, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(973, 974, $toNativeArray($kindInt32, [-63, 0, -63])), new CaseRange.ptr(975, 975, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(976, 976, $toNativeArray($kindInt32, [-62, 0, -62])), new CaseRange.ptr(977, 977, $toNativeArray($kindInt32, [-57, 0, -57])), new CaseRange.ptr(981, 981, $toNativeArray($kindInt32, [-47, 0, -47])), new CaseRange.ptr(982, 982, $toNativeArray($kindInt32, [-54, 0, -54])), new CaseRange.ptr(983, 983, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(984, 1007, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1008, 1008, $toNativeArray($kindInt32, [-86, 0, -86])), new CaseRange.ptr(1009, 1009, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1010, 1010, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(1011, 1011, $toNativeArray($kindInt32, [-116, 0, -116])), new CaseRange.ptr(1012, 1012, $toNativeArray($kindInt32, [0, -60, 0])), new CaseRange.ptr(1013, 1013, $toNativeArray($kindInt32, [-96, 0, -96])), new CaseRange.ptr(1015, 1016, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1017, 1017, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(1018, 1019, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1021, 1023, $toNativeArray($kindInt32, [0, -130, 0])), new CaseRange.ptr(1024, 1039, $toNativeArray($kindInt32, [0, 80, 0])), new CaseRange.ptr(1040, 1071, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(1072, 1103, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(1104, 1119, $toNativeArray($kindInt32, [-80, 0, -80])), new CaseRange.ptr(1120, 1153, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1162, 1215, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1216, 1216, $toNativeArray($kindInt32, [0, 15, 0])), new CaseRange.ptr(1217, 1230, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1231, 1231, $toNativeArray($kindInt32, [-15, 0, -15])), new CaseRange.ptr(1232, 1327, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(1329, 1366, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(1377, 1414, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(4256, 4293, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4295, 4295, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(4301, 4301, $toNativeArray($kindInt32, [0, 7264, 0])), new CaseRange.ptr(5024, 5103, $toNativeArray($kindInt32, [0, 38864, 0])), new CaseRange.ptr(5104, 5109, $toNativeArray($kindInt32, [0, 8, 0])), new CaseRange.ptr(5112, 5117, $toNativeArray($kindInt32, [-8, 0, -8])), new CaseRange.ptr(7545, 7545, $toNativeArray($kindInt32, [35332, 0, 35332])), new CaseRange.ptr(7549, 7549, $toNativeArray($kindInt32, [3814, 0, 3814])), new CaseRange.ptr(7680, 7829, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7835, 7835, $toNativeArray($kindInt32, [-59, 0, -59])), new CaseRange.ptr(7838, 7838, $toNativeArray($kindInt32, [0, -7615, 0])), new CaseRange.ptr(7840, 7935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(7936, 7943, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7944, 7951, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7952, 7957, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7960, 7965, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7968, 7975, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7976, 7983, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(7984, 7991, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(7992, 7999, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8000, 8005, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8008, 8013, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8017, 8017, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8019, 8019, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8021, 8021, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8023, 8023, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8025, 8025, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8027, 8027, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8029, 8029, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8031, 8031, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8032, 8039, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8040, 8047, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8048, 8049, $toNativeArray($kindInt32, [74, 0, 74])), new CaseRange.ptr(8050, 8053, $toNativeArray($kindInt32, [86, 0, 86])), new CaseRange.ptr(8054, 8055, $toNativeArray($kindInt32, [100, 0, 100])), new CaseRange.ptr(8056, 8057, $toNativeArray($kindInt32, [128, 0, 128])), new CaseRange.ptr(8058, 8059, $toNativeArray($kindInt32, [112, 0, 112])), new CaseRange.ptr(8060, 8061, $toNativeArray($kindInt32, [126, 0, 126])), new CaseRange.ptr(8064, 8071, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8072, 8079, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8080, 8087, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8088, 8095, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8096, 8103, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8104, 8111, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8112, 8113, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8115, 8115, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8120, 8121, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8122, 8123, $toNativeArray($kindInt32, [0, -74, 0])), new CaseRange.ptr(8124, 8124, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8126, 8126, $toNativeArray($kindInt32, [-7205, 0, -7205])), new CaseRange.ptr(8131, 8131, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8136, 8139, $toNativeArray($kindInt32, [0, -86, 0])), new CaseRange.ptr(8140, 8140, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8144, 8145, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8152, 8153, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8154, 8155, $toNativeArray($kindInt32, [0, -100, 0])), new CaseRange.ptr(8160, 8161, $toNativeArray($kindInt32, [8, 0, 8])), new CaseRange.ptr(8165, 8165, $toNativeArray($kindInt32, [7, 0, 7])), new CaseRange.ptr(8168, 8169, $toNativeArray($kindInt32, [0, -8, 0])), new CaseRange.ptr(8170, 8171, $toNativeArray($kindInt32, [0, -112, 0])), new CaseRange.ptr(8172, 8172, $toNativeArray($kindInt32, [0, -7, 0])), new CaseRange.ptr(8179, 8179, $toNativeArray($kindInt32, [9, 0, 9])), new CaseRange.ptr(8184, 8185, $toNativeArray($kindInt32, [0, -128, 0])), new CaseRange.ptr(8186, 8187, $toNativeArray($kindInt32, [0, -126, 0])), new CaseRange.ptr(8188, 8188, $toNativeArray($kindInt32, [0, -9, 0])), new CaseRange.ptr(8486, 8486, $toNativeArray($kindInt32, [0, -7517, 0])), new CaseRange.ptr(8490, 8490, $toNativeArray($kindInt32, [0, -8383, 0])), new CaseRange.ptr(8491, 8491, $toNativeArray($kindInt32, [0, -8262, 0])), new CaseRange.ptr(8498, 8498, $toNativeArray($kindInt32, [0, 28, 0])), new CaseRange.ptr(8526, 8526, $toNativeArray($kindInt32, [-28, 0, -28])), new CaseRange.ptr(8544, 8559, $toNativeArray($kindInt32, [0, 16, 0])), new CaseRange.ptr(8560, 8575, $toNativeArray($kindInt32, [-16, 0, -16])), new CaseRange.ptr(8579, 8580, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(9398, 9423, $toNativeArray($kindInt32, [0, 26, 0])), new CaseRange.ptr(9424, 9449, $toNativeArray($kindInt32, [-26, 0, -26])), new CaseRange.ptr(11264, 11310, $toNativeArray($kindInt32, [0, 48, 0])), new CaseRange.ptr(11312, 11358, $toNativeArray($kindInt32, [-48, 0, -48])), new CaseRange.ptr(11360, 11361, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11362, 11362, $toNativeArray($kindInt32, [0, -10743, 0])), new CaseRange.ptr(11363, 11363, $toNativeArray($kindInt32, [0, -3814, 0])), new CaseRange.ptr(11364, 11364, $toNativeArray($kindInt32, [0, -10727, 0])), new CaseRange.ptr(11365, 11365, $toNativeArray($kindInt32, [-10795, 0, -10795])), new CaseRange.ptr(11366, 11366, $toNativeArray($kindInt32, [-10792, 0, -10792])), new CaseRange.ptr(11367, 11372, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11373, 11373, $toNativeArray($kindInt32, [0, -10780, 0])), new CaseRange.ptr(11374, 11374, $toNativeArray($kindInt32, [0, -10749, 0])), new CaseRange.ptr(11375, 11375, $toNativeArray($kindInt32, [0, -10783, 0])), new CaseRange.ptr(11376, 11376, $toNativeArray($kindInt32, [0, -10782, 0])), new CaseRange.ptr(11378, 11379, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11381, 11382, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11390, 11391, $toNativeArray($kindInt32, [0, -10815, 0])), new CaseRange.ptr(11392, 11491, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11499, 11502, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11506, 11507, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(11520, 11557, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11559, 11559, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(11565, 11565, $toNativeArray($kindInt32, [-7264, 0, -7264])), new CaseRange.ptr(42560, 42605, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42624, 42651, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42786, 42799, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42802, 42863, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42873, 42876, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42877, 42877, $toNativeArray($kindInt32, [0, -35332, 0])), new CaseRange.ptr(42878, 42887, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42891, 42892, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42893, 42893, $toNativeArray($kindInt32, [0, -42280, 0])), new CaseRange.ptr(42896, 42899, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42902, 42921, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(42922, 42922, $toNativeArray($kindInt32, [0, -42308, 0])), new CaseRange.ptr(42923, 42923, $toNativeArray($kindInt32, [0, -42319, 0])), new CaseRange.ptr(42924, 42924, $toNativeArray($kindInt32, [0, -42315, 0])), new CaseRange.ptr(42925, 42925, $toNativeArray($kindInt32, [0, -42305, 0])), new CaseRange.ptr(42928, 42928, $toNativeArray($kindInt32, [0, -42258, 0])), new CaseRange.ptr(42929, 42929, $toNativeArray($kindInt32, [0, -42282, 0])), new CaseRange.ptr(42930, 42930, $toNativeArray($kindInt32, [0, -42261, 0])), new CaseRange.ptr(42931, 42931, $toNativeArray($kindInt32, [0, 928, 0])), new CaseRange.ptr(42932, 42935, $toNativeArray($kindInt32, [1114112, 1114112, 1114112])), new CaseRange.ptr(43859, 43859, $toNativeArray($kindInt32, [-928, 0, -928])), new CaseRange.ptr(43888, 43967, $toNativeArray($kindInt32, [-38864, 0, -38864])), new CaseRange.ptr(65313, 65338, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(65345, 65370, $toNativeArray($kindInt32, [-32, 0, -32])), new CaseRange.ptr(66560, 66599, $toNativeArray($kindInt32, [0, 40, 0])), new CaseRange.ptr(66600, 66639, $toNativeArray($kindInt32, [-40, 0, -40])), new CaseRange.ptr(68736, 68786, $toNativeArray($kindInt32, [0, 64, 0])), new CaseRange.ptr(68800, 68850, $toNativeArray($kindInt32, [-64, 0, -64])), new CaseRange.ptr(71840, 71871, $toNativeArray($kindInt32, [0, 32, 0])), new CaseRange.ptr(71872, 71903, $toNativeArray($kindInt32, [-32, 0, -32]))]);
		$pkg.CaseRanges = _CaseRanges;
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf8"] = (function() {
	var $pkg = {}, $init, acceptRange, first, acceptRanges, DecodeRune, DecodeRuneInString, DecodeLastRune, DecodeLastRuneInString, RuneLen, EncodeRune, RuneCountInString, RuneStart;
	acceptRange = $pkg.acceptRange = $newType(0, $kindStruct, "utf8.acceptRange", "acceptRange", "unicode/utf8", function(lo_, hi_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.lo = 0;
			this.hi = 0;
			return;
		}
		this.lo = lo_;
		this.hi = hi_;
	});
	DecodeRune = function(p) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, b1, b2, b3, mask, n, p, p0, r, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = p.$length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		p0 = (0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0]);
		x = ((p0 < 0 || p0 >= first.length) ? $throwRuntimeError("index out of range") : first[p0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = ((((0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0]) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		b1 = (1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1]);
		if (b1 < accept.lo || accept.hi < b1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((p0 & 31) >>> 0) >> 0) << 6 >> 0) | (((b1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		b2 = (2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2]);
		if (b2 < 128 || 191 < b2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((p0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((b1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((b2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		b3 = (3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3]);
		if (b3 < 128 || 191 < b3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((p0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((b1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((b2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((b3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRune = DecodeRune;
	DecodeRuneInString = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, accept, mask, n, r, s, s0, s1, s2, s3, size, sz, x, x$1;
		r = 0;
		size = 0;
		n = s.length;
		if (n < 1) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		s0 = s.charCodeAt(0);
		x = ((s0 < 0 || s0 >= first.length) ? $throwRuntimeError("index out of range") : first[s0]);
		if (x >= 240) {
			mask = ((x >> 0) << 31 >> 0) >> 31 >> 0;
			_tmp$2 = (((s.charCodeAt(0) >> 0) & ~mask) >> 0) | (65533 & mask);
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		sz = (x & 7) >>> 0;
		accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
		if (n < (sz >> 0)) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		s1 = s.charCodeAt(1);
		if (s1 < accept.lo || accept.hi < s1) {
			_tmp$6 = 65533;
			_tmp$7 = 1;
			r = _tmp$6;
			size = _tmp$7;
			return [r, size];
		}
		if (sz === 2) {
			_tmp$8 = ((((s0 & 31) >>> 0) >> 0) << 6 >> 0) | (((s1 & 63) >>> 0) >> 0);
			_tmp$9 = 2;
			r = _tmp$8;
			size = _tmp$9;
			return [r, size];
		}
		s2 = s.charCodeAt(2);
		if (s2 < 128 || 191 < s2) {
			_tmp$10 = 65533;
			_tmp$11 = 1;
			r = _tmp$10;
			size = _tmp$11;
			return [r, size];
		}
		if (sz === 3) {
			_tmp$12 = (((((s0 & 15) >>> 0) >> 0) << 12 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s2 & 63) >>> 0) >> 0);
			_tmp$13 = 3;
			r = _tmp$12;
			size = _tmp$13;
			return [r, size];
		}
		s3 = s.charCodeAt(3);
		if (s3 < 128 || 191 < s3) {
			_tmp$14 = 65533;
			_tmp$15 = 1;
			r = _tmp$14;
			size = _tmp$15;
			return [r, size];
		}
		_tmp$16 = ((((((s0 & 7) >>> 0) >> 0) << 18 >> 0) | ((((s1 & 63) >>> 0) >> 0) << 12 >> 0)) | ((((s2 & 63) >>> 0) >> 0) << 6 >> 0)) | (((s3 & 63) >>> 0) >> 0);
		_tmp$17 = 4;
		r = _tmp$16;
		size = _tmp$17;
		return [r, size];
	};
	$pkg.DecodeRuneInString = DecodeRuneInString;
	DecodeLastRune = function(p) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, end, lim, p, r, size, start;
		r = 0;
		size = 0;
		end = p.$length;
		if (end === 0) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		start = end - 1 >> 0;
		r = (((start < 0 || start >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + start]) >> 0);
		if (r < 128) {
			_tmp$2 = r;
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		lim = end - 4 >> 0;
		if (lim < 0) {
			lim = 0;
		}
		start = start - (1) >> 0;
		while (true) {
			if (!(start >= lim)) { break; }
			if (RuneStart(((start < 0 || start >= p.$length) ? $throwRuntimeError("index out of range") : p.$array[p.$offset + start]))) {
				break;
			}
			start = start - (1) >> 0;
		}
		if (start < 0) {
			start = 0;
		}
		_tuple = DecodeRune($subslice(p, start, end));
		r = _tuple[0];
		size = _tuple[1];
		if (!(((start + size >> 0) === end))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		_tmp$6 = r;
		_tmp$7 = size;
		r = _tmp$6;
		size = _tmp$7;
		return [r, size];
	};
	$pkg.DecodeLastRune = DecodeLastRune;
	DecodeLastRuneInString = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, end, lim, r, s, size, start;
		r = 0;
		size = 0;
		end = s.length;
		if (end === 0) {
			_tmp = 65533;
			_tmp$1 = 0;
			r = _tmp;
			size = _tmp$1;
			return [r, size];
		}
		start = end - 1 >> 0;
		r = (s.charCodeAt(start) >> 0);
		if (r < 128) {
			_tmp$2 = r;
			_tmp$3 = 1;
			r = _tmp$2;
			size = _tmp$3;
			return [r, size];
		}
		lim = end - 4 >> 0;
		if (lim < 0) {
			lim = 0;
		}
		start = start - (1) >> 0;
		while (true) {
			if (!(start >= lim)) { break; }
			if (RuneStart(s.charCodeAt(start))) {
				break;
			}
			start = start - (1) >> 0;
		}
		if (start < 0) {
			start = 0;
		}
		_tuple = DecodeRuneInString(s.substring(start, end));
		r = _tuple[0];
		size = _tuple[1];
		if (!(((start + size >> 0) === end))) {
			_tmp$4 = 65533;
			_tmp$5 = 1;
			r = _tmp$4;
			size = _tmp$5;
			return [r, size];
		}
		_tmp$6 = r;
		_tmp$7 = size;
		r = _tmp$6;
		size = _tmp$7;
		return [r, size];
	};
	$pkg.DecodeLastRuneInString = DecodeLastRuneInString;
	RuneLen = function(r) {
		var $ptr, r;
		if (r < 0) {
			return -1;
		} else if (r <= 127) {
			return 1;
		} else if (r <= 2047) {
			return 2;
		} else if (55296 <= r && r <= 57343) {
			return -1;
		} else if (r <= 65535) {
			return 3;
		} else if (r <= 1114111) {
			return 4;
		}
		return -1;
	};
	$pkg.RuneLen = RuneLen;
	EncodeRune = function(p, r) {
		var $ptr, i, p, r;
		i = (r >>> 0);
		if (i <= 127) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = (r << 24 >>> 24));
			return 1;
		} else if (i <= 2047) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((192 | ((r >> 6 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 2;
		} else if ((i > 1114111) || (55296 <= i && i <= 57343)) {
			r = 65533;
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else if (i <= 65535) {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((224 | ((r >> 12 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 3;
		} else {
			(0 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 0] = ((240 | ((r >> 18 >> 0) << 24 >>> 24)) >>> 0));
			(1 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 1] = ((128 | ((((r >> 12 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(2 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 2] = ((128 | ((((r >> 6 >> 0) << 24 >>> 24) & 63) >>> 0)) >>> 0));
			(3 >= p.$length ? $throwRuntimeError("index out of range") : p.$array[p.$offset + 3] = ((128 | (((r << 24 >>> 24) & 63) >>> 0)) >>> 0));
			return 4;
		}
	};
	$pkg.EncodeRune = EncodeRune;
	RuneCountInString = function(s) {
		var $ptr, accept, c, c$1, c$2, c$3, i, n, ns, s, size, x, x$1;
		n = 0;
		ns = s.length;
		i = 0;
		while (true) {
			if (!(i < ns)) { break; }
			c = s.charCodeAt(i);
			if (c < 128) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			x = ((c < 0 || c >= first.length) ? $throwRuntimeError("index out of range") : first[c]);
			if (x === 241) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			size = (((x & 7) >>> 0) >> 0);
			if ((i + size >> 0) > ns) {
				i = i + (1) >> 0;
				n = n + (1) >> 0;
				continue;
			}
			accept = $clone((x$1 = x >>> 4 << 24 >>> 24, ((x$1 < 0 || x$1 >= acceptRanges.length) ? $throwRuntimeError("index out of range") : acceptRanges[x$1])), acceptRange);
			c$1 = s.charCodeAt((i + 1 >> 0));
			if (c$1 < accept.lo || accept.hi < c$1) {
				size = 1;
			} else if (size === 2) {
			} else {
				c$2 = s.charCodeAt((i + 2 >> 0));
				if (c$2 < 128 || 191 < c$2) {
					size = 1;
				} else if (size === 3) {
				} else {
					c$3 = s.charCodeAt((i + 3 >> 0));
					if (c$3 < 128 || 191 < c$3) {
						size = 1;
					}
				}
			}
			i = i + (size) >> 0;
			n = n + (1) >> 0;
		}
		n = n;
		return n;
	};
	$pkg.RuneCountInString = RuneCountInString;
	RuneStart = function(b) {
		var $ptr, b;
		return !((((b & 192) >>> 0) === 128));
	};
	$pkg.RuneStart = RuneStart;
	acceptRange.init([{prop: "lo", name: "lo", pkg: "unicode/utf8", typ: $Uint8, tag: ""}, {prop: "hi", name: "hi", pkg: "unicode/utf8", typ: $Uint8, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		first = $toNativeArray($kindUint8, [240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 240, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 19, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 35, 3, 3, 52, 4, 4, 4, 68, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241, 241]);
		acceptRanges = $toNativeArray($kindStruct, [new acceptRange.ptr(128, 191), new acceptRange.ptr(160, 191), new acceptRange.ptr(128, 159), new acceptRange.ptr(144, 191), new acceptRange.ptr(128, 143)]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["bytes"] = (function() {
	var $pkg = {}, $init, errors, io, unicode, utf8, Buffer, readOp, ptrType, sliceType, arrayType, arrayType$1, IndexByte, makeSlice;
	errors = $packages["errors"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	Buffer = $pkg.Buffer = $newType(0, $kindStruct, "bytes.Buffer", "Buffer", "bytes", function(buf_, off_, runeBytes_, bootstrap_, lastRead_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.buf = sliceType.nil;
			this.off = 0;
			this.runeBytes = arrayType.zero();
			this.bootstrap = arrayType$1.zero();
			this.lastRead = 0;
			return;
		}
		this.buf = buf_;
		this.off = off_;
		this.runeBytes = runeBytes_;
		this.bootstrap = bootstrap_;
		this.lastRead = lastRead_;
	});
	readOp = $pkg.readOp = $newType(4, $kindInt, "bytes.readOp", "readOp", "bytes", null);
	ptrType = $ptrType(Buffer);
	sliceType = $sliceType($Uint8);
	arrayType = $arrayType($Uint8, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	IndexByte = function(s, c) {
		var $ptr, _i, _ref, b, c, i, s;
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			b = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (b === c) {
				return i;
			}
			_i++;
		}
		return -1;
	};
	$pkg.IndexByte = IndexByte;
	Buffer.ptr.prototype.Bytes = function() {
		var $ptr, b;
		b = this;
		return $subslice(b.buf, b.off);
	};
	Buffer.prototype.Bytes = function() { return this.$val.Bytes(); };
	Buffer.ptr.prototype.String = function() {
		var $ptr, b;
		b = this;
		if (b === ptrType.nil) {
			return "<nil>";
		}
		return $bytesToString($subslice(b.buf, b.off));
	};
	Buffer.prototype.String = function() { return this.$val.String(); };
	Buffer.ptr.prototype.Len = function() {
		var $ptr, b;
		b = this;
		return b.buf.$length - b.off >> 0;
	};
	Buffer.prototype.Len = function() { return this.$val.Len(); };
	Buffer.ptr.prototype.Cap = function() {
		var $ptr, b;
		b = this;
		return b.buf.$capacity;
	};
	Buffer.prototype.Cap = function() { return this.$val.Cap(); };
	Buffer.ptr.prototype.Truncate = function(n) {
		var $ptr, b, n;
		b = this;
		b.lastRead = 0;
		if (n < 0 || n > b.Len()) {
			$panic(new $String("bytes.Buffer: truncation out of range"));
		} else if ((n === 0)) {
			b.off = 0;
		}
		b.buf = $subslice(b.buf, 0, (b.off + n >> 0));
	};
	Buffer.prototype.Truncate = function(n) { return this.$val.Truncate(n); };
	Buffer.ptr.prototype.Reset = function() {
		var $ptr, b;
		b = this;
		b.Truncate(0);
	};
	Buffer.prototype.Reset = function() { return this.$val.Reset(); };
	Buffer.ptr.prototype.grow = function(n) {
		var $ptr, _q, b, buf, m, n;
		b = this;
		m = b.Len();
		if ((m === 0) && !((b.off === 0))) {
			b.Truncate(0);
		}
		if ((b.buf.$length + n >> 0) > b.buf.$capacity) {
			buf = sliceType.nil;
			if (b.buf === sliceType.nil && n <= 64) {
				buf = $subslice(new sliceType(b.bootstrap), 0);
			} else if ((m + n >> 0) <= (_q = b.buf.$capacity / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"))) {
				$copySlice(b.buf, $subslice(b.buf, b.off));
				buf = $subslice(b.buf, 0, m);
			} else {
				buf = makeSlice(($imul(2, b.buf.$capacity)) + n >> 0);
				$copySlice(buf, $subslice(b.buf, b.off));
			}
			b.buf = buf;
			b.off = 0;
		}
		b.buf = $subslice(b.buf, 0, ((b.off + m >> 0) + n >> 0));
		return b.off + m >> 0;
	};
	Buffer.prototype.grow = function(n) { return this.$val.grow(n); };
	Buffer.ptr.prototype.Grow = function(n) {
		var $ptr, b, m, n;
		b = this;
		if (n < 0) {
			$panic(new $String("bytes.Buffer.Grow: negative count"));
		}
		m = b.grow(n);
		b.buf = $subslice(b.buf, 0, m);
	};
	Buffer.prototype.Grow = function(n) { return this.$val.Grow(n); };
	Buffer.ptr.prototype.Write = function(p) {
		var $ptr, _tmp, _tmp$1, b, err, m, n, p;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		m = b.grow(p.$length);
		_tmp = $copySlice($subslice(b.buf, m), p);
		_tmp$1 = $ifaceNil;
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	Buffer.prototype.Write = function(p) { return this.$val.Write(p); };
	Buffer.ptr.prototype.WriteString = function(s) {
		var $ptr, _tmp, _tmp$1, b, err, m, n, s;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		m = b.grow(s.length);
		_tmp = $copyString($subslice(b.buf, m), s);
		_tmp$1 = $ifaceNil;
		n = _tmp;
		err = _tmp$1;
		return [n, err];
	};
	Buffer.prototype.WriteString = function(s) { return this.$val.WriteString(s); };
	Buffer.ptr.prototype.ReadFrom = function(r) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, free, m, n, newBuf, r, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; b = $f.b; e = $f.e; err = $f.err; free = $f.free; m = $f.m; n = $f.n; newBuf = $f.newBuf; r = $f.r; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
		}
		/* while (true) { */ case 1:
			free = b.buf.$capacity - b.buf.$length >> 0;
			if (free < 512) {
				newBuf = b.buf;
				if ((b.off + free >> 0) < 512) {
					newBuf = makeSlice(($imul(2, b.buf.$capacity)) + 512 >> 0);
				}
				$copySlice(newBuf, $subslice(b.buf, b.off));
				b.buf = $subslice(newBuf, 0, (b.buf.$length - b.off >> 0));
				b.off = 0;
			}
			_r = r.Read($subslice(b.buf, b.buf.$length, b.buf.$capacity)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			m = _tuple[0];
			e = _tuple[1];
			b.buf = $subslice(b.buf, 0, (b.buf.$length + m >> 0));
			n = (x = new $Int64(0, m), new $Int64(n.$high + x.$high, n.$low + x.$low));
			if ($interfaceIsEqual(e, io.EOF)) {
				/* break; */ $s = 2; continue;
			}
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tmp = n;
				_tmp$1 = e;
				n = _tmp;
				err = _tmp$1;
				return [n, err];
			}
		/* } */ $s = 1; continue; case 2:
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Buffer.ptr.prototype.ReadFrom }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.b = b; $f.e = e; $f.err = err; $f.free = free; $f.m = m; $f.n = n; $f.newBuf = newBuf; $f.r = r; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Buffer.prototype.ReadFrom = function(r) { return this.$val.ReadFrom(r); };
	makeSlice = function(n) {
		var $ptr, n, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			var $ptr;
			if (!($interfaceIsEqual($recover(), $ifaceNil))) {
				$panic($pkg.ErrTooLarge);
			}
		}), []]);
		return $makeSlice(sliceType, n);
		/* */ } catch(err) { $err = err; return sliceType.nil; } finally { $callDeferred($deferred, $err); }
	};
	Buffer.ptr.prototype.WriteTo = function(w) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple, b, e, err, m, n, nBytes, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tuple = $f._tuple; b = $f.b; e = $f.e; err = $f.err; m = $f.m; n = $f.n; nBytes = $f.nBytes; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = new $Int64(0, 0);
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		/* */ if (b.off < b.buf.$length) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (b.off < b.buf.$length) { */ case 1:
			nBytes = b.Len();
			_r = w.Write($subslice(b.buf, b.off)); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			m = _tuple[0];
			e = _tuple[1];
			if (m > nBytes) {
				$panic(new $String("bytes.Buffer.WriteTo: invalid Write count"));
			}
			b.off = b.off + (m) >> 0;
			n = new $Int64(0, m);
			if (!($interfaceIsEqual(e, $ifaceNil))) {
				_tmp = n;
				_tmp$1 = e;
				n = _tmp;
				err = _tmp$1;
				return [n, err];
			}
			if (!((m === nBytes))) {
				_tmp$2 = n;
				_tmp$3 = io.ErrShortWrite;
				n = _tmp$2;
				err = _tmp$3;
				return [n, err];
			}
		/* } */ case 2:
		b.Truncate(0);
		return [n, err];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Buffer.ptr.prototype.WriteTo }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tuple = _tuple; $f.b = b; $f.e = e; $f.err = err; $f.m = m; $f.n = n; $f.nBytes = nBytes; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	Buffer.prototype.WriteTo = function(w) { return this.$val.WriteTo(w); };
	Buffer.ptr.prototype.WriteByte = function(c) {
		var $ptr, b, c, m, x;
		b = this;
		b.lastRead = 0;
		m = b.grow(1);
		(x = b.buf, ((m < 0 || m >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + m] = c));
		return $ifaceNil;
	};
	Buffer.prototype.WriteByte = function(c) { return this.$val.WriteByte(c); };
	Buffer.ptr.prototype.WriteRune = function(r) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, b, err, n, r;
		n = 0;
		err = $ifaceNil;
		b = this;
		if (r < 128) {
			b.WriteByte((r << 24 >>> 24));
			_tmp = 1;
			_tmp$1 = $ifaceNil;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		n = utf8.EncodeRune($subslice(new sliceType(b.runeBytes), 0), r);
		b.Write($subslice(new sliceType(b.runeBytes), 0, n));
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
	};
	Buffer.prototype.WriteRune = function(r) { return this.$val.WriteRune(r); };
	Buffer.ptr.prototype.Read = function(p) {
		var $ptr, _tmp, _tmp$1, b, err, n, p;
		n = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			if (p.$length === 0) {
				return [n, err];
			}
			_tmp = 0;
			_tmp$1 = io.EOF;
			n = _tmp;
			err = _tmp$1;
			return [n, err];
		}
		n = $copySlice(p, $subslice(b.buf, b.off));
		b.off = b.off + (n) >> 0;
		if (n > 0) {
			b.lastRead = 2;
		}
		return [n, err];
	};
	Buffer.prototype.Read = function(p) { return this.$val.Read(p); };
	Buffer.ptr.prototype.Next = function(n) {
		var $ptr, b, data, m, n;
		b = this;
		b.lastRead = 0;
		m = b.Len();
		if (n > m) {
			n = m;
		}
		data = $subslice(b.buf, b.off, (b.off + n >> 0));
		b.off = b.off + (n) >> 0;
		if (n > 0) {
			b.lastRead = 2;
		}
		return data;
	};
	Buffer.prototype.Next = function(n) { return this.$val.Next(n); };
	Buffer.ptr.prototype.ReadByte = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, b, c, err, x, x$1;
		c = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			_tmp = 0;
			_tmp$1 = io.EOF;
			c = _tmp;
			err = _tmp$1;
			return [c, err];
		}
		c = (x = b.buf, x$1 = b.off, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		b.off = b.off + (1) >> 0;
		b.lastRead = 2;
		_tmp$2 = c;
		_tmp$3 = $ifaceNil;
		c = _tmp$2;
		err = _tmp$3;
		return [c, err];
	};
	Buffer.prototype.ReadByte = function() { return this.$val.ReadByte(); };
	Buffer.ptr.prototype.ReadRune = function() {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tuple, b, c, err, n, r, size, x, x$1;
		r = 0;
		size = 0;
		err = $ifaceNil;
		b = this;
		b.lastRead = 0;
		if (b.off >= b.buf.$length) {
			b.Truncate(0);
			_tmp = 0;
			_tmp$1 = 0;
			_tmp$2 = io.EOF;
			r = _tmp;
			size = _tmp$1;
			err = _tmp$2;
			return [r, size, err];
		}
		b.lastRead = 1;
		c = (x = b.buf, x$1 = b.off, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
		if (c < 128) {
			b.off = b.off + (1) >> 0;
			_tmp$3 = (c >> 0);
			_tmp$4 = 1;
			_tmp$5 = $ifaceNil;
			r = _tmp$3;
			size = _tmp$4;
			err = _tmp$5;
			return [r, size, err];
		}
		_tuple = utf8.DecodeRune($subslice(b.buf, b.off));
		r = _tuple[0];
		n = _tuple[1];
		b.off = b.off + (n) >> 0;
		_tmp$6 = r;
		_tmp$7 = n;
		_tmp$8 = $ifaceNil;
		r = _tmp$6;
		size = _tmp$7;
		err = _tmp$8;
		return [r, size, err];
	};
	Buffer.prototype.ReadRune = function() { return this.$val.ReadRune(); };
	Buffer.ptr.prototype.UnreadRune = function() {
		var $ptr, _tuple, b, n;
		b = this;
		if (!((b.lastRead === 1))) {
			return errors.New("bytes.Buffer: UnreadRune: previous operation was not ReadRune");
		}
		b.lastRead = 0;
		if (b.off > 0) {
			_tuple = utf8.DecodeLastRune($subslice(b.buf, 0, b.off));
			n = _tuple[1];
			b.off = b.off - (n) >> 0;
		}
		return $ifaceNil;
	};
	Buffer.prototype.UnreadRune = function() { return this.$val.UnreadRune(); };
	Buffer.ptr.prototype.UnreadByte = function() {
		var $ptr, b;
		b = this;
		if (!((b.lastRead === 1)) && !((b.lastRead === 2))) {
			return errors.New("bytes.Buffer: UnreadByte: previous operation was not a read");
		}
		b.lastRead = 0;
		if (b.off > 0) {
			b.off = b.off - (1) >> 0;
		}
		return $ifaceNil;
	};
	Buffer.prototype.UnreadByte = function() { return this.$val.UnreadByte(); };
	Buffer.ptr.prototype.ReadBytes = function(delim) {
		var $ptr, _tuple, b, delim, err, line, slice;
		line = sliceType.nil;
		err = $ifaceNil;
		b = this;
		_tuple = b.readSlice(delim);
		slice = _tuple[0];
		err = _tuple[1];
		line = $appendSlice(line, slice);
		return [line, err];
	};
	Buffer.prototype.ReadBytes = function(delim) { return this.$val.ReadBytes(delim); };
	Buffer.ptr.prototype.readSlice = function(delim) {
		var $ptr, _tmp, _tmp$1, b, delim, end, err, i, line;
		line = sliceType.nil;
		err = $ifaceNil;
		b = this;
		i = IndexByte($subslice(b.buf, b.off), delim);
		end = (b.off + i >> 0) + 1 >> 0;
		if (i < 0) {
			end = b.buf.$length;
			err = io.EOF;
		}
		line = $subslice(b.buf, b.off, end);
		b.off = end;
		b.lastRead = 2;
		_tmp = line;
		_tmp$1 = err;
		line = _tmp;
		err = _tmp$1;
		return [line, err];
	};
	Buffer.prototype.readSlice = function(delim) { return this.$val.readSlice(delim); };
	Buffer.ptr.prototype.ReadString = function(delim) {
		var $ptr, _tmp, _tmp$1, _tuple, b, delim, err, line, slice;
		line = "";
		err = $ifaceNil;
		b = this;
		_tuple = b.readSlice(delim);
		slice = _tuple[0];
		err = _tuple[1];
		_tmp = $bytesToString(slice);
		_tmp$1 = err;
		line = _tmp;
		err = _tmp$1;
		return [line, err];
	};
	Buffer.prototype.ReadString = function(delim) { return this.$val.ReadString(delim); };
	ptrType.methods = [{prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "grow", name: "grow", pkg: "bytes", typ: $funcType([$Int], [$Int], false)}, {prop: "Grow", name: "Grow", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Write", name: "Write", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "WriteString", name: "WriteString", pkg: "", typ: $funcType([$String], [$Int, $error], false)}, {prop: "ReadFrom", name: "ReadFrom", pkg: "", typ: $funcType([io.Reader], [$Int64, $error], false)}, {prop: "WriteTo", name: "WriteTo", pkg: "", typ: $funcType([io.Writer], [$Int64, $error], false)}, {prop: "WriteByte", name: "WriteByte", pkg: "", typ: $funcType([$Uint8], [$error], false)}, {prop: "WriteRune", name: "WriteRune", pkg: "", typ: $funcType([$Int32], [$Int, $error], false)}, {prop: "Read", name: "Read", pkg: "", typ: $funcType([sliceType], [$Int, $error], false)}, {prop: "Next", name: "Next", pkg: "", typ: $funcType([$Int], [sliceType], false)}, {prop: "ReadByte", name: "ReadByte", pkg: "", typ: $funcType([], [$Uint8, $error], false)}, {prop: "ReadRune", name: "ReadRune", pkg: "", typ: $funcType([], [$Int32, $Int, $error], false)}, {prop: "UnreadRune", name: "UnreadRune", pkg: "", typ: $funcType([], [$error], false)}, {prop: "UnreadByte", name: "UnreadByte", pkg: "", typ: $funcType([], [$error], false)}, {prop: "ReadBytes", name: "ReadBytes", pkg: "", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "readSlice", name: "readSlice", pkg: "bytes", typ: $funcType([$Uint8], [sliceType, $error], false)}, {prop: "ReadString", name: "ReadString", pkg: "", typ: $funcType([$Uint8], [$String, $error], false)}];
	Buffer.init([{prop: "buf", name: "buf", pkg: "bytes", typ: sliceType, tag: ""}, {prop: "off", name: "off", pkg: "bytes", typ: $Int, tag: ""}, {prop: "runeBytes", name: "runeBytes", pkg: "bytes", typ: arrayType, tag: ""}, {prop: "bootstrap", name: "bootstrap", pkg: "bytes", typ: arrayType$1, tag: ""}, {prop: "lastRead", name: "lastRead", pkg: "bytes", typ: readOp, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrTooLarge = errors.New("bytes.Buffer: too large");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["math"] = (function() {
	var $pkg = {}, $init, js, arrayType, arrayType$1, arrayType$2, structType, arrayType$3, math, buf, pow10tab, init, init$1;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	arrayType = $arrayType($Uint32, 2);
	arrayType$1 = $arrayType($Float32, 2);
	arrayType$2 = $arrayType($Float64, 1);
	structType = $structType([{prop: "uint32array", name: "uint32array", pkg: "math", typ: arrayType, tag: ""}, {prop: "float32array", name: "float32array", pkg: "math", typ: arrayType$1, tag: ""}, {prop: "float64array", name: "float64array", pkg: "math", typ: arrayType$2, tag: ""}]);
	arrayType$3 = $arrayType($Float64, 70);
	init = function() {
		var $ptr, ab;
		ab = new ($global.ArrayBuffer)(8);
		buf.uint32array = new ($global.Uint32Array)(ab);
		buf.float32array = new ($global.Float32Array)(ab);
		buf.float64array = new ($global.Float64Array)(ab);
	};
	init$1 = function() {
		var $ptr, _q, i, m, x;
		pow10tab[0] = 1;
		pow10tab[1] = 10;
		i = 2;
		while (true) {
			if (!(i < 70)) { break; }
			m = (_q = i / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[i] = ((m < 0 || m >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[m]) * (x = i - m >> 0, ((x < 0 || x >= pow10tab.length) ? $throwRuntimeError("index out of range") : pow10tab[x])));
			i = i + (1) >> 0;
		}
	};
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		buf = new structType.ptr(arrayType.zero(), arrayType$1.zero(), arrayType$2.zero());
		pow10tab = arrayType$3.zero();
		math = $global.Math;
		init();
		init$1();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strconv"] = (function() {
	var $pkg = {}, $init, errors, math, utf8, NumError, sliceType$4, sliceType$5, ptrType, sliceType$6, arrayType$3, arrayType$4, isPrint16, isNotPrint16, isPrint32, isNotPrint32, isGraphic, shifts, ParseUint, FormatInt, Itoa, formatBits, quoteWith, Quote, unhex, UnquoteChar, Unquote, contains, bsearch16, bsearch32, IsPrint, isInGraphicList;
	errors = $packages["errors"];
	math = $packages["math"];
	utf8 = $packages["unicode/utf8"];
	NumError = $pkg.NumError = $newType(0, $kindStruct, "strconv.NumError", "NumError", "strconv", function(Func_, Num_, Err_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Func = "";
			this.Num = "";
			this.Err = $ifaceNil;
			return;
		}
		this.Func = Func_;
		this.Num = Num_;
		this.Err = Err_;
	});
	sliceType$4 = $sliceType($Uint16);
	sliceType$5 = $sliceType($Uint32);
	ptrType = $ptrType(NumError);
	sliceType$6 = $sliceType($Uint8);
	arrayType$3 = $arrayType($Uint8, 65);
	arrayType$4 = $arrayType($Uint8, 4);
	NumError.ptr.prototype.Error = function() {
		var $ptr, _r, e, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; e = $f.e; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		e = this;
		_r = e.Err.Error(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return "strconv." + e.Func + ": " + "parsing " + Quote(e.Num) + ": " + _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: NumError.ptr.prototype.Error }; } $f.$ptr = $ptr; $f._r = _r; $f.e = e; $f.$s = $s; $f.$r = $r; return $f;
	};
	NumError.prototype.Error = function() { return this.$val.Error(); };
	ParseUint = function(s, base, bitSize) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, base, bitSize, cutoff, d, err, i, maxVal, n, n1, s, v, x, x$1, x$2, $s;
		/* */ $s = 0; s: while (true) { switch ($s) { case 0:
		n = new $Uint64(0, 0);
		err = $ifaceNil;
		_tmp = new $Uint64(0, 0);
		_tmp$1 = new $Uint64(0, 0);
		cutoff = _tmp;
		maxVal = _tmp$1;
		if (bitSize === 0) {
			bitSize = 32;
		}
		i = 0;
			/* */ if (s.length < 1) { $s = 2; continue; }
			/* */ if (2 <= base && base <= 36) { $s = 3; continue; }
			/* */ if ((base === 0)) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (s.length < 1) { */ case 2:
				err = $pkg.ErrSyntax;
				/* goto Error */ $s = 7; continue;
				$s = 6; continue;
			/* } else if (2 <= base && base <= 36) { */ case 3:
				$s = 6; continue;
			/* } else if ((base === 0)) { */ case 4:
					/* */ if ((s.charCodeAt(0) === 48) && s.length > 1 && ((s.charCodeAt(1) === 120) || (s.charCodeAt(1) === 88))) { $s = 9; continue; }
					/* */ if ((s.charCodeAt(0) === 48)) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if ((s.charCodeAt(0) === 48) && s.length > 1 && ((s.charCodeAt(1) === 120) || (s.charCodeAt(1) === 88))) { */ case 9:
						/* */ if (s.length < 3) { $s = 13; continue; }
						/* */ $s = 14; continue;
						/* if (s.length < 3) { */ case 13:
							err = $pkg.ErrSyntax;
							/* goto Error */ $s = 7; continue;
						/* } */ case 14:
						base = 16;
						i = 2;
						$s = 12; continue;
					/* } else if ((s.charCodeAt(0) === 48)) { */ case 10:
						base = 8;
						i = 1;
						$s = 12; continue;
					/* } else { */ case 11:
						base = 10;
					/* } */ case 12:
				case 8:
				$s = 6; continue;
			/* } else { */ case 5:
				err = errors.New("invalid base " + Itoa(base));
				/* goto Error */ $s = 7; continue;
			/* } */ case 6:
		case 1:
		_1 = base;
		if (_1 === 10) {
			cutoff = new $Uint64(429496729, 2576980378);
		} else if (_1 === 16) {
			cutoff = new $Uint64(268435456, 0);
		} else {
			cutoff = (x = $div64(new $Uint64(4294967295, 4294967295), new $Uint64(0, base), false), new $Uint64(x.$high + 0, x.$low + 1));
		}
		maxVal = (x$1 = $shiftLeft64(new $Uint64(0, 1), (bitSize >>> 0)), new $Uint64(x$1.$high - 0, x$1.$low - 1));
		/* while (true) { */ case 15:
			/* if (!(i < s.length)) { break; } */ if(!(i < s.length)) { $s = 16; continue; }
			v = 0;
			d = s.charCodeAt(i);
				/* */ if (48 <= d && d <= 57) { $s = 18; continue; }
				/* */ if (97 <= d && d <= 122) { $s = 19; continue; }
				/* */ if (65 <= d && d <= 90) { $s = 20; continue; }
				/* */ $s = 21; continue;
				/* if (48 <= d && d <= 57) { */ case 18:
					v = d - 48 << 24 >>> 24;
					$s = 22; continue;
				/* } else if (97 <= d && d <= 122) { */ case 19:
					v = (d - 97 << 24 >>> 24) + 10 << 24 >>> 24;
					$s = 22; continue;
				/* } else if (65 <= d && d <= 90) { */ case 20:
					v = (d - 65 << 24 >>> 24) + 10 << 24 >>> 24;
					$s = 22; continue;
				/* } else { */ case 21:
					n = new $Uint64(0, 0);
					err = $pkg.ErrSyntax;
					/* goto Error */ $s = 7; continue;
				/* } */ case 22:
			case 17:
			/* */ if (v >= (base << 24 >>> 24)) { $s = 23; continue; }
			/* */ $s = 24; continue;
			/* if (v >= (base << 24 >>> 24)) { */ case 23:
				n = new $Uint64(0, 0);
				err = $pkg.ErrSyntax;
				/* goto Error */ $s = 7; continue;
			/* } */ case 24:
			/* */ if ((n.$high > cutoff.$high || (n.$high === cutoff.$high && n.$low >= cutoff.$low))) { $s = 25; continue; }
			/* */ $s = 26; continue;
			/* if ((n.$high > cutoff.$high || (n.$high === cutoff.$high && n.$low >= cutoff.$low))) { */ case 25:
				n = new $Uint64(4294967295, 4294967295);
				err = $pkg.ErrRange;
				/* goto Error */ $s = 7; continue;
			/* } */ case 26:
			n = $mul64(n, (new $Uint64(0, base)));
			n1 = (x$2 = new $Uint64(0, v), new $Uint64(n.$high + x$2.$high, n.$low + x$2.$low));
			/* */ if ((n1.$high < n.$high || (n1.$high === n.$high && n1.$low < n.$low)) || (n1.$high > maxVal.$high || (n1.$high === maxVal.$high && n1.$low > maxVal.$low))) { $s = 27; continue; }
			/* */ $s = 28; continue;
			/* if ((n1.$high < n.$high || (n1.$high === n.$high && n1.$low < n.$low)) || (n1.$high > maxVal.$high || (n1.$high === maxVal.$high && n1.$low > maxVal.$low))) { */ case 27:
				n = new $Uint64(4294967295, 4294967295);
				err = $pkg.ErrRange;
				/* goto Error */ $s = 7; continue;
			/* } */ case 28:
			n = n1;
			i = i + (1) >> 0;
		/* } */ $s = 15; continue; case 16:
		_tmp$2 = n;
		_tmp$3 = $ifaceNil;
		n = _tmp$2;
		err = _tmp$3;
		return [n, err];
		/* Error: */ case 7:
		_tmp$4 = n;
		_tmp$5 = new NumError.ptr("ParseUint", s, err);
		n = _tmp$4;
		err = _tmp$5;
		return [n, err];
		/* */ $s = -1; case -1: } return; }
	};
	$pkg.ParseUint = ParseUint;
	FormatInt = function(i, base) {
		var $ptr, _tuple, base, i, s;
		_tuple = formatBits(sliceType$6.nil, new $Uint64(i.$high, i.$low), base, (i.$high < 0 || (i.$high === 0 && i.$low < 0)), false);
		s = _tuple[1];
		return s;
	};
	$pkg.FormatInt = FormatInt;
	Itoa = function(i) {
		var $ptr, i;
		return FormatInt(new $Int64(0, i), 10);
	};
	$pkg.Itoa = Itoa;
	formatBits = function(dst, u, base, neg, append_) {
		var $ptr, _q, _q$1, a, append_, b, b$1, base, d, dst, i, j, m, neg, q, q$1, q$2, qs, s, s$1, u, us, us$1, x, x$1;
		d = sliceType$6.nil;
		s = "";
		if (base < 2 || base > 36) {
			$panic(new $String("strconv: illegal AppendInt/FormatInt base"));
		}
		a = arrayType$3.zero();
		i = 65;
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if (base === 10) {
			if (true) {
				while (true) {
					if (!((u.$high > 0 || (u.$high === 0 && u.$low > 4294967295)))) { break; }
					q = $div64(u, new $Uint64(0, 1000000000), false);
					us = ((x = $mul64(q, new $Uint64(0, 1000000000)), new $Uint64(u.$high - x.$high, u.$low - x.$low)).$low >>> 0);
					j = 9;
					while (true) {
						if (!(j > 0)) { break; }
						i = i - (1) >> 0;
						qs = (_q = us / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
						((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us - ($imul(qs, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
						us = qs;
						j = j - (1) >> 0;
					}
					u = q;
				}
			}
			us$1 = (u.$low >>> 0);
			while (true) {
				if (!(us$1 >= 10)) { break; }
				i = i - (1) >> 0;
				q$1 = (_q$1 = us$1 / 10, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >>> 0 : $throwRuntimeError("integer divide by zero"));
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = (((us$1 - ($imul(q$1, 10) >>> 0) >>> 0) + 48 >>> 0) << 24 >>> 24));
				us$1 = q$1;
			}
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = ((us$1 + 48 >>> 0) << 24 >>> 24));
		} else {
			s$1 = ((base < 0 || base >= shifts.length) ? $throwRuntimeError("index out of range") : shifts[base]);
			if (s$1 > 0) {
				b = new $Uint64(0, base);
				m = (b.$low >>> 0) - 1 >>> 0;
				while (true) {
					if (!((u.$high > b.$high || (u.$high === b.$high && u.$low >= b.$low)))) { break; }
					i = i - (1) >> 0;
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((((u.$low >>> 0) & m) >>> 0)));
					u = $shiftRightUint64(u, (s$1));
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			} else {
				b$1 = new $Uint64(0, base);
				while (true) {
					if (!((u.$high > b$1.$high || (u.$high === b$1.$high && u.$low >= b$1.$low)))) { break; }
					i = i - (1) >> 0;
					q$2 = $div64(u, b$1, false);
					((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt(((x$1 = $mul64(q$2, b$1), new $Uint64(u.$high - x$1.$high, u.$low - x$1.$low)).$low >>> 0)));
					u = q$2;
				}
				i = i - (1) >> 0;
				((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = "0123456789abcdefghijklmnopqrstuvwxyz".charCodeAt((u.$low >>> 0)));
			}
		}
		if (neg) {
			i = i - (1) >> 0;
			((i < 0 || i >= a.length) ? $throwRuntimeError("index out of range") : a[i] = 45);
		}
		if (append_) {
			d = $appendSlice(dst, $subslice(new sliceType$6(a), i));
			return [d, s];
		}
		s = $bytesToString($subslice(new sliceType$6(a), i));
		return [d, s];
	};
	quoteWith = function(s, quote, ASCIIonly, graphicOnly) {
		var $ptr, ASCIIonly, _1, _q, _tuple, buf, graphicOnly, n, quote, r, runeTmp, s, s$1, s$2, width;
		runeTmp = arrayType$4.zero();
		buf = $makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
		buf = $append(buf, quote);
		width = 0;
		while (true) {
			if (!(s.length > 0)) { break; }
			r = (s.charCodeAt(0) >> 0);
			width = 1;
			if (r >= 128) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				width = _tuple[1];
			}
			if ((width === 1) && (r === 65533)) {
				buf = $appendSlice(buf, "\\x");
				buf = $append(buf, "0123456789abcdef".charCodeAt((s.charCodeAt(0) >>> 4 << 24 >>> 24)));
				buf = $append(buf, "0123456789abcdef".charCodeAt(((s.charCodeAt(0) & 15) >>> 0)));
				s = s.substring(width);
				continue;
			}
			if ((r === (quote >> 0)) || (r === 92)) {
				buf = $append(buf, 92);
				buf = $append(buf, (r << 24 >>> 24));
				s = s.substring(width);
				continue;
			}
			if (ASCIIonly) {
				if (r < 128 && IsPrint(r)) {
					buf = $append(buf, (r << 24 >>> 24));
					s = s.substring(width);
					continue;
				}
			} else if (IsPrint(r) || graphicOnly && isInGraphicList(r)) {
				n = utf8.EncodeRune(new sliceType$6(runeTmp), r);
				buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n));
				s = s.substring(width);
				continue;
			}
			_1 = r;
			if (_1 === 7) {
				buf = $appendSlice(buf, "\\a");
			} else if (_1 === 8) {
				buf = $appendSlice(buf, "\\b");
			} else if (_1 === 12) {
				buf = $appendSlice(buf, "\\f");
			} else if (_1 === 10) {
				buf = $appendSlice(buf, "\\n");
			} else if (_1 === 13) {
				buf = $appendSlice(buf, "\\r");
			} else if (_1 === 9) {
				buf = $appendSlice(buf, "\\t");
			} else if (_1 === 11) {
				buf = $appendSlice(buf, "\\v");
			} else {
				if (r < 32) {
					buf = $appendSlice(buf, "\\x");
					buf = $append(buf, "0123456789abcdef".charCodeAt((s.charCodeAt(0) >>> 4 << 24 >>> 24)));
					buf = $append(buf, "0123456789abcdef".charCodeAt(((s.charCodeAt(0) & 15) >>> 0)));
				} else if (r > 1114111) {
					r = 65533;
					buf = $appendSlice(buf, "\\u");
					s$1 = 12;
					while (true) {
						if (!(s$1 >= 0)) { break; }
						buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s$1 >>> 0), 31)) >> 0) & 15)));
						s$1 = s$1 - (4) >> 0;
					}
				} else if (r < 65536) {
					buf = $appendSlice(buf, "\\u");
					s$1 = 12;
					while (true) {
						if (!(s$1 >= 0)) { break; }
						buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s$1 >>> 0), 31)) >> 0) & 15)));
						s$1 = s$1 - (4) >> 0;
					}
				} else {
					buf = $appendSlice(buf, "\\U");
					s$2 = 28;
					while (true) {
						if (!(s$2 >= 0)) { break; }
						buf = $append(buf, "0123456789abcdef".charCodeAt((((r >> $min((s$2 >>> 0), 31)) >> 0) & 15)));
						s$2 = s$2 - (4) >> 0;
					}
				}
			}
			s = s.substring(width);
		}
		buf = $append(buf, quote);
		return $bytesToString(buf);
	};
	Quote = function(s) {
		var $ptr, s;
		return quoteWith(s, 34, false, false);
	};
	$pkg.Quote = Quote;
	unhex = function(b) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, b, c, ok, v;
		v = 0;
		ok = false;
		c = (b >> 0);
		if (48 <= c && c <= 57) {
			_tmp = c - 48 >> 0;
			_tmp$1 = true;
			v = _tmp;
			ok = _tmp$1;
			return [v, ok];
		} else if (97 <= c && c <= 102) {
			_tmp$2 = (c - 97 >> 0) + 10 >> 0;
			_tmp$3 = true;
			v = _tmp$2;
			ok = _tmp$3;
			return [v, ok];
		} else if (65 <= c && c <= 70) {
			_tmp$4 = (c - 65 >> 0) + 10 >> 0;
			_tmp$5 = true;
			v = _tmp$4;
			ok = _tmp$5;
			return [v, ok];
		}
		return [v, ok];
	};
	UnquoteChar = function(s, quote) {
		var $ptr, _2, _3, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, _tuple$1, c, c$1, err, j, j$1, multibyte, n, ok, quote, r, s, size, tail, v, v$1, value, x, x$1;
		value = 0;
		multibyte = false;
		tail = "";
		err = $ifaceNil;
		c = s.charCodeAt(0);
		if ((c === quote) && ((quote === 39) || (quote === 34))) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		} else if (c >= 128) {
			_tuple = utf8.DecodeRuneInString(s);
			r = _tuple[0];
			size = _tuple[1];
			_tmp = r;
			_tmp$1 = true;
			_tmp$2 = s.substring(size);
			_tmp$3 = $ifaceNil;
			value = _tmp;
			multibyte = _tmp$1;
			tail = _tmp$2;
			err = _tmp$3;
			return [value, multibyte, tail, err];
		} else if (!((c === 92))) {
			_tmp$4 = (s.charCodeAt(0) >> 0);
			_tmp$5 = false;
			_tmp$6 = s.substring(1);
			_tmp$7 = $ifaceNil;
			value = _tmp$4;
			multibyte = _tmp$5;
			tail = _tmp$6;
			err = _tmp$7;
			return [value, multibyte, tail, err];
		}
		if (s.length <= 1) {
			err = $pkg.ErrSyntax;
			return [value, multibyte, tail, err];
		}
		c$1 = s.charCodeAt(1);
		s = s.substring(2);
		switch (0) { default:
			_2 = c$1;
			if (_2 === 97) {
				value = 7;
			} else if (_2 === 98) {
				value = 8;
			} else if (_2 === 102) {
				value = 12;
			} else if (_2 === 110) {
				value = 10;
			} else if (_2 === 114) {
				value = 13;
			} else if (_2 === 116) {
				value = 9;
			} else if (_2 === 118) {
				value = 11;
			} else if ((_2 === 120) || (_2 === 117) || (_2 === 85)) {
				n = 0;
				_3 = c$1;
				if (_3 === 120) {
					n = 2;
				} else if (_3 === 117) {
					n = 4;
				} else if (_3 === 85) {
					n = 8;
				}
				v = 0;
				if (s.length < n) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j = 0;
				while (true) {
					if (!(j < n)) { break; }
					_tuple$1 = unhex(s.charCodeAt(j));
					x = _tuple$1[0];
					ok = _tuple$1[1];
					if (!ok) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v = (v << 4 >> 0) | x;
					j = j + (1) >> 0;
				}
				s = s.substring(n);
				if (c$1 === 120) {
					value = v;
					break;
				}
				if (v > 1114111) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v;
				multibyte = true;
			} else if ((_2 === 48) || (_2 === 49) || (_2 === 50) || (_2 === 51) || (_2 === 52) || (_2 === 53) || (_2 === 54) || (_2 === 55)) {
				v$1 = (c$1 >> 0) - 48 >> 0;
				if (s.length < 2) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				j$1 = 0;
				while (true) {
					if (!(j$1 < 2)) { break; }
					x$1 = (s.charCodeAt(j$1) >> 0) - 48 >> 0;
					if (x$1 < 0 || x$1 > 7) {
						err = $pkg.ErrSyntax;
						return [value, multibyte, tail, err];
					}
					v$1 = ((v$1 << 3 >> 0)) | x$1;
					j$1 = j$1 + (1) >> 0;
				}
				s = s.substring(2);
				if (v$1 > 255) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = v$1;
			} else if (_2 === 92) {
				value = 92;
			} else if ((_2 === 39) || (_2 === 34)) {
				if (!((c$1 === quote))) {
					err = $pkg.ErrSyntax;
					return [value, multibyte, tail, err];
				}
				value = (c$1 >> 0);
			} else {
				err = $pkg.ErrSyntax;
				return [value, multibyte, tail, err];
			}
		}
		tail = s;
		return [value, multibyte, tail, err];
	};
	$pkg.UnquoteChar = UnquoteChar;
	Unquote = function(s) {
		var $ptr, _4, _q, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple, _tuple$1, buf, c, err, err$1, multibyte, n, n$1, quote, r, runeTmp, s, size, ss, t;
		t = "";
		err = $ifaceNil;
		n = s.length;
		if (n < 2) {
			_tmp = "";
			_tmp$1 = $pkg.ErrSyntax;
			t = _tmp;
			err = _tmp$1;
			return [t, err];
		}
		quote = s.charCodeAt(0);
		if (!((quote === s.charCodeAt((n - 1 >> 0))))) {
			_tmp$2 = "";
			_tmp$3 = $pkg.ErrSyntax;
			t = _tmp$2;
			err = _tmp$3;
			return [t, err];
		}
		s = s.substring(1, (n - 1 >> 0));
		if (quote === 96) {
			if (contains(s, 96)) {
				_tmp$4 = "";
				_tmp$5 = $pkg.ErrSyntax;
				t = _tmp$4;
				err = _tmp$5;
				return [t, err];
			}
			_tmp$6 = s;
			_tmp$7 = $ifaceNil;
			t = _tmp$6;
			err = _tmp$7;
			return [t, err];
		}
		if (!((quote === 34)) && !((quote === 39))) {
			_tmp$8 = "";
			_tmp$9 = $pkg.ErrSyntax;
			t = _tmp$8;
			err = _tmp$9;
			return [t, err];
		}
		if (contains(s, 10)) {
			_tmp$10 = "";
			_tmp$11 = $pkg.ErrSyntax;
			t = _tmp$10;
			err = _tmp$11;
			return [t, err];
		}
		if (!contains(s, 92) && !contains(s, quote)) {
			_4 = quote;
			if (_4 === 34) {
				_tmp$12 = s;
				_tmp$13 = $ifaceNil;
				t = _tmp$12;
				err = _tmp$13;
				return [t, err];
			} else if (_4 === 39) {
				_tuple = utf8.DecodeRuneInString(s);
				r = _tuple[0];
				size = _tuple[1];
				if ((size === s.length) && (!((r === 65533)) || !((size === 1)))) {
					_tmp$14 = s;
					_tmp$15 = $ifaceNil;
					t = _tmp$14;
					err = _tmp$15;
					return [t, err];
				}
			}
		}
		runeTmp = arrayType$4.zero();
		buf = $makeSlice(sliceType$6, 0, (_q = ($imul(3, s.length)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")));
		while (true) {
			if (!(s.length > 0)) { break; }
			_tuple$1 = UnquoteChar(s, quote);
			c = _tuple$1[0];
			multibyte = _tuple$1[1];
			ss = _tuple$1[2];
			err$1 = _tuple$1[3];
			if (!($interfaceIsEqual(err$1, $ifaceNil))) {
				_tmp$16 = "";
				_tmp$17 = err$1;
				t = _tmp$16;
				err = _tmp$17;
				return [t, err];
			}
			s = ss;
			if (c < 128 || !multibyte) {
				buf = $append(buf, (c << 24 >>> 24));
			} else {
				n$1 = utf8.EncodeRune(new sliceType$6(runeTmp), c);
				buf = $appendSlice(buf, $subslice(new sliceType$6(runeTmp), 0, n$1));
			}
			if ((quote === 39) && !((s.length === 0))) {
				_tmp$18 = "";
				_tmp$19 = $pkg.ErrSyntax;
				t = _tmp$18;
				err = _tmp$19;
				return [t, err];
			}
		}
		_tmp$20 = $bytesToString(buf);
		_tmp$21 = $ifaceNil;
		t = _tmp$20;
		err = _tmp$21;
		return [t, err];
	};
	$pkg.Unquote = Unquote;
	contains = function(s, c) {
		var $ptr, c, i, s;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			if (s.charCodeAt(i) === c) {
				return true;
			}
			i = i + (1) >> 0;
		}
		return false;
	};
	bsearch16 = function(a, x) {
		var $ptr, _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	bsearch32 = function(a, x) {
		var $ptr, _q, _tmp, _tmp$1, a, h, i, j, x;
		_tmp = 0;
		_tmp$1 = a.$length;
		i = _tmp;
		j = _tmp$1;
		while (true) {
			if (!(i < j)) { break; }
			h = i + (_q = ((j - i >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			if (((h < 0 || h >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + h]) < x) {
				i = h + 1 >> 0;
			} else {
				j = h;
			}
		}
		return i;
	};
	IsPrint = function(r) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, i, i$1, isNotPrint, isNotPrint$1, isPrint, isPrint$1, j, j$1, r, rr, rr$1, x, x$1, x$2, x$3;
		if (r <= 255) {
			if (32 <= r && r <= 126) {
				return true;
			}
			if (161 <= r && r <= 255) {
				return !((r === 173));
			}
			return false;
		}
		if (0 <= r && r < 65536) {
			_tmp = (r << 16 >>> 16);
			_tmp$1 = isPrint16;
			_tmp$2 = isNotPrint16;
			rr = _tmp;
			isPrint = _tmp$1;
			isNotPrint = _tmp$2;
			i = bsearch16(isPrint, rr);
			if (i >= isPrint.$length || rr < (x = (i & ~1) >> 0, ((x < 0 || x >= isPrint.$length) ? $throwRuntimeError("index out of range") : isPrint.$array[isPrint.$offset + x])) || (x$1 = i | 1, ((x$1 < 0 || x$1 >= isPrint.$length) ? $throwRuntimeError("index out of range") : isPrint.$array[isPrint.$offset + x$1])) < rr) {
				return false;
			}
			j = bsearch16(isNotPrint, rr);
			return j >= isNotPrint.$length || !((((j < 0 || j >= isNotPrint.$length) ? $throwRuntimeError("index out of range") : isNotPrint.$array[isNotPrint.$offset + j]) === rr));
		}
		_tmp$3 = (r >>> 0);
		_tmp$4 = isPrint32;
		_tmp$5 = isNotPrint32;
		rr$1 = _tmp$3;
		isPrint$1 = _tmp$4;
		isNotPrint$1 = _tmp$5;
		i$1 = bsearch32(isPrint$1, rr$1);
		if (i$1 >= isPrint$1.$length || rr$1 < (x$2 = (i$1 & ~1) >> 0, ((x$2 < 0 || x$2 >= isPrint$1.$length) ? $throwRuntimeError("index out of range") : isPrint$1.$array[isPrint$1.$offset + x$2])) || (x$3 = i$1 | 1, ((x$3 < 0 || x$3 >= isPrint$1.$length) ? $throwRuntimeError("index out of range") : isPrint$1.$array[isPrint$1.$offset + x$3])) < rr$1) {
			return false;
		}
		if (r >= 131072) {
			return true;
		}
		r = r - (65536) >> 0;
		j$1 = bsearch16(isNotPrint$1, (r << 16 >>> 16));
		return j$1 >= isNotPrint$1.$length || !((((j$1 < 0 || j$1 >= isNotPrint$1.$length) ? $throwRuntimeError("index out of range") : isNotPrint$1.$array[isNotPrint$1.$offset + j$1]) === (r << 16 >>> 16)));
	};
	$pkg.IsPrint = IsPrint;
	isInGraphicList = function(r) {
		var $ptr, i, r, rr;
		if (r > 65535) {
			return false;
		}
		rr = (r << 16 >>> 16);
		i = bsearch16(isGraphic, rr);
		return i < isGraphic.$length && (rr === ((i < 0 || i >= isGraphic.$length) ? $throwRuntimeError("index out of range") : isGraphic.$array[isGraphic.$offset + i]));
	};
	ptrType.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	NumError.init([{prop: "Func", name: "Func", pkg: "", typ: $String, tag: ""}, {prop: "Num", name: "Num", pkg: "", typ: $String, tag: ""}, {prop: "Err", name: "Err", pkg: "", typ: $error, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrRange = errors.New("value out of range");
		$pkg.ErrSyntax = errors.New("invalid syntax");
		isPrint16 = new sliceType$4([32, 126, 161, 887, 890, 895, 900, 1366, 1369, 1418, 1421, 1479, 1488, 1514, 1520, 1524, 1542, 1563, 1566, 1805, 1808, 1866, 1869, 1969, 1984, 2042, 2048, 2093, 2096, 2139, 2142, 2142, 2208, 2228, 2275, 2444, 2447, 2448, 2451, 2482, 2486, 2489, 2492, 2500, 2503, 2504, 2507, 2510, 2519, 2519, 2524, 2531, 2534, 2555, 2561, 2570, 2575, 2576, 2579, 2617, 2620, 2626, 2631, 2632, 2635, 2637, 2641, 2641, 2649, 2654, 2662, 2677, 2689, 2745, 2748, 2765, 2768, 2768, 2784, 2787, 2790, 2801, 2809, 2809, 2817, 2828, 2831, 2832, 2835, 2873, 2876, 2884, 2887, 2888, 2891, 2893, 2902, 2903, 2908, 2915, 2918, 2935, 2946, 2954, 2958, 2965, 2969, 2975, 2979, 2980, 2984, 2986, 2990, 3001, 3006, 3010, 3014, 3021, 3024, 3024, 3031, 3031, 3046, 3066, 3072, 3129, 3133, 3149, 3157, 3162, 3168, 3171, 3174, 3183, 3192, 3257, 3260, 3277, 3285, 3286, 3294, 3299, 3302, 3314, 3329, 3386, 3389, 3406, 3415, 3415, 3423, 3427, 3430, 3445, 3449, 3455, 3458, 3478, 3482, 3517, 3520, 3526, 3530, 3530, 3535, 3551, 3558, 3567, 3570, 3572, 3585, 3642, 3647, 3675, 3713, 3716, 3719, 3722, 3725, 3725, 3732, 3751, 3754, 3773, 3776, 3789, 3792, 3801, 3804, 3807, 3840, 3948, 3953, 4058, 4096, 4295, 4301, 4301, 4304, 4685, 4688, 4701, 4704, 4749, 4752, 4789, 4792, 4805, 4808, 4885, 4888, 4954, 4957, 4988, 4992, 5017, 5024, 5109, 5112, 5117, 5120, 5788, 5792, 5880, 5888, 5908, 5920, 5942, 5952, 5971, 5984, 6003, 6016, 6109, 6112, 6121, 6128, 6137, 6144, 6157, 6160, 6169, 6176, 6263, 6272, 6314, 6320, 6389, 6400, 6443, 6448, 6459, 6464, 6464, 6468, 6509, 6512, 6516, 6528, 6571, 6576, 6601, 6608, 6618, 6622, 6683, 6686, 6780, 6783, 6793, 6800, 6809, 6816, 6829, 6832, 6846, 6912, 6987, 6992, 7036, 7040, 7155, 7164, 7223, 7227, 7241, 7245, 7295, 7360, 7367, 7376, 7417, 7424, 7669, 7676, 7957, 7960, 7965, 7968, 8005, 8008, 8013, 8016, 8061, 8064, 8147, 8150, 8175, 8178, 8190, 8208, 8231, 8240, 8286, 8304, 8305, 8308, 8348, 8352, 8382, 8400, 8432, 8448, 8587, 8592, 9210, 9216, 9254, 9280, 9290, 9312, 11123, 11126, 11157, 11160, 11193, 11197, 11217, 11244, 11247, 11264, 11507, 11513, 11559, 11565, 11565, 11568, 11623, 11631, 11632, 11647, 11670, 11680, 11842, 11904, 12019, 12032, 12245, 12272, 12283, 12289, 12438, 12441, 12543, 12549, 12589, 12593, 12730, 12736, 12771, 12784, 19893, 19904, 40917, 40960, 42124, 42128, 42182, 42192, 42539, 42560, 42743, 42752, 42925, 42928, 42935, 42999, 43051, 43056, 43065, 43072, 43127, 43136, 43204, 43214, 43225, 43232, 43261, 43264, 43347, 43359, 43388, 43392, 43481, 43486, 43574, 43584, 43597, 43600, 43609, 43612, 43714, 43739, 43766, 43777, 43782, 43785, 43790, 43793, 43798, 43808, 43877, 43888, 44013, 44016, 44025, 44032, 55203, 55216, 55238, 55243, 55291, 63744, 64109, 64112, 64217, 64256, 64262, 64275, 64279, 64285, 64449, 64467, 64831, 64848, 64911, 64914, 64967, 65008, 65021, 65024, 65049, 65056, 65131, 65136, 65276, 65281, 65470, 65474, 65479, 65482, 65487, 65490, 65495, 65498, 65500, 65504, 65518, 65532, 65533]);
		isNotPrint16 = new sliceType$4([173, 907, 909, 930, 1328, 1376, 1416, 1424, 1757, 2111, 2436, 2473, 2481, 2526, 2564, 2601, 2609, 2612, 2615, 2621, 2653, 2692, 2702, 2706, 2729, 2737, 2740, 2758, 2762, 2820, 2857, 2865, 2868, 2910, 2948, 2961, 2971, 2973, 3017, 3076, 3085, 3089, 3113, 3141, 3145, 3159, 3200, 3204, 3213, 3217, 3241, 3252, 3269, 3273, 3295, 3312, 3332, 3341, 3345, 3397, 3401, 3460, 3506, 3516, 3541, 3543, 3715, 3721, 3736, 3744, 3748, 3750, 3756, 3770, 3781, 3783, 3912, 3992, 4029, 4045, 4294, 4681, 4695, 4697, 4745, 4785, 4799, 4801, 4823, 4881, 5760, 5901, 5997, 6001, 6431, 6751, 7415, 8024, 8026, 8028, 8030, 8117, 8133, 8156, 8181, 8335, 11209, 11311, 11359, 11558, 11687, 11695, 11703, 11711, 11719, 11727, 11735, 11743, 11930, 12352, 12687, 12831, 13055, 43470, 43519, 43815, 43823, 64311, 64317, 64319, 64322, 64325, 65107, 65127, 65141, 65511]);
		isPrint32 = new sliceType$5([65536, 65613, 65616, 65629, 65664, 65786, 65792, 65794, 65799, 65843, 65847, 65932, 65936, 65947, 65952, 65952, 66000, 66045, 66176, 66204, 66208, 66256, 66272, 66299, 66304, 66339, 66352, 66378, 66384, 66426, 66432, 66499, 66504, 66517, 66560, 66717, 66720, 66729, 66816, 66855, 66864, 66915, 66927, 66927, 67072, 67382, 67392, 67413, 67424, 67431, 67584, 67589, 67592, 67640, 67644, 67644, 67647, 67742, 67751, 67759, 67808, 67829, 67835, 67867, 67871, 67897, 67903, 67903, 67968, 68023, 68028, 68047, 68050, 68102, 68108, 68147, 68152, 68154, 68159, 68167, 68176, 68184, 68192, 68255, 68288, 68326, 68331, 68342, 68352, 68405, 68409, 68437, 68440, 68466, 68472, 68497, 68505, 68508, 68521, 68527, 68608, 68680, 68736, 68786, 68800, 68850, 68858, 68863, 69216, 69246, 69632, 69709, 69714, 69743, 69759, 69825, 69840, 69864, 69872, 69881, 69888, 69955, 69968, 70006, 70016, 70093, 70096, 70132, 70144, 70205, 70272, 70313, 70320, 70378, 70384, 70393, 70400, 70412, 70415, 70416, 70419, 70457, 70460, 70468, 70471, 70472, 70475, 70477, 70480, 70480, 70487, 70487, 70493, 70499, 70502, 70508, 70512, 70516, 70784, 70855, 70864, 70873, 71040, 71093, 71096, 71133, 71168, 71236, 71248, 71257, 71296, 71351, 71360, 71369, 71424, 71449, 71453, 71467, 71472, 71487, 71840, 71922, 71935, 71935, 72384, 72440, 73728, 74649, 74752, 74868, 74880, 75075, 77824, 78894, 82944, 83526, 92160, 92728, 92736, 92777, 92782, 92783, 92880, 92909, 92912, 92917, 92928, 92997, 93008, 93047, 93053, 93071, 93952, 94020, 94032, 94078, 94095, 94111, 110592, 110593, 113664, 113770, 113776, 113788, 113792, 113800, 113808, 113817, 113820, 113823, 118784, 119029, 119040, 119078, 119081, 119154, 119163, 119272, 119296, 119365, 119552, 119638, 119648, 119665, 119808, 119967, 119970, 119970, 119973, 119974, 119977, 120074, 120077, 120134, 120138, 120485, 120488, 120779, 120782, 121483, 121499, 121519, 124928, 125124, 125127, 125142, 126464, 126500, 126503, 126523, 126530, 126530, 126535, 126548, 126551, 126564, 126567, 126619, 126625, 126651, 126704, 126705, 126976, 127019, 127024, 127123, 127136, 127150, 127153, 127221, 127232, 127244, 127248, 127339, 127344, 127386, 127462, 127490, 127504, 127546, 127552, 127560, 127568, 127569, 127744, 128720, 128736, 128748, 128752, 128755, 128768, 128883, 128896, 128980, 129024, 129035, 129040, 129095, 129104, 129113, 129120, 129159, 129168, 129197, 129296, 129304, 129408, 129412, 129472, 129472, 131072, 173782, 173824, 177972, 177984, 178205, 178208, 183969, 194560, 195101, 917760, 917999]);
		isNotPrint32 = new sliceType$4([12, 39, 59, 62, 926, 2057, 2102, 2134, 2291, 2564, 2580, 2584, 4285, 4405, 4576, 4626, 4743, 4745, 4750, 4766, 4868, 4905, 4913, 4916, 9327, 27231, 27482, 27490, 54357, 54429, 54445, 54458, 54460, 54468, 54534, 54549, 54557, 54586, 54591, 54597, 54609, 55968, 60932, 60960, 60963, 60968, 60979, 60984, 60986, 61000, 61002, 61004, 61008, 61011, 61016, 61018, 61020, 61022, 61024, 61027, 61035, 61043, 61048, 61053, 61055, 61066, 61092, 61098, 61632, 61648, 61743, 62842, 62884]);
		isGraphic = new sliceType$4([160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8239, 8287, 12288]);
		shifts = $toNativeArray($kindUint, [0, 0, 1, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["reflect"] = (function() {
	var $pkg = {}, $init, errors, js, math, runtime, strconv, sync, mapIter, Type, Kind, rtype, typeAlg, method, uncommonType, ChanDir, arrayType, chanType, funcType, imethod, interfaceType, mapType, ptrType, sliceType, structField, structType, Method, StructField, StructTag, fieldScan, Value, flag, ValueError, nonEmptyInterface, ptrType$1, sliceType$1, sliceType$2, ptrType$3, funcType$1, sliceType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, sliceType$4, sliceType$5, sliceType$6, structType$6, sliceType$7, sliceType$8, ptrType$8, arrayType$1, structType$7, ptrType$9, sliceType$9, ptrType$10, ptrType$11, ptrType$12, sliceType$11, sliceType$12, ptrType$13, sliceType$13, ptrType$18, sliceType$15, funcType$3, funcType$4, funcType$5, arrayType$3, ptrType$20, initialized, stringPtrMap, callHelper, jsObjectPtr, selectHelper, kindNames, uint8Type, init, jsType, reflectType, setKindType, newStringPtr, isWrapped, copyStruct, makeValue, MakeSlice, TypeOf, ValueOf, SliceOf, Zero, unsafe_New, makeInt, typedmemmove, keyFor, mapaccess, mapassign, mapdelete, mapiterinit, mapiterkey, mapiternext, maplen, cvtDirect, methodReceiver, valueInterface, ifaceE2I, methodName, makeMethodValue, wrapJsObject, unwrapJsObject, getJsTag, chanrecv, chansend, PtrTo, implements$1, directlyAssignable, haveIdenticalUnderlyingType, toType, ifaceIndir, overflowFloat32, Indirect, New, convertOp, makeFloat, makeComplex, makeString, makeBytes, makeRunes, cvtInt, cvtUint, cvtFloatInt, cvtFloatUint, cvtIntFloat, cvtUintFloat, cvtFloat, cvtComplex, cvtIntString, cvtUintString, cvtBytesString, cvtStringBytes, cvtRunesString, cvtStringRunes, cvtT2I, cvtI2I;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	math = $packages["math"];
	runtime = $packages["runtime"];
	strconv = $packages["strconv"];
	sync = $packages["sync"];
	mapIter = $pkg.mapIter = $newType(0, $kindStruct, "reflect.mapIter", "mapIter", "reflect", function(t_, m_, keys_, i_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.t = $ifaceNil;
			this.m = null;
			this.keys = null;
			this.i = 0;
			return;
		}
		this.t = t_;
		this.m = m_;
		this.keys = keys_;
		this.i = i_;
	});
	Type = $pkg.Type = $newType(8, $kindInterface, "reflect.Type", "Type", "reflect", null);
	Kind = $pkg.Kind = $newType(4, $kindUint, "reflect.Kind", "Kind", "reflect", null);
	rtype = $pkg.rtype = $newType(0, $kindStruct, "reflect.rtype", "rtype", "reflect", function(size_, ptrdata_, hash_, _$3_, align_, fieldAlign_, kind_, alg_, gcdata_, string_, uncommonType_, ptrToThis_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.size = 0;
			this.ptrdata = 0;
			this.hash = 0;
			this._$3 = 0;
			this.align = 0;
			this.fieldAlign = 0;
			this.kind = 0;
			this.alg = ptrType$4.nil;
			this.gcdata = ptrType$5.nil;
			this.string = ptrType$6.nil;
			this.uncommonType = ptrType$7.nil;
			this.ptrToThis = ptrType$1.nil;
			return;
		}
		this.size = size_;
		this.ptrdata = ptrdata_;
		this.hash = hash_;
		this._$3 = _$3_;
		this.align = align_;
		this.fieldAlign = fieldAlign_;
		this.kind = kind_;
		this.alg = alg_;
		this.gcdata = gcdata_;
		this.string = string_;
		this.uncommonType = uncommonType_;
		this.ptrToThis = ptrToThis_;
	});
	typeAlg = $pkg.typeAlg = $newType(0, $kindStruct, "reflect.typeAlg", "typeAlg", "reflect", function(hash_, equal_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.hash = $throwNilPointerError;
			this.equal = $throwNilPointerError;
			return;
		}
		this.hash = hash_;
		this.equal = equal_;
	});
	method = $pkg.method = $newType(0, $kindStruct, "reflect.method", "method", "reflect", function(name_, pkgPath_, mtyp_, typ_, ifn_, tfn_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.mtyp = ptrType$1.nil;
			this.typ = ptrType$1.nil;
			this.ifn = 0;
			this.tfn = 0;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.mtyp = mtyp_;
		this.typ = typ_;
		this.ifn = ifn_;
		this.tfn = tfn_;
	});
	uncommonType = $pkg.uncommonType = $newType(0, $kindStruct, "reflect.uncommonType", "uncommonType", "reflect", function(name_, pkgPath_, methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.methods = sliceType$4.nil;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.methods = methods_;
	});
	ChanDir = $pkg.ChanDir = $newType(4, $kindInt, "reflect.ChanDir", "ChanDir", "reflect", null);
	arrayType = $pkg.arrayType = $newType(0, $kindStruct, "reflect.arrayType", "arrayType", "reflect", function(rtype_, elem_, slice_, len_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			this.slice = ptrType$1.nil;
			this.len = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.slice = slice_;
		this.len = len_;
	});
	chanType = $pkg.chanType = $newType(0, $kindStruct, "reflect.chanType", "chanType", "reflect", function(rtype_, elem_, dir_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			this.dir = 0;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
		this.dir = dir_;
	});
	funcType = $pkg.funcType = $newType(0, $kindStruct, "reflect.funcType", "funcType", "reflect", function(rtype_, dotdotdot_, in$2_, out_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.dotdotdot = false;
			this.in$2 = sliceType$1.nil;
			this.out = sliceType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.dotdotdot = dotdotdot_;
		this.in$2 = in$2_;
		this.out = out_;
	});
	imethod = $pkg.imethod = $newType(0, $kindStruct, "reflect.imethod", "imethod", "reflect", function(name_, pkgPath_, typ_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.typ = ptrType$1.nil;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.typ = typ_;
	});
	interfaceType = $pkg.interfaceType = $newType(0, $kindStruct, "reflect.interfaceType", "interfaceType", "reflect", function(rtype_, methods_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.methods = sliceType$5.nil;
			return;
		}
		this.rtype = rtype_;
		this.methods = methods_;
	});
	mapType = $pkg.mapType = $newType(0, $kindStruct, "reflect.mapType", "mapType", "reflect", function(rtype_, key_, elem_, bucket_, hmap_, keysize_, indirectkey_, valuesize_, indirectvalue_, bucketsize_, reflexivekey_, needkeyupdate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.key = ptrType$1.nil;
			this.elem = ptrType$1.nil;
			this.bucket = ptrType$1.nil;
			this.hmap = ptrType$1.nil;
			this.keysize = 0;
			this.indirectkey = 0;
			this.valuesize = 0;
			this.indirectvalue = 0;
			this.bucketsize = 0;
			this.reflexivekey = false;
			this.needkeyupdate = false;
			return;
		}
		this.rtype = rtype_;
		this.key = key_;
		this.elem = elem_;
		this.bucket = bucket_;
		this.hmap = hmap_;
		this.keysize = keysize_;
		this.indirectkey = indirectkey_;
		this.valuesize = valuesize_;
		this.indirectvalue = indirectvalue_;
		this.bucketsize = bucketsize_;
		this.reflexivekey = reflexivekey_;
		this.needkeyupdate = needkeyupdate_;
	});
	ptrType = $pkg.ptrType = $newType(0, $kindStruct, "reflect.ptrType", "ptrType", "reflect", function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	sliceType = $pkg.sliceType = $newType(0, $kindStruct, "reflect.sliceType", "sliceType", "reflect", function(rtype_, elem_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.elem = ptrType$1.nil;
			return;
		}
		this.rtype = rtype_;
		this.elem = elem_;
	});
	structField = $pkg.structField = $newType(0, $kindStruct, "reflect.structField", "structField", "reflect", function(name_, pkgPath_, typ_, tag_, offset_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = ptrType$6.nil;
			this.pkgPath = ptrType$6.nil;
			this.typ = ptrType$1.nil;
			this.tag = ptrType$6.nil;
			this.offset = 0;
			return;
		}
		this.name = name_;
		this.pkgPath = pkgPath_;
		this.typ = typ_;
		this.tag = tag_;
		this.offset = offset_;
	});
	structType = $pkg.structType = $newType(0, $kindStruct, "reflect.structType", "structType", "reflect", function(rtype_, fields_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.rtype = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
			this.fields = sliceType$6.nil;
			return;
		}
		this.rtype = rtype_;
		this.fields = fields_;
	});
	Method = $pkg.Method = $newType(0, $kindStruct, "reflect.Method", "Method", "reflect", function(Name_, PkgPath_, Type_, Func_, Index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Func = new Value.ptr(ptrType$1.nil, 0, 0);
			this.Index = 0;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Func = Func_;
		this.Index = Index_;
	});
	StructField = $pkg.StructField = $newType(0, $kindStruct, "reflect.StructField", "StructField", "reflect", function(Name_, PkgPath_, Type_, Tag_, Offset_, Index_, Anonymous_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.PkgPath = "";
			this.Type = $ifaceNil;
			this.Tag = "";
			this.Offset = 0;
			this.Index = sliceType$11.nil;
			this.Anonymous = false;
			return;
		}
		this.Name = Name_;
		this.PkgPath = PkgPath_;
		this.Type = Type_;
		this.Tag = Tag_;
		this.Offset = Offset_;
		this.Index = Index_;
		this.Anonymous = Anonymous_;
	});
	StructTag = $pkg.StructTag = $newType(8, $kindString, "reflect.StructTag", "StructTag", "reflect", null);
	fieldScan = $pkg.fieldScan = $newType(0, $kindStruct, "reflect.fieldScan", "fieldScan", "reflect", function(typ_, index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$13.nil;
			this.index = sliceType$11.nil;
			return;
		}
		this.typ = typ_;
		this.index = index_;
	});
	Value = $pkg.Value = $newType(0, $kindStruct, "reflect.Value", "Value", "reflect", function(typ_, ptr_, flag_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.typ = ptrType$1.nil;
			this.ptr = 0;
			this.flag = 0;
			return;
		}
		this.typ = typ_;
		this.ptr = ptr_;
		this.flag = flag_;
	});
	flag = $pkg.flag = $newType(4, $kindUintptr, "reflect.flag", "flag", "reflect", null);
	ValueError = $pkg.ValueError = $newType(0, $kindStruct, "reflect.ValueError", "ValueError", "reflect", function(Method_, Kind_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Method = "";
			this.Kind = 0;
			return;
		}
		this.Method = Method_;
		this.Kind = Kind_;
	});
	nonEmptyInterface = $pkg.nonEmptyInterface = $newType(0, $kindStruct, "reflect.nonEmptyInterface", "nonEmptyInterface", "reflect", function(itab_, word_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.itab = ptrType$9.nil;
			this.word = 0;
			return;
		}
		this.itab = itab_;
		this.word = word_;
	});
	ptrType$1 = $ptrType(rtype);
	sliceType$1 = $sliceType(ptrType$1);
	sliceType$2 = $sliceType($emptyInterface);
	ptrType$3 = $ptrType(js.Object);
	funcType$1 = $funcType([sliceType$2], [ptrType$3], true);
	sliceType$3 = $sliceType($String);
	ptrType$4 = $ptrType(typeAlg);
	ptrType$5 = $ptrType($Uint8);
	ptrType$6 = $ptrType($String);
	ptrType$7 = $ptrType(uncommonType);
	sliceType$4 = $sliceType(method);
	sliceType$5 = $sliceType(imethod);
	sliceType$6 = $sliceType(structField);
	structType$6 = $structType([{prop: "str", name: "str", pkg: "reflect", typ: $String, tag: ""}]);
	sliceType$7 = $sliceType(ptrType$3);
	sliceType$8 = $sliceType(Value);
	ptrType$8 = $ptrType(nonEmptyInterface);
	arrayType$1 = $arrayType($UnsafePointer, 100000);
	structType$7 = $structType([{prop: "ityp", name: "ityp", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "link", name: "link", pkg: "reflect", typ: $UnsafePointer, tag: ""}, {prop: "bad", name: "bad", pkg: "reflect", typ: $Int32, tag: ""}, {prop: "unused", name: "unused", pkg: "reflect", typ: $Int32, tag: ""}, {prop: "fun", name: "fun", pkg: "reflect", typ: arrayType$1, tag: ""}]);
	ptrType$9 = $ptrType(structType$7);
	sliceType$9 = $sliceType(sliceType$7);
	ptrType$10 = $ptrType(method);
	ptrType$11 = $ptrType(interfaceType);
	ptrType$12 = $ptrType(imethod);
	sliceType$11 = $sliceType($Int);
	sliceType$12 = $sliceType(fieldScan);
	ptrType$13 = $ptrType(structType);
	sliceType$13 = $sliceType($Uint8);
	ptrType$18 = $ptrType($UnsafePointer);
	sliceType$15 = $sliceType($Int32);
	funcType$3 = $funcType([$String], [$Bool], false);
	funcType$4 = $funcType([$UnsafePointer, $Uintptr], [$Uintptr], false);
	funcType$5 = $funcType([$UnsafePointer, $UnsafePointer], [$Bool], false);
	arrayType$3 = $arrayType($Uintptr, 2);
	ptrType$20 = $ptrType(ValueError);
	init = function() {
		var $ptr, used, x, x$1, x$10, x$11, x$12, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; used = $f.used; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		used = (function(i) {
			var $ptr, i;
		});
		$r = used((x = new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), new x.constructor.elem(x))); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$1 = new uncommonType.ptr(ptrType$6.nil, ptrType$6.nil, sliceType$4.nil), new x$1.constructor.elem(x$1))); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$2 = new method.ptr(ptrType$6.nil, ptrType$6.nil, ptrType$1.nil, ptrType$1.nil, 0, 0), new x$2.constructor.elem(x$2))); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$3 = new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil, ptrType$1.nil, 0), new x$3.constructor.elem(x$3))); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$4 = new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil, 0), new x$4.constructor.elem(x$4))); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$5 = new funcType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), false, sliceType$1.nil, sliceType$1.nil), new x$5.constructor.elem(x$5))); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$6 = new interfaceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), sliceType$5.nil), new x$6.constructor.elem(x$6))); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$7 = new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false), new x$7.constructor.elem(x$7))); /* */ $s = 8; case 8: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$8 = new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil), new x$8.constructor.elem(x$8))); /* */ $s = 9; case 9: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$9 = new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), ptrType$1.nil), new x$9.constructor.elem(x$9))); /* */ $s = 10; case 10: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$10 = new structType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), sliceType$6.nil), new x$10.constructor.elem(x$10))); /* */ $s = 11; case 11: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$11 = new imethod.ptr(ptrType$6.nil, ptrType$6.nil, ptrType$1.nil), new x$11.constructor.elem(x$11))); /* */ $s = 12; case 12: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = used((x$12 = new structField.ptr(ptrType$6.nil, ptrType$6.nil, ptrType$1.nil, ptrType$6.nil, 0), new x$12.constructor.elem(x$12))); /* */ $s = 13; case 13: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		initialized = true;
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: init }; } $f.$ptr = $ptr; $f.used = used; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	jsType = function(typ) {
		var $ptr, typ;
		return typ.jsType;
	};
	reflectType = function(typ) {
		var $ptr, _1, _i, _i$1, _i$2, _i$3, _i$4, _ref, _ref$1, _ref$2, _ref$3, _ref$4, dir, f, fields, i, i$1, i$2, i$3, i$4, imethods, in$1, m, m$1, methodSet, methods, out, params, reflectFields, reflectMethods, results, rt, t, typ;
		if (typ.reflectType === undefined) {
			rt = new rtype.ptr((($parseInt(typ.size) >> 0) >>> 0), 0, 0, 0, 0, 0, (($parseInt(typ.kind) >> 0) << 24 >>> 24), ptrType$4.nil, ptrType$5.nil, newStringPtr(typ.string), ptrType$7.nil, ptrType$1.nil);
			rt.jsType = typ;
			typ.reflectType = rt;
			methodSet = $methodSet(typ);
			if (!($internalize(typ.typeName, $String) === "") || !(($parseInt(methodSet.length) === 0))) {
				reflectMethods = $makeSlice(sliceType$4, $parseInt(methodSet.length));
				_ref = reflectMethods;
				_i = 0;
				while (true) {
					if (!(_i < _ref.$length)) { break; }
					i = _i;
					m = methodSet[i];
					t = m.typ;
					method.copy(((i < 0 || i >= reflectMethods.$length) ? $throwRuntimeError("index out of range") : reflectMethods.$array[reflectMethods.$offset + i]), new method.ptr(newStringPtr(m.name), newStringPtr(m.pkg), reflectType(t), reflectType($funcType(new ($global.Array)(typ).concat(t.params), t.results, t.variadic)), 0, 0));
					_i++;
				}
				rt.uncommonType = new uncommonType.ptr(newStringPtr(typ.typeName), newStringPtr(typ.pkg), reflectMethods);
				rt.uncommonType.jsType = typ;
			}
			_1 = rt.Kind();
			if (_1 === 17) {
				setKindType(rt, new arrayType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem), ptrType$1.nil, (($parseInt(typ.len) >> 0) >>> 0)));
			} else if (_1 === 18) {
				dir = 3;
				if (!!(typ.sendOnly)) {
					dir = 2;
				}
				if (!!(typ.recvOnly)) {
					dir = 1;
				}
				setKindType(rt, new chanType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem), (dir >>> 0)));
			} else if (_1 === 19) {
				params = typ.params;
				in$1 = $makeSlice(sliceType$1, $parseInt(params.length));
				_ref$1 = in$1;
				_i$1 = 0;
				while (true) {
					if (!(_i$1 < _ref$1.$length)) { break; }
					i$1 = _i$1;
					((i$1 < 0 || i$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i$1] = reflectType(params[i$1]));
					_i$1++;
				}
				results = typ.results;
				out = $makeSlice(sliceType$1, $parseInt(results.length));
				_ref$2 = out;
				_i$2 = 0;
				while (true) {
					if (!(_i$2 < _ref$2.$length)) { break; }
					i$2 = _i$2;
					((i$2 < 0 || i$2 >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i$2] = reflectType(results[i$2]));
					_i$2++;
				}
				setKindType(rt, new funcType.ptr($clone(rt, rtype), !!(typ.variadic), in$1, out));
			} else if (_1 === 20) {
				methods = typ.methods;
				imethods = $makeSlice(sliceType$5, $parseInt(methods.length));
				_ref$3 = imethods;
				_i$3 = 0;
				while (true) {
					if (!(_i$3 < _ref$3.$length)) { break; }
					i$3 = _i$3;
					m$1 = methods[i$3];
					imethod.copy(((i$3 < 0 || i$3 >= imethods.$length) ? $throwRuntimeError("index out of range") : imethods.$array[imethods.$offset + i$3]), new imethod.ptr(newStringPtr(m$1.name), newStringPtr(m$1.pkg), reflectType(m$1.typ)));
					_i$3++;
				}
				setKindType(rt, new interfaceType.ptr($clone(rt, rtype), imethods));
			} else if (_1 === 21) {
				setKindType(rt, new mapType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.key), reflectType(typ.elem), ptrType$1.nil, ptrType$1.nil, 0, 0, 0, 0, 0, false, false));
			} else if (_1 === 22) {
				setKindType(rt, new ptrType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem)));
			} else if (_1 === 23) {
				setKindType(rt, new sliceType.ptr(new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil), reflectType(typ.elem)));
			} else if (_1 === 25) {
				fields = typ.fields;
				reflectFields = $makeSlice(sliceType$6, $parseInt(fields.length));
				_ref$4 = reflectFields;
				_i$4 = 0;
				while (true) {
					if (!(_i$4 < _ref$4.$length)) { break; }
					i$4 = _i$4;
					f = fields[i$4];
					structField.copy(((i$4 < 0 || i$4 >= reflectFields.$length) ? $throwRuntimeError("index out of range") : reflectFields.$array[reflectFields.$offset + i$4]), new structField.ptr(newStringPtr(f.name), newStringPtr(f.pkg), reflectType(f.typ), newStringPtr(f.tag), (i$4 >>> 0)));
					_i$4++;
				}
				setKindType(rt, new structType.ptr($clone(rt, rtype), reflectFields));
			}
		}
		return typ.reflectType;
	};
	setKindType = function(rt, kindType) {
		var $ptr, kindType, rt;
		rt.kindType = kindType;
		kindType.rtype = rt;
	};
	newStringPtr = function(strObj) {
		var $ptr, _entry, _key, _tuple, c, ok, ptr, str, str$24ptr, strObj;
		c = new structType$6.ptr("");
		c.str = strObj;
		str = c.str;
		if (str === "") {
			return ptrType$6.nil;
		}
		_tuple = (_entry = stringPtrMap[$String.keyFor(str)], _entry !== undefined ? [_entry.v, true] : [ptrType$6.nil, false]);
		ptr = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			ptr = (str$24ptr || (str$24ptr = new ptrType$6(function() { return str; }, function($v) { str = $v; })));
			_key = str; (stringPtrMap || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: ptr };
		}
		return ptr;
	};
	isWrapped = function(typ) {
		var $ptr, typ;
		return !!(jsType(typ).wrapped);
	};
	copyStruct = function(dst, src, typ) {
		var $ptr, dst, fields, i, prop, src, typ;
		fields = jsType(typ).fields;
		i = 0;
		while (true) {
			if (!(i < $parseInt(fields.length))) { break; }
			prop = $internalize(fields[i].prop, $String);
			dst[$externalize(prop, $String)] = src[$externalize(prop, $String)];
			i = i + (1) >> 0;
		}
	};
	makeValue = function(t, v, fl) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _v, _v$1, fl, rt, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _v = $f._v; _v$1 = $f._v$1; fl = $f.fl; rt = $f.rt; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		rt = _r;
		_r$1 = t.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		if (_r$1 === 17) { _v$1 = true; $s = 5; continue s; }
		_r$2 = t.Kind(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_v$1 = _r$2 === 25; case 5:
		if (_v$1) { _v = true; $s = 4; continue s; }
		_r$3 = t.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		_v = _r$3 === 22; case 4:
		/* */ if (_v) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (_v) { */ case 2:
			_r$4 = t.Kind(); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			/* */ $s = 10; case 10:
			return new Value.ptr(rt, v, (fl | (_r$4 >>> 0)) >>> 0);
		/* } */ case 3:
		_r$5 = t.Kind(); /* */ $s = 11; case 11: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		/* */ $s = 12; case 12:
		return new Value.ptr(rt, $newDataPointer(v, jsType(rt.ptrTo())), (((fl | (_r$5 >>> 0)) >>> 0) | 128) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeValue }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._v = _v; $f._v$1 = _v$1; $f.fl = fl; $f.rt = rt; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	MakeSlice = function(typ, len, cap) {
		var $ptr, _r, _r$1, cap, len, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; len = $f.len; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		typ = [typ];
		_r = typ[0].Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 23))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 23))) { */ case 1:
			$panic(new $String("reflect.MakeSlice of non-slice type"));
		/* } */ case 2:
		if (len < 0) {
			$panic(new $String("reflect.MakeSlice: negative len"));
		}
		if (cap < 0) {
			$panic(new $String("reflect.MakeSlice: negative cap"));
		}
		if (len > cap) {
			$panic(new $String("reflect.MakeSlice: len > cap"));
		}
		_r$1 = makeValue(typ[0], $makeSlice(jsType(typ[0]), len, cap, (function(typ) { return function $b() {
			var $ptr, _r$1, _r$2, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$1 = typ[0].Elem(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_r$2 = jsType(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			/* */ $s = 3; case 3:
			return _r$2.zero();
			/* */ } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.$s = $s; $f.$r = $r; return $f;
		}; })(typ)), 0); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 5; case 5:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: MakeSlice }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.len = len; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.MakeSlice = MakeSlice;
	TypeOf = function(i) {
		var $ptr, i;
		if (!initialized) {
			return new rtype.ptr(0, 0, 0, 0, 0, 0, 0, ptrType$4.nil, ptrType$5.nil, ptrType$6.nil, ptrType$7.nil, ptrType$1.nil);
		}
		if ($interfaceIsEqual(i, $ifaceNil)) {
			return $ifaceNil;
		}
		return reflectType(i.constructor);
	};
	$pkg.TypeOf = TypeOf;
	ValueOf = function(i) {
		var $ptr, _r, i, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(i, $ifaceNil)) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_r = makeValue(reflectType(i.constructor), i.$val, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ValueOf }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ValueOf = ValueOf;
	rtype.ptr.prototype.ptrTo = function() {
		var $ptr, t;
		t = this;
		return reflectType($ptrType(jsType(t)));
	};
	rtype.prototype.ptrTo = function() { return this.$val.ptrTo(); };
	SliceOf = function(t) {
		var $ptr, t;
		return reflectType($sliceType(jsType(t)));
	};
	$pkg.SliceOf = SliceOf;
	Zero = function(typ) {
		var $ptr, _r, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = makeValue(typ, jsType(typ).zero(), 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Zero }; } $f.$ptr = $ptr; $f._r = _r; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Zero = Zero;
	unsafe_New = function(typ) {
		var $ptr, _3, typ;
		_3 = typ.Kind();
		if (_3 === 25) {
			return new (jsType(typ).ptr)();
		} else if (_3 === 17) {
			return jsType(typ).zero();
		} else {
			return $newDataPointer(jsType(typ).zero(), jsType(typ.ptrTo()));
		}
	};
	makeInt = function(f, bits, t) {
		var $ptr, _4, _r, bits, f, ptr, t, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _4 = $f._4; _r = $f._r; bits = $f.bits; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_4 = typ.Kind();
		if (_4 === 3) {
			ptr.$set((bits.$low << 24 >> 24));
		} else if (_4 === 4) {
			ptr.$set((bits.$low << 16 >> 16));
		} else if ((_4 === 2) || (_4 === 5)) {
			ptr.$set((bits.$low >> 0));
		} else if (_4 === 6) {
			ptr.$set(new $Int64(bits.$high, bits.$low));
		} else if (_4 === 8) {
			ptr.$set((bits.$low << 24 >>> 24));
		} else if (_4 === 9) {
			ptr.$set((bits.$low << 16 >>> 16));
		} else if ((_4 === 7) || (_4 === 10) || (_4 === 12)) {
			ptr.$set((bits.$low >>> 0));
		} else if (_4 === 11) {
			ptr.$set(bits);
		}
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeInt }; } $f.$ptr = $ptr; $f._4 = _4; $f._r = _r; $f.bits = bits; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	typedmemmove = function(t, dst, src) {
		var $ptr, dst, src, t;
		dst.$set(src.$get());
	};
	keyFor = function(t, key) {
		var $ptr, k, key, kv, t;
		kv = key;
		if (!(kv.$get === undefined)) {
			kv = kv.$get();
		}
		k = $internalize(jsType(t.Key()).keyFor(kv), $String);
		return [kv, k];
	};
	mapaccess = function(t, m, key) {
		var $ptr, _tuple, entry, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		entry = m[$externalize(k, $String)];
		if (entry === undefined) {
			return 0;
		}
		return $newDataPointer(entry.v, jsType(PtrTo(t.Elem())));
	};
	mapassign = function(t, m, key, val) {
		var $ptr, _r, _tuple, entry, et, jsVal, k, key, kv, m, newVal, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; entry = $f.entry; et = $f.et; jsVal = $f.jsVal; k = $f.k; key = $f.key; kv = $f.kv; m = $f.m; newVal = $f.newVal; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tuple = keyFor(t, key);
		kv = _tuple[0];
		k = _tuple[1];
		jsVal = val.$get();
		et = t.Elem();
		_r = et.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r === 25) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r === 25) { */ case 1:
			newVal = jsType(et).zero();
			copyStruct(newVal, jsVal, et);
			jsVal = newVal;
		/* } */ case 2:
		entry = new ($global.Object)();
		entry.k = kv;
		entry.v = jsVal;
		m[$externalize(k, $String)] = entry;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: mapassign }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.entry = entry; $f.et = et; $f.jsVal = jsVal; $f.k = k; $f.key = key; $f.kv = kv; $f.m = m; $f.newVal = newVal; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapdelete = function(t, m, key) {
		var $ptr, _tuple, k, key, m, t;
		_tuple = keyFor(t, key);
		k = _tuple[1];
		delete m[$externalize(k, $String)];
	};
	mapiterinit = function(t, m) {
		var $ptr, m, t;
		return new mapIter.ptr(t, m, $keys(m), 0);
	};
	mapiterkey = function(it) {
		var $ptr, _r, _r$1, _r$2, it, iter, k, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; it = $f.it; iter = $f.iter; k = $f.k; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		iter = it;
		k = iter.keys[iter.i];
		_r = iter.t.Key(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = PtrTo(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = jsType(_r$1); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 4; case 4:
		return $newDataPointer(iter.m[$externalize($internalize(k, $String), $String)].k, _r$2);
		/* */ } return; } if ($f === undefined) { $f = { $blk: mapiterkey }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.it = it; $f.iter = iter; $f.k = k; $f.$s = $s; $f.$r = $r; return $f;
	};
	mapiternext = function(it) {
		var $ptr, it, iter;
		iter = it;
		iter.i = iter.i + (1) >> 0;
	};
	maplen = function(m) {
		var $ptr, m;
		return $parseInt($keys(m).length);
	};
	cvtDirect = function(v, typ) {
		var $ptr, _6, _arg, _arg$1, _arg$2, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, k, slice, srcVal, typ, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _6 = $f._6; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; k = $f.k; slice = $f.slice; srcVal = $f.srcVal; typ = $f.typ; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		srcVal = v.object();
		/* */ if (srcVal === jsType(v.typ).nil) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (srcVal === jsType(v.typ).nil) { */ case 1:
			_r = makeValue(typ, jsType(typ).nil, v.flag); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ $s = 4; case 4:
			return _r;
		/* } */ case 2:
		val = null;
			_r$1 = typ.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			k = _r$1;
			_6 = k;
			/* */ if (_6 === 23) { $s = 7; continue; }
			/* */ if (_6 === 22) { $s = 8; continue; }
			/* */ if (_6 === 25) { $s = 9; continue; }
			/* */ if ((_6 === 17) || (_6 === 1) || (_6 === 18) || (_6 === 19) || (_6 === 20) || (_6 === 21) || (_6 === 24)) { $s = 10; continue; }
			/* */ $s = 11; continue;
			/* if (_6 === 23) { */ case 7:
				slice = new (jsType(typ))(srcVal.$array);
				slice.$offset = srcVal.$offset;
				slice.$length = srcVal.$length;
				slice.$capacity = srcVal.$capacity;
				val = $newDataPointer(slice, jsType(PtrTo(typ)));
				$s = 12; continue;
			/* } else if (_6 === 22) { */ case 8:
				_r$2 = typ.Elem(); /* */ $s = 15; case 15: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_r$3 = _r$2.Kind(); /* */ $s = 16; case 16: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				/* */ if (_r$3 === 25) { $s = 13; continue; }
				/* */ $s = 14; continue;
				/* if (_r$3 === 25) { */ case 13:
					_r$4 = typ.Elem(); /* */ $s = 19; case 19: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_r$4, v.typ.Elem())) { $s = 17; continue; }
					/* */ $s = 18; continue;
					/* if ($interfaceIsEqual(_r$4, v.typ.Elem())) { */ case 17:
						val = srcVal;
						/* break; */ $s = 5; continue;
					/* } */ case 18:
					val = new (jsType(typ))();
					_arg = val;
					_arg$1 = srcVal;
					_r$5 = typ.Elem(); /* */ $s = 20; case 20: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					_arg$2 = _r$5;
					$r = copyStruct(_arg, _arg$1, _arg$2); /* */ $s = 21; case 21: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
					/* break; */ $s = 5; continue;
				/* } */ case 14:
				val = new (jsType(typ))(srcVal.$get, srcVal.$set);
				$s = 12; continue;
			/* } else if (_6 === 25) { */ case 9:
				val = new (jsType(typ).ptr)();
				copyStruct(val, srcVal, typ);
				$s = 12; continue;
			/* } else if ((_6 === 17) || (_6 === 1) || (_6 === 18) || (_6 === 19) || (_6 === 20) || (_6 === 21) || (_6 === 24)) { */ case 10:
				val = v.ptr;
				$s = 12; continue;
			/* } else { */ case 11:
				$panic(new ValueError.ptr("reflect.Convert", k));
			/* } */ case 12:
		case 5:
		_r$6 = typ.common(); /* */ $s = 22; case 22: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_r$7 = typ.Kind(); /* */ $s = 23; case 23: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		/* */ $s = 24; case 24:
		return new Value.ptr(_r$6, val, (((v.flag & 224) >>> 0) | (_r$7 >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtDirect }; } $f.$ptr = $ptr; $f._6 = _6; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f.k = k; $f.slice = slice; $f.srcVal = srcVal; $f.typ = typ; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	methodReceiver = function(op, v, i) {
		var $ptr, fn, i, iface, m, m$1, op, prop, rcvr, rcvrtype, t, tt, ut, v, x, x$1;
		rcvrtype = ptrType$1.nil;
		t = ptrType$1.nil;
		fn = 0;
		v = v;
		prop = "";
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if (i < 0 || i >= tt.methods.$length) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (!(m.pkgPath === ptrType$6.nil)) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			iface = $pointerOfStructConversion(v.ptr, ptrType$8);
			if (iface.itab === ptrType$9.nil) {
				$panic(new $String("reflect: " + op + " of method on nil interface value"));
			}
			t = m.typ;
			prop = m.name.$get();
		} else {
			ut = v.typ.uncommonType.uncommon();
			if (ut === ptrType$7.nil || i < 0 || i >= ut.methods.$length) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m$1 = (x$1 = ut.methods, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i]));
			if (!(m$1.pkgPath === ptrType$6.nil)) {
				$panic(new $String("reflect: " + op + " of unexported method"));
			}
			t = m$1.mtyp;
			prop = $internalize($methodSet(jsType(v.typ))[i].prop, $String);
		}
		rcvr = v.object();
		if (isWrapped(v.typ)) {
			rcvr = new (jsType(v.typ))(rcvr);
		}
		fn = rcvr[$externalize(prop, $String)];
		return [rcvrtype, t, fn];
	};
	valueInterface = function(v, safe) {
		var $ptr, _r, safe, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; safe = $f.safe; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.Interface", 0));
		}
		if (safe && !((((v.flag & 96) >>> 0) === 0))) {
			$panic(new $String("reflect.Value.Interface: cannot return value obtained from unexported field or method"));
		}
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Interface", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		if (isWrapped(v.typ)) {
			return new (jsType(v.typ))(v.object());
		}
		return v.object();
		/* */ } return; } if ($f === undefined) { $f = { $blk: valueInterface }; } $f.$ptr = $ptr; $f._r = _r; $f.safe = safe; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	ifaceE2I = function(t, src, dst) {
		var $ptr, dst, src, t;
		dst.$set(src);
	};
	methodName = function() {
		var $ptr;
		return "?FIXME?";
	};
	makeMethodValue = function(op, v) {
		var $ptr, _r, _tuple, fn, fv, op, rcvr, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; fn = $f.fn; fv = $f.fv; op = $f.op; rcvr = $f.rcvr; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		fn = [fn];
		rcvr = [rcvr];
		v = v;
		if (((v.flag & 512) >>> 0) === 0) {
			$panic(new $String("reflect: internal error: invalid use of makePartialFunc"));
		}
		_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
		fn[0] = _tuple[2];
		rcvr[0] = v.object();
		if (isWrapped(v.typ)) {
			rcvr[0] = new (jsType(v.typ))(rcvr[0]);
		}
		fv = $makeFunc((function(fn, rcvr) { return function(arguments$1) {
			var $ptr, arguments$1;
			return fn[0].apply(rcvr[0], $externalize(arguments$1, sliceType$7));
		}; })(fn, rcvr));
		_r = v.Type().common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return new Value.ptr(_r, fv, (((v.flag & 96) >>> 0) | 19) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeMethodValue }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.fn = fn; $f.fv = fv; $f.op = op; $f.rcvr = rcvr; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.ptr.prototype.pointers = function() {
		var $ptr, _7, t;
		t = this;
		_7 = t.Kind();
		if ((_7 === 22) || (_7 === 21) || (_7 === 18) || (_7 === 19) || (_7 === 25) || (_7 === 17)) {
			return true;
		} else {
			return false;
		}
	};
	rtype.prototype.pointers = function() { return this.$val.pointers(); };
	rtype.ptr.prototype.Comparable = function() {
		var $ptr, _8, _r, _r$1, _r$2, i, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _8 = $f._8; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; i = $f.i; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
			_8 = t.Kind();
			/* */ if ((_8 === 19) || (_8 === 23) || (_8 === 21)) { $s = 2; continue; }
			/* */ if (_8 === 17) { $s = 3; continue; }
			/* */ if (_8 === 25) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if ((_8 === 19) || (_8 === 23) || (_8 === 21)) { */ case 2:
				return false;
			/* } else if (_8 === 17) { */ case 3:
				_r = t.Elem().Comparable(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 7; case 7:
				return _r;
			/* } else if (_8 === 25) { */ case 4:
				i = 0;
				/* while (true) { */ case 8:
					/* if (!(i < t.NumField())) { break; } */ if(!(i < t.NumField())) { $s = 9; continue; }
					_r$1 = t.Field(i); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					_r$2 = _r$1.Type.Comparable(); /* */ $s = 13; case 13: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					/* */ if (!_r$2) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (!_r$2) { */ case 10:
						return false;
					/* } */ case 11:
					i = i + (1) >> 0;
				/* } */ $s = 8; continue; case 9:
			/* } */ case 5:
		case 1:
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Comparable }; } $f.$ptr = $ptr; $f._8 = _8; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.i = i; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Comparable = function() { return this.$val.Comparable(); };
	uncommonType.ptr.prototype.Method = function(i) {
		var $ptr, fl, fn, i, m, mt, p, prop, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (t === ptrType$7.nil || i < 0 || i >= t.methods.$length) {
			$panic(new $String("reflect: Method index out of range"));
		}
		p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		if (!(p.name === ptrType$6.nil)) {
			m.Name = p.name.$get();
		}
		fl = 19;
		if (!(p.pkgPath === ptrType$6.nil)) {
			m.PkgPath = p.pkgPath.$get();
			fl = (fl | (32)) >>> 0;
		}
		mt = p.typ;
		m.Type = mt;
		prop = $internalize($methodSet(t.jsType)[i].prop, $String);
		fn = $makeFunc((function(arguments$1) {
			var $ptr, arguments$1, rcvr;
			rcvr = (0 >= arguments$1.$length ? $throwRuntimeError("index out of range") : arguments$1.$array[arguments$1.$offset + 0]);
			return rcvr[$externalize(prop, $String)].apply(rcvr, $externalize($subslice(arguments$1, 1), sliceType$7));
		}));
		m.Func = new Value.ptr(mt, fn, fl);
		m.Index = i;
		return m;
	};
	uncommonType.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.object = function() {
		var $ptr, _9, newVal, v, val;
		v = this;
		if ((v.typ.Kind() === 17) || (v.typ.Kind() === 25)) {
			return v.ptr;
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			val = v.ptr.$get();
			if (!(val === $ifaceNil) && !(val.constructor === jsType(v.typ))) {
				switch (0) { default:
					_9 = v.typ.Kind();
					if ((_9 === 11) || (_9 === 6)) {
						val = new (jsType(v.typ))(val.$high, val.$low);
					} else if ((_9 === 15) || (_9 === 16)) {
						val = new (jsType(v.typ))(val.$real, val.$imag);
					} else if (_9 === 23) {
						if (val === val.constructor.nil) {
							val = jsType(v.typ).nil;
							break;
						}
						newVal = new (jsType(v.typ))(val.$array);
						newVal.$offset = val.$offset;
						newVal.$length = val.$length;
						newVal.$capacity = val.$capacity;
						val = newVal;
					}
				}
			}
			return val;
		}
		return v.ptr;
	};
	Value.prototype.object = function() { return this.$val.object(); };
	Value.ptr.prototype.call = function(op, in$1) {
		var $ptr, _10, _arg, _arg$1, _arg$2, _arg$3, _i, _i$1, _i$2, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, _ref$1, _ref$2, _tmp, _tmp$1, _tuple, arg, argsArray, elem, fn, i, i$1, i$2, i$3, in$1, isSlice, m, n, nin, nout, op, origIn, rcvr, results, ret, slice, t, targ, v, x, x$1, x$2, xt, xt$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _10 = $f._10; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _arg$3 = $f._arg$3; _i = $f._i; _i$1 = $f._i$1; _i$2 = $f._i$2; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; arg = $f.arg; argsArray = $f.argsArray; elem = $f.elem; fn = $f.fn; i = $f.i; i$1 = $f.i$1; i$2 = $f.i$2; i$3 = $f.i$3; in$1 = $f.in$1; isSlice = $f.isSlice; m = $f.m; n = $f.n; nin = $f.nin; nout = $f.nout; op = $f.op; origIn = $f.origIn; rcvr = $f.rcvr; results = $f.results; ret = $f.ret; slice = $f.slice; t = $f.t; targ = $f.targ; v = $f.v; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; xt = $f.xt; xt$1 = $f.xt$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		t = v.typ;
		fn = 0;
		rcvr = null;
		if (!((((v.flag & 512) >>> 0) === 0))) {
			_tuple = methodReceiver(op, v, (v.flag >> 0) >> 10 >> 0);
			t = _tuple[1];
			fn = _tuple[2];
			rcvr = v.object();
			if (isWrapped(v.typ)) {
				rcvr = new (jsType(v.typ))(rcvr);
			}
		} else {
			fn = v.object();
			rcvr = undefined;
		}
		if (fn === 0) {
			$panic(new $String("reflect.Value.Call: call of nil function"));
		}
		isSlice = op === "CallSlice";
		n = t.NumIn();
		if (isSlice) {
			if (!t.IsVariadic()) {
				$panic(new $String("reflect: CallSlice of non-variadic function"));
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: CallSlice with too few input arguments"));
			}
			if (in$1.$length > n) {
				$panic(new $String("reflect: CallSlice with too many input arguments"));
			}
		} else {
			if (t.IsVariadic()) {
				n = n - (1) >> 0;
			}
			if (in$1.$length < n) {
				$panic(new $String("reflect: Call with too few input arguments"));
			}
			if (!t.IsVariadic() && in$1.$length > n) {
				$panic(new $String("reflect: Call with too many input arguments"));
			}
		}
		_ref = in$1;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (x.Kind() === 0) {
				$panic(new $String("reflect: " + op + " using zero Value argument"));
			}
			_i++;
		}
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < n)) { break; } */ if(!(i < n)) { $s = 2; continue; }
			_tmp = ((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i]).Type();
			_tmp$1 = t.In(i);
			xt = _tmp;
			targ = _tmp$1;
			_r = xt.AssignableTo(targ); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (!_r) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!_r) { */ case 3:
				_r$1 = xt.String(); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = targ.String(); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				$panic(new $String("reflect: " + op + " using " + _r$1 + " as type " + _r$2));
			/* } */ case 4:
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		/* */ if (!isSlice && t.IsVariadic()) { $s = 8; continue; }
		/* */ $s = 9; continue;
		/* if (!isSlice && t.IsVariadic()) { */ case 8:
			m = in$1.$length - n >> 0;
			_r$3 = MakeSlice(t.In(n), m, m); /* */ $s = 10; case 10: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			slice = _r$3;
			_r$4 = t.In(n).Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			elem = _r$4;
			i$1 = 0;
			/* while (true) { */ case 12:
				/* if (!(i$1 < m)) { break; } */ if(!(i$1 < m)) { $s = 13; continue; }
				x$2 = (x$1 = n + i$1 >> 0, ((x$1 < 0 || x$1 >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + x$1]));
				xt$1 = x$2.Type();
				_r$5 = xt$1.AssignableTo(elem); /* */ $s = 16; case 16: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
				/* */ if (!_r$5) { $s = 14; continue; }
				/* */ $s = 15; continue;
				/* if (!_r$5) { */ case 14:
					_r$6 = xt$1.String(); /* */ $s = 17; case 17: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					_r$7 = elem.String(); /* */ $s = 18; case 18: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					$panic(new $String("reflect: cannot use " + _r$6 + " as type " + _r$7 + " in " + op));
				/* } */ case 15:
				_r$8 = slice.Index(i$1); /* */ $s = 19; case 19: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				$r = _r$8.Set(x$2); /* */ $s = 20; case 20: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i$1 = i$1 + (1) >> 0;
			/* } */ $s = 12; continue; case 13:
			origIn = in$1;
			in$1 = $makeSlice(sliceType$8, (n + 1 >> 0));
			$copySlice($subslice(in$1, 0, n), origIn);
			((n < 0 || n >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + n] = slice);
		/* } */ case 9:
		nin = in$1.$length;
		if (!((nin === t.NumIn()))) {
			$panic(new $String("reflect.Value.Call: wrong argument count"));
		}
		nout = t.NumOut();
		argsArray = new ($global.Array)(t.NumIn());
		_ref$1 = in$1;
		_i$1 = 0;
		/* while (true) { */ case 21:
			/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 22; continue; }
			i$2 = _i$1;
			arg = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
			_arg = t.In(i$2);
			_r$9 = t.In(i$2).common(); /* */ $s = 23; case 23: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
			_arg$1 = _r$9;
			_arg$2 = 0;
			_r$10 = arg.assignTo("reflect.Value.Call", _arg$1, _arg$2); /* */ $s = 24; case 24: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
			_r$11 = _r$10.object(); /* */ $s = 25; case 25: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
			_arg$3 = _r$11;
			_r$12 = unwrapJsObject(_arg, _arg$3); /* */ $s = 26; case 26: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
			argsArray[i$2] = _r$12;
			_i$1++;
		/* } */ $s = 21; continue; case 22:
		_r$13 = callHelper(new sliceType$2([new $jsObjectPtr(fn), new $jsObjectPtr(rcvr), new $jsObjectPtr(argsArray)])); /* */ $s = 27; case 27: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
		results = _r$13;
			_10 = nout;
			/* */ if (_10 === 0) { $s = 29; continue; }
			/* */ if (_10 === 1) { $s = 30; continue; }
			/* */ $s = 31; continue;
			/* if (_10 === 0) { */ case 29:
				return sliceType$8.nil;
			/* } else if (_10 === 1) { */ case 30:
				_r$14 = makeValue(t.Out(0), wrapJsObject(t.Out(0), results), 0); /* */ $s = 33; case 33: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
				/* */ $s = 34; case 34:
				return new sliceType$8([$clone(_r$14, Value)]);
			/* } else { */ case 31:
				ret = $makeSlice(sliceType$8, nout);
				_ref$2 = ret;
				_i$2 = 0;
				/* while (true) { */ case 35:
					/* if (!(_i$2 < _ref$2.$length)) { break; } */ if(!(_i$2 < _ref$2.$length)) { $s = 36; continue; }
					i$3 = _i$2;
					_r$15 = makeValue(t.Out(i$3), wrapJsObject(t.Out(i$3), results[i$3]), 0); /* */ $s = 37; case 37: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
					((i$3 < 0 || i$3 >= ret.$length) ? $throwRuntimeError("index out of range") : ret.$array[ret.$offset + i$3] = _r$15);
					_i$2++;
				/* } */ $s = 35; continue; case 36:
				return ret;
			/* } */ case 32:
		case 28:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.call }; } $f.$ptr = $ptr; $f._10 = _10; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._arg$3 = _arg$3; $f._i = _i; $f._i$1 = _i$1; $f._i$2 = _i$2; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.arg = arg; $f.argsArray = argsArray; $f.elem = elem; $f.fn = fn; $f.i = i; $f.i$1 = i$1; $f.i$2 = i$2; $f.i$3 = i$3; $f.in$1 = in$1; $f.isSlice = isSlice; $f.m = m; $f.n = n; $f.nin = nin; $f.nout = nout; $f.op = op; $f.origIn = origIn; $f.rcvr = rcvr; $f.results = results; $f.ret = ret; $f.slice = slice; $f.t = t; $f.targ = targ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.xt = xt; $f.xt$1 = xt$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.call = function(op, in$1) { return this.$val.call(op, in$1); };
	Value.ptr.prototype.Cap = function() {
		var $ptr, _11, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_11 = k;
		if (_11 === 17) {
			return v.typ.Len();
		} else if ((_11 === 18) || (_11 === 23)) {
			return $parseInt(v.object().$capacity) >> 0;
		}
		$panic(new ValueError.ptr("reflect.Value.Cap", k));
	};
	Value.prototype.Cap = function() { return this.$val.Cap(); };
	wrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return new (jsType(jsObjectPtr))(val);
		}
		return val;
	};
	unwrapJsObject = function(typ, val) {
		var $ptr, typ, val;
		if ($interfaceIsEqual(typ, jsObjectPtr)) {
			return val.object;
		}
		return val;
	};
	Value.ptr.prototype.Elem = function() {
		var $ptr, _12, _r, fl, k, tt, typ, v, val, val$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _12 = $f._12; _r = $f._r; fl = $f.fl; k = $f.k; tt = $f.tt; typ = $f.typ; v = $f.v; val = $f.val; val$1 = $f.val$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
			k = new flag(v.flag).kind();
			_12 = k;
			/* */ if (_12 === 20) { $s = 2; continue; }
			/* */ if (_12 === 22) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_12 === 20) { */ case 2:
				val = v.object();
				if (val === $ifaceNil) {
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				typ = reflectType(val.constructor);
				_r = makeValue(typ, val.$val, (v.flag & 96) >>> 0); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 7; case 7:
				return _r;
			/* } else if (_12 === 22) { */ case 3:
				if (v.IsNil()) {
					return new Value.ptr(ptrType$1.nil, 0, 0);
				}
				val$1 = v.object();
				tt = v.typ.kindType;
				fl = (((((v.flag & 96) >>> 0) | 128) >>> 0) | 256) >>> 0;
				fl = (fl | ((tt.elem.Kind() >>> 0))) >>> 0;
				return new Value.ptr(tt.elem, wrapJsObject(tt.elem, val$1), fl);
			/* } else { */ case 4:
				$panic(new ValueError.ptr("reflect.Value.Elem", k));
			/* } */ case 5:
		case 1:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Elem }; } $f.$ptr = $ptr; $f._12 = _12; $f._r = _r; $f.fl = fl; $f.k = k; $f.tt = tt; $f.typ = typ; $f.v = v; $f.val = val; $f.val$1 = val$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Elem = function() { return this.$val.Elem(); };
	Value.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, field, fl, i, jsTag, o, prop, s, tag, tt, typ, v, x, x$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; field = $f.field; fl = $f.fl; i = $f.i; jsTag = $f.jsTag; o = $f.o; prop = $f.prop; s = $f.s; tag = $f.tag; tt = $f.tt; typ = $f.typ; v = $f.v; x = $f.x; x$1 = $f.x$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		jsTag = [jsTag];
		prop = [prop];
		s = [s];
		typ = [typ];
		v = this;
		new flag(v.flag).mustBe(25);
		tt = v.typ.kindType;
		if (i < 0 || i >= tt.fields.$length) {
			$panic(new $String("reflect: Field index out of range"));
		}
		prop[0] = $internalize(jsType(v.typ).fields[i].prop, $String);
		field = (x = tt.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		typ[0] = field.typ;
		fl = (((v.flag & 416) >>> 0) | (typ[0].Kind() >>> 0)) >>> 0;
		if (!(field.pkgPath === ptrType$6.nil)) {
			if (field.name === ptrType$6.nil) {
				fl = (fl | (64)) >>> 0;
			} else {
				fl = (fl | (32)) >>> 0;
			}
		}
		tag = (x$1 = tt.fields, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i])).tag;
		/* */ if (!(tag === ptrType$6.nil) && !((i === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(tag === ptrType$6.nil) && !((i === 0))) { */ case 1:
			jsTag[0] = getJsTag(tag.$get());
			/* */ if (!(jsTag[0] === "")) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (!(jsTag[0] === "")) { */ case 3:
				/* while (true) { */ case 5:
					o = [o];
					_r = v.Field(0); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					v = _r;
					/* */ if (v.typ === jsObjectPtr) { $s = 8; continue; }
					/* */ $s = 9; continue;
					/* if (v.typ === jsObjectPtr) { */ case 8:
						o[0] = v.object().object;
						return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, o, prop, s, typ) { return function() {
							var $ptr;
							return $internalize(o[0][$externalize(jsTag[0], $String)], jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ), (function(jsTag, o, prop, s, typ) { return function(x$2) {
							var $ptr, x$2;
							o[0][$externalize(jsTag[0], $String)] = $externalize(x$2, jsType(typ[0]));
						}; })(jsTag, o, prop, s, typ)), fl);
					/* } */ case 9:
					/* */ if (v.typ.Kind() === 22) { $s = 10; continue; }
					/* */ $s = 11; continue;
					/* if (v.typ.Kind() === 22) { */ case 10:
						_r$1 = v.Elem(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						v = _r$1;
					/* } */ case 11:
				/* } */ $s = 5; continue; case 6:
			/* } */ case 4:
		/* } */ case 2:
		s[0] = v.ptr;
		/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 13; continue; }
		/* */ $s = 14; continue;
		/* if (!((((fl & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 13:
			return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(jsTag, prop, s, typ) { return function() {
				var $ptr;
				return wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]);
			}; })(jsTag, prop, s, typ), (function(jsTag, prop, s, typ) { return function(x$2) {
				var $ptr, x$2;
				s[0][$externalize(prop[0], $String)] = unwrapJsObject(typ[0], x$2);
			}; })(jsTag, prop, s, typ)), fl);
		/* } */ case 14:
		_r$2 = makeValue(typ[0], wrapJsObject(typ[0], s[0][$externalize(prop[0], $String)]), fl); /* */ $s = 15; case 15: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 16; case 16:
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.field = field; $f.fl = fl; $f.i = i; $f.jsTag = jsTag; $f.o = o; $f.prop = prop; $f.s = s; $f.tag = tag; $f.tt = tt; $f.typ = typ; $f.v = v; $f.x = x; $f.x$1 = x$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Field = function(i) { return this.$val.Field(i); };
	getJsTag = function(tag) {
		var $ptr, _tuple, i, name, qvalue, tag, value;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = tag.substring(i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 32)) && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name = tag.substring(0, i);
			tag = tag.substring((i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = tag.substring(0, (i + 1 >> 0));
			tag = tag.substring((i + 1 >> 0));
			if (name === "js") {
				_tuple = strconv.Unquote(qvalue);
				value = _tuple[0];
				return value;
			}
		}
		return "";
	};
	Value.ptr.prototype.Index = function(i) {
		var $ptr, _13, _r, _r$1, a, a$1, c, fl, fl$1, fl$2, i, k, s, str, tt, tt$1, typ, typ$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _13 = $f._13; _r = $f._r; _r$1 = $f._r$1; a = $f.a; a$1 = $f.a$1; c = $f.c; fl = $f.fl; fl$1 = $f.fl$1; fl$2 = $f.fl$2; i = $f.i; k = $f.k; s = $f.s; str = $f.str; tt = $f.tt; tt$1 = $f.tt$1; typ = $f.typ; typ$1 = $f.typ$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		a = [a];
		a$1 = [a$1];
		c = [c];
		i = [i];
		typ = [typ];
		typ$1 = [typ$1];
		v = this;
			k = new flag(v.flag).kind();
			_13 = k;
			/* */ if (_13 === 17) { $s = 2; continue; }
			/* */ if (_13 === 23) { $s = 3; continue; }
			/* */ if (_13 === 24) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_13 === 17) { */ case 2:
				tt = v.typ.kindType;
				if (i[0] < 0 || i[0] > (tt.len >> 0)) {
					$panic(new $String("reflect: array index out of range"));
				}
				typ$1[0] = tt.elem;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((typ$1[0].Kind() >>> 0))) >>> 0;
				a$1[0] = v.ptr;
				/* */ if (!((((fl & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (!((((fl & 128) >>> 0) === 0)) && !((typ$1[0].Kind() === 17)) && !((typ$1[0].Kind() === 25))) { */ case 7:
					return new Value.ptr(typ$1[0], new (jsType(PtrTo(typ$1[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ$1[0], a$1[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a$1[0][i[0]] = unwrapJsObject(typ$1[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl);
				/* } */ case 8:
				_r = makeValue(typ$1[0], wrapJsObject(typ$1[0], a$1[0][i[0]]), fl); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 10; case 10:
				return _r;
			/* } else if (_13 === 23) { */ case 3:
				s = v.object();
				if (i[0] < 0 || i[0] >= ($parseInt(s.$length) >> 0)) {
					$panic(new $String("reflect: slice index out of range"));
				}
				tt$1 = v.typ.kindType;
				typ[0] = tt$1.elem;
				fl$1 = (384 | ((v.flag & 96) >>> 0)) >>> 0;
				fl$1 = (fl$1 | ((typ[0].Kind() >>> 0))) >>> 0;
				i[0] = i[0] + (($parseInt(s.$offset) >> 0)) >> 0;
				a[0] = s.$array;
				/* */ if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { $s = 11; continue; }
				/* */ $s = 12; continue;
				/* if (!((((fl$1 & 128) >>> 0) === 0)) && !((typ[0].Kind() === 17)) && !((typ[0].Kind() === 25))) { */ case 11:
					return new Value.ptr(typ[0], new (jsType(PtrTo(typ[0])))((function(a, a$1, c, i, typ, typ$1) { return function() {
						var $ptr;
						return wrapJsObject(typ[0], a[0][i[0]]);
					}; })(a, a$1, c, i, typ, typ$1), (function(a, a$1, c, i, typ, typ$1) { return function(x) {
						var $ptr, x;
						a[0][i[0]] = unwrapJsObject(typ[0], x);
					}; })(a, a$1, c, i, typ, typ$1)), fl$1);
				/* } */ case 12:
				_r$1 = makeValue(typ[0], wrapJsObject(typ[0], a[0][i[0]]), fl$1); /* */ $s = 13; case 13: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				/* */ $s = 14; case 14:
				return _r$1;
			/* } else if (_13 === 24) { */ case 4:
				str = v.ptr.$get();
				if (i[0] < 0 || i[0] >= str.length) {
					$panic(new $String("reflect: string index out of range"));
				}
				fl$2 = (((v.flag & 96) >>> 0) | 8) >>> 0;
				c[0] = str.charCodeAt(i[0]);
				return new Value.ptr(uint8Type, (c.$ptr || (c.$ptr = new ptrType$5(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, c))), (fl$2 | 128) >>> 0);
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Index", k));
			/* } */ case 6:
		case 1:
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Index }; } $f.$ptr = $ptr; $f._13 = _13; $f._r = _r; $f._r$1 = _r$1; $f.a = a; $f.a$1 = a$1; $f.c = c; $f.fl = fl; $f.fl$1 = fl$1; $f.fl$2 = fl$2; $f.i = i; $f.k = k; $f.s = s; $f.str = str; $f.tt = tt; $f.tt$1 = tt$1; $f.typ = typ; $f.typ$1 = typ$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Index = function(i) { return this.$val.Index(i); };
	Value.ptr.prototype.InterfaceData = function() {
		var $ptr, v;
		v = this;
		$panic(errors.New("InterfaceData is not supported by GopherJS"));
	};
	Value.prototype.InterfaceData = function() { return this.$val.InterfaceData(); };
	Value.ptr.prototype.IsNil = function() {
		var $ptr, _14, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_14 = k;
		if ((_14 === 22) || (_14 === 23)) {
			return v.object() === jsType(v.typ).nil;
		} else if (_14 === 18) {
			return v.object() === $chanNil;
		} else if (_14 === 19) {
			return v.object() === $throwNilPointerError;
		} else if (_14 === 21) {
			return v.object() === false;
		} else if (_14 === 20) {
			return v.object() === $ifaceNil;
		} else {
			$panic(new ValueError.ptr("reflect.Value.IsNil", k));
		}
	};
	Value.prototype.IsNil = function() { return this.$val.IsNil(); };
	Value.ptr.prototype.Len = function() {
		var $ptr, _15, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_15 = k;
		if ((_15 === 17) || (_15 === 24)) {
			return $parseInt(v.object().length);
		} else if (_15 === 23) {
			return $parseInt(v.object().$length) >> 0;
		} else if (_15 === 18) {
			return $parseInt(v.object().$buffer.length) >> 0;
		} else if (_15 === 21) {
			return $parseInt($keys(v.object()).length);
		} else {
			$panic(new ValueError.ptr("reflect.Value.Len", k));
		}
	};
	Value.prototype.Len = function() { return this.$val.Len(); };
	Value.ptr.prototype.Pointer = function() {
		var $ptr, _16, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_16 = k;
		if ((_16 === 18) || (_16 === 21) || (_16 === 22) || (_16 === 26)) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object();
		} else if (_16 === 19) {
			if (v.IsNil()) {
				return 0;
			}
			return 1;
		} else if (_16 === 23) {
			if (v.IsNil()) {
				return 0;
			}
			return v.object().$array;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Pointer", k));
		}
	};
	Value.prototype.Pointer = function() { return this.$val.Pointer(); };
	Value.ptr.prototype.Set = function(x) {
		var $ptr, _17, _r, _r$1, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _17 = $f._17; _r = $f._r; _r$1 = $f._r$1; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Set", v.typ, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		/* */ if (!((((v.flag & 128) >>> 0) === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((((v.flag & 128) >>> 0) === 0))) { */ case 2:
				_17 = v.typ.Kind();
				/* */ if (_17 === 17) { $s = 5; continue; }
				/* */ if (_17 === 20) { $s = 6; continue; }
				/* */ if (_17 === 25) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (_17 === 17) { */ case 5:
					jsType(v.typ).copy(v.ptr, x.ptr);
					$s = 9; continue;
				/* } else if (_17 === 20) { */ case 6:
					_r$1 = valueInterface(x, false); /* */ $s = 10; case 10: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					v.ptr.$set(_r$1);
					$s = 9; continue;
				/* } else if (_17 === 25) { */ case 7:
					copyStruct(v.ptr, x.ptr, v.typ);
					$s = 9; continue;
				/* } else { */ case 8:
					v.ptr.$set(x.object());
				/* } */ case 9:
			case 4:
			return;
		/* } */ case 3:
		v.ptr = x.ptr;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Set }; } $f.$ptr = $ptr; $f._17 = _17; $f._r = _r; $f._r$1 = _r$1; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Set = function(x) { return this.$val.Set(x); };
	Value.ptr.prototype.SetBytes = function(x) {
		var $ptr, _r, _r$1, _v, slice, typedSlice, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _v = $f._v; slice = $f.slice; typedSlice = $f.typedSlice; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.SetBytes of non-byte slice"));
		/* } */ case 2:
		slice = x;
		if (!(v.typ.Name() === "")) { _v = true; $s = 6; continue s; }
		_r$1 = v.typ.Elem().Name(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_v = !(_r$1 === ""); case 6:
		/* */ if (_v) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_v) { */ case 4:
			typedSlice = new (jsType(v.typ))(slice.$array);
			typedSlice.$offset = slice.$offset;
			typedSlice.$length = slice.$length;
			typedSlice.$capacity = slice.$capacity;
			slice = typedSlice;
		/* } */ case 5:
		v.ptr.$set(slice);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._v = _v; $f.slice = slice; $f.typedSlice = typedSlice; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetBytes = function(x) { return this.$val.SetBytes(x); };
	Value.ptr.prototype.SetCap = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < ($parseInt(s.$length) >> 0) || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice capacity out of range in SetCap"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = s.$length;
		newSlice.$capacity = n;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetCap = function(n) { return this.$val.SetCap(n); };
	Value.ptr.prototype.SetLen = function(n) {
		var $ptr, n, newSlice, s, v;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		s = v.ptr.$get();
		if (n < 0 || n > ($parseInt(s.$capacity) >> 0)) {
			$panic(new $String("reflect: slice length out of range in SetLen"));
		}
		newSlice = new (jsType(v.typ))(s.$array);
		newSlice.$offset = s.$offset;
		newSlice.$length = n;
		newSlice.$capacity = s.$capacity;
		v.ptr.$set(newSlice);
	};
	Value.prototype.SetLen = function(n) { return this.$val.SetLen(n); };
	Value.ptr.prototype.Slice = function(i, j) {
		var $ptr, _18, _r, _r$1, cap, i, j, kind, s, str, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _18 = $f._18; _r = $f._r; _r$1 = $f._r$1; cap = $f.cap; i = $f.i; j = $f.j; kind = $f.kind; s = $f.s; str = $f.str; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
			kind = new flag(v.flag).kind();
			_18 = kind;
			/* */ if (_18 === 17) { $s = 2; continue; }
			/* */ if (_18 === 23) { $s = 3; continue; }
			/* */ if (_18 === 24) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_18 === 17) { */ case 2:
				if (((v.flag & 256) >>> 0) === 0) {
					$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
				}
				tt = v.typ.kindType;
				cap = (tt.len >> 0);
				typ = SliceOf(tt.elem);
				s = new (jsType(typ))(v.object());
				$s = 6; continue;
			/* } else if (_18 === 23) { */ case 3:
				typ = v.typ;
				s = v.object();
				cap = $parseInt(s.$capacity) >> 0;
				$s = 6; continue;
			/* } else if (_18 === 24) { */ case 4:
				str = v.ptr.$get();
				if (i < 0 || j < i || j > str.length) {
					$panic(new $String("reflect.Value.Slice: string slice index out of bounds"));
				}
				_r = ValueOf(new $String(str.substring(i, j))); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				/* */ $s = 8; case 8:
				return _r;
			/* } else { */ case 5:
				$panic(new ValueError.ptr("reflect.Value.Slice", kind));
			/* } */ case 6:
		case 1:
		if (i < 0 || j < i || j > cap) {
			$panic(new $String("reflect.Value.Slice: slice index out of bounds"));
		}
		_r$1 = makeValue(typ, $subslice(s, i, j), (v.flag & 96) >>> 0); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 10; case 10:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice }; } $f.$ptr = $ptr; $f._18 = _18; $f._r = _r; $f._r$1 = _r$1; $f.cap = cap; $f.i = i; $f.j = j; $f.kind = kind; $f.s = s; $f.str = str; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice = function(i, j) { return this.$val.Slice(i, j); };
	Value.ptr.prototype.Slice3 = function(i, j, k) {
		var $ptr, _19, _r, cap, i, j, k, kind, s, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _19 = $f._19; _r = $f._r; cap = $f.cap; i = $f.i; j = $f.j; k = $f.k; kind = $f.kind; s = $f.s; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		cap = 0;
		typ = $ifaceNil;
		s = null;
		kind = new flag(v.flag).kind();
		_19 = kind;
		if (_19 === 17) {
			if (((v.flag & 256) >>> 0) === 0) {
				$panic(new $String("reflect.Value.Slice: slice of unaddressable array"));
			}
			tt = v.typ.kindType;
			cap = (tt.len >> 0);
			typ = SliceOf(tt.elem);
			s = new (jsType(typ))(v.object());
		} else if (_19 === 23) {
			typ = v.typ;
			s = v.object();
			cap = $parseInt(s.$capacity) >> 0;
		} else {
			$panic(new ValueError.ptr("reflect.Value.Slice3", kind));
		}
		if (i < 0 || j < i || k < j || k > cap) {
			$panic(new $String("reflect.Value.Slice3: slice index out of bounds"));
		}
		_r = makeValue(typ, $subslice(s, i, j, k), (v.flag & 96) >>> 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Slice3 }; } $f.$ptr = $ptr; $f._19 = _19; $f._r = _r; $f.cap = cap; $f.i = i; $f.j = j; $f.k = k; $f.kind = kind; $f.s = s; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Slice3 = function(i, j, k) { return this.$val.Slice3(i, j, k); };
	Value.ptr.prototype.Close = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		$close(v.object());
	};
	Value.prototype.Close = function() { return this.$val.Close(); };
	chanrecv = function(t, ch, nb, val) {
		var $ptr, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, ch, comms, nb, received, recvRes, selectRes, selected, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; ch = $f.ch; comms = $f.comms; nb = $f.nb; received = $f.received; recvRes = $f.recvRes; selectRes = $f.selectRes; selected = $f.selected; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		received = false;
		comms = new sliceType$9([new sliceType$7([ch])]);
		if (nb) {
			comms = $append(comms, new sliceType$7([]));
		}
		_r = selectHelper(new sliceType$2([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			_tmp = false;
			_tmp$1 = false;
			selected = _tmp;
			received = _tmp$1;
			return [selected, received];
		}
		recvRes = selectRes[1];
		val.$set(recvRes[0]);
		_tmp$2 = true;
		_tmp$3 = !!(recvRes[1]);
		selected = _tmp$2;
		received = _tmp$3;
		return [selected, received];
		/* */ } return; } if ($f === undefined) { $f = { $blk: chanrecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.received = received; $f.recvRes = recvRes; $f.selectRes = selectRes; $f.selected = selected; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	chansend = function(t, ch, val, nb) {
		var $ptr, _r, ch, comms, nb, selectRes, t, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; ch = $f.ch; comms = $f.comms; nb = $f.nb; selectRes = $f.selectRes; t = $f.t; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		comms = new sliceType$9([new sliceType$7([ch, val.$get()])]);
		if (nb) {
			comms = $append(comms, new sliceType$7([]));
		}
		_r = selectHelper(new sliceType$2([comms])); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		selectRes = _r;
		if (nb && (($parseInt(selectRes[0]) >> 0) === 1)) {
			return false;
		}
		return true;
		/* */ } return; } if ($f === undefined) { $f = { $blk: chansend }; } $f.$ptr = $ptr; $f._r = _r; $f.ch = ch; $f.comms = comms; $f.nb = nb; $f.selectRes = selectRes; $f.t = t; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Kind.prototype.String = function() {
		var $ptr, k;
		k = this.$val;
		if ((k >> 0) < kindNames.$length) {
			return ((k < 0 || k >= kindNames.$length) ? $throwRuntimeError("index out of range") : kindNames.$array[kindNames.$offset + k]);
		}
		return "kind" + strconv.Itoa((k >> 0));
	};
	$ptrType(Kind).prototype.String = function() { return new Kind(this.$get()).String(); };
	uncommonType.ptr.prototype.uncommon = function() {
		var $ptr, t;
		t = this;
		return t;
	};
	uncommonType.prototype.uncommon = function() { return this.$val.uncommon(); };
	uncommonType.ptr.prototype.PkgPath = function() {
		var $ptr, t;
		t = this;
		if (t === ptrType$7.nil || t.pkgPath === ptrType$6.nil) {
			return "";
		}
		return t.pkgPath.$get();
	};
	uncommonType.prototype.PkgPath = function() { return this.$val.PkgPath(); };
	uncommonType.ptr.prototype.Name = function() {
		var $ptr, t;
		t = this;
		if (t === ptrType$7.nil || t.name === ptrType$6.nil) {
			return "";
		}
		return t.name.$get();
	};
	uncommonType.prototype.Name = function() { return this.$val.Name(); };
	rtype.ptr.prototype.String = function() {
		var $ptr, t;
		t = this;
		return t.string.$get();
	};
	rtype.prototype.String = function() { return this.$val.String(); };
	rtype.ptr.prototype.Size = function() {
		var $ptr, t;
		t = this;
		return t.size;
	};
	rtype.prototype.Size = function() { return this.$val.Size(); };
	rtype.ptr.prototype.Bits = function() {
		var $ptr, k, t;
		t = this;
		if (t === ptrType$1.nil) {
			$panic(new $String("reflect: Bits of nil Type"));
		}
		k = t.Kind();
		if (k < 2 || k > 16) {
			$panic(new $String("reflect: Bits of non-arithmetic Type " + t.String()));
		}
		return $imul((t.size >> 0), 8);
	};
	rtype.prototype.Bits = function() { return this.$val.Bits(); };
	rtype.ptr.prototype.Align = function() {
		var $ptr, t;
		t = this;
		return (t.align >> 0);
	};
	rtype.prototype.Align = function() { return this.$val.Align(); };
	rtype.ptr.prototype.FieldAlign = function() {
		var $ptr, t;
		t = this;
		return (t.fieldAlign >> 0);
	};
	rtype.prototype.FieldAlign = function() { return this.$val.FieldAlign(); };
	rtype.ptr.prototype.Kind = function() {
		var $ptr, t;
		t = this;
		return (((t.kind & 31) >>> 0) >>> 0);
	};
	rtype.prototype.Kind = function() { return this.$val.Kind(); };
	rtype.ptr.prototype.common = function() {
		var $ptr, t;
		t = this;
		return t;
	};
	rtype.prototype.common = function() { return this.$val.common(); };
	uncommonType.ptr.prototype.NumMethod = function() {
		var $ptr, t;
		t = this;
		if (t === ptrType$7.nil) {
			return 0;
		}
		return t.methods.$length;
	};
	uncommonType.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	uncommonType.ptr.prototype.MethodByName = function(name) {
		var $ptr, _i, _ref, _tmp, _tmp$1, i, m, name, ok, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t === ptrType$7.nil) {
			return [m, ok];
		}
		p = ptrType$10.nil;
		_ref = t.methods;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (!(p.name === ptrType$6.nil) && p.name.$get() === name) {
				_tmp = $clone(t.Method(i), Method);
				_tmp$1 = true;
				Method.copy(m, _tmp);
				ok = _tmp$1;
				return [m, ok];
			}
			_i++;
		}
		return [m, ok];
	};
	uncommonType.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	rtype.ptr.prototype.NumMethod = function() {
		var $ptr, t, tt;
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			return tt.NumMethod();
		}
		return t.uncommonType.NumMethod();
	};
	rtype.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	rtype.ptr.prototype.Method = function(i) {
		var $ptr, i, m, t, tt;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			Method.copy(m, tt.Method(i));
			return m;
		}
		Method.copy(m, t.uncommonType.Method(i));
		return m;
	};
	rtype.prototype.Method = function(i) { return this.$val.Method(i); };
	rtype.ptr.prototype.MethodByName = function(name) {
		var $ptr, _tuple, _tuple$1, m, name, ok, t, tt;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t.Kind() === 20) {
			tt = t.kindType;
			_tuple = tt.MethodByName(name);
			Method.copy(m, _tuple[0]);
			ok = _tuple[1];
			return [m, ok];
		}
		_tuple$1 = t.uncommonType.MethodByName(name);
		Method.copy(m, _tuple$1[0]);
		ok = _tuple$1[1];
		return [m, ok];
	};
	rtype.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	rtype.ptr.prototype.PkgPath = function() {
		var $ptr, t;
		t = this;
		return t.uncommonType.PkgPath();
	};
	rtype.prototype.PkgPath = function() { return this.$val.PkgPath(); };
	rtype.ptr.prototype.Name = function() {
		var $ptr, t;
		t = this;
		return t.uncommonType.Name();
	};
	rtype.prototype.Name = function() { return this.$val.Name(); };
	rtype.ptr.prototype.ChanDir = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 18))) {
			$panic(new $String("reflect: ChanDir of non-chan type"));
		}
		tt = t.kindType;
		return (tt.dir >> 0);
	};
	rtype.prototype.ChanDir = function() { return this.$val.ChanDir(); };
	rtype.ptr.prototype.IsVariadic = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: IsVariadic of non-func type"));
		}
		tt = t.kindType;
		return tt.dotdotdot;
	};
	rtype.prototype.IsVariadic = function() { return this.$val.IsVariadic(); };
	rtype.ptr.prototype.Elem = function() {
		var $ptr, _1, t, tt, tt$1, tt$2, tt$3, tt$4;
		t = this;
		_1 = t.Kind();
		if (_1 === 17) {
			tt = t.kindType;
			return toType(tt.elem);
		} else if (_1 === 18) {
			tt$1 = t.kindType;
			return toType(tt$1.elem);
		} else if (_1 === 21) {
			tt$2 = t.kindType;
			return toType(tt$2.elem);
		} else if (_1 === 22) {
			tt$3 = t.kindType;
			return toType(tt$3.elem);
		} else if (_1 === 23) {
			tt$4 = t.kindType;
			return toType(tt$4.elem);
		}
		$panic(new $String("reflect: Elem of invalid type"));
	};
	rtype.prototype.Elem = function() { return this.$val.Elem(); };
	rtype.ptr.prototype.Field = function(i) {
		var $ptr, _r, i, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: Field of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.Field(i); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Field = function(i) { return this.$val.Field(i); };
	rtype.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _r, index, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; index = $f.index; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByIndex of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByIndex(index); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.index = index; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	rtype.ptr.prototype.FieldByName = function(name) {
		var $ptr, _r, name, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; name = $f.name; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByName of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByName(name); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f.name = name; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByName = function(name) { return this.$val.FieldByName(name); };
	rtype.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, match, t, tt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; match = $f.match; t = $f.t; tt = $f.tt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: FieldByNameFunc of non-struct type"));
		}
		tt = t.kindType;
		_r = tt.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.match = match; $f.t = t; $f.tt = tt; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	rtype.ptr.prototype.In = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: In of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.in$2, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.In = function(i) { return this.$val.In(i); };
	rtype.ptr.prototype.Key = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 21))) {
			$panic(new $String("reflect: Key of non-map type"));
		}
		tt = t.kindType;
		return toType(tt.key);
	};
	rtype.prototype.Key = function() { return this.$val.Key(); };
	rtype.ptr.prototype.Len = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 17))) {
			$panic(new $String("reflect: Len of non-array type"));
		}
		tt = t.kindType;
		return (tt.len >> 0);
	};
	rtype.prototype.Len = function() { return this.$val.Len(); };
	rtype.ptr.prototype.NumField = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 25))) {
			$panic(new $String("reflect: NumField of non-struct type"));
		}
		tt = t.kindType;
		return tt.fields.$length;
	};
	rtype.prototype.NumField = function() { return this.$val.NumField(); };
	rtype.ptr.prototype.NumIn = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumIn of non-func type"));
		}
		tt = t.kindType;
		return tt.in$2.$length;
	};
	rtype.prototype.NumIn = function() { return this.$val.NumIn(); };
	rtype.ptr.prototype.NumOut = function() {
		var $ptr, t, tt;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: NumOut of non-func type"));
		}
		tt = t.kindType;
		return tt.out.$length;
	};
	rtype.prototype.NumOut = function() { return this.$val.NumOut(); };
	rtype.ptr.prototype.Out = function(i) {
		var $ptr, i, t, tt, x;
		t = this;
		if (!((t.Kind() === 19))) {
			$panic(new $String("reflect: Out of non-func type"));
		}
		tt = t.kindType;
		return toType((x = tt.out, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])));
	};
	rtype.prototype.Out = function(i) { return this.$val.Out(i); };
	ChanDir.prototype.String = function() {
		var $ptr, _2, d;
		d = this.$val;
		_2 = d;
		if (_2 === 2) {
			return "chan<-";
		} else if (_2 === 1) {
			return "<-chan";
		} else if (_2 === 3) {
			return "chan";
		}
		return "ChanDir" + strconv.Itoa((d >> 0));
	};
	$ptrType(ChanDir).prototype.String = function() { return new ChanDir(this.$get()).String(); };
	interfaceType.ptr.prototype.Method = function(i) {
		var $ptr, i, m, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		t = this;
		if (i < 0 || i >= t.methods.$length) {
			return m;
		}
		p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		m.Name = p.name.$get();
		if (!(p.pkgPath === ptrType$6.nil)) {
			m.PkgPath = p.pkgPath.$get();
		}
		m.Type = toType(p.typ);
		m.Index = i;
		return m;
	};
	interfaceType.prototype.Method = function(i) { return this.$val.Method(i); };
	interfaceType.ptr.prototype.NumMethod = function() {
		var $ptr, t;
		t = this;
		return t.methods.$length;
	};
	interfaceType.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	interfaceType.ptr.prototype.MethodByName = function(name) {
		var $ptr, _i, _ref, _tmp, _tmp$1, i, m, name, ok, p, t, x;
		m = new Method.ptr("", "", $ifaceNil, new Value.ptr(ptrType$1.nil, 0, 0), 0);
		ok = false;
		t = this;
		if (t === ptrType$11.nil) {
			return [m, ok];
		}
		p = ptrType$12.nil;
		_ref = t.methods;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			p = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			if (p.name.$get() === name) {
				_tmp = $clone(t.Method(i), Method);
				_tmp$1 = true;
				Method.copy(m, _tmp);
				ok = _tmp$1;
				return [m, ok];
			}
			_i++;
		}
		return [m, ok];
	};
	interfaceType.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	StructTag.prototype.Get = function(key) {
		var $ptr, _tuple, err, i, key, name, qvalue, tag, value;
		tag = this.$val;
		while (true) {
			if (!(!(tag === ""))) { break; }
			i = 0;
			while (true) {
				if (!(i < tag.length && (tag.charCodeAt(i) === 32))) { break; }
				i = i + (1) >> 0;
			}
			tag = tag.substring(i);
			if (tag === "") {
				break;
			}
			i = 0;
			while (true) {
				if (!(i < tag.length && tag.charCodeAt(i) > 32 && !((tag.charCodeAt(i) === 58)) && !((tag.charCodeAt(i) === 34)) && !((tag.charCodeAt(i) === 127)))) { break; }
				i = i + (1) >> 0;
			}
			if ((i === 0) || (i + 1 >> 0) >= tag.length || !((tag.charCodeAt(i) === 58)) || !((tag.charCodeAt((i + 1 >> 0)) === 34))) {
				break;
			}
			name = tag.substring(0, i);
			tag = tag.substring((i + 1 >> 0));
			i = 1;
			while (true) {
				if (!(i < tag.length && !((tag.charCodeAt(i) === 34)))) { break; }
				if (tag.charCodeAt(i) === 92) {
					i = i + (1) >> 0;
				}
				i = i + (1) >> 0;
			}
			if (i >= tag.length) {
				break;
			}
			qvalue = tag.substring(0, (i + 1 >> 0));
			tag = tag.substring((i + 1 >> 0));
			if (key === name) {
				_tuple = strconv.Unquote(qvalue);
				value = _tuple[0];
				err = _tuple[1];
				if (!($interfaceIsEqual(err, $ifaceNil))) {
					break;
				}
				return value;
			}
		}
		return "";
	};
	$ptrType(StructTag).prototype.Get = function(key) { return new StructTag(this.$get()).Get(key); };
	structType.ptr.prototype.Field = function(i) {
		var $ptr, _r, _r$1, _r$2, f, i, p, t, t$1, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; f = $f.f; i = $f.i; p = $f.p; t = $f.t; t$1 = $f.t$1; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		t = this;
		if (i < 0 || i >= t.fields.$length) {
			return f;
		}
		p = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
		f.Type = toType(p.typ);
		/* */ if (!(p.name === ptrType$6.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(p.name === ptrType$6.nil)) { */ case 1:
			f.Name = p.name.$get();
			$s = 3; continue;
		/* } else { */ case 2:
			t$1 = f.Type;
			_r = t$1.Kind(); /* */ $s = 6; case 6: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === 22) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (_r === 22) { */ case 4:
				_r$1 = t$1.Elem(); /* */ $s = 7; case 7: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				t$1 = _r$1;
			/* } */ case 5:
			_r$2 = t$1.Name(); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			f.Name = _r$2;
			f.Anonymous = true;
		/* } */ case 3:
		if (!(p.pkgPath === ptrType$6.nil)) {
			f.PkgPath = p.pkgPath.$get();
		}
		if (!(p.tag === ptrType$6.nil)) {
			f.Tag = p.tag.$get();
		}
		f.Offset = p.offset;
		f.Index = new sliceType$11([i]);
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.Field }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.f = f; $f.i = i; $f.p = p; $f.t = t; $f.t$1 = t$1; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.Field = function(i) { return this.$val.Field(i); };
	structType.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _r$4, _ref, _v, f, ft, i, index, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _ref = $f._ref; _v = $f._v; f = $f.f; ft = $f.ft; i = $f.i; index = $f.index; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		t = this;
		f.Type = toType(t.rtype);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 2; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (i > 0) { */ case 3:
				ft = f.Type;
				_r = ft.Kind(); /* */ $s = 8; case 8: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				if (!(_r === 22)) { _v = false; $s = 7; continue s; }
				_r$1 = ft.Elem(); /* */ $s = 9; case 9: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_r$2 = _r$1.Kind(); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v = _r$2 === 25; case 7:
				/* */ if (_v) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (_v) { */ case 5:
					_r$3 = ft.Elem(); /* */ $s = 11; case 11: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					ft = _r$3;
				/* } */ case 6:
				f.Type = ft;
			/* } */ case 4:
			_r$4 = f.Type.Field(x); /* */ $s = 12; case 12: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			StructField.copy(f, _r$4);
			_i++;
		/* } */ $s = 1; continue; case 2:
		return f;
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._ref = _ref; $f._v = _v; $f.f = f; $f.ft = ft; $f.i = i; $f.index = index; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	structType.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _entry, _entry$1, _entry$2, _entry$3, _i, _i$1, _key, _key$1, _key$2, _key$3, _r, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, count, current, f, fname, i, index, match, next, nextCount, ntyp, ok, result, scan, styp, t, t$1, visited, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _entry$2 = $f._entry$2; _entry$3 = $f._entry$3; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _key$1 = $f._key$1; _key$2 = $f._key$2; _key$3 = $f._key$3; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; count = $f.count; current = $f.current; f = $f.f; fname = $f.fname; i = $f.i; index = $f.index; match = $f.match; next = $f.next; nextCount = $f.nextCount; ntyp = $f.ntyp; ok = $f.ok; result = $f.result; scan = $f.scan; styp = $f.styp; t = $f.t; t$1 = $f.t$1; visited = $f.visited; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		result = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		ok = false;
		t = this;
		current = new sliceType$12([]);
		next = new sliceType$12([new fieldScan.ptr(t, sliceType$11.nil)]);
		nextCount = false;
		visited = $makeMap(ptrType$13.keyFor, []);
		/* while (true) { */ case 1:
			/* if (!(next.$length > 0)) { break; } */ if(!(next.$length > 0)) { $s = 2; continue; }
			_tmp = next;
			_tmp$1 = $subslice(current, 0, 0);
			current = _tmp;
			next = _tmp$1;
			count = nextCount;
			nextCount = false;
			_ref = current;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				scan = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), fieldScan);
				t$1 = scan.typ;
				/* */ if ((_entry = visited[ptrType$13.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if ((_entry = visited[ptrType$13.keyFor(t$1)], _entry !== undefined ? _entry.v : false)) { */ case 5:
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				_key = t$1; (visited || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key)] = { k: _key, v: true };
				_ref$1 = t$1.fields;
				_i$1 = 0;
				/* while (true) { */ case 7:
					/* if (!(_i$1 < _ref$1.$length)) { break; } */ if(!(_i$1 < _ref$1.$length)) { $s = 8; continue; }
					i = _i$1;
					f = (x = t$1.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
					fname = "";
					ntyp = ptrType$1.nil;
					/* */ if (!(f.name === ptrType$6.nil)) { $s = 9; continue; }
					/* */ $s = 10; continue;
					/* if (!(f.name === ptrType$6.nil)) { */ case 9:
						fname = f.name.$get();
						$s = 11; continue;
					/* } else { */ case 10:
						ntyp = f.typ;
						/* */ if (ntyp.Kind() === 22) { $s = 12; continue; }
						/* */ $s = 13; continue;
						/* if (ntyp.Kind() === 22) { */ case 12:
							_r = ntyp.Elem().common(); /* */ $s = 14; case 14: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
							ntyp = _r;
						/* } */ case 13:
						fname = ntyp.Name();
					/* } */ case 11:
					_r$1 = match(fname); /* */ $s = 17; case 17: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
					/* */ if (_r$1) { $s = 15; continue; }
					/* */ $s = 16; continue;
					/* if (_r$1) { */ case 15:
						if ((_entry$1 = count[ptrType$13.keyFor(t$1)], _entry$1 !== undefined ? _entry$1.v : 0) > 1 || ok) {
							_tmp$2 = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
							_tmp$3 = false;
							StructField.copy(result, _tmp$2);
							ok = _tmp$3;
							return [result, ok];
						}
						_r$2 = t$1.Field(i); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
						StructField.copy(result, _r$2);
						result.Index = sliceType$11.nil;
						result.Index = $appendSlice(result.Index, scan.index);
						result.Index = $append(result.Index, i);
						ok = true;
						_i$1++;
						/* continue; */ $s = 7; continue;
					/* } */ case 16:
					if (ok || ntyp === ptrType$1.nil || !((ntyp.Kind() === 25))) {
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					styp = ntyp.kindType;
					if ((_entry$2 = nextCount[ptrType$13.keyFor(styp)], _entry$2 !== undefined ? _entry$2.v : 0) > 0) {
						_key$1 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key$1)] = { k: _key$1, v: 2 };
						_i$1++;
						/* continue; */ $s = 7; continue;
					}
					if (nextCount === false) {
						nextCount = $makeMap(ptrType$13.keyFor, []);
					}
					_key$2 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key$2)] = { k: _key$2, v: 1 };
					if ((_entry$3 = count[ptrType$13.keyFor(t$1)], _entry$3 !== undefined ? _entry$3.v : 0) > 1) {
						_key$3 = styp; (nextCount || $throwRuntimeError("assignment to entry in nil map"))[ptrType$13.keyFor(_key$3)] = { k: _key$3, v: 2 };
					}
					index = sliceType$11.nil;
					index = $appendSlice(index, scan.index);
					index = $append(index, i);
					next = $append(next, new fieldScan.ptr(styp, index));
					_i$1++;
				/* } */ $s = 7; continue; case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
			if (ok) {
				/* break; */ $s = 2; continue;
			}
		/* } */ $s = 1; continue; case 2:
		return [result, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._entry$2 = _entry$2; $f._entry$3 = _entry$3; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._key$1 = _key$1; $f._key$2 = _key$2; $f._key$3 = _key$3; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f.count = count; $f.current = current; $f.f = f; $f.fname = fname; $f.i = i; $f.index = index; $f.match = match; $f.next = next; $f.nextCount = nextCount; $f.ntyp = ntyp; $f.ok = ok; $f.result = result; $f.scan = scan; $f.styp = styp; $f.t = t; $f.t$1 = t$1; $f.visited = visited; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	structType.ptr.prototype.FieldByName = function(name) {
		var $ptr, _i, _r, _r$1, _ref, _tmp, _tmp$1, _tuple, f, hasAnon, i, name, present, t, tf, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _ref = $f._ref; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tuple = $f._tuple; f = $f.f; hasAnon = $f.hasAnon; i = $f.i; name = $f.name; present = $f.present; t = $f.t; tf = $f.tf; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = [name];
		f = new StructField.ptr("", "", $ifaceNil, "", 0, sliceType$11.nil, false);
		present = false;
		t = this;
		hasAnon = false;
		/* */ if (!(name[0] === "")) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(name[0] === "")) { */ case 1:
			_ref = t.fields;
			_i = 0;
			/* while (true) { */ case 3:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 4; continue; }
				i = _i;
				tf = (x = t.fields, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				/* */ if (tf.name === ptrType$6.nil) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (tf.name === ptrType$6.nil) { */ case 5:
					hasAnon = true;
					_i++;
					/* continue; */ $s = 3; continue;
				/* } */ case 6:
				/* */ if (tf.name.$get() === name[0]) { $s = 7; continue; }
				/* */ $s = 8; continue;
				/* if (tf.name.$get() === name[0]) { */ case 7:
					_r = t.Field(i); /* */ $s = 9; case 9: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
					_tmp = $clone(_r, StructField);
					_tmp$1 = true;
					StructField.copy(f, _tmp);
					present = _tmp$1;
					/* */ $s = 10; case 10:
					return [f, present];
				/* } */ case 8:
				_i++;
			/* } */ $s = 3; continue; case 4:
		/* } */ case 2:
		if (!hasAnon) {
			return [f, present];
		}
		_r$1 = t.FieldByNameFunc((function(name) { return function(s) {
			var $ptr, s;
			return s === name[0];
		}; })(name)); /* */ $s = 11; case 11: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		StructField.copy(f, _tuple[0]);
		present = _tuple[1];
		/* */ $s = 12; case 12:
		return [f, present];
		/* */ } return; } if ($f === undefined) { $f = { $blk: structType.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._ref = _ref; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tuple = _tuple; $f.f = f; $f.hasAnon = hasAnon; $f.i = i; $f.name = name; $f.present = present; $f.t = t; $f.tf = tf; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	structType.prototype.FieldByName = function(name) { return this.$val.FieldByName(name); };
	PtrTo = function(t) {
		var $ptr, t;
		return $assertType(t, ptrType$1).ptrTo();
	};
	$pkg.PtrTo = PtrTo;
	rtype.ptr.prototype.Implements = function(u) {
		var $ptr, _r, t, u, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.Implements"));
		}
		_r = u.Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 20))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 20))) { */ case 1:
			$panic(new $String("reflect: non-interface type passed to Type.Implements"));
		/* } */ case 2:
		return implements$1($assertType(u, ptrType$1), t);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.Implements }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.Implements = function(u) { return this.$val.Implements(u); };
	rtype.ptr.prototype.AssignableTo = function(u) {
		var $ptr, t, u, uu;
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.AssignableTo"));
		}
		uu = $assertType(u, ptrType$1);
		return directlyAssignable(uu, t) || implements$1(uu, t);
	};
	rtype.prototype.AssignableTo = function(u) { return this.$val.AssignableTo(u); };
	rtype.ptr.prototype.ConvertibleTo = function(u) {
		var $ptr, _r, t, u, uu, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; u = $f.u; uu = $f.uu; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		if ($interfaceIsEqual(u, $ifaceNil)) {
			$panic(new $String("reflect: nil type passed to Type.ConvertibleTo"));
		}
		uu = $assertType(u, ptrType$1);
		_r = convertOp(uu, t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return !(_r === $throwNilPointerError);
		/* */ } return; } if ($f === undefined) { $f = { $blk: rtype.ptr.prototype.ConvertibleTo }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.u = u; $f.uu = uu; $f.$s = $s; $f.$r = $r; return $f;
	};
	rtype.prototype.ConvertibleTo = function(u) { return this.$val.ConvertibleTo(u); };
	implements$1 = function(T, V) {
		var $ptr, T, V, i, i$1, j, j$1, t, tm, tm$1, v, v$1, vm, vm$1, x, x$1, x$2, x$3;
		if (!((T.Kind() === 20))) {
			return false;
		}
		t = T.kindType;
		if (t.methods.$length === 0) {
			return true;
		}
		if (V.Kind() === 20) {
			v = V.kindType;
			i = 0;
			j = 0;
			while (true) {
				if (!(j < v.methods.$length)) { break; }
				tm = (x = t.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
				vm = (x$1 = v.methods, ((j < 0 || j >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + j]));
				if (vm.name.$get() === tm.name.$get() && vm.pkgPath === tm.pkgPath && vm.typ === tm.typ) {
					i = i + (1) >> 0;
					if (i >= t.methods.$length) {
						return true;
					}
				}
				j = j + (1) >> 0;
			}
			return false;
		}
		v$1 = V.uncommonType.uncommon();
		if (v$1 === ptrType$7.nil) {
			return false;
		}
		i$1 = 0;
		j$1 = 0;
		while (true) {
			if (!(j$1 < v$1.methods.$length)) { break; }
			tm$1 = (x$2 = t.methods, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			vm$1 = (x$3 = v$1.methods, ((j$1 < 0 || j$1 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + j$1]));
			if (vm$1.name.$get() === tm$1.name.$get() && vm$1.pkgPath === tm$1.pkgPath && vm$1.mtyp === tm$1.typ) {
				i$1 = i$1 + (1) >> 0;
				if (i$1 >= t.methods.$length) {
					return true;
				}
			}
			j$1 = j$1 + (1) >> 0;
		}
		return false;
	};
	directlyAssignable = function(T, V) {
		var $ptr, T, V;
		if (T === V) {
			return true;
		}
		if (!(T.Name() === "") && !(V.Name() === "") || !((T.Kind() === V.Kind()))) {
			return false;
		}
		return haveIdenticalUnderlyingType(T, V);
	};
	haveIdenticalUnderlyingType = function(T, V) {
		var $ptr, T, V, _3, _i, _i$1, _i$2, _ref, _ref$1, _ref$2, i, i$1, i$2, kind, t, t$1, t$2, tf, typ, typ$1, v, v$1, v$2, vf, x, x$1, x$2, x$3;
		if (T === V) {
			return true;
		}
		kind = T.Kind();
		if (!((kind === V.Kind()))) {
			return false;
		}
		if (1 <= kind && kind <= 16 || (kind === 24) || (kind === 26)) {
			return true;
		}
		_3 = kind;
		if (_3 === 17) {
			return $interfaceIsEqual(T.Elem(), V.Elem()) && (T.Len() === V.Len());
		} else if (_3 === 18) {
			if ((V.ChanDir() === 3) && $interfaceIsEqual(T.Elem(), V.Elem())) {
				return true;
			}
			return (V.ChanDir() === T.ChanDir()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_3 === 19) {
			t = T.kindType;
			v = V.kindType;
			if (!(t.dotdotdot === v.dotdotdot) || !((t.in$2.$length === v.in$2.$length)) || !((t.out.$length === v.out.$length))) {
				return false;
			}
			_ref = t.in$2;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				i = _i;
				typ = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
				if (!(typ === (x = v.in$2, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i])))) {
					return false;
				}
				_i++;
			}
			_ref$1 = t.out;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				i$1 = _i$1;
				typ$1 = ((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]);
				if (!(typ$1 === (x$1 = v.out, ((i$1 < 0 || i$1 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i$1])))) {
					return false;
				}
				_i$1++;
			}
			return true;
		} else if (_3 === 20) {
			t$1 = T.kindType;
			v$1 = V.kindType;
			if ((t$1.methods.$length === 0) && (v$1.methods.$length === 0)) {
				return true;
			}
			return false;
		} else if (_3 === 21) {
			return $interfaceIsEqual(T.Key(), V.Key()) && $interfaceIsEqual(T.Elem(), V.Elem());
		} else if ((_3 === 22) || (_3 === 23)) {
			return $interfaceIsEqual(T.Elem(), V.Elem());
		} else if (_3 === 25) {
			t$2 = T.kindType;
			v$2 = V.kindType;
			if (!((t$2.fields.$length === v$2.fields.$length))) {
				return false;
			}
			_ref$2 = t$2.fields;
			_i$2 = 0;
			while (true) {
				if (!(_i$2 < _ref$2.$length)) { break; }
				i$2 = _i$2;
				tf = (x$2 = t$2.fields, ((i$2 < 0 || i$2 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$2]));
				vf = (x$3 = v$2.fields, ((i$2 < 0 || i$2 >= x$3.$length) ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + i$2]));
				if (!(tf.name === vf.name) && (tf.name === ptrType$6.nil || vf.name === ptrType$6.nil || !(tf.name.$get() === vf.name.$get()))) {
					return false;
				}
				if (!(tf.pkgPath === vf.pkgPath) && (tf.pkgPath === ptrType$6.nil || vf.pkgPath === ptrType$6.nil || !(tf.pkgPath.$get() === vf.pkgPath.$get()))) {
					return false;
				}
				if (!(tf.typ === vf.typ)) {
					return false;
				}
				if (!(tf.tag === vf.tag) && (tf.tag === ptrType$6.nil || vf.tag === ptrType$6.nil || !(tf.tag.$get() === vf.tag.$get()))) {
					return false;
				}
				if (!((tf.offset === vf.offset))) {
					return false;
				}
				_i$2++;
			}
			return true;
		}
		return false;
	};
	toType = function(t) {
		var $ptr, t;
		if (t === ptrType$1.nil) {
			return $ifaceNil;
		}
		return t;
	};
	ifaceIndir = function(t) {
		var $ptr, t;
		return ((t.kind & 32) >>> 0) === 0;
	};
	flag.prototype.kind = function() {
		var $ptr, f;
		f = this.$val;
		return (((f & 31) >>> 0) >>> 0);
	};
	$ptrType(flag).prototype.kind = function() { return new flag(this.$get()).kind(); };
	Value.ptr.prototype.pointer = function() {
		var $ptr, v;
		v = this;
		if (!((v.typ.size === 4)) || !v.typ.pointers()) {
			$panic(new $String("can't call pointer on a non-pointer Value"));
		}
		if (!((((v.flag & 128) >>> 0) === 0))) {
			return v.ptr.$get();
		}
		return v.ptr;
	};
	Value.prototype.pointer = function() { return this.$val.pointer(); };
	ValueError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Kind === 0) {
			return "reflect: call of " + e.Method + " on zero Value";
		}
		return "reflect: call of " + e.Method + " on " + new Kind(e.Kind).String() + " Value";
	};
	ValueError.prototype.Error = function() { return this.$val.Error(); };
	flag.prototype.mustBe = function(expected) {
		var $ptr, expected, f;
		f = this.$val;
		if (!((new flag(f).kind() === expected))) {
			$panic(new ValueError.ptr(methodName(), new flag(f).kind()));
		}
	};
	$ptrType(flag).prototype.mustBe = function(expected) { return new flag(this.$get()).mustBe(expected); };
	flag.prototype.mustBeExported = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
	};
	$ptrType(flag).prototype.mustBeExported = function() { return new flag(this.$get()).mustBeExported(); };
	flag.prototype.mustBeAssignable = function() {
		var $ptr, f;
		f = this.$val;
		if (f === 0) {
			$panic(new ValueError.ptr(methodName(), 0));
		}
		if (!((((f & 96) >>> 0) === 0))) {
			$panic(new $String("reflect: " + methodName() + " using value obtained using unexported field"));
		}
		if (((f & 256) >>> 0) === 0) {
			$panic(new $String("reflect: " + methodName() + " using unaddressable value"));
		}
	};
	$ptrType(flag).prototype.mustBeAssignable = function() { return new flag(this.$get()).mustBeAssignable(); };
	Value.ptr.prototype.Addr = function() {
		var $ptr, v;
		v = this;
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.Addr of unaddressable value"));
		}
		return new Value.ptr(v.typ.ptrTo(), v.ptr, ((((v.flag & 96) >>> 0)) | 22) >>> 0);
	};
	Value.prototype.Addr = function() { return this.$val.Addr(); };
	Value.ptr.prototype.Bool = function() {
		var $ptr, v;
		v = this;
		new flag(v.flag).mustBe(1);
		return v.ptr.$get();
	};
	Value.prototype.Bool = function() { return this.$val.Bool(); };
	Value.ptr.prototype.Bytes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 8))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 8))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-byte slice"));
		/* } */ case 2:
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Bytes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Bytes = function() { return this.$val.Bytes(); };
	Value.ptr.prototype.runes = function() {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.Bytes of non-rune slice"));
		/* } */ case 2:
		return v.ptr.$get();
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.runes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.runes = function() { return this.$val.runes(); };
	Value.ptr.prototype.CanAddr = function() {
		var $ptr, v;
		v = this;
		return !((((v.flag & 256) >>> 0) === 0));
	};
	Value.prototype.CanAddr = function() { return this.$val.CanAddr(); };
	Value.ptr.prototype.CanSet = function() {
		var $ptr, v;
		v = this;
		return ((v.flag & 352) >>> 0) === 256;
	};
	Value.prototype.CanSet = function() { return this.$val.CanSet(); };
	Value.ptr.prototype.Call = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("Call", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Call }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Call = function(in$1) { return this.$val.Call(in$1); };
	Value.ptr.prototype.CallSlice = function(in$1) {
		var $ptr, _r, in$1, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; in$1 = $f.in$1; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(19);
		new flag(v.flag).mustBeExported();
		_r = v.call("CallSlice", in$1); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.CallSlice }; } $f.$ptr = $ptr; $f._r = _r; $f.in$1 = in$1; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.CallSlice = function(in$1) { return this.$val.CallSlice(in$1); };
	Value.ptr.prototype.Complex = function() {
		var $ptr, _2, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_2 = k;
		if (_2 === 15) {
			return (x = v.ptr.$get(), new $Complex128(x.$real, x.$imag));
		} else if (_2 === 16) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Complex", new flag(v.flag).kind()));
	};
	Value.prototype.Complex = function() { return this.$val.Complex(); };
	Value.ptr.prototype.FieldByIndex = function(index) {
		var $ptr, _i, _r, _r$1, _r$2, _r$3, _ref, _v, i, index, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _ref = $f._ref; _v = $f._v; i = $f.i; index = $f.index; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (index.$length === 1) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (index.$length === 1) { */ case 1:
			_r = v.Field((0 >= index.$length ? $throwRuntimeError("index out of range") : index.$array[index.$offset + 0])); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ $s = 4; case 4:
			return _r;
		/* } */ case 2:
		new flag(v.flag).mustBe(25);
		_ref = index;
		_i = 0;
		/* while (true) { */ case 5:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 6; continue; }
			i = _i;
			x = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			/* */ if (i > 0) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (i > 0) { */ case 7:
				if (!(v.Kind() === 22)) { _v = false; $s = 11; continue s; }
				_r$1 = v.typ.Elem().Kind(); /* */ $s = 12; case 12: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				_v = _r$1 === 25; case 11:
				/* */ if (_v) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_v) { */ case 9:
					if (v.IsNil()) {
						$panic(new $String("reflect: indirection through nil pointer to embedded struct"));
					}
					_r$2 = v.Elem(); /* */ $s = 13; case 13: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					v = _r$2;
				/* } */ case 10:
			/* } */ case 8:
			_r$3 = v.Field(x); /* */ $s = 14; case 14: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			v = _r$3;
			_i++;
		/* } */ $s = 5; continue; case 6:
		return v;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByIndex }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._ref = _ref; $f._v = _v; $f.i = i; $f.index = index; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByIndex = function(index) { return this.$val.FieldByIndex(index); };
	Value.ptr.prototype.FieldByName = function(name) {
		var $ptr, _r, _r$1, _tuple, f, name, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; name = $f.name; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(25);
		_r = v.typ.FieldByName(name); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ $s = 5; case 5:
			return _r$1;
		/* } */ case 3:
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByName }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.name = name; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByName = function(name) { return this.$val.FieldByName(name); };
	Value.ptr.prototype.FieldByNameFunc = function(match) {
		var $ptr, _r, _r$1, _tuple, f, match, ok, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; f = $f.f; match = $f.match; ok = $f.ok; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		_r = v.typ.FieldByNameFunc(match); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		f = $clone(_tuple[0], StructField);
		ok = _tuple[1];
		/* */ if (ok) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (ok) { */ case 2:
			_r$1 = v.FieldByIndex(f.Index); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ $s = 5; case 5:
			return _r$1;
		/* } */ case 3:
		return new Value.ptr(ptrType$1.nil, 0, 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.FieldByNameFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.f = f; $f.match = match; $f.ok = ok; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.FieldByNameFunc = function(match) { return this.$val.FieldByNameFunc(match); };
	Value.ptr.prototype.Float = function() {
		var $ptr, _4, k, v;
		v = this;
		k = new flag(v.flag).kind();
		_4 = k;
		if (_4 === 13) {
			return v.ptr.$get();
		} else if (_4 === 14) {
			return v.ptr.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Float", new flag(v.flag).kind()));
	};
	Value.prototype.Float = function() { return this.$val.Float(); };
	Value.ptr.prototype.Int = function() {
		var $ptr, _6, k, p, v;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_6 = k;
		if (_6 === 2) {
			return new $Int64(0, p.$get());
		} else if (_6 === 3) {
			return new $Int64(0, p.$get());
		} else if (_6 === 4) {
			return new $Int64(0, p.$get());
		} else if (_6 === 5) {
			return new $Int64(0, p.$get());
		} else if (_6 === 6) {
			return p.$get();
		}
		$panic(new ValueError.ptr("reflect.Value.Int", new flag(v.flag).kind()));
	};
	Value.prototype.Int = function() { return this.$val.Int(); };
	Value.ptr.prototype.CanInterface = function() {
		var $ptr, v;
		v = this;
		if (v.flag === 0) {
			$panic(new ValueError.ptr("reflect.Value.CanInterface", 0));
		}
		return ((v.flag & 96) >>> 0) === 0;
	};
	Value.prototype.CanInterface = function() { return this.$val.CanInterface(); };
	Value.ptr.prototype.Interface = function() {
		var $ptr, _r, i, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; i = $f.i; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = $ifaceNil;
		v = this;
		_r = valueInterface(v, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		/* */ $s = 2; case 2:
		return i;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Interface }; } $f.$ptr = $ptr; $f._r = _r; $f.i = i; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Interface = function() { return this.$val.Interface(); };
	Value.ptr.prototype.IsValid = function() {
		var $ptr, v;
		v = this;
		return !((v.flag === 0));
	};
	Value.prototype.IsValid = function() { return this.$val.IsValid(); };
	Value.ptr.prototype.Kind = function() {
		var $ptr, v;
		v = this;
		return new flag(v.flag).kind();
	};
	Value.prototype.Kind = function() { return this.$val.Kind(); };
	Value.ptr.prototype.MapIndex = function(key) {
		var $ptr, _r, c, e, fl, k, key, tt, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; c = $f.c; e = $f.e; fl = $f.fl; k = $f.k; key = $f.key; tt = $f.tt; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.MapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		e = mapaccess(v.typ, v.pointer(), k);
		if (e === 0) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		typ = tt.elem;
		fl = ((((v.flag | key.flag) >>> 0)) & 96) >>> 0;
		fl = (fl | ((typ.Kind() >>> 0))) >>> 0;
		if (ifaceIndir(typ)) {
			c = unsafe_New(typ);
			typedmemmove(typ, c, e);
			return new Value.ptr(typ, c, (fl | 128) >>> 0);
		} else {
			return new Value.ptr(typ, e.$get(), fl);
		}
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f.c = c; $f.e = e; $f.fl = fl; $f.k = k; $f.key = key; $f.tt = tt; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapIndex = function(key) { return this.$val.MapIndex(key); };
	Value.ptr.prototype.MapKeys = function() {
		var $ptr, _r, a, c, fl, i, it, key, keyType, m, mlen, tt, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; a = $f.a; c = $f.c; fl = $f.fl; i = $f.i; it = $f.it; key = $f.key; keyType = $f.keyType; m = $f.m; mlen = $f.mlen; tt = $f.tt; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBe(21);
		tt = v.typ.kindType;
		keyType = tt.key;
		fl = (((v.flag & 96) >>> 0) | (keyType.Kind() >>> 0)) >>> 0;
		m = v.pointer();
		mlen = 0;
		if (!(m === 0)) {
			mlen = maplen(m);
		}
		it = mapiterinit(v.typ, m);
		a = $makeSlice(sliceType$8, mlen);
		i = 0;
		i = 0;
		/* while (true) { */ case 1:
			/* if (!(i < a.$length)) { break; } */ if(!(i < a.$length)) { $s = 2; continue; }
			_r = mapiterkey(it); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			key = _r;
			if (key === 0) {
				/* break; */ $s = 2; continue;
			}
			if (ifaceIndir(keyType)) {
				c = unsafe_New(keyType);
				typedmemmove(keyType, c, key);
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, c, (fl | 128) >>> 0));
			} else {
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = new Value.ptr(keyType, key.$get(), fl));
			}
			mapiternext(it);
			i = i + (1) >> 0;
		/* } */ $s = 1; continue; case 2:
		return $subslice(a, 0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.MapKeys }; } $f.$ptr = $ptr; $f._r = _r; $f.a = a; $f.c = c; $f.fl = fl; $f.i = i; $f.it = it; $f.key = key; $f.keyType = keyType; $f.m = m; $f.mlen = mlen; $f.tt = tt; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.MapKeys = function() { return this.$val.MapKeys(); };
	Value.ptr.prototype.Method = function(i) {
		var $ptr, fl, i, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.Method", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0)) || (i >>> 0) >= (v.typ.NumMethod() >>> 0)) {
			$panic(new $String("reflect: Method index out of range"));
		}
		if ((v.typ.Kind() === 20) && v.IsNil()) {
			$panic(new $String("reflect: Method on nil interface value"));
		}
		fl = (v.flag & 160) >>> 0;
		fl = (fl | (19)) >>> 0;
		fl = (fl | (((((i >>> 0) << 10 >>> 0) | 512) >>> 0))) >>> 0;
		return new Value.ptr(v.typ, v.ptr, fl);
	};
	Value.prototype.Method = function(i) { return this.$val.Method(i); };
	Value.ptr.prototype.NumMethod = function() {
		var $ptr, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.NumMethod", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			return 0;
		}
		return v.typ.NumMethod();
	};
	Value.prototype.NumMethod = function() { return this.$val.NumMethod(); };
	Value.ptr.prototype.MethodByName = function(name) {
		var $ptr, _tuple, m, name, ok, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.MethodByName", 0));
		}
		if (!((((v.flag & 512) >>> 0) === 0))) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		_tuple = v.typ.MethodByName(name);
		m = $clone(_tuple[0], Method);
		ok = _tuple[1];
		if (!ok) {
			return new Value.ptr(ptrType$1.nil, 0, 0);
		}
		return v.Method(m.Index);
	};
	Value.prototype.MethodByName = function(name) { return this.$val.MethodByName(name); };
	Value.ptr.prototype.NumField = function() {
		var $ptr, tt, v;
		v = this;
		new flag(v.flag).mustBe(25);
		tt = v.typ.kindType;
		return tt.fields.$length;
	};
	Value.prototype.NumField = function() { return this.$val.NumField(); };
	Value.ptr.prototype.OverflowComplex = function(x) {
		var $ptr, _9, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_9 = k;
		if (_9 === 15) {
			return overflowFloat32(x.$real) || overflowFloat32(x.$imag);
		} else if (_9 === 16) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowComplex", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowComplex = function(x) { return this.$val.OverflowComplex(x); };
	Value.ptr.prototype.OverflowFloat = function(x) {
		var $ptr, _10, k, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_10 = k;
		if (_10 === 13) {
			return overflowFloat32(x);
		} else if (_10 === 14) {
			return false;
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowFloat", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowFloat = function(x) { return this.$val.OverflowFloat(x); };
	overflowFloat32 = function(x) {
		var $ptr, x;
		if (x < 0) {
			x = -x;
		}
		return 3.4028234663852886e+38 < x && x <= 1.7976931348623157e+308;
	};
	Value.ptr.prototype.OverflowInt = function(x) {
		var $ptr, _11, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_11 = k;
		if ((_11 === 2) || (_11 === 3) || (_11 === 4) || (_11 === 5) || (_11 === 6)) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightInt64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowInt", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowInt = function(x) { return this.$val.OverflowInt(x); };
	Value.ptr.prototype.OverflowUint = function(x) {
		var $ptr, _12, bitSize, k, trunc, v, x;
		v = this;
		k = new flag(v.flag).kind();
		_12 = k;
		if ((_12 === 7) || (_12 === 12) || (_12 === 8) || (_12 === 9) || (_12 === 10) || (_12 === 11)) {
			bitSize = $imul(v.typ.size, 8) >>> 0;
			trunc = $shiftRightUint64(($shiftLeft64(x, ((64 - bitSize >>> 0)))), ((64 - bitSize >>> 0)));
			return !((x.$high === trunc.$high && x.$low === trunc.$low));
		}
		$panic(new ValueError.ptr("reflect.Value.OverflowUint", new flag(v.flag).kind()));
	};
	Value.prototype.OverflowUint = function(x) { return this.$val.OverflowUint(x); };
	Value.ptr.prototype.Recv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		/* */ $s = 2; case 2:
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Recv = function() { return this.$val.Recv(); };
	Value.ptr.prototype.recv = function(nb) {
		var $ptr, _r, _tuple, nb, ok, p, selected, t, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; nb = $f.nb; ok = $f.ok; p = $f.p; selected = $f.selected; t = $f.t; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 1) === 0) {
			$panic(new $String("reflect: recv on send-only channel"));
		}
		t = tt.elem;
		val = new Value.ptr(t, 0, (t.Kind() >>> 0));
		p = 0;
		if (ifaceIndir(t)) {
			p = unsafe_New(t);
			val.ptr = p;
			val.flag = (val.flag | (128)) >>> 0;
		} else {
			p = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		_r = chanrecv(v.typ, v.pointer(), nb, p); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		selected = _tuple[0];
		ok = _tuple[1];
		if (!selected) {
			val = new Value.ptr(ptrType$1.nil, 0, 0);
		}
		return [val, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.recv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.nb = nb; $f.ok = ok; $f.p = p; $f.selected = selected; $f.t = t; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.recv = function(nb) { return this.$val.recv(nb); };
	Value.ptr.prototype.Send = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r;
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Send }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Send = function(x) { return this.$val.Send(x); };
	Value.ptr.prototype.send = function(x, nb) {
		var $ptr, _r, _r$1, nb, p, selected, tt, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; nb = $f.nb; p = $f.p; selected = $f.selected; tt = $f.tt; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		selected = false;
		x = x;
		v = this;
		tt = v.typ.kindType;
		if (((tt.dir >> 0) & 2) === 0) {
			$panic(new $String("reflect: send on recv-only channel"));
		}
		new flag(x.flag).mustBeExported();
		_r = x.assignTo("reflect.Value.Send", tt.elem, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		x = _r;
		p = 0;
		if (!((((x.flag & 128) >>> 0) === 0))) {
			p = x.ptr;
		} else {
			p = (x.$ptr_ptr || (x.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, x)));
		}
		_r$1 = chansend(v.typ, v.pointer(), p, nb); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		selected = _r$1;
		/* */ $s = 3; case 3:
		return selected;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.send }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.nb = nb; $f.p = p; $f.selected = selected; $f.tt = tt; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.send = function(x, nb) { return this.$val.send(x, nb); };
	Value.ptr.prototype.SetBool = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(1);
		v.ptr.$set(x);
	};
	Value.prototype.SetBool = function(x) { return this.$val.SetBool(x); };
	Value.ptr.prototype.setRunes = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(23);
		_r = v.typ.Elem().Kind(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (!((_r === 5))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((_r === 5))) { */ case 1:
			$panic(new $String("reflect.Value.setRunes of non-rune slice"));
		/* } */ case 2:
		v.ptr.$set(x);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.setRunes }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.setRunes = function(x) { return this.$val.setRunes(x); };
	Value.ptr.prototype.SetComplex = function(x) {
		var $ptr, _14, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_14 = k;
		if (_14 === 15) {
			v.ptr.$set(new $Complex64(x.$real, x.$imag));
		} else if (_14 === 16) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetComplex", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetComplex = function(x) { return this.$val.SetComplex(x); };
	Value.ptr.prototype.SetFloat = function(x) {
		var $ptr, _15, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_15 = k;
		if (_15 === 13) {
			v.ptr.$set($fround(x));
		} else if (_15 === 14) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetFloat", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetFloat = function(x) { return this.$val.SetFloat(x); };
	Value.ptr.prototype.SetInt = function(x) {
		var $ptr, _16, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_16 = k;
		if (_16 === 2) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_16 === 3) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 24 >> 24));
		} else if (_16 === 4) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) << 16 >> 16));
		} else if (_16 === 5) {
			v.ptr.$set(((x.$low + ((x.$high >> 31) * 4294967296)) >> 0));
		} else if (_16 === 6) {
			v.ptr.$set(x);
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetInt", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetInt = function(x) { return this.$val.SetInt(x); };
	Value.ptr.prototype.SetMapIndex = function(key, val) {
		var $ptr, _r, _r$1, e, k, key, tt, v, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; e = $f.e; k = $f.k; key = $f.key; tt = $f.tt; v = $f.v; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		val = val;
		key = key;
		v = this;
		new flag(v.flag).mustBe(21);
		new flag(v.flag).mustBeExported();
		new flag(key.flag).mustBeExported();
		tt = v.typ.kindType;
		_r = key.assignTo("reflect.Value.SetMapIndex", tt.key, 0); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		key = _r;
		k = 0;
		if (!((((key.flag & 128) >>> 0) === 0))) {
			k = key.ptr;
		} else {
			k = (key.$ptr_ptr || (key.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, key)));
		}
		if (val.typ === ptrType$1.nil) {
			mapdelete(v.typ, v.pointer(), k);
			return;
		}
		new flag(val.flag).mustBeExported();
		_r$1 = val.assignTo("reflect.Value.SetMapIndex", tt.elem, 0); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		val = _r$1;
		e = 0;
		if (!((((val.flag & 128) >>> 0) === 0))) {
			e = val.ptr;
		} else {
			e = (val.$ptr_ptr || (val.$ptr_ptr = new ptrType$18(function() { return this.$target.ptr; }, function($v) { this.$target.ptr = $v; }, val)));
		}
		$r = mapassign(v.typ, v.pointer(), k, e); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.SetMapIndex }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.e = e; $f.k = k; $f.key = key; $f.tt = tt; $f.v = v; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.SetMapIndex = function(key, val) { return this.$val.SetMapIndex(key, val); };
	Value.ptr.prototype.SetUint = function(x) {
		var $ptr, _17, k, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		k = new flag(v.flag).kind();
		_17 = k;
		if (_17 === 7) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_17 === 8) {
			v.ptr.$set((x.$low << 24 >>> 24));
		} else if (_17 === 9) {
			v.ptr.$set((x.$low << 16 >>> 16));
		} else if (_17 === 10) {
			v.ptr.$set((x.$low >>> 0));
		} else if (_17 === 11) {
			v.ptr.$set(x);
		} else if (_17 === 12) {
			v.ptr.$set((x.$low >>> 0));
		} else {
			$panic(new ValueError.ptr("reflect.Value.SetUint", new flag(v.flag).kind()));
		}
	};
	Value.prototype.SetUint = function(x) { return this.$val.SetUint(x); };
	Value.ptr.prototype.SetPointer = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(26);
		v.ptr.$set(x);
	};
	Value.prototype.SetPointer = function(x) { return this.$val.SetPointer(x); };
	Value.ptr.prototype.SetString = function(x) {
		var $ptr, v, x;
		v = this;
		new flag(v.flag).mustBeAssignable();
		new flag(v.flag).mustBe(24);
		v.ptr.$set(x);
	};
	Value.prototype.SetString = function(x) { return this.$val.SetString(x); };
	Value.ptr.prototype.String = function() {
		var $ptr, _20, _r, k, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _20 = $f._20; _r = $f._r; k = $f.k; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		k = new flag(v.flag).kind();
		_20 = k;
		if (_20 === 0) {
			return "<invalid Value>";
		} else if (_20 === 24) {
			return v.ptr.$get();
		}
		_r = v.Type().String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return "<" + _r + " Value>";
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.String }; } $f.$ptr = $ptr; $f._20 = _20; $f._r = _r; $f.k = k; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.String = function() { return this.$val.String(); };
	Value.ptr.prototype.TryRecv = function() {
		var $ptr, _r, _tuple, ok, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; ok = $f.ok; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = new Value.ptr(ptrType$1.nil, 0, 0);
		ok = false;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.recv(true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		x = _tuple[0];
		ok = _tuple[1];
		/* */ $s = 2; case 2:
		return [x, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TryRecv }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.ok = ok; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TryRecv = function() { return this.$val.TryRecv(); };
	Value.ptr.prototype.TrySend = function(x) {
		var $ptr, _r, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		x = x;
		v = this;
		new flag(v.flag).mustBe(18);
		new flag(v.flag).mustBeExported();
		_r = v.send(x, true); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.TrySend }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.TrySend = function(x) { return this.$val.TrySend(x); };
	Value.ptr.prototype.Type = function() {
		var $ptr, f, i, m, m$1, tt, ut, v, x, x$1;
		v = this;
		f = v.flag;
		if (f === 0) {
			$panic(new ValueError.ptr("reflect.Value.Type", 0));
		}
		if (((f & 512) >>> 0) === 0) {
			return v.typ;
		}
		i = (v.flag >> 0) >> 10 >> 0;
		if (v.typ.Kind() === 20) {
			tt = v.typ.kindType;
			if ((i >>> 0) >= (tt.methods.$length >>> 0)) {
				$panic(new $String("reflect: internal error: invalid method index"));
			}
			m = (x = tt.methods, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			return m.typ;
		}
		ut = v.typ.uncommonType.uncommon();
		if (ut === ptrType$7.nil || (i >>> 0) >= (ut.methods.$length >>> 0)) {
			$panic(new $String("reflect: internal error: invalid method index"));
		}
		m$1 = (x$1 = ut.methods, ((i < 0 || i >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + i]));
		return m$1.mtyp;
	};
	Value.prototype.Type = function() { return this.$val.Type(); };
	Value.ptr.prototype.Uint = function() {
		var $ptr, _21, k, p, v, x;
		v = this;
		k = new flag(v.flag).kind();
		p = v.ptr;
		_21 = k;
		if (_21 === 7) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 8) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 9) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 10) {
			return new $Uint64(0, p.$get());
		} else if (_21 === 11) {
			return p.$get();
		} else if (_21 === 12) {
			return (x = p.$get(), new $Uint64(0, x.constructor === Number ? x : 1));
		}
		$panic(new ValueError.ptr("reflect.Value.Uint", new flag(v.flag).kind()));
	};
	Value.prototype.Uint = function() { return this.$val.Uint(); };
	Value.ptr.prototype.UnsafeAddr = function() {
		var $ptr, v;
		v = this;
		if (v.typ === ptrType$1.nil) {
			$panic(new ValueError.ptr("reflect.Value.UnsafeAddr", 0));
		}
		if (((v.flag & 256) >>> 0) === 0) {
			$panic(new $String("reflect.Value.UnsafeAddr of unaddressable value"));
		}
		return v.ptr;
	};
	Value.prototype.UnsafeAddr = function() { return this.$val.UnsafeAddr(); };
	Indirect = function(v) {
		var $ptr, _r, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		if (!((v.Kind() === 22))) {
			return v;
		}
		_r = v.Elem(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Indirect }; } $f.$ptr = $ptr; $f._r = _r; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Indirect = Indirect;
	New = function(typ) {
		var $ptr, _r, _r$1, fl, ptr, typ, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; fl = $f.fl; ptr = $f.ptr; typ = $f.typ; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if ($interfaceIsEqual(typ, $ifaceNil)) {
			$panic(new $String("reflect: New(nil)"));
		}
		ptr = unsafe_New($assertType(typ, ptrType$1));
		fl = 22;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.ptrTo(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return new Value.ptr(_r$1, ptr, fl);
		/* */ } return; } if ($f === undefined) { $f = { $blk: New }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.fl = fl; $f.ptr = ptr; $f.typ = typ; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.New = New;
	Value.ptr.prototype.assignTo = function(context, dst, target) {
		var $ptr, _r, _r$1, context, dst, fl, target, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; context = $f.context; dst = $f.dst; fl = $f.fl; target = $f.target; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue(context, v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
			/* */ if (directlyAssignable(dst, v.typ)) { $s = 5; continue; }
			/* */ if (implements$1(dst, v.typ)) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (directlyAssignable(dst, v.typ)) { */ case 5:
				v.typ = dst;
				fl = (v.flag & 480) >>> 0;
				fl = (fl | ((dst.Kind() >>> 0))) >>> 0;
				return new Value.ptr(dst, v.ptr, fl);
			/* } else if (implements$1(dst, v.typ)) { */ case 6:
				if (target === 0) {
					target = unsafe_New(dst);
				}
				_r$1 = valueInterface(v, false); /* */ $s = 8; case 8: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				x = _r$1;
				if (dst.NumMethod() === 0) {
					target.$set(x);
				} else {
					ifaceE2I(dst, x, target);
				}
				return new Value.ptr(dst, target, 148);
			/* } */ case 7:
		case 4:
		$panic(new $String(context + ": value of type " + v.typ.String() + " is not assignable to type " + dst.String()));
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.assignTo }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.context = context; $f.dst = dst; $f.fl = fl; $f.target = target; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.assignTo = function(context, dst, target) { return this.$val.assignTo(context, dst, target); };
	Value.ptr.prototype.Convert = function(t) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, op, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; op = $f.op; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = this;
		/* */ if (!((((v.flag & 512) >>> 0) === 0))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!((((v.flag & 512) >>> 0) === 0))) { */ case 1:
			_r = makeMethodValue("Convert", v); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			v = _r;
		/* } */ case 2:
		_r$1 = t.common(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = convertOp(_r$1, v.typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		op = _r$2;
		/* */ if (op === $throwNilPointerError) { $s = 6; continue; }
		/* */ $s = 7; continue;
		/* if (op === $throwNilPointerError) { */ case 6:
			_r$3 = t.String(); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			$panic(new $String("reflect.Value.Convert: value of type " + v.typ.String() + " cannot be converted to type " + _r$3));
		/* } */ case 7:
		_r$4 = op(v, t); /* */ $s = 9; case 9: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		/* */ $s = 10; case 10:
		return _r$4;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Value.ptr.prototype.Convert }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.op = op; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Value.prototype.Convert = function(t) { return this.$val.Convert(t); };
	convertOp = function(dst, src) {
		var $ptr, _23, _24, _25, _26, _27, _28, _29, _arg, _arg$1, _r, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _v, _v$1, _v$2, dst, src, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _23 = $f._23; _24 = $f._24; _25 = $f._25; _26 = $f._26; _27 = $f._27; _28 = $f._28; _29 = $f._29; _arg = $f._arg; _arg$1 = $f._arg$1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _v = $f._v; _v$1 = $f._v$1; _v$2 = $f._v$2; dst = $f.dst; src = $f.src; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_23 = src.Kind();
			/* */ if ((_23 === 2) || (_23 === 3) || (_23 === 4) || (_23 === 5) || (_23 === 6)) { $s = 2; continue; }
			/* */ if ((_23 === 7) || (_23 === 8) || (_23 === 9) || (_23 === 10) || (_23 === 11) || (_23 === 12)) { $s = 3; continue; }
			/* */ if ((_23 === 13) || (_23 === 14)) { $s = 4; continue; }
			/* */ if ((_23 === 15) || (_23 === 16)) { $s = 5; continue; }
			/* */ if (_23 === 24) { $s = 6; continue; }
			/* */ if (_23 === 23) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if ((_23 === 2) || (_23 === 3) || (_23 === 4) || (_23 === 5) || (_23 === 6)) { */ case 2:
				_24 = dst.Kind();
				if ((_24 === 2) || (_24 === 3) || (_24 === 4) || (_24 === 5) || (_24 === 6) || (_24 === 7) || (_24 === 8) || (_24 === 9) || (_24 === 10) || (_24 === 11) || (_24 === 12)) {
					return cvtInt;
				} else if ((_24 === 13) || (_24 === 14)) {
					return cvtIntFloat;
				} else if (_24 === 24) {
					return cvtIntString;
				}
				$s = 8; continue;
			/* } else if ((_23 === 7) || (_23 === 8) || (_23 === 9) || (_23 === 10) || (_23 === 11) || (_23 === 12)) { */ case 3:
				_25 = dst.Kind();
				if ((_25 === 2) || (_25 === 3) || (_25 === 4) || (_25 === 5) || (_25 === 6) || (_25 === 7) || (_25 === 8) || (_25 === 9) || (_25 === 10) || (_25 === 11) || (_25 === 12)) {
					return cvtUint;
				} else if ((_25 === 13) || (_25 === 14)) {
					return cvtUintFloat;
				} else if (_25 === 24) {
					return cvtUintString;
				}
				$s = 8; continue;
			/* } else if ((_23 === 13) || (_23 === 14)) { */ case 4:
				_26 = dst.Kind();
				if ((_26 === 2) || (_26 === 3) || (_26 === 4) || (_26 === 5) || (_26 === 6)) {
					return cvtFloatInt;
				} else if ((_26 === 7) || (_26 === 8) || (_26 === 9) || (_26 === 10) || (_26 === 11) || (_26 === 12)) {
					return cvtFloatUint;
				} else if ((_26 === 13) || (_26 === 14)) {
					return cvtFloat;
				}
				$s = 8; continue;
			/* } else if ((_23 === 15) || (_23 === 16)) { */ case 5:
				_27 = dst.Kind();
				if ((_27 === 15) || (_27 === 16)) {
					return cvtComplex;
				}
				$s = 8; continue;
			/* } else if (_23 === 24) { */ case 6:
				if (!(dst.Kind() === 23)) { _v = false; $s = 11; continue s; }
				_r = dst.Elem().PkgPath(); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_v = _r === ""; case 11:
				/* */ if (_v) { $s = 9; continue; }
				/* */ $s = 10; continue;
				/* if (_v) { */ case 9:
						_r$1 = dst.Elem().Kind(); /* */ $s = 14; case 14: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
						_28 = _r$1;
						if (_28 === 8) {
							return cvtStringBytes;
						} else if (_28 === 5) {
							return cvtStringRunes;
						}
					case 13:
				/* } */ case 10:
				$s = 8; continue;
			/* } else if (_23 === 23) { */ case 7:
				if (!(dst.Kind() === 24)) { _v$1 = false; $s = 17; continue s; }
				_r$2 = src.Elem().PkgPath(); /* */ $s = 18; case 18: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_v$1 = _r$2 === ""; case 17:
				/* */ if (_v$1) { $s = 15; continue; }
				/* */ $s = 16; continue;
				/* if (_v$1) { */ case 15:
						_r$3 = src.Elem().Kind(); /* */ $s = 20; case 20: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
						_29 = _r$3;
						if (_29 === 8) {
							return cvtBytesString;
						} else if (_29 === 5) {
							return cvtRunesString;
						}
					case 19:
				/* } */ case 16:
			/* } */ case 8:
		case 1:
		if (haveIdenticalUnderlyingType(dst, src)) {
			return cvtDirect;
		}
		if (!((dst.Kind() === 22) && dst.Name() === "" && (src.Kind() === 22) && src.Name() === "")) { _v$2 = false; $s = 23; continue s; }
		_r$4 = dst.Elem().common(); /* */ $s = 24; case 24: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		_arg = _r$4;
		_r$5 = src.Elem().common(); /* */ $s = 25; case 25: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		_arg$1 = _r$5;
		_r$6 = haveIdenticalUnderlyingType(_arg, _arg$1); /* */ $s = 26; case 26: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		_v$2 = _r$6; case 23:
		/* */ if (_v$2) { $s = 21; continue; }
		/* */ $s = 22; continue;
		/* if (_v$2) { */ case 21:
			return cvtDirect;
		/* } */ case 22:
		if (implements$1(dst, src)) {
			if (src.Kind() === 20) {
				return cvtI2I;
			}
			return cvtT2I;
		}
		return $throwNilPointerError;
		/* */ } return; } if ($f === undefined) { $f = { $blk: convertOp }; } $f.$ptr = $ptr; $f._23 = _23; $f._24 = _24; $f._25 = _25; $f._26 = _26; $f._27 = _27; $f._28 = _28; $f._29 = _29; $f._arg = _arg; $f._arg$1 = _arg$1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._v = _v; $f._v$1 = _v$1; $f._v$2 = _v$2; $f.dst = dst; $f.src = src; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeFloat = function(f, v, t) {
		var $ptr, _31, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _31 = $f._31; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_31 = typ.size;
		if (_31 === 4) {
			ptr.$set($fround(v));
		} else if (_31 === 8) {
			ptr.$set(v);
		}
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeFloat }; } $f.$ptr = $ptr; $f._31 = _31; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeComplex = function(f, v, t) {
		var $ptr, _32, _r, f, ptr, t, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _32 = $f._32; _r = $f._r; f = $f.f; ptr = $f.ptr; t = $f.t; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = t.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		typ = _r;
		ptr = unsafe_New(typ);
		_32 = typ.size;
		if (_32 === 8) {
			ptr.$set(new $Complex64(v.$real, v.$imag));
		} else if (_32 === 16) {
			ptr.$set(v);
		}
		return new Value.ptr(typ, ptr, (((f | 128) >>> 0) | (typ.Kind() >>> 0)) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeComplex }; } $f.$ptr = $ptr; $f._32 = _32; $f._r = _r; $f.f = f; $f.ptr = ptr; $f.t = t; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeString = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		ret.SetString(v);
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeString }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeBytes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.SetBytes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeBytes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeRunes = function(f, v, t) {
		var $ptr, _r, _r$1, f, ret, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; ret = $f.ret; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = New(t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = _r.Elem(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		ret = _r$1;
		$r = ret.setRunes(v); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		ret.flag = (((ret.flag & ~256) >>> 0) | f) >>> 0;
		return ret;
		/* */ } return; } if ($f === undefined) { $f = { $blk: makeRunes }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.ret = ret; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = v.Int(), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, v.Uint(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatInt = function(v, t) {
		var $ptr, _r, t, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, (x = new $Int64(0, v.Float()), new $Uint64(x.$high, x.$low)), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatInt }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloatUint = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeInt((v.flag & 96) >>> 0, new $Uint64(0, v.Float()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloatUint }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Int()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, $flatten64(v.Uint()), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtFloat = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeFloat((v.flag & 96) >>> 0, v.Float(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtFloat }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtComplex = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeComplex((v.flag & 96) >>> 0, v.Complex(), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtComplex }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtIntString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Int().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtIntString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtUintString = function(v, t) {
		var $ptr, _r, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = makeString((v.flag & 96) >>> 0, $encodeRune(v.Uint().$low), t); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtUintString }; } $f.$ptr = $ptr; $f._r = _r; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtBytesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.Bytes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $bytesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtBytesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringBytes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$13($stringToBytes(_r));
		_arg$2 = t;
		_r$1 = makeBytes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringBytes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtRunesString = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.runes(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = $runesToString(_r);
		_arg$2 = t;
		_r$1 = makeString(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtRunesString }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtStringRunes = function(v, t) {
		var $ptr, _arg, _arg$1, _arg$2, _r, _r$1, t, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _arg = $f._arg; _arg$1 = $f._arg$1; _arg$2 = $f._arg$2; _r = $f._r; _r$1 = $f._r$1; t = $f.t; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_arg = (v.flag & 96) >>> 0;
		_r = v.String(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_arg$1 = new sliceType$15($stringToRunes(_r));
		_arg$2 = t;
		_r$1 = makeRunes(_arg, _arg$1, _arg$2); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtStringRunes }; } $f.$ptr = $ptr; $f._arg = _arg; $f._arg$1 = _arg$1; $f._arg$2 = _arg$2; $f._r = _r; $f._r$1 = _r$1; $f.t = t; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtT2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, _r$3, _r$4, target, typ, v, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; target = $f.target; typ = $f.typ; v = $f.v; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		_r = typ.common(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = unsafe_New(_r); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		target = _r$1;
		_r$2 = valueInterface(v, false); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		x = _r$2;
		_r$3 = typ.NumMethod(); /* */ $s = 7; case 7: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ if (_r$3 === 0) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (_r$3 === 0) { */ case 4:
			target.$set(x);
			$s = 6; continue;
		/* } else { */ case 5:
			ifaceE2I($assertType(typ, ptrType$1), x, target);
		/* } */ case 6:
		_r$4 = typ.common(); /* */ $s = 8; case 8: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
		/* */ $s = 9; case 9:
		return new Value.ptr(_r$4, target, (((((v.flag & 96) >>> 0) | 128) >>> 0) | 20) >>> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtT2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f.target = target; $f.typ = typ; $f.v = v; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	cvtI2I = function(v, typ) {
		var $ptr, _r, _r$1, _r$2, ret, typ, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; ret = $f.ret; typ = $f.typ; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = v;
		/* */ if (v.IsNil()) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (v.IsNil()) { */ case 1:
			_r = Zero(typ); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			ret = _r;
			ret.flag = (ret.flag | (((v.flag & 96) >>> 0))) >>> 0;
			return ret;
		/* } */ case 2:
		_r$1 = v.Elem(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = cvtT2I(_r$1, typ); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 6; case 6:
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: cvtI2I }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.ret = ret; $f.typ = typ; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	Kind.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$1.methods = [{prop: "ptrTo", name: "ptrTo", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "pointers", name: "pointers", pkg: "reflect", typ: $funcType([], [$Bool], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}];
	ptrType$7.methods = [{prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$7], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}];
	ChanDir.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$11.methods = [{prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}];
	ptrType$13.methods = [{prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [StructField], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}];
	StructTag.methods = [{prop: "Get", name: "Get", pkg: "", typ: $funcType([$String], [$String], false)}];
	Value.methods = [{prop: "object", name: "object", pkg: "reflect", typ: $funcType([], [ptrType$3], false)}, {prop: "call", name: "call", pkg: "reflect", typ: $funcType([$String, sliceType$8], [sliceType$8], false)}, {prop: "Cap", name: "Cap", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "InterfaceData", name: "InterfaceData", pkg: "", typ: $funcType([], [arrayType$3], false)}, {prop: "IsNil", name: "IsNil", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Pointer", name: "Pointer", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([Value], [], false)}, {prop: "SetBytes", name: "SetBytes", pkg: "", typ: $funcType([sliceType$13], [], false)}, {prop: "SetCap", name: "SetCap", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "SetLen", name: "SetLen", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Slice", name: "Slice", pkg: "", typ: $funcType([$Int, $Int], [Value], false)}, {prop: "Slice3", name: "Slice3", pkg: "", typ: $funcType([$Int, $Int, $Int], [Value], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "pointer", name: "pointer", pkg: "reflect", typ: $funcType([], [$UnsafePointer], false)}, {prop: "Addr", name: "Addr", pkg: "", typ: $funcType([], [Value], false)}, {prop: "Bool", name: "Bool", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Bytes", name: "Bytes", pkg: "", typ: $funcType([], [sliceType$13], false)}, {prop: "runes", name: "runes", pkg: "reflect", typ: $funcType([], [sliceType$15], false)}, {prop: "CanAddr", name: "CanAddr", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CanSet", name: "CanSet", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Call", name: "Call", pkg: "", typ: $funcType([sliceType$8], [sliceType$8], false)}, {prop: "CallSlice", name: "CallSlice", pkg: "", typ: $funcType([sliceType$8], [sliceType$8], false)}, {prop: "Complex", name: "Complex", pkg: "", typ: $funcType([], [$Complex128], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [Value], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [Value], false)}, {prop: "Float", name: "Float", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Int", name: "Int", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "CanInterface", name: "CanInterface", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Interface", name: "Interface", pkg: "", typ: $funcType([], [$emptyInterface], false)}, {prop: "IsValid", name: "IsValid", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "MapIndex", name: "MapIndex", pkg: "", typ: $funcType([Value], [Value], false)}, {prop: "MapKeys", name: "MapKeys", pkg: "", typ: $funcType([], [sliceType$8], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Value], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Value], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OverflowComplex", name: "OverflowComplex", pkg: "", typ: $funcType([$Complex128], [$Bool], false)}, {prop: "OverflowFloat", name: "OverflowFloat", pkg: "", typ: $funcType([$Float64], [$Bool], false)}, {prop: "OverflowInt", name: "OverflowInt", pkg: "", typ: $funcType([$Int64], [$Bool], false)}, {prop: "OverflowUint", name: "OverflowUint", pkg: "", typ: $funcType([$Uint64], [$Bool], false)}, {prop: "Recv", name: "Recv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "recv", name: "recv", pkg: "reflect", typ: $funcType([$Bool], [Value, $Bool], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([Value], [], false)}, {prop: "send", name: "send", pkg: "reflect", typ: $funcType([Value, $Bool], [$Bool], false)}, {prop: "SetBool", name: "SetBool", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "setRunes", name: "setRunes", pkg: "reflect", typ: $funcType([sliceType$15], [], false)}, {prop: "SetComplex", name: "SetComplex", pkg: "", typ: $funcType([$Complex128], [], false)}, {prop: "SetFloat", name: "SetFloat", pkg: "", typ: $funcType([$Float64], [], false)}, {prop: "SetInt", name: "SetInt", pkg: "", typ: $funcType([$Int64], [], false)}, {prop: "SetMapIndex", name: "SetMapIndex", pkg: "", typ: $funcType([Value, Value], [], false)}, {prop: "SetUint", name: "SetUint", pkg: "", typ: $funcType([$Uint64], [], false)}, {prop: "SetPointer", name: "SetPointer", pkg: "", typ: $funcType([$UnsafePointer], [], false)}, {prop: "SetString", name: "SetString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TryRecv", name: "TryRecv", pkg: "", typ: $funcType([], [Value, $Bool], false)}, {prop: "TrySend", name: "TrySend", pkg: "", typ: $funcType([Value], [$Bool], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Uint", name: "Uint", pkg: "", typ: $funcType([], [$Uint64], false)}, {prop: "UnsafeAddr", name: "UnsafeAddr", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "assignTo", name: "assignTo", pkg: "reflect", typ: $funcType([$String, ptrType$1, $UnsafePointer], [Value], false)}, {prop: "Convert", name: "Convert", pkg: "", typ: $funcType([Type], [Value], false)}];
	flag.methods = [{prop: "kind", name: "kind", pkg: "reflect", typ: $funcType([], [Kind], false)}, {prop: "mustBe", name: "mustBe", pkg: "reflect", typ: $funcType([Kind], [], false)}, {prop: "mustBeExported", name: "mustBeExported", pkg: "reflect", typ: $funcType([], [], false)}, {prop: "mustBeAssignable", name: "mustBeAssignable", pkg: "reflect", typ: $funcType([], [], false)}];
	ptrType$20.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	mapIter.init([{prop: "t", name: "t", pkg: "reflect", typ: Type, tag: ""}, {prop: "m", name: "m", pkg: "reflect", typ: ptrType$3, tag: ""}, {prop: "keys", name: "keys", pkg: "reflect", typ: ptrType$3, tag: ""}, {prop: "i", name: "i", pkg: "reflect", typ: $Int, tag: ""}]);
	Type.init([{prop: "Align", name: "Align", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "AssignableTo", name: "AssignableTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Bits", name: "Bits", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ChanDir", name: "ChanDir", pkg: "", typ: $funcType([], [ChanDir], false)}, {prop: "Comparable", name: "Comparable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ConvertibleTo", name: "ConvertibleTo", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "Elem", name: "Elem", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Field", name: "Field", pkg: "", typ: $funcType([$Int], [StructField], false)}, {prop: "FieldAlign", name: "FieldAlign", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "FieldByIndex", name: "FieldByIndex", pkg: "", typ: $funcType([sliceType$11], [StructField], false)}, {prop: "FieldByName", name: "FieldByName", pkg: "", typ: $funcType([$String], [StructField, $Bool], false)}, {prop: "FieldByNameFunc", name: "FieldByNameFunc", pkg: "", typ: $funcType([funcType$3], [StructField, $Bool], false)}, {prop: "Implements", name: "Implements", pkg: "", typ: $funcType([Type], [$Bool], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "IsVariadic", name: "IsVariadic", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Key", name: "Key", pkg: "", typ: $funcType([], [Type], false)}, {prop: "Kind", name: "Kind", pkg: "", typ: $funcType([], [Kind], false)}, {prop: "Len", name: "Len", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Method", name: "Method", pkg: "", typ: $funcType([$Int], [Method], false)}, {prop: "MethodByName", name: "MethodByName", pkg: "", typ: $funcType([$String], [Method, $Bool], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NumField", name: "NumField", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumIn", name: "NumIn", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumMethod", name: "NumMethod", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NumOut", name: "NumOut", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Out", name: "Out", pkg: "", typ: $funcType([$Int], [Type], false)}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Size", name: "Size", pkg: "", typ: $funcType([], [$Uintptr], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "common", name: "common", pkg: "reflect", typ: $funcType([], [ptrType$1], false)}, {prop: "uncommon", name: "uncommon", pkg: "reflect", typ: $funcType([], [ptrType$7], false)}]);
	rtype.init([{prop: "size", name: "size", pkg: "reflect", typ: $Uintptr, tag: ""}, {prop: "ptrdata", name: "ptrdata", pkg: "reflect", typ: $Uintptr, tag: ""}, {prop: "hash", name: "hash", pkg: "reflect", typ: $Uint32, tag: ""}, {prop: "_$3", name: "_", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "align", name: "align", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "fieldAlign", name: "fieldAlign", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "kind", name: "kind", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "alg", name: "alg", pkg: "reflect", typ: ptrType$4, tag: ""}, {prop: "gcdata", name: "gcdata", pkg: "reflect", typ: ptrType$5, tag: ""}, {prop: "string", name: "string", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "uncommonType", name: "", pkg: "reflect", typ: ptrType$7, tag: ""}, {prop: "ptrToThis", name: "ptrToThis", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	typeAlg.init([{prop: "hash", name: "hash", pkg: "reflect", typ: funcType$4, tag: ""}, {prop: "equal", name: "equal", pkg: "reflect", typ: funcType$5, tag: ""}]);
	method.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "mtyp", name: "mtyp", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "ifn", name: "ifn", pkg: "reflect", typ: $UnsafePointer, tag: ""}, {prop: "tfn", name: "tfn", pkg: "reflect", typ: $UnsafePointer, tag: ""}]);
	uncommonType.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "methods", name: "methods", pkg: "reflect", typ: sliceType$4, tag: ""}]);
	arrayType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"array\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "slice", name: "slice", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "len", name: "len", pkg: "reflect", typ: $Uintptr, tag: ""}]);
	chanType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"chan\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "dir", name: "dir", pkg: "reflect", typ: $Uintptr, tag: ""}]);
	funcType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"func\""}, {prop: "dotdotdot", name: "dotdotdot", pkg: "reflect", typ: $Bool, tag: ""}, {prop: "in$2", name: "in", pkg: "reflect", typ: sliceType$1, tag: ""}, {prop: "out", name: "out", pkg: "reflect", typ: sliceType$1, tag: ""}]);
	imethod.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	interfaceType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"interface\""}, {prop: "methods", name: "methods", pkg: "reflect", typ: sliceType$5, tag: ""}]);
	mapType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"map\""}, {prop: "key", name: "key", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "bucket", name: "bucket", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "hmap", name: "hmap", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "keysize", name: "keysize", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "indirectkey", name: "indirectkey", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "valuesize", name: "valuesize", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "indirectvalue", name: "indirectvalue", pkg: "reflect", typ: $Uint8, tag: ""}, {prop: "bucketsize", name: "bucketsize", pkg: "reflect", typ: $Uint16, tag: ""}, {prop: "reflexivekey", name: "reflexivekey", pkg: "reflect", typ: $Bool, tag: ""}, {prop: "needkeyupdate", name: "needkeyupdate", pkg: "reflect", typ: $Bool, tag: ""}]);
	ptrType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"ptr\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	sliceType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"slice\""}, {prop: "elem", name: "elem", pkg: "reflect", typ: ptrType$1, tag: ""}]);
	structField.init([{prop: "name", name: "name", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "pkgPath", name: "pkgPath", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "tag", name: "tag", pkg: "reflect", typ: ptrType$6, tag: ""}, {prop: "offset", name: "offset", pkg: "reflect", typ: $Uintptr, tag: ""}]);
	structType.init([{prop: "rtype", name: "", pkg: "reflect", typ: rtype, tag: "reflect:\"struct\""}, {prop: "fields", name: "fields", pkg: "reflect", typ: sliceType$6, tag: ""}]);
	Method.init([{prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $String, tag: ""}, {prop: "Type", name: "Type", pkg: "", typ: Type, tag: ""}, {prop: "Func", name: "Func", pkg: "", typ: Value, tag: ""}, {prop: "Index", name: "Index", pkg: "", typ: $Int, tag: ""}]);
	StructField.init([{prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}, {prop: "PkgPath", name: "PkgPath", pkg: "", typ: $String, tag: ""}, {prop: "Type", name: "Type", pkg: "", typ: Type, tag: ""}, {prop: "Tag", name: "Tag", pkg: "", typ: StructTag, tag: ""}, {prop: "Offset", name: "Offset", pkg: "", typ: $Uintptr, tag: ""}, {prop: "Index", name: "Index", pkg: "", typ: sliceType$11, tag: ""}, {prop: "Anonymous", name: "Anonymous", pkg: "", typ: $Bool, tag: ""}]);
	fieldScan.init([{prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$13, tag: ""}, {prop: "index", name: "index", pkg: "reflect", typ: sliceType$11, tag: ""}]);
	Value.init([{prop: "typ", name: "typ", pkg: "reflect", typ: ptrType$1, tag: ""}, {prop: "ptr", name: "ptr", pkg: "reflect", typ: $UnsafePointer, tag: ""}, {prop: "flag", name: "", pkg: "reflect", typ: flag, tag: ""}]);
	ValueError.init([{prop: "Method", name: "Method", pkg: "", typ: $String, tag: ""}, {prop: "Kind", name: "Kind", pkg: "", typ: Kind, tag: ""}]);
	nonEmptyInterface.init([{prop: "itab", name: "itab", pkg: "reflect", typ: ptrType$9, tag: ""}, {prop: "word", name: "word", pkg: "reflect", typ: $UnsafePointer, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = math.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		initialized = false;
		stringPtrMap = {};
		callHelper = $assertType($internalize($call, $emptyInterface), funcType$1);
		selectHelper = $assertType($internalize($select, $emptyInterface), funcType$1);
		kindNames = new sliceType$3(["invalid", "bool", "int", "int8", "int16", "int32", "int64", "uint", "uint8", "uint16", "uint32", "uint64", "uintptr", "float32", "float64", "complex64", "complex128", "array", "chan", "func", "interface", "map", "ptr", "slice", "string", "struct", "unsafe.Pointer"]);
		jsObjectPtr = reflectType($jsObjectPtr);
		uint8Type = $assertType(TypeOf(new $Uint8(0)), ptrType$1);
		$r = init(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["strings"] = (function() {
	var $pkg = {}, $init, errors, js, io, unicode, utf8, sliceType, sliceType$3, IndexByte, Index, Count, explode, IndexRune, genSplit, Split, Join, HasPrefix, Map, ToLower, TrimLeftFunc, TrimRightFunc, TrimFunc, indexFunc, lastIndexFunc, makeCutsetFunc, Trim;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	io = $packages["io"];
	unicode = $packages["unicode"];
	utf8 = $packages["unicode/utf8"];
	sliceType = $sliceType($Uint8);
	sliceType$3 = $sliceType($String);
	IndexByte = function(s, c) {
		var $ptr, c, s;
		return $parseInt(s.indexOf($global.String.fromCharCode(c))) >> 0;
	};
	$pkg.IndexByte = IndexByte;
	Index = function(s, sep) {
		var $ptr, s, sep;
		return $parseInt(s.indexOf(sep)) >> 0;
	};
	$pkg.Index = Index;
	Count = function(s, sep) {
		var $ptr, n, pos, s, sep;
		n = 0;
		if ((sep.length === 0)) {
			return utf8.RuneCountInString(s) + 1 >> 0;
		} else if (sep.length > s.length) {
			return 0;
		} else if ((sep.length === s.length)) {
			if (sep === s) {
				return 1;
			}
			return 0;
		}
		while (true) {
			pos = Index(s, sep);
			if (pos === -1) {
				break;
			}
			n = n + (1) >> 0;
			s = s.substring((pos + sep.length >> 0));
		}
		return n;
	};
	$pkg.Count = Count;
	explode = function(s, n) {
		var $ptr, _tmp, _tmp$1, _tuple, a, ch, cur, i, l, n, s, size;
		if (n === 0) {
			return sliceType$3.nil;
		}
		l = utf8.RuneCountInString(s);
		if (n <= 0 || n > l) {
			n = l;
		}
		a = $makeSlice(sliceType$3, n);
		size = 0;
		ch = 0;
		_tmp = 0;
		_tmp$1 = 0;
		i = _tmp;
		cur = _tmp$1;
		while (true) {
			if (!((i + 1 >> 0) < n)) { break; }
			_tuple = utf8.DecodeRuneInString(s.substring(cur));
			ch = _tuple[0];
			size = _tuple[1];
			if (ch === 65533) {
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = "\xEF\xBF\xBD");
			} else {
				((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = s.substring(cur, (cur + size >> 0)));
			}
			cur = cur + (size) >> 0;
			i = i + (1) >> 0;
		}
		if (cur < s.length) {
			((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i] = s.substring(cur));
		}
		return a;
	};
	IndexRune = function(s, r) {
		var $ptr, _i, _ref, _rune, c, i, r, s;
		if (r < 128) {
			return IndexByte(s, (r << 24 >>> 24));
		} else {
			_ref = s;
			_i = 0;
			while (true) {
				if (!(_i < _ref.length)) { break; }
				_rune = $decodeRune(_ref, _i);
				i = _i;
				c = _rune[0];
				if (c === r) {
					return i;
				}
				_i += _rune[1];
			}
		}
		return -1;
	};
	$pkg.IndexRune = IndexRune;
	genSplit = function(s, sep, sepSave, n) {
		var $ptr, a, c, i, n, na, s, sep, sepSave, start;
		if (n === 0) {
			return sliceType$3.nil;
		}
		if (sep === "") {
			return explode(s, n);
		}
		if (n < 0) {
			n = Count(s, sep) + 1 >> 0;
		}
		c = sep.charCodeAt(0);
		start = 0;
		a = $makeSlice(sliceType$3, n);
		na = 0;
		i = 0;
		while (true) {
			if (!((i + sep.length >> 0) <= s.length && (na + 1 >> 0) < n)) { break; }
			if ((s.charCodeAt(i) === c) && ((sep.length === 1) || s.substring(i, (i + sep.length >> 0)) === sep)) {
				((na < 0 || na >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + na] = s.substring(start, (i + sepSave >> 0)));
				na = na + (1) >> 0;
				start = i + sep.length >> 0;
				i = i + ((sep.length - 1 >> 0)) >> 0;
			}
			i = i + (1) >> 0;
		}
		((na < 0 || na >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + na] = s.substring(start));
		return $subslice(a, 0, (na + 1 >> 0));
	};
	Split = function(s, sep) {
		var $ptr, s, sep;
		return genSplit(s, sep, 0, -1);
	};
	$pkg.Split = Split;
	Join = function(a, sep) {
		var $ptr, _i, _ref, a, b, bp, i, n, s, sep;
		if (a.$length === 0) {
			return "";
		}
		if (a.$length === 1) {
			return (0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]);
		}
		n = $imul(sep.length, ((a.$length - 1 >> 0)));
		i = 0;
		while (true) {
			if (!(i < a.$length)) { break; }
			n = n + (((i < 0 || i >= a.$length) ? $throwRuntimeError("index out of range") : a.$array[a.$offset + i]).length) >> 0;
			i = i + (1) >> 0;
		}
		b = $makeSlice(sliceType, n);
		bp = $copyString(b, (0 >= a.$length ? $throwRuntimeError("index out of range") : a.$array[a.$offset + 0]));
		_ref = $subslice(a, 1);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			bp = bp + ($copyString($subslice(b, bp), sep)) >> 0;
			bp = bp + ($copyString($subslice(b, bp), s)) >> 0;
			_i++;
		}
		return $bytesToString(b);
	};
	$pkg.Join = Join;
	HasPrefix = function(s, prefix) {
		var $ptr, prefix, s;
		return s.length >= prefix.length && s.substring(0, prefix.length) === prefix;
	};
	$pkg.HasPrefix = HasPrefix;
	Map = function(mapping, s) {
		var $ptr, _i, _r, _ref, _rune, b, c, i, mapping, maxbytes, nb, nbytes, r, s, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _r = $f._r; _ref = $f._ref; _rune = $f._rune; b = $f.b; c = $f.c; i = $f.i; mapping = $f.mapping; maxbytes = $f.maxbytes; nb = $f.nb; nbytes = $f.nbytes; r = $f.r; s = $f.s; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		maxbytes = s.length;
		nbytes = 0;
		b = sliceType.nil;
		_ref = s;
		_i = 0;
		/* while (true) { */ case 1:
			/* if (!(_i < _ref.length)) { break; } */ if(!(_i < _ref.length)) { $s = 2; continue; }
			_rune = $decodeRune(_ref, _i);
			i = _i;
			c = _rune[0];
			_r = mapping(c); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			r = _r;
			if (b === sliceType.nil) {
				if (r === c) {
					_i += _rune[1];
					/* continue; */ $s = 1; continue;
				}
				b = $makeSlice(sliceType, maxbytes);
				nbytes = $copyString(b, s.substring(0, i));
			}
			if (r >= 0) {
				wid = 1;
				if (r >= 128) {
					wid = utf8.RuneLen(r);
				}
				if ((nbytes + wid >> 0) > maxbytes) {
					maxbytes = ($imul(maxbytes, 2)) + 4 >> 0;
					nb = $makeSlice(sliceType, maxbytes);
					$copySlice(nb, $subslice(b, 0, nbytes));
					b = nb;
				}
				nbytes = nbytes + (utf8.EncodeRune($subslice(b, nbytes, maxbytes), r)) >> 0;
			}
			_i += _rune[1];
		/* } */ $s = 1; continue; case 2:
		if (b === sliceType.nil) {
			return s;
		}
		return $bytesToString($subslice(b, 0, nbytes));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Map }; } $f.$ptr = $ptr; $f._i = _i; $f._r = _r; $f._ref = _ref; $f._rune = _rune; $f.b = b; $f.c = c; $f.i = i; $f.mapping = mapping; $f.maxbytes = maxbytes; $f.nb = nb; $f.nbytes = nbytes; $f.r = r; $f.s = s; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Map = Map;
	ToLower = function(s) {
		var $ptr, _r, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = Map(unicode.ToLower, s); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: ToLower }; } $f.$ptr = $ptr; $f._r = _r; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.ToLower = ToLower;
	TrimLeftFunc = function(s, f) {
		var $ptr, _r, f, i, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; f = $f.f; i = $f.i; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = indexFunc(s, f, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		if (i === -1) {
			return "";
		}
		return s.substring(i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimLeftFunc }; } $f.$ptr = $ptr; $f._r = _r; $f.f = f; $f.i = i; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimLeftFunc = TrimLeftFunc;
	TrimRightFunc = function(s, f) {
		var $ptr, _r, _tuple, f, i, s, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; f = $f.f; i = $f.i; s = $f.s; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = lastIndexFunc(s, f, false); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		i = _r;
		if (i >= 0 && s.charCodeAt(i) >= 128) {
			_tuple = utf8.DecodeRuneInString(s.substring(i));
			wid = _tuple[1];
			i = i + (wid) >> 0;
		} else {
			i = i + (1) >> 0;
		}
		return s.substring(0, i);
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimRightFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.i = i; $f.s = s; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimRightFunc = TrimRightFunc;
	TrimFunc = function(s, f) {
		var $ptr, _r, _r$1, f, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; f = $f.f; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = TrimLeftFunc(s, f); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = TrimRightFunc(_r, f); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: TrimFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.f = f; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.TrimFunc = TrimFunc;
	indexFunc = function(s, f, truth) {
		var $ptr, _r, _tuple, f, r, s, start, truth, wid, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; f = $f.f; r = $f.r; s = $f.s; start = $f.start; truth = $f.truth; wid = $f.wid; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		start = 0;
		/* while (true) { */ case 1:
			/* if (!(start < s.length)) { break; } */ if(!(start < s.length)) { $s = 2; continue; }
			wid = 1;
			r = (s.charCodeAt(start) >> 0);
			if (r >= 128) {
				_tuple = utf8.DecodeRuneInString(s.substring(start));
				r = _tuple[0];
				wid = _tuple[1];
			}
			_r = f(r); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === truth) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_r === truth) { */ case 3:
				return start;
			/* } */ case 4:
			start = start + (wid) >> 0;
		/* } */ $s = 1; continue; case 2:
		return -1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: indexFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.r = r; $f.s = s; $f.start = start; $f.truth = truth; $f.wid = wid; $f.$s = $s; $f.$r = $r; return $f;
	};
	lastIndexFunc = function(s, f, truth) {
		var $ptr, _r, _tuple, f, i, r, s, size, truth, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; f = $f.f; i = $f.i; r = $f.r; s = $f.s; size = $f.size; truth = $f.truth; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		i = s.length;
		/* while (true) { */ case 1:
			/* if (!(i > 0)) { break; } */ if(!(i > 0)) { $s = 2; continue; }
			_tuple = utf8.DecodeLastRuneInString(s.substring(0, i));
			r = _tuple[0];
			size = _tuple[1];
			i = i - (size) >> 0;
			_r = f(r); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			/* */ if (_r === truth) { $s = 3; continue; }
			/* */ $s = 4; continue;
			/* if (_r === truth) { */ case 3:
				return i;
			/* } */ case 4:
		/* } */ $s = 1; continue; case 2:
		return -1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: lastIndexFunc }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f.f = f; $f.i = i; $f.r = r; $f.s = s; $f.size = size; $f.truth = truth; $f.$s = $s; $f.$r = $r; return $f;
	};
	makeCutsetFunc = function(cutset) {
		var $ptr, cutset;
		return (function(r) {
			var $ptr, r;
			return IndexRune(cutset, r) >= 0;
		});
	};
	Trim = function(s, cutset) {
		var $ptr, _r, cutset, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; cutset = $f.cutset; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (s === "" || cutset === "") {
			return s;
		}
		_r = TrimFunc(s, makeCutsetFunc(cutset)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Trim }; } $f.$ptr = $ptr; $f._r = _r; $f.cutset = cutset; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Trim = Trim;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = io.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = unicode.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf8.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["unicode/utf16"] = (function() {
	var $pkg = {}, $init, IsSurrogate, DecodeRune;
	IsSurrogate = function(r) {
		var $ptr, r;
		return 55296 <= r && r < 57344;
	};
	$pkg.IsSurrogate = IsSurrogate;
	DecodeRune = function(r1, r2) {
		var $ptr, r1, r2;
		if (55296 <= r1 && r1 < 56320 && 56320 <= r2 && r2 < 57344) {
			return ((((r1 - 55296 >> 0)) << 10 >> 0) | ((r2 - 56320 >> 0))) + 65536 >> 0;
		}
		return 65533;
	};
	$pkg.DecodeRune = DecodeRune;
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/kurrik/json"] = (function() {
	var $pkg = {}, $init, bytes, errors, reflect, strconv, strings, utf16, Event, State, EndMap, EndArray, ptrType, sliceType, arrayType, arrayType$1, mapType, sliceType$1, sliceType$2, ptrType$1, clamp, decodeSurrogates, Unmarshal;
	bytes = $packages["bytes"];
	errors = $packages["errors"];
	reflect = $packages["reflect"];
	strconv = $packages["strconv"];
	strings = $packages["strings"];
	utf16 = $packages["unicode/utf16"];
	Event = $pkg.Event = $newType(0, $kindStruct, "json.Event", "Event", "github.com/kurrik/json", function(Type_, Index_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Type = 0;
			this.Index = 0;
			return;
		}
		this.Type = Type_;
		this.Index = Index_;
	});
	State = $pkg.State = $newType(0, $kindStruct, "json.State", "State", "github.com/kurrik/json", function(data_, i_, v_, events_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.data = sliceType.nil;
			this.i = 0;
			this.v = $ifaceNil;
			this.events = sliceType$2.nil;
			return;
		}
		this.data = data_;
		this.i = i_;
		this.v = v_;
		this.events = events_;
	});
	EndMap = $pkg.EndMap = $newType(0, $kindStruct, "json.EndMap", "EndMap", "github.com/kurrik/json", function() {
		this.$val = this;
		if (arguments.length === 0) {
			return;
		}
	});
	EndArray = $pkg.EndArray = $newType(0, $kindStruct, "json.EndArray", "EndArray", "github.com/kurrik/json", function() {
		this.$val = this;
		if (arguments.length === 0) {
			return;
		}
	});
	ptrType = $ptrType(bytes.Buffer);
	sliceType = $sliceType($Uint8);
	arrayType = $arrayType($Uint8, 4);
	arrayType$1 = $arrayType($Uint8, 64);
	mapType = $mapType($String, $emptyInterface);
	sliceType$1 = $sliceType($emptyInterface);
	sliceType$2 = $sliceType(Event);
	ptrType$1 = $ptrType(State);
	clamp = function(val, min, max) {
		var $ptr, max, min, val;
		if (val > max) {
			val = max;
		}
		if (val < min) {
			val = min;
		}
		return val;
	};
	State.ptr.prototype.Read = function() {
		var $ptr, _1, _r, _r$1, _r$2, _r$3, b, c, e, err, idx, length, max, mid, min, s, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; b = $f.b; c = $f.c; e = $f.e; err = $f.err; idx = $f.idx; length = $f.length; max = $f.max; mid = $f.mid; min = $f.min; s = $f.s; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		s = this;
		t = s.nextType();
			_1 = t;
			/* */ if (_1 === 0) { $s = 2; continue; }
			/* */ if (_1 === 1) { $s = 3; continue; }
			/* */ if (_1 === 2) { $s = 4; continue; }
			/* */ if (_1 === 3) { $s = 5; continue; }
			/* */ if (_1 === 4) { $s = 6; continue; }
			/* */ if (_1 === 6) { $s = 7; continue; }
			/* */ if (_1 === 7) { $s = 8; continue; }
			/* */ if (_1 === 5) { $s = 9; continue; }
			/* */ $s = 10; continue;
			/* if (_1 === 0) { */ case 2:
				err = s.readString();
				$s = 11; continue;
			/* } else if (_1 === 1) { */ case 3:
				err = s.readNumber();
				$s = 11; continue;
			/* } else if (_1 === 2) { */ case 4:
				_r = s.readMap(); /* */ $s = 12; case 12: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				err = _r;
				$s = 11; continue;
			/* } else if (_1 === 3) { */ case 5:
				_r$1 = s.readArray(); /* */ $s = 13; case 13: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				err = _r$1;
				$s = 11; continue;
			/* } else if (_1 === 4) { */ case 6:
				s.i = s.i + (1) >> 0;
				err = (x = new EndArray.ptr(), new x.constructor.elem(x));
				$s = 11; continue;
			/* } else if (_1 === 6) { */ case 7:
				_r$2 = s.readBool(); /* */ $s = 14; case 14: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				err = _r$2;
				$s = 11; continue;
			/* } else if (_1 === 7) { */ case 8:
				_r$3 = s.readNull(); /* */ $s = 15; case 15: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
				err = _r$3;
				$s = 11; continue;
			/* } else if (_1 === 5) { */ case 9:
				err = errors.New("JSON should not start with escape");
				$s = 11; continue;
			/* } else { */ case 10:
				length = s.data.$length - 1 >> 0;
				idx = clamp(s.i, 0, length);
				max = clamp(idx + 10 >> 0, 0, length);
				min = clamp(idx - 10 >> 0, 0, length);
				mid = clamp(s.i + 1 >> 0, idx, length);
				b = $bytesToString($subslice(s.data, min, idx));
				c = $bytesToString($subslice(s.data, idx, mid));
				e = $bytesToString($subslice(s.data, mid, max));
				err = errors.New("Unrecognized type in '" + b + " -->" + c + "<-- " + e + "'");
			/* } */ case 11:
		case 1:
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: State.ptr.prototype.Read }; } $f.$ptr = $ptr; $f._1 = _1; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f.b = b; $f.c = c; $f.e = e; $f.err = err; $f.idx = idx; $f.length = length; $f.max = max; $f.mid = mid; $f.min = min; $f.s = s; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	State.prototype.Read = function() { return this.$val.Read(); };
	State.ptr.prototype.nextType = function() {
		var $ptr, c, s, x, x$1;
		s = this;
		while (true) {
			if (s.i >= s.data.$length) {
				return -1;
			}
			c = (x = s.data, x$1 = s.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
			switch (0) { default:
				if ((c === 32)) {
					s.i = s.i + (1) >> 0;
					break;
				} else if ((c === 9)) {
					s.i = s.i + (1) >> 0;
					break;
				} else if ((c === 34)) {
					return 0;
				} else if (48 <= c && c <= 57 || (c === 45)) {
					return 1;
				} else if ((c === 91)) {
					return 3;
				} else if ((c === 93)) {
					return 4;
				} else if ((c === 123)) {
					return 2;
				} else if ((c === 116) || (c === 84) || (c === 102) || (c === 70)) {
					return 6;
				} else if ((c === 110)) {
					return 7;
				} else {
					return -1;
				}
			}
		}
		return -1;
	};
	State.prototype.nextType = function() { return this.$val.nextType(); };
	State.ptr.prototype.readString = function() {
		var $ptr, _tmp, _tmp$1, _tuple, _tuple$1, _tuple$2, atstart, buf, c, err, escape, escaped, more, perr, r1, r2, s, start, utfstr, x, x$1, x$2, x$3, x$4, x$5;
		err = $ifaceNil;
		s = this;
		c = 0;
		start = 0;
		buf = ptrType.nil;
		atstart = false;
		more = true;
		escaped = false;
		escape = false;
		while (true) {
			if (!(atstart === false)) { break; }
			c = (x = s.data, x$1 = s.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1]));
			switch (0) { default:
				if ((c === 32)) {
					s.i = s.i + (1) >> 0;
				} else if ((c === 9)) {
					s.i = s.i + (1) >> 0;
				} else if ((c === 34)) {
					atstart = true;
					break;
				} else if ((c === 125)) {
					s.i = s.i + (1) >> 0;
					err = (x$2 = new EndMap.ptr(), new x$2.constructor.elem(x$2));
					return err;
				} else if ((c === 93)) {
					s.i = s.i + (1) >> 0;
					err = (x$3 = new EndArray.ptr(), new x$3.constructor.elem(x$3));
					return err;
				} else {
					err = errors.New("Invalid string char: " + $encodeRune(c));
					return err;
				}
			}
		}
		s.i = s.i + (1) >> 0;
		start = s.i;
		buf = new bytes.Buffer.ptr(sliceType.nil, 0, arrayType.zero(), arrayType$1.zero(), 0);
		while (true) {
			if (!(more)) { break; }
			c = (x$4 = s.data, x$5 = s.i, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5]));
			switch (0) { default:
				if (escape === false && (c === 92)) {
					escape = true;
					escaped = true;
					break;
				} else if (escape && (c === 92)) {
					escape = false;
					break;
				} else if (escape && (c === 47)) {
					buf.Write($subslice(s.data, start, (s.i - 1 >> 0)));
					start = s.i;
					escape = false;
					break;
				} else if (escape && (c === 117)) {
					buf.Write($subslice(s.data, start, (s.i - 1 >> 0)));
					_tmp = 0;
					_tmp$1 = 0;
					r1 = _tmp;
					r2 = _tmp$1;
					perr = $ifaceNil;
					_tuple = s.getSmallURune(s.i - 1 >> 0);
					r1 = _tuple[0];
					perr = _tuple[1];
					if (!($interfaceIsEqual(perr, $ifaceNil))) {
						err = perr;
						return err;
					}
					s.i = s.i + (4) >> 0;
					if (utf16.IsSurrogate(r1)) {
						_tuple$1 = s.getSmallURune(s.i + 1 >> 0);
						r2 = _tuple$1[0];
						perr = _tuple$1[1];
						if (!($interfaceIsEqual(perr, $ifaceNil))) {
							err = perr;
							return err;
						}
						buf.WriteRune(utf16.DecodeRune(r1, r2));
						s.i = s.i + (6) >> 0;
					} else {
						buf.WriteRune(r1);
					}
					start = s.i + 1 >> 0;
					escape = false;
					break;
				} else if ((c === 34)) {
					if (escape === false) {
						more = false;
					} else {
						escape = false;
					}
					break;
				} else if (s.i >= (s.data.$length - 1 >> 0)) {
					err = errors.New("No string terminator");
					return err;
				} else {
					escape = false;
					break;
				}
			}
			s.i = s.i + (1) >> 0;
		}
		buf.Write($subslice(s.data, start, (s.i - 1 >> 0)));
		s.v = new $String(buf.String());
		if (escaped) {
			utfstr = $assertType(s.v, $String);
			utfstr = "\"" + utfstr + "\"";
			_tuple$2 = strconv.Unquote(utfstr);
			s.v = new $String(_tuple$2[0]);
			err = _tuple$2[1];
			if ($interfaceIsEqual(err, $ifaceNil)) {
				s.v = new $String(decodeSurrogates($assertType(s.v, $String)));
			}
		}
		return err;
	};
	State.prototype.readString = function() { return this.$val.readString(); };
	State.ptr.prototype.getSmallURune = function(start) {
		var $ptr, _tuple, err, i, r, s, start, substr, x, x$1, x$2;
		r = 0;
		err = $ifaceNil;
		s = this;
		r = 0;
		i = new $Uint64(0, 0);
		if (!(((x = s.data, ((start < 0 || start >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + start])) === 92)) || !(((x$1 = s.data, x$2 = start + 1 >> 0, ((x$2 < 0 || x$2 >= x$1.$length) ? $throwRuntimeError("index out of range") : x$1.$array[x$1.$offset + x$2])) === 117))) {
			return [r, err];
		}
		substr = $bytesToString($subslice(s.data, (start + 2 >> 0), (start + 6 >> 0)));
		_tuple = strconv.ParseUint(substr, 16, 16);
		i = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			err = errors.New("Could not parse '\\u" + substr + "'");
		}
		r = (i.$low >> 0);
		return [r, err];
	};
	State.prototype.getSmallURune = function(start) { return this.$val.getSmallURune(start); };
	State.ptr.prototype.readNumber = function() {
		var $ptr, c, err, more, mult, places, s, val, valf, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		err = $ifaceNil;
		s = this;
		c = 0;
		val = new $Int64(0, 0);
		valf = 0;
		mult = new $Int64(0, 1);
		if ((x = s.data, x$1 = s.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])) === 45) {
			mult = new $Int64(-1, 4294967295);
			s.i = s.i + (1) >> 0;
		}
		more = true;
		places = 0;
		while (true) {
			if (!(more)) { break; }
			c = (x$2 = s.data, x$3 = s.i, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3]));
			if (48 <= c && c <= 57) {
				if (!((places === 0))) {
					places = $imul(places, (10));
				}
				val = (x$4 = $mul64(val, new $Int64(0, 10)), x$5 = new $Int64(0, (c - 48 << 24 >>> 24)), new $Int64(x$4.$high + x$5.$high, x$4.$low + x$5.$low));
			} else if ((125 === c)) {
				err = (x$6 = new EndMap.ptr(), new x$6.constructor.elem(x$6));
				more = false;
			} else if ((93 === c)) {
				err = (x$7 = new EndArray.ptr(), new x$7.constructor.elem(x$7));
				more = false;
			} else if ((44 === c)) {
				s.i = s.i - (1) >> 0;
				more = false;
			} else if ((32 === c) || (9 === c)) {
				more = false;
			} else if ((46 === c)) {
				valf = $flatten64(val);
				val = new $Int64(0, 0);
				places = 1;
			} else {
				err = errors.New("Bad num char: " + $bytesToString(new sliceType([c])));
				return err;
			}
			if (s.i >= (s.data.$length - 1 >> 0)) {
				more = false;
			}
			s.i = s.i + (1) >> 0;
		}
		if (places > 0) {
			s.v = new $Float64((valf + $flatten64(val) / places) * $flatten64(mult));
		} else {
			s.v = $mul64(val, mult);
		}
		return err;
	};
	State.prototype.readNumber = function() { return this.$val.readNumber(); };
	decodeSurrogates = function(s) {
		var $ptr, _i, _ref, _rune, buf, r, r1, s;
		r1 = 0;
		buf = new bytes.Buffer.ptr(sliceType.nil, 0, arrayType.zero(), arrayType$1.zero(), 0);
		_ref = s;
		_i = 0;
		while (true) {
			if (!(_i < _ref.length)) { break; }
			_rune = $decodeRune(_ref, _i);
			r = _rune[0];
			if (utf16.IsSurrogate(r)) {
				if (r1 === 0) {
					r1 = r;
				} else {
					buf.WriteRune(utf16.DecodeRune(r1, r));
					r1 = 0;
				}
			} else {
				if (!((r1 === 0))) {
					buf.WriteRune(r1);
					r1 = 0;
				}
				buf.WriteRune(r);
			}
			_i += _rune[1];
		}
		return buf.String();
	};
	EndMap.ptr.prototype.Error = function() {
		var $ptr, e;
		e = $clone(this, EndMap);
		return "End of map structure encountered.";
	};
	EndMap.prototype.Error = function() { return this.$val.Error(); };
	EndArray.ptr.prototype.Error = function() {
		var $ptr, e;
		e = $clone(this, EndArray);
		return "End of array structure encountered.";
	};
	EndArray.prototype.Error = function() { return this.$val.Error(); };
	State.ptr.prototype.readComma = function() {
		var $ptr, err, more, s, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		err = $ifaceNil;
		s = this;
		more = true;
		while (true) {
			if (!(more)) { break; }
			if (((x = s.data, x$1 = s.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])) === 44)) {
				more = false;
			} else if (((x$2 = s.data, x$3 = s.i, ((x$3 < 0 || x$3 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + x$3])) === 125)) {
				s.i = s.i + (1) >> 0;
				err = (x$6 = new EndMap.ptr(), new x$6.constructor.elem(x$6));
				return err;
			} else if (((x$4 = s.data, x$5 = s.i, ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5])) === 93)) {
				s.i = s.i + (1) >> 0;
				err = (x$7 = new EndArray.ptr(), new x$7.constructor.elem(x$7));
				return err;
			} else if (s.i >= (s.data.$length - 1 >> 0)) {
				err = errors.New("No comma");
				return err;
			}
			s.i = s.i + (1) >> 0;
		}
		err = $ifaceNil;
		return err;
	};
	State.prototype.readComma = function() { return this.$val.readComma(); };
	State.ptr.prototype.readColon = function() {
		var $ptr, err, more, s, x, x$1;
		err = $ifaceNil;
		s = this;
		more = true;
		while (true) {
			if (!(more)) { break; }
			if (((x = s.data, x$1 = s.i, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])) === 58)) {
				more = false;
			} else if (s.i >= (s.data.$length - 1 >> 0)) {
				err = errors.New("No colon");
				return err;
			}
			s.i = s.i + (1) >> 0;
		}
		err = $ifaceNil;
		return err;
	};
	State.prototype.readColon = function() { return this.$val.readColon(); };
	State.ptr.prototype.readMap = function() {
		var $ptr, _key, _r, _tuple, _tuple$1, _tuple$2, _tuple$3, err, key, m, ok, ok$1, ok$2, ok$3, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; err = $f.err; key = $f.key; m = $f.m; ok = $f.ok; ok$1 = $f.ok$1; ok$2 = $f.ok$2; ok$3 = $f.ok$3; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		s = this;
		s.i = s.i + (1) >> 0;
		m = false;
		key = "";
		m = {};
		/* while (true) { */ case 1:
			err = s.readString();
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				_tuple = $assertType(err, EndMap, true);
				ok = _tuple[1];
				if (!ok) {
					return err;
				}
				/* break; */ $s = 2; continue;
			}
			key = $assertType(s.v, $String);
			err = s.readColon();
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return err;
			}
			_r = s.Read(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			err = _r;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				_tuple$1 = $assertType(err, EndMap, true);
				ok$1 = _tuple$1[1];
				if (!ok$1) {
					return err;
				}
			}
			_key = key; (m || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: s.v };
			_tuple$2 = $assertType(err, EndMap, true);
			ok$2 = _tuple$2[1];
			if (ok$2) {
				/* break; */ $s = 2; continue;
			}
			err = s.readComma();
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				_tuple$3 = $assertType(err, EndMap, true);
				ok$3 = _tuple$3[1];
				if (ok$3) {
					/* break; */ $s = 2; continue;
				}
				return err;
			}
		/* } */ $s = 1; continue; case 2:
		s.v = new mapType(m);
		err = $ifaceNil;
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: State.ptr.prototype.readMap }; } $f.$ptr = $ptr; $f._key = _key; $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f.err = err; $f.key = key; $f.m = m; $f.ok = ok; $f.ok$1 = ok$1; $f.ok$2 = ok$2; $f.ok$3 = ok$3; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	State.prototype.readMap = function() { return this.$val.readMap(); };
	State.ptr.prototype.readArray = function() {
		var $ptr, _r, _tuple, _tuple$1, _tuple$2, a, c, err, ok, ok$1, ok$2, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; a = $f.a; c = $f.c; err = $f.err; ok = $f.ok; ok$1 = $f.ok$1; ok$2 = $f.ok$2; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		s = this;
		s.i = s.i + (1) >> 0;
		a = sliceType$1.nil;
		c = 0;
		a = $makeSlice(sliceType$1, 0, 10);
		/* while (true) { */ case 1:
			_r = s.Read(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			err = _r;
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				_tuple = $assertType(err, EndArray, true);
				ok = _tuple[1];
				if (!ok) {
					return err;
				}
				if (c === 0) {
					/* break; */ $s = 2; continue;
				}
			}
			a = $append(a, s.v);
			c = c + (1) >>> 0;
			_tuple$1 = $assertType(err, EndArray, true);
			ok$1 = _tuple$1[1];
			if (ok$1) {
				/* break; */ $s = 2; continue;
			}
			err = s.readComma();
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				_tuple$2 = $assertType(err, EndArray, true);
				ok$2 = _tuple$2[1];
				if (ok$2) {
					/* break; */ $s = 2; continue;
				}
				return err;
			}
		/* } */ $s = 1; continue; case 2:
		s.v = a;
		err = $ifaceNil;
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: State.ptr.prototype.readArray }; } $f.$ptr = $ptr; $f._r = _r; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.a = a; $f.c = c; $f.err = err; $f.ok = ok; $f.ok$1 = ok$1; $f.ok$2 = ok$2; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	State.prototype.readArray = function() { return this.$val.readArray(); };
	State.ptr.prototype.readBool = function() {
		var $ptr, _r, _r$1, err, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; err = $f.err; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		s = this;
		_r = strings.ToLower($bytesToString($subslice(s.data, s.i, (s.i + 4 >> 0)))); /* */ $s = 5; case 5: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r === "true") { $s = 1; continue; }
		_r$1 = strings.ToLower($bytesToString($subslice(s.data, s.i, (s.i + 5 >> 0)))); /* */ $s = 6; case 6: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ if (_r$1 === "false") { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (_r === "true") { */ case 1:
			s.i = s.i + (4) >> 0;
			s.v = new $Bool(true);
			$s = 4; continue;
		/* } else if (_r$1 === "false") { */ case 2:
			s.i = s.i + (5) >> 0;
			s.v = new $Bool(false);
			$s = 4; continue;
		/* } else { */ case 3:
			err = errors.New("Could not parse boolean");
		/* } */ case 4:
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: State.ptr.prototype.readBool }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.err = err; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	State.prototype.readBool = function() { return this.$val.readBool(); };
	State.ptr.prototype.readNull = function() {
		var $ptr, _r, err, s, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; err = $f.err; s = $f.s; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		s = this;
		_r = strings.ToLower($bytesToString($subslice(s.data, s.i, (s.i + 4 >> 0)))); /* */ $s = 4; case 4: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ if (_r === "null") { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (_r === "null") { */ case 1:
			s.i = s.i + (4) >> 0;
			s.v = $ifaceNil;
			$s = 3; continue;
		/* } else { */ case 2:
			err = errors.New("Could not parse null");
		/* } */ case 3:
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: State.ptr.prototype.readNull }; } $f.$ptr = $ptr; $f._r = _r; $f.err = err; $f.s = s; $f.$s = $s; $f.$r = $r; return $f;
	};
	State.prototype.readNull = function() { return this.$val.readNull(); };
	Unmarshal = function(data, v) {
		var $ptr, _r, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$17, _r$18, _r$19, _r$2, _r$20, _r$21, _r$22, _r$23, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _tuple, _v, data, err, i, ismap, mapi, mapt, rv, rvt, rvte, ssv, state, sv, svt, svte, v, v$1, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$17 = $f._r$17; _r$18 = $f._r$18; _r$19 = $f._r$19; _r$2 = $f._r$2; _r$20 = $f._r$20; _r$21 = $f._r$21; _r$22 = $f._r$22; _r$23 = $f._r$23; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _tuple = $f._tuple; _v = $f._v; data = $f.data; err = $f.err; i = $f.i; ismap = $f.ismap; mapi = $f.mapi; mapt = $f.mapt; rv = $f.rv; rvt = $f.rvt; rvte = $f.rvte; ssv = $f.ssv; state = $f.state; sv = $f.sv; svt = $f.svt; svte = $f.svte; v = $f.v; v$1 = $f.v$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		state = new State.ptr(data, 0, v, $makeSlice(sliceType$2, 0, 10));
		_r = state.Read(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return err;
		}
		_r$1 = reflect.ValueOf(v); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		rv = _r$1;
		/* */ if (!((rv.Kind() === 22)) || rv.IsNil()) { $s = 3; continue; }
		/* */ $s = 4; continue;
		/* if (!((rv.Kind() === 22)) || rv.IsNil()) { */ case 3:
			_r$2 = reflect.TypeOf(v).String(); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			_r$3 = errors.New("Need a pointer, got " + _r$2); /* */ $s = 6; case 6: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			/* */ $s = 7; case 7:
			return _r$3;
		/* } */ case 4:
		/* while (true) { */ case 8:
			/* if (!(rv.Kind() === 22)) { break; } */ if(!(rv.Kind() === 22)) { $s = 9; continue; }
			_r$4 = rv.Elem(); /* */ $s = 10; case 10: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			rv = _r$4;
		/* } */ $s = 8; continue; case 9:
		_r$5 = reflect.ValueOf(state.v); /* */ $s = 11; case 11: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
		sv = _r$5;
		/* while (true) { */ case 12:
			/* if (!(sv.Kind() === 22)) { break; } */ if(!(sv.Kind() === 22)) { $s = 13; continue; }
			_r$6 = sv.Elem(); /* */ $s = 14; case 14: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
			sv = _r$6;
		/* } */ $s = 12; continue; case 13:
		rvt = rv.Type();
		svt = sv.Type();
		_r$7 = svt.AssignableTo(rvt); /* */ $s = 17; case 17: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
		/* */ if (!_r$7) { $s = 15; continue; }
		/* */ $s = 16; continue;
		/* if (!_r$7) { */ case 15:
			/* */ if (!((rv.Kind() === 23)) && !((sv.Kind() === 23))) { $s = 18; continue; }
			/* */ $s = 19; continue;
			/* if (!((rv.Kind() === 23)) && !((sv.Kind() === 23))) { */ case 18:
				_r$8 = svt.String(); /* */ $s = 20; case 20: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
				_r$9 = rvt.String(); /* */ $s = 21; case 21: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
				_r$10 = errors.New("Cannot assign " + _r$8 + " to " + _r$9); /* */ $s = 22; case 22: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
				/* */ $s = 23; case 23:
				return _r$10;
			/* } */ case 19:
			if (sv.Len() === 0) {
				return $ifaceNil;
			}
			mapi = false;
			mapt = reflect.TypeOf(new mapType(mapi));
			_r$11 = svt.Elem(); /* */ $s = 24; case 24: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
			svte = _r$11;
			_r$12 = rvt.Elem(); /* */ $s = 25; case 25: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
			rvte = _r$12;
			ismap = false;
			_r$13 = sv.Index(0); /* */ $s = 26; case 26: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
			_r$14 = _r$13.Interface(); /* */ $s = 27; case 27: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
			_tuple = $assertType(_r$14, mapType, true);
			ismap = _tuple[1];
			if (!(ismap)) { _v = false; $s = 30; continue s; }
			_r$15 = mapt.AssignableTo(rvte); /* */ $s = 31; case 31: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
			_v = _r$15; case 30:
			/* */ if (!(_v)) { $s = 28; continue; }
			/* */ $s = 29; continue;
			/* if (!(_v)) { */ case 28:
				_r$16 = svte.String(); /* */ $s = 32; case 32: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
				_r$17 = rvte.String(); /* */ $s = 33; case 33: if($c) { $c = false; _r$17 = _r$17.$blk(); } if (_r$17 && _r$17.$blk !== undefined) { break s; }
				_r$18 = errors.New("Cannot assign " + _r$16 + " to " + _r$17); /* */ $s = 34; case 34: if($c) { $c = false; _r$18 = _r$18.$blk(); } if (_r$18 && _r$18.$blk !== undefined) { break s; }
				/* */ $s = 35; case 35:
				return _r$18;
			/* } */ case 29:
			_r$19 = reflect.MakeSlice(rvt, sv.Len(), sv.Cap()); /* */ $s = 36; case 36: if($c) { $c = false; _r$19 = _r$19.$blk(); } if (_r$19 && _r$19.$blk !== undefined) { break s; }
			ssv = _r$19;
			i = 0;
			/* while (true) { */ case 37:
				/* if (!(i < sv.Len())) { break; } */ if(!(i < sv.Len())) { $s = 38; continue; }
				_r$20 = sv.Index(i); /* */ $s = 39; case 39: if($c) { $c = false; _r$20 = _r$20.$blk(); } if (_r$20 && _r$20.$blk !== undefined) { break s; }
				_r$21 = _r$20.Interface(); /* */ $s = 40; case 40: if($c) { $c = false; _r$21 = _r$21.$blk(); } if (_r$21 && _r$21.$blk !== undefined) { break s; }
				v$1 = $assertType(_r$21, mapType);
				_r$22 = ssv.Index(i); /* */ $s = 41; case 41: if($c) { $c = false; _r$22 = _r$22.$blk(); } if (_r$22 && _r$22.$blk !== undefined) { break s; }
				_r$23 = reflect.ValueOf(new mapType(v$1)); /* */ $s = 42; case 42: if($c) { $c = false; _r$23 = _r$23.$blk(); } if (_r$23 && _r$23.$blk !== undefined) { break s; }
				$r = _r$22.Set(_r$23); /* */ $s = 43; case 43: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				i = i + (1) >> 0;
			/* } */ $s = 37; continue; case 38:
			sv = ssv;
		/* } */ case 16:
		$r = rv.Set(sv); /* */ $s = 44; case 44: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Unmarshal }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$17 = _r$17; $f._r$18 = _r$18; $f._r$19 = _r$19; $f._r$2 = _r$2; $f._r$20 = _r$20; $f._r$21 = _r$21; $f._r$22 = _r$22; $f._r$23 = _r$23; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._tuple = _tuple; $f._v = _v; $f.data = data; $f.err = err; $f.i = i; $f.ismap = ismap; $f.mapi = mapi; $f.mapt = mapt; $f.rv = rv; $f.rvt = rvt; $f.rvte = rvte; $f.ssv = ssv; $f.state = state; $f.sv = sv; $f.svt = svt; $f.svte = svte; $f.v = v; $f.v$1 = v$1; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Unmarshal = Unmarshal;
	ptrType$1.methods = [{prop: "Read", name: "Read", pkg: "", typ: $funcType([], [$error], false)}, {prop: "nextType", name: "nextType", pkg: "github.com/kurrik/json", typ: $funcType([], [$Int], false)}, {prop: "readString", name: "readString", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}, {prop: "getSmallURune", name: "getSmallURune", pkg: "github.com/kurrik/json", typ: $funcType([$Int], [$Int32, $error], false)}, {prop: "readNumber", name: "readNumber", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}, {prop: "readComma", name: "readComma", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}, {prop: "readColon", name: "readColon", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}, {prop: "readMap", name: "readMap", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}, {prop: "readArray", name: "readArray", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}, {prop: "readBool", name: "readBool", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}, {prop: "readNull", name: "readNull", pkg: "github.com/kurrik/json", typ: $funcType([], [$error], false)}];
	EndMap.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	EndArray.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	Event.init([{prop: "Type", name: "Type", pkg: "", typ: $Int, tag: ""}, {prop: "Index", name: "Index", pkg: "", typ: $Int, tag: ""}]);
	State.init([{prop: "data", name: "data", pkg: "github.com/kurrik/json", typ: sliceType, tag: ""}, {prop: "i", name: "i", pkg: "github.com/kurrik/json", typ: $Int, tag: ""}, {prop: "v", name: "v", pkg: "github.com/kurrik/json", typ: $emptyInterface, tag: ""}, {prop: "events", name: "events", pkg: "github.com/kurrik/json", typ: sliceType$2, tag: ""}]);
	EndMap.init([]);
	EndArray.init([]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = errors.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = reflect.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strconv.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = utf16.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["honnef.co/go/js/util"] = (function() {
	var $pkg = {}, $init, js, EventTarget, ptrType, funcType;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	EventTarget = $pkg.EventTarget = $newType(0, $kindStruct, "util.EventTarget", "EventTarget", "honnef.co/go/js/util", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	ptrType = $ptrType(js.Object);
	funcType = $funcType([ptrType], [], false);
	EventTarget.ptr.prototype.AddEventListener = function(typ, useCapture, listener) {
		var $ptr, listener, t, typ, useCapture;
		t = $clone(this, EventTarget);
		t.Object.addEventListener($externalize(typ, $String), $externalize(listener, funcType), $externalize(useCapture, $Bool));
	};
	EventTarget.prototype.AddEventListener = function(typ, useCapture, listener) { return this.$val.AddEventListener(typ, useCapture, listener); };
	EventTarget.ptr.prototype.RemoveEventListener = function(typ, useCapture, listener) {
		var $ptr, listener, t, typ, useCapture;
		t = $clone(this, EventTarget);
		t.Object.removeEventListener($externalize(typ, $String), $externalize(listener, funcType), $externalize(useCapture, $Bool));
	};
	EventTarget.prototype.RemoveEventListener = function(typ, useCapture, listener) { return this.$val.RemoveEventListener(typ, useCapture, listener); };
	EventTarget.methods = [{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType], [], false)}];
	EventTarget.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["honnef.co/go/js/xhr"] = (function() {
	var $pkg = {}, $init, errors, js, util, Request, Upload, sliceType, ptrType, ptrType$1, ptrType$2, chanType, NewRequest, Send;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	util = $packages["honnef.co/go/js/util"];
	Request = $pkg.Request = $newType(0, $kindStruct, "xhr.Request", "Request", "honnef.co/go/js/xhr", function(Object_, EventTarget_, ReadyState_, Response_, ResponseText_, ResponseType_, ResponseXML_, Status_, StatusText_, Timeout_, WithCredentials_, ch_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.EventTarget = new util.EventTarget.ptr(null);
			this.ReadyState = 0;
			this.Response = null;
			this.ResponseText = "";
			this.ResponseType = "";
			this.ResponseXML = null;
			this.Status = 0;
			this.StatusText = "";
			this.Timeout = 0;
			this.WithCredentials = false;
			this.ch = $chanNil;
			return;
		}
		this.Object = Object_;
		this.EventTarget = EventTarget_;
		this.ReadyState = ReadyState_;
		this.Response = Response_;
		this.ResponseText = ResponseText_;
		this.ResponseType = ResponseType_;
		this.ResponseXML = ResponseXML_;
		this.Status = Status_;
		this.StatusText = StatusText_;
		this.Timeout = Timeout_;
		this.WithCredentials = WithCredentials_;
		this.ch = ch_;
	});
	Upload = $pkg.Upload = $newType(0, $kindStruct, "xhr.Upload", "Upload", "honnef.co/go/js/xhr", function(Object_, EventTarget_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.EventTarget = new util.EventTarget.ptr(null);
			return;
		}
		this.Object = Object_;
		this.EventTarget = EventTarget_;
	});
	sliceType = $sliceType($Uint8);
	ptrType = $ptrType(Upload);
	ptrType$1 = $ptrType(Request);
	ptrType$2 = $ptrType(js.Object);
	chanType = $chanType($error, false, false);
	Request.ptr.prototype.Upload = function() {
		var $ptr, o, r;
		r = this;
		o = r.Object.upload;
		return new Upload.ptr(o, new util.EventTarget.ptr(o));
	};
	Request.prototype.Upload = function() { return this.$val.Upload(); };
	NewRequest = function(method, url) {
		var $ptr, method, o, r, url;
		o = new ($global.XMLHttpRequest)();
		r = new Request.ptr(o, new util.EventTarget.ptr(o), 0, null, "", "", null, 0, "", 0, false, $chanNil);
		r.Object.open($externalize(method, $String), $externalize(url, $String), $externalize(true, $Bool));
		return r;
	};
	$pkg.NewRequest = NewRequest;
	Request.ptr.prototype.ResponseHeaders = function() {
		var $ptr, r;
		r = this;
		return $internalize(r.Object.getAllResponseHeaders(), $String);
	};
	Request.prototype.ResponseHeaders = function() { return this.$val.ResponseHeaders(); };
	Request.ptr.prototype.ResponseHeader = function(name) {
		var $ptr, name, r, value;
		r = this;
		value = r.Object.getResponseHeader($externalize(name, $String));
		if (value === null) {
			return "";
		}
		return $internalize(value, $String);
	};
	Request.prototype.ResponseHeader = function(name) { return this.$val.ResponseHeader(name); };
	Request.ptr.prototype.Abort = function() {
		var $ptr, _selection, r, $r;
		/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; r = $f.r; $r = $f.$r; }
		r = this;
		if (r.ch === $chanNil) {
			return;
		}
		r.Object.abort();
		_selection = $select([[r.ch, $pkg.ErrAborted], []]);
		if (_selection[0] === 0) {
		} else if (_selection[0] === 1) {
		}
		/* */ if ($f === undefined) { $f = { $blk: Request.ptr.prototype.Abort }; } $f.$ptr = $ptr; $f._selection = _selection; $f.r = r; $f.$r = $r; return $f;
	};
	Request.prototype.Abort = function() { return this.$val.Abort(); };
	Request.ptr.prototype.OverrideMimeType = function(mimetype) {
		var $ptr, mimetype, r;
		r = this;
		r.Object.overrideMimeType($externalize(mimetype, $String));
	};
	Request.prototype.OverrideMimeType = function(mimetype) { return this.$val.OverrideMimeType(mimetype); };
	Request.ptr.prototype.Send = function(data) {
		var $ptr, _r, data, r, val, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; data = $f.data; r = $f.r; val = $f.val; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		r = [r];
		r[0] = this;
		if (!(r[0].ch === $chanNil)) {
			$panic(new $String("must not use a Request for multiple requests"));
		}
		r[0].ch = new $Chan($error, 1);
		r[0].EventTarget.AddEventListener("load", false, (function(r) { return function(param) {
			var $ptr, param;
			$go((function(r) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(r[0].ch, $ifaceNil); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(r), []);
		}; })(r));
		r[0].EventTarget.AddEventListener("error", false, (function(r) { return function(o) {
			var $ptr, o;
			$go((function(r) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(r[0].ch, $pkg.ErrFailure); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(r), []);
		}; })(r));
		r[0].EventTarget.AddEventListener("timeout", false, (function(r) { return function(param) {
			var $ptr, param;
			$go((function(r) { return function $b() {
				var $ptr, $s, $r;
				/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
				$r = $send(r[0].ch, $pkg.ErrTimeout); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.$s = $s; $f.$r = $r; return $f;
			}; })(r), []);
		}; })(r));
		r[0].Object.send($externalize(data, $emptyInterface));
		_r = $recv(r[0].ch); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		val = _r[0];
		return val;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Request.ptr.prototype.Send }; } $f.$ptr = $ptr; $f._r = _r; $f.data = data; $f.r = r; $f.val = val; $f.$s = $s; $f.$r = $r; return $f;
	};
	Request.prototype.Send = function(data) { return this.$val.Send(data); };
	Request.ptr.prototype.SetRequestHeader = function(header, value) {
		var $ptr, header, r, value;
		r = this;
		r.Object.setRequestHeader($externalize(header, $String), $externalize(value, $String));
	};
	Request.prototype.SetRequestHeader = function(header, value) { return this.$val.SetRequestHeader(header, value); };
	Send = function(method, url, data) {
		var $ptr, _r, data, err, method, url, xhr, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; data = $f.data; err = $f.err; method = $f.method; url = $f.url; xhr = $f.xhr; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		xhr = NewRequest(method, url);
		xhr.Object.responseType = $externalize("arraybuffer", $String);
		_r = xhr.Send(data); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		err = _r;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [sliceType.nil, err];
		}
		return [$assertType($internalize(new ($global.Uint8Array)(xhr.Object.response), $emptyInterface), sliceType), $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Send }; } $f.$ptr = $ptr; $f._r = _r; $f.data = data; $f.err = err; $f.method = method; $f.url = url; $f.xhr = xhr; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Send = Send;
	ptrType$1.methods = [{prop: "Upload", name: "Upload", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "ResponseHeaders", name: "ResponseHeaders", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ResponseHeader", name: "ResponseHeader", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "Abort", name: "Abort", pkg: "", typ: $funcType([], [], false)}, {prop: "OverrideMimeType", name: "OverrideMimeType", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Send", name: "Send", pkg: "", typ: $funcType([$emptyInterface], [$error], false)}, {prop: "SetRequestHeader", name: "SetRequestHeader", pkg: "", typ: $funcType([$String, $String], [], false)}];
	Request.init([{prop: "Object", name: "", pkg: "", typ: ptrType$2, tag: ""}, {prop: "EventTarget", name: "", pkg: "", typ: util.EventTarget, tag: ""}, {prop: "ReadyState", name: "ReadyState", pkg: "", typ: $Int, tag: "js:\"readyState\""}, {prop: "Response", name: "Response", pkg: "", typ: ptrType$2, tag: "js:\"response\""}, {prop: "ResponseText", name: "ResponseText", pkg: "", typ: $String, tag: "js:\"responseText\""}, {prop: "ResponseType", name: "ResponseType", pkg: "", typ: $String, tag: "js:\"responseType\""}, {prop: "ResponseXML", name: "ResponseXML", pkg: "", typ: ptrType$2, tag: "js:\"responseXML\""}, {prop: "Status", name: "Status", pkg: "", typ: $Int, tag: "js:\"status\""}, {prop: "StatusText", name: "StatusText", pkg: "", typ: $String, tag: "js:\"statusText\""}, {prop: "Timeout", name: "Timeout", pkg: "", typ: $Int, tag: "js:\"timeout\""}, {prop: "WithCredentials", name: "WithCredentials", pkg: "", typ: $Bool, tag: "js:\"withCredentials\""}, {prop: "ch", name: "ch", pkg: "honnef.co/go/js/xhr", typ: chanType, tag: ""}]);
	Upload.init([{prop: "Object", name: "", pkg: "", typ: ptrType$2, tag: ""}, {prop: "EventTarget", name: "", pkg: "", typ: util.EventTarget, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = util.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.ErrAborted = errors.New("request aborted");
		$pkg.ErrTimeout = errors.New("request timed out");
		$pkg.ErrFailure = errors.New("send failed");
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/cathalgarvey/gdocstojson"] = (function() {
	var $pkg = {}, $init, errors, json, xhr, strings, GJSON, mapType, sliceType, structType, ptrType, ptrType$1, mapType$1, sliceType$1, sliceType$2, DocURLToJSONURL, JSONFromDocURL, GetSaneGDocsJSON, XHRGet, init;
	errors = $packages["errors"];
	json = $packages["github.com/kurrik/json"];
	xhr = $packages["honnef.co/go/js/xhr"];
	strings = $packages["strings"];
	GJSON = $pkg.GJSON = $newType(0, $kindStruct, "gdocstojson.GJSON", "GJSON", "github.com/cathalgarvey/gdocstojson", function(Feed_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Feed = new structType.ptr(sliceType.nil);
			return;
		}
		this.Feed = Feed_;
	});
	mapType = $mapType($String, $emptyInterface);
	sliceType = $sliceType(mapType);
	structType = $structType([{prop: "Entry", name: "Entry", pkg: "", typ: sliceType, tag: "json:\"entry\""}]);
	ptrType = $ptrType(GJSON);
	ptrType$1 = $ptrType(ptrType);
	mapType$1 = $mapType($String, $String);
	sliceType$1 = $sliceType(mapType$1);
	sliceType$2 = $sliceType($Uint8);
	DocURLToJSONURL = function(url) {
		var $ptr, _r, _r$1, pathbits, prefLen, url, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; pathbits = $f.pathbits; prefLen = $f.prefLen; url = $f.url; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (!strings.HasPrefix(url, "https://docs.google.com/spreadsheets/d/")) {
			return "";
		}
		prefLen = 39;
		url = url.substring(prefLen);
		_r = strings.Trim(url, "/"); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = strings.Split(_r, "/"); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		pathbits = _r$1;
		if (pathbits.$length === 0) {
			return "";
		}
		return "https://spreadsheets.google.com/feeds/list/" + (0 >= pathbits.$length ? $throwRuntimeError("index out of range") : pathbits.$array[pathbits.$offset + 0]) + "/od6/public/values?alt=json";
		/* */ } return; } if ($f === undefined) { $f = { $blk: DocURLToJSONURL }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.pathbits = pathbits; $f.prefLen = prefLen; $f.url = url; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.DocURLToJSONURL = DocURLToJSONURL;
	JSONFromDocURL = function(docURL, httpGetter) {
		var $ptr, _r, _r$1, _r$2, _tuple, body, docURL, err, httpGetter, jsonURL, prelim, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple = $f._tuple; body = $f.body; docURL = $f.docURL; err = $f.err; httpGetter = $f.httpGetter; jsonURL = $f.jsonURL; prelim = $f.prelim; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		prelim = [prelim];
		_r = DocURLToJSONURL(docURL); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		jsonURL = _r;
		if (jsonURL === "") {
			return [sliceType.nil, $pkg.ErrURLParseFailure];
		}
		_r$1 = httpGetter(jsonURL); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple = _r$1;
		body = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [sliceType.nil, err];
		}
		prelim[0] = new GJSON.ptr(new structType.ptr(sliceType.nil));
		prelim[0].Feed.Entry = $makeSlice(sliceType, 0);
		_r$2 = json.Unmarshal(body, (prelim.$ptr || (prelim.$ptr = new ptrType$1(function() { return this.$target[0]; }, function($v) { this.$target[0] = $v; }, prelim)))); /* */ $s = 3; case 3: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		err = _r$2;
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [sliceType.nil, err];
		}
		return [prelim[0].Feed.Entry, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: JSONFromDocURL }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple = _tuple; $f.body = body; $f.docURL = docURL; $f.err = err; $f.httpGetter = httpGetter; $f.jsonURL = jsonURL; $f.prelim = prelim; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.JSONFromDocURL = JSONFromDocURL;
	GetSaneGDocsJSON = function(htmlDocURL) {
		var $ptr, _entry, _entry$1, _i, _i$1, _key, _keys, _r, _ref, _ref$1, _ref$2, _tuple, _tuple$1, err, gJSONEntry, gJSONMap, htmlDocURL, insaneJSON, key, ok, re, returned, row, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _entry$1 = $f._entry$1; _i = $f._i; _i$1 = $f._i$1; _key = $f._key; _keys = $f._keys; _r = $f._r; _ref = $f._ref; _ref$1 = $f._ref$1; _ref$2 = $f._ref$2; _tuple = $f._tuple; _tuple$1 = $f._tuple$1; err = $f.err; gJSONEntry = $f.gJSONEntry; gJSONMap = $f.gJSONMap; htmlDocURL = $f.htmlDocURL; insaneJSON = $f.insaneJSON; key = $f.key; ok = $f.ok; re = $f.re; returned = $f.returned; row = $f.row; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = JSONFromDocURL(htmlDocURL, $pkg.PreferredGetter); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		insaneJSON = _tuple[0];
		err = _tuple[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [sliceType$1.nil, err];
		}
		returned = sliceType$1.nil;
		_ref = insaneJSON;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			row = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			re = {};
			_ref$1 = row;
			_i$1 = 0;
			_keys = $keys(_ref$1);
			while (true) {
				if (!(_i$1 < _keys.length)) { break; }
				_entry = _ref$1[_keys[_i$1]];
				if (_entry === undefined) {
					_i$1++;
					continue;
				}
				key = _entry.k;
				gJSONEntry = _entry.v;
				if (!strings.HasPrefix(key, "gsx$")) {
					_i$1++;
					continue;
				}
				_ref$2 = gJSONEntry;
				if ($assertType(_ref$2, mapType, true)[1]) {
					_tuple$1 = $assertType(gJSONEntry, mapType, true);
					gJSONMap = _tuple$1[0];
					ok = _tuple$1[1];
					if (!ok) {
						console.log("Failed to cast gJSONEntry to map");
						_i$1++;
						continue;
					}
					_key = key.substring(4); (re || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: $assertType((_entry$1 = gJSONMap[$String.keyFor("$t")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil), $String) };
				} else {
				}
				_i$1++;
			}
			returned = $append(returned, re);
			_i++;
		}
		return [returned, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: GetSaneGDocsJSON }; } $f.$ptr = $ptr; $f._entry = _entry; $f._entry$1 = _entry$1; $f._i = _i; $f._i$1 = _i$1; $f._key = _key; $f._keys = _keys; $f._r = _r; $f._ref = _ref; $f._ref$1 = _ref$1; $f._ref$2 = _ref$2; $f._tuple = _tuple; $f._tuple$1 = _tuple$1; $f.err = err; $f.gJSONEntry = gJSONEntry; $f.gJSONMap = gJSONMap; $f.htmlDocURL = htmlDocURL; $f.insaneJSON = insaneJSON; $f.key = key; $f.ok = ok; $f.re = re; $f.returned = returned; $f.row = row; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.GetSaneGDocsJSON = GetSaneGDocsJSON;
	XHRGet = function(URL) {
		var $ptr, URL, _r, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; URL = $f.URL; _r = $f._r; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = xhr.Send("GET", URL, sliceType$2.nil); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: XHRGet }; } $f.$ptr = $ptr; $f.URL = URL; $f._r = _r; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.XHRGet = XHRGet;
	init = function() {
		var $ptr;
		$pkg.PreferredGetter = XHRGet;
	};
	GJSON.init([{prop: "Feed", name: "Feed", pkg: "", typ: structType, tag: "json:\"feed\""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = json.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = xhr.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.PreferredGetter = $throwNilPointerError;
		$pkg.ErrURLParseFailure = errors.New("Failed to parse JSON Url from Doc URL");
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/gopherjs/gopherjs/nosync"] = (function() {
	var $pkg = {}, $init, Once, funcType, ptrType$3;
	Once = $pkg.Once = $newType(0, $kindStruct, "nosync.Once", "Once", "github.com/gopherjs/gopherjs/nosync", function(doing_, done_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.doing = false;
			this.done = false;
			return;
		}
		this.doing = doing_;
		this.done = done_;
	});
	funcType = $funcType([], [], false);
	ptrType$3 = $ptrType(Once);
	Once.ptr.prototype.Do = function(f) {
		var $ptr, f, o, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; f = $f.f; o = $f.o; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		o = [o];
		o[0] = this;
		if (o[0].done) {
			return;
		}
		if (o[0].doing) {
			$panic(new $String("nosync: Do called within f"));
		}
		o[0].doing = true;
		$deferred.push([(function(o) { return function() {
			var $ptr;
			o[0].doing = false;
			o[0].done = true;
		}; })(o), []]);
		$r = f(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ $s = -1; case -1: } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Once.ptr.prototype.Do }; } $f.$ptr = $ptr; $f.f = f; $f.o = o; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	Once.prototype.Do = function(f) { return this.$val.Do(f); };
	ptrType$3.methods = [{prop: "Do", name: "Do", pkg: "", typ: $funcType([funcType], [], false)}];
	Once.init([{prop: "doing", name: "doing", pkg: "github.com/gopherjs/gopherjs/nosync", typ: $Bool, tag: ""}, {prop: "done", name: "done", pkg: "github.com/gopherjs/gopherjs/nosync", typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["syscall"] = (function() {
	var $pkg = {}, $init, bytes, js, race, runtime, sync, mmapper, Errno, sliceType, sliceType$1, ptrType$2, arrayType$5, structType, ptrType$25, mapType, funcType, funcType$1, warningPrinted, lineBuffer, syscallModule, alreadyTriedToLoad, minusOne, envOnce, envLock, env, envs, mapper, errEAGAIN, errEINVAL, errENOENT, errors, init, printWarning, printToConsole, runtime_envs, syscall, Syscall, Syscall6, copyenv, Getenv, itoa, uitoa, errnoErr, munmap, mmap;
	bytes = $packages["bytes"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	race = $packages["internal/race"];
	runtime = $packages["runtime"];
	sync = $packages["sync"];
	mmapper = $pkg.mmapper = $newType(0, $kindStruct, "syscall.mmapper", "mmapper", "syscall", function(Mutex_, active_, mmap_, munmap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Mutex = new sync.Mutex.ptr(0, 0);
			this.active = false;
			this.mmap = $throwNilPointerError;
			this.munmap = $throwNilPointerError;
			return;
		}
		this.Mutex = Mutex_;
		this.active = active_;
		this.mmap = mmap_;
		this.munmap = munmap_;
	});
	Errno = $pkg.Errno = $newType(4, $kindUintptr, "syscall.Errno", "Errno", "syscall", null);
	sliceType = $sliceType($Uint8);
	sliceType$1 = $sliceType($String);
	ptrType$2 = $ptrType($Uint8);
	arrayType$5 = $arrayType($Uint8, 32);
	structType = $structType([{prop: "addr", name: "addr", pkg: "syscall", typ: $Uintptr, tag: ""}, {prop: "len", name: "len", pkg: "syscall", typ: $Int, tag: ""}, {prop: "cap", name: "cap", pkg: "syscall", typ: $Int, tag: ""}]);
	ptrType$25 = $ptrType(mmapper);
	mapType = $mapType(ptrType$2, sliceType);
	funcType = $funcType([$Uintptr, $Uintptr, $Int, $Int, $Int, $Int64], [$Uintptr, $error], false);
	funcType$1 = $funcType([$Uintptr, $Uintptr], [$error], false);
	init = function() {
		var $ptr;
		$flushConsole = (function() {
			var $ptr;
			if (!((lineBuffer.$length === 0))) {
				$global.console.log($externalize($bytesToString(lineBuffer), $String));
				lineBuffer = sliceType.nil;
			}
		});
	};
	printWarning = function() {
		var $ptr;
		if (!warningPrinted) {
			$global.console.error($externalize("warning: system calls not available, see https://github.com/gopherjs/gopherjs/blob/master/doc/syscalls.md", $String));
		}
		warningPrinted = true;
	};
	printToConsole = function(b) {
		var $ptr, b, goPrintToConsole, i;
		goPrintToConsole = $global.goPrintToConsole;
		if (!(goPrintToConsole === undefined)) {
			goPrintToConsole(b);
			return;
		}
		lineBuffer = $appendSlice(lineBuffer, b);
		while (true) {
			i = bytes.IndexByte(lineBuffer, 10);
			if (i === -1) {
				break;
			}
			$global.console.log($externalize($bytesToString($subslice(lineBuffer, 0, i)), $String));
			lineBuffer = $subslice(lineBuffer, (i + 1 >> 0));
		}
	};
	runtime_envs = function() {
		var $ptr, envkeys, envs$1, i, jsEnv, key, process;
		process = $global.process;
		if (process === undefined) {
			return sliceType$1.nil;
		}
		jsEnv = process.env;
		envkeys = $global.Object.keys(jsEnv);
		envs$1 = $makeSlice(sliceType$1, $parseInt(envkeys.length));
		i = 0;
		while (true) {
			if (!(i < $parseInt(envkeys.length))) { break; }
			key = $internalize(envkeys[i], $String);
			((i < 0 || i >= envs$1.$length) ? $throwRuntimeError("index out of range") : envs$1.$array[envs$1.$offset + i] = key + "=" + $internalize(jsEnv[$externalize(key, $String)], $String));
			i = i + (1) >> 0;
		}
		return envs$1;
	};
	syscall = function(name) {
		var $ptr, name, require, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		$deferred.push([(function() {
			var $ptr;
			$recover();
		}), []]);
		if (syscallModule === null) {
			if (alreadyTriedToLoad) {
				return null;
			}
			alreadyTriedToLoad = true;
			require = $global.require;
			if (require === undefined) {
				$panic(new $String(""));
			}
			syscallModule = require($externalize("syscall", $String));
		}
		return syscallModule[$externalize(name, $String)];
		/* */ } catch(err) { $err = err; return null; } finally { $callDeferred($deferred, $err); }
	};
	Syscall = function(trap, a1, a2, a3) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, a1, a2, a3, array, err, f, r, r1, r2, slice, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if ((trap === 1) && ((a1 === 1) || (a1 === 2))) {
			array = a2;
			slice = $makeSlice(sliceType, $parseInt(array.length));
			slice.$array = array;
			printToConsole(slice);
			_tmp$3 = ($parseInt(array.length) >>> 0);
			_tmp$4 = 0;
			_tmp$5 = 0;
			r1 = _tmp$3;
			r2 = _tmp$4;
			err = _tmp$5;
			return [r1, r2, err];
		}
		if (trap === 60) {
			runtime.Goexit();
		}
		printWarning();
		_tmp$6 = (minusOne >>> 0);
		_tmp$7 = 0;
		_tmp$8 = 13;
		r1 = _tmp$6;
		r2 = _tmp$7;
		err = _tmp$8;
		return [r1, r2, err];
	};
	$pkg.Syscall = Syscall;
	Syscall6 = function(trap, a1, a2, a3, a4, a5, a6) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, a1, a2, a3, a4, a5, a6, err, f, r, r1, r2, trap;
		r1 = 0;
		r2 = 0;
		err = 0;
		f = syscall("Syscall6");
		if (!(f === null)) {
			r = f(trap, a1, a2, a3, a4, a5, a6);
			_tmp = (($parseInt(r[0]) >> 0) >>> 0);
			_tmp$1 = (($parseInt(r[1]) >> 0) >>> 0);
			_tmp$2 = (($parseInt(r[2]) >> 0) >>> 0);
			r1 = _tmp;
			r2 = _tmp$1;
			err = _tmp$2;
			return [r1, r2, err];
		}
		if (!((trap === 202))) {
			printWarning();
		}
		_tmp$3 = (minusOne >>> 0);
		_tmp$4 = 0;
		_tmp$5 = 13;
		r1 = _tmp$3;
		r2 = _tmp$4;
		err = _tmp$5;
		return [r1, r2, err];
	};
	$pkg.Syscall6 = Syscall6;
	copyenv = function() {
		var $ptr, _entry, _i, _key, _ref, _tuple, i, j, key, ok, s;
		env = {};
		_ref = envs;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			s = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			j = 0;
			while (true) {
				if (!(j < s.length)) { break; }
				if (s.charCodeAt(j) === 61) {
					key = s.substring(0, j);
					_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
					ok = _tuple[1];
					if (!ok) {
						_key = key; (env || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: i };
					} else {
						((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i] = "");
					}
					break;
				}
				j = j + (1) >> 0;
			}
			_i++;
		}
	};
	Getenv = function(key) {
		var $ptr, _entry, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tuple, found, i, i$1, key, ok, s, value, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tuple = $f._tuple; found = $f.found; i = $f.i; i$1 = $f.i$1; key = $f.key; ok = $f.ok; s = $f.s; value = $f.value; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		value = "";
		found = false;
		$r = envOnce.Do(copyenv); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		if (key.length === 0) {
			_tmp = "";
			_tmp$1 = false;
			value = _tmp;
			found = _tmp$1;
			return [value, found];
		}
		$r = envLock.RLock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(envLock, "RUnlock"), []]);
		_tuple = (_entry = env[$String.keyFor(key)], _entry !== undefined ? [_entry.v, true] : [0, false]);
		i = _tuple[0];
		ok = _tuple[1];
		if (!ok) {
			_tmp$2 = "";
			_tmp$3 = false;
			value = _tmp$2;
			found = _tmp$3;
			return [value, found];
		}
		s = ((i < 0 || i >= envs.$length) ? $throwRuntimeError("index out of range") : envs.$array[envs.$offset + i]);
		i$1 = 0;
		while (true) {
			if (!(i$1 < s.length)) { break; }
			if (s.charCodeAt(i$1) === 61) {
				_tmp$4 = s.substring((i$1 + 1 >> 0));
				_tmp$5 = true;
				value = _tmp$4;
				found = _tmp$5;
				return [value, found];
			}
			i$1 = i$1 + (1) >> 0;
		}
		_tmp$6 = "";
		_tmp$7 = false;
		value = _tmp$6;
		found = _tmp$7;
		return [value, found];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [value, found]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: Getenv }; } $f.$ptr = $ptr; $f._entry = _entry; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tuple = _tuple; $f.found = found; $f.i = i; $f.i$1 = i$1; $f.key = key; $f.ok = ok; $f.s = s; $f.value = value; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	$pkg.Getenv = Getenv;
	itoa = function(val) {
		var $ptr, val;
		if (val < 0) {
			return "-" + uitoa((-val >>> 0));
		}
		return uitoa((val >>> 0));
	};
	uitoa = function(val) {
		var $ptr, _q, _r, buf, i, val;
		buf = arrayType$5.zero();
		i = 31;
		while (true) {
			if (!(val >= 10)) { break; }
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((_r = val % 10, _r === _r ? _r : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			i = i - (1) >> 0;
			val = (_q = val / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((val + 48 >>> 0) << 24 >>> 24));
		return $bytesToString($subslice(new sliceType(buf), i));
	};
	mmapper.ptr.prototype.Mmap = function(fd, offset, length, prot, flags) {
		var $ptr, _key, _r, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple, addr, b, data, err, errno, fd, flags, length, m, offset, p, prot, sl, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _key = $f._key; _r = $f._r; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple = $f._tuple; addr = $f.addr; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; fd = $f.fd; flags = $f.flags; length = $f.length; m = $f.m; offset = $f.offset; p = $f.p; prot = $f.prot; sl = $f.sl; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		sl = [sl];
		data = sliceType.nil;
		err = $ifaceNil;
		m = this;
		if (length <= 0) {
			_tmp = sliceType.nil;
			_tmp$1 = new Errno(22);
			data = _tmp;
			err = _tmp$1;
			return [data, err];
		}
		_r = m.mmap(0, (length >>> 0), prot, flags, fd, offset); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		addr = _tuple[0];
		errno = _tuple[1];
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			_tmp$2 = sliceType.nil;
			_tmp$3 = errno;
			data = _tmp$2;
			err = _tmp$3;
			return [data, err];
		}
		sl[0] = new structType.ptr(addr, length, length);
		b = sl[0];
		p = $indexPtr(b.$array, b.$offset + (b.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		_key = p; (m.active || $throwRuntimeError("assignment to entry in nil map"))[ptrType$2.keyFor(_key)] = { k: _key, v: b };
		_tmp$4 = b;
		_tmp$5 = $ifaceNil;
		data = _tmp$4;
		err = _tmp$5;
		return [data, err];
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  [data, err]; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Mmap }; } $f.$ptr = $ptr; $f._key = _key; $f._r = _r; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple = _tuple; $f.addr = addr; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.fd = fd; $f.flags = flags; $f.length = length; $f.m = m; $f.offset = offset; $f.p = p; $f.prot = prot; $f.sl = sl; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Mmap = function(fd, offset, length, prot, flags) { return this.$val.Mmap(fd, offset, length, prot, flags); };
	mmapper.ptr.prototype.Munmap = function(data) {
		var $ptr, _entry, _r, b, data, err, errno, m, p, $s, $deferred, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _entry = $f._entry; _r = $f._r; b = $f.b; data = $f.data; err = $f.err; errno = $f.errno; m = $f.m; p = $f.p; $s = $f.$s; $deferred = $f.$deferred; $r = $f.$r; } var $err = null; try { s: while (true) { switch ($s) { case 0: $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		m = this;
		if ((data.$length === 0) || !((data.$length === data.$capacity))) {
			err = new Errno(22);
			return err;
		}
		p = $indexPtr(data.$array, data.$offset + (data.$capacity - 1 >> 0), ptrType$2);
		$r = m.Mutex.Lock(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$deferred.push([$methodVal(m.Mutex, "Unlock"), []]);
		b = (_entry = m.active[ptrType$2.keyFor(p)], _entry !== undefined ? _entry.v : sliceType.nil);
		if (b === sliceType.nil || !($indexPtr(b.$array, b.$offset + 0, ptrType$2) === $indexPtr(data.$array, data.$offset + 0, ptrType$2))) {
			err = new Errno(22);
			return err;
		}
		_r = m.munmap($sliceToArray(b), (b.$length >>> 0)); /* */ $s = 2; case 2: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		errno = _r;
		if (!($interfaceIsEqual(errno, $ifaceNil))) {
			err = errno;
			return err;
		}
		delete m.active[ptrType$2.keyFor(p)];
		err = $ifaceNil;
		return err;
		/* */ } return; } } catch(err) { $err = err; $s = -1; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } if($curGoroutine.asleep) { if ($f === undefined) { $f = { $blk: mmapper.ptr.prototype.Munmap }; } $f.$ptr = $ptr; $f._entry = _entry; $f._r = _r; $f.b = b; $f.data = data; $f.err = err; $f.errno = errno; $f.m = m; $f.p = p; $f.$s = $s; $f.$deferred = $deferred; $f.$r = $r; return $f; } }
	};
	mmapper.prototype.Munmap = function(data) { return this.$val.Munmap(data); };
	Errno.prototype.Error = function() {
		var $ptr, e, s;
		e = this.$val;
		if (0 <= (e >> 0) && (e >> 0) < 133) {
			s = ((e < 0 || e >= errors.length) ? $throwRuntimeError("index out of range") : errors[e]);
			if (!(s === "")) {
				return s;
			}
		}
		return "errno " + itoa((e >> 0));
	};
	$ptrType(Errno).prototype.Error = function() { return new Errno(this.$get()).Error(); };
	Errno.prototype.Temporary = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 4) || (e === 24) || (e === 104) || (e === 103) || new Errno(e).Timeout();
	};
	$ptrType(Errno).prototype.Temporary = function() { return new Errno(this.$get()).Temporary(); };
	Errno.prototype.Timeout = function() {
		var $ptr, e;
		e = this.$val;
		return (e === 11) || (e === 11) || (e === 110);
	};
	$ptrType(Errno).prototype.Timeout = function() { return new Errno(this.$get()).Timeout(); };
	errnoErr = function(e) {
		var $ptr, _1, e;
		_1 = e;
		if (_1 === 0) {
			return $ifaceNil;
		} else if (_1 === 11) {
			return errEAGAIN;
		} else if (_1 === 22) {
			return errEINVAL;
		} else if (_1 === 2) {
			return errENOENT;
		}
		return new Errno(e);
	};
	munmap = function(addr, length) {
		var $ptr, _tuple, addr, e1, err, length;
		err = $ifaceNil;
		_tuple = Syscall(11, addr, length, 0);
		e1 = _tuple[2];
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return err;
	};
	mmap = function(addr, length, prot, flags, fd, offset) {
		var $ptr, _tuple, addr, e1, err, fd, flags, length, offset, prot, r0, xaddr;
		xaddr = 0;
		err = $ifaceNil;
		_tuple = Syscall6(9, addr, length, (prot >>> 0), (flags >>> 0), (fd >>> 0), (offset.$low >>> 0));
		r0 = _tuple[0];
		e1 = _tuple[2];
		xaddr = r0;
		if (!((e1 === 0))) {
			err = errnoErr(e1);
		}
		return [xaddr, err];
	};
	ptrType$25.methods = [{prop: "Mmap", name: "Mmap", pkg: "", typ: $funcType([$Int, $Int64, $Int, $Int, $Int], [sliceType, $error], false)}, {prop: "Munmap", name: "Munmap", pkg: "", typ: $funcType([sliceType], [$error], false)}];
	Errno.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Temporary", name: "Temporary", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Timeout", name: "Timeout", pkg: "", typ: $funcType([], [$Bool], false)}];
	mmapper.init([{prop: "Mutex", name: "", pkg: "", typ: sync.Mutex, tag: ""}, {prop: "active", name: "active", pkg: "syscall", typ: mapType, tag: ""}, {prop: "mmap", name: "mmap", pkg: "syscall", typ: funcType, tag: ""}, {prop: "munmap", name: "munmap", pkg: "syscall", typ: funcType$1, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = bytes.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = race.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = sync.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		lineBuffer = sliceType.nil;
		syscallModule = null;
		envOnce = new sync.Once.ptr(new sync.Mutex.ptr(0, 0), 0);
		envLock = new sync.RWMutex.ptr(new sync.Mutex.ptr(0, 0), 0, 0, 0, 0);
		env = false;
		warningPrinted = false;
		alreadyTriedToLoad = false;
		minusOne = -1;
		envs = runtime_envs();
		errEAGAIN = new Errno(11);
		errEINVAL = new Errno(22);
		errENOENT = new Errno(2);
		errors = $toNativeArray($kindString, ["", "operation not permitted", "no such file or directory", "no such process", "interrupted system call", "input/output error", "no such device or address", "argument list too long", "exec format error", "bad file descriptor", "no child processes", "resource temporarily unavailable", "cannot allocate memory", "permission denied", "bad address", "block device required", "device or resource busy", "file exists", "invalid cross-device link", "no such device", "not a directory", "is a directory", "invalid argument", "too many open files in system", "too many open files", "inappropriate ioctl for device", "text file busy", "file too large", "no space left on device", "illegal seek", "read-only file system", "too many links", "broken pipe", "numerical argument out of domain", "numerical result out of range", "resource deadlock avoided", "file name too long", "no locks available", "function not implemented", "directory not empty", "too many levels of symbolic links", "", "no message of desired type", "identifier removed", "channel number out of range", "level 2 not synchronized", "level 3 halted", "level 3 reset", "link number out of range", "protocol driver not attached", "no CSI structure available", "level 2 halted", "invalid exchange", "invalid request descriptor", "exchange full", "no anode", "invalid request code", "invalid slot", "", "bad font file format", "device not a stream", "no data available", "timer expired", "out of streams resources", "machine is not on the network", "package not installed", "object is remote", "link has been severed", "advertise error", "srmount error", "communication error on send", "protocol error", "multihop attempted", "RFS specific error", "bad message", "value too large for defined data type", "name not unique on network", "file descriptor in bad state", "remote address changed", "can not access a needed shared library", "accessing a corrupted shared library", ".lib section in a.out corrupted", "attempting to link in too many shared libraries", "cannot exec a shared library directly", "invalid or incomplete multibyte or wide character", "interrupted system call should be restarted", "streams pipe error", "too many users", "socket operation on non-socket", "destination address required", "message too long", "protocol wrong type for socket", "protocol not available", "protocol not supported", "socket type not supported", "operation not supported", "protocol family not supported", "address family not supported by protocol", "address already in use", "cannot assign requested address", "network is down", "network is unreachable", "network dropped connection on reset", "software caused connection abort", "connection reset by peer", "no buffer space available", "transport endpoint is already connected", "transport endpoint is not connected", "cannot send after transport endpoint shutdown", "too many references: cannot splice", "connection timed out", "connection refused", "host is down", "no route to host", "operation already in progress", "operation now in progress", "stale NFS file handle", "structure needs cleaning", "not a XENIX named type file", "no XENIX semaphores available", "is a named type file", "remote I/O error", "disk quota exceeded", "no medium found", "wrong medium type", "operation canceled", "required key not available", "key has expired", "key has been revoked", "key was rejected by service", "owner died", "state not recoverable", "operation not possible due to RF-kill"]);
		mapper = new mmapper.ptr(new sync.Mutex.ptr(0, 0), {}, mmap, munmap);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["time"] = (function() {
	var $pkg = {}, $init, errors, js, nosync, runtime, strings, syscall, runtimeTimer, ParseError, Timer, Time, Month, Weekday, Duration, Location, zone, zoneTrans, sliceType, sliceType$1, ptrType, sliceType$2, arrayType, sliceType$3, arrayType$1, arrayType$2, ptrType$1, chanType, arrayType$4, funcType$1, ptrType$2, ptrType$3, ptrType$4, chanType$1, ptrType$6, std0x, longDayNames, shortDayNames, shortMonthNames, longMonthNames, atoiError, errBad, errLeadingInt, months, days, daysBefore, utcLoc, utcLoc$24ptr, localLoc, localLoc$24ptr, localOnce, zoneinfo, badData, zoneDirs, _tuple, _r, init, initLocal, runtimeNano, now, startTimer, stopTimer, startsWithLowerCase, nextStdChunk, match, lookup, appendInt, atoi, formatNano, quote, isDigit, getnum, cutspace, skip, Parse, parse, parseTimeZone, parseGMT, parseNanoseconds, leadingInt, when, NewTimer, sendTime, After, absWeekday, absClock, fmtFrac, fmtInt, absDate, daysIn, Now, Unix, isLeap, norm, Date, div, FixedZone;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	nosync = $packages["github.com/gopherjs/gopherjs/nosync"];
	runtime = $packages["runtime"];
	strings = $packages["strings"];
	syscall = $packages["syscall"];
	runtimeTimer = $pkg.runtimeTimer = $newType(0, $kindStruct, "time.runtimeTimer", "runtimeTimer", "time", function(i_, when_, period_, f_, arg_, timeout_, active_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.i = 0;
			this.when = new $Int64(0, 0);
			this.period = new $Int64(0, 0);
			this.f = $throwNilPointerError;
			this.arg = $ifaceNil;
			this.timeout = null;
			this.active = false;
			return;
		}
		this.i = i_;
		this.when = when_;
		this.period = period_;
		this.f = f_;
		this.arg = arg_;
		this.timeout = timeout_;
		this.active = active_;
	});
	ParseError = $pkg.ParseError = $newType(0, $kindStruct, "time.ParseError", "ParseError", "time", function(Layout_, Value_, LayoutElem_, ValueElem_, Message_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Layout = "";
			this.Value = "";
			this.LayoutElem = "";
			this.ValueElem = "";
			this.Message = "";
			return;
		}
		this.Layout = Layout_;
		this.Value = Value_;
		this.LayoutElem = LayoutElem_;
		this.ValueElem = ValueElem_;
		this.Message = Message_;
	});
	Timer = $pkg.Timer = $newType(0, $kindStruct, "time.Timer", "Timer", "time", function(C_, r_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.C = $chanNil;
			this.r = new runtimeTimer.ptr(0, new $Int64(0, 0), new $Int64(0, 0), $throwNilPointerError, $ifaceNil, null, false);
			return;
		}
		this.C = C_;
		this.r = r_;
	});
	Time = $pkg.Time = $newType(0, $kindStruct, "time.Time", "Time", "time", function(sec_, nsec_, loc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.sec = new $Int64(0, 0);
			this.nsec = 0;
			this.loc = ptrType$1.nil;
			return;
		}
		this.sec = sec_;
		this.nsec = nsec_;
		this.loc = loc_;
	});
	Month = $pkg.Month = $newType(4, $kindInt, "time.Month", "Month", "time", null);
	Weekday = $pkg.Weekday = $newType(4, $kindInt, "time.Weekday", "Weekday", "time", null);
	Duration = $pkg.Duration = $newType(8, $kindInt64, "time.Duration", "Duration", "time", null);
	Location = $pkg.Location = $newType(0, $kindStruct, "time.Location", "Location", "time", function(name_, zone_, tx_, cacheStart_, cacheEnd_, cacheZone_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.zone = sliceType.nil;
			this.tx = sliceType$1.nil;
			this.cacheStart = new $Int64(0, 0);
			this.cacheEnd = new $Int64(0, 0);
			this.cacheZone = ptrType.nil;
			return;
		}
		this.name = name_;
		this.zone = zone_;
		this.tx = tx_;
		this.cacheStart = cacheStart_;
		this.cacheEnd = cacheEnd_;
		this.cacheZone = cacheZone_;
	});
	zone = $pkg.zone = $newType(0, $kindStruct, "time.zone", "zone", "time", function(name_, offset_, isDST_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.name = "";
			this.offset = 0;
			this.isDST = false;
			return;
		}
		this.name = name_;
		this.offset = offset_;
		this.isDST = isDST_;
	});
	zoneTrans = $pkg.zoneTrans = $newType(0, $kindStruct, "time.zoneTrans", "zoneTrans", "time", function(when_, index_, isstd_, isutc_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.when = new $Int64(0, 0);
			this.index = 0;
			this.isstd = false;
			this.isutc = false;
			return;
		}
		this.when = when_;
		this.index = index_;
		this.isstd = isstd_;
		this.isutc = isutc_;
	});
	sliceType = $sliceType(zone);
	sliceType$1 = $sliceType(zoneTrans);
	ptrType = $ptrType(zone);
	sliceType$2 = $sliceType($String);
	arrayType = $arrayType($Uint8, 20);
	sliceType$3 = $sliceType($Uint8);
	arrayType$1 = $arrayType($Uint8, 9);
	arrayType$2 = $arrayType($Uint8, 64);
	ptrType$1 = $ptrType(Location);
	chanType = $chanType(Time, false, false);
	arrayType$4 = $arrayType($Uint8, 32);
	funcType$1 = $funcType([$emptyInterface, $Uintptr], [], false);
	ptrType$2 = $ptrType(js.Object);
	ptrType$3 = $ptrType(ParseError);
	ptrType$4 = $ptrType(Timer);
	chanType$1 = $chanType(Time, false, true);
	ptrType$6 = $ptrType(Time);
	init = function() {
		var $ptr;
		Unix(new $Int64(0, 0), new $Int64(0, 0));
	};
	initLocal = function() {
		var $ptr, d, i, j, s;
		d = new ($global.Date)();
		s = $internalize(d, $String);
		i = strings.IndexByte(s, 40);
		j = strings.IndexByte(s, 41);
		if ((i === -1) || (j === -1)) {
			localLoc.name = "UTC";
			return;
		}
		localLoc.name = s.substring((i + 1 >> 0), j);
		localLoc.zone = new sliceType([new zone.ptr(localLoc.name, $imul(($parseInt(d.getTimezoneOffset()) >> 0), -60), false)]);
	};
	runtimeNano = function() {
		var $ptr;
		return $mul64($internalize(new ($global.Date)().getTime(), $Int64), new $Int64(0, 1000000));
	};
	now = function() {
		var $ptr, _tmp, _tmp$1, n, nsec, sec, x;
		sec = new $Int64(0, 0);
		nsec = 0;
		n = runtimeNano();
		_tmp = $div64(n, new $Int64(0, 1000000000), false);
		_tmp$1 = ((x = $div64(n, new $Int64(0, 1000000000), true), x.$low + ((x.$high >> 31) * 4294967296)) >> 0);
		sec = _tmp;
		nsec = _tmp$1;
		return [sec, nsec];
	};
	startTimer = function(t) {
		var $ptr, diff, t, x, x$1;
		t.active = true;
		diff = $div64(((x = t.when, x$1 = runtimeNano(), new $Int64(x.$high - x$1.$high, x.$low - x$1.$low))), new $Int64(0, 1000000), false);
		if ((diff.$high > 0 || (diff.$high === 0 && diff.$low > 2147483647))) {
			return;
		}
		if ((diff.$high < 0 || (diff.$high === 0 && diff.$low < 0))) {
			diff = new $Int64(0, 0);
		}
		t.timeout = $setTimeout((function() {
			var $ptr, x$2, x$3, x$4;
			t.active = false;
			$go(t.f, [t.arg, 0]);
			if (!((x$2 = t.period, (x$2.$high === 0 && x$2.$low === 0)))) {
				t.when = (x$3 = t.when, x$4 = t.period, new $Int64(x$3.$high + x$4.$high, x$3.$low + x$4.$low));
				startTimer(t);
			}
		}), $externalize(new $Int64(diff.$high + 0, diff.$low + 1), $Int64));
	};
	stopTimer = function(t) {
		var $ptr, t, wasActive;
		$global.clearTimeout(t.timeout);
		wasActive = t.active;
		t.active = false;
		return wasActive;
	};
	startsWithLowerCase = function(str) {
		var $ptr, c, str;
		if (str.length === 0) {
			return false;
		}
		c = str.charCodeAt(0);
		return 97 <= c && c <= 122;
	};
	nextStdChunk = function(layout) {
		var $ptr, _1, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$44, _tmp$45, _tmp$46, _tmp$47, _tmp$48, _tmp$49, _tmp$5, _tmp$50, _tmp$51, _tmp$52, _tmp$53, _tmp$54, _tmp$55, _tmp$56, _tmp$57, _tmp$58, _tmp$59, _tmp$6, _tmp$60, _tmp$61, _tmp$62, _tmp$63, _tmp$64, _tmp$65, _tmp$66, _tmp$67, _tmp$68, _tmp$69, _tmp$7, _tmp$70, _tmp$71, _tmp$72, _tmp$73, _tmp$74, _tmp$75, _tmp$76, _tmp$77, _tmp$78, _tmp$79, _tmp$8, _tmp$80, _tmp$81, _tmp$82, _tmp$83, _tmp$84, _tmp$85, _tmp$86, _tmp$9, c, ch, i, j, layout, prefix, std, std$1, suffix, x;
		prefix = "";
		std = 0;
		suffix = "";
		i = 0;
		while (true) {
			if (!(i < layout.length)) { break; }
			c = (layout.charCodeAt(i) >> 0);
			_1 = c;
			if (_1 === 74) {
				if (layout.length >= (i + 3 >> 0) && layout.substring(i, (i + 3 >> 0)) === "Jan") {
					if (layout.length >= (i + 7 >> 0) && layout.substring(i, (i + 7 >> 0)) === "January") {
						_tmp = layout.substring(0, i);
						_tmp$1 = 257;
						_tmp$2 = layout.substring((i + 7 >> 0));
						prefix = _tmp;
						std = _tmp$1;
						suffix = _tmp$2;
						return [prefix, std, suffix];
					}
					if (!startsWithLowerCase(layout.substring((i + 3 >> 0)))) {
						_tmp$3 = layout.substring(0, i);
						_tmp$4 = 258;
						_tmp$5 = layout.substring((i + 3 >> 0));
						prefix = _tmp$3;
						std = _tmp$4;
						suffix = _tmp$5;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === 77) {
				if (layout.length >= (i + 3 >> 0)) {
					if (layout.substring(i, (i + 3 >> 0)) === "Mon") {
						if (layout.length >= (i + 6 >> 0) && layout.substring(i, (i + 6 >> 0)) === "Monday") {
							_tmp$6 = layout.substring(0, i);
							_tmp$7 = 261;
							_tmp$8 = layout.substring((i + 6 >> 0));
							prefix = _tmp$6;
							std = _tmp$7;
							suffix = _tmp$8;
							return [prefix, std, suffix];
						}
						if (!startsWithLowerCase(layout.substring((i + 3 >> 0)))) {
							_tmp$9 = layout.substring(0, i);
							_tmp$10 = 262;
							_tmp$11 = layout.substring((i + 3 >> 0));
							prefix = _tmp$9;
							std = _tmp$10;
							suffix = _tmp$11;
							return [prefix, std, suffix];
						}
					}
					if (layout.substring(i, (i + 3 >> 0)) === "MST") {
						_tmp$12 = layout.substring(0, i);
						_tmp$13 = 21;
						_tmp$14 = layout.substring((i + 3 >> 0));
						prefix = _tmp$12;
						std = _tmp$13;
						suffix = _tmp$14;
						return [prefix, std, suffix];
					}
				}
			} else if (_1 === 48) {
				if (layout.length >= (i + 2 >> 0) && 49 <= layout.charCodeAt((i + 1 >> 0)) && layout.charCodeAt((i + 1 >> 0)) <= 54) {
					_tmp$15 = layout.substring(0, i);
					_tmp$16 = (x = layout.charCodeAt((i + 1 >> 0)) - 49 << 24 >>> 24, ((x < 0 || x >= std0x.length) ? $throwRuntimeError("index out of range") : std0x[x]));
					_tmp$17 = layout.substring((i + 2 >> 0));
					prefix = _tmp$15;
					std = _tmp$16;
					suffix = _tmp$17;
					return [prefix, std, suffix];
				}
			} else if (_1 === 49) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 53)) {
					_tmp$18 = layout.substring(0, i);
					_tmp$19 = 522;
					_tmp$20 = layout.substring((i + 2 >> 0));
					prefix = _tmp$18;
					std = _tmp$19;
					suffix = _tmp$20;
					return [prefix, std, suffix];
				}
				_tmp$21 = layout.substring(0, i);
				_tmp$22 = 259;
				_tmp$23 = layout.substring((i + 1 >> 0));
				prefix = _tmp$21;
				std = _tmp$22;
				suffix = _tmp$23;
				return [prefix, std, suffix];
			} else if (_1 === 50) {
				if (layout.length >= (i + 4 >> 0) && layout.substring(i, (i + 4 >> 0)) === "2006") {
					_tmp$24 = layout.substring(0, i);
					_tmp$25 = 273;
					_tmp$26 = layout.substring((i + 4 >> 0));
					prefix = _tmp$24;
					std = _tmp$25;
					suffix = _tmp$26;
					return [prefix, std, suffix];
				}
				_tmp$27 = layout.substring(0, i);
				_tmp$28 = 263;
				_tmp$29 = layout.substring((i + 1 >> 0));
				prefix = _tmp$27;
				std = _tmp$28;
				suffix = _tmp$29;
				return [prefix, std, suffix];
			} else if (_1 === 95) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 50)) {
					if (layout.length >= (i + 5 >> 0) && layout.substring((i + 1 >> 0), (i + 5 >> 0)) === "2006") {
						_tmp$30 = layout.substring(0, (i + 1 >> 0));
						_tmp$31 = 273;
						_tmp$32 = layout.substring((i + 5 >> 0));
						prefix = _tmp$30;
						std = _tmp$31;
						suffix = _tmp$32;
						return [prefix, std, suffix];
					}
					_tmp$33 = layout.substring(0, i);
					_tmp$34 = 264;
					_tmp$35 = layout.substring((i + 2 >> 0));
					prefix = _tmp$33;
					std = _tmp$34;
					suffix = _tmp$35;
					return [prefix, std, suffix];
				}
			} else if (_1 === 51) {
				_tmp$36 = layout.substring(0, i);
				_tmp$37 = 523;
				_tmp$38 = layout.substring((i + 1 >> 0));
				prefix = _tmp$36;
				std = _tmp$37;
				suffix = _tmp$38;
				return [prefix, std, suffix];
			} else if (_1 === 52) {
				_tmp$39 = layout.substring(0, i);
				_tmp$40 = 525;
				_tmp$41 = layout.substring((i + 1 >> 0));
				prefix = _tmp$39;
				std = _tmp$40;
				suffix = _tmp$41;
				return [prefix, std, suffix];
			} else if (_1 === 53) {
				_tmp$42 = layout.substring(0, i);
				_tmp$43 = 527;
				_tmp$44 = layout.substring((i + 1 >> 0));
				prefix = _tmp$42;
				std = _tmp$43;
				suffix = _tmp$44;
				return [prefix, std, suffix];
			} else if (_1 === 80) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 77)) {
					_tmp$45 = layout.substring(0, i);
					_tmp$46 = 531;
					_tmp$47 = layout.substring((i + 2 >> 0));
					prefix = _tmp$45;
					std = _tmp$46;
					suffix = _tmp$47;
					return [prefix, std, suffix];
				}
			} else if (_1 === 112) {
				if (layout.length >= (i + 2 >> 0) && (layout.charCodeAt((i + 1 >> 0)) === 109)) {
					_tmp$48 = layout.substring(0, i);
					_tmp$49 = 532;
					_tmp$50 = layout.substring((i + 2 >> 0));
					prefix = _tmp$48;
					std = _tmp$49;
					suffix = _tmp$50;
					return [prefix, std, suffix];
				}
			} else if (_1 === 45) {
				if (layout.length >= (i + 7 >> 0) && layout.substring(i, (i + 7 >> 0)) === "-070000") {
					_tmp$51 = layout.substring(0, i);
					_tmp$52 = 28;
					_tmp$53 = layout.substring((i + 7 >> 0));
					prefix = _tmp$51;
					std = _tmp$52;
					suffix = _tmp$53;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && layout.substring(i, (i + 9 >> 0)) === "-07:00:00") {
					_tmp$54 = layout.substring(0, i);
					_tmp$55 = 31;
					_tmp$56 = layout.substring((i + 9 >> 0));
					prefix = _tmp$54;
					std = _tmp$55;
					suffix = _tmp$56;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && layout.substring(i, (i + 5 >> 0)) === "-0700") {
					_tmp$57 = layout.substring(0, i);
					_tmp$58 = 27;
					_tmp$59 = layout.substring((i + 5 >> 0));
					prefix = _tmp$57;
					std = _tmp$58;
					suffix = _tmp$59;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && layout.substring(i, (i + 6 >> 0)) === "-07:00") {
					_tmp$60 = layout.substring(0, i);
					_tmp$61 = 30;
					_tmp$62 = layout.substring((i + 6 >> 0));
					prefix = _tmp$60;
					std = _tmp$61;
					suffix = _tmp$62;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && layout.substring(i, (i + 3 >> 0)) === "-07") {
					_tmp$63 = layout.substring(0, i);
					_tmp$64 = 29;
					_tmp$65 = layout.substring((i + 3 >> 0));
					prefix = _tmp$63;
					std = _tmp$64;
					suffix = _tmp$65;
					return [prefix, std, suffix];
				}
			} else if (_1 === 90) {
				if (layout.length >= (i + 7 >> 0) && layout.substring(i, (i + 7 >> 0)) === "Z070000") {
					_tmp$66 = layout.substring(0, i);
					_tmp$67 = 23;
					_tmp$68 = layout.substring((i + 7 >> 0));
					prefix = _tmp$66;
					std = _tmp$67;
					suffix = _tmp$68;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 9 >> 0) && layout.substring(i, (i + 9 >> 0)) === "Z07:00:00") {
					_tmp$69 = layout.substring(0, i);
					_tmp$70 = 26;
					_tmp$71 = layout.substring((i + 9 >> 0));
					prefix = _tmp$69;
					std = _tmp$70;
					suffix = _tmp$71;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 5 >> 0) && layout.substring(i, (i + 5 >> 0)) === "Z0700") {
					_tmp$72 = layout.substring(0, i);
					_tmp$73 = 22;
					_tmp$74 = layout.substring((i + 5 >> 0));
					prefix = _tmp$72;
					std = _tmp$73;
					suffix = _tmp$74;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 6 >> 0) && layout.substring(i, (i + 6 >> 0)) === "Z07:00") {
					_tmp$75 = layout.substring(0, i);
					_tmp$76 = 25;
					_tmp$77 = layout.substring((i + 6 >> 0));
					prefix = _tmp$75;
					std = _tmp$76;
					suffix = _tmp$77;
					return [prefix, std, suffix];
				}
				if (layout.length >= (i + 3 >> 0) && layout.substring(i, (i + 3 >> 0)) === "Z07") {
					_tmp$78 = layout.substring(0, i);
					_tmp$79 = 24;
					_tmp$80 = layout.substring((i + 3 >> 0));
					prefix = _tmp$78;
					std = _tmp$79;
					suffix = _tmp$80;
					return [prefix, std, suffix];
				}
			} else if (_1 === 46) {
				if ((i + 1 >> 0) < layout.length && ((layout.charCodeAt((i + 1 >> 0)) === 48) || (layout.charCodeAt((i + 1 >> 0)) === 57))) {
					ch = layout.charCodeAt((i + 1 >> 0));
					j = i + 1 >> 0;
					while (true) {
						if (!(j < layout.length && (layout.charCodeAt(j) === ch))) { break; }
						j = j + (1) >> 0;
					}
					if (!isDigit(layout, j)) {
						std$1 = 32;
						if (layout.charCodeAt((i + 1 >> 0)) === 57) {
							std$1 = 33;
						}
						std$1 = std$1 | ((((j - ((i + 1 >> 0)) >> 0)) << 16 >> 0));
						_tmp$81 = layout.substring(0, i);
						_tmp$82 = std$1;
						_tmp$83 = layout.substring(j);
						prefix = _tmp$81;
						std = _tmp$82;
						suffix = _tmp$83;
						return [prefix, std, suffix];
					}
				}
			}
			i = i + (1) >> 0;
		}
		_tmp$84 = layout;
		_tmp$85 = 0;
		_tmp$86 = "";
		prefix = _tmp$84;
		std = _tmp$85;
		suffix = _tmp$86;
		return [prefix, std, suffix];
	};
	match = function(s1, s2) {
		var $ptr, c1, c2, i, s1, s2;
		i = 0;
		while (true) {
			if (!(i < s1.length)) { break; }
			c1 = s1.charCodeAt(i);
			c2 = s2.charCodeAt(i);
			if (!((c1 === c2))) {
				c1 = (c1 | (32)) >>> 0;
				c2 = (c2 | (32)) >>> 0;
				if (!((c1 === c2)) || c1 < 97 || c1 > 122) {
					return false;
				}
			}
			i = i + (1) >> 0;
		}
		return true;
	};
	lookup = function(tab, val) {
		var $ptr, _i, _ref, i, tab, v, val;
		_ref = tab;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			v = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			if (val.length >= v.length && match(val.substring(0, v.length), v)) {
				return [i, val.substring(v.length), $ifaceNil];
			}
			_i++;
		}
		return [-1, val, errBad];
	};
	appendInt = function(b, x, width) {
		var $ptr, _q, b, buf, i, q, u, w, width, x;
		u = (x >>> 0);
		if (x < 0) {
			b = $append(b, 45);
			u = (-x >>> 0);
		}
		buf = arrayType.zero();
		i = 20;
		while (true) {
			if (!(u >= 10)) { break; }
			i = i - (1) >> 0;
			q = (_q = u / 10, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
			((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = (((48 + u >>> 0) - (q * 10 >>> 0) >>> 0) << 24 >>> 24));
			u = q;
		}
		i = i - (1) >> 0;
		((i < 0 || i >= buf.length) ? $throwRuntimeError("index out of range") : buf[i] = ((48 + u >>> 0) << 24 >>> 24));
		w = 20 - i >> 0;
		while (true) {
			if (!(w < width)) { break; }
			b = $append(b, 48);
			w = w + (1) >> 0;
		}
		return $appendSlice(b, $subslice(new sliceType$3(buf), i));
	};
	atoi = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tuple$1, err, neg, q, rem, s, x;
		x = 0;
		err = $ifaceNil;
		neg = false;
		if (!(s === "") && ((s.charCodeAt(0) === 45) || (s.charCodeAt(0) === 43))) {
			neg = s.charCodeAt(0) === 45;
			s = s.substring(1);
		}
		_tuple$1 = leadingInt(s);
		q = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		x = ((q.$low + ((q.$high >> 31) * 4294967296)) >> 0);
		if (!($interfaceIsEqual(err, $ifaceNil)) || !(rem === "")) {
			_tmp = 0;
			_tmp$1 = atoiError;
			x = _tmp;
			err = _tmp$1;
			return [x, err];
		}
		if (neg) {
			x = -x;
		}
		_tmp$2 = x;
		_tmp$3 = $ifaceNil;
		x = _tmp$2;
		err = _tmp$3;
		return [x, err];
	};
	formatNano = function(b, nanosec, n, trim) {
		var $ptr, _q, _r$1, b, buf, n, nanosec, start, trim, u, x;
		u = nanosec;
		buf = arrayType$1.zero();
		start = 9;
		while (true) {
			if (!(start > 0)) { break; }
			start = start - (1) >> 0;
			((start < 0 || start >= buf.length) ? $throwRuntimeError("index out of range") : buf[start] = (((_r$1 = u % 10, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) + 48 >>> 0) << 24 >>> 24));
			u = (_q = u / (10), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >>> 0 : $throwRuntimeError("integer divide by zero"));
		}
		if (n > 9) {
			n = 9;
		}
		if (trim) {
			while (true) {
				if (!(n > 0 && ((x = n - 1 >> 0, ((x < 0 || x >= buf.length) ? $throwRuntimeError("index out of range") : buf[x])) === 48))) { break; }
				n = n - (1) >> 0;
			}
			if (n === 0) {
				return b;
			}
		}
		b = $append(b, 46);
		return $appendSlice(b, $subslice(new sliceType$3(buf), 0, n));
	};
	Time.ptr.prototype.String = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Format("2006-01-02 15:04:05.999999999 -0700 MST"); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.String = function() { return this.$val.String(); };
	Time.ptr.prototype.Format = function(layout) {
		var $ptr, _r$1, b, buf, layout, max, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; b = $f.b; buf = $f.buf; layout = $f.layout; max = $f.max; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		b = sliceType$3.nil;
		max = layout.length + 10 >> 0;
		if (max < 64) {
			buf = arrayType$2.zero();
			b = $subslice(new sliceType$3(buf), 0, 0);
		} else {
			b = $makeSlice(sliceType$3, 0, max);
		}
		_r$1 = t.AppendFormat(b, layout); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		b = _r$1;
		return $bytesToString(b);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Format }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.b = b; $f.buf = buf; $f.layout = layout; $f.max = max; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Format = function(layout) { return this.$val.Format(layout); };
	Time.ptr.prototype.AppendFormat = function(b, layout) {
		var $ptr, _2, _q, _q$1, _q$2, _q$3, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _r$7, _tuple$1, _tuple$2, _tuple$3, _tuple$4, abs, absoffset, b, day, hour, hr, hr$1, layout, m, min, month, name, offset, prefix, s, sec, std, suffix, t, y, year, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _2 = $f._2; _q = $f._q; _q$1 = $f._q$1; _q$2 = $f._q$2; _q$3 = $f._q$3; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; abs = $f.abs; absoffset = $f.absoffset; b = $f.b; day = $f.day; hour = $f.hour; hr = $f.hr; hr$1 = $f.hr$1; layout = $f.layout; m = $f.m; min = $f.min; month = $f.month; name = $f.name; offset = $f.offset; prefix = $f.prefix; s = $f.s; sec = $f.sec; std = $f.std; suffix = $f.suffix; t = $f.t; y = $f.y; year = $f.year; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.locabs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		abs = _tuple$1[2];
		year = -1;
		month = 0;
		day = 0;
		hour = -1;
		min = 0;
		sec = 0;
		while (true) {
			if (!(!(layout === ""))) { break; }
			_tuple$2 = nextStdChunk(layout);
			prefix = _tuple$2[0];
			std = _tuple$2[1];
			suffix = _tuple$2[2];
			if (!(prefix === "")) {
				b = $appendSlice(b, prefix);
			}
			if (std === 0) {
				break;
			}
			layout = suffix;
			if (year < 0 && !(((std & 256) === 0))) {
				_tuple$3 = absDate(abs, true);
				year = _tuple$3[0];
				month = _tuple$3[1];
				day = _tuple$3[2];
			}
			if (hour < 0 && !(((std & 512) === 0))) {
				_tuple$4 = absClock(abs);
				hour = _tuple$4[0];
				min = _tuple$4[1];
				sec = _tuple$4[2];
			}
			switch (0) { default:
				_2 = std & 65535;
				if (_2 === 274) {
					y = year;
					if (y < 0) {
						y = -y;
					}
					b = appendInt(b, (_r$2 = y % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")), 2);
				} else if (_2 === 273) {
					b = appendInt(b, year, 4);
				} else if (_2 === 258) {
					b = $appendSlice(b, new Month(month).String().substring(0, 3));
				} else if (_2 === 257) {
					m = new Month(month).String();
					b = $appendSlice(b, m);
				} else if (_2 === 259) {
					b = appendInt(b, (month >> 0), 0);
				} else if (_2 === 260) {
					b = appendInt(b, (month >> 0), 2);
				} else if (_2 === 262) {
					b = $appendSlice(b, new Weekday(absWeekday(abs)).String().substring(0, 3));
				} else if (_2 === 261) {
					s = new Weekday(absWeekday(abs)).String();
					b = $appendSlice(b, s);
				} else if (_2 === 263) {
					b = appendInt(b, day, 0);
				} else if (_2 === 264) {
					if (day < 10) {
						b = $append(b, 32);
					}
					b = appendInt(b, day, 0);
				} else if (_2 === 265) {
					b = appendInt(b, day, 2);
				} else if (_2 === 522) {
					b = appendInt(b, hour, 2);
				} else if (_2 === 523) {
					hr = (_r$3 = hour % 12, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero"));
					if (hr === 0) {
						hr = 12;
					}
					b = appendInt(b, hr, 0);
				} else if (_2 === 524) {
					hr$1 = (_r$4 = hour % 12, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
					if (hr$1 === 0) {
						hr$1 = 12;
					}
					b = appendInt(b, hr$1, 2);
				} else if (_2 === 525) {
					b = appendInt(b, min, 0);
				} else if (_2 === 526) {
					b = appendInt(b, min, 2);
				} else if (_2 === 527) {
					b = appendInt(b, sec, 0);
				} else if (_2 === 528) {
					b = appendInt(b, sec, 2);
				} else if (_2 === 531) {
					if (hour >= 12) {
						b = $appendSlice(b, "PM");
					} else {
						b = $appendSlice(b, "AM");
					}
				} else if (_2 === 532) {
					if (hour >= 12) {
						b = $appendSlice(b, "pm");
					} else {
						b = $appendSlice(b, "am");
					}
				} else if ((_2 === 22) || (_2 === 25) || (_2 === 23) || (_2 === 24) || (_2 === 26) || (_2 === 27) || (_2 === 30) || (_2 === 28) || (_2 === 29) || (_2 === 31)) {
					if ((offset === 0) && ((std === 22) || (std === 25) || (std === 23) || (std === 24) || (std === 26))) {
						b = $append(b, 90);
						break;
					}
					zone$1 = (_q = offset / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
					absoffset = offset;
					if (zone$1 < 0) {
						b = $append(b, 45);
						zone$1 = -zone$1;
						absoffset = -absoffset;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$1 = zone$1 / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					if ((std === 25) || (std === 30) || (std === 26) || (std === 31)) {
						b = $append(b, 58);
					}
					if (!((std === 29)) && !((std === 24))) {
						b = appendInt(b, (_r$5 = zone$1 % 60, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero")), 2);
					}
					if ((std === 23) || (std === 28) || (std === 31) || (std === 26)) {
						if ((std === 31) || (std === 26)) {
							b = $append(b, 58);
						}
						b = appendInt(b, (_r$6 = absoffset % 60, _r$6 === _r$6 ? _r$6 : $throwRuntimeError("integer divide by zero")), 2);
					}
				} else if (_2 === 21) {
					if (!(name === "")) {
						b = $appendSlice(b, name);
						break;
					}
					zone$2 = (_q$2 = offset / 60, (_q$2 === _q$2 && _q$2 !== 1/0 && _q$2 !== -1/0) ? _q$2 >> 0 : $throwRuntimeError("integer divide by zero"));
					if (zone$2 < 0) {
						b = $append(b, 45);
						zone$2 = -zone$2;
					} else {
						b = $append(b, 43);
					}
					b = appendInt(b, (_q$3 = zone$2 / 60, (_q$3 === _q$3 && _q$3 !== 1/0 && _q$3 !== -1/0) ? _q$3 >> 0 : $throwRuntimeError("integer divide by zero")), 2);
					b = appendInt(b, (_r$7 = zone$2 % 60, _r$7 === _r$7 ? _r$7 : $throwRuntimeError("integer divide by zero")), 2);
				} else if ((_2 === 32) || (_2 === 33)) {
					b = formatNano(b, (t.Nanosecond() >>> 0), std >> 16 >> 0, (std & 65535) === 33);
				}
			}
		}
		return b;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AppendFormat }; } $f.$ptr = $ptr; $f._2 = _2; $f._q = _q; $f._q$1 = _q$1; $f._q$2 = _q$2; $f._q$3 = _q$3; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f.abs = abs; $f.absoffset = absoffset; $f.b = b; $f.day = day; $f.hour = hour; $f.hr = hr; $f.hr$1 = hr$1; $f.layout = layout; $f.m = m; $f.min = min; $f.month = month; $f.name = name; $f.offset = offset; $f.prefix = prefix; $f.s = s; $f.sec = sec; $f.std = std; $f.suffix = suffix; $f.t = t; $f.y = y; $f.year = year; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AppendFormat = function(b, layout) { return this.$val.AppendFormat(b, layout); };
	quote = function(s) {
		var $ptr, s;
		return "\"" + s + "\"";
	};
	ParseError.ptr.prototype.Error = function() {
		var $ptr, e;
		e = this;
		if (e.Message === "") {
			return "parsing time " + quote(e.Value) + " as " + quote(e.Layout) + ": cannot parse " + quote(e.ValueElem) + " as " + quote(e.LayoutElem);
		}
		return "parsing time " + quote(e.Value) + e.Message;
	};
	ParseError.prototype.Error = function() { return this.$val.Error(); };
	isDigit = function(s, i) {
		var $ptr, c, i, s;
		if (s.length <= i) {
			return false;
		}
		c = s.charCodeAt(i);
		return 48 <= c && c <= 57;
	};
	getnum = function(s, fixed) {
		var $ptr, fixed, s;
		if (!isDigit(s, 0)) {
			return [0, s, errBad];
		}
		if (!isDigit(s, 1)) {
			if (fixed) {
				return [0, s, errBad];
			}
			return [((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), s.substring(1), $ifaceNil];
		}
		return [($imul(((s.charCodeAt(0) - 48 << 24 >>> 24) >> 0), 10)) + ((s.charCodeAt(1) - 48 << 24 >>> 24) >> 0) >> 0, s.substring(2), $ifaceNil];
	};
	cutspace = function(s) {
		var $ptr, s;
		while (true) {
			if (!(s.length > 0 && (s.charCodeAt(0) === 32))) { break; }
			s = s.substring(1);
		}
		return s;
	};
	skip = function(value, prefix) {
		var $ptr, prefix, value;
		while (true) {
			if (!(prefix.length > 0)) { break; }
			if (prefix.charCodeAt(0) === 32) {
				if (value.length > 0 && !((value.charCodeAt(0) === 32))) {
					return [value, errBad];
				}
				prefix = cutspace(prefix);
				value = cutspace(value);
				continue;
			}
			if ((value.length === 0) || !((value.charCodeAt(0) === prefix.charCodeAt(0)))) {
				return [value, errBad];
			}
			prefix = prefix.substring(1);
			value = value.substring(1);
		}
		return [value, $ifaceNil];
	};
	Parse = function(layout, value) {
		var $ptr, _r$1, layout, value, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; layout = $f.layout; value = $f.value; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r$1 = parse(layout, value, $pkg.UTC, $pkg.Local); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Parse }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.layout = layout; $f.value = value; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Parse = Parse;
	parse = function(layout, value, defaultLocation, local) {
		var $ptr, _3, _4, _5, _6, _r$1, _r$2, _r$3, _r$4, _r$5, _r$6, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$16, _tmp$17, _tmp$18, _tmp$19, _tmp$2, _tmp$20, _tmp$21, _tmp$22, _tmp$23, _tmp$24, _tmp$25, _tmp$26, _tmp$27, _tmp$28, _tmp$29, _tmp$3, _tmp$30, _tmp$31, _tmp$32, _tmp$33, _tmp$34, _tmp$35, _tmp$36, _tmp$37, _tmp$38, _tmp$39, _tmp$4, _tmp$40, _tmp$41, _tmp$42, _tmp$43, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, _tuple$1, _tuple$10, _tuple$11, _tuple$12, _tuple$13, _tuple$14, _tuple$15, _tuple$16, _tuple$17, _tuple$18, _tuple$19, _tuple$2, _tuple$20, _tuple$21, _tuple$22, _tuple$23, _tuple$24, _tuple$25, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, _tuple$9, alayout, amSet, avalue, day, defaultLocation, err, hour, hour$1, hr, i, layout, local, min, min$1, mm, month, n, n$1, name, ndigit, nsec, offset, offset$1, ok, ok$1, p, pmSet, prefix, rangeErrString, sec, seconds, sign, ss, std, stdstr, suffix, t, t$1, value, x, x$1, x$2, x$3, x$4, x$5, year, z, zoneName, zoneOffset, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _3 = $f._3; _4 = $f._4; _5 = $f._5; _6 = $f._6; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$10 = $f._tmp$10; _tmp$11 = $f._tmp$11; _tmp$12 = $f._tmp$12; _tmp$13 = $f._tmp$13; _tmp$14 = $f._tmp$14; _tmp$15 = $f._tmp$15; _tmp$16 = $f._tmp$16; _tmp$17 = $f._tmp$17; _tmp$18 = $f._tmp$18; _tmp$19 = $f._tmp$19; _tmp$2 = $f._tmp$2; _tmp$20 = $f._tmp$20; _tmp$21 = $f._tmp$21; _tmp$22 = $f._tmp$22; _tmp$23 = $f._tmp$23; _tmp$24 = $f._tmp$24; _tmp$25 = $f._tmp$25; _tmp$26 = $f._tmp$26; _tmp$27 = $f._tmp$27; _tmp$28 = $f._tmp$28; _tmp$29 = $f._tmp$29; _tmp$3 = $f._tmp$3; _tmp$30 = $f._tmp$30; _tmp$31 = $f._tmp$31; _tmp$32 = $f._tmp$32; _tmp$33 = $f._tmp$33; _tmp$34 = $f._tmp$34; _tmp$35 = $f._tmp$35; _tmp$36 = $f._tmp$36; _tmp$37 = $f._tmp$37; _tmp$38 = $f._tmp$38; _tmp$39 = $f._tmp$39; _tmp$4 = $f._tmp$4; _tmp$40 = $f._tmp$40; _tmp$41 = $f._tmp$41; _tmp$42 = $f._tmp$42; _tmp$43 = $f._tmp$43; _tmp$5 = $f._tmp$5; _tmp$6 = $f._tmp$6; _tmp$7 = $f._tmp$7; _tmp$8 = $f._tmp$8; _tmp$9 = $f._tmp$9; _tuple$1 = $f._tuple$1; _tuple$10 = $f._tuple$10; _tuple$11 = $f._tuple$11; _tuple$12 = $f._tuple$12; _tuple$13 = $f._tuple$13; _tuple$14 = $f._tuple$14; _tuple$15 = $f._tuple$15; _tuple$16 = $f._tuple$16; _tuple$17 = $f._tuple$17; _tuple$18 = $f._tuple$18; _tuple$19 = $f._tuple$19; _tuple$2 = $f._tuple$2; _tuple$20 = $f._tuple$20; _tuple$21 = $f._tuple$21; _tuple$22 = $f._tuple$22; _tuple$23 = $f._tuple$23; _tuple$24 = $f._tuple$24; _tuple$25 = $f._tuple$25; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; _tuple$9 = $f._tuple$9; alayout = $f.alayout; amSet = $f.amSet; avalue = $f.avalue; day = $f.day; defaultLocation = $f.defaultLocation; err = $f.err; hour = $f.hour; hour$1 = $f.hour$1; hr = $f.hr; i = $f.i; layout = $f.layout; local = $f.local; min = $f.min; min$1 = $f.min$1; mm = $f.mm; month = $f.month; n = $f.n; n$1 = $f.n$1; name = $f.name; ndigit = $f.ndigit; nsec = $f.nsec; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; ok$1 = $f.ok$1; p = $f.p; pmSet = $f.pmSet; prefix = $f.prefix; rangeErrString = $f.rangeErrString; sec = $f.sec; seconds = $f.seconds; sign = $f.sign; ss = $f.ss; std = $f.std; stdstr = $f.stdstr; suffix = $f.suffix; t = $f.t; t$1 = $f.t$1; value = $f.value; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; year = $f.year; z = $f.z; zoneName = $f.zoneName; zoneOffset = $f.zoneOffset; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_tmp = layout;
		_tmp$1 = value;
		alayout = _tmp;
		avalue = _tmp$1;
		rangeErrString = "";
		amSet = false;
		pmSet = false;
		year = 0;
		month = 1;
		day = 1;
		hour = 0;
		min = 0;
		sec = 0;
		nsec = 0;
		z = ptrType$1.nil;
		zoneOffset = -1;
		zoneName = "";
		while (true) {
			err = $ifaceNil;
			_tuple$1 = nextStdChunk(layout);
			prefix = _tuple$1[0];
			std = _tuple$1[1];
			suffix = _tuple$1[2];
			stdstr = layout.substring(prefix.length, (layout.length - suffix.length >> 0));
			_tuple$2 = skip(value, prefix);
			value = _tuple$2[0];
			err = _tuple$2[1];
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, prefix, value, "")];
			}
			if (std === 0) {
				if (!((value.length === 0))) {
					return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": extra text: " + value)];
				}
				break;
			}
			layout = suffix;
			p = "";
			switch (0) { default:
				_3 = std & 65535;
				if (_3 === 274) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$2 = value.substring(0, 2);
					_tmp$3 = value.substring(2);
					p = _tmp$2;
					value = _tmp$3;
					_tuple$3 = atoi(p);
					year = _tuple$3[0];
					err = _tuple$3[1];
					if (year >= 69) {
						year = year + (1900) >> 0;
					} else {
						year = year + (2000) >> 0;
					}
				} else if (_3 === 273) {
					if (value.length < 4 || !isDigit(value, 0)) {
						err = errBad;
						break;
					}
					_tmp$4 = value.substring(0, 4);
					_tmp$5 = value.substring(4);
					p = _tmp$4;
					value = _tmp$5;
					_tuple$4 = atoi(p);
					year = _tuple$4[0];
					err = _tuple$4[1];
				} else if (_3 === 258) {
					_tuple$5 = lookup(shortMonthNames, value);
					month = _tuple$5[0];
					value = _tuple$5[1];
					err = _tuple$5[2];
				} else if (_3 === 257) {
					_tuple$6 = lookup(longMonthNames, value);
					month = _tuple$6[0];
					value = _tuple$6[1];
					err = _tuple$6[2];
				} else if ((_3 === 259) || (_3 === 260)) {
					_tuple$7 = getnum(value, std === 260);
					month = _tuple$7[0];
					value = _tuple$7[1];
					err = _tuple$7[2];
					if (month <= 0 || 12 < month) {
						rangeErrString = "month";
					}
				} else if (_3 === 262) {
					_tuple$8 = lookup(shortDayNames, value);
					value = _tuple$8[1];
					err = _tuple$8[2];
				} else if (_3 === 261) {
					_tuple$9 = lookup(longDayNames, value);
					value = _tuple$9[1];
					err = _tuple$9[2];
				} else if ((_3 === 263) || (_3 === 264) || (_3 === 265)) {
					if ((std === 264) && value.length > 0 && (value.charCodeAt(0) === 32)) {
						value = value.substring(1);
					}
					_tuple$10 = getnum(value, std === 265);
					day = _tuple$10[0];
					value = _tuple$10[1];
					err = _tuple$10[2];
					if (day < 0) {
						rangeErrString = "day";
					}
				} else if (_3 === 522) {
					_tuple$11 = getnum(value, false);
					hour = _tuple$11[0];
					value = _tuple$11[1];
					err = _tuple$11[2];
					if (hour < 0 || 24 <= hour) {
						rangeErrString = "hour";
					}
				} else if ((_3 === 523) || (_3 === 524)) {
					_tuple$12 = getnum(value, std === 524);
					hour = _tuple$12[0];
					value = _tuple$12[1];
					err = _tuple$12[2];
					if (hour < 0 || 12 < hour) {
						rangeErrString = "hour";
					}
				} else if ((_3 === 525) || (_3 === 526)) {
					_tuple$13 = getnum(value, std === 526);
					min = _tuple$13[0];
					value = _tuple$13[1];
					err = _tuple$13[2];
					if (min < 0 || 60 <= min) {
						rangeErrString = "minute";
					}
				} else if ((_3 === 527) || (_3 === 528)) {
					_tuple$14 = getnum(value, std === 528);
					sec = _tuple$14[0];
					value = _tuple$14[1];
					err = _tuple$14[2];
					if (sec < 0 || 60 <= sec) {
						rangeErrString = "second";
					}
					if (value.length >= 2 && (value.charCodeAt(0) === 46) && isDigit(value, 1)) {
						_tuple$15 = nextStdChunk(layout);
						std = _tuple$15[1];
						std = std & (65535);
						if ((std === 32) || (std === 33)) {
							break;
						}
						n = 2;
						while (true) {
							if (!(n < value.length && isDigit(value, n))) { break; }
							n = n + (1) >> 0;
						}
						_tuple$16 = parseNanoseconds(value, n);
						nsec = _tuple$16[0];
						rangeErrString = _tuple$16[1];
						err = _tuple$16[2];
						value = value.substring(n);
					}
				} else if (_3 === 531) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$6 = value.substring(0, 2);
					_tmp$7 = value.substring(2);
					p = _tmp$6;
					value = _tmp$7;
					_4 = p;
					if (_4 === "PM") {
						pmSet = true;
					} else if (_4 === "AM") {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if (_3 === 532) {
					if (value.length < 2) {
						err = errBad;
						break;
					}
					_tmp$8 = value.substring(0, 2);
					_tmp$9 = value.substring(2);
					p = _tmp$8;
					value = _tmp$9;
					_5 = p;
					if (_5 === "pm") {
						pmSet = true;
					} else if (_5 === "am") {
						amSet = true;
					} else {
						err = errBad;
					}
				} else if ((_3 === 22) || (_3 === 25) || (_3 === 23) || (_3 === 24) || (_3 === 26) || (_3 === 27) || (_3 === 29) || (_3 === 30) || (_3 === 28) || (_3 === 31)) {
					if (((std === 22) || (std === 24) || (std === 25)) && value.length >= 1 && (value.charCodeAt(0) === 90)) {
						value = value.substring(1);
						z = $pkg.UTC;
						break;
					}
					_tmp$10 = "";
					_tmp$11 = "";
					_tmp$12 = "";
					_tmp$13 = "";
					sign = _tmp$10;
					hour$1 = _tmp$11;
					min$1 = _tmp$12;
					seconds = _tmp$13;
					if ((std === 25) || (std === 30)) {
						if (value.length < 6) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58))) {
							err = errBad;
							break;
						}
						_tmp$14 = value.substring(0, 1);
						_tmp$15 = value.substring(1, 3);
						_tmp$16 = value.substring(4, 6);
						_tmp$17 = "00";
						_tmp$18 = value.substring(6);
						sign = _tmp$14;
						hour$1 = _tmp$15;
						min$1 = _tmp$16;
						seconds = _tmp$17;
						value = _tmp$18;
					} else if ((std === 29) || (std === 24)) {
						if (value.length < 3) {
							err = errBad;
							break;
						}
						_tmp$19 = value.substring(0, 1);
						_tmp$20 = value.substring(1, 3);
						_tmp$21 = "00";
						_tmp$22 = "00";
						_tmp$23 = value.substring(3);
						sign = _tmp$19;
						hour$1 = _tmp$20;
						min$1 = _tmp$21;
						seconds = _tmp$22;
						value = _tmp$23;
					} else if ((std === 26) || (std === 31)) {
						if (value.length < 9) {
							err = errBad;
							break;
						}
						if (!((value.charCodeAt(3) === 58)) || !((value.charCodeAt(6) === 58))) {
							err = errBad;
							break;
						}
						_tmp$24 = value.substring(0, 1);
						_tmp$25 = value.substring(1, 3);
						_tmp$26 = value.substring(4, 6);
						_tmp$27 = value.substring(7, 9);
						_tmp$28 = value.substring(9);
						sign = _tmp$24;
						hour$1 = _tmp$25;
						min$1 = _tmp$26;
						seconds = _tmp$27;
						value = _tmp$28;
					} else if ((std === 23) || (std === 28)) {
						if (value.length < 7) {
							err = errBad;
							break;
						}
						_tmp$29 = value.substring(0, 1);
						_tmp$30 = value.substring(1, 3);
						_tmp$31 = value.substring(3, 5);
						_tmp$32 = value.substring(5, 7);
						_tmp$33 = value.substring(7);
						sign = _tmp$29;
						hour$1 = _tmp$30;
						min$1 = _tmp$31;
						seconds = _tmp$32;
						value = _tmp$33;
					} else {
						if (value.length < 5) {
							err = errBad;
							break;
						}
						_tmp$34 = value.substring(0, 1);
						_tmp$35 = value.substring(1, 3);
						_tmp$36 = value.substring(3, 5);
						_tmp$37 = "00";
						_tmp$38 = value.substring(5);
						sign = _tmp$34;
						hour$1 = _tmp$35;
						min$1 = _tmp$36;
						seconds = _tmp$37;
						value = _tmp$38;
					}
					_tmp$39 = 0;
					_tmp$40 = 0;
					_tmp$41 = 0;
					hr = _tmp$39;
					mm = _tmp$40;
					ss = _tmp$41;
					_tuple$17 = atoi(hour$1);
					hr = _tuple$17[0];
					err = _tuple$17[1];
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$18 = atoi(min$1);
						mm = _tuple$18[0];
						err = _tuple$18[1];
					}
					if ($interfaceIsEqual(err, $ifaceNil)) {
						_tuple$19 = atoi(seconds);
						ss = _tuple$19[0];
						err = _tuple$19[1];
					}
					zoneOffset = ($imul(((($imul(hr, 60)) + mm >> 0)), 60)) + ss >> 0;
					_6 = sign.charCodeAt(0);
					if (_6 === 43) {
					} else if (_6 === 45) {
						zoneOffset = -zoneOffset;
					} else {
						err = errBad;
					}
				} else if (_3 === 21) {
					if (value.length >= 3 && value.substring(0, 3) === "UTC") {
						z = $pkg.UTC;
						value = value.substring(3);
						break;
					}
					_tuple$20 = parseTimeZone(value);
					n$1 = _tuple$20[0];
					ok = _tuple$20[1];
					if (!ok) {
						err = errBad;
						break;
					}
					_tmp$42 = value.substring(0, n$1);
					_tmp$43 = value.substring(n$1);
					zoneName = _tmp$42;
					value = _tmp$43;
				} else if (_3 === 32) {
					ndigit = 1 + ((std >> 16 >> 0)) >> 0;
					if (value.length < ndigit) {
						err = errBad;
						break;
					}
					_tuple$21 = parseNanoseconds(value, ndigit);
					nsec = _tuple$21[0];
					rangeErrString = _tuple$21[1];
					err = _tuple$21[2];
					value = value.substring(ndigit);
				} else if (_3 === 33) {
					if (value.length < 2 || !((value.charCodeAt(0) === 46)) || value.charCodeAt(1) < 48 || 57 < value.charCodeAt(1)) {
						break;
					}
					i = 0;
					while (true) {
						if (!(i < 9 && (i + 1 >> 0) < value.length && 48 <= value.charCodeAt((i + 1 >> 0)) && value.charCodeAt((i + 1 >> 0)) <= 57)) { break; }
						i = i + (1) >> 0;
					}
					_tuple$22 = parseNanoseconds(value, 1 + i >> 0);
					nsec = _tuple$22[0];
					rangeErrString = _tuple$22[1];
					err = _tuple$22[2];
					value = value.substring((1 + i >> 0));
				}
			}
			if (!(rangeErrString === "")) {
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, ": " + rangeErrString + " out of range")];
			}
			if (!($interfaceIsEqual(err, $ifaceNil))) {
				return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, stdstr, value, "")];
			}
		}
		if (pmSet && hour < 12) {
			hour = hour + (12) >> 0;
		} else if (amSet && (hour === 12)) {
			hour = 0;
		}
		if (day > daysIn((month >> 0), year)) {
			return [new Time.ptr(new $Int64(0, 0), 0, ptrType$1.nil), new ParseError.ptr(alayout, avalue, "", value, ": day out of range")];
		}
		/* */ if (!(z === ptrType$1.nil)) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!(z === ptrType$1.nil)) { */ case 1:
			_r$1 = Date(year, (month >> 0), day, hour, min, sec, nsec, z); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			/* */ $s = 4; case 4:
			return [_r$1, $ifaceNil];
		/* } */ case 2:
		/* */ if (!((zoneOffset === -1))) { $s = 5; continue; }
		/* */ $s = 6; continue;
		/* if (!((zoneOffset === -1))) { */ case 5:
			_r$2 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 7; case 7: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
			t = $clone(_r$2, Time);
			t.sec = (x = t.sec, x$1 = new $Int64(0, zoneOffset), new $Int64(x.$high - x$1.$high, x.$low - x$1.$low));
			_r$3 = local.lookup((x$2 = t.sec, new $Int64(x$2.$high + -15, x$2.$low + 2288912640))); /* */ $s = 8; case 8: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
			_tuple$23 = _r$3;
			name = _tuple$23[0];
			offset = _tuple$23[1];
			if ((offset === zoneOffset) && (zoneName === "" || name === zoneName)) {
				t.loc = local;
				return [t, $ifaceNil];
			}
			t.loc = FixedZone(zoneName, zoneOffset);
			return [t, $ifaceNil];
		/* } */ case 6:
		/* */ if (!(zoneName === "")) { $s = 9; continue; }
		/* */ $s = 10; continue;
		/* if (!(zoneName === "")) { */ case 9:
			_r$4 = Date(year, (month >> 0), day, hour, min, sec, nsec, $pkg.UTC); /* */ $s = 11; case 11: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
			t$1 = $clone(_r$4, Time);
			_r$5 = local.lookupName(zoneName, (x$3 = t$1.sec, new $Int64(x$3.$high + -15, x$3.$low + 2288912640))); /* */ $s = 12; case 12: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
			_tuple$24 = _r$5;
			offset$1 = _tuple$24[0];
			ok$1 = _tuple$24[2];
			if (ok$1) {
				t$1.sec = (x$4 = t$1.sec, x$5 = new $Int64(0, offset$1), new $Int64(x$4.$high - x$5.$high, x$4.$low - x$5.$low));
				t$1.loc = local;
				return [t$1, $ifaceNil];
			}
			if (zoneName.length > 3 && zoneName.substring(0, 3) === "GMT") {
				_tuple$25 = atoi(zoneName.substring(3));
				offset$1 = _tuple$25[0];
				offset$1 = $imul(offset$1, (3600));
			}
			t$1.loc = FixedZone(zoneName, offset$1);
			return [t$1, $ifaceNil];
		/* } */ case 10:
		_r$6 = Date(year, (month >> 0), day, hour, min, sec, nsec, defaultLocation); /* */ $s = 13; case 13: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
		/* */ $s = 14; case 14:
		return [_r$6, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: parse }; } $f.$ptr = $ptr; $f._3 = _3; $f._4 = _4; $f._5 = _5; $f._6 = _6; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$10 = _tmp$10; $f._tmp$11 = _tmp$11; $f._tmp$12 = _tmp$12; $f._tmp$13 = _tmp$13; $f._tmp$14 = _tmp$14; $f._tmp$15 = _tmp$15; $f._tmp$16 = _tmp$16; $f._tmp$17 = _tmp$17; $f._tmp$18 = _tmp$18; $f._tmp$19 = _tmp$19; $f._tmp$2 = _tmp$2; $f._tmp$20 = _tmp$20; $f._tmp$21 = _tmp$21; $f._tmp$22 = _tmp$22; $f._tmp$23 = _tmp$23; $f._tmp$24 = _tmp$24; $f._tmp$25 = _tmp$25; $f._tmp$26 = _tmp$26; $f._tmp$27 = _tmp$27; $f._tmp$28 = _tmp$28; $f._tmp$29 = _tmp$29; $f._tmp$3 = _tmp$3; $f._tmp$30 = _tmp$30; $f._tmp$31 = _tmp$31; $f._tmp$32 = _tmp$32; $f._tmp$33 = _tmp$33; $f._tmp$34 = _tmp$34; $f._tmp$35 = _tmp$35; $f._tmp$36 = _tmp$36; $f._tmp$37 = _tmp$37; $f._tmp$38 = _tmp$38; $f._tmp$39 = _tmp$39; $f._tmp$4 = _tmp$4; $f._tmp$40 = _tmp$40; $f._tmp$41 = _tmp$41; $f._tmp$42 = _tmp$42; $f._tmp$43 = _tmp$43; $f._tmp$5 = _tmp$5; $f._tmp$6 = _tmp$6; $f._tmp$7 = _tmp$7; $f._tmp$8 = _tmp$8; $f._tmp$9 = _tmp$9; $f._tuple$1 = _tuple$1; $f._tuple$10 = _tuple$10; $f._tuple$11 = _tuple$11; $f._tuple$12 = _tuple$12; $f._tuple$13 = _tuple$13; $f._tuple$14 = _tuple$14; $f._tuple$15 = _tuple$15; $f._tuple$16 = _tuple$16; $f._tuple$17 = _tuple$17; $f._tuple$18 = _tuple$18; $f._tuple$19 = _tuple$19; $f._tuple$2 = _tuple$2; $f._tuple$20 = _tuple$20; $f._tuple$21 = _tuple$21; $f._tuple$22 = _tuple$22; $f._tuple$23 = _tuple$23; $f._tuple$24 = _tuple$24; $f._tuple$25 = _tuple$25; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f._tuple$9 = _tuple$9; $f.alayout = alayout; $f.amSet = amSet; $f.avalue = avalue; $f.day = day; $f.defaultLocation = defaultLocation; $f.err = err; $f.hour = hour; $f.hour$1 = hour$1; $f.hr = hr; $f.i = i; $f.layout = layout; $f.local = local; $f.min = min; $f.min$1 = min$1; $f.mm = mm; $f.month = month; $f.n = n; $f.n$1 = n$1; $f.name = name; $f.ndigit = ndigit; $f.nsec = nsec; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.ok$1 = ok$1; $f.p = p; $f.pmSet = pmSet; $f.prefix = prefix; $f.rangeErrString = rangeErrString; $f.sec = sec; $f.seconds = seconds; $f.sign = sign; $f.ss = ss; $f.std = std; $f.stdstr = stdstr; $f.suffix = suffix; $f.t = t; $f.t$1 = t$1; $f.value = value; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.year = year; $f.z = z; $f.zoneName = zoneName; $f.zoneOffset = zoneOffset; $f.$s = $s; $f.$r = $r; return $f;
	};
	parseTimeZone = function(value) {
		var $ptr, _7, _tmp, _tmp$1, _tmp$10, _tmp$11, _tmp$12, _tmp$13, _tmp$14, _tmp$15, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, _tmp$9, c, length, nUpper, ok, value;
		length = 0;
		ok = false;
		if (value.length < 3) {
			_tmp = 0;
			_tmp$1 = false;
			length = _tmp;
			ok = _tmp$1;
			return [length, ok];
		}
		if (value.length >= 4 && (value.substring(0, 4) === "ChST" || value.substring(0, 4) === "MeST")) {
			_tmp$2 = 4;
			_tmp$3 = true;
			length = _tmp$2;
			ok = _tmp$3;
			return [length, ok];
		}
		if (value.substring(0, 3) === "GMT") {
			length = parseGMT(value);
			_tmp$4 = length;
			_tmp$5 = true;
			length = _tmp$4;
			ok = _tmp$5;
			return [length, ok];
		}
		nUpper = 0;
		nUpper = 0;
		while (true) {
			if (!(nUpper < 6)) { break; }
			if (nUpper >= value.length) {
				break;
			}
			c = value.charCodeAt(nUpper);
			if (c < 65 || 90 < c) {
				break;
			}
			nUpper = nUpper + (1) >> 0;
		}
		_7 = nUpper;
		if ((_7 === 0) || (_7 === 1) || (_7 === 2) || (_7 === 6)) {
			_tmp$6 = 0;
			_tmp$7 = false;
			length = _tmp$6;
			ok = _tmp$7;
			return [length, ok];
		} else if (_7 === 5) {
			if (value.charCodeAt(4) === 84) {
				_tmp$8 = 5;
				_tmp$9 = true;
				length = _tmp$8;
				ok = _tmp$9;
				return [length, ok];
			}
		} else if (_7 === 4) {
			if (value.charCodeAt(3) === 84) {
				_tmp$10 = 4;
				_tmp$11 = true;
				length = _tmp$10;
				ok = _tmp$11;
				return [length, ok];
			}
		} else if (_7 === 3) {
			_tmp$12 = 3;
			_tmp$13 = true;
			length = _tmp$12;
			ok = _tmp$13;
			return [length, ok];
		}
		_tmp$14 = 0;
		_tmp$15 = false;
		length = _tmp$14;
		ok = _tmp$15;
		return [length, ok];
	};
	parseGMT = function(value) {
		var $ptr, _tuple$1, err, rem, sign, value, x;
		value = value.substring(3);
		if (value.length === 0) {
			return 3;
		}
		sign = value.charCodeAt(0);
		if (!((sign === 45)) && !((sign === 43))) {
			return 3;
		}
		_tuple$1 = leadingInt(value.substring(1));
		x = _tuple$1[0];
		rem = _tuple$1[1];
		err = _tuple$1[2];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return 3;
		}
		if (sign === 45) {
			x = new $Int64(-x.$high, -x.$low);
		}
		if ((x.$high === 0 && x.$low === 0) || (x.$high < -1 || (x.$high === -1 && x.$low < 4294967282)) || (0 < x.$high || (0 === x.$high && 12 < x.$low))) {
			return 3;
		}
		return (3 + value.length >> 0) - rem.length >> 0;
	};
	parseNanoseconds = function(value, nbytes) {
		var $ptr, _tuple$1, err, i, nbytes, ns, rangeErrString, scaleDigits, value;
		ns = 0;
		rangeErrString = "";
		err = $ifaceNil;
		if (!((value.charCodeAt(0) === 46))) {
			err = errBad;
			return [ns, rangeErrString, err];
		}
		_tuple$1 = atoi(value.substring(1, nbytes));
		ns = _tuple$1[0];
		err = _tuple$1[1];
		if (!($interfaceIsEqual(err, $ifaceNil))) {
			return [ns, rangeErrString, err];
		}
		if (ns < 0 || 1000000000 <= ns) {
			rangeErrString = "fractional second";
			return [ns, rangeErrString, err];
		}
		scaleDigits = 10 - nbytes >> 0;
		i = 0;
		while (true) {
			if (!(i < scaleDigits)) { break; }
			ns = $imul(ns, (10));
			i = i + (1) >> 0;
		}
		return [ns, rangeErrString, err];
	};
	leadingInt = function(s) {
		var $ptr, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tmp$6, _tmp$7, _tmp$8, c, err, i, rem, s, x, x$1, x$2, x$3;
		x = new $Int64(0, 0);
		rem = "";
		err = $ifaceNil;
		i = 0;
		while (true) {
			if (!(i < s.length)) { break; }
			c = s.charCodeAt(i);
			if (c < 48 || c > 57) {
				break;
			}
			if ((x.$high > 214748364 || (x.$high === 214748364 && x.$low > 3435973836))) {
				_tmp = new $Int64(0, 0);
				_tmp$1 = "";
				_tmp$2 = errLeadingInt;
				x = _tmp;
				rem = _tmp$1;
				err = _tmp$2;
				return [x, rem, err];
			}
			x = (x$1 = (x$2 = $mul64(x, new $Int64(0, 10)), x$3 = new $Int64(0, c), new $Int64(x$2.$high + x$3.$high, x$2.$low + x$3.$low)), new $Int64(x$1.$high - 0, x$1.$low - 48));
			if ((x.$high < 0 || (x.$high === 0 && x.$low < 0))) {
				_tmp$3 = new $Int64(0, 0);
				_tmp$4 = "";
				_tmp$5 = errLeadingInt;
				x = _tmp$3;
				rem = _tmp$4;
				err = _tmp$5;
				return [x, rem, err];
			}
			i = i + (1) >> 0;
		}
		_tmp$6 = x;
		_tmp$7 = s.substring(i);
		_tmp$8 = $ifaceNil;
		x = _tmp$6;
		rem = _tmp$7;
		err = _tmp$8;
		return [x, rem, err];
	};
	when = function(d) {
		var $ptr, d, t, x, x$1;
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return runtimeNano();
		}
		t = (x = runtimeNano(), x$1 = new $Int64(d.$high, d.$low), new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
		if ((t.$high < 0 || (t.$high === 0 && t.$low < 0))) {
			t = new $Int64(2147483647, 4294967295);
		}
		return t;
	};
	Timer.ptr.prototype.Stop = function() {
		var $ptr, t;
		t = this;
		if (t.r.f === $throwNilPointerError) {
			$panic(new $String("time: Stop called on uninitialized Timer"));
		}
		return stopTimer(t.r);
	};
	Timer.prototype.Stop = function() { return this.$val.Stop(); };
	NewTimer = function(d) {
		var $ptr, c, d, t;
		c = new $Chan(Time, 1);
		t = new Timer.ptr(c, new runtimeTimer.ptr(0, when(d), new $Int64(0, 0), sendTime, new chanType(c), null, false));
		startTimer(t.r);
		return t;
	};
	$pkg.NewTimer = NewTimer;
	Timer.ptr.prototype.Reset = function(d) {
		var $ptr, active, d, t, w;
		t = this;
		if (t.r.f === $throwNilPointerError) {
			$panic(new $String("time: Reset called on uninitialized Timer"));
		}
		w = when(d);
		active = stopTimer(t.r);
		t.r.when = w;
		startTimer(t.r);
		return active;
	};
	Timer.prototype.Reset = function(d) { return this.$val.Reset(d); };
	sendTime = function(c, seq) {
		var $ptr, _selection, c, seq, $r;
		/* */ var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _selection = $f._selection; c = $f.c; seq = $f.seq; $r = $f.$r; }
		_selection = $select([[$assertType(c, chanType), $clone(Now(), Time)], []]);
		if (_selection[0] === 0) {
		} else if (_selection[0] === 1) {
		}
		/* */ if ($f === undefined) { $f = { $blk: sendTime }; } $f.$ptr = $ptr; $f._selection = _selection; $f.c = c; $f.seq = seq; $f.$r = $r; return $f;
	};
	After = function(d) {
		var $ptr, d;
		return NewTimer(d).C;
	};
	$pkg.After = After;
	Time.ptr.prototype.After = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high > x$1.$high || (x.$high === x$1.$high && x.$low > x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec > u.nsec;
	};
	Time.prototype.After = function(u) { return this.$val.After(u); };
	Time.ptr.prototype.Before = function(u) {
		var $ptr, t, u, x, x$1, x$2, x$3;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high < x$1.$high || (x.$high === x$1.$high && x.$low < x$1.$low))) || (x$2 = t.sec, x$3 = u.sec, (x$2.$high === x$3.$high && x$2.$low === x$3.$low)) && t.nsec < u.nsec;
	};
	Time.prototype.Before = function(u) { return this.$val.Before(u); };
	Time.ptr.prototype.Equal = function(u) {
		var $ptr, t, u, x, x$1;
		u = $clone(u, Time);
		t = $clone(this, Time);
		return (x = t.sec, x$1 = u.sec, (x.$high === x$1.$high && x.$low === x$1.$low)) && (t.nsec === u.nsec);
	};
	Time.prototype.Equal = function(u) { return this.$val.Equal(u); };
	Month.prototype.String = function() {
		var $ptr, m, x;
		m = this.$val;
		return (x = m - 1 >> 0, ((x < 0 || x >= months.length) ? $throwRuntimeError("index out of range") : months[x]));
	};
	$ptrType(Month).prototype.String = function() { return new Month(this.$get()).String(); };
	Weekday.prototype.String = function() {
		var $ptr, d;
		d = this.$val;
		return ((d < 0 || d >= days.length) ? $throwRuntimeError("index out of range") : days[d]);
	};
	$ptrType(Weekday).prototype.String = function() { return new Weekday(this.$get()).String(); };
	Time.ptr.prototype.IsZero = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, (x.$high === 0 && x.$low === 0)) && (t.nsec === 0);
	};
	Time.prototype.IsZero = function() { return this.$val.IsZero(); };
	Time.ptr.prototype.abs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, l, offset, sec, t, x, x$1, x$2, x$3, x$4, x$5, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; l = $f.l; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 6; continue; }
			/* */ $s = 7; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 6:
				sec = (x$3 = new $Int64(0, l.cacheZone.offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
				$s = 8; continue;
			/* } else { */ case 7:
				_r$2 = l.lookup(sec); /* */ $s = 9; case 9: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				offset = _tuple$1[1];
				sec = (x$4 = new $Int64(0, offset), new $Int64(sec.$high + x$4.$high, sec.$low + x$4.$low));
			/* } */ case 8:
		/* } */ case 5:
		return (x$5 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$5.$high, x$5.$low));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.abs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.l = l; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.abs = function() { return this.$val.abs(); };
	Time.ptr.prototype.locabs = function() {
		var $ptr, _r$1, _r$2, _tuple$1, abs, l, name, offset, sec, t, x, x$1, x$2, x$3, x$4, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; abs = $f.abs; l = $f.l; name = $f.name; offset = $f.offset; sec = $f.sec; t = $f.t; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		abs = new $Uint64(0, 0);
		t = $clone(this, Time);
		l = t.loc;
		/* */ if (l === ptrType$1.nil || l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === ptrType$1.nil || l === localLoc) { */ case 1:
			_r$1 = l.get(); /* */ $s = 3; case 3: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			l = _r$1;
		/* } */ case 2:
		sec = (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
		/* */ if (!(l === utcLoc)) { $s = 4; continue; }
		/* */ $s = 5; continue;
		/* if (!(l === utcLoc)) { */ case 4:
			/* */ if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { $s = 7; continue; }
			/* */ $s = 8; continue;
			/* if (!(l.cacheZone === ptrType.nil) && (x$1 = l.cacheStart, (x$1.$high < sec.$high || (x$1.$high === sec.$high && x$1.$low <= sec.$low))) && (x$2 = l.cacheEnd, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) { */ case 7:
				name = l.cacheZone.name;
				offset = l.cacheZone.offset;
				$s = 9; continue;
			/* } else { */ case 8:
				_r$2 = l.lookup(sec); /* */ $s = 10; case 10: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				name = _tuple$1[0];
				offset = _tuple$1[1];
			/* } */ case 9:
			sec = (x$3 = new $Int64(0, offset), new $Int64(sec.$high + x$3.$high, sec.$low + x$3.$low));
			$s = 6; continue;
		/* } else { */ case 5:
			name = "UTC";
		/* } */ case 6:
		abs = (x$4 = new $Int64(sec.$high + 2147483646, sec.$low + 450480384), new $Uint64(x$4.$high, x$4.$low));
		return [name, offset, abs];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.locabs }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.abs = abs; $f.l = l; $f.name = name; $f.offset = offset; $f.sec = sec; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.locabs = function() { return this.$val.locabs(); };
	Time.ptr.prototype.Date = function() {
		var $ptr, _r$1, _tuple$1, day, month, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; month = $f.month; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		return [year, month, day];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.month = month; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Date = function() { return this.$val.Date(); };
	Time.ptr.prototype.Year = function() {
		var $ptr, _r$1, _tuple$1, t, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		return year;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Year }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Year = function() { return this.$val.Year(); };
	Time.ptr.prototype.Month = function() {
		var $ptr, _r$1, _tuple$1, month, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; month = $f.month; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		month = _tuple$1[1];
		return month;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Month }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.month = month; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Month = function() { return this.$val.Month(); };
	Time.ptr.prototype.Day = function() {
		var $ptr, _r$1, _tuple$1, day, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; day = $f.day; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		day = _tuple$1[2];
		return day;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Day }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.day = day; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Day = function() { return this.$val.Day(); };
	Time.ptr.prototype.Weekday = function() {
		var $ptr, _r$1, _r$2, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absWeekday(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$2;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Weekday }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Weekday = function() { return this.$val.Weekday(); };
	absWeekday = function(abs) {
		var $ptr, _q, abs, sec;
		sec = $div64((new $Uint64(abs.$high + 0, abs.$low + 86400)), new $Uint64(0, 604800), true);
		return ((_q = (sec.$low >> 0) / 86400, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
	};
	Time.ptr.prototype.ISOWeek = function() {
		var $ptr, _q, _r$1, _r$2, _r$3, _r$4, _r$5, _tuple$1, day, dec31wday, jan1wday, month, t, wday, week, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _tuple$1 = $f._tuple$1; day = $f.day; dec31wday = $f.dec31wday; jan1wday = $f.jan1wday; month = $f.month; t = $f.t; wday = $f.wday; week = $f.week; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		week = 0;
		t = $clone(this, Time);
		_r$1 = t.date(true); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		_r$3 = t.Weekday(); /* */ $s = 2; case 2: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		wday = (_r$2 = ((_r$3 + 6 >> 0) >> 0) % 7, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero"));
		week = (_q = (((yday - wday >> 0) + 7 >> 0)) / 7, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		jan1wday = (_r$4 = (((wday - yday >> 0) + 371 >> 0)) % 7, _r$4 === _r$4 ? _r$4 : $throwRuntimeError("integer divide by zero"));
		if (1 <= jan1wday && jan1wday <= 3) {
			week = week + (1) >> 0;
		}
		if (week === 0) {
			year = year - (1) >> 0;
			week = 52;
			if ((jan1wday === 4) || ((jan1wday === 5) && isLeap(year))) {
				week = week + (1) >> 0;
			}
		}
		if ((month === 12) && day >= 29 && wday < 3) {
			dec31wday = (_r$5 = (((wday + 31 >> 0) - day >> 0)) % 7, _r$5 === _r$5 ? _r$5 : $throwRuntimeError("integer divide by zero"));
			if (0 <= dec31wday && dec31wday <= 2) {
				year = year + (1) >> 0;
				week = 1;
			}
		}
		return [year, week];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.ISOWeek }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._tuple$1 = _tuple$1; $f.day = day; $f.dec31wday = dec31wday; $f.jan1wday = jan1wday; $f.month = month; $f.t = t; $f.wday = wday; $f.week = week; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.ISOWeek = function() { return this.$val.ISOWeek(); };
	Time.ptr.prototype.Clock = function() {
		var $ptr, _r$1, _r$2, _tuple$1, hour, min, sec, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; hour = $f.hour; min = $f.min; sec = $f.sec; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		hour = 0;
		min = 0;
		sec = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absClock(_r$1); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		hour = _tuple$1[0];
		min = _tuple$1[1];
		sec = _tuple$1[2];
		/* */ $s = 3; case 3:
		return [hour, min, sec];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Clock }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.hour = hour; $f.min = min; $f.sec = sec; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Clock = function() { return this.$val.Clock(); };
	absClock = function(abs) {
		var $ptr, _q, _q$1, abs, hour, min, sec;
		hour = 0;
		min = 0;
		sec = 0;
		sec = ($div64(abs, new $Uint64(0, 86400), true).$low >> 0);
		hour = (_q = sec / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(hour, 3600))) >> 0;
		min = (_q$1 = sec / 60, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
		sec = sec - (($imul(min, 60))) >> 0;
		return [hour, min, sec];
	};
	Time.ptr.prototype.Hour = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return (_q = ($div64(_r$1, new $Uint64(0, 86400), true).$low >> 0) / 3600, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Hour }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Hour = function() { return this.$val.Hour(); };
	Time.ptr.prototype.Minute = function() {
		var $ptr, _q, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return (_q = ($div64(_r$1, new $Uint64(0, 3600), true).$low >> 0) / 60, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Minute }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Minute = function() { return this.$val.Minute(); };
	Time.ptr.prototype.Second = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return ($div64(_r$1, new $Uint64(0, 60), true).$low >> 0);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Second }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Second = function() { return this.$val.Second(); };
	Time.ptr.prototype.Nanosecond = function() {
		var $ptr, t;
		t = $clone(this, Time);
		return (t.nsec >> 0);
	};
	Time.prototype.Nanosecond = function() { return this.$val.Nanosecond(); };
	Time.ptr.prototype.YearDay = function() {
		var $ptr, _r$1, _tuple$1, t, yday, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; t = $f.t; yday = $f.yday; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.date(false); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		yday = _tuple$1[3];
		return yday + 1 >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.YearDay }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.t = t; $f.yday = yday; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.YearDay = function() { return this.$val.YearDay(); };
	Duration.prototype.String = function() {
		var $ptr, _tuple$1, _tuple$2, buf, d, neg, prec, u, w;
		d = this;
		buf = arrayType$4.zero();
		w = 32;
		u = new $Uint64(d.$high, d.$low);
		neg = (d.$high < 0 || (d.$high === 0 && d.$low < 0));
		if (neg) {
			u = new $Uint64(-u.$high, -u.$low);
		}
		if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000000))) {
			prec = 0;
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			w = w - (1) >> 0;
			if ((u.$high === 0 && u.$low === 0)) {
				return "0";
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000))) {
				prec = 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 110);
			} else if ((u.$high < 0 || (u.$high === 0 && u.$low < 1000000))) {
				prec = 3;
				w = w - (1) >> 0;
				$copyString($subslice(new sliceType$3(buf), w), "\xC2\xB5");
			} else {
				prec = 6;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
			}
			_tuple$1 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, prec);
			w = _tuple$1[0];
			u = _tuple$1[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
		} else {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 115);
			_tuple$2 = fmtFrac($subslice(new sliceType$3(buf), 0, w), u, 9);
			w = _tuple$2[0];
			u = _tuple$2[1];
			w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
			u = $div64(u, (new $Uint64(0, 60)), false);
			if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 109);
				w = fmtInt($subslice(new sliceType$3(buf), 0, w), $div64(u, new $Uint64(0, 60), true));
				u = $div64(u, (new $Uint64(0, 60)), false);
				if ((u.$high > 0 || (u.$high === 0 && u.$low > 0))) {
					w = w - (1) >> 0;
					((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 104);
					w = fmtInt($subslice(new sliceType$3(buf), 0, w), u);
				}
			}
		}
		if (neg) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.length) ? $throwRuntimeError("index out of range") : buf[w] = 45);
		}
		return $bytesToString($subslice(new sliceType$3(buf), w));
	};
	$ptrType(Duration).prototype.String = function() { return this.$get().String(); };
	fmtFrac = function(buf, v, prec) {
		var $ptr, _tmp, _tmp$1, buf, digit, i, nv, nw, prec, print, v, w;
		nw = 0;
		nv = new $Uint64(0, 0);
		w = buf.$length;
		print = false;
		i = 0;
		while (true) {
			if (!(i < prec)) { break; }
			digit = $div64(v, new $Uint64(0, 10), true);
			print = print || !((digit.$high === 0 && digit.$low === 0));
			if (print) {
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = ((digit.$low << 24 >>> 24) + 48 << 24 >>> 24));
			}
			v = $div64(v, (new $Uint64(0, 10)), false);
			i = i + (1) >> 0;
		}
		if (print) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 46);
		}
		_tmp = w;
		_tmp$1 = v;
		nw = _tmp;
		nv = _tmp$1;
		return [nw, nv];
	};
	fmtInt = function(buf, v) {
		var $ptr, buf, v, w;
		w = buf.$length;
		if ((v.$high === 0 && v.$low === 0)) {
			w = w - (1) >> 0;
			((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = 48);
		} else {
			while (true) {
				if (!((v.$high > 0 || (v.$high === 0 && v.$low > 0)))) { break; }
				w = w - (1) >> 0;
				((w < 0 || w >= buf.$length) ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + w] = (($div64(v, new $Uint64(0, 10), true).$low << 24 >>> 24) + 48 << 24 >>> 24));
				v = $div64(v, (new $Uint64(0, 10)), false);
			}
		}
		return w;
	};
	Duration.prototype.Nanoseconds = function() {
		var $ptr, d;
		d = this;
		return new $Int64(d.$high, d.$low);
	};
	$ptrType(Duration).prototype.Nanoseconds = function() { return this.$get().Nanoseconds(); };
	Duration.prototype.Seconds = function() {
		var $ptr, d, nsec, sec;
		d = this;
		sec = $div64(d, new Duration(0, 1000000000), false);
		nsec = $div64(d, new Duration(0, 1000000000), true);
		return $flatten64(sec) + $flatten64(nsec) * 1e-09;
	};
	$ptrType(Duration).prototype.Seconds = function() { return this.$get().Seconds(); };
	Duration.prototype.Minutes = function() {
		var $ptr, d, min, nsec;
		d = this;
		min = $div64(d, new Duration(13, 4165425152), false);
		nsec = $div64(d, new Duration(13, 4165425152), true);
		return $flatten64(min) + $flatten64(nsec) * 1.6666666666666667e-11;
	};
	$ptrType(Duration).prototype.Minutes = function() { return this.$get().Minutes(); };
	Duration.prototype.Hours = function() {
		var $ptr, d, hour, nsec;
		d = this;
		hour = $div64(d, new Duration(838, 817405952), false);
		nsec = $div64(d, new Duration(838, 817405952), true);
		return $flatten64(hour) + $flatten64(nsec) * 2.777777777777778e-13;
	};
	$ptrType(Duration).prototype.Hours = function() { return this.$get().Hours(); };
	Time.ptr.prototype.Add = function(d) {
		var $ptr, d, nsec, t, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7;
		t = $clone(this, Time);
		t.sec = (x = t.sec, x$1 = (x$2 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$2.$high, x$2.$low)), new $Int64(x.$high + x$1.$high, x.$low + x$1.$low));
		nsec = t.nsec + ((x$3 = $div64(d, new Duration(0, 1000000000), true), x$3.$low + ((x$3.$high >> 31) * 4294967296)) >> 0) >> 0;
		if (nsec >= 1000000000) {
			t.sec = (x$4 = t.sec, x$5 = new $Int64(0, 1), new $Int64(x$4.$high + x$5.$high, x$4.$low + x$5.$low));
			nsec = nsec - (1000000000) >> 0;
		} else if (nsec < 0) {
			t.sec = (x$6 = t.sec, x$7 = new $Int64(0, 1), new $Int64(x$6.$high - x$7.$high, x$6.$low - x$7.$low));
			nsec = nsec + (1000000000) >> 0;
		}
		t.nsec = nsec;
		return t;
	};
	Time.prototype.Add = function(d) { return this.$val.Add(d); };
	Time.ptr.prototype.Sub = function(u) {
		var $ptr, d, t, u, x, x$1, x$2, x$3, x$4;
		u = $clone(u, Time);
		t = $clone(this, Time);
		d = (x = $mul64((x$1 = (x$2 = t.sec, x$3 = u.sec, new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low)), new Duration(x$1.$high, x$1.$low)), new Duration(0, 1000000000)), x$4 = new Duration(0, (t.nsec - u.nsec >> 0)), new Duration(x.$high + x$4.$high, x.$low + x$4.$low));
		if (u.Add(d).Equal(t)) {
			return d;
		} else if (t.Before(u)) {
			return new Duration(-2147483648, 0);
		} else {
			return new Duration(2147483647, 4294967295);
		}
	};
	Time.prototype.Sub = function(u) { return this.$val.Sub(u); };
	Time.ptr.prototype.AddDate = function(years, months$1, days$1) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, day, days$1, hour, min, month, months$1, sec, t, year, years, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; day = $f.day; days$1 = $f.days$1; hour = $f.hour; min = $f.min; month = $f.month; months$1 = $f.months$1; sec = $f.sec; t = $f.t; year = $f.year; years = $f.years; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Date(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		_r$2 = t.Clock(); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$2 = _r$2;
		hour = _tuple$2[0];
		min = _tuple$2[1];
		sec = _tuple$2[2];
		_r$3 = Date(year + years >> 0, month + (months$1 >> 0) >> 0, day + days$1 >> 0, hour, min, sec, (t.nsec >> 0), t.loc); /* */ $s = 3; case 3: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
		/* */ $s = 4; case 4:
		return _r$3;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.AddDate }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f.day = day; $f.days$1 = days$1; $f.hour = hour; $f.min = min; $f.month = month; $f.months$1 = months$1; $f.sec = sec; $f.t = t; $f.year = year; $f.years = years; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.AddDate = function(years, months$1, days$1) { return this.$val.AddDate(years, months$1, days$1); };
	Time.ptr.prototype.date = function(full) {
		var $ptr, _r$1, _r$2, _tuple$1, day, full, month, t, yday, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; day = $f.day; full = $f.full; month = $f.month; t = $f.t; yday = $f.yday; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		t = $clone(this, Time);
		_r$1 = t.abs(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_r$2 = absDate(_r$1, full); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		_tuple$1 = _r$2;
		year = _tuple$1[0];
		month = _tuple$1[1];
		day = _tuple$1[2];
		yday = _tuple$1[3];
		/* */ $s = 3; case 3:
		return [year, month, day, yday];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.day = day; $f.full = full; $f.month = month; $f.t = t; $f.yday = yday; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.date = function(full) { return this.$val.date(full); };
	absDate = function(abs, full) {
		var $ptr, _q, abs, begin, d, day, end, full, month, n, x, x$1, x$10, x$11, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, yday, year;
		year = 0;
		month = 0;
		day = 0;
		yday = 0;
		d = $div64(abs, new $Uint64(0, 86400), false);
		n = $div64(d, new $Uint64(0, 146097), false);
		y = $mul64(new $Uint64(0, 400), n);
		d = (x = $mul64(new $Uint64(0, 146097), n), new $Uint64(d.$high - x.$high, d.$low - x.$low));
		n = $div64(d, new $Uint64(0, 36524), false);
		n = (x$1 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$1.$high, n.$low - x$1.$low));
		y = (x$2 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high + x$2.$high, y.$low + x$2.$low));
		d = (x$3 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high - x$3.$high, d.$low - x$3.$low));
		n = $div64(d, new $Uint64(0, 1461), false);
		y = (x$4 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high + x$4.$high, y.$low + x$4.$low));
		d = (x$5 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high - x$5.$high, d.$low - x$5.$low));
		n = $div64(d, new $Uint64(0, 365), false);
		n = (x$6 = $shiftRightUint64(n, 2), new $Uint64(n.$high - x$6.$high, n.$low - x$6.$low));
		y = (x$7 = n, new $Uint64(y.$high + x$7.$high, y.$low + x$7.$low));
		d = (x$8 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high - x$8.$high, d.$low - x$8.$low));
		year = ((x$9 = (x$10 = new $Int64(y.$high, y.$low), new $Int64(x$10.$high + -69, x$10.$low + 4075721025)), x$9.$low + ((x$9.$high >> 31) * 4294967296)) >> 0);
		yday = (d.$low >> 0);
		if (!full) {
			return [year, month, day, yday];
		}
		day = yday;
		if (isLeap(year)) {
			if (day > 59) {
				day = day - (1) >> 0;
			} else if ((day === 59)) {
				month = 2;
				day = 29;
				return [year, month, day, yday];
			}
		}
		month = ((_q = day / 31, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0);
		end = ((x$11 = month + 1 >> 0, ((x$11 < 0 || x$11 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$11])) >> 0);
		begin = 0;
		if (day >= end) {
			month = month + (1) >> 0;
			begin = end;
		} else {
			begin = (((month < 0 || month >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[month]) >> 0);
		}
		month = month + (1) >> 0;
		day = (day - begin >> 0) + 1 >> 0;
		return [year, month, day, yday];
	};
	daysIn = function(m, year) {
		var $ptr, m, x, year;
		if ((m === 2) && isLeap(year)) {
			return 29;
		}
		return ((((m < 0 || m >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[m]) - (x = m - 1 >> 0, ((x < 0 || x >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x])) >> 0) >> 0);
	};
	Now = function() {
		var $ptr, _tuple$1, nsec, sec;
		_tuple$1 = now();
		sec = _tuple$1[0];
		nsec = _tuple$1[1];
		return new Time.ptr(new $Int64(sec.$high + 14, sec.$low + 2006054656), nsec, $pkg.Local);
	};
	$pkg.Now = Now;
	Time.ptr.prototype.UTC = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.UTC;
		return t;
	};
	Time.prototype.UTC = function() { return this.$val.UTC(); };
	Time.ptr.prototype.Local = function() {
		var $ptr, t;
		t = $clone(this, Time);
		t.loc = $pkg.Local;
		return t;
	};
	Time.prototype.Local = function() { return this.$val.Local(); };
	Time.ptr.prototype.In = function(loc) {
		var $ptr, loc, t;
		t = $clone(this, Time);
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Time.In"));
		}
		t.loc = loc;
		return t;
	};
	Time.prototype.In = function(loc) { return this.$val.In(loc); };
	Time.ptr.prototype.Location = function() {
		var $ptr, l, t;
		t = $clone(this, Time);
		l = t.loc;
		if (l === ptrType$1.nil) {
			l = $pkg.UTC;
		}
		return l;
	};
	Time.prototype.Location = function() { return this.$val.Location(); };
	Time.ptr.prototype.Zone = function() {
		var $ptr, _r$1, _tuple$1, name, offset, t, x, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; name = $f.name; offset = $f.offset; t = $f.t; x = $f.x; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		t = $clone(this, Time);
		_r$1 = t.loc.lookup((x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640))); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		name = _tuple$1[0];
		offset = _tuple$1[1];
		return [name, offset];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.Zone }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.name = name; $f.offset = offset; $f.t = t; $f.x = x; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.Zone = function() { return this.$val.Zone(); };
	Time.ptr.prototype.Unix = function() {
		var $ptr, t, x;
		t = $clone(this, Time);
		return (x = t.sec, new $Int64(x.$high + -15, x.$low + 2288912640));
	};
	Time.prototype.Unix = function() { return this.$val.Unix(); };
	Time.ptr.prototype.UnixNano = function() {
		var $ptr, t, x, x$1, x$2;
		t = $clone(this, Time);
		return (x = $mul64(((x$1 = t.sec, new $Int64(x$1.$high + -15, x$1.$low + 2288912640))), new $Int64(0, 1000000000)), x$2 = new $Int64(0, t.nsec), new $Int64(x.$high + x$2.$high, x.$low + x$2.$low));
	};
	Time.prototype.UnixNano = function() { return this.$val.UnixNano(); };
	Time.ptr.prototype.MarshalBinary = function() {
		var $ptr, _q, _r$1, _r$2, _tuple$1, enc, offset, offsetMin, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; _r$2 = $f._r$2; _tuple$1 = $f._tuple$1; enc = $f.enc; offset = $f.offset; offsetMin = $f.offsetMin; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		offsetMin = 0;
		/* */ if (t.Location() === utcLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (t.Location() === utcLoc) { */ case 1:
			offsetMin = -1;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = t.Zone(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			offset = _tuple$1[1];
			if (!(((_r$2 = offset % 60, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0))) {
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: zone offset has fractional minute")];
			}
			offset = (_q = offset / (60), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
			if (offset < -32768 || (offset === -1) || offset > 32767) {
				return [sliceType$3.nil, errors.New("Time.MarshalBinary: unexpected zone offset")];
			}
			offsetMin = (offset << 16 >> 16);
		/* } */ case 3:
		enc = new sliceType$3([1, ($shiftRightInt64(t.sec, 56).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 48).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 40).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 32).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 24).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 16).$low << 24 >>> 24), ($shiftRightInt64(t.sec, 8).$low << 24 >>> 24), (t.sec.$low << 24 >>> 24), ((t.nsec >> 24 >> 0) << 24 >>> 24), ((t.nsec >> 16 >> 0) << 24 >>> 24), ((t.nsec >> 8 >> 0) << 24 >>> 24), (t.nsec << 24 >>> 24), ((offsetMin >> 8 << 16 >> 16) << 24 >>> 24), (offsetMin << 24 >>> 24)]);
		return [enc, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalBinary }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._tuple$1 = _tuple$1; $f.enc = enc; $f.offset = offset; $f.offsetMin = offsetMin; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalBinary = function() { return this.$val.MarshalBinary(); };
	Time.ptr.prototype.UnmarshalBinary = function(data$1) {
		var $ptr, _r$1, _tuple$1, buf, data$1, localoff, offset, t, x, x$1, x$10, x$11, x$12, x$13, x$14, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; buf = $f.buf; data$1 = $f.data$1; localoff = $f.localoff; offset = $f.offset; t = $f.t; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		buf = data$1;
		if (buf.$length === 0) {
			return errors.New("Time.UnmarshalBinary: no data");
		}
		if (!(((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) === 1))) {
			return errors.New("Time.UnmarshalBinary: unsupported version");
		}
		if (!((buf.$length === 15))) {
			return errors.New("Time.UnmarshalBinary: invalid length");
		}
		buf = $subslice(buf, 1);
		t.sec = (x = (x$1 = (x$2 = (x$3 = (x$4 = (x$5 = (x$6 = new $Int64(0, (7 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 7])), x$7 = $shiftLeft64(new $Int64(0, (6 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 6])), 8), new $Int64(x$6.$high | x$7.$high, (x$6.$low | x$7.$low) >>> 0)), x$8 = $shiftLeft64(new $Int64(0, (5 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 5])), 16), new $Int64(x$5.$high | x$8.$high, (x$5.$low | x$8.$low) >>> 0)), x$9 = $shiftLeft64(new $Int64(0, (4 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 4])), 24), new $Int64(x$4.$high | x$9.$high, (x$4.$low | x$9.$low) >>> 0)), x$10 = $shiftLeft64(new $Int64(0, (3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3])), 32), new $Int64(x$3.$high | x$10.$high, (x$3.$low | x$10.$low) >>> 0)), x$11 = $shiftLeft64(new $Int64(0, (2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2])), 40), new $Int64(x$2.$high | x$11.$high, (x$2.$low | x$11.$low) >>> 0)), x$12 = $shiftLeft64(new $Int64(0, (1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1])), 48), new $Int64(x$1.$high | x$12.$high, (x$1.$low | x$12.$low) >>> 0)), x$13 = $shiftLeft64(new $Int64(0, (0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0])), 56), new $Int64(x.$high | x$13.$high, (x.$low | x$13.$low) >>> 0));
		buf = $subslice(buf, 8);
		t.nsec = ((((3 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 3]) >> 0) | (((2 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 2]) >> 0) << 8 >> 0)) | (((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) >> 0) << 16 >> 0)) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) >> 0) << 24 >> 0);
		buf = $subslice(buf, 4);
		offset = $imul(((((1 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 1]) << 16 >> 16) | (((0 >= buf.$length ? $throwRuntimeError("index out of range") : buf.$array[buf.$offset + 0]) << 16 >> 16) << 8 << 16 >> 16)) >> 0), 60);
		/* */ if (offset === -60) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (offset === -60) { */ case 1:
			t.loc = utcLoc;
			$s = 3; continue;
		/* } else { */ case 2:
			_r$1 = $pkg.Local.lookup((x$14 = t.sec, new $Int64(x$14.$high + -15, x$14.$low + 2288912640))); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			_tuple$1 = _r$1;
			localoff = _tuple$1[1];
			if (offset === localoff) {
				t.loc = $pkg.Local;
			} else {
				t.loc = FixedZone("", offset);
			}
		/* } */ case 3:
		return $ifaceNil;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalBinary }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.buf = buf; $f.data$1 = data$1; $f.localoff = localoff; $f.offset = offset; $f.t = t; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalBinary = function(data$1) { return this.$val.UnmarshalBinary(data$1); };
	Time.ptr.prototype.GobEncode = function() {
		var $ptr, _r$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.MarshalBinary(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobEncode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobEncode = function() { return this.$val.GobEncode(); };
	Time.ptr.prototype.GobDecode = function(data$1) {
		var $ptr, _r$1, data$1, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; data$1 = $f.data$1; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = this;
		_r$1 = t.UnmarshalBinary(data$1); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.GobDecode }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.data$1 = data$1; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.GobDecode = function(data$1) { return this.$val.GobDecode(data$1); };
	Time.ptr.prototype.MarshalJSON = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			return [sliceType$3.nil, errors.New("Time.MarshalJSON: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 37);
		b = $append(b, 34);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		b = _r$2;
		b = $append(b, 34);
		return [b, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalJSON = function() { return this.$val.MarshalJSON(); };
	Time.ptr.prototype.UnmarshalJSON = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		t = this;
		_r$1 = Parse("\"2006-01-02T15:04:05Z07:00\"", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalJSON }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalJSON = function(data$1) { return this.$val.UnmarshalJSON(data$1); };
	Time.ptr.prototype.MarshalText = function() {
		var $ptr, _r$1, _r$2, b, t, y, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; b = $f.b; t = $f.t; y = $f.y; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		t = $clone(this, Time);
		_r$1 = t.Year(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		y = _r$1;
		if (y < 0 || y >= 10000) {
			return [sliceType$3.nil, errors.New("Time.MarshalText: year outside of range [0,9999]")];
		}
		b = $makeSlice(sliceType$3, 0, 35);
		_r$2 = t.AppendFormat(b, "2006-01-02T15:04:05.999999999Z07:00"); /* */ $s = 2; case 2: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return [_r$2, $ifaceNil];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.MarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f.b = b; $f.t = t; $f.y = y; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.MarshalText = function() { return this.$val.MarshalText(); };
	Time.ptr.prototype.UnmarshalText = function(data$1) {
		var $ptr, _r$1, _tuple$1, data$1, err, t, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _tuple$1 = $f._tuple$1; data$1 = $f.data$1; err = $f.err; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		err = $ifaceNil;
		t = this;
		_r$1 = Parse("2006-01-02T15:04:05Z07:00", $bytesToString(data$1)); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$1 = _r$1;
		Time.copy(t, _tuple$1[0]);
		err = _tuple$1[1];
		return err;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Time.ptr.prototype.UnmarshalText }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._tuple$1 = _tuple$1; $f.data$1 = data$1; $f.err = err; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
	};
	Time.prototype.UnmarshalText = function(data$1) { return this.$val.UnmarshalText(data$1); };
	Unix = function(sec, nsec) {
		var $ptr, n, nsec, sec, x, x$1, x$2, x$3;
		if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0)) || (nsec.$high > 0 || (nsec.$high === 0 && nsec.$low >= 1000000000))) {
			n = $div64(nsec, new $Int64(0, 1000000000), false);
			sec = (x = n, new $Int64(sec.$high + x.$high, sec.$low + x.$low));
			nsec = (x$1 = $mul64(n, new $Int64(0, 1000000000)), new $Int64(nsec.$high - x$1.$high, nsec.$low - x$1.$low));
			if ((nsec.$high < 0 || (nsec.$high === 0 && nsec.$low < 0))) {
				nsec = (x$2 = new $Int64(0, 1000000000), new $Int64(nsec.$high + x$2.$high, nsec.$low + x$2.$low));
				sec = (x$3 = new $Int64(0, 1), new $Int64(sec.$high - x$3.$high, sec.$low - x$3.$low));
			}
		}
		return new Time.ptr(new $Int64(sec.$high + 14, sec.$low + 2006054656), ((nsec.$low + ((nsec.$high >> 31) * 4294967296)) >> 0), $pkg.Local);
	};
	$pkg.Unix = Unix;
	isLeap = function(year) {
		var $ptr, _r$1, _r$2, _r$3, year;
		return ((_r$1 = year % 4, _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")) === 0) && (!(((_r$2 = year % 100, _r$2 === _r$2 ? _r$2 : $throwRuntimeError("integer divide by zero")) === 0)) || ((_r$3 = year % 400, _r$3 === _r$3 ? _r$3 : $throwRuntimeError("integer divide by zero")) === 0));
	};
	norm = function(hi, lo, base) {
		var $ptr, _q, _q$1, _tmp, _tmp$1, base, hi, lo, n, n$1, nhi, nlo;
		nhi = 0;
		nlo = 0;
		if (lo < 0) {
			n = (_q = ((-lo - 1 >> 0)) / base, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) + 1 >> 0;
			hi = hi - (n) >> 0;
			lo = lo + (($imul(n, base))) >> 0;
		}
		if (lo >= base) {
			n$1 = (_q$1 = lo / base, (_q$1 === _q$1 && _q$1 !== 1/0 && _q$1 !== -1/0) ? _q$1 >> 0 : $throwRuntimeError("integer divide by zero"));
			hi = hi + (n$1) >> 0;
			lo = lo - (($imul(n$1, base))) >> 0;
		}
		_tmp = hi;
		_tmp$1 = lo;
		nhi = _tmp;
		nlo = _tmp$1;
		return [nhi, nlo];
	};
	Date = function(year, month, day, hour, min, sec, nsec, loc) {
		var $ptr, _r$1, _r$2, _r$3, _tuple$1, _tuple$2, _tuple$3, _tuple$4, _tuple$5, _tuple$6, _tuple$7, _tuple$8, abs, d, day, end, hour, loc, m, min, month, n, nsec, offset, sec, start, unix, utc, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9, y, year, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; _r$2 = $f._r$2; _r$3 = $f._r$3; _tuple$1 = $f._tuple$1; _tuple$2 = $f._tuple$2; _tuple$3 = $f._tuple$3; _tuple$4 = $f._tuple$4; _tuple$5 = $f._tuple$5; _tuple$6 = $f._tuple$6; _tuple$7 = $f._tuple$7; _tuple$8 = $f._tuple$8; abs = $f.abs; d = $f.d; day = $f.day; end = $f.end; hour = $f.hour; loc = $f.loc; m = $f.m; min = $f.min; month = $f.month; n = $f.n; nsec = $f.nsec; offset = $f.offset; sec = $f.sec; start = $f.start; unix = $f.unix; utc = $f.utc; x = $f.x; x$1 = $f.x$1; x$10 = $f.x$10; x$11 = $f.x$11; x$12 = $f.x$12; x$13 = $f.x$13; x$14 = $f.x$14; x$15 = $f.x$15; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; x$9 = $f.x$9; y = $f.y; year = $f.year; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		if (loc === ptrType$1.nil) {
			$panic(new $String("time: missing Location in call to Date"));
		}
		m = (month >> 0) - 1 >> 0;
		_tuple$1 = norm(year, m, 12);
		year = _tuple$1[0];
		m = _tuple$1[1];
		month = (m >> 0) + 1 >> 0;
		_tuple$2 = norm(sec, nsec, 1000000000);
		sec = _tuple$2[0];
		nsec = _tuple$2[1];
		_tuple$3 = norm(min, sec, 60);
		min = _tuple$3[0];
		sec = _tuple$3[1];
		_tuple$4 = norm(hour, min, 60);
		hour = _tuple$4[0];
		min = _tuple$4[1];
		_tuple$5 = norm(day, hour, 24);
		day = _tuple$5[0];
		hour = _tuple$5[1];
		y = (x = (x$1 = new $Int64(0, year), new $Int64(x$1.$high - -69, x$1.$low - 4075721025)), new $Uint64(x.$high, x.$low));
		n = $div64(y, new $Uint64(0, 400), false);
		y = (x$2 = $mul64(new $Uint64(0, 400), n), new $Uint64(y.$high - x$2.$high, y.$low - x$2.$low));
		d = $mul64(new $Uint64(0, 146097), n);
		n = $div64(y, new $Uint64(0, 100), false);
		y = (x$3 = $mul64(new $Uint64(0, 100), n), new $Uint64(y.$high - x$3.$high, y.$low - x$3.$low));
		d = (x$4 = $mul64(new $Uint64(0, 36524), n), new $Uint64(d.$high + x$4.$high, d.$low + x$4.$low));
		n = $div64(y, new $Uint64(0, 4), false);
		y = (x$5 = $mul64(new $Uint64(0, 4), n), new $Uint64(y.$high - x$5.$high, y.$low - x$5.$low));
		d = (x$6 = $mul64(new $Uint64(0, 1461), n), new $Uint64(d.$high + x$6.$high, d.$low + x$6.$low));
		n = y;
		d = (x$7 = $mul64(new $Uint64(0, 365), n), new $Uint64(d.$high + x$7.$high, d.$low + x$7.$low));
		d = (x$8 = new $Uint64(0, (x$9 = month - 1 >> 0, ((x$9 < 0 || x$9 >= daysBefore.length) ? $throwRuntimeError("index out of range") : daysBefore[x$9]))), new $Uint64(d.$high + x$8.$high, d.$low + x$8.$low));
		if (isLeap(year) && month >= 3) {
			d = (x$10 = new $Uint64(0, 1), new $Uint64(d.$high + x$10.$high, d.$low + x$10.$low));
		}
		d = (x$11 = new $Uint64(0, (day - 1 >> 0)), new $Uint64(d.$high + x$11.$high, d.$low + x$11.$low));
		abs = $mul64(d, new $Uint64(0, 86400));
		abs = (x$12 = new $Uint64(0, ((($imul(hour, 3600)) + ($imul(min, 60)) >> 0) + sec >> 0)), new $Uint64(abs.$high + x$12.$high, abs.$low + x$12.$low));
		unix = (x$13 = new $Int64(abs.$high, abs.$low), new $Int64(x$13.$high + -2147483647, x$13.$low + 3844486912));
		_r$1 = loc.lookup(unix); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		_tuple$6 = _r$1;
		offset = _tuple$6[1];
		start = _tuple$6[3];
		end = _tuple$6[4];
		/* */ if (!((offset === 0))) { $s = 2; continue; }
		/* */ $s = 3; continue;
		/* if (!((offset === 0))) { */ case 2:
				utc = (x$14 = new $Int64(0, offset), new $Int64(unix.$high - x$14.$high, unix.$low - x$14.$low));
				/* */ if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { $s = 5; continue; }
				/* */ if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { $s = 6; continue; }
				/* */ $s = 7; continue;
				/* if ((utc.$high < start.$high || (utc.$high === start.$high && utc.$low < start.$low))) { */ case 5:
					_r$2 = loc.lookup(new $Int64(start.$high - 0, start.$low - 1)); /* */ $s = 8; case 8: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					_tuple$7 = _r$2;
					offset = _tuple$7[1];
					$s = 7; continue;
				/* } else if ((utc.$high > end.$high || (utc.$high === end.$high && utc.$low >= end.$low))) { */ case 6:
					_r$3 = loc.lookup(end); /* */ $s = 9; case 9: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					_tuple$8 = _r$3;
					offset = _tuple$8[1];
				/* } */ case 7:
			case 4:
			unix = (x$15 = new $Int64(0, offset), new $Int64(unix.$high - x$15.$high, unix.$low - x$15.$low));
		/* } */ case 3:
		return new Time.ptr(new $Int64(unix.$high + 14, unix.$low + 2006054656), (nsec >> 0), loc);
		/* */ } return; } if ($f === undefined) { $f = { $blk: Date }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._r$3 = _r$3; $f._tuple$1 = _tuple$1; $f._tuple$2 = _tuple$2; $f._tuple$3 = _tuple$3; $f._tuple$4 = _tuple$4; $f._tuple$5 = _tuple$5; $f._tuple$6 = _tuple$6; $f._tuple$7 = _tuple$7; $f._tuple$8 = _tuple$8; $f.abs = abs; $f.d = d; $f.day = day; $f.end = end; $f.hour = hour; $f.loc = loc; $f.m = m; $f.min = min; $f.month = month; $f.n = n; $f.nsec = nsec; $f.offset = offset; $f.sec = sec; $f.start = start; $f.unix = unix; $f.utc = utc; $f.x = x; $f.x$1 = x$1; $f.x$10 = x$10; $f.x$11 = x$11; $f.x$12 = x$12; $f.x$13 = x$13; $f.x$14 = x$14; $f.x$15 = x$15; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.x$9 = x$9; $f.y = y; $f.year = year; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.Date = Date;
	Time.ptr.prototype.Truncate = function(d) {
		var $ptr, _tuple$1, d, r, t;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		return t.Add(new Duration(-r.$high, -r.$low));
	};
	Time.prototype.Truncate = function(d) { return this.$val.Truncate(d); };
	Time.ptr.prototype.Round = function(d) {
		var $ptr, _tuple$1, d, r, t, x;
		t = $clone(this, Time);
		if ((d.$high < 0 || (d.$high === 0 && d.$low <= 0))) {
			return t;
		}
		_tuple$1 = div(t, d);
		r = _tuple$1[1];
		if ((x = new Duration(r.$high + r.$high, r.$low + r.$low), (x.$high < d.$high || (x.$high === d.$high && x.$low < d.$low)))) {
			return t.Add(new Duration(-r.$high, -r.$low));
		}
		return t.Add(new Duration(d.$high - r.$high, d.$low - r.$low));
	};
	Time.prototype.Round = function(d) { return this.$val.Round(d); };
	div = function(t, d) {
		var $ptr, _q, _r$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, d, d0, d1, d1$1, neg, nsec, qmod2, r, sec, t, tmp, u0, u0x, u1, x, x$1, x$10, x$11, x$12, x$13, x$14, x$15, x$16, x$17, x$18, x$19, x$2, x$3, x$4, x$5, x$6, x$7, x$8, x$9;
		qmod2 = 0;
		r = new Duration(0, 0);
		t = $clone(t, Time);
		neg = false;
		nsec = t.nsec;
		if ((x = t.sec, (x.$high < 0 || (x.$high === 0 && x.$low < 0)))) {
			neg = true;
			t.sec = (x$1 = t.sec, new $Int64(-x$1.$high, -x$1.$low));
			nsec = -nsec;
			if (nsec < 0) {
				nsec = nsec + (1000000000) >> 0;
				t.sec = (x$2 = t.sec, x$3 = new $Int64(0, 1), new $Int64(x$2.$high - x$3.$high, x$2.$low - x$3.$low));
			}
		}
		if ((d.$high < 0 || (d.$high === 0 && d.$low < 1000000000)) && (x$4 = $div64(new Duration(0, 1000000000), (new Duration(d.$high + d.$high, d.$low + d.$low)), true), (x$4.$high === 0 && x$4.$low === 0))) {
			qmod2 = ((_q = nsec / ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0) & 1;
			r = new Duration(0, (_r$1 = nsec % ((d.$low + ((d.$high >> 31) * 4294967296)) >> 0), _r$1 === _r$1 ? _r$1 : $throwRuntimeError("integer divide by zero")));
		} else if ((x$5 = $div64(d, new Duration(0, 1000000000), true), (x$5.$high === 0 && x$5.$low === 0))) {
			d1 = (x$6 = $div64(d, new Duration(0, 1000000000), false), new $Int64(x$6.$high, x$6.$low));
			qmod2 = ((x$7 = $div64(t.sec, d1, false), x$7.$low + ((x$7.$high >> 31) * 4294967296)) >> 0) & 1;
			r = (x$8 = $mul64((x$9 = $div64(t.sec, d1, true), new Duration(x$9.$high, x$9.$low)), new Duration(0, 1000000000)), x$10 = new Duration(0, nsec), new Duration(x$8.$high + x$10.$high, x$8.$low + x$10.$low));
		} else {
			sec = (x$11 = t.sec, new $Uint64(x$11.$high, x$11.$low));
			tmp = $mul64(($shiftRightUint64(sec, 32)), new $Uint64(0, 1000000000));
			u1 = $shiftRightUint64(tmp, 32);
			u0 = $shiftLeft64(tmp, 32);
			tmp = $mul64(new $Uint64(sec.$high & 0, (sec.$low & 4294967295) >>> 0), new $Uint64(0, 1000000000));
			_tmp = u0;
			_tmp$1 = new $Uint64(u0.$high + tmp.$high, u0.$low + tmp.$low);
			u0x = _tmp;
			u0 = _tmp$1;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$12 = new $Uint64(0, 1), new $Uint64(u1.$high + x$12.$high, u1.$low + x$12.$low));
			}
			_tmp$2 = u0;
			_tmp$3 = (x$13 = new $Uint64(0, nsec), new $Uint64(u0.$high + x$13.$high, u0.$low + x$13.$low));
			u0x = _tmp$2;
			u0 = _tmp$3;
			if ((u0.$high < u0x.$high || (u0.$high === u0x.$high && u0.$low < u0x.$low))) {
				u1 = (x$14 = new $Uint64(0, 1), new $Uint64(u1.$high + x$14.$high, u1.$low + x$14.$low));
			}
			d1$1 = new $Uint64(d.$high, d.$low);
			while (true) {
				if (!(!((x$15 = $shiftRightUint64(d1$1, 63), (x$15.$high === 0 && x$15.$low === 1))))) { break; }
				d1$1 = $shiftLeft64(d1$1, (1));
			}
			d0 = new $Uint64(0, 0);
			while (true) {
				qmod2 = 0;
				if ((u1.$high > d1$1.$high || (u1.$high === d1$1.$high && u1.$low > d1$1.$low)) || (u1.$high === d1$1.$high && u1.$low === d1$1.$low) && (u0.$high > d0.$high || (u0.$high === d0.$high && u0.$low >= d0.$low))) {
					qmod2 = 1;
					_tmp$4 = u0;
					_tmp$5 = new $Uint64(u0.$high - d0.$high, u0.$low - d0.$low);
					u0x = _tmp$4;
					u0 = _tmp$5;
					if ((u0.$high > u0x.$high || (u0.$high === u0x.$high && u0.$low > u0x.$low))) {
						u1 = (x$16 = new $Uint64(0, 1), new $Uint64(u1.$high - x$16.$high, u1.$low - x$16.$low));
					}
					u1 = (x$17 = d1$1, new $Uint64(u1.$high - x$17.$high, u1.$low - x$17.$low));
				}
				if ((d1$1.$high === 0 && d1$1.$low === 0) && (x$18 = new $Uint64(d.$high, d.$low), (d0.$high === x$18.$high && d0.$low === x$18.$low))) {
					break;
				}
				d0 = $shiftRightUint64(d0, (1));
				d0 = (x$19 = $shiftLeft64((new $Uint64(d1$1.$high & 0, (d1$1.$low & 1) >>> 0)), 63), new $Uint64(d0.$high | x$19.$high, (d0.$low | x$19.$low) >>> 0));
				d1$1 = $shiftRightUint64(d1$1, (1));
			}
			r = new Duration(u0.$high, u0.$low);
		}
		if (neg && !((r.$high === 0 && r.$low === 0))) {
			qmod2 = (qmod2 ^ (1)) >> 0;
			r = new Duration(d.$high - r.$high, d.$low - r.$low);
		}
		return [qmod2, r];
	};
	Location.ptr.prototype.get = function() {
		var $ptr, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		if (l === ptrType$1.nil) {
			return utcLoc;
		}
		/* */ if (l === localLoc) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (l === localLoc) { */ case 1:
			$r = localOnce.Do(initLocal); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* } */ case 2:
		return l;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.get }; } $f.$ptr = $ptr; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.get = function() { return this.$val.get(); };
	Location.ptr.prototype.String = function() {
		var $ptr, _r$1, l, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r$1 = $f._r$1; l = $f.l; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r$1.name;
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.String }; } $f.$ptr = $ptr; $f._r$1 = _r$1; $f.l = l; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.String = function() { return this.$val.String(); };
	FixedZone = function(name, offset) {
		var $ptr, l, name, offset, x;
		l = new Location.ptr(name, new sliceType([new zone.ptr(name, offset, false)]), new sliceType$1([new zoneTrans.ptr(new $Int64(-2147483648, 0), 0, false, false)]), new $Int64(-2147483648, 0), new $Int64(2147483647, 4294967295), ptrType.nil);
		l.cacheZone = (x = l.zone, (0 >= x.$length ? $throwRuntimeError("index out of range") : x.$array[x.$offset + 0]));
		return l;
	};
	$pkg.FixedZone = FixedZone;
	Location.ptr.prototype.lookup = function(sec) {
		var $ptr, _q, _r$1, end, hi, isDST, l, lim, lo, m, name, offset, sec, start, tx, x, x$1, x$2, x$3, x$4, x$5, x$6, x$7, x$8, zone$1, zone$2, zone$3, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _q = $f._q; _r$1 = $f._r$1; end = $f.end; hi = $f.hi; isDST = $f.isDST; l = $f.l; lim = $f.lim; lo = $f.lo; m = $f.m; name = $f.name; offset = $f.offset; sec = $f.sec; start = $f.start; tx = $f.tx; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; x$3 = $f.x$3; x$4 = $f.x$4; x$5 = $f.x$5; x$6 = $f.x$6; x$7 = $f.x$7; x$8 = $f.x$8; zone$1 = $f.zone$1; zone$2 = $f.zone$2; zone$3 = $f.zone$3; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		name = "";
		offset = 0;
		isDST = false;
		start = new $Int64(0, 0);
		end = new $Int64(0, 0);
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		if (l.zone.$length === 0) {
			name = "UTC";
			offset = 0;
			isDST = false;
			start = new $Int64(-2147483648, 0);
			end = new $Int64(2147483647, 4294967295);
			return [name, offset, isDST, start, end];
		}
		zone$1 = l.cacheZone;
		if (!(zone$1 === ptrType.nil) && (x = l.cacheStart, (x.$high < sec.$high || (x.$high === sec.$high && x.$low <= sec.$low))) && (x$1 = l.cacheEnd, (sec.$high < x$1.$high || (sec.$high === x$1.$high && sec.$low < x$1.$low)))) {
			name = zone$1.name;
			offset = zone$1.offset;
			isDST = zone$1.isDST;
			start = l.cacheStart;
			end = l.cacheEnd;
			return [name, offset, isDST, start, end];
		}
		if ((l.tx.$length === 0) || (x$2 = (x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).when, (sec.$high < x$2.$high || (sec.$high === x$2.$high && sec.$low < x$2.$low)))) {
			zone$2 = (x$4 = l.zone, x$5 = l.lookupFirstZone(), ((x$5 < 0 || x$5 >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + x$5]));
			name = zone$2.name;
			offset = zone$2.offset;
			isDST = zone$2.isDST;
			start = new $Int64(-2147483648, 0);
			if (l.tx.$length > 0) {
				end = (x$6 = l.tx, (0 >= x$6.$length ? $throwRuntimeError("index out of range") : x$6.$array[x$6.$offset + 0])).when;
			} else {
				end = new $Int64(2147483647, 4294967295);
			}
			return [name, offset, isDST, start, end];
		}
		tx = l.tx;
		end = new $Int64(2147483647, 4294967295);
		lo = 0;
		hi = tx.$length;
		while (true) {
			if (!((hi - lo >> 0) > 1)) { break; }
			m = lo + (_q = ((hi - lo >> 0)) / 2, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero")) >> 0;
			lim = ((m < 0 || m >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + m]).when;
			if ((sec.$high < lim.$high || (sec.$high === lim.$high && sec.$low < lim.$low))) {
				end = lim;
				hi = m;
			} else {
				lo = m;
			}
		}
		zone$3 = (x$7 = l.zone, x$8 = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).index, ((x$8 < 0 || x$8 >= x$7.$length) ? $throwRuntimeError("index out of range") : x$7.$array[x$7.$offset + x$8]));
		name = zone$3.name;
		offset = zone$3.offset;
		isDST = zone$3.isDST;
		start = ((lo < 0 || lo >= tx.$length) ? $throwRuntimeError("index out of range") : tx.$array[tx.$offset + lo]).when;
		return [name, offset, isDST, start, end];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookup }; } $f.$ptr = $ptr; $f._q = _q; $f._r$1 = _r$1; $f.end = end; $f.hi = hi; $f.isDST = isDST; $f.l = l; $f.lim = lim; $f.lo = lo; $f.m = m; $f.name = name; $f.offset = offset; $f.sec = sec; $f.start = start; $f.tx = tx; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.x$3 = x$3; $f.x$4 = x$4; $f.x$5 = x$5; $f.x$6 = x$6; $f.x$7 = x$7; $f.x$8 = x$8; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.zone$3 = zone$3; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookup = function(sec) { return this.$val.lookup(sec); };
	Location.ptr.prototype.lookupFirstZone = function() {
		var $ptr, _i, _ref, l, x, x$1, x$2, x$3, x$4, x$5, zi, zi$1;
		l = this;
		if (!l.firstZoneUsed()) {
			return 0;
		}
		if (l.tx.$length > 0 && (x = l.zone, x$1 = (x$2 = l.tx, (0 >= x$2.$length ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + 0])).index, ((x$1 < 0 || x$1 >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + x$1])).isDST) {
			zi = ((x$3 = l.tx, (0 >= x$3.$length ? $throwRuntimeError("index out of range") : x$3.$array[x$3.$offset + 0])).index >> 0) - 1 >> 0;
			while (true) {
				if (!(zi >= 0)) { break; }
				if (!(x$4 = l.zone, ((zi < 0 || zi >= x$4.$length) ? $throwRuntimeError("index out of range") : x$4.$array[x$4.$offset + zi])).isDST) {
					return zi;
				}
				zi = zi - (1) >> 0;
			}
		}
		_ref = l.zone;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			zi$1 = _i;
			if (!(x$5 = l.zone, ((zi$1 < 0 || zi$1 >= x$5.$length) ? $throwRuntimeError("index out of range") : x$5.$array[x$5.$offset + zi$1])).isDST) {
				return zi$1;
			}
			_i++;
		}
		return 0;
	};
	Location.prototype.lookupFirstZone = function() { return this.$val.lookupFirstZone(); };
	Location.ptr.prototype.firstZoneUsed = function() {
		var $ptr, _i, _ref, l, tx;
		l = this;
		_ref = l.tx;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			tx = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), zoneTrans);
			if (tx.index === 0) {
				return true;
			}
			_i++;
		}
		return false;
	};
	Location.prototype.firstZoneUsed = function() { return this.$val.firstZoneUsed(); };
	Location.ptr.prototype.lookupName = function(name, unix) {
		var $ptr, _i, _i$1, _r$1, _r$2, _ref, _ref$1, _tmp, _tmp$1, _tmp$2, _tmp$3, _tmp$4, _tmp$5, _tuple$1, i, i$1, isDST, isDST$1, l, nam, name, offset, offset$1, ok, unix, x, x$1, x$2, zone$1, zone$2, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _i = $f._i; _i$1 = $f._i$1; _r$1 = $f._r$1; _r$2 = $f._r$2; _ref = $f._ref; _ref$1 = $f._ref$1; _tmp = $f._tmp; _tmp$1 = $f._tmp$1; _tmp$2 = $f._tmp$2; _tmp$3 = $f._tmp$3; _tmp$4 = $f._tmp$4; _tmp$5 = $f._tmp$5; _tuple$1 = $f._tuple$1; i = $f.i; i$1 = $f.i$1; isDST = $f.isDST; isDST$1 = $f.isDST$1; l = $f.l; nam = $f.nam; name = $f.name; offset = $f.offset; offset$1 = $f.offset$1; ok = $f.ok; unix = $f.unix; x = $f.x; x$1 = $f.x$1; x$2 = $f.x$2; zone$1 = $f.zone$1; zone$2 = $f.zone$2; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		offset = 0;
		isDST = false;
		ok = false;
		l = this;
		_r$1 = l.get(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		l = _r$1;
		_ref = l.zone;
		_i = 0;
		/* while (true) { */ case 2:
			/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 3; continue; }
			i = _i;
			zone$1 = (x = l.zone, ((i < 0 || i >= x.$length) ? $throwRuntimeError("index out of range") : x.$array[x.$offset + i]));
			/* */ if (zone$1.name === name) { $s = 4; continue; }
			/* */ $s = 5; continue;
			/* if (zone$1.name === name) { */ case 4:
				_r$2 = l.lookup((x$1 = new $Int64(0, zone$1.offset), new $Int64(unix.$high - x$1.$high, unix.$low - x$1.$low))); /* */ $s = 6; case 6: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
				_tuple$1 = _r$2;
				nam = _tuple$1[0];
				offset$1 = _tuple$1[1];
				isDST$1 = _tuple$1[2];
				if (nam === zone$1.name) {
					_tmp = offset$1;
					_tmp$1 = isDST$1;
					_tmp$2 = true;
					offset = _tmp;
					isDST = _tmp$1;
					ok = _tmp$2;
					return [offset, isDST, ok];
				}
			/* } */ case 5:
			_i++;
		/* } */ $s = 2; continue; case 3:
		_ref$1 = l.zone;
		_i$1 = 0;
		while (true) {
			if (!(_i$1 < _ref$1.$length)) { break; }
			i$1 = _i$1;
			zone$2 = (x$2 = l.zone, ((i$1 < 0 || i$1 >= x$2.$length) ? $throwRuntimeError("index out of range") : x$2.$array[x$2.$offset + i$1]));
			if (zone$2.name === name) {
				_tmp$3 = zone$2.offset;
				_tmp$4 = zone$2.isDST;
				_tmp$5 = true;
				offset = _tmp$3;
				isDST = _tmp$4;
				ok = _tmp$5;
				return [offset, isDST, ok];
			}
			_i$1++;
		}
		return [offset, isDST, ok];
		/* */ } return; } if ($f === undefined) { $f = { $blk: Location.ptr.prototype.lookupName }; } $f.$ptr = $ptr; $f._i = _i; $f._i$1 = _i$1; $f._r$1 = _r$1; $f._r$2 = _r$2; $f._ref = _ref; $f._ref$1 = _ref$1; $f._tmp = _tmp; $f._tmp$1 = _tmp$1; $f._tmp$2 = _tmp$2; $f._tmp$3 = _tmp$3; $f._tmp$4 = _tmp$4; $f._tmp$5 = _tmp$5; $f._tuple$1 = _tuple$1; $f.i = i; $f.i$1 = i$1; $f.isDST = isDST; $f.isDST$1 = isDST$1; $f.l = l; $f.nam = nam; $f.name = name; $f.offset = offset; $f.offset$1 = offset$1; $f.ok = ok; $f.unix = unix; $f.x = x; $f.x$1 = x$1; $f.x$2 = x$2; $f.zone$1 = zone$1; $f.zone$2 = zone$2; $f.$s = $s; $f.$r = $r; return $f;
	};
	Location.prototype.lookupName = function(name, unix) { return this.$val.lookupName(name, unix); };
	ptrType$3.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$4.methods = [{prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([Duration], [$Bool], false)}];
	Time.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Format", name: "Format", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "AppendFormat", name: "AppendFormat", pkg: "", typ: $funcType([sliceType$3, $String], [sliceType$3], false)}, {prop: "After", name: "After", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Before", name: "Before", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "Equal", name: "Equal", pkg: "", typ: $funcType([Time], [$Bool], false)}, {prop: "IsZero", name: "IsZero", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "abs", name: "abs", pkg: "time", typ: $funcType([], [$Uint64], false)}, {prop: "locabs", name: "locabs", pkg: "time", typ: $funcType([], [$String, $Int, $Uint64], false)}, {prop: "Date", name: "Date", pkg: "", typ: $funcType([], [$Int, Month, $Int], false)}, {prop: "Year", name: "Year", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Month", name: "Month", pkg: "", typ: $funcType([], [Month], false)}, {prop: "Day", name: "Day", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Weekday", name: "Weekday", pkg: "", typ: $funcType([], [Weekday], false)}, {prop: "ISOWeek", name: "ISOWeek", pkg: "", typ: $funcType([], [$Int, $Int], false)}, {prop: "Clock", name: "Clock", pkg: "", typ: $funcType([], [$Int, $Int, $Int], false)}, {prop: "Hour", name: "Hour", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Minute", name: "Minute", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Second", name: "Second", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Nanosecond", name: "Nanosecond", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "YearDay", name: "YearDay", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Sub", name: "Sub", pkg: "", typ: $funcType([Time], [Duration], false)}, {prop: "AddDate", name: "AddDate", pkg: "", typ: $funcType([$Int, $Int, $Int], [Time], false)}, {prop: "date", name: "date", pkg: "time", typ: $funcType([$Bool], [$Int, Month, $Int, $Int], false)}, {prop: "UTC", name: "UTC", pkg: "", typ: $funcType([], [Time], false)}, {prop: "Local", name: "Local", pkg: "", typ: $funcType([], [Time], false)}, {prop: "In", name: "In", pkg: "", typ: $funcType([ptrType$1], [Time], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "Zone", name: "Zone", pkg: "", typ: $funcType([], [$String, $Int], false)}, {prop: "Unix", name: "Unix", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "UnixNano", name: "UnixNano", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "MarshalBinary", name: "MarshalBinary", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "GobEncode", name: "GobEncode", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalJSON", name: "MarshalJSON", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "MarshalText", name: "MarshalText", pkg: "", typ: $funcType([], [sliceType$3, $error], false)}, {prop: "Truncate", name: "Truncate", pkg: "", typ: $funcType([Duration], [Time], false)}, {prop: "Round", name: "Round", pkg: "", typ: $funcType([Duration], [Time], false)}];
	ptrType$6.methods = [{prop: "UnmarshalBinary", name: "UnmarshalBinary", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "GobDecode", name: "GobDecode", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalJSON", name: "UnmarshalJSON", pkg: "", typ: $funcType([sliceType$3], [$error], false)}, {prop: "UnmarshalText", name: "UnmarshalText", pkg: "", typ: $funcType([sliceType$3], [$error], false)}];
	Month.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Weekday.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}];
	Duration.methods = [{prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Nanoseconds", name: "Nanoseconds", pkg: "", typ: $funcType([], [$Int64], false)}, {prop: "Seconds", name: "Seconds", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Minutes", name: "Minutes", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Hours", name: "Hours", pkg: "", typ: $funcType([], [$Float64], false)}];
	ptrType$1.methods = [{prop: "get", name: "get", pkg: "time", typ: $funcType([], [ptrType$1], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "lookup", name: "lookup", pkg: "time", typ: $funcType([$Int64], [$String, $Int, $Bool, $Int64, $Int64], false)}, {prop: "lookupFirstZone", name: "lookupFirstZone", pkg: "time", typ: $funcType([], [$Int], false)}, {prop: "firstZoneUsed", name: "firstZoneUsed", pkg: "time", typ: $funcType([], [$Bool], false)}, {prop: "lookupName", name: "lookupName", pkg: "time", typ: $funcType([$String, $Int64], [$Int, $Bool, $Bool], false)}];
	runtimeTimer.init([{prop: "i", name: "i", pkg: "time", typ: $Int32, tag: ""}, {prop: "when", name: "when", pkg: "time", typ: $Int64, tag: ""}, {prop: "period", name: "period", pkg: "time", typ: $Int64, tag: ""}, {prop: "f", name: "f", pkg: "time", typ: funcType$1, tag: ""}, {prop: "arg", name: "arg", pkg: "time", typ: $emptyInterface, tag: ""}, {prop: "timeout", name: "timeout", pkg: "time", typ: ptrType$2, tag: ""}, {prop: "active", name: "active", pkg: "time", typ: $Bool, tag: ""}]);
	ParseError.init([{prop: "Layout", name: "Layout", pkg: "", typ: $String, tag: ""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: ""}, {prop: "LayoutElem", name: "LayoutElem", pkg: "", typ: $String, tag: ""}, {prop: "ValueElem", name: "ValueElem", pkg: "", typ: $String, tag: ""}, {prop: "Message", name: "Message", pkg: "", typ: $String, tag: ""}]);
	Timer.init([{prop: "C", name: "C", pkg: "", typ: chanType$1, tag: ""}, {prop: "r", name: "r", pkg: "time", typ: runtimeTimer, tag: ""}]);
	Time.init([{prop: "sec", name: "sec", pkg: "time", typ: $Int64, tag: ""}, {prop: "nsec", name: "nsec", pkg: "time", typ: $Int32, tag: ""}, {prop: "loc", name: "loc", pkg: "time", typ: ptrType$1, tag: ""}]);
	Location.init([{prop: "name", name: "name", pkg: "time", typ: $String, tag: ""}, {prop: "zone", name: "zone", pkg: "time", typ: sliceType, tag: ""}, {prop: "tx", name: "tx", pkg: "time", typ: sliceType$1, tag: ""}, {prop: "cacheStart", name: "cacheStart", pkg: "time", typ: $Int64, tag: ""}, {prop: "cacheEnd", name: "cacheEnd", pkg: "time", typ: $Int64, tag: ""}, {prop: "cacheZone", name: "cacheZone", pkg: "time", typ: ptrType, tag: ""}]);
	zone.init([{prop: "name", name: "name", pkg: "time", typ: $String, tag: ""}, {prop: "offset", name: "offset", pkg: "time", typ: $Int, tag: ""}, {prop: "isDST", name: "isDST", pkg: "time", typ: $Bool, tag: ""}]);
	zoneTrans.init([{prop: "when", name: "when", pkg: "time", typ: $Int64, tag: ""}, {prop: "index", name: "index", pkg: "time", typ: $Uint8, tag: ""}, {prop: "isstd", name: "isstd", pkg: "time", typ: $Bool, tag: ""}, {prop: "isutc", name: "isutc", pkg: "time", typ: $Bool, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = nosync.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = runtime.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = syscall.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		localLoc = new Location.ptr("", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		localOnce = new nosync.Once.ptr(false, false);
		std0x = $toNativeArray($kindInt, [260, 265, 524, 526, 528, 274]);
		longDayNames = new sliceType$2(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		shortDayNames = new sliceType$2(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
		shortMonthNames = new sliceType$2(["---", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
		longMonthNames = new sliceType$2(["---", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		atoiError = errors.New("time: invalid number");
		errBad = errors.New("bad value for field");
		errLeadingInt = errors.New("time: bad [0-9]*");
		months = $toNativeArray($kindString, ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
		days = $toNativeArray($kindString, ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
		daysBefore = $toNativeArray($kindInt32, [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365]);
		utcLoc = new Location.ptr("UTC", sliceType.nil, sliceType$1.nil, new $Int64(0, 0), new $Int64(0, 0), ptrType.nil);
		$pkg.UTC = utcLoc;
		$pkg.Local = localLoc;
		_r = syscall.Getenv("ZONEINFO"); /* */ $s = 7; case 7: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_tuple = _r;
		zoneinfo = _tuple[0];
		badData = errors.New("malformed time zone information");
		zoneDirs = new sliceType$2(["/usr/share/zoneinfo/", "/usr/share/lib/zoneinfo/", "/usr/lib/locale/TZ/", runtime.GOROOT() + "/lib/time/zoneinfo.zip"]);
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["honnef.co/go/js/dom"] = (function() {
	var $pkg = {}, $init, js, strings, time, TokenList, Document, DocumentFragment, documentFragment, document, htmlDocument, URLUtils, Location, HTMLElement, Window, window, Selection, Screen, Navigator, Geolocation, PositionError, PositionOptions, Position, Coordinates, History, Console, DocumentType, DOMImplementation, StyleSheet, Node, BasicNode, Element, ClientRect, BasicHTMLElement, BasicElement, HTMLAnchorElement, HTMLAppletElement, HTMLAreaElement, HTMLAudioElement, HTMLBRElement, HTMLBaseElement, HTMLBodyElement, ValidityState, HTMLButtonElement, HTMLCanvasElement, CanvasRenderingContext2D, HTMLDListElement, HTMLDataElement, HTMLDataListElement, HTMLDirectoryElement, HTMLDivElement, HTMLEmbedElement, HTMLFieldSetElement, HTMLFontElement, HTMLFormElement, HTMLFrameElement, HTMLFrameSetElement, HTMLHRElement, HTMLHeadElement, HTMLHeadingElement, HTMLHtmlElement, HTMLIFrameElement, HTMLImageElement, HTMLInputElement, File, HTMLKeygenElement, HTMLLIElement, HTMLLabelElement, HTMLLegendElement, HTMLLinkElement, HTMLMapElement, HTMLMediaElement, HTMLMenuElement, HTMLMetaElement, HTMLMeterElement, HTMLModElement, HTMLOListElement, HTMLObjectElement, HTMLOptGroupElement, HTMLOptionElement, HTMLOutputElement, HTMLParagraphElement, HTMLParamElement, HTMLPreElement, HTMLProgressElement, HTMLQuoteElement, HTMLScriptElement, HTMLSelectElement, HTMLSourceElement, HTMLSpanElement, HTMLStyleElement, HTMLTableCaptionElement, HTMLTableCellElement, HTMLTableColElement, HTMLTableDataCellElement, HTMLTableElement, HTMLTableHeaderCellElement, HTMLTableRowElement, HTMLTableSectionElement, HTMLTextAreaElement, HTMLTimeElement, HTMLTitleElement, TextTrack, HTMLTrackElement, HTMLUListElement, HTMLUnknownElement, HTMLVideoElement, CSSStyleDeclaration, Text, Event, BasicEvent, AnimationEvent, AudioProcessingEvent, BeforeInputEvent, BeforeUnloadEvent, BlobEvent, ClipboardEvent, CloseEvent, CompositionEvent, CSSFontFaceLoadEvent, CustomEvent, DeviceLightEvent, DeviceMotionEvent, DeviceOrientationEvent, DeviceProximityEvent, DOMTransactionEvent, DragEvent, EditingBeforeInputEvent, ErrorEvent, FocusEvent, GamepadEvent, HashChangeEvent, IDBVersionChangeEvent, KeyboardEvent, MediaStreamEvent, MessageEvent, MouseEvent, MutationEvent, OfflineAudioCompletionEvent, PageTransitionEvent, PointerEvent, PopStateEvent, ProgressEvent, RelatedEvent, RTCPeerConnectionIceEvent, SensorEvent, StorageEvent, SVGEvent, SVGZoomEvent, TimeEvent, TouchEvent, TrackEvent, TransitionEvent, UIEvent, UserProximityEvent, WheelEvent, sliceType, ptrType, sliceType$1, sliceType$2, sliceType$3, sliceType$4, ptrType$1, ptrType$2, ptrType$3, ptrType$4, ptrType$5, ptrType$6, sliceType$5, ptrType$7, sliceType$6, sliceType$7, sliceType$8, ptrType$8, ptrType$9, sliceType$9, ptrType$10, sliceType$10, ptrType$11, sliceType$11, ptrType$12, funcType, funcType$1, ptrType$13, sliceType$12, ptrType$14, ptrType$15, sliceType$13, ptrType$16, sliceType$14, ptrType$17, sliceType$15, ptrType$18, ptrType$19, ptrType$20, funcType$2, sliceType$16, ptrType$21, ptrType$22, ptrType$23, ptrType$24, mapType, ptrType$25, ptrType$26, funcType$3, ptrType$27, ptrType$28, funcType$4, funcType$5, ptrType$29, ptrType$30, ptrType$31, ptrType$32, ptrType$33, ptrType$34, ptrType$35, ptrType$36, ptrType$37, ptrType$38, ptrType$39, ptrType$40, ptrType$41, ptrType$42, ptrType$43, ptrType$44, ptrType$45, ptrType$46, ptrType$47, ptrType$48, ptrType$49, ptrType$50, ptrType$51, ptrType$52, ptrType$53, ptrType$54, toString, callRecover, elementConstructor, arrayToObjects, nodeListToObjects, nodeListToNodes, nodeListToElements, nodeListToHTMLElements, WrapDocument, WrapNode, WrapElement, WrapHTMLElement, wrapDocument, wrapDocumentFragment, wrapNode, wrapElement, wrapHTMLElement, getForm, getLabels, getOptions, wrapDOMHighResTimeStamp, WrapEvent, wrapEvent;
	js = $packages["github.com/gopherjs/gopherjs/js"];
	strings = $packages["strings"];
	time = $packages["time"];
	TokenList = $pkg.TokenList = $newType(0, $kindStruct, "dom.TokenList", "TokenList", "honnef.co/go/js/dom", function(dtl_, o_, sa_, Length_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.dtl = null;
			this.o = null;
			this.sa = "";
			this.Length = 0;
			return;
		}
		this.dtl = dtl_;
		this.o = o_;
		this.sa = sa_;
		this.Length = Length_;
	});
	Document = $pkg.Document = $newType(8, $kindInterface, "dom.Document", "Document", "honnef.co/go/js/dom", null);
	DocumentFragment = $pkg.DocumentFragment = $newType(8, $kindInterface, "dom.DocumentFragment", "DocumentFragment", "honnef.co/go/js/dom", null);
	documentFragment = $pkg.documentFragment = $newType(0, $kindStruct, "dom.documentFragment", "documentFragment", "honnef.co/go/js/dom", function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$22.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	document = $pkg.document = $newType(0, $kindStruct, "dom.document", "document", "honnef.co/go/js/dom", function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$22.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	htmlDocument = $pkg.htmlDocument = $newType(0, $kindStruct, "dom.htmlDocument", "htmlDocument", "honnef.co/go/js/dom", function(document_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.document = ptrType$23.nil;
			return;
		}
		this.document = document_;
	});
	URLUtils = $pkg.URLUtils = $newType(0, $kindStruct, "dom.URLUtils", "URLUtils", "honnef.co/go/js/dom", function(Object_, Href_, Protocol_, Host_, Hostname_, Port_, Pathname_, Search_, Hash_, Username_, Password_, Origin_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Href = "";
			this.Protocol = "";
			this.Host = "";
			this.Hostname = "";
			this.Port = "";
			this.Pathname = "";
			this.Search = "";
			this.Hash = "";
			this.Username = "";
			this.Password = "";
			this.Origin = "";
			return;
		}
		this.Object = Object_;
		this.Href = Href_;
		this.Protocol = Protocol_;
		this.Host = Host_;
		this.Hostname = Hostname_;
		this.Port = Port_;
		this.Pathname = Pathname_;
		this.Search = Search_;
		this.Hash = Hash_;
		this.Username = Username_;
		this.Password = Password_;
		this.Origin = Origin_;
	});
	Location = $pkg.Location = $newType(0, $kindStruct, "dom.Location", "Location", "honnef.co/go/js/dom", function(Object_, URLUtils_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.URLUtils = ptrType$2.nil;
			return;
		}
		this.Object = Object_;
		this.URLUtils = URLUtils_;
	});
	HTMLElement = $pkg.HTMLElement = $newType(8, $kindInterface, "dom.HTMLElement", "HTMLElement", "honnef.co/go/js/dom", null);
	Window = $pkg.Window = $newType(8, $kindInterface, "dom.Window", "Window", "honnef.co/go/js/dom", null);
	window = $pkg.window = $newType(0, $kindStruct, "dom.window", "window", "honnef.co/go/js/dom", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Selection = $pkg.Selection = $newType(8, $kindInterface, "dom.Selection", "Selection", "honnef.co/go/js/dom", null);
	Screen = $pkg.Screen = $newType(0, $kindStruct, "dom.Screen", "Screen", "honnef.co/go/js/dom", function(Object_, AvailTop_, AvailLeft_, AvailHeight_, AvailWidth_, ColorDepth_, Height_, Left_, PixelDepth_, Top_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.AvailTop = 0;
			this.AvailLeft = 0;
			this.AvailHeight = 0;
			this.AvailWidth = 0;
			this.ColorDepth = 0;
			this.Height = 0;
			this.Left = 0;
			this.PixelDepth = 0;
			this.Top = 0;
			this.Width = 0;
			return;
		}
		this.Object = Object_;
		this.AvailTop = AvailTop_;
		this.AvailLeft = AvailLeft_;
		this.AvailHeight = AvailHeight_;
		this.AvailWidth = AvailWidth_;
		this.ColorDepth = ColorDepth_;
		this.Height = Height_;
		this.Left = Left_;
		this.PixelDepth = PixelDepth_;
		this.Top = Top_;
		this.Width = Width_;
	});
	Navigator = $pkg.Navigator = $newType(8, $kindInterface, "dom.Navigator", "Navigator", "honnef.co/go/js/dom", null);
	Geolocation = $pkg.Geolocation = $newType(8, $kindInterface, "dom.Geolocation", "Geolocation", "honnef.co/go/js/dom", null);
	PositionError = $pkg.PositionError = $newType(0, $kindStruct, "dom.PositionError", "PositionError", "honnef.co/go/js/dom", function(Object_, Code_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Code = 0;
			return;
		}
		this.Object = Object_;
		this.Code = Code_;
	});
	PositionOptions = $pkg.PositionOptions = $newType(0, $kindStruct, "dom.PositionOptions", "PositionOptions", "honnef.co/go/js/dom", function(EnableHighAccuracy_, Timeout_, MaximumAge_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.EnableHighAccuracy = false;
			this.Timeout = new time.Duration(0, 0);
			this.MaximumAge = new time.Duration(0, 0);
			return;
		}
		this.EnableHighAccuracy = EnableHighAccuracy_;
		this.Timeout = Timeout_;
		this.MaximumAge = MaximumAge_;
	});
	Position = $pkg.Position = $newType(0, $kindStruct, "dom.Position", "Position", "honnef.co/go/js/dom", function(Coords_, Timestamp_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Coords = ptrType$30.nil;
			this.Timestamp = new time.Time.ptr(new $Int64(0, 0), 0, ptrType$4.nil);
			return;
		}
		this.Coords = Coords_;
		this.Timestamp = Timestamp_;
	});
	Coordinates = $pkg.Coordinates = $newType(0, $kindStruct, "dom.Coordinates", "Coordinates", "honnef.co/go/js/dom", function(Object_, Latitude_, Longitude_, Altitude_, Accuracy_, AltitudeAccuracy_, Heading_, Speed_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Latitude = 0;
			this.Longitude = 0;
			this.Altitude = 0;
			this.Accuracy = 0;
			this.AltitudeAccuracy = 0;
			this.Heading = 0;
			this.Speed = 0;
			return;
		}
		this.Object = Object_;
		this.Latitude = Latitude_;
		this.Longitude = Longitude_;
		this.Altitude = Altitude_;
		this.Accuracy = Accuracy_;
		this.AltitudeAccuracy = AltitudeAccuracy_;
		this.Heading = Heading_;
		this.Speed = Speed_;
	});
	History = $pkg.History = $newType(8, $kindInterface, "dom.History", "History", "honnef.co/go/js/dom", null);
	Console = $pkg.Console = $newType(0, $kindStruct, "dom.Console", "Console", "honnef.co/go/js/dom", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	DocumentType = $pkg.DocumentType = $newType(8, $kindInterface, "dom.DocumentType", "DocumentType", "honnef.co/go/js/dom", null);
	DOMImplementation = $pkg.DOMImplementation = $newType(8, $kindInterface, "dom.DOMImplementation", "DOMImplementation", "honnef.co/go/js/dom", null);
	StyleSheet = $pkg.StyleSheet = $newType(8, $kindInterface, "dom.StyleSheet", "StyleSheet", "honnef.co/go/js/dom", null);
	Node = $pkg.Node = $newType(8, $kindInterface, "dom.Node", "Node", "honnef.co/go/js/dom", null);
	BasicNode = $pkg.BasicNode = $newType(0, $kindStruct, "dom.BasicNode", "BasicNode", "honnef.co/go/js/dom", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Element = $pkg.Element = $newType(8, $kindInterface, "dom.Element", "Element", "honnef.co/go/js/dom", null);
	ClientRect = $pkg.ClientRect = $newType(0, $kindStruct, "dom.ClientRect", "ClientRect", "honnef.co/go/js/dom", function(Object_, Height_, Width_, Left_, Right_, Top_, Bottom_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.Height = 0;
			this.Width = 0;
			this.Left = 0;
			this.Right = 0;
			this.Top = 0;
			this.Bottom = 0;
			return;
		}
		this.Object = Object_;
		this.Height = Height_;
		this.Width = Width_;
		this.Left = Left_;
		this.Right = Right_;
		this.Top = Top_;
		this.Bottom = Bottom_;
	});
	BasicHTMLElement = $pkg.BasicHTMLElement = $newType(0, $kindStruct, "dom.BasicHTMLElement", "BasicHTMLElement", "honnef.co/go/js/dom", function(BasicElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicElement = ptrType$31.nil;
			return;
		}
		this.BasicElement = BasicElement_;
	});
	BasicElement = $pkg.BasicElement = $newType(0, $kindStruct, "dom.BasicElement", "BasicElement", "honnef.co/go/js/dom", function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$22.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	HTMLAnchorElement = $pkg.HTMLAnchorElement = $newType(0, $kindStruct, "dom.HTMLAnchorElement", "HTMLAnchorElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, URLUtils_, HrefLang_, Media_, TabIndex_, Target_, Text_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.URLUtils = ptrType$2.nil;
			this.HrefLang = "";
			this.Media = "";
			this.TabIndex = 0;
			this.Target = "";
			this.Text = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.URLUtils = URLUtils_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.TabIndex = TabIndex_;
		this.Target = Target_;
		this.Text = Text_;
		this.Type = Type_;
	});
	HTMLAppletElement = $pkg.HTMLAppletElement = $newType(0, $kindStruct, "dom.HTMLAppletElement", "HTMLAppletElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Alt_, Coords_, HrefLang_, Media_, Search_, Shape_, TabIndex_, Target_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Alt = "";
			this.Coords = "";
			this.HrefLang = "";
			this.Media = "";
			this.Search = "";
			this.Shape = "";
			this.TabIndex = 0;
			this.Target = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Alt = Alt_;
		this.Coords = Coords_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.Search = Search_;
		this.Shape = Shape_;
		this.TabIndex = TabIndex_;
		this.Target = Target_;
		this.Type = Type_;
	});
	HTMLAreaElement = $pkg.HTMLAreaElement = $newType(0, $kindStruct, "dom.HTMLAreaElement", "HTMLAreaElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, URLUtils_, Alt_, Coords_, HrefLang_, Media_, Search_, Shape_, TabIndex_, Target_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.URLUtils = ptrType$2.nil;
			this.Alt = "";
			this.Coords = "";
			this.HrefLang = "";
			this.Media = "";
			this.Search = "";
			this.Shape = "";
			this.TabIndex = 0;
			this.Target = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.URLUtils = URLUtils_;
		this.Alt = Alt_;
		this.Coords = Coords_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.Search = Search_;
		this.Shape = Shape_;
		this.TabIndex = TabIndex_;
		this.Target = Target_;
		this.Type = Type_;
	});
	HTMLAudioElement = $pkg.HTMLAudioElement = $newType(0, $kindStruct, "dom.HTMLAudioElement", "HTMLAudioElement", "honnef.co/go/js/dom", function(HTMLMediaElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.HTMLMediaElement = ptrType$3.nil;
			return;
		}
		this.HTMLMediaElement = HTMLMediaElement_;
	});
	HTMLBRElement = $pkg.HTMLBRElement = $newType(0, $kindStruct, "dom.HTMLBRElement", "HTMLBRElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLBaseElement = $pkg.HTMLBaseElement = $newType(0, $kindStruct, "dom.HTMLBaseElement", "HTMLBaseElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLBodyElement = $pkg.HTMLBodyElement = $newType(0, $kindStruct, "dom.HTMLBodyElement", "HTMLBodyElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	ValidityState = $pkg.ValidityState = $newType(0, $kindStruct, "dom.ValidityState", "ValidityState", "honnef.co/go/js/dom", function(Object_, CustomError_, PatternMismatch_, RangeOverflow_, RangeUnderflow_, StepMismatch_, TooLong_, TypeMismatch_, Valid_, ValueMissing_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.CustomError = false;
			this.PatternMismatch = false;
			this.RangeOverflow = false;
			this.RangeUnderflow = false;
			this.StepMismatch = false;
			this.TooLong = false;
			this.TypeMismatch = false;
			this.Valid = false;
			this.ValueMissing = false;
			return;
		}
		this.Object = Object_;
		this.CustomError = CustomError_;
		this.PatternMismatch = PatternMismatch_;
		this.RangeOverflow = RangeOverflow_;
		this.RangeUnderflow = RangeUnderflow_;
		this.StepMismatch = StepMismatch_;
		this.TooLong = TooLong_;
		this.TypeMismatch = TypeMismatch_;
		this.Valid = Valid_;
		this.ValueMissing = ValueMissing_;
	});
	HTMLButtonElement = $pkg.HTMLButtonElement = $newType(0, $kindStruct, "dom.HTMLButtonElement", "HTMLButtonElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, AutoFocus_, Disabled_, FormAction_, FormEncType_, FormMethod_, FormNoValidate_, FormTarget_, Name_, TabIndex_, Type_, ValidationMessage_, Value_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.AutoFocus = false;
			this.Disabled = false;
			this.FormAction = "";
			this.FormEncType = "";
			this.FormMethod = "";
			this.FormNoValidate = false;
			this.FormTarget = "";
			this.Name = "";
			this.TabIndex = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.AutoFocus = AutoFocus_;
		this.Disabled = Disabled_;
		this.FormAction = FormAction_;
		this.FormEncType = FormEncType_;
		this.FormMethod = FormMethod_;
		this.FormNoValidate = FormNoValidate_;
		this.FormTarget = FormTarget_;
		this.Name = Name_;
		this.TabIndex = TabIndex_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
	});
	HTMLCanvasElement = $pkg.HTMLCanvasElement = $newType(0, $kindStruct, "dom.HTMLCanvasElement", "HTMLCanvasElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Height_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Height = 0;
			this.Width = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Height = Height_;
		this.Width = Width_;
	});
	CanvasRenderingContext2D = $pkg.CanvasRenderingContext2D = $newType(0, $kindStruct, "dom.CanvasRenderingContext2D", "CanvasRenderingContext2D", "honnef.co/go/js/dom", function(Object_, FillStyle_, StrokeStyle_, ShadowColor_, ShadowBlur_, ShadowOffsetX_, ShadowOffsetY_, LineCap_, LineJoin_, LineWidth_, MiterLimit_, Font_, TextAlign_, TextBaseline_, GlobalAlpha_, GlobalCompositeOperation_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			this.FillStyle = "";
			this.StrokeStyle = "";
			this.ShadowColor = "";
			this.ShadowBlur = 0;
			this.ShadowOffsetX = 0;
			this.ShadowOffsetY = 0;
			this.LineCap = "";
			this.LineJoin = "";
			this.LineWidth = 0;
			this.MiterLimit = 0;
			this.Font = "";
			this.TextAlign = "";
			this.TextBaseline = "";
			this.GlobalAlpha = 0;
			this.GlobalCompositeOperation = "";
			return;
		}
		this.Object = Object_;
		this.FillStyle = FillStyle_;
		this.StrokeStyle = StrokeStyle_;
		this.ShadowColor = ShadowColor_;
		this.ShadowBlur = ShadowBlur_;
		this.ShadowOffsetX = ShadowOffsetX_;
		this.ShadowOffsetY = ShadowOffsetY_;
		this.LineCap = LineCap_;
		this.LineJoin = LineJoin_;
		this.LineWidth = LineWidth_;
		this.MiterLimit = MiterLimit_;
		this.Font = Font_;
		this.TextAlign = TextAlign_;
		this.TextBaseline = TextBaseline_;
		this.GlobalAlpha = GlobalAlpha_;
		this.GlobalCompositeOperation = GlobalCompositeOperation_;
	});
	HTMLDListElement = $pkg.HTMLDListElement = $newType(0, $kindStruct, "dom.HTMLDListElement", "HTMLDListElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLDataElement = $pkg.HTMLDataElement = $newType(0, $kindStruct, "dom.HTMLDataElement", "HTMLDataElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Value = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Value = Value_;
	});
	HTMLDataListElement = $pkg.HTMLDataListElement = $newType(0, $kindStruct, "dom.HTMLDataListElement", "HTMLDataListElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLDirectoryElement = $pkg.HTMLDirectoryElement = $newType(0, $kindStruct, "dom.HTMLDirectoryElement", "HTMLDirectoryElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLDivElement = $pkg.HTMLDivElement = $newType(0, $kindStruct, "dom.HTMLDivElement", "HTMLDivElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLEmbedElement = $pkg.HTMLEmbedElement = $newType(0, $kindStruct, "dom.HTMLEmbedElement", "HTMLEmbedElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Src_, Type_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Src = "";
			this.Type = "";
			this.Width = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Src = Src_;
		this.Type = Type_;
		this.Width = Width_;
	});
	HTMLFieldSetElement = $pkg.HTMLFieldSetElement = $newType(0, $kindStruct, "dom.HTMLFieldSetElement", "HTMLFieldSetElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Disabled_, Name_, Type_, ValidationMessage_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Disabled = false;
			this.Name = "";
			this.Type = "";
			this.ValidationMessage = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Disabled = Disabled_;
		this.Name = Name_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.WillValidate = WillValidate_;
	});
	HTMLFontElement = $pkg.HTMLFontElement = $newType(0, $kindStruct, "dom.HTMLFontElement", "HTMLFontElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLFormElement = $pkg.HTMLFormElement = $newType(0, $kindStruct, "dom.HTMLFormElement", "HTMLFormElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, AcceptCharset_, Action_, Autocomplete_, Encoding_, Enctype_, Length_, Method_, Name_, NoValidate_, Target_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.AcceptCharset = "";
			this.Action = "";
			this.Autocomplete = "";
			this.Encoding = "";
			this.Enctype = "";
			this.Length = 0;
			this.Method = "";
			this.Name = "";
			this.NoValidate = false;
			this.Target = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.AcceptCharset = AcceptCharset_;
		this.Action = Action_;
		this.Autocomplete = Autocomplete_;
		this.Encoding = Encoding_;
		this.Enctype = Enctype_;
		this.Length = Length_;
		this.Method = Method_;
		this.Name = Name_;
		this.NoValidate = NoValidate_;
		this.Target = Target_;
	});
	HTMLFrameElement = $pkg.HTMLFrameElement = $newType(0, $kindStruct, "dom.HTMLFrameElement", "HTMLFrameElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLFrameSetElement = $pkg.HTMLFrameSetElement = $newType(0, $kindStruct, "dom.HTMLFrameSetElement", "HTMLFrameSetElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHRElement = $pkg.HTMLHRElement = $newType(0, $kindStruct, "dom.HTMLHRElement", "HTMLHRElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHeadElement = $pkg.HTMLHeadElement = $newType(0, $kindStruct, "dom.HTMLHeadElement", "HTMLHeadElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHeadingElement = $pkg.HTMLHeadingElement = $newType(0, $kindStruct, "dom.HTMLHeadingElement", "HTMLHeadingElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLHtmlElement = $pkg.HTMLHtmlElement = $newType(0, $kindStruct, "dom.HTMLHtmlElement", "HTMLHtmlElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLIFrameElement = $pkg.HTMLIFrameElement = $newType(0, $kindStruct, "dom.HTMLIFrameElement", "HTMLIFrameElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Width_, Height_, Name_, Src_, SrcDoc_, Seamless_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Width = "";
			this.Height = "";
			this.Name = "";
			this.Src = "";
			this.SrcDoc = "";
			this.Seamless = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Width = Width_;
		this.Height = Height_;
		this.Name = Name_;
		this.Src = Src_;
		this.SrcDoc = SrcDoc_;
		this.Seamless = Seamless_;
	});
	HTMLImageElement = $pkg.HTMLImageElement = $newType(0, $kindStruct, "dom.HTMLImageElement", "HTMLImageElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Complete_, CrossOrigin_, Height_, IsMap_, NaturalHeight_, NaturalWidth_, Src_, UseMap_, Width_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Complete = false;
			this.CrossOrigin = "";
			this.Height = 0;
			this.IsMap = false;
			this.NaturalHeight = 0;
			this.NaturalWidth = 0;
			this.Src = "";
			this.UseMap = "";
			this.Width = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Complete = Complete_;
		this.CrossOrigin = CrossOrigin_;
		this.Height = Height_;
		this.IsMap = IsMap_;
		this.NaturalHeight = NaturalHeight_;
		this.NaturalWidth = NaturalWidth_;
		this.Src = Src_;
		this.UseMap = UseMap_;
		this.Width = Width_;
	});
	HTMLInputElement = $pkg.HTMLInputElement = $newType(0, $kindStruct, "dom.HTMLInputElement", "HTMLInputElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Accept_, Alt_, Autocomplete_, Autofocus_, Checked_, DefaultChecked_, DefaultValue_, DirName_, Disabled_, FormAction_, FormEncType_, FormMethod_, FormNoValidate_, FormTarget_, Height_, Indeterminate_, Max_, MaxLength_, Min_, Multiple_, Name_, Pattern_, Placeholder_, ReadOnly_, Required_, SelectionDirection_, SelectionEnd_, SelectionStart_, Size_, Src_, Step_, TabIndex_, Type_, ValidationMessage_, Value_, ValueAsDate_, ValueAsNumber_, Width_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Accept = "";
			this.Alt = "";
			this.Autocomplete = "";
			this.Autofocus = false;
			this.Checked = false;
			this.DefaultChecked = false;
			this.DefaultValue = "";
			this.DirName = "";
			this.Disabled = false;
			this.FormAction = "";
			this.FormEncType = "";
			this.FormMethod = "";
			this.FormNoValidate = false;
			this.FormTarget = "";
			this.Height = "";
			this.Indeterminate = false;
			this.Max = "";
			this.MaxLength = 0;
			this.Min = "";
			this.Multiple = false;
			this.Name = "";
			this.Pattern = "";
			this.Placeholder = "";
			this.ReadOnly = false;
			this.Required = false;
			this.SelectionDirection = "";
			this.SelectionEnd = 0;
			this.SelectionStart = 0;
			this.Size = 0;
			this.Src = "";
			this.Step = "";
			this.TabIndex = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.ValueAsDate = new time.Time.ptr(new $Int64(0, 0), 0, ptrType$4.nil);
			this.ValueAsNumber = 0;
			this.Width = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Accept = Accept_;
		this.Alt = Alt_;
		this.Autocomplete = Autocomplete_;
		this.Autofocus = Autofocus_;
		this.Checked = Checked_;
		this.DefaultChecked = DefaultChecked_;
		this.DefaultValue = DefaultValue_;
		this.DirName = DirName_;
		this.Disabled = Disabled_;
		this.FormAction = FormAction_;
		this.FormEncType = FormEncType_;
		this.FormMethod = FormMethod_;
		this.FormNoValidate = FormNoValidate_;
		this.FormTarget = FormTarget_;
		this.Height = Height_;
		this.Indeterminate = Indeterminate_;
		this.Max = Max_;
		this.MaxLength = MaxLength_;
		this.Min = Min_;
		this.Multiple = Multiple_;
		this.Name = Name_;
		this.Pattern = Pattern_;
		this.Placeholder = Placeholder_;
		this.ReadOnly = ReadOnly_;
		this.Required = Required_;
		this.SelectionDirection = SelectionDirection_;
		this.SelectionEnd = SelectionEnd_;
		this.SelectionStart = SelectionStart_;
		this.Size = Size_;
		this.Src = Src_;
		this.Step = Step_;
		this.TabIndex = TabIndex_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.ValueAsDate = ValueAsDate_;
		this.ValueAsNumber = ValueAsNumber_;
		this.Width = Width_;
		this.WillValidate = WillValidate_;
	});
	File = $pkg.File = $newType(0, $kindStruct, "dom.File", "File", "honnef.co/go/js/dom", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	HTMLKeygenElement = $pkg.HTMLKeygenElement = $newType(0, $kindStruct, "dom.HTMLKeygenElement", "HTMLKeygenElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Autofocus_, Challenge_, Disabled_, Keytype_, Name_, Type_, ValidationMessage_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Autofocus = false;
			this.Challenge = "";
			this.Disabled = false;
			this.Keytype = "";
			this.Name = "";
			this.Type = "";
			this.ValidationMessage = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Autofocus = Autofocus_;
		this.Challenge = Challenge_;
		this.Disabled = Disabled_;
		this.Keytype = Keytype_;
		this.Name = Name_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.WillValidate = WillValidate_;
	});
	HTMLLIElement = $pkg.HTMLLIElement = $newType(0, $kindStruct, "dom.HTMLLIElement", "HTMLLIElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Value = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Value = Value_;
	});
	HTMLLabelElement = $pkg.HTMLLabelElement = $newType(0, $kindStruct, "dom.HTMLLabelElement", "HTMLLabelElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, For_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.For = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.For = For_;
	});
	HTMLLegendElement = $pkg.HTMLLegendElement = $newType(0, $kindStruct, "dom.HTMLLegendElement", "HTMLLegendElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLLinkElement = $pkg.HTMLLinkElement = $newType(0, $kindStruct, "dom.HTMLLinkElement", "HTMLLinkElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Disabled_, Href_, HrefLang_, Media_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Disabled = false;
			this.Href = "";
			this.HrefLang = "";
			this.Media = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Disabled = Disabled_;
		this.Href = Href_;
		this.HrefLang = HrefLang_;
		this.Media = Media_;
		this.Type = Type_;
	});
	HTMLMapElement = $pkg.HTMLMapElement = $newType(0, $kindStruct, "dom.HTMLMapElement", "HTMLMapElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Name = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Name = Name_;
	});
	HTMLMediaElement = $pkg.HTMLMediaElement = $newType(0, $kindStruct, "dom.HTMLMediaElement", "HTMLMediaElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Paused_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Paused = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Paused = Paused_;
	});
	HTMLMenuElement = $pkg.HTMLMenuElement = $newType(0, $kindStruct, "dom.HTMLMenuElement", "HTMLMenuElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLMetaElement = $pkg.HTMLMetaElement = $newType(0, $kindStruct, "dom.HTMLMetaElement", "HTMLMetaElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Content_, HTTPEquiv_, Name_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Content = "";
			this.HTTPEquiv = "";
			this.Name = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Content = Content_;
		this.HTTPEquiv = HTTPEquiv_;
		this.Name = Name_;
	});
	HTMLMeterElement = $pkg.HTMLMeterElement = $newType(0, $kindStruct, "dom.HTMLMeterElement", "HTMLMeterElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, High_, Low_, Max_, Min_, Optimum_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.High = 0;
			this.Low = 0;
			this.Max = 0;
			this.Min = 0;
			this.Optimum = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.High = High_;
		this.Low = Low_;
		this.Max = Max_;
		this.Min = Min_;
		this.Optimum = Optimum_;
	});
	HTMLModElement = $pkg.HTMLModElement = $newType(0, $kindStruct, "dom.HTMLModElement", "HTMLModElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Cite_, DateTime_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Cite = "";
			this.DateTime = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Cite = Cite_;
		this.DateTime = DateTime_;
	});
	HTMLOListElement = $pkg.HTMLOListElement = $newType(0, $kindStruct, "dom.HTMLOListElement", "HTMLOListElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Reversed_, Start_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Reversed = false;
			this.Start = 0;
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Reversed = Reversed_;
		this.Start = Start_;
		this.Type = Type_;
	});
	HTMLObjectElement = $pkg.HTMLObjectElement = $newType(0, $kindStruct, "dom.HTMLObjectElement", "HTMLObjectElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Data_, Height_, Name_, TabIndex_, Type_, TypeMustMatch_, UseMap_, ValidationMessage_, With_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Data = "";
			this.Height = "";
			this.Name = "";
			this.TabIndex = 0;
			this.Type = "";
			this.TypeMustMatch = false;
			this.UseMap = "";
			this.ValidationMessage = "";
			this.With = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Data = Data_;
		this.Height = Height_;
		this.Name = Name_;
		this.TabIndex = TabIndex_;
		this.Type = Type_;
		this.TypeMustMatch = TypeMustMatch_;
		this.UseMap = UseMap_;
		this.ValidationMessage = ValidationMessage_;
		this.With = With_;
		this.WillValidate = WillValidate_;
	});
	HTMLOptGroupElement = $pkg.HTMLOptGroupElement = $newType(0, $kindStruct, "dom.HTMLOptGroupElement", "HTMLOptGroupElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Disabled_, Label_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Disabled = false;
			this.Label = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Disabled = Disabled_;
		this.Label = Label_;
	});
	HTMLOptionElement = $pkg.HTMLOptionElement = $newType(0, $kindStruct, "dom.HTMLOptionElement", "HTMLOptionElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, DefaultSelected_, Disabled_, Index_, Label_, Selected_, Text_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.DefaultSelected = false;
			this.Disabled = false;
			this.Index = 0;
			this.Label = "";
			this.Selected = false;
			this.Text = "";
			this.Value = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.DefaultSelected = DefaultSelected_;
		this.Disabled = Disabled_;
		this.Index = Index_;
		this.Label = Label_;
		this.Selected = Selected_;
		this.Text = Text_;
		this.Value = Value_;
	});
	HTMLOutputElement = $pkg.HTMLOutputElement = $newType(0, $kindStruct, "dom.HTMLOutputElement", "HTMLOutputElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, DefaultValue_, Name_, Type_, ValidationMessage_, Value_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.DefaultValue = "";
			this.Name = "";
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.DefaultValue = DefaultValue_;
		this.Name = Name_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
	});
	HTMLParagraphElement = $pkg.HTMLParagraphElement = $newType(0, $kindStruct, "dom.HTMLParagraphElement", "HTMLParagraphElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLParamElement = $pkg.HTMLParamElement = $newType(0, $kindStruct, "dom.HTMLParamElement", "HTMLParamElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Name_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Name = "";
			this.Value = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Name = Name_;
		this.Value = Value_;
	});
	HTMLPreElement = $pkg.HTMLPreElement = $newType(0, $kindStruct, "dom.HTMLPreElement", "HTMLPreElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLProgressElement = $pkg.HTMLProgressElement = $newType(0, $kindStruct, "dom.HTMLProgressElement", "HTMLProgressElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Max_, Position_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Max = 0;
			this.Position = 0;
			this.Value = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Max = Max_;
		this.Position = Position_;
		this.Value = Value_;
	});
	HTMLQuoteElement = $pkg.HTMLQuoteElement = $newType(0, $kindStruct, "dom.HTMLQuoteElement", "HTMLQuoteElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Cite_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Cite = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Cite = Cite_;
	});
	HTMLScriptElement = $pkg.HTMLScriptElement = $newType(0, $kindStruct, "dom.HTMLScriptElement", "HTMLScriptElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Type_, Src_, Charset_, Async_, Defer_, Text_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Type = "";
			this.Src = "";
			this.Charset = "";
			this.Async = false;
			this.Defer = false;
			this.Text = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Type = Type_;
		this.Src = Src_;
		this.Charset = Charset_;
		this.Async = Async_;
		this.Defer = Defer_;
		this.Text = Text_;
	});
	HTMLSelectElement = $pkg.HTMLSelectElement = $newType(0, $kindStruct, "dom.HTMLSelectElement", "HTMLSelectElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Autofocus_, Disabled_, Length_, Multiple_, Name_, Required_, SelectedIndex_, Size_, Type_, ValidationMessage_, Value_, WillValidate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Autofocus = false;
			this.Disabled = false;
			this.Length = 0;
			this.Multiple = false;
			this.Name = "";
			this.Required = false;
			this.SelectedIndex = 0;
			this.Size = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Autofocus = Autofocus_;
		this.Disabled = Disabled_;
		this.Length = Length_;
		this.Multiple = Multiple_;
		this.Name = Name_;
		this.Required = Required_;
		this.SelectedIndex = SelectedIndex_;
		this.Size = Size_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
	});
	HTMLSourceElement = $pkg.HTMLSourceElement = $newType(0, $kindStruct, "dom.HTMLSourceElement", "HTMLSourceElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Media_, Src_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Media = "";
			this.Src = "";
			this.Type = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Media = Media_;
		this.Src = Src_;
		this.Type = Type_;
	});
	HTMLSpanElement = $pkg.HTMLSpanElement = $newType(0, $kindStruct, "dom.HTMLSpanElement", "HTMLSpanElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLStyleElement = $pkg.HTMLStyleElement = $newType(0, $kindStruct, "dom.HTMLStyleElement", "HTMLStyleElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableCaptionElement = $pkg.HTMLTableCaptionElement = $newType(0, $kindStruct, "dom.HTMLTableCaptionElement", "HTMLTableCaptionElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableCellElement = $pkg.HTMLTableCellElement = $newType(0, $kindStruct, "dom.HTMLTableCellElement", "HTMLTableCellElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, ColSpan_, RowSpan_, CellIndex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.ColSpan = 0;
			this.RowSpan = 0;
			this.CellIndex = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.ColSpan = ColSpan_;
		this.RowSpan = RowSpan_;
		this.CellIndex = CellIndex_;
	});
	HTMLTableColElement = $pkg.HTMLTableColElement = $newType(0, $kindStruct, "dom.HTMLTableColElement", "HTMLTableColElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Span_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Span = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Span = Span_;
	});
	HTMLTableDataCellElement = $pkg.HTMLTableDataCellElement = $newType(0, $kindStruct, "dom.HTMLTableDataCellElement", "HTMLTableDataCellElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableElement = $pkg.HTMLTableElement = $newType(0, $kindStruct, "dom.HTMLTableElement", "HTMLTableElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTableHeaderCellElement = $pkg.HTMLTableHeaderCellElement = $newType(0, $kindStruct, "dom.HTMLTableHeaderCellElement", "HTMLTableHeaderCellElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Abbr_, Scope_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Abbr = "";
			this.Scope = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Abbr = Abbr_;
		this.Scope = Scope_;
	});
	HTMLTableRowElement = $pkg.HTMLTableRowElement = $newType(0, $kindStruct, "dom.HTMLTableRowElement", "HTMLTableRowElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, RowIndex_, SectionRowIndex_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.RowIndex = 0;
			this.SectionRowIndex = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.RowIndex = RowIndex_;
		this.SectionRowIndex = SectionRowIndex_;
	});
	HTMLTableSectionElement = $pkg.HTMLTableSectionElement = $newType(0, $kindStruct, "dom.HTMLTableSectionElement", "HTMLTableSectionElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLTextAreaElement = $pkg.HTMLTextAreaElement = $newType(0, $kindStruct, "dom.HTMLTextAreaElement", "HTMLTextAreaElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Autocomplete_, Autofocus_, Cols_, DefaultValue_, DirName_, Disabled_, MaxLength_, Name_, Placeholder_, ReadOnly_, Required_, Rows_, SelectionDirection_, SelectionStart_, SelectionEnd_, TabIndex_, TextLength_, Type_, ValidationMessage_, Value_, WillValidate_, Wrap_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Autocomplete = "";
			this.Autofocus = false;
			this.Cols = 0;
			this.DefaultValue = "";
			this.DirName = "";
			this.Disabled = false;
			this.MaxLength = 0;
			this.Name = "";
			this.Placeholder = "";
			this.ReadOnly = false;
			this.Required = false;
			this.Rows = 0;
			this.SelectionDirection = "";
			this.SelectionStart = 0;
			this.SelectionEnd = 0;
			this.TabIndex = 0;
			this.TextLength = 0;
			this.Type = "";
			this.ValidationMessage = "";
			this.Value = "";
			this.WillValidate = false;
			this.Wrap = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Autocomplete = Autocomplete_;
		this.Autofocus = Autofocus_;
		this.Cols = Cols_;
		this.DefaultValue = DefaultValue_;
		this.DirName = DirName_;
		this.Disabled = Disabled_;
		this.MaxLength = MaxLength_;
		this.Name = Name_;
		this.Placeholder = Placeholder_;
		this.ReadOnly = ReadOnly_;
		this.Required = Required_;
		this.Rows = Rows_;
		this.SelectionDirection = SelectionDirection_;
		this.SelectionStart = SelectionStart_;
		this.SelectionEnd = SelectionEnd_;
		this.TabIndex = TabIndex_;
		this.TextLength = TextLength_;
		this.Type = Type_;
		this.ValidationMessage = ValidationMessage_;
		this.Value = Value_;
		this.WillValidate = WillValidate_;
		this.Wrap = Wrap_;
	});
	HTMLTimeElement = $pkg.HTMLTimeElement = $newType(0, $kindStruct, "dom.HTMLTimeElement", "HTMLTimeElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, DateTime_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.DateTime = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.DateTime = DateTime_;
	});
	HTMLTitleElement = $pkg.HTMLTitleElement = $newType(0, $kindStruct, "dom.HTMLTitleElement", "HTMLTitleElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Text_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Text = "";
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Text = Text_;
	});
	TextTrack = $pkg.TextTrack = $newType(0, $kindStruct, "dom.TextTrack", "TextTrack", "honnef.co/go/js/dom", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	HTMLTrackElement = $pkg.HTMLTrackElement = $newType(0, $kindStruct, "dom.HTMLTrackElement", "HTMLTrackElement", "honnef.co/go/js/dom", function(BasicHTMLElement_, Kind_, Src_, Srclang_, Label_, Default_, ReadyState_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			this.Kind = "";
			this.Src = "";
			this.Srclang = "";
			this.Label = "";
			this.Default = false;
			this.ReadyState = 0;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
		this.Kind = Kind_;
		this.Src = Src_;
		this.Srclang = Srclang_;
		this.Label = Label_;
		this.Default = Default_;
		this.ReadyState = ReadyState_;
	});
	HTMLUListElement = $pkg.HTMLUListElement = $newType(0, $kindStruct, "dom.HTMLUListElement", "HTMLUListElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLUnknownElement = $pkg.HTMLUnknownElement = $newType(0, $kindStruct, "dom.HTMLUnknownElement", "HTMLUnknownElement", "honnef.co/go/js/dom", function(BasicHTMLElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicHTMLElement = ptrType$1.nil;
			return;
		}
		this.BasicHTMLElement = BasicHTMLElement_;
	});
	HTMLVideoElement = $pkg.HTMLVideoElement = $newType(0, $kindStruct, "dom.HTMLVideoElement", "HTMLVideoElement", "honnef.co/go/js/dom", function(HTMLMediaElement_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.HTMLMediaElement = ptrType$3.nil;
			return;
		}
		this.HTMLMediaElement = HTMLMediaElement_;
	});
	CSSStyleDeclaration = $pkg.CSSStyleDeclaration = $newType(0, $kindStruct, "dom.CSSStyleDeclaration", "CSSStyleDeclaration", "honnef.co/go/js/dom", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	Text = $pkg.Text = $newType(0, $kindStruct, "dom.Text", "Text", "honnef.co/go/js/dom", function(BasicNode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicNode = ptrType$22.nil;
			return;
		}
		this.BasicNode = BasicNode_;
	});
	Event = $pkg.Event = $newType(8, $kindInterface, "dom.Event", "Event", "honnef.co/go/js/dom", null);
	BasicEvent = $pkg.BasicEvent = $newType(0, $kindStruct, "dom.BasicEvent", "BasicEvent", "honnef.co/go/js/dom", function(Object_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Object = null;
			return;
		}
		this.Object = Object_;
	});
	AnimationEvent = $pkg.AnimationEvent = $newType(0, $kindStruct, "dom.AnimationEvent", "AnimationEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	AudioProcessingEvent = $pkg.AudioProcessingEvent = $newType(0, $kindStruct, "dom.AudioProcessingEvent", "AudioProcessingEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	BeforeInputEvent = $pkg.BeforeInputEvent = $newType(0, $kindStruct, "dom.BeforeInputEvent", "BeforeInputEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	BeforeUnloadEvent = $pkg.BeforeUnloadEvent = $newType(0, $kindStruct, "dom.BeforeUnloadEvent", "BeforeUnloadEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	BlobEvent = $pkg.BlobEvent = $newType(0, $kindStruct, "dom.BlobEvent", "BlobEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	ClipboardEvent = $pkg.ClipboardEvent = $newType(0, $kindStruct, "dom.ClipboardEvent", "ClipboardEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	CloseEvent = $pkg.CloseEvent = $newType(0, $kindStruct, "dom.CloseEvent", "CloseEvent", "honnef.co/go/js/dom", function(BasicEvent_, Code_, Reason_, WasClean_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			this.Code = 0;
			this.Reason = "";
			this.WasClean = false;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.Code = Code_;
		this.Reason = Reason_;
		this.WasClean = WasClean_;
	});
	CompositionEvent = $pkg.CompositionEvent = $newType(0, $kindStruct, "dom.CompositionEvent", "CompositionEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	CSSFontFaceLoadEvent = $pkg.CSSFontFaceLoadEvent = $newType(0, $kindStruct, "dom.CSSFontFaceLoadEvent", "CSSFontFaceLoadEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	CustomEvent = $pkg.CustomEvent = $newType(0, $kindStruct, "dom.CustomEvent", "CustomEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceLightEvent = $pkg.DeviceLightEvent = $newType(0, $kindStruct, "dom.DeviceLightEvent", "DeviceLightEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceMotionEvent = $pkg.DeviceMotionEvent = $newType(0, $kindStruct, "dom.DeviceMotionEvent", "DeviceMotionEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceOrientationEvent = $pkg.DeviceOrientationEvent = $newType(0, $kindStruct, "dom.DeviceOrientationEvent", "DeviceOrientationEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DeviceProximityEvent = $pkg.DeviceProximityEvent = $newType(0, $kindStruct, "dom.DeviceProximityEvent", "DeviceProximityEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DOMTransactionEvent = $pkg.DOMTransactionEvent = $newType(0, $kindStruct, "dom.DOMTransactionEvent", "DOMTransactionEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	DragEvent = $pkg.DragEvent = $newType(0, $kindStruct, "dom.DragEvent", "DragEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	EditingBeforeInputEvent = $pkg.EditingBeforeInputEvent = $newType(0, $kindStruct, "dom.EditingBeforeInputEvent", "EditingBeforeInputEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	ErrorEvent = $pkg.ErrorEvent = $newType(0, $kindStruct, "dom.ErrorEvent", "ErrorEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	FocusEvent = $pkg.FocusEvent = $newType(0, $kindStruct, "dom.FocusEvent", "FocusEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	GamepadEvent = $pkg.GamepadEvent = $newType(0, $kindStruct, "dom.GamepadEvent", "GamepadEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	HashChangeEvent = $pkg.HashChangeEvent = $newType(0, $kindStruct, "dom.HashChangeEvent", "HashChangeEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	IDBVersionChangeEvent = $pkg.IDBVersionChangeEvent = $newType(0, $kindStruct, "dom.IDBVersionChangeEvent", "IDBVersionChangeEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	KeyboardEvent = $pkg.KeyboardEvent = $newType(0, $kindStruct, "dom.KeyboardEvent", "KeyboardEvent", "honnef.co/go/js/dom", function(BasicEvent_, AltKey_, CharCode_, CtrlKey_, Key_, KeyIdentifier_, KeyCode_, Locale_, Location_, KeyLocation_, MetaKey_, Repeat_, ShiftKey_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			this.AltKey = false;
			this.CharCode = 0;
			this.CtrlKey = false;
			this.Key = "";
			this.KeyIdentifier = "";
			this.KeyCode = 0;
			this.Locale = "";
			this.Location = 0;
			this.KeyLocation = 0;
			this.MetaKey = false;
			this.Repeat = false;
			this.ShiftKey = false;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.AltKey = AltKey_;
		this.CharCode = CharCode_;
		this.CtrlKey = CtrlKey_;
		this.Key = Key_;
		this.KeyIdentifier = KeyIdentifier_;
		this.KeyCode = KeyCode_;
		this.Locale = Locale_;
		this.Location = Location_;
		this.KeyLocation = KeyLocation_;
		this.MetaKey = MetaKey_;
		this.Repeat = Repeat_;
		this.ShiftKey = ShiftKey_;
	});
	MediaStreamEvent = $pkg.MediaStreamEvent = $newType(0, $kindStruct, "dom.MediaStreamEvent", "MediaStreamEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	MessageEvent = $pkg.MessageEvent = $newType(0, $kindStruct, "dom.MessageEvent", "MessageEvent", "honnef.co/go/js/dom", function(BasicEvent_, Data_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			this.Data = null;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.Data = Data_;
	});
	MouseEvent = $pkg.MouseEvent = $newType(0, $kindStruct, "dom.MouseEvent", "MouseEvent", "honnef.co/go/js/dom", function(UIEvent_, AltKey_, Button_, ClientX_, ClientY_, CtrlKey_, MetaKey_, MovementX_, MovementY_, ScreenX_, ScreenY_, ShiftKey_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.UIEvent = ptrType$19.nil;
			this.AltKey = false;
			this.Button = 0;
			this.ClientX = 0;
			this.ClientY = 0;
			this.CtrlKey = false;
			this.MetaKey = false;
			this.MovementX = 0;
			this.MovementY = 0;
			this.ScreenX = 0;
			this.ScreenY = 0;
			this.ShiftKey = false;
			return;
		}
		this.UIEvent = UIEvent_;
		this.AltKey = AltKey_;
		this.Button = Button_;
		this.ClientX = ClientX_;
		this.ClientY = ClientY_;
		this.CtrlKey = CtrlKey_;
		this.MetaKey = MetaKey_;
		this.MovementX = MovementX_;
		this.MovementY = MovementY_;
		this.ScreenX = ScreenX_;
		this.ScreenY = ScreenY_;
		this.ShiftKey = ShiftKey_;
	});
	MutationEvent = $pkg.MutationEvent = $newType(0, $kindStruct, "dom.MutationEvent", "MutationEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	OfflineAudioCompletionEvent = $pkg.OfflineAudioCompletionEvent = $newType(0, $kindStruct, "dom.OfflineAudioCompletionEvent", "OfflineAudioCompletionEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	PageTransitionEvent = $pkg.PageTransitionEvent = $newType(0, $kindStruct, "dom.PageTransitionEvent", "PageTransitionEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	PointerEvent = $pkg.PointerEvent = $newType(0, $kindStruct, "dom.PointerEvent", "PointerEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	PopStateEvent = $pkg.PopStateEvent = $newType(0, $kindStruct, "dom.PopStateEvent", "PopStateEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	ProgressEvent = $pkg.ProgressEvent = $newType(0, $kindStruct, "dom.ProgressEvent", "ProgressEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	RelatedEvent = $pkg.RelatedEvent = $newType(0, $kindStruct, "dom.RelatedEvent", "RelatedEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	RTCPeerConnectionIceEvent = $pkg.RTCPeerConnectionIceEvent = $newType(0, $kindStruct, "dom.RTCPeerConnectionIceEvent", "RTCPeerConnectionIceEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	SensorEvent = $pkg.SensorEvent = $newType(0, $kindStruct, "dom.SensorEvent", "SensorEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	StorageEvent = $pkg.StorageEvent = $newType(0, $kindStruct, "dom.StorageEvent", "StorageEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	SVGEvent = $pkg.SVGEvent = $newType(0, $kindStruct, "dom.SVGEvent", "SVGEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	SVGZoomEvent = $pkg.SVGZoomEvent = $newType(0, $kindStruct, "dom.SVGZoomEvent", "SVGZoomEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	TimeEvent = $pkg.TimeEvent = $newType(0, $kindStruct, "dom.TimeEvent", "TimeEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	TouchEvent = $pkg.TouchEvent = $newType(0, $kindStruct, "dom.TouchEvent", "TouchEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	TrackEvent = $pkg.TrackEvent = $newType(0, $kindStruct, "dom.TrackEvent", "TrackEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	TransitionEvent = $pkg.TransitionEvent = $newType(0, $kindStruct, "dom.TransitionEvent", "TransitionEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	UIEvent = $pkg.UIEvent = $newType(0, $kindStruct, "dom.UIEvent", "UIEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	UserProximityEvent = $pkg.UserProximityEvent = $newType(0, $kindStruct, "dom.UserProximityEvent", "UserProximityEvent", "honnef.co/go/js/dom", function(BasicEvent_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			return;
		}
		this.BasicEvent = BasicEvent_;
	});
	WheelEvent = $pkg.WheelEvent = $newType(0, $kindStruct, "dom.WheelEvent", "WheelEvent", "honnef.co/go/js/dom", function(BasicEvent_, DeltaX_, DeltaY_, DeltaZ_, DeltaMode_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.BasicEvent = ptrType$18.nil;
			this.DeltaX = 0;
			this.DeltaY = 0;
			this.DeltaZ = 0;
			this.DeltaMode = 0;
			return;
		}
		this.BasicEvent = BasicEvent_;
		this.DeltaX = DeltaX_;
		this.DeltaY = DeltaY_;
		this.DeltaZ = DeltaZ_;
		this.DeltaMode = DeltaMode_;
	});
	sliceType = $sliceType($emptyInterface);
	ptrType = $ptrType(js.Object);
	sliceType$1 = $sliceType(ptrType);
	sliceType$2 = $sliceType(Node);
	sliceType$3 = $sliceType(Element);
	sliceType$4 = $sliceType(HTMLElement);
	ptrType$1 = $ptrType(BasicHTMLElement);
	ptrType$2 = $ptrType(URLUtils);
	ptrType$3 = $ptrType(HTMLMediaElement);
	ptrType$4 = $ptrType(time.Location);
	ptrType$5 = $ptrType(HTMLFormElement);
	ptrType$6 = $ptrType(HTMLLabelElement);
	sliceType$5 = $sliceType(ptrType$6);
	ptrType$7 = $ptrType(HTMLOptionElement);
	sliceType$6 = $sliceType(ptrType$7);
	sliceType$7 = $sliceType($String);
	sliceType$8 = $sliceType(ptrType$5);
	ptrType$8 = $ptrType(HTMLHeadElement);
	ptrType$9 = $ptrType(HTMLImageElement);
	sliceType$9 = $sliceType(ptrType$9);
	ptrType$10 = $ptrType(HTMLEmbedElement);
	sliceType$10 = $sliceType(ptrType$10);
	ptrType$11 = $ptrType(HTMLScriptElement);
	sliceType$11 = $sliceType(ptrType$11);
	ptrType$12 = $ptrType(Text);
	funcType = $funcType([], [], false);
	funcType$1 = $funcType([ptrType], [], false);
	ptrType$13 = $ptrType(File);
	sliceType$12 = $sliceType(ptrType$13);
	ptrType$14 = $ptrType(HTMLDataListElement);
	ptrType$15 = $ptrType(HTMLAreaElement);
	sliceType$13 = $sliceType(ptrType$15);
	ptrType$16 = $ptrType(HTMLTableCellElement);
	sliceType$14 = $sliceType(ptrType$16);
	ptrType$17 = $ptrType(HTMLTableRowElement);
	sliceType$15 = $sliceType(ptrType$17);
	ptrType$18 = $ptrType(BasicEvent);
	ptrType$19 = $ptrType(UIEvent);
	ptrType$20 = $ptrType(TokenList);
	funcType$2 = $funcType([Event], [], false);
	sliceType$16 = $sliceType(StyleSheet);
	ptrType$21 = $ptrType(Location);
	ptrType$22 = $ptrType(BasicNode);
	ptrType$23 = $ptrType(document);
	ptrType$24 = $ptrType(htmlDocument);
	mapType = $mapType($String, $String);
	ptrType$25 = $ptrType(CSSStyleDeclaration);
	ptrType$26 = $ptrType(Console);
	funcType$3 = $funcType([time.Duration], [], false);
	ptrType$27 = $ptrType(Screen);
	ptrType$28 = $ptrType(window);
	funcType$4 = $funcType([Position], [], false);
	funcType$5 = $funcType([PositionError], [], false);
	ptrType$29 = $ptrType(PositionError);
	ptrType$30 = $ptrType(Coordinates);
	ptrType$31 = $ptrType(BasicElement);
	ptrType$32 = $ptrType(HTMLAnchorElement);
	ptrType$33 = $ptrType(HTMLAppletElement);
	ptrType$34 = $ptrType(HTMLBaseElement);
	ptrType$35 = $ptrType(ValidityState);
	ptrType$36 = $ptrType(HTMLButtonElement);
	ptrType$37 = $ptrType(CanvasRenderingContext2D);
	ptrType$38 = $ptrType(HTMLCanvasElement);
	ptrType$39 = $ptrType(HTMLFieldSetElement);
	ptrType$40 = $ptrType(HTMLIFrameElement);
	ptrType$41 = $ptrType(HTMLInputElement);
	ptrType$42 = $ptrType(HTMLKeygenElement);
	ptrType$43 = $ptrType(HTMLLegendElement);
	ptrType$44 = $ptrType(HTMLLinkElement);
	ptrType$45 = $ptrType(HTMLMapElement);
	ptrType$46 = $ptrType(HTMLObjectElement);
	ptrType$47 = $ptrType(HTMLOutputElement);
	ptrType$48 = $ptrType(HTMLSelectElement);
	ptrType$49 = $ptrType(HTMLTableSectionElement);
	ptrType$50 = $ptrType(HTMLTextAreaElement);
	ptrType$51 = $ptrType(TextTrack);
	ptrType$52 = $ptrType(HTMLTrackElement);
	ptrType$53 = $ptrType(KeyboardEvent);
	ptrType$54 = $ptrType(MouseEvent);
	toString = function(o) {
		var $ptr, o;
		if (o === null || o === undefined) {
			return "";
		}
		return $internalize(o, $String);
	};
	callRecover = function(o, fn, args) {
		var $ptr, args, err, fn, o, obj, $deferred;
		/* */ var $err = null; try { $deferred = []; $deferred.index = $curGoroutine.deferStack.length; $curGoroutine.deferStack.push($deferred);
		err = $ifaceNil;
		$deferred.push([(function() {
			var $ptr, _tuple, e, ok, panicErr;
			e = $recover();
			if ($interfaceIsEqual(e, $ifaceNil)) {
				return;
			}
			_tuple = $assertType(e, $error, true);
			panicErr = _tuple[0];
			ok = _tuple[1];
			if (ok && !($interfaceIsEqual(panicErr, $ifaceNil))) {
				err = panicErr;
			} else {
				$panic(e);
			}
		}), []]);
		(obj = o, obj[$externalize(fn, $String)].apply(obj, $externalize(args, sliceType)));
		err = $ifaceNil;
		return err;
		/* */ } catch(err) { $err = err; } finally { $callDeferred($deferred, $err); if (!$curGoroutine.asleep) { return  err; } }
	};
	elementConstructor = function(o) {
		var $ptr, n, o;
		n = o.node;
		if (!(n === undefined)) {
			return n.constructor;
		}
		return o.constructor;
	};
	arrayToObjects = function(o) {
		var $ptr, i, o, out;
		out = sliceType$1.nil;
		i = 0;
		while (true) {
			if (!(i < $parseInt(o.length))) { break; }
			out = $append(out, o[i]);
			i = i + (1) >> 0;
		}
		return out;
	};
	nodeListToObjects = function(o) {
		var $ptr, i, length, o, out;
		if (o.constructor === $global.Array) {
			return arrayToObjects(o);
		}
		out = sliceType$1.nil;
		length = $parseInt(o.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			out = $append(out, o.item(i));
			i = i + (1) >> 0;
		}
		return out;
	};
	nodeListToNodes = function(o) {
		var $ptr, _i, _ref, o, obj, out;
		out = sliceType$2.nil;
		_ref = nodeListToObjects(o);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			obj = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			out = $append(out, wrapNode(obj));
			_i++;
		}
		return out;
	};
	nodeListToElements = function(o) {
		var $ptr, _i, _ref, o, obj, out;
		out = sliceType$3.nil;
		_ref = nodeListToObjects(o);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			obj = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			out = $append(out, wrapElement(obj));
			_i++;
		}
		return out;
	};
	nodeListToHTMLElements = function(o) {
		var $ptr, _i, _ref, o, obj, out;
		out = sliceType$4.nil;
		_ref = nodeListToObjects(o);
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			obj = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			out = $append(out, wrapHTMLElement(obj));
			_i++;
		}
		return out;
	};
	WrapDocument = function(o) {
		var $ptr, o;
		return wrapDocument(o);
	};
	$pkg.WrapDocument = WrapDocument;
	WrapNode = function(o) {
		var $ptr, o;
		return wrapNode(o);
	};
	$pkg.WrapNode = WrapNode;
	WrapElement = function(o) {
		var $ptr, o;
		return wrapElement(o);
	};
	$pkg.WrapElement = WrapElement;
	WrapHTMLElement = function(o) {
		var $ptr, o;
		return wrapHTMLElement(o);
	};
	$pkg.WrapHTMLElement = WrapHTMLElement;
	wrapDocument = function(o) {
		var $ptr, _1, o;
		_1 = elementConstructor(o);
		if (_1 === ($global.HTMLDocument)) {
			return new htmlDocument.ptr(new document.ptr(new BasicNode.ptr(o)));
		} else {
			return new document.ptr(new BasicNode.ptr(o));
		}
	};
	wrapDocumentFragment = function(o) {
		var $ptr, o;
		elementConstructor(o);
		return new documentFragment.ptr(new BasicNode.ptr(o));
	};
	wrapNode = function(o) {
		var $ptr, _2, o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		_2 = elementConstructor(o);
		if (_2 === ($global.Text)) {
			return new Text.ptr(new BasicNode.ptr(o));
		} else {
			return wrapElement(o);
		}
	};
	wrapElement = function(o) {
		var $ptr, o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		elementConstructor(o);
		return wrapHTMLElement(o);
	};
	wrapHTMLElement = function(o) {
		var $ptr, _3, c, el, o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		el = new BasicHTMLElement.ptr(new BasicElement.ptr(new BasicNode.ptr(o)));
		c = elementConstructor(o);
		_3 = c;
		if (_3 === ($global.HTMLAnchorElement)) {
			return new HTMLAnchorElement.ptr(el, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""), "", "", 0, "", "", "");
		} else if (_3 === ($global.HTMLAppletElement)) {
			return new HTMLAppletElement.ptr(el, "", "", "", "", "", "", 0, "", "");
		} else if (_3 === ($global.HTMLAreaElement)) {
			return new HTMLAreaElement.ptr(el, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""), "", "", "", "", "", "", 0, "", "");
		} else if (_3 === ($global.HTMLAudioElement)) {
			return new HTMLAudioElement.ptr(new HTMLMediaElement.ptr(el, false));
		} else if (_3 === ($global.HTMLBaseElement)) {
			return new HTMLBaseElement.ptr(el);
		} else if (_3 === ($global.HTMLBodyElement)) {
			return new HTMLBodyElement.ptr(el);
		} else if (_3 === ($global.HTMLBRElement)) {
			return new HTMLBRElement.ptr(el);
		} else if (_3 === ($global.HTMLButtonElement)) {
			return new HTMLButtonElement.ptr(el, false, false, "", "", "", false, "", "", 0, "", "", "", false);
		} else if (_3 === ($global.HTMLCanvasElement)) {
			return new HTMLCanvasElement.ptr(el, 0, 0);
		} else if (_3 === ($global.HTMLDataElement)) {
			return new HTMLDataElement.ptr(el, "");
		} else if (_3 === ($global.HTMLDataListElement)) {
			return new HTMLDataListElement.ptr(el);
		} else if (_3 === ($global.HTMLDirectoryElement)) {
			return new HTMLDirectoryElement.ptr(el);
		} else if (_3 === ($global.HTMLDivElement)) {
			return new HTMLDivElement.ptr(el);
		} else if (_3 === ($global.HTMLDListElement)) {
			return new HTMLDListElement.ptr(el);
		} else if (_3 === ($global.HTMLEmbedElement)) {
			return new HTMLEmbedElement.ptr(el, "", "", "");
		} else if (_3 === ($global.HTMLFieldSetElement)) {
			return new HTMLFieldSetElement.ptr(el, false, "", "", "", false);
		} else if (_3 === ($global.HTMLFontElement)) {
			return new HTMLFontElement.ptr(el);
		} else if (_3 === ($global.HTMLFormElement)) {
			return new HTMLFormElement.ptr(el, "", "", "", "", "", 0, "", "", false, "");
		} else if (_3 === ($global.HTMLFrameElement)) {
			return new HTMLFrameElement.ptr(el);
		} else if (_3 === ($global.HTMLFrameSetElement)) {
			return new HTMLFrameSetElement.ptr(el);
		} else if (_3 === ($global.HTMLHeadElement)) {
			return new HTMLHeadElement.ptr(el);
		} else if (_3 === ($global.HTMLHeadingElement)) {
			return new HTMLHeadingElement.ptr(el);
		} else if (_3 === ($global.HTMLHtmlElement)) {
			return new HTMLHtmlElement.ptr(el);
		} else if (_3 === ($global.HTMLHRElement)) {
			return new HTMLHRElement.ptr(el);
		} else if (_3 === ($global.HTMLIFrameElement)) {
			return new HTMLIFrameElement.ptr(el, "", "", "", "", "", false);
		} else if (_3 === ($global.HTMLImageElement)) {
			return new HTMLImageElement.ptr(el, false, "", 0, false, 0, 0, "", "", 0);
		} else if (_3 === ($global.HTMLInputElement)) {
			return new HTMLInputElement.ptr(el, "", "", "", false, false, false, "", "", false, "", "", "", false, "", "", false, "", 0, "", false, "", "", "", false, false, "", 0, 0, 0, "", "", 0, "", "", "", new time.Time.ptr(new $Int64(0, 0), 0, ptrType$4.nil), 0, "", false);
		} else if (_3 === ($global.HTMLKeygenElement)) {
			return new HTMLKeygenElement.ptr(el, false, "", false, "", "", "", "", false);
		} else if (_3 === ($global.HTMLLabelElement)) {
			return new HTMLLabelElement.ptr(el, "");
		} else if (_3 === ($global.HTMLLegendElement)) {
			return new HTMLLegendElement.ptr(el);
		} else if (_3 === ($global.HTMLLIElement)) {
			return new HTMLLIElement.ptr(el, 0);
		} else if (_3 === ($global.HTMLLinkElement)) {
			return new HTMLLinkElement.ptr(el, false, "", "", "", "");
		} else if (_3 === ($global.HTMLMapElement)) {
			return new HTMLMapElement.ptr(el, "");
		} else if (_3 === ($global.HTMLMediaElement)) {
			return new HTMLMediaElement.ptr(el, false);
		} else if (_3 === ($global.HTMLMenuElement)) {
			return new HTMLMenuElement.ptr(el);
		} else if (_3 === ($global.HTMLMetaElement)) {
			return new HTMLMetaElement.ptr(el, "", "", "");
		} else if (_3 === ($global.HTMLMeterElement)) {
			return new HTMLMeterElement.ptr(el, 0, 0, 0, 0, 0);
		} else if (_3 === ($global.HTMLModElement)) {
			return new HTMLModElement.ptr(el, "", "");
		} else if (_3 === ($global.HTMLObjectElement)) {
			return new HTMLObjectElement.ptr(el, "", "", "", 0, "", false, "", "", "", false);
		} else if (_3 === ($global.HTMLOListElement)) {
			return new HTMLOListElement.ptr(el, false, 0, "");
		} else if (_3 === ($global.HTMLOptGroupElement)) {
			return new HTMLOptGroupElement.ptr(el, false, "");
		} else if (_3 === ($global.HTMLOptionElement)) {
			return new HTMLOptionElement.ptr(el, false, false, 0, "", false, "", "");
		} else if (_3 === ($global.HTMLOutputElement)) {
			return new HTMLOutputElement.ptr(el, "", "", "", "", "", false);
		} else if (_3 === ($global.HTMLParagraphElement)) {
			return new HTMLParagraphElement.ptr(el);
		} else if (_3 === ($global.HTMLParamElement)) {
			return new HTMLParamElement.ptr(el, "", "");
		} else if (_3 === ($global.HTMLPreElement)) {
			return new HTMLPreElement.ptr(el);
		} else if (_3 === ($global.HTMLProgressElement)) {
			return new HTMLProgressElement.ptr(el, 0, 0, 0);
		} else if (_3 === ($global.HTMLQuoteElement)) {
			return new HTMLQuoteElement.ptr(el, "");
		} else if (_3 === ($global.HTMLScriptElement)) {
			return new HTMLScriptElement.ptr(el, "", "", "", false, false, "");
		} else if (_3 === ($global.HTMLSelectElement)) {
			return new HTMLSelectElement.ptr(el, false, false, 0, false, "", false, 0, 0, "", "", "", false);
		} else if (_3 === ($global.HTMLSourceElement)) {
			return new HTMLSourceElement.ptr(el, "", "", "");
		} else if (_3 === ($global.HTMLSpanElement)) {
			return new HTMLSpanElement.ptr(el);
		} else if (_3 === ($global.HTMLStyleElement)) {
			return new HTMLStyleElement.ptr(el);
		} else if (_3 === ($global.HTMLTableElement)) {
			return new HTMLTableElement.ptr(el);
		} else if (_3 === ($global.HTMLTableCaptionElement)) {
			return new HTMLTableCaptionElement.ptr(el);
		} else if (_3 === ($global.HTMLTableCellElement)) {
			return new HTMLTableCellElement.ptr(el, 0, 0, 0);
		} else if (_3 === ($global.HTMLTableDataCellElement)) {
			return new HTMLTableDataCellElement.ptr(el);
		} else if (_3 === ($global.HTMLTableHeaderCellElement)) {
			return new HTMLTableHeaderCellElement.ptr(el, "", "");
		} else if (_3 === ($global.HTMLTableColElement)) {
			return new HTMLTableColElement.ptr(el, 0);
		} else if (_3 === ($global.HTMLTableRowElement)) {
			return new HTMLTableRowElement.ptr(el, 0, 0);
		} else if (_3 === ($global.HTMLTableSectionElement)) {
			return new HTMLTableSectionElement.ptr(el);
		} else if (_3 === ($global.HTMLTextAreaElement)) {
			return new HTMLTextAreaElement.ptr(el, "", false, 0, "", "", false, 0, "", "", false, false, 0, "", 0, 0, 0, 0, "", "", "", false, "");
		} else if (_3 === ($global.HTMLTimeElement)) {
			return new HTMLTimeElement.ptr(el, "");
		} else if (_3 === ($global.HTMLTitleElement)) {
			return new HTMLTitleElement.ptr(el, "");
		} else if (_3 === ($global.HTMLTrackElement)) {
			return new HTMLTrackElement.ptr(el, "", "", "", "", false, 0);
		} else if (_3 === ($global.HTMLUListElement)) {
			return new HTMLUListElement.ptr(el);
		} else if (_3 === ($global.HTMLUnknownElement)) {
			return new HTMLUnknownElement.ptr(el);
		} else if (_3 === ($global.HTMLVideoElement)) {
			return new HTMLVideoElement.ptr(new HTMLMediaElement.ptr(el, false));
		} else if (_3 === ($global.HTMLElement)) {
			return el;
		} else {
			return el;
		}
	};
	getForm = function(o) {
		var $ptr, form, o;
		form = wrapHTMLElement(o.form);
		if ($interfaceIsEqual(form, $ifaceNil)) {
			return ptrType$5.nil;
		}
		return $assertType(form, ptrType$5);
	};
	getLabels = function(o) {
		var $ptr, _i, _ref, i, label, labels, o, out;
		labels = nodeListToElements(o.labels);
		out = $makeSlice(sliceType$5, labels.$length);
		_ref = labels;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			label = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i] = $assertType(label, ptrType$6));
			_i++;
		}
		return out;
	};
	getOptions = function(o, attr) {
		var $ptr, _i, _ref, attr, i, o, option, options, out;
		options = nodeListToElements(o[$externalize(attr, $String)]);
		out = $makeSlice(sliceType$6, options.$length);
		_ref = options;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			option = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i] = $assertType(option, ptrType$7));
			_i++;
		}
		return out;
	};
	TokenList.ptr.prototype.Item = function(idx) {
		var $ptr, idx, o, tl;
		tl = this;
		o = tl.dtl.item(idx);
		return toString(o);
	};
	TokenList.prototype.Item = function(idx) { return this.$val.Item(idx); };
	TokenList.ptr.prototype.Contains = function(token) {
		var $ptr, tl, token;
		tl = this;
		return !!(tl.dtl.contains($externalize(token, $String)));
	};
	TokenList.prototype.Contains = function(token) { return this.$val.Contains(token); };
	TokenList.ptr.prototype.Add = function(token) {
		var $ptr, tl, token;
		tl = this;
		tl.dtl.add($externalize(token, $String));
	};
	TokenList.prototype.Add = function(token) { return this.$val.Add(token); };
	TokenList.ptr.prototype.Remove = function(token) {
		var $ptr, tl, token;
		tl = this;
		tl.dtl.remove($externalize(token, $String));
	};
	TokenList.prototype.Remove = function(token) { return this.$val.Remove(token); };
	TokenList.ptr.prototype.Toggle = function(token) {
		var $ptr, tl, token;
		tl = this;
		tl.dtl.toggle($externalize(token, $String));
	};
	TokenList.prototype.Toggle = function(token) { return this.$val.Toggle(token); };
	TokenList.ptr.prototype.String = function() {
		var $ptr, tl;
		tl = this;
		if (!(tl.sa === "")) {
			return $internalize(tl.o[$externalize(tl.sa, $String)], $String);
		}
		if (tl.dtl.constructor === $global.DOMSettableTokenList) {
			return $internalize(tl.dtl.value, $String);
		}
		return "";
	};
	TokenList.prototype.String = function() { return this.$val.String(); };
	TokenList.ptr.prototype.Slice = function() {
		var $ptr, i, length, out, tl;
		tl = this;
		out = sliceType$7.nil;
		length = $parseInt(tl.dtl.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			out = $append(out, $internalize(tl.dtl.item(i), $String));
			i = i + (1) >> 0;
		}
		return out;
	};
	TokenList.prototype.Slice = function() { return this.$val.Slice(); };
	TokenList.ptr.prototype.SetString = function(s) {
		var $ptr, s, tl;
		tl = this;
		if (!(tl.sa === "")) {
			tl.o[$externalize(tl.sa, $String)] = $externalize(s, $String);
			return;
		}
		if (tl.dtl.constructor === $global.DOMSettableTokenList) {
			tl.dtl.value = $externalize(s, $String);
			return;
		}
		$panic(new $String("no way to SetString on this TokenList"));
	};
	TokenList.prototype.SetString = function(s) { return this.$val.SetString(s); };
	TokenList.ptr.prototype.Set = function(s) {
		var $ptr, s, tl;
		tl = this;
		tl.SetString(strings.Join(s, " "));
	};
	TokenList.prototype.Set = function(s) { return this.$val.Set(s); };
	documentFragment.ptr.prototype.GetElementByID = function(id) {
		var $ptr, d, id;
		d = $clone(this, documentFragment);
		return wrapElement(d.BasicNode.Object.getElementById($externalize(id, $String)));
	};
	documentFragment.prototype.GetElementByID = function(id) { return this.$val.GetElementByID(id); };
	documentFragment.ptr.prototype.QuerySelector = function(sel) {
		var $ptr, d, sel;
		d = $clone(this, documentFragment);
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelector(sel);
	};
	documentFragment.prototype.QuerySelector = function(sel) { return this.$val.QuerySelector(sel); };
	documentFragment.ptr.prototype.QuerySelectorAll = function(sel) {
		var $ptr, d, sel;
		d = $clone(this, documentFragment);
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelectorAll(sel);
	};
	documentFragment.prototype.QuerySelectorAll = function(sel) { return this.$val.QuerySelectorAll(sel); };
	htmlDocument.ptr.prototype.ActiveElement = function() {
		var $ptr, d;
		d = this;
		return wrapHTMLElement(d.document.BasicNode.Object.activeElement);
	};
	htmlDocument.prototype.ActiveElement = function() { return this.$val.ActiveElement(); };
	htmlDocument.ptr.prototype.Body = function() {
		var $ptr, d;
		d = this;
		return wrapHTMLElement(d.document.BasicNode.Object.body);
	};
	htmlDocument.prototype.Body = function() { return this.$val.Body(); };
	htmlDocument.ptr.prototype.Cookie = function() {
		var $ptr, d;
		d = this;
		return $internalize(d.document.BasicNode.Object.cookie, $String);
	};
	htmlDocument.prototype.Cookie = function() { return this.$val.Cookie(); };
	htmlDocument.ptr.prototype.SetCookie = function(s) {
		var $ptr, d, s;
		d = this;
		d.document.BasicNode.Object.cookie = $externalize(s, $String);
	};
	htmlDocument.prototype.SetCookie = function(s) { return this.$val.SetCookie(s); };
	htmlDocument.ptr.prototype.DefaultView = function() {
		var $ptr, d;
		d = this;
		return new window.ptr(d.document.BasicNode.Object.defaultView);
	};
	htmlDocument.prototype.DefaultView = function() { return this.$val.DefaultView(); };
	htmlDocument.ptr.prototype.DesignMode = function() {
		var $ptr, d, s;
		d = this;
		s = $internalize(d.document.BasicNode.Object.designMode, $String);
		if (s === "off") {
			return false;
		}
		return true;
	};
	htmlDocument.prototype.DesignMode = function() { return this.$val.DesignMode(); };
	htmlDocument.ptr.prototype.SetDesignMode = function(b) {
		var $ptr, b, d, s;
		d = this;
		s = "off";
		if (b) {
			s = "on";
		}
		d.document.BasicNode.Object.designMode = $externalize(s, $String);
	};
	htmlDocument.prototype.SetDesignMode = function(b) { return this.$val.SetDesignMode(b); };
	htmlDocument.ptr.prototype.Domain = function() {
		var $ptr, d;
		d = this;
		return $internalize(d.document.BasicNode.Object.domain, $String);
	};
	htmlDocument.prototype.Domain = function() { return this.$val.Domain(); };
	htmlDocument.ptr.prototype.SetDomain = function(s) {
		var $ptr, d, s;
		d = this;
		d.document.BasicNode.Object.domain = $externalize(s, $String);
	};
	htmlDocument.prototype.SetDomain = function(s) { return this.$val.SetDomain(s); };
	htmlDocument.ptr.prototype.Forms = function() {
		var $ptr, d, els, forms, i, length;
		d = this;
		els = sliceType$8.nil;
		forms = d.document.BasicNode.Object.forms;
		length = $parseInt(forms.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(forms.item(i)), ptrType$5));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Forms = function() { return this.$val.Forms(); };
	htmlDocument.ptr.prototype.Head = function() {
		var $ptr, d, head;
		d = this;
		head = wrapElement(d.document.BasicNode.Object.head);
		if ($interfaceIsEqual(head, $ifaceNil)) {
			return ptrType$8.nil;
		}
		return $assertType(head, ptrType$8);
	};
	htmlDocument.prototype.Head = function() { return this.$val.Head(); };
	htmlDocument.ptr.prototype.Images = function() {
		var $ptr, d, els, i, images, length;
		d = this;
		els = sliceType$9.nil;
		images = d.document.BasicNode.Object.images;
		length = $parseInt(images.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(images.item(i)), ptrType$9));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Images = function() { return this.$val.Images(); };
	htmlDocument.ptr.prototype.LastModified = function() {
		var $ptr, d;
		d = this;
		return $assertType($internalize(d.document.BasicNode.Object.lastModified, $emptyInterface), time.Time);
	};
	htmlDocument.prototype.LastModified = function() { return this.$val.LastModified(); };
	htmlDocument.ptr.prototype.Links = function() {
		var $ptr, d, els, i, length, links;
		d = this;
		els = sliceType$4.nil;
		links = d.document.BasicNode.Object.links;
		length = $parseInt(links.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, wrapHTMLElement(links.item(i)));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Links = function() { return this.$val.Links(); };
	htmlDocument.ptr.prototype.Location = function() {
		var $ptr, d, o;
		d = this;
		o = d.document.BasicNode.Object.location;
		return new Location.ptr(o, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""));
	};
	htmlDocument.prototype.Location = function() { return this.$val.Location(); };
	htmlDocument.ptr.prototype.Plugins = function() {
		var $ptr, d, els, forms, i, length;
		d = this;
		els = sliceType$10.nil;
		forms = d.document.BasicNode.Object.plugins;
		length = $parseInt(forms.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(forms.item(i)), ptrType$10));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Plugins = function() { return this.$val.Plugins(); };
	htmlDocument.ptr.prototype.ReadyState = function() {
		var $ptr, d;
		d = this;
		return $internalize(d.document.BasicNode.Object.readyState, $String);
	};
	htmlDocument.prototype.ReadyState = function() { return this.$val.ReadyState(); };
	htmlDocument.ptr.prototype.Referrer = function() {
		var $ptr, d;
		d = this;
		return $internalize(d.document.BasicNode.Object.referrer, $String);
	};
	htmlDocument.prototype.Referrer = function() { return this.$val.Referrer(); };
	htmlDocument.ptr.prototype.Scripts = function() {
		var $ptr, d, els, forms, i, length;
		d = this;
		els = sliceType$11.nil;
		forms = d.document.BasicNode.Object.scripts;
		length = $parseInt(forms.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			els = $append(els, $assertType(wrapHTMLElement(forms.item(i)), ptrType$11));
			i = i + (1) >> 0;
		}
		return els;
	};
	htmlDocument.prototype.Scripts = function() { return this.$val.Scripts(); };
	htmlDocument.ptr.prototype.Title = function() {
		var $ptr, d;
		d = this;
		return $internalize(d.document.BasicNode.Object.title, $String);
	};
	htmlDocument.prototype.Title = function() { return this.$val.Title(); };
	htmlDocument.ptr.prototype.SetTitle = function(s) {
		var $ptr, d, s;
		d = this;
		d.document.BasicNode.Object.title = $externalize(s, $String);
	};
	htmlDocument.prototype.SetTitle = function(s) { return this.$val.SetTitle(s); };
	htmlDocument.ptr.prototype.URL = function() {
		var $ptr, d;
		d = this;
		return $internalize(d.document.BasicNode.Object.URL, $String);
	};
	htmlDocument.prototype.URL = function() { return this.$val.URL(); };
	document.ptr.prototype.Async = function() {
		var $ptr, d;
		d = $clone(this, document);
		return !!(d.BasicNode.Object.async);
	};
	document.prototype.Async = function() { return this.$val.Async(); };
	document.ptr.prototype.SetAsync = function(b) {
		var $ptr, b, d;
		d = $clone(this, document);
		d.BasicNode.Object.async = $externalize(b, $Bool);
	};
	document.prototype.SetAsync = function(b) { return this.$val.SetAsync(b); };
	document.ptr.prototype.Doctype = function() {
		var $ptr, d;
		d = $clone(this, document);
		$panic(new $String("not implemented"));
	};
	document.prototype.Doctype = function() { return this.$val.Doctype(); };
	document.ptr.prototype.DocumentElement = function() {
		var $ptr, d;
		d = $clone(this, document);
		return wrapElement(d.BasicNode.Object.documentElement);
	};
	document.prototype.DocumentElement = function() { return this.$val.DocumentElement(); };
	document.ptr.prototype.DocumentURI = function() {
		var $ptr, d;
		d = $clone(this, document);
		return $internalize(d.BasicNode.Object.documentURI, $String);
	};
	document.prototype.DocumentURI = function() { return this.$val.DocumentURI(); };
	document.ptr.prototype.Implementation = function() {
		var $ptr, d;
		d = $clone(this, document);
		$panic(new $String("not implemented"));
	};
	document.prototype.Implementation = function() { return this.$val.Implementation(); };
	document.ptr.prototype.LastStyleSheetSet = function() {
		var $ptr, d;
		d = $clone(this, document);
		return $internalize(d.BasicNode.Object.lastStyleSheetSet, $String);
	};
	document.prototype.LastStyleSheetSet = function() { return this.$val.LastStyleSheetSet(); };
	document.ptr.prototype.PreferredStyleSheetSet = function() {
		var $ptr, d;
		d = $clone(this, document);
		return $internalize(d.BasicNode.Object.preferredStyleSheetSet, $String);
	};
	document.prototype.PreferredStyleSheetSet = function() { return this.$val.PreferredStyleSheetSet(); };
	document.ptr.prototype.SelectedStyleSheetSet = function() {
		var $ptr, d;
		d = $clone(this, document);
		return $internalize(d.BasicNode.Object.selectedStyleSheetSet, $String);
	};
	document.prototype.SelectedStyleSheetSet = function() { return this.$val.SelectedStyleSheetSet(); };
	document.ptr.prototype.StyleSheets = function() {
		var $ptr, d;
		d = $clone(this, document);
		$panic(new $String("not implemented"));
	};
	document.prototype.StyleSheets = function() { return this.$val.StyleSheets(); };
	document.ptr.prototype.StyleSheetSets = function() {
		var $ptr, d;
		d = $clone(this, document);
		$panic(new $String("not implemented"));
	};
	document.prototype.StyleSheetSets = function() { return this.$val.StyleSheetSets(); };
	document.ptr.prototype.AdoptNode = function(node) {
		var $ptr, _r, _r$1, d, node, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; d = $f.d; node = $f.node; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = $clone(this, document);
		_r = node.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = wrapNode(d.BasicNode.Object.adoptNode(_r)); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: document.ptr.prototype.AdoptNode }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.d = d; $f.node = node; $f.$s = $s; $f.$r = $r; return $f;
	};
	document.prototype.AdoptNode = function(node) { return this.$val.AdoptNode(node); };
	document.ptr.prototype.ImportNode = function(node, deep) {
		var $ptr, _r, _r$1, d, deep, node, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; d = $f.d; deep = $f.deep; node = $f.node; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		d = $clone(this, document);
		_r = node.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = wrapNode(d.BasicNode.Object.importNode(_r, $externalize(deep, $Bool))); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		/* */ $s = 3; case 3:
		return _r$1;
		/* */ } return; } if ($f === undefined) { $f = { $blk: document.ptr.prototype.ImportNode }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.d = d; $f.deep = deep; $f.node = node; $f.$s = $s; $f.$r = $r; return $f;
	};
	document.prototype.ImportNode = function(node, deep) { return this.$val.ImportNode(node, deep); };
	document.ptr.prototype.CreateDocumentFragment = function() {
		var $ptr, d;
		d = $clone(this, document);
		return wrapDocumentFragment(d.BasicNode.Object.createDocumentFragment());
	};
	document.prototype.CreateDocumentFragment = function() { return this.$val.CreateDocumentFragment(); };
	document.ptr.prototype.CreateElement = function(name) {
		var $ptr, d, name;
		d = $clone(this, document);
		return wrapElement(d.BasicNode.Object.createElement($externalize(name, $String)));
	};
	document.prototype.CreateElement = function(name) { return this.$val.CreateElement(name); };
	document.ptr.prototype.CreateElementNS = function(ns, name) {
		var $ptr, d, name, ns;
		d = $clone(this, document);
		return wrapElement(d.BasicNode.Object.createElement($externalize(ns, $String), $externalize(name, $String)));
	};
	document.prototype.CreateElementNS = function(ns, name) { return this.$val.CreateElementNS(ns, name); };
	document.ptr.prototype.CreateTextNode = function(s) {
		var $ptr, d, s;
		d = $clone(this, document);
		return $assertType(wrapNode(d.BasicNode.Object.createTextNode($externalize(s, $String))), ptrType$12);
	};
	document.prototype.CreateTextNode = function(s) { return this.$val.CreateTextNode(s); };
	document.ptr.prototype.ElementFromPoint = function(x, y) {
		var $ptr, d, x, y;
		d = $clone(this, document);
		return wrapElement(d.BasicNode.Object.elementFromPoint(x, y));
	};
	document.prototype.ElementFromPoint = function(x, y) { return this.$val.ElementFromPoint(x, y); };
	document.ptr.prototype.EnableStyleSheetsForSet = function(name) {
		var $ptr, d, name;
		d = $clone(this, document);
		d.BasicNode.Object.enableStyleSheetsForSet($externalize(name, $String));
	};
	document.prototype.EnableStyleSheetsForSet = function(name) { return this.$val.EnableStyleSheetsForSet(name); };
	document.ptr.prototype.GetElementsByClassName = function(name) {
		var $ptr, d, name;
		d = $clone(this, document);
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).GetElementsByClassName(name);
	};
	document.prototype.GetElementsByClassName = function(name) { return this.$val.GetElementsByClassName(name); };
	document.ptr.prototype.GetElementsByTagName = function(name) {
		var $ptr, d, name;
		d = $clone(this, document);
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).GetElementsByTagName(name);
	};
	document.prototype.GetElementsByTagName = function(name) { return this.$val.GetElementsByTagName(name); };
	document.ptr.prototype.GetElementsByTagNameNS = function(ns, name) {
		var $ptr, d, name, ns;
		d = $clone(this, document);
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).GetElementsByTagNameNS(ns, name);
	};
	document.prototype.GetElementsByTagNameNS = function(ns, name) { return this.$val.GetElementsByTagNameNS(ns, name); };
	document.ptr.prototype.GetElementByID = function(id) {
		var $ptr, d, id;
		d = $clone(this, document);
		return wrapElement(d.BasicNode.Object.getElementById($externalize(id, $String)));
	};
	document.prototype.GetElementByID = function(id) { return this.$val.GetElementByID(id); };
	document.ptr.prototype.QuerySelector = function(sel) {
		var $ptr, d, sel;
		d = $clone(this, document);
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelector(sel);
	};
	document.prototype.QuerySelector = function(sel) { return this.$val.QuerySelector(sel); };
	document.ptr.prototype.QuerySelectorAll = function(sel) {
		var $ptr, d, sel;
		d = $clone(this, document);
		return (new BasicElement.ptr(new BasicNode.ptr(d.BasicNode.Object))).QuerySelectorAll(sel);
	};
	document.prototype.QuerySelectorAll = function(sel) { return this.$val.QuerySelectorAll(sel); };
	window.ptr.prototype.Console = function() {
		var $ptr, w;
		w = this;
		return new Console.ptr(w.Object.console);
	};
	window.prototype.Console = function() { return this.$val.Console(); };
	window.ptr.prototype.Document = function() {
		var $ptr, w;
		w = this;
		return wrapDocument(w.Object.document);
	};
	window.prototype.Document = function() { return this.$val.Document(); };
	window.ptr.prototype.FrameElement = function() {
		var $ptr, w;
		w = this;
		return wrapElement(w.Object.frameElement);
	};
	window.prototype.FrameElement = function() { return this.$val.FrameElement(); };
	window.ptr.prototype.Location = function() {
		var $ptr, o, w;
		w = this;
		o = w.Object.location;
		return new Location.ptr(o, new URLUtils.ptr(o, "", "", "", "", "", "", "", "", "", "", ""));
	};
	window.prototype.Location = function() { return this.$val.Location(); };
	window.ptr.prototype.Name = function() {
		var $ptr, w;
		w = this;
		return $internalize(w.Object.name, $String);
	};
	window.prototype.Name = function() { return this.$val.Name(); };
	window.ptr.prototype.SetName = function(s) {
		var $ptr, s, w;
		w = this;
		w.Object.name = $externalize(s, $String);
	};
	window.prototype.SetName = function(s) { return this.$val.SetName(s); };
	window.ptr.prototype.InnerHeight = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.innerHeight) >> 0;
	};
	window.prototype.InnerHeight = function() { return this.$val.InnerHeight(); };
	window.ptr.prototype.InnerWidth = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.innerWidth) >> 0;
	};
	window.prototype.InnerWidth = function() { return this.$val.InnerWidth(); };
	window.ptr.prototype.Length = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.length) >> 0;
	};
	window.prototype.Length = function() { return this.$val.Length(); };
	window.ptr.prototype.Opener = function() {
		var $ptr, w;
		w = this;
		return new window.ptr(w.Object.opener);
	};
	window.prototype.Opener = function() { return this.$val.Opener(); };
	window.ptr.prototype.OuterHeight = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.outerHeight) >> 0;
	};
	window.prototype.OuterHeight = function() { return this.$val.OuterHeight(); };
	window.ptr.prototype.OuterWidth = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.outerWidth) >> 0;
	};
	window.prototype.OuterWidth = function() { return this.$val.OuterWidth(); };
	window.ptr.prototype.ScrollX = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.scrollX) >> 0;
	};
	window.prototype.ScrollX = function() { return this.$val.ScrollX(); };
	window.ptr.prototype.ScrollY = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.scrollY) >> 0;
	};
	window.prototype.ScrollY = function() { return this.$val.ScrollY(); };
	window.ptr.prototype.Parent = function() {
		var $ptr, w;
		w = this;
		return new window.ptr(w.Object.parent);
	};
	window.prototype.Parent = function() { return this.$val.Parent(); };
	window.ptr.prototype.ScreenX = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.screenX) >> 0;
	};
	window.prototype.ScreenX = function() { return this.$val.ScreenX(); };
	window.ptr.prototype.ScreenY = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.screenY) >> 0;
	};
	window.prototype.ScreenY = function() { return this.$val.ScreenY(); };
	window.ptr.prototype.ScrollMaxX = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.scrollMaxX) >> 0;
	};
	window.prototype.ScrollMaxX = function() { return this.$val.ScrollMaxX(); };
	window.ptr.prototype.ScrollMaxY = function() {
		var $ptr, w;
		w = this;
		return $parseInt(w.Object.scrollMaxY) >> 0;
	};
	window.prototype.ScrollMaxY = function() { return this.$val.ScrollMaxY(); };
	window.ptr.prototype.Top = function() {
		var $ptr, w;
		w = this;
		return new window.ptr(w.Object.top);
	};
	window.prototype.Top = function() { return this.$val.Top(); };
	window.ptr.prototype.History = function() {
		var $ptr, w;
		w = this;
		return $ifaceNil;
	};
	window.prototype.History = function() { return this.$val.History(); };
	window.ptr.prototype.Navigator = function() {
		var $ptr, w;
		w = this;
		$panic(new $String("not implemented"));
	};
	window.prototype.Navigator = function() { return this.$val.Navigator(); };
	window.ptr.prototype.Screen = function() {
		var $ptr, w;
		w = this;
		return new Screen.ptr(w.Object.screen, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
	};
	window.prototype.Screen = function() { return this.$val.Screen(); };
	window.ptr.prototype.Alert = function(msg) {
		var $ptr, msg, w;
		w = this;
		w.Object.alert($externalize(msg, $String));
	};
	window.prototype.Alert = function(msg) { return this.$val.Alert(msg); };
	window.ptr.prototype.Back = function() {
		var $ptr, w;
		w = this;
		w.Object.back();
	};
	window.prototype.Back = function() { return this.$val.Back(); };
	window.ptr.prototype.Blur = function() {
		var $ptr, w;
		w = this;
		w.Object.blur();
	};
	window.prototype.Blur = function() { return this.$val.Blur(); };
	window.ptr.prototype.ClearInterval = function(id) {
		var $ptr, id, w;
		w = this;
		w.Object.clearInterval(id);
	};
	window.prototype.ClearInterval = function(id) { return this.$val.ClearInterval(id); };
	window.ptr.prototype.ClearTimeout = function(id) {
		var $ptr, id, w;
		w = this;
		w.Object.clearTimeout(id);
	};
	window.prototype.ClearTimeout = function(id) { return this.$val.ClearTimeout(id); };
	window.ptr.prototype.Close = function() {
		var $ptr, w;
		w = this;
		w.Object.close();
	};
	window.prototype.Close = function() { return this.$val.Close(); };
	window.ptr.prototype.Confirm = function(prompt) {
		var $ptr, prompt, w;
		w = this;
		return !!(w.Object.confirm($externalize(prompt, $String)));
	};
	window.prototype.Confirm = function(prompt) { return this.$val.Confirm(prompt); };
	window.ptr.prototype.Focus = function() {
		var $ptr, w;
		w = this;
		w.Object.focus();
	};
	window.prototype.Focus = function() { return this.$val.Focus(); };
	window.ptr.prototype.Forward = function() {
		var $ptr, w;
		w = this;
		w.Object.forward();
	};
	window.prototype.Forward = function() { return this.$val.Forward(); };
	window.ptr.prototype.GetComputedStyle = function(el, pseudoElt) {
		var $ptr, _r, el, optArg, pseudoElt, w, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; el = $f.el; optArg = $f.optArg; pseudoElt = $f.pseudoElt; w = $f.w; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		w = this;
		optArg = $ifaceNil;
		if (!(pseudoElt === "")) {
			optArg = new $String(pseudoElt);
		}
		_r = el.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return new CSSStyleDeclaration.ptr(w.Object.getComputedStyle(_r, $externalize(optArg, $emptyInterface)));
		/* */ } return; } if ($f === undefined) { $f = { $blk: window.ptr.prototype.GetComputedStyle }; } $f.$ptr = $ptr; $f._r = _r; $f.el = el; $f.optArg = optArg; $f.pseudoElt = pseudoElt; $f.w = w; $f.$s = $s; $f.$r = $r; return $f;
	};
	window.prototype.GetComputedStyle = function(el, pseudoElt) { return this.$val.GetComputedStyle(el, pseudoElt); };
	window.ptr.prototype.GetSelection = function() {
		var $ptr, w;
		w = this;
		$panic(new $String("not implemented"));
	};
	window.prototype.GetSelection = function() { return this.$val.GetSelection(); };
	window.ptr.prototype.Home = function() {
		var $ptr, w;
		w = this;
		w.Object.home();
	};
	window.prototype.Home = function() { return this.$val.Home(); };
	window.ptr.prototype.MoveBy = function(dx, dy) {
		var $ptr, dx, dy, w;
		w = this;
		w.Object.moveBy(dx, dy);
	};
	window.prototype.MoveBy = function(dx, dy) { return this.$val.MoveBy(dx, dy); };
	window.ptr.prototype.MoveTo = function(x, y) {
		var $ptr, w, x, y;
		w = this;
		w.Object.moveTo(x, y);
	};
	window.prototype.MoveTo = function(x, y) { return this.$val.MoveTo(x, y); };
	window.ptr.prototype.Open = function(url, name, features) {
		var $ptr, features, name, url, w;
		w = this;
		return new window.ptr(w.Object.open($externalize(url, $String), $externalize(name, $String), $externalize(features, $String)));
	};
	window.prototype.Open = function(url, name, features) { return this.$val.Open(url, name, features); };
	window.ptr.prototype.OpenDialog = function(url, name, features, args) {
		var $ptr, args, features, name, url, w;
		w = this;
		return new window.ptr(w.Object.openDialog($externalize(url, $String), $externalize(name, $String), $externalize(features, $String), $externalize(args, sliceType)));
	};
	window.prototype.OpenDialog = function(url, name, features, args) { return this.$val.OpenDialog(url, name, features, args); };
	window.ptr.prototype.PostMessage = function(message, target, transfer) {
		var $ptr, message, target, transfer, w;
		w = this;
		w.Object.postMessage($externalize(message, $String), $externalize(target, $String), $externalize(transfer, sliceType));
	};
	window.prototype.PostMessage = function(message, target, transfer) { return this.$val.PostMessage(message, target, transfer); };
	window.ptr.prototype.Print = function() {
		var $ptr, w;
		w = this;
		w.Object.print();
	};
	window.prototype.Print = function() { return this.$val.Print(); };
	window.ptr.prototype.Prompt = function(prompt, initial) {
		var $ptr, initial, prompt, w;
		w = this;
		return $internalize(w.Object.prompt($externalize(prompt, $String), $externalize(initial, $String)), $String);
	};
	window.prototype.Prompt = function(prompt, initial) { return this.$val.Prompt(prompt, initial); };
	window.ptr.prototype.ResizeBy = function(dw, dh) {
		var $ptr, dh, dw, w;
		w = this;
		w.Object.resizeBy(dw, dh);
	};
	window.prototype.ResizeBy = function(dw, dh) { return this.$val.ResizeBy(dw, dh); };
	window.ptr.prototype.ResizeTo = function(width, height) {
		var $ptr, height, w, width;
		w = this;
		w.Object.resizeTo(width, height);
	};
	window.prototype.ResizeTo = function(width, height) { return this.$val.ResizeTo(width, height); };
	window.ptr.prototype.Scroll = function(x, y) {
		var $ptr, w, x, y;
		w = this;
		w.Object.scroll(x, y);
	};
	window.prototype.Scroll = function(x, y) { return this.$val.Scroll(x, y); };
	window.ptr.prototype.ScrollBy = function(dx, dy) {
		var $ptr, dx, dy, w;
		w = this;
		w.Object.scrollBy(dx, dy);
	};
	window.prototype.ScrollBy = function(dx, dy) { return this.$val.ScrollBy(dx, dy); };
	window.ptr.prototype.ScrollByLines = function(i) {
		var $ptr, i, w;
		w = this;
		w.Object.scrollByLines(i);
	};
	window.prototype.ScrollByLines = function(i) { return this.$val.ScrollByLines(i); };
	window.ptr.prototype.ScrollTo = function(x, y) {
		var $ptr, w, x, y;
		w = this;
		w.Object.scrollTo(x, y);
	};
	window.prototype.ScrollTo = function(x, y) { return this.$val.ScrollTo(x, y); };
	window.ptr.prototype.SetCursor = function(name) {
		var $ptr, name, w;
		w = this;
		w.Object.setCursor($externalize(name, $String));
	};
	window.prototype.SetCursor = function(name) { return this.$val.SetCursor(name); };
	window.ptr.prototype.SetInterval = function(fn, delay) {
		var $ptr, delay, fn, w;
		w = this;
		return $parseInt(w.Object.setInterval($externalize(fn, funcType), delay)) >> 0;
	};
	window.prototype.SetInterval = function(fn, delay) { return this.$val.SetInterval(fn, delay); };
	window.ptr.prototype.SetTimeout = function(fn, delay) {
		var $ptr, delay, fn, w;
		w = this;
		return $parseInt(w.Object.setTimeout($externalize(fn, funcType), delay)) >> 0;
	};
	window.prototype.SetTimeout = function(fn, delay) { return this.$val.SetTimeout(fn, delay); };
	window.ptr.prototype.Stop = function() {
		var $ptr, w;
		w = this;
		w.Object.stop();
	};
	window.prototype.Stop = function() { return this.$val.Stop(); };
	window.ptr.prototype.AddEventListener = function(typ, useCapture, listener) {
		var $ptr, listener, typ, useCapture, w, wrapper;
		w = this;
		wrapper = (function $b(o) {
			var $ptr, o, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; o = $f.o; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = listener(wrapEvent(o)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.o = o; $f.$s = $s; $f.$r = $r; return $f;
		});
		w.Object.addEventListener($externalize(typ, $String), $externalize(wrapper, funcType$1), $externalize(useCapture, $Bool));
		return wrapper;
	};
	window.prototype.AddEventListener = function(typ, useCapture, listener) { return this.$val.AddEventListener(typ, useCapture, listener); };
	window.ptr.prototype.RemoveEventListener = function(typ, useCapture, listener) {
		var $ptr, listener, typ, useCapture, w;
		w = this;
		w.Object.removeEventListener($externalize(typ, $String), $externalize(listener, funcType$1), $externalize(useCapture, $Bool));
	};
	window.prototype.RemoveEventListener = function(typ, useCapture, listener) { return this.$val.RemoveEventListener(typ, useCapture, listener); };
	wrapDOMHighResTimeStamp = function(o) {
		var $ptr, o;
		return new time.Duration(0, $parseFloat(o) * 1e+06);
	};
	window.ptr.prototype.RequestAnimationFrame = function(callback) {
		var $ptr, callback, w, wrapper;
		w = this;
		wrapper = (function $b(o) {
			var $ptr, o, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; o = $f.o; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = callback(wrapDOMHighResTimeStamp(o)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.o = o; $f.$s = $s; $f.$r = $r; return $f;
		});
		return $parseInt(w.Object.requestAnimationFrame($externalize(wrapper, funcType$1))) >> 0;
	};
	window.prototype.RequestAnimationFrame = function(callback) { return this.$val.RequestAnimationFrame(callback); };
	window.ptr.prototype.CancelAnimationFrame = function(requestID) {
		var $ptr, requestID, w;
		w = this;
		w.Object.cancelAnimationFrame(requestID);
	};
	window.prototype.CancelAnimationFrame = function(requestID) { return this.$val.CancelAnimationFrame(requestID); };
	PositionError.ptr.prototype.Error = function() {
		var $ptr, err;
		err = this;
		return $internalize(err.Object.message(), $String);
	};
	PositionError.prototype.Error = function() { return this.$val.Error(); };
	BasicNode.ptr.prototype.Underlying = function() {
		var $ptr, n;
		n = this;
		return n.Object;
	};
	BasicNode.prototype.Underlying = function() { return this.$val.Underlying(); };
	BasicNode.ptr.prototype.AddEventListener = function(typ, useCapture, listener) {
		var $ptr, listener, n, typ, useCapture, wrapper;
		n = this;
		wrapper = (function $b(o) {
			var $ptr, o, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; o = $f.o; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			$r = listener(wrapEvent(o)); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.o = o; $f.$s = $s; $f.$r = $r; return $f;
		});
		n.Object.addEventListener($externalize(typ, $String), $externalize(wrapper, funcType$1), $externalize(useCapture, $Bool));
		return wrapper;
	};
	BasicNode.prototype.AddEventListener = function(typ, useCapture, listener) { return this.$val.AddEventListener(typ, useCapture, listener); };
	BasicNode.ptr.prototype.RemoveEventListener = function(typ, useCapture, listener) {
		var $ptr, listener, n, typ, useCapture;
		n = this;
		n.Object.removeEventListener($externalize(typ, $String), $externalize(listener, funcType$1), $externalize(useCapture, $Bool));
	};
	BasicNode.prototype.RemoveEventListener = function(typ, useCapture, listener) { return this.$val.RemoveEventListener(typ, useCapture, listener); };
	BasicNode.ptr.prototype.BaseURI = function() {
		var $ptr, n;
		n = this;
		return $internalize(n.Object.baseURI, $String);
	};
	BasicNode.prototype.BaseURI = function() { return this.$val.BaseURI(); };
	BasicNode.ptr.prototype.ChildNodes = function() {
		var $ptr, n;
		n = this;
		return nodeListToNodes(n.Object.childNodes);
	};
	BasicNode.prototype.ChildNodes = function() { return this.$val.ChildNodes(); };
	BasicNode.ptr.prototype.FirstChild = function() {
		var $ptr, n;
		n = this;
		return wrapNode(n.Object.firstChild);
	};
	BasicNode.prototype.FirstChild = function() { return this.$val.FirstChild(); };
	BasicNode.ptr.prototype.LastChild = function() {
		var $ptr, n;
		n = this;
		return wrapNode(n.Object.lastChild);
	};
	BasicNode.prototype.LastChild = function() { return this.$val.LastChild(); };
	BasicNode.ptr.prototype.NextSibling = function() {
		var $ptr, n;
		n = this;
		return wrapNode(n.Object.nextSibling);
	};
	BasicNode.prototype.NextSibling = function() { return this.$val.NextSibling(); };
	BasicNode.ptr.prototype.NodeName = function() {
		var $ptr, n;
		n = this;
		return $internalize(n.Object.nodeName, $String);
	};
	BasicNode.prototype.NodeName = function() { return this.$val.NodeName(); };
	BasicNode.ptr.prototype.NodeType = function() {
		var $ptr, n;
		n = this;
		return $parseInt(n.Object.nodeType) >> 0;
	};
	BasicNode.prototype.NodeType = function() { return this.$val.NodeType(); };
	BasicNode.ptr.prototype.NodeValue = function() {
		var $ptr, n;
		n = this;
		return toString(n.Object.nodeValue);
	};
	BasicNode.prototype.NodeValue = function() { return this.$val.NodeValue(); };
	BasicNode.ptr.prototype.SetNodeValue = function(s) {
		var $ptr, n, s;
		n = this;
		n.Object.nodeValue = $externalize(s, $String);
	};
	BasicNode.prototype.SetNodeValue = function(s) { return this.$val.SetNodeValue(s); };
	BasicNode.ptr.prototype.OwnerDocument = function() {
		var $ptr, n;
		n = this;
		$panic(new $String("not implemented"));
	};
	BasicNode.prototype.OwnerDocument = function() { return this.$val.OwnerDocument(); };
	BasicNode.ptr.prototype.ParentNode = function() {
		var $ptr, n;
		n = this;
		return wrapNode(n.Object.parentNode);
	};
	BasicNode.prototype.ParentNode = function() { return this.$val.ParentNode(); };
	BasicNode.ptr.prototype.ParentElement = function() {
		var $ptr, n;
		n = this;
		return wrapElement(n.Object.parentElement);
	};
	BasicNode.prototype.ParentElement = function() { return this.$val.ParentElement(); };
	BasicNode.ptr.prototype.PreviousSibling = function() {
		var $ptr, n;
		n = this;
		return wrapNode(n.Object.previousSibling);
	};
	BasicNode.prototype.PreviousSibling = function() { return this.$val.PreviousSibling(); };
	BasicNode.ptr.prototype.TextContent = function() {
		var $ptr, n;
		n = this;
		return toString(n.Object.textContent);
	};
	BasicNode.prototype.TextContent = function() { return this.$val.TextContent(); };
	BasicNode.ptr.prototype.SetTextContent = function(s) {
		var $ptr, n, s;
		n = this;
		n.Object.textContent = $externalize(s, $String);
	};
	BasicNode.prototype.SetTextContent = function(s) { return this.$val.SetTextContent(s); };
	BasicNode.ptr.prototype.AppendChild = function(newchild) {
		var $ptr, _r, n, newchild, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; n = $f.n; newchild = $f.newchild; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = newchild.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n.Object.appendChild(_r);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.AppendChild }; } $f.$ptr = $ptr; $f._r = _r; $f.n = n; $f.newchild = newchild; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.AppendChild = function(newchild) { return this.$val.AppendChild(newchild); };
	BasicNode.ptr.prototype.CloneNode = function(deep) {
		var $ptr, deep, n;
		n = this;
		return wrapNode(n.Object.cloneNode($externalize(deep, $Bool)));
	};
	BasicNode.prototype.CloneNode = function(deep) { return this.$val.CloneNode(deep); };
	BasicNode.ptr.prototype.CompareDocumentPosition = function(other) {
		var $ptr, _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return $parseInt(n.Object.compareDocumentPosition(_r)) >> 0;
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.CompareDocumentPosition }; } $f.$ptr = $ptr; $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.CompareDocumentPosition = function(other) { return this.$val.CompareDocumentPosition(other); };
	BasicNode.ptr.prototype.Contains = function(other) {
		var $ptr, _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return !!(n.Object.contains(_r));
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.Contains }; } $f.$ptr = $ptr; $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.Contains = function(other) { return this.$val.Contains(other); };
	BasicNode.ptr.prototype.HasChildNodes = function() {
		var $ptr, n;
		n = this;
		return !!(n.Object.hasChildNodes());
	};
	BasicNode.prototype.HasChildNodes = function() { return this.$val.HasChildNodes(); };
	BasicNode.ptr.prototype.InsertBefore = function(which, before) {
		var $ptr, _r, _r$1, before, n, o, which, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; before = $f.before; n = $f.n; o = $f.o; which = $f.which; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		o = $ifaceNil;
		/* */ if (!($interfaceIsEqual(before, $ifaceNil))) { $s = 1; continue; }
		/* */ $s = 2; continue;
		/* if (!($interfaceIsEqual(before, $ifaceNil))) { */ case 1:
			_r = before.Underlying(); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			o = new $jsObjectPtr(_r);
		/* } */ case 2:
		_r$1 = which.Underlying(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		n.Object.insertBefore(_r$1, $externalize(o, $emptyInterface));
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.InsertBefore }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.before = before; $f.n = n; $f.o = o; $f.which = which; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.InsertBefore = function(which, before) { return this.$val.InsertBefore(which, before); };
	BasicNode.ptr.prototype.IsDefaultNamespace = function(s) {
		var $ptr, n, s;
		n = this;
		return !!(n.Object.isDefaultNamespace($externalize(s, $String)));
	};
	BasicNode.prototype.IsDefaultNamespace = function(s) { return this.$val.IsDefaultNamespace(s); };
	BasicNode.ptr.prototype.IsEqualNode = function(other) {
		var $ptr, _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return !!(n.Object.isEqualNode(_r));
		/* */ } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.IsEqualNode }; } $f.$ptr = $ptr; $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.IsEqualNode = function(other) { return this.$val.IsEqualNode(other); };
	BasicNode.ptr.prototype.LookupPrefix = function() {
		var $ptr, n;
		n = this;
		return $internalize(n.Object.lookupPrefix(), $String);
	};
	BasicNode.prototype.LookupPrefix = function() { return this.$val.LookupPrefix(); };
	BasicNode.ptr.prototype.LookupNamespaceURI = function(s) {
		var $ptr, n, s;
		n = this;
		return toString(n.Object.lookupNamespaceURI($externalize(s, $String)));
	};
	BasicNode.prototype.LookupNamespaceURI = function(s) { return this.$val.LookupNamespaceURI(s); };
	BasicNode.ptr.prototype.Normalize = function() {
		var $ptr, n;
		n = this;
		n.Object.normalize();
	};
	BasicNode.prototype.Normalize = function() { return this.$val.Normalize(); };
	BasicNode.ptr.prototype.RemoveChild = function(other) {
		var $ptr, _r, n, other, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; n = $f.n; other = $f.other; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = other.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		n.Object.removeChild(_r);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.RemoveChild }; } $f.$ptr = $ptr; $f._r = _r; $f.n = n; $f.other = other; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.RemoveChild = function(other) { return this.$val.RemoveChild(other); };
	BasicNode.ptr.prototype.ReplaceChild = function(newChild, oldChild) {
		var $ptr, _r, _r$1, n, newChild, oldChild, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; n = $f.n; newChild = $f.newChild; oldChild = $f.oldChild; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		n = this;
		_r = newChild.Underlying(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		_r$1 = oldChild.Underlying(); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
		n.Object.replaceChild(_r, _r$1);
		/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: BasicNode.ptr.prototype.ReplaceChild }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f.n = n; $f.newChild = newChild; $f.oldChild = oldChild; $f.$s = $s; $f.$r = $r; return $f;
	};
	BasicNode.prototype.ReplaceChild = function(newChild, oldChild) { return this.$val.ReplaceChild(newChild, oldChild); };
	BasicHTMLElement.ptr.prototype.AccessKey = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.accessKey, $String);
	};
	BasicHTMLElement.prototype.AccessKey = function() { return this.$val.AccessKey(); };
	BasicHTMLElement.ptr.prototype.Dataset = function() {
		var $ptr, _i, _key, _ref, data, e, key, keys, o;
		e = this;
		o = e.BasicElement.BasicNode.Object.dataset;
		data = $makeMap($String.keyFor, []);
		keys = js.Keys(o);
		_ref = keys;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			key = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			_key = key; (data || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: $internalize(o[$externalize(key, $String)], $String) };
			_i++;
		}
		return data;
	};
	BasicHTMLElement.prototype.Dataset = function() { return this.$val.Dataset(); };
	BasicHTMLElement.ptr.prototype.SetAccessKey = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicElement.BasicNode.Object.accessKey = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetAccessKey = function(s) { return this.$val.SetAccessKey(s); };
	BasicHTMLElement.ptr.prototype.AccessKeyLabel = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.accessKeyLabel, $String);
	};
	BasicHTMLElement.prototype.AccessKeyLabel = function() { return this.$val.AccessKeyLabel(); };
	BasicHTMLElement.ptr.prototype.SetAccessKeyLabel = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicElement.BasicNode.Object.accessKeyLabel = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetAccessKeyLabel = function(s) { return this.$val.SetAccessKeyLabel(s); };
	BasicHTMLElement.ptr.prototype.ContentEditable = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.contentEditable, $String);
	};
	BasicHTMLElement.prototype.ContentEditable = function() { return this.$val.ContentEditable(); };
	BasicHTMLElement.ptr.prototype.SetContentEditable = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicElement.BasicNode.Object.contentEditable = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetContentEditable = function(s) { return this.$val.SetContentEditable(s); };
	BasicHTMLElement.ptr.prototype.IsContentEditable = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicElement.BasicNode.Object.isContentEditable);
	};
	BasicHTMLElement.prototype.IsContentEditable = function() { return this.$val.IsContentEditable(); };
	BasicHTMLElement.ptr.prototype.Dir = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.dir, $String);
	};
	BasicHTMLElement.prototype.Dir = function() { return this.$val.Dir(); };
	BasicHTMLElement.ptr.prototype.SetDir = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicElement.BasicNode.Object.dir = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetDir = function(s) { return this.$val.SetDir(s); };
	BasicHTMLElement.ptr.prototype.Draggable = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicElement.BasicNode.Object.draggable);
	};
	BasicHTMLElement.prototype.Draggable = function() { return this.$val.Draggable(); };
	BasicHTMLElement.ptr.prototype.SetDraggable = function(b) {
		var $ptr, b, e;
		e = this;
		e.BasicElement.BasicNode.Object.draggable = $externalize(b, $Bool);
	};
	BasicHTMLElement.prototype.SetDraggable = function(b) { return this.$val.SetDraggable(b); };
	BasicHTMLElement.ptr.prototype.Lang = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.lang, $String);
	};
	BasicHTMLElement.prototype.Lang = function() { return this.$val.Lang(); };
	BasicHTMLElement.ptr.prototype.SetLang = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicElement.BasicNode.Object.lang = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetLang = function(s) { return this.$val.SetLang(s); };
	BasicHTMLElement.ptr.prototype.OffsetHeight = function() {
		var $ptr, e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetHeight);
	};
	BasicHTMLElement.prototype.OffsetHeight = function() { return this.$val.OffsetHeight(); };
	BasicHTMLElement.ptr.prototype.OffsetLeft = function() {
		var $ptr, e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetLeft);
	};
	BasicHTMLElement.prototype.OffsetLeft = function() { return this.$val.OffsetLeft(); };
	BasicHTMLElement.ptr.prototype.OffsetParent = function() {
		var $ptr, e;
		e = this;
		return wrapHTMLElement(e.BasicElement.BasicNode.Object.offsetParent);
	};
	BasicHTMLElement.prototype.OffsetParent = function() { return this.$val.OffsetParent(); };
	BasicHTMLElement.ptr.prototype.OffsetTop = function() {
		var $ptr, e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetTop);
	};
	BasicHTMLElement.prototype.OffsetTop = function() { return this.$val.OffsetTop(); };
	BasicHTMLElement.ptr.prototype.OffsetWidth = function() {
		var $ptr, e;
		e = this;
		return $parseFloat(e.BasicElement.BasicNode.Object.offsetWidth);
	};
	BasicHTMLElement.prototype.OffsetWidth = function() { return this.$val.OffsetWidth(); };
	BasicHTMLElement.ptr.prototype.Style = function() {
		var $ptr, e;
		e = this;
		return new CSSStyleDeclaration.ptr(e.BasicElement.BasicNode.Object.style);
	};
	BasicHTMLElement.prototype.Style = function() { return this.$val.Style(); };
	BasicHTMLElement.ptr.prototype.TabIndex = function() {
		var $ptr, e;
		e = this;
		return $parseInt(e.BasicElement.BasicNode.Object.tabIndex) >> 0;
	};
	BasicHTMLElement.prototype.TabIndex = function() { return this.$val.TabIndex(); };
	BasicHTMLElement.ptr.prototype.SetTabIndex = function(i) {
		var $ptr, e, i;
		e = this;
		e.BasicElement.BasicNode.Object.tabIndex = i;
	};
	BasicHTMLElement.prototype.SetTabIndex = function(i) { return this.$val.SetTabIndex(i); };
	BasicHTMLElement.ptr.prototype.Title = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicElement.BasicNode.Object.title, $String);
	};
	BasicHTMLElement.prototype.Title = function() { return this.$val.Title(); };
	BasicHTMLElement.ptr.prototype.SetTitle = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicElement.BasicNode.Object.title = $externalize(s, $String);
	};
	BasicHTMLElement.prototype.SetTitle = function(s) { return this.$val.SetTitle(s); };
	BasicHTMLElement.ptr.prototype.Blur = function() {
		var $ptr, e;
		e = this;
		e.BasicElement.BasicNode.Object.blur();
	};
	BasicHTMLElement.prototype.Blur = function() { return this.$val.Blur(); };
	BasicHTMLElement.ptr.prototype.Click = function() {
		var $ptr, e;
		e = this;
		e.BasicElement.BasicNode.Object.click();
	};
	BasicHTMLElement.prototype.Click = function() { return this.$val.Click(); };
	BasicHTMLElement.ptr.prototype.Focus = function() {
		var $ptr, e;
		e = this;
		e.BasicElement.BasicNode.Object.focus();
	};
	BasicHTMLElement.prototype.Focus = function() { return this.$val.Focus(); };
	BasicElement.ptr.prototype.Attributes = function() {
		var $ptr, _key, attrs, e, i, item, length, o;
		e = this;
		o = e.BasicNode.Object.attributes;
		attrs = $makeMap($String.keyFor, []);
		length = $parseInt(o.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < length)) { break; }
			item = o.item(i);
			_key = $internalize(item.name, $String); (attrs || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: $internalize(item.value, $String) };
			i = i + (1) >> 0;
		}
		return attrs;
	};
	BasicElement.prototype.Attributes = function() { return this.$val.Attributes(); };
	BasicElement.ptr.prototype.GetBoundingClientRect = function() {
		var $ptr, e, obj;
		e = this;
		obj = e.BasicNode.Object.getBoundingClientRect();
		return new ClientRect.ptr(obj, 0, 0, 0, 0, 0, 0);
	};
	BasicElement.prototype.GetBoundingClientRect = function() { return this.$val.GetBoundingClientRect(); };
	BasicElement.ptr.prototype.PreviousElementSibling = function() {
		var $ptr, e;
		e = this;
		return wrapElement(e.BasicNode.Object.previousElementSibling);
	};
	BasicElement.prototype.PreviousElementSibling = function() { return this.$val.PreviousElementSibling(); };
	BasicElement.ptr.prototype.NextElementSibling = function() {
		var $ptr, e;
		e = this;
		return wrapElement(e.BasicNode.Object.nextElementSibling);
	};
	BasicElement.prototype.NextElementSibling = function() { return this.$val.NextElementSibling(); };
	BasicElement.ptr.prototype.Class = function() {
		var $ptr, e;
		e = this;
		return new TokenList.ptr(e.BasicNode.Object.classList, e.BasicNode.Object, "className", 0);
	};
	BasicElement.prototype.Class = function() { return this.$val.Class(); };
	BasicElement.ptr.prototype.SetClass = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicNode.Object.className = $externalize(s, $String);
	};
	BasicElement.prototype.SetClass = function(s) { return this.$val.SetClass(s); };
	BasicElement.ptr.prototype.ID = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicNode.Object.id, $String);
	};
	BasicElement.prototype.ID = function() { return this.$val.ID(); };
	BasicElement.ptr.prototype.SetID = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicNode.Object.id = $externalize(s, $String);
	};
	BasicElement.prototype.SetID = function(s) { return this.$val.SetID(s); };
	BasicElement.ptr.prototype.TagName = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicNode.Object.tagName, $String);
	};
	BasicElement.prototype.TagName = function() { return this.$val.TagName(); };
	BasicElement.ptr.prototype.GetAttribute = function(name) {
		var $ptr, e, name;
		e = this;
		return toString(e.BasicNode.Object.getAttribute($externalize(name, $String)));
	};
	BasicElement.prototype.GetAttribute = function(name) { return this.$val.GetAttribute(name); };
	BasicElement.ptr.prototype.GetAttributeNS = function(ns, name) {
		var $ptr, e, name, ns;
		e = this;
		return toString(e.BasicNode.Object.getAttributeNS($externalize(ns, $String), $externalize(name, $String)));
	};
	BasicElement.prototype.GetAttributeNS = function(ns, name) { return this.$val.GetAttributeNS(ns, name); };
	BasicElement.ptr.prototype.GetElementsByClassName = function(s) {
		var $ptr, e, s;
		e = this;
		return nodeListToElements(e.BasicNode.Object.getElementsByClassName($externalize(s, $String)));
	};
	BasicElement.prototype.GetElementsByClassName = function(s) { return this.$val.GetElementsByClassName(s); };
	BasicElement.ptr.prototype.GetElementsByTagName = function(s) {
		var $ptr, e, s;
		e = this;
		return nodeListToElements(e.BasicNode.Object.getElementsByTagName($externalize(s, $String)));
	};
	BasicElement.prototype.GetElementsByTagName = function(s) { return this.$val.GetElementsByTagName(s); };
	BasicElement.ptr.prototype.GetElementsByTagNameNS = function(ns, name) {
		var $ptr, e, name, ns;
		e = this;
		return nodeListToElements(e.BasicNode.Object.getElementsByTagNameNS($externalize(ns, $String), $externalize(name, $String)));
	};
	BasicElement.prototype.GetElementsByTagNameNS = function(ns, name) { return this.$val.GetElementsByTagNameNS(ns, name); };
	BasicElement.ptr.prototype.HasAttribute = function(s) {
		var $ptr, e, s;
		e = this;
		return !!(e.BasicNode.Object.hasAttribute($externalize(s, $String)));
	};
	BasicElement.prototype.HasAttribute = function(s) { return this.$val.HasAttribute(s); };
	BasicElement.ptr.prototype.HasAttributeNS = function(ns, name) {
		var $ptr, e, name, ns;
		e = this;
		return !!(e.BasicNode.Object.hasAttributeNS($externalize(ns, $String), $externalize(name, $String)));
	};
	BasicElement.prototype.HasAttributeNS = function(ns, name) { return this.$val.HasAttributeNS(ns, name); };
	BasicElement.ptr.prototype.QuerySelector = function(s) {
		var $ptr, e, s;
		e = this;
		return wrapElement(e.BasicNode.Object.querySelector($externalize(s, $String)));
	};
	BasicElement.prototype.QuerySelector = function(s) { return this.$val.QuerySelector(s); };
	BasicElement.ptr.prototype.QuerySelectorAll = function(s) {
		var $ptr, e, s;
		e = this;
		return nodeListToElements(e.BasicNode.Object.querySelectorAll($externalize(s, $String)));
	};
	BasicElement.prototype.QuerySelectorAll = function(s) { return this.$val.QuerySelectorAll(s); };
	BasicElement.ptr.prototype.RemoveAttribute = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicNode.Object.removeAttribute($externalize(s, $String));
	};
	BasicElement.prototype.RemoveAttribute = function(s) { return this.$val.RemoveAttribute(s); };
	BasicElement.ptr.prototype.RemoveAttributeNS = function(ns, name) {
		var $ptr, e, name, ns;
		e = this;
		e.BasicNode.Object.removeAttributeNS($externalize(ns, $String), $externalize(name, $String));
	};
	BasicElement.prototype.RemoveAttributeNS = function(ns, name) { return this.$val.RemoveAttributeNS(ns, name); };
	BasicElement.ptr.prototype.SetAttribute = function(name, value) {
		var $ptr, e, name, value;
		e = this;
		e.BasicNode.Object.setAttribute($externalize(name, $String), $externalize(value, $String));
	};
	BasicElement.prototype.SetAttribute = function(name, value) { return this.$val.SetAttribute(name, value); };
	BasicElement.ptr.prototype.SetAttributeNS = function(ns, name, value) {
		var $ptr, e, name, ns, value;
		e = this;
		e.BasicNode.Object.setAttributeNS($externalize(ns, $String), $externalize(name, $String), $externalize(value, $String));
	};
	BasicElement.prototype.SetAttributeNS = function(ns, name, value) { return this.$val.SetAttributeNS(ns, name, value); };
	BasicElement.ptr.prototype.InnerHTML = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicNode.Object.innerHTML, $String);
	};
	BasicElement.prototype.InnerHTML = function() { return this.$val.InnerHTML(); };
	BasicElement.ptr.prototype.SetInnerHTML = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicNode.Object.innerHTML = $externalize(s, $String);
	};
	BasicElement.prototype.SetInnerHTML = function(s) { return this.$val.SetInnerHTML(s); };
	BasicElement.ptr.prototype.OuterHTML = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicNode.Object.outerHTML, $String);
	};
	BasicElement.prototype.OuterHTML = function() { return this.$val.OuterHTML(); };
	BasicElement.ptr.prototype.SetOuterHTML = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicNode.Object.outerHTML = $externalize(s, $String);
	};
	BasicElement.prototype.SetOuterHTML = function(s) { return this.$val.SetOuterHTML(s); };
	HTMLAnchorElement.ptr.prototype.Rel = function() {
		var $ptr, e;
		e = this;
		return new TokenList.ptr(e.URLUtils.Object.relList, e.URLUtils.Object, "rel", 0);
	};
	HTMLAnchorElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLAppletElement.ptr.prototype.Rel = function() {
		var $ptr, e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.relList, e.BasicHTMLElement.BasicElement.BasicNode.Object, "rel", 0);
	};
	HTMLAppletElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLAreaElement.ptr.prototype.Rel = function() {
		var $ptr, e;
		e = this;
		return new TokenList.ptr(e.URLUtils.Object.relList, e.URLUtils.Object, "rel", 0);
	};
	HTMLAreaElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLButtonElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLButtonElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLButtonElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLButtonElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLButtonElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLButtonElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLButtonElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLButtonElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLButtonElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLButtonElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLCanvasElement.ptr.prototype.GetContext2d = function() {
		var $ptr, ctx, e;
		e = this;
		ctx = e.GetContext("2d");
		return new CanvasRenderingContext2D.ptr(ctx, "", "", "", 0, 0, 0, "", "", 0, 0, "", "", "", 0, "");
	};
	HTMLCanvasElement.prototype.GetContext2d = function() { return this.$val.GetContext2d(); };
	HTMLCanvasElement.ptr.prototype.GetContext = function(param) {
		var $ptr, e, param;
		e = this;
		return e.BasicHTMLElement.BasicElement.BasicNode.Object.getContext($externalize(param, $String));
	};
	HTMLCanvasElement.prototype.GetContext = function(param) { return this.$val.GetContext(param); };
	CanvasRenderingContext2D.ptr.prototype.CreateLinearGradient = function(x0, y0, x1, y1) {
		var $ptr, ctx, x0, x1, y0, y1;
		ctx = this;
		ctx.Object.createLinearGradient(x0, y0, x1, y1);
	};
	CanvasRenderingContext2D.prototype.CreateLinearGradient = function(x0, y0, x1, y1) { return this.$val.CreateLinearGradient(x0, y0, x1, y1); };
	CanvasRenderingContext2D.ptr.prototype.Rect = function(x, y, width, height) {
		var $ptr, ctx, height, width, x, y;
		ctx = this;
		ctx.Object.rect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.Rect = function(x, y, width, height) { return this.$val.Rect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.FillRect = function(x, y, width, height) {
		var $ptr, ctx, height, width, x, y;
		ctx = this;
		ctx.Object.fillRect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.FillRect = function(x, y, width, height) { return this.$val.FillRect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.StrokeRect = function(x, y, width, height) {
		var $ptr, ctx, height, width, x, y;
		ctx = this;
		ctx.Object.strokeRect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.StrokeRect = function(x, y, width, height) { return this.$val.StrokeRect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.ClearRect = function(x, y, width, height) {
		var $ptr, ctx, height, width, x, y;
		ctx = this;
		ctx.Object.clearRect(x, y, width, height);
	};
	CanvasRenderingContext2D.prototype.ClearRect = function(x, y, width, height) { return this.$val.ClearRect(x, y, width, height); };
	CanvasRenderingContext2D.ptr.prototype.Fill = function() {
		var $ptr, ctx;
		ctx = this;
		ctx.Object.fill();
	};
	CanvasRenderingContext2D.prototype.Fill = function() { return this.$val.Fill(); };
	CanvasRenderingContext2D.ptr.prototype.Stroke = function() {
		var $ptr, ctx;
		ctx = this;
		ctx.Object.stroke();
	};
	CanvasRenderingContext2D.prototype.Stroke = function() { return this.$val.Stroke(); };
	CanvasRenderingContext2D.ptr.prototype.BeginPath = function() {
		var $ptr, ctx;
		ctx = this;
		ctx.Object.beginPath();
	};
	CanvasRenderingContext2D.prototype.BeginPath = function() { return this.$val.BeginPath(); };
	CanvasRenderingContext2D.ptr.prototype.MoveTo = function(x, y) {
		var $ptr, ctx, x, y;
		ctx = this;
		ctx.Object.moveTo(x, y);
	};
	CanvasRenderingContext2D.prototype.MoveTo = function(x, y) { return this.$val.MoveTo(x, y); };
	CanvasRenderingContext2D.ptr.prototype.ClosePath = function() {
		var $ptr, ctx;
		ctx = this;
		ctx.Object.closePath();
	};
	CanvasRenderingContext2D.prototype.ClosePath = function() { return this.$val.ClosePath(); };
	CanvasRenderingContext2D.ptr.prototype.LineTo = function(x, y) {
		var $ptr, ctx, x, y;
		ctx = this;
		ctx.Object.lineTo(x, y);
	};
	CanvasRenderingContext2D.prototype.LineTo = function(x, y) { return this.$val.LineTo(x, y); };
	CanvasRenderingContext2D.ptr.prototype.Clip = function() {
		var $ptr, ctx;
		ctx = this;
		ctx.Object.clip();
	};
	CanvasRenderingContext2D.prototype.Clip = function() { return this.$val.Clip(); };
	CanvasRenderingContext2D.ptr.prototype.QuadraticCurveTo = function(cpx, cpy, x, y) {
		var $ptr, cpx, cpy, ctx, x, y;
		ctx = this;
		ctx.Object.quadraticCurveTo(cpx, cpy, x, y);
	};
	CanvasRenderingContext2D.prototype.QuadraticCurveTo = function(cpx, cpy, x, y) { return this.$val.QuadraticCurveTo(cpx, cpy, x, y); };
	CanvasRenderingContext2D.ptr.prototype.BezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) {
		var $ptr, cp1x, cp1y, cp2x, cp2y, ctx, x, y;
		ctx = this;
		ctx.Object.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
	};
	CanvasRenderingContext2D.prototype.BezierCurveTo = function(cp1x, cp1y, cp2x, cp2y, x, y) { return this.$val.BezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y); };
	CanvasRenderingContext2D.ptr.prototype.Arc = function(x, y, r, sAngle, eAngle, counterclockwise) {
		var $ptr, counterclockwise, ctx, eAngle, r, sAngle, x, y;
		ctx = this;
		ctx.Object.arc(x, y, r, sAngle, eAngle, $externalize(counterclockwise, $Bool));
	};
	CanvasRenderingContext2D.prototype.Arc = function(x, y, r, sAngle, eAngle, counterclockwise) { return this.$val.Arc(x, y, r, sAngle, eAngle, counterclockwise); };
	CanvasRenderingContext2D.ptr.prototype.ArcTo = function(x1, y1, x2, y2, r) {
		var $ptr, ctx, r, x1, x2, y1, y2;
		ctx = this;
		ctx.Object.arcTo(x1, y1, x2, y2, r);
	};
	CanvasRenderingContext2D.prototype.ArcTo = function(x1, y1, x2, y2, r) { return this.$val.ArcTo(x1, y1, x2, y2, r); };
	CanvasRenderingContext2D.ptr.prototype.IsPointInPath = function(x, y) {
		var $ptr, ctx, x, y;
		ctx = this;
		return !!(ctx.Object.isPointInPath(x, y));
	};
	CanvasRenderingContext2D.prototype.IsPointInPath = function(x, y) { return this.$val.IsPointInPath(x, y); };
	CanvasRenderingContext2D.ptr.prototype.Scale = function(scaleWidth, scaleHeight) {
		var $ptr, ctx, scaleHeight, scaleWidth;
		ctx = this;
		ctx.Object.scale(scaleWidth, scaleHeight);
	};
	CanvasRenderingContext2D.prototype.Scale = function(scaleWidth, scaleHeight) { return this.$val.Scale(scaleWidth, scaleHeight); };
	CanvasRenderingContext2D.ptr.prototype.Rotate = function(angle) {
		var $ptr, angle, ctx;
		ctx = this;
		ctx.Object.rotate(angle);
	};
	CanvasRenderingContext2D.prototype.Rotate = function(angle) { return this.$val.Rotate(angle); };
	CanvasRenderingContext2D.ptr.prototype.Translate = function(x, y) {
		var $ptr, ctx, x, y;
		ctx = this;
		ctx.Object.translate(x, y);
	};
	CanvasRenderingContext2D.prototype.Translate = function(x, y) { return this.$val.Translate(x, y); };
	CanvasRenderingContext2D.ptr.prototype.Transform = function(a, b, c, d, e, f) {
		var $ptr, a, b, c, ctx, d, e, f;
		ctx = this;
		ctx.Object.transform(a, b, c, d, e, f);
	};
	CanvasRenderingContext2D.prototype.Transform = function(a, b, c, d, e, f) { return this.$val.Transform(a, b, c, d, e, f); };
	CanvasRenderingContext2D.ptr.prototype.SetTransform = function(a, b, c, d, e, f) {
		var $ptr, a, b, c, ctx, d, e, f;
		ctx = this;
		ctx.Object.setTransform(a, b, c, d, e, f);
	};
	CanvasRenderingContext2D.prototype.SetTransform = function(a, b, c, d, e, f) { return this.$val.SetTransform(a, b, c, d, e, f); };
	CanvasRenderingContext2D.ptr.prototype.FillText = function(text, x, y, maxWidth) {
		var $ptr, ctx, maxWidth, text, x, y;
		ctx = this;
		if (maxWidth === -1) {
			ctx.Object.fillText($externalize(text, $String), x, y);
			return;
		}
		ctx.Object.fillText($externalize(text, $String), x, y, maxWidth);
	};
	CanvasRenderingContext2D.prototype.FillText = function(text, x, y, maxWidth) { return this.$val.FillText(text, x, y, maxWidth); };
	CanvasRenderingContext2D.ptr.prototype.StrokeText = function(text, x, y, maxWidth) {
		var $ptr, ctx, maxWidth, text, x, y;
		ctx = this;
		if (maxWidth === -1) {
			ctx.Object.strokeText($externalize(text, $String), x, y);
			return;
		}
		ctx.Object.strokeText($externalize(text, $String), x, y, maxWidth);
	};
	CanvasRenderingContext2D.prototype.StrokeText = function(text, x, y, maxWidth) { return this.$val.StrokeText(text, x, y, maxWidth); };
	HTMLDataListElement.ptr.prototype.Options = function() {
		var $ptr, e;
		e = this;
		return getOptions(e.BasicHTMLElement.BasicElement.BasicNode.Object, "options");
	};
	HTMLDataListElement.prototype.Options = function() { return this.$val.Options(); };
	HTMLFieldSetElement.ptr.prototype.Elements = function() {
		var $ptr, e;
		e = this;
		return nodeListToHTMLElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.elements);
	};
	HTMLFieldSetElement.prototype.Elements = function() { return this.$val.Elements(); };
	HTMLFieldSetElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLFieldSetElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLFieldSetElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLFieldSetElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLFieldSetElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLFieldSetElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLFieldSetElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLFieldSetElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLFormElement.ptr.prototype.Elements = function() {
		var $ptr, e;
		e = this;
		return nodeListToHTMLElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.elements);
	};
	HTMLFormElement.prototype.Elements = function() { return this.$val.Elements(); };
	HTMLFormElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLFormElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLFormElement.ptr.prototype.Submit = function() {
		var $ptr, e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.submit();
	};
	HTMLFormElement.prototype.Submit = function() { return this.$val.Submit(); };
	HTMLFormElement.ptr.prototype.Reset = function() {
		var $ptr, e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.reset();
	};
	HTMLFormElement.prototype.Reset = function() { return this.$val.Reset(); };
	HTMLFormElement.ptr.prototype.Item = function(index) {
		var $ptr, e, index;
		e = this;
		return wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.item(index));
	};
	HTMLFormElement.prototype.Item = function(index) { return this.$val.Item(index); };
	HTMLFormElement.ptr.prototype.NamedItem = function(name) {
		var $ptr, e, name;
		e = this;
		return wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.namedItem($externalize(name, $String)));
	};
	HTMLFormElement.prototype.NamedItem = function(name) { return this.$val.NamedItem(name); };
	HTMLIFrameElement.ptr.prototype.ContentDocument = function() {
		var $ptr, e;
		e = this;
		return wrapDocument(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentDocument);
	};
	HTMLIFrameElement.prototype.ContentDocument = function() { return this.$val.ContentDocument(); };
	HTMLIFrameElement.ptr.prototype.ContentWindow = function() {
		var $ptr, e;
		e = this;
		return new window.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentWindow);
	};
	HTMLIFrameElement.prototype.ContentWindow = function() { return this.$val.ContentWindow(); };
	HTMLInputElement.ptr.prototype.Files = function() {
		var $ptr, _i, _ref, e, files, i, out;
		e = this;
		files = e.BasicHTMLElement.BasicElement.BasicNode.Object.files;
		out = $makeSlice(sliceType$12, ($parseInt(files.length) >> 0));
		_ref = out;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			((i < 0 || i >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i] = new File.ptr(files.item(i)));
			_i++;
		}
		return out;
	};
	HTMLInputElement.prototype.Files = function() { return this.$val.Files(); };
	HTMLInputElement.ptr.prototype.List = function() {
		var $ptr, e, list;
		e = this;
		list = wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.list);
		if ($interfaceIsEqual(list, $ifaceNil)) {
			return ptrType$14.nil;
		}
		return $assertType(list, ptrType$14);
	};
	HTMLInputElement.prototype.List = function() { return this.$val.List(); };
	HTMLInputElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLInputElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLInputElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLInputElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLInputElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLInputElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLInputElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLInputElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLInputElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLInputElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLInputElement.ptr.prototype.Select = function() {
		var $ptr, e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.select();
	};
	HTMLInputElement.prototype.Select = function() { return this.$val.Select(); };
	HTMLInputElement.ptr.prototype.SetSelectionRange = function(start, end, direction) {
		var $ptr, direction, e, end, start;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setSelectionRange(start, end, $externalize(direction, $String));
	};
	HTMLInputElement.prototype.SetSelectionRange = function(start, end, direction) { return this.$val.SetSelectionRange(start, end, direction); };
	HTMLInputElement.ptr.prototype.StepDown = function(n) {
		var $ptr, e, n;
		e = this;
		return callRecover(e.BasicHTMLElement.BasicElement.BasicNode.Object, "stepDown", new sliceType([new $Int(n)]));
	};
	HTMLInputElement.prototype.StepDown = function(n) { return this.$val.StepDown(n); };
	HTMLInputElement.ptr.prototype.StepUp = function(n) {
		var $ptr, e, n;
		e = this;
		return callRecover(e.BasicHTMLElement.BasicElement.BasicNode.Object, "stepUp", new sliceType([new $Int(n)]));
	};
	HTMLInputElement.prototype.StepUp = function(n) { return this.$val.StepUp(n); };
	HTMLKeygenElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLKeygenElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLKeygenElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLKeygenElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLKeygenElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLKeygenElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLKeygenElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLKeygenElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLKeygenElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLKeygenElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLLabelElement.ptr.prototype.Control = function() {
		var $ptr, e;
		e = this;
		return wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.control);
	};
	HTMLLabelElement.prototype.Control = function() { return this.$val.Control(); };
	HTMLLabelElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLLabelElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLLegendElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLLegendElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLLinkElement.ptr.prototype.Rel = function() {
		var $ptr, e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.relList, e.BasicHTMLElement.BasicElement.BasicNode.Object, "rel", 0);
	};
	HTMLLinkElement.prototype.Rel = function() { return this.$val.Rel(); };
	HTMLLinkElement.ptr.prototype.Sizes = function() {
		var $ptr, e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.sizes, e.BasicHTMLElement.BasicElement.BasicNode.Object, "", 0);
	};
	HTMLLinkElement.prototype.Sizes = function() { return this.$val.Sizes(); };
	HTMLLinkElement.ptr.prototype.Sheet = function() {
		var $ptr, e;
		e = this;
		$panic(new $String("not implemented"));
	};
	HTMLLinkElement.prototype.Sheet = function() { return this.$val.Sheet(); };
	HTMLMapElement.ptr.prototype.Areas = function() {
		var $ptr, _i, _ref, area, areas, e, i, out;
		e = this;
		areas = nodeListToElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.areas);
		out = $makeSlice(sliceType$13, areas.$length);
		_ref = areas;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			area = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i] = $assertType(area, ptrType$15));
			_i++;
		}
		return out;
	};
	HTMLMapElement.prototype.Areas = function() { return this.$val.Areas(); };
	HTMLMapElement.ptr.prototype.Images = function() {
		var $ptr, e;
		e = this;
		return nodeListToHTMLElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.areas);
	};
	HTMLMapElement.prototype.Images = function() { return this.$val.Images(); };
	HTMLMediaElement.ptr.prototype.Play = function() {
		var $ptr, e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.play();
	};
	HTMLMediaElement.prototype.Play = function() { return this.$val.Play(); };
	HTMLMediaElement.ptr.prototype.Pause = function() {
		var $ptr, e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.pause();
	};
	HTMLMediaElement.prototype.Pause = function() { return this.$val.Pause(); };
	HTMLMeterElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = $clone(this, HTMLMeterElement);
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLMeterElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLObjectElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLObjectElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLObjectElement.ptr.prototype.ContentDocument = function() {
		var $ptr, e;
		e = this;
		return wrapDocument(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentDocument);
	};
	HTMLObjectElement.prototype.ContentDocument = function() { return this.$val.ContentDocument(); };
	HTMLObjectElement.ptr.prototype.ContentWindow = function() {
		var $ptr, e;
		e = this;
		return new window.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.contentWindow);
	};
	HTMLObjectElement.prototype.ContentWindow = function() { return this.$val.ContentWindow(); };
	HTMLObjectElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLObjectElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLObjectElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLObjectElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLObjectElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLObjectElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLOptionElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLOptionElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLOutputElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLOutputElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLOutputElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLOutputElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLOutputElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLOutputElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLOutputElement.ptr.prototype.For = function() {
		var $ptr, e;
		e = this;
		return new TokenList.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.htmlFor, e.BasicHTMLElement.BasicElement.BasicNode.Object, "", 0);
	};
	HTMLOutputElement.prototype.For = function() { return this.$val.For(); };
	HTMLOutputElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLOutputElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLOutputElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLOutputElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLProgressElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = $clone(this, HTMLProgressElement);
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLProgressElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLSelectElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLSelectElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLSelectElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLSelectElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLSelectElement.ptr.prototype.Options = function() {
		var $ptr, e;
		e = this;
		return getOptions(e.BasicHTMLElement.BasicElement.BasicNode.Object, "options");
	};
	HTMLSelectElement.prototype.Options = function() { return this.$val.Options(); };
	HTMLSelectElement.ptr.prototype.SelectedOptions = function() {
		var $ptr, e;
		e = this;
		return getOptions(e.BasicHTMLElement.BasicElement.BasicNode.Object, "selectedOptions");
	};
	HTMLSelectElement.prototype.SelectedOptions = function() { return this.$val.SelectedOptions(); };
	HTMLSelectElement.ptr.prototype.Item = function(index) {
		var $ptr, e, el, index;
		e = this;
		el = wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.item(index));
		if ($interfaceIsEqual(el, $ifaceNil)) {
			return ptrType$7.nil;
		}
		return $assertType(el, ptrType$7);
	};
	HTMLSelectElement.prototype.Item = function(index) { return this.$val.Item(index); };
	HTMLSelectElement.ptr.prototype.NamedItem = function(name) {
		var $ptr, e, el, name;
		e = this;
		el = wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.namedItem($externalize(name, $String)));
		if ($interfaceIsEqual(el, $ifaceNil)) {
			return ptrType$7.nil;
		}
		return $assertType(el, ptrType$7);
	};
	HTMLSelectElement.prototype.NamedItem = function(name) { return this.$val.NamedItem(name); };
	HTMLSelectElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLSelectElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLSelectElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLSelectElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLSelectElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLSelectElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLTableRowElement.ptr.prototype.Cells = function() {
		var $ptr, _i, _ref, cell, cells, e, i, out;
		e = this;
		cells = nodeListToElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.cells);
		out = $makeSlice(sliceType$14, cells.$length);
		_ref = cells;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			cell = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i] = $assertType(cell, ptrType$16));
			_i++;
		}
		return out;
	};
	HTMLTableRowElement.prototype.Cells = function() { return this.$val.Cells(); };
	HTMLTableRowElement.ptr.prototype.InsertCell = function(index) {
		var $ptr, e, index;
		e = this;
		return $assertType(wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.insertCell(index)), ptrType$16);
	};
	HTMLTableRowElement.prototype.InsertCell = function(index) { return this.$val.InsertCell(index); };
	HTMLTableRowElement.ptr.prototype.DeleteCell = function(index) {
		var $ptr, e, index;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.deleteCell(index);
	};
	HTMLTableRowElement.prototype.DeleteCell = function(index) { return this.$val.DeleteCell(index); };
	HTMLTableSectionElement.ptr.prototype.Rows = function() {
		var $ptr, _i, _ref, e, i, out, row, rows;
		e = this;
		rows = nodeListToElements(e.BasicHTMLElement.BasicElement.BasicNode.Object.rows);
		out = $makeSlice(sliceType$15, rows.$length);
		_ref = rows;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			i = _i;
			row = ((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]);
			((i < 0 || i >= out.$length) ? $throwRuntimeError("index out of range") : out.$array[out.$offset + i] = $assertType(row, ptrType$17));
			_i++;
		}
		return out;
	};
	HTMLTableSectionElement.prototype.Rows = function() { return this.$val.Rows(); };
	HTMLTableSectionElement.ptr.prototype.DeleteRow = function(index) {
		var $ptr, e, index;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.deleteRow(index);
	};
	HTMLTableSectionElement.prototype.DeleteRow = function(index) { return this.$val.DeleteRow(index); };
	HTMLTableSectionElement.ptr.prototype.InsertRow = function(index) {
		var $ptr, e, index;
		e = this;
		return $assertType(wrapHTMLElement(e.BasicHTMLElement.BasicElement.BasicNode.Object.insertRow(index)), ptrType$17);
	};
	HTMLTableSectionElement.prototype.InsertRow = function(index) { return this.$val.InsertRow(index); };
	HTMLTextAreaElement.ptr.prototype.Form = function() {
		var $ptr, e;
		e = this;
		return getForm(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLTextAreaElement.prototype.Form = function() { return this.$val.Form(); };
	HTMLTextAreaElement.ptr.prototype.Labels = function() {
		var $ptr, e;
		e = this;
		return getLabels(e.BasicHTMLElement.BasicElement.BasicNode.Object);
	};
	HTMLTextAreaElement.prototype.Labels = function() { return this.$val.Labels(); };
	HTMLTextAreaElement.ptr.prototype.Validity = function() {
		var $ptr, e;
		e = this;
		return new ValidityState.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.validity, false, false, false, false, false, false, false, false, false);
	};
	HTMLTextAreaElement.prototype.Validity = function() { return this.$val.Validity(); };
	HTMLTextAreaElement.ptr.prototype.CheckValidity = function() {
		var $ptr, e;
		e = this;
		return !!(e.BasicHTMLElement.BasicElement.BasicNode.Object.checkValidity());
	};
	HTMLTextAreaElement.prototype.CheckValidity = function() { return this.$val.CheckValidity(); };
	HTMLTextAreaElement.ptr.prototype.SetCustomValidity = function(s) {
		var $ptr, e, s;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setCustomValidity($externalize(s, $String));
	};
	HTMLTextAreaElement.prototype.SetCustomValidity = function(s) { return this.$val.SetCustomValidity(s); };
	HTMLTextAreaElement.ptr.prototype.Select = function() {
		var $ptr, e;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.select();
	};
	HTMLTextAreaElement.prototype.Select = function() { return this.$val.Select(); };
	HTMLTextAreaElement.ptr.prototype.SetSelectionRange = function(start, end, direction) {
		var $ptr, direction, e, end, start;
		e = this;
		e.BasicHTMLElement.BasicElement.BasicNode.Object.setSelectionRange(start, end, $externalize(direction, $String));
	};
	HTMLTextAreaElement.prototype.SetSelectionRange = function(start, end, direction) { return this.$val.SetSelectionRange(start, end, direction); };
	HTMLTrackElement.ptr.prototype.Track = function() {
		var $ptr, e;
		e = this;
		return new TextTrack.ptr(e.BasicHTMLElement.BasicElement.BasicNode.Object.track);
	};
	HTMLTrackElement.prototype.Track = function() { return this.$val.Track(); };
	HTMLBaseElement.ptr.prototype.Href = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicHTMLElement.BasicElement.BasicNode.Object.href, $String);
	};
	HTMLBaseElement.prototype.Href = function() { return this.$val.Href(); };
	HTMLBaseElement.ptr.prototype.Target = function() {
		var $ptr, e;
		e = this;
		return $internalize(e.BasicHTMLElement.BasicElement.BasicNode.Object.target, $String);
	};
	HTMLBaseElement.prototype.Target = function() { return this.$val.Target(); };
	CSSStyleDeclaration.ptr.prototype.ToMap = function() {
		var $ptr, N, _key, css, i, m, name, value;
		css = this;
		m = {};
		N = $parseInt(css.Object.length) >> 0;
		i = 0;
		while (true) {
			if (!(i < N)) { break; }
			name = $internalize(css.Object.item(i), $String);
			value = $internalize(css.Object.getPropertyValue($externalize(name, $String)), $String);
			_key = name; (m || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: value };
			i = i + (1) >> 0;
		}
		return m;
	};
	CSSStyleDeclaration.prototype.ToMap = function() { return this.$val.ToMap(); };
	CSSStyleDeclaration.ptr.prototype.RemoveProperty = function(name) {
		var $ptr, css, name;
		css = this;
		css.Object.removeProperty($externalize(name, $String));
	};
	CSSStyleDeclaration.prototype.RemoveProperty = function(name) { return this.$val.RemoveProperty(name); };
	CSSStyleDeclaration.ptr.prototype.GetPropertyValue = function(name) {
		var $ptr, css, name;
		css = this;
		return toString(css.Object.getPropertyValue($externalize(name, $String)));
	};
	CSSStyleDeclaration.prototype.GetPropertyValue = function(name) { return this.$val.GetPropertyValue(name); };
	CSSStyleDeclaration.ptr.prototype.GetPropertyPriority = function(name) {
		var $ptr, css, name;
		css = this;
		return toString(css.Object.getPropertyPriority($externalize(name, $String)));
	};
	CSSStyleDeclaration.prototype.GetPropertyPriority = function(name) { return this.$val.GetPropertyPriority(name); };
	CSSStyleDeclaration.ptr.prototype.SetProperty = function(name, value, priority) {
		var $ptr, css, name, priority, value;
		css = this;
		css.Object.setProperty($externalize(name, $String), $externalize(value, $String), $externalize(priority, $String));
	};
	CSSStyleDeclaration.prototype.SetProperty = function(name, value, priority) { return this.$val.SetProperty(name, value, priority); };
	CSSStyleDeclaration.ptr.prototype.Index = function(idx) {
		var $ptr, css, idx;
		css = this;
		return $internalize(css.Object.index(idx), $String);
	};
	CSSStyleDeclaration.prototype.Index = function(idx) { return this.$val.Index(idx); };
	CSSStyleDeclaration.ptr.prototype.Length = function() {
		var $ptr, css;
		css = this;
		return $parseInt(css.Object.length) >> 0;
	};
	CSSStyleDeclaration.prototype.Length = function() { return this.$val.Length(); };
	WrapEvent = function(o) {
		var $ptr, o;
		return wrapEvent(o);
	};
	$pkg.WrapEvent = WrapEvent;
	wrapEvent = function(o) {
		var $ptr, _1, c, ev, o;
		if (o === null || o === undefined) {
			return $ifaceNil;
		}
		ev = new BasicEvent.ptr(o);
		c = o.constructor;
		_1 = c;
		if (_1 === ($global.AnimationEvent)) {
			return new AnimationEvent.ptr(ev);
		} else if (_1 === ($global.AudioProcessingEvent)) {
			return new AudioProcessingEvent.ptr(ev);
		} else if (_1 === ($global.BeforeInputEvent)) {
			return new BeforeInputEvent.ptr(ev);
		} else if (_1 === ($global.BeforeUnloadEvent)) {
			return new BeforeUnloadEvent.ptr(ev);
		} else if (_1 === ($global.BlobEvent)) {
			return new BlobEvent.ptr(ev);
		} else if (_1 === ($global.ClipboardEvent)) {
			return new ClipboardEvent.ptr(ev);
		} else if (_1 === ($global.CloseEvent)) {
			return new CloseEvent.ptr(ev, 0, "", false);
		} else if (_1 === ($global.CompositionEvent)) {
			return new CompositionEvent.ptr(ev);
		} else if (_1 === ($global.CSSFontFaceLoadEvent)) {
			return new CSSFontFaceLoadEvent.ptr(ev);
		} else if (_1 === ($global.CustomEvent)) {
			return new CustomEvent.ptr(ev);
		} else if (_1 === ($global.DeviceLightEvent)) {
			return new DeviceLightEvent.ptr(ev);
		} else if (_1 === ($global.DeviceMotionEvent)) {
			return new DeviceMotionEvent.ptr(ev);
		} else if (_1 === ($global.DeviceOrientationEvent)) {
			return new DeviceOrientationEvent.ptr(ev);
		} else if (_1 === ($global.DeviceProximityEvent)) {
			return new DeviceProximityEvent.ptr(ev);
		} else if (_1 === ($global.DOMTransactionEvent)) {
			return new DOMTransactionEvent.ptr(ev);
		} else if (_1 === ($global.DragEvent)) {
			return new DragEvent.ptr(ev);
		} else if (_1 === ($global.EditingBeforeInputEvent)) {
			return new EditingBeforeInputEvent.ptr(ev);
		} else if (_1 === ($global.ErrorEvent)) {
			return new ErrorEvent.ptr(ev);
		} else if (_1 === ($global.FocusEvent)) {
			return new FocusEvent.ptr(ev);
		} else if (_1 === ($global.GamepadEvent)) {
			return new GamepadEvent.ptr(ev);
		} else if (_1 === ($global.HashChangeEvent)) {
			return new HashChangeEvent.ptr(ev);
		} else if (_1 === ($global.IDBVersionChangeEvent)) {
			return new IDBVersionChangeEvent.ptr(ev);
		} else if (_1 === ($global.KeyboardEvent)) {
			return new KeyboardEvent.ptr(ev, false, 0, false, "", "", 0, "", 0, 0, false, false, false);
		} else if (_1 === ($global.MediaStreamEvent)) {
			return new MediaStreamEvent.ptr(ev);
		} else if (_1 === ($global.MessageEvent)) {
			return new MessageEvent.ptr(ev, null);
		} else if (_1 === ($global.MouseEvent)) {
			return new MouseEvent.ptr(new UIEvent.ptr(ev), false, 0, 0, 0, false, false, 0, 0, 0, 0, false);
		} else if (_1 === ($global.MutationEvent)) {
			return new MutationEvent.ptr(ev);
		} else if (_1 === ($global.OfflineAudioCompletionEvent)) {
			return new OfflineAudioCompletionEvent.ptr(ev);
		} else if (_1 === ($global.PageTransitionEvent)) {
			return new PageTransitionEvent.ptr(ev);
		} else if (_1 === ($global.PointerEvent)) {
			return new PointerEvent.ptr(ev);
		} else if (_1 === ($global.PopStateEvent)) {
			return new PopStateEvent.ptr(ev);
		} else if (_1 === ($global.ProgressEvent)) {
			return new ProgressEvent.ptr(ev);
		} else if (_1 === ($global.RelatedEvent)) {
			return new RelatedEvent.ptr(ev);
		} else if (_1 === ($global.RTCPeerConnectionIceEvent)) {
			return new RTCPeerConnectionIceEvent.ptr(ev);
		} else if (_1 === ($global.SensorEvent)) {
			return new SensorEvent.ptr(ev);
		} else if (_1 === ($global.StorageEvent)) {
			return new StorageEvent.ptr(ev);
		} else if (_1 === ($global.SVGEvent)) {
			return new SVGEvent.ptr(ev);
		} else if (_1 === ($global.SVGZoomEvent)) {
			return new SVGZoomEvent.ptr(ev);
		} else if (_1 === ($global.TimeEvent)) {
			return new TimeEvent.ptr(ev);
		} else if (_1 === ($global.TouchEvent)) {
			return new TouchEvent.ptr(ev);
		} else if (_1 === ($global.TrackEvent)) {
			return new TrackEvent.ptr(ev);
		} else if (_1 === ($global.TransitionEvent)) {
			return new TransitionEvent.ptr(ev);
		} else if (_1 === ($global.UIEvent)) {
			return new UIEvent.ptr(ev);
		} else if (_1 === ($global.UserProximityEvent)) {
			return new UserProximityEvent.ptr(ev);
		} else if (_1 === ($global.WheelEvent)) {
			return new WheelEvent.ptr(ev, 0, 0, 0, 0);
		} else {
			return ev;
		}
	};
	BasicEvent.ptr.prototype.Bubbles = function() {
		var $ptr, ev;
		ev = this;
		return !!(ev.Object.bubbles);
	};
	BasicEvent.prototype.Bubbles = function() { return this.$val.Bubbles(); };
	BasicEvent.ptr.prototype.Cancelable = function() {
		var $ptr, ev;
		ev = this;
		return !!(ev.Object.cancelable);
	};
	BasicEvent.prototype.Cancelable = function() { return this.$val.Cancelable(); };
	BasicEvent.ptr.prototype.CurrentTarget = function() {
		var $ptr, ev;
		ev = this;
		return wrapElement(ev.Object.currentTarget);
	};
	BasicEvent.prototype.CurrentTarget = function() { return this.$val.CurrentTarget(); };
	BasicEvent.ptr.prototype.DefaultPrevented = function() {
		var $ptr, ev;
		ev = this;
		return !!(ev.Object.defaultPrevented);
	};
	BasicEvent.prototype.DefaultPrevented = function() { return this.$val.DefaultPrevented(); };
	BasicEvent.ptr.prototype.EventPhase = function() {
		var $ptr, ev;
		ev = this;
		return $parseInt(ev.Object.eventPhase) >> 0;
	};
	BasicEvent.prototype.EventPhase = function() { return this.$val.EventPhase(); };
	BasicEvent.ptr.prototype.Target = function() {
		var $ptr, ev;
		ev = this;
		return wrapElement(ev.Object.target);
	};
	BasicEvent.prototype.Target = function() { return this.$val.Target(); };
	BasicEvent.ptr.prototype.Timestamp = function() {
		var $ptr, _q, _r, ev, ms, ns, s;
		ev = this;
		ms = $parseInt(ev.Object.timeStamp) >> 0;
		s = (_q = ms / 1000, (_q === _q && _q !== 1/0 && _q !== -1/0) ? _q >> 0 : $throwRuntimeError("integer divide by zero"));
		ns = ($imul((_r = ms % 1000, _r === _r ? _r : $throwRuntimeError("integer divide by zero")), 1000000));
		return time.Unix(new $Int64(0, s), new $Int64(0, ns));
	};
	BasicEvent.prototype.Timestamp = function() { return this.$val.Timestamp(); };
	BasicEvent.ptr.prototype.Type = function() {
		var $ptr, ev;
		ev = this;
		return $internalize(ev.Object.type, $String);
	};
	BasicEvent.prototype.Type = function() { return this.$val.Type(); };
	BasicEvent.ptr.prototype.PreventDefault = function() {
		var $ptr, ev;
		ev = this;
		ev.Object.preventDefault();
	};
	BasicEvent.prototype.PreventDefault = function() { return this.$val.PreventDefault(); };
	BasicEvent.ptr.prototype.StopImmediatePropagation = function() {
		var $ptr, ev;
		ev = this;
		ev.Object.stopImmediatePropagation();
	};
	BasicEvent.prototype.StopImmediatePropagation = function() { return this.$val.StopImmediatePropagation(); };
	BasicEvent.ptr.prototype.StopPropagation = function() {
		var $ptr, ev;
		ev = this;
		ev.Object.stopPropagation();
	};
	BasicEvent.prototype.StopPropagation = function() { return this.$val.StopPropagation(); };
	BasicEvent.ptr.prototype.Underlying = function() {
		var $ptr, ev;
		ev = this;
		return ev.Object;
	};
	BasicEvent.prototype.Underlying = function() { return this.$val.Underlying(); };
	KeyboardEvent.ptr.prototype.ModifierState = function(mod) {
		var $ptr, ev, mod;
		ev = this;
		return !!(ev.BasicEvent.Object.getModifierState($externalize(mod, $String)));
	};
	KeyboardEvent.prototype.ModifierState = function(mod) { return this.$val.ModifierState(mod); };
	MouseEvent.ptr.prototype.RelatedTarget = function() {
		var $ptr, ev;
		ev = this;
		return wrapElement(ev.UIEvent.BasicEvent.Object.target);
	};
	MouseEvent.prototype.RelatedTarget = function() { return this.$val.RelatedTarget(); };
	MouseEvent.ptr.prototype.ModifierState = function(mod) {
		var $ptr, ev, mod;
		ev = this;
		return !!(ev.UIEvent.BasicEvent.Object.getModifierState($externalize(mod, $String)));
	};
	MouseEvent.prototype.ModifierState = function(mod) { return this.$val.ModifierState(mod); };
	ptrType$20.methods = [{prop: "Item", name: "Item", pkg: "", typ: $funcType([$Int], [$String], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Add", name: "Add", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Remove", name: "Remove", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Toggle", name: "Toggle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "String", name: "String", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Slice", name: "Slice", pkg: "", typ: $funcType([], [sliceType$7], false)}, {prop: "SetString", name: "SetString", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Set", name: "Set", pkg: "", typ: $funcType([sliceType$7], [], false)}];
	documentFragment.methods = [{prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}];
	document.methods = [{prop: "Async", name: "Async", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetAsync", name: "SetAsync", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "Doctype", name: "Doctype", pkg: "", typ: $funcType([], [DocumentType], false)}, {prop: "DocumentElement", name: "DocumentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DocumentURI", name: "DocumentURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Implementation", name: "Implementation", pkg: "", typ: $funcType([], [DOMImplementation], false)}, {prop: "LastStyleSheetSet", name: "LastStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "PreferredStyleSheetSet", name: "PreferredStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SelectedStyleSheetSet", name: "SelectedStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "StyleSheets", name: "StyleSheets", pkg: "", typ: $funcType([], [sliceType$16], false)}, {prop: "StyleSheetSets", name: "StyleSheetSets", pkg: "", typ: $funcType([], [sliceType$16], false)}, {prop: "AdoptNode", name: "AdoptNode", pkg: "", typ: $funcType([Node], [Node], false)}, {prop: "ImportNode", name: "ImportNode", pkg: "", typ: $funcType([Node, $Bool], [Node], false)}, {prop: "CreateDocumentFragment", name: "CreateDocumentFragment", pkg: "", typ: $funcType([], [DocumentFragment], false)}, {prop: "CreateElement", name: "CreateElement", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "CreateElementNS", name: "CreateElementNS", pkg: "", typ: $funcType([$String, $String], [Element], false)}, {prop: "CreateTextNode", name: "CreateTextNode", pkg: "", typ: $funcType([$String], [ptrType$12], false)}, {prop: "ElementFromPoint", name: "ElementFromPoint", pkg: "", typ: $funcType([$Int, $Int], [Element], false)}, {prop: "EnableStyleSheetsForSet", name: "EnableStyleSheetsForSet", pkg: "", typ: $funcType([$String], [], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}];
	ptrType$24.methods = [{prop: "ActiveElement", name: "ActiveElement", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "Body", name: "Body", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "Cookie", name: "Cookie", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetCookie", name: "SetCookie", pkg: "", typ: $funcType([$String], [], false)}, {prop: "DefaultView", name: "DefaultView", pkg: "", typ: $funcType([], [Window], false)}, {prop: "DesignMode", name: "DesignMode", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetDesignMode", name: "SetDesignMode", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "Domain", name: "Domain", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetDomain", name: "SetDomain", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Forms", name: "Forms", pkg: "", typ: $funcType([], [sliceType$8], false)}, {prop: "Head", name: "Head", pkg: "", typ: $funcType([], [ptrType$8], false)}, {prop: "Images", name: "Images", pkg: "", typ: $funcType([], [sliceType$9], false)}, {prop: "LastModified", name: "LastModified", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Links", name: "Links", pkg: "", typ: $funcType([], [sliceType$4], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$21], false)}, {prop: "Plugins", name: "Plugins", pkg: "", typ: $funcType([], [sliceType$10], false)}, {prop: "ReadyState", name: "ReadyState", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Referrer", name: "Referrer", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Scripts", name: "Scripts", pkg: "", typ: $funcType([], [sliceType$11], false)}, {prop: "Title", name: "Title", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTitle", name: "SetTitle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "URL", name: "URL", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$28.methods = [{prop: "Console", name: "Console", pkg: "", typ: $funcType([], [ptrType$26], false)}, {prop: "Document", name: "Document", pkg: "", typ: $funcType([], [Document], false)}, {prop: "FrameElement", name: "FrameElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$21], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetName", name: "SetName", pkg: "", typ: $funcType([$String], [], false)}, {prop: "InnerHeight", name: "InnerHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "InnerWidth", name: "InnerWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Opener", name: "Opener", pkg: "", typ: $funcType([], [Window], false)}, {prop: "OuterHeight", name: "OuterHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OuterWidth", name: "OuterWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollX", name: "ScrollX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollY", name: "ScrollY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Parent", name: "Parent", pkg: "", typ: $funcType([], [Window], false)}, {prop: "ScreenX", name: "ScreenX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScreenY", name: "ScreenY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollMaxX", name: "ScrollMaxX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollMaxY", name: "ScrollMaxY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Top", name: "Top", pkg: "", typ: $funcType([], [Window], false)}, {prop: "History", name: "History", pkg: "", typ: $funcType([], [History], false)}, {prop: "Navigator", name: "Navigator", pkg: "", typ: $funcType([], [Navigator], false)}, {prop: "Screen", name: "Screen", pkg: "", typ: $funcType([], [ptrType$27], false)}, {prop: "Alert", name: "Alert", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Back", name: "Back", pkg: "", typ: $funcType([], [], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "ClearInterval", name: "ClearInterval", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ClearTimeout", name: "ClearTimeout", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "Confirm", name: "Confirm", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}, {prop: "Forward", name: "Forward", pkg: "", typ: $funcType([], [], false)}, {prop: "GetComputedStyle", name: "GetComputedStyle", pkg: "", typ: $funcType([Element, $String], [ptrType$25], false)}, {prop: "GetSelection", name: "GetSelection", pkg: "", typ: $funcType([], [Selection], false)}, {prop: "Home", name: "Home", pkg: "", typ: $funcType([], [], false)}, {prop: "MoveBy", name: "MoveBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "MoveTo", name: "MoveTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Open", name: "Open", pkg: "", typ: $funcType([$String, $String, $String], [Window], false)}, {prop: "OpenDialog", name: "OpenDialog", pkg: "", typ: $funcType([$String, $String, $String, sliceType], [Window], false)}, {prop: "PostMessage", name: "PostMessage", pkg: "", typ: $funcType([$String, $String, sliceType], [], false)}, {prop: "Print", name: "Print", pkg: "", typ: $funcType([], [], false)}, {prop: "Prompt", name: "Prompt", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "ResizeBy", name: "ResizeBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ResizeTo", name: "ResizeTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Scroll", name: "Scroll", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollBy", name: "ScrollBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollByLines", name: "ScrollByLines", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ScrollTo", name: "ScrollTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "SetCursor", name: "SetCursor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInterval", name: "SetInterval", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "SetTimeout", name: "SetTimeout", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [], false)}, {prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "RequestAnimationFrame", name: "RequestAnimationFrame", pkg: "", typ: $funcType([funcType$3], [$Int], false)}, {prop: "CancelAnimationFrame", name: "CancelAnimationFrame", pkg: "", typ: $funcType([$Int], [], false)}];
	ptrType$29.methods = [{prop: "Error", name: "Error", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$22.methods = [{prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}];
	ptrType$1.methods = [{prop: "AccessKey", name: "AccessKey", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Dataset", name: "Dataset", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "SetAccessKey", name: "SetAccessKey", pkg: "", typ: $funcType([$String], [], false)}, {prop: "AccessKeyLabel", name: "AccessKeyLabel", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAccessKeyLabel", name: "SetAccessKeyLabel", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ContentEditable", name: "ContentEditable", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetContentEditable", name: "SetContentEditable", pkg: "", typ: $funcType([$String], [], false)}, {prop: "IsContentEditable", name: "IsContentEditable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Dir", name: "Dir", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetDir", name: "SetDir", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Draggable", name: "Draggable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetDraggable", name: "SetDraggable", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "Lang", name: "Lang", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetLang", name: "SetLang", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OffsetHeight", name: "OffsetHeight", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetLeft", name: "OffsetLeft", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetParent", name: "OffsetParent", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "OffsetTop", name: "OffsetTop", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetWidth", name: "OffsetWidth", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "Style", name: "Style", pkg: "", typ: $funcType([], [ptrType$25], false)}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "SetTabIndex", name: "SetTabIndex", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Title", name: "Title", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetTitle", name: "SetTitle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "Click", name: "Click", pkg: "", typ: $funcType([], [], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}];
	ptrType$31.methods = [{prop: "Attributes", name: "Attributes", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "GetBoundingClientRect", name: "GetBoundingClientRect", pkg: "", typ: $funcType([], [ClientRect], false)}, {prop: "PreviousElementSibling", name: "PreviousElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "NextElementSibling", name: "NextElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Class", name: "Class", pkg: "", typ: $funcType([], [ptrType$20], false)}, {prop: "SetClass", name: "SetClass", pkg: "", typ: $funcType([$String], [], false)}, {prop: "ID", name: "ID", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetID", name: "SetID", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TagName", name: "TagName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "GetAttribute", name: "GetAttribute", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetAttributeNS", name: "GetAttributeNS", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasAttribute", name: "HasAttribute", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "HasAttributeNS", name: "HasAttributeNS", pkg: "", typ: $funcType([$String, $String], [$Bool], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveAttribute", name: "RemoveAttribute", pkg: "", typ: $funcType([$String], [], false)}, {prop: "RemoveAttributeNS", name: "RemoveAttributeNS", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttribute", name: "SetAttribute", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttributeNS", name: "SetAttributeNS", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "InnerHTML", name: "InnerHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetInnerHTML", name: "SetInnerHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "OuterHTML", name: "OuterHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetOuterHTML", name: "SetOuterHTML", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$32.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$20], false)}];
	ptrType$33.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$20], false)}];
	ptrType$15.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$20], false)}];
	ptrType$34.methods = [{prop: "Href", name: "Href", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Target", name: "Target", pkg: "", typ: $funcType([], [$String], false)}];
	ptrType$36.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$38.methods = [{prop: "GetContext2d", name: "GetContext2d", pkg: "", typ: $funcType([], [ptrType$37], false)}, {prop: "GetContext", name: "GetContext", pkg: "", typ: $funcType([$String], [ptrType], false)}];
	ptrType$37.methods = [{prop: "CreateLinearGradient", name: "CreateLinearGradient", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int], [], false)}, {prop: "Rect", name: "Rect", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int], [], false)}, {prop: "FillRect", name: "FillRect", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int], [], false)}, {prop: "StrokeRect", name: "StrokeRect", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int], [], false)}, {prop: "ClearRect", name: "ClearRect", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int], [], false)}, {prop: "Fill", name: "Fill", pkg: "", typ: $funcType([], [], false)}, {prop: "Stroke", name: "Stroke", pkg: "", typ: $funcType([], [], false)}, {prop: "BeginPath", name: "BeginPath", pkg: "", typ: $funcType([], [], false)}, {prop: "MoveTo", name: "MoveTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ClosePath", name: "ClosePath", pkg: "", typ: $funcType([], [], false)}, {prop: "LineTo", name: "LineTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Clip", name: "Clip", pkg: "", typ: $funcType([], [], false)}, {prop: "QuadraticCurveTo", name: "QuadraticCurveTo", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int], [], false)}, {prop: "BezierCurveTo", name: "BezierCurveTo", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int, $Int, $Int], [], false)}, {prop: "Arc", name: "Arc", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int, $Int, $Bool], [], false)}, {prop: "ArcTo", name: "ArcTo", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int, $Int], [], false)}, {prop: "IsPointInPath", name: "IsPointInPath", pkg: "", typ: $funcType([$Int, $Int], [$Bool], false)}, {prop: "Scale", name: "Scale", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Rotate", name: "Rotate", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Translate", name: "Translate", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Transform", name: "Transform", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int, $Int, $Int], [], false)}, {prop: "SetTransform", name: "SetTransform", pkg: "", typ: $funcType([$Int, $Int, $Int, $Int, $Int, $Int], [], false)}, {prop: "FillText", name: "FillText", pkg: "", typ: $funcType([$String, $Int, $Int, $Int], [], false)}, {prop: "StrokeText", name: "StrokeText", pkg: "", typ: $funcType([$String, $Int, $Int, $Int], [], false)}];
	ptrType$14.methods = [{prop: "Options", name: "Options", pkg: "", typ: $funcType([], [sliceType$6], false)}];
	ptrType$39.methods = [{prop: "Elements", name: "Elements", pkg: "", typ: $funcType([], [sliceType$4], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$5.methods = [{prop: "Elements", name: "Elements", pkg: "", typ: $funcType([], [sliceType$4], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Submit", name: "Submit", pkg: "", typ: $funcType([], [], false)}, {prop: "Reset", name: "Reset", pkg: "", typ: $funcType([], [], false)}, {prop: "Item", name: "Item", pkg: "", typ: $funcType([$Int], [HTMLElement], false)}, {prop: "NamedItem", name: "NamedItem", pkg: "", typ: $funcType([$String], [HTMLElement], false)}];
	ptrType$40.methods = [{prop: "ContentDocument", name: "ContentDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ContentWindow", name: "ContentWindow", pkg: "", typ: $funcType([], [Window], false)}];
	ptrType$41.methods = [{prop: "Files", name: "Files", pkg: "", typ: $funcType([], [sliceType$12], false)}, {prop: "List", name: "List", pkg: "", typ: $funcType([], [ptrType$14], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Select", name: "Select", pkg: "", typ: $funcType([], [], false)}, {prop: "SetSelectionRange", name: "SetSelectionRange", pkg: "", typ: $funcType([$Int, $Int, $String], [], false)}, {prop: "StepDown", name: "StepDown", pkg: "", typ: $funcType([$Int], [$error], false)}, {prop: "StepUp", name: "StepUp", pkg: "", typ: $funcType([$Int], [$error], false)}];
	ptrType$42.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$6.methods = [{prop: "Control", name: "Control", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}];
	ptrType$43.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}];
	ptrType$44.methods = [{prop: "Rel", name: "Rel", pkg: "", typ: $funcType([], [ptrType$20], false)}, {prop: "Sizes", name: "Sizes", pkg: "", typ: $funcType([], [ptrType$20], false)}, {prop: "Sheet", name: "Sheet", pkg: "", typ: $funcType([], [StyleSheet], false)}];
	ptrType$45.methods = [{prop: "Areas", name: "Areas", pkg: "", typ: $funcType([], [sliceType$13], false)}, {prop: "Images", name: "Images", pkg: "", typ: $funcType([], [sliceType$4], false)}];
	ptrType$3.methods = [{prop: "Play", name: "Play", pkg: "", typ: $funcType([], [], false)}, {prop: "Pause", name: "Pause", pkg: "", typ: $funcType([], [], false)}];
	HTMLMeterElement.methods = [{prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}];
	ptrType$46.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "ContentDocument", name: "ContentDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ContentWindow", name: "ContentWindow", pkg: "", typ: $funcType([], [Window], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$7.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}];
	ptrType$47.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "For", name: "For", pkg: "", typ: $funcType([], [ptrType$20], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	HTMLProgressElement.methods = [{prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}];
	ptrType$48.methods = [{prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Options", name: "Options", pkg: "", typ: $funcType([], [sliceType$6], false)}, {prop: "SelectedOptions", name: "SelectedOptions", pkg: "", typ: $funcType([], [sliceType$6], false)}, {prop: "Item", name: "Item", pkg: "", typ: $funcType([$Int], [ptrType$7], false)}, {prop: "NamedItem", name: "NamedItem", pkg: "", typ: $funcType([$String], [ptrType$7], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}];
	ptrType$17.methods = [{prop: "Cells", name: "Cells", pkg: "", typ: $funcType([], [sliceType$14], false)}, {prop: "InsertCell", name: "InsertCell", pkg: "", typ: $funcType([$Int], [ptrType$16], false)}, {prop: "DeleteCell", name: "DeleteCell", pkg: "", typ: $funcType([$Int], [], false)}];
	ptrType$49.methods = [{prop: "Rows", name: "Rows", pkg: "", typ: $funcType([], [sliceType$15], false)}, {prop: "DeleteRow", name: "DeleteRow", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "InsertRow", name: "InsertRow", pkg: "", typ: $funcType([$Int], [ptrType$17], false)}];
	ptrType$50.methods = [{prop: "Form", name: "Form", pkg: "", typ: $funcType([], [ptrType$5], false)}, {prop: "Labels", name: "Labels", pkg: "", typ: $funcType([], [sliceType$5], false)}, {prop: "Validity", name: "Validity", pkg: "", typ: $funcType([], [ptrType$35], false)}, {prop: "CheckValidity", name: "CheckValidity", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "SetCustomValidity", name: "SetCustomValidity", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Select", name: "Select", pkg: "", typ: $funcType([], [], false)}, {prop: "SetSelectionRange", name: "SetSelectionRange", pkg: "", typ: $funcType([$Int, $Int, $String], [], false)}];
	ptrType$52.methods = [{prop: "Track", name: "Track", pkg: "", typ: $funcType([], [ptrType$51], false)}];
	ptrType$25.methods = [{prop: "ToMap", name: "ToMap", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "RemoveProperty", name: "RemoveProperty", pkg: "", typ: $funcType([$String], [], false)}, {prop: "GetPropertyValue", name: "GetPropertyValue", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetPropertyPriority", name: "GetPropertyPriority", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "SetProperty", name: "SetProperty", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "Index", name: "Index", pkg: "", typ: $funcType([$Int], [$String], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}];
	ptrType$18.methods = [{prop: "Bubbles", name: "Bubbles", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Cancelable", name: "Cancelable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CurrentTarget", name: "CurrentTarget", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DefaultPrevented", name: "DefaultPrevented", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "EventPhase", name: "EventPhase", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Target", name: "Target", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Timestamp", name: "Timestamp", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [$String], false)}, {prop: "PreventDefault", name: "PreventDefault", pkg: "", typ: $funcType([], [], false)}, {prop: "StopImmediatePropagation", name: "StopImmediatePropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "StopPropagation", name: "StopPropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}];
	ptrType$53.methods = [{prop: "ModifierState", name: "ModifierState", pkg: "", typ: $funcType([$String], [$Bool], false)}];
	ptrType$54.methods = [{prop: "RelatedTarget", name: "RelatedTarget", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ModifierState", name: "ModifierState", pkg: "", typ: $funcType([$String], [$Bool], false)}];
	TokenList.init([{prop: "dtl", name: "dtl", pkg: "honnef.co/go/js/dom", typ: ptrType, tag: ""}, {prop: "o", name: "o", pkg: "honnef.co/go/js/dom", typ: ptrType, tag: ""}, {prop: "sa", name: "sa", pkg: "honnef.co/go/js/dom", typ: $String, tag: ""}, {prop: "Length", name: "Length", pkg: "", typ: $Int, tag: "js:\"length\""}]);
	Document.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AdoptNode", name: "AdoptNode", pkg: "", typ: $funcType([Node], [Node], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "Async", name: "Async", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "CreateDocumentFragment", name: "CreateDocumentFragment", pkg: "", typ: $funcType([], [DocumentFragment], false)}, {prop: "CreateElement", name: "CreateElement", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "CreateElementNS", name: "CreateElementNS", pkg: "", typ: $funcType([$String, $String], [Element], false)}, {prop: "CreateTextNode", name: "CreateTextNode", pkg: "", typ: $funcType([$String], [ptrType$12], false)}, {prop: "Doctype", name: "Doctype", pkg: "", typ: $funcType([], [DocumentType], false)}, {prop: "DocumentElement", name: "DocumentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DocumentURI", name: "DocumentURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ElementFromPoint", name: "ElementFromPoint", pkg: "", typ: $funcType([$Int, $Int], [Element], false)}, {prop: "EnableStyleSheetsForSet", name: "EnableStyleSheetsForSet", pkg: "", typ: $funcType([$String], [], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Implementation", name: "Implementation", pkg: "", typ: $funcType([], [DOMImplementation], false)}, {prop: "ImportNode", name: "ImportNode", pkg: "", typ: $funcType([Node, $Bool], [Node], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LastStyleSheetSet", name: "LastStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreferredStyleSheetSet", name: "PreferredStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SelectedStyleSheetSet", name: "SelectedStyleSheetSet", pkg: "", typ: $funcType([], [$String], false)}, {prop: "SetAsync", name: "SetAsync", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "StyleSheetSets", name: "StyleSheetSets", pkg: "", typ: $funcType([], [sliceType$16], false)}, {prop: "StyleSheets", name: "StyleSheets", pkg: "", typ: $funcType([], [sliceType$16], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	DocumentFragment.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "GetElementByID", name: "GetElementByID", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	documentFragment.init([{prop: "BasicNode", name: "", pkg: "", typ: ptrType$22, tag: ""}]);
	document.init([{prop: "BasicNode", name: "", pkg: "", typ: ptrType$22, tag: ""}]);
	htmlDocument.init([{prop: "document", name: "", pkg: "honnef.co/go/js/dom", typ: ptrType$23, tag: ""}]);
	URLUtils.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "Href", name: "Href", pkg: "", typ: $String, tag: "js:\"href\""}, {prop: "Protocol", name: "Protocol", pkg: "", typ: $String, tag: "js:\"protocol\""}, {prop: "Host", name: "Host", pkg: "", typ: $String, tag: "js:\"host\""}, {prop: "Hostname", name: "Hostname", pkg: "", typ: $String, tag: "js:\"hostname\""}, {prop: "Port", name: "Port", pkg: "", typ: $String, tag: "js:\"port\""}, {prop: "Pathname", name: "Pathname", pkg: "", typ: $String, tag: "js:\"pathname\""}, {prop: "Search", name: "Search", pkg: "", typ: $String, tag: "js:\"search\""}, {prop: "Hash", name: "Hash", pkg: "", typ: $String, tag: "js:\"hash\""}, {prop: "Username", name: "Username", pkg: "", typ: $String, tag: "js:\"username\""}, {prop: "Password", name: "Password", pkg: "", typ: $String, tag: "js:\"password\""}, {prop: "Origin", name: "Origin", pkg: "", typ: $String, tag: "js:\"origin\""}]);
	Location.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "URLUtils", name: "", pkg: "", typ: ptrType$2, tag: ""}]);
	HTMLElement.init([{prop: "AccessKey", name: "AccessKey", pkg: "", typ: $funcType([], [$String], false)}, {prop: "AccessKeyLabel", name: "AccessKeyLabel", pkg: "", typ: $funcType([], [$String], false)}, {prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "Attributes", name: "Attributes", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "Class", name: "Class", pkg: "", typ: $funcType([], [ptrType$20], false)}, {prop: "Click", name: "Click", pkg: "", typ: $funcType([], [], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "ContentEditable", name: "ContentEditable", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Dataset", name: "Dataset", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "Dir", name: "Dir", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Draggable", name: "Draggable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}, {prop: "GetAttribute", name: "GetAttribute", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetAttributeNS", name: "GetAttributeNS", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "GetBoundingClientRect", name: "GetBoundingClientRect", pkg: "", typ: $funcType([], [ClientRect], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasAttribute", name: "HasAttribute", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "HasAttributeNS", name: "HasAttributeNS", pkg: "", typ: $funcType([$String, $String], [$Bool], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ID", name: "ID", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InnerHTML", name: "InnerHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsContentEditable", name: "IsContentEditable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "Lang", name: "Lang", pkg: "", typ: $funcType([], [$String], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextElementSibling", name: "NextElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OffsetHeight", name: "OffsetHeight", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetLeft", name: "OffsetLeft", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetParent", name: "OffsetParent", pkg: "", typ: $funcType([], [HTMLElement], false)}, {prop: "OffsetTop", name: "OffsetTop", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OffsetWidth", name: "OffsetWidth", pkg: "", typ: $funcType([], [$Float64], false)}, {prop: "OuterHTML", name: "OuterHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousElementSibling", name: "PreviousElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveAttribute", name: "RemoveAttribute", pkg: "", typ: $funcType([$String], [], false)}, {prop: "RemoveAttributeNS", name: "RemoveAttributeNS", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetAccessKey", name: "SetAccessKey", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetAccessKeyLabel", name: "SetAccessKeyLabel", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetAttribute", name: "SetAttribute", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttributeNS", name: "SetAttributeNS", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "SetContentEditable", name: "SetContentEditable", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetDir", name: "SetDir", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetDraggable", name: "SetDraggable", pkg: "", typ: $funcType([$Bool], [], false)}, {prop: "SetID", name: "SetID", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInnerHTML", name: "SetInnerHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetLang", name: "SetLang", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetOuterHTML", name: "SetOuterHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTitle", name: "SetTitle", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Style", name: "Style", pkg: "", typ: $funcType([], [ptrType$25], false)}, {prop: "TagName", name: "TagName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Title", name: "Title", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	Window.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "Alert", name: "Alert", pkg: "", typ: $funcType([$String], [], false)}, {prop: "Back", name: "Back", pkg: "", typ: $funcType([], [], false)}, {prop: "Blur", name: "Blur", pkg: "", typ: $funcType([], [], false)}, {prop: "CancelAnimationFrame", name: "CancelAnimationFrame", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ClearInterval", name: "ClearInterval", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ClearTimeout", name: "ClearTimeout", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Close", name: "Close", pkg: "", typ: $funcType([], [], false)}, {prop: "Confirm", name: "Confirm", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "Console", name: "Console", pkg: "", typ: $funcType([], [ptrType$26], false)}, {prop: "Document", name: "Document", pkg: "", typ: $funcType([], [Document], false)}, {prop: "Focus", name: "Focus", pkg: "", typ: $funcType([], [], false)}, {prop: "Forward", name: "Forward", pkg: "", typ: $funcType([], [], false)}, {prop: "FrameElement", name: "FrameElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "GetComputedStyle", name: "GetComputedStyle", pkg: "", typ: $funcType([Element, $String], [ptrType$25], false)}, {prop: "GetSelection", name: "GetSelection", pkg: "", typ: $funcType([], [Selection], false)}, {prop: "History", name: "History", pkg: "", typ: $funcType([], [History], false)}, {prop: "Home", name: "Home", pkg: "", typ: $funcType([], [], false)}, {prop: "InnerHeight", name: "InnerHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "InnerWidth", name: "InnerWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Location", name: "Location", pkg: "", typ: $funcType([], [ptrType$21], false)}, {prop: "MoveBy", name: "MoveBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "MoveTo", name: "MoveTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Name", name: "Name", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Navigator", name: "Navigator", pkg: "", typ: $funcType([], [Navigator], false)}, {prop: "Open", name: "Open", pkg: "", typ: $funcType([$String, $String, $String], [Window], false)}, {prop: "OpenDialog", name: "OpenDialog", pkg: "", typ: $funcType([$String, $String, $String, sliceType], [Window], false)}, {prop: "Opener", name: "Opener", pkg: "", typ: $funcType([], [Window], false)}, {prop: "OuterHeight", name: "OuterHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OuterWidth", name: "OuterWidth", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Parent", name: "Parent", pkg: "", typ: $funcType([], [Window], false)}, {prop: "PostMessage", name: "PostMessage", pkg: "", typ: $funcType([$String, $String, sliceType], [], false)}, {prop: "Print", name: "Print", pkg: "", typ: $funcType([], [], false)}, {prop: "Prompt", name: "Prompt", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "RequestAnimationFrame", name: "RequestAnimationFrame", pkg: "", typ: $funcType([funcType$3], [$Int], false)}, {prop: "ResizeBy", name: "ResizeBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ResizeTo", name: "ResizeTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "Screen", name: "Screen", pkg: "", typ: $funcType([], [ptrType$27], false)}, {prop: "ScreenX", name: "ScreenX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScreenY", name: "ScreenY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "Scroll", name: "Scroll", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollBy", name: "ScrollBy", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollByLines", name: "ScrollByLines", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "ScrollMaxX", name: "ScrollMaxX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollMaxY", name: "ScrollMaxY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollTo", name: "ScrollTo", pkg: "", typ: $funcType([$Int, $Int], [], false)}, {prop: "ScrollX", name: "ScrollX", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "ScrollY", name: "ScrollY", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "SetCursor", name: "SetCursor", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInterval", name: "SetInterval", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "SetName", name: "SetName", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTimeout", name: "SetTimeout", pkg: "", typ: $funcType([funcType, $Int], [$Int], false)}, {prop: "Stop", name: "Stop", pkg: "", typ: $funcType([], [], false)}, {prop: "Top", name: "Top", pkg: "", typ: $funcType([], [Window], false)}]);
	window.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	Selection.init([]);
	Screen.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "AvailTop", name: "AvailTop", pkg: "", typ: $Int, tag: "js:\"availTop\""}, {prop: "AvailLeft", name: "AvailLeft", pkg: "", typ: $Int, tag: "js:\"availLeft\""}, {prop: "AvailHeight", name: "AvailHeight", pkg: "", typ: $Int, tag: "js:\"availHeight\""}, {prop: "AvailWidth", name: "AvailWidth", pkg: "", typ: $Int, tag: "js:\"availWidth\""}, {prop: "ColorDepth", name: "ColorDepth", pkg: "", typ: $Int, tag: "js:\"colorDepth\""}, {prop: "Height", name: "Height", pkg: "", typ: $Int, tag: "js:\"height\""}, {prop: "Left", name: "Left", pkg: "", typ: $Int, tag: "js:\"left\""}, {prop: "PixelDepth", name: "PixelDepth", pkg: "", typ: $Int, tag: "js:\"pixelDepth\""}, {prop: "Top", name: "Top", pkg: "", typ: $Int, tag: "js:\"top\""}, {prop: "Width", name: "Width", pkg: "", typ: $Int, tag: "js:\"width\""}]);
	Navigator.init([{prop: "AppName", name: "AppName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "AppVersion", name: "AppVersion", pkg: "", typ: $funcType([], [$String], false)}, {prop: "CookieEnabled", name: "CookieEnabled", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "DoNotTrack", name: "DoNotTrack", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Geolocation", name: "Geolocation", pkg: "", typ: $funcType([], [Geolocation], false)}, {prop: "Language", name: "Language", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Online", name: "Online", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Platform", name: "Platform", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Product", name: "Product", pkg: "", typ: $funcType([], [$String], false)}, {prop: "RegisterProtocolHandler", name: "RegisterProtocolHandler", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "UserAgent", name: "UserAgent", pkg: "", typ: $funcType([], [$String], false)}]);
	Geolocation.init([{prop: "ClearWatch", name: "ClearWatch", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "CurrentPosition", name: "CurrentPosition", pkg: "", typ: $funcType([funcType$4, funcType$5, PositionOptions], [Position], false)}, {prop: "WatchPosition", name: "WatchPosition", pkg: "", typ: $funcType([funcType$4, funcType$5, PositionOptions], [$Int], false)}]);
	PositionError.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "Code", name: "Code", pkg: "", typ: $Int, tag: "js:\"code\""}]);
	PositionOptions.init([{prop: "EnableHighAccuracy", name: "EnableHighAccuracy", pkg: "", typ: $Bool, tag: ""}, {prop: "Timeout", name: "Timeout", pkg: "", typ: time.Duration, tag: ""}, {prop: "MaximumAge", name: "MaximumAge", pkg: "", typ: time.Duration, tag: ""}]);
	Position.init([{prop: "Coords", name: "Coords", pkg: "", typ: ptrType$30, tag: ""}, {prop: "Timestamp", name: "Timestamp", pkg: "", typ: time.Time, tag: ""}]);
	Coordinates.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "Latitude", name: "Latitude", pkg: "", typ: $Float64, tag: "js:\"latitude\""}, {prop: "Longitude", name: "Longitude", pkg: "", typ: $Float64, tag: "js:\"longitude\""}, {prop: "Altitude", name: "Altitude", pkg: "", typ: $Float64, tag: "js:\"altitude\""}, {prop: "Accuracy", name: "Accuracy", pkg: "", typ: $Float64, tag: "js:\"accuracy\""}, {prop: "AltitudeAccuracy", name: "AltitudeAccuracy", pkg: "", typ: $Float64, tag: "js:\"altitudeAccuracy\""}, {prop: "Heading", name: "Heading", pkg: "", typ: $Float64, tag: "js:\"heading\""}, {prop: "Speed", name: "Speed", pkg: "", typ: $Float64, tag: "js:\"speed\""}]);
	History.init([{prop: "Back", name: "Back", pkg: "", typ: $funcType([], [], false)}, {prop: "Forward", name: "Forward", pkg: "", typ: $funcType([], [], false)}, {prop: "Go", name: "Go", pkg: "", typ: $funcType([$Int], [], false)}, {prop: "Length", name: "Length", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "PushState", name: "PushState", pkg: "", typ: $funcType([$emptyInterface, $String, $String], [], false)}, {prop: "ReplaceState", name: "ReplaceState", pkg: "", typ: $funcType([$emptyInterface, $String, $String], [], false)}, {prop: "State", name: "State", pkg: "", typ: $funcType([], [$emptyInterface], false)}]);
	Console.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	DocumentType.init([]);
	DOMImplementation.init([]);
	StyleSheet.init([]);
	Node.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	BasicNode.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	Element.init([{prop: "AddEventListener", name: "AddEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$2], [funcType$1], false)}, {prop: "AppendChild", name: "AppendChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "Attributes", name: "Attributes", pkg: "", typ: $funcType([], [mapType], false)}, {prop: "BaseURI", name: "BaseURI", pkg: "", typ: $funcType([], [$String], false)}, {prop: "ChildNodes", name: "ChildNodes", pkg: "", typ: $funcType([], [sliceType$2], false)}, {prop: "Class", name: "Class", pkg: "", typ: $funcType([], [ptrType$20], false)}, {prop: "CloneNode", name: "CloneNode", pkg: "", typ: $funcType([$Bool], [Node], false)}, {prop: "CompareDocumentPosition", name: "CompareDocumentPosition", pkg: "", typ: $funcType([Node], [$Int], false)}, {prop: "Contains", name: "Contains", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "FirstChild", name: "FirstChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "GetAttribute", name: "GetAttribute", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "GetAttributeNS", name: "GetAttributeNS", pkg: "", typ: $funcType([$String, $String], [$String], false)}, {prop: "GetBoundingClientRect", name: "GetBoundingClientRect", pkg: "", typ: $funcType([], [ClientRect], false)}, {prop: "GetElementsByClassName", name: "GetElementsByClassName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagName", name: "GetElementsByTagName", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "GetElementsByTagNameNS", name: "GetElementsByTagNameNS", pkg: "", typ: $funcType([$String, $String], [sliceType$3], false)}, {prop: "HasAttribute", name: "HasAttribute", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "HasAttributeNS", name: "HasAttributeNS", pkg: "", typ: $funcType([$String, $String], [$Bool], false)}, {prop: "HasChildNodes", name: "HasChildNodes", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "ID", name: "ID", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InnerHTML", name: "InnerHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "InsertBefore", name: "InsertBefore", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "IsDefaultNamespace", name: "IsDefaultNamespace", pkg: "", typ: $funcType([$String], [$Bool], false)}, {prop: "IsEqualNode", name: "IsEqualNode", pkg: "", typ: $funcType([Node], [$Bool], false)}, {prop: "LastChild", name: "LastChild", pkg: "", typ: $funcType([], [Node], false)}, {prop: "LookupNamespaceURI", name: "LookupNamespaceURI", pkg: "", typ: $funcType([$String], [$String], false)}, {prop: "LookupPrefix", name: "LookupPrefix", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NextElementSibling", name: "NextElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "NextSibling", name: "NextSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "NodeName", name: "NodeName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "NodeType", name: "NodeType", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "NodeValue", name: "NodeValue", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Normalize", name: "Normalize", pkg: "", typ: $funcType([], [], false)}, {prop: "OuterHTML", name: "OuterHTML", pkg: "", typ: $funcType([], [$String], false)}, {prop: "OwnerDocument", name: "OwnerDocument", pkg: "", typ: $funcType([], [Document], false)}, {prop: "ParentElement", name: "ParentElement", pkg: "", typ: $funcType([], [Element], false)}, {prop: "ParentNode", name: "ParentNode", pkg: "", typ: $funcType([], [Node], false)}, {prop: "PreviousElementSibling", name: "PreviousElementSibling", pkg: "", typ: $funcType([], [Element], false)}, {prop: "PreviousSibling", name: "PreviousSibling", pkg: "", typ: $funcType([], [Node], false)}, {prop: "QuerySelector", name: "QuerySelector", pkg: "", typ: $funcType([$String], [Element], false)}, {prop: "QuerySelectorAll", name: "QuerySelectorAll", pkg: "", typ: $funcType([$String], [sliceType$3], false)}, {prop: "RemoveAttribute", name: "RemoveAttribute", pkg: "", typ: $funcType([$String], [], false)}, {prop: "RemoveAttributeNS", name: "RemoveAttributeNS", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "RemoveChild", name: "RemoveChild", pkg: "", typ: $funcType([Node], [], false)}, {prop: "RemoveEventListener", name: "RemoveEventListener", pkg: "", typ: $funcType([$String, $Bool, funcType$1], [], false)}, {prop: "ReplaceChild", name: "ReplaceChild", pkg: "", typ: $funcType([Node, Node], [], false)}, {prop: "SetAttribute", name: "SetAttribute", pkg: "", typ: $funcType([$String, $String], [], false)}, {prop: "SetAttributeNS", name: "SetAttributeNS", pkg: "", typ: $funcType([$String, $String, $String], [], false)}, {prop: "SetID", name: "SetID", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetInnerHTML", name: "SetInnerHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetNodeValue", name: "SetNodeValue", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetOuterHTML", name: "SetOuterHTML", pkg: "", typ: $funcType([$String], [], false)}, {prop: "SetTextContent", name: "SetTextContent", pkg: "", typ: $funcType([$String], [], false)}, {prop: "TagName", name: "TagName", pkg: "", typ: $funcType([], [$String], false)}, {prop: "TextContent", name: "TextContent", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	ClientRect.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "Height", name: "Height", pkg: "", typ: $Float64, tag: "js:\"height\""}, {prop: "Width", name: "Width", pkg: "", typ: $Float64, tag: "js:\"width\""}, {prop: "Left", name: "Left", pkg: "", typ: $Float64, tag: "js:\"left\""}, {prop: "Right", name: "Right", pkg: "", typ: $Float64, tag: "js:\"right\""}, {prop: "Top", name: "Top", pkg: "", typ: $Float64, tag: "js:\"top\""}, {prop: "Bottom", name: "Bottom", pkg: "", typ: $Float64, tag: "js:\"bottom\""}]);
	BasicHTMLElement.init([{prop: "BasicElement", name: "", pkg: "", typ: ptrType$31, tag: ""}]);
	BasicElement.init([{prop: "BasicNode", name: "", pkg: "", typ: ptrType$22, tag: ""}]);
	HTMLAnchorElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "URLUtils", name: "", pkg: "", typ: ptrType$2, tag: ""}, {prop: "HrefLang", name: "HrefLang", pkg: "", typ: $String, tag: "js:\"hreflang\""}, {prop: "Media", name: "Media", pkg: "", typ: $String, tag: "js:\"media\""}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Target", name: "Target", pkg: "", typ: $String, tag: "js:\"target\""}, {prop: "Text", name: "Text", pkg: "", typ: $String, tag: "js:\"text\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}]);
	HTMLAppletElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Alt", name: "Alt", pkg: "", typ: $String, tag: "js:\"alt\""}, {prop: "Coords", name: "Coords", pkg: "", typ: $String, tag: "js:\"coords\""}, {prop: "HrefLang", name: "HrefLang", pkg: "", typ: $String, tag: "js:\"hreflang\""}, {prop: "Media", name: "Media", pkg: "", typ: $String, tag: "js:\"media\""}, {prop: "Search", name: "Search", pkg: "", typ: $String, tag: "js:\"search\""}, {prop: "Shape", name: "Shape", pkg: "", typ: $String, tag: "js:\"shape\""}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Target", name: "Target", pkg: "", typ: $String, tag: "js:\"target\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}]);
	HTMLAreaElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "URLUtils", name: "", pkg: "", typ: ptrType$2, tag: ""}, {prop: "Alt", name: "Alt", pkg: "", typ: $String, tag: "js:\"alt\""}, {prop: "Coords", name: "Coords", pkg: "", typ: $String, tag: "js:\"coords\""}, {prop: "HrefLang", name: "HrefLang", pkg: "", typ: $String, tag: "js:\"hreflang\""}, {prop: "Media", name: "Media", pkg: "", typ: $String, tag: "js:\"media\""}, {prop: "Search", name: "Search", pkg: "", typ: $String, tag: "js:\"search\""}, {prop: "Shape", name: "Shape", pkg: "", typ: $String, tag: "js:\"shape\""}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Target", name: "Target", pkg: "", typ: $String, tag: "js:\"target\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}]);
	HTMLAudioElement.init([{prop: "HTMLMediaElement", name: "", pkg: "", typ: ptrType$3, tag: ""}]);
	HTMLBRElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLBaseElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLBodyElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	ValidityState.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "CustomError", name: "CustomError", pkg: "", typ: $Bool, tag: "js:\"customError\""}, {prop: "PatternMismatch", name: "PatternMismatch", pkg: "", typ: $Bool, tag: "js:\"patternMismatch\""}, {prop: "RangeOverflow", name: "RangeOverflow", pkg: "", typ: $Bool, tag: "js:\"rangeOverflow\""}, {prop: "RangeUnderflow", name: "RangeUnderflow", pkg: "", typ: $Bool, tag: "js:\"rangeUnderflow\""}, {prop: "StepMismatch", name: "StepMismatch", pkg: "", typ: $Bool, tag: "js:\"stepMismatch\""}, {prop: "TooLong", name: "TooLong", pkg: "", typ: $Bool, tag: "js:\"tooLong\""}, {prop: "TypeMismatch", name: "TypeMismatch", pkg: "", typ: $Bool, tag: "js:\"typeMismatch\""}, {prop: "Valid", name: "Valid", pkg: "", typ: $Bool, tag: "js:\"valid\""}, {prop: "ValueMissing", name: "ValueMissing", pkg: "", typ: $Bool, tag: "js:\"valueMissing\""}]);
	HTMLButtonElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "AutoFocus", name: "AutoFocus", pkg: "", typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "FormAction", name: "FormAction", pkg: "", typ: $String, tag: "js:\"formAction\""}, {prop: "FormEncType", name: "FormEncType", pkg: "", typ: $String, tag: "js:\"formEncType\""}, {prop: "FormMethod", name: "FormMethod", pkg: "", typ: $String, tag: "js:\"formMethod\""}, {prop: "FormNoValidate", name: "FormNoValidate", pkg: "", typ: $Bool, tag: "js:\"formNoValidate\""}, {prop: "FormTarget", name: "FormTarget", pkg: "", typ: $String, tag: "js:\"formTarget\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLCanvasElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Height", name: "Height", pkg: "", typ: $Int, tag: "js:\"height\""}, {prop: "Width", name: "Width", pkg: "", typ: $Int, tag: "js:\"width\""}]);
	CanvasRenderingContext2D.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}, {prop: "FillStyle", name: "FillStyle", pkg: "", typ: $String, tag: "js:\"fillStyle\""}, {prop: "StrokeStyle", name: "StrokeStyle", pkg: "", typ: $String, tag: "js:\"strokeStyle\""}, {prop: "ShadowColor", name: "ShadowColor", pkg: "", typ: $String, tag: "js:\"shadowColor\""}, {prop: "ShadowBlur", name: "ShadowBlur", pkg: "", typ: $Int, tag: "js:\"shadowBlur\""}, {prop: "ShadowOffsetX", name: "ShadowOffsetX", pkg: "", typ: $Int, tag: "js:\"shadowOffsetX\""}, {prop: "ShadowOffsetY", name: "ShadowOffsetY", pkg: "", typ: $Int, tag: "js:\"shadowOffsetY\""}, {prop: "LineCap", name: "LineCap", pkg: "", typ: $String, tag: "js:\"lineCap\""}, {prop: "LineJoin", name: "LineJoin", pkg: "", typ: $String, tag: "js:\"lineJoin\""}, {prop: "LineWidth", name: "LineWidth", pkg: "", typ: $Int, tag: "js:\"lineWidth\""}, {prop: "MiterLimit", name: "MiterLimit", pkg: "", typ: $Int, tag: "js:\"miterLimit\""}, {prop: "Font", name: "Font", pkg: "", typ: $String, tag: "js:\"font\""}, {prop: "TextAlign", name: "TextAlign", pkg: "", typ: $String, tag: "js:\"textAlign\""}, {prop: "TextBaseline", name: "TextBaseline", pkg: "", typ: $String, tag: "js:\"textBaseline\""}, {prop: "GlobalAlpha", name: "GlobalAlpha", pkg: "", typ: $Float64, tag: "js:\"globalAlpha\""}, {prop: "GlobalCompositeOperation", name: "GlobalCompositeOperation", pkg: "", typ: $String, tag: "js:\"globalCompositeOperation\""}]);
	HTMLDListElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLDataElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}]);
	HTMLDataListElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLDirectoryElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLDivElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLEmbedElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Src", name: "Src", pkg: "", typ: $String, tag: "js:\"src\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "Width", name: "Width", pkg: "", typ: $String, tag: "js:\"width\""}]);
	HTMLFieldSetElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLFontElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLFormElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "AcceptCharset", name: "AcceptCharset", pkg: "", typ: $String, tag: "js:\"acceptCharset\""}, {prop: "Action", name: "Action", pkg: "", typ: $String, tag: "js:\"action\""}, {prop: "Autocomplete", name: "Autocomplete", pkg: "", typ: $String, tag: "js:\"autocomplete\""}, {prop: "Encoding", name: "Encoding", pkg: "", typ: $String, tag: "js:\"encoding\""}, {prop: "Enctype", name: "Enctype", pkg: "", typ: $String, tag: "js:\"enctype\""}, {prop: "Length", name: "Length", pkg: "", typ: $Int, tag: "js:\"length\""}, {prop: "Method", name: "Method", pkg: "", typ: $String, tag: "js:\"method\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "NoValidate", name: "NoValidate", pkg: "", typ: $Bool, tag: "js:\"noValidate\""}, {prop: "Target", name: "Target", pkg: "", typ: $String, tag: "js:\"target\""}]);
	HTMLFrameElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLFrameSetElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLHRElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLHeadElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLHeadingElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLHtmlElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLIFrameElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Width", name: "Width", pkg: "", typ: $String, tag: "js:\"width\""}, {prop: "Height", name: "Height", pkg: "", typ: $String, tag: "js:\"height\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Src", name: "Src", pkg: "", typ: $String, tag: "js:\"src\""}, {prop: "SrcDoc", name: "SrcDoc", pkg: "", typ: $String, tag: "js:\"srcdoc\""}, {prop: "Seamless", name: "Seamless", pkg: "", typ: $Bool, tag: "js:\"seamless\""}]);
	HTMLImageElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Complete", name: "Complete", pkg: "", typ: $Bool, tag: "js:\"complete\""}, {prop: "CrossOrigin", name: "CrossOrigin", pkg: "", typ: $String, tag: "js:\"crossOrigin\""}, {prop: "Height", name: "Height", pkg: "", typ: $Int, tag: "js:\"height\""}, {prop: "IsMap", name: "IsMap", pkg: "", typ: $Bool, tag: "js:\"isMap\""}, {prop: "NaturalHeight", name: "NaturalHeight", pkg: "", typ: $Int, tag: "js:\"naturalHeight\""}, {prop: "NaturalWidth", name: "NaturalWidth", pkg: "", typ: $Int, tag: "js:\"naturalWidth\""}, {prop: "Src", name: "Src", pkg: "", typ: $String, tag: "js:\"src\""}, {prop: "UseMap", name: "UseMap", pkg: "", typ: $String, tag: "js:\"useMap\""}, {prop: "Width", name: "Width", pkg: "", typ: $Int, tag: "js:\"width\""}]);
	HTMLInputElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Accept", name: "Accept", pkg: "", typ: $String, tag: "js:\"accept\""}, {prop: "Alt", name: "Alt", pkg: "", typ: $String, tag: "js:\"alt\""}, {prop: "Autocomplete", name: "Autocomplete", pkg: "", typ: $String, tag: "js:\"autocomplete\""}, {prop: "Autofocus", name: "Autofocus", pkg: "", typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Checked", name: "Checked", pkg: "", typ: $Bool, tag: "js:\"checked\""}, {prop: "DefaultChecked", name: "DefaultChecked", pkg: "", typ: $Bool, tag: "js:\"defaultChecked\""}, {prop: "DefaultValue", name: "DefaultValue", pkg: "", typ: $String, tag: "js:\"defaultValue\""}, {prop: "DirName", name: "DirName", pkg: "", typ: $String, tag: "js:\"dirName\""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "FormAction", name: "FormAction", pkg: "", typ: $String, tag: "js:\"formAction\""}, {prop: "FormEncType", name: "FormEncType", pkg: "", typ: $String, tag: "js:\"formEncType\""}, {prop: "FormMethod", name: "FormMethod", pkg: "", typ: $String, tag: "js:\"formMethod\""}, {prop: "FormNoValidate", name: "FormNoValidate", pkg: "", typ: $Bool, tag: "js:\"formNoValidate\""}, {prop: "FormTarget", name: "FormTarget", pkg: "", typ: $String, tag: "js:\"formTarget\""}, {prop: "Height", name: "Height", pkg: "", typ: $String, tag: "js:\"height\""}, {prop: "Indeterminate", name: "Indeterminate", pkg: "", typ: $Bool, tag: "js:\"indeterminate\""}, {prop: "Max", name: "Max", pkg: "", typ: $String, tag: "js:\"max\""}, {prop: "MaxLength", name: "MaxLength", pkg: "", typ: $Int, tag: "js:\"maxLength\""}, {prop: "Min", name: "Min", pkg: "", typ: $String, tag: "js:\"min\""}, {prop: "Multiple", name: "Multiple", pkg: "", typ: $Bool, tag: "js:\"multiple\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Pattern", name: "Pattern", pkg: "", typ: $String, tag: "js:\"pattern\""}, {prop: "Placeholder", name: "Placeholder", pkg: "", typ: $String, tag: "js:\"placeholder\""}, {prop: "ReadOnly", name: "ReadOnly", pkg: "", typ: $Bool, tag: "js:\"readOnly\""}, {prop: "Required", name: "Required", pkg: "", typ: $Bool, tag: "js:\"required\""}, {prop: "SelectionDirection", name: "SelectionDirection", pkg: "", typ: $String, tag: "js:\"selectionDirection\""}, {prop: "SelectionEnd", name: "SelectionEnd", pkg: "", typ: $Int, tag: "js:\"selectionEnd\""}, {prop: "SelectionStart", name: "SelectionStart", pkg: "", typ: $Int, tag: "js:\"selectionStart\""}, {prop: "Size", name: "Size", pkg: "", typ: $Int, tag: "js:\"size\""}, {prop: "Src", name: "Src", pkg: "", typ: $String, tag: "js:\"src\""}, {prop: "Step", name: "Step", pkg: "", typ: $String, tag: "js:\"step\""}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}, {prop: "ValueAsDate", name: "ValueAsDate", pkg: "", typ: time.Time, tag: "js:\"valueAsDate\""}, {prop: "ValueAsNumber", name: "ValueAsNumber", pkg: "", typ: $Float64, tag: "js:\"valueAsNumber\""}, {prop: "Width", name: "Width", pkg: "", typ: $String, tag: "js:\"width\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}]);
	File.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	HTMLKeygenElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Autofocus", name: "Autofocus", pkg: "", typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Challenge", name: "Challenge", pkg: "", typ: $String, tag: "js:\"challenge\""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "Keytype", name: "Keytype", pkg: "", typ: $String, tag: "js:\"keytype\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLLIElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Value", name: "Value", pkg: "", typ: $Int, tag: "js:\"value\""}]);
	HTMLLabelElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "For", name: "For", pkg: "", typ: $String, tag: "js:\"htmlFor\""}]);
	HTMLLegendElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLLinkElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "Href", name: "Href", pkg: "", typ: $String, tag: "js:\"href\""}, {prop: "HrefLang", name: "HrefLang", pkg: "", typ: $String, tag: "js:\"hrefLang\""}, {prop: "Media", name: "Media", pkg: "", typ: $String, tag: "js:\"media\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}]);
	HTMLMapElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}]);
	HTMLMediaElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Paused", name: "Paused", pkg: "", typ: $Bool, tag: "js:\"paused\""}]);
	HTMLMenuElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLMetaElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Content", name: "Content", pkg: "", typ: $String, tag: "js:\"content\""}, {prop: "HTTPEquiv", name: "HTTPEquiv", pkg: "", typ: $String, tag: "js:\"httpEquiv\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}]);
	HTMLMeterElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "High", name: "High", pkg: "", typ: $Float64, tag: "js:\"high\""}, {prop: "Low", name: "Low", pkg: "", typ: $Float64, tag: "js:\"low\""}, {prop: "Max", name: "Max", pkg: "", typ: $Float64, tag: "js:\"max\""}, {prop: "Min", name: "Min", pkg: "", typ: $Float64, tag: "js:\"min\""}, {prop: "Optimum", name: "Optimum", pkg: "", typ: $Float64, tag: "js:\"optimum\""}]);
	HTMLModElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Cite", name: "Cite", pkg: "", typ: $String, tag: "js:\"cite\""}, {prop: "DateTime", name: "DateTime", pkg: "", typ: $String, tag: "js:\"dateTime\""}]);
	HTMLOListElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Reversed", name: "Reversed", pkg: "", typ: $Bool, tag: "js:\"reversed\""}, {prop: "Start", name: "Start", pkg: "", typ: $Int, tag: "js:\"start\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}]);
	HTMLObjectElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Data", name: "Data", pkg: "", typ: $String, tag: "js:\"data\""}, {prop: "Height", name: "Height", pkg: "", typ: $String, tag: "js:\"height\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $Int, tag: "js:\"tabIndex\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "TypeMustMatch", name: "TypeMustMatch", pkg: "", typ: $Bool, tag: "js:\"typeMustMatch\""}, {prop: "UseMap", name: "UseMap", pkg: "", typ: $String, tag: "js:\"useMap\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "With", name: "With", pkg: "", typ: $String, tag: "js:\"with\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLOptGroupElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "Label", name: "Label", pkg: "", typ: $String, tag: "js:\"label\""}]);
	HTMLOptionElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "DefaultSelected", name: "DefaultSelected", pkg: "", typ: $Bool, tag: "js:\"defaultSelected\""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "Index", name: "Index", pkg: "", typ: $Int, tag: "js:\"index\""}, {prop: "Label", name: "Label", pkg: "", typ: $String, tag: "js:\"label\""}, {prop: "Selected", name: "Selected", pkg: "", typ: $Bool, tag: "js:\"selected\""}, {prop: "Text", name: "Text", pkg: "", typ: $String, tag: "js:\"text\""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}]);
	HTMLOutputElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "DefaultValue", name: "DefaultValue", pkg: "", typ: $String, tag: "js:\"defaultValue\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLParagraphElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLParamElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}]);
	HTMLPreElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLProgressElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Max", name: "Max", pkg: "", typ: $Float64, tag: "js:\"max\""}, {prop: "Position", name: "Position", pkg: "", typ: $Float64, tag: "js:\"position\""}, {prop: "Value", name: "Value", pkg: "", typ: $Float64, tag: "js:\"value\""}]);
	HTMLQuoteElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Cite", name: "Cite", pkg: "", typ: $String, tag: "js:\"cite\""}]);
	HTMLScriptElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "Src", name: "Src", pkg: "", typ: $String, tag: "js:\"src\""}, {prop: "Charset", name: "Charset", pkg: "", typ: $String, tag: "js:\"charset\""}, {prop: "Async", name: "Async", pkg: "", typ: $Bool, tag: "js:\"async\""}, {prop: "Defer", name: "Defer", pkg: "", typ: $Bool, tag: "js:\"defer\""}, {prop: "Text", name: "Text", pkg: "", typ: $String, tag: "js:\"text\""}]);
	HTMLSelectElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Autofocus", name: "Autofocus", pkg: "", typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "Length", name: "Length", pkg: "", typ: $Int, tag: "js:\"length\""}, {prop: "Multiple", name: "Multiple", pkg: "", typ: $Bool, tag: "js:\"multiple\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Required", name: "Required", pkg: "", typ: $Bool, tag: "js:\"required\""}, {prop: "SelectedIndex", name: "SelectedIndex", pkg: "", typ: $Int, tag: "js:\"selectedIndex\""}, {prop: "Size", name: "Size", pkg: "", typ: $Int, tag: "js:\"size\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}]);
	HTMLSourceElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Media", name: "Media", pkg: "", typ: $String, tag: "js:\"media\""}, {prop: "Src", name: "Src", pkg: "", typ: $String, tag: "js:\"src\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}]);
	HTMLSpanElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLStyleElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLTableCaptionElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLTableCellElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "ColSpan", name: "ColSpan", pkg: "", typ: $Int, tag: "js:\"colSpan\""}, {prop: "RowSpan", name: "RowSpan", pkg: "", typ: $Int, tag: "js:\"rowSpan\""}, {prop: "CellIndex", name: "CellIndex", pkg: "", typ: $Int, tag: "js:\"cellIndex\""}]);
	HTMLTableColElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Span", name: "Span", pkg: "", typ: $Int, tag: "js:\"span\""}]);
	HTMLTableDataCellElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLTableElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLTableHeaderCellElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Abbr", name: "Abbr", pkg: "", typ: $String, tag: "js:\"abbr\""}, {prop: "Scope", name: "Scope", pkg: "", typ: $String, tag: "js:\"scope\""}]);
	HTMLTableRowElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "RowIndex", name: "RowIndex", pkg: "", typ: $Int, tag: "js:\"rowIndex\""}, {prop: "SectionRowIndex", name: "SectionRowIndex", pkg: "", typ: $Int, tag: "js:\"sectionRowIndex\""}]);
	HTMLTableSectionElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLTextAreaElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Autocomplete", name: "Autocomplete", pkg: "", typ: $String, tag: "js:\"autocomplete\""}, {prop: "Autofocus", name: "Autofocus", pkg: "", typ: $Bool, tag: "js:\"autofocus\""}, {prop: "Cols", name: "Cols", pkg: "", typ: $Int, tag: "js:\"cols\""}, {prop: "DefaultValue", name: "DefaultValue", pkg: "", typ: $String, tag: "js:\"defaultValue\""}, {prop: "DirName", name: "DirName", pkg: "", typ: $String, tag: "js:\"dirName\""}, {prop: "Disabled", name: "Disabled", pkg: "", typ: $Bool, tag: "js:\"disabled\""}, {prop: "MaxLength", name: "MaxLength", pkg: "", typ: $Int, tag: "js:\"maxLength\""}, {prop: "Name", name: "Name", pkg: "", typ: $String, tag: "js:\"name\""}, {prop: "Placeholder", name: "Placeholder", pkg: "", typ: $String, tag: "js:\"placeholder\""}, {prop: "ReadOnly", name: "ReadOnly", pkg: "", typ: $Bool, tag: "js:\"readOnly\""}, {prop: "Required", name: "Required", pkg: "", typ: $Bool, tag: "js:\"required\""}, {prop: "Rows", name: "Rows", pkg: "", typ: $Int, tag: "js:\"rows\""}, {prop: "SelectionDirection", name: "SelectionDirection", pkg: "", typ: $String, tag: "js:\"selectionDirection\""}, {prop: "SelectionStart", name: "SelectionStart", pkg: "", typ: $Int, tag: "js:\"selectionStart\""}, {prop: "SelectionEnd", name: "SelectionEnd", pkg: "", typ: $Int, tag: "js:\"selectionEnd\""}, {prop: "TabIndex", name: "TabIndex", pkg: "", typ: $Int, tag: "js:\"tabIndex\""}, {prop: "TextLength", name: "TextLength", pkg: "", typ: $Int, tag: "js:\"textLength\""}, {prop: "Type", name: "Type", pkg: "", typ: $String, tag: "js:\"type\""}, {prop: "ValidationMessage", name: "ValidationMessage", pkg: "", typ: $String, tag: "js:\"validationMessage\""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: "js:\"value\""}, {prop: "WillValidate", name: "WillValidate", pkg: "", typ: $Bool, tag: "js:\"willValidate\""}, {prop: "Wrap", name: "Wrap", pkg: "", typ: $String, tag: "js:\"wrap\""}]);
	HTMLTimeElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "DateTime", name: "DateTime", pkg: "", typ: $String, tag: "js:\"dateTime\""}]);
	HTMLTitleElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Text", name: "Text", pkg: "", typ: $String, tag: "js:\"text\""}]);
	TextTrack.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	HTMLTrackElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}, {prop: "Kind", name: "Kind", pkg: "", typ: $String, tag: "js:\"kind\""}, {prop: "Src", name: "Src", pkg: "", typ: $String, tag: "js:\"src\""}, {prop: "Srclang", name: "Srclang", pkg: "", typ: $String, tag: "js:\"srclang\""}, {prop: "Label", name: "Label", pkg: "", typ: $String, tag: "js:\"label\""}, {prop: "Default", name: "Default", pkg: "", typ: $Bool, tag: "js:\"default\""}, {prop: "ReadyState", name: "ReadyState", pkg: "", typ: $Int, tag: "js:\"readyState\""}]);
	HTMLUListElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLUnknownElement.init([{prop: "BasicHTMLElement", name: "", pkg: "", typ: ptrType$1, tag: ""}]);
	HTMLVideoElement.init([{prop: "HTMLMediaElement", name: "", pkg: "", typ: ptrType$3, tag: ""}]);
	CSSStyleDeclaration.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	Text.init([{prop: "BasicNode", name: "", pkg: "", typ: ptrType$22, tag: ""}]);
	Event.init([{prop: "Bubbles", name: "Bubbles", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "Cancelable", name: "Cancelable", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "CurrentTarget", name: "CurrentTarget", pkg: "", typ: $funcType([], [Element], false)}, {prop: "DefaultPrevented", name: "DefaultPrevented", pkg: "", typ: $funcType([], [$Bool], false)}, {prop: "EventPhase", name: "EventPhase", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "PreventDefault", name: "PreventDefault", pkg: "", typ: $funcType([], [], false)}, {prop: "StopImmediatePropagation", name: "StopImmediatePropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "StopPropagation", name: "StopPropagation", pkg: "", typ: $funcType([], [], false)}, {prop: "Target", name: "Target", pkg: "", typ: $funcType([], [Element], false)}, {prop: "Timestamp", name: "Timestamp", pkg: "", typ: $funcType([], [time.Time], false)}, {prop: "Type", name: "Type", pkg: "", typ: $funcType([], [$String], false)}, {prop: "Underlying", name: "Underlying", pkg: "", typ: $funcType([], [ptrType], false)}]);
	BasicEvent.init([{prop: "Object", name: "", pkg: "", typ: ptrType, tag: ""}]);
	AnimationEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	AudioProcessingEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	BeforeInputEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	BeforeUnloadEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	BlobEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	ClipboardEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	CloseEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}, {prop: "Code", name: "Code", pkg: "", typ: $Int, tag: "js:\"code\""}, {prop: "Reason", name: "Reason", pkg: "", typ: $String, tag: "js:\"reason\""}, {prop: "WasClean", name: "WasClean", pkg: "", typ: $Bool, tag: "js:\"wasClean\""}]);
	CompositionEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	CSSFontFaceLoadEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	CustomEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	DeviceLightEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	DeviceMotionEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	DeviceOrientationEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	DeviceProximityEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	DOMTransactionEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	DragEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	EditingBeforeInputEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	ErrorEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	FocusEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	GamepadEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	HashChangeEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	IDBVersionChangeEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	KeyboardEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}, {prop: "AltKey", name: "AltKey", pkg: "", typ: $Bool, tag: "js:\"altKey\""}, {prop: "CharCode", name: "CharCode", pkg: "", typ: $Int, tag: "js:\"charCode\""}, {prop: "CtrlKey", name: "CtrlKey", pkg: "", typ: $Bool, tag: "js:\"ctrlKey\""}, {prop: "Key", name: "Key", pkg: "", typ: $String, tag: "js:\"key\""}, {prop: "KeyIdentifier", name: "KeyIdentifier", pkg: "", typ: $String, tag: "js:\"keyIdentifier\""}, {prop: "KeyCode", name: "KeyCode", pkg: "", typ: $Int, tag: "js:\"keyCode\""}, {prop: "Locale", name: "Locale", pkg: "", typ: $String, tag: "js:\"locale\""}, {prop: "Location", name: "Location", pkg: "", typ: $Int, tag: "js:\"location\""}, {prop: "KeyLocation", name: "KeyLocation", pkg: "", typ: $Int, tag: "js:\"keyLocation\""}, {prop: "MetaKey", name: "MetaKey", pkg: "", typ: $Bool, tag: "js:\"metaKey\""}, {prop: "Repeat", name: "Repeat", pkg: "", typ: $Bool, tag: "js:\"repeat\""}, {prop: "ShiftKey", name: "ShiftKey", pkg: "", typ: $Bool, tag: "js:\"shiftKey\""}]);
	MediaStreamEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	MessageEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}, {prop: "Data", name: "Data", pkg: "", typ: ptrType, tag: "js:\"data\""}]);
	MouseEvent.init([{prop: "UIEvent", name: "", pkg: "", typ: ptrType$19, tag: ""}, {prop: "AltKey", name: "AltKey", pkg: "", typ: $Bool, tag: "js:\"altKey\""}, {prop: "Button", name: "Button", pkg: "", typ: $Int, tag: "js:\"button\""}, {prop: "ClientX", name: "ClientX", pkg: "", typ: $Int, tag: "js:\"clientX\""}, {prop: "ClientY", name: "ClientY", pkg: "", typ: $Int, tag: "js:\"clientY\""}, {prop: "CtrlKey", name: "CtrlKey", pkg: "", typ: $Bool, tag: "js:\"ctrlKey\""}, {prop: "MetaKey", name: "MetaKey", pkg: "", typ: $Bool, tag: "js:\"metaKey\""}, {prop: "MovementX", name: "MovementX", pkg: "", typ: $Int, tag: "js:\"movementX\""}, {prop: "MovementY", name: "MovementY", pkg: "", typ: $Int, tag: "js:\"movementY\""}, {prop: "ScreenX", name: "ScreenX", pkg: "", typ: $Int, tag: "js:\"screenX\""}, {prop: "ScreenY", name: "ScreenY", pkg: "", typ: $Int, tag: "js:\"screenY\""}, {prop: "ShiftKey", name: "ShiftKey", pkg: "", typ: $Bool, tag: "js:\"shiftKey\""}]);
	MutationEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	OfflineAudioCompletionEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	PageTransitionEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	PointerEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	PopStateEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	ProgressEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	RelatedEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	RTCPeerConnectionIceEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	SensorEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	StorageEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	SVGEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	SVGZoomEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	TimeEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	TouchEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	TrackEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	TransitionEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	UIEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	UserProximityEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}]);
	WheelEvent.init([{prop: "BasicEvent", name: "", pkg: "", typ: ptrType$18, tag: ""}, {prop: "DeltaX", name: "DeltaX", pkg: "", typ: $Float64, tag: "js:\"deltaX\""}, {prop: "DeltaY", name: "DeltaY", pkg: "", typ: $Float64, tag: "js:\"deltaY\""}, {prop: "DeltaZ", name: "DeltaZ", pkg: "", typ: $Float64, tag: "js:\"deltaZ\""}, {prop: "DeltaMode", name: "DeltaMode", pkg: "", typ: $Int, tag: "js:\"deltaMode\""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = js.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = strings.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["github.com/cathalgarvey/go-freeboard"] = (function() {
	var $pkg = {}, $init, errors, js, json, dom, reflect, time, DsPlugin, DsPluginDefinition, settingType, FBSettingOpt, FBSettingSet, FBSetting, WidgetPlugin, WtPluginDefinition, FBWrapper, ptrType, funcType, ptrType$1, funcType$1, funcType$2, sliceType, mapType, sliceType$1, funcType$3, sliceType$2, ptrType$2, ptrType$3, ptrType$4, ptrType$5, ptrType$6, ptrType$7, sliceType$3, mapType$1, sliceType$4, funcType$4, funcType$5, sliceType$5, funcType$6, funcType$7, funcType$8, funcType$9, sliceType$6, funcType$10, funcType$11, sliceType$7, sliceType$8, funcType$12, WrapDsPlugin, MakeUpdateTicker, jsWrap, typeOf, WrapWidgetPlugin, init;
	errors = $packages["errors"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	json = $packages["github.com/kurrik/json"];
	dom = $packages["honnef.co/go/js/dom"];
	reflect = $packages["reflect"];
	time = $packages["time"];
	DsPlugin = $pkg.DsPlugin = $newType(8, $kindInterface, "freeboard.DsPlugin", "DsPlugin", "github.com/cathalgarvey/go-freeboard", null);
	DsPluginDefinition = $pkg.DsPluginDefinition = $newType(0, $kindStruct, "freeboard.DsPluginDefinition", "DsPluginDefinition", "github.com/cathalgarvey/go-freeboard", function(TypeName_, DisplayName_, Description_, ExternalScripts_, Settings_, NewInstance_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.TypeName = "";
			this.DisplayName = "";
			this.Description = "";
			this.ExternalScripts = sliceType.nil;
			this.Settings = sliceType$6.nil;
			this.NewInstance = $throwNilPointerError;
			return;
		}
		this.TypeName = TypeName_;
		this.DisplayName = DisplayName_;
		this.Description = Description_;
		this.ExternalScripts = ExternalScripts_;
		this.Settings = Settings_;
		this.NewInstance = NewInstance_;
	});
	settingType = $pkg.settingType = $newType(8, $kindString, "freeboard.settingType", "settingType", "github.com/cathalgarvey/go-freeboard", null);
	FBSettingOpt = $pkg.FBSettingOpt = $newType(0, $kindStruct, "freeboard.FBSettingOpt", "FBSettingOpt", "github.com/cathalgarvey/go-freeboard", function(Name_, Value_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.Value = "";
			return;
		}
		this.Name = Name_;
		this.Value = Value_;
	});
	FBSettingSet = $pkg.FBSettingSet = $newType(0, $kindStruct, "freeboard.FBSettingSet", "FBSettingSet", "github.com/cathalgarvey/go-freeboard", function(Name_, DisplayName_, Type_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.DisplayName = "";
			this.Type = "";
			return;
		}
		this.Name = Name_;
		this.DisplayName = DisplayName_;
		this.Type = Type_;
	});
	FBSetting = $pkg.FBSetting = $newType(0, $kindStruct, "freeboard.FBSetting", "FBSetting", "github.com/cathalgarvey/go-freeboard", function(Name_, DisplayName_, Description_, Type_, Options_, Settings_, DefaultStringValue_, DefaultIntValue_, DefaultFloatValue_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.Name = "";
			this.DisplayName = "";
			this.Description = "";
			this.Type = "";
			this.Options = sliceType$7.nil;
			this.Settings = sliceType$8.nil;
			this.DefaultStringValue = "";
			this.DefaultIntValue = 0;
			this.DefaultFloatValue = 0;
			return;
		}
		this.Name = Name_;
		this.DisplayName = DisplayName_;
		this.Description = Description_;
		this.Type = Type_;
		this.Options = Options_;
		this.Settings = Settings_;
		this.DefaultStringValue = DefaultStringValue_;
		this.DefaultIntValue = DefaultIntValue_;
		this.DefaultFloatValue = DefaultFloatValue_;
	});
	WidgetPlugin = $pkg.WidgetPlugin = $newType(8, $kindInterface, "freeboard.WidgetPlugin", "WidgetPlugin", "github.com/cathalgarvey/go-freeboard", null);
	WtPluginDefinition = $pkg.WtPluginDefinition = $newType(0, $kindStruct, "freeboard.WtPluginDefinition", "WtPluginDefinition", "github.com/cathalgarvey/go-freeboard", function(TypeName_, DisplayName_, Description_, FillSize_, ExternalScripts_, Settings_, NewInstance_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.TypeName = "";
			this.DisplayName = "";
			this.Description = "";
			this.FillSize = false;
			this.ExternalScripts = sliceType.nil;
			this.Settings = sliceType$6.nil;
			this.NewInstance = $throwNilPointerError;
			return;
		}
		this.TypeName = TypeName_;
		this.DisplayName = DisplayName_;
		this.Description = Description_;
		this.FillSize = FillSize_;
		this.ExternalScripts = ExternalScripts_;
		this.Settings = Settings_;
		this.NewInstance = NewInstance_;
	});
	FBWrapper = $pkg.FBWrapper = $newType(0, $kindStruct, "freeboard.FBWrapper", "FBWrapper", "github.com/cathalgarvey/go-freeboard", function(FreeboardObject_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.FreeboardObject = null;
			return;
		}
		this.FreeboardObject = FreeboardObject_;
	});
	ptrType = $ptrType(FBWrapper);
	funcType = $funcType([], [], false);
	ptrType$1 = $ptrType(js.Object);
	funcType$1 = $funcType([ptrType$1], [], false);
	funcType$2 = $funcType([], [ptrType$1], false);
	sliceType = $sliceType($String);
	mapType = $mapType($String, $emptyInterface);
	sliceType$1 = $sliceType(mapType);
	funcType$3 = $funcType([ptrType$1, ptrType$1, ptrType$1], [], false);
	sliceType$2 = $sliceType(reflect.Value);
	ptrType$2 = $ptrType(ptrType$1);
	ptrType$3 = $ptrType(dom.Document);
	ptrType$4 = $ptrType(dom.Element);
	ptrType$5 = $ptrType(dom.Event);
	ptrType$6 = $ptrType(dom.HTMLElement);
	ptrType$7 = $ptrType(dom.Node);
	sliceType$3 = $sliceType($Uint8);
	mapType$1 = $mapType($String, $String);
	sliceType$4 = $sliceType(mapType$1);
	funcType$4 = $funcType([mapType], [], false);
	funcType$5 = $funcType([$String, $emptyInterface], [], false);
	sliceType$5 = $sliceType(ptrType$1);
	funcType$6 = $funcType([sliceType$5], [], true);
	funcType$7 = $funcType([dom.HTMLElement], [], false);
	funcType$8 = $funcType([], [$Int], false);
	funcType$9 = $funcType([ptrType$1, ptrType$1], [], false);
	sliceType$6 = $sliceType(FBSetting);
	funcType$10 = $funcType([$emptyInterface], [], false);
	funcType$11 = $funcType([ptrType$1, funcType$10], [DsPlugin], false);
	sliceType$7 = $sliceType(FBSettingOpt);
	sliceType$8 = $sliceType(FBSettingSet);
	funcType$12 = $funcType([ptrType$1], [WidgetPlugin], false);
	WrapDsPlugin = function(dsp) {
		var $ptr, dsp;
		return $makeMap($String.keyFor, [{ k: "plugin", v: dsp }, { k: "updateNow", v: new funcType($methodVal(dsp, "UpdateNow")) }, { k: "onDispose", v: new funcType($methodVal(dsp, "OnDispose")) }, { k: "onSettingsChanged", v: new funcType$1($methodVal(dsp, "OnSettingsChanged")) }, { k: "currentSettings", v: new funcType$2($methodVal(dsp, "CurrentSettings")) }]);
	};
	$pkg.WrapDsPlugin = WrapDsPlugin;
	MakeUpdateTicker = function(dsp, seconds) {
		var $ptr, closeToKillUpdate, dsp, seconds;
		closeToKillUpdate = new $Chan($emptyInterface, 0);
		$go((function $b(dsp$1, seconds$1) {
			var $ptr, _r, _selection, dsp$1, seconds$1, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _selection = $f._selection; dsp$1 = $f.dsp$1; seconds$1 = $f.seconds$1; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			/* while (true) { */ case 1:
				_r = $select([[closeToKillUpdate], [time.After($mul64(new time.Duration(0, seconds$1), new time.Duration(0, 1000000000)))]]); /* */ $s = 3; case 3: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
				_selection = _r;
				/* */ if (_selection[0] === 0) { $s = 4; continue; }
				/* */ if (_selection[0] === 1) { $s = 5; continue; }
				/* */ $s = 6; continue;
				/* if (_selection[0] === 0) { */ case 4:
					return;
				/* } else if (_selection[0] === 1) { */ case 5:
					$r = dsp$1.UpdateNow(); /* */ $s = 7; case 7: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
				/* } */ case 6:
			/* } */ $s = 1; continue; case 2:
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f._selection = _selection; $f.dsp$1 = dsp$1; $f.seconds$1 = seconds$1; $f.$s = $s; $f.$r = $r; return $f;
		}), [dsp, seconds]);
		return closeToKillUpdate;
	};
	$pkg.MakeUpdateTicker = MakeUpdateTicker;
	DsPluginDefinition.ptr.prototype.ToFBInterface = function() {
		var $ptr, _i, _key, _key$1, _key$2, _key$3, _key$4, _key$5, _ref, dsp, output, s, settingSlice;
		dsp = $clone(this, DsPluginDefinition);
		output = {};
		_key = "type_name"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $String(dsp.TypeName) };
		_key$1 = "display_name"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: new $String(dsp.DisplayName) };
		_key$2 = "description"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: new $String(dsp.Description) };
		if (!(dsp.ExternalScripts === sliceType.nil) && dsp.ExternalScripts.$length > 0) {
			_key$3 = "external_scripts"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$3)] = { k: _key$3, v: dsp.ExternalScripts };
		}
		settingSlice = $makeSlice(sliceType$1, 0, dsp.Settings.$length);
		_ref = dsp.Settings;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			s = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), FBSetting);
			settingSlice = $append(settingSlice, s.ToFBInterface());
			_i++;
		}
		_key$4 = "settings"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$4)] = { k: _key$4, v: settingSlice };
		_key$5 = "newInstance"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$5)] = { k: _key$5, v: new funcType$3((function $b(settings, newInstanceCallback, updateCallback) {
			var $ptr, Plugin, _r, newInstanceCallback, settings, updateCallback, wrapper, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; Plugin = $f.Plugin; _r = $f._r; newInstanceCallback = $f.newInstanceCallback; settings = $f.settings; updateCallback = $f.updateCallback; wrapper = $f.wrapper; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			updateCallback = [updateCallback];
			_r = dsp.NewInstance(settings, (function(updateCallback) { return function(i) {
				var $ptr, i;
				updateCallback[0]($externalize(i, $emptyInterface));
			}; })(updateCallback)); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			Plugin = _r;
			wrapper = WrapDsPlugin(Plugin);
			newInstanceCallback($externalize(wrapper, mapType));
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.Plugin = Plugin; $f._r = _r; $f.newInstanceCallback = newInstanceCallback; $f.settings = settings; $f.updateCallback = updateCallback; $f.wrapper = wrapper; $f.$s = $s; $f.$r = $r; return $f;
		})) };
		return output;
	};
	DsPluginDefinition.prototype.ToFBInterface = function() { return this.$val.ToFBInterface(); };
	jsWrap = function(fn) {
		var $ptr, _r, fn, v, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; fn = $f.fn; v = $f.v; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		v = [v];
		_r = reflect.ValueOf(fn); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		v[0] = _r;
		return (function(v) { return function $b(args) {
			var $ptr, _1, _arg, _arg$1, _i, _r$1, _r$10, _r$11, _r$12, _r$13, _r$14, _r$15, _r$16, _r$17, _r$18, _r$19, _r$2, _r$20, _r$21, _r$3, _r$4, _r$5, _r$6, _r$7, _r$8, _r$9, _ref, args, err, i, in$1, p, t, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _1 = $f._1; _arg = $f._arg; _arg$1 = $f._arg$1; _i = $f._i; _r$1 = $f._r$1; _r$10 = $f._r$10; _r$11 = $f._r$11; _r$12 = $f._r$12; _r$13 = $f._r$13; _r$14 = $f._r$14; _r$15 = $f._r$15; _r$16 = $f._r$16; _r$17 = $f._r$17; _r$18 = $f._r$18; _r$19 = $f._r$19; _r$2 = $f._r$2; _r$20 = $f._r$20; _r$21 = $f._r$21; _r$3 = $f._r$3; _r$4 = $f._r$4; _r$5 = $f._r$5; _r$6 = $f._r$6; _r$7 = $f._r$7; _r$8 = $f._r$8; _r$9 = $f._r$9; _ref = $f._ref; args = $f.args; err = $f.err; i = $f.i; in$1 = $f.in$1; p = $f.p; t = $f.t; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r$1 = v[0].Type().NumIn(); /* */ $s = 1; case 1: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			in$1 = $makeSlice(sliceType$2, _r$1);
			_ref = in$1;
			_i = 0;
			/* while (true) { */ case 2:
				/* if (!(_i < _ref.$length)) { break; } */ if(!(_i < _ref.$length)) { $s = 3; continue; }
				i = _i;
					_r$2 = v[0].Type().In(i); /* */ $s = 5; case 5: if($c) { $c = false; _r$2 = _r$2.$blk(); } if (_r$2 && _r$2.$blk !== undefined) { break s; }
					t = _r$2;
					_1 = t;
					_r$3 = typeOf(ptrType$2.nil); /* */ $s = 14; case 14: if($c) { $c = false; _r$3 = _r$3.$blk(); } if (_r$3 && _r$3.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_1, (_r$3))) { $s = 6; continue; }
					_r$4 = typeOf(ptrType$3.nil); /* */ $s = 15; case 15: if($c) { $c = false; _r$4 = _r$4.$blk(); } if (_r$4 && _r$4.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_1, (_r$4))) { $s = 7; continue; }
					_r$5 = typeOf(ptrType$4.nil); /* */ $s = 16; case 16: if($c) { $c = false; _r$5 = _r$5.$blk(); } if (_r$5 && _r$5.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_1, (_r$5))) { $s = 8; continue; }
					_r$6 = typeOf(ptrType$5.nil); /* */ $s = 17; case 17: if($c) { $c = false; _r$6 = _r$6.$blk(); } if (_r$6 && _r$6.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_1, (_r$6))) { $s = 9; continue; }
					_r$7 = typeOf(ptrType$6.nil); /* */ $s = 18; case 18: if($c) { $c = false; _r$7 = _r$7.$blk(); } if (_r$7 && _r$7.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_1, (_r$7))) { $s = 10; continue; }
					_r$8 = typeOf(ptrType$7.nil); /* */ $s = 19; case 19: if($c) { $c = false; _r$8 = _r$8.$blk(); } if (_r$8 && _r$8.$blk !== undefined) { break s; }
					/* */ if ($interfaceIsEqual(_1, (_r$8))) { $s = 11; continue; }
					/* */ $s = 12; continue;
					/* if ($interfaceIsEqual(_1, (_r$3))) { */ case 6:
						_r$9 = reflect.ValueOf(new $jsObjectPtr(((i < 0 || i >= args.$length) ? $throwRuntimeError("index out of range") : args.$array[args.$offset + i]))); /* */ $s = 20; case 20: if($c) { $c = false; _r$9 = _r$9.$blk(); } if (_r$9 && _r$9.$blk !== undefined) { break s; }
						((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i] = _r$9);
						$s = 13; continue;
					/* } else if ($interfaceIsEqual(_1, (_r$4))) { */ case 7:
						_r$10 = reflect.ValueOf(dom.WrapDocument(((i < 0 || i >= args.$length) ? $throwRuntimeError("index out of range") : args.$array[args.$offset + i]))); /* */ $s = 21; case 21: if($c) { $c = false; _r$10 = _r$10.$blk(); } if (_r$10 && _r$10.$blk !== undefined) { break s; }
						((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i] = _r$10);
						$s = 13; continue;
					/* } else if ($interfaceIsEqual(_1, (_r$5))) { */ case 8:
						_r$11 = reflect.ValueOf(dom.WrapElement(((i < 0 || i >= args.$length) ? $throwRuntimeError("index out of range") : args.$array[args.$offset + i]))); /* */ $s = 22; case 22: if($c) { $c = false; _r$11 = _r$11.$blk(); } if (_r$11 && _r$11.$blk !== undefined) { break s; }
						((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i] = _r$11);
						$s = 13; continue;
					/* } else if ($interfaceIsEqual(_1, (_r$6))) { */ case 9:
						_r$12 = reflect.ValueOf(dom.WrapEvent(((i < 0 || i >= args.$length) ? $throwRuntimeError("index out of range") : args.$array[args.$offset + i]))); /* */ $s = 23; case 23: if($c) { $c = false; _r$12 = _r$12.$blk(); } if (_r$12 && _r$12.$blk !== undefined) { break s; }
						((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i] = _r$12);
						$s = 13; continue;
					/* } else if ($interfaceIsEqual(_1, (_r$7))) { */ case 10:
						_r$13 = reflect.ValueOf(dom.WrapHTMLElement(((i < 0 || i >= args.$length) ? $throwRuntimeError("index out of range") : args.$array[args.$offset + i]))); /* */ $s = 24; case 24: if($c) { $c = false; _r$13 = _r$13.$blk(); } if (_r$13 && _r$13.$blk !== undefined) { break s; }
						((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i] = _r$13);
						$s = 13; continue;
					/* } else if ($interfaceIsEqual(_1, (_r$8))) { */ case 11:
						_r$14 = reflect.ValueOf(dom.WrapNode(((i < 0 || i >= args.$length) ? $throwRuntimeError("index out of range") : args.$array[args.$offset + i]))); /* */ $s = 25; case 25: if($c) { $c = false; _r$14 = _r$14.$blk(); } if (_r$14 && _r$14.$blk !== undefined) { break s; }
						((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i] = _r$14);
						$s = 13; continue;
					/* } else { */ case 12:
						_r$15 = reflect.New(t); /* */ $s = 26; case 26: if($c) { $c = false; _r$15 = _r$15.$blk(); } if (_r$15 && _r$15.$blk !== undefined) { break s; }
						p = _r$15;
						_arg = new sliceType$3($stringToBytes($internalize(((i < 0 || i >= args.$length) ? $throwRuntimeError("index out of range") : args.$array[args.$offset + i]), $String)));
						_r$16 = p.Interface(); /* */ $s = 27; case 27: if($c) { $c = false; _r$16 = _r$16.$blk(); } if (_r$16 && _r$16.$blk !== undefined) { break s; }
						_arg$1 = _r$16;
						_r$17 = json.Unmarshal(_arg, _arg$1); /* */ $s = 28; case 28: if($c) { $c = false; _r$17 = _r$17.$blk(); } if (_r$17 && _r$17.$blk !== undefined) { break s; }
						err = _r$17;
						/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 29; continue; }
						/* */ $s = 30; continue;
						/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 29:
							_r$18 = err.Error(); /* */ $s = 31; case 31: if($c) { $c = false; _r$18 = _r$18.$blk(); } if (_r$18 && _r$18.$blk !== undefined) { break s; }
							_r$19 = errors.New("jsutil: unmarshaling JSON failed: " + _r$18); /* */ $s = 32; case 32: if($c) { $c = false; _r$19 = _r$19.$blk(); } if (_r$19 && _r$19.$blk !== undefined) { break s; }
							$panic(_r$19);
						/* } */ case 30:
						_r$20 = reflect.Indirect(p); /* */ $s = 33; case 33: if($c) { $c = false; _r$20 = _r$20.$blk(); } if (_r$20 && _r$20.$blk !== undefined) { break s; }
						((i < 0 || i >= in$1.$length) ? $throwRuntimeError("index out of range") : in$1.$array[in$1.$offset + i] = _r$20);
					/* } */ case 13:
				case 4:
				_i++;
			/* } */ $s = 2; continue; case 3:
			_r$21 = v[0].Call(in$1); /* */ $s = 34; case 34: if($c) { $c = false; _r$21 = _r$21.$blk(); } if (_r$21 && _r$21.$blk !== undefined) { break s; }
			_r$21;
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._1 = _1; $f._arg = _arg; $f._arg$1 = _arg$1; $f._i = _i; $f._r$1 = _r$1; $f._r$10 = _r$10; $f._r$11 = _r$11; $f._r$12 = _r$12; $f._r$13 = _r$13; $f._r$14 = _r$14; $f._r$15 = _r$15; $f._r$16 = _r$16; $f._r$17 = _r$17; $f._r$18 = _r$18; $f._r$19 = _r$19; $f._r$2 = _r$2; $f._r$20 = _r$20; $f._r$21 = _r$21; $f._r$3 = _r$3; $f._r$4 = _r$4; $f._r$5 = _r$5; $f._r$6 = _r$6; $f._r$7 = _r$7; $f._r$8 = _r$8; $f._r$9 = _r$9; $f._ref = _ref; $f.args = args; $f.err = err; $f.i = i; $f.in$1 = in$1; $f.p = p; $f.t = t; $f.$s = $s; $f.$r = $r; return $f;
		}; })(v);
		/* */ } return; } if ($f === undefined) { $f = { $blk: jsWrap }; } $f.$ptr = $ptr; $f._r = _r; $f.fn = fn; $f.v = v; $f.$s = $s; $f.$r = $r; return $f;
	};
	typeOf = function(pointer) {
		var $ptr, _r, pointer, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; pointer = $f.pointer; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = reflect.TypeOf(pointer).Elem(); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return _r;
		/* */ } return; } if ($f === undefined) { $f = { $blk: typeOf }; } $f.$ptr = $ptr; $f._r = _r; $f.pointer = pointer; $f.$s = $s; $f.$r = $r; return $f;
	};
	FBSetting.ptr.prototype.ToFBInterface = function() {
		var $ptr, _1, _entry, _entry$1, _i, _i$1, _key, _key$1, _key$10, _key$11, _key$12, _key$13, _key$14, _key$15, _key$16, _key$17, _key$2, _key$3, _key$4, _key$5, _key$6, _key$7, _key$8, _key$9, _ref, _ref$1, o, opt, output, s, set, st;
		set = $clone(this, FBSetting);
		output = {};
		_key = "name"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $String(set.Name) };
		_key$1 = "display_name"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: new $String(set.DisplayName) };
		_key$2 = "description"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: new $String(set.Description) };
		_key$3 = "type"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$3)] = { k: _key$3, v: new $String(set.Type) };
		_1 = set.Type;
		if (_1 === ($pkg.SettingTextType) || _1 === ($pkg.SettingCalculatedType)) {
			if (!(set.DefaultStringValue === "")) {
				_key$4 = "default_value"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$4)] = { k: _key$4, v: new $String(set.DefaultStringValue) };
			} else if (!((set.DefaultIntValue === 0))) {
				_key$5 = "default_value"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$5)] = { k: _key$5, v: new $Int(set.DefaultIntValue) };
			}
		} else if (_1 === ($pkg.SettingNumberType)) {
			if (!((set.DefaultIntValue === 0)) && (set.DefaultFloatValue === 0)) {
				_key$6 = "default_value"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$6)] = { k: _key$6, v: new $Int(set.DefaultIntValue) };
			} else if (!((set.DefaultFloatValue === 0)) && (set.DefaultIntValue === 0)) {
				_key$7 = "default_value"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$7)] = { k: _key$7, v: new $Float64(set.DefaultFloatValue) };
			} else if (!((set.DefaultIntValue === 0)) && !((set.DefaultFloatValue === 0))) {
				$panic(new $String("Cannot have defaults for both int and float numeric values."));
			}
		} else if (_1 === ($pkg.SettingOptionType)) {
			_key$8 = "options"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$8)] = { k: _key$8, v: $makeSlice(sliceType$4, 0, set.Options.$length) };
			_ref = set.Options;
			_i = 0;
			while (true) {
				if (!(_i < _ref.$length)) { break; }
				opt = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), FBSettingOpt);
				o = {};
				_key$9 = "name"; (o || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$9)] = { k: _key$9, v: opt.Name };
				if (!(opt.Value === "")) {
					_key$10 = "value"; (o || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$10)] = { k: _key$10, v: opt.Value };
				} else {
					_key$11 = "value"; (o || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$11)] = { k: _key$11, v: opt.Name };
				}
				_key$12 = "options"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$12)] = { k: _key$12, v: $append($assertType((_entry = output[$String.keyFor("options")], _entry !== undefined ? _entry.v : $ifaceNil), sliceType$4), o) };
				_i++;
			}
		} else if (_1 === ($pkg.SettingArrayType)) {
			_key$13 = "settings"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$13)] = { k: _key$13, v: $makeSlice(sliceType$4, 0, set.Settings.$length) };
			_ref$1 = set.Settings;
			_i$1 = 0;
			while (true) {
				if (!(_i$1 < _ref$1.$length)) { break; }
				st = $clone(((_i$1 < 0 || _i$1 >= _ref$1.$length) ? $throwRuntimeError("index out of range") : _ref$1.$array[_ref$1.$offset + _i$1]), FBSettingSet);
				s = {};
				_key$14 = "name"; (s || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$14)] = { k: _key$14, v: st.Name };
				_key$15 = "display_name"; (s || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$15)] = { k: _key$15, v: st.DisplayName };
				_key$16 = "type"; (s || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$16)] = { k: _key$16, v: st.Type };
				_key$17 = "settings"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$17)] = { k: _key$17, v: $append($assertType((_entry$1 = output[$String.keyFor("settings")], _entry$1 !== undefined ? _entry$1.v : $ifaceNil), sliceType$4), s) };
				_i$1++;
			}
		} else {
			$panic(new $String("Unknown setting type: " + set.Type));
		}
		return output;
	};
	FBSetting.prototype.ToFBInterface = function() { return this.$val.ToFBInterface(); };
	WrapWidgetPlugin = function(wt) {
		var $ptr, _r, wt, $s, $r;
		/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; wt = $f.wt; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		_r = jsWrap(new funcType$7($methodVal(wt, "Render"))); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
		/* */ $s = 2; case 2:
		return $makeMap($String.keyFor, [{ k: "plugin", v: wt }, { k: "onSettingsChanged", v: new funcType$4($methodVal(wt, "OnSettingsChanged")) }, { k: "OnCalculatedValueChanged", v: new funcType$5($methodVal(wt, "OnCalculatedValueChanged")) }, { k: "render", v: new funcType$6(_r) }, { k: "getHeight", v: new funcType$8($methodVal(wt, "GetHeight")) }, { k: "onDispose", v: new funcType($methodVal(wt, "OnDispose")) }]);
		/* */ } return; } if ($f === undefined) { $f = { $blk: WrapWidgetPlugin }; } $f.$ptr = $ptr; $f._r = _r; $f.wt = wt; $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.WrapWidgetPlugin = WrapWidgetPlugin;
	WtPluginDefinition.ptr.prototype.ToFBInterface = function() {
		var $ptr, _entry, _i, _key, _key$1, _key$2, _key$3, _key$4, _key$5, _key$6, _ref, output, s, settingSlice, wtp;
		wtp = $clone(this, WtPluginDefinition);
		output = {};
		_key = "type_name"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key)] = { k: _key, v: new $String(wtp.TypeName) };
		_key$1 = "display_name"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$1)] = { k: _key$1, v: new $String(wtp.DisplayName) };
		_key$2 = "description"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$2)] = { k: _key$2, v: new $String(wtp.Description) };
		_key$3 = "fill_size"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$3)] = { k: _key$3, v: new $Bool(wtp.FillSize) };
		_key$4 = "external_scripts"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$4)] = { k: _key$4, v: wtp.ExternalScripts };
		_key$5 = "settings"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$5)] = { k: _key$5, v: $makeSlice(sliceType$1, 0, wtp.Settings.$length) };
		settingSlice = $assertType((_entry = output[$String.keyFor("settings")], _entry !== undefined ? _entry.v : $ifaceNil), sliceType$1);
		_ref = wtp.Settings;
		_i = 0;
		while (true) {
			if (!(_i < _ref.$length)) { break; }
			s = $clone(((_i < 0 || _i >= _ref.$length) ? $throwRuntimeError("index out of range") : _ref.$array[_ref.$offset + _i]), FBSetting);
			settingSlice = $append(settingSlice, s.ToFBInterface());
			_i++;
		}
		_key$6 = "newInstance"; (output || $throwRuntimeError("assignment to entry in nil map"))[$String.keyFor(_key$6)] = { k: _key$6, v: new funcType$9((function $b(settings, newInstanceCallback) {
			var $ptr, Plugin, _r, _r$1, newInstanceCallback, settings, wrapper, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; Plugin = $f.Plugin; _r = $f._r; _r$1 = $f._r$1; newInstanceCallback = $f.newInstanceCallback; settings = $f.settings; wrapper = $f.wrapper; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			_r = wtp.NewInstance(settings); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			Plugin = _r;
			_r$1 = WrapWidgetPlugin(Plugin); /* */ $s = 2; case 2: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
			wrapper = _r$1;
			newInstanceCallback($externalize(wrapper, mapType));
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f.Plugin = Plugin; $f._r = _r; $f._r$1 = _r$1; $f.newInstanceCallback = newInstanceCallback; $f.settings = settings; $f.wrapper = wrapper; $f.$s = $s; $f.$r = $r; return $f;
		})) };
		return output;
	};
	WtPluginDefinition.prototype.ToFBInterface = function() { return this.$val.ToFBInterface(); };
	init = function() {
		var $ptr, fbobj;
		fbobj = $global.freeboard;
		$pkg.FB = new FBWrapper.ptr(fbobj);
	};
	FBWrapper.ptr.prototype.Initialize = function(allowEdit, finished) {
		var $ptr, allowEdit, fb, finished;
		fb = this;
		fb.FreeboardObject.initialize($externalize(allowEdit, $Bool), $externalize(finished, funcType));
	};
	FBWrapper.prototype.Initialize = function(allowEdit, finished) { return this.$val.Initialize(allowEdit, finished); };
	FBWrapper.ptr.prototype.NewDashboard = function() {
		var $ptr, fb;
		fb = this;
		fb.FreeboardObject.newDashboard();
	};
	FBWrapper.prototype.NewDashboard = function() { return this.$val.NewDashboard(); };
	FBWrapper.ptr.prototype.Serialize = function() {
		var $ptr, fb;
		fb = this;
		return fb.FreeboardObject.serialize();
	};
	FBWrapper.prototype.Serialize = function() { return this.$val.Serialize(); };
	FBWrapper.ptr.prototype.LoadDashboard = function(serialised, callback) {
		var $ptr, callback, fb, serialised;
		fb = this;
		fb.FreeboardObject.loadDashboard(serialised, callback);
	};
	FBWrapper.prototype.LoadDashboard = function(serialised, callback) { return this.$val.LoadDashboard(serialised, callback); };
	FBWrapper.ptr.prototype.SetEditing = function(editing, animate) {
		var $ptr, animate, editing, fb;
		fb = this;
		fb.FreeboardObject.setEditing(editing, animate);
	};
	FBWrapper.prototype.SetEditing = function(editing, animate) { return this.$val.SetEditing(editing, animate); };
	FBWrapper.ptr.prototype.IsEditing = function() {
		var $ptr, fb;
		fb = this;
		return fb.FreeboardObject.isEditing();
	};
	FBWrapper.prototype.IsEditing = function() { return this.$val.IsEditing(); };
	FBWrapper.ptr.prototype.LoadDatasourcePlugin = function(ds) {
		var $ptr, ds, fb;
		fb = this;
		fb.FreeboardObject.loadDatasourcePlugin(ds);
	};
	FBWrapper.prototype.LoadDatasourcePlugin = function(ds) { return this.$val.LoadDatasourcePlugin(ds); };
	FBWrapper.ptr.prototype.LoadGoDatasourcePlugin = function(ds) {
		var $ptr, ds, fb;
		ds = $clone(ds, DsPluginDefinition);
		fb = this;
		fb.FreeboardObject.loadDatasourcePlugin($externalize(ds.ToFBInterface(), mapType));
	};
	FBWrapper.prototype.LoadGoDatasourcePlugin = function(ds) { return this.$val.LoadGoDatasourcePlugin(ds); };
	FBWrapper.ptr.prototype.LoadWidgetPlugin = function(wt) {
		var $ptr, fb, wt;
		fb = this;
		fb.FreeboardObject.loadWidgetPlugin(wt);
	};
	FBWrapper.prototype.LoadWidgetPlugin = function(wt) { return this.$val.LoadWidgetPlugin(wt); };
	FBWrapper.ptr.prototype.LoadGoWidgetPlugin = function(wt) {
		var $ptr, fb, wt;
		wt = $clone(wt, WtPluginDefinition);
		fb = this;
		fb.FreeboardObject.loadWidgetPlugin($externalize(wt.ToFBInterface(), mapType));
	};
	FBWrapper.prototype.LoadGoWidgetPlugin = function(wt) { return this.$val.LoadGoWidgetPlugin(wt); };
	FBWrapper.ptr.prototype.ShowLoadingIndicator = function(show) {
		var $ptr, fb, show;
		fb = this;
		fb.FreeboardObject.showLoadingIndicator(show);
	};
	FBWrapper.prototype.ShowLoadingIndicator = function(show) { return this.$val.ShowLoadingIndicator(show); };
	FBWrapper.ptr.prototype.ShowDialog = function(contentElement, title, okButtonTitle, cancelButtonTitle, okCallback) {
		var $ptr, cancelButtonTitle, contentElement, fb, okButtonTitle, okCallback, title;
		fb = this;
		fb.FreeboardObject.showDialog($externalize(contentElement, dom.HTMLElement), $externalize(title, $String), $externalize(okButtonTitle, $String), $externalize(cancelButtonTitle, $String), $externalize(okCallback, $emptyInterface));
	};
	FBWrapper.prototype.ShowDialog = function(contentElement, title, okButtonTitle, cancelButtonTitle, okCallback) { return this.$val.ShowDialog(contentElement, title, okButtonTitle, cancelButtonTitle, okCallback); };
	FBWrapper.ptr.prototype.GetDatasourceSettings = function(name) {
		var $ptr, fb, name;
		fb = this;
		return fb.FreeboardObject.getDatasourceSettings($externalize(name, $String));
	};
	FBWrapper.prototype.GetDatasourceSettings = function(name) { return this.$val.GetDatasourceSettings(name); };
	FBWrapper.ptr.prototype.SetDatasourceSettings = function(name, settings) {
		var $ptr, fb, name, settings;
		fb = this;
		fb.FreeboardObject.setDatasourceSettings($externalize(name, $String), settings);
	};
	FBWrapper.prototype.SetDatasourceSettings = function(name, settings) { return this.$val.SetDatasourceSettings(name, settings); };
	FBWrapper.ptr.prototype.On = function(eventName, callback) {
		var $ptr, callback, eventName, fb;
		fb = this;
		fb.FreeboardObject.on($externalize(eventName, $String), callback);
	};
	FBWrapper.prototype.On = function(eventName, callback) { return this.$val.On(eventName, callback); };
	DsPluginDefinition.methods = [{prop: "ToFBInterface", name: "ToFBInterface", pkg: "", typ: $funcType([], [mapType], false)}];
	FBSetting.methods = [{prop: "ToFBInterface", name: "ToFBInterface", pkg: "", typ: $funcType([], [mapType], false)}];
	WtPluginDefinition.methods = [{prop: "ToFBInterface", name: "ToFBInterface", pkg: "", typ: $funcType([], [mapType], false)}];
	ptrType.methods = [{prop: "Initialize", name: "Initialize", pkg: "", typ: $funcType([$Bool, funcType], [], false)}, {prop: "NewDashboard", name: "NewDashboard", pkg: "", typ: $funcType([], [], false)}, {prop: "Serialize", name: "Serialize", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "LoadDashboard", name: "LoadDashboard", pkg: "", typ: $funcType([ptrType$1, ptrType$1], [], false)}, {prop: "SetEditing", name: "SetEditing", pkg: "", typ: $funcType([ptrType$1, ptrType$1], [], false)}, {prop: "IsEditing", name: "IsEditing", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "LoadDatasourcePlugin", name: "LoadDatasourcePlugin", pkg: "", typ: $funcType([ptrType$1], [], false)}, {prop: "LoadGoDatasourcePlugin", name: "LoadGoDatasourcePlugin", pkg: "", typ: $funcType([DsPluginDefinition], [], false)}, {prop: "LoadWidgetPlugin", name: "LoadWidgetPlugin", pkg: "", typ: $funcType([ptrType$1], [], false)}, {prop: "LoadGoWidgetPlugin", name: "LoadGoWidgetPlugin", pkg: "", typ: $funcType([WtPluginDefinition], [], false)}, {prop: "ShowLoadingIndicator", name: "ShowLoadingIndicator", pkg: "", typ: $funcType([ptrType$1], [], false)}, {prop: "ShowDialog", name: "ShowDialog", pkg: "", typ: $funcType([dom.HTMLElement, $String, $String, $String, $emptyInterface], [], false)}, {prop: "GetDatasourceSettings", name: "GetDatasourceSettings", pkg: "", typ: $funcType([$String], [ptrType$1], false)}, {prop: "SetDatasourceSettings", name: "SetDatasourceSettings", pkg: "", typ: $funcType([$String, ptrType$1], [], false)}, {prop: "On", name: "On", pkg: "", typ: $funcType([$String, ptrType$1], [], false)}];
	DsPlugin.init([{prop: "CurrentSettings", name: "CurrentSettings", pkg: "", typ: $funcType([], [ptrType$1], false)}, {prop: "OnDispose", name: "OnDispose", pkg: "", typ: $funcType([], [], false)}, {prop: "OnSettingsChanged", name: "OnSettingsChanged", pkg: "", typ: $funcType([ptrType$1], [], false)}, {prop: "UpdateNow", name: "UpdateNow", pkg: "", typ: $funcType([], [], false)}]);
	DsPluginDefinition.init([{prop: "TypeName", name: "TypeName", pkg: "", typ: $String, tag: ""}, {prop: "DisplayName", name: "DisplayName", pkg: "", typ: $String, tag: ""}, {prop: "Description", name: "Description", pkg: "", typ: $String, tag: ""}, {prop: "ExternalScripts", name: "ExternalScripts", pkg: "", typ: sliceType, tag: ""}, {prop: "Settings", name: "Settings", pkg: "", typ: sliceType$6, tag: ""}, {prop: "NewInstance", name: "NewInstance", pkg: "", typ: funcType$11, tag: ""}]);
	FBSettingOpt.init([{prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}, {prop: "Value", name: "Value", pkg: "", typ: $String, tag: ""}]);
	FBSettingSet.init([{prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}, {prop: "DisplayName", name: "DisplayName", pkg: "", typ: $String, tag: ""}, {prop: "Type", name: "Type", pkg: "", typ: settingType, tag: ""}]);
	FBSetting.init([{prop: "Name", name: "Name", pkg: "", typ: $String, tag: ""}, {prop: "DisplayName", name: "DisplayName", pkg: "", typ: $String, tag: ""}, {prop: "Description", name: "Description", pkg: "", typ: $String, tag: ""}, {prop: "Type", name: "Type", pkg: "", typ: settingType, tag: ""}, {prop: "Options", name: "Options", pkg: "", typ: sliceType$7, tag: ""}, {prop: "Settings", name: "Settings", pkg: "", typ: sliceType$8, tag: ""}, {prop: "DefaultStringValue", name: "DefaultStringValue", pkg: "", typ: $String, tag: ""}, {prop: "DefaultIntValue", name: "DefaultIntValue", pkg: "", typ: $Int, tag: ""}, {prop: "DefaultFloatValue", name: "DefaultFloatValue", pkg: "", typ: $Float64, tag: ""}]);
	WidgetPlugin.init([{prop: "GetHeight", name: "GetHeight", pkg: "", typ: $funcType([], [$Int], false)}, {prop: "OnCalculatedValueChanged", name: "OnCalculatedValueChanged", pkg: "", typ: $funcType([$String, $emptyInterface], [], false)}, {prop: "OnDispose", name: "OnDispose", pkg: "", typ: $funcType([], [], false)}, {prop: "OnSettingsChanged", name: "OnSettingsChanged", pkg: "", typ: $funcType([mapType], [], false)}, {prop: "Render", name: "Render", pkg: "", typ: $funcType([dom.HTMLElement], [], false)}]);
	WtPluginDefinition.init([{prop: "TypeName", name: "TypeName", pkg: "", typ: $String, tag: ""}, {prop: "DisplayName", name: "DisplayName", pkg: "", typ: $String, tag: ""}, {prop: "Description", name: "Description", pkg: "", typ: $String, tag: ""}, {prop: "FillSize", name: "FillSize", pkg: "", typ: $Bool, tag: ""}, {prop: "ExternalScripts", name: "ExternalScripts", pkg: "", typ: sliceType, tag: ""}, {prop: "Settings", name: "Settings", pkg: "", typ: sliceType$6, tag: ""}, {prop: "NewInstance", name: "NewInstance", pkg: "", typ: funcType$12, tag: ""}]);
	FBWrapper.init([{prop: "FreeboardObject", name: "FreeboardObject", pkg: "", typ: ptrType$1, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = errors.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = json.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = dom.$init(); /* */ $s = 4; case 4: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = reflect.$init(); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = time.$init(); /* */ $s = 6; case 6: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.FB = ptrType.nil;
		$pkg.SettingTextType = "text";
		$pkg.SettingNumberType = "number";
		$pkg.SettingCalculatedType = "calculated";
		$pkg.SettingOptionType = "option";
		$pkg.SettingArrayType = "array";
		init();
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$packages["main"] = (function() {
	var $pkg = {}, $init, gdocstojson, freeboard, js, GDocsPlugin, sliceType, sliceType$1, sliceType$2, sliceType$3, ptrType, ptrType$1, funcType, chanType, main;
	gdocstojson = $packages["github.com/cathalgarvey/gdocstojson"];
	freeboard = $packages["github.com/cathalgarvey/go-freeboard"];
	js = $packages["github.com/gopherjs/gopherjs/js"];
	GDocsPlugin = $pkg.GDocsPlugin = $newType(0, $kindStruct, "main.GDocsPlugin", "GDocsPlugin", "main", function(UpdateFunc_, settings_, closeToKillUpdate_) {
		this.$val = this;
		if (arguments.length === 0) {
			this.UpdateFunc = $throwNilPointerError;
			this.settings = null;
			this.closeToKillUpdate = $chanNil;
			return;
		}
		this.UpdateFunc = UpdateFunc_;
		this.settings = settings_;
		this.closeToKillUpdate = closeToKillUpdate_;
	});
	sliceType = $sliceType($String);
	sliceType$1 = $sliceType(freeboard.FBSetting);
	sliceType$2 = $sliceType(freeboard.FBSettingOpt);
	sliceType$3 = $sliceType(freeboard.FBSettingSet);
	ptrType = $ptrType(js.Object);
	ptrType$1 = $ptrType(GDocsPlugin);
	funcType = $funcType([$emptyInterface], [], false);
	chanType = $chanType($emptyInterface, false, false);
	GDocsPlugin.ptr.prototype.CurrentSettings = function() {
		var $ptr, gdp;
		gdp = this;
		return gdp.settings;
	};
	GDocsPlugin.prototype.CurrentSettings = function() { return this.$val.CurrentSettings(); };
	GDocsPlugin.ptr.prototype.OnSettingsChanged = function(settings) {
		var $ptr, gdp, settings;
		gdp = this;
		gdp.settings = settings;
		gdp.UpdateNow();
	};
	GDocsPlugin.prototype.OnSettingsChanged = function(settings) { return this.$val.OnSettingsChanged(settings); };
	GDocsPlugin.ptr.prototype.getDocURL = function() {
		var $ptr, gdp;
		gdp = this;
		return $internalize(gdp.settings.gdocUrl, $String);
	};
	GDocsPlugin.prototype.getDocURL = function() { return this.$val.getDocURL(); };
	GDocsPlugin.ptr.prototype.UpdateNow = function() {
		var $ptr, gdp;
		gdp = this;
		$go((function $b() {
			var $ptr, _r, _r$1, _tuple, data, err, url, $s, $r;
			/* */ $s = 0; var $f, $c = false; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $ptr = $f.$ptr; _r = $f._r; _r$1 = $f._r$1; _tuple = $f._tuple; data = $f.data; err = $f.err; url = $f.url; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
			url = gdp.getDocURL();
			_r = gdocstojson.GetSaneGDocsJSON(url); /* */ $s = 1; case 1: if($c) { $c = false; _r = _r.$blk(); } if (_r && _r.$blk !== undefined) { break s; }
			_tuple = _r;
			data = _tuple[0];
			err = _tuple[1];
			/* */ if (!($interfaceIsEqual(err, $ifaceNil))) { $s = 2; continue; }
			/* */ $s = 3; continue;
			/* if (!($interfaceIsEqual(err, $ifaceNil))) { */ case 2:
				_r$1 = err.Error(); /* */ $s = 4; case 4: if($c) { $c = false; _r$1 = _r$1.$blk(); } if (_r$1 && _r$1.$blk !== undefined) { break s; }
				console.log(_r$1);
			/* } */ case 3:
			$r = gdp.UpdateFunc(data); /* */ $s = 5; case 5: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
			/* */ $s = -1; case -1: } return; } if ($f === undefined) { $f = { $blk: $b }; } $f.$ptr = $ptr; $f._r = _r; $f._r$1 = _r$1; $f._tuple = _tuple; $f.data = data; $f.err = err; $f.url = url; $f.$s = $s; $f.$r = $r; return $f;
		}), []);
	};
	GDocsPlugin.prototype.UpdateNow = function() { return this.$val.UpdateNow(); };
	GDocsPlugin.ptr.prototype.OnDispose = function() {
		var $ptr, gdp;
		gdp = this;
		$close(gdp.closeToKillUpdate);
	};
	GDocsPlugin.prototype.OnDispose = function() { return this.$val.OnDispose(); };
	main = function() {
		var $ptr;
		console.log("Registering googledocs plugin");
		freeboard.FB.LoadGoDatasourcePlugin($pkg.GDocsPluginDefinition);
	};
	ptrType$1.methods = [{prop: "CurrentSettings", name: "CurrentSettings", pkg: "", typ: $funcType([], [ptrType], false)}, {prop: "OnSettingsChanged", name: "OnSettingsChanged", pkg: "", typ: $funcType([ptrType], [], false)}, {prop: "getDocURL", name: "getDocURL", pkg: "main", typ: $funcType([], [$String], false)}, {prop: "UpdateNow", name: "UpdateNow", pkg: "", typ: $funcType([], [], false)}, {prop: "OnDispose", name: "OnDispose", pkg: "", typ: $funcType([], [], false)}];
	GDocsPlugin.init([{prop: "UpdateFunc", name: "UpdateFunc", pkg: "", typ: funcType, tag: ""}, {prop: "settings", name: "settings", pkg: "main", typ: ptrType, tag: ""}, {prop: "closeToKillUpdate", name: "closeToKillUpdate", pkg: "main", typ: chanType, tag: ""}]);
	$init = function() {
		$pkg.$init = function() {};
		/* */ var $f, $c = false, $s = 0, $r; if (this !== undefined && this.$blk !== undefined) { $f = this; $c = true; $s = $f.$s; $r = $f.$r; } s: while (true) { switch ($s) { case 0:
		$r = gdocstojson.$init(); /* */ $s = 1; case 1: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = freeboard.$init(); /* */ $s = 2; case 2: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$r = js.$init(); /* */ $s = 3; case 3: if($c) { $c = false; $r = $r.$blk(); } if ($r && $r.$blk !== undefined) { break s; }
		$pkg.GDocsPluginDefinition = new freeboard.DsPluginDefinition.ptr("googledocs_sheet", "GoogleDocs Sheet", "This plugin enables pulling data from a GoogleDocs spreadsheet that has been published as HTML.", sliceType.nil, new sliceType$1([new freeboard.FBSetting.ptr("gdocUrl", "HTML URL", "URL of the published data as HTML", freeboard.SettingTextType, sliceType$2.nil, sliceType$3.nil, "", 0, 0), new freeboard.FBSetting.ptr("updateInterval", "Update Interval", "How often to update the data source", freeboard.SettingNumberType, sliceType$2.nil, sliceType$3.nil, "", 60, 0)]), (function(settings, updateCallback) {
			var $ptr, pl, settings, updateCallback, updateDuration;
			pl = new GDocsPlugin.ptr($throwNilPointerError, null, $chanNil);
			pl.settings = settings;
			pl.UpdateFunc = updateCallback;
			updateDuration = $parseInt(settings.updateInterval) >> 0;
			pl.closeToKillUpdate = freeboard.MakeUpdateTicker(pl, updateDuration);
			return pl;
		}));
		if ($pkg === $mainPkg) {
			main();
			$mainFinished = true;
		}
		/* */ } return; } if ($f === undefined) { $f = { $blk: $init }; } $f.$s = $s; $f.$r = $r; return $f;
	};
	$pkg.$init = $init;
	return $pkg;
})();
$synthesizeMethods();
var $mainPkg = $packages["main"];
$packages["runtime"].$init();
$go($mainPkg.$init, [], true);
$flushConsole();

}).call(this);
//# sourceMappingURL=freeboardplugin.js.map
