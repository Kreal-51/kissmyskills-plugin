#!/usr/bin/env node
// KissMySkills: sync my skills (KAN-1408). Installs the user's own and team skills from KissMySkills (handles
// "my-<slug>-<6 hex>") into Claude Code's skills folder as real skills: <dir>/<handle>/SKILL.md + every file.
//
//   node sync-skills.mjs <link> [--dir <skills folder>] [--dry-run]
//
// <link> comes from the connector tool my_skills_sync (valid 10 minutes). Default folder: ~/.claude/skills
// (or $CLAUDE_CONFIG_DIR/skills). No dependencies, Node 18+.
//
// Safety rules:
//  - only https links on mcp.kissmyskills.com / mcp-staging.kissmyskills.com are fetched;
//  - every file path is checked: relative, no "..", no backslashes, no absolute or drive paths;
//  - files are written as plain text (mode 0644) and never executed or opened;
//  - a folder is replaced or removed only when sync made it (its .kms-sync.json marker) and its name is a "my-" handle;
//    any other folder in the skills dir, including a same-named one the user made, is never touched.

import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const HANDLE_RE = /^my-[a-z0-9-]{1,60}-[0-9a-f]{6}$/;
export const MARKER = ".kms-sync.json";
const HOSTS = new Set(["mcp.kissmyskills.com", "mcp-staging.kissmyskills.com"]);
const LINK_PATH_RE = /^\/skills-sync\/v1\/[0-9a-f]{64}$/;

export function checkLink(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    throw new Error("not a link");
  }
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname) || u.port || !LINK_PATH_RE.test(u.pathname) || u.search || u.username) {
    throw new Error("not a KissMySkills sync link (get one with the my_skills_sync tool)");
  }
  return `${u.origin}${u.pathname}`;
}

/** A file path from the server, as path segments; throws on anything that could leave the skill folder. */
export function safeSegments(p) {
  if (typeof p !== "string" || !p || p.length > 300) throw new Error(`bad file path: ${JSON.stringify(p)}`);
  if (p.includes("\\") || p.includes("\0") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) throw new Error(`bad file path: ${p}`);
  const segs = p.split("/");
  if (segs.some((s) => !s || s === "." || s === "..")) throw new Error(`bad file path: ${p}`);
  if (p === MARKER) throw new Error(`bad file path: ${p}`);
  return segs;
}

const yamlStr = (s) => JSON.stringify(String(s).replace(/[\r\n]+/g, " ").trim());

/** Claude Code picks a skill by its front-matter description: add name / description when SKILL.md has none. */
export function withFrontMatter(text, skill) {
  const desc = skill.description || skill.title || skill.handle;
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return `---\nname: ${skill.handle}\ndescription: ${yamlStr(desc)}\n---\n\n${text}`;
  if (/^description:\s*\S/m.test(m[1])) return text;
  const head = m[1].replace(/^description:.*$/m, "").replace(/\n{2,}/g, "\n").trimEnd();
  return `---\n${head ? `${head}\n` : ""}description: ${yamlStr(desc)}\n---${text.slice(m[0].length)}`;
}

async function exists(p) {
  try {
    return await lstat(p);
  } catch {
    return null;
  }
}

async function readMarker(dir) {
  try {
    const m = JSON.parse(await readFile(join(dir, MARKER), "utf8"));
    return m && m.source === "kissmyskills" ? m : null;
  } catch {
    return null;
  }
}

async function getJson(fetchImpl, url) {
  const r = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "error" });
  if (r.status === 401) throw new Error("the sync link expired: ask for a new one (/kms-sync-skills)");
  if (!r.ok) throw new Error(`${url.replace(/[0-9a-f]{64}/, "<token>")} answered ${r.status}`);
  return r.json();
}

export function defaultSkillsDir(env = process.env) {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "skills");
}

