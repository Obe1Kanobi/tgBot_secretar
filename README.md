# 🤖 Meeting Bot - Production-Ready Analysis

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/docker-ready-blue.svg)](https://docker.com)
[![Gemini](https://img.shields.io/badge/Gemini-AI-orange.svg)](https://ai.google.dev)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-blue.svg)](https://core.telegram.org/bots)
[![Bitrix24](https://img.shields.io/badge/Bitrix24-CRM-green.svg)](https://www.bitrix24.com)

**Production-ready meeting analysis bot** with automatic recording, AI-powered transcription via Gemini, structured checklist analysis, and Bitrix24 CRM integration.

## 🚀 Features

### Core Capabilities
- **Auto-join meetings** via Puppeteer (Google Meet, Zoom, Yandex Telemost, Contour.Talk, MS Teams)
- **Audio recording** throughout the entire meeting duration
- **AI Transcription** using Google Gemini 1.5 Flash
- **Structured analysis** with 12-point sales checklist
- **Telegram control** - send a link, get a detailed report
- **Bitrix24 integration** - auto-update leads with analysis results

### Security & Production Features
- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ Rate limiting for API endpoints
- ✅ Input validation (URL, required fields)
- ✅ Structured JSON logging with Pino
- ✅ Graceful shutdown handling
- ✅ Error handling middleware
- ✅ Health check endpoints with auth option
- ✅ Resource cleanup on errors
- ✅ Memory usage monitoring

## ⚡ Quick Start

```bash
# Clone repository
git clone https://github.com/goqorhopar/bot.git
cd bot

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
nano .env

# Start the bot
npm start
```

Server will start on `http://localhost:3000`

## 📦 Installation

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Docker (optional, for containerized deployment)
- Chrome/Chromium (installed automatically in Docker)

### Local Installation

```bash
# Install dependencies
npm install

# Skip Puppeteer download if you have Chrome installed
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

### Docker Installation

```bash
# Build image
docker build -t meeting-bot .

# Run container
docker run -d \
  --name meeting-bot \
  --env-file .env \
  -p 3000:10000 \
  meeting-bot
```

## ⚙️ Configuration

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | `123456:ABC-DEF...` |
| `ADMIN_CHAT_ID` | Admin chat ID for reports | `-1001234567890` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaSy...` |
| `PORT` | Server port | `3000` |

### Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BITRIX_WEBHOOK_URL` | Bitrix24 webhook URL | - |
| `BITRIX_USER_ID` | Bitrix24 user ID | `1` |
| `BITRIX_WEBHOOK_KEY` | Bitrix24 webhook key | - |
| `REC_DIR` | Recording directory | `/tmp/recordings` |
| `REC_MAX_SECONDS` | Max recording duration | `3600` |
| `LOG_LEVEL` | Logging level | `info` |
| `CHROME_BIN` | Chrome binary path | `/usr/bin/google-chrome-stable` |
| `CORS_ORIGIN` | CORS allowed origin | `*` |
| `RATE_LIMIT_MAX_REQUESTS` | Rate limit requests | `10` |
| `HELMET_ENABLED` | Enable security headers | `true` |

### Environment File Template

```bash
# .env
TELEGRAM_BOT_TOKEN=your_bot_token
ADMIN_CHAT_ID=your_chat_id
GEMINI_API_KEY=your_gemini_key
BITRIX_WEBHOOK_URL=https://your-domain.bitrix24.ru/rest/USER_ID/WEBHOOK_KEY/
PORT=3000
LOG_LEVEL=info
```

## 💻 Usage

### Telegram Commands

- `/start` - Welcome message and instructions
- `/process [url] [leadId]` - Process a meeting
- `/test` - Test bot connectivity

Example:
```
/process https://meet.google.com/abc-defg-hij L12345
```

### API Endpoints

#### POST /process-meeting

Process a meeting and return analysis.

```bash
curl -X POST http://localhost:3000/process-meeting \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/abc-defg-hij",
    "leadId": "L12345"
  }'
```

Response:
```json
{
  "success": true,
  "meetingUrl": "https://meet.google.com/abc-defg-hij",
  "leadId": "L12345",
  "transcriptLength": 5432,
  "analysis": {
    "overallScore": 85,
    "category": "B",
    "summary": "Good meeting with clear next steps",
    "pointsCount": 12
  },
  "bitrixUpdated": true
}
```

#### GET /health

Health check endpoint.

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600,
  "memory": { "rss": 256000000, "heapUsed": 128000000 },
  "nodeVersion": "v18.19.0"
}
```

#### GET /health/deep

Deep health check with system metrics.

## 🏗 Architecture

### Project Structure

```
├── src/
│   ├── index.js           # Express server + main API
│   ├── middleware.js      # Security, logging, error handling
│   ├── config.js          # Configuration management
│   ├── telegram.js        # Telegram bot logic
│   ├── browser.js         # Puppeteer browser automation
│   ├── recording.js       # Audio recording via FFmpeg
│   ├── transcribe.js      # Gemini audio transcription
│   ├── gemini.js          # AI checklist analysis
│   └── bitrix.js          # Bitrix24 CRM integration
├── Dockerfile             # Container configuration
├── docker-compose.yml     # Docker Compose setup
├── render.yaml            # Render deployment config
├── .env.example           # Environment template
└── package.json           # Dependencies
```

### Data Flow

1. **Request Received** → Telegram command or API call
2. **Browser Launch** → Puppeteer opens meeting URL
3. **Auto-Join** → Platform-specific join logic
4. **Recording Start** → FFmpeg captures system audio
5. **Meeting Duration** → Wait for timeout or end signal
6. **Recording Stop** → Save audio file
7. **Transcription** → Gemini AI converts audio to text
8. **Analysis** → 12-point checklist evaluation
9. **CRM Update** → Bitrix24 lead update (if leadId provided)
10. **Report Delivery** → Telegram message to admin

### Supported Platforms

- ✅ Google Meet
- ✅ Zoom
- ✅ Microsoft Teams
- ✅ Yandex Telemost
- ✅ Contour.Talk
- ✅ Generic platforms (fallback logic)

## 🚢 Deployment

### Docker Deployment

```bash
# Build
docker build -t meeting-bot .

# Run
docker run -d \
  --env-file .env \
  -p 3000:10000 \
  --name meeting-bot \
  meeting-bot

# Logs
docker logs -f meeting-bot
```

### Render Deployment

1. Connect your GitHub repository to Render
2. Select `render.yaml` as the blueprint
3. Set environment variables in Render dashboard
4. Deploy automatically on push

### Environment-Specific Configs

- `.env.example` - Template for local development
- `.env.production` - Production hardening options

## 🔧 Development

### Scripts

```bash
# Start production
npm start

# Start development
npm run dev

# Check syntax
node --check src/index.js

# Audit dependencies
npm audit

# Fix vulnerabilities
npm audit fix
```

### Adding New Meeting Platforms

Edit `src/browser.js`:

```javascript
async function joinNewPlatform(page, logger) {
  // Platform-specific join logic
}
```

### Testing

```bash
# Test health endpoint
curl http://localhost:3000/health

# Test process endpoint
curl -X POST http://localhost:3000/process-meeting \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://example.com"}'
```

## 🐛 Troubleshooting

### Common Issues

**1. Puppeteer/Chrome Errors**
```bash
# Install Chrome dependencies
apt-get install -y chromium-browser

# Or use Docker which includes all dependencies
docker run meeting-bot
```

**2. Audio Recording Issues**
```bash
# Check PulseAudio is running
pulseaudio --check

# Verify FFmpeg installation
ffmpeg -version
```

**3. API Key Errors**
- Verify `GEMINI_API_KEY` is valid
- Check API quota in Google Cloud Console
- Ensure no trailing spaces in .env

**4. Telegram Bot Not Responding**
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check bot is not blocked by admin
- Review polling logs for errors

**5. Memory Issues**
```bash
# Monitor memory usage
docker stats meeting-bot

# Adjust Node memory limit
NODE_OPTIONS="--max-old-space-size=512" npm start
```

### Logs

```bash
# View application logs
docker logs meeting-bot

# Follow logs in real-time
docker logs -f meeting-bot

# Last 100 lines
docker logs --tail 100 meeting-bot
```

### Getting Help

- Check existing issues on GitHub
- Review logs with `LOG_LEVEL=debug`
- Contact support via Telegram

## 📊 Monitoring

### Metrics to Watch

- Memory usage (keep under 512MB)
- CPU usage during meetings
- Recording file sizes
- API response times
- Error rates

### Alerting

Set up alerts for:
- High memory usage (>80%)
- Failed meeting processes
- API rate limit hits
- Health check failures

## 🔒 Security

### Best Practices Implemented

- ✅ Input validation on all endpoints
- ✅ Rate limiting to prevent abuse
- ✅ CORS configuration
- ✅ Security headers via Helmet
- ✅ No sensitive data in logs
- ✅ Graceful error handling
- ✅ Resource cleanup

### Recommendations

1. Use HTTPS in production
2. Rotate API keys regularly
3. Limit rate limits based on usage
4. Monitor for unusual patterns
5. Keep dependencies updated

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📞 Support

For issues and questions:
- GitHub Issues
- Telegram: @your_support_bot

---

**Built with ❤️ using Node.js, Puppeteer, and Google Gemini AI**
