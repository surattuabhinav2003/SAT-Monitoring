/**
 * SAT Monitoring — Docker discovery acceptance tests.
 *
 *   docker compose -p sattest -f docker-compose.test.yml up -d --build
 *   node scripts/test-discovery.mjs
 *   docker compose -p sattest -f docker-compose.test.yml down -v
 *
 * The harness mirrors production: the API has NO Docker access and requests
 * scans from the worker over Postgres NOTIFY. Auth is bypassed so no Azure
 * tenant is needed.
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function docker(args) {
  try {
    const { stdout } = await exec('docker', args);
    return stdout.trim();
  } catch (err) {
    throw new Error(`docker ${args.join(' ')} failed: ${err.message}`);
  }
}

async function removeIfPresent(name) {
  try {
    await docker(['container', 'stop', name]);
  } catch {
    /* not running */
  }
  try {
    await docker(['container', 'rm', name]);
  } catch {
    /* not present */
  }
}

async function latestRun() {
  const r = await req('/applications/discovery');
  return r.body?.latestRun ?? null;
}

async function latestRunId() {
  return (await latestRun())?.id ?? 0;
}

/**
 * Wait until no pass is in flight.
 *
 * Necessary before requesting one: the worker deliberately COALESCES a request
 * that arrives while a pass is running, so firing blindly can produce no new run
 * at all. Every sync() therefore starts from a known-idle state.
 */
async function waitForIdle(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await latestRun();
    if (!run || run.completedAt) return;
    await sleep(400);
  }
  throw new Error('a discovery run never finished');
}

/**
 * Run a discovery pass and return the completed run.
 *
 * The endpoint notifies the worker and waits for it, so the response IS the
 * result — no polling needed here. waitForIdle first because the worker coalesces
 * a request that arrives mid-pass, which would otherwise return the previous run.
 */
