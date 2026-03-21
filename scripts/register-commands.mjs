const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!applicationId) {
  throw new Error("Missing DISCORD_APPLICATION_ID");
}

if (!botToken) {
  throw new Error("Missing DISCORD_BOT_TOKEN");
}

const commands = [
  {
    name: "todo",
    description: "Todo を追加する",
    type: 1,
    options: [
      {
        name: "text",
        description: "タスク本文",
        type: 3,
        required: true
      }
    ]
  },
  {
    name: "todo-list",
    description: "Todo 一覧を表示する",
    type: 1,
    options: [
      {
        name: "status",
        description: "open, done, all から選ぶ",
        type: 3,
        required: false,
        choices: [
          { name: "open", value: "open" },
          { name: "done", value: "done" },
          { name: "all", value: "all" }
        ]
      }
    ]
  },
  {
    name: "info",
    description: "情報を参照・登録する",
    type: 1,
    options: [
      {
        name: "title",
        description: "情報タイトル（参照キー）",
        type: 3,
        required: true
      },
      {
        name: "url",
        description: "登録または更新したいURL",
        type: 3,
        required: false
      }
    ]
  },
  {
    name: "info-list",
    description: "登録済み情報を一覧表示する",
    type: 1,
    options: [
      {
        name: "limit",
        description: "表示件数（1-50）",
        type: 4,
        required: false,
        min_value: 1,
        max_value: 50
      }
    ]
  }
];

const apiBase = "https://discord.com/api/v10";
const url = guildId
  ? `${apiBase}/applications/${applicationId}/guilds/${guildId}/commands`
  : `${apiBase}/applications/${applicationId}/commands`;

const response = await fetch(url, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify(commands)
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Command registration failed: ${response.status} ${text}`);
}

const data = await response.json();
console.log(`Registered ${data.length} command(s) to ${guildId ? "guild" : "global"} scope.`);
