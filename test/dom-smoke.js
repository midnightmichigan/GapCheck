/* DOM smoke test: runs app.js against stub DOM, clicks through Analyze. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const G = require('../analyzer.js');

function makeEl(id) {
  const el = {
    id, value: '', textContent: '', innerHTML: '',
    style: {}, disabled: false,
    _listeners: {}, _children: [],
    classList: { add() {}, remove() {} },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    appendChild(c) { this._children.push(c); return c; },
    closest() { return { classList: { add() {}, remove() {} } }; },
    scrollIntoView() {},
    select() {},
    click() { (this._listeners['click'] || []).forEach(f => f()); },
  };
  return el;
}

const ids = ['posting', 'resume', 'posting-count', 'resume-count', 'btn-analyze',
  'btn-sample', 'btn-clear', 'error', 'results', 'score-num', 'score-band',
  'score-fill', 'count-hit', 'count-part', 'count-miss', 'score-note',
  'alias-row', 'alias-chips', 'missing-list', 'partial-list', 'matched-list',
  'matched-n', 'fixlist-label', 'fixlist-fill', 'btn-copy'];
const elements = {};
ids.forEach(id => { elements[id] = makeEl(id); });

const store = {};
let domReady = null;
const sandbox = {
  window: { GapCheck: G },
  document: {
    getElementById: id => {
      assert.ok(elements[id], 'app.js referenced unknown element id: ' + id);
      return elements[id];
    },
    addEventListener(ev, fn) {
      if (ev === 'DOMContentLoaded') domReady = fn; // invoke synchronously below
    },
    createElement: tag => makeEl('dyn-' + tag),
    querySelectorAll: () => [],
    execCommand: () => true,
    body: makeEl('body'),
  },
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  navigator: {},
  setTimeout: (fn) => { fn(); return 0; }, // run immediately for test
  clearTimeout: () => {},
  console,
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const appSrc = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
assert.ok(domReady, 'DOMContentLoaded handler registered');
domReady(); // run synchronously — listeners now attached

const posting = fs.readFileSync(path.join(__dirname, '../samples/sample-posting.txt'), 'utf8');
const resume = fs.readFileSync(path.join(__dirname, '../samples/sample-resume.txt'), 'utf8');

// 1. Load sample via button (app sample has no trailing newline; compare trimmed)
elements['btn-sample'].click();
assert.strictEqual(elements['posting'].value, posting.trimEnd(), 'sample posting loaded');
assert.ok(elements['resume'].value.length > 100, 'sample resume loaded');
assert.ok(store['gapcheck.v1'], 'sample saved to localStorage');
console.log('ok - sample load + localStorage');

// 2. Analyze
elements['btn-analyze'].click();
assert.strictEqual(elements['results'].style.display, 'block', 'results shown');
assert.ok(/^\d+$/.test(elements['score-num'].textContent), 'score rendered: ' + elements['score-num'].textContent);
assert.ok(elements['missing-list']._children.length > 5, 'missing list rendered: ' + elements['missing-list']._children.length);
assert.ok(elements['partial-list']._children.length > 0, 'partial list rendered');
assert.ok(elements['alias-chips'].innerHTML.includes('WMS'), 'alias chips rendered');
assert.strictEqual(elements['error'].style.display, 'none', 'no error shown');
console.log('ok - analyze renders (score ' + elements['score-num'].textContent + ', missing items ' + elements['missing-list']._children.length + ')');

// 3. Error path: too-short inputs
elements['posting'].value = 'short';
elements['resume'].value = 'x';
elements['btn-analyze'].click();
assert.strictEqual(elements['error'].style.display, 'block', 'error shown for short input');
assert.ok(elements['error'].textContent.length > 10, 'error message present');
console.log('ok - error path');

// 4. Clear wipes state
elements['btn-clear'].click();
assert.strictEqual(elements['posting'].value, '', 'posting cleared');
assert.strictEqual(elements['results'].style.display, 'none', 'results hidden');
assert.ok(!store['gapcheck.v1'], 'localStorage cleared');
console.log('ok - clear');

console.log('\nDOM smoke test passed');
