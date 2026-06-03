# SCRUB-STEPS — purge the coordinator password from git history

**DO NOT RUN any of this until you have rotated the coordinator password in Supabase.**

## Context (why order matters)
- The string `SiB-coord-2026` is present in this repo's **git history** (commit `17ba215`), not in the current working tree.
- The remote `origin` is **https://github.com/ysaadaldin08/SiB.git** and the repo is **PUBLIC**, and that commit is already pushed (`origin/master`).
- Because it has been public, **rotation is mandatory and comes first.** A history rewrite only stops *future* reads — assume the old value is already cloned/cached/forked. Scrubbing is cleanup, not a fix on its own.

## Step 0 — Prerequisite (do this first, outside this file)
1. Rotate the coordinator account password in the Supabase dashboard
   (Authentication → Users → coordinator account → Reset password), in the **canonical** project.
2. Confirm login still works with the new password.
3. Only then proceed below.

## Step 1 — Back up first
```bash
# A throwaway safety copy of the whole repo (including .git) before rewriting history.
cd ..
cp -r SiB SiB-backup-before-scrub
cd SiB
```

## Step 2 — Rewrite history (pick ONE tool)

### Option A — git-filter-repo (recommended; modern, fast)
```bash
# Install once:  pip install git-filter-repo   (or: winget install --id GitHub.git-filter-repo)

# Create a replacements file. Each line: <literal>==><replacement>
printf 'SiB-coord-2026==>***REMOVED***\n' > ../scrub-replacements.txt

# Rewrite every blob across all refs:
git filter-repo --replace-text ../scrub-replacements.txt --force

# filter-repo removes 'origin' as a safety measure — re-add it:
git remote add origin https://github.com/ysaadaldin08/SiB.git
```

### Option B — BFG Repo-Cleaner (matches the SECURITY.md PAF-1 notes)
```bash
# Requires Java + bfg.jar (https://rtyley.github.io/bfg-repo-cleaner/)
# Create a password list (one secret per line):
printf 'SiB-coord-2026\n' > passwords.txt        # NOTE: this is the BFG input list, keep it out of commits

# Operate on a fresh mirror clone, then push back:
cd ..
git clone --mirror https://github.com/ysaadaldin08/SiB.git sib.git
java -jar bfg.jar --replace-text passwords.txt sib.git
cd sib.git
git reflog expire --expire=now --all && git gc --prune=now --aggressive
```

## Step 3 — Verify the secret is gone from history
```bash
git log -p --all -S 'SiB-coord-2026' | head     # must print NOTHING
git grep -n 'SiB-coord-2026' $(git rev-list --all) | head   # must print NOTHING
```

## Step 4 — Force-push the rewritten history
```bash
# This overwrites the public remote. Coordinate first if anyone else has a clone.
git push origin --force --all
git push origin --force --tags
```
(If you used Option B's mirror: `cd sib.git && git push --force` then re-clone a working copy.)

## Step 5 — After the force-push
- Anyone with an existing clone must **delete it and re-clone** (their local history still has the secret and a normal `git pull` will conflict).
- The old commit SHAs may still be reachable via GitHub's cache or forks for a while. If this is sensitive, you can ask GitHub Support to purge cached views — but the rotated password is what actually closes the exposure.
- Delete the backup (`SiB-backup-before-scrub`) and the replacements/`passwords.txt` files once you've confirmed everything works.

## Reminder
The pre-commit gitleaks hook (`.githooks/pre-commit` + `.gitleaks.toml`) prevents *new* secrets from being committed going forward. Activate it with `git config core.hooksPath .githooks` after installing gitleaks.
