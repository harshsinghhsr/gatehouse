/**
 * 3. The same two calls through the official OpenAI and Anthropic SDKs.
 *
 *     npm install        # once, in this folder
 *     node 3-sdks.mjs
 *
 * Read the two constructors below and note what is different from the vendor's own quickstart:
 * the base URL and the key. That is it. No Gatehouse SDK, no wrapper, no request rewriting — the
 * proxy speaks both wire protocols, so existing code moves onto the gateway by changing two
 * lines, and the operator gets model allow-lists, budgets, and per-developer spend for free.
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { signIn, gatewayUrls, loadKey, heading } from './gatehouse.mjs';

const key = loadKey();
const urls = await gatewayUrls(await signIn());

heading(`OpenAI SDK  ->  ${urls.openai}`);
const openai = new OpenAI({ baseURL: urls.openai, apiKey: key });
const completion = await openai.chat.completions.create({
  model: process.env.GATEHOUSE_OPENAI_MODEL ?? 'gpt-4o',
  messages: [{ role: 'user', content: 'Say hello from the gateway.' }],
});
console.log('  model  ', completion.model);
console.log('  reply  ', completion.choices[0].message.content);
console.log('  tokens ', `${completion.usage.prompt_tokens} in / ${completion.usage.completion_tokens} out`);

heading(`Anthropic SDK  ->  ${urls.anthropic}`);
const anthropic = new Anthropic({ baseURL: urls.anthropic, apiKey: key });
const message = await anthropic.messages.create({
  model: process.env.GATEHOUSE_ANTHROPIC_MODEL ?? 'claude-sonnet-4-5',
  max_tokens: 128,
  messages: [{ role: 'user', content: 'Say hello from the gateway.' }],
});
console.log('  model  ', message.model);
console.log('  reply  ', message.content[0].text);
console.log('  tokens ', `${message.usage.input_tokens} in / ${message.usage.output_tokens} out`);

console.log('\nBoth calls used the same key. Which model a key may reach is decided by the grants');
console.log('an admin set in Gatehouse, not by which SDK the developer happens to import.');
