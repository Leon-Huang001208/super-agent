import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runImageCloseout } from '../scripts/runtime-image-closeout.mjs';

const repository = 'super-agent-paperclip-runtime';
const name = 'pilot-closeout';
const stableError = { message: /^[A-Z][A-Z0-9_]+$/ };

function fixture(t) {
  const data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sa-closeout-')));
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const state = path.join(data, 'image-reuse-v1');
  const verification = 'sample/daily-summary.json';
  const planPath = path.join(data, 'image-closeout-plans', name + '.json');
  const verificationPath = path.join(data, 'logs', verification);
  for (const directory of [state, path.dirname(planPath), path.dirname(verificationPath), path.join(data, 'archives')]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }

  const localImages = new Map();
  const containers = [];
  const calls = [];
  let sequence = 0;
  function image(register = true) {
    const key = (++sequence).toString(16).padStart(64, '0');
    const imageId = 'sha256:' + (sequence + 100).toString(16).padStart(64, '0');
    const reference = repository + ':input-' + key;
    const generated = { key, imageId, reference, recordPath: path.join(state, key + '.json') };
    const entry = {
      id: imageId,
      key,
      os: 'linux',
      architecture: 'arm64',
      tags: [reference],
      digests: [repository + '@' + imageId],
    };
    localImages.set(reference, entry);
    localImages.set(imageId, entry);
    if (register) {
      writeJson(generated.recordPath, { schemaVersion: 1, key, reference, platform: 'linux/arm64', imageId });
    }
    return generated;
  }
  function config(kind, references) {
    const file = path.join(data, kind + '.yaml');
    fs.writeFileSync(file, references.map((reference, index) =>
      '  app' + index + ':\n    image: ' + reference + '\n').join(''), { mode: 0o600 });
    return { kind, path: file, images: references };
  }
  function bindRole(role, target, { dropInput = false } = {}) {
    const reference = repository + ':' + role;
    const previous = localImages.get(reference);
    const image = localImages.get(target.reference);
    assert(image);
    if (previous) previous.tags = previous.tags.filter(tag => tag !== reference);
    image.tags.push(reference);
    localImages.set(reference, image);
    if (dropInput) {
      image.tags = image.tags.filter(tag => tag !== target.reference);
      localImages.delete(target.reference);
    }
    return reference;
  }

  const current = image();
  const previous = image();
  const startup = config('startup', [current.imageId]);
  const rollback = config('rollback', [previous.reference]);
  const plan = {
    schemaVersion: 1,
    verification,
    current: subject(current),
    previousImageId: previous.imageId,
    configs: [startup, rollback],
    retire: [],
  };
  function pass(overrides = {}) {
    writeJson(verificationPath, {
      status: 'PASS',
      imageId: current.imageId,
      executionClosed: true,
      activeSharedLeases: 0,
      liveModelWorkers: 0,
      ...overrides,
    });
  }
  pass();

  const driver = {
    identity: () => 'fixture-desktop-daemon',
    observe: () => containers.map(container => ({ ...container })),
    inspect: reference => localImages.get(reference)
      ?? [...localImages.values()].find(image => image.id === reference)
      ?? null,
    save({ target, reference, imageId }) {
      assert.equal(driver.inspect(reference)?.id, imageId);
      calls.push(['save', imageId]);
      const contents = Buffer.from('archive of ' + reference + ' ' + imageId + '\n');
      fs.writeFileSync(target, contents, { mode: 0o600 });
      return createHash('sha256').update(contents).digest('hex');
    },
    remove(imageId) {
      calls.push(['remove', imageId]);
      for (const [reference, image] of localImages) {
        if (image.id === imageId) localImages.delete(reference);
      }
    },
  };

  return {
    data, state, planPath, plan, current, previous, startup, rollback, pass,
    image, bindRole, containers, driver, calls,
    run() {
      writeJson(planPath, plan);
      return runImageCloseout({ data, name, driver, log: () => {} });
    },
  };
}

function subject({ key, imageId }) {
  return { key, imageId };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value) + '\n', { mode: 0o600 });
}

test('verified closeout archives then removes only the exact retired image and clears its build record', t => {
  const f = fixture(t);
  const retired = f.image();
  const unrelated = f.image();
  f.plan.retire = [subject(retired)];

  const result = f.run();

  assert.equal(result.status, 'PASS');
  assert.equal(result.images.find(image => image.imageId === retired.imageId)?.decision, 'retired');
  assert.deepEqual(f.calls, [['save', retired.imageId], ['remove', retired.imageId]]);
  assert.equal(f.driver.inspect(retired.imageId), null);
  assert.equal(f.driver.inspect(retired.reference), null);
  assert.equal(fs.existsSync(retired.recordPath), false);
  for (const keep of [f.current, f.previous, unrelated]) {
    assert.equal(f.driver.inspect(keep.reference)?.id, keep.imageId);
    assert.equal(fs.existsSync(keep.recordPath), true);
  }
  assert.equal(fs.existsSync(path.join(f.state, 'build.lock')), false);
  assert.deepEqual(f.run(), result);
  assert.deepEqual(f.calls, [['save', retired.imageId], ['remove', retired.imageId]]);
});

