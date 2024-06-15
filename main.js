const { Client, GatewayIntentBits, REST, Routes } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const SpotifyWebApi = require("spotify-web-api-node");
const cron = require("node-cron");
const express = require("express");
require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

const db = new sqlite3.Database("./tracks.db", (err) => {
  if (err) {
    console.error(`Error opening database: ${err.message}`);
  } else {
    db.run(
      "CREATE TABLE IF NOT EXISTS tracks (guild_id TEXT, user TEXT, track_name TEXT, artist TEXT, timestamp TEXT)",
      (err) => {
        if (err) {
          console.error(`Error creating table: ${err.message}`);
        } else {
          console.log('Table "tracks" is ready');
        }
      },
    );
    db.run(
      "CREATE TABLE IF NOT EXISTS settings (guild_id TEXT PRIMARY KEY, playlist_channel_id TEXT)",
      (err) => {
        if (err) {
          console.error(`Error creating table: ${err.message}`);
        } else {
          console.log('Table "settings" is ready');
        }
      },
    );
  }
});

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI,
});

const app = express();

app.get("/login", (req, res) => {
  const authorizeURL = spotifyApi.createAuthorizeURL([
    "playlist-modify-public",
    "playlist-modify-private",
  ]);
  res.redirect(authorizeURL);
});

app.get("/callback", (req, res) => {
  const code = req.query.code || null;
  spotifyApi.authorizationCodeGrant(code).then(
    async function(data) {
      const accessToken = data.body["access_token"];
      const refreshToken = data.body["refresh_token"];

      // Store tokens securely in your environment variables or database
      process.env.SPOTIFY_ACCESS_TOKEN = accessToken;
      process.env.SPOTIFY_REFRESH_TOKEN = refreshToken;

      // Set access and refresh tokens for the Spotify API object
      spotifyApi.setAccessToken(accessToken);
      spotifyApi.setRefreshToken(refreshToken);

      res.send("Success! You can close this window.");

      // Schedule the weekly cron job to create the Spotify playlist
      schedulePlaylistCreation();
    },
    function(err) {
      console.log("Something went wrong!", err);
      res.send("Error during authentication");
    },
  );
});

const PORT = process.env.PORT || 8888;
app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
  console.log(
    "Authorize this app by visiting this URL:" +
    process.env.YOUR_URI +
    ":" +
    PORT +
    "/login",
  );
});
// Cronjob 
const schedulePlaylistCreation = () => {
  cron.schedule("0 20 * * 5", async () => {
    try {
      await refreshAccessToken();
      //await createWeeklySpotifyPlaylist();
      db.all("SELECT guild_id, playlist_channel_id FROM settings WHERE playlist_channel_id IS NOT NULL", async (err, rows) => {
        if (err) {
          console.error("Error fetching guilds and channel IDs:", err);
          return;
        }

        for (const row of rows) {
          const guildId = row.guild_id;
          await createWeeklySpotifyPlaylist(guildId);
        }
      });
    } catch (error) {
      console.error("Error scheduling playlist creation:", error);
    }
  });
};

const refreshAccessToken = async () => {
  try {
    const data = await spotifyApi.refreshAccessToken();
    const accessToken = data.body["access_token"];

    // Update the access token
    process.env.SPOTIFY_ACCESS_TOKEN = accessToken;
    spotifyApi.setAccessToken(accessToken);
    console.log("Access token refreshed successfully.");
  } catch (error) {
    console.error("Error refreshing access token:", error);
    throw error;
  }
};