/** The whole sync. Returns { installed, updated, unchanged, removed, skipped } (handles). */
export async function sync({ link, dir = defaultSkillsDir(), dryRun = false, fetchImpl = fetch, log = () => {} }) {
  const base = checkLink(link);
  const root = resolve(dir);
  const manifest = await getJson(fetchImpl, base);
  if (!manifest || !Array.isArray(manifest.skills)) throw new Error("unexpected answer from KissMySkills");
  const out = { installed: [], updated: [], unchanged: [], removed: [], skipped: [] };
  if (!dryRun) await mkdir(root, { recursive: true });

  const wanted = new Set();
  for (const skill of manifest.skills) {
    if (!HANDLE_RE.test(skill?.handle ?? "")) continue;
    wanted.add(skill.handle);
    const target = join(root, skill.handle);
    const st = await exists(target);
    const marker = st && st.isDirectory() && !st.isSymbolicLink() ? await readMarker(target) : null;
    if (st && !marker) {
      out.skipped.push(skill.handle);
      log(`skip ${skill.handle}: the folder exists and was not made by sync`);
      continue;
    }
    if (marker && marker.updatedAt === skill.updatedAt) {
      out.unchanged.push(skill.handle);
      continue;
    }
    if (dryRun) {
      (marker ? out.updated : out.installed).push(skill.handle);
      continue;
    }

    // Download every page first, check every path, then write into a temp folder and swap it in.
    const files = [];
    for (let from = 0, guard = 0; from !== null && guard < 200; guard++) {
      const page = await getJson(fetchImpl, `${base}/${skill.handle}?from=${from}`);
      for (const f of page.files ?? []) files.push({ segs: safeSegments(f.path), path: f.path, text: String(f.text ?? "") });
      from = Number.isInteger(page.next) && page.next > from ? page.next : null;
    }
    if (!files.some((f) => f.path === "SKILL.md")) {
      out.skipped.push(skill.handle);
      log(`skip ${skill.handle}: no SKILL.md`);
      continue;
    }
    const tmp = join(root, `.kms-sync-tmp-${skill.handle}-${process.pid}`);
    await rm(tmp, { recursive: true, force: true });
    await mkdir(tmp, { recursive: true });
    for (const f of files) {
      const dest = join(tmp, ...f.segs);
      if (!dest.startsWith(tmp + sep)) throw new Error(`bad file path: ${f.path}`);
      await mkdir(join(dest, ".."), { recursive: true });
      await writeFile(dest, f.path === "SKILL.md" ? withFrontMatter(f.text, skill) : f.text, { mode: 0o644 });
    }
    await writeFile(
      join(tmp, MARKER),
      JSON.stringify({ source: "kissmyskills", handle: skill.handle, updatedAt: skill.updatedAt, files: files.map((f) => f.path) }, null, 2) + "\n",
      { mode: 0o644 }
    );
    if (marker) await rm(target, { recursive: true, force: true });
    await rename(tmp, target);
    (marker ? out.updated : out.installed).push(skill.handle);
  }

  // Remove only folders sync made for skills the user can no longer see (deleted, unshared, left the workspace).
  for (const name of await readdir(root).catch(() => [])) {
    if (!HANDLE_RE.test(name) || wanted.has(name)) continue;
    const p = join(root, name);
    const st = await exists(p);
    if (!st || !st.isDirectory() || st.isSymbolicLink() || !(await readMarker(p))) continue;
    if (!dryRun) await rm(p, { recursive: true, force: true });
    out.removed.push(name);
  }
  return out;
}

function parseArgs(argv) {
  const a = { link: "", dir: undefined, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") a.dir = argv[++i];
    else if (argv[i] === "--dry-run") a.dryRun = true;
    else if (!a.link) a.link = argv[i];
  }
  return a;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.link) {
    console.error("usage: sync-skills.mjs <link from my_skills_sync> [--dir <skills folder>] [--dry-run]");
    process.exit(2);
  }
  const dir = args.dir ?? defaultSkillsDir();
  sync({ link: args.link, dir, dryRun: args.dryRun, log: (m) => console.log(m) })
    .then((r) => {
      const line = (k, v) => v.length && console.log(`${k} (${v.length}): ${v.join(", ")}`);
      console.log(`${args.dryRun ? "[dry run] " : ""}KissMySkills skills in ${resolve(dir)}`);
      line("installed", r.installed);
      line("updated", r.updated);
      line("unchanged", r.unchanged);
      line("removed", r.removed);
      line("skipped", r.skipped);
      if (!r.installed.length && !r.updated.length && !r.removed.length) console.log("nothing to change");
    })
    .catch((err) => {
      console.error(`sync failed: ${err.message}`);
      process.exit(1);
    });
}
