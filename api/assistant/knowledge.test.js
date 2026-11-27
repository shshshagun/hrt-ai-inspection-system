'use strict';
/**
 * Tests for Ask HRT retrieval (the knowledge notes and BM25 search) and the offline part of the evaluation set.
 * No AI service is called: this measures whether the right note is found, not whether the model's answer is right.
 * Run:  node api/assistant/knowledge.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { searchKnowledge, buildIndex, loadChunks, parseNote, tokenize } = require('./knowledge');
const { DECLARATIONS, executeTool } = require('./tools');
const { toRequest } = require('./groq');
const { questions } = require('./eval/questions.json');

test('every note parses into titled sections of bounded size', () => {
  const chunks = loadChunks();
  const notes = new Set(chunks.map((c) => c.note));
  assert.ok(notes.size >= 8, `only ${notes.size} notes`);
  for (const c of chunks) {
    assert.ok(c.note && c.section && c.text, JSON.stringify(c).slice(0, 80));
    assert.ok(c.text.length <= 1200);
  }
});

test('parseNote keeps the title and splits on ## headings', () => {
  const chunks = parseNote('x.md', '# My note\nSource: here\n\n## One\nfirst part\n\n## Two\nsecond\npart\n');
  assert.deepEqual(chunks.map((c) => [c.note, c.section, c.text]), [['My note', 'One', 'first part'], ['My note', 'Two', 'second part']]);
});

test('tokenize drops stop words and plural endings', () => {
  assert.deepEqual(tokenize('What are the Cracks in this tunnel?'), ['crack', 'tunnel']);
  assert.deepEqual(tokenize('glass'), ['glass']);
});

test('a word found in every section never lowers a score', () => {
  const search = buildIndex([
    { note: 'A', section: 's', text: 'tunnel crack width' },
    { note: 'B', section: 's', text: 'tunnel lining joint' },
  ]);
  const [top] = search('tunnel crack');
  assert.equal(top.note, 'A');
  assert.ok(top.score > 0);
  assert.equal(search('zzz').length, 0);
});

test('search_knowledge tool works without the database and adds nothing to the defect links', async () => {
  const sink = new Set();
  const out = await executeTool('search_knowledge', { query: 'what makes a crack critical' }, { db: null, sink });
  assert.equal(out.passages[0].note, 'Severity levels');
  assert.deepEqual(Object.keys(out.passages[0]).sort(), ['note', 'section', 'text']);
  assert.equal(sink.size, 0);
  await assert.rejects(executeTool('search_knowledge', { query: 'x' }, { db: null, sink }), /2 to 200/);
  await assert.rejects(executeTool('search_knowledge', { query: { $ne: 1 } }, { db: null, sink }), /2 to 200/);
  // data tools still need the database
  await assert.rejects(executeTool('list_inspections', {}, { db: null, sink }), /db/);
});

test('the new tool is declared and survives the Groq translation', () => {
  assert.ok(DECLARATIONS.some((d) => d.name === 'search_knowledge'));
  const req = toRequest('m', { contents: [], tools: [{ functionDeclarations: DECLARATIONS }] });
  assert.ok(req.tools.some((t) => t.function.name === 'search_knowledge'));
});

test('evaluation set: the right note is in the top 3 for knowledge questions', () => {
  const asked = questions.filter((x) => x.notes);
  const misses = [];
  for (const x of asked) {
    const found = searchKnowledge(x.q, 3).map((r) => r.note);
    if (!x.notes.some((n) => found.includes(n))) misses.push(`${x.id}: wanted ${x.notes[0]}, got ${found.join(' | ') || 'nothing'}`);
  }
  const hits = asked.length - misses.length;
  console.log(`retrieval hit rate (top 3): ${hits}/${asked.length}`);
  misses.forEach((m) => console.log(`  miss ${m}`));
  assert.ok(hits / asked.length >= 0.85, `hit rate ${hits}/${asked.length} is below 85%`);
});
