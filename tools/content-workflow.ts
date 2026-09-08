/** Local content checks; no renderer imports or execution on import. */
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSX = 'node_modules/tsx/dist/cli.mjs';

export interface ContentView {
  id: string;
  feature: string;
  purpose: string;
  source: string;
  snapshot: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateViews(value: unknown): ContentView[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error('View catalogue must be a nonempty array');
  const ids = new Set<string>();
  for (const view of value) {
    if (
      !record(view) ||
      Object.keys(view).some((k) => !['id', 'feature', 'purpose', 'source', 'snapshot'].includes(k))
    )
      throw new Error('Invalid view schema');
    for (const key of ['id', 'feature', 'purpose', 'source', 'snapshot']) {
      if (typeof view[key] !== 'string' || !(view[key] as string).trim())
        throw new Error(`View requires ${key}`);
    }
    const { id, snapshot, source } = view as unknown as ContentView;
    if (
      !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id) ||
      id.length > 64 ||
      id === 'all' ||
      ids.has(id)
    )
      throw new Error(`Invalid or duplicate view id: ${id}`);
    ids.add(id);
    if (!/^docs\/[a-zA-Z0-9_-]+\.md$/.test(source))
      throw new Error(`Invalid view source: ${source}`);
    let snap: unknown;
    try {
      if (!snapshot.startsWith('DDSNAP1{')) throw new Error();
      snap = JSON.parse(snapshot.slice(7));
    } catch {
      throw new Error(`Invalid snapshot JSON for ${id}`);
    }
    const fields = ['seed', 'stack', 'x', 'y', 'z', 'yaw', 'pitch'];
    if (
      !record(snap) ||
      Object.keys(snap).some((k) => ![...fields, 'opx', 'opz', 'marks'].includes(k))
    )
      throw new Error(`Invalid snapshot schema for ${id}`);
    for (const key of fields)
      if (typeof snap[key] !== 'number' || !Number.isFinite(snap[key]))
        throw new Error(`Invalid snapshot ${key} for ${id}`);
    for (const key of ['seed', 'stack', 'opx', 'opz']) {
      if (key in snap && !Number.isSafeInteger(snap[key]))
        throw new Error(`Invalid snapshot integer ${key} for ${id}`);
    }

    if (
      'marks' in snap &&
      (!Array.isArray(snap.marks) ||
        !snap.marks.every(
          (mark: unknown) =>
            Array.isArray(mark) &&
            mark.length === 3 &&
            mark.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)),
        ))
    )
      throw new Error(`Invalid snapshot marks for ${id}`);
  }
  return value as ContentView[];
}

export const CHECK_GROUPS: Record<string, { purpose: string; checks: string[] }> = {
  roads: {
    purpose: 'Road facilities, reserved crossings and recenter seams',
    checks: ['verify-road-buildings', 'verify-road-reservations', 'verify-road-seams'],
  },
  performance: {
    purpose: 'Headless infrastructure geometry/streaming budgets (not measured gameplay FPS)',
    checks: ['verify-infrastructure-performance', 'verify-infrastructure-streaming'],
  },
  authoring: {
    purpose: 'Cheap workflow and structural-kit unit tests (no full world/migration)',
    checks: ['content-workflow.test', 'structure-kit.test', 'frame-core-plan.test'],
  },
  structures: {
    purpose: 'Framed building, doorway, fixture and service contracts',
    checks: [
      'structure-kit.test',
      'frame-core-plan.test',
      'verify-frame-buildings',
      'verify-frame-doorways',
      'verify-frame-fixtures',
      'verify-frame-services',
    ],
  },
  infrastructure: {
    purpose: 'Network, physical solids, seams, circulation and input contracts',
    checks: [
      'verify-frame-services',
      'verify-infrastructure-network',
      'verify-infrastructure-solids',
      'verify-infrastructure-seams',
      'verify-infrastructure-physics',
      'verify-infrastructure-access',
      'verify-infrastructure-circulation',
      'verify-service-ladders',
      'verify-ladder-input',
      'verify-infrastructure-input',
    ],
  },
  materials: {
    purpose: 'Quick material roles, shader-hook/UV contracts (not GPU compilation)',
    checks: [
      'texture-repetition.test',
      'verify-quiet-materials',
      'verify-source-materials',
      'verify-world-finishes',
      'verify-pipe-uvs',
    ],
  },
  world: {
    purpose: 'Full safety gates: default 16 seeds, migration parity, production build',
    checks: ['verify-world', 'verify-migration', 'build'],
  },
  shaders: {
    purpose: 'OPTIONAL expensive/environment-dependent: python + Mesa EGL/GLES3; excluded from all',
    checks: ['verify-source-shaders'],
  },
};

