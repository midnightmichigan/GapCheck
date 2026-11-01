/* GapCheck UI wiring. Requires analyzer.js (window.GapCheck). No network calls. */
(function () {
  'use strict';

  var SAMPLE_POSTING = [
    'Inventory Control Specialist — Grand Rapids, MI (2nd Shift)',
    '',
    'About the role:',
    'We are hiring an Inventory Control Specialist for our Grand Rapids distribution center. This is a full-time, second-shift position reporting to the Warehouse Supervisor. You will own inventory accuracy across 12,000 SKUs and help us hit our 98% cycle count accuracy target.',
    '',
    'Responsibilities:',
    '- Perform daily cycle counts and reconcile variances in the Warehouse Management System (WMS)',
    '- Investigate inventory discrepancies using root cause analysis and document corrective actions',
    '- Operate a forklift and order picker to access high-bay storage locations',
    '- Process inbound receipts and outbound shipments in SAP',
    '- Maintain FIFO rotation for perishable goods in the cooler',
    '- Partner with the purchasing team on reorder points and safety stock levels',
    '- Prepare weekly inventory accuracy reports for the operations manager',
    '',
    'Requirements:',
    '- 2+ years of experience in inventory control, warehousing, or logistics',
    '- Hands-on experience with a Warehouse Management System (WMS); SAP experience strongly preferred',
    '- Forklift certification (OSHA compliant) — we will recertify on site',
    '- Strong Excel skills including pivot tables and VLOOKUP',
    '- High attention to detail and ability to work independently on second shift',
    '- Ability to lift 50 lbs and stand for extended periods',
    '',
    'Preferred:',
    '- APICS CPIM certification or coursework',
    '- Experience with cycle counting programs in a high-SKU environment',
    '- Knowledge of OSHA safety standards for powered industrial trucks',
    '',
    'Pay: $27.50/hr + shift differential. Benefits after 30 days.'
  ].join('\n');

  var SAMPLE_RESUME = [
    'Dakota McCall — Hastings, MI | 2699537168',
    '',
    'Summary:',
    'Reliable warehouse and logistics worker with 3 years of experience in distribution and inventory support. Forklift certified, comfortable with high-volume environments and second shift schedules.',
    '',
    'Experience:',
    'Warehouse Associate — Regional Distribution Center, Grand Rapids, MI (2023–2026)',
    '- Picked and packed orders averaging 200+ units per shift with 99.1% accuracy',
    '- Operated forklift and pallet jack daily in a high-bay warehouse',
    '- Received inbound freight and verified counts against packing slips',
    '- Used SAP to look up stock locations and print labels',
    '- Helped with quarterly physical inventory counts',
    '- Followed FIFO rotation for perishable products',
    '',
    'Stocker — Retail Store, Ionia, MI (2020–2021)',
    '- Stocked shelves overnight and rotated product by expiration date',
    '- Operated pallet jack to move freight from receiving to the sales floor',
    '',
    'Skills:',
    'Forklift operation, pallet jack, SAP (basic), shipping and receiving, order picking, attention to detail, Microsoft Excel, lifting up to 50 lbs, dependable attendance'
  ].join('\n');

  var LS_KEY = 'gapcheck.v1';

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function updateCounts() {
    $('posting-count').textContent = $('posting').value.length + ' characters';
    $('resume-count').textContent = $('resume').value.length + ' characters';
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        posting: $('posting').value,
        resume: $('resume').value
      }));
    } catch (e) { /* storage unavailable — non-fatal */ }
  }

  function restoreLocal() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.posting) $('posting').value = d.posting;
      if (d.resume) $('resume').value = d.resume;
    } catch (e) { /* ignore */ }
  }

  function showError(msg) {
    var el = $('error');
    el.textContent = msg;
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() { $('error').style.display = 'none'; }

  function bandFor(score) {
    if (score >= 75) return 'Strong keyword coverage (heuristic)';
    if (score >= 50) return 'Partial coverage — a few targeted, truthful tweaks could help';
    return 'Large gaps — this resume speaks a different language than this posting';
  }

  function renderPartialWords(p) {
    var viaSet = {};
    (p.aliasWords || []).forEach(function (w) { viaSet[w] = true; });
    var has = p.hitWords.map(function (w) {
      return '<span class="has">' + esc(w) + '</span>' + (viaSet[w] ? ' <span class="via">(via acronym)</span>' : '');
    }).join(', ');
    var lacks = p.missWords.length
      ? p.missWords.map(function (w) { return '<span class="lacks">' + esc(w) + '</span>'; }).join(', ')
      : '<span class="has">— all words appear, but scattered, not as a phrase</span>';
    return '<div class="kw-words">Resume mentions: ' + has + '<br>Not shown as a phrase: ' + lacks + '</div>';
  }

  var lastResult = null;

  function render(result) {
    lastResult = result;
    $('results').style.display = 'block';
    $('score-num').textContent = result.score;
    $('score-band').textContent = bandFor(result.score);
    $('score-fill').style.width = result.score + '%';
    $('count-hit').textContent = result.matchedCount;
    $('count-part').textContent = result.partialCount;
    $('count-miss').textContent = result.missingCount;
    $('score-note').textContent = result.note +
      ' Analyzed ' + result.totalKeywords + ' key terms from this posting.';

    if (result.aliases && result.aliases.length) {
      $('alias-row').style.display = 'block';
      $('alias-chips').innerHTML = result.aliases.map(function (a) {
        return '<span class="alias-chip">' + esc(a.acronym) + ' = ' + esc(a.expansion) + '</span>';
      }).join('');
    } else {
      $('alias-row').style.display = 'none';
    }

    // Missing — the fix list, with per-item checkboxes.
    var ml = $('missing-list');
    ml.innerHTML = '';
    if (!result.missing.length) {
      ml.innerHTML = '<p>No missing keywords — every extracted term is covered or partially mentioned.</p>';
    }
    result.missing.forEach(function (m, i) {
      var div = document.createElement('div');
      div.className = 'kw';
      div.innerHTML =
        '<div class="kw-top"><span class="kw-phrase">' + esc(m.phrase) + '</span>' +
        '<span class="kw-tag miss">missing</span></div>' +
        (m.context ? '<div class="kw-ctx">“' + esc(m.context) + '”</div>' : '') +
        '<label class="kw-check"><input type="checkbox" data-i="' + i + '"> ' +
        '<span>I genuinely have this — added truthfully to my resume (or confirmed it does not apply to me)</span></label>';
      ml.appendChild(div);
    });
    updateFixlistProgress();

    // Partial.
    var pl = $('partial-list');
    pl.innerHTML = '';
    if (!result.partial.length) {
      pl.innerHTML = '<p>Nothing partially mentioned.</p>';
    }
    result.partial.forEach(function (p) {
      var div = document.createElement('div');
      div.className = 'kw';
      div.innerHTML =
        '<div class="kw-top"><span class="kw-phrase">' + esc(p.phrase) + '</span>' +
        '<span class="kw-tag part">' + (p.scattered ? 'mentioned separately' : 'partial') + '</span></div>' +
        renderPartialWords(p) +
        (p.context ? '<div class="kw-ctx">“' + esc(p.context) + '”</div>' : '');
      pl.appendChild(div);
    });

    // Matched (collapsed).
    $('matched-n').textContent = result.matchedCount;
    $('matched-list').innerHTML = result.matched.map(function (m) {
      return '<span class="matched-pill">' + esc(m.phrase) + '</span>';
    }).join('');

    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function updateFixlistProgress() {
    var boxes = document.querySelectorAll('#missing-list input[type=checkbox]');
    var done = 0;
    boxes.forEach(function (b) {
      if (b.checked) {
        done++;
        b.closest('.kw').classList.add('done');
      } else {
        b.closest('.kw').classList.remove('done');
      }
    });
    var total = boxes.length;
    $('fixlist-label').textContent = 'Fix-list progress: ' + done + ' of ' + total + ' addressed';
    $('fixlist-fill').style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  }

  function buildMarkdown() {
    if (!lastResult) return '';
    var r = lastResult;
    var lines = [];
    lines.push('# GapCheck report');
    lines.push('');
    lines.push('Keyword coverage: **' + r.score + '/100** (heuristic estimate — ' +
      r.matchedCount + ' covered, ' + r.partialCount + ' partial, ' + r.missingCount +
      ' missing, of ' + r.totalKeywords + ' key terms).');
    lines.push('');
    lines.push('> ' + r.note);
    lines.push('');
    if (r.missing.length) {
      lines.push('## Missing — review each truthfully');
      lines.push('');
      r.missing.forEach(function (m) {
        lines.push('- [ ] **' + m.phrase + '**' + (m.context ? ' — "' + m.context + '"' : ''));
      });
      lines.push('');
    }
    if (r.partial.length) {
      lines.push('## Partially mentioned');
      lines.push('');
      r.partial.forEach(function (p) {
        lines.push('- **' + p.phrase + '** — resume shows: ' + p.hitWords.join(', ') +
          '; not as a phrase: ' + (p.missWords.join(', ') || 'n/a (scattered)'));
      });
      lines.push('');
    }
    lines.push('_Generated locally by GapCheck. Only add keywords that truthfully describe you._');
    return lines.join('\n');
  }

  function analyze() {
    hideError();
    if (!window.GapCheck) {
      showError('Analyzer failed to load (analyzer.js missing).');
      return;
    }
    var btn = $('btn-analyze');
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    // Let the UI paint before the (fast, synchronous) analysis runs.
    setTimeout(function () {
      try {
        var result = window.GapCheck.analyze($('posting').value, $('resume').value);
        if (result.error) {
          showError(result.message);
        } else {
          saveLocal();
          render(result);
        }
      } catch (e) {
        showError('Something went wrong during analysis: ' + (e && e.message ? e.message : e));
      }
      btn.disabled = false;
      btn.textContent = 'Analyze gap';
    }, 30);
  }

  document.addEventListener('DOMContentLoaded', function () {
    restoreLocal();
    updateCounts();
    $('posting').addEventListener('input', updateCounts);
    $('resume').addEventListener('input', updateCounts);
    $('btn-analyze').addEventListener('click', analyze);
    $('btn-sample').addEventListener('click', function () {
      hideError();
      $('posting').value = SAMPLE_POSTING;
      $('resume').value = SAMPLE_RESUME;
      updateCounts();
      saveLocal();
    });
    $('btn-clear').addEventListener('click', function () {
      hideError();
      $('posting').value = '';
      $('resume').value = '';
      $('results').style.display = 'none';
      lastResult = null;
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      updateCounts();
    });
    $('missing-list').addEventListener('change', updateFixlistProgress);
    $('btn-copy').addEventListener('click', function () {
      var md = buildMarkdown();
      if (!md) return;
      var done = function () {
        var b = $('btn-copy');
        b.textContent = 'Copied!';
        setTimeout(function () { b.textContent = 'Copy fix-list as Markdown'; }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(md).then(done, function () { fallbackCopy(md); done(); });
      } else {
        fallbackCopy(md);
        done();
      }
    });
  });

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
  }
})();
