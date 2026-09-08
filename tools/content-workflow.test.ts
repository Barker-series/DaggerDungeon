import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const snapshot =
  'DDSNAP1{"seed":1234,"stack":1,"opx":-1,"opz":0,"x":280.5,"y":18.5,"z":277.5,"yaw":0,"pitch":0.1}';
const view = {
  id: 'core-switchback',
  feature: 'Framed stairs',
  purpose: 'Inspect ascending flight',
  source: 'docs/framed-buildings.md',
  snapshot,
};

test('command planning rejects invalid args and validates every snapshot before spawning', async () => {
  const { planCommands } = await import('./content-workflow');
  for (const args of [
    ['wat'],
    ['list', 'all'],
    ['check'],
    ['preview'],
    ['check', 'materials', '--oops'],
    ['check', '__proto__'],
    ['preview', '../bad'],
    ['preview', 'missing'],
  ])
    assert.throws(() => planCommands(args, [view]));
  assert.throws(() =>
    planCommands(['preview', view.id], [view, { ...view, id: 'other', snapshot: 'bad' }]),
  );
  assert.deepEqual(planCommands(['preview', view.id], [view]), [
    {
      id: 'preview-core-switchback',
      argv: [
        'node_modules/tsx/dist/cli.mjs',
        'tools/debug-view.ts',
        snapshot,
        'artifacts/content/core-switchback.png',
      ],
      output: 'artifacts/content/core-switchback.png',
    },
  ]);
  assert.equal(planCommands(['preview', 'all'], [view]).length, 1);
  assert.deepEqual(planCommands(['check', 'authoring'], [view])[0]!.argv, [
    'node_modules/tsx/dist/cli.mjs',
    '--test',
    'tools/content-workflow.test.ts',
  ]);
  assert.deepEqual(
    planCommands(['check', 'world'], [view]).map((c) => c.argv),
    [
      ['node_modules/tsx/dist/cli.mjs', 'tools/verify-world.ts'],
      ['node_modules/tsx/dist/cli.mjs', 'tools/verify-migration.ts'],
      ['node_modules/typescript/bin/tsc'],
      ['node_modules/vite/bin/vite.js', 'build', '--outDir', 'artifacts/content/build'],
    ],
  );
  assert.deepEqual(planCommands(['list'], [view]), []);
  assert.deepEqual(planCommands([], [view]), []);
});

test('runner passes argument arrays without shell, saves diagnostics and stops on child failure', async () => {
  const { planCommands, runCommands, ROOT } = await import('./content-workflow');
  const calls: unknown[] = [],
    saved: unknown[] = [],
    logs: string[] = [];
  const commands = planCommands(['check', 'materials'], [view]);
  const deps = {
    log: (s: string) => logs.push(s),
    save: (p: string, s: string) => saved.push([p, s]),
    spawn: (exe: string, argv: string[], options: unknown) => {
      calls.push([exe, argv, options]);
      return { status: 7, stdout: 'diagnostic', stderr: 'failed' };
    },
  };
  assert.equal(runCommands(commands, deps), 7);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    process.execPath,
    commands[0]!.argv,
    { cwd: ROOT, shell: false, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ]);
  assert.ok(JSON.stringify(saved).includes('artifacts/content/texture-repetition.test.log'));
  assert.ok(logs.join('\n').includes('diagnostic'));
  for (const result of [
    { status: null, signal: 'SIGTERM' },
    { status: null, error: new Error('ENOENT') },
  ])
    assert.notEqual(runCommands(commands, { ...deps, spawn: () => result }), 0);
  assert.equal(runCommands(commands, { ...deps, spawn: () => ({ status: 0 }) }), 0);
  const previews = planCommands(['preview', view.id], [view]);
  assert.equal(
    runCommands(previews, {
      ...deps,
      prepareOutput: () => {},
      validOutput: () => true,
      spawn: () => ({ status: 0, stdout: '5 missing-ray pixels' }),
    }),
    0,
  );
  assert.match(logs.join('\n'), /not.*clean|not.*audit pass/i);
});

