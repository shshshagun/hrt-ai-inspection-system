'use strict';
/**
 * Live evaluation of Ask HRT: sends every question in questions.json to the configured free AI provider and scores
 *   - tool choice: did the model call the expected tool(s)?
 *   - citation:   for knowledge questions, does the answer name one of the expected notes?
 *   - answer:     does the answer contain the expected facts (one item from each answer_has group)?
 * Uses GEMINI_API_KEY / GROQ_API_KEY from api/.env. With MONGODB_URI set, data tools run against the real database;
 * without it they return "database not available", so only tool choice is scored for data questions.
 * This spends free-tier quota (about 2 to 4 requests per question), so it is run by hand, never in CI.
 * Run:  node api/assistant/eval/run-live.js            (or add an id, e.g. k01, to run one question)
 */
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { createProviders } = require('../providers');
const { runAgent, toolExecutor } = require('../service');
const { questions } = require('./questions.json');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (text, word) => text.toLowerCase().includes(word.toLowerCase());

async function main() {
  const providers = createProviders(process.env);
  if (!providers.enabled) { console.error('Set GEMINI_API_KEY or GROQ_API_KEY in api/.env first.'); process.exit(1); }

  let db = null; let client = null;
  if (process.env.MONGODB_URI) {
    const { MongoClient } = require('mongodb');
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('hrt_inspection');
  }

  const only = process.argv[2];
  const set = only ? questions.filter((x) => x.id === only) : questions;
  const score = { tool: [0, 0], cite: [0, 0], answer: [0, 0] };

  for (const x of set) {
    let out;
    try {
      out = await runAgent({ history: [{ role: 'user', text: x.q }], generate: providers.generate, execute: toolExecutor(db) });
    } catch (err) {
      console.log(`${x.id}  ERROR ${err.publicMessage || err.message}`);
      score.tool[1] += 1;
      continue;
    }
    const wanted = x.tool.split('+');
    const toolOk = wanted.every((t) => out.tools_used.includes(t));
    score.tool[0] += toolOk ? 1 : 0; score.tool[1] += 1;
    const marks = [`tool ${toolOk ? 'ok' : `MISS (used ${out.tools_used.join(', ') || 'none'})`}`];

    if (x.notes) {
      const cited = x.notes.some((n) => has(out.answer, n));
      score.cite[0] += cited ? 1 : 0; score.cite[1] += 1;
      marks.push(`cite ${cited ? 'ok' : 'MISS'}`);
    }
    if (x.answer_has) {
      const right = x.answer_has.every((group) => group.some((w) => has(out.answer, w)));
      score.answer[0] += right ? 1 : 0; score.answer[1] += 1;
      marks.push(`answer ${right ? 'ok' : 'MISS'}`);
    }
    console.log(`${x.id}  ${marks.join(' | ')}\n      Q: ${x.q}\n      A: ${out.answer.replace(/\s+/g, ' ').slice(0, 240)}`);
    await wait(Number(process.env.EVAL_DELAY_MS) || 4000); // stay under the free per-minute limits
  }

  const pct = ([a, b]) => (b ? `${a}/${b} (${Math.round((a / b) * 100)}%)` : 'n/a');
  console.log(`\nTool choice: ${pct(score.tool)}   Citations: ${pct(score.cite)}   Answer accuracy: ${pct(score.answer)}`);
  if (client) await client.close();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
