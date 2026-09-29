import { WorkforceRegistry, verifyRegistry } from "./registry";

export function formatRegistry(reg: WorkforceRegistry): string {
  const lines = [`catalogStatus=${reg.catalogStatus} catalogModels=${reg.catalogSize}`, ""];
  for (const e of reg.list()) {
    lines.push(
      `${e.employee.padEnd(24)} ${e.source.padEnd(16)} ${e.providerId.padEnd(10)} ${String(e.model)}`,
      `${"".padEnd(24)} fallback=${e.fallback} modalities=${e.capabilities.inputModalities.join("+")} ctx=${e.capabilities.contextLength ?? "n/a"}${e.note ? `  (${e.note})` : ""}`,
    );
  }
  return lines.join("\n");
}

/** Live run:  npx tsx server/workforce/print-registry.ts   (needs outbound network; prints no secrets) */
async function main() {
  const reg = await WorkforceRegistry.create();
  console.log(formatRegistry(reg));
  console.log("");
  let failed = 0;
  for (const c of verifyRegistry(reg)) {
    if (!c.pass) failed++;
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  -> ${c.detail}` : ""}`);
  }
  if (reg.catalogStatus !== "ok") console.log("\nNOTE: catalog unreachable; static registry shown (fixed NVIDIA + openrouter/free).");
  process.exit(failed ? 1 : 0);
}

if (process.argv[1]?.endsWith("print-registry.ts")) void main();
