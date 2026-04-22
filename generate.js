#!/usr/bin/env node
/**

- The Morning Brief — Daily Newspaper Generator
- Run at 5am via cron or GitHub Actions.
- 
- Required env vars:
- ANTHROPIC_KEY   — your Anthropic API key
- NEWSAPI_KEY     — your NewsAPI.org API key
- 
- Usage:
- ANTHROPIC_KEY=sk-… NEWSAPI_KEY=… node generate.js
  */

const fs = require(“fs”);
const https = require(“https”);

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const NEWSAPI_KEY   = process.env.NEWSAPI_KEY;

if (!ANTHROPIC_KEY || !NEWSAPI_KEY) {
console.error(“Missing ANTHROPIC_KEY or NEWSAPI_KEY environment variables.”);
process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function httpsGet(url) {
return new Promise((resolve, reject) => {
https.get(url, (res) => {
let data = “”;
res.on(“data”, (chunk) => (data += chunk));
res.on(“end”, () => resolve(JSON.parse(data)));
res.on(“error”, reject);
}).on(“error”, reject);
});
}

function httpsPost(hostname, path, headers, body) {
return new Promise((resolve, reject) => {
const payload = JSON.stringify(body);
const req = https.request(
{ hostname, path, method: “POST”, headers: { …headers, “Content-Length”: Buffer.byteLength(payload) } },
(res) => {
let data = “”;
res.on(“data”, (chunk) => (data += chunk));
res.on(“end”, () => resolve(JSON.parse(data)));
res.on(“error”, reject);
}
);
req.on(“error”, reject);
req.write(payload);
req.end();
});
}

// ── Step 1: Fetch yesterday’s top headlines from NewsAPI ─────────────────────

async function fetchNews() {
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const from = yesterday.toISOString().split(“T”)[0];

// Pull from multiple categories for variety
const categories = [“general”, “technology”, “science”, “business”, “health”];
const allArticles = [];

for (const cat of categories) {
const url = `https://newsapi.org/v2/top-headlines?language=en&category=${cat}&pageSize=5&apiKey=${NEWSAPI_KEY}`;
const data = await httpsGet(url);
if (data.articles) {
allArticles.push(…data.articles.map(a => ({
category: cat,
title: a.title,
description: a.description || “”,
source: a.source?.name || “Unknown”,
url: a.url,
})));
}
}

return allArticles;
}

// ── Step 2: Ask Claude to summarize as facts-only newspaper ──────────────────

async function generateNewspaper(articles) {
const articleList = articles
.map(a => `[${a.category.toUpperCase()} | ${a.source}] ${a.title}. ${a.description}`)
.join(”\n”);

const today = new Date();
const dateStr = today.toLocaleDateString(“en-US”, { weekday:“long”, year:“numeric”, month:“long”, day:“numeric” });

const prompt = `You are the editor of “The Morning Brief”, a facts-only newspaper with zero political bias.

Today is ${dateStr}. Here are raw headlines from NewsAPI for you to work with:

${articleList}

Your job: transform these into a clean, factual newspaper layout. Rules:

- Report ONLY verifiable facts: who, what, when, where, numbers
- NO opinion, analysis, or editorial language
- NO politically loaded adjectives (e.g. “controversial”, “radical”, “shocking”)
- If politically charged, state only the objective action taken — not reactions
- Write in AP/Reuters wire-service style
- Distribute stories across categories naturally

Return ONLY a valid JSON object (no markdown, no backticks, no preamble):
{
“lead”: {
“label”: “category”,
“headline”: “headline”,
“subhead”: “one factual sentence of context”,
“body”: “2-3 sentence factual summary”
},
“aside”: [
{“headline”: “short headline”, “summary”: “one factual sentence”},
{“headline”: “short headline”, “summary”: “one factual sentence”},
{“headline”: “short headline”, “summary”: “one factual sentence”}
],
“col1”: [
{“label”: “category”, “headline”: “headline”, “body”: “2-3 sentence factual summary”, “source”: “source name”},
{“label”: “category”, “headline”: “headline”, “body”: “2-3 sentence factual summary”, “source”: “source name”}
],
“col2”: [
{“label”: “category”, “headline”: “headline”, “body”: “2-3 sentence factual summary”, “source”: “source name”},
{“label”: “category”, “headline”: “headline”, “body”: “2-3 sentence factual summary”, “source”: “source name”}
],
“col3”: [
{“label”: “category”, “headline”: “headline”, “body”: “2-3 sentence factual summary”, “source”: “source name”},
{“label”: “category”, “headline”: “headline”, “body”: “2-3 sentence factual summary”, “source”: “source name”}
]
}`;

const response = await httpsPost(
“api.anthropic.com”,
“/v1/messages”,
{
“Content-Type”: “application/json”,
“x-api-key”: ANTHROPIC_KEY,
“anthropic-version”: “2023-06-01”,
},
{
model: “claude-sonnet-4-20250514”,
max_tokens: 2000,
messages: [{ role: “user”, content: prompt }],
}
);

const text = response.content.filter(b => b.type === “text”).map(b => b.text).join(””);
return JSON.parse(text.replace(/`json|`/g, “”).trim());
}

// ── Step 3: Inject news into HTML template ───────────────────────────────────

function buildHTML(news) {
const today = new Date();
const dateStr = today.toLocaleDateString(“en-US”, { weekday:“long”, year:“numeric”, month:“long”, day:“numeric” });
const timeStr = today.toLocaleTimeString(“en-US”, { hour:“2-digit”, minute:“2-digit” });

const asideHTML = news.aside.map(a => ` <div class="aside-item"> <h3>${esc(a.headline)}</h3> <p>${esc(a.summary)}</p> </div>`).join(””);

const colHTML = (items) => items.map(a => ` <div class="article"> <div class="article-label">${esc(a.label)}</div> <h2>${esc(a.headline)}</h2> <p>${esc(a.body)}</p> <span class="source-tag">Source: ${esc(a.source)}</span> </div>`).join(””);

return `<!DOCTYPE html>

<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>The Morning Brief — ${dateStr}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=IM+Fell+English:ital@0;1&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --ink: #1a1008; --paper: #f5f0e8; --paper-dark: #ede7d5;
    --rule: #2a1f0e; --accent: #8b1a1a; --muted: #5a4a35; --col-gap: 20px;
  }
  body { background: #c8b89a; font-family: 'Source Serif 4', Georgia, serif; color: var(--ink); min-height: 100vh; padding: 20px; }
  .page { max-width: 1100px; margin: 0 auto; background: var(--paper); box-shadow: 0 4px 40px rgba(0,0,0,0.35); }
  .masthead { padding: 18px 28px 0; border-bottom: 3px double var(--rule); }
  .masthead-top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 6px; border-bottom: 1px solid var(--rule); margin-bottom: 8px; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .ai-badge { background: var(--accent); color: #f5f0e8; padding: 2px 8px; font-size: 9px; letter-spacing: 0.15em; font-weight: 600; }
  .paper-name { text-align: center; padding: 10px 0 12px; }
  .paper-name h1 { font-family: 'Playfair Display', Georgia, serif; font-size: clamp(48px, 8vw, 88px); font-weight: 900; line-height: 0.9; color: var(--ink); }
  .paper-name .subtitle { font-family: 'IM Fell English', serif; font-style: italic; font-size: 13px; color: var(--muted); margin-top: 6px; }
  .edition-bar { display: flex; justify-content: space-between; padding: 5px 28px; background: var(--ink); color: var(--paper); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }
  .section-label { padding: 6px 28px; border-bottom: 2px solid var(--rule); display: flex; align-items: center; gap: 12px; }
  .section-label span { font-family: 'Playfair Display', serif; font-size: 11px; letter-spacing: 0.25em; text-transform: uppercase; font-weight: 700; color: var(--accent); }
  .section-label::after { content: ''; flex: 1; height: 1px; background: var(--rule); opacity: 0.3; }
  .lead-story { padding: 16px 20px; border-bottom: 2px solid var(--rule); display: grid; grid-template-columns: 1.5fr 1fr; gap: 20px; }
  .lead-headline { font-family: 'Playfair Display', serif; font-size: clamp(26px, 4vw, 38px); font-weight: 900; line-height: 1.1; margin-bottom: 10px; }
  .lead-subhead { font-family: 'IM Fell English', serif; font-style: italic; font-size: 14px; color: var(--muted); margin-bottom: 10px; border-left: 2px solid var(--accent); padding-left: 8px; }
  .lead-story p { font-size: 13px; line-height: 1.68; font-weight: 300; text-align: justify; }
  .lead-aside { border-left: 1px solid rgba(42,31,14,0.3); padding-left: 20px; }
  .aside-label { font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin-bottom: 8px; }
  .aside-item { padding: 8px 0; border-bottom: 1px solid rgba(42,31,14,0.15); }
  .aside-item:last-child { border-bottom: none; }
  .aside-item h3 { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 700; line-height: 1.25; margin-bottom: 3px; }
  .aside-item p { font-size: 11.5px; line-height: 1.5; color: var(--muted); }
  .columns { display: grid; grid-template-columns: 1fr 1fr 1fr; padding: 0 20px; }
  .col { padding: 16px var(--col-gap); position: relative; }
  .col:not(:last-child)::after { content: ''; position: absolute; right: 0; top: 16px; bottom: 16px; width: 1px; background: var(--rule); opacity: 0.4; }
  .article { margin-bottom: 20px; padding-bottom: 18px; border-bottom: 1px solid rgba(42,31,14,0.2); }
  .article:last-child { border-bottom: none; }
  .article-label { font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin-bottom: 4px; }
  .article h2 { font-family: 'Playfair Display', serif; font-size: 17px; font-weight: 700; line-height: 1.2; margin-bottom: 6px; }
  .article p { font-size: 12.5px; line-height: 1.65; font-weight: 300; text-align: justify; hyphens: auto; }
  .source-tag { display: inline-block; margin-top: 6px; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); opacity: 0.7; }
  .footer { border-top: 3px double var(--rule); padding: 10px 28px; display: flex; justify-content: space-between; font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); background: var(--paper-dark); }
  @media (max-width: 700px) { .columns, .lead-story { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="page">
  <div class="masthead">
    <div class="masthead-top">
      <div>${dateStr}</div>
      <span class="ai-badge">AI · Fact-Only Edition</span>
      <div>Free of Opinion &bull; Free of Spin</div>
    </div>
    <div class="paper-name">
      <h1>The Morning Brief</h1>
      <div class="subtitle">Facts Only &mdash; Yesterday's News &mdash; No Opinion &mdash; No Spin</div>
    </div>
  </div>
  <div class="edition-bar">
    <span>World &bull; Science &bull; Technology &bull; Business &bull; Health</span>
    <span>Generated at ${timeStr}</span>
    <span>Powered by Claude &bull; NewsAPI</span>
  </div>
  <div class="lead-story">
    <div>
      <div class="article-label">Top Story &bull; ${esc(news.lead.label)}</div>
      <h2 class="lead-headline">${esc(news.lead.headline)}</h2>
      <div class="lead-subhead">${esc(news.lead.subhead)}</div>
      <p>${esc(news.lead.body)}</p>
    </div>
    <div class="lead-aside">
      <div class="aside-label">Also This Morning</div>
      ${asideHTML}
    </div>
  </div>
  <div class="section-label"><span>Top Stories</span></div>
  <div class="columns">
    <div class="col">${colHTML(news.col1)}</div>
    <div class="col">${colHTML(news.col2)}</div>
    <div class="col">${colHTML(news.col3)}</div>
  </div>
  <div class="footer">
    <span>The Morning Brief</span>
    <span>All content AI-generated from verified sources &bull; No opinion &bull; No political bias</span>
    <span>${dateStr}</span>
  </div>
</div>
</body>
</html>`;
}

function esc(str = “”) {
return String(str).replace(/&/g,”&”).replace(/</g,”<”).replace(/>/g,”>”).replace(/”/g,”"”);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
console.log(“📰 The Morning Brief — starting generation…”);

console.log(”  ① Fetching news from NewsAPI…”);
const articles = await fetchNews();
console.log(`     Got ${articles.length} articles.`);

console.log(”  ② Sending to Claude for facts-only summarization…”);
const news = await generateNewspaper(articles);

console.log(”  ③ Building HTML…”);
const html = buildHTML(news);

const outFile = “index.html”;
fs.writeFileSync(outFile, html, “utf8”);
console.log(`  ✅ Saved to ${outFile}`);
})();
