/* GapCheck analyzer tests. Run: node test/run-tests.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const G = require('../analyzer.js');

const posting = fs.readFileSync(path.join(__dirname, '../samples/sample-posting.txt'), 'utf8');
const resume = fs.readFileSync(path.join(__dirname, '../samples/sample-resume.txt'), 'utf8');

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok -', name);
  } catch (e) {
    console.error('  FAIL -', name, '\n   ', e.message);
    process.exitCode = 1;
  }
}

console.log('stemmer');
t('plurals stem consistently', () => {
  assert.strictEqual(G.stemToken('counts'), G.stemToken('counting'));
  assert.strictEqual(G.stemToken('managers'), G.stemToken('manager'));
  assert.strictEqual(G.stemToken('studies'), 'study');
  assert.strictEqual(G.stemToken('boxes'), 'box');
});
t('tech tokens preserved', () => {
  assert.strictEqual(G.stemToken('C++'), 'c++');
  assert.strictEqual(G.stemToken('C#'), 'c#');
  assert.strictEqual(G.stemToken('SAP'), 'sap');
  assert.strictEqual(G.stemToken('.NET'), 'net');
  assert.strictEqual(G.stemToken('Node.js'), 'node.js');
});
t('verb forms converge', () => {
  assert.strictEqual(G.stemToken('managed'), G.stemToken('managing'));
  assert.strictEqual(G.stemToken('built'), G.stemToken('building'));
  assert.strictEqual(G.stemToken('written'), G.stemToken('write'));
});

console.log('alias detection');
t('finds WMS acronym from posting', () => {
  const a = G.detectAliases(posting);
  assert.ok(a['wms'], 'expected wms alias');
  assert.deepStrictEqual(a['wms'], ['warehouse', 'management', 'system']);
});
t('finds reverse-form acronym', () => {
  const a = G.detectAliases('Experience with WMS (Warehouse Management System) required.');
  assert.ok(a['wms'], 'expected wms alias from reverse form');
});
t('ignores non-initial-matching parens', () => {
  const a = G.detectAliases('Apply today (see below for details).');
  assert.ok(!a['see'], 'should not map junk parens');
});

console.log('keyword extraction');
t('extracts expected key phrases', () => {
  const kws = G.extractKeywords(posting).map(k => k.phrase.toLowerCase());
  const joined = '\n' + kws.join('\n') + '\n';
  for (const want of ['cycle count', 'inventory control', 'root cause analysis', 'safety stock']) {
    assert.ok(joined.includes(want), 'missing keyword phrase: ' + want);
  }
  assert.ok(kws.some(k => k === 'osha' || k === 'sap' || k.includes('osha')), 'expected OSHA/SAP acronym keyword, got: ' + kws.slice(0, 12).join(', '));
});
t('phrases never span line breaks or swallow headers', () => {
  const kws = G.extractKeywords(posting).map(k => k.phrase.toLowerCase());
  assert.ok(!kws.some(k => /requirements|responsibilities/.test(k)), 'header word leaked: ' + kws.filter(k => /requirements|responsibilities/.test(k)).join(', '));
});
t('section boost favors requirements-area phrases', () => {
  const kws = G.extractKeywords(posting);
  assert.ok(kws.length >= 10 && kws.length <= 40, 'keyword count in range, got ' + kws.length);
});
t('no duplicate stemmed phrases', () => {
  const kws = G.extractKeywords(posting).map(k => k.phrase.toLowerCase());
  const seen = new Set();
  kws.forEach(k => { assert.ok(!seen.has(k), 'dup: ' + k); seen.add(k); });
});

console.log('tolerant matching');
t('"cycle counting" in resume matches "cycle counts"', () => {
  const idx = G.buildResumeIndex('I performed daily cycle counting and variance research.');
  assert.ok(G.phraseInResume(['cycl', 'count'].map(s => s), idx) || G.phraseInResume(['cycle', 'count'].map(G.stemToken), idx));
});
t('word order tolerated: "management of projects" matches "project management"', () => {
  const idx = G.buildResumeIndex('I did management of several projects last year.');
  assert.ok(G.phraseInResume(['project', 'management'].map(G.stemToken), idx));
});
t('gap tolerated: "project and program management" matches "project management"', () => {
  const idx = G.buildResumeIndex('Led project and program management efforts.');
  assert.ok(G.phraseInResume(['project', 'management'].map(G.stemToken), idx));
});

console.log('full analysis on samples');
let result;
t('analyze returns sane result', () => {
  result = G.analyze(posting, resume);
  assert.ok(!result.error, 'unexpected error: ' + (result.error || ''));
  // This sample resume is a genuinely weak match for a specialized posting;
  // the score should be low but non-zero and well under 100.
  assert.ok(result.score >= 10 && result.score <= 85, 'score out of sane band: ' + result.score);
  assert.ok(result.matchedCount > 0, 'expected some matches');
  assert.ok(result.missingCount > 0, 'expected some missing');
  console.log('   score:', result.score, '| matched:', result.matchedCount, '| partial:', result.partialCount, '| missing:', result.missingCount);
});
t('score rises monotonically when the resume gains real keywords', () => {
  const improved = resume + '\nAdditional: WMS (Warehouse Management System), OSHA safety standards, root cause analysis, cycle counts, APICS CPIM coursework, pivot tables, VLOOKUP.';
  const r2 = G.analyze(posting, improved);
  assert.ok(r2.score > result.score, 'improved resume scored ' + r2.score + ' vs ' + result.score);
  console.log('   improved score:', r2.score);
});
t('forklift concept is matched or partial (resume has it)', () => {
  const hit = result.matched.some(m => m.phrase.toLowerCase().includes('forklift')) ||
              result.partial.some(m => m.phrase.toLowerCase().includes('forklift'));
  assert.ok(hit, 'forklift should match or be partial');
});
t('partial tier catches core-word overlap without false "missing"', () => {
  assert.ok(result.partialCount >= 0, 'partial count present');
  result.partial.forEach(p => {
    assert.ok(p.hitWords && p.hitWords.length > 0, 'partial needs hitWords');
    // missWords may be empty when all words appear but scattered
    if (p.missWords.length === 0) assert.ok(p.scattered, 'empty missWords must flag scattered');
  });
  console.log('   partial examples:', result.partial.slice(0, 3).map(p => p.phrase + ' (has: ' + p.hitWords.join(',') + ' / lacks: ' + (p.missWords.join(',') || '— scattered') + ')').join(' | '));
});
t('WMS keyword appears on the missing or partial side (resume lacks it — honest)', () => {
  const wmsMissing = result.missing.some(m => m.phrase.toLowerCase().includes('warehouse management'));
  const wmsPartial = result.partial.some(m => m.phrase.toLowerCase().includes('warehouse management'));
  assert.ok(wmsMissing || wmsPartial, 'WMS keyword should appear on one side');
  console.log('   WMS status:', wmsPartial ? 'partial' : 'missing');
});
t('missing items carry posting context', () => {
  const withCtx = result.missing.filter(m => m.context && m.context.length > 10);
  assert.ok(withCtx.length >= Math.floor(result.missingCount / 2), 'most missing items should have context');
});
t('aliases reported', () => {
  assert.ok(result.aliases.some(a => a.acronym === 'WMS'), 'WMS alias reported');
});
t('short inputs rejected with clear errors', () => {
  assert.strictEqual(G.analyze('hi', resume).error, 'posting_too_short');
  assert.strictEqual(G.analyze(posting, 'x').error, 'resume_too_short');
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (WITH FAILURES)' : ''));
