/**
 * SAT Monitoring — Docker discovery acceptance tests.
 *
 * Exercises the flows from the specification against the isolated test stack.
 *
 *   docker compose -p sattest -f docker-compose.test.yml up -d --build
 *   node scripts/test-discovery.mjs
 *   docker compose -p sattest -f docker-compose.test.yml down -v
 *
 * The API in that stack runs with DEV_AUTH_BYPASS so no Azure tenant is needed,
 * and with DISCOVERY_ENABLED=false so only the worker syncs.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const API = process.env.TEST_API || 'http://localhost:4200/api';

let pass = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`   ok   ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`   FAIL ${name}${detail ? `  [${detail}]` : ''}`);
  }
}

async function req(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/** Trigger a pass and wait for it, rather than waiting on the cron. */
async function sync() {
  const r = await req('/applications/discovery/run', { method: 'POST' });
  if (r.status !== 200) throw new Error(`discovery run failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

async function apps() {
  const r = await req('/applications');
  if (r.status !== 200) throw new Error(`list failed: ${r.status}`);
  return r.body;
}

const byName = (list, name) => list.find((a) => a.name === name);

async function docker(args) {
  try {
    const { stdout } = await exec('docker', args);
    return stdout.trim();
  } catch (err) {
    throw new Error(`docker ${args.join(' ')} failed: ${err.message}`);
  }
}

async function events(id) {
  const r = await req(`/applications/${id}/events`);
  return r.status === 200 ? r.body : [];
}

async function notifications() {
  const r = await req('/notifications');
  return r.status === 200 ? r.body : [];
}

// ===========================================================================
console.log('\nWaiting for the test API…');
{
  let up = false;
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await req('/health');
      if (r.status === 200) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!up) {
    console.error('Test API never became ready. Is the test stack up?');
    process.exit(1);
  }
  console.log('API ready.\n');
}

// ---------------------------------------------------------------------------
console.log('SETUP: initial discovery pass');
{
  const stats = await sync();
  const list = await apps();
  console.log(`   discovered ${stats.seen} group(s); inventory has ${list.length}`);
  check('tool1 discovered via sat.url label', Boolean(byName(list, 'Tool One')));
  check('tool2 discovered', Boolean(byName(list, 'Tool Two')));
  check('tool3 discovered', Boolean(byName(list, 'Tool Three')));
  check(
    'label URL honoured',
    byName(list, 'Tool One')?.url === 'http://tool-one.test.local',
    byName(list, 'Tool One')?.url
  );
  check(
    'infrastructure excluded (no postgres app)',
    !list.some((a) => /sattest-db|postgres/i.test(a.name)),
    list.map((a) => a.name).join(', ')
  );
  check(
    'portal itself excluded',
    !list.some((a) => /sattest-api|sattest-worker|sat-api/i.test(a.name))
  );
  check(
    'new applications have NULL business metadata',
    byName(list, 'Tool Two')?.team == null &&
      byName(list, 'Tool Two')?.developedBy == null
  );
  check('source is docker', byName(list, 'Tool Two')?.source === 'docker');
}

// ---------------------------------------------------------------------------
console.log('\nTEST 1: a new container is auto-created');
{
  await docker([
    'run', '--detach', '--name', 'sattest-tool4',
    '--label', 'sat.name=Tool Four',
    '--label', 'sat.url=tool-four.test.local',
    'nginx:alpine',
  ]);
  await sync();
  const list = await apps();
  const tool4 = byName(list, 'Tool Four');
  check('Tool Four auto-created', Boolean(tool4));
  check('created as Active', tool4?.status === 'Active', tool4?.status);
  check('discovery_status active', tool4?.discoveryStatus === 'active');
  check('first_seen set', Boolean(tool4?.firstSeen));
  check('last_seen set', Boolean(tool4?.lastSeen));
  check('metadata left for an admin', tool4?.team == null && tool4?.developedBy == null);

  const ev = await events(tool4.id);
  check(
    'APPLICATION_DISCOVERED audited',
    ev.some((e) => e.eventType === 'APPLICATION_DISCOVERED'),
    ev.map((e) => e.eventType).join(',')
  );
  const notes = await notifications();
  check(
    'discovery notification raised',
    notes.some((n) => n.type === 'TOOL_DISCOVERED' && n.applicationName === 'Tool Four')
  );
}

// ---------------------------------------------------------------------------
console.log('\nTEST 4: admin metadata survives a discovery pass');
let tool2Id = null;
{
  const list = await apps();
  tool2Id = byName(list, 'Tool Two').id;

  const r = await req(`/applications/${tool2Id}`, {
    method: 'PUT',
    body: JSON.stringify({
      team: 'Analytics',
      developedBy: 'Platform Team',
      gstackImplemented: true,
      notes: 'Owned by the data guild.',
    }),
  });
  check('admin can set metadata', r.status === 200, `got ${r.status}`);
  check('team saved', r.body?.team === 'Analytics', r.body?.team);

  // Server-owned fields must be ignored even when explicitly sent.
  const attack = await req(`/applications/${tool2Id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'HIJACKED',
      url: 'http://evil.test',
      status: 'Inactive',
      source: 'manual',
      team: 'Analytics',
    }),
  });
  check('server-owned name ignored', attack.body?.name === 'Tool Two', attack.body?.name);
  check(
    'server-owned url ignored',
    attack.body?.url === 'http://tool-two.test.local',
    attack.body?.url
  );
  check('server-owned status ignored', attack.body?.status === 'Active', attack.body?.status);

  await sync();
  const after = byName(await apps(), 'Tool Two');
  check('team survives discovery', after?.team === 'Analytics', after?.team);
  check('developedBy survives discovery', after?.developedBy === 'Platform Team');
  check('gstack survives discovery', after?.gstackImplemented === true);
  check('notes survive discovery', after?.notes === 'Owned by the data guild.');
}

