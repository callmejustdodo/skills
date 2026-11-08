// Run with: node --test repo-conventions/tests/
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-documentation.mjs', import.meta.url));
const temporary = [];
after(() => temporary.forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function repository(files, { git = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'check-docs-'));
  temporary.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  if (git) spawnSync('git', ['init', '-q'], { cwd: root });
  return root;
}

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('passes valid file, heading, Korean, duplicate and code-span anchors', () => {
  const root = repository({
    'README.md': [
      '# Project',
      '',
      'See [the guide](docs/guide.md), [setup](docs/guide.md#getting-started), [한국어](docs/guide.md#설치-방법),',
      '[second](docs/guide.md#notes-1), [variable](docs/guide.md#supabase_url-and-api_key), [emphasis](docs/guide.md#bold-and-em),',
      '[entity](docs/guide.md#q--a), [script](docs/guide.md#check-documentationmjs), [local](#project), [dir](docs),',
      '[root-relative](/docs/guide.md), [line](docs/guide.md#L3), [raw](docs/image.png?raw=true), [prefixed](#user-content-project),',
      '[spaced](<docs/guide.md>) and [titled](docs/guide.md "Guide").',
      '',
      '[ref]: docs/guide.md#getting-started',
      '<img src="docs/image.png" alt="">',
    ].join('\n'),
    'docs/guide.md': [
      '# Guide',
      '## Getting Started',
      '## 설치 방법',
      '## Notes',
      '## Notes',
      '## `SUPABASE_URL` and `API_KEY`',
      '## **Bold** and _em_',
      '## Q &amp; A',
      '## `check-documentation.mjs`',
    ].join('\n'),
    'docs/image.png': '',
  });
  const result = run(root);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Checked 18 local links in 2 Markdown files\./u);
});

// fixtures/github-anchors.json pairs each heading with the id GitHub gave it, read from
// `gh api markdown -f mode=markdown -f text='## <heading>'` on 2026-11-09.
test('computes the same heading anchors as GitHub', () => {
  const pairs = JSON.parse(readFileSync(new URL('fixtures/github-anchors.json', import.meta.url), 'utf8'));
  const files = { 'README.md': pairs.map(([, anchor], index) => `[${index}](h${index}.md#${anchor})`).join('\n') };
  pairs.forEach(([heading], index) => { files[`h${index}.md`] = `## ${heading}\n`; });
  files['logo.png'] = '';
  const result = run(repository(files));
  assert.equal(result.code, 0, result.err);
  // Two of the headings contain an image link to logo.png, which is checked too.
  assert.match(result.out, new RegExp(`Checked ${pairs.length + 2} local links`, 'u'));
});

test('finds HTML, quoted, listed and multi-line headings, #top and GitHub routes', () => {
  const root = repository({
    'README.md': [
      '# Readme',
      '[html](docs/guide.md#my-project) [html-2](docs/guide.md#install) [quoted](docs/guide.md#quoted-heading)',
      '[listed](docs/guide.md#list-heading) [numbered](docs/guide.md#numbered-heading) [setext](docs/guide.md#a-longheading)',
      '[usage](docs/guide.md#usage) [continued](#continued) [Back to top](#top) [top elsewhere](docs/guide.md#top)',
      'Report bugs in the [issue tracker](../../issues) or see [releases](../../releases/latest).',
      '',
      '- item',
      '  continued',
      '---',
      '',
      '## continued',
    ].join('\n'),
    'docs/guide.md': [
      '<h1 align="center">My Project</h1>',
      '',
      '<h2>Install</h2>',
      '',
      '> ## Quoted heading',
      '',
      '- ## List heading',
      '',
      '1. ## Numbered heading',
      '',
      'A long',
      'heading',
      '-------',
      '',
      '## Usage',
    ].join('\n'),
  });
  const result = run(root);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Checked 10 local links in 2 Markdown files\./u);
});

test('does not mistake text for links, and checks wrapped code, srcset and .MD files', () => {
  const root = repository({
    'README.md': [
      '# Readme',
      '',
      '[TODO]: remember to run setup first',
      '',
      '[Note]:',
      'See the guide.',
      '',
      '> ```md',
      '> [quoted](quoted-missing.md)',
      '> ```',
      '',
      '[paren file](docs/notes_(draft).md)',
      '',
      'Use the `--flag',
      'value` option and read [the setup guide](docs/missing-setup.md) before `run`.',
      '',
      '<picture>',
      '  <source media="(prefers-color-scheme: dark)" srcset="docs/missing-dark.png 1x, docs/logo.png 2x">',
      '  <img src="docs/logo.png" data-src="lazy-missing.png" alt="">',
      '</picture>',
      '[outside](../elsewhere.md)',
    ].join('\n'),
    'docs/notes_(draft).md': '# Notes\n',
    'docs/logo.png': '',
    'NOTES.MD': '[broken](nowhere.md)\n',
    'CHANGELOG.md': '---\n\n# Changelog\n\n[broken](gone.md)\n',
  });
  symlinkSync('gone.md', path.join(root, 'dangling.md'));
  writeFileSync(path.join(root, 'links.md'), '[d](dangling.md#intro) [e](dangling.md)\n');
  const result = run(root);
  assert.equal(result.code, 1, result.err);
  const lines = result.err.trim().split('\n').filter((line) => line.includes(': '));
  assert.deepEqual(lines, [
    'CHANGELOG.md:5: gone.md (not found)',
    'NOTES.MD:1: nowhere.md (not found)',
    'README.md:15: docs/missing-setup.md (not found)',
    'README.md:18: docs/missing-dark.png (not found)',
    'README.md:21: ../elsewhere.md (outside the repository)',
    'links.md:1: dangling.md#intro (not found)',
    'links.md:1: dangling.md (not found)',
  ]);
});

