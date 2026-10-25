// Collect from deployed, public pages only. No local server, login, or upload
// to the Lighthouse CI public reporting service (reports stay as CI artifacts).
const desktop = process.env.LHCI_FORM_FACTOR === "desktop";
module.exports = {
  ci: {
    collect: {
      url: ["https://ecopulseef.netlify.app/", "https://ecopulseef.netlify.app/materials"],
      numberOfRuns: Math.max(1, Math.min(3, Number(process.env.LHCI_RUNS) || 1)),
      chromePath: process.env.CHROME_PATH,
      settings: {
        ...(desktop ? { preset: "desktop" } : {}),
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        maxWaitForLoad: 45000,
      },
    },
  },
};
