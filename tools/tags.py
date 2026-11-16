#!/usr/bin/env python3
"""
Check the tags of Håg's separately tagged files.

Some files in dist/ are loaded with a tag of their own, written where
they're loaded: './core/colors.js?v=1'. Home Assistant tells browsers to
keep a file for a month under an unchanged address, so a file that
changes needs a new tag, or displays keep the old file.

This compares each tagged file with tools/tags.json (its tag and SHA-256
when last recorded) and fails when:

- a file changed and its tag didn't: raise the number where it's loaded
  (never reuse an old one);
- a file or its tag changed and tags.json doesn't say so yet: --update;
- one file is loaded with two different tags (it would load twice);
- a tagged file is missing.

    python3 tools/tags.py            check
    python3 tools/tags.py --update   record the tags and files as they are

Standard library only. Not part of the plugin install.
"""

import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
LIST = ROOT / "tools" / "tags.json"
# A relative address with a tag, in quotes: './core/colors.js?v=1'.
TAGGED = re.compile(r"""(['"`])(\.{1,2}/[^'"`?\s]+)\?v=([\w.-]+)\1""")


def loaded():
    """Every tagged file: { path: { tag: [where it's loaded] } }."""
    found = {}
    for source in sorted((ROOT / "dist").rglob("*.js")):
        for number, line in enumerate(source.read_text(encoding="utf-8").splitlines(), 1):
            for _, address, tag in TAGGED.findall(line):
                path = (source.parent / address).resolve().relative_to(ROOT).as_posix()
                where = f"{source.relative_to(ROOT).as_posix()}:{number}"
                found.setdefault(path, {}).setdefault(tag, []).append(where)
    return found


def main():
    update = "--update" in sys.argv[1:]
    recorded = json.loads(LIST.read_text(encoding="utf-8")) if LIST.exists() else {}
    now, problems, stale = {}, [], []

    for path, tags in sorted(loaded().items()):
        where = ", ".join(w for places in tags.values() for w in places)
        if len(tags) > 1:
            problems.append(f"{path} is loaded with different tags ({', '.join(sorted(tags))}): {where}")
            continue
        tag = next(iter(tags))
        file = ROOT / path
        if not file.is_file():
            problems.append(f"{path} is missing (loaded at {where})")
            continue
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        now[path] = {"tag": tag, "sha256": digest}
        was = recorded.get(path)
        if was and was["sha256"] != digest and was["tag"] == tag:
            problems.append(f"{path} changed but its tag is still {tag}: raise it at {where}")
        elif was != now[path]:
            stale.append(f"{path}: {'new' if not was else 'tag ' + was['tag'] + ' to ' + tag}")
        else:
            print(f"ok   {path}  v={tag}")
    stale += [f"{path}: no longer loaded with a tag" for path in recorded if path not in now]

    for line in problems:
        print(f"FAIL {line}")
    if problems:
        return 1
    if stale and not update:
        for line in dict.fromkeys(stale):
            print(f"FAIL {line} (not recorded: run with --update)")
        return 1
    if update:
        LIST.write_text(json.dumps(now, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        for line in dict.fromkeys(stale):
            print(f"recorded  {line}")
    print(f"{len(now)} tagged file(s) in step with tools/tags.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
