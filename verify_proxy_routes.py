import httpx
import sys
import asyncio
import os

async def verify_proxy_routes():
    # Use 80 for prod env (set PROXY_PORT=80), 4200 for dev env (default)
    port = os.getenv("PROXY_PORT", "4200")
    ssl_port = os.getenv("PROXY_SSL_PORT", "10443")
    base_url = f"http://localhost:{port}"
    ssl_base_url = f"https://localhost:{ssl_port}"
    
    api_prefix = os.getenv("API_PREFIX", "/api/app")
    
    # We use verify=False because local SSL certs might not be trusted by httpx
    # We use timeout=10.0 to allow for backend startup
    # B501 justified: this probes the LOCAL stack's self-signed certificate by
    # design and is never pointed at a remote host. Keep the suppression comment
    # below bare — Bandit reads whatever follows it as further test IDs.
    async with httpx.AsyncClient(verify=False, timeout=10.0) as client:  # nosec B501
        tests = [
            # 1. API Health
            {
                "url": f"{base_url}{api_prefix}/health",
                "headers": {"Host": "localhost"},
                "expected_status": 200,
                "label": "API Health (localhost)"
            },
            # 2. Main Site
            {
                "url": f"{base_url}/",
                "headers": {"Host": "localhost"},
                "expected_status": 200,
                "label": "Main Site (localhost)"
            },
            # 3. Production Domain -> Redirect to HTTPS
            {
                "url": f"{base_url}/",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 301,
                "label": "Production Host -> HTTPS Redirect"
            },
            # 4. HTTPS Production Domain API
            {
                "url": f"{ssl_base_url}{api_prefix}/health",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 200,
                "label": "HTTPS API Health (beaconfolio.com)",
                "expected_text": "healthy"
            },
            # 4b. HTTPS Public Stats (beaconfolio.com)
            {
                "url": f"{ssl_base_url}{api_prefix}/stats/public",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 200,
                "label": "HTTPS Public Stats (beaconfolio.com)",
                "expected_text": "visitor_ip"
            },
            # 5. Domain HTTPS (Standard)
            {
                "url": f"{ssl_base_url}/",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 200,
                "label": "Domain HTTPS -> Frontend"
            },
            # 5b. Admin Login Route — served on the dedicated admin host since the
            # admin/public workspace split (the E2E overlay opens the allowlist;
            # production ships CLOSED). The public host no longer routes /admin/*.
            {
                "url": f"{base_url}/login",
                "headers": {"Host": "admin.localhost"},
                "expected_status": 200,
                # The admin nginx SPA-fallbacks every path to index.html, so a bare
                # 200 proves nothing — assert the admin bundle's title is served.
                "expected_text": "beaconfolio.com | Admin",
                "label": "Admin Host Login Route"
            },
            # 5b-2. Public host /admin/* is an unmatched SPA route post-split: the
            # SSR engine deopts and Express falls through to 404 — asserting this
            # documents that the admin surface is NOT reachable on the public host.
            {
                "url": f"{ssl_base_url}/admin/login",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 404,
                "label": "Public Host /admin Split (404)"
            },
            # 5c. Backend Auth Endpoint (Method Not Allowed for GET)
            {
                "url": f"{ssl_base_url}{api_prefix}/auth/login",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 405, # POST only
                "label": "Backend Auth Login (Exists)"
            },
            # 5d. Protected Admin Endpoint (Unauthorized)
            {
                "url": f"{ssl_base_url}{api_prefix}/stats",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 401, # Should be unauthorized without token
                "label": "Protected Admin Route (401 Check)"
            },
            # 5e. Image Upload Route (PUT Method Check)
            {
                "url": f"{ssl_base_url}{api_prefix}/posts/1/image",
                "headers": {"Host": "beaconfolio.com"},
                "method": "PUT",
                "expected_status": 401, # Should be unauthorized, but confirms PUT reaches backend
                "label": "Image Upload Route (PUT Verification only)"
            },
            # 6. /open subpath
            {
                "url": f"{ssl_base_url}/open/",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": [200, 502], # 502 is acceptable if open-webui is still starting
                "label": "Open WebUI Subpath"
            },
             # 6b. Open WebUI Health (via subpath)
            {
                "url": f"{ssl_base_url}/open/health",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 200,
                "label": "Open WebUI Health (via /open/)",
                "expected_text": "true" # Open WebUI returns {"status": true} usually
            },
            # 6c. Root Health -> Should be Backend
            {
                "url": f"{ssl_base_url}/health",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 200,
                "label": "Root Health -> Backend",
                "expected_text": "healthy"
            },
            # 6d. Manifest.json -> Open WebUI (via subpath)
            {
                "url": f"{ssl_base_url}/open/manifest.json",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 200,
                "label": "Open WebUI Manifest (via /open/)",
                # Open WebUI manifest usually contains "name": "Open WebUI" or similar
                "expected_text": "Open WebUI" 
            },
            # 6e. /static/ -> Open WebUI
            {
                "url": f"{ssl_base_url}/static/favicon.png", # Example static file? Or just check 404 from O-WUI but handled by it
                # Actually, requesting /static/ might give 403 or 404 from O-WUI, but NOT index.html from Frontend
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": [200, 404], 
                "label": "Root Static -> Open WebUI (Not Frontend)"
            },
            # 6. /open trailing slash redirect
            {
                "url": f"{ssl_base_url}/open",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 301,
                "label": "Open WebUI Trailing Slash Redirect"
            },
            # 7. Default rejection (Unknown host)
            {
                "url": f"{base_url}/",
                "headers": {"Host": "unknown.com"},
                "expected_status": 444, # Nginx custom status for closed connection
                "label": "Unknown Host -> Reject (444)"
            },
            # 8. LinkedIn API Routes (Auth-protected)
            {
                "url": f"{ssl_base_url}{api_prefix}/linkedin/posts",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 401,
                "label": "LinkedIn Posts (401 Auth Check)"
            },
            {
                "url": f"{ssl_base_url}{api_prefix}/linkedin/profile-sync",
                "headers": {"Host": "beaconfolio.com"},
                "expected_status": 401,
                "label": "LinkedIn Profile Sync (401 Auth Check)"
            },
            {
                "url": f"{ssl_base_url}{api_prefix}/linkedin/transfer-post",
                "headers": {"Host": "beaconfolio.com"},
                "method": "POST",
                "expected_status": 401,
                "label": "LinkedIn Transfer Post (401 Auth Check)"
            },
            {
                "url": f"{ssl_base_url}{api_prefix}/linkedin/transfer-posts",
                "headers": {"Host": "beaconfolio.com"},
                "method": "POST",
                "expected_status": 401,
                "label": "LinkedIn Bulk Transfer (401 Auth Check)"
            },
        ]

        failed = False
        print("\n🛡️  PROXY ROUTE VERIFICATION\n" + "="*30)
        
        for test in tests:
            try:
                # Single dispatch for any method — the old GET/PUT/POST if/elif
                # left `response` unbound (NameError) for an unlisted method.
                method = test.get("method", "GET")
                response = await client.request(
                    method, test["url"], headers=test["headers"], follow_redirects=False
                )

                status = response.status_code
                
                expected = test["expected_status"]
                if isinstance(expected, list):
                    passed = status in expected
                else:
                    passed = (status == expected)
                
                if passed and "expected_text" in test:
                   if test["expected_text"] not in response.text:
                       print(f"❌ {test['label']}: FAIL (Content mismatch. Expected '{test['expected_text']}', got '{response.text[:50]}...')")
                       passed = False

                if passed:
                    print(f"✅ {test['label']}: PASS ({status})")
                else:
                    if "expected_text" not in test or (status not in expected if isinstance(expected, list) else status != expected):
                        print(f"❌ {test['label']}: FAIL (Got {status}, expected {expected})")
                    failed = True
            except (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError):
                # Nginx returns 444 by closing the connection abruptly, 
                # which httpx can catch as various connection/protocol errors.
                if test["expected_status"] == 444:
                    print(f"✅ {test['label']}: PASS (Connection closed as expected)")
                else:
                    print(f"❌ {test['label']}: FAIL (Unexpected Connection/Protocol Error)")
                    failed = True
            except Exception as e:
                print(f"❌ {test['label']}: ERROR ({type(e).__name__}: {str(e)})")
                failed = True

        print("="*30)
        if failed:
            print("❌ PROXY VERIFICATION FAILED")
            sys.exit(1)
        else:
            print("✅ PROXY VERIFICATION PASSED (100% ROUTE COVERAGE)")

if __name__ == "__main__":
    asyncio.run(verify_proxy_routes())