test('failed, open, mismatched and still-active verification receipts gate all retirement', t => {
  const f = fixture(t);
  const retired = f.image();
  f.plan.retire = [subject(retired)];

  for (const overrides of [
    { status: 'FAIL' },
    { executionClosed: false },
    { imageId: retired.imageId },
    { activeSharedLeases: 1 },
    { liveModelWorkers: 1 },
  ]) {
    f.pass(overrides);
    assert.throws(() => f.run(), stableError);
  }

  assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(retired.recordPath), true);
});

test('a passed receipt does not authorize retirement if the verified image identity changed', t => {
  const f = fixture(t);
  const retired = f.image();
  f.plan.retire = [subject(retired)];
  f.driver.inspect(f.current.reference).id = retired.imageId;

  assert.throws(() => f.run(), stableError);
  assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(retired.recordPath), true);
});

test('a verified current image can use a role tag after dropping its input tag', t => {
  const f = fixture(t);
  const production = f.bindRole('production', f.current, { dropInput: true });
  const retired = f.image();
  f.plan.retire = [subject(retired)];

  assert.equal(f.driver.inspect(f.current.reference), null);
  assert.equal(f.run().status, 'PASS');
  assert.deepEqual(f.calls, [['save', retired.imageId], ['remove', retired.imageId]]);
  assert.equal(f.driver.inspect(production)?.id, f.current.imageId);
});

test('all three role tags protect their exact images without a container or explicit configuration pin', t => {
  const f = fixture(t);
  const assigned = ['production', 'development', 'rollback'].map(role => {
    const image = f.image();
    f.bindRole(role, image, { dropInput: true });
    return image;
  });
  f.plan.retire = assigned.map(subject);

  const result = f.run();

  assert.equal(result.status, 'PASS');
  assert.deepEqual(result.images.map(row => row.decision), assigned.map(() => 'keep-protected'));
  assert.deepEqual(f.calls, []);
});

test('an untagged former role image is archived and removed by its registered full ID', t => {
  const f = fixture(t);
  const former = f.image();
  f.bindRole('development', former, { dropInput: true });
  f.bindRole('development', f.current);
  f.plan.retire = [subject(former)];
  const save = f.driver.save;
  f.driver.save = params => {
    assert.equal(params.reference, former.imageId);
    return save(params);
  };

  const result = f.run();

  assert.equal(result.images[0].decision, 'retired');
  assert.deepEqual(f.calls, [['save', former.imageId], ['remove', former.imageId]]);
  assert.equal(fs.existsSync(former.recordPath), false);
  assert.deepEqual(f.run(), result);
});

test('a drifted input tag or foreign tag blocks the anonymous archive path', t => {
  const f = fixture(t);
  const drifted = f.image();
  const foreign = f.image();
  f.bindRole('production', drifted, { dropInput: true });
  f.bindRole('development', foreign, { dropInput: true });
  f.bindRole('production', f.current);
  f.bindRole('development', f.current);
  f.driver.inspect(foreign.imageId).tags.push('other-project:live');
  const inspect = f.driver.inspect;
  f.driver.inspect = ref => ref === drifted.reference ? inspect(f.current.reference) : inspect(ref);
  f.plan.retire = [drifted, foreign].map(subject);

  assert.deepEqual(f.run().images.map(row => row.decision), ['keep-unknown', 'keep-unknown']);
  assert.deepEqual(f.calls, []);
});

test('an input tag appearing after an anonymous archive prevents removal', t => {
  const f = fixture(t);
  const former = f.image();
  f.bindRole('development', former, { dropInput: true });
  f.bindRole('development', f.current);
  f.plan.retire = [subject(former)];
  const save = f.driver.save;
  const inspect = f.driver.inspect;
  f.driver.save = params => {
    assert.equal(params.reference, former.imageId);
    const result = save(params);
    const image = inspect(former.imageId);
    image.tags.push(former.reference);
    f.driver.inspect = ref => ref === former.reference ? image : inspect(ref);
    return result;
  };

  assert.equal(f.run().images[0].decision, 'keep-unknown');
  assert.deepEqual(f.calls, [['save', former.imageId]]);
});

