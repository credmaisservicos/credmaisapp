export type NegotiationMessage = { role: "user" | "assistant"; content: string };

export type NegotiationRequest = {
  clientId: string;
  sessionToken: string;
  messages: NegotiationMessage[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 1_200;
const MAX_TOTAL_CHARS = 6_000;

export function parseNegotiationRequest(input: unknown): NegotiationRequest | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  const clientId = typeof value.clientId === "string" ? value.clientId.trim() : "";
  const sessionToken = typeof value.session_token === "string" ? value.session_token.trim() : "";
  if (!UUID.test(clientId) || !sessionToken || sessionToken.length > 256 || !Array.isArray(value.messages)) return null;
  if (value.messages.length < 1 || value.messages.length > MAX_MESSAGES) return null;

  let totalChars = 0;
  const messages: NegotiationMessage[] = [];
  for (const raw of value.messages) {
    if (!raw || typeof raw !== "object") return null;
    const message = raw as Record<string, unknown>;
    if (message.role !== "user" && message.role !== "assistant") return null;
    if (typeof message.content !== "string") return null;
    const content = message.content.trim();
    if (!content || content.length > MAX_MESSAGE_CHARS) return null;
    totalChars += content.length;
    if (totalChars > MAX_TOTAL_CHARS) return null;
    messages.push({ role: message.role, content });
  }

  return { clientId, sessionToken, messages };
}
