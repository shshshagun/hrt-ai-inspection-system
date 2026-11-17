'use strict';
const { createGemini, FREE_MODELS, isFree } = require('./gemini');
const { createGroq, GROQ_MODELS } = require('./groq');

/**
 * Builds the list of configured AI providers (a provider is on only when its key is set) and one `generate` function that
 * tries them in order, moving to the next when one fails (quota, outage, bad key, unknown model). Order comes from
 * ASSISTANT_PROVIDERS, default "gemini,groq".
 */
function createProviders(env, fetchImpl) {
  const retryDelayMs = env.ASSISTANT_RETRY_MS !== undefined ? Number(env.ASSISTANT_RETRY_MS) : 1200;
  const builders = {
    gemini() {
      const apiKey = (env.GEMINI_API_KEY || '').trim();
      if (!apiKey) return null;
      // Only free-tier models unless GEMINI_ALLOW_PAID=true, so a key can never be charged by accident.
      const allowPaid = env.GEMINI_ALLOW_PAID === 'true';
      const wanted = [env.GEMINI_MODEL, ...(env.GEMINI_FALLBACK_MODELS || '').split(',')].map((s) => (s || '').trim()).filter(Boolean);
      const skipped = allowPaid ? [] : wanted.filter((m) => !isFree(m));
      if (skipped.length) console.warn(`Ignoring non-free Gemini model(s) ${skipped.join(', ')}; using free-tier models. Set GEMINI_ALLOW_PAID=true to allow others.`);
      const chosen = [...(allowPaid ? wanted : wanted.filter(isFree)), ...FREE_MODELS].filter((m, i, all) => all.indexOf(m) === i);
      return { name: 'gemini', generate: createGemini({ apiKey, model: chosen[0], fallbacks: chosen.slice(1), fetchImpl, allowPaid, retryDelayMs }) };
    },
    groq() {
      const apiKey = (env.GROQ_API_KEY || '').trim();
      if (!apiKey) return null;
      let model = (env.GROQ_MODEL || '').trim() || GROQ_MODELS[0];
      if (env.GROQ_ALLOW_ANY_MODEL !== 'true' && !GROQ_MODELS.includes(model)) {
        console.warn(`Ignoring Groq model "${model}" (not on the free production list); using ${GROQ_MODELS[0]}. Set GROQ_ALLOW_ANY_MODEL=true to allow it.`);
        model = GROQ_MODELS[0];
      }
      return { name: 'groq', generate: createGroq({ apiKey, model, fetchImpl }) };
    },
  };
  const order = (env.ASSISTANT_PROVIDERS || 'gemini,groq').split(',').map((s) => s.trim().toLowerCase()).filter((n) => builders[n]);
  const providers = order.map((n) => builders[n]()).filter(Boolean);

  async function generate(body) {
    let first;
    for (let i = 0; i < providers.length; i += 1) {
      try {
        return await providers[i].generate(body);
      } catch (err) {
        first = first || err; // report the preferred provider's problem if every provider fails
        if (i < providers.length - 1) console.warn(`${providers[i].name} failed (${err.kind || 'error'}); trying ${providers[i + 1].name}.`);
      }
    }
    throw first;
  }

  return { enabled: providers.length > 0, names: providers.map((p) => p.name), generate };
}

module.exports = { createProviders };