export function selectChecks(group: string): string[] {
  if (group === 'all')
    return [
      ...new Set(
        Object.entries(CHECK_GROUPS)
          .filter(([name]) => name !== 'shaders')
          .flatMap(([, value]) => value.checks),
      ),
    ];
  if (!Object.hasOwn(CHECK_GROUPS, group)) throw new Error(`Unknown check group: ${group}`);
  return [...CHECK_GROUPS[group]!.checks];
}

export interface Command {
  id: string;
  argv: string[];
  output?: string;
}

export function planCommands(args: string[], catalogue: unknown): Command[] {
  const views = validateViews(catalogue);
  if (!args.length || (args.length === 1 && ['list', 'help', '--help', '-h'].includes(args[0]!)))
    return [];
  if (args.length !== 2 || !['check', 'preview'].includes(args[0]!))
    throw new Error('Expected list, check GROUP|all, or preview VIEW|all (see --help)');
  const [action, name] = args;
  if (action === 'check')
    return selectChecks(name!).flatMap((id): Command[] =>
      id === 'build'
        ? [
            { id: 'build-types', argv: ['node_modules/typescript/bin/tsc'] },
            {
              id: 'build-vite',
              argv: [
                'node_modules/vite/bin/vite.js',
                'build',
                '--outDir',
                'artifacts/content/build',
              ],
            },
          ]
        : [{ id, argv: [TSX, ...(id.endsWith('.test') ? ['--test'] : []), `tools/${id}.ts`] }],
    );
  const selected = name === 'all' ? views : views.filter((v) => v.id === name);
  if (!selected.length) throw new Error(`Unknown preview view: ${name}`);
  return selected.map((v) => {
    // Relative safe paths also protect older debug-view image-converter invocations.
    const output = `artifacts/content/${v.id}.png`;
    return {
      id: `preview-${v.id}`,
      argv: [TSX, 'tools/debug-view.ts', v.snapshot, output],
      output,
    };
  });
}

interface ChildResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  signal?: string | null;
  error?: Error;
}
interface RunnerDependencies {
  prepareOutput?: (path: string) => void;
  validOutput?: (path: string) => boolean;
  spawn?: (exe: string, argv: string[], options: SpawnSyncOptionsWithStringEncoding) => ChildResult;
  log?: (message: string) => void;
  save?: (path: string, text: string) => void;
}

