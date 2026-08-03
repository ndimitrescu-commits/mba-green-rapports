export const claude = {
  apiKey: process.env.ANTHROPIC_API_KEY || "",
};

export async function callClaude(
  _messages: any[],
  _system: string,
  _maxTokens: number = 1024
): Promise<string> {
  return "";
}
