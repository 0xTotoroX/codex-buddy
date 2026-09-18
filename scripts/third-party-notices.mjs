/*
 * [INPUT]: 锁定 Cargo/npm 依赖、已安装包、本地 shadcn/ui、OpenAI 图标与上游许可原文。
 * [OUTPUT]: collectLicenseFiles 收集包内许可路径；generateNotices 生成 THIRD_PARTY_NOTICES.md 与 dependencies.json。
 * [POS]: 递归收集包内许可与署名，保留相对路径；只合并完全相同的原文，保留组件归属和来源。
 * [PROTOCOL]: 变更时更新此头部，然后检查 AGENTS.md。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const licenseName = /^(?:licen[cs]e|copying|notice)(?:$|[-_.])/i;
const attributionName = /^(?:authors|copyright)(?:$|[-_.])/i;
const licenseDirectory = /^(?:licen[cs]es?|notices)$/i;
const sourceExtension = /\.(?:[cm]?[jt]sx?|rs|py|swift|c|cc|cpp|h|hpp|json)$/i;

function isLicensePath(path) {
  return (
    licenseName.test(basename(path)) ||
    path
      .split(sep)
      .slice(0, -1)
      .some((part) => licenseDirectory.test(part))
  );
}

export function collectLicenseFiles(directory, declaredFile) {
  const files = new Set();
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.git') visit(file);
      } else if (entry.isFile() && !sourceExtension.test(entry.name)) {
        if (isLicensePath(relative(directory, file)) || attributionName.test(entry.name))
          files.add(file);
      }
    }
  }
  visit(directory);
  if (declaredFile) {
    const file = resolve(directory, declaredFile);
    if (!existsSync(file)) throw new Error(`Declared license file not found: ${declaredFile}`);
    files.add(file);
  }
  return [...files].sort();
}

export function generateNotices(directory = join(root, 'dist/licenses')) {
  const metadata = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (metadata.status !== 0) throw new Error(metadata.stderr || 'cargo metadata failed');
  const packages = JSON.parse(metadata.stdout).packages.filter(
    (item) => item.name !== 'codex-buddy',
  );
  const components = packages.map((item) => ({
    ecosystem: 'cargo',
    name: item.name,
    version: item.version,
    license: item.license,
    source: `https://crates.io/crates/${item.name}/${item.version}`,
    directory: dirname(item.manifest_path),
    licenseFile: item.license_file,
  }));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const supplements = JSON.parse(
    readFileSync(join(root, 'scripts/license-texts.json'), 'utf8'),
  ).sources;
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path || item.dev) continue;
    const installed = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));
    components.push({
      ecosystem: 'npm',
      name: installed.name,
      version: item.version,
      license: item.license,
      source: `https://www.npmjs.com/package/${installed.name}/v/${item.version}`,
      directory: join(root, path),
    });
  }
  components.push({
    ecosystem: 'source',
    name: 'openai/apps-sdk-ui icons',
    version: '0f00143c7a639906f1621fe58e1b6be7b5bea46d',
    license: 'MIT',
    source: 'https://github.com/openai/apps-sdk-ui',
    directory: join(root, 'ui/panel/icons'),
  });
  components.push({
    ecosystem: 'source',
    name: 'shadcn/ui',
    version: 'vendored',
    license: 'MIT',
    source: 'https://ui.shadcn.com/r/styles/new-york-v4',
    directory: join(root, 'ui/settings/components/ui'),
  });
  components.sort(
    (a, b) =>
      a.ecosystem.localeCompare(b.ecosystem) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version),
  );
  const text = [
    '# Third-party notices',
    '',
    'Generated from Cargo.lock, the installed production npm dependencies and vendored UI source. The Cargo inventory includes target-specific and development dependencies; this is a conservative inventory, not a claim that every package is linked into this binary.',
    '',
    'These are the original package license expressions and license/notice/attribution documents collected recursively within each package, plus pinned upstream supplements. Paths are relative to each package. Embedded source comments are not a separate scan. Copyright and license terms remain with their respective owners. Identical texts are stored once and linked from every covered package. Project-owned code has a separate MIT license.',
    '',
  ];
  const inventory = [];
  const texts = new Map();
  function licenseText(name, contents) {
    if (!contents.trim()) throw new Error(`Empty license or attribution text: ${name}`);
    const id = `license-${createHash('sha256').update(contents).digest('hex')}`;
    texts.set(id, contents);
    return `[${name}](#${id})`;
  }
  for (const item of components) {
    const files = collectLicenseFiles(item.directory, item.licenseFile);
    const extra =
      supplements.find((source) =>
        source.packages.some((p) => p.name === item.name && p.version === item.version),
      )?.files || [];
    // Some packages (for example r-efi) include their complete license in AUTHORS.
    if (!item.license || (!files.length && !extra.length))
      throw new Error(`Missing license metadata or text: ${item.name}@${item.version}`);
    const packagePath = (file) => relative(item.directory, file).split(sep).join('/');
    inventory.push({
      ecosystem: item.ecosystem,
      name: item.name,
      version: item.version,
      license: item.license,
      source: item.source,
      files: files.map(packagePath),
      upstreamFiles: extra.map((file) => file.url),
    });
    text.push(
      `## ${item.ecosystem}: ${item.name} ${item.version}`,
      '',
      `License expression: ${item.license}`,
      '',
      `Source: ${item.source}`,
      '',
    );
    for (const file of files)
      text.push(`- ${licenseText(packagePath(file), readFileSync(file, 'utf8').trimEnd())}`);
    for (const file of extra)
      text.push(`- ${licenseText(file.name, file.text.trimEnd())} — Retrieved from: ${file.url}`);
    text.push('');
  }
  text.push('## License texts', '');
  for (const [id, contents] of texts) text.push(`### ${id}`, '', '````text', contents, '````', '');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'THIRD_PARTY_NOTICES.md'), text.join('\n'));
  writeFileSync(
    join(directory, 'dependencies.json'),
    JSON.stringify(
      {
        cargoPackages: packages.length,
        npmRuntimePackages: components.filter((item) => item.ecosystem === 'npm').length,
        sourceComponents: components.filter((item) => item.ecosystem === 'source').length,
        components: inventory,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `License texts collected: ${packages.length} Cargo packages and ${components.filter((item) => item.ecosystem === 'npm').length} npm runtime packages and ${components.filter((item) => item.ecosystem === 'source').length} source components; ${texts.size} distinct texts.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  generateNotices();