async function sync() {
  await waitForIdle();
  const before = await latestRunId();

  const r = await req('/applications/discovery/run', { method: 'POST' });
  if (r.status !== 200) {
    throw new Error(`discovery run failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  if (!r.body?.completedAt) {
    throw new Error(`run did not complete: ${JSON.stringify(r.body)}`);
  }
  if (!(r.body.id > before)) {
    throw new Error(`stale run returned (${r.body.id} <= ${before})`);
  }
  return r.body;
}

async function apps() {
  const r = await req('/applications');
  if (r.status !== 200) throw new Error(`list failed: ${r.status}`);
  return r.body;
}

const byName = (list, name) => list.find((a) => a.name === name);

async function events(id) {
  const r = await req(`/applications/${id}/events`);
  return r.status === 200 ? r.body : [];
}

async function notifications() {
  const r = await req('/notifications');
  return r.status === 200 ? r.body : [];
}

async function approve(id) {
  return req(`/applications/${id}/approve`, { method: 'POST' });
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
    await sleep(2000);
  }
  if (!up) {
    console.error('Test API never became ready. Is the test stack up?');
    process.exit(1);
  }
  console.log('API ready.\n');
}

/**
 * Clear the test database so the suite is repeatable.
 *
 * Several tests assert first-discovery behaviour (pending_review, "no URL
 * invented", approval), which only holds for rows this run created. Without this
 * the suite passes once on a fresh stack and then fails on its own leftovers.
 *
 * `admins` is deliberately preserved — the seeded admin is what authorises the
 * requests the suite makes.
 */
async function resetDatabase() {
  await docker([
    'exec', 'sattest-db', 'psql', '-U', 'sat', '-d', 'sat_test', '-c',
    'TRUNCATE applications, notifications, application_events, discovery_runs RESTART IDENTITY CASCADE;',
  ]);
}

console.log('SETUP: clearing leftovers from any previous run');
await removeIfPresent('sattest-tool4');
await resetDatabase();
console.log('   database reset (applications, notifications, events, runs)');

// ---------------------------------------------------------------------------
console.log('\nTEST A: the API has no Docker privileges');
{
  const h = await req('/health');
  check('health reports dockerAccess false', h.body?.dockerAccess === false, JSON.stringify(h.body));
  const state = await req('/applications/discovery');
  check('API scheduler disabled', state.body?.enabled === false, String(state.body?.enabled));

  await waitForIdle();
  const t0 = Date.now();
  const r = await req('/applications/discovery/run', { method: 'POST' });
  const ms = Date.now() - t0;

  // The API cannot reach Docker, so the worker does the scan — but the caller
  // still gets the outcome rather than an acknowledgement.
  check('manual scan returns the completed run (200)', r.status === 200, `got ${r.status}`);
  check('response carries real counts', typeof r.body?.containersScanned === 'number', JSON.stringify(r.body));
  check('run is completed', Boolean(r.body?.completedAt));
  check('attributed to the caller', r.body?.requestedBy === 'tester@cloudfuze.com', r.body?.requestedBy);
  check('returns promptly', ms < 15000, `${ms}ms`);
  await waitForIdle();
}

// ---------------------------------------------------------------------------
console.log('\nSETUP: first full pass (driven by the worker)');
{
  const run = await sync();
  const list = await apps();
  console.log(`   scanned ${run.containersScanned}, inventory ${list.length}`);

  check('worker completed the requested run', Boolean(run.completedAt));
  check('run recorded the trigger', run.trigger === 'manual', run.trigger);
  check('run attributed to the requester', run.requestedBy === 'tester@cloudfuze.com', run.requestedBy);
  check('run counted containers scanned', run.containersScanned > 0, String(run.containersScanned));
  check('run recorded no errors', !run.errors, run.errors || '');

  check('tool1 discovered', Boolean(byName(list, 'Tool One')));
  check('tool2 discovered', Boolean(byName(list, 'Tool Two')));
  check('tool3 discovered', Boolean(byName(list, 'Tool Three')));
}

// ---------------------------------------------------------------------------
console.log('\nTEST B: URL resolution order — label, nginx, then Needs Mapping');
{
  const list = await apps();
  const t1 = byName(list, 'Tool One');
  const t2 = byName(list, 'Tool Two');
  const t3 = byName(list, 'Tool Three');

  check('priority 1: label URL used', t1?.url === 'http://tool-one.test.local', t1?.url);
  check('priority 1: urlSource=label', t1?.urlSource === 'label', t1?.urlSource);

  check(
    'priority 2: nginx URL used',
    t2?.url === 'http://tool-two-from-nginx.test.local',
    t2?.url
  );
  check('priority 2: urlSource=nginx', t2?.urlSource === 'nginx', t2?.urlSource);

  check('priority 3: no URL invented', t3?.url === null, String(t3?.url));
  check('priority 3: flagged needsMapping', t3?.needsMapping === true);
  check('priority 3: urlSource null', t3?.urlSource === null, String(t3?.urlSource));

  // The old behaviour would have produced this from the container name.
  check(
    'container-name URL generation removed',
    !list.some((a) => a.url && a.url.includes('sattesttool')),
    list.map((a) => a.url).join(', ')
  );

  // An admin can supply the missing hostname.
  const set = await req(`/applications/${t3.id}/url`, {
    method: 'PUT',
    body: JSON.stringify({ url: 'tool-three.manual.local' }),
  });
  check('admin can set a URL', set.status === 200, `got ${set.status}`);
  check('URL normalised to https', set.body?.url === 'https://tool-three.manual.local', set.body?.url);
  check('urlSource=manual', set.body?.urlSource === 'manual', set.body?.urlSource);
  const ev = await events(t3.id);
  check('URL change audited', ev.some((e) => e.eventType === 'APPLICATION_URL_SET'));

  const bad = await req(`/applications/${t3.id}/url`, {
    method: 'PUT',
    body: JSON.stringify({ url: '' }),
  });
  check('empty URL rejected', bad.status === 400, `got ${bad.status}`);
}

// ---------------------------------------------------------------------------
console.log('\nTEST C: infrastructure exclusions');
{
  const list = await apps();
  const names = list.map((a) => a.name.toLowerCase()).join(' | ');
  for (const banned of ['postgres', 'mongo', 'redis', 'nginx', 'traefik', 'worker', 'sat api', 'sat db']) {
    check(`excluded: ${banned}`, !names.includes(banned), names);
  }
  check('harness api/worker excluded via sat.ignore', !/sattest/i.test(names), names);
}

// ---------------------------------------------------------------------------
console.log('\nTEST D: review workflow — pending_review then approval');
let tool2Id = null;
{
  const list = await apps();
  const t2 = byName(list, 'Tool Two');
  tool2Id = t2.id;

  check('new application is pending_review', t2?.discoveryStatus === 'pending_review', t2?.discoveryStatus);
  check('pendingReview flag exposed', t2?.pendingReview === true);
  check('business metadata left blank', t2?.team == null && t2?.developedBy == null);
  check('not approved yet', !t2?.approvedAt);

  // Discovery must not self-approve on a later pass.
  await sync();
  const still = byName(await apps(), 'Tool Two');
  check('discovery does NOT auto-approve', still?.discoveryStatus === 'pending_review');

  const ok = await approve(tool2Id);
  check('admin can approve', ok.status === 200, `got ${ok.status}`);
  check('becomes active on approval', ok.body?.discoveryStatus === 'active', ok.body?.discoveryStatus);
  check('records who approved', ok.body?.approvedBy === 'tester@cloudfuze.com', ok.body?.approvedBy);
  check('records when', Boolean(ok.body?.approvedAt));

  const ev = await events(tool2Id);
  check('approval audited', ev.some((e) => e.eventType === 'APPLICATION_APPROVED'));

  const again = await approve(tool2Id);
  check('re-approval rejected', again.status === 409, `got ${again.status}`);
}

// ---------------------------------------------------------------------------
console.log('\nTEST E: admin metadata survives discovery');
{
  const r = await req(`/applications/${tool2Id}`, {
    method: 'PUT',
    body: JSON.stringify({
      team: 'Infra',
      developedBy: 'Platform Team',
      gstackImplemented: true,
      notes: 'Owned by the data guild.',
    }),
  });
  check('metadata saved', r.status === 200 && r.body?.team === 'Infra', `got ${r.status}`);

  // Server-owned fields must be ignored even when explicitly sent.
  const attack = await req(`/applications/${tool2Id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'HIJACKED',
      url: 'http://evil.test',
      status: 'Inactive',
      source: 'manual',
      discoveryStatus: 'pending_review',
      team: 'Infra',
    }),
  });
  check('name ignored', attack.body?.name === 'Tool Two', attack.body?.name);
  check('url ignored on the metadata route', attack.body?.url !== 'http://evil.test', attack.body?.url);
  check('status ignored', attack.body?.status !== 'Inactive', attack.body?.status);
  check('discoveryStatus ignored', attack.body?.discoveryStatus === 'active', attack.body?.discoveryStatus);

  await sync();
  const after = byName(await apps(), 'Tool Two');
  check('team survives', after?.team === 'Infra', after?.team);
  check('developedBy survives', after?.developedBy === 'Platform Team');
  check('gstack survives', after?.gstackImplemented === true);
  check('notes survive', after?.notes === 'Owned by the data guild.');
  check('approval survives', after?.discoveryStatus === 'active');
}

