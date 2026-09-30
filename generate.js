#!/usr/bin/env node

const fs = require("fs");
const https = require("https");

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const NEWSAPI_KEY = process.env.NEWSAPI_KEY;

if (!ANTHROPIC_KEY || !NEWSAPI_KEY) {
  console.error("Missing ANTHROPIC_KEY or NEWSAPI_KEY");
  process.exit(1);
}

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    https.get(url, function(res) {
      var data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() { resolve(JSON.parse(data)); });
      res.on("error", reject);
    }).on("error", reject);
  });
}

function httpsPost(hostname, path, headers, body) {
  return new Promise(function(resolve, reject) {
    var payload = JSON.stringify(body);
    var opts = {
      hostname: hostname,
      path: path,
      method: "POST",
      headers: Object.assign({}, headers, { "Content-Length": Buffer.byteLength(payload) })
    };
    var req = https.request(opts, function(res) {
      var data = "";
      res.on("data", function(chunk) { data += chunk; });
      res.on("end", function() { resolve(JSON.parse(data)); });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function fetchNews() {
  var yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  var categories = ["general", "technology", "science", "business", "health"];
  var allArticles = [];

  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    var url = "https://newsapi.org/v2/top-headlines?language=en&category=" + cat + "&pageSize=5&apiKey=" + NEWSAPI_KEY;
    try {
      var data = await httpsGet(url);
      if (data.articles) {
        for (var j = 0; j < data.articles.length; j++) {
          var a = data.articles[j];
          allArticles.push({
            category: cat,
            title: a.title || "",
            description: a.description || "",
            source: (a.source && a.source.name) ? a.source.name : "Unknown"
          });
        }
      }
    } catch (e) {
      console.error("NewsAPI error for " + cat + ": " + e.message);
    }
  }
  return allArticles;
}

async function generateNewspaper(articles) {
  var today = new Date();
  var dateStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  var articleList = articles.map(function(a) {
    return "[" + a.category.toUpperCase() + " | " + a.source + "] " + a.title + ". " + a.description;
  }).join("\n");

  var prompt = "You are the editor of The Morning Brief, a facts-only newspaper with zero political bias.\n\nToday is " + dateStr + ". Here are raw headlines:\n\n" + articleList + "\n\nRules:\n- Report ONLY verifiable facts: who, what, when, where, numbers\n- NO opinion or editorial language\n- NO politically loaded adjectives\n- Write in AP/Reuters wire-service style\n\nReturn ONLY a valid JSON object with no markdown, no backticks:\n{\"lead\":{\"label\":\"category\",\"headline\":\"headline\",\"subhead\":\"one sentence\",\"body\":\"2-3 sentences\"},\"aside\":[{\"headline\":\"headline\",\"summary\":\"one sentence\"},{\"headline\":\"headline\",\"summary\":\"one sentence\"},{\"headline\":\"headline\",\"summary\":\"one sentence\"}],\"col1\":[{\"label\":\"category\",\"headline\":\"headline\",\"body\":\"2-3 sentences\",\"source\":\"source\"},{\"label\":\"category\",\"headline\":\"headline\",\"body\":\"2-3 sentences\",\"source\":\"source\"}],\"col2\":[{\"label\":\"category\",\"headline\":\"headline\",\"body\":\"2-3 sentences\",\"source\":\"source\"},{\"label\":\"category\",\"headline\":\"headline\",\"body\":\"2-3 sentences\",\"source\":\"source\"}],\"col3\":[{\"label\":\"category\",\"headline\":\"headline\",\"body\":\"2-3 sentences\",\"source\":\"source\"},{\"label\":\"category\",\"headline\":\"headline\",\"body\":\"2-3 sentences\",\"source\":\"source\"}]}";

  var response = await httpsPost(
    "api.anthropic.com",
    "/v1/messages",
    {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01"
    },
    {
      model: "claude-sonnet-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }]
    }
  );

  var text = response.content.filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

function buildHTML(news) {
  var today = new Date();
  var dateStr = today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  var timeStr = today.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  var asideHTML = news.aside.map(function(a) {
    return "<div class=\"aside-item\"><h3>" + esc(a.headline) + "</h3><p>" + esc(a.summary) + "</p></div>";
  }).join("");

  function colHTML(items) {
    return items.map(function(a) {
      return "<div class=\"article\"><div class=\"article-label\">" + esc(a.label) + "</div><h2>" + esc(a.headline) + "</h2><p>" + esc(a.body) + "</p><span class=\"source-tag\">Source: " + esc(a.source) + "</span></div>";
    }).join("");
  }

  return "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n<title>The Morning Brief - " + dateStr + "</title>\n<link href=\"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=IM+Fell+English:ital@0;1&family=Source+Serif+4:ital,wght@0,300;0,400;0,600;1,300;1,400&display=swap\" rel=\"stylesheet\">\n<style>\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}\n:root{--ink:#1a1008;--paper:#f5f0e8;--paper-dark:#ede7d5;--rule:#2a1f0e;--accent:#8b1a1a;--muted:#5a4a35}\nbody{background:#c8b89a;font-family:'Source Serif 4',Georgia,serif;color:var(--ink);min-height:100vh;padding:20px}\n.page{max-width:1100px;margin:0 auto;background:var(--paper);box-shadow:0 4px 40px rgba(0,0,0,.35)}\n.masthead{padding:18px 28px 0;border-bottom:3px double var(--rule)}\n.masthead-top{display:flex;justify-content:space-between;align-items:center;padding-bottom:6px;border-bottom:1px solid var(--rule);margin-bottom:8px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}\n.ai-badge{background:var(--accent);color:#f5f0e8;padding:2px 8px;font-size:9px;letter-spacing:.15em;font-weight:600}\n.paper-name{text-align:center;padding:10px 0 12px}\n.paper-name h1{font-family:'Playfair Display',Georgia,serif;font-size:clamp(48px,8vw,88px);font-weight:900;line-height:.9;color:var(--ink)}\n.paper-name .subtitle{font-family:'IM Fell English',serif;font-style:italic;font-size:13px;color:var(--muted);margin-top:6px}\n.edition-bar{display:flex;justify-content:space-between;padding:5px 28px;background:var(--ink);color:var(--paper);font-size:10px;letter-spacing:.12em;text-transform:uppercase}\n.section-label{padding:6px 28px;border-bottom:2px solid var(--rule);display:flex;align-items:center;gap:12px}\n.section-label span{font-family:'Playfair Display',serif;font-size:11px;letter-spacing:.25em;text-transform:uppercase;font-weight:700;color:var(--accent)}\n.section-label::after{content:'';flex:1;height:1px;background:var(--rule);opacity:.3}\n.lead-story{padding:16px 20px;border-bottom:2px solid var(--rule);display:grid;grid-template-columns:1.5fr 1fr;gap:20px}\n.lead-headline{font-family:'Playfair Display',serif;font-size:clamp(26px,4vw,38px);font-weight:900;line-height:1.1;margin-bottom:10px}\n.lead-subhead{font-family:'IM Fell English',serif;font-style:italic;font-size:14px;color:var(--muted);margin-bottom:10px;border-left:2px solid var(--accent);padding-left:8px}\n.lead-story p{font-size:13px;line-height:1.68;font-weight:300;text-align:justify}\n.lead-aside{border-left:1px solid rgba(42,31,14,.3);padding-left:20px}\n.aside-label{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:8px}\n.aside-item{padding:8px 0;border-bottom:1px solid rgba(42,31,14,.15)}\n.aside-item:last-child{border-bottom:none}\n.aside-item h3{font-family:'Playfair Display',serif;font-size:13px;font-weight:700;line-height:1.25;margin-bottom:3px}\n.aside-item p{font-size:11.5px;line-height:1.5;color:var(--muted)}\n.columns{display:grid;grid-template-columns:1fr 1fr 1fr;padding:0 20px}\n.col{padding:16px 20px;position:relative}\n.col:not(:last-child)::after{content:'';position:absolute;right:0;top:16px;bottom:16px;width:1px;background:var(--rule);opacity:.4}\n.article{margin-bottom:20px;padding-bottom:18px;border-bottom:1px solid rgba(42,31,14,.2)}\n.article:last-child{border-bottom:none}\n.article-label{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:700;margin-bottom:4px}\n.article h2{font-family:'Playfair Display',serif;font-size:17px;font-weight:700;line-height:1.2;margin-bottom:6px}\n.article p{font-size:12.5px;line-height:1.65;font-weight:300;text-align:justify;hyphens:auto}\n.source-tag{display:inline-block;margin-top:6px;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);opacity:.7}\n.footer{border-top:3px double var(--rule);padding:10px 28px;display:flex;justify-content:space-between;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);background:var(--paper-dark)}\n@media(max-width:700px){.columns,.lead-story{grid-template-columns:1fr}}\n</style>\n</head>\n<body>\n<div class=\"page\">\n<div class=\"masthead\">\n<div class=\"masthead-top\">\n<div>" + dateStr + "</div>\n<span class=\"ai-badge\">AI - Fact-Only Edition</span>\n<div>Free of Opinion - Free of Spin</div>\n</div>\n<div class=\"paper-name\">\n<h1>The Morning Brief</h1>\n<div class=\"subtitle\">Facts Only - Yesterday's News - No Opinion - No Spin</div>\n</div>\n</div>\n<div class=\"edition-bar\">\n<span>World - Science - Technology - Business - Health</span>\n<span>Generated at " + timeStr + "</span>\n<span>Powered by Claude and NewsAPI</span>\n</div>\n<div class=\"lead-story\">\n<div>\n<div class=\"article-label\">Top Story - " + esc(news.lead.label) + "</div>\n<h2 class=\"lead-headline\">" + esc(news.lead.headline) + "</h2>\n<div class=\"lead-subhead\">" + esc(news.lead.subhead) + "</div>\n<p>" + esc(news.lead.body) + "</p>\n</div>\n<div class=\"lead-aside\">\n<div class=\"aside-label\">Also This Morning</div>\n" + asideHTML + "\n</div>\n</div>\n<div class=\"section-label\"><span>Top Stories</span></div>\n<div class=\"columns\">\n<div class=\"col\">" + colHTML(news.col1) + "</div>\n<div class=\"col\">" + colHTML(news.col2) + "</div>\n<div class=\"col\">" + colHTML(news.col3) + "</div>\n</div>\n<div class=\"footer\">\n<span>The Morning Brief</span>\n<span>AI-generated from verified sources - No opinion - No political bias</span>\n<span>" + dateStr + "</span>\n</div>\n</div>\n</body>\n</html>";
}

async function main() {
  console.log("The Morning Brief - starting...");
  console.log("Fetching news from NewsAPI...");
  var articles = await fetchNews();
  console.log("Got " + articles.length + " articles");
  console.log("Sending to Claude...");
  var news = await generateNewspaper(articles);
  console.log("Building HTML...");
  var html = buildHTML(news);
  fs.writeFileSync("index.html", html, "utf8");
  console.log("Done - saved to index.html");
}

main().catch(function(err) {
  console.error("Fatal error: " + err.message);
  process.exit(1);
});
