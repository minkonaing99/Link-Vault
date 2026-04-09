#!/usr/bin/env python3
import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.cookiejar import CookieJar


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import a Link Nest JSON export through the web API."
    )
    parser.add_argument("json_file", help="Path to a JSON export file")
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:3090",
        help="Base URL of the Link Nest site, for example https://links.merxy.club",
    )
    parser.add_argument("--username", required=True, help="Link Nest username")
    parser.add_argument("--password", required=True, help="Link Nest password")
    return parser.parse_args()


def build_opener():
    cookies = CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookies))


def request_json(opener, url, payload):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with opener.open(request) as response:
        return json.loads(response.read().decode("utf-8"))


def login(opener, base_url, username, password):
    return request_json(
        opener,
        urllib.parse.urljoin(base_url.rstrip("/") + "/", "api/login"),
        {"username": username, "password": password},
    )


def import_links(opener, base_url, links):
    return request_json(
        opener,
        urllib.parse.urljoin(base_url.rstrip("/") + "/", "api/links/import"),
        {"links": links},
    )


def load_links(path):
    with open(path, "r", encoding="utf-8") as handle:
        parsed = json.load(handle)
    links = parsed if isinstance(parsed, list) else parsed.get("links")
    if not isinstance(links, list):
        raise ValueError("Import file must contain an array or an object with a 'links' array")
    return links


def main():
    args = parse_args()
    opener = build_opener()

    try:
        links = load_links(args.json_file)
        login_result = login(opener, args.base_url, args.username, args.password)
        if not login_result.get("ok"):
            raise RuntimeError("Login failed")

        result = import_links(opener, args.base_url, links)
        print(json.dumps(result, indent=2))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"HTTP {error.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