test('current, previous verified, startup and rollback image pins all survive an explicit retirement list', t => {
  const f = fixture(t);
  const startup = f.image();
  const rollback = f.image();
  fs.appendFileSync(f.startup.path, '  resume:\n    image: ' + startup.reference + '\n');
  fs.appendFileSync(f.rollback.path, '  restore:\n    image: ' + rollback.imageId + '\n');
  f.startup.images = [f.current.imageId, startup.reference];
  f.rollback.images = [rollback.imageId];
  const protectedImages = [f.current, f.previous, startup, rollback];
  f.plan.retire = protectedImages.map(subject);

  const result = f.run();

  for (const image of protectedImages) {
    assert.equal(result.images.find(item => item.imageId === image.imageId)?.decision, 'keep-protected');
    assert.equal(fs.existsSync(image.recordPath), true);
  }
  assert.deepEqual(f.calls, []);
});

test('actual container image IDs and stale stopped-container original tags both prevent retirement', t => {
  const f = fixture(t);
  const running = f.image();
  const stopped = f.image();
  const legacyHubAlias = f.image();
  const hubAlias = f.image();
  const protectedImages = [running, stopped, legacyHubAlias, hubAlias];
  f.plan.retire = protectedImages.map(subject);
  f.containers.push(
    { imageId: running.imageId, image: f.current.reference, project: 'super-agent-paperclip-eval', configFiles: [], state: 'running' },
    { imageId: f.current.imageId, image: stopped.reference, project: 'super-agent-paperclip-eval', configFiles: [], state: 'exited' },
    { imageId: f.current.imageId, image: 'index.docker.io/' + legacyHubAlias.reference, project: '', configFiles: [], state: 'exited' },
    { imageId: f.current.imageId, image: 'docker.io/' + hubAlias.reference, project: '', configFiles: [], state: 'exited' },
  );

  const result = f.run();

  for (const image of protectedImages) {
    assert.equal(result.images.find(item => item.imageId === image.imageId)?.decision, 'keep-protected');
    assert.equal(fs.existsSync(image.recordPath), true);
  }
  assert.deepEqual(f.calls, []);
});

test('a pinned runtime in a Docker-attached Compose file is protected even if unlisted in the plan', t => {
  const f = fixture(t);
  const pinned = f.image();
  const observed = path.join(f.data, 'attached.yaml');
  fs.writeFileSync(observed, 'services:\n  app:\n    image: "' + pinned.reference + '"\n', { mode: 0o600 });
  f.containers.push({
    imageId: f.current.imageId,
    image: f.current.reference,
    project: 'super-agent-paperclip-eval',
    configFiles: [observed],
  });
  f.plan.retire = [subject(pinned)];

  const result = f.run();

  assert.equal(result.images.find(item => item.imageId === pinned.imageId)?.decision, 'keep-protected');
  assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(pinned.recordPath), true);
});

test('an attached Compose interpolation blocks retirement until the plan supplies its resolved image', t => {
  const f = fixture(t);
  const pinned = f.image();
  const observed = path.join(f.data, 'interpolated.yaml');
  fs.writeFileSync(observed, 'services:\n  app:\n    image: "' + repository + ':input-${SA_KEY}"\n', { mode: 0o600 });
  f.containers.push({
    imageId: f.current.imageId,
    image: f.current.reference,
    project: 'super-agent-paperclip-eval',
    configFiles: [observed],
  });
  f.plan.retire = [subject(pinned)];

  assert.throws(() => f.run(), stableError);
  f.plan.configs.push({ kind: 'startup', path: observed, images: [pinned.imageId] });
  const result = f.run();

  assert.equal(result.images.find(item => item.imageId === pinned.imageId)?.decision, 'keep-protected');
  assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(pinned.recordPath), true);
});

test('an attached Compose include cannot hide a runtime pin from retirement protection', t => {
  const f = fixture(t);
  const pinned = f.image();
  const attached = path.join(f.data, 'attached.yaml');
  const included = path.join(f.data, 'included.yaml');
  fs.writeFileSync(attached, 'include: included.yaml\n', { mode: 0o600 });
  fs.writeFileSync(included, 'services:\n  app:\n    image: ' + pinned.reference + '\n', { mode: 0o600 });
  f.containers.push({
    imageId: f.current.imageId,
    image: f.current.reference,
    project: 'super-agent-paperclip-eval',
    configFiles: [attached],
  });
  f.plan.retire = [subject(pinned)];

  assert.throws(() => f.run(), stableError);
  assert.deepEqual(f.calls, []);
  assert.equal(f.driver.inspect(pinned.reference)?.id, pinned.imageId);
});

