# Authentik SSO/OAuth Implementation Guide for ATLAS PWA

## Executive Summary
Comprehensive guide for implementing SSO/OAuth authentication using authentik for ATLAS PWA, replacing PIN-based login. Covers authentik capabilities, installation, PWA integration patterns, n8n backend authentication, and migration strategies.

## Key Findings

### What is Authentik?
- Open-source Identity Provider (MIT license) for modern SSO
- Supports SAML, OAuth2/OIDC, LDAP, RADIUS
- Self-hosting from home labs to production
- Active development: 476+ contributors, 20,000+ commits
- Modern architecture: Python (52%), TypeScript (32.2%), Go (4.2%)

### For ATLAS PWA Implementation
**Perfect fit because:**
- Self-hosted deployment on existing VPS
- Lightweight requirements (2-4 CPU, 4-8GB RAM)
- Native OAuth/OIDC with PKCE for browser-based apps
- Cross-device session support with refresh tokens
- Docker Compose deployment alongside n8n

### Cross-Device Solution
**Current:** Each device = separate session_id (localStorage)
**With Authentik:** User logs in → user_id based sessions → conversation history follows across devices

**Flow:**
1. Login on JoJo → token tied to user_id "david@example.com"
2. Login on Skynet → same user_id → **continues same conversation**
3. CORTEX indexes by user_id instead of random UUID

### Migration Path
1. **Phase 1 (2-4 weeks):** Dual auth - keep PIN, add SSO button
2. **Phase 2 (2-4 weeks):** Account linking - migrate PIN data to SSO
3. **Phase 3 (2-4 weeks):** SSO primary - PIN becomes fallback
4. **Phase 4 (2-4 weeks):** Deprecation notice for PIN users
5. **Phase 5:** Remove PIN code entirely

## Technical Implementation

### Docker Compose Deployment
```yaml
services:
  postgresql:
    image: postgres:12-alpine
    volumes:
      - database:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: ${PG_PASS}
      POSTGRES_USER: authentik
      POSTGRES_DB: authentik

  server:
    image: ghcr.io/goauthentik/server:2024.12.0
    command: server
    ports:
      - "9000:9000"
      - "9443:9443"
    depends_on:
      - postgresql
      - redis

  worker:
    image: ghcr.io/goauthentik/server:2024.12.0
    command: worker
    depends_on:
      - postgresql
      - redis

  redis:
    image: redis:alpine
    volumes:
      - redis:/data
```

### PWA Integration (PKCE Flow)
**Why PKCE:** Authorization Code Flow with PKCE is OAuth 2.0 standard for browser apps that can't securely store secrets.

**JavaScript Implementation:**
```typescript
import { UserManager } from 'oidc-client-ts';

const config = {
  authority: 'https://authentik.yourdomain.com/application/o/atlas-pwa/',
  client_id: 'atlas-pwa-client-id',
  redirect_uri: 'https://atlas.yourdomain.com/callback',
  response_type: 'code',
  scope: 'openid profile email offline_access',
  automaticSilentRenew: true,
};

const userManager = new UserManager(config);

// Auth service
export const authService = {
  login: () => userManager.signinRedirect(),
  logout: () => userManager.signoutRedirect(),
  getUser: () => userManager.getUser(),
  getAccessToken: async () => {
    const user = await userManager.getUser();
    return user?.access_token;
  },
};
```

### n8n Backend Integration
**Token Validation in n8n Code Node:**
```javascript
const token = $input.first().headers.authorization?.replace('Bearer ', '');

if (!token) {
  throw new Error('No authorization token');
}

// Validate with authentik
const response = await this.helpers.httpRequest({
  method: 'GET',
  url: 'https://authentik.yourdomain.com/application/o/userinfo/',
  headers: { 'Authorization': `Bearer ${token}` },
});

return { user: response };
```

### User Identification for Conversations
```typescript
// Get consistent user ID from authentik
async function getUserId(): Promise<string> {
  const user = await authService.getUser();
  return user?.profile.sub || '';
}

// Save conversations with user ID
async function saveConversation(messages: Message[]) {
  const userId = await getUserId();
  await callN8nWorkflow('save-conversation', {
    userId,  // Instead of random session_id
    messages,
    timestamp: new Date().toISOString(),
  });
}
```

## Security Best Practices

### Token Storage Hierarchy
1. **Browser Memory + Web Workers** (Most Secure) - XSS protected
2. **sessionStorage** (Moderate) - Cleared on tab close
3. **localStorage** (Least Secure) - Avoid for tokens

**Recommendation:** Use sessionStorage with silent token renewal

