// TEMPORARY diagnostics (fix/firefox-webgl-flake): how often Firefox fails to
// create a WebGL2 context right after losing the previous one, per pref set.
import { firefox } from "playwright";
const [label, prefsJson, delayMs = "0", count = "200"] = process.argv.slice(2);
const prefs = { "network.proxy.failover_direct": false, ...JSON.parse(prefsJson) };
const browser = await firefox.launch({ firefoxUserPrefs: prefs });
const page = await browser.newPage();
await page.setContent("<div id=h></div>");
const started = Date.now();
const res = await page.evaluate(async ([n, delay]) => {
  const fails = {};
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const c = document.createElement("canvas");
    c.width = 1280;
    c.height = 800;
    document.getElementById("h").replaceChildren(c);
    let why = "";
    c.addEventListener("webglcontextcreationerror", (e) => { why = e.statusMessage; });
    const gl = c.getContext("webgl2");
    if (!gl) {
      const k = why.replace(/\s+/g, " ").slice(0, 120);
      fails[k] = (fails[k] ?? 0) + 1;
      continue;
    }
    ok++;
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    await new Promise((r) => requestAnimationFrame(() => r()));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return { ok, fails };
}, [Number(count), Number(delayMs)]);
console.log(`PROBE ${label} delay=${delayMs} ok=${res.ok} fails=${JSON.stringify(res.fails)} secs=${(Date.now() - started) / 1000}`);
await browser.close();
