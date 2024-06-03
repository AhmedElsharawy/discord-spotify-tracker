# Spotify activity tracker for Discord

A discord bot that tracks a server's users Spotify activity and places them into a Top 40 playlist on a weekly basis.

A spotify premium account is required.

### This project uses `.env` for token access.

Create a Discord bot [here](https://discord.com/developers/applications) and grab your bot token.

Create a Spotify app [here](https://developer.spotify.com) and grab your app's Client ID and Client Secret.

Create a `.env` file and place the following:

```
DISCORD_TOKEN= your_discord_token
DISCORD_USER_ID= your_discord_user_id
SPOTIFY_CLIENT_ID= your_spotify_client_id
SPOTIFY_CLIENT_SECRET= your_spotify_client_secret
SPOTIFY_REDIRECT_URI= your_spotify_redirect_uri
YOUR_URI= your_ip_OR_url
```
Run `npm i` to install all the necessary node_modules.

Run the bot using `node main.js`

Log into Spotify and enjoy! :)
