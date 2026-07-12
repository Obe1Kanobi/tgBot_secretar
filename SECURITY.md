# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of Meeting Bot seriously. If you believe you have found a security vulnerability, please report it to us as described below.

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them via email at security@example.com or create a draft security advisory on GitHub.

You should receive a response within 48 hours acknowledging your report. After the initial reply, we will keep you informed of the progress towards a fix and announcement.

## Security Best Practices

### For Users

1. **Environment Variables**
   - Never commit `.env` files to version control
   - Use strong, unique API keys
   - Rotate credentials regularly
   - Use secrets management in production

2. **Network Security**
   - Deploy behind HTTPS proxy in production
   - Use firewall rules to restrict access
   - Enable rate limiting (configured by default)
   - Monitor for unusual traffic patterns

3. **Access Control**
   - Restrict Telegram bot access to authorized users only
   - Use `ADMIN_CHAT_ID` to limit who can trigger actions
   - Consider adding API key authentication for sensitive endpoints

4. **Data Protection**
   - Recording files are stored temporarily in `/tmp/recordings`
   - Files are automatically deleted after processing
   - Consider encrypting recordings if storing long-term

5. **Dependencies**
   - Keep dependencies updated (`npm audit`, `npm update`)
   - Review security advisories regularly
   - Use `npm audit fix` for automatic patches

### Known Limitations

1. **Puppeteer Security**
   - Browser runs with `--no-sandbox` in Docker (required for containerized environments)
   - Consider using a sandboxed environment for untrusted URLs
   - Be cautious with user-provided meeting URLs

2. **Rate Limiting**
   - Default: 10 requests per minute per IP on `/api/*` routes
   - Adjust based on your usage patterns
   - Monitor for abuse

3. **API Keys**
   - Gemini API key has quota limits
   - Monitor usage in Google Cloud Console
   - Set up billing alerts

## Security Features Implemented

- ✅ Helmet security headers
- ✅ CORS configuration
- ✅ Rate limiting
- ✅ Input validation
- ✅ Structured logging (no sensitive data)
- ✅ Error handling (no stack traces in production)
- ✅ Graceful shutdown
- ✅ Resource cleanup

## Security Checklist for Deployment

- [ ] Set strong, unique API keys
- [ ] Configure CORS for your domain
- [ ] Enable HTTPS
- [ ] Set up monitoring and alerting
- [ ] Configure firewall rules
- [ ] Review rate limit settings
- [ ] Test health check endpoints
- [ ] Verify logging configuration
- [ ] Set up backup procedures
- [ ] Document incident response plan

## Third-Party Services

This application uses:

1. **Google Gemini AI** - Review [Google's security practices](https://cloud.google.com/security)
2. **Telegram Bot API** - Review [Telegram's security](https://core.telegram.org/api/security)
3. **Bitrix24** - Review [Bitrix24 security](https://www.bitrix24.com/security.php)

Ensure you understand and comply with their terms of service and security requirements.

## Incident Response

In case of a security incident:

1. **Immediate Actions**
   - Revoke compromised credentials
   - Stop affected services if necessary
   - Preserve logs for investigation

2. **Investigation**
   - Review logs for unauthorized access
   - Check for data exposure
   - Identify root cause

3. **Recovery**
   - Patch vulnerabilities
   - Rotate all credentials
   - Resume services with enhanced monitoring

4. **Post-Incident**
   - Document lessons learned
   - Update security procedures
   - Communicate with affected users if required

## Contact

For security-related questions:
- Email: security@example.com
- GitHub Security Advisories: Use the "Security" tab

---

Last updated: January 2024