// ---------------------------------------------------------------------------
console.log('\nTEST 2: stopping a container marks it Inactive and notifies');
{
  await docker(['container', 'stop', 'sattest-tool2']);
  await sync();
  const tool2 = byName(await apps(), 'Tool Two');
  check('status Inactive', tool2?.status === 'Inactive', tool2?.status);
  check('discovery_status inactive', tool2?.discoveryStatus === 'inactive');
  check('NOT auto-decommissioned', tool2?.decommissioned === false);
  check('metadata still intact', tool2?.team === 'Analytics');
  check('needsReview flagged', tool2?.needsReview === true);

  const ev = await events(tool2Id);
  check(
    'APPLICATION_INACTIVE audited',
    ev.some((e) => e.eventType === 'APPLICATION_INACTIVE' && e.newValue === 'Inactive')
  );

  const stopNotes = (await notifications()).filter(
    (n) => n.type === 'TOOL_STOPPED' && n.applicationName === 'Tool Two'
  );
  check('outage notification raised', stopNotes.length === 1, `count=${stopNotes.length}`);
  check('message names the tool', stopNotes[0]?.message.includes('Tool Two'));
  check('message asks for review', /Action Required/i.test(stopNotes[0]?.message || ''));

  // Spam guard: repeated passes must not pile up duplicates.
  await sync();
  await sync();
  const again = (await notifications()).filter(
    (n) => n.type === 'TOOL_STOPPED' && n.applicationName === 'Tool Two' && !n.isRead
  );
  check('no duplicate outage notifications', again.length === 1, `count=${again.length}`);
}

