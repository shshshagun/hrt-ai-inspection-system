'use strict';
/**
 * Retrieval for Ask HRT (the "R" in RAG). The notes in ./knowledge are split into sections, and a question is matched
 * against them with BM25 keyword scoring: a section scores higher when it contains more of the question's words,
 * and rare words count for more than common ones. No embeddings, no extra service, no API calls.
 */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'knowledge');
const MAX_CHUNK_CHARS = 1200;
const K1 = 1.2; // how quickly repeating a word stops adding score
const B = 0.75; // how much long sections are penalised

const STOP = new Set(('a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or so '
  + 'than that the their then there these they this to was we what when where which who why will with you your').split(' '));

/** Lower-case words, without stop words, with a light plural strip so "cracks" matches "crack". */
function tokenize(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** One note -> sections. A note starts with "# Title", an optional "Source:" line, then "## Heading" sections. */
function parseNote(file, text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const title = (lines.find((l) => l.startsWith('# ')) || `# ${file}`).slice(2).trim();
  const chunks = [];
  let heading = null;
  let body = [];
  const flush = () => {
    const content = body.join(' ').replace(/\s+/g, ' ').trim();
    if (heading && content) chunks.push({ note: title, file, section: heading, text: content.slice(0, MAX_CHUNK_CHARS) });
    body = [];
  };
  for (const line of lines) {
    if (line.startsWith('## ')) { flush(); heading = line.slice(3).trim(); } else if (heading) body.push(line);
  }
  flush();
  return chunks;
}

/** Builds a BM25 index over the given chunks. Title and heading words are part of each chunk. */
function buildIndex(chunks) {
  const docs = chunks.map((c) => {
    const terms = tokenize(`${c.note} ${c.section} ${c.text}`);
    const tf = new Map();
    terms.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    return { chunk: c, tf, len: terms.length };
  });
  const df = new Map();
  docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / Math.max(1, docs.length);
  const N = docs.length;
  // this form of idf never goes negative, which matters on a small set of notes
  const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));

  return function search(query, k = 3) {
    const q = [...new Set(tokenize(query))];
    if (!q.length) return [];
    return docs.map((d) => {
      let score = 0;
      for (const t of q) {
        const f = d.tf.get(t);
        if (f) score += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgLen)));
      }
      return { ...d.chunk, score: Math.round(score * 100) / 100 };
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  };
}

function loadChunks(dir = DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()
    .flatMap((f) => parseNote(f, fs.readFileSync(path.join(dir, f), 'utf8')));
}

let cached = null;
/** Searches the project notes. The index is built once, on first use. */
function searchKnowledge(query, k = 3) {
  if (!cached) cached = buildIndex(loadChunks());
  return cached(query, k);
}

module.exports = { searchKnowledge, buildIndex, loadChunks, parseNote, tokenize };
