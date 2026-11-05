// node --test: scripts/sync-skills.mjs against a fake KissMySkills server, in a temp skills folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkLink, safeSegments, sync, withFrontMatter, MARKER } from "../scripts/sync-skills.mjs";

const TOKEN = "a".repeat(64);
const LINK = `https://mcp.kissmyskills.com/skills-sync/v1/${TOKEN}`;
const A = "my-release-checklist-012345";
const B = "my-team-notes-abcdef";

function server(skills) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const u = new URL(url);
    const rest = u.pathname.slice(`/skills-sync/v1/${TOKEN}`.length);
    const res = (status, body) => ({ status, ok: status < 300, json: async () => body });
    if (!rest) return res(200, { skills: skills.map(({ files, ...s }) => ({ ...s, files: files.map((f) => ({ path: f.path, size: f.text.length })) })) });
    const s = skills.find((x) => `/${x.handle}` === rest);
    if (!s) return res(404, { error: "not_found" });
    const from = Number(u.searchParams.get("from"));
    // one file per page, to exercise paging
    return res(200, { handle: s.handle, updatedAt: s.updatedAt, files: s.files.slice(from, from + 1), next: from + 1 < s.files.length ? from + 1 : null });
  };
  return { fetchImpl, calls };
}

const skillA = (updatedAt = 1) => ({
  handle: A,
  title: "Release checklist",
  description: "Our release steps",
  updatedAt,
  files: [
    { path: "SKILL.md", text: "# Release\n" },
    { path: "scripts/run.py", text: "print(1)\n" },
  ],
});

test("link and path checks", () => {
  assert.equal(checkLink(LINK), LINK);
  for (const bad of [
    `http://mcp.kissmyskills.com/skills-sync/v1/${TOKEN}`,
    `https://evil.example/skills-sync/v1/${TOKEN}`,
    `https://mcp.kissmyskills.com.evil.example/skills-sync/v1/${TOKEN}`,
    `https://mcp.kissmyskills.com/skills-sync/v1/${TOKEN}/x`,
    "nonsense",
  ])
    assert.throws(() => checkLink(bad), bad);
  assert.deepEqual(safeSegments("ref/a.md"), ["ref", "a.md"]);
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "C:/x", "a\\b", "a//b", "./a", MARKER, ""]) assert.throws(() => safeSegments(bad), bad);
});

test("front matter: added when missing, description filled in, kept when present", () => {
  const s = { handle: A, title: "Release", description: 'Steps "quoted"\nline' };
  assert.equal(withFrontMatter("# R", s), `---\nname: ${A}\ndescription: "Steps \\"quoted\\" line"\n---\n\n# R`);
  assert.equal(withFrontMatter("---\nname: Release\n---\n# R", s), `---\nname: Release\ndescription: "Steps \\"quoted\\" line"\n---\n# R`);
  const full = "---\nname: x\ndescription: mine\n---\n# R";
  assert.equal(withFrontMatter(full, s), full);
});

test("install, unchanged, update, remove stale; foreign folders never touched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kms-sync-"));
  // the user's own skills: a normal one, a same-named "my-" folder without the marker, and a symlink
  await mkdir(join(dir, "my-own-skill-aaaaaa"));
  await writeFile(join(dir, "my-own-skill-aaaaaa", "SKILL.md"), "mine");
  await mkdir(join(dir, B));
  await writeFile(join(dir, B, "SKILL.md"), "user made this");
  await mkdir(join(dir, "pdf"));
  await symlink(join(dir, "pdf"), join(dir, "my-linked-skill-bbbbbb"));

  const s1 = server([skillA(1), { handle: B, title: "Team", description: "", updatedAt: 1, files: [{ path: "SKILL.md", text: "x" }] }]);
  const r1 = await sync({ link: LINK, dir, fetchImpl: s1.fetchImpl });
  assert.deepEqual(r1.installed, [A]);
  assert.deepEqual(r1.skipped, [B]);
  assert.equal(await readFile(join(dir, B, "SKILL.md"), "utf8"), "user made this");
  assert.match(await readFile(join(dir, A, "SKILL.md"), "utf8"), /^---\nname: my-release-checklist-012345\ndescription: "Our release steps"\n---\n\n# Release/);
  assert.equal(await readFile(join(dir, A, "scripts", "run.py"), "utf8"), "print(1)\n");
  assert.equal((await stat(join(dir, A, "scripts", "run.py"))).mode & 0o111, 0, "never executable");
  assert.equal(JSON.parse(await readFile(join(dir, A, MARKER), "utf8")).updatedAt, 1);

  const r2 = await sync({ link: LINK, dir, fetchImpl: server([skillA(1)]).fetchImpl });
  assert.deepEqual(r2.unchanged, [A]);

  const changed = skillA(2);
  changed.files = [{ path: "SKILL.md", text: "---\nname: rel\ndescription: v2\n---\nv2" }];
  const r3 = await sync({ link: LINK, dir, fetchImpl: server([changed]).fetchImpl });
  assert.deepEqual(r3.updated, [A]);
  assert.deepEqual(await readdir(join(dir, A)), [MARKER, "SKILL.md"].sort(), "old files gone");

  const r4 = await sync({ link: LINK, dir, fetchImpl: server([]).fetchImpl, dryRun: true });
  assert.deepEqual(r4.removed, [A]);
  assert.ok((await readdir(dir)).includes(A), "dry run removes nothing");
  const r5 = await sync({ link: LINK, dir, fetchImpl: server([]).fetchImpl });
  assert.deepEqual(r5.removed, [A]);
  assert.deepEqual((await readdir(dir)).sort(), [B, "my-linked-skill-bbbbbb", "my-own-skill-aaaaaa", "pdf"].sort());
});

test("a bad path from the server aborts that skill before anything is written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kms-sync-"));
  const evil = skillA(1);
  evil.files.push({ path: "../../escape.md", text: "x" });
  await assert.rejects(sync({ link: LINK, dir, fetchImpl: server([evil]).fetchImpl }), /bad file path/);
  assert.deepEqual(await readdir(dir), []);
});

test("expired link: clear message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kms-sync-"));
  const fetchImpl = async () => ({ status: 401, ok: false, json: async () => ({}) });
  await assert.rejects(sync({ link: LINK, dir, fetchImpl }), /expired/);
});
