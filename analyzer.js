/* GapCheck analyzer — pure logic, no DOM access.
 *
 * What it honestly is: deterministic text heuristics.
 *  - Keyword extraction: RAKE-style (Rapid Automatic Keyword Extraction) statistics —
 *    candidate phrases are scored by word frequency/co-occurrence. No ML model.
 *  - Matching: "tolerant" comparison — light stemming, word-order tolerance,
 *    acronym/alias equivalence parsed from the posting itself.
 *  - No network calls, no tracking, no model weights. Runs 100% client-side.
 *
 * Loads in a browser as window.GapCheck and in Node via module.exports.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.GapCheck = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Word lists
  // ---------------------------------------------------------------------------

  var STOPWORDS = new Set(
    ('a,an,and,are,as,at,be,been,but,by,for,from,has,have,had,he,her,hers,' +
      'him,his,i,in,into,is,it,its,of,on,or,our,ours,she,so,such,than,that,' +
      'the,their,them,they,this,to,was,we,were,will,with,you,your,yours,' +
      'about,above,across,after,again,against,all,almost,also,among,around,' +
      'because,before,between,both,could,did,do,does,doing,down,during,each,' +
      'few,further,here,how,however,just,like,more,most,much,must,my,need,' +
      'needs,no,nor,not,now,off,often,once,only,other,own,same,should,since,' +
      'some,still,take,taken,taking,then,there,these,those,through,under,' +
      'until,up,upon,us,use,used,using,very,via,wasn,weren,what,when,where,' +
      'which,while,who,whom,whose,why,would,yet,yourself,ourselves,themselves,' +
      'may,might,shall,can,cannot,able,etc,eg,ie,per,within,without,every,' +
      'any,each,another,anyone,everyone,something,anything,nothing,everything,' +
      'well,along,toward,towards,upon,amongst,amid,among,regarding,including,' +
      'according,across,behind,beyond,plus,except,either,neither,both,half,' +
      'several,various,such,certain,rather,quite,pretty,simply,merely,almost,' +
      'nearly,hardly,scarcely,barely,always,never,often,sometimes,usually,' +
      'generally,typically,normally,currently,recently,lately,soon,already,' +
      'still,even,also,too,either,else,otherwise,rather,therefore,thus,hence,' +
      'accordingly,consequently,meanwhile,whereas,although,though,unless,until,' +
      'whether,while,wherever,whenever,whatever,whichever,whoever,whomever'
    ).split(',')
  );

  // Boilerplate words common in postings that are not skills/requirements.
  var BOILERPLATE = new Set(
    ('job,role,position,company,team,teams,work,working,worker,help,helps,' +
      'join,joining,opportunity,career,apply,applying,applicant,candidate,' +
      'hiring,hire,day,days,week,weeks,month,months,year,years,full,time,' +
      'part,fulltime,parttime,onsite,remote,hybrid,shift,shifts,location,' +
      'based,pay,salary,benefits,benefit,offer,offers,offering,looking,' +
      'seeking,searching,need,needs,needed,wanted,ideal,great,good,best,' +
      'excellent,strong,proven,passionate,driven,motivated,energetic,' +
      'dynamic,fast,paced,detail,oriented,self,starter,environment,ensure,' +
      'including,include,includes,involves,involve,related,various,multiple,' +
      'duties,duty,tasks,task,activities,activity,responsible,perform,' +
      'maintain,assist,support,provide,handle,complete,meet,able,ability,' +
      'willing,willingness,required,requirement,requirements,preferred,' +
      'plus,bonus,desired,minimum,min,maximum,max,least,etc,others,other,' +
      'employer,employee,staff,member,members,department,organization,' +
      'business,industry,field,area,areas,level,levels,range,open,opening,' +
      'experience,first,second'
    ).split(',')
  );

  // Small curated alias list for common tech acronyms (documented, fixed).
  // Posting-derived aliases (e.g. "Warehouse Management System (WMS)") take
  // precedence and are detected automatically per posting.
  var CURATED_ALIASES = {
    js: ['javascript'],
    k8s: ['kubernetes'],
    ml: ['machine', 'learning'],
    ai: ['artificial', 'intelligence'],
    db: ['database'],
    ui: ['user', 'interface'],
    ux: ['user', 'experience'],
    qa: ['quality', 'assurance'],
    hr: ['human', 'resources'],
    crm: ['customer', 'relationship', 'management']
  };

  // Words that start posting sections — treated as separators so they never
  // leak into extracted phrases ("operations manager Requirements").
  var HEADER_WORDS = new Set(
    'requirements,responsibilities,qualifications,preferred,summary,description,about'.split(',')
  );

  // ---------------------------------------------------------------------------
  // Tokenizing + stemming
  // ---------------------------------------------------------------------------

  // Keeps tech tokens intact: C++, C#, .NET, Node.js, e-mail, high-bay.
  // Trailing +/# runs are kept (C++, C#); a trailing "." is dropped ("end.").
  var TOKEN_RE = /\.?(?:[A-Za-z0-9]+(?:[.#'\-&/][A-Za-z0-9]+)*(?:[+#]+)?)/g;

  function tokenizeWithLines(text) {
    var out = [];
    var lines = String(text).split(/\r?\n/);
    for (var li = 0; li < lines.length; li++) {
      TOKEN_RE.lastIndex = 0;
      var m;
      while ((m = TOKEN_RE.exec(lines[li])) !== null) {
        out.push({ t: m[0], line: li });
      }
    }
    return out;
  }

  // Light inflectional stemmer. Deterministic, English-only, heuristic —
  // documented as such. Handles plurals and -ing/-ed so "cycle counts" matches
  // "cycle counting".
  // Common irregular verb forms -> base, so "built" matches "building".
  // Small, fixed, documented list — not a guesser.
  var IRREGULARS = {
    built: 'build', taught: 'teach', thought: 'think', brought: 'bring',
    bought: 'buy', sent: 'send', spent: 'spend', lent: 'lend',
    left: 'leave', felt: 'feel', dealt: 'deal', meant: 'mean',
    kept: 'keep', slept: 'sleep', lost: 'lose', shot: 'shoot',
    written: 'write', driven: 'drive', chosen: 'choose', broken: 'break',
    spoken: 'speak', taken: 'take', given: 'give', done: 'do'
  };

  function stemToken(raw) {
    var w = String(raw).toLowerCase()
      .replace(/^[^a-z0-9]+/, '')   // leading junk (".NET" -> "net")
      .replace(/[^a-z0-9+#]+$/, ''); // trailing junk, keep + and # ("C++" stays)
    if (!w || w.length <= 2) return w;
    if (IRREGULARS[w]) return IRREGULARS[w];
    // Keep tech tokens (c++, c#, node.js) verbatim after edge cleanup.
    if (/[+#]/.test(w) || /\.[a-z]/.test(w)) return w;
    if (w.endsWith('sses')) return w.slice(0, -2);          // classes -> class
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'; // studies -> study
    if (/(ss|us)$/.test(w)) return w;                        // class, bus
    if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2); // boxes -> box
    if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss')) return w.slice(0, -1);
    if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
    if (w.endsWith('eed') && w.length > 4) return w;         // agreed, feed
    if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
    return w;
  }

  function stemPhrase(words) {
    return words.map(stemToken).filter(function (w) { return w; });
  }

  // ---------------------------------------------------------------------------
  // Acronym / alias detection from the posting itself
  // ---------------------------------------------------------------------------
  // Finds "Warehouse Management System (WMS)" and "WMS (Warehouse Management
  // System)" patterns. Validates that the acronym matches the phrase initials
  // so "(see below)" style parentheticals are ignored.

  function initialsOfWords(words) {
    return words.map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  }

  function detectAliases(text) {
    var map = {}; // lowercase acronym -> array of lowercase expansion words
    var seen = {};
    function add(acronym, words) {
      var key = acronym.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      map[key] = words.map(function (w) { return w.toLowerCase(); });
    }
    // "Warehouse Management System (WMS)": take the last N words before the
    // paren where N = acronym length, and require the initials to match.
    // This avoids the lazy-quantifier trap of swallowing the whole sentence.
    var re1 = /((?:[A-Za-z][A-Za-z0-9&'\-]*\s+){1,8})\(([A-Za-z0-9&]{2,10})\)/g;
    var m;
    while ((m = re1.exec(text)) !== null) {
      var letters = m[2].toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^[A-Z0-9]{2,}$/.test(letters)) continue;
      var words = m[1].trim().split(/\s+/);
      var cand = words.slice(-letters.length);
      if (cand.length < letters.length) continue;
      if (initialsOfWords(cand) === letters) add(letters, cand);
    }
    // Reverse form: "WMS (Warehouse Management System)".
    var re2 = /\b([A-Z0-9&]{2,10})\s*\(((?:[A-Za-z][A-Za-z0-9&'\-]*\s*){1,8})\)/g;
    while ((m = re2.exec(text)) !== null) {
      var letters2 = m[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!/^[A-Z0-9]{2,}$/.test(letters2)) continue;
      var words2 = m[2].trim().split(/\s+/);
      var cand2 = words2.slice(0, letters2.length);
      if (cand2.length < letters2.length) continue;
      if (initialsOfWords(cand2) === letters2) add(letters2, cand2);
    }
    // Curated fallbacks (posting-derived wins).
    Object.keys(CURATED_ALIASES).forEach(function (k) {
      if (!seen[k]) map[k] = CURATED_ALIASES[k].slice();
    });
    return map;
  }

  // ---------------------------------------------------------------------------
  // RAKE-style keyword extraction
  // ---------------------------------------------------------------------------

  var HEADER_RE = /^\s*(requirements?|qualifications?|must[-\s]?haves?|what you('ll| will) (bring|need)|preferred qualifications|nice[-\s]?to[-\s]?haves?|responsibilities|about the (role|job)|job (summary|description))\b/i;

  function isSeparator(tok) {
    var low = tok.toLowerCase();
    if (STOPWORDS.has(low)) return true;
    if (BOILERPLATE.has(low)) return true; // domain stopwords: "team", "role", ...
    if (HEADER_WORDS.has(low)) return true; // section headers never join phrases
    if (/^\d+(\.\d+)?$/.test(low)) return true; // pure/decimal numbers
    if (low.length < 2) return true;
    // Hyphenated compounds where every part is filler: "full-time".
    var parts = low.split(/[-/]/);
    if (parts.length > 1 && parts.every(function (p) {
      return STOPWORDS.has(p) || BOILERPLATE.has(p) || /^\d+$/.test(p);
    })) return true;
    return false;
  }

  function isAcronymToken(tok) {
    return /^[A-Z0-9]{2,}$/.test(tok) && /[A-Z]/.test(tok);
  }

  function extractKeywords(postingText, opts) {
    opts = opts || {};
    var maxKeywords = opts.maxKeywords || 40;

    var tokens = tokenizeWithLines(postingText);
    var lines = String(postingText).split(/\r?\n/);
    var boostLines = {};
    for (var li = 0; li < lines.length; li++) {
      if (HEADER_RE.test(lines[li])) {
        for (var k = li; k < Math.min(lines.length, li + 12); k++) boostLines[k] = true;
      }
    }

    // Build runs of content tokens separated by stopwords/numbers/line breaks.
    var runs = [];
    var cur = [];
    var prevLine = -1;
    tokens.forEach(function (tok) {
      if (tok.line !== prevLine) {
        // Never let a phrase span a line break ("...actions\n- Operate...").
        if (cur.length) { runs.push(cur); cur = []; }
        prevLine = tok.line;
      }
      if (isSeparator(tok.t)) {
        if (cur.length) { runs.push(cur); cur = []; }
      } else {
        cur.push(tok);
      }
    });
    if (cur.length) runs.push(cur);

    var freq = {};
    var deg = {};
    var phrases = [];
    runs.forEach(function (run) {
      if (run.length === 0 || run.length > 4) return;
      var words = run.map(function (r) { return r.t.toLowerCase(); });
      if (words.length === 1) {
        var w0 = words[0];
        if (BOILERPLATE.has(w0) || STOPWORDS.has(w0)) return;
        // "Techy" = acronym or tech token with a letter: C++, C#, .NET.
        // (Not "2+" or "27.50" — those are quantities, not skills.)
        var techy = isAcronymToken(run[0].t) ||
          (/[a-zA-Z]/.test(w0) && /[+#.]/.test(w0));
        phrases.push({ words: words, raw: run[0].t, line: run[0].line, single: true, techy: techy });
      } else {
        phrases.push({ words: words, raw: run.map(function (r) { return r.t; }).join(' '), line: run[0].line, single: false, techy: false });
      }
      words.forEach(function (w) {
        freq[w] = (freq[w] || 0) + 1;
        deg[w] = (deg[w] || 0) + words.length;
      });
    });

    // Score: RAKE word score deg/freq; phrase score = sum; boost near headers.
    // Per-word scores AND frequencies are returned too, so analyze() can pick
    // "core" words for honest partial matching.
    var scored = [];
    phrases.forEach(function (p) {
      if (p.single && !p.techy && (freq[p.words[0]] || 0) < 2) return; // one-off plain words are noise
      var s = 0;
      var wordScores = p.words.map(function (w) {
        var ws = (deg[w] || 0) / (freq[w] || 1);
        s += ws;
        return ws;
      });
      var wordFreqs = p.words.map(function (w) { return freq[w] || 0; });
      if (boostLines[p.line]) s *= 1.3;
      scored.push({ phrase: p.raw, words: p.words, wordScores: wordScores, wordFreqs: wordFreqs, score: s, line: p.line });
    });

    scored.sort(function (a, b) { return b.score - a.score; });

    // Greedy dedupe: drop a phrase if it is fully contained (stemmed) in an
    // already-kept longer phrase.
    var kept = [];
    var keptStemSets = [];
    scored.forEach(function (c) {
      if (kept.length >= maxKeywords) return;
      var stems = stemPhrase(c.words);
      var stemStr = stems.join(' ');
      var dup = keptStemSets.some(function (ks) {
        return ks === stemStr || ks.indexOf(stemStr) !== -1;
      });
      if (dup) return;
      kept.push(c);
      keptStemSets.push(stemStr);
    });

    return kept;
  }

  // ---------------------------------------------------------------------------
  // Tolerant matching against the resume
  // ---------------------------------------------------------------------------

  function buildResumeIndex(resumeText) {
    // position -> stemmed token; map stem -> sorted positions
    var posMap = {};
    var idx = 0;
    var tokens = tokenizeWithLines(resumeText);
    tokens.forEach(function (tok) {
      var s = stemToken(tok.t);
      if (!s) return;
      if (!posMap[s]) posMap[s] = [];
      posMap[s].push(idx);
      idx++;
    });
    return posMap;
  }

  // True if all stemmed tokens of the phrase occur in the resume in order
  // (or reverse order), allowing up to 2 extra tokens between phrase words.
  // This tolerates "management of projects" matching "project management".
  function phraseInResume(stemmedWords, posMap) {
    function ordered(words) {
      var lists = words.map(function (w) { return posMap[w] || []; });
      for (var i = 0; i < lists.length; i++) {
        if (lists[i].length === 0) return false;
      }
      var window = words.length + 2;
      for (var s0 = 0; s0 < lists[0].length; s0++) {
        var p0 = lists[0][s0];
        var curPos = p0;
        var ok = true;
        for (var i2 = 1; i2 < lists.length; i2++) {
          var found = -1;
          for (var j = 0; j < lists[i2].length; j++) {
            var p = lists[i2][j];
            if (p > curPos && p - p0 <= window) { found = p; break; }
          }
          if (found === -1) { ok = false; break; }
          curPos = found;
        }
        if (ok) return true;
      }
      return false;
    }
    if (stemmedWords.length === 1) {
      return (posMap[stemmedWords[0]] || []).length > 0;
    }
    return ordered(stemmedWords) || ordered(stemmedWords.slice().reverse());
  }

  // Expand acronym tokens using the alias map, producing match variants.
  function phraseVariants(words, aliases) {
    var variants = [stemPhrase(words)];
    var expanded = [];
    var changed = false;
    words.forEach(function (w) {
      var key = w.toLowerCase();
      if (aliases[key]) {
        changed = true;
        aliases[key].forEach(function (ew) { expanded.push(stemToken(ew)); });
      } else {
        expanded.push(stemToken(w));
      }
    });
    if (changed) variants.push(expanded.filter(Boolean));
    // Also add the bare acronym as a variant for full-phrase keywords:
    // e.g. keyword "warehouse management system" should match resume "WMS".
    Object.keys(aliases).forEach(function (acro) {
      var exp = aliases[acro].join(' ');
      var stemmed = stemPhrase(words).join(' ');
      if (stemmed === exp) variants.push([acro]);
    });
    return variants;
  }

  // Single-word hit test with alias equivalence in both directions:
  // "WMS" hits if the resume says "warehouse management system" and vice versa.
  // Returns 0 = miss, 1 = direct hit, 2 = hit via alias/expansion.
  function wordHit(word, posMap, aliases) {
    var s = stemToken(word);
    if ((posMap[s] || []).length > 0) return 1;
    var key = word.toLowerCase();
    if (aliases[key]) {
      var exp = aliases[key].map(stemToken);
      if (exp.some(function (e) { return (posMap[e] || []).length > 0; })) return 2;
    }
    for (var acro in aliases) {
      if (!Object.prototype.hasOwnProperty.call(aliases, acro)) continue;
      if ((posMap[acro] || []).length === 0) continue;
      var expWords = aliases[acro].map(stemToken);
      if (expWords.indexOf(s) !== -1) return 2;
    }
    return 0;
  }

  function findContextSentence(phrase, sentences) {
    var needles = phrase.toLowerCase().split(/[\s/]+/).filter(Boolean);
    for (var i = 0; i < sentences.length; i++) {
      var s = sentences[i].toLowerCase();
      var all = needles.every(function (n) { return s.indexOf(n) !== -1; });
      if (all) {
        var trimmed = sentences[i].trim().replace(/\s+/g, ' ');
        return trimmed.length > 180 ? trimmed.slice(0, 177) + '…' : trimmed;
      }
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------------

  function analyze(postingText, resumeText, opts) {
    opts = opts || {};
    postingText = String(postingText || '');
    resumeText = String(resumeText || '');

    if (postingText.trim().length < 80) {
      return { error: 'posting_too_short', message: 'The job posting looks too short to analyze (under 80 characters). Paste the full posting text.' };
    }
    if (resumeText.trim().length < 80) {
      return { error: 'resume_too_short', message: 'The resume text looks too short to analyze (under 80 characters). Paste your full resume text.' };
    }

    var keywords = extractKeywords(postingText, { maxKeywords: opts.maxKeywords || 40 });
    if (!keywords.length) {
      return { error: 'no_keywords', message: 'Could not extract keywords from this posting. It may be mostly boilerplate.' };
    }

    var aliases = detectAliases(postingText);
    var posMap = buildResumeIndex(resumeText);
    var sentences = String(postingText).split(/(?<=[.!?])\s+|\n+/);

    var matched = [];   // full phrase found (tolerant)
    var partial = [];   // core word(s) found, but not the whole phrase
    var missing = [];   // nothing found
    var coveredScore = 0;
    var totalScore = 0;

    keywords.forEach(function (kw) {
      totalScore += kw.score;
      var variants = phraseVariants(kw.words, aliases);
      var fullHit = variants.some(function (v) { return phraseInResume(v, posMap); });
      var entry = {
        phrase: kw.phrase,
        score: Math.round(kw.score * 10) / 10,
        context: findContextSentence(kw.phrase, sentences)
      };
      if (fullHit) {
        matched.push(entry);
        coveredScore += kw.score;
        return;
      }
      // Partial: "core" words = the phrase's most frequently mentioned words
      // in the posting (top half, min 1) — the concept's head terms, not its
      // rarest words. e.g. posting "forklift certification" vs resume
      // "forklift" -> partial, instead of a false "missing" alarm.
      // If ALL words appear but scattered, that's also partial ("mentioned
      // separately"), never silently full.
      var order = kw.words.map(function (w, i) { return i; }).sort(function (a, b) {
        return kw.wordFreqs[b] - kw.wordFreqs[a];
      });
      var coreCount = Math.max(1, Math.ceil(kw.words.length / 2));
      var hitWords = [];
      var missWords = [];
      var aliasWords = [];
      kw.words.forEach(function (w) {
        var h = wordHit(w, posMap, aliases);
        if (h === 0) missWords.push(w);
        else {
          hitWords.push(w);
          if (h === 2) aliasWords.push(w); // found only via acronym/alias equivalence
        }
      });
      var coreHit = order.slice(0, coreCount).some(function (i) {
        return wordHit(kw.words[i], posMap, aliases) > 0;
      });
      if (coreHit && hitWords.length > 0) {
        entry.status = 'partial';
        entry.hitWords = hitWords;
        entry.missWords = missWords;
        entry.aliasWords = aliasWords;
        entry.scattered = missWords.length === 0;
        partial.push(entry);
        coveredScore += kw.score * 0.5;
      } else {
        missing.push(entry);
      }
    });

    var score = totalScore > 0 ? Math.round((coveredScore / totalScore) * 100) : 0;

    var aliasList = Object.keys(aliases)
      .filter(function (k) { return !CURATED_ALIASES[k]; })
      .map(function (k) { return { acronym: k.toUpperCase(), expansion: aliases[k].join(' ') }; });

    return {
      score: score,
      totalKeywords: keywords.length,
      matchedCount: matched.length,
      partialCount: partial.length,
      missingCount: missing.length,
      matched: matched,
      partial: partial,
      missing: missing,
      aliases: aliasList,
      note: 'Heuristic estimate from keyword coverage. No tool can see the employer\u2019s actual screening software — treat this as a gap-finder, not a prediction.'
    };
  }

  return {
    analyze: analyze,
    extractKeywords: extractKeywords,
    detectAliases: detectAliases,
    stemToken: stemToken,
    phraseInResume: phraseInResume,
    buildResumeIndex: buildResumeIndex,
    wordHit: wordHit
  };
});
