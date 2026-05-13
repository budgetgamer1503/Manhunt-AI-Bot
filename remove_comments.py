"""
remove_comments.py — Remove ALL comments from JavaScript files.
Handles: single-line // comments, multi-line /* */ comments, and JSDoc /** */ blocks.
Also removes blank lines left behind by deleted comments.

Usage:
    python remove_comments.py <file.js>              # Process a single file
    python remove_comments.py <directory>            # Process all .js files recursively
    python remove_comments.py <file.js> --dry-run    # Preview changes without writing
"""

import os
import sys
import argparse
import re


def remove_all_comments(content: str) -> str:
    """
    Remove all comments from JavaScript content:
    - Single-line // comments (whole-line and inline)
    - Multi-line /* */ comments
    - JSDoc /** */ blocks
    Does NOT touch comments inside string literals.
    Removes blank lines left behind.
    """
    result = []
    i = 0
    n = len(content)

    while i < n:
        # Check for string literals first (they may contain comment-like sequences)
        if content[i] in ("'", '"', '`'):
            string_content, i = extract_string(content, i)
            result.append(string_content)
            continue

        # Check for single-line comment //
        if i + 1 < n and content[i] == "/" and content[i + 1] == "/":
            # Skip to end of line
            while i < n and content[i] != "\n":
                i += 1
            # Skip the newline too
            if i < n and content[i] == "\n":
                i += 1
            continue

        # Check for multi-line comment /* ... */
        if i + 1 < n and content[i] == "/" and content[i + 1] == "*":
            # Find the closing */
            i += 2  # skip /*
            while i + 1 < n:
                if content[i] == "*" and content[i + 1] == "/":
                    i += 2  # skip */
                    break
                i += 1
            continue

        # Regular character — keep it
        result.append(content[i])
        i += 1

    # Join and clean up blank lines
    text = "".join(result)

    # Remove blank lines (lines that are empty or only whitespace)
    lines = text.split("\n")
    cleaned_lines = [line for line in lines if line.strip()]
    return "\n".join(cleaned_lines)


def extract_string(content: str, start: int):
    """
    Extract a string literal starting at content[start].
    Returns (string_content, new_index).
    Handles escape sequences and template literal nesting.
    """
    quote = content[start]
    result = [quote]
    i = start + 1

    while i < len(content):
        char = content[i]

        # Handle escape sequences
        if char == "\\":
            result.append(char)
            i += 1
            if i < len(content):
                result.append(content[i])
                i += 1
            continue

        # Template literals can contain ${...} with nested braces
        if quote == "`" and char == "$" and i + 1 < len(content) and content[i + 1] == "{":
            result.append("${")
            i += 2
            brace_depth = 1
            while i < len(content) and brace_depth > 0:
                c = content[i]
                if c == "{":
                    brace_depth += 1
                elif c == "}":
                    brace_depth -= 1
                elif c in ("'", '"', '`'):
                    nested, i = extract_string(content, i)
                    result.append(nested)
                    continue
                result.append(c)
                i += 1
            continue

        # Closing quote
        if char == quote:
            result.append(quote)
            return ("".join(result), i + 1)

        # Handle newlines in strings (template literals can have them)
        result.append(char)
        i += 1

    # Unterminated string — return what we have
    return ("".join(result), i)


def process_file(filepath: str, dry_run: bool = False) -> bool:
    """Process a single .js file. Returns True if changes were made."""
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            original = f.read()

        cleaned = remove_all_comments(original)

        if cleaned == original:
            print(f"  [NO CHANGE] {filepath}")
            return False

        if dry_run:
            print(f"  [DRY RUN]   {filepath} — would remove comments")
            orig_lines = len(original.split("\n"))
            clean_lines = len(cleaned.split("\n"))
            print(f"               {orig_lines} -> {clean_lines} lines ({orig_lines - clean_lines} removed)")
            return True

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(cleaned)

        print(f"  [CLEANED]   {filepath}")
        return True

    except Exception as e:
        print(f"  [ERROR]     {filepath}: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description="Remove ALL comments (// and /* */) from JavaScript files."
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