test('preview requires a fresh, complete, decodable PNG despite a zero converter status', async () => {
  const { planCommands, runCommands } = await import('./content-workflow');
  const id = 'workflow-output-test';
  const commands = planCommands(['preview', id], [{ ...view, id }]);
  const output = commands[0]!.output!;
  mkdirSync('artifacts/content', { recursive: true });
  const truncatedHeader = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
  ]);
  // Complete 1x1 gray+alpha PNG, including compressed pixels and chunk CRCs.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  const badLength = Buffer.from(png);
  badLength.writeUInt32BE(0xffffffff, 33);
  const badCRC = Buffer.from(png);
  badCRC[29] ^= 1;
  const badPixels = Buffer.from(png);
  badPixels[41] = 0; // Invalid zlib header, but retain a correct IDAT CRC.
  let crc = 0xffffffff;
  for (const byte of badPixels.subarray(37, 52)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  badPixels.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 52);
  const badSignature = Buffer.from(png);
  badSignature[0] = 0;
  const invalidPNGs: [string, Buffer][] = [
    ['non-PNG', Buffer.from('not a PNG')],
    ['old 24-byte header fixture', truncatedHeader],
    ['bad signature', badSignature],
    ['truncated IHDR', png.subarray(0, 32)],
    ['truncated IDAT', png.subarray(0, 48)],
    ['truncated IEND', png.subarray(0, -1)],
    ['missing IEND', png.subarray(0, -12)],
    ['missing IDAT', Buffer.concat([png.subarray(0, 33), png.subarray(-12)])],
    ['out-of-bounds chunk', badLength],
    ['bad CRC', badCRC],
    ['undecodable pixels with valid CRC', badPixels],
    ['trailing garbage', Buffer.concat([png, Buffer.from([0])])],
  ];
  try {
    writeFileSync(output, png);
    assert.notEqual(
      runCommands(commands, {
        log: () => {},
        save: () => {},
        spawn: () => {
          assert.equal(existsSync(output), false, 'stale PNG must be removed before the child');
          return { status: 0, stdout: 'conversion failed; PPM only' };
        },
      }),
      0,
    );
    for (const [name, invalid] of invalidPNGs) {
      const logs: string[] = [];
      assert.notEqual(
        runCommands(commands, {
          log: (message) => logs.push(message),
          save: () => {},
          spawn: () => {
            writeFileSync(output, invalid);
            return { status: 0 };
          },
        }),
        0,
        name,
      );
      assert.match(logs.join('\n'), /Missing or invalid fresh PNG/, name);
      assert.match(logs.join('\n'), /Child exit status: 0; workflow status: 1/, name);
    }
    assert.equal(
      runCommands(commands, {
        log: () => {},
        save: () => {},
        spawn: () => {
          writeFileSync(output, png);
          return { status: 0 };
        },
      }),
      0,
    );
  } finally {
    rmSync(output, { force: true });
  }
});

test('import is safe and emits nothing even with misleading process arguments', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      './node_modules/tsx/dist/loader.mjs',
      '--input-type=module',
      '-e',
      "process.argv.push('check', 'all'); await import('./tools/content-workflow.ts')",
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('snapshot catalogue validates complete schema and safe unique path identifiers', async () => {
  const { validateViews } = await import('./content-workflow');
  assert.deepEqual(validateViews([view]), [view]);
  const snap = JSON.parse(snapshot.slice(7));
  for (const stack of [0, -1, 1])
    assert.equal(
      validateViews([{ ...view, snapshot: `DDSNAP1${JSON.stringify({ ...snap, stack })}` }]).length,
      1,
    );
  for (const invalid of [
    null,
    {},
    [],
    { ...snap, seed: 1.5 },
    { ...snap, stack: 0.5 },
    { ...snap, opx: 0.5 },
    { ...snap, x: '0' },
    { ...snap, y: null },
    { ...snap, marks: [[1, 2]] },
    { ...snap, marks: [[1, 2, null]] },
    { ...snap, surprise: 1 },
  ]) {
    assert.throws(
      () => validateViews([{ ...view, snapshot: `DDSNAP1${JSON.stringify(invalid)}` }]),
      /snapshot/i,
    );
  }
  for (const invalid of [
    null,
    {},
    [],
    [view, view],
    [{ ...view, feature: '' }],
    [{ ...view, extra: true }],
  ])
    assert.throws(() => validateViews(invalid));
  for (const id of ['all', '../bad', 'a/b', 'a\\b', 'a b', 'a;touch', '-bad', 'UPPER', '.'])
    assert.throws(() => validateViews([{ ...view, id }]));
  for (const bad of ['DDSNAP2{}', 'DDSNAP1{', ' DDSNAP1{}', 'DDSNAP1{"x":1e999}'])
    assert.throws(() => validateViews([{ ...view, snapshot: bad }]));
  const saved = validateViews(
    JSON.parse(readFileSync(new URL('./content-views.json', import.meta.url), 'utf8')),
  );
  for (const v of saved)
    assert.ok(
      readFileSync(new URL(`../${v.source}`, import.meta.url), 'utf8').includes(v.snapshot),
      `${v.id} must be literal documented DDSNAP`,
    );
});

test('group selection separates cheap authoring from world gates and deduplicates all', async () => {
  const { selectChecks } = await import('./content-workflow');
  assert.deepEqual(selectChecks('authoring'), [
    'content-workflow.test',
    'structure-kit.test',
    'frame-core-plan.test',
  ]);
  const all = selectChecks('all');
  assert.equal(new Set(all).size, all.length);
  assert.ok(all.includes('verify-world'));
  assert.ok(all.includes('verify-migration'));
  assert.ok(all.includes('build'));
  assert.ok(!all.includes('verify-source-shaders'));
  assert.ok(!selectChecks('structures').includes('verify-world'));
  assert.deepEqual(selectChecks('shaders'), ['verify-source-shaders']);
  assert.deepEqual(selectChecks('roads'), [
    'verify-road-buildings',
    'verify-road-reservations',
    'verify-road-seams',
  ]);
  assert.deepEqual(selectChecks('performance'), [
    'verify-infrastructure-performance',
    'verify-infrastructure-streaming',
  ]);
  assert.throws(() => selectChecks('../world'), /Unknown check group/);
});
