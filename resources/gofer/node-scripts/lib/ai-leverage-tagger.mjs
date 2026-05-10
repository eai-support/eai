/**
 * ai-leverage-tagger.mjs
 *
 * Implements the 4-verb AI-leverage taxonomy used across persona-pack visuals.
 *
 * The taxonomy is enforced everywhere a TO-BE value-stream step appears:
 *   - Replace  : AI fully replaces a step that a human used to do.
 *   - Augment  : AI helps a human do a step better/faster (human in the loop).
 *   - Automate : Step runs unattended on a schedule or trigger (no human).
 *   - Observe  : AI watches/monitors only — no action taken.
 *
 * `tagVerb()` applies a keyword heuristic to a free-text step description and
 * returns one of the four valid verbs (defaulting to "Augment" when nothing
 * matches — the most common case for human-in-the-loop AI work).
 *
 * `validateVerb()` is the strict gate used by the persona-pack completeness
 * check; it throws when the input is not exactly one of the four verbs.
 */

export const VERBS = Object.freeze(['Replace', 'Augment', 'Automate', 'Observe']);

const KEYWORD_RULES = [
  {
    verb: 'Replace',
    patterns: [
      /\breplace[sd]?\b/i,
      /\beliminat(e|es|ed|ing)\b/i,
      /\bremov(e|es|ed|ing)\b/i,
      /\bsupersed(e|es|ed|ing)\b/i,
      /\binstead of\b/i,
    ],
  },
  {
    verb: 'Automate',
    patterns: [
      /\bautomat(e|es|ed|ing|ion)\b/i,
      /\bunattended\b/i,
      /\bscheduled?\b/i,
      /\btrigger(ed|s)?\b/i,
      /\bcron\b/i,
      /\bwithout (a |any )?human\b/i,
    ],
  },
  {
    verb: 'Observe',
    patterns: [
      /\bobserv(e|es|ed|ing)\b/i,
      /\bmonitor(s|ed|ing)?\b/i,
      /\bwatch(es|ed|ing)?\b/i,
      /\balert(s|ed|ing)?\b/i,
      /\bdetect(s|ed|ing)?\b/i,
      /\btrack(s|ed|ing)?\b/i,
    ],
  },
  {
    verb: 'Augment',
    patterns: [
      /\baugment(s|ed|ing)?\b/i,
      /\bassist(s|ed|ing)?\b/i,
      /\bsuggest(s|ed|ing|ion|ions)?\b/i,
      /\brecommend(s|ed|ing|ation|ations)?\b/i,
      /\bhelp(s|ed|ing)?\b/i,
      /\bco-?pilot\b/i,
    ],
  },
];

/**
 * Classify a value-stream step description into one of the four verbs.
 *
 * @param {string} stepDescription Free-text step from a TO-BE flowchart.
 * @returns {'Replace'|'Augment'|'Automate'|'Observe'}
 */
export function tagVerb(stepDescription) {
  if (typeof stepDescription !== 'string' || stepDescription.trim() === '') {
    return 'Augment';
  }
  for (const { verb, patterns } of KEYWORD_RULES) {
    if (patterns.some((re) => re.test(stepDescription))) {
      return verb;
    }
  }
  return 'Augment';
}

/**
 * Strict validator used by the persona-pack completeness gate. Throws on any
 * value outside the canonical 4-verb set.
 *
 * @param {string} verb Candidate verb.
 * @returns {true} On success.
 * @throws {Error} When `verb` is not one of Replace/Augment/Automate/Observe.
 */
export function validateVerb(verb) {
  if (!VERBS.includes(verb)) {
    throw new Error(
      `Invalid AI-leverage verb: ${JSON.stringify(verb)}. Expected one of ${VERBS.join(', ')}.`
    );
  }
  return true;
}

export default { tagVerb, validateVerb, VERBS };
