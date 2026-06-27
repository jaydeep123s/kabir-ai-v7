// websocket.ts — connects to the Go backend /ws endpoint.
// Protocol (matches overlay-backend exactly):
//   Send:    JSON  { "question": "..." }
//   Receive: JSON  { "type": "token"|"done"|"error", "content"?: "...", "error"?: "..." }

const WS_URL            = "ws://localhost:8080/ws";
const RECONNECT_DELAY_MS = 3000;

let ws: WebSocket | null = null;

export function connectWebSocket(
  onToken: (text: string) => void,
  onDone: () => void,
  onStatusChange: (connected: boolean) => void
): void {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    console.log("[ws] connected to backend");
    onStatusChange(true);
  };

  ws.onmessage = (event: MessageEvent) => {
    const msg = JSON.parse(event.data) as {
      type: string;
      content?: string;
      error?: string;
    };

    if (msg.type === "token" && msg.content) {
      onToken(msg.content);
    } else if (msg.type === "done") {
      onDone();
    } else if (msg.type === "error") {
      console.error("[ws] error from backend:", msg.error);
      onDone();
    }
  };

  ws.onerror = () => onStatusChange(false);

  ws.onclose = () => {
    onStatusChange(false);
    // Auto-reconnect so the overlay stays live during the interview
    setTimeout(
      () => connectWebSocket(onToken, onDone, onStatusChange),
      RECONNECT_DELAY_MS
    );
  };
}

export function askQuestion(question: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[ws] not connected — question dropped");
    return;
  }
  ws.send(JSON.stringify({ question }));
}
