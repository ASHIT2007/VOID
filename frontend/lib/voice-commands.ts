function normalizedCommand(text: string): string {
  return text.toLocaleLowerCase().replace(/[’']/g, '').replace(/[.,!?;:"“”‘]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function isVoiceStopCommand(text: string): boolean {
  const value = normalizedCommand(text);
  return /^(?:(?:ok|okay)\s+)*(?:shut up|stop|stop talking|stop speaking|be quiet|quiet|बस|बस करो|चुप|चुप हो जाओ|रुको|रुक जाओ|बंद करो)$/.test(value);
}

export function isVoiceExitCommand(text: string): boolean {
  const value = normalizedCommand(text);
  return /^(?:(?:ok|okay|alright|thanks?|thank you)\s+)*(?:go away|goodbye|good bye|bye|bye bye|see you|see you later|that(?:s| is) all|we(?:re| are) done|end (?:the )?(?:voice session|voice|call|session|conversation)|close (?:the )?(?:voice agent|voice session|voice|call|session)|exit (?:voice|the voice|the call)?|quit (?:voice|the voice|the call)?|dismiss|leave me alone|you can go|stop listening|बाय|अलविदा|चले जाओ|चले जाईए|बस इतना|वॉइस बंद करो)$/.test(value);
}
