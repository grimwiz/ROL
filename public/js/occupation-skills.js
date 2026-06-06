// Occupation → required skills, transcribed verbatim from the rulebook
// Occupation Table (Rivers_of_London/rules/03-character-creation.md). Drives the
// non-blocking "required skills not yet listed" hint under the Expert skills
// area. We never auto-add — an occupation may be a GM variant with allocated
// skills — we only warn.
//
// Each entry: { text } is the exact Required-skills cell. `required` is a parsed
// list of plainly-named skills for matching; `complex` flags entries whose
// requirement can't be reduced to a flat skill list (None / or / plus a
// specialism), where we show the text rather than a tick-list.
(function (root) {
  'use strict';

  // base = the leading skill name used for present/absent matching (lowercased).
  // label = how it's shown to the user (keeps the specialisation).
  const S = (label) => ({ label, base: String(label).split('(')[0].trim().toLowerCase() });

  const OCCUPATIONS = {
    'architect':            { text: 'Art/Craft (Architecture)', required: [S('Art/Craft (Architecture)')] },
    'artist':               { text: 'Art/Craft (chosen discipline)', required: [S('Art/Craft')] },
    'athlete':              { text: 'Athletics', required: [S('Athletics')] },
    'author':               { text: 'Art/Craft (Literature), Research', required: [S('Art/Craft (Literature)'), S('Research')] },
    'chancer':              { text: 'Observation, Stealth', required: [S('Observation'), S('Stealth')] },
    'clergy':               { text: 'Read Person, Research, Social', required: [S('Read Person'), S('Research'), S('Social')] },
    'computer specialist':  { text: 'Computer Use, Tech', required: [S('Computer Use'), S('Tech')] },
    'criminal':             { text: 'None', required: [], complex: true },
    'dilettante':           { text: 'None', required: [], complex: true },
    'doctor of medicine':   { text: 'Medicine', required: [S('Medicine')] },
    'driver':               { text: 'Drive', required: [S('Drive')] },
    'entertainer':          { text: 'Art/Craft (Acting or instrument)', required: [S('Art/Craft')], complex: true },
    'farmer':               { text: 'Art/Craft (Farming), Drive', required: [S('Art/Craft (Farming)'), S('Drive')] },
    'firefighter':          { text: 'Athletics', required: [S('Athletics')] },
    'influencer':           { text: 'Social', required: [S('Social')] },
    'journalist':           { text: 'Research, Social', required: [S('Research'), S('Social')] },
    'lawyer':               { text: 'Law, Research, Social', required: [S('Law'), S('Research'), S('Social')] },
    'lecturer':             { text: 'Research plus a subject-skill specialism', required: [S('Research')], complex: true },
    'librarian':            { text: 'Research', required: [S('Research')] },
    'nurse':                { text: 'Medicine 60, or Medicine 40 plus one other expert skill at 40', required: [S('Medicine')], complex: true },
    'paramedic':            { text: 'Medicine, Observation', required: [S('Medicine'), S('Observation')] },
    'parapsychologist':     { text: 'Occult, Read Person', required: [S('Occult'), S('Read Person')] },
    'police officer/detective': { text: 'Law', required: [S('Law')] },
    'private investigator': { text: 'Law, Research', required: [S('Law'), S('Research')] },
    'service member':       { text: 'Athletics, Fighting, Firearms', required: [S('Athletics'), S('Fighting'), S('Firearms')] },
    'social worker':        { text: 'Social', required: [S('Social')] },
    'special agent':        { text: 'Law', required: [S('Law')] },
    'tradesperson':         { text: 'Art/Craft specialism, or another suitable expert skill', required: [S('Art/Craft')], complex: true }
  };

  // Loose alias matching so free-text occupation boxes still resolve, e.g.
  // "Police Constable", "Detective", "DC", "Cryptopathologist".
  const ALIASES = [
    [/police|\bpc\b|\bdc\b|\bdci?\b|\bds\b|detective|constable|warrant/i, 'police officer/detective'],
    [/doctor|\bgp\b|physician|patholog|medic(?!al student)/i, 'doctor of medicine'],
    [/nurse/i, 'nurse'],
    [/paramedic|\bemt\b|first responder/i, 'paramedic'],
    [/lawyer|solicitor|barrister|advocate/i, 'lawyer'],
    [/\bfbi\b|special agent|\bagent\b/i, 'special agent'],
    [/private investigator|\bpi\b|private eye/i, 'private investigator'],
    [/soldier|army|marine|service member|veteran|military/i, 'service member'],
    [/firefighter|fireman/i, 'firefighter'],
    [/journalist|reporter|press/i, 'journalist'],
    [/librarian|archivist|curator/i, 'librarian'],
    [/lecturer|professor|teacher|tutor|academic|scholar/i, 'lecturer'],
    [/computer|programmer|hacker|\bit\b/i, 'computer specialist'],
    [/architect/i, 'architect'],
    [/author|writer|novelist/i, 'author']
  ];

  function resolveOccupation(occupation) {
    const key = String(occupation || '').trim().toLowerCase();
    if (!key) return null;
    if (OCCUPATIONS[key]) return OCCUPATIONS[key];
    for (const [re, target] of ALIASES) if (re.test(key)) return OCCUPATIONS[target];
    return null;
  }

  // presentNames: array of skill names the investigator already has (common +
  // expert + combat). Returns { occupation, text, complex, missing:[labels] } or
  // null if the occupation isn't recognised. `missing` lists required skills not
  // present; for complex requirements `missing` may be empty and `complex` true.
  function requiredHint(occupation, presentNames) {
    const entry = resolveOccupation(occupation);
    if (!entry) return null;
    const have = (Array.isArray(presentNames) ? presentNames : [])
      .map((n) => String(n || '').trim().toLowerCase())
      .filter(Boolean);
    const present = (base) => have.some((h) => h === base || h.startsWith(base));
    const missing = entry.required.filter((r) => !present(r.base)).map((r) => r.label);
    return { text: entry.text, complex: !!entry.complex, missing };
  }

  const api = { OCCUPATIONS, resolveOccupation, requiredHint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OccupationSkills = api;
})(typeof window !== 'undefined' ? window : null);
