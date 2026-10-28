import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Copy real dev dependencies into the approved fixture. Symlinking host
// node_modules would correctly fail the harness's workspace confinement.
export function prepareVueFixture(destination) {
  cpSync(fileURLToPath(new URL("../test-fixtures/vue-ts/", import.meta.url)), destination, {
    recursive: true,
  });
  const installed = new Map();
  const modules = join(destination, "node_modules");
  function copy(name, sourceRequire, nestedModules) {
    let source;
    try {
      source = dirname(sourceRequire.resolve(`${name}/package.json`));
    } catch {
      source = dirname(sourceRequire.resolve(name));
      while (
        !existsSync(join(source, "package.json")) ||
        JSON.parse(readFileSync(join(source, "package.json"), "utf8")).name !== name
      ) {
        const parent = dirname(source);
        if (source === parent) throw new Error(`Cannot locate fixture dependency ${name}`);
        source = parent;
      }
    }
    const prior = installed.get(name);
    if (prior === source) return;
    const target = join(prior ? nestedModules : modules, name);
    if (existsSync(target)) return;
    if (!prior) installed.set(name, source);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, {
      recursive: true,
      filter: (path) =>
        path === source ||
        !path
          .slice(source.length + 1)
          .split(/[\\/]/)
          .includes("node_modules"),
    });
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const localRequire = createRequire(join(source, "package.json"));
    for (const dep of Object.keys(manifest.dependencies ?? {}))
      copy(dep, localRequire, join(target, "node_modules"));
  }
  for (const name of ["vue", "typescript"]) copy(name, createRequire(import.meta.url), modules);
}
