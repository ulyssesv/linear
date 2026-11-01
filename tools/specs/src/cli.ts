// Usage: node src/cli.ts [repository root]
// Checks specs, records and test citations (SEED-R8, SEED-R9). Exits 1 on any error.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { check } from "./check.ts";
import { collect } from "./scan.ts";

const { positionals } = parseArgs({ allowPositionals: true });
const root = resolve(positionals[0] ?? ".");

const input = await collect(root);
const { errors, pending } = check(input);

for (const error of errors) {
  console.error(
    `${error.path}${error.line === undefined ? "" : `:${error.line}`}: ${error.message}`,
  );
}

if (pending.length > 0) {
  console.log(
    "Pending: unit and e2e requirements no test cites yet (enforced once the spec is done)",
  );
  for (const p of pending) console.log(`  ${p.id} (${p.tag}) ${p.path}:${p.line} [${p.status}]`);
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
console.log(
  `check:specs: ${count(input.specs.length, "spec")}, ${count(input.records.length, "record")}, ` +
    `${count(input.tests.length, "test file")}; ${count(errors.length, "error")}, ${pending.length} pending`,
);

process.exitCode = errors.length > 0 ? 1 : 0;
