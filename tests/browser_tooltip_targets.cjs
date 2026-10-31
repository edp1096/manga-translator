// Region-level usability probes intentionally include points outside the raw
// detector's ink. Use the actual content-script hover/resize/editing harness.
process.env.MANGA_TOOLTIP_FIXTURES=require('node:path').join(__dirname,'fixtures/tooltip-targets.json');
require('./browser_tooltip_overlap.cjs');
