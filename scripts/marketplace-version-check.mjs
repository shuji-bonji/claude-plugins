#!/usr/bin/env node
/**
 * marketplace.json に書いた版が、各 plugin repo の `.claude-plugin/plugin.json` と
 * 一致しているかを照合する。
 *
 * ## なぜ要るか
 *
 * `/plugin install` が実際に持ってくるのは **GitHub 側の plugin.json** である。
 * marketplace.json の `version` は一覧に出る表示で、install の中身を決めていない。
 * だから両者がずれても、install は成功し、誰も落ちない。一覧には 0.2.0 と出て、
 * 入るのは 0.1.0 という状態が、そのまま残る。
 *
 * 実際に起きたこと（2026-08-27〜31）: pdf family の 4 MCP と Skill 3 本が
 * 数日で 8 回版を上げた。marketplace.json は毎回手で直しており、直し忘れても
 * 気づく所が無かった（このリポジトリには CI が無い）。
 *
 * ## 何を測るか
 *
 *   台帳  = .claude-plugin/marketplace.json の plugins[].version
 *   GitHub = その repo の .claude-plugin/plugin.json の version（install で入る版）
 *   手元   = --local を渡したとき、手元の checkout の同ファイル（push 前を見るため）
 *
 * 台帳 ≠ GitHub は誤り（一覧の版が嘘になる）。手元 ≠ GitHub は push 待ちで、
 * 誤りではないが、そのまま台帳を上げると上の誤りになるので黄で出す。
 * plugin.json の `name` も照合する（repo 側で改名すると install 名が変わる）。
 *
 * ## この検査自体を壊して確かめた（T-3）
 *
 * 壊す先が無い検査は何も測っていない。台帳を 3 通りに壊して、3 件とも名指しされた:
 *
 *   pdf-reader-mcp の version を 0.13.0 に落とす
 *     → 🔴 一覧には 0.13.0 と出るが、install で入るのは 0.14.0
 *   pdf-trust の source.repo を実在しない名前にする
 *     → 🔴 main / master のどちらにも .claude-plugin/plugin.json が無い
 *   台帳側の name を w3c-mcp-renamed に変える
 *     → 🔴 repo 側の plugin.json は name が "w3c-mcp"
 *
 * `--write` はこのうち版のずれ 1 件だけを直し、残り 2 件を残したまま 1 で終わった。
 * 直っていないものが残っているのに 0 で終わると、通ったと読めてしまう。
 *
 * ## 使い方
 *
 *   node scripts/marketplace-version-check.mjs                     # 台帳 vs GitHub
 *   node scripts/marketplace-version-check.mjs --local ~/workspace # 手元の checkout も 3 列で出す
 *   node scripts/marketplace-version-check.mjs --write             # 台帳を GitHub 側の版に揃える
 *
 * 終了コード: 0 = 一致 / 1 = ずれがある / 2 = 照合を回せなかった
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, '.claude-plugin/marketplace.json');

const args = process.argv.slice(2);
let write = false;
const localRoots = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--write') write = true;
  else if (args[i] === '--local') {
    const d = args[++i];
    if (!d) die(2, '--local には探す先のディレクトリが要る');
    localRoots.push(resolve(d.replace(/^~/, process.env.HOME ?? '~')));
  } else die(2, `知らない引数: ${args[i]}\n使い方: node scripts/marketplace-version-check.mjs [--local <dir>]... [--write]`);
}

function die(code, msg) {
  console.error(msg);
  process.exit(code);
}

const raw = readFileSync(FILE, 'utf8');
const market = JSON.parse(raw);

/** 手元の checkout を探す。repo 名と同じディレクトリで、plugin.json を持つもの。 */
function findLocal(repoName) {
  for (const root of localRoots) {
    const hit = walk(root, repoName, 0);
    if (hit) return hit;
  }
  return null;
}
function walk(dir, name, depth) {
  if (depth > 4) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.name === name && existsSync(join(p, '.claude-plugin/plugin.json'))) return p;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const hit = walk(join(dir, e.name), name, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** GitHub の raw から plugin.json を取る。既定枝が main か master かは repo による。 */
async function fromGitHub(repo) {
  for (const branch of ['main', 'master']) {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/.claude-plugin/plugin.json`;
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      return { error: `取得できなかった（${String(error).slice(0, 60)}）` };
    }
    if (res.status === 404) continue;
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { json: JSON.parse(text), branch };
    } catch {
      return { error: `${branch} の plugin.json が JSON として読めない` };
    }
  }
  return { error: 'main / master のどちらにも .claude-plugin/plugin.json が無い' };
}

/** 同時に取りに行く数。多くしても速くならず、429 を踏むだけ。 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

const plugins = market.plugins ?? [];
if (!plugins.length) die(2, 'marketplace.json に plugins が無い');

const rows = await mapLimit(plugins, 4, async (p) => {
  const repo = p.source?.repo;
  const row = { name: p.name, repo, market: p.version };
  if (p.source?.source !== 'github' || !repo) {
    row.error = `source が github ではない（${JSON.stringify(p.source)}）`;
    return row;
  }
  const gh = await fromGitHub(repo);
  if (gh.error) row.error = gh.error;
  else {
    row.github = gh.json.version;
    row.githubName = gh.json.name;
    row.branch = gh.branch;
  }
  if (localRoots.length) {
    const dir = findLocal(repo.split('/').pop());
    if (dir) {
      try {
        row.local = JSON.parse(readFileSync(join(dir, '.claude-plugin/plugin.json'), 'utf8')).version;
        row.localDir = dir;
      } catch {
        row.local = '(読めない)';
      }
    }
  }
  return row;
});

const pad = (s, n) => String(s ?? '—').padEnd(n);
const nameW = Math.max(...rows.map((r) => r.name.length), 4);
const showLocal = localRoots.length > 0;

console.log(`${pad('plugin', nameW)}  ${pad('台帳', 8)}  ${pad('GitHub', 8)}${showLocal ? `  ${pad('手元', 8)}` : ''}`);

let bad = 0;
let pending = 0;
const notes = [];
for (const r of rows) {
  const line = `${pad(r.name, nameW)}  ${pad(r.market, 8)}  ${pad(r.github, 8)}${showLocal ? `  ${pad(r.local, 8)}` : ''}`;
  if (r.error) {
    bad++;
    console.log(`🔴 ${line}`);
    notes.push(`🔴 ${r.name}: ${r.error}（${r.repo}）`);
    continue;
  }
  const mark = [];
  if (r.market !== r.github) {
    bad++;
    mark.push('台帳 ≠ GitHub');
    notes.push(
      `🔴 ${r.name}: 一覧には ${r.market} と出るが、install で入るのは ${r.github}\n` +
        `   直す: marketplace.json の "${r.name}" の version を ${r.github} にする（--write で揃う）`,
    );
  }
  if (r.githubName && r.githubName !== r.name) {
    bad++;
    mark.push('名前が違う');
    notes.push(`🔴 ${r.name}: repo 側の plugin.json は name が "${r.githubName}"（${r.repo}）`);
  }
  if (showLocal && r.local && r.local !== r.github) {
    pending++;
    mark.push('手元 ≠ GitHub');
    notes.push(`🟡 ${r.name}: 手元は ${r.local}、GitHub は ${r.github}。push すればこの差は消える\n   ${r.localDir}`);
  }
  console.log(`${mark.length ? (mark.includes('台帳 ≠ GitHub') || mark.includes('名前が違う') ? '🔴' : '🟡') : 'OK'} ${line}${mark.length ? `  ${mark.join(' / ')}` : ''}`);
}

if (notes.length) {
  console.log('');
  for (const n of notes) console.log(n);
}

if (write) {
  let changed = 0;
  for (const r of rows) {
    if (r.error || r.market === r.github) continue;
    const entry = plugins.find((p) => p.name === r.name);
    entry.version = r.github;
    changed++;
  }
  if (changed) {
    writeFileSync(FILE, `${JSON.stringify(market, null, 2)}\n`);
    console.log(`\n${changed} 件を GitHub 側の版に書き換えた。差分を見てから commit すること`);
  } else {
    console.log('\n書き換えるものは無かった');
  }
  // 版のずれ以外（repo が取れない・名前が違う）は自動では直さない。
  // 直っていないものが残っているのに 0 で終わると、通ったと読めてしまう。
  const left = bad - changed;
  if (left > 0) {
    console.log(`🔴 版のずれ以外が ${left} 件残っている。上を読んで手で直すこと`);
    process.exit(1);
  }
  process.exit(0);
}

console.log('');
if (bad) {
  console.log(`🔴 ${bad} 件ずれている（${rows.length} 件中）。--write で台帳を GitHub 側に揃えられる`);
  process.exit(1);
}
console.log(pending ? `${rows.length} 件とも台帳と GitHub は一致（うち ${pending} 件は手元が先行）` : `${rows.length} 件とも一致`);
process.exit(0);
