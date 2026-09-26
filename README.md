# EvoMC Manager

EvoMC Manager is a Discord moderation bot with both dot-prefix and slash commands, persistent SQLite warnings, native Discord role color styling, and a Minecraft Java server status message that is edited in place every 30 seconds.

## Run locally

Requirements: Node.js 22 or newer and npm.

```sh
cp .env.example .env
# Fill in DISCORD_TOKEN and CLIENT_ID in .env.
npm install
npm run build
npm run deploy-commands
npm start
```

The bot listens on `PORT` (default `3000`). `GET /health` returns HTTP 200 with the body `OK`. The same endpoint can be monitored with UptimeRobot:

```text
https://YOUR-RENDER-SERVICE.onrender.com/health
```

## Discord application setup

1. Create an application in the Discord Developer Portal.
2. Open its **Bot** page and create a bot user.
3. Copy the bot token and set it as `DISCORD_TOKEN`. Never commit the token or paste it into chat.
4. Copy the Application ID from **General Information** and set it as `CLIENT_ID`.
5. Under **Bot > Privileged Gateway Intents**, enable **Message Content Intent** for dot-prefix commands and **Server Members Intent** for member lookup and role operations.
6. Invite the bot with the `bot` and `applications.commands` OAuth scopes. The `.invite` command creates a link with the permissions this bot uses.
7. Give the bot only the permissions it needs: View Channels, Send Messages, Read Message History, Ban Members, Kick Members, Moderate Members, Manage Messages, Manage Roles, Manage Channels, and Manage Nicknames.
8. Move the bot's highest role above every role it must assign or moderate. Discord will reject moderation or role changes above the bot's top role.
9. Register slash commands with `npm run deploy-commands`. The Render Blueprint runs this as a pre-deploy step; global Discord commands can take time to appear after first registration.

## Commands

Every command below also has a slash-command equivalent. Prefix defaults to `.` and can be changed with `PREFIX`.

### General

- `.serverinfo`
- `.userinfo [user]`
- `.avatar [user]`
- `.roleinfo <role>`
- `.channelinfo [channel]`

### Moderation

- `.ban <user> [reason]`
- `.unban <userId> [reason]`
- `.kick <user> [reason]`
- `.timeout <user> <duration> [reason]`
- `.untimeout <user> [reason]`
- `.mute <user> [duration] [reason]` (defaults to 1 hour)
- `.unmute <user>`
- `.warn <user> <reason>`
- `.unwarn <warningId> [user]`
- `.warnings [user]`
- `.clearwarnings <user>` (clears warnings for that user only)
- `.purge <1-100>`
- `.purgebots [1-100]`
- `.purgeuser <user> [1-100]`
- `.purgeafter <messageId>`
- `.slowmode <0-21600>`
- `.lock [channel]`
- `.unlock [channel]`
- `.nick <user> <nickname>`
- `.resetnick <user>`
- `.addrole <user> <role>`
- `.removerole <user> <role>`
- `.massrole <add|remove> <role> <member mentions or IDs>` (1-25 members)
- `.announce <channel> <message>`

Moderation commands check the caller's permissions and role hierarchy as applicable. The bot separately checks its own permissions and role position. Mass-role changes are limited to 25 selected members per command.

Purge commands scan at most 100 recent messages. Discord does not allow bulk deletion of messages older than 14 days; those are skipped and reported. The bot does not try to bypass that limit with individual deletes. `.purgebots` and `.purgeuser` scan the requested number of recent messages and only delete matching authors.

Warnings are stored in SQLite with guild ID, user ID, warning ID, reason, moderator ID, and creation timestamp. They remain after restarts and redeploys when `DATABASE_PATH` points to a Render persistent disk.

### Roles

- `.gradientrole <role> <#color1> <#color2>`
- `.gradientrole <role> <preset>`
- `.solidrole <role> <#color>`
- `.gradientinfo <role>`

Presets:

| Preset | First color | Second color |
| --- | --- | --- |
| HERO | `#38BDF8` | `#93C5FD` |
| CHAMPION | `#FFF176` | `#FFC107` |
| ELITE | `#BBF7D0` | `#4ADE80` |
| MASTER | `#5433FF` | `#20BDFF` |
| SUPREME | `#8B0000` | `#FF304F` |

The bot uses Discord's role color style API. It does not imitate gradients. If Discord rejects the style for a server or role, the command reports the API response and does not claim success.

### Minecraft Live Check

- `.livecheck setup [#channel]`
- `.livecheck status`
- `.livecheck channel [#channel]`
- `.livecheck disable`
- `.livecheck force`
- `.livecheck help`

Setup creates one message per guild, saved with its guild, channel, and message IDs in SQLite. The service edits that same message every 30 seconds and restores updates after a restart. Running setup again in the same channel edits the existing message. Moving it removes the prior message before creating its replacement. The bot uses a Minecraft server status ping library and does not log in as a Minecraft player.

## Environment

Copy `.env.example` to `.env` for local development. On Render, configure the same values as service environment variables instead.

| Variable | Required | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Discord bot token; keep it secret. |
| `CLIENT_ID` | Yes | Discord application ID. |
| `PREFIX` | No | Prefix for text commands; defaults to `.`. |
| `MC_SERVER_HOST` | For live checks | Minecraft server hostname. |
| `MC_SERVER_PORT` | No | Minecraft Java status port; defaults to `25565`. |
| `DATABASE_PATH` | No | SQLite database path; defaults to `./data/bot.db`. |
| `PORT` | No | HTTP health-server port; defaults to `3000`. |

## Deploy on Render

This repository includes `render.yaml` for a Render Blueprint. The service runs as a web service so the health endpoint is public, uses the requested build and start commands, registers slash commands before deploy, and mounts a persistent disk at `/var/data`.

1. Push this project to a Git provider connected to your Render account.
2. In Render, create a new **Blueprint Instance** from that repository and select `render.yaml`.
3. When prompted, provide `DISCORD_TOKEN` as a secret environment variable. Do not put the token in source control.
4. Confirm the service settings before creating it. The Blueprint requests a Starter web service and a 1 GB persistent disk because a continuously running bot and durable SQLite database require always-on compute and persistent storage.
5. After the first deploy succeeds, open the Render service URL and confirm `/health` returns `OK`.
6. Add that URL plus `/health` to UptimeRobot.

Render services use an ephemeral filesystem unless a persistent disk is attached. The Blueprint sets `DATABASE_PATH=/var/data/bot.db` on the mounted disk so warnings and live-check configuration survive restarts and deploys. Render API keys are not required by the running bot and should not be added to its environment.

If you deploy without the Blueprint, set the root directory to `.`, build command to `npm install && npm run build`, start command to `npm start`, and health-check path to `/health`. Use an always-on web service with a persistent disk mounted at `/var/data`; set `DATABASE_PATH=/var/data/bot.db`.

## Safety and limits

- Bot-generated replies remove emoji characters; announcements containing emoji are rejected.
- Prefix and slash commands run through the same command handlers.
- Slash command responses are private to the person who invoked the command.
- Moderation errors are handled without exposing stack traces to Discord.
- Role color styles depend on Discord API support for the server; API errors are returned accurately.
- No paid AI or Minecraft player-login services are used.