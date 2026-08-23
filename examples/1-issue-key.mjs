/**
 * 1. Issue a gateway key through the Gatehouse API.
 *
 *     node 1-issue-key.mjs
 *
 * This is the whole control-plane story in one file: an admin signs in, picks a developer, and
 * mints them a key. The developer never sees a provider credential — the OpenAI or Anthropic
 * key stays in the secret store, and what comes back is a LiteLLM virtual key scoped to exactly
 * the models that developer has been granted, with their budget and rate limits attached.
 *
 * The plaintext comes back exactly once, in this response, and Gatehouse never stores it: the
 * database keeps an alias, a LiteLLM token id, and a masked prefix. So we write it to a
 * gitignored file for the later examples to use, and print only the mask.
 */
import { signIn, findDeveloper, saveKey, mask, KEY_FILE, heading } from './gatehouse.mjs';

const DEVELOPER = process.env.GATEHOUSE_DEVELOPER ?? 'direct@gatehouse.dev';

const api = await signIn();
const developer = await findDeveloper(api, DEVELOPER);

heading(`Developer ${developer.name} <${developer.email}>`);
const detail = await api.get(`/developers/${developer.id}`);
console.log('  models  ', detail.models.map((model) => model.publicModelName).join(', ') || '(none)');
console.log('  budget  ', detail.budget ? `$${detail.budget.maxBudget} ${detail.budget.period}` : '(none)');
console.log('  keys    ', `${detail.keys.filter((key) => key.status === 'ACTIVE').length} active`);

heading('POST /api/developers/:id/keys');
const issued = await api.post(`/developers/${developer.id}/keys`);
saveKey({ id: issued.id, key: issued.key, developerId: developer.id });

console.log('  id      ', issued.id);
console.log('  prefix  ', issued.keyPrefix, '(this is all Gatehouse keeps)');
console.log('  key     ', mask(issued.key), '- returned once, never stored, never logged');
console.log(`\nWritten to ${KEY_FILE} (gitignored) for the next examples.`);
console.log('Revoke it when you are done:  node 6-cleanup.mjs');
