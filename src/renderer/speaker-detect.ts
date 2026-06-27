// speaker-detect.ts — Smart speaker detection for single HDMI audio source
//
// Problem: Dono aawazein (interviewer + candidate) ek hi HDMI capture card se aati hain.
// Solution: Tri-layer detection —
//   1. AI content analysis (question vs statement)
//   2. Silence gap heuristic (lambi silence = speaker change)
//   3. Manual hotkey override (Ctrl+Shift+I / Ctrl+Shift+C)
//
// Priority: Manual override > Silence gap > AI content analysis

export type Speaker = "Interviewer" | "Candidate";

export interface SpeakerDetectOptions {
  onSpeakerChange: (speaker: Speaker) => void;
}

// ── State ──────────────────────────────────────────────────────────────────────
let currentSpeaker: Speaker = "Interviewer";
let manualOverride: Speaker | null = null;
let lastSpeechEndTime = 0;
let listeners: Array<(s: Speaker) => void> = [];

// Silence > this ms between utterances = likely speaker changed
const SPEAKER_CHANGE_SILENCE_MS = 2500;

// ── AI content analysis — heuristics, no API call needed ─────────────────────
// Returns confidence 0-1 that this text is from the Interviewer
function interviewerScore(text: string): number {
  const t = text.trim().toLowerCase();
  let score = 0.5; // neutral

  // Strong interviewer signals
  const interviewerPatterns = [
    /\?$/, // ends with question mark
    /^(what|how|why|when|where|which|who|can you|could you|would you|tell me|explain|describe|walk me through|have you|did you|do you|are you|is there|what's your|what are your)/i,
    /(experience with|worked with|familiar with|knowledge of|background in)/i,
    /(tell me about|describe a (time|situation|case)|give me an example)/i,
    /(what would you|how would you|what do you think|in your opinion)/i,
    /(next question|moving on|let's talk about|one more|last question)/i,
  ];

  // Strong candidate signals (self-referential statements)
  const candidatePatterns = [
    /^(i |i've |i had |i used |i implemented |i built |i worked |i was |in my |at my |we used |we had |we built)/i,
    /(in my (previous|current|last) (role|company|job|experience))/i,
    /(when i was at|during my time at|i remember when)/i,
    /(so basically|so what i did|the approach i took|what i found)/i,
    /(for example,? i|specifically i|personally i)/i,
  ];

  for (const p of interviewerPatterns) {
    if (p.test(t)) score += 0.3;
  }
  for (const p of candidatePatterns) {
    if (p.test(t)) score -= 0.3;
  }

  // Short text with question mark = very likely interviewer
  if (t.endsWith("?") && t.split(" ").length < 20) score += 0.2;

  // Long text > 30 words starting with "I" = likely candidate answering
  if (t.startsWith("i ") && t.split(" ").length > 30) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

// ── Main detection function ────────────────────────────────────────────────────
export function detectSpeaker(
  text: string,
  speechEndTime: number = Date.now()
): Speaker {
  // 1. Manual override takes priority
  if (manualOverride !== null) {
    currentSpeaker = manualOverride;
    manualOverride = null; // one-shot override
    notifyListeners(currentSpeaker);
    return currentSpeaker;
  }

  // 2. Silence gap heuristic — long silence = speaker likely changed
  const silenceGap = speechEndTime - lastSpeechEndTime;
  lastSpeechEndTime = speechEndTime;

  let detectedSpeaker: Speaker;

  if (silenceGap > SPEAKER_CHANGE_SILENCE_MS && lastSpeechEndTime > 0) {
    // Long silence — flip speaker
    detectedSpeaker = currentSpeaker === "Interviewer" ? "Candidate" : "Interviewer";
  } else {
    // 3. AI content analysis
    const score = interviewerScore(text);
    if (score >= 0.65) {
      detectedSpeaker = "Interviewer";
    } else if (score <= 0.35) {
      detectedSpeaker = "Candidate";
    } else {
      // Ambiguous — keep current speaker
      detectedSpeaker = currentSpeaker;
    }
  }

  if (detectedSpeaker !== currentSpeaker) {
    currentSpeaker = detectedSpeaker;
    notifyListeners(currentSpeaker);
  }

  return currentSpeaker;
}

// ── Manual override ────────────────────────────────────────────────────────────
export function setNextSpeaker(speaker: Speaker) {
  manualOverride = speaker;
  currentSpeaker = speaker;
  notifyListeners(speaker);
}

export function getCurrentSpeaker(): Speaker {
  return currentSpeaker;
}

export function toggleSpeaker(): Speaker {
  currentSpeaker = currentSpeaker === "Interviewer" ? "Candidate" : "Interviewer";
  manualOverride = null;
  notifyListeners(currentSpeaker);
  return currentSpeaker;
}

// ── Listener system ────────────────────────────────────────────────────────────
export function onSpeakerChange(fn: (s: Speaker) => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

function notifyListeners(s: Speaker) {
  listeners.forEach(fn => fn(s));
}

// ── Hotkey registration ────────────────────────────────────────────────────────
// Ctrl+Shift+I = force Interviewer next
// Ctrl+Shift+C = force Candidate (you) next
// Ctrl+Shift+T = toggle between them
export function registerHotkeys() {
  document.addEventListener("keydown", (e) => {
    if (!e.ctrlKey || !e.shiftKey) return;

    if (e.key === "F" || e.key === "f") { // Ctrl+Shift+F = Interviewer (Forward)
      e.preventDefault();
      setNextSpeaker("Interviewer");
    } else if (e.key === "M" || e.key === "m") { // Ctrl+Shift+M = Me (Candidate)
      e.preventDefault();
      setNextSpeaker("Candidate");
    } else if (e.key === "T" || e.key === "t") { // Ctrl+Shift+T = Toggle
      e.preventDefault();
      toggleSpeaker();
    }
  });
}
