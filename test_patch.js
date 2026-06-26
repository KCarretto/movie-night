const assert = require('assert');

let v = [new Float32Array([1.1, 2.2])];

const isFloatVec = (vec) => (Array.isArray(vec) || ArrayBuffer.isView(vec)) && vec.length > 0 && vec.length <= 2048
    && Array.from(vec).every((n) => typeof n === 'number' && isFinite(n));

console.log(v.every(isFloatVec));
