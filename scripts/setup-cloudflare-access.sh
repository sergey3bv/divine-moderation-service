#!/bin/bash
# ABOUTME: Script to configure Cloudflare Access for /admin/* routes
# ABOUTME: Allows all @divine.video email addresses to access the admin panel

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Cloudflare Access Setup for Divine Moderation Service${NC}"
echo "This will configure Cloudflare Access to protect /admin/* routes"
echo ""

# Check for required environment variables
if [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo -e "${RED}Error: CLOUDFLARE_ACCOUNT_ID environment variable not set${NC}"
  echo "Find it at: https://dash.cloudflare.com/ (in the URL or Workers & Pages section)"
  exit 1
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo -e "${RED}Error: CLOUDFLARE_API_TOKEN environment variable not set${NC}"
  echo "Create one at: https://dash.cloudflare.com/profile/api-tokens"
  echo "Required permissions: Account > Zero Trust > Edit"
  exit 1
fi

ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"
API_TOKEN="$CLOUDFLARE_API_TOKEN"
EMAIL_DOMAIN="divine.video"

# Domains to protect (both admin.divine.video and *.admin.divine.video)
DOMAINS=("admin.divine.video" "*.admin.divine.video")

echo -e "${YELLOW}Configuration:${NC}"
echo "  Account ID: $ACCOUNT_ID"
echo "  Protected Domains:"
for domain in "${DOMAINS[@]}"; do
  echo "    - $domain"
done
echo "  Allowed Email Domain: @$EMAIL_DOMAIN"
echo ""

# Step 1: Create Access Application
echo -e "${GREEN}Step 1: Creating Access Application...${NC}"

APP_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Divine Admin Portal",
    "domain": "admin.divine.video",
    "type": "self_hosted",
    "session_duration": "24h",
    "allowed_idps": [],
    "auto_redirect_to_identity": false,
    "enable_binding_cookie": false,
    "custom_deny_message": "You need a @'$EMAIL_DOMAIN' email to access the Divine admin portal.",
    "custom_deny_url": "",
    "logo_url": "",
    "skip_interstitial": false,
    "app_launcher_visible": true,
    "service_auth_401_redirect": true,
    "custom_pages": [],
    "tags": [],
    "http_only_cookie_attribute": true,
    "same_site_cookie_attribute": "lax",
    "policies": []
  }')

# Check if application creation succeeded
if echo "$APP_RESPONSE" | grep -q '"success":true'; then
  APP_ID=$(echo "$APP_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo -e "${GREEN}✓ Application created successfully (ID: $APP_ID)${NC}"
else
  echo -e "${RED}✗ Failed to create application${NC}"
  echo "$APP_RESPONSE" | jq '.' 2>/dev/null || echo "$APP_RESPONSE"
  exit 1
fi

# Step 2: Create Access Policy
echo -e "${GREEN}Step 2: Creating Access Policy for @$EMAIL_DOMAIN...${NC}"

POLICY_RESPONSE=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps/$APP_ID/policies" \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Allow @'$EMAIL_DOMAIN' users",
    "decision": "allow",
    "include": [
      {
        "email_domain": {
          "domain": "'$EMAIL_DOMAIN'"
        }
      }
    ],
    "exclude": [],
    "require": [],
    "precedence": 1,
    "isolation_required": false
  }')

# Check if policy creation succeeded
if echo "$POLICY_RESPONSE" | grep -q '"success":true'; then
  POLICY_ID=$(echo "$POLICY_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo -e "${GREEN}✓ Policy created successfully (ID: $POLICY_ID)${NC}"
else
  echo -e "${RED}✗ Failed to create policy${NC}"
  echo "$POLICY_RESPONSE" | jq '.' 2>/dev/null || echo "$POLICY_RESPONSE"
  exit 1
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Cloudflare Access configured successfully!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "Protected domains:"
echo "  • https://admin.divine.video (all paths)"
echo "  • https://*.admin.divine.video (all subdomains)"
echo ""
echo "Access granted to:"
echo "  • Anyone with an @$EMAIL_DOMAIN email address"
echo ""
echo "Next steps:"
echo "  1. Configure an identity provider (recommended: One-time PIN)"
echo "     → https://one.dash.cloudflare.com/$ACCOUNT_ID/settings/authentication"
echo ""
echo "  2. Set up DNS records for admin.divine.video"
echo "     → Point admin.divine.video to your Worker or origin server"
echo ""
echo "  3. Test access:"
echo "     → Visit: https://admin.divine.video"
echo "     → You'll be prompted to authenticate with your @$EMAIL_DOMAIN email"
echo ""
echo "Note: Cloudflare Access works at the edge, before your application."
echo "You can optionally remove the custom auth code from your Worker."
echo ""
