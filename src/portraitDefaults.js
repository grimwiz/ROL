// Single source of truth for the built-in portrait art-style default.
// Leaf module (no requires) so it can be imported anywhere — including db.js
// migrations and the settings data layer — without risking an import cycle.
// The default is materialised into session_settings.portrait_style (see db.js
// backfill + sessionRolls.setSettings), so readers use the stored value
// directly rather than re-deriving the default at the UI or render layer.
const DEFAULT_PORTRAIT_STYLE = 'Art Nouveau portrait styling with a restrained Art Deco frame around the portrait, clean elegant linework, muted earthy palette with antique gold accents, painterly illustration, not photorealistic, not modern snapshot';

module.exports = { DEFAULT_PORTRAIT_STYLE };