const createWeeklySpotifyPlaylist = (guildId) => {
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error(`Guild with ID ${guildId} not found.`)
    }
    db.all(
      "SELECT track_name, artist, COUNT(*) as plays FROM tracks WHERE guild_id = ? GROUP BY track_name, artist ORDER BY plays DESC LIMIT 40",
      [guildId],
      (err, rows) => {
        if (err) {
          console.error(err);
          return;
        }

        const trackUris = [];
        const fetchTrackPromises = rows.map((row) => {
          return spotifyApi
            .searchTracks(`track:${row.track_name} artist:${row.artist}`)
            .then((data) => {
              if (data.body.tracks.items.length > 0) {
                trackUris.push(data.body.tracks.items[0].uri);
              } else {
                console.warn(
                  `Track not found on Spotify: ${row.track_name} by ${row.artist}`,
                );
              }
            })
            .catch((err) => {
              console.error(
                `Error searching for track on Spotify: ${err.message}`,
              );
            });
        });

        Promise.all(fetchTrackPromises).then(() => {
          const now = new Date();
          const year = now.getFullYear();
          const month = String(now.getMonth() + 1).padStart(2, "0");
          const day = String(now.getDate()).padStart(2, "0");
          const guildName = guild.name;
          const playlistName = `${guildName}'s Most Played - ${year}-${month}-${day}`;

          spotifyApi
            .createPlaylist(playlistName, {
              description: `Most played tracks of the week in ${guildName}!`,
              public: true,
            })
            .then((data) => {
              const playlistId = data.body.id;
              const playlistUrl = data.body.external_urls.spotify;

              spotifyApi
                .addTracksToPlaylist(playlistId, trackUris)
                .then(() => {
                  console.log("Playlist created and tracks added successfully!");

                  db.all(
                    "SELECT guild_id, playlist_channel_id FROM settings WHERE guild_id = ?",
                    [guildId],
                    (err, settingsRows) => {
                      if (err) {
                        console.error(`Error fetching settings: ${err.message}`);
                        return;
                      }

                      settingsRows.forEach((row) => {
                        const guild = client.guilds.cache.get(row.guild_id);
                        if (guild) {
                          const channel = guild.channels.cache.get(
                            row.playlist_channel_id,
                          );
                          if (channel) {
                            channel.send(
                              `It's the weekend! Here are your most played tracks in ${guildName}, make sure to check them out! ${playlistUrl}`,
                            );
                          } else {
                            console.error(
                              `Channel not found: ${row.playlist_channel_id}`,
                            );
                          }
                        } else {
                          console.error(`Guild not found: ${row.guild_id}`);
                        }
                      });
                    },
                  );
                })
                .catch((err) => {
                  console.error(
                    `Error adding tracks to playlist: ${err.message}`,
                  );
                });
            })
            .catch((err) => {
              console.error(`Error creating playlist: ${err.message}`);
            });
        });
      },
    );
  } catch (error) {
    console.error("Error creating weekly spotify playlist:", error);
  }
};

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);
  client.guilds.cache.forEach(guild => {
    console.log(`Bot is in guild: ${guild.id} - ${guild.name}`);
  });
  client.guilds.cache.forEach(registerCommands);
});

const registerCommands = async (guild) => {
  const commands = [
    {
      name: "help",
      description: "List help commands",
    },
    {
      name: "mostplayed",
      description: "Get the most played tracks in this server.",
    },
    {
      name: "mostactive",
      description: "Get the most active user in this server.",
    },
    {
      name: "leaderboard",
      description: "Get the leaderboard of most active users in this server.",
    },
    {
      name: "stats",
      description: "Get your personal play stats.",
    },
    {
      name: "forceplaylist",
      description: "Force creating a new weekly playlist.",
    },
    {
      name: "setchannel",
      description: "Set the channel for playlist announcements.",
      options: [
        {
          name: "channel",
          type: 7,
          description: "The channel to send playlist announcements to",
          required: true,
        },
      ],
    },
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log(`Registering commands for guild ${guild.id}`);
    await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), {
      body: commands,
    });
    console.log(`Successfully registered commands for guild ${guild.id}`);
  } catch (error) {
    console.error(`Failed to register commands for guild ${guild.id}:`, error);
  }
};

client.on("guildCreate", (guild) => {
  console.log(`Joined new guild: ${guild.name}`);
  registerCommands(guild);
});