// ---------------------------------------------------------------------------
console.log('\nTEST F: a new container is auto-created, pending review');
{
  await docker([
    'run', '--detach', '--name', 'sattest-tool4',
    '--label', 'sat.name=Tool Four',
    '--label', 'sat.url=tool-four.test.local',
    'httpd:alpine',
  ]);
  const run = await sync();
  const t4 = byName(await apps(), 'Tool Four');

  check('Tool Four created', Boolean(t4));
  check('pending review', t4?.discoveryStatus === 'pending_review');
  check('Active status', t4?.status === 'Active', t4?.status);
  check('first_seen set', Boolean(t4?.firstSeen));
  check('run counted the discovery', run.applicationsDiscovered >= 1, String(run.applicationsDiscovered));

  const ev = await events(t4.id);
  check('discovery audited', ev.some((e) => e.eventType === 'APPLICATION_DISCOVERED'));
  const notes = await notifications();
  check('notification raised', notes.some((n) => n.type === 'TOOL_DISCOVERED' && n.applicationName === 'Tool Four'));

  await approve(t4.id);
}

// ---------------------------------------------------------------------------
console.log('\nTEST G: stop -> Inactive + notification; restart -> recovery');
{
  await docker(['container', 'stop', 'sattest-tool2']);
  await sync();
  let t2 = byName(await apps(), 'Tool Two');
  check('Inactive', t2?.status === 'Inactive', t2?.status);
  check('discovery_status inactive', t2?.discoveryStatus === 'inactive');
  check('NOT auto-decommissioned', t2?.decommissionState === 'none', t2?.decommissionState);
  check('metadata intact', t2?.team === 'Infra');
  check('needsReview flagged', t2?.needsReview === true);
  check('docker_state recorded', Boolean(t2?.dockerState), String(t2?.dockerState));

  const stopNotes = (await notifications()).filter(
    (n) => n.type === 'TOOL_STOPPED' && n.applicationName === 'Tool Two' && !n.isRead
  );
  check('one outage notification', stopNotes.length === 1, `count=${stopNotes.length}`);

  await sync();
  await sync();
  const dupes = (await notifications()).filter(
    (n) => n.type === 'TOOL_STOPPED' && n.applicationName === 'Tool Two' && !n.isRead
  );
  check('no duplicate outage notifications', dupes.length === 1, `count=${dupes.length}`);

  await docker(['container', 'start', 'sattest-tool2']);
  await sync();
  t2 = byName(await apps(), 'Tool Two');
  check('Active again', t2?.status === 'Active', t2?.status);
  check('metadata intact after recovery', t2?.team === 'Infra');
  const notes = await notifications();
  check('recovery notification', notes.some((n) => n.type === 'TOOL_RESTORED' && n.applicationName === 'Tool Two'));
  check(
    'outage resolved',
    !notes.some((n) => n.type === 'TOOL_STOPPED' && n.applicationName === 'Tool Two' && !n.isRead)
  );
}