test('reports missing files, missing headings and case differences with line numbers', () => {
  const root = repository({
    'README.md': [
      '# Project',
      '[missing](docs/nope.md)',
      '[bad anchor](docs/Guide.md#nowhere)',
      '[wrong case](docs/guide.md)',
      '[bad local](#nothing)',
      '[ref]: docs/gone.md',
      '<img src="logo.png">',
    ].join('\n'),
    'docs/Guide.md': '# Guide\n',
  });
  const result = run(root);
  assert.equal(result.code, 1);
  assert.match(result.err, /README\.md:2: docs\/nope\.md \(not found\)/u);
  assert.match(result.err, /README\.md:3: docs\/Guide\.md#nowhere \(no such heading\)/u);
  assert.match(result.err, /README\.md:4: docs\/guide\.md \(case differs from "Guide\.md"\)/u);
  assert.match(result.err, /README\.md:5: #nothing \(no such heading\)/u);
  assert.match(result.err, /README\.md:6: docs\/gone\.md \(not found\)/u);
  assert.match(result.err, /README\.md:7: logo\.png \(not found\)/u);
  assert.match(result.err, /6 broken links in 1 file\./u);
});

test('ignores code, comments, front matter, footnotes and external links', () => {
  const root = repository({
    'README.md': [
      '---',
      'link: "[x](front-matter.md)"',
      '---',
      '# Project',
      '',
      '```md',
      '[fenced](missing-fenced.md)',
      '```',
      '  ~~~',
      '  [tilde](missing-tilde.md)',
      '  ~~~',
      'Inline `[code](missing-inline.md)` and ``[double](missing-double.md)``.',
      '<!-- [comment](missing-comment.md)',
      'still a comment -->',
      '[web](https://example.com/x.md), [mail](mailto:a@b.c), [proto](//cdn.example.com/a.js)',
      '[^1]: A footnote, not a link.',
    ].join('\n'),
  });
  const result = run(root);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /Checked 0 local links in 1 Markdown files\./u);
});

test('skips symlinks, dot-directories and ignored files but checks .github and untracked files', () => {
  const root = repository({
    'AGENTS.md': '# Agents\n',
    '.gitignore': 'ignored/\n',
    'ignored/notes.md': '[broken](nope.md)\n',
    '.agents/skills/x/SKILL.md': '[broken](nope.md)\n',
    'node_modules/pkg/README.md': '[broken](nope.md)\n',
    '.github/pull_request_template.md': '[agents](../AGENTS.md#agents)\n',
    'new.md': '[broken](missing.md)\n',
  });
  symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
  const result = run(root);
  assert.equal(result.code, 1);
  assert.match(result.err, /^new\.md:1: missing\.md \(not found\)$/mu);
  assert.doesNotMatch(result.err, /ignored|\.agents|node_modules|CLAUDE/u);
  assert.match(result.err, /1 broken link in 1 file\./u);
});

test('leaves out excluded directories but still checks links into them', () => {
  const root = repository({
    'README.md': '[mirror](ko/README.md) and [gone](ko/gone.md)\n',
    'ko/README.md': '[translated anchor](../docs/a.md#번역된-제목)\n',
    'docs/a.md': '# Original heading\n',
  });
  const result = run(root, '--exclude', 'ko');
  assert.equal(result.code, 1);
  assert.match(result.err, /^README\.md:1: ko\/gone\.md \(not found\)$/mu);
  assert.doesNotMatch(result.err, /번역된/u);
  const equals = run(root, '--exclude=ko', 'README.md');
  assert.match(equals.err, /1 broken link in 1 file\./u);
  assert.equal(run(root, '--exclude').code, 2);
});

test('checks only the given paths, and works outside a Git repository', () => {
  const root = repository({
    'README.md': '[broken](nope.md)\n',
    'docs/a.md': '[b](b.md)\n',
    'docs/b.md': '# B\n',
  }, { git: false });
  const scoped = run(root, 'docs');
  assert.equal(scoped.code, 0, scoped.err);
  assert.match(scoped.out, /Checked 1 local links in 2 Markdown files\./u);
  const whole = run(root);
  assert.equal(whole.code, 1);
  assert.match(whole.err, /README\.md:1: nope\.md \(not found\)/u);
  const missing = run(root, 'nowhere');
  assert.equal(missing.code, 2);
  assert.match(missing.err, /No such file or directory: nowhere/u);
});