test('unknown registry identities and unexpected image aliases are kept for review', t => {
  const f = fixture(t);
  const unknown = f.image(false);
  const extraTag = f.image();
  const foreignDigest = f.image();
  f.driver.inspect(extraTag.reference).tags.push(repository + ':another-name');
  f.driver.inspect(foreignDigest.reference).digests.push('other-app@' + foreignDigest.imageId);
  f.plan.retire = [unknown, extraTag, foreignDigest].map(subject);

  const result = f.run();

  assert.deepEqual(result.images.map(image => image.decision), ['keep-unknown', 'keep-unknown', 'keep-unknown']);
  assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(extraTag.recordPath), true);
  assert.equal(fs.existsSync(foreignDigest.recordPath), true);
});

test('unsafe plan references and malformed retire identities never reach the Docker mutation', t => {
  const f = fixture(t);
  const retired = f.image();
  for (const overrides of [
    { verification: '../sample/daily-summary.json', retire: [subject(retired)] },
    { previousImageId: 'sha256:123', retire: [subject(retired)] },
    { retire: [{ key: retired.key, imageId: 'sha256:123' }] },
  ]) {
    const original = { ...f.plan };
    Object.assign(f.plan, overrides);
    assert.throws(() => f.run(), stableError);
    Object.assign(f.plan, original);
  }

  assert.deepEqual(f.calls, []);
  assert.equal(fs.existsSync(retired.recordPath), true);
});

test('a new container image reference after the archive is saved stops retirement', t => {
  const f = fixture(t);
  const retired = f.image();
  f.plan.retire = [subject(retired)];
  const save = f.driver.save;
  f.driver.save = params => {
    const result = save(params);
    f.containers.push({
      imageId: retired.imageId,
      image: retired.reference,
      project: 'super-agent-paperclip-eval',
      configFiles: [],
    });
    return result;
  };

  const result = f.run();

  assert.equal(result.images.find(image => image.imageId === retired.imageId)?.decision, 'keep-protected');
  assert.deepEqual(f.calls, [['save', retired.imageId]]);
  assert.equal(fs.existsSync(retired.recordPath), true);
  assert.equal(fs.existsSync(path.join(f.state, 'build.lock')), false);
});

test('repointing the rollback role during archive stops the pending retirement', t => {
  const f = fixture(t);
  const retired = f.image();
  f.plan.retire = [subject(retired)];
  const rollback = f.bindRole('rollback', f.previous);
  const save = f.driver.save;
  f.driver.save = params => {
    const result = save(params);
    f.bindRole('rollback', retired);
    return result;
  };

  const result = f.run();

  assert.equal(result.images.find(row => row.imageId === retired.imageId)?.decision, 'keep-protected');
  assert.equal(f.driver.inspect(rollback)?.id, retired.imageId);
  assert.deepEqual(f.calls, [['save', retired.imageId]]);
  assert.equal(fs.existsSync(retired.recordPath), true);
});

test('uncertain removal preserves the original registry entry, archive and build lock', t => {
  const f = fixture(t);
  const retired = f.image();
  f.plan.retire = [subject(retired)];
  const save = f.driver.save;
  let archived;
  f.driver.save = params => {
    archived = params.target;
    return save(params);
  };
  let removals = 0;
  f.driver.remove = () => {
    removals++;
    throw new Error('IMAGE_REMOVE_OUTCOME_UNKNOWN');
  };

  assert.throws(() => f.run(), stableError);
  assert.equal(removals, 1);
  assert.equal(fs.existsSync(retired.recordPath), true);
  assert.equal(fs.existsSync(archived), true);
  assert.equal(fs.existsSync(path.join(f.state, 'build.lock')), true);
  assert.throws(() => f.run(), stableError);
  assert.equal(removals, 1);
});

test('an apparent success with the exact image ID still present cannot remove its build record', t => {
  const f = fixture(t);
  const retired = f.image();
  f.plan.retire = [subject(retired)];
  const inspect = f.driver.inspect;
  let removeCalled = false;
  f.driver.inspect = reference => removeCalled && reference === retired.reference ? null : inspect(reference);
  f.driver.remove = () => { removeCalled = true; };

  assert.throws(() => f.run(), stableError);
  assert.equal(removeCalled, true);
  assert.equal(fs.existsSync(retired.recordPath), true);
  assert.equal(fs.existsSync(path.join(f.state, 'build.lock')), true);
});

test('an existing build lock prevents retirement and is left in place', t => {
  const f = fixture(t);
  const retired = f.image();
  f.plan.retire = [subject(retired)];
  const lock = path.join(f.state, 'build.lock');
  fs.mkdirSync(lock, { mode: 0o700 });
  fs.writeFileSync(path.join(lock, 'owner'), 'another operation');

  assert.throws(() => f.run(), stableError);
  assert.deepEqual(f.calls, []);
  assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8'), 'another operation');
  assert.equal(fs.existsSync(retired.recordPath), true);
});
