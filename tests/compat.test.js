const assert = require('assert');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.join(__dirname, '..', 'sjtu-speedup.user.js'), 'utf8');

assert.match(script, /\/\/ @grant\s+none/, 'must run in the page realm for Safari Userscripts');
assert.match(script, /\/\/ @inject-into\s+page/);
assert.doesNotMatch(script, /unsafeWindow/, 'Safari Userscripts has no unsafeWindow');
assert.doesNotMatch(script, /GM_(get|set)Value/, 'must not depend on Tampermonkey-only storage');
assert.match(script, /localStorage\.getItem\('sjtu-speeder:rate'\)/);
assert.match(script, /localStorage\.setItem\('sjtu-speeder:rate'/);
assert.match(script, /https:\/\/v\.sjtu\.edu\.cn\/jy-application-resourcemanage-ui\/\*/);
assert.match(script, /KMediaUniPool/, 'must drive both KMedia players, not only one <video>');
assert.match(script, /presets:\s*\[0\.5,\s*0\.75,\s*1,\s*1\.25,\s*1\.5,\s*2,\s*2\.5,\s*3\]/);
assert.match(script, /KeyO/);
assert.match(script, /KeyP/);
assert.match(script, /holdBoost:\s*1\.5/);
assert.match(script, /holdSlow:\s*0\.5/);
assert.match(script, /Math\.round\(n \* 100\) \/ 100/, '0.75 and 1.25 must survive rounding');
assert.doesNotMatch(
  script,
  /HTMLMediaElement\.prototype/,
  'must not patch the browser-wide media prototype'
);

function isolate(name) {
  const start = script.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, name);
  let depth = 0;
  let seen = false;
  for (let i = script.indexOf('{', start); i < script.length; i += 1) {
    if (script[i] === '{') {
      depth += 1;
      seen = true;
    } else if (script[i] === '}') {
      depth -= 1;
      if (seen && depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`could not isolate ${name}`);
}

const CONFIG = { min: 0.1, max: 10 };
const sandbox = { CONFIG, Math, Number, String, isFinite: Number.isFinite };
for (const name of [
  'clampRate',
  'roundRate',
  'effectiveRate',
  'parseCustomRate',
  'formatMenuRate',
  'needsSmoothRate',
  'sampleAtTime',
]) {
  // eslint-disable-next-line no-new-func
  sandbox[name] = new Function(
    ...Object.keys(sandbox),
    `${isolate(name)}; return ${name};`
  )(...Object.values(sandbox));
}

assert.strictEqual(sandbox.roundRate(0.75), 0.75);
assert.strictEqual(sandbox.roundRate(1.25), 1.25);
assert.strictEqual(sandbox.effectiveRate(2, 1.5), 3);
assert.strictEqual(sandbox.effectiveRate(1.25, 1.5), 1.88);
assert.strictEqual(sandbox.effectiveRate(0.75, 0.5), 0.38);
assert.strictEqual(sandbox.parseCustomRate(''), null);
assert.strictEqual(sandbox.parseCustomRate('11'), 10);
assert.strictEqual(sandbox.parseCustomRate('0.03'), 0.1);
assert.strictEqual(sandbox.formatMenuRate(1), '1X');
assert.strictEqual(sandbox.formatMenuRate(0.75), '0.75X');
assert.strictEqual(sandbox.formatMenuRate(2.5), '2.5X');
assert.strictEqual(sandbox.needsSmoothRate(2, true, true), false);
assert.strictEqual(sandbox.needsSmoothRate(2.5, true, true), true);
assert.strictEqual(sandbox.needsSmoothRate(3, false, true), false);
assert.strictEqual(sandbox.needsSmoothRate(3, true, false), false);
const pts = new Float32Array([0, 0.04, 0.08, 3, 3.04]);
const key = new Uint8Array([1, 0, 0, 1, 0]);
assert.strictEqual(sandbox.sampleAtTime(pts, key, 0.09), 0);
assert.strictEqual(sandbox.sampleAtTime(pts, key, 3.04), 3);
assert.strictEqual(sandbox.sampleAtTime(pts, key, 0), 0);

console.log('sjtu speeder compat: ok');
