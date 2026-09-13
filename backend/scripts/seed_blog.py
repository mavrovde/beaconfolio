import json
import os
import sys
import urllib.error
import urllib.request

# Constants - use container-internal URL by default
API_URL_BASE = os.getenv("API_URL", "http://backend:8000/api")
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASS", "admin")

# API_URL comes from the environment, and urllib honours whatever scheme it is
# given — including file:// and ftp://, which would make these "HTTP" calls read
# the local filesystem instead (Bandit B310). Pin the scheme once, here, so both
# call sites below are covered by construction rather than by a suppression.
if not API_URL_BASE.startswith(("http://", "https://")):
    sys.exit(f"API_URL must be an http(s) URL, got: {API_URL_BASE!r}")


def get_auth_token():
    print(f"Authenticating as {ADMIN_USER}...")
    login_url = f"{API_URL_BASE}/auth/login"

    # OAuth2PasswordRequestForm expects form-data
    data = urllib.parse.urlencode(
        {"username": ADMIN_USER, "password": ADMIN_PASS}
    ).encode("utf-8")

    req = urllib.request.Request(login_url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        # scheme pinned to http(s) at import time above
        with urllib.request.urlopen(req) as response:  # nosec B310
            res_data = json.loads(response.read().decode())
            print("Successfully authenticated.")
            return res_data["access_token"]
    except Exception as e:
        print(f"Authentication failed: {e}")
        if isinstance(e, urllib.error.HTTPError):
            print(f"Error detail: {e.read().decode()}")
        sys.exit(1)


def seed_posts():
    token = get_auth_token()

    # Path to static blog data (now local)
    base_dir = "."
    files = {"en": "blog_data_en.json", "de": "blog_data_de.json"}

    script_dir = os.path.dirname(os.path.abspath(__file__))

    for lang, filename in files.items():
        path = os.path.join(script_dir, base_dir, filename)
        if not os.path.exists(path):
            print(f"File not found: {path}")
            continue

        print(f"Seeding {lang} posts from {filename}...")
        with open(path, "r", encoding="utf-8") as f:
            posts = json.load(f)

        for post_data in posts:
            payload = {
                "title": post_data["title"],
                "slug": post_data["id"],
                "content": post_data["content"],
                "summary": post_data["summary"],
                "language": lang,
                "published": True,
            }

            data = json.dumps(payload).encode("utf-8")
            create_url = f"{API_URL_BASE}/posts"
            req = urllib.request.Request(create_url, data=data, method="POST")
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Bearer {token}")

            try:
                # scheme pinned to http(s) at import time above
                with urllib.request.urlopen(req):  # nosec B310
                    print(f"Successfully seeded: {post_data['id']} ({lang})")
            except urllib.error.HTTPError as e:
                if e.code in [400, 409]:
                    print(f"Post {post_data['id']} ({lang}) already exists (skipped).")
                else:
                    print(
                        f"HTTP Error seeding {post_data['id']} ({lang}): {e.code} - {e.read().decode()}"
                    )
            except Exception as e:
                print(f"Error seeding {post_data['id']} ({lang}): {e!s}")


if __name__ == "__main__":
    import urllib.parse

    seed_posts()
