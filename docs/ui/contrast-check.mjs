// WCAG contrast ratio checker for the phase-3 token palette.
function srgbToLin(c) {
  const cs = c / 255;
  return cs <= 0.04045 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  const [rl, gl, bl] = [srgbToLin(r), srgbToLin(g), srgbToLin(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
function contrast(a, b) {
  const la = luminance(a) + 0.05;
  const lb = luminance(b) + 0.05;
  return la > lb ? la / lb : lb / la;
}
function fmt(ratio) {
  return ratio.toFixed(2) + ':1';
}
function check(label, fg, bg, threshold) {
  const r = contrast(fg, bg);
  const pass = r >= threshold ? 'PASS' : 'FAIL';
  console.log(`${pass}  ${label}  ${fmt(r)}  (need ${threshold}:1)`);
  return r >= threshold;
}

console.log('=== LIGHT THEME ===');
const L = {
  canvas: [247, 246, 244],
  surface: [255, 255, 255],
  surfaceElevated: [241, 240, 237],
  primary: [28, 28, 30],
  secondary: [85, 85, 90],
  muted: [110, 108, 104],
  accent: [232, 78, 15],
  accentStrong: [201, 69, 9],
  accentInk: [190, 60, 5],
  success: [4, 120, 87],
  warning: [146, 64, 14],
  danger: [185, 28, 28],
  info: [14, 116, 144],
  white: [255, 255, 255],
};
check('primary text / canvas', L.primary, L.canvas, 4.5);
check('primary text / surface', L.primary, L.surface, 4.5);
check('primary text / surface-elevated', L.primary, L.surfaceElevated, 4.5);
check('secondary text / canvas', L.secondary, L.canvas, 4.5);
check('secondary text / surface', L.secondary, L.surface, 4.5);
check('muted text / surface-elevated', L.muted, L.surfaceElevated, 4.5);
check('accent-ink text / surface-elevated', L.accentInk, L.surfaceElevated, 4.5);
check('success text / surface-elevated', L.success, L.surfaceElevated, 4.5);
check('warning text / surface-elevated', L.warning, L.surfaceElevated, 4.5);
check('danger text / surface-elevated', L.danger, L.surfaceElevated, 4.5);
check('info text / surface-elevated', L.info, L.surfaceElevated, 4.5);
check('accent / canvas (UI component, 3:1)', L.accent, L.canvas, 3.0);
check('accent / surface (UI component, 3:1)', L.accent, L.surface, 3.0);
check('white text / accent-strong (button label, 4.5:1)', L.white, L.accentStrong, 4.5);
check('accent-strong / surface (focus ring, 3:1)', L.accentStrong, L.surface, 3.0);
check('accent-strong / canvas (focus ring, 3:1)', L.accentStrong, L.canvas, 3.0);

console.log('\n=== DARK THEME (warm anthracite) ===');
const D = {
  canvas: [30, 30, 33],
  surface: [38, 38, 42],
  surfaceElevated: [45, 45, 50],
  primary: [232, 231, 228],
  secondary: [158, 156, 152],
  muted: [166, 163, 158],
  accent: [232, 78, 15],
  accentStrong: [201, 69, 9],
  accentInk: [255, 145, 97],
  success: [52, 211, 153],
  warning: [253, 203, 110],
  danger: [255, 118, 118],
  info: [34, 211, 238],
  focusRing: [255, 145, 97],
  white: [255, 255, 255],
};
check('primary text / canvas', D.primary, D.canvas, 4.5);
check('primary text / surface', D.primary, D.surface, 4.5);
check('primary text / surface-elevated', D.primary, D.surfaceElevated, 4.5);
check('secondary text / canvas', D.secondary, D.canvas, 4.5);
check('secondary text / surface', D.secondary, D.surface, 4.5);
check('muted text / surface-elevated', D.muted, D.surfaceElevated, 4.5);
check('accent-ink text / surface-elevated', D.accentInk, D.surfaceElevated, 4.5);
check('success text / surface-elevated', D.success, D.surfaceElevated, 4.5);
check('warning text / surface-elevated', D.warning, D.surfaceElevated, 4.5);
check('danger text / surface-elevated', D.danger, D.surfaceElevated, 4.5);
check('info text / surface-elevated', D.info, D.surfaceElevated, 4.5);
check('accent / canvas (UI component, 3:1)', D.accent, D.canvas, 3.0);
check('accent / surface (UI component, 3:1)', D.accent, D.surface, 3.0);
check('accent / surface-elevated (UI component, 3:1)', D.accent, D.surfaceElevated, 3.0);
check('white text / accent-strong (button hover, 4.5:1)', D.white, D.accentStrong, 4.5);
check('focus-ring / surface (3:1)', D.focusRing, D.surface, 3.0);
check('focus-ring / canvas (3:1)', D.focusRing, D.canvas, 3.0);

console.log('\n=== OLD (for reference) ===');
check('old accent #FF5917 / old dark surface #16161F', [255,89,23], [22,22,31], 3.0);
check('old accent #FF5917 white text (button label)', [255,255,255], [255,89,23], 4.5);
