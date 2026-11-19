// WCAG 2.2 contrast computation for the Titip token pairs actually used.
// Parses the theme variables out of web/styles.css and computes ratios
// for the foreground/background pairs the components really render.
// Run: node test/contrast-check.js
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "web", "styles.css"), "utf8");

function themeVars(theme) {
  const m = css.match(new RegExp(`html\\[data-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error("theme block not found: " + theme);
  const vars = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/);
    if (mm) vars[mm[1]] = mm[2];
  }
  return vars;
}

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
function ratio(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [fg token, bg token, minimum ratio, where it is used]
const PAIRS = [
  ["text", "bg", 4.5, "body text on page"],
  ["text", "surface", 4.5, "text on cards"],
  ["text", "surface-raised", 4.5, "text on escrow rows"],
  ["text-muted", "bg", 4.5, "lede on page"],
  ["text-muted", "surface", 4.5, "hints, sheet keys on cards"],
  ["text-muted", "surface-raised", 4.5, "row meta on escrow rows"],
  ["text-muted", "surface-muted", 4.5, "segmented control off state"],
  ["text-faint", "bg", 4.5, "footer, label caption"],
  ["text-faint", "surface-raised", 4.5, "dust/refund why lines"],
  ["accent-ink", "accent", 4.5, "primary button label"],
  ["paper-ink", "paper", 4.5, "label card main ink"],
  ["paper-muted", "paper", 4.5, "label card keys"],
  ["stamp", "paper", 4.5, "stamp status on label card"],
  ["postal-ink", "surface", 4.5, "step numbers, tx links"],
  ["ok", "surface", 4.5, "success form message"],
  ["ok", "surface-raised", 4.5, "claimed status"],
  ["warn", "bg", 4.5, "deploy/testnet note"],
  ["warn", "surface", 4.5, "note inside sheet"],
  ["warn", "surface-raised", 4.5, "locked status"],
  ["bad", "surface", 4.5, "error form message"],
  ["border", "bg", 3.0, "input and card borders (non-text)"],
  ["border", "surface", 3.0, "borders on cards (non-text)"],
  ["focus", "bg", 3.0, "focus indicator on page"],
  ["focus", "surface", 3.0, "focus indicator on cards"],
];

let failed = 0;
for (const theme of ["dark", "light"]) {
  const v = themeVars(theme);
  console.log(`\n== ${theme} theme ==`);
  for (const [fg, bg, min, where] of PAIRS) {
    const r = ratio(v[fg], v[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${fg} on ${bg}: ${r.toFixed(2)}:1 (min ${min})  ${where}`);
  }
}
console.log(`\nCONTRAST RESULT: ${failed} failing pairs`);
process.exit(failed === 0 ? 0 : 1);
