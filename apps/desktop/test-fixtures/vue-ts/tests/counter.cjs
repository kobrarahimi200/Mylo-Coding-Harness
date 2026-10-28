const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { parse, compileScript, compileTemplate } = require("@vue/compiler-sfc");
const root = path.join(__dirname, "..");
const compiled = path.join(root, ".mylo-test");
fs.mkdirSync(compiled, { recursive: true });
fs.writeFileSync(
  path.join(compiled, "counter.cjs"),
  ts.transpileModule(fs.readFileSync(path.join(root, "src/counter.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
const { useCounter } = require(path.join(compiled, "counter.cjs"));

test("Vue counter increments its reactive value", () => {
  const { count, increment } = useCounter();
  increment();
  assert.equal(count.value, 1);
  increment();
  assert.equal(count.value, 2);
  console.log("MYLO_VUE_TEST_PASSED");
});

test("Vue TypeScript component compiles", () => {
  const filename = path.join(root, "src/App.vue");
  const parsed = parse(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(parsed.errors, []);
  compileScript(parsed.descriptor, { id: "mylo-fixture" });
  assert.deepEqual(
    compileTemplate({ source: parsed.descriptor.template.content, filename, id: "mylo-fixture" })
      .errors,
    [],
  );
});