// ---------------------------------------------------------------------------
console.log('\nTEST 3: restarting a container restores it and notifies');
{
  await docker(['container', 'start', 'sattest-tool2']);
  await sync();
  const tool2 = byName(await apps(), 'Tool Two');
  check('status Active again', tool2?.status === 'Active', tool2?.status);
  check('discovery_status active again', tool2?.discoveryStatus === 'active');
  check('metadata still intact after recovery', tool2?.team === 'Analytics');

  const ev = await events(tool2Id);
  check(
    'APPLICATION_ACTIVE audited',
    ev.some((e) => e.eventType === 'APPLICATION_ACTIVE' && e.newValue === 'Active')
  );

  const notes = await notifications();
  check(
    'recovery notification raised',
    notes.some((n) => n.type === 'TOOL_RESTORED' && n.applicationName === 'Tool Two')
  );
  check(
    'previous outage notification resolved',
    !notes.some(
      (n) => n.type === 'TOOL_STOPPED' && n.applicationName === 'Tool Two' && !n.isRead
    )
  );

  // A second outage must be able to raise a fresh notification.
  await docker(['container', 'stop', 'sattest-tool2']);
  await sync();
  const reopened = (await notifications()).filter(
    (n) => n.type === 'TOOL_STOPPED' && n.applicationName === 'Tool Two' && !n.isRead
  );
  check('a later outage notifies again', reopened.length === 1, `count=${reopened.length}`);
  await docker(['container', 'start', 'sattest-tool2']);
  await sync();
}

// ---------------------------------------------------------------------------
console.log('\nTEST 5: removing a container does NOT delete the application');
{
  const before = await apps();
  const tool4 = byName(before, 'Tool Four');

  await docker(['container', 'stop', 'sattest-tool4']);
  await docker(['container', 'rm', 'sattest-tool4']);
  await sync();

  const after = await apps();
  const stillThere = byName(after, 'Tool Four');
  check('application NOT deleted', Boolean(stillThere));
  check('marked Inactive', stillThere?.status === 'Inactive', stillThere?.status);
  check('NOT decommissioned automatically', stillThere?.decommissioned === false);
  check('inventory count unchanged', after.length === before.length, `${before.length} -> ${after.length}`);
  check('history preserved (first_seen kept)', stillThere?.firstSeen === tool4?.firstSeen);

  // There is deliberately no DELETE route.
  const del = await req(`/applications/${tool4.id}`, { method: 'DELETE' });
  check('DELETE route does not exist', del.status === 404, `got ${del.status}`);

  // POST is gone too — applications cannot be created by hand any more.
  const post = await req('/applications', {
    method: 'POST',
    body: JSON.stringify({ name: 'Manual', url: 'http://x.test', team: 'T', developedBy: 'D' }),
  });
  check('POST (manual create) removed', post.status === 404, `got ${post.status}`);
}

// ---------------------------------------------------------------------------
console.log('\nTEST 6: decommissioning is admin-only and audited');
{
  const tool4 = byName(await apps(), 'Tool Four');
  const r = await req(`/applications/${tool4.id}`, {
    method: 'PUT',
    body: JSON.stringify({ decommissioned: true, notes: 'Replaced by Tool One.' }),
  });
  check('admin can decommission', r.status === 200 && r.body?.decommissioned === true);
  check('leaves the review queue', r.body?.needsReview === false);

  const ev = await events(tool4.id);
  const dec = ev.find((e) => e.eventType === 'APPLICATION_DECOMMISSIONED');
  check('APPLICATION_DECOMMISSIONED audited', Boolean(dec));
  check('audited against the admin, not discovery', dec?.actor === 'tester@cloudfuze.com', dec?.actor);

  // Discovery must not undo an admin's decision.
  await sync();
  const after = byName(await apps(), 'Tool Four');
  check('discovery leaves decommissioned alone', after?.decommissioned === true);
}

// ---------------------------------------------------------------------------
console.log('\nCLEANUP');
{
  try {
    await docker(['container', 'stop', 'sattest-tool4']);
    await docker(['container', 'rm', 'sattest-tool4']);
  } catch {
    /* already gone */
  }
  console.log('   test containers removed');
}

console.log(`\n${'='.repeat(62)}`);
console.log(`PASSED: ${pass}    FAILED: ${failures.length}`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