const sendPaginatedMessage = async (interaction, message) => {
  const chunks = message.match(/(.|[\r\n]){1,2000}/g);
  for (const chunk of chunks) {
    await interaction.followUp(chunk);
  }
};

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  const { commandName, guildId, user } = interaction;

  if (commandName === "mostplayed") {
    db.all(
      "SELECT track_name, artist, COUNT(*) as plays FROM tracks WHERE guild_id = ? GROUP BY track_name, artist ORDER BY plays DESC LIMIT 10",
      [guildId],
      (err, rows) => {
        if (err) {
          console.error(err);
          return interaction.reply(
            "An error occurred while fetching most played tracks.",
          );
        }

        const tracks = rows.map(
          (row, index) =>
            `\`${index + 1}.\` **${row.track_name}** by *${row.artist}* - Plays: \`${row.plays}\``,
        );
        const response = tracks.length
          ? `**Most Played Tracks:**\n${tracks.join("\n")}`
          : "*No tracks found.*";

        interaction.reply(response);
      },
    );
  } else if (commandName === "mostactive") {
    db.get(
      "SELECT user, COUNT(*) as plays FROM tracks WHERE guild_id = ? GROUP BY user ORDER BY plays DESC LIMIT 1",
      [guildId],
      (err, row) => {
        if (err) {
          console.error(err);
          return interaction.reply(
            "An error occurred while fetching most active user.",
          );
        }

        const response = row
          ? `**Most Active User:**\n\`${row.user}\` - Plays: \`${row.plays}\``
          : "*No active users found.*";

        interaction.reply(response);
      },
    );
  } else if (commandName === "leaderboard") {
    db.all(
      "SELECT user, COUNT(*) as plays FROM tracks WHERE guild_id = ? GROUP BY user ORDER BY plays DESC LIMIT 10",
      [guildId],
      (err, rows) => {
        if (err) {
          console.error(err);
          return interaction.reply(
            "An error occurred while fetching leaderboard.",
          );
        }

        const leaderboard = rows.map(
          (row, index) =>
            `\`${index + 1}.\` **${row.user}** - Plays: \`${row.plays}\``,
        );
        const response = leaderboard.length
          ? `**Leaderboard of Most Active Users:**\n${leaderboard.join("\n")}`
          : "*No data found.*";
        interaction.reply(response);
      },
    );
  } else if (commandName === "stats") {
    db.all(
      "SELECT track_name, artist, COUNT(*) as plays FROM tracks WHERE guild_id = ? AND user = ? GROUP BY track_name, artist ORDER BY plays DESC LIMIT 20",
      [guildId, user.tag],
      async (err, rows) => {
        if (err) {
          console.error(err);
          return interaction.reply(
            "An error occurred while fetching your played tracks.",
          );
        }

        const tracks = rows.map(
          (row, index) =>
            `\`${index + 1}.\` **${row.track_name}** by *${row.artist}* - Plays: \`${row.plays}\``,
        );
        const response = tracks.length
          ? `**Your Top 20 Played Tracks:**\n${tracks.join("\n")}`
          : "*You have not played any tracks.*";

        if (response.length > 2000) {
          await interaction.reply(
            "Your top 20 played tracks exceed the message length limit. Sending in multiple parts...",
          );
          await sendPaginatedMessage(interaction, response);
        } else {
          interaction.reply(response);
        }
      },
    );
  } else if (commandName === "forceplaylist") {
    // TEST COMMAND, WILL BE REMOVED OR COMMENTED OUT AS SOON AS I VERIFY THAT THE CRONJOB WORKS.
    if (user.id === process.env.DISCORD_USER_ID) {
      await refreshAccessToken();
      createWeeklySpotifyPlaylist(guildId);
      interaction.reply("Playlist creation triggered!");
      // console.log(`${accessToken}`);
    } else {
      interaction.reply("You are not authorized to trigger this command.");
    }
  } else if (commandName === "setchannel") {
    const channelId = interaction.options.getChannel("channel").id;

    db.run(
      "INSERT OR REPLACE INTO settings (guild_id, playlist_channel_id) VALUES (?, ?)",
      [guildId, channelId],
      (err) => {
        if (err) {
          console.error(`Error setting playlist channel: ${err.message}`);
          return interaction.reply(
            "An error occurred while setting the playlist channel.",
          );
        }

        interaction.reply(`Playlist channel set to <#${channelId}>`);
      },
    );
  } else if (commandName === "help") {
    const helpMessage = `**Available Commands:**
      \`/mostplayed\` - Get the most played tracks in this server.
      \`/mostactive\` - Get the most active Spotify user in this server.
      \`/leaderboard\` - Get the leaderboard of most active Spotify users in this server.
      \`/stats\` - Get your personal Spotify stats.
      \`/setchannel\` - Sets a channel to send the weekly playlist every week.`;
    return interaction.reply(helpMessage);
  }
});

client.on("presenceUpdate", (oldPresence, newPresence) => {
  //console.log(
  //  `Presence update detected for user: ${newPresence.user?.tag || "Unknown User"}`,
  //);

  if (newPresence.activities && newPresence.activities.length > 0) {
    // console.log(`Activities: ${JSON.stringify(newPresence.activities)}`);
    newPresence.activities.forEach((activity) => {
      // console.log(`Activity detected: ${JSON.stringify(activity)}`);
      if (activity.type === 2 && activity.name === "Spotify") {
        const user = newPresence.user.tag;
        const trackName = activity.details;
        const artist = activity.state;
        const timestamp = new Date().toISOString();
        const guildId = newPresence.guild.id;
        

        //A random bot in a random ass server decided to add null entries. So here's a null check, thanks ManageBot very cool.
        if (!trackName || !artist) {
          console.warn(`Skipping null entry (Thanks ManageBot#0805, very cool.)`)
          return;
        }

        console.log(
          `User ${user} is listening to ${trackName} by ${artist} in guild ${guildId}`,
        );

        console.log(
          `Inserting data: ${guildId}, ${user}, ${trackName}, ${artist}, ${timestamp}`,
        );

        db.run(
          "INSERT INTO tracks (guild_id, user, track_name, artist, timestamp) VALUES (?, ?, ?, ?, ?)",
          [guildId, user, trackName, artist, timestamp],
          (err) => {
            if (err) {
              console.error(`Database insertion error: ${err.message}`);
            } else {
              console.log(`Track inserted: ${trackName} by ${artist}`);
            }
          },
        );
      }
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
