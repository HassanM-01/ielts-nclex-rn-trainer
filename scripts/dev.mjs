// `npm run dev`: the app plus the /api functions, via `vercel dev`.
// Vercel refuses a package.json "dev" script that calls `vercel dev`
// directly (it would recurse); vercel.json's devCommand starts Vite instead.
import { spawn } from "node:child_process";

const args = process.argv.slice(2).join(" ");
const child = spawn(`npx vercel dev ${args}`.trim(), { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
