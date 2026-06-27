# Kabir AI v6

Stealth interview assistant with HDMI capture card audio listening, 10-user profiles, and AI answers.

## What's New in v6

| Feature | Detail |
|---|---|
| 🎙 **Audio Listening** | Real-time speech-to-AI. Auto-detects HDMI capture card (USB Audio) |
| 👥 **10 User Profiles** | Per-user Resume + JD stored in localStorage permanently |
| 📷 **Screen Capture** | Ctrl+Shift+C — screenshot → AI analyzes interview question |
| 🗜️ **Compact UI** | Icon-only toolbar, 1-line question input, arrow send button |

## Audio Setup (HDMI Capture Card)

1. Connect capture card USB to THIS laptop (the one running Kabir AI)
2. Second laptop → HDMI out → Capture card → USB → this laptop
3. Click 🎙 button in toolbar → select the capture card from dropdown
4. Click mic button to start listening → interviews audio auto-transcribes

**Device names to look for:**
- "USB Audio Device"
- "HDMI Capture"
- "Elgato", "AVerMedia", "Magewell"
- Any USB audio device

## Hotkeys

| Key | Action |
|---|---|
| Ctrl+Shift+A | Toggle audio listening |
| Ctrl+Shift+C | Screen capture → AI |
| Ctrl+Shift+S | OCR selection |
| Ctrl+Shift+I | Stealth text input |
| Ctrl+Shift+O | Show/hide overlay |
| Ctrl+Enter | Send question |

## User Profiles

- Click 👤 button in titlebar → User Profiles panel
- Add up to 10 profiles (name, role, company, resume, JD)
- Click a profile to activate → auto-uploads resume + JD to AI backend
- Data stored permanently in localStorage (survives app restart)

## Build & Run

```bash
cd overlay-app-v6
npm install
npm start
```

Backend (Go) must be running:
```bash
cd overlay-backend
go run cmd/server/main.go
```
"# kabir-ai-v7" 
