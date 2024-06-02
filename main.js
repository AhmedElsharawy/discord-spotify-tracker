const { Client, GatewayIntentBits } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();

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
  }
});

const registerCommands = (guild) => {
  guild.commands.create({
    name: "mostplayed",
    description: "Display the most played tracks",
  });

  guild.commands.create({
    name: "mostactive",
    description: "Display the most active user",
  });

  guild.commands.create({
    name: "leaderboard",
    description: "Display the leaderboard of most active users",
  });

  guild.commands.create({
    name: "stats",
    description: "Display your top 20 most played tracks and play count",
  });
};

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}!`);

  client.guilds.cache.forEach(registerCommands);
});

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
  }
});

client.on("presenceUpdate", (oldPresence, newPresence) => {
  // Monitor user presence
  console.log(
    `Presence update detected for user: ${newPresence.user?.tag || "Unknown User"}`,
  );

  if (newPresence.activities && newPresence.activities.length > 0) {
    console.log(`Activities: ${JSON.stringify(newPresence.activities)}`);
    newPresence.activities.forEach((activity) => {
      console.log(`Activity detected: ${JSON.stringify(activity)}`);
      if (activity.type === 2 && activity.name === "Spotify") {
        const user = newPresence.user.tag;
        const trackName = activity.details;
        const artist = activity.state;
        const timestamp = new Date().toISOString();
        const guildId = newPresence.guild.id;

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
  } else {
    console.log("No activities found.");
  }
});

client.login(process.env.DISCORD_TOKEN);
