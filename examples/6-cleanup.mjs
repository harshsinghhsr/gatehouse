/**
 * 6. Put the key away.
 *
 *     node 6-cleanup.mjs
 *
 * Revokes the key example 1 issued and deletes the local copy, along with the cached admin
 * session. Example 4 cleans up after itself; this is only for the key the other examples share.
 */
import { rmSync } from 'node:fs';
import { signIn, loadKeyRef, mask, KEY_FILE, SESSION_FILE } from './gatehouse.mjs';

const api = await signIn();
const { id, developerId, key } = loadKeyRef();

await api.post(`/developers/${developerId}/keys/${id}/revoke`);
rmSync(KEY_FILE, { force: true });
rmSync(SESSION_FILE, { force: true });
console.log(`Revoked ${mask(key)} and deleted ${KEY_FILE}.`);
console.log('Its spend stays on the dashboard - revoking a key does not erase its history.');
