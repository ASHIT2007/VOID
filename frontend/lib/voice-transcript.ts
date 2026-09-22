const SWORD_CONTEXT = /\b(?:seven|ninja|naruto|mist|kirigakure|blade|sword|swords|swordsmanship|samurai|anime|manga|shinobi)\b/i;
const KNOWN_WADE_NAME = /\bwade\s+(?:wilson|barrett|boggs|hampton|robson|phillips|davis)\b/i;

/**
 * Correct a very small set of observed voice-assistant homophones.
 *
 * Corrections are deliberately contextual: ordinary people called Wade and
 * genuine sports-related uses of "sportsmen" must remain untouched.
 */
export function normalizeVoiceTranscript(rawText: string, recentContext = ""): string {
  let text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return "";

  if (!KNOWN_WADE_NAME.test(text)) {
    text = text.replace(
      /\b(hey|hi|hello|okay|ok|thanks|thank you)\s*,?\s+wade\b/gi,
      "$1 Void",
    );
    text = text.replace(
      /^wade\b(?=\s*(?:[,;:!?-]|can\b|could\b|would\b|will\b|please\b|tell\b|show\b|find\b|search\b|give\b|make\b|explain\b|stop\b|wait\b|listen\b|what\b|who\b|why\b|when\b|where\b|how\b|do\b|are\b|is\b|$))/i,
      "Void",
    );
    text = text.replace(
      /\b(you are|are you|your name is|I call you|called)\s+wade\b/gi,
      "$1 Void",
    );
  }

  const combinedContext = `${recentContext} ${text}`;
  if (SWORD_CONTEXT.test(combinedContext)) {
    text = text
      .replace(/\bsports[ -]?men\b/gi, "swordsmen")
      .replace(/\bsportsman\b/gi, "swordsman");
  }

  return text;
}
