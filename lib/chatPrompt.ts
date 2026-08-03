export function buildSystemPrompt(_prenom: string, _role: string): string {
  return "";
}

export function parseQualified(reply: string): { qualified: boolean; brief: any; clean: string } {
  return { qualified: false, brief: null, clean: reply || "" };
}

export function getChatPrompt(): string {
  return "";
}
