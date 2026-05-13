"""
add_copyright.py — Add copyright header comment to all JavaScript files.

Usage:
    python add_copyright.py <file.js>              # Process a single file
    python add_copyright.py <directory>            # Process all .js files recursively
    python add_copyright.py <file.js> --dry-run    # Preview changes without writing
"""

import os
import sys
import argparse

COPYRIGHT_HEADER = """/*
 * (c) 2026 BUDGETGAMER1503. All Rights Reserved.
 * Unauthorized reproduction or distribution is strictly prohibited.
 */"""


def has_copyright(content: str) -> bool:
    """Check if the file already has a copyright header."""
    stripped = content.lstrip()
    return stripped.startswith("/*") and "BUDGETGAMER1503" in stripped[:200]


def add_copyright(content: str) -> str:
    """Add copyright header to the beginning of the file content."""
    stripped = content.lstrip()

    # If file already has a copyright, don't add another
    if has_copyright(content):
        return content

    # Preserve any shebang line
    if stripped.startswith("#!"):
        lines = content.split("\n", 1)
        shebang = lines[0]
        rest = lines[1] if len(lines) > 1 else ""
        return shebang + "\n\n" + COPYRIGHT_HEADER + "\n\n" + rest.lstrip()

    return COPYRIGHT_HEADER + "\n\n" + stripped


def process_file(filepath: str, dry_run: bool = False) -> bool:
    """Process a single .js file. Returns True if changes were made."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            original = f.read()

        if has_copyright(original):
            print(f"  [SKIP]      {filepath} — already has copyright")
            return False

        modified = add_copyright(original)

        if dry_run:
            print(f"  [DRY RUN]   {filepath} — would add copyright header")
            return True

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(modified)

        print(f"  [ADDED]     {filepath}")
        return True

    except Exception as e:
        print(f"  [ERROR]     {filepath}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Add copyright header comment to JavaScript files."
    )
    parser.add_argument(
        "path",
        help="Path to a .js file or directory containing .js files"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to files"
    )
    args = parser.parse_args()

    target = os.path.abspath(args.path)

    if not os.path.exists(target):
        print(f"Error: Path does not exist: {target}")
        sys.exit(1)

    files_to_process = []

    if os.path.isfile(target):
        if target.endswith(".js"):
            files_to_process.append(target)
        else:
            print(f"Error: Not a .js file: {target}")
            sys.exit(1)
    else:
        for root, dirs, filenames in os.walk(target):
            dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
            for filename in filenames:
                if filename.endswith(".js"):
                    files_to_process.append(os.path.join(root, filename))

    if not files_to_process:
        print("No .js files found.")
        return

    print(f"\nProcessing {len(files_to_process)} file(s)...")
    if args.dry_run:
        print("(DRY RUN — no files will be modified)\n")

    changed = 0
    for filepath in files_to_process:
        if process_file(filepath, args.dry_run):
            changed += 1

    print(f"\nDone. {changed}/{len(files_to_process)} file(s) modified.")


if __name__ == "__main__":
    main()