### Silent Token Renewal
```html
<!-- silent-renew.html -->
<script src="oidc-client-ts.min.js"></script>
<script>
  new oidc.UserManager({ response_mode: 'query' })
    .signinSilentCallback()
    .catch(err => console.error('Silent renew error:', err));
</script>
```

### Logout Flow
```typescript
async function fullLogout() {
  // 1. Clear local state
  localStorage.clear();
  sessionStorage.clear();
  
  // 2. Revoke tokens (optional)
  const user = await userManager.getUser();
  if (user?.access_token) {
    await fetch('https://authentik.yourdomain.com/application/o/revoke/', {
      method: 'POST',
      body: `token=${user.access_token}&client_id=atlas-pwa-client-id`,
    });
  }
  
  // 3. Redirect to authentik logout
  await userManager.signoutRedirect();
}
```

## Multi-Device Session Handling

### Authentik Session Configuration
- Session duration: Configurable (default: browser close, optional: 30 days)
- "Stay signed in" option for extended sessions
- Device recognition via cookies and IP tracking
- Session binding to networks/GeoIP (security feature)

### Recommended Settings
**OAuth2 Provider:**
- Access token validity: 5-15 minutes (short-lived)
- Refresh token validity: 30 days
- Enable `offline_access` scope

**User Login Stage:**
- Session duration: `days=30`
- Stay signed in offset: `days=90`
- Enable "Remember me" functionality

## Comparison with Alternatives

| Feature | Authentik | Keycloak | Auth0 |
|---------|-----------|----------|-------|
| License | MIT (Open) | Apache 2.0 | Proprietary |
| Self-Hosted | ✅ Yes | ✅ Yes | ❌ No |
| Setup Complexity | Low-Medium | High | Low (Managed) |
| Resources | 2-4 CPU, 4-8GB | High | N/A |
| Cost | Free | Free | Free tier → Paid |
| UI/UX | Modern | Dated | Modern |
| Best For | Small-Medium, Home lab | Enterprise | SaaS, Quick |

**Verdict:** Authentik recommended for ATLAS PWA due to open source, low resources, modern UI, and self-hosting capability.

## Implementation Checklist

### Infrastructure
- [ ] Deploy authentik (Docker Compose)
- [ ] Configure DNS and SSL/TLS
- [ ] Set up PostgreSQL and Redis
- [ ] Create admin account

### Authentik Configuration
- [ ] Create OAuth2/OIDC provider (Public client)
- [ ] Configure redirect URIs
- [ ] Enable offline_access scope
- [ ] Set token lifetimes and session duration

### PWA Integration
- [ ] Install oidc-client-ts
- [ ] Implement login/logout flows
- [ ] Add callback page
- [ ] Implement silent renewal
- [ ] Test multi-browser/device

### n8n Backend
- [ ] Create token validation workflow
- [ ] Update API endpoints for auth
- [ ] Migrate user_id storage

### Migration
- [ ] Build account linking workflow
- [ ] Create data migration scripts
- [ ] Test migration process
- [ ] Prepare user documentation

## Common Pitfalls

1. **CORS Configuration:** Add `AUTHENTIK_CORS__ALLOWED_ORIGINS`
2. **Redirect URI Mismatch:** Exact match required (trailing slashes!)
3. **Token Expiry:** Handle with silent renewal + graceful re-login
4. **PWA Service Worker:** Exclude auth endpoints from caching
5. **Mobile Safari:** Stricter cookie policies, test on real devices
6. **Version Pinning:** Always pin authentik version (e.g., `2024.12.0`)
7. **offline_access Scope:** Must explicitly configure in provider (authentik 2024.2+)

## Resources

- Official Docs: https://docs.goauthentik.io/
- GitHub: https://github.com/goauthentik/authentik
- oidc-client-ts: https://github.com/authts/oidc-client-ts
- Docker Compose Guide: https://version-2025-4.goauthentik.io/docs/install-config/install/docker-compose
- OAuth Best Practices: https://www.oauth.com/oauth2-servers/single-page-apps/

## Next Steps for ATLAS PWA

1. **Deploy authentik on VPS** (100.73.59.40 alongside n8n)
2. **Create OAuth provider** with PKCE support
3. **Integrate oidc-client-ts** in PWA frontend
4. **Update n8n workflows** for token validation
5. **Implement dual authentication** (PIN + SSO)
6. **Migrate existing sessions** to user_id based storage
7. **Test cross-device continuity**
8. **Gradually deprecate PIN** over 8-12 weeks

**Status:** Research complete, ready for implementation planning.
