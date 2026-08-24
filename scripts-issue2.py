import json, urllib.request, os
tok = os.environ["GH_OAUTH"]
req = urllib.request.Request("https://api.github.com/user")
req.add_header("Authorization", "Bearer " + tok)
req.add_header("User-Agent", "issue-cli")
d = json.load(urllib.request.urlopen(req))
print("login:", d["login"])
