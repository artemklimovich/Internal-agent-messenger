# Security — what this repo must never contain

MAG Hive is a **self-hosted** panel. The GitHub tree is the product source, not a dump of a live swarm.

Do not commit:

- `.env`, `.data/`, `session-secret`, `hive.json`
- `hive_` / `hive_peer_` keys, MAG `X-Agent-Key`, user passwords
- WireGuard private keys, SSH keys, overlay maps of real machines
- Production hostnames, office PC names, Telegram tokens, OpenClaw `openclaw.json`

The first registered user on a **new** hub is admin. After that, registration stays closed unless you set `HIVE_ALLOW_REGISTER=1`. Keep the login page to the product name and one line of purpose — not your agent roster.

If a secret ever landed in git history, rotate it. Do not rely on deleting the file in a later commit.