// ---------------------------------------------------------------------------
console.log('\nTEST H: container removal never deletes the application');
{
  const before = await apps();
  const t4 = byName(before, 'Tool Four');

  await removeIfPresent('sattest-tool4');
  await sync();

  const after = await apps();
  const still = byName(after, 'Tool Four');
  check('NOT deleted', Boolean(still));
  check('marked Inactive', still?.status === 'Inactive', still?.status);
  check('NOT decommissioned automatically', still?.decommissionState === 'none', still?.decommissionState);
  check('inventory count unchanged', after.length === before.length, `${before.length} -> ${after.length}`);
  check('history preserved', still?.firstSeen === t4?.firstSeen);

  const del = await req(`/applications/${t4.id}`, { method: 'DELETE' });
  check('DELETE route absent', del.status === 404, `got ${del.status}`);
  const post = await req('/applications', {
    method: 'POST',
    body: JSON.stringify({ name: 'Manual', url: 'http://x.test' }),
  });
  check('POST route absent', post.status === 404, `got ${post.status}`);
}

// ---------------------------------------------------------------------------
console.log('\nTEST I: decommissioning is an admin decision, audited');
{
  const t4 = byName(await apps(), 'Tool Four');
  const r = await req(`/applications/${t4.id}`, {
    method: 'PUT',
    body: JSON.stringify({ decommissionState: 'done', notes: 'Replaced by Tool One.' }),
  });
  check('admin can decommission', r.status === 200 && r.body?.decommissionState === 'done', r.body?.decommissionState);
  check('leaves the review queue', r.body?.needsReview === false);

  const ev = await events(t4.id);
  const dec = ev.find((e) => e.eventType === 'APPLICATION_DECOMMISSION_CHANGED');
  check('decommission audited', Boolean(dec));
  check('attributed to the admin', dec?.actor === 'tester@cloudfuze.com', dec?.actor);

  await sync();
  check('discovery leaves it decommissioned', byName(await apps(), 'Tool Four')?.decommissionState === 'done');
}

// ---------------------------------------------------------------------------
console.log('\nTEST J: discovery run metrics');
{
  const state = await req('/applications/discovery');
  const runs = state.body?.runs || [];
  check('runs recorded', runs.length > 0, String(runs.length));
  const r = runs[0];
  check('has started_at', Boolean(r?.startedAt));
  check('has completed_at', Boolean(r?.completedAt));
  check('has containers_scanned', typeof r?.containersScanned === 'number');
  check('has applications_discovered', typeof r?.applicationsDiscovered === 'number');
  check('has applications_updated', typeof r?.applicationsUpdated === 'number');
  check('has duration', typeof r?.durationMs === 'number');
  check('every run is attributed', runs.every((x) => x.trigger));
}

// ---------------------------------------------------------------------------
console.log('\nTEST K: concurrent passes are serialised by the advisory lock');
{
  // Fire several requests at once; the lock must ensure they do not interleave.
  await waitForIdle();
  const before = await latestRunId();
  await Promise.all(
    Array.from({ length: 4 }, () => req('/applications/discovery/run', { method: 'POST' }))
  );
  await sleep(8000);
  await waitForIdle();

  const state = await req('/applications/discovery');
  const runs = (state.body?.runs || []).filter((r) => r.id > before);
  const overlapping = runs.filter((r) => !r.completedAt).length;
  check('at least one pass ran', runs.length >= 1, `runs=${runs.length}`);
  // Coalescing is correct: 4 requests need not produce 4 runs.
  check('no run left unfinished', overlapping === 0, `unfinished=${overlapping}`);
  check('no run errored', runs.every((r) => !r.errors), runs.map((r) => r.errors).filter(Boolean).join('; '));

  // Applications must not be duplicated by concurrent passes.
  const list = await apps();
  const names = list.map((a) => a.name);
  check('no duplicate applications', new Set(names).size === names.length, names.join(', '));
}

// ---------------------------------------------------------------------------
console.log('\nCLEANUP');
await removeIfPresent('sattest-tool4');
console.log('   test containers removed');

console.log(`\n${'='.repeat(62)}`);
console.log(`PASSED: ${pass}    FAILED: ${failures.length}`);
if (failures.length) {
  console.log('\nFAILURES:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  process.exit(1);
}