export function runCommands(commands: Command[], dependencies: RunnerDependencies = {}): number {
  const prepareOutput =
    dependencies.prepareOutput ?? ((path: string) => rmSync(resolve(ROOT, path), { force: true }));
  const validOutput =
    dependencies.validOutput ??
    ((path: string) => {
      try {
        const png = readFileSync(resolve(ROOT, path));
        if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
          return false;
        let hasPixels = false;
        let ended = false;
        for (let offset = 8; offset < png.length; ) {
          if (png.length - offset < 12) return false;
          const length = png.readUInt32BE(offset);
          const type = png.toString('ascii', offset + 4, offset + 8);
          if (length > png.length - offset - 12) return false;
          if (offset === 8) {
            if (
              type !== 'IHDR' ||
              length !== 13 ||
              png.readUInt32BE(offset + 8) === 0 ||
              png.readUInt32BE(offset + 12) === 0
            )
              return false;
          } else if (type === 'IHDR') return false;
          if (type === 'IDAT' && length > 0) hasPixels = true;
          offset += length + 12;
          if (type === 'IEND') {
            if (length !== 0 || offset !== png.length) return false;
            ended = true;
          }
        }
        if (!hasPixels || !ended) return false;
        // Decode, rather than ping metadata: complete chunks can still contain bad pixels.
        // Reuse the converter already required by debug-view, without a shell or new dependency.
        for (const exe of ['magick', 'convert']) {
          const decoded = spawnSync(exe, ['-regard-warnings', 'png:-', 'null:'], {
            shell: false,
            input: png,
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          });
          if ((decoded.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') continue;
          return !decoded.error && decoded.status === 0;
        }
        return false;
      } catch {
        return false;
      }
    });
  const spawn = dependencies.spawn ?? spawnSync;
  const log = dependencies.log ?? console.log;
  const save =
    dependencies.save ??
    ((path: string, text: string) => {
      mkdirSync(resolve(ROOT, 'artifacts/content'), { recursive: true });
      writeFileSync(resolve(ROOT, path), text);
    });
  for (const command of commands) {
    if (
      !/^[a-z][a-z0-9.-]*$/.test(command.id) ||
      (command.output && !/^artifacts\/content\/[a-z][a-z0-9-]*\.png$/.test(command.output))
    )
      throw new Error('Unsafe command output identifier');
    if (command.output) prepareOutput(command.output);
    const display = [process.execPath, ...command.argv].map((arg) => JSON.stringify(arg)).join(' ');
    log(`> ${display}`);
    const result = spawn(process.execPath, command.argv, {
      cwd: ROOT,
      shell: false,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const childStatus = result.error ? result.status || 1 : (result.status ?? 1);
    const missingOutput = command.output && childStatus === 0 && !validOutput(command.output);
    const status = childStatus || (missingOutput ? 1 : 0);
    const diagnostic = `${result.stdout ?? ''}${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}${result.signal ? `\nSignal: ${result.signal}` : ''}${missingOutput ? `\nMissing or invalid fresh PNG: ${command.output}; inspect converter diagnostics (PPM fallback is not PNG success).` : ''}`;
    const path = `artifacts/content/${command.id}.log`;
    save(
      path,
      `> ${display}\n${diagnostic}\nChild exit status: ${childStatus}; workflow status: ${status}\n`,
    );
    if (diagnostic) log(diagnostic);
    log(`Child exit status: ${childStatus}; workflow status: ${status}; diagnostics: ${path}`);
    if (command.output)
      log(
        `Preview target: ${command.output}. Exit zero is not a clean audit: inspect missing-ray/wrong-side counts in the log and the image. Normal shading does not verify textures or FPS.`,
      );
    if (status !== 0) return status;
  }
  return 0;
}

export const HELP = `Local content workflow (uses installed dependencies only)
  npm run content -- list
  npm run content -- check GROUP
  npm run content -- check all
  npm run content -- preview VIEW
  npm run content -- preview all
  npm run content -- --help

authoring is the cheap kit/workflow loop. world runs full 16-seed + migration + build gates.
all deduplicates the listed non-shader groups; it is not every historical tools/ script.
shaders is explicit opt-in (python + Mesa EGL/GLES3); never part of all.
Previews are expensive software raycasts; PNG conversion requires local magick/convert.
Logs/images/build output: artifacts/content/ (same named outputs are overwritten).
Preview exit zero is not a clean geometry audit; inspect diagnostics and images.
Normal-shaded previews cannot validate material appearance, textures, lighting quality or FPS.`;

export function main(args = process.argv.slice(2)): number {
  try {
    const views = validateViews(
      JSON.parse(readFileSync(resolve(ROOT, 'tools/content-views.json'), 'utf8')),
    );
    const commands = planCommands(args, views);
    if (!commands.length) {
      console.log(HELP);
      if (args[0] === 'list') {
        console.log('\nCheck groups:');
        for (const [name, group] of Object.entries(CHECK_GROUPS))
          console.log(`  ${name}: ${group.purpose}\n    ${group.checks.join(', ')}`);
        console.log('\nSaved DDSNAP views:');
        for (const v of views)
          console.log(
            `  ${v.id}: ${v.feature}\n    ${v.purpose}\n    Source: ${v.source}\n    ${v.snapshot}`,
          );
      }
      return 0;
    }
    // Resolve all prerequisites before running the first child (never install).
    for (const command of commands)
      for (const arg of command.argv) {
        if (
          (arg.startsWith('tools/') || arg.startsWith('node_modules/')) &&
          !existsSync(resolve(ROOT, arg))
        )
          throw new Error(
            `Missing local prerequisite: ${arg}; use the existing dependency setup, no automatic downloads`,
          );
      }
    mkdirSync(resolve(ROOT, 'artifacts/content'), { recursive: true });
    return runCommands(commands);
  } catch (error) {
    console.error(`content: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = main();
