# GapCheck — free resume keyword gap analyzer

**One sentence:** Paste a job posting and your resume; GapCheck shows which of the posting's key terms you cover, partially mention, or miss — so you can tailor your resume before applying.

## Who it's for

Job seekers who tailor their resume per application and are tired of $30–50/month ATS-checker subscriptions (or free tiers capped at ~5 scans/month). Also useful for career counselors and anyone who wants a second pair of eyes on keyword coverage without uploading their resume to a server.

## How to run it

No build step, no dependencies, no server. Any of these work:

1. **Double-click** `index.html` — it runs from `file://` with no network needed.
2. **Serve locally:** `python3 -m http.server 8000` in this folder, then open http://localhost:8000
3. **Host it free:** drop these files on GitHub Pages / Cloudflare Pages / Netlify (all $0) — it's 100% static.

Click **Load sample data** to try it instantly, or paste your own posting + resume and hit **Analyze gap**.

## What it actually does (honest description)

There is **no AI model** here — and we don't claim one. It's deterministic text heuristics, all client-side:

1. **Keyword extraction** — RAKE-style statistics: the posting is split into candidate phrases (stopwords/boilerplate removed, phrases never span line breaks), each word scored by frequency/co-occurrence, phrases near "Requirements"-type headers boosted 1.3×. Top ~40 kept, near-duplicates dropped.
2. **Tolerant matching** — a phrase counts as *covered* when its words appear together in your resume, tolerating:
   - stemming (`cycle counts` = `cycle counting`, `built` = `building`),
   - word order and small gaps (`management of projects` = `project management`),
   - acronym equivalence parsed from the posting itself (`WMS` = `Warehouse Management System`, detected from "Warehouse Management System (WMS)"), plus a tiny built-in list (`JS`/`JavaScript`, `K8s`/`Kubernetes`…).
3. **Three tiers, not false alarms** — *covered* (full phrase) / *partially mentioned* (core words present but not the whole phrase — shown transparently as "resume shows: X, not as a phrase: Y") / *missing*. This directly addresses the biggest complaint about keyword checkers: dumb string matching that cries "missing" over words you actually have.
4. **Fix-list** — missing terms ranked by importance, each with the posting sentence it came from and a checkbox to track what you've truthfully addressed. Export the list as Markdown.

**Privacy:** everything runs in the page. Inputs persist only in your browser's localStorage (so refresh doesn't wipe them); the Clear button wipes them. Nothing is uploaded, tracked, or sent anywhere.

## Limits (read before trusting it)

- **English only.** The stemmer, stopwords, and heuristics are English-specific.
- **Pasted plain text.** It can't open PDF/DOCX files — copy the text out of them first.
- **The score is a heuristic, not a prediction.** No tool can see the employer's actual screening software. Treat 0–100 as "keyword coverage," a gap-finder, not a forecast. Scores much above ~75 on every posting may mean keyword stuffing, not a better resume.
- **Acronyms** are understood when the posting defines them ("X (Y)") or they're in the small built-in list; leet-style abbreviations like `K8s` fall back to the built-in list only.
- **It can't judge quality.** Great bullet points, honest framing, and whether you should even apply are human judgments. And it will never tell you to add a skill you don't have — the page says so up front, and you shouldn't.

## Files

| File | What |
|---|---|
| `index.html` | The app page |
| `styles.css` | Styling |
| `analyzer.js` | The analysis engine (pure logic — also loads in Node) |
| `app.js` | UI wiring |
| `samples/` | Sample posting + resume (also embedded as the in-app demo) |
| `test/run-tests.js` | 21 analyzer unit/integration tests — `node test/run-tests.js` |
| `test/dom-smoke.js` | UI wiring smoke test against a stub DOM — `node test/dom-smoke.js` |

## Cost to run

$0. No APIs, no keys, no backend, no database, no build. Static hosting is free (GitHub Pages etc.).
