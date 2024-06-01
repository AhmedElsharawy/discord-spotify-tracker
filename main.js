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
    // Implementation for mostplayed command
  } else if (commandName === "mostactive") {
    // Implementation for mostactive command
  } else if (commandName === "leaderboard") {
    // Implementation for leaderboard command
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
          await interaction.reply("Your top 20 played tracks exceed the message length limit. Sending in multiple parts...");
          await sendPaginatedMessage(interaction, response);
        } else {
          interaction.reply(response);
        }
      },
    );
  }
});

client.on("presenceUpdate", (oldPresence, newPresence) => {
  // Implementation for presenceUpdate event
});

client.login(process.env.DISCORD_TOKEN